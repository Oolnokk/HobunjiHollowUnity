// Corrects Fine Hood's head-on-only visibility after the portrait has been neck-rigged.
//
// The Fine Hood trim is authored as a distinct `layerRole: "trim"`, but portrait
// compositing flattens it into the same front texture as the rest of the hood/head.
// npc-avatar-preview-utils therefore builds a matched trimless texture and blends
// to it outside a head-on cone. That blend originally measured the SkinnedMesh's
// matrixWorld, which only describes the body plane; neckJoint can rotate the head
// region independently after skinning, so the trim could still remain visible while
// the actual head pixels were turned away. This adapter makes the gate follow the
// real rigged head orientation instead.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const preview = global.NpcAvatarPreview;
  const avatarApi = global.PNGPlaneAvatar;
  if (!THREE || !preview?.renderProfileToCanvas || !avatarApi?.buildSinglePlaneAvatarModel) return;

  let correctedBuilds = 0;
  let correctedMeshes = 0;
  let lastFacingDot = null;

  function installBuildCorrection() {
    const currentBuild = avatarApi.buildSinglePlaneAvatarModel;
    if (typeof currentBuild !== 'function' || currentBuild.__hobunjiFineHoodNeckFacingWrapped) return false;

    const correctedBuild = function fineHoodNeckFacingBuild(...args) {
      const root = currentBuild.apply(this, args);
      if (!root) return root;

      const neckJoint = root.userData?.neckRig?.neckJoint;
      if (!neckJoint?.isBone) return root;

      let attached = 0;
      root.traverse?.(object => {
        if (!object?.isMesh || object.userData?.__hobunjiFineHoodNeckFacing) return;
        const materials = object.material
          ? (Array.isArray(object.material) ? object.material : [object.material])
          : [];
        if (!materials.some(material => material?.userData?.hobunjiFineHoodTrimHeadOnFacingUniform)) return;

        const previousOnBeforeRender = typeof object.onBeforeRender === 'function'
          ? object.onBeforeRender
          : null;
        const localFront = new THREE.Vector3(0, 0, 1);
        const worldFront = new THREE.Vector3();
        const headWorld = new THREE.Vector3();
        const cameraWorld = new THREE.Vector3();
        const toCamera = new THREE.Vector3();

        object.onBeforeRender = function fineHoodNeckFacingBeforeRender(renderer, scene, camera, geometry, material, group) {
          previousOnBeforeRender?.call(this, renderer, scene, camera, geometry, material, group);
          const uniform = material?.userData?.hobunjiFineHoodTrimHeadOnFacingUniform;
          if (!uniform || !camera) return;

          // Bone matrixWorld includes the avatar/body transform AND the live neck
          // rotation. That is the actual orientation of the fully head-weighted
          // Fine Hood trim pixels; using the mesh matrix alone misses neck turns.
          neckJoint.updateWorldMatrix?.(true, false);
          worldFront.copy(localFront).transformDirection(neckJoint.matrixWorld).normalize();
          neckJoint.getWorldPosition(headWorld);
          camera.getWorldPosition(cameraWorld);
          toCamera.copy(cameraWorld).sub(headWorld).normalize();

          const dot = Math.max(-1, Math.min(1, worldFront.dot(toCamera)));
          uniform.value = dot;
          lastFacingDot = dot;
          material.userData.hobunjiFineHoodTrimLastFacingDot = dot;
          material.userData.hobunjiFineHoodTrimFacingSource = 'neck-bone';
        };

        object.userData = object.userData || {};
        object.userData.__hobunjiFineHoodNeckFacing = true;
        attached += 1;
      });

      if (attached > 0) {
        root.userData = root.userData || {};
        root.userData.fineHoodTrimHeadOn = {
          ...(root.userData.fineHoodTrimHeadOn || {}),
          facingSource: 'neck-bone',
          neckFacingMeshes: attached,
        };
        correctedBuilds += 1;
        correctedMeshes += attached;
      }
      return root;
    };

    correctedBuild.__hobunjiFineHoodNeckFacingWrapped = true;
    avatarApi.buildSinglePlaneAvatarModel = correctedBuild;
    return true;
  }

  // Fine Hood's trimless shader hook is installed lazily by
  // NpcAvatarPreview.renderProfileToCanvas when it actually encounters a Fine
  // Hood. Install our build wrapper immediately AFTER that call, so our wrapper
  // sits outside the shader-producing builder and can see/override its facing
  // uniform on the avatar that is built a few lines later by game.js.
  const originalRenderProfileToCanvas = preview.renderProfileToCanvas;
  preview.renderProfileToCanvas = async function fineHoodNeckFacingRenderProfileToCanvas(...args) {
    const result = await originalRenderProfileToCanvas.apply(this, args);
    installBuildCorrection();
    return result;
  };

  global.HobunjiFineHoodTrimHeadFacing = Object.freeze({
    getDebug() {
      return {
        correctedBuilds,
        correctedMeshes,
        lastFacingDot,
        facingSource: 'neck-bone',
      };
    },
  });
})(window);
