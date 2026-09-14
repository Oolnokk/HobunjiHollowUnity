(() => {
  'use strict';

  const DEFAULT_DOWN_CLAMP_DEG = 45;
  const DEFAULT_UP_CLAMP_DEG = 85;

  function clampPitchOffsetDeg(value, controlsConfig = {}) {
    const cfg = controlsConfig || {};
    const downClampDeg = Number.isFinite(Number(cfg.cameraRotateClampDeg)) ? Math.abs(Number(cfg.cameraRotateClampDeg)) : DEFAULT_DOWN_CLAMP_DEG;
    const upClampDeg = Number.isFinite(Number(cfg.cameraRotateUpClampDeg)) ? Math.abs(Number(cfg.cameraRotateUpClampDeg)) : DEFAULT_UP_CLAMP_DEG;
    const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    return Math.max(-upClampDeg, Math.min(downClampDeg, numericValue));
  }

  window.CameraLookClamp = {
    clampPitchOffsetDeg,
    defaults: Object.freeze({ downDeg: DEFAULT_DOWN_CLAMP_DEG, upDeg: DEFAULT_UP_CLAMP_DEG }),
  };

  // Parser-time dev-playtest bootstrap. Hit-driven puzzle logic loads before
  // the structural/base ruin adapters because it must publish mechanism signal
  // proxies before the adapter resolves moving geometry. Motion/egress integration
  // loads after the base adapter so it can carry riders and repair missing recovery
  // access against the final V50 scene graph. Wall rendering is transferred into
  // the parent game's THREE realm while retaining V50 geometry/transforms, and the
  // final interaction bridge converts DEV RUIN prompts to normal world input lists.
  if (document.readyState === 'loading') {
    document.write('<script src="js/dynamic-surfaces.js?v=20260914v50interactions1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-hit-puzzles-loader.js?v=20260914v50interactions1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-prototype-hooks.js?v=20260914v50interactions1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-interior-map.js?v=20260914v50interactions1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-wall-planes.js?v=20260914v50interactions1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-wall-render-proxy.js?v=20260914v50interactions1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-motion-runtime.js?v=20260914v50interactions1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-interactions.js?v=20260914v50interactions1"></scr' + 'ipt>');
    document.write('<script src="js/dev-random-ruin-runtime-coverage.js?v=20260914v50interactions1"></scr' + 'ipt>');
  }
})();
