// Parser-time bootstrap for the dev-only Random Test Ruin runtime (moved out of
// js/camera-look-clamp.js). Hit-driven puzzle logic loads before the
// structural/base ruin adapters because it must publish mechanism signal
// proxies before the adapter resolves moving geometry. Motion/egress
// integration loads after the base adapter so it can carry riders and repair
// missing recovery access against the final V50 scene graph. Wall rendering is
// transferred into the parent game's THREE realm and is always
// structural/visible; semantic interaction bridging names ladder parts and
// feeds all nearby ruin actions into the game's ordinary world-space
// input-list prompt workflow.
//
// Only injected when Dev Mode is on: ~4k lines of prototype code plus several
// per-render DynamicSurfaces frame clients have no reason to load for ordinary
// players. The ruin's own Settings button already requires Dev Mode at page
// load, so toggling Dev Mode takes effect on the next reload either way.
(() => {
  'use strict';
  let devMode = false;
  try { devMode = localStorage.getItem('hobunjiDevMode') === '1'; } catch (_) {}
  if (!devMode || document.readyState !== 'loading') return;
  document.write('<script src="js/dynamic-surfaces.js?v=20260914v50wallsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-hit-puzzles-loader.js?v=20260914v50wallsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-prototype-hooks.js?v=20260917v50doorsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-tile-occupancy.js?v=20260917v50doorsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-interior-map.js?v=20260917v50doorsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-wall-planes.js?v=20260923review1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-wall-render-proxy.js?v=20260917v50doorsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-collision-precision.js?v=20260917v50doorsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-motion-runtime.js?v=20260914v50wallsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-interactions.js?v=20260917v50doorsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-runtime-coverage.js?v=20260923review1"></scr' + 'ipt>');
})();
