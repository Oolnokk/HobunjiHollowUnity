#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Runs the actual move-height functions without booting a WebGL world.
const fs = require('node:fs'); // Reads production game and elevation modules, not duplicate test implementations.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Checks normal movement, NPC footing and water behavior.
const jump = fs.readFileSync('docs/js/player-jump.js', 'utf8'); // Checks jump launch and landing physics.
const walkable = fs.readFileSync('docs/js/town-player-body-elevation-bridge.js', 'utf8'); // Checks real porch top selection and render-bridge removal.

function extract(source, start, end) {
  const first = source.indexOf(start); // Bounds the original shipping function used by each behavior test.
  const last = source.indexOf(end, first + start.length);
  assert(first >= 0 && last > first, 'missing production function: ' + start);
  return source.slice(first, last);
}

const topForExtensionCell = new Function('finite',
  extract(walkable, '  function topForExtensionCell(', '  function registerPiecePorches(') +
  '\nreturn topForExtensionCell;')((v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback);
const cell = { x: 1, y: 2 }; // Same source tile can contain a roof, a porch deck and a stair riser.
const face = (extensionFace, h) => ({
  extensionType: 'porch', sourceTile: cell, extensionFace,
  v: [[0, h, 0], [1, h, 0], [1, h, 1], [0, h, 1]],
});
const piece = { tileSize: 1, base: { groundY: 0, faces: [
  face('top', 0.18), face('tunnelCeiling', 1.29), face('north', 0.85),
] } }; // The old max-any-face algorithm selected the tunnel ceiling instead of the deck.
assert.equal(topForExtensionCell(piece, cell, 'porch'), 0.18, 'porch walk height comes from its tread, not the ceiling');
assert.equal(topForExtensionCell({ tileSize: 1, base: { groundY: 0, faces: [] } }, cell, 'porch'), 0.18,
  'legacy porch without explicit faces keeps the authored default');

const sampleActiveSurface = new Function('currentArea', '_isZoneArea', 'farmSurfaceYAtWorld',
  'surfaceYAtWorld', 'window', 'tileSurfaceYInArea',
  extract(game, '      function activeSurfaceYAtWorld(', '      function drawWeaponTrailEffects(') +
  '\nreturn activeSurfaceYAtWorld;')(
  'town', () => false, () => 0.2, () => 0.9,
  {
    GridTileAccessors: { getActiveGrid: () => [[{ type: 'grass' }]] },
    HobunjiTownSubtleElevation: { sampleHeightAt: () => 0.37 },
  },
  () => 0.1,
);
assert.equal(sampleActiveSurface(0.5, 0.5), 0.47, 'town standing ground includes smooth authored visual terrain, once');

const npcGround = new Function('npcGridForArea', 'farmSurfaceYAtWorld', '_isZoneArea',
  'surfaceYAtWorld', 'tileSurfaceYInArea', 'window',
  extract(game, '      function npcSurfaceY(', '      function resolveNpcSpawnPosition(') +
  '\nreturn npcSurfaceY;')(
  () => [[{ type: 'grass' }]], () => 0.2, () => false, () => 0.9, () => 0.1,
  {
    HobunjiTownSubtleElevation: { sampleHeightAt: () => 0.23 },
    HobunjiWalkableElevation: { worldSurfaceTopAt: (_x, _z, baseY) => Math.max(baseY, 0.55) },
  },
);
assert.equal(npcGround('town', 0, 0), 0.55, 'NPCs stand on absolute bridge/porch top, not base plus a relative lift');
assert.equal(npcGround('farm', 0, 0), 0.55, "a supported farm NPC also uses the surface's true top");

const physicalJumpGround = new Function('deps', 'window', 'tileAt',
  extract(jump, '  function groundAt(', '  function coverAtTile(') + '\nreturn groundAt;')(
  {
    TILE: 64, isSolid: () => false, getCurrentArea: () => 'town',
    worldSurfaceY: () => 0.37, tileSurfaceYInArea: () => 0.1,
  },
  {
    AreaFootprintBlockers: { surfaceYAt: () => null },
    HobunjiWalkableElevation: { worldSurfaceTopAt: (_x, _z, baseY) => Math.max(baseY, 0.55) },
  },
  () => ({ type: 'grass', incline: false, mapBoundary: false }),
);
assert.equal(physicalJumpGround(2.5, 5.5), 0.55, 'a jump starts and lands on the same raised walking surface');
const flatJumpGround = new Function('deps', 'window', 'tileAt',
  extract(jump, '  function groundAt(', '  function coverAtTile(') + '\nreturn groundAt;')(
  { TILE: 64, isSolid: () => false, getCurrentArea: () => 'town', worldSurfaceY: () => 0.37 },
  { AreaFootprintBlockers: { surfaceYAt: () => null } },
  () => ({ type: 'grass' }),
);
assert.equal(flatJumpGround(2.5, 5.5), 0.37, 'without raised furniture the jump uses continuous terrain rather than a flat tile');
assert.match(game, /const physicalSurfaceY = physicalGroundOwnedByWalk[\s\S]{0,230}worldSurfaceTopAt/,
  'ordinary walking resolves a physical support, not a render-only Y translation');
assert.match(game, /player\.physicalFeetY = physicalSurfaceY/,
  'grounded walkers report their real physical foot height to downstream systems');
assert.match(game, /const onBridge = !projectile && !!window\.HobunjiWalkableElevation\?\.supportAt/,
  'the stream below a real bridge does not slow grounded walkers to swimming speed');
assert.match(game, /!stoodOnRaisedSupport && tile\.water > 0\.05/,
  'water under a bridge does not visually lift the player above its deck');
assert.match(game, /isPlayerInWater:[\s\S]{0,200}!window\.HobunjiWalkableElevation\?\.supportAt/,
  'water under a bridge does not extinguish the person on top');
assert.match(walkable, /composer\.clearChannel\(CHANNEL\);[\s\S]{0,80}lastDebug =/,
  'the old player render-only elevation channel is cleared after physical grounding takes ownership');

console.log('physical walkable surfaces: actual porch tops, walking, NPC grounding, jumps and bridges passed');
