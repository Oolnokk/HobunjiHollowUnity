// Direct held-item-to-hand frame driver.
//
// No arm solver participates. The right hand follows the held item's authored
// primary grip frame directly. If the active item has an enabled secondary grip
// in hand-tool-grips.js, the left hand follows that frame; otherwise it receives
// the procedural locomotion fallback. Free hands breathe subtly at idle and swing
// while walking. Attachment ownership always wins per side, so fallback motion
// never modifies a gripped hand. Hands never translate or rotate the tool.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const profiles = global.HobunjiHandModelProfiles;
  const toolGrips = global.HobunjiHandToolGrips;
  const avatarApi = global.PNGPlaneAvatar;
  if (!hands?.attach || !profiles || !toolGrips || !avatarApi?.buildSinglePlaneAvatarModel) return;
  if (avatarApi.buildSinglePlaneAvatarModel.__hobunjiDirectHandDriverWrapped) return;

  const pending = new Set();
  const managed = new Set();
  const FALLBACK_REFERENCE_SPEED = 3.2; // Scene units/second that produce a full ordinary walking arm swing below.
  const FALLBACK_TELEPORT_SPEED = 24; // Scene units/second above which movement is treated as a snap, not a gait sample.
  let gameDeps = hands.gameDeps || null;
  let syncing = false;

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  }

  function identityFor(options = {}) {
    const source = options.appearance || options.profile?.appearance || options.profile?.fighter || {};
    return {
      speciesId: normalizeKey(options.speciesId || source.speciesId || source.species),
      gender: normalizeGender(options.gender || source.gender),
    };
  }

  function attachPending(record) {
    const avatarRoot = record.avatarRoot;
    if (!avatarRoot?.parent || avatarRoot.userData?.proceduralHandRig) return !!avatarRoot?.userData?.proceduralHandRig;
    const handParent = avatarRoot.userData?.proceduralHandParent || avatarRoot.parent; // Lets authoring previews attach hands to their floor-relative visual root instead of the lifted portrait group.
    const rig = hands.attach(record.THREE, handParent, {
      speciesId: record.speciesId,
      gender: record.gender,
      bodyColors: record.bodyColors,
      profile: record.profile,
      sourceCanvas: record.sourceCanvas,
      modelHeight: avatarRoot.userData?.portraitModelHeight,
      handAttachX: avatarRoot.userData?.handAttachX,
      handAttachY: avatarRoot.userData?.handAttachY,
      avatarRoot,
      name: record.name || avatarRoot.name || 'avatar',
    });
    if (!rig) return false;
    avatarRoot.userData.proceduralHandRig = rig;
    record.rig = rig;
    managed.add(record);
    return true;
  }

  const originalBuild = avatarApi.buildSinglePlaneAvatarModel;
  const wrappedBuild = function directHandAvatarBuild(THREE, sourceCanvas, options = {}) {
    const avatarRoot = originalBuild.call(this, THREE, sourceCanvas, options);
    const identity = identityFor(options);
    if (!avatarRoot || !identity.speciesId || !profiles.modelKeyForSpecies(identity.speciesId)) return avatarRoot;
    pending.add({
      THREE,
      avatarRoot,
      sourceCanvas,
      profile: options.profile || null,
      speciesId: identity.speciesId,
      gender: identity.gender,
      bodyColors: options.profile?.bodyColors || options.appearance?.bodyColors || options.bodyColors,
      name: options.name,
      rig: null,
      syncSentinel: null,
      lastToolKey: null,
      lastVisualGripBasis: null,
      secondaryActive: false,
      fallback: null,
    });
    return avatarRoot;
  };
  wrappedBuild.__hobunjiDirectHandDriverWrapped = true;
  avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;

  if (avatarApi.disposeAvatarModel && !avatarApi.disposeAvatarModel.__hobunjiDirectHandsWrapped) {
    const originalDispose = avatarApi.disposeAvatarModel.bind(avatarApi);
    avatarApi.disposeAvatarModel = function directHandAvatarDispose(avatarRoot) {
      for (const record of [...pending]) if (record.avatarRoot === avatarRoot) pending.delete(record);
      for (const record of [...managed]) {
        if (record.avatarRoot !== avatarRoot) continue;
        disposeSyncSentinel(record);
        record.rig?.dispose?.();
        managed.delete(record);
      }
      if (avatarRoot?.userData) avatarRoot.userData.proceduralHandRig = null;
      return originalDispose(avatarRoot);
    };
    avatarApi.disposeAvatarModel.__hobunjiDirectHandsWrapped = true;
  }

  function findEditorToolHolder(record) {
    const bodyRoot = record?.avatarRoot?.parent;
    if (!bodyRoot) return null;
    const searchRoots = [bodyRoot];
    if (bodyRoot.parent?.isObject3D) searchRoots.push(bodyRoot.parent); // Attack Editor keeps the CharacterRigScale-owned body one level below the unscaled weapon/body-yaw rig, matching gameplay ownership.
    for (const searchRoot of searchRoots) {
      for (const child of searchRoot.children || []) {
        if (child === record.avatarRoot || child === bodyRoot || child === record.rig?.group || child === record.syncSentinel) continue;
        const hasAnchorSphere = (child.children || []).some(candidate => candidate?.isMesh && candidate.geometry?.type === 'SphereGeometry');
        if (!hasAnchorSphere) continue;
        const holder = (child.children || []).find(candidate => !candidate?.isMesh && candidate?.isObject3D);
        if (holder) return holder;
      }
    }
    return null;
  }

  function inAttackEditor() {
    return /\/tools\/attack-animation-editor\//.test(location.pathname);
  }

  function inHandCalibrationMode() {
    return inAttackEditor() && global.HobunjiAttackEditorHandCalibrationMode?.active === true; // Dedicated editor tab bypasses every animation/tool/shoulder-derived hand transform.
  }

  function currentToolKey(record = null) {
    const ownedKey = record?.avatarRoot?.userData?.proceduralHandToolKey; // Hostile/NPC avatar roots can name their own held item without leaking through the player-singleton stance state.
    if (ownedKey) return toolGrips.toolKeyFor(ownedKey);
    if (inAttackEditor()) {
      return toolGrips.toolKeyFor(document.getElementById('toolSpriteSelect')?.value || '');
    }
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    return toolGrips.toolKeyFor(snapshot?.itemKey || snapshot?.shape || '');
  }

  function currentGripContext(record = null) {
    const ownedContext = record?.avatarRoot?.userData?.proceduralHandGripContext; // Hostile tool owners explicitly select melee/ranged instead of inheriting the player's active slot.
    if (ownedContext === 'ranged' || ownedContext === 'melee') return ownedContext;
    if (typeof toolGrips.currentGripContext === 'function') return toolGrips.currentGripContext();
    if (inAttackEditor()) return document.getElementById('handGripContextSelect')?.value === 'ranged' ? 'ranged' : 'melee';
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    return snapshot?.activeSlot === 'ranged' ? 'ranged' : 'melee';
  }

  function currentToolHolder(record) {
    if (inAttackEditor()) return findEditorToolHolder(record);
    const ownedHolder = record?.avatarRoot?.userData?.proceduralHandToolHolder; // Shared humanoid hostiles publish the exact animated holder their final-render hands must follow.
    if (ownedHolder?.parent) return ownedHolder;
    if (gameDeps?.playerMesh && record.rig?.parent === gameDeps.playerMesh) return gameDeps.toolHolder || null;
    return null;
  }

  // Bag items (potions, flasks, large carried objects) live on game.js's heldItemHolder, not
  // toolHolder, so the player's hands used to fall back to free-hand idle while holding them.
  function heldItemTarget(record) {
    if (inAttackEditor() || record?.avatarRoot?.userData?.proceduralHandToolHolder) return null;
    const npcTarget = global.NpcDrinkInteraction?.heldItemTarget?.(record.rig?.parent); // Meals and ambient bottles share the existing world-space held-item grip solve.
    if (npcTarget) return npcTarget;
    if (!gameDeps?.playerMesh || record.rig?.parent !== gameDeps.playerMesh) return null;
    const carried = window.Shattercasks?.heldHandTarget?.();
    if (carried?.holder?.parent) return carried;
    if (gameDeps.toolHolder?.visible) return null;
    const target = gameDeps.getHeldItemHandTarget?.();
    return target?.holder?.visible ? target : null;
  }

  function modelKeyForRecord(record) {
    if (inAttackEditor()) {
      const editorModelKey = global.HobunjiAttackEditorHandContext?.currentModelKey?.();
      if (editorModelKey && profiles.data?.models?.[editorModelKey]) return editorModelKey;
    }
    return profiles.modelKeyForSpecies?.(record.speciesId) || null;
  }

  function modelCalibrationForRecord(record) {
    if (!inAttackEditor() && hands.modelCalibrationForSpecies) {
      return hands.modelCalibrationForSpecies(record.speciesId, record.gender,
        Number(record.avatarRoot?.userData?.portraitModelHeight) || .9);
    }
    const modelKey = modelKeyForRecord(record); // Single authoritative editor/runtime model identity used for both rendered GLB and calibration.
    const raw = profiles.normalizeHandTransform?.(profiles.data?.models?.[modelKey]?.handFromTool)
      || profiles.data?.models?.[modelKey]?.handFromTool
      || {};
    const p = raw.position || {};
    const r = raw.rotationDeg || {};
    const q = raw.rotationQuaternion || null;
    const modelHeight = Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9;
    const modelScale = Number(profiles.data?.models?.[modelKey]?.scale) || 1;
    const speciesScale = Number(profiles.speciesScaleFor?.(record.speciesId, record.gender)) || 1;
    const unit = modelHeight * (Number(profiles.data?.handHeightFraction) || 0.12) * modelScale * speciesScale;
    return {
      modelKey,
      position: {
        x: (Number(p.x) || 0) * unit,
        y: (Number(p.y) || 0) * unit,
        z: (Number(p.z) || 0) * unit,
      },
      rotationDeg: {
        pitch: Number(r.pitch) || 0,
        yaw: Number(r.yaw) || 0,
        roll: Number(r.roll) || 0,
      },
      rotationQuaternion: q && [q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))
        ? { x: Number(q.x), y: Number(q.y), z: Number(q.z), w: Number(q.w) }
        : null,
    };
  }

  function gripModeTransformForRecord(record) {
    const mode = global.HobunjiHandGripModes?.currentMode?.() || {}; // Grip Mode belongs to the socket; GLB-specific handFromTool calibration now lives on the visual child owned by ProceduralHandAttachments.
    const p = mode.position || {};
    const r = mode.rotationDeg || {};
    const modelKey = modelKeyForRecord(record);
    const modelHeight = Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9;
    const modelScale = Number(profiles.data?.models?.[modelKey]?.scale) || 1;
    const speciesScale = Number(profiles.speciesScaleFor?.(record.speciesId, record.gender)) || 1;
    const unit = modelHeight * (Number(profiles.data?.handHeightFraction) || 0.12) * modelScale * speciesScale;
    return {
      position: {
        x: (Number(p.x) || 0) * unit,
        y: (Number(p.y) || 0) * unit,
        z: (Number(p.z) || 0) * unit,
      },
      rotationDeg: {
        pitch: Number(r.pitch) || 0,
        yaw: Number(r.yaw) || 0,
        roll: Number(r.roll) || 0,
      },
    };
  }

  function quaternionFromDeg(record, rotation = {}) {
    return new record.THREE.Quaternion().setFromEuler(new record.THREE.Euler(
      record.THREE.MathUtils.degToRad(Number(rotation.pitch) || 0),
      record.THREE.MathUtils.degToRad(Number(rotation.yaw) || 0),
      record.THREE.MathUtils.degToRad(Number(rotation.roll) || 0),
      'YXZ',
    ));
  }

  function quaternionFromAuthored(record, authored = {}) {
    const q = authored.rotationQuaternion;
    if (q && [q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))) {
      return new record.THREE.Quaternion(Number(q.x), Number(q.y), Number(q.z), Number(q.w)).normalize();
    }
    return quaternionFromDeg(record, authored.rotationDeg || {});
  }

  function hierarchyWorldQuaternion(record, node, target = new record.THREE.Quaternion()) {
    const chain = []; // Used below to compose node-local rotations without decomposing mirrored matrixWorld values.
    for (let cursor = node; cursor?.isObject3D; cursor = cursor.parent) chain.push(cursor);
    target.identity();
    for (let i = chain.length - 1; i >= 0; i -= 1) target.multiply(chain[i].quaternion);
    return target.normalize();
  }

  function findToolVisualPlane(toolHolder) {
    let plane = null;
    toolHolder?.traverse?.(node => {
      if (!plane && node?.userData?.toolPlane?.isObject3D) plane = node.userData.toolPlane;
    });
    return plane;
  }

  // The visible weapon plane has a sweep-only child rotation that fades from the
  // neutral sprite basis into the -90° attack basis. Hands used to follow only
  // toolHolder, so that child-only visual correction made the apparent grip rotate
  // between Neutral/Windup/Strike even with shoulder aiming disabled. Preserve the
  // existing Neutral calibration and apply only the plane's delta-from-Neutral to
  // the hand socket frame.
  function visualGripBasisDelta(record, toolHolder) {
    const Quaternion = toolHolder.quaternion.constructor;
    const identity = new Quaternion();
    const plane = findToolVisualPlane(toolHolder);
    if (!plane?.rotation) return { quaternion: identity, source: 'none', angleDeg: 0 };

    const currentEuler = plane.rotation.clone();
    const neutralEuler = plane.rotation.clone();
    let source = 'none';

    if (inAttackEditor()) {
      const style = String(document.getElementById('animStyle')?.value || '').toLowerCase();
      if (style !== 'sweep') return { quaternion: identity, source, angleDeg: 0 };
      // In the editor Neutral is z=0; applyPoseToRig writes the animated sweep
      // basis directly onto this child plane as z=-90°..0°.
      neutralEuler.z = 0;
      source = 'editor-sweep-plane';
    } else {
      const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
      const isSweep = snapshot?.activeSlot === 'weapon'
        && (snapshot?.combatAnim === 'sweep' || (!snapshot?.combatAnim && snapshot?.sourceAnimStyle === 'sweep'));
      if (!isSweep) return { quaternion: identity, source, angleDeg: 0 };

      // weapon-tool-stances temporarily adds this compensation during
      // updateMatrixWorld and then restores plane.rotation.z. Reconstruct the
      // rendered current basis here; Neutral is always the +90° compensation.
      const currentCompDeg = Number(snapshot?.sweepPlaneNeutralCompensationDeg);
      currentEuler.z += record.THREE.MathUtils.degToRad(Number.isFinite(currentCompDeg) ? currentCompDeg : 0);
      neutralEuler.z += Math.PI / 2;
      source = 'runtime-sweep-plane';
    }

    const currentQ = new Quaternion().setFromEuler(currentEuler);
    const neutralQ = new Quaternion().setFromEuler(neutralEuler);
    const delta = currentQ.multiply(neutralQ.invert()).normalize();
    const angleDeg = record.THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(delta.w))));
    return { quaternion: delta, source, angleDeg };
  }

  // In-game, WeaponToolStances applies the active idle/attack stance to
  // toolHolder only for the duration of its own updateMatrixWorld() call —
  // it bakes the stance into toolHolder.matrixWorld, then reverts toolHolder's
  // own LOCAL position/quaternion back to the plain aiming pose in a
  // `finally` (needed so a second updateMatrixWorld() call later the same
  // frame doesn't compound the stance delta onto itself). That means any of
  // Three.js's own world-space accessors (updateWorldMatrix/getWorldPosition/
  // localToWorld) called on toolHolder afterward recompute matrixWorld from
  // the already-reverted local values, silently discarding the stance: the
  // tool mesh itself still renders with the stance (its own matrixWorld was
  // baked earlier, during the same traversal, and nothing recomputes it
  // afterward), but hands following toolHolder through one of those
  // accessors would land on the neutral, un-stanced pose instead.
  // WeaponToolStances.lastHolderMatrixWorld() hands back the matrixWorld
  // actually baked this frame so hands read the same transform the tool
  // rendered with, without calling a recomputing accessor on toolHolder.
  function toolSocketWorld(record, toolHolder, gripFrame = null) {
    const Vector3 = toolHolder.position.constructor;
    const Quaternion = toolHolder.quaternion.constructor;
    const ownedHolder = record?.avatarRoot?.userData?.proceduralHandToolHolder; // Hostile/NPC records publish their own scene-root holder; only the player's holder is owned by WeaponToolStances' singleton baked-matrix cache.
    const playerOwnedHolder = !ownedHolder
      && !!gameDeps?.playerMesh
      && record.rig?.parent === gameDeps.playerMesh
      && toolHolder === gameDeps.toolHolder; // Prevents a hostile hand record from ever reading the player's last baked holder matrix.
    const bakedWorldMatrix = !inAttackEditor() && playerOwnedHolder
      ? global.WeaponToolStances?.lastHolderMatrixWorld?.()
      : null;

    const visualBasis = visualGripBasisDelta(record, toolHolder);
    let position;
    // Used as the scale-free world orientation of the tool socket. The special
    // baked WeaponToolStances matrix is PLAYER-ONLY: hostile/NPC holders are
    // independently positioned in the scene and must resolve from their own
    // hierarchy, or their hands literally inherit the player's world position.
    let quaternion;
    if (bakedWorldMatrix) {
      quaternion = new Quaternion();
      position = new Vector3();
      bakedWorldMatrix.decompose(position, quaternion, new Vector3());
    } else {
      toolHolder.updateWorldMatrix?.(true, true);
      quaternion = hierarchyWorldQuaternion(record, toolHolder, new Quaternion());
    }
    quaternion.multiply(visualBasis.quaternion);
    if (gripFrame) {
      const p = gripFrame.position || {};
      const localOffset = new Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0)
        .applyQuaternion(visualBasis.quaternion);
      if (bakedWorldMatrix) localOffset.applyMatrix4(bakedWorldMatrix);
      else toolHolder.localToWorld(localOffset);
      position = localOffset;
      quaternion.multiply(quaternionFromDeg(record, gripFrame.rotationDeg || {}));
    } else if (!bakedWorldMatrix) {
      position = toolHolder.getWorldPosition(new Vector3());
    }
    return { position, quaternion, visualBasis };
  }

  function handSocketAfterGripMode(record, socketFrame) {
    const Vector3 = socketFrame.position.constructor;
    const mode = gripModeTransformForRecord(record); // Only generic palm/shaft relationship is composed into the socket.
    const offset = new Vector3(mode.position.x, mode.position.y, mode.position.z)
      .applyQuaternion(socketFrame.quaternion);
    return {
      position: socketFrame.position.clone().add(offset),
      quaternion: socketFrame.quaternion.clone().multiply(quaternionFromDeg(record, mode.rotationDeg || {})),
      mode,
      visualBasis: socketFrame.visualBasis || null,
    };
  }

  function ensureFallbackState(record) {
    if (record.fallback) return record.fallback;
    const modelHeight = Math.max(0.1, Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9); // Scales fallback travel consistently across avatar sizes.
    record.fallback = {
      worldPosition: new record.THREE.Vector3(), // Previous parent-world sample used to infer locomotion without game-specific velocity hooks.
      samplePosition: new record.THREE.Vector3(), // Reused current parent-world sample to keep the per-frame fallback path allocation-free.
      hasWorldPosition: false,
      lastSampleMs: null,
      speed: 0,
      phase: 0,
      gaitStrength: 0,
      modelHeight,
      mode: 'idle',
      poses: { left: null, right: null },
      owners: { left: 'fallback-idle', right: 'fallback-idle' },
    };
    return record.fallback;
  }

  function damp(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt)));
  }

  const ARM_SWING_DEG = 38; // Peak forward/back arm swing about the shoulder.
  const ARM_LENGTH_FRACTION = 0.26; // Shoulder-to-wrist distance as a fraction of model height (the arc's radius).

  function fallbackPose(state, side, nowMs) {
    const sidePhase = state.phase + (side === 'right' ? Math.PI : 0); // Opposes left/right swings for a natural alternating gait.
    const swing = Math.sin(sidePhase);
    const liftWave = Math.max(0, Math.cos(sidePhase));
    const idlePhase = nowMs * 0.0017 + (side === 'right' ? 0.28 : 0); // Slight phase split keeps idle hands from moving as a rigid pair.
    const idleBreath = Math.sin(idlePhase);
    const h = state.modelHeight;
    const gait = state.gaitStrength;
    const swingAngle = ARM_SWING_DEG * Math.PI / 180 * swing; // Arm swing about the shoulder: the hand's position and its pitch share this angle, so the arm turns as one piece.
    return {
      position: {
        x: 0, // Shoulder-aim wrapper replaces the authored T-pose X with this side's resolved shoulder X.
        y: h * 0.0045 * idleBreath * (1 - gait) + ARM_LENGTH_FRACTION * h * (1 - Math.cos(swingAngle)) * gait, // The hand rides an arc about its shoulder: it rises as the arm swings away from hanging.
        z: ARM_LENGTH_FRACTION * h * Math.sin(swingAngle) * gait + h * 0.003 * Math.cos(idlePhase) * (1 - gait),
      },
      rotationDeg: {
        pitch: ARM_SWING_DEG * swing * gait + 2.5 * idleBreath * (1 - gait),
        yaw: (side === 'right' ? -1 : 1) * 3 * gait * Math.abs(swing),
        roll: (side === 'right' ? -1 : 1) * (5 * liftWave * gait + 1.5 * idleBreath * (1 - gait)),
      },
    };
  }

  // Gameplay states (e.g. the downed crawl) can take over one free hand by
  // registering `HobunjiFreeHandPose.providers`: each provider(parent, side,
  // modelHeight, record) returns a fallback-shaped { position:{x,y,z}, rotationDeg } or
  // null. A claimed hand ignores held-item secondary/dual-wield grips so the
  // pose is never fought over; the other hand is untouched.
  function freeHandOverride(record, side, modelHeight) {
    const providers = global.HobunjiFreeHandPose?.providers;
    if (!providers?.size) return null;
    const parent = record.rig?.parent;
    for (const provider of providers.values()) {
      const pose = provider(parent, side, modelHeight, record);
      if (pose) return pose;
    }
    return null;
  }

  function updateFallbackMotion(record, nowMs = performance.now()) {
    const state = ensureFallbackState(record);
    const sample = record.rig?.parent?.getWorldPosition?.(state.samplePosition) || null; // Includes NPC ancestor movement even when the hand parent itself stays local.
    const elapsed = state.lastSampleMs == null ? 0 : Math.max(0, Math.min(0.1, (nowMs - state.lastSampleMs) / 1000));
    if (sample && state.hasWorldPosition && elapsed > 0.0001) {
      const rawSpeed = Math.hypot(sample.x - state.worldPosition.x, sample.z - state.worldPosition.z) / elapsed;
      const sampledSpeed = rawSpeed <= FALLBACK_TELEPORT_SPEED ? rawSpeed : 0; // Area transfers and spawn snaps must not create one-frame flailing.
      state.speed = damp(state.speed, sampledSpeed, sampledSpeed > state.speed ? 11 : 15, elapsed);
    } else if (elapsed > 0.0001) {
      state.speed = damp(state.speed, 0, 15, elapsed);
    }
    if (sample) {
      state.worldPosition.copy(sample);
      state.hasWorldPosition = true;
    }
    state.lastSampleMs = nowMs;

    const speedRatio = Math.max(0, Math.min(1.25, state.speed / FALLBACK_REFERENCE_SPEED));
    const targetStrength = state.speed > 0.035 ? Math.sqrt(speedRatio) : 0;
    state.gaitStrength = damp(state.gaitStrength, targetStrength, targetStrength > state.gaitStrength ? 9 : 13, elapsed);
    const fullStride = Math.max(state.modelHeight * (0.32 + 0.44 * Math.sqrt(speedRatio)), 0.12); // The legs' stride (procedural-leg-animation.js), so each arm swings once per leg cycle.
    const cadenceHz = state.speed > 0.035 ? Math.max(0.55, Math.min(3.2, state.speed * 0.62 / fullStride)) : 0;
    if (cadenceHz > 0 && elapsed > 0) state.phase = (state.phase + elapsed * cadenceHz * Math.PI * 2) % (Math.PI * 2);
    state.mode = state.gaitStrength > 0.04 ? 'walk' : 'idle';
    state.poses.left = freeHandOverride(record, 'left', state.modelHeight) || fallbackPose(state, 'left', nowMs);
    state.poses.right = freeHandOverride(record, 'right', state.modelHeight) || fallbackPose(state, 'right', nowMs);
    state.overridden = { left: state.poses.left?.overridden === true, right: state.poses.right?.overridden === true };
    return state;
  }

  function applyFallbackSide(record, side) {
    const state = ensureFallbackState(record);
    record.rig?.setSideIdle?.(side, state.poses[side]);
    state.owners[side] = `fallback-${state.mode}`;
  }

  function applyFallbackBoth(record) {
    const state = ensureFallbackState(record);
    record.rig?.useIdlePose?.(state.poses);
    record.rig?.hidePaperHandGuideTarget?.(); // No raw weapon grip target exists while both hands are in fallback.
    state.owners.left = `fallback-${state.mode}`;
    state.owners.right = `fallback-${state.mode}`;
  }

  function syncCalibrationWorkspace(record, diagnostic = false) {
    if (!record?.rig?.placeCalibrationPreviewWorld) return null;
    const state = record._handCalibrationWorkspace ||= {
      worldPosition: new record.THREE.Vector3(), // Reused fixed preview origin so the calibration tab allocates nothing per frame.
      worldQuaternion: new record.THREE.Quaternion(), // Always identity: the paper reference is neutrally oriented in world space.
    };
    const modelHeight = Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9;
    record.rig.parent?.getWorldPosition?.(state.worldPosition);
    state.worldPosition.y += modelHeight * 0.52; // Stable chest-height workspace independent of tool/attack pose.
    state.worldQuaternion.identity();
    const modelCalibration = modelCalibrationForRecord(record);
    const placed = record.rig.placeCalibrationPreviewWorld(state.worldPosition, state.worldQuaternion, modelCalibration);
    if (!placed) return null;
    record.secondaryActive = false;
    record.lastToolKey = null;
    record.lastVisualGripBasis = null;
    ensureFallbackState(record).owners.right = 'glb-calibration';
    ensureFallbackState(record).owners.left = 'hidden-calibration';
    if (!diagnostic) return null;
    return {
      direct: true,
      calibrationWorkspace: true,
      neutralWorldQuaternion: true,
      bypassesAnimation: true,
      bypassesGripMode: true,
      bypassesShoulderAim: true,
      bypassesToolTarget: true,
      modelCalibration,
      paperHandReferenceFrame: 'fixed-neutral-world-frame',
    };
  }

  const HELD_LARGE_EDGE_MARGIN = 0.02; // Large items are gripped just outside their left/right edges.

  // Hands follow the held-item holder directly. Bottle: right hand on the neck (+Z of the
  // holder because the plane is laid flat end-for-end). Large: right/left hands on either side.
  // Runs for each hand every frame, so the vectors/quaternions it builds are reused (the sockets it hands
  // on are clones, so nothing retains them) and the fixed hand rotations are composed once per record.
  const HELD_ITEM_HAND_ROTATIONS = Object.freeze({
    bottle: { pitch: 90, yaw: -90, roll: 0 },
    right: { pitch: 0, yaw: -90, roll: 0 },
    left: { pitch: 0, yaw: 90, roll: 0 },
  });
  function heldItemScratch(record) {
    if (!record.heldItemScratch) {
      const THREE = record.THREE;
      record.heldItemScratch = {
        holderQuat: new THREE.Quaternion(),
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        rotations: Object.fromEntries(Object.entries(HELD_ITEM_HAND_ROTATIONS).map(([name, rotation]) => [name, quaternionFromDeg(record, rotation)])),
      };
    }
    return record.heldItemScratch;
  }

  function syncRigToHeldItem(record, target) {
    const holder = target.holder;
    holder.updateWorldMatrix(true, false);
    const scratch = heldItemScratch(record);
    const holderQuat = hierarchyWorldQuaternion(record, holder, scratch.holderQuat);
    const modelCalibration = modelCalibrationForRecord(record);
    const place = (side, x, y, z, rotationName) => {
      const position = holder.localToWorld(scratch.position.set(x, y, z));
      const quaternion = scratch.quaternion.copy(holderQuat).multiply(scratch.rotations[rotationName]);
      if (target.mode === 'authored-world') {
        // Local XYZ grip rotation comes AFTER the shared canonical left/right
        // hand orientation, matching the Furniture Editor's actual GLB preview.
        // This runs per hand per frame: reuse scratch instead of allocating
        // extra Euler/Quaternion objects during ordinary movement.
        const r = target.handTargets?.[side]?.rotation || {};
        scratch.authoredEuler ||= new record.THREE.Euler(0,0,0,'XYZ');
        scratch.authoredQuaternion ||= new record.THREE.Quaternion();
        scratch.authoredEuler.set(
          (Number(r.x)||0)*Math.PI/180,
          (Number(r.y)||0)*Math.PI/180,
          (Number(r.z)||0)*Math.PI/180, 'XYZ');
        quaternion.multiply(scratch.authoredQuaternion.setFromEuler(scratch.authoredEuler));
      }
      const socket = handSocketAfterGripMode(record, { position, quaternion, visualBasis: null });
      record.rig.placeHandWorld?.(side, socket.position, socket.quaternion, modelCalibration);
    };
    const owners = ensureFallbackState(record).owners;
    if (target.mode === 'authored-world') {
      for (const side of ['right', 'left']) {
        const p = target.handTargets?.[side] || {};
        place(side, Number(p.x)||0, Number(p.y)||0, Number(p.z)||0, side);
        owners[side]='authored-world-'+side;
      }
      record.secondaryActive=true;
    } else if (target.mode === 'large') {
      const edge = target.width / 2 + HELD_LARGE_EDGE_MARGIN;
      place('right', edge, 0, 0, 'right');
      place('left', -edge, 0, 0, 'left');
      owners.right = 'held-item-two-hand-right';
      owners.left = 'held-item-two-hand-left';
      record.secondaryActive = true;
    } else {
      place('right', 0, 0, target.height * (Number(target.neckFraction) || 0.2), 'bottle');
      applyFallbackSide(record, 'left');
      owners.right = 'held-item-bottle-neck';
      record.secondaryActive = false;
    }
    record.lastToolKey = null;
    record.lastVisualGripBasis = null;
  }

  function syncRigToTool(record, toolHolder, diagnostic = false) {
    if (!record?.rig || !toolHolder?.parent || syncing) return null;
    if (!toolHolder.visible) {
      applyFallbackBoth(record);
      record.secondaryActive = false;
      record.lastToolKey = null;
      record.lastVisualGripBasis = null;
      return diagnostic ? { direct: true, toolVisible: false, secondaryActive: false } : null;
    }

    syncing = true;
    try {
      const toolKey = currentToolKey(record);
      const gripContext = currentGripContext(record);
      const scaleIdentity = { speciesId: record.speciesId, gender: record.gender, rigScaleY: Number(record.avatarRoot?.userData?.proceduralHandRigScaleY) || null }; // Authored per-enemy body height (Maskbound troops), so grip targets match the resized weapon. Used by grip targets so they expand with the same calculated-height weapon scale as the visible item.
      if (record.avatarRoot?.userData?.proceduralHandToolHolder) {
        scaleIdentity.animationGripState = record.avatarRoot.userData.proceduralHandAnimationGrip ?? null; // Each NPC’s own animation gates both ranges; idle NPCs stay 1H.
      }
      const dualWield = toolGrips.dualWieldStateForTool?.(toolKey, gripContext, scaleIdentity) || null;
      const primaryGrip = toolGrips.primaryGripForTool(toolKey, gripContext, scaleIdentity);
      const primarySocket = toolSocketWorld(record, toolHolder, primaryGrip); // Raw fixed 1H target remains the canonical weapon-grip reference before optional Dual Wield remapping.
      record.rig.placePaperHandGuideWorld?.(primarySocket.position, primarySocket.quaternion);
      let primary = handSocketAfterGripMode(record, primarySocket); // Preserve the ordinary raw-socket contract for 1H/2H and diagnostics.
      if (dualWield) {
        const dualPrimarySocket = global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'right', primarySocket) || primarySocket;
        primary = handSocketAfterGripMode(record, dualPrimarySocket); // Dual Wield alone remaps the same canonical grip onto the lagged main-hand weapon copy.
      }
      const modelCalibration = modelCalibrationForRecord(record);
      record.rig.placeHandWorld?.('right', primary.position, primary.quaternion, modelCalibration);
      const owners = ensureFallbackState(record).owners;
      owners.right = 'primary-grip'; // Ordinary attachment ownership always wins over locomotion fallback.
      if (dualWield) owners.right = 'dual-wield-main-grip'; // Dual Wield refines that ownership to the lagged duplicate weapon.

      let secondaryGrip = null;
      const leftOverridden = ensureFallbackState(record).overridden?.left === true; // A gameplay pose owns the off hand: it neither mirrors a dual-wield weapon nor takes a two-hand grip.
      if (leftOverridden) {
        applyFallbackSide(record, 'left');
        record.secondaryActive = false;
        ensureFallbackState(record).owners.left = 'gameplay-pose';
      } else if (dualWield) {
        const offhandGrip = toolGrips.offhandPrimaryGripForTool?.(toolKey, gripContext, scaleIdentity) || primaryGrip; // Same authored 1H grip point, minus the main hand's palm-side offset: the offhand holds its copy from the other side.
        const offhandBaseSocket = toolSocketWorld(record, toolHolder, offhandGrip);
        const offhandSocket = global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'left', offhandBaseSocket) || offhandBaseSocket;
        const secondary = handSocketAfterGripMode(record, offhandSocket);
        record.rig.placeHandWorld?.('left', secondary.position, secondary.quaternion, modelCalibration, dualWield.influence);
        record.secondaryActive = true;
        ensureFallbackState(record).owners.left = 'dual-wield-offhand-grip';
      } else {
        secondaryGrip = toolGrips.secondaryGripForTool(toolKey, gripContext, scaleIdentity);
        if (secondaryGrip) {
          const secondary = handSocketAfterGripMode(record, toolSocketWorld(record, toolHolder, secondaryGrip));
          record.rig.placeHandWorld?.('left', secondary.position, secondary.quaternion, modelCalibration, secondaryGrip.influence);
          record.secondaryActive = true;
          ensureFallbackState(record).owners.left = 'secondary-grip';
        } else {
          applyFallbackSide(record, 'left');
          record.secondaryActive = false;
        }
      }
      record.lastToolKey = toolKey || null;
      record.lastVisualGripBasis = primary.visualBasis || null;

      // Frame/render callers discard the return value; only explicit syncNow
      // probes need the rich snapshot and deep copies of authored grips.
      if (!diagnostic) return null;
      return {
        direct: true,
        clamped: false,
        noArmIK: true,
        modelCalibrationOwnedByVisualChild: true,
        scaleFreeWorldQuaternion: true,
        toolKey: toolKey || null,
        gripContext,
        holderAuthority: record?.avatarRoot?.userData?.proceduralHandToolHolder ? 'actor-owned-world-transform' : 'player-weapon-stance-baked-matrix',
        gripMode: global.HobunjiHandGripModes?.currentModeKey?.() || null,
        primaryGrip: JSON.parse(JSON.stringify(primaryGrip)),
        secondaryActive: record.secondaryActive,
        dualWield: dualWield ? JSON.parse(JSON.stringify(dualWield)) : null,
        secondaryGrip: dualWield
          ? { mode: 'dual-wield', grip: JSON.parse(JSON.stringify(primaryGrip)), influence: dualWield.influence }
          : (secondaryGrip ? JSON.parse(JSON.stringify(secondaryGrip)) : null),
        authoredHandTransform: profiles.data?.models?.[modelCalibration.modelKey]?.handFromTool || null,
        modelCalibration,
        gripModeTransform: primary.mode,
        paperHandReferenceFrame: 'raw-primary-grip-before-grip-mode-and-hand-model-calibration',
        visualGripBasis: primary.visualBasis,
      };
    } finally {
      syncing = false;
    }
  }

  const originalInstallGameRuntime = hands.installGameRuntime?.bind(hands);
  if (originalInstallGameRuntime) {
    hands.installGameRuntime = function directHandGameRuntime(deps) {
      gameDeps = deps || null;
      return originalInstallGameRuntime(deps);
    };
  }

  function disposeSyncSentinel(record) {
    const sentinel = record?.syncSentinel;
    if (!sentinel) return;
    sentinel.parent?.remove?.(sentinel);
    sentinel.geometry?.dispose?.();
    sentinel.material?.dispose?.();
    record.syncSentinel = null;
  }

  function ensureSyncSentinel(record) {
    if (!record?.rig?.parent || record.syncSentinel) return;
    const THREE = record.THREE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      0.0001, 0, 0,
      0, 0.0001, 0,
    ], 3));
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false });
    material.colorWrite = false;
    const sentinel = new THREE.Mesh(geometry, material);
    sentinel.name = `${record.name || 'avatar'}_direct_hand_sync`;
    sentinel.frustumCulled = false;
    sentinel.renderOrder = -100000;
    sentinel.onBeforeRender = () => {
      // THREE.WebGLRenderer.prototype.render() is shared across every
      // renderer instance in the game (see combat-config-loader.js's
      // makeRendererPrototypeHookable), and fires more than once per real
      // browser frame — pixel-probe.js's diagnostic isolation renders and
      // farm-panel-core.js's house-layout preview renderer both render this
      // same live scene through it. player-body-attachment-bridge.js hit
      // the identical hazard for shoulder pets (see its frameId-memoized
      // fix) and it applies here too: poseAndSyncUpdate (pre-render phase)
      // already ran this exact sync once, authoritatively, before Three.js
      // traversal even starts, so only the first render() call this real
      // frame needs to repeat it — a later same-frame call would otherwise
      // redo the work, or read whatever transient toolHolder/stance state
      // that OTHER renderer's own pass left behind and stomp the correct
      // pose with it (visible as a one-frame hand pop).
      const frameId = global.RuntimeFrameScheduler?.frameId?.();
      if (frameId != null) record._lastRenderedFrameId = frameId; // Lets updateManagedRigs skip rigs nobody is drawing.
      if (frameId != null && record._lastHandSyncFrameId === frameId) return;
      record._lastHandSyncFrameId = frameId;
      if (record.rig.applyOwnedPose?.()) return; // A paired action retains its hand contacts through the final render-time sync too.
      if (inHandCalibrationMode()) {
        syncCalibrationWorkspace(record); // Render-time authority stays on the neutral calibration frame while this tab is active.
      } else {
        const heldItem = heldItemTarget(record);
        const holder = heldItem ? null : currentToolHolder(record);
        if (heldItem) syncRigToHeldItem(record, heldItem);
        else if (holder) syncRigToTool(record, holder);
        else applyFallbackBoth(record);
      }
    };
    record.rig.parent.add(sentinel);
    record.syncSentinel = sentinel;
    record._lastRenderedFrameId = global.RuntimeFrameScheduler?.frameId?.() ?? null; // A rig that never draws stops costing pre-render work after the grace window.
  }

  // The sentinel only fires when its rig is actually drawn, so a rig whose
  // sentinel hasn't fired for a couple of frames is in another area's scene,
  // hidden, or detached. Its pose isn't visible, so skip the pre-render pose
  // work for it; the sentinel still syncs it on the first frame it draws
  // again, and pre-render takes over from the next frame.
  const UNRENDERED_GRACE_FRAMES = 2;
  function rigRecentlyRendered(record) {
    const frameId = global.RuntimeFrameScheduler?.frameId?.();
    if (frameId == null || record._lastRenderedFrameId == null) return true; // No frame scheduler (tool pages): keep the old every-frame behavior.
    return frameId - record._lastRenderedFrameId <= UNRENDERED_GRACE_FRAMES;
  }

  function updateManagedRigs() {
    for (const record of [...managed]) {
      if (!record.avatarRoot?.userData || record.avatarRoot.userData.proceduralHandRig !== record.rig) {
        disposeSyncSentinel(record);
        managed.delete(record);
        continue;
      }
      ensureSyncSentinel(record);
      if (!rigRecentlyRendered(record)) {
        record._poseSyncSkipped = true;
        continue;
      }
      if (record._poseSyncSkipped && record.fallback) {
        // Resume gait sampling from here instead of reading the whole off-screen
        // gap as one stride's worth of movement.
        record.fallback.hasWorldPosition = false;
        record.fallback.lastSampleMs = null;
      }
      record._poseSyncSkipped = false;
      updateFallbackMotion(record);
      if (record.rig.applyOwnedPose?.()) continue; // Explicit pose ownership precedes held-tool and idle fallback writers.
      if (inHandCalibrationMode()) {
        syncCalibrationWorkspace(record);
      } else {
        const heldItem = heldItemTarget(record);
        const holder = heldItem ? null : currentToolHolder(record);
        if (heldItem) syncRigToHeldItem(record, heldItem);
        else if (holder) syncRigToTool(record, holder);
        else applyFallbackBoth(record);
      }
    }
  }

  // Discovery/attachment (does a newly-built avatar's rig need attaching yet?)
  // has no ordering dependency on gameplay simulation or rendering, so it is
  // split out from the render-sensitive pose/sync work below instead of
  // sharing one per-frame callback (see
  // docs/architecture/runtime-frame-scheduler.md's Stage 7 notes). The final
  // exact tool/hand matrix stays entirely in ensureSyncSentinel's
  // onBeforeRender hook below, untouched by either piece of this split.
  function attachmentSweep() {
    for (const record of [...pending]) {
      if (!record.avatarRoot?.userData) {
        pending.delete(record);
        continue;
      }
      if (record.avatarRoot.userData.proceduralHandRig || attachPending(record)) pending.delete(record);
    }
  }

  // Needs this frame's fresh simulation state (elapsed time, current parent
  // world position for the fallback gait) but must run before Three.js
  // traverses the scene, so this is pre-render phase work.
  function poseAndSyncUpdate() {
    updateManagedRigs();
  }

  global.ProceduralHandFrameDriver = {
    syncNow() {
      const results = [];
      for (const record of managed) {
        updateFallbackMotion(record);
        if(record.rig.applyOwnedPose?.()){results.push({poseOwned:true});continue;} // Async shoulder/profile refreshes obey the same action owner as normal frames.
        if (inHandCalibrationMode()) {
          results.push(syncCalibrationWorkspace(record, true));
        } else {
          const holder = currentToolHolder(record);
          if (holder) results.push(syncRigToTool(record, holder, true));
          else {
            applyFallbackBoth(record);
            results.push({ direct: true, toolVisible: false, secondaryActive: false });
          }
        }
      }
      return results;
    },
    getDebug() {
      return [...managed].map(record => ({
        speciesId: record.speciesId,
        gender: record.gender,
        mode: inHandCalibrationMode() ? 'glb-calibration-neutral-reference' : 'direct-tool-attachments',
        noArmIK: true,
        toolKey: record.lastToolKey,
        secondaryActive: record.secondaryActive,
        scaleFreeWorldQuaternion: true,
        visualGripBasis: record.lastVisualGripBasis,
        fallback: record.fallback ? {
          mode: record.fallback.mode,
          speed: Number(record.fallback.speed.toFixed(3)),
          gaitStrength: Number(record.fallback.gaitStrength.toFixed(3)),
          phase: Number(record.fallback.phase.toFixed(3)),
          owners: { ...record.fallback.owners },
        } : null,
        modelKey: modelKeyForRecord(record),
        handFromTool: global.HobunjiHandGripModes?.effectiveFrameForModel?.(modelKeyForRecord(record))
          || profiles.data?.models?.[modelKeyForRecord(record)]?.handFromTool
          || null,
        primaryGrip: toolGrips.primaryGripForTool(record.lastToolKey, toolGrips.currentGripContext?.(), { speciesId: record.speciesId, gender: record.gender }),
        secondaryGrip: toolGrips.secondaryGripForTool(record.lastToolKey, toolGrips.currentGripContext?.(), { speciesId: record.speciesId, gender: record.gender }) || null,
        hand: record.rig?.getDebug?.() || null,
        hasPreRenderSentinel: !!record.syncSentinel,
        poseSyncSkipped: !!record._poseSyncSkipped,
      }));
    },
  };

  toolGrips.subscribe?.(() => global.ProceduralHandFrameDriver?.syncNow?.());
  profiles.subscribe?.((_data, change) => {
    if (change?.kind === 'hand-transform' || change?.kind === 'model-mapping' || change?.kind === 'species-scale') {
      global.ProceduralHandFrameDriver?.syncNow?.();
    }
  });

  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('procedural-hand-attachment', attachmentSweep, {
      owner: 'ProceduralHandFrameDriver',
      description: 'Attaches a pending procedural hand rig once its avatar has been added to the scene.',
    });
    global.RuntimeFrameScheduler.register('procedural-hand-pose-sync', poseAndSyncUpdate, {
      phase: 'pre-render',
      owner: 'ProceduralHandFrameDriver',
      description: 'Ensures each managed rig\'s render sentinel exists and refreshes its fallback gait pose from this frame\'s state.',
    });
  } else {
    // The standalone Attack Animation Editor and Animation Author tool pages
    // (docs/tools/*) also load this module but never load
    // RuntimeFrameScheduler — they own their own isolated animation context,
    // so this keeps the original combined per-frame loop for them unchanged.
    (function frame() {
      attachmentSweep();
      poseAndSyncUpdate();
      global.requestAnimationFrame(frame);
    })();
  }
})(window);
