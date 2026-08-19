// Seated head facing: split the orbit camera into two 180-degree hemispheres.
// When the camera sees the avatar's front, the head faces back toward the camera;
// when the camera sees the avatar's back, the head points with the camera instead.
(function installSeatedHeadFacing(root) {
  'use strict';
  if (!root || root.SeatedHeadFacing) return;

  const state = {
    deps: null,
    renderer: null,
    rawRender: null,
    lastHemisphere: '',
    lastSnapshot: null,
  };

  function log(message, level = 'info') {
    if (typeof root.__farmLog === 'function') root.__farmLog(`[seated-head] ${message}`, level, 'render');
    else if (level === 'warn' || level === 'error') console.warn(`[seated-head] ${message}`);
  }

  function angleDiff(target, current) {
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  // game.js uses this exact yaw convention for the player's normal head aim:
  // facing angle atan2(z,x) -> Three.js avatar yaw -angle + PI/2.
  function yawForWorldDirection(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) < 1e-6) return NaN;
    return -Math.atan2(z, x) + Math.PI / 2;
  }

  function currentNeckJoint() {
    const playerMesh = state.deps?.playerMesh;
    if (!playerMesh?.children) return null;
    const avatar = playerMesh.children.find(child => child?.name === 'player_avatar') || null;
    return avatar?.userData?.neckRig?.neckJoint || null;
  }

  function apply(camera = state.deps?.camera) {
    const deps = state.deps;
    const sit = deps?.getSitInteraction?.();
    if (!deps?.playerMesh || !deps?.player || sit?.phase !== 'active' || !camera?.getWorldDirection) {
      state.lastHemisphere = '';
      state.lastSnapshot = null;
      return false;
    }

    const neckJoint = currentNeckJoint();
    if (!neckJoint) return false;

    // getWorldDirection points the same way the camera is looking. Since the
    // seated camera targets the player, this is the camera -> character vector.
    const Vector3 = root.THREE?.Vector3;
    if (typeof Vector3 !== 'function') return false;
    const cameraForward = camera.getWorldDirection(new Vector3());
    const flatLen = Math.hypot(cameraForward.x, cameraForward.z);
    if (flatLen < 1e-6) return false;
    const viewX = cameraForward.x / flatLen;
    const viewZ = cameraForward.z / flatLen;

    // player.angle's documented world-facing vector is (cos(angle), sin(angle))
    // in X/Z. Dot < 0 means the camera looks opposite the avatar's facing and
    // therefore sees the FRONT sprite; dot >= 0 means it sees the BACK sprite.
    const facingAngle = Number.isFinite(Number(sit.targetAngle)) ? Number(sit.targetAngle) : (Number(deps.player.angle) || 0);
    const facingX = Math.cos(facingAngle);
    const facingZ = Math.sin(facingAngle);
    const facingDotCameraView = facingX * viewX + facingZ * viewZ;
    const cameraSeesFront = facingDotCameraView < 0;

    const cameraViewYaw = yawForWorldDirection(viewX, viewZ);
    if (!Number.isFinite(cameraViewYaw)) return false;
    const targetWorldYaw = cameraSeesFront ? cameraViewYaw + Math.PI : cameraViewYaw;
    neckJoint.rotation.y = angleDiff(targetWorldYaw, deps.playerMesh.rotation.y);

    const hemisphere = cameraSeesFront ? 'front' : 'back';
    state.lastSnapshot = {
      active: true,
      hemisphere,
      facingDotCameraView,
      cameraViewYaw,
      targetWorldYaw,
      bodyWorldYaw: deps.playerMesh.rotation.y,
      neckLocalYaw: neckJoint.rotation.y,
    };
    if (hemisphere !== state.lastHemisphere) {
      state.lastHemisphere = hemisphere;
      log(`camera entered ${hemisphere} 180° span; head now ${cameraSeesFront ? 'faces camera' : 'aligns with camera'}.`);
    }
    return true;
  }

  function patchRenderer(renderer) {
    if (!renderer || typeof renderer.render !== 'function') return false;
    if (renderer.render.__seatedHeadFacing) {
      state.renderer = renderer;
      return true;
    }
    const rawRender = renderer.render;
    function renderWithSeatedHeadFacing(scene, camera, ...rest) {
      if (camera === state.deps?.camera) apply(camera);
      return rawRender.call(this, scene, camera, ...rest);
    }
    renderWithSeatedHeadFacing.__seatedHeadFacing = true;
    renderWithSeatedHeadFacing.__seatedHeadFacingRaw = rawRender;
    renderer.render = renderWithSeatedHeadFacing;
    state.renderer = renderer;
    state.rawRender = rawRender;
    log('renderer hook installed; seated head now uses front/back camera hemispheres.');
    return true;
  }

  function captureDeps(injectedDeps) {
    if (!injectedDeps?.renderer || !injectedDeps?.camera || !injectedDeps?.playerMesh || typeof injectedDeps?.getSitInteraction !== 'function') {
      log('PixelProbe init did not provide the seated-head dependency set.', 'warn');
      return false;
    }
    state.deps = injectedDeps;
    patchRenderer(injectedDeps.renderer);
    return true;
  }

  function patchPixelProbe(pixelProbe) {
    if (!pixelProbe || pixelProbe.__seatedHeadFacingPatched) return pixelProbe;
    const rawInit = pixelProbe.init;
    if (typeof rawInit !== 'function') return pixelProbe;
    pixelProbe.init = function seatedHeadFacingPixelProbeInit(injectedDeps, ...rest) {
      captureDeps(injectedDeps);
      return rawInit.call(this, injectedDeps, ...rest);
    };
    pixelProbe.__seatedHeadFacingPatched = true;
    return pixelProbe;
  }

  function installGlobalInterceptor(name, patcher) {
    let current = root[name];
    if (current) {
      patcher(current);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(root, name);
    if (descriptor && !descriptor.configurable) {
      const poll = () => {
        if (root[name]) patcher(root[name]);
        else root.requestAnimationFrame?.(poll);
      };
      poll();
      return;
    }
    Object.defineProperty(root, name, {
      configurable: true,
      enumerable: true,
      get() { return current; },
      set(value) { current = patcher(value); },
    });
  }

  root.SeatedHeadFacing = Object.freeze({
    apply,
    snapshot: () => state.lastSnapshot ? { ...state.lastSnapshot } : { active: false },
    get installed() { return !!state.renderer; },
  });

  installGlobalInterceptor('PixelProbe', patchPixelProbe);
})(typeof window !== 'undefined' ? window : globalThis);
