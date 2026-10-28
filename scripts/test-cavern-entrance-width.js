'use strict';

const assert = require('node:assert/strict');
global.window = global;
require('../docs/config/cave-shape.js');
require('../docs/js/cavern-sculptor.js');
require('../docs/js/cavern-generator.js');

const config = global.HobunjiCaveShapeConfig; // User-editable entrance setting exercised by both carvings below.
const seed = 'test-cave-entrance-side-columns'; // Reuse this seed to test that changing the setting invalidates the cavern cache.
const baseColumns = Math.max(3, Math.round(3 / 0.5)); // Existing 3-unit mouth width on the game's half-unit cave grid.

try {
  assert.equal(global.CavernGenerator.caveShape().entranceOpenSideColumns, 2, 'default opens two columns on each side');
  const widened = global.CavernGenerator.generateCavernFloor(seed, { fast: true });
  const widenedFloor = new Set(widened.floor.map(tile => tile.join(','))); // Used to verify none of the added entrance cells has a collider.
  const widenedRim = new Set(widened.outerRimTiles.map(tile => tile.join(','))); // Used to catch side columns accidentally reserved as rock.
  assert.equal(widened.exitTiles.length, baseColumns + 4, 'both sides must be widened by two tiles');
  for (const tile of widened.exitTiles) {
    const key = tile.join(',');
    assert.ok(widenedFloor.has(key), 'every entrance tile must stay on the walkable floor: ' + key);
    assert.ok(!widenedRim.has(key), 'no entrance tile may also be a rock collider: ' + key);
  }

  config.entranceOpenSideColumns = 0;
  assert.equal(global.CavernGenerator.caveShape().entranceOpenSideColumns, 0, 'zero must restore the existing width');
  const original = global.CavernGenerator.generateCavernFloor(seed, { fast: true });
  assert.equal(original.exitTiles.length, baseColumns, 'configuration change must re-carve instead of returning the widened cached cave');
  assert.ok(original.exitTiles.every(tile => original.floor.some(cell => cell[0] === tile[0] && cell[1] === tile[1])), 'original entrance remains walkable');

  config.entranceOpenSideColumns = 500;
  assert.equal(global.CavernGenerator.caveShape().entranceOpenSideColumns, 8, 'unreasonably large configuration is clamped');
  config.entranceOpenSideColumns = -2;
  assert.equal(global.CavernGenerator.caveShape().entranceOpenSideColumns, 0, 'negative widths cannot close the doorway');
} finally {
  config.entranceOpenSideColumns = 2;
}

console.log('cavern entrance width: configurable side columns, carved opening, rock rim, and cache invalidation validated');
