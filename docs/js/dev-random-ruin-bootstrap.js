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
  document.write('<script src="js/projectile-cover-pixel-probe.js?v=20261015semanticprobe1"></scr' + 'ipt>'); // One-shot Pixel Probe adapter: ray-tests semantic projectile-cover volumes even when they have no mesh/material.
  document.write('<script src="js/ruin-footprint-pixel-probe.js?v=20261015ruinfootprintprobe1"></scr' + 'ipt>'); // One-shot Pixel Probe adapter: ray-tests the exact oriented ruin footprints used by movement/projectile occupancy.
  document.write('<script src="js/dynamic-surfaces.js?v=20260914v50wallsinputs1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-config.js?v=20260929config1"></scr' + 'ipt>'); // docs/config/random-ruin/ruin-config.json loader, read by every ruin module below.
  if (!window.FurnitureDecalRuntime) document.write('<script src="js/furniture-decal-runtime.js?v=20261003h3fbafdb"></scr' + 'ipt>'); // Authored decals + state glow (usually already loaded by zone features).
  document.write('<script src="js/dev-random-ruin-furniture-pieces.js?v=20261015h7327f5e"></scr' + 'ipt>'); // Door seals, glyph plaques, Great Door as authored furniture.
  document.write('<script src="js/dev-random-ruin-hit-puzzles.js?v=20261015h65cbbc1"></scr' + 'ipt>'); // Plain source (formerly nine base64 part files reassembled with eval).
  document.write('<script src="js/dev-random-ruin-prototype-hooks.js?v=20261018badge1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-solid-footprints.js?v=20261031hcefb03e"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-tile-occupancy.js?v=20261031hb8f20da"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-solvability.js?v=20260926lighting1"></scr' + 'ipt>');
  document.write('<script src="js/live-root-network.js?v=1"></scr' + 'ipt>');
  document.write('<script src="js/live-root-growth.js?v=20261031snare-guide1"></scr' + 'ipt>');
  document.write('<script src="js/live-root-mechanisms.js?v=20261031he2e77bc"></scr' + 'ipt>');
  document.write('<script src="js/stone-age-ruin-scenery.js?v=20261031snare-cover2"></scr' + 'ipt>'); // Same quarry floor, wall rockification and Temple vegetation as the author preview.
  document.write('<script src="js/dev-random-ruin-interior-map.js?v=20261031stoneworld5"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-wall-planes.js?v=20260927geometry1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-wall-render-proxy.js?v=20260930plaquesources1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-collision-precision.js?v=20260927geometry1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-motion-runtime.js?v=20261031hcccaf2d"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-dungeon-chests.js?v=20261025hbronzechest1"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-ceiling-target-visuals.js?v=20261018targethum1"></scr' + 'ipt>'); // Reused, connected stone block + four glowing decals, for fixed and moving overhead targets.
  document.write('<script src="js/dev-random-ruin-simple-puzzles.js?v=20261019h50eef9d"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-rope-rewards.js?v=20261016hd25cc1c"></scr' + 'ipt>'); // Registers rope payoffs + lava basins as a simple-puzzle composer.
  document.write('<script src="js/dev-random-ruin-rope-variants.js?v=20261016ropevariants1"></scr' + 'ipt>'); // Pump-to-height and rope-to-rope standalone rope rooms.
  document.write('<script src="js/dev-random-ruin-rail-targets.js?v=20261018sconceaudit2"></scr' + 'ipt>'); // Ceiling-rail projectile targets that emerge from the walls while the player is in their room.
  document.write('<script src="js/dev-random-ruin-target-hum.js?v=20261018targethum1"></scr' + 'ipt>'); // Proximity hum on every unstruck projectile target.
  document.write('<script src="js/dev-random-ruin-sanctum.js?v=20261028h51438dd"></scr' + 'ipt>'); // Braziers, Great Door, boss sanctum + vault (simple-puzzle composer).
  document.write('<script src="js/dev-random-ruin-lich-themes.js?v=20261028h2980b7d"></scr' + 'ipt>'); // Lich-specific floor/wall illumination and disposable ruin hazard composer.
  document.write('<script src="js/dev-random-ruin-interactions.js?v=20261016h0a192e6"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-glyph-circuits.js?v=20261015h1fb070c"></scr' + 'ipt>');
  document.write('<script src="js/dev-random-ruin-runtime-coverage.js?v=20261018badge1"></scr' + 'ipt>');
})();
