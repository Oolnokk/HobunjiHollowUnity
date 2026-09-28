// Parser-time bootstrap for the dev-only Random Test Ruin runtime (moved out of
// js/camera-look-clamp.js). Hit-driven puzzle logic loads before the
// structural/base ruin adapters because it must publish mechanism signal
// proxies before the adapter resolves moving geometry. Motion/egress
// integration loads after the base adapter so it can carry riders and repair
// missing recovery access against the final V50 scene graph. Embedded V50 now
// constructs directly with parent.THREE, so its source geometry renders in the
// game scene without a duplicate proxy graph; semantic interaction bridging names ladder parts and
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
  document.write('<script src="js/dev-random-ruin-hit-puzzles.js?v=20260927glyphs1"></scr' + 'ipt>'); // Plain source (formerly nine base64 part files reassembled with eval).
  document.write('<script src="js/dev-random-ruin-prototype-hooks.js?v=20260927interiorparity1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-solid-footprints.js?v=20260928puzzles2"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-tile-occupancy.js?v=20260928puzzles2"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-solvability.js?v=20260926lighting1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-interior-map.js?v=20260928climb1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-wall-planes.js?v=20260927geometry1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-wall-render-proxy.js?v=20260927geometry1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-collision-precision.js?v=20260927geometry1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-motion-runtime.js?v=20260926animperf2"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-dungeon-chests.js?v=20260928basins1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-simple-puzzles.js?v=20260928reticle1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-rope-rewards.js?v=20260928escape1"></scr' + 'ipt>'); // Registers rope payoffs + lava basins as a simple-puzzle composer.
  document.write('<script src="js/dev-random-ruin-interactions.js?v=20260928climb1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-glyph-circuits.js?v=20260928reticle1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-runtime-coverage.js?v=20260923review1"></scr' + 'ipt>');
})();
