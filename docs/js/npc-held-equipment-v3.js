// Civilian NPC held tools/weapons, driven from the live walker array rather than NpcScheduling init hooks.
(() => {
  'use strict';

  const VERSION = 3; // Loader/debug gate for the live-walker implementation.
  const SCAN_MS = 100; // Walker discovery latency; actual pose work still runs only inside each walker's own update.
  const TOOL_W = 0.5; // Runtime/Attack Editor held-tool world width.
  const RENDER_ORDER = 1.5; // Same held-object render order used by ordinary tools.
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
  const claimedRigs = new WeakMap(); // Per-hand ownership so fallback walk/idle cannot overwrite a gripped hand.
  const loggedHoe = new WeakSet(); // One in-game confirmation per farmer after the real grip path executes.
  let scanTimer = null;

  const T = () => window.THREE || null;
  const grips = () => window.HobunjiHandToolGrips || null;
  const profiles = () => window.HobunjiHandModelProfiles || null;
  const rad = value => (Number(value) || 0) * Math.PI / 180;
  const normalizeToolKey = value => grips()?.toolKeyFor?.(value) || String(value || '').trim().toLowerCase();

  function liveWalkers() {
    const debugWalkers = window.__hobunjiFurnitureDebug?.getNpcWalkers?.(); // Existing game-owned escape hatch used by other late-bound NPC systems.
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

  function poseQuaternion(pose) {
    const three = T();
    if (!three) return null;
    const yaw = (Number(pose?.bodyYaw) || 0) + (Number(pose?.yaw) || 0); // Civilian portrait facing stays scheduler-owned; fold stance bodyYaw into the held socket.
    return new three.Quaternion().setFromEuler(new three.Euler(rad(pose?.pitch), rad(yaw), rad(pose?.roll), 'YXZ'));
  }

  function setHolderPose(walker, holder, pose) {
    const three = T();
    const rig = rigFor(walker);
    const sourceParent = rig?.parent || walker?.root;
    const holderParent = holder?.parent || walker?.root;
    if (!three || !sourceParent || !holderParent || !pose) return false;
    const anchor = anchorFor(walker);
    const p = new three.Vector3(anchor.x + (Number(pose.x) || 0), anchor.y + (Number(pose.y) || 0), Number(pose.z) || 0);
    const q = poseQuaternion(pose);
    if (!q) return false;
    sourceParent.updateWorldMatrix?.(true, false);
    holderParent.updateWorldMatrix?.(true, false);
    if (sourceParent === holderParent) {
      holder.position.copy(p);
      holder.quaternion.copy(q);
    } else {
      const worldP = sourceParent.localToWorld(p.clone());
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
    for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll']) {
      out[key] = phase(progress, CHOP_WINDUP[key], CHOP_STRIKE[key], Number(neutral[key]) || 0);
    }
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
    const three = T();
    const r = frame?.rotationDeg || {};
    return three ? new three.Quaternion().setFromEuler(new three.Euler(rad(r.pitch), rad(r.yaw), rad(r.roll), 'YXZ')) : null;
  }

  function applyPrimaryCorrection(visual, key) {
    if (!visual || visual.userData?.npcGripKey === key) return;
    const three = T();
    const grip = primaryGrip(key);
    const scale = gripScale(key);
    const invQ = gripQuaternion(grip)?.invert();
    if (!three || !invQ) return;
    const p = grip.position || {};
    visual.position.copy(new three.Vector3(-(Number(p.x) || 0) * scale, -(Number(p.y) || 0) * scale, -(Number(p.z) || 0) * scale).applyQuaternion(invQ));
    visual.quaternion.copy(invQ);
    visual.scale.setScalar(scale);
    visual.userData = { ...(visual.userData || {}), npcGripKey: key };
  }

  function stationVisual(holder, key) {
    if (holder?.userData?.npcGripVisualV3) return holder.userData.npcGripVisualV3;
    const three = T();
    if (!holder || !three) return null;
    const visual = new three.Group();
    visual.name = `npc_${key}_grip_visual_v3`;
    for (const child of [...holder.children]) visual.add(child);
    holder.add(visual);
    holder.userData = { ...(holder.userData || {}), npcGripVisualV3: visual };
    applyPrimaryCorrection(visual, key);
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

  function secondaryFrame(holder, key) {
    const three = T();
    const span = grips()?.secondaryGripSpanForTool?.(key);
    if (!three || !span) return null;
    const itemZ = (Number(span.startZ) + Number(span.endZ)) / 2;
    if (!Number.isFinite(itemZ)) return null;
    const primary = primaryGrip(key), invQ = gripQuaternion(primary)?.invert(), socket = worldFrame(holder);
    if (!invQ || !socket) return null;
    const scale = gripScale(key), p = primary.position || {};
    const relative = new three.Vector3(-(Number(p.x) || 0) * scale, -(Number(p.y) || 0) * scale, (itemZ - (Number(p.z) || 0)) * scale).applyQuaternion(invQ);
    return { position: socket.position.clone().add(relative.applyQuaternion(socket.quaternion)), quaternion: socket.quaternion.clone().multiply(invQ) };
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

  function attachHands(walker, holder, key, owner) {
    const rig = rigFor(walker), hand = handFrame(walker), socket = worldFrame(holder);
    if (!rig?.placeHandWorld || !hand || !socket) return false;
    const secondary = secondaryFrame(holder, key);
    const claims = ensureClaims(rig);
    if (claims) {
      claims.right = owner;
      claims.left = secondary ? owner : null;
    }
    const rightP = socket.position.clone().add(hand.position.clone().applyQuaternion(socket.quaternion));
    const rightQ = socket.quaternion.clone().multiply(hand.quaternion);
    rig.setSideVisible?.('right', true);
    rig.placeHandWorld('right', rightP, rightQ);
    if (secondary) {
      const leftP = secondary.position.clone().add(hand.position.clone().applyQuaternion(secondary.quaternion));
      const leftQ = secondary.quaternion.clone().multiply(hand.quaternion);
      rig.setSideVisible?.('left', true);
      rig.placeHandWorld('left', leftP, leftQ);
    }
    return true;
  }

  function disposeObject(root) {
    root?.traverse?.(node => {
      node.geometry?.dispose?.();
      const mats = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
      for (const mat of mats) { mat.map?.dispose?.(); mat.dispose?.(); }
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
        canvas = await window.ToolMetalRecolor?.getRecoloredCanvas?.(loadout.sprite, { targetHex: BRONZE.hex, verdigrisHex: BRONZE.verdigrisHex, oxidationAmount: loadout.verdigris });
      } catch (error) {
        window.__farmLog?.(`[npc-held-v3] ${state.walker?.rec?.id}: verdigris render failed: ${error?.message || error}`, 'warn');
      }
      if (state.disposed || generation !== state.buildGeneration) return null;
      let texture = null, w = 1, h = 1;
      if (canvas) {
        texture = new three.CanvasTexture(canvas); w = canvas.width || 1; h = canvas.height || 1;
      } else {
        texture = await new Promise(resolve => new three.TextureLoader().load(loadout.sprite, resolve, undefined, () => resolve(null)));
        if (!texture || state.disposed || generation !== state.buildGeneration) return null;
        w = texture.image?.naturalWidth || texture.image?.width || 1;
        h = texture.image?.naturalHeight || texture.image?.height || 1;
      }
      texture.magFilter = three.NearestFilter;
      texture.minFilter = three.NearestFilter;
      if ('colorSpace' in texture && three.SRGBColorSpace) texture.colorSpace = three.SRGBColorSpace;
      else if ('encoding' in texture && three.sRGBEncoding) texture.encoding = three.sRGBEncoding;
      texture.needsUpdate = true;
      const plane = new three.Mesh(
        new three.PlaneGeometry(TOOL_W, TOOL_W * h / Math.max(1, w)),
        new three.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .05, side: three.DoubleSide, toneMapped: false }),
      );
      plane.name = `${state.walker.rec.id}_${loadout.toolKey}_plane`;
      plane.rotation.x = -Math.PI / 2;
      plane.renderOrder = RENDER_ORDER;
      plane.frustumCulled = false;
      plane.layers?.enable?.(1);
      const visual = new three.Group();
      visual.name = `${state.walker.rec.id}_${loadout.toolKey}_visual`;
      visual.userData = { toolPlane: plane };
      visual.add(plane);
      applyPrimaryCorrection(visual, loadout.toolKey);
      const holder = new three.Group();
      holder.name = `${state.walker.rec.id}_${loadout.toolKey}_holder`;
      holder.userData = { toolPlane: plane, npcWatchmanWeapon: true, toolKey: loadout.toolKey };
      holder.add(visual);
      parent.add(holder);
      state.holder = holder;
      state.buildPromise = null;
      window.__farmLog?.(`[npc-held-v3] ${state.walker.rec.name || state.walker.rec.id}: ARMED ${loadout.toolKey}, ${loadout.stance}, mastery ${loadout.mastery}/5, verdigris ${Math.round(loadout.verdigris * 100)}%`, 'combat');
      updateState(state);
      return holder;
    })().catch(error => {
      state.buildPromise = null;
      window.__farmLog?.(`[npc-held-v3] ${state.walker?.rec?.id}: weapon build failed: ${error?.message || error}`, 'warn');
      return null;
    });
    return state.buildPromise;
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
      if (pose) setHolderPose(walker, state.holder, pose);
      state.holder.visible = walker?.root?.visible !== false;
      state.handsAttached = attachHands(walker, state.holder, loadout.toolKey, `watchman:${loadout.toolKey}`);
      state.mode = 'watchman'; state.key = loadout.toolKey; state.loadout = loadout;
      return;
    }

    state.loadout = null;
    const target = walker?.currentScheduleTarget || null;
    const key = normalizeToolKey(target?.toolKey || walker?.stationToolKey);
    if (!key || key === 'kurraya' || !walker?.stationToolMesh) {
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
      setHolderPose(walker, walker.stationToolMesh, hoePose(progress));
      state.mode = 'station-hoe';
      if (!loggedHoe.has(walker) && attachHands(walker, walker.stationToolMesh, key, 'station:hoe')) {
        loggedHoe.add(walker);
        window.__farmLog?.(`[npc-held-v3] ${walker.rec?.name || walker.rec?.id}: HOE HAND CLAIMED and following player-style socket`, 'combat');
        state.handsAttached = true;
      } else {
        state.handsAttached = attachHands(walker, walker.stationToolMesh, key, 'station:hoe');
      }
    } else {
      state.mode = 'station-tool';
      state.handsAttached = attachHands(walker, walker.stationToolMesh, key, `station:${key}`);
    }
    state.key = key;
  }

  function wrapWalker(walker) {
    if (!walker || typeof walker.update !== 'function') return null;
    const prior = stateByWalker.get(walker);
    if (prior) return prior;
    const original = walker.update;
    const state = { walker, original, wrapped: null, holder: null, buildPromise: null, buildGeneration: 0, mode: null, key: null, loadout: null, handsAttached: false, lastUpdateAt: null, disposed: false };
    state.wrapped = function npcHeldV3WalkerUpdate(...args) {
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
    if (state.walker?.update === state.wrapped) state.walker.update = state.original;
    if (state.holder) { state.holder.parent?.remove?.(state.holder); disposeObject(state.holder); state.holder = null; }
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

  window.NpcHeldEquipment = {
    version: VERSION,
    liveWalkers,
    debugSnapshot: snapshot,
    rescan() { scan(); return snapshot(); },
  };

  scan();
  scanTimer = window.setInterval(scan, SCAN_MS);
  window.__farmLog?.('[npc-held-v3] installed: direct live-walker discovery; no NpcScheduling namespace hook', 'combat');
})();
