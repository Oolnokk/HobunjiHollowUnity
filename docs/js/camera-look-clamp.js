(() => {
  'use strict';

  const DEFAULT_DOWN_CLAMP_DEG = 45;

  function clampPitchOffsetDeg(value, controlsConfig = {}) {
    const cfg = controlsConfig || {};
    const downClampDeg = Number.isFinite(Number(cfg.cameraRotateClampDeg)) ? Math.abs(Number(cfg.cameraRotateClampDeg)) : DEFAULT_DOWN_CLAMP_DEG;
    const upClampDeg = downClampDeg; // Keep the maximum upward and downward look angles exactly symmetric.
    const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    return Math.max(-upClampDeg, Math.min(downClampDeg, numericValue));
  }

  window.CameraLookClamp = {
    clampPitchOffsetDeg,
    defaults: Object.freeze({ downDeg: DEFAULT_DOWN_CLAMP_DEG, upDeg: DEFAULT_DOWN_CLAMP_DEG }),
  };

  // Kurraya reuses the ordinary gameplay camera rather than owning a staged
  // music camera.  This bridge is intentionally housed beside the shared
  // camera clamp: it captures existing public module init seams instead of
  // reaching back into game.js's private camera variables.  Fishing already
  // receives the authoritative camera getters/setters, while ActionArcUI
  // receives the Character View state/setter.  Capturing those two injected
  // bags keeps this integration compatible with the current modular owners.
  let cameraDeps = null; // Captured from Fishing.init; used to read/write the live gameplay camera while Kurraya is active.
  let characterViewDeps = null; // Captured from ActionArcUI.init; used to enter/restore Character View for a performance.
  let previousMusicCamera = null; // Snapshot restored when the visible Kurraya performance closes.
  let lastMusicLook = { x: 0, y: 0, active: false }; // Mobile-visible/debug snapshot of the most recent controller camera input.
  let controllerUnsubscribe = null; // Shared ControllerInput subscription used only for Kurraya right-stick camera look.

  const CONTROLLER_LOOK_SENSITIVITY_STORAGE_KEY = 'scratchbones.controllerLookSensitivity.v1';
  const CONTROLLER_INVERT_Y_STORAGE_KEY = 'scratchbones.controllerInvertY.v1';

  function clamp(value, min, max) {
    const numeric = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(numeric) ? numeric : 0));
  }

  function wrapDegrees(value) {
    let result = Number(value) || 0;
    while (result > 180) result -= 360;
    while (result <= -180) result += 360;
    return result;
  }

  function cameraControlsConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.desktopControls || {};
  }

  function controllerInputConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.input || {};
  }

  function captureInit(api, marker, capture) {
    if (!api?.init || api.init[marker]) return;
    const original = api.init;
    const wrapped = function capturedInit(injectedDeps) {
      capture(injectedDeps || null);
      return original.call(this, injectedDeps);
    };
    Object.defineProperty(wrapped, marker, { value: true });
    api.init = wrapped;
  }

  function beginKurrayaCamera() {
    if (!cameraDeps || !characterViewDeps) {
      window.__farmLog?.('[kurraya-camera] camera integration dependencies are unavailable', 'warn');
      return;
    }
    if (!previousMusicCamera) {
      previousMusicCamera = {
        mode: cameraDeps.getCameraMode?.() ?? null,
        target: cameraDeps.getCameraTarget?.() ?? null,
        characterView: !!characterViewDeps.characterViewMode?.enabled,
      };
    }
    cameraDeps.setCameraTarget?.(null);
    characterViewDeps.setCharacterViewMode?.(true, 'kurraya');
    window.ShoulderCamPointerLock?.request?.();
    window.__farmLog?.('[kurraya-camera] using Character View gameplay camera', 'input');
  }

  function endKurrayaCamera() {
    const previous = previousMusicCamera;
    previousMusicCamera = null;
    lastMusicLook = { x: 0, y: 0, active: false };
    if (!previous) return;
    characterViewDeps?.setCharacterViewMode?.(previous.characterView, 'kurraya-ended');
    cameraDeps?.setCameraMode?.(previous.mode);
    cameraDeps?.setCameraTarget?.(previous.target);
    window.__farmLog?.('[kurraya-camera] restored pre-performance camera', 'input');
  }

  function installMusicInitBridge(api) {
    if (!api?.init || api.init.__kurrayaGameplayCameraWrapped) return;
    const original = api.init;
    const wrapped = function kurrayaCameraMusicInit(injectedDeps) {
      const patchedDeps = {
        ...(injectedDeps || {}),
        beginMusicCamera: beginKurrayaCamera,
        endMusicCamera: endKurrayaCamera,
      };
      return original.call(this, patchedDeps);
    };
    Object.defineProperty(wrapped, '__kurrayaGameplayCameraWrapped', { value: true });
    api.init = wrapped;
  }

  // Settings writes these keys; re-read at most twice a second instead of
  // touching localStorage on every controller frame of a performance.
  let lookPrefs = null;
  let lookPrefsAt = -Infinity;
  function controllerLookPrefs() {
    const now = window.performance?.now?.() ?? 0;
    if (!lookPrefs || now - lookPrefsAt > 500) {
      lookPrefs = {
        sensitivity: clamp(Number(localStorage.getItem(CONTROLLER_LOOK_SENSITIVITY_STORAGE_KEY)) || 1, 0.5, 2),
        invertY: localStorage.getItem(CONTROLLER_INVERT_Y_STORAGE_KEY) === '1',
      };
      lookPrefsAt = now;
    }
    return lookPrefs;
  }

  function applyKurrayaControllerLook(frame) {
    if (!window.MusicMinigame?.state?.active || !cameraDeps || !characterViewDeps?.characterViewMode?.enabled) {
      if (lastMusicLook.active) lastMusicLook = { x: 0, y: 0, active: false };
      return;
    }
    const pad = frame?.pad;
    if (!pad) {
      lastMusicLook = { x: 0, y: 0, active: false };
      return;
    }
    const inputCfg = controllerInputConfig();
    const deadzone = Number.isFinite(Number(inputCfg.deadzone)) ? Number(inputCfg.deadzone) : 0.24;
    const response = Number(inputCfg.controllerLookResponse) || 1.45;
    const look = window.ControllerInput?.normalizeStick?.(pad.axes?.[2], pad.axes?.[3], deadzone, response) || { x: 0, y: 0, magnitude: 0 };
    if ((look.magnitude ?? Math.hypot(look.x || 0, look.y || 0)) <= 0.001) {
      lastMusicLook = { x: 0, y: 0, active: false };
      return;
    }

    const current = cameraDeps.getCameraOrientationOffsets?.() || { azimuthDeg: 0, angleDeg: 0 };
    const { sensitivity, invertY } = controllerLookPrefs();
    const turnRate = Number(inputCfg.controllerLookDegPerSec) || 190;
    const verticalScale = Number(inputCfg.controllerLookVerticalScale) || 0.8;
    const dt = clamp(frame?.dt || (1 / 60), 0, 0.05);
    const pitchDirection = invertY ? -1 : 1;
    const azimuthDeg = wrapDegrees((Number(current.azimuthDeg) || 0) - (Number(look.x) || 0) * turnRate * sensitivity * dt);
    const angleDeg = clampPitchOffsetDeg(
      (Number(current.angleDeg) || 0) + (Number(look.y) || 0) * pitchDirection * turnRate * sensitivity * verticalScale * dt,
      cameraControlsConfig(),
    );
    cameraDeps.setCameraOrientationOffsets?.({ azimuthDeg, angleDeg });
    lastMusicLook = { x: Number(look.x) || 0, y: Number(look.y) || 0, active: true };
  }

  function installKurrayaCameraBridge() {
    captureInit(window.Fishing, '__kurrayaCameraDepsCapture', value => { cameraDeps = value; });
    captureInit(window.ActionArcUI, '__kurrayaCharacterViewDepsCapture', value => { characterViewDeps = value; });
    installMusicInitBridge(window.MusicMinigame);
    if (!controllerUnsubscribe && window.ControllerInput?.subscribe) {
      const priority = (Number(window.ControllerInput.PRIORITY?.music) || 40) + 1;
      controllerUnsubscribe = window.ControllerInput.subscribe('kurraya-camera-look', applyKurrayaControllerLook, priority);
    }
  }

  installKurrayaCameraBridge();

  window.KurrayaCameraRuntime = Object.freeze({
    getDebug: () => ({
      active: !!window.MusicMinigame?.state?.active,
      cameraDepsReady: !!cameraDeps,
      characterViewDepsReady: !!characterViewDeps,
      characterView: !!characterViewDeps?.characterViewMode?.enabled,
      previousCamera: previousMusicCamera ? { ...previousMusicCamera } : null,
      controllerLook: { ...lastMusicLook },
    }),
    begin: beginKurrayaCamera,
    end: endKurrayaCamera,
  });

  // The Random Test Ruin parser-time bootstrap that used to live here now lives in
  // js/dev-random-ruin-bootstrap.js (loaded right after this file, dev mode only).
})();
