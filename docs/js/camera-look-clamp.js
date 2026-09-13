(() => {
  'use strict';

  const DEFAULT_DOWN_CLAMP_DEG = 45;
  const DEFAULT_UP_CLAMP_DEG = 85;

  function clampPitchOffsetDeg(value, controlsConfig = {}) {
    const cfg = controlsConfig || {}; // Receives desktopControlsConfig() without depending on game.js or FormatUtils.
    const downClampDeg = Number.isFinite(Number(cfg.cameraRotateClampDeg)) ? Math.abs(Number(cfg.cameraRotateClampDeg)) : DEFAULT_DOWN_CLAMP_DEG; // Positive pitch/downward boundary.
    const upClampDeg = Number.isFinite(Number(cfg.cameraRotateUpClampDeg)) ? Math.abs(Number(cfg.cameraRotateUpClampDeg)) : DEFAULT_UP_CLAMP_DEG; // Negative pitch/upward boundary.
    const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    return Math.max(-upClampDeg, Math.min(downClampDeg, numericValue));
  }

  window.CameraLookClamp = {
    clampPitchOffsetDeg,
    defaults: Object.freeze({ downDeg: DEFAULT_DOWN_CLAMP_DEG, upDeg: DEFAULT_UP_CLAMP_DEG }),
  };

  // Parser-time dev-playtest bootstrap. camera-look-clamp.js already sits
  // immediately before the Dev Testing Switchbox and game.js in index.html;
  // loading these here keeps the animated-surface registry and Random Test
  // Ruin harness synchronous, so they can wrap THREE.WebGLRenderer and
  // DevSpawner.init before game boot creates either runtime dependency.
  // The ruin module itself remains inert unless Dev Mode's Random Test Ruin
  // button is used, and it never writes its seed/state into save storage.
  if (document.readyState === 'loading') {
    document.write('<script src="js/dynamic-surfaces.js?v=20260912ruins1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin.js?v=20260912ruins1"></scr' + 'ipt>');
  }
})();
