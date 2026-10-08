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
// Loaded for every player: wilderness ruin sites (js/ruin-sites.js) generate
// these ruins in ordinary play. Its per-render DynamicSurfaces clients return
// immediately outside the ruin map, and the V50 generator iframe is only
// booted on first entry. The Settings "Random Test Ruin" controls still
// require Dev Mode (see installSettingsButton in the interior-map module).
(() => {
  'use strict';
  if (document.readyState !== 'loading') return;
  document.write('<script src="js/dynamic-surfaces.js?v=20260914v50wallsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-config.js?v=20260929config1"></scr' + 'ipt>'); // docs/config/random-ruin/ruin-config.json loader, read by every ruin module below.
  if (!window.FurnitureDecalRuntime) document.write('<script src="js/furniture-decal-runtime.js?v=20261003h3fbafdb"></scr' + 'ipt>'); // Authored decals + state glow (usually already loaded by zone features).
  document.write('<script src="js/dev-random-ruin-furniture-pieces.js?v=20260929ruinpieces1"></scr' + 'ipt>'); // Door seals, glyph plaques, Great Door as authored furniture.
  document.write('<script src="js/dev-random-ruin-hit-puzzles.js?v=20261002h5ed97f5"></scr' + 'ipt>'); // Plain source (formerly nine base64 part files reassembled with eval).
  document.write('<script src="js/dev-random-ruin-prototype-hooks.js?v=20260927interiorparity1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-solid-footprints.js?v=20260928puzzles2"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-tile-occupancy.js?v=20260928puzzles2"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-solvability.js?v=20260926lighting1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-interior-map.js?v=20261003h640f664"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-wall-planes.js?v=20260927geometry1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-wall-render-proxy.js?v=20260930plaquesources1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-collision-precision.js?v=20260927geometry1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-motion-runtime.js?v=20260926animperf2"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-dungeon-chests.js?v=20261007h1df310c"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-simple-puzzles.js?v=20261002h23cd191"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-rope-rewards.js?v=20260929ruinpieces1"></scr' + 'ipt>'); // Registers rope payoffs + lava basins as a simple-puzzle composer.
  document.write('<script src="js/dev-random-ruin-sanctum.js?v=20261003hefbd8d7"></scr' + 'ipt>'); // Braziers, Great Door, boss sanctum + vault (simple-puzzle composer).
  document.write('<script src="js/dev-random-ruin-interactions.js?v=20261001cadfd96e"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-glyph-circuits.js?v=20260929glowdecals1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-runtime-coverage.js?v=20260923review1"></scr' + 'ipt>');
})();
