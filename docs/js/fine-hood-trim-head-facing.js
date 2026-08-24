// Corrects Fine Hood's head-on-only visibility after the portrait has been neck-rigged.
//
// The Fine Hood trim is authored as a distinct `layerRole: "trim"`, but portrait
// compositing flattens it into the same front texture as the rest of the hood/head.
// npc-avatar-preview-utils therefore builds a matched trimless texture.
//
// Two different motions need two different rules:
//   1) Camera orbit / head yaw uses an exact hard 90-degree front/back handoff.
//      That switch happens while the portrait is edge-on, so there is no visible
//      fade or pop while orbiting around an otherwise upright character.
//   2) Attack/body pitch and roll can make this flat face-opening overlay visibly
//      intersect the head well BEFORE the yaw boundary. A separate hard upright
//      safety gate removes the trim once the rigged head tilts more than 35 deg.
//
// Both gates are binary. There is never a smooth/faded visibility transition.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const preview = global.NpcAvatarPreview;
  const avatarApi = global.PNGPlaneAvatar;
  if (!THREE || !preview?.renderProfileToCanvas || !avatarApi?.buildSinglePlaneAvatarModel) return;

  const TILT_CUTOFF_DEG = 35;
  const TILT_CUTOFF_DOT = Math.cos(TILT_CUTOFF_DEG * Math.PI / 180);

  let correctedBuilds = 0;
  let correctedMeshes = 0;
  let lastFacingDot = null;
  let lastYawDot = null;
  let lastUprightDot = null;

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
        const localUp = new THREE.Vector3(0, 1, 0);
        const worldFront = new THREE.Vector3();
        const worldUp = new THREE.Vector3();
        const headWorld = new THREE.Vector3();
        const cameraWorld = new THREE.Vector3();
        const toCamera = new THREE.Vector3();
        const horizontalFront = new THREE.Vector3();
        const horizontalToCamera = new THREE.Vector3();
        const worldVertical = new THREE.Vector3(0, 1, 0);

        object.onBeforeRender = function fineHoodNeckFacingBeforeRender(renderer, scene, camera, geometry, material, group) {
          previousOnBeforeRender?.call(this, renderer, scene, camera, geometry, material, group);
          const uniform = material?.userData?.hobunjiFineHoodTrimHeadOnFacingUniform;
          if (!uniform || !camera) return;

          // The bone matrix includes both the composed body transform and the
          // live neck turn, i.e. the actual basis driving head-weighted pixels.
          neckJoint.updateWorldMatrix?.(true, false);
          worldFront.copy(localFront).transformDirection(neckJoint.matrixWorld).normalize();
          worldUp.copy(localUp).transformDirection(neckJoint.matrixWorld).normalize();
          neckJoint.getWorldPosition(headWorld);
          camera.getWorldPosition(cameraWorld);
          toCamera.copy(cameraWorld).sub(headWorld).normalize();

          // Yaw/front-back gate: project both vectors to the ground plane so
          // pitch/roll do not move the orbit handoff away from exactly 90 deg.
          horizontalFront.set(worldFront.x, 0, worldFront.z);
          horizontalToCamera.set(toCamera.x, 0, toCamera.z);
          const horizontalFrontLenSq = horizontalFront.lengthSq();
          const horizontalCameraLenSq = horizontalToCamera.lengthSq();
          let yawDot = worldFront.dot(toCamera);
          if (horizontalFrontLenSq > 1e-8 && horizontalCameraLenSq > 1e-8) {
            horizontalFront.multiplyScalar(1 / Math.sqrt(horizontalFrontLenSq));
            horizontalToCamera.multiplyScalar(1 / Math.sqrt(horizontalCameraLenSq));
            yawDot = horizontalFront.dot(horizontalToCamera);
          }

          // Attack/body safety gate: yaw does not change the head's world-up
          // alignment, but pitch/roll does. The previous build that hid by ~35
          // degrees proved sufficient to stop the trim intersecting the head;
          // retain that protection only for actual rig tilt, not camera orbit.
          const uprightDot = worldUp.dot(worldVertical);
          const visible = yawDot > 0 && uprightDot >= TILT_CUTOFF_DOT;

          // npc-avatar-preview-utils still owns the full-vs-trimless texture
          // blend. Feeding it only 0/1 makes that blend a true hard switch.
          uniform.value = visible ? 1 : 0;
          lastFacingDot = worldFront.dot(toCamera);
          lastYawDot = yawDot;
          lastUprightDot = uprightDot;
          material.userData.hobunjiFineHoodTrimLastFacingDot = lastFacingDot;
          material.userData.hobunjiFineHoodTrimLastYawDot = yawDot;
          material.userData.hobunjiFineHoodTrimLastUprightDot = uprightDot;
          material.userData.hobunjiFineHoodTrimFacingSource = 'neck-bone-hard90-yaw-plus-tilt-guard';
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
          yawCutoffDot: 0,
          yawCutoffDegrees: 90,
          tiltCutoffDot: TILT_CUTOFF_DOT,
          tiltCutoffDegrees: TILT_CUTOFF_DEG,
          transition: 'hard-step',
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
  // sits outside the shader-producing builder and can override its visibility
  // uniform on the avatar that game.js builds next.
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
        lastYawDot,
        lastUprightDot,
        yawCutoffDot: 0,
        yawCutoffDegrees: 90,
        tiltCutoffDot: TILT_CUTOFF_DOT,
        tiltCutoffDegrees: TILT_CUTOFF_DEG,
        transition: 'hard-step',
        facingSource: 'neck-bone',
      };
    },
  });
})(window);
