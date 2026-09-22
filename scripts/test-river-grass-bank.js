'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const vegetation = read('docs/js/vegetation-crop-rendering.js'); // Guards bank-aware grass placement and its mobile diagnostic.
const terrain = read('docs/js/terrain-geometry.js'); // Executes the real soft-town-waterway bank geometry below.
const pixelProbe = read('docs/js/pixel-probe.js'); // Guards the mobile-readable bank diagnostics.
const index = read('docs/index.html'); // Guards cache-busting for every runtime file changed by this fix.
const townMap = JSON.parse(read('docs/config/maps/hobunji_hollow_town.map.json')); // Confirms the exact probe boundary remains authored as grass -> stream.

assert.equal(townMap.tiles['29,15']?.type || 'grass', 'grass',
  'the supplied probe foreground is an authored grass tile');
assert.equal(townMap.tiles['29,16']?.type, 'stream',
  'the supplied probe background is the immediately adjacent stream tile');

assert.match(vegetation, /const GRASS_BANK_SWAY_MARGIN = 0\.05/,
  'town bank grass reserves room for billboard width plus shader wind sway');
assert.match(vegetation, /function _townGrassBankEdges\(townGrid, col, row\)[\s\S]{0,1200}?return west \|\| east \|\| north \|\| south \? \{ west, east, north, south \} : null;/,
  'town grass identifies permanent water along all four sides and river-bend corners');
assert.match(vegetation, /const safeHalfExtent = w \* 0\.5 \+ GRASS_BANK_SWAY_MARGIN;[\s\S]{0,500}?edgeInsets\.south/,
  'bank-aware billboard placement clamps the full crossed-card footprint, not only its root');
assert.match(vegetation, /_fillBillboardInstances\(townGrassBillMesh, dummy, idx, col, row, 1\.0, tierY, 1, 1, 0, bankEdges\)/,
  'town grass passes detected bank edges into the shared billboard placement helper');
assert.match(terrain, /const TOWN_WATER_BANK_GRASS_LIP_HEIGHT = 0\.14/,
  'town soft waterways define the grass-bank lip used to occlude lower tuft gaps');
assert.match(terrain, /bankGrassLipIdx[\s\S]{0,2400}?neighborIsGrass[\s\S]{0,2400}?appendGrassBankLip/,
  'the lip is generated only for soft waterway edges neighboring actual grass');
assert.match(terrain, /grassIdx\.push\(\.\.\.bankGrassLipIdx\)/,
  'the shoreline lip uses the grass terrain material rather than the water or dirt shader');

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
}
class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
  }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(attr) { this.index = attr; return this; }
  computeVertexNormals() { return this; }
}
const THREE = { BufferAttribute, Float32BufferAttribute: BufferAttribute, BufferGeometry }; // Minimal geometry API required by buildTerrainTileGeo.
const TileType = {
  GRASS: 'grass', TRENCH: 'trench', RAISED: 'raised',
  RIVER: 'river', STREAM: 'stream', WATERFALL: 'waterfall',
};
const WATERWAY_TYPES = new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL]);
const sameWaterway = (a, b) => a === b || (WATERWAY_TYPES.has(a) && WATERWAY_TYPES.has(b));
const DEPRESSION_TOP = {
  [TileType.TRENCH]: -0.5,
  [TileType.RIVER]: -0.55,
  [TileType.STREAM]: -0.55,
  [TileType.WATERFALL]: -0.55,
};
const testGrid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ type: TileType.STREAM }))); // Keeps west/east/south open so the one north grass edge is isolated.
testGrid[0][1] = { type: TileType.GRASS };
const deps = {
  TileType, WATERWAY_TYPES, sameWaterway, DEPRESSION_TOP,
  NORMAL_TOP: 0, RAISED_TOP: 0.5,
  getGrid: () => testGrid,
};
const functionMatch = terrain.match(/(function buildTerrainTileGeo\(col, row, type, srcGrid = deps\.getGrid\(\), options = \{\}\) \{[\s\S]*?\n  \})\n\n  window\.TerrainGeometry = \{/);
assert(functionMatch, 'the live terrain-bank builder must remain executable by the focused regression');
const TOWN_WATER_BANK_GRASS_LIP_HEIGHT = 0.14; // Mirrors the exported runtime constant so the extracted function keeps its lexical dependency.
const buildTerrainTileGeo = eval(`(${functionMatch[1]})`); // Executes repository code only.
const townStream = buildTerrainTileGeo(1, 1, TileType.STREAM, testGrid);
assert(townStream.grassGeo, 'a soft town stream beside grass must produce grass-bank geometry');

const baseVertexCount = 7 * 7; // Original 7x7 heightfield vertices; all larger indices belong to the new shoreline lip in this town-only call.
const lipIndices = Array.from(townStream.grassGeo.index.array).filter(indexValue => indexValue >= baseVertexCount);
assert.equal(lipIndices.length, 6 * 2 * 3,
  'one grass-adjacent stream edge must add exactly six two-triangle lip segments');
const positions = townStream.grassGeo.getAttribute('position').array;
for (let vertex = baseVertexCount; vertex < baseVertexCount + 14; vertex += 2) {
  const topY = positions[vertex * 3 + 1]; // Paired top vertex written first by appendGrassBankLip.
  const baseY = positions[(vertex + 1) * 3 + 1]; // Paired shoreline base vertex written second.
  assert(Math.abs((topY - baseY) - TOWN_WATER_BANK_GRASS_LIP_HEIGHT) < 1e-6,
    'every shoreline sample must retain the full 0.14u grass-bank occlusion height');
}

assert.match(vegetation, /debugGrassBankSnapshot/,
  'the vegetation runtime exposes a lightweight bank diagnostic');
assert.match(pixelProbe, /Grass bank inset: townTiles=[^\n]*lip=/,
  'Pixel Probe surfaces both billboard inset and real shoreline-lip state without DevTools');
assert.match(index, /terrain-geometry\.js\?v=20260922rivergrass2/,
  'the shipped page cache-busts the shoreline geometry');
assert.match(index, /vegetation-crop-rendering\.js\?v=20260922rivergrass2/,
  'the shipped page cache-busts the bank-aware vegetation runtime');
assert.match(index, /pixel-probe\.js\?v=20260922rivergrass2/,
  'the shipped page cache-busts the river-bank Pixel Probe diagnostic');

console.log('River grass bank regression checks passed.');
