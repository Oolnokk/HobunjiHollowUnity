// Character-creator composition: exact 10° resting turn and a Mao'ao-mid-body camera eye line.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingCharacterCreationCameraComposition'; // Prevents duplicate renderer wrapping from cache/reloads.
  if (window[PATCH_ID]) return;

  const PREVIEW_ROOT_NAME = 'OnboardingCharacterPreviewRoot'; // Unique scene node created by the 3D onboarding redesign.
  const LIFE_PATCH_ID = 'hobunjiOnboardingCharacterCreationLifePreview'; // Exposes the current avatar model for face-view anchoring.
  const TARGET_PREVIEW_YAW_DEG = 10; // Turns the resting preview five degrees back from the earlier +15° composition.
  const MAO_AO_BASE_MODEL_HEIGHT = 0.9; // Runtime PNG-plane fallback width/height used by the creator when config is unavailable.
  const MAO_AO_MALE_RUNTIME_Y = 1.125; // Canonical Full Character Scale Y for Mao'ao male; used only as a fallback.
  const FACE_NECK_OFFSET = 0.13; // Matches the existing species-aware face-view center above the neck joint.

  const yawOffsets = new WeakMap(); // Stores only the delta needed to turn each preview root from its existing default to exactly +10°.
  let rendererWrapped = false; // Diagnostic state for the onboarding-only WebGLRenderer hook.

  function deg(value) {
    return Number(value) * Math.PI / 180;
  }

  function life() {
    return window[LIFE_PATCH_ID]?.life || null;
  }

  function maoAoMidBodyY() {
    const configuredHeight = Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth);
    const baseHeight = configuredHeight > 0 ? configuredHeight : MAO_AO_BASE_MODEL_HEIGHT;
    const scale = window.HobunjiCharacterRigScale?.scaleFor?.('mao-ao', 'male')
      || window.HobunjiCharacterRigScaleDefaults?.scaleFor?.('mao-ao', 'male')
      || { y: MAO_AO_MALE_RUNTIME_Y };
    return baseHeight * (Number(scale.y) || MAO_AO_MALE_RUNTIME_Y) * 0.5;
  }

  function yawOffsetFor(root) {
    if (!root?.rotation) return 0;
    if (!yawOffsets.has(root)) {
      // Preserve drag behavior: the redesign still owns root.rotation.y; this patch
      // adds only the fixed delta required to make its first/resting view exactly +10°.
      yawOffsets.set(root, deg(TARGET_PREVIEW_YAW_DEG) - Number(root.rotation.y || 0));
    }
    return yawOffsets.get(root) || 0;
  }

  function applyCamera(camera) {
    if (!camera?.position || typeof camera.lookAt !== 'function') return;
    const midY = maoAoMidBodyY();
    camera.position.set(1.55, midY, 2.75);
    camera.lookAt(0, midY, 0); // Eye and target share Y: no residual top-down angle.
    camera.updateMatrixWorld?.(true);
  }

  function installRendererHook() {
    const THREE = window.THREE;
    const proto = THREE?.WebGLRenderer?.prototype;
    if (!proto?.render || proto.render.__hobunjiCreatorMidBodyCamera) return !!proto?.render;

    const originalRender = proto.render;
    const wrapped = function onboardingMidBodyCameraRender(scene, camera, ...rest) {
      const root = scene?.getObjectByName?.(PREVIEW_ROOT_NAME) || null;
      if (!root || !camera?.isCamera) return originalRender.call(this, scene, camera, ...rest);

      const savedRootYaw = Number(root.rotation.y || 0);
      const savedPosition = camera.position.clone();
      const savedQuaternion = camera.quaternion.clone();
      root.rotation.y = savedRootYaw + yawOffsetFor(root);
      root.updateMatrixWorld?.(true);
      applyCamera(camera);

      try {
        return originalRender.call(this, scene, camera, ...rest);
      } finally {
        root.rotation.y = savedRootYaw;
        root.updateMatrixWorld?.(true);
        camera.position.copy(savedPosition);
        camera.quaternion.copy(savedQuaternion);
        camera.updateMatrixWorld?.(true);
      }
    };
    wrapped.__hobunjiCreatorMidBodyCamera = true;
    proto.render = wrapped;
    rendererWrapped = true;
    return true;
  }

  function faceWorldAnchor(THREE, model) {
    if (!model?.parent) return null;
    const neck = model.userData?.neckRig?.neckJoint || null;
    const modelHeight = Math.max(0.1, Number(model.userData?.portraitModelHeight) || MAO_AO_BASE_MODEL_HEIGHT);
    const avatarGroup = model.parent;
    const worldScale = avatarGroup.getWorldScale?.(new THREE.Vector3()) || new THREE.Vector3(1, 1, 1);
    if (neck?.getWorldPosition) {
      const anchor = neck.getWorldPosition(new THREE.Vector3());
      anchor.y += modelHeight * Math.abs(Number(worldScale.y) || 1) * FACE_NECK_OFFSET;
      return anchor;
    }
    return avatarGroup.localToWorld(new THREE.Vector3(0, modelHeight * 0.80, 0));
  }

  function syncFaceViewOrigin() {
    const currentLife = life();
    if (currentLife?.viewMode !== 'face' || !currentLife.model?.parent) return;
    const shell = document.querySelector('#ob-overlay .ob-3d-shell');
    const canvas = shell?.querySelector('.ob-3d-canvas');
    const THREE = window.THREE;
    if (!shell || !canvas || !THREE?.PerspectiveCamera) return;

    const model = currentLife.model;
    const root = model.parent?.parent;
    const savedYaw = root?.rotation ? Number(root.rotation.y || 0) : 0;
    if (root?.rotation) {
      root.rotation.y = savedYaw + yawOffsetFor(root);
      root.updateMatrixWorld?.(true);
    }
    model.updateWorldMatrix?.(true, true);
    const anchor = faceWorldAnchor(THREE, model);
    if (root?.rotation) {
      root.rotation.y = savedYaw;
      root.updateMatrixWorld?.(true);
    }
    if (!anchor) return;

    const width = Math.max(1, shell.clientWidth || 220);
    const height = Math.max(1, shell.clientHeight || 300);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 100);
    applyCamera(camera);
    camera.updateProjectionMatrix();
    const projected = anchor.project(camera);
    const x = Math.max(18, Math.min(82, (projected.x * 0.5 + 0.5) * 100));
    const y = Math.max(10, Math.min(72, (1 - (projected.y * 0.5 + 0.5)) * 100));
    canvas.style.setProperty('transform-origin', `${x.toFixed(2)}% ${y.toFixed(2)}%`, 'important');
  }

  function frame() {
    installRendererHook();
    syncFaceViewOrigin(); // Runs after the older face-view pass and keeps its crop aligned to the new lower camera.
    const status = window.HOBUNJI_ONBOARDING_REDESIGN_STATUS;
    if (status && typeof status === 'object') {
      status.previewRestYawDeg = TARGET_PREVIEW_YAW_DEG;
      status.cameraEyeBasis = "mao-ao male mid-body";
      status.cameraEyeY = maoAoMidBodyY();
      status.cameraTopDownAngle = 0;
    }
    requestAnimationFrame(frame);
  }

  window[PATCH_ID] = Object.freeze({
    targetYawDeg: TARGET_PREVIEW_YAW_DEG,
    maoAoMidBodyY,
    get rendererWrapped() { return rendererWrapped; },
  });
  requestAnimationFrame(frame);
})();
