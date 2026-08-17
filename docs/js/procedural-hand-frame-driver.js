// Compatibility frame driver for procedural hands.
//
// Three.js r128 installs WebGLRenderer.render on each renderer instance rather
// than WebGLRenderer.prototype. The original hand bootstrap tried to use a
// prototype render hook, so pending avatar rigs were never promoted into live
// hand rigs in the editor (and their tool-follow pass never ran). This small
// adapter keeps the shared hand implementation untouched while driving its
// public attach/follow API once per animation frame.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  const profiles = global.HobunjiHandModelProfiles;
  const avatarApi = global.PNGPlaneAvatar;
  if (!hands?.attach || !profiles || !avatarApi?.buildSinglePlaneAvatarModel) return;
  if (avatarApi.buildSinglePlaneAvatarModel.__hobunjiHandFrameDriverWrapped) return;

  const pending = new Set(); // Avatars wait here until their caller has inserted them under the real floor/body root.
  const managed = new Set(); // Rigs attached by this driver and updated before the page's normal render callback.
  let gameDeps = null; // Captured from the existing player-body bridge so gameplay gets the same tool-follow behavior.

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
    managed.add({ avatarRoot, rig });
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

  function followRigToTool(rig, toolHolder) {
    if (!rig || !toolHolder?.visible || !toolHolder.parent) {
      rig?.useIdlePose?.();
      return;
    }
    toolHolder.parent.updateWorldMatrix?.(true, true);
    const worldPosition = toolHolder.getWorldPosition(new toolHolder.position.constructor());
    const worldQuaternion = toolHolder.getWorldQuaternion(new toolHolder.quaternion.constructor());
    const result = rig.followWorldTarget?.(worldPosition, worldQuaternion);
    if (!result?.clamped) return;
    const adjustedLocal = result.target.clone();
    toolHolder.parent.worldToLocal(adjustedLocal);
    toolHolder.position.copy(adjustedLocal);
  }

  const originalInstallGameRuntime = hands.installGameRuntime?.bind(hands);
  if (originalInstallGameRuntime) {
    hands.installGameRuntime = function frameDrivenGameRuntime(deps) {
      gameDeps = deps || null;
      return originalInstallGameRuntime(deps);
    };
  }

  function updateManagedRigs() {
    const editor = /\/tools\/attack-animation-editor\//.test(location.pathname);
    for (const record of [...managed]) {
      if (!record.avatarRoot?.userData || record.avatarRoot.userData.proceduralArmRig !== record.rig) {
        managed.delete(record);
        continue;
      }
      if (editor) {
        followRigToTool(record.rig, findEditorToolHolder(record));
      } else if (gameDeps?.playerMesh && record.rig?.parent === gameDeps.playerMesh) {
        followRigToTool(record.rig, gameDeps.toolHolder);
      }
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

  global.requestAnimationFrame(frame);
})(window);
