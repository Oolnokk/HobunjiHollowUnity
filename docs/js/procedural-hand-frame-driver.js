// Compatibility frame driver for procedural hands.
//
// The right hand is inverse-animated from the held tool. Each hand model supplies
// a fine handFromTool transform and the shared grip-mode layer adds the current
// palm orientation. Tool pose is authoritative while reachable. If the requested
// hand target exceeds the constrained arm reach, the tool is translated only for
// that solve/render; the authored/base tool pose is never rewritten.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  const profiles = global.HobunjiHandModelProfiles;
  const avatarApi = global.PNGPlaneAvatar;
  if (!hands?.attach || !profiles || !avatarApi?.buildSinglePlaneAvatarModel) return;
  if (avatarApi.buildSinglePlaneAvatarModel.__hobunjiHandFrameDriverWrapped) return;

  const pending = new Set();
  const managed = new Set();
  let gameDeps = null;
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

  function portraitPointToLocal(point, modelWidth, modelHeight, placementRatio, anchorZ) {
    if (!point || !Number.isFinite(Number(point.xRatio)) || !Number.isFinite(Number(point.yRatio))) return null;
    return {
      x: -modelWidth / 2 + Number(point.xRatio) * modelWidth,
      y: modelHeight * (0.5 + placementRatio - Number(point.yRatio)),
      z: anchorZ,
    };
  }

  function armAttachmentsFromCanvas(sourceCanvas, avatarRoot) {
    const modelWidth = Number(avatarRoot?.userData?.portraitModelWidth) || 0.9;
    const modelHeight = Number(avatarRoot?.userData?.portraitModelHeight) || 0.9;
    const placementRatio = Number(avatarRoot?.userData?.portraitVerticalPlacementRatio) || 0.5;
    const handAttachX = Number(avatarRoot?.userData?.handAttachX) || -modelWidth / 2;
    const handAttachY = Number(avatarRoot?.userData?.handAttachY) || modelHeight * 0.45;
    const anchorZ = 0;
    const scan = sourceCanvas?.hobunjiArmAttachmentScan || null;
    const fallbackLength = modelHeight * 0.32;
    const rightShoulder = portraitPointToLocal(scan?.right?.shoulder, modelWidth, modelHeight, placementRatio, anchorZ)
      || { x: handAttachX, y: handAttachY + fallbackLength, z: anchorZ };
    const leftShoulder = portraitPointToLocal(scan?.left?.shoulder, modelWidth, modelHeight, placementRatio, anchorZ)
      || { x: -handAttachX, y: handAttachY + fallbackLength, z: anchorZ };
    const leftHand = portraitPointToLocal(scan?.left?.hand, modelWidth, modelHeight, placementRatio, anchorZ)
      || { x: -handAttachX, y: handAttachY, z: anchorZ };
    const armLength = Math.max(modelHeight * 0.05, rightShoulder.y - handAttachY);
    return {
      left: { shoulder: leftShoulder, idleHand: leftHand, armLength },
      right: { shoulder: rightShoulder, idleHand: { x: handAttachX, y: handAttachY, z: anchorZ }, armLength },
      scanSucceeded: !!(scan?.left && scan?.right),
      rule: scan?.rule || 'fallback shoulder directly above tool attach',
      source: scan,
    };
  }

  function newClampState() {
    return { parent: null, baseLocal: null, adjustedLocal: null, active: false };
  }

  function attachPending(record) {
    const avatarRoot = record.avatarRoot;
    if (!avatarRoot?.parent || avatarRoot.userData?.proceduralArmRig) return !!avatarRoot?.userData?.proceduralArmRig;
    const anatomy = armAttachmentsFromCanvas(record.sourceCanvas, avatarRoot);
    avatarRoot.userData.armAttachments = anatomy;
    const rig = hands.attach(record.THREE, avatarRoot.parent, {
      speciesId: record.speciesId,
      gender: record.gender,
      bodyColors: record.bodyColors,
      modelHeight: avatarRoot.userData?.portraitModelHeight,
      handAttachX: avatarRoot.userData?.handAttachX,
      handAttachY: avatarRoot.userData?.handAttachY,
      armAttachments: anatomy,
      avatarRoot,
      name: record.name || avatarRoot.name || 'avatar',
    });
    if (!rig) return false;
    avatarRoot.userData.proceduralArmRig = rig;
    record.rig = rig;
    record.anatomy = anatomy;
    record.syncSentinel = null;
    record.clampState = newClampState();
    managed.add(record);
    return true;
  }

  const originalBuild = avatarApi.buildSinglePlaneAvatarModel;
  const wrappedBuild = function frameDrivenHandAvatarBuild(THREE, sourceCanvas, options = {}) {
    const avatarRoot = originalBuild.call(this, THREE, sourceCanvas, options);
    const identity = identityFor(options);
    if (!avatarRoot || !identity.speciesId || !profiles.modelKeyForSpecies(identity.speciesId)) return avatarRoot;
    pending.add({
      THREE,
      avatarRoot,
      sourceCanvas,
      speciesId: identity.speciesId,
      gender: identity.gender,
      bodyColors: options.profile?.bodyColors || options.appearance?.bodyColors || options.bodyColors,
      name: options.name,
      rig: null,
      anatomy: null,
      syncSentinel: null,
      clampState: newClampState(),
    });
    return avatarRoot;
  };
  wrappedBuild.__hobunjiHandFrameDriverWrapped = true;
  avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;

  function findEditorToolHolder(record) {
    const avatarRoot = record?.avatarRoot;
    const bodyRoot = avatarRoot?.parent;
    if (!bodyRoot) return null;
    for (const child of bodyRoot.children || []) {
      if (child === avatarRoot || child === record.rig?.group || child === record.syncSentinel) continue;
      const hasAnchorSphere = (child.children || []).some(candidate => candidate?.isMesh && candidate.geometry?.type === 'SphereGeometry');
      if (!hasAnchorSphere) continue;
      const holder = (child.children || []).find(candidate => !candidate?.isMesh && candidate?.isObject3D);
      if (holder) return holder;
    }
    return null;
  }

  function transformForRecord(record) {
    const raw = profiles.handTransformForSpecies?.(record.speciesId)
      || profiles.modelForSpecies?.(record.speciesId)?.handFromTool
      || {};
    const p = raw.position || {};
    const r = raw.rotationDeg || {};
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
    };
  }

  function clearClampState(record) {
    record.clampState = newClampState();
  }

  function restorePreviousClampIfStillApplied(record, toolHolder) {
    const state = record.clampState || newClampState();
    if (!state.active || !state.baseLocal || !state.adjustedLocal || state.parent !== toolHolder.parent) {
      clearClampState(record);
      return false;
    }

    // If an animation/tool system has already authored a new local pose since the
    // previous solve, do not subtract the old correction from that new pose. Only
    // restore when the holder is still exactly where our last clamp left it.
    const toleranceSq = 1e-8;
    if (toolHolder.position.distanceToSquared(state.adjustedLocal) <= toleranceSq) {
      toolHolder.position.copy(state.baseLocal);
      toolHolder.updateMatrix?.();
      toolHolder.updateMatrixWorld?.(true);
      clearClampState(record);
      return true;
    }

    clearClampState(record);
    return false;
  }

  function syncRigToTool(record, toolHolder) {
    const rig = record?.rig;
    if (!rig || !toolHolder?.parent || syncing) return null;
    if (!toolHolder.visible) {
      restorePreviousClampIfStillApplied(record, toolHolder);
      rig.useIdlePose?.();
      return null;
    }

    syncing = true;
    try {
      restorePreviousClampIfStillApplied(record, toolHolder);
      toolHolder.parent.updateWorldMatrix?.(true, true);
      toolHolder.updateWorldMatrix?.(true, true);

      const Vector3 = toolHolder.position.constructor;
      const Quaternion = toolHolder.quaternion.constructor;
      const baseLocal = toolHolder.position.clone();
      const toolWorldPosition = toolHolder.getWorldPosition(new Vector3());
      const toolWorldQuaternion = toolHolder.getWorldQuaternion(new Quaternion());
      const authored = transformForRecord(record);
      const handOffset = new Vector3(authored.position.x, authored.position.y, authored.position.z).applyQuaternion(toolWorldQuaternion);
      const desiredHandWorld = toolWorldPosition.clone().add(handOffset);
      const offsetQuaternion = new Quaternion().setFromEuler(new record.THREE.Euler(
        record.THREE.MathUtils.degToRad(authored.rotationDeg.pitch),
        record.THREE.MathUtils.degToRad(authored.rotationDeg.yaw),
        record.THREE.MathUtils.degToRad(authored.rotationDeg.roll),
        'YXZ',
      ));
      const desiredHandQuaternion = toolWorldQuaternion.clone().multiply(offsetQuaternion);
      const result = rig.followWorldTarget?.(desiredHandWorld, desiredHandQuaternion);

      if (!result?.clamped) {
        clearClampState(record);
        return {
          clamped: false,
          desiredHandWorld,
          toolWorldPosition,
          gripMode: global.HobunjiHandGripModes?.currentModeKey?.() || null,
        };
      }

      // The clamp is a derived visual/runtime correction, never authored data.
      // Store the untouched local pose so a later solve can return to it when arm
      // length, species, grip mode or hand offset changes.
      const clampDeltaWorld = result.target.clone().sub(desiredHandWorld);
      const adjustedToolWorld = toolWorldPosition.clone().add(clampDeltaWorld);
      const adjustedLocal = adjustedToolWorld.clone();
      toolHolder.parent.worldToLocal(adjustedLocal);
      toolHolder.position.copy(adjustedLocal);
      toolHolder.updateMatrix?.();
      toolHolder.updateMatrixWorld?.(true);
      rig.group?.updateMatrixWorld?.(true);
      record.clampState = {
        parent: toolHolder.parent,
        baseLocal,
        adjustedLocal: adjustedLocal.clone(),
        active: true,
      };

      return {
        clamped: true,
        desiredHandWorld,
        constrainedHandWorld: result.target.clone(),
        clampDeltaWorld,
        adjustedToolLocal: adjustedLocal.clone(),
        baseToolLocal: baseLocal.clone(),
        constraint: result.constraint || 'reach-limit',
        gripMode: global.HobunjiHandGripModes?.currentModeKey?.() || null,
      };
    } finally {
      syncing = false;
    }
  }

  const originalInstallGameRuntime = hands.installGameRuntime?.bind(hands);
  if (originalInstallGameRuntime) {
    hands.installGameRuntime = function frameDrivenGameRuntime(deps) {
      gameDeps = deps || null;
      return originalInstallGameRuntime(deps);
    };
  }

  function currentToolHolder(record) {
    const editor = /\/tools\/attack-animation-editor\//.test(location.pathname);
    if (editor) return findEditorToolHolder(record);
    if (gameDeps?.playerMesh && record.rig?.parent === gameDeps.playerMesh) return gameDeps.toolHolder || null;
    return null;
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
    sentinel.name = `${record.name || 'avatar'}_hand_sync_sentinel`;
    sentinel.frustumCulled = false;
    sentinel.renderOrder = -100000;
    sentinel.onBeforeRender = () => {
      const toolHolder = currentToolHolder(record);
      if (toolHolder) syncRigToTool(record, toolHolder);
      else record.rig?.useIdlePose?.();
    };
    record.rig.parent.add(sentinel);
    record.syncSentinel = sentinel;
  }

  function updateManagedRigs() {
    for (const record of [...managed]) {
      if (!record.avatarRoot?.userData || record.avatarRoot.userData.proceduralArmRig !== record.rig) {
        disposeSyncSentinel(record);
        managed.delete(record);
        continue;
      }
      ensureSyncSentinel(record);
      const toolHolder = currentToolHolder(record);
      if (toolHolder) syncRigToTool(record, toolHolder);
      else record.rig?.useIdlePose?.();
    }
  }

  function frame() {
    for (const record of [...pending]) {
      if (!record.avatarRoot?.userData) {
        pending.delete(record);
        continue;
      }
      if (record.avatarRoot.userData.proceduralArmRig || attachPending(record)) pending.delete(record);
    }
    updateManagedRigs();
    global.requestAnimationFrame(frame);
  }

  global.ProceduralHandFrameDriver = {
    syncNow() {
      const results = [];
      for (const record of managed) {
        const toolHolder = currentToolHolder(record);
        if (toolHolder) results.push(syncRigToTool(record, toolHolder));
        else {
          record.rig?.useIdlePose?.();
          results.push(null);
        }
      }
      return results;
    },
    getDebug() {
      return [...managed].map(record => ({
        speciesId: record.speciesId,
        gender: record.gender,
        handFromTool: profiles.handTransformForSpecies?.(record.speciesId) || null,
        gripMode: global.HobunjiHandGripModes?.currentModeKey?.() || null,
        arm: record.rig?.getDebug?.() || null,
        clamp: record.clampState?.active ? {
          baseLocal: record.clampState.baseLocal?.toArray?.() || null,
          adjustedLocal: record.clampState.adjustedLocal?.toArray?.() || null,
        } : null,
        hasPreRenderSentinel: !!record.syncSentinel,
      }));
    },
  };

  global.requestAnimationFrame(frame);
})(window);
