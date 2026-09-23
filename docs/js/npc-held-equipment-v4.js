// Civilian NPC held tools/weapons using live walkers and the player's shared held-tool presentation primitives.
(() => {
  'use strict';

  const VERSION = 4; // Loader/debug gate for the player-parity implementation.
  const SCAN_MS = 100; // Finds newly spawned/rebuilt walkers; pose work itself stays on each walker's update.
  const TOOL_W = 0.5; // Player/Attack Editor fallback width when the shared factory is unavailable.
  const HOE_SWING_S = 0.42; // Player chop/hoe presentation duration.
  const WF = 0.16, SF = 0.28, HF = SF + (1 - SF) * 0.3; // Player four-phase chop timing.
  const CHOP_NEUTRAL = Object.freeze({ x: .03, y: .37, z: -.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 });
  const CHOP_WINDUP = Object.freeze({ x: -.18, y: .41, z: -.15, pitch: -165, yaw: 13, bodyYaw: -29, roll: -112 });
  const CHOP_STRIKE = Object.freeze({ x: 0, y: 0, z: .12, pitch: 13, yaw: -28, bodyYaw: 29, roll: -91 });
  const BRONZE = Object.freeze({ hex: '#CD7F32', verdigrisHex: '#57B38B' });
  const WATCHMEN = Object.freeze({
    oddclaw_unumanuk: Object.freeze({ name: 'Oddclaw', toolKey: 'hatchet', sprite: 'assets/toolsprites/axe_hatchet.png', stance: 'heavy', mastery: 3, xp: 150, verdigris: .5 }),
    spearhead_unumanuk: Object.freeze({ name: 'Spearhead', toolKey: 'fishingspear', sprite: 'assets/toolsprites/harpoon_fishingspear.png', stance: 'light', mastery: 5, xp: 300, verdigris: 1 }),
  });

  const states = new Set(); // Managed live walkers, iterable for cleanup/debug.
  const stateByWalker = new WeakMap(); // Prevents duplicate update wrappers.
  const claimedRigs = new WeakMap(); // Per-hand ownership so walk/idle fallback cannot overwrite a held right hand.
  const loggedHoe = new WeakSet(); // One confirmation after a farmer reaches the real grip path.
  let scanTimer = null;
  let banditDeps = null; // Captured BanditCombat.init dependency bag; owns the exact player/bandit makeToolPlaneMesh factory.

  const T = () => window.THREE || null;
  const grips = () => window.HobunjiHandToolGrips || null;
  const profiles = () => window.HobunjiHandModelProfiles || null;
  const rad = value => (Number(value) || 0) * Math.PI / 180;
  const normalizeToolKey = value => grips()?.toolKeyFor?.(value) || String(value || '').trim().toLowerCase();

  function installBanditDepsCapture() {
    const api = window.BanditCombat; // combat-bandit.js is parser-loaded before this module.
    if (!api?.init) return false;
    if (api.__npcHeldEquipmentV4Capture) return true;
    const originalInit = api.init.bind(api);
    api.init = function npcHeldEquipmentCaptureBanditDeps(injectedDeps) {
      banditDeps = injectedDeps || null;
      return originalInit(injectedDeps);
    };
    Object.defineProperty(api, '__npcHeldEquipmentV4Capture', { value: true, configurable: true });
    return true;
  }

  function sharedToolFactory() {
    return banditDeps?.makeToolPlaneMesh || window.Combat?.deps?.makeToolPlaneMesh || null;
  }

  function liveWalkers() {
    const debugWalkers = window.__hobunjiFurnitureDebug?.getNpcWalkers?.(); // Existing game-owned live-walker seam.
    if (Array.isArray(debugWalkers)) return debugWalkers;
    if (Array.isArray(window._npcWalkers)) return window._npcWalkers; // Existing global fallback used by perp-rotation.
    return [];
  }

  function avatarRootFor(walker) {
    if (walker?.avatarGroup?.userData?.proceduralHandRig) return walker.avatarGroup;
    let found = null;
    walker?.root?.traverse?.(node => {
      if (!found && node?.userData?.proceduralHandRig) found = node;
    });
    return found || walker?.avatarGroup || null;
  }

  function rigFor(walker) {
    return avatarRootFor(walker)?.userData?.proceduralHandRig || null;
  }

  function watchmanLoadoutFor(walker) {
    const id = String(walker?.rec?.id || '').trim().toLowerCase();
    if (WATCHMEN[id]) return { ...WATCHMEN[id], matchedBy: 'id' };
    const name = String(walker?.rec?.name || '').trim().toLowerCase();
    for (const loadout of Object.values(WATCHMEN)) {
      const first = loadout.name.toLowerCase();
      if (name === first || name.startsWith(`${first} `)) return { ...loadout, matchedBy: 'name' };
    }
    return null;
  }

  function anchorFor(walker) {
    const avatar = avatarRootFor(walker);
    const h = Number(avatar?.userData?.portraitModelHeight) || Number(walker?.avatarHeight) || .9;
    const w = Number(avatar?.userData?.portraitModelWidth) || h;
    return {
      x: Number.isFinite(Number(avatar?.userData?.handAttachX)) ? Number(avatar.userData.handAttachX) : -w / 2,
      y: Number.isFinite(Number(avatar?.userData?.handAttachY)) ? Number(avatar.userData.handAttachY) : h / 2,
    };
  }

  function disposeBodyYawWrapper(state) {
    const rec = state?.bodyYaw;
    if (!rec) return;
    rec.wrapper.rotation.y = 0;
    rec.wrapper.updateWorldMatrix?.(true, true);
    if (rec.body?.parent === rec.wrapper) rec.originalParent?.add?.(rec.body);
    if (rec.feet?.parent === rec.wrapper) rec.originalParent?.add?.(rec.feet);
    rec.wrapper.parent?.remove?.(rec.wrapper);
    state.bodyYaw = null;
  }

  function ensureBodyYawWrapper(state) {
    const three = T(), walker = state?.walker, rig = rigFor(walker);
    const body = rig?.parent, root = walker?.root;
    if (!three || !body || !root || body === root || !body.parent) return null;
    if (state.bodyYaw?.body === body && body.parent === state.bodyYaw.wrapper) return state.bodyYaw;
    if (state.bodyYaw) disposeBodyYawWrapper(state);
    const originalParent = body.parent;
    const wrapper = new three.Group();
    wrapper.name = `${walker?.rec?.id || 'npc'}_held_stance_body_yaw`;
    wrapper.userData = { npcHeldStanceBodyYaw: true };
    originalParent.add(wrapper); // Identity insertion preserves the presentation's existing world transform.
    wrapper.add(body);
    const feet = [...(originalParent.children || [])].find(child => child !== wrapper && /_procedural_feet$/.test(String(child?.name || ''))) || null;
    if (feet) wrapper.add(feet); // Player bodyYaw turns the complete body rig; keep NPC feet on the same heading too.
    state.bodyYaw = { wrapper, body, feet, originalParent, yawDeg: 0 };
    return state.bodyYaw;
  }

  function applyBodyYaw(state, yawDeg) {
    const rec = ensureBodyYawWrapper(state);
    if (!rec) return false;
    rec.yawDeg = Number(yawDeg) || 0;
    rec.wrapper.rotation.y = rad(rec.yawDeg);
    rec.wrapper.updateWorldMatrix?.(true, true);
    return true;
  }

  function clearBodyYaw(state) {
    const rec = state?.bodyYaw;
    if (!rec) return;
    rec.yawDeg = 0;
    rec.wrapper.rotation.y = 0;
    rec.wrapper.updateWorldMatrix?.(true, true);
  }

  function poseQuaternion(pose, foldBodyYaw = false) {
    const three = T();
    if (!three) return null;
    const yaw = (Number(pose?.yaw) || 0) + (foldBodyYaw ? (Number(pose?.bodyYaw) || 0) : 0);
    return new three.Quaternion().setFromEuler(new three.Euler(rad(pose?.pitch), rad(yaw), rad(pose?.roll), 'YXZ'));
  }

  function setHolderPose(state, holder, pose) {
    const three = T(), walker = state?.walker, rig = rigFor(walker);
    const separatedBodyYaw = applyBodyYaw(state, pose?.bodyYaw); // Mirrors WeaponIdleBodyYawRuntime instead of baking bodyYaw into the item.
    const sourceParent = rig?.parent || walker?.root;
    const holderParent = holder?.parent || walker?.root;
    if (!three || !sourceParent || !holderParent || !pose) return false;
    const anchor = anchorFor(walker);
    const p = new three.Vector3(anchor.x + (Number(pose.x) || 0), anchor.y + (Number(pose.y) || 0), Number(pose.z) || 0);
    const q = poseQuaternion(pose, !separatedBodyYaw); // Fallback only: if no body wrapper exists yet, preserve the old combined orientation temporarily.
    if (!q) return false;
    sourceParent.updateWorldMatrix?.(true, false);
    holderParent.updateWorldMatrix?.(true, false);
    const avatar = avatarRootFor(walker); // Supplies cached identity, portrait height and weapon-orbit metadata.
    const armLength = Number(avatar?.userData?.armLength);
    const poseOrbitScale = Number(avatar?.userData?.poseOrbitScale);
    const speciesId = avatar?.userData?.speciesId || walker?.rec?.appearance?.speciesId || walker?.rec?.species || null; // Used by shared authored-Y height mapping.
    const gender = avatar?.userData?.gender || walker?.rec?.appearance?.gender || walker?.rec?.gender || 'male';
    const modelHeight = Number(avatar?.userData?.portraitModelHeight) || Number(walker?.avatarHeight) || .9;
    const scaler = window.HobunjiSpeciesPoseScale;
    const scale = scaler?.scaleForPose?.(poseOrbitScale, armLength) ?? 1;
    // sourceParent already contains any CharacterRigScale parent scale. Passing
    // rigScaleY=1 below avoids applying that body scale twice; the world-space
    // authored delta already carries the target rigScaleY once through the hierarchy.
    const height = scaler?.heightMetrics?.(speciesId, gender, modelHeight, 1) || null;
    const needsPoseMap = Math.abs(scale - 1) > 1e-9 || Math.abs((height?.heightRatio ?? 1) - 1) > 1e-9;
    if (sourceParent === holderParent && !needsPoseMap) {
      holder.position.copy(p); // Preserve the exact identity path without unnecessary world/local round-trips.
      holder.quaternion.copy(q);
    } else {
      const worldP = sourceParent.localToWorld(p.clone()); // Finished point after the character hierarchy has contributed its real body scale once.
      if (avatar && needsPoseMap) {
        avatar.updateWorldMatrix?.(true, false);
        const centroidLocal = new three.Vector3(
          Number(avatar.userData?.visualCentroidLocalX) || 0,
          Number(avatar.userData?.visualCentroidLocalY) || 0,
          Number(avatar.userData?.visualCentroidLocalZ) || 0,
        );
        const centroid = avatar.localToWorld(centroidLocal); // Horizontal X/Z orbit center in world space.
        const baseWorld = sourceParent.localToWorld(new three.Vector3(anchor.x, anchor.y, 0)); // Actual already-scaled raw hand base.
        const floorWorld = sourceParent.localToWorld(new three.Vector3(0, 0, 0)); // Actual already-scaled character floor.
        if (scaler?.transformPosePoint) {
          scaler.transformPosePoint(worldP, {
            cx: centroid.x, cz: centroid.z, floorY: floorWorld.y, baseY: baseWorld.y,
            speciesId, gender, modelHeight, rigScaleY: 1,
            armLength, poseOrbitScale,
          });
        } else {
          scaler?.scalePointAroundCentroid?.(worldP, centroid.x, centroid.y, centroid.z, armLength, poseOrbitScale);
        }
      }
      const worldQ = sourceParent.getWorldQuaternion(new three.Quaternion()).multiply(q);
      const parentQ = holderParent.getWorldQuaternion(new three.Quaternion()).invert();
      holder.position.copy(holderParent.worldToLocal(worldP));
      holder.quaternion.copy(parentQ.multiply(worldQ));
    }
    holder.updateWorldMatrix?.(true, true);
    return true;
  }

  function phase(progress, windup, strike, neutral) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    if (p <= WF) return neutral + (windup - neutral) * (p / Math.max(.0001, WF));
    if (p <= SF) return windup + (strike - windup) * ((p - WF) / Math.max(.0001, SF - WF));
    if (p <= HF) return strike;
    return strike + (neutral - strike) * ((p - HF) / Math.max(.0001, 1 - HF));
  }

  function hoePose(progress) {
    const neutral = window.WeaponToolStances?.poses?.hoeTool || CHOP_NEUTRAL;
    const out = {};
    for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll']) out[key] = phase(progress, CHOP_WINDUP[key], CHOP_STRIKE[key], Number(neutral[key]) || 0);
    return out;
  }

  function watchmanPose(loadout) {
    const poses = window.WeaponToolStances?.poses;
    if (!poses) return null;
    return loadout.stance === 'heavy' ? poses.heavyWeapon : poses.lightWeapon;
  }

  function primaryGrip(key) {
    return grips()?.authoredPrimaryGripForTool?.(key) || { position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 } };
  }

  function gripScale(key) {
    const n = Number(grips()?.toolScaleForTool?.(key));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function gripQuaternion(frame) {
    const three = T(), r = frame?.rotationDeg || {};
    return three ? new three.Quaternion().setFromEuler(new three.Euler(rad(r.pitch), rad(r.yaw), rad(r.roll), 'YXZ')) : null;
  }

  function applyGripScale(visual, key) {
    if (!visual || visual.userData?.npcGripKey === key) return;
    visual.scale.setScalar(gripScale(key)); // Grip target moves the HAND; held-item position/rotation remain authored by the stance animation.
    visual.userData = { ...(visual.userData || {}), npcGripKey: key };
  }

  function stationVisual(holder, key) {
    if (holder?.userData?.npcGripVisualV4) return holder.userData.npcGripVisualV4;
    const three = T();
    if (!holder || !three) return null;
    const visual = new three.Group();
    visual.name = `npc_${key}_grip_visual_v4`;
    for (const child of [...holder.children]) visual.add(child);
    holder.add(visual);
    holder.userData = { ...(holder.userData || {}), npcGripVisualV4: visual };
    applyGripScale(visual, key);
    return visual;
  }

  function handFrame(walker) {
    const three = T(), rig = rigFor(walker), profileApi = profiles();
    if (!three || !rig || !profileApi) return null;
    const species = rig.speciesId, gender = rig.gender;
    const raw = window.HobunjiHandGripModes?.effectiveFrameForSpecies?.(species)
      || profileApi.handTransformForSpecies?.(species)
      || profileApi.modelForSpecies?.(species)?.handFromTool
      || {};
    const p = raw.position || {}, r = raw.rotationDeg || {}, q = raw.rotationQuaternion || null;
    const avatar = avatarRootFor(walker);
    const modelH = Number(avatar?.userData?.portraitModelHeight) || Number(walker?.avatarHeight) || .9;
    const speciesScale = Number(profileApi.effectiveScaleFor?.(species, gender)) || 1;
    const unit = modelH * (Number(profileApi.data?.handHeightFraction) || .12) * speciesScale;
    const rotation = q && [q.x, q.y, q.z, q.w].every(v => Number.isFinite(Number(v)))
      ? new three.Quaternion(Number(q.x), Number(q.y), Number(q.z), Number(q.w)).normalize()
      : new three.Quaternion().setFromEuler(new three.Euler(rad(r.pitch), rad(r.yaw), rad(r.roll), 'YXZ'));
    return { position: new three.Vector3((Number(p.x) || 0) * unit, (Number(p.y) || 0) * unit, (Number(p.z) || 0) * unit), quaternion: rotation };
  }

  function worldFrame(holder) {
    const three = T();
    if (!three || !holder) return null;
    holder.updateWorldMatrix?.(true, true);
    return { position: holder.getWorldPosition(new three.Vector3()), quaternion: holder.getWorldQuaternion(new three.Quaternion()) };
  }

  function ensureClaims(rig) {
    if (!rig) return null;
    const prior = claimedRigs.get(rig);
    if (prior) return prior;
    const rawSet = typeof rig.setSideIdle === 'function' ? rig.setSideIdle.bind(rig) : null;
    const rawBoth = typeof rig.useIdlePose === 'function' ? rig.useIdlePose.bind(rig) : null;
    const claims = { left: null, right: null, rawSet, rawBoth };
    if (rawSet) rig.setSideIdle = (side, pose) => claims[side] ? false : (rawSet(side, pose), true);
    if (rawBoth) rig.useIdlePose = poses => {
      if (!claims.left && !claims.right) return rawBoth(poses);
      if (!claims.left) rawSet?.('left', poses?.left || null);
      if (!claims.right) rawSet?.('right', poses?.right || null);
      return true;
    };
    claimedRigs.set(rig, claims);
    return claims;
  }

  function releaseClaims(walker) {
    const claims = claimedRigs.get(rigFor(walker));
    if (claims) claims.left = claims.right = null;
  }

  function attachPrimaryHand(walker, holder, key, owner) {
    const rig = rigFor(walker), hand = handFrame(walker), socket = worldFrame(holder);
    if (!rig?.placeHandWorld || !hand || !socket) return false;
    const claims = ensureClaims(rig);
    if (claims) {
      claims.right = owner;
      claims.left = null; // Idle fishingspear is explicitly secondary=no; attack animation metadata gates any left-hand span.
    }

    const grip = primaryGrip(key); // Authored point/orientation ON the weapon where the right hand must land.
    const gripP = grip.position || {};
    const gripQ = gripQuaternion(grip);
    const scale = gripScale(key);
    socket.position.add(new (T().Vector3)(
      (Number(gripP.x) || 0) * scale,
      (Number(gripP.y) || 0) * scale,
      (Number(gripP.z) || 0) * scale,
    ).applyQuaternion(socket.quaternion));
    if (gripQ) socket.quaternion.multiply(gripQ);

    const rightP = socket.position.clone().add(hand.position.clone().applyQuaternion(socket.quaternion));
    const rightQ = socket.quaternion.clone().multiply(hand.quaternion);
    rig.setSideVisible?.('right', true);
    rig.placeHandWorld('right', rightP, rightQ);
    return true;
  }

  function findToolPlane(root) {
    if (!root) return null;
    if (root.userData?.toolPlane?.isObject3D) return root.userData.toolPlane;
    if (root.isMesh && root.material) return root;
    let plane = null;
    root.traverse?.(node => {
      if (plane) return;
      if (node?.userData?.toolPlane?.isObject3D) plane = node.userData.toolPlane;
      else if (node?.isMesh && node.material) plane = node;
    });
    return plane;
  }

  function mappedMaterials(node) {
    const list = Array.isArray(node?.material) ? node.material : (node?.material ? [node.material] : []);
    return list.filter(material => material?.map);
  }

  function applyRecoloredCanvasToSharedPlane(state, plane, canvas) {
    if (!plane || !canvas) return false;
    const materials = mappedMaterials(plane);
    if (!materials.length) return false;
    let changed = false;
    for (const material of materials) {
      const source = material.map;
      const texture = source?.clone?.();
      if (!texture) continue;
      texture.image = canvas; // Preserve player texture flipY/filter/wrap/encoding; only replace pixel source.
      texture.needsUpdate = true;
      material.map = texture;
      material.needsUpdate = true;
      state.ownedTextures.add(texture);
      changed = true;
    }
    return changed;
  }

  function makeFallbackToolVisual(state, loadout, canvas) {
    const three = T();
    if (!three) return null;
    return new Promise(resolve => {
      const finish = texture => {
        if (!texture) return resolve(null);
        state.ownedTextures.add(texture);
        texture.magFilter = three.NearestFilter;
        texture.minFilter = three.NearestFilter;
        if ('colorSpace' in texture && three.SRGBColorSpace) texture.colorSpace = three.SRGBColorSpace;
        else if ('encoding' in texture && three.sRGBEncoding) texture.encoding = three.sRGBEncoding;
        texture.needsUpdate = true;
        const w = texture.image?.naturalWidth || texture.image?.width || canvas?.width || 1;
        const h = texture.image?.naturalHeight || texture.image?.height || canvas?.height || 1;
        const plane = new three.Mesh(
          new three.PlaneGeometry(TOOL_W, TOOL_W * h / Math.max(1, w)),
          new three.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .08, side: three.DoubleSide }), // Exact player/editor cutout convention.
        );
        plane.rotation.x = -Math.PI / 2;
        resolve({ root: plane, plane, source: 'fallback-player-convention' });
      };
      if (canvas) finish(new three.CanvasTexture(canvas));
      else new three.TextureLoader().load(loadout.sprite, finish, undefined, () => resolve(null));
    });
  }

  async function buildWatchman(state, loadout) {
    if (state.holder || state.buildPromise || state.disposed) return state.holder || state.buildPromise;
    const three = T(), parent = state.walker?.root?.parent;
    if (!three || !parent) return null;
    const generation = ++state.buildGeneration;
    state.buildPromise = (async () => {
      let canvas = null;
      try {
        canvas = await window.ToolMetalRecolor?.getRecoloredCanvas?.(loadout.sprite, {
          targetHex: BRONZE.hex, verdigrisHex: BRONZE.verdigrisHex, oxidationAmount: loadout.verdigris,
        });
      } catch (error) {
        window.__farmLog?.(`[npc-held-v4] ${state.walker?.rec?.id}: verdigris render failed: ${error?.message || error}`, 'warn');
      }
      if (state.disposed || generation !== state.buildGeneration) return null;

      let built = null;
      const factory = sharedToolFactory();
      if (factory) {
        try {
          const root = factory(loadout.toolKey); // Exact same plane/material/texture construction used by player and bandits.
          const plane = findToolPlane(root);
          if (root && plane) {
            if (canvas) applyRecoloredCanvasToSharedPlane(state, plane, canvas);
            built = { root, plane, source: 'shared-makeToolPlaneMesh' };
          }
        } catch (error) {
          window.__farmLog?.(`[npc-held-v4] ${state.walker?.rec?.id}: shared tool factory failed: ${error?.message || error}`, 'warn');
        }
      }
      if (!built) built = await makeFallbackToolVisual(state, loadout, canvas);
      if (!built || state.disposed || generation !== state.buildGeneration) return null;

      const visual = new three.Group();
      visual.name = `${state.walker.rec.id}_${loadout.toolKey}_visual`;
      visual.userData = { toolPlane: built.plane };
      visual.add(built.root);
      applyGripScale(visual, loadout.toolKey); // Primary grip is hand-owned now; watchman weapon keeps the authored holder transform and only inherits intrinsic item scale.
      const holder = new three.Group();
      holder.name = `${state.walker.rec.id}_${loadout.toolKey}_holder`;
      holder.userData = { toolPlane: built.plane, npcWatchmanWeapon: true, toolKey: loadout.toolKey };
      holder.add(visual);
      parent.add(holder);
      if (built.plane) built.plane.name = `${state.walker.rec.id}_${loadout.toolKey}_plane`;
      state.holder = holder;
      state.visualSource = built.source;
      state.buildPromise = null;
      window.__farmLog?.(`[npc-held-v4] ${state.walker.rec.name || state.walker.rec.id}: ARMED ${loadout.toolKey}, ${loadout.stance}, mastery ${loadout.mastery}/5, verdigris ${Math.round(loadout.verdigris * 100)}%, visual=${built.source}`, 'combat');
      updateState(state);
      return holder;
    })().catch(error => {
      state.buildPromise = null;
      window.__farmLog?.(`[npc-held-v4] ${state.walker?.rec?.id}: weapon build failed: ${error?.message || error}`, 'warn');
      return null;
    });
    return state.buildPromise;
  }

  function disposeObject(state, root) {
    root?.traverse?.(node => {
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
      for (const material of materials) {
        if (state.ownedTextures.has(material?.map)) material.map.dispose?.(); // Never dispose the shared factory's global base texture.
        material?.dispose?.();
      }
    });
    for (const texture of state.ownedTextures) texture?.dispose?.();
    state.ownedTextures.clear();
  }

  function updateState(state) {
    const walker = state.walker;
    state.lastUpdateAt = performance.now();
    const loadout = watchmanLoadoutFor(walker);
    if (loadout) {
      const parent = walker?.root?.parent;
      if (!state.holder) { buildWatchman(state, loadout); releaseClaims(walker); state.mode = 'watchman-loading'; return; }
      if (parent && state.holder.parent !== parent) parent.add(state.holder);
      const pose = watchmanPose(loadout);
      if (pose) setHolderPose(state, state.holder, pose);
      state.holder.visible = walker?.root?.visible !== false;
      state.handsAttached = attachPrimaryHand(walker, state.holder, loadout.toolKey, `watchman:${loadout.toolKey}`);
      state.mode = 'watchman'; state.key = loadout.toolKey; state.loadout = loadout;
      return;
    }

    state.loadout = null;
    const target = walker?.currentScheduleTarget || null;
    const key = normalizeToolKey(target?.toolKey || walker?.stationToolKey);
    if (!key || key === 'kurraya' || !walker?.stationToolMesh) {
      clearBodyYaw(state);
      releaseClaims(walker);
      state.mode = null; state.key = null; state.handsAttached = false;
      return;
    }
    stationVisual(walker.stationToolMesh, key);
    if (key === 'hoe') {
      const interval = Math.max(.2, Number(target?.toolIntervalSec) || 2);
      const actionTime = Math.max(0, Number(walker.stationToolT) || 0);
      const duration = Math.min(interval, HOE_SWING_S);
      const progress = actionTime <= duration ? actionTime / Math.max(.0001, duration) : 1;
      setHolderPose(state, walker.stationToolMesh, hoePose(progress));
      state.mode = 'station-hoe';
      state.handsAttached = attachPrimaryHand(walker, walker.stationToolMesh, key, 'station:hoe');
      if (!loggedHoe.has(walker) && state.handsAttached) {
        loggedHoe.add(walker);
        window.__farmLog?.(`[npc-held-v4] ${walker.rec?.name || walker.rec?.id}: HOE HAND CLAIMED and following player-style socket/body-yaw`, 'combat');
      }
    } else {
      clearBodyYaw(state);
      state.mode = 'station-tool';
      state.handsAttached = attachPrimaryHand(walker, walker.stationToolMesh, key, `station:${key}`);
    }
    state.key = key;
  }

  function wrapWalker(walker) {
    if (!walker || typeof walker.update !== 'function') return null;
    const prior = stateByWalker.get(walker);
    if (prior) return prior;
    const original = walker.update;
    const state = {
      walker, original, wrapped: null, holder: null, buildPromise: null, buildGeneration: 0,
      mode: null, key: null, loadout: null, handsAttached: false, lastUpdateAt: null,
      bodyYaw: null, visualSource: null, ownedTextures: new Set(), disposed: false,
    };
    state.wrapped = function npcHeldV4WalkerUpdate(...args) {
      const result = original.apply(this, args);
      updateState(state);
      return result;
    };
    walker.update = state.wrapped;
    stateByWalker.set(walker, state);
    states.add(state);
    const loadout = watchmanLoadoutFor(walker);
    if (loadout) buildWatchman(state, loadout);
    return state;
  }

  function disposeState(state) {
    if (!state || state.disposed) return;
    state.disposed = true;
    state.buildGeneration++;
    releaseClaims(state.walker);
    disposeBodyYawWrapper(state);
    if (state.walker?.update === state.wrapped) state.walker.update = state.original;
    if (state.holder) { state.holder.parent?.remove?.(state.holder); disposeObject(state, state.holder); state.holder = null; }
    states.delete(state);
  }

  function scan() {
    installDebug();
    const walkers = liveWalkers();
    if (!walkers.length) return;
    const live = new Set(walkers);
    for (const walker of live) wrapWalker(walker);
    for (const state of [...states]) if (!live.has(state.walker)) disposeState(state);
  }

  function snapshot(npcId = null) {
    const rows = [];
    for (const state of states) {
      const walker = state.walker;
      if (npcId && walker?.rec?.id !== npcId) continue;
      const loadout = watchmanLoadoutFor(walker), rig = rigFor(walker), claims = rig ? claimedRigs.get(rig) : null;
      rows.push({
        version: VERSION,
        id: walker?.rec?.id || null,
        name: walker?.rec?.name || null,
        mode: state.mode,
        toolKey: loadout?.toolKey || state.key,
        stance: loadout?.stance || (state.key === 'hoe' ? 'hoeTool' : null),
        mastery: loadout?.mastery ?? null,
        verdigris: loadout?.verdigris ?? null,
        holderReady: loadout ? !!state.holder : !!walker?.stationToolMesh,
        holderVisible: state.holder?.visible ?? null,
        rigReady: !!rig,
        handsAttached: !!state.handsAttached,
        rightHandOwner: claims?.right || null,
        leftHandOwner: claims?.left || null,
        secondaryGripActive: false,
        bodyYawDeg: state.bodyYaw?.yawDeg ?? 0,
        bodyYawSeparated: !!state.bodyYaw,
        visualSource: state.visualSource,
        sharedPlaneFactoryReady: !!sharedToolFactory(),
        walkerState: walker?.state || null,
        area: walker?.area || null,
        lastUpdateAgeMs: state.lastUpdateAt == null ? null : Math.max(0, Math.round(performance.now() - state.lastUpdateAt)),
      });
    }
    return npcId ? (rows[0] || null) : rows;
  }

  function installDebug() {
    if (!window.__farmDebugTools) return;
    window.__farmDebugTools.npcHeldEquipmentSnapshot = snapshot;
    window.__farmDebugTools.rescanNpcHeldEquipment = () => { scan(); return snapshot(); };
  }

  installBanditDepsCapture();
  window.NpcHeldEquipment = {
    version: VERSION,
    liveWalkers,
    debugSnapshot: snapshot,
    rescan() { scan(); return snapshot(); },
  };

  scan();
  scanTimer = window.setInterval(scan, SCAN_MS);
  window.__farmLog?.('[npc-held-v4] installed: player-parity body yaw, primary-hand idle grips, shared tool-plane factory capture', 'combat');
})();
