// Direct tool-to-hand frame driver.
//
// No arm solver participates. The right hand follows the toolHolder's authored
// primary grip frame directly. If the active tool has an enabled secondary grip
// in hand-tool-grips.js, the left hand follows that frame; otherwise it remains
// at its avatar idle attachment. The tool is never translated or rotated by hands.
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
    const rig = hands.attach(record.THREE, avatarRoot.parent, {
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
    for (const child of bodyRoot.children || []) {
      if (child === record.avatarRoot || child === record.rig?.group || child === record.syncSentinel) continue;
      const hasAnchorSphere = (child.children || []).some(candidate => candidate?.isMesh && candidate.geometry?.type === 'SphereGeometry');
      if (!hasAnchorSphere) continue;
      const holder = (child.children || []).find(candidate => !candidate?.isMesh && candidate?.isObject3D);
      if (holder) return holder;
    }
    return null;
  }

  function inAttackEditor() {
    return /\/tools\/attack-animation-editor\//.test(location.pathname);
  }

  function currentToolKey() {
    if (inAttackEditor()) {
      return toolGrips.toolKeyFor(document.getElementById('toolSpriteSelect')?.value || '');
    }
    const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
    return toolGrips.toolKeyFor(snapshot?.itemKey || snapshot?.shape || '');
  }

  function currentToolHolder(record) {
    if (inAttackEditor()) return findEditorToolHolder(record);
    if (gameDeps?.playerMesh && record.rig?.parent === gameDeps.playerMesh) return gameDeps.toolHolder || null;
    return null;
  }

  function handTransformForRecord(record) {
    const raw = global.HobunjiHandGripModes?.effectiveFrameForSpecies?.(record.speciesId)
      || profiles.handTransformForSpecies?.(record.speciesId)
      || profiles.modelForSpecies?.(record.speciesId)?.handFromTool
      || {};
    const p = raw.position || {};
    const r = raw.rotationDeg || {};
    const q = raw.rotationQuaternion || null;
    const modelHeight = Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9;
    const effectiveScale = Number(profiles.effectiveScaleFor?.(record.speciesId, record.gender)) || 1;
    const unit = modelHeight * (Number(profiles.data?.handHeightFraction) || 0.12) * effectiveScale;
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
      rotationQuaternion: q && [q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))
        ? { x: Number(q.x), y: Number(q.y), z: Number(q.z), w: Number(q.w) }
        : null,
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
      const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
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
  function toolSocketWorld(record, toolHolder, secondaryGrip = null) {
    const Vector3 = toolHolder.position.constructor;
    const Quaternion = toolHolder.quaternion.constructor;
    const bakedWorldMatrix = !inAttackEditor() ? global.WeaponToolStances?.lastHolderMatrixWorld?.() : null;

    const visualBasis = visualGripBasisDelta(record, toolHolder);
    let position;
    // Used as the scale-free world orientation of the tool socket. Do not use
    // getWorldQuaternion() on toolHolder's own local quaternion/position chain
    // in general (the game player hierarchy can contain negative scale) — but
    // toolHolder itself lives directly under the scene root and never carries
    // non-uniform or negative scale (see toolHolder.scale.setScalar calls in
    // game.js), so decomposing its already-baked matrixWorld is safe.
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
    if (secondaryGrip) {
      const p = secondaryGrip.position || {};
      const localOffset = new Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0)
        .applyQuaternion(visualBasis.quaternion);
      if (bakedWorldMatrix) localOffset.applyMatrix4(bakedWorldMatrix);
      else toolHolder.localToWorld(localOffset);
      position = localOffset;
      quaternion.multiply(quaternionFromDeg(record, secondaryGrip.rotationDeg || {}));
    } else if (!bakedWorldMatrix) {
      position = toolHolder.getWorldPosition(new Vector3());
    }
    return { position, quaternion, visualBasis };
  }

  function handWorldFromSocket(record, socketFrame) {
    const Vector3 = socketFrame.position.constructor;
    const authored = handTransformForRecord(record);
    const offset = new Vector3(authored.position.x, authored.position.y, authored.position.z)
      .applyQuaternion(socketFrame.quaternion);
    return {
      position: socketFrame.position.clone().add(offset),
      quaternion: socketFrame.quaternion.clone().multiply(quaternionFromAuthored(record, authored)),
      authored,
      visualBasis: socketFrame.visualBasis || null,
    };
  }

  function syncRigToTool(record, toolHolder) {
    if (!record?.rig || !toolHolder?.parent || syncing) return null;
    if (!toolHolder.visible) {
      record.rig.useIdlePose?.();
      record.secondaryActive = false;
      record.lastToolKey = null;
      record.lastVisualGripBasis = null;
      return { direct: true, toolVisible: false, secondaryActive: false };
    }

    syncing = true;
    try {
      const toolKey = currentToolKey();
      const primary = handWorldFromSocket(record, toolSocketWorld(record, toolHolder));
      record.rig.placeHandWorld?.('right', primary.position, primary.quaternion);

      const secondaryGrip = toolGrips.secondaryGripForTool(toolKey);
      if (secondaryGrip) {
        const secondary = handWorldFromSocket(record, toolSocketWorld(record, toolHolder, secondaryGrip));
        record.rig.placeHandWorld?.('left', secondary.position, secondary.quaternion);
        record.secondaryActive = true;
      } else {
        record.rig.setSideIdle?.('left');
        record.secondaryActive = false;
      }
      record.lastToolKey = toolKey || null;
      record.lastVisualGripBasis = primary.visualBasis || null;

      return {
        direct: true,
        clamped: false,
        noArmIK: true,
        quaternionNativeGripComposition: !!primary.authored.rotationQuaternion,
        scaleFreeWorldQuaternion: true,
        toolKey: toolKey || null,
        gripMode: global.HobunjiHandGripModes?.currentModeKey?.() || null,
        secondaryActive: record.secondaryActive,
        secondaryGrip: secondaryGrip ? JSON.parse(JSON.stringify(secondaryGrip)) : null,
        authoredHandTransform: primary.authored,
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
      const holder = currentToolHolder(record);
      if (holder) syncRigToTool(record, holder);
      else record.rig?.useIdlePose?.();
    };
    record.rig.parent.add(sentinel);
    record.syncSentinel = sentinel;
  }

  function updateManagedRigs() {
    for (const record of [...managed]) {
      if (!record.avatarRoot?.userData || record.avatarRoot.userData.proceduralHandRig !== record.rig) {
        disposeSyncSentinel(record);
        managed.delete(record);
        continue;
      }
      ensureSyncSentinel(record);
      const holder = currentToolHolder(record);
      if (holder) syncRigToTool(record, holder);
      else record.rig?.useIdlePose?.();
    }
  }

  function frame() {
    for (const record of [...pending]) {
      if (!record.avatarRoot?.userData) {
        pending.delete(record);
        continue;
      }
      if (record.avatarRoot.userData.proceduralHandRig || attachPending(record)) pending.delete(record);
    }
    updateManagedRigs();
    global.requestAnimationFrame(frame);
  }

  global.ProceduralHandFrameDriver = {
    syncNow() {
      const results = [];
      for (const record of managed) {
        const holder = currentToolHolder(record);
        if (holder) results.push(syncRigToTool(record, holder));
        else {
          record.rig?.useIdlePose?.();
          results.push({ direct: true, toolVisible: false, secondaryActive: false });
        }
      }
      return results;
    },
    getDebug() {
      return [...managed].map(record => ({
        speciesId: record.speciesId,
        gender: record.gender,
        mode: 'direct-tool-attachments',
        noArmIK: true,
        toolKey: record.lastToolKey,
        secondaryActive: record.secondaryActive,
        scaleFreeWorldQuaternion: true,
        visualGripBasis: record.lastVisualGripBasis,
        handFromTool: global.HobunjiHandGripModes?.effectiveFrameForSpecies?.(record.speciesId)
          || profiles.handTransformForSpecies?.(record.speciesId)
          || null,
        secondaryGrip: toolGrips.secondaryGripForTool(record.lastToolKey) || null,
        hand: record.rig?.getDebug?.() || null,
        hasPreRenderSentinel: !!record.syncSentinel,
      }));
    },
  };

  toolGrips.subscribe?.(() => global.ProceduralHandFrameDriver?.syncNow?.());
  global.requestAnimationFrame(frame);
})(window);