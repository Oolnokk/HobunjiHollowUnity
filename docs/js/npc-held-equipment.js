// Shared held-tool presentation for scheduled non-combat NPCs.
(() => {
  'use strict';

  const VERSION = 2; // Debug/version gate used by the runtime module loader.
  const HOE_SWING_S = 0.42; // Player chop/hoe visual duration reused by farmer stations.
  const TOOL_W = 0.5; // Runtime/Attack Editor held-tool world width.
  const RENDER_ORDER = 1.5; // Same held-object render order as player tools.
  const WF = 0.16; // Player tool-action windup fraction.
  const SF = 0.28; // Player tool-action strike fraction.
  const HF = SF + (1 - SF) * 0.3; // Player default strike-hold endpoint.
  const CHOP_NEUTRAL = Object.freeze({ x: .03, y: .37, z: -.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 }); // Player chop source neutral.
  const CHOP_WINDUP = Object.freeze({ x: -.18, y: .41, z: -.15, pitch: -165, yaw: 13, bodyYaw: -29, roll: -112 }); // Player chop windup endpoint.
  const CHOP_STRIKE = Object.freeze({ x: 0, y: 0, z: .12, pitch: 13, yaw: -28, bodyYaw: 29, roll: -91 }); // Player chop strike endpoint.
  const BRONZE = Object.freeze({ hex: '#CD7F32', verdigrisHex: '#57B38B' }); // Existing bronze/verdigris palette used for watchman weapon flavor.
  const WATCHMEN = Object.freeze({
    oddclaw_unumanuk: Object.freeze({ name: 'Oddclaw', toolKey: 'hatchet', sprite: 'assets/toolsprites/axe_hatchet.png', stance: 'heavy', mastery: 3, xp: 150, verdigris: .5 }), // Mastery 3 = 150/300 = 50% live verdigris coverage.
    spearhead_unumanuk: Object.freeze({ name: 'Spearhead', toolKey: 'fishingspear', sprite: 'assets/toolsprites/harpoon_fishingspear.png', stance: 'light', mastery: 5, xp: 300, verdigris: 1 }), // Mastery 5 = 300/300 = full verdigris coverage.
  });

  let deps = null; // NpcScheduling.init dependency bag; supplies the live npcWalkers array.
  let scanTimer = null; // Low-frequency walker discovery/cleanup timer.
  const states = new Set(); // Iterable managed-state set for despawn cleanup/debugging.
  const stateByWalker = new WeakMap(); // Prevents double wrapping the same walker.
  const loggedHoe = new WeakSet(); // One-time farmer integration debug logging.
  const claimedRigs = new WeakMap(); // Per-rig fallback ownership wrappers that stop the global hand driver from overwriting held hands.

  const grips = () => window.HobunjiHandToolGrips || null; // Shared primary/secondary grip metadata source.
  const profiles = () => window.HobunjiHandModelProfiles || null; // Shared species/gender hand transform source.
  const T = () => window.THREE || null; // Runtime Three.js namespace used by all transform helpers.
  const rad = value => (Number(value) || 0) * Math.PI / 180; // Degrees-to-radians helper for authored pose channels.
  const toolKey = value => grips()?.toolKeyFor?.(value) || String(value || '').trim().toLowerCase(); // Normalizes station/item ids to shared grip keys.
  const rigFor = walker => walker?.avatarGroup?.userData?.proceduralHandRig || null; // Existing rig created by ProceduralHandFrameDriver.

  function watchmanLoadoutFor(walker) {
    const id = String(walker?.rec?.id || '').trim().toLowerCase(); // Primary canonical NPC id lookup.
    if (WATCHMEN[id]) return { ...WATCHMEN[id], matchedBy: 'id' };
    const name = String(walker?.rec?.name || '').trim().toLowerCase(); // Name fallback keeps authored DB aliases from silently making watchmen unarmed.
    for (const loadout of Object.values(WATCHMEN)) {
      if (name === loadout.name.toLowerCase() || name.startsWith(`${loadout.name.toLowerCase()} `)) return { ...loadout, matchedBy: 'name' };
    }
    return null;
  }

  function anchorFor(walker) {
    const avatar = walker?.avatarGroup; // Holds the same scanned per-species hand anchor used by the player.
    const height = Number(avatar?.userData?.portraitModelHeight) || Number(walker?.avatarHeight) || .9; // Fallback model height.
    const width = Number(avatar?.userData?.portraitModelWidth) || height; // Fallback model width.
    return {
      x: Number.isFinite(Number(avatar?.userData?.handAttachX)) ? Number(avatar.userData.handAttachX) : -width / 2,
      y: Number.isFinite(Number(avatar?.userData?.handAttachY)) ? Number(avatar.userData.handAttachY) : height / 2,
    };
  }

  function poseQ(pose) {
    const three = T(); // Three math source for authored holder rotations.
    if (!three) return null;
    const yaw = (Number(pose?.bodyYaw) || 0) + (Number(pose?.yaw) || 0); // Folds body yaw into the held item while walker facing remains authoritative.
    return new three.Quaternion().setFromEuler(new three.Euler(rad(pose?.pitch), rad(yaw), rad(pose?.roll), 'YXZ'));
  }

  function phase(progress, windup, strike, neutral) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0)); // Clamped player-style action progress.
    if (p <= WF) return neutral + (windup - neutral) * (p / WF);
    if (p <= SF) return windup + (strike - windup) * ((p - WF) / (SF - WF));
    if (p <= HF) return strike;
    return strike + (neutral - strike) * ((p - HF) / (1 - HF));
  }

  function hoePose(progress) {
    const neutral = window.WeaponToolStances?.poses?.hoeTool || CHOP_NEUTRAL; // Same live hoe Neutral object used by the player stance runtime.
    const pose = {}; // Sampled player chop channels returned to the civilian holder.
    for (const channel of ['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll']) pose[channel] = phase(progress, CHOP_WINDUP[channel], CHOP_STRIKE[channel], Number(neutral[channel]) || 0);
    return pose;
  }

  function watchmanPose(loadout) {
    const poses = window.WeaponToolStances?.poses; // Same live Light/Heavy objects used by player and EnemyWeaponStances.
    if (!poses) return null;
    return loadout.stance === 'heavy' ? poses.heavyWeapon : poses.lightWeapon;
  }

  function scaleFor(key) {
    const scale = Number(grips()?.toolScaleForTool?.(key)); // Shared per-shape tool scale, notably the fishing spear's 1.15 factor.
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function primaryFor(key) {
    return grips()?.authoredPrimaryGripForTool?.(key) || { position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 } }; // Shared authored item-space right-hand point.
  }

  function frameQ(frame) {
    const three = T(); // Converts authored hand-tool Euler frames to quaternions.
    const r = frame?.rotationDeg || {}; // Authored tool-local rotation channels.
    return three ? new three.Quaternion().setFromEuler(new three.Euler(rad(r.pitch), rad(r.yaw), rad(r.roll), 'YXZ')) : null;
  }

  function correctVisual(visual, key) {
    if (!visual || visual.userData?.npcGripKey === key) return;
    const three = T(); // Applies the same primary-grip inverse transform used by hand-tool-grips.js.
    if (!three) return;
    const grip = primaryFor(key); // Authored item-space right-hand point.
    const scale = scaleFor(key); // Intrinsic item scale around the hand pivot.
    const inverseQ = frameQ(grip)?.invert(); // Moves the item frame onto the fixed primary socket.
    if (!inverseQ) return;
    const p = grip.position || {}; // Item-space primary-grip translation.
    const correction = new three.Vector3(-(Number(p.x) || 0) * scale, -(Number(p.y) || 0) * scale, -(Number(p.z) || 0) * scale).applyQuaternion(inverseQ);
    visual.position.copy(correction);
    visual.quaternion.copy(inverseQ);
    visual.scale.setScalar(scale);
    visual.userData = { ...(visual.userData || {}), npcGripKey: key };
  }

  function stationVisual(holder, key) {
    if (holder?.userData?.npcGripVisual) return holder.userData.npcGripVisual;
    const three = T(); // Adds a correction wrapper without changing game.js's station-tool ownership/lifecycle.
    if (!holder || !three) return null;
    const visual = new three.Group(); // Child wrapper receives primary-grip correction; outer group stays the animation socket.
    visual.name = `npc_${key}_grip_visual`;
    const children = [...holder.children]; // Existing tool plane children moved under the wrapper once.
    for (const child of children) visual.add(child);
    holder.add(visual);
    holder.userData = { ...(holder.userData || {}), npcGripVisual: visual };
    correctVisual(visual, key);
    return visual;
  }

  function setHolderPose(walker, holder, pose) {
    const rig = rigFor(walker); // Its parent is the calibrated hand-coordinate space.
    const anchorParent = rig?.parent || walker?.root; // Source parent for player-equivalent hand-relative placement.
    const holderParent = holder?.parent || walker?.root; // Watchmen use the scene root, matching BanditCombat/player holders.
    const three = T(); // Converts between parents without reparenting game-owned station meshes.
    if (!anchorParent || !holderParent || !three || !pose) return false;
    const anchor = anchorFor(walker); // Right-hand base before authored pose offsets.
    const localPos = new three.Vector3(anchor.x + (Number(pose.x) || 0), anchor.y + (Number(pose.y) || 0), Number(pose.z) || 0);
    const localQ = poseQ(pose); // Authored local stance/swing orientation.
    anchorParent.updateWorldMatrix?.(true, false);
    holderParent.updateWorldMatrix?.(true, false);
    if (anchorParent === holderParent) {
      holder.position.copy(localPos);
      holder.quaternion.copy(localQ);
    } else {
      const worldPos = anchorParent.localToWorld(localPos.clone()); // Equivalent socket position in world space.
      const worldQ = anchorParent.getWorldQuaternion(new three.Quaternion()).multiply(localQ); // Equivalent socket rotation in world space.
      const parentQ = holderParent.getWorldQuaternion(new three.Quaternion()); // Holder parent rotation removed below.
      holder.position.copy(holderParent.worldToLocal(worldPos));
      holder.quaternion.copy(parentQ.invert().multiply(worldQ));
    }
    holder.updateWorldMatrix?.(true, true);
    return true;
  }

  function handFrame(walker) {
    const rig = rigFor(walker); // Supplies normalized species/gender identity.
    const profileApi = profiles(); // Same handFromTool calibration source as ProceduralHandFrameDriver.
    const three = T(); // Builds the final hand offset/quaternion.
    if (!rig || !profileApi || !three) return null;
    const species = rig.speciesId; // Normalized species id from ProceduralHandAttachments.
    const gender = rig.gender; // Normalized gender from ProceduralHandAttachments.
    const raw = window.HobunjiHandGripModes?.effectiveFrameForSpecies?.(species) || profileApi.handTransformForSpecies?.(species) || profileApi.modelForSpecies?.(species)?.handFromTool || {}; // Shared per-species hand-from-tool frame.
    const p = raw.position || {}; // Normalized hand offset from tool socket.
    const r = raw.rotationDeg || {}; // Authored hand Euler orientation.
    const q = raw.rotationQuaternion || null; // Optional authored quaternion orientation.
    const modelH = Number(walker?.avatarGroup?.userData?.portraitModelHeight) || Number(walker?.avatarHeight) || .9; // Avatar scale basis.
    const speciesScale = Number(profileApi.effectiveScaleFor?.(species, gender)) || 1; // Species/gender hand scale.
    const unit = modelH * (Number(profileApi.data?.handHeightFraction) || .12) * speciesScale; // Converts normalized hand offsets to world units.
    const rotation = q && [q.x, q.y, q.z, q.w].every(v => Number.isFinite(Number(v)))
      ? new three.Quaternion(Number(q.x), Number(q.y), Number(q.z), Number(q.w)).normalize()
      : new three.Quaternion().setFromEuler(new three.Euler(rad(r.pitch), rad(r.yaw), rad(r.roll), 'YXZ'));
    return { position: new three.Vector3((Number(p.x) || 0) * unit, (Number(p.y) || 0) * unit, (Number(p.z) || 0) * unit), quaternion: rotation };
  }

  function worldFrame(holder) {
    const three = T(); // Reads the socket after its NPC stance/swing has been applied.
    if (!holder || !three) return null;
    holder.updateWorldMatrix?.(true, true);
    return { position: holder.getWorldPosition(new three.Vector3()), quaternion: holder.getWorldQuaternion(new three.Quaternion()) };
  }

  function secondaryFrame(holder, key) {
    const span = grips()?.secondaryGripSpanForTool?.(key); // Shared authored off-hand shaft span; null deliberately means one-handed.
    const three = T(); // Converts the shaft midpoint through the primary inverse transform.
    if (!span || !three) return null;
    const itemZ = (Number(span.startZ) + Number(span.endZ)) / 2; // Stable midpoint while civilian NPCs walk/work.
    if (!Number.isFinite(itemZ)) return null;
    const primary = primaryFor(key); // Primary item-space frame.
    const inverseQ = frameQ(primary)?.invert(); // Item -> primary socket rotation.
    const socket = worldFrame(holder); // Animated primary socket in world space.
    if (!inverseQ || !socket) return null;
    const scale = scaleFor(key); // Shared intrinsic tool scale.
    const p = primary.position || {}; // Primary item-space translation.
    const relative = new three.Vector3(-(Number(p.x) || 0) * scale, -(Number(p.y) || 0) * scale, (itemZ - (Number(p.z) || 0)) * scale).applyQuaternion(inverseQ);
    return { position: socket.position.clone().add(relative.applyQuaternion(socket.quaternion)), quaternion: socket.quaternion.clone().multiply(inverseQ) };
  }

  function ensureRigClaims(rig) {
    if (!rig) return null;
    const existing = claimedRigs.get(rig); // Existing wrapper is reused for every station/loadout change on this NPC.
    if (existing) return existing;
    const originalSetSideIdle = typeof rig.setSideIdle === 'function' ? rig.setSideIdle.bind(rig) : null; // Free-hand fallback used selectively below.
    const originalUseIdlePose = typeof rig.useIdlePose === 'function' ? rig.useIdlePose.bind(rig) : null; // Whole-rig fallback retained when nothing is claimed.
    const claims = { left: null, right: null, originalSetSideIdle, originalUseIdlePose }; // Current external owner per hand plus original fallback methods.
    if (originalSetSideIdle) {
      rig.setSideIdle = function npcHeldClaimAwareSetSideIdle(side, pose) {
        if (claims[side]) return false;
        originalSetSideIdle(side, pose);
        return true;
      };
    }
    if (originalUseIdlePose) {
      rig.useIdlePose = function npcHeldClaimAwareUseIdlePose(poses) {
        if (!claims.left && !claims.right) return originalUseIdlePose(poses);
        if (!claims.left) originalSetSideIdle?.('left', poses?.left || null);
        if (!claims.right) originalSetSideIdle?.('right', poses?.right || null);
        return true;
      };
    }
    claimedRigs.set(rig, claims);
    return claims;
  }

  function setHandClaims(walker, owner, hasSecondary) {
    const rig = rigFor(walker); // Existing NPC procedural hand rig whose fallback ownership is being changed.
    const claims = ensureRigClaims(rig); // Claim-aware wrapper installed lazily once the async hand rig exists.
    if (!claims) return null;
    claims.right = owner || null;
    claims.left = owner && hasSecondary ? owner : null;
    return claims;
  }

  function releaseHandClaims(walker) {
    const rig = rigFor(walker); // Existing NPC rig that should return to ordinary idle/walk fallback.
    const claims = claimedRigs.get(rig); // Only rigs previously claimed by this bridge need releasing.
    if (!claims) return;
    claims.left = null;
    claims.right = null;
  }

  function attachHands(walker, holder, key, owner) {
    const rig = rigFor(walker); // Existing procedural hand rig attached by ProceduralHandFrameDriver.
    const hand = handFrame(walker); // Same species/gender handFromTool transform as the player.
    const socket = worldFrame(holder); // Primary animated tool socket.
    if (!rig?.placeHandWorld || !hand || !socket) return false;
    const secondary = secondaryFrame(holder, key); // Shared authored off-hand span when the tool supports one.
    setHandClaims(walker, owner, !!secondary); // Claims happen before placement so the frame driver's later fallback pass cannot undo them.
    const rightPos = socket.position.clone().add(hand.position.clone().applyQuaternion(socket.quaternion)); // Final right-hand world position.
    const rightQ = socket.quaternion.clone().multiply(hand.quaternion); // Final right-hand world orientation.
    rig.setSideVisible?.('right', true);
    rig.placeHandWorld('right', rightPos, rightQ);
    if (secondary) {
      const leftPos = secondary.position.clone().add(hand.position.clone().applyQuaternion(secondary.quaternion)); // Final left-hand world position.
      const leftQ = secondary.quaternion.clone().multiply(hand.quaternion); // Final left-hand world orientation.
      rig.setSideVisible?.('left', true);
      rig.placeHandWorld('left', leftPos, leftQ);
    }
    return true;
  }

  function disposeObject(root) {
    root?.traverse?.(node => {
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []); // Watchman-only GPU materials owned by this bridge.
      for (const material of materials) { material?.map?.dispose?.(); material?.dispose?.(); }
    });
  }

  function desiredWatchmanParent(walker) {
    return walker?.root?.parent || null; // Bandit/player-equivalent scene-root holder parent; deliberately not the rotating NPC avatar root.
  }

  async function buildWatchman(state, loadout) {
    if (state.holder || state.buildPromise) return state.holder || state.buildPromise;
    const three = T(); // Builds the watchman-only held weapon; farmer meshes remain game-owned.
    const sceneParent = desiredWatchmanParent(state.walker); // Scene root that receives the holder exactly like BanditCombat.makeBanditToolHolder.
    if (!three || !sceneParent) return null;
    const generation = ++state.buildGeneration; // Invalidates async texture work if this walker despawns.
    state.buildPromise = (async () => {
      let canvas = null; // Mastery/verdigris-rendered sprite from the existing metal-tool recolorer.
      try {
        canvas = await window.ToolMetalRecolor?.getRecoloredCanvas?.(loadout.sprite, { targetHex: BRONZE.hex, verdigrisHex: BRONZE.verdigrisHex, oxidationAmount: loadout.verdigris });
      } catch (error) {
        window.__farmLog?.(`[npc-held-tools] ${state.walker?.rec?.id} verdigris render failed: ${error?.message || error}`, 'warn');
      }
      if (state.disposed || generation !== state.buildGeneration) return null;
      let texture = null; // Recolored CanvasTexture, or clean sprite fallback if recoloring is unavailable.
      let w = 1; // Sprite width used for aspect ratio.
      let h = 1; // Sprite height used for aspect ratio.
      if (canvas) {
        texture = new three.CanvasTexture(canvas); w = canvas.width || 1; h = canvas.height || 1;
      } else {
        texture = await new Promise(resolve => new three.TextureLoader().load(loadout.sprite, resolve, undefined, () => resolve(null)));
        if (!texture || state.disposed || generation !== state.buildGeneration) return null;
        w = texture.image?.naturalWidth || texture.image?.width || 1; h = texture.image?.naturalHeight || texture.image?.height || 1;
      }
      texture.magFilter = three.NearestFilter; // Matches runtime/tool-editor pixel filtering.
      texture.minFilter = three.NearestFilter; // Matches runtime/tool-editor pixel filtering.
      if ('colorSpace' in texture && three.SRGBColorSpace) texture.colorSpace = three.SRGBColorSpace;
      else if ('encoding' in texture && three.sRGBEncoding) texture.encoding = three.sRGBEncoding;
      texture.needsUpdate = true;
      const plane = new three.Mesh(new three.PlaneGeometry(TOOL_W, TOOL_W * h / Math.max(1, w)), new three.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .05, side: three.DoubleSide, toneMapped: false })); // Same aspect-preserving flat tool presentation as player/enemy meshes.
      plane.name = `${state.walker.rec.id}_${loadout.toolKey}_plane`;
      plane.rotation.x = -Math.PI / 2;
      plane.renderOrder = RENDER_ORDER;
      plane.frustumCulled = false;
      plane.layers?.enable?.(1);
      const visual = new three.Group(); // Primary-grip-corrected sprite child.
      visual.name = `${state.walker.rec.id}_${loadout.toolKey}_visual`;
      visual.userData = { toolPlane: plane };
      visual.add(plane);
      correctVisual(visual, loadout.toolKey);
      const holder = new three.Group(); // Persistent scene-root primary socket driven by shared weapon stance.
      holder.name = `${state.walker.rec.id}_${loadout.toolKey}_holder`;
      holder.userData = { toolPlane: plane, npcWatchmanWeapon: true, toolKey: loadout.toolKey };
      holder.add(visual);
      sceneParent.add(holder);
      state.holder = holder;
      state.buildPromise = null;
      state.holderBuiltAt = performance.now();
      window.__farmLog?.(`[npc-held-tools] ${state.walker.rec.name || state.walker.rec.id}: armed ${loadout.toolKey}, ${loadout.stance} stance, mastery ${loadout.mastery}/5, verdigris ${Math.round(loadout.verdigris * 100)}%, match=${loadout.matchedBy}`, 'combat');
      updateState(state); // Makes the weapon visible/posed immediately instead of waiting for another walker tick.
      return holder;
    })().catch(error => { state.buildPromise = null; window.__farmLog?.(`[npc-held-tools] ${state.walker?.rec?.id} weapon build failed: ${error?.message || error}`, 'warn'); return null; });
    return state.buildPromise;
  }

  function updateState(state) {
    const walker = state.walker; // Live scheduled walker updated by game.js immediately before this post-pass.
    const loadout = watchmanLoadoutFor(walker); // Oddclaw/Spearhead persistent watchman loadout, if applicable.
    state.lastUpdateAt = performance.now();
    if (loadout) {
      const sceneParent = desiredWatchmanParent(walker); // Current scene parent after any area transfer.
      if (!state.holder) { buildWatchman(state, loadout); releaseHandClaims(walker); return; }
      if (sceneParent && state.holder.parent !== sceneParent) sceneParent.add(state.holder); // Keeps scene-root ownership through map transfers.
      const pose = watchmanPose(loadout); // Exact shared Heavy/Light stance object.
      if (pose) setHolderPose(walker, state.holder, pose);
      state.holder.visible = walker.root?.visible !== false;
      const handsAttached = attachHands(walker, state.holder, loadout.toolKey, `watchman:${loadout.toolKey}`); // Same procedural hand rig, now protected from fallback overwrite.
      state.mode = 'watchman'; state.key = loadout.toolKey; state.loadout = loadout; state.handsAttached = handsAttached;
      return;
    }

    state.loadout = null;
    const target = walker.currentScheduleTarget || null; // Existing scheduler decides whether a civilian is currently using a station tool.
    const key = toolKey(target?.toolKey || walker.stationToolKey); // Shared authored grip key for that station tool.
    if (!key || key === 'kurraya' || !walker.stationToolMesh) { releaseHandClaims(walker); state.mode = null; state.key = null; state.handsAttached = false; return; }
    stationVisual(walker.stationToolMesh, key);
    if (key === 'hoe') {
      const interval = Math.max(.2, Number(target?.toolIntervalSec) || 2); // Existing station cadence remains authoritative.
      const actionTime = Math.max(0, Number(walker.stationToolT) || 0); // Existing station cycle time advanced by game.js.
      const duration = Math.min(interval, HOE_SWING_S); // Player-speed hoe swing, then neutral rest until the next station cycle.
      const progress = actionTime <= duration ? actionTime / Math.max(.0001, duration) : 1; // Player chop progress for this cycle.
      setHolderPose(walker, walker.stationToolMesh, hoePose(progress));
      state.mode = 'station-hoe';
      if (!loggedHoe.has(walker)) { loggedHoe.add(walker); window.__farmLog?.(`[npc-held-tools] ${walker.rec?.name || walker.rec?.id}: hoe primary hand claimed from fallback and attached to player-style tool socket`, 'combat'); }
    } else {
      state.mode = 'station-tool'; // Other station tools retain their authored motion but now receive shared grip/hand attachment.
    }
    state.handsAttached = attachHands(walker, walker.stationToolMesh, key, `station:${key}`);
    state.key = key;
  }

  function wrapWalker(walker) {
    if (!walker || typeof walker.update !== 'function') return null;
    const prior = stateByWalker.get(walker); // Existing state prevents duplicate update wrappers.
    if (prior) return prior;
    const original = walker.update; // Scheduling/movement/tool lifecycle remains the authoritative first pass.
    const state = { walker, original, wrapped: null, holder: null, buildPromise: null, buildGeneration: 0, holderBuiltAt: null, lastUpdateAt: null, mode: null, key: null, loadout: null, handsAttached: false, disposed: false }; // Per-walker presentation state.
    state.wrapped = function npcHeldEquipmentUpdate(...args) { const result = original.apply(this, args); updateState(state); return result; };
    walker.update = state.wrapped;
    stateByWalker.set(walker, state); states.add(state);
    const loadout = watchmanLoadoutFor(walker); // Starts weapon construction as soon as the watchman enters the live walker set.
    if (loadout) buildWatchman(state, loadout);
    return state;
  }

  function disposeState(state) {
    if (!state || state.disposed) return;
    state.disposed = true; state.buildGeneration++;
    releaseHandClaims(state.walker);
    if (state.walker?.update === state.wrapped) state.walker.update = state.original;
    if (state.holder) { state.holder.parent?.remove?.(state.holder); disposeObject(state.holder); state.holder = null; }
    states.delete(state);
  }

  function scan() {
    if (!deps?.npcWalkers) return;
    const live = new Set(deps.npcWalkers); // Current authoritative walker set used for wrapping and cleanup.
    for (const walker of live) wrapWalker(walker);
    for (const state of [...states]) if (!live.has(state.walker)) disposeState(state);
  }

  function snapshot(npcId = null) {
    const rows = []; // Mobile/headless-readable integration state returned through __farmDebugTools.
    for (const state of states) {
      const walker = state.walker; // Walker represented by this debug row.
      if (npcId && walker?.rec?.id !== npcId) continue;
      const loadout = watchmanLoadoutFor(walker); // Supplies watchman mastery/verdigris metadata when applicable.
      const rig = rigFor(walker); // Current hand rig used to expose claim ownership.
      const claims = rig ? claimedRigs.get(rig) : null; // Current fallback-blocking side ownership.
      rows.push({
        id: walker?.rec?.id || null,
        name: walker?.rec?.name || null,
        mode: state.mode,
        toolKey: loadout?.toolKey || state.key,
        stance: loadout?.stance || (state.key === 'hoe' ? 'hoeTool' : null),
        mastery: loadout?.mastery ?? null,
        masteryXp: loadout?.xp ?? null,
        verdigris: loadout?.verdigris ?? null,
        loadoutMatchedBy: loadout?.matchedBy || null,
        holderReady: loadout ? !!state.holder : !!walker?.stationToolMesh,
        holderParent: state.holder?.parent?.name || (state.holder?.parent ? 'scene-root' : null),
        holderVisible: state.holder?.visible ?? null,
        handsReady: !!rig,
        handsAttached: !!state.handsAttached,
        rightHandOwner: claims?.right || null,
        leftHandOwner: claims?.left || null,
        secondaryGrip: !!((loadout?.toolKey || state.key) && grips()?.secondaryGripSpanForTool?.(loadout?.toolKey || state.key)),
        walkerState: walker?.state || null,
        area: walker?.area || null,
        lastUpdateAgeMs: state.lastUpdateAt == null ? null : Math.max(0, Math.round(performance.now() - state.lastUpdateAt)),
      });
    }
    return npcId ? (rows[0] || null) : rows;
  }

  function installDebug() {
    const debug = window.__farmDebugTools; // Existing scheduling debug surface visible through the game's debug UI/log workflow.
    if (!debug || debug.npcHeldEquipmentSnapshot) return;
    debug.npcHeldEquipmentSnapshot = snapshot;
    debug.rescanNpcHeldEquipment = () => { scan(); return snapshot(); };
  }

  function hookScheduler(api) {
    if (!api?.init || api.__npcHeldEquipmentHooked) return false;
    const originalInit = api.init.bind(api); // Existing scheduler dependency injection preserved so this bridge owns presentation only.
    api.init = function npcHeldEquipmentInit(injected) {
      deps = injected || null;
      const result = originalInit(injected); // Scheduler remains authoritative and initializes first.
      installDebug(); scan();
      if (scanTimer == null) scanTimer = window.setInterval(scan, 250);
      window.__farmLog?.('[npc-held-tools] v2 initialized: scene-root watchman holders + claimed procedural-hand ownership', 'combat');
      return result;
    };
    Object.defineProperty(api, '__npcHeldEquipmentHooked', { value: true, configurable: true });
    return true;
  }

  function hookPresentOrFutureScheduler() {
    if (hookScheduler(window.NpcScheduling)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'NpcScheduling'); // Preserves any earlier descriptor while intercepting the later scheduler assignment.
    if (descriptor && descriptor.configurable === false) return;
    let value = descriptor && 'value' in descriptor ? descriptor.value : descriptor?.get?.call(window); // Stored scheduler value returned by the compatibility getter.
    Object.defineProperty(window, 'NpcScheduling', {
      configurable: true, enumerable: descriptor?.enumerable ?? true,
      get() { return descriptor?.get ? descriptor.get.call(window) : value; },
      set(next) { value = next; descriptor?.set?.call(window, next); hookScheduler(next); },
    });
  }

  window.NpcHeldEquipment = { version: VERSION, debugSnapshot: snapshot, rescan: () => { scan(); return snapshot(); } };
  hookPresentOrFutureScheduler();
})();