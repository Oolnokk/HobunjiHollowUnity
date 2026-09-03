// Fine Hood trim visibility follows the normal portrait plane only.
//
// npc-avatar-preview-utils may attach a trimless fallback shader lazily when it
// renders a Fine Hood. Keep that texture/shader machinery intact, but wrap the
// final avatar builder after portrait rendering and force the legacy facing
// uniform to the full-trim state after its own onBeforeRender callback runs.
// This removes camera/head-angle visibility changes everywhere, including NPCs.
(function (global) {
  'use strict';

  const preview = global.NpcAvatarPreview;
  const avatarApi = global.PNGPlaneAvatar;
  if (!preview?.renderProfileToCanvas || !avatarApi?.buildSinglePlaneAvatarModel) return;

  let correctedBuilds = 0;
  let correctedMeshes = 0;

  function disableFacingGate(root) {
    if (!root) return root;
    let corrected = 0;
    root.traverse?.(object => {
      if (!object?.isMesh || object.userData?.hobunjiFineHoodFacingDisabled) return;
      const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
      if (!materials.some(material => material?.userData?.hobunjiFineHoodTrimHeadOnFacingUniform)) return;
      const previousOnBeforeRender = typeof object.onBeforeRender === 'function' ? object.onBeforeRender : null;
      object.onBeforeRender = function fineHoodAlwaysVisibleBeforeRender(renderer, scene, camera, geometry, material, group) {
        previousOnBeforeRender?.call(this, renderer, scene, camera, geometry, material, group);
        const currentMaterials = this.material ? (Array.isArray(this.material) ? this.material : [this.material]) : [];
        for (const currentMaterial of currentMaterials) {
          const uniform = currentMaterial?.userData?.hobunjiFineHoodTrimHeadOnFacingUniform;
          if (uniform) uniform.value = 1;
          if (currentMaterial?.userData?.hobunjiFineHoodTrimHeadOn) {
            currentMaterial.userData.hobunjiFineHoodTrimHeadOn.cameraFacingVisibility = false;
            currentMaterial.userData.hobunjiFineHoodTrimHeadOn.transition = 'disabled';
          }
        }
      };
      object.userData = object.userData || {};
      object.userData.hobunjiFineHoodFacingDisabled = true;
      corrected += 1;
    });
    if (corrected) {
      root.userData = root.userData || {};
      root.userData.fineHoodTrimHeadOn = {
        ...(root.userData.fineHoodTrimHeadOn || {}),
        cameraFacingVisibility: false,
        transition: 'disabled',
        visibilityOwner: 'normal portrait front/back renderer',
        correctedMeshes: corrected,
      };
      correctedBuilds += 1;
      correctedMeshes += corrected;
    }
    return root;
  }

  function installBuildCorrection() {
    const currentBuild = avatarApi.buildSinglePlaneAvatarModel;
    if (typeof currentBuild !== 'function' || currentBuild.__hobunjiFineHoodFacingDisabledWrapped) return false;
    const wrapped = function buildAvatarWithoutFineHoodFacingGate(...args) {
      return disableFacingGate(currentBuild.apply(this, args));
    };
    wrapped.__hobunjiFineHoodFacingDisabledWrapped = true;
    avatarApi.buildSinglePlaneAvatarModel = wrapped;
    return true;
  }

  // The Fine Hood shader hook is installed lazily by portrait rendering. Run
  // our builder wrapper *after* every render so it stays outside that hook and
  // therefore gets the final say on the facing uniform.
  const originalRenderProfileToCanvas = preview.renderProfileToCanvas;
  preview.renderProfileToCanvas = async function renderProfileWithoutFineHoodFacingGate(...args) {
    const result = await originalRenderProfileToCanvas.apply(this, args);
    installBuildCorrection();
    return result;
  };
  installBuildCorrection();

  global.HobunjiFineHoodTrimHeadFacing = Object.freeze({
    getDebug() {
      return {
        correctedBuilds,
        correctedMeshes,
        cameraFacingVisibility: false,
        transition: 'disabled',
        visibilityOwner: 'normal portrait front/back renderer',
      };
    },
  });
})(window);
