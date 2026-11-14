// Run: node scripts/test-town-map-authority.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const map = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json', 'utf8')); // Canonical town map used by the game.
const workspace = JSON.parse(fs.readFileSync('docs/config/town-workspace-v1.json', 'utf8')); // Bundled editor workspace used when authoring town.
const town = workspace.maps.find(entry => entry.id === 'map_hobunji_town'); // Editor town record to compare against the runtime data.
assert(town, 'Town must exist in the editor workspace');
assert.equal(workspace.maps.filter(entry => entry.id === 'map_hobunji_town').length, 1);

function sparseTiles(tiles) {
  const entries = Array.isArray(tiles)
    ? tiles.map(({ c, r, ...record }) => [`${c},${r}`, record])
    : Object.entries(tiles || {});
  const out = {}; // Normalized authored tiles; default grass does not need storage in the runtime map.
  for (const [key, record] of entries) {
    const clean = Object.fromEntries(Object.entries(record).filter(([field, value]) => !(field === 'crop' && value === '')));
    if (clean.type !== 'grass' || Object.keys(clean).length > 1) {
      assert(!Object.hasOwn(out, key), `Duplicate tile ${key}`);
      out[key] = clean;
    }
  }
  return out;
}

assert.equal(map.schema, 'hobunji_map.v1');
assert.equal(map.id, 'map_hobunji_town');
assert.equal(map.cols * map.rows, 3000);
assert.equal(town.tiles.length, 3000, 'Editor must retain all tile cells');
// Visual elevation must follow occupied building cells, including authored irregular footprints, plus their one-cell border.
const expectedHeights = new Set(); // Guards against elevated ghost foundations left behind by moved buildings.
for (const building of map.buildings) {
  const w = building.footprintW, d = building.footprintD;
  const cells = building.footprintShape?.cells?.length
    ? building.footprintShape.cells
    : Array.from({ length: w * d }, (_, i) => ({ x: i % w, y: Math.floor(i / w) }));
  const angle = ((building.rotationDeg ?? building.rotation ?? 0) % 360 + 360) % 360;
  for (const { x, y } of cells) {
    const [u, v] = angle === 90 ? [y, w - 1 - x] : angle === 180 ? [w - 1 - x, d - 1 - y]
      : angle === 270 ? [d - 1 - y, x] : [x, y];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const col = building.gridX + u + dx, row = building.gridZ + v + dz;
      if (col >= 0 && col < map.cols && row >= 0 && row < map.rows) expectedHeights.add(`${col},${row}`);
    }
  }
}
assert.equal(expectedHeights.size, 609, 'Regression fixture: preserved town geometry has 609 raised cells');
assert.deepEqual(new Set(Object.keys(map.visualHeights)), expectedHeights, 'Every elevation must match a current building footprint and margin');
assert(Object.values(map.visualHeights).every(value => value === 0.5), 'Building foundations must use the authored half-tile lift');
assert.equal(map.buildings.length, 12);
assert.equal(map.npcStations.length, 31);
assert.equal(map.transitions.length, 17);
assert.equal(map.layouts.length, 5);
assert.equal(map.farmPlots.length, 7);

const { tiles: runtimeTiles, ...runtimeOther } = map; // Runtime data excluding its storage-specific tile representation.
const { tiles: editorTiles, ...editorOther } = town; // Editor data excluding its complete tile grid representation.
assert.deepEqual(runtimeOther, editorOther, 'Runtime and editor town metadata must agree');
assert.deepEqual(sparseTiles(runtimeTiles), sparseTiles(editorTiles), 'Runtime and editor tile paint must agree');
console.log('Town runtime and editor workspace agree on authored map data.');
