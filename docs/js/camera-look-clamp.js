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

  // Parser-time dev-playtest bootstrap. Hit-driven puzzle logic loads before
  // the structural/base ruin adapters because it must publish mechanism signal
  // proxies and suppress their legacy Interact shortcuts before those adapters
  // poll keyboard/controller input. Prototype hooks still own only the extra
  // structural interactions (ladders/transit doors), and the base adapter owns
  // the actual V50 map lifecycle and animated mechanism presentation.
  if (document.readyState === 'loading') {
    document.write('<script src="js/dynamic-surfaces.js?v=20260913v50hits1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-hit-puzzles-loader.js?v=20260913v50hits1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-prototype-hooks.js?v=20260913v50hits1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-interior-map.js?v=20260913v50hits1"></scr' + 'ipt>');
  }
})();
