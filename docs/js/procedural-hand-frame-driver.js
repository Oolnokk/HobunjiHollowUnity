// Compatibility frame driver for procedural hands.
//
// The right hand is inverse-animated from the held tool. Each hand model authors
// a direct handFromTool transform (hand root relative to the tool attach frame).
// The tool pose stays authoritative while the requested hand target is reachable.
// If it exceeds the species' arm length, IK clamps the hand to the reach sphere
// and the tool is translated inward by that exact delta. The same rule is used
// by gameplay and the Attack Animation Editor.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  const profiles = global.HobunjiHandModelProfiles;
  const avatarApi = global.PNGPlaneAvatar;
  if (!hands?.attach || !profiles || !avatarApi?.buildSinglePlaneAvatarModel) return;
  if (avatarApi.buildSinglePlaneAvatarModel.__hobunjiHandFrameDriverWrapped) return;

  const pending = new Set(); // Avatars wait here until their caller inserts them under the real floor/body root.
  const managed = new Set(); // Rigs attached by this driver and synchronized to held tools.
  const hookedMeshes = new WeakMap(); // Preserves pre-existing onBeforeRender callbacks while adding current-frame IK.
  let gameDeps = null; // Captured from the existing player-body bridge so gameplay uses the same inverse-hand rule.
  let pendingEditorRewrite = null; // Persists a clamped authored keyframe after the render that discovered the overreach.
  let syncing = false; // Prevents nested onBeforeRender callbacks from solving the same rig recursively.

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
      if (child === avatarRoot || child === record.rig?.group) continue;
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

  function editorPhaseAtKeyframe() {
    if (!/\/tools\/attack-animation-editor\//.test(location.pathname)) return null;
    const playButton = document.getElementById('playPauseBtn');
    if (!playButton || !/Play/i.test(playButton.textContent || '')) return null; // Only rewrite authored data while preview is paused.
    const scrub = Number(document.getElementById('scrub')?.value);
    const windup = Number(document.getElementById('windupFrac')?.value);
    const strike = Number(document.getElementById('strikeFrac')?.value);
    const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.0015;
    if (near(scrub, 0)) return 'neutral';
    if (near(scrub, windup)) return 'windup';
    if (near(scrub, strike)) return 'strike';
    return null;
  }

  function queueEditorPoseRewrite(localPosition) {
    const phase = editorPhaseAtKeyframe();
    if (!phase || !localPosition) return;
    pendingEditorRewrite = {
      phase,
      x: localPosition.x,
      y: localPosition.y,
      z: localPosition.z,
    };
  }

  function applyPendingEditorRewrite() {
    const rewrite = pendingEditorRewrite;
    pendingEditorRewrite = null;
    if (!rewrite) return;
    // Dispatch through the editor's own range inputs so its module-scoped anim
    // object, labels and JSON export all receive exactly the same clamped pose.
    for (const axis of ['x', 'y', 'z']) {
      const input = document.getElementById(`${rewrite.phase}_${axis}`);
      if (!input) continue;
      const next = Number(rewrite[axis]);
      if (!Number.isFinite(next) || Math.abs(Number(input.value) - next) < 0.0005) continue;
      input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), next)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function syncRigToTool(record, toolHolder, options = {}) {
    const rig = record?.rig;
    if (!rig || !toolHolder?.visible || !toolHolder.parent || syncing) {
      if (!toolHolder?.visible) rig?.useIdlePose?.();
      return null;
    }
    syncing = true;
    try {
      toolHolder.parent.updateWorldMatrix?.(true, true);
      toolHolder.updateWorldMatrix?.(true, true);
      const Vector3 = toolHolder.position.constructor;
      const Quaternion = toolHolder.quaternion.constructor;
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
      if (!result?.clamped) return { clamped: false, desiredHandWorld, toolWorldPosition };

      // Preserve the tool's authored rotation and the hand-from-tool offset.
      // Translating the tool by the hand clamp delta moves both frames together,
      // making the final hand root land exactly on the reachable IK target.
      const clampDeltaWorld = result.target.clone().sub(desiredHandWorld);
      const adjustedToolWorld = toolWorldPosition.clone().add(clampDeltaWorld);
      const adjustedLocal = adjustedToolWorld.clone();
      toolHolder.parent.worldToLocal(adjustedLocal);
      toolHolder.position.copy(adjustedLocal);
      toolHolder.updateMatrixWorld?.(true);
      rig.group?.updateMatrixWorld?.(true);
      if (options.persistEditorPose) queueEditorPoseRewrite(adjustedLocal);
      return {
        clamped: true,
        desiredHandWorld,
        constrainedHandWorld: result.target.clone(),
        clampDeltaWorld,
        adjustedToolLocal: adjustedLocal.clone(),
      };
    } finally {
      syncing = false;
    }
  }

  function installToolRenderHooks(record, toolHolder) {
    if (!record?.rig || !toolHolder?.traverse) return;
    toolHolder.traverse(node => {
      if (!node?.isMesh || hookedMeshes.has(node)) return;
      const previous = typeof node.onBeforeRender === 'function' ? node.onBeforeRender : null;
      const hook = function inverseHandBeforeToolRender(...args) {
        syncRigToTool(record, toolHolder, { persistEditorPose: true });
        previous?.apply(this, args);
      };
      hookedMeshes.set(node, previous);
      node.onBeforeRender = hook;
    });
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

  function updateManagedRigs() {
    for (const record of [...managed]) {
      if (!record.avatarRoot?.userData || record.avatarRoot.userData.proceduralArmRig !== record.rig) {
        managed.delete(record);
        continue;
      }
      const toolHolder = currentToolHolder(record);
      if (!toolHolder) continue;
      installToolRenderHooks(record, toolHolder); // Current-frame correction runs immediately before the tool mesh draws.
      syncRigToTool(record, toolHolder, { persistEditorPose: false }); // Keeps hands responsive even on frames where the tool has no renderable mesh yet.
    }
  }

  function frame() {
    applyPendingEditorRewrite();
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
        if (toolHolder) results.push(syncRigToTool(record, toolHolder, { persistEditorPose: true }));
      }
      return results;
    },
    getDebug() {
      return [...managed].map(record => ({
        speciesId: record.speciesId,
        gender: record.gender,
        handFromTool: profiles.handTransformForSpecies?.(record.speciesId) || null,
        arm: record.rig?.getDebug?.() || null,
      }));
    },
  };

  global.requestAnimationFrame(frame);
})(window);
