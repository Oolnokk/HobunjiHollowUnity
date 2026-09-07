'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const parity = fs.readFileSync(path.join(__dirname, '../docs/js/wilderness-cliff-surface-parity.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, '../docs/js/house-pieces.js'), 'utf8');

for (const expected of [
  'buildRockFormationMeshes',
  'buildPlateauMesa',
  'buildZoneBorderTerrain',
  "natural.naturalizeMesh(mesh, 'rocks')",
  'delete geometry.userData.hobunjiSurfaceStretchSignature',
  'delete geometry.userData.hobunjiSurfaceStretch',
  'maxPatchWorldSize: WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE',
  'queueMicrotask(run)',
  "chainGlobal('ZoneTerrainFeatures', patchZoneTerrainFeatures)",
  "chainGlobal('ZonePlateauMesa', patchPlateauMesa)",
  "chainGlobal('BorderTerrain', patchBorderTerrain)",
]) assert.ok(parity.includes(expected), `missing parity contract: ${expected}`);

assert.ok(loader.includes("['WildernessCliffSurfaceParity', 'wilderness-cliff-surface-parity.js?v=20260907a']"), 'loader does not include wilderness cliff parity adapter');
assert.ok(loader.indexOf('farm-cliff-rock-outline.js?v=20260907b') < loader.indexOf('wilderness-cliff-surface-parity.js?v=20260907a'), 'wilderness parity must load after farm cliff material helper');
assert.ok(loader.indexOf('wilderness-cliff-surface-parity.js?v=20260907a') < loader.indexOf('terrain-render-chunks.js?v=20260812a'), 'wilderness parity must load before terrain chunking');

console.log('PASS wilderness cliffs rerun farm-style material + connected-surface stretch after final geometry edits.');
