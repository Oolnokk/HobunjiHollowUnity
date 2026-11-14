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
assert.equal(expectedHeights.size, 653, 'Regression fixture: preserved town geometry has 653 raised cells');
assert.deepEqual(new Set(Object.keys(map.visualHeights)), expectedHeights, 'Every elevation must match a current building footprint and margin');
assert(Object.values(map.visualHeights).every(value => value === 0.5), 'Building foundations must use the authored half-tile lift');
assert.equal(map.buildings.length, 12);
assert.equal(map.npcStations.length, 31);
assert.equal(map.transitions.length, 17);
assert.equal(map.layouts.length, 5);
assert.equal(map.farmPlots.length, 7);
assert.equal(map.buildings.find(building => building.id === 'bldg_6sd51').gridX, 3, 'Smithy must remain at the screenshot-approved west position');
assert.deepEqual(
  ['bldg_pb9bn', 'bldg_town_mine_entry', 'bldg_ikmc_outpost'].map(id => {
    const b = map.buildings.find(entry => entry.id === id);
    return [b.gridX, b.gridZ, b.footprintW, b.footprintD];
  }),
  [[18, 8, 6, 5], [12, 0, 2, 2], [4, 40, 11, 7]],
  'Carpenter and mine retain approved positions while the complete IKMC porch relocates to the southwest edge'
);
assert.deepEqual(map.rivers[0].nodes[1], [12, 15], 'River must follow the screenshot-approved bend');
assert.equal(Object.values(map.tiles).filter(tile => tile.type === 'path').length, 594, 'Screenshot-approved road coverage');
assert.equal(Object.values(map.tiles).filter(tile => tile.type === 'stream').length, 244, 'Screenshot-approved stream coverage');


const { tiles: runtimeTiles, ...runtimeOther } = map; // Runtime data excluding its storage-specific tile representation.
const { tiles: editorTiles, ...editorOther } = town; // Editor data excluding its complete tile grid representation.
assert.deepEqual(runtimeOther, editorOther, 'Runtime and editor town metadata must agree');
assert.deepEqual(sparseTiles(runtimeTiles), sparseTiles(editorTiles), 'Runtime and editor tile paint must agree');
// Exercise the existing Map Editor import functions directly, without booting WebGL.
const vm = require('node:vm');
const editor = fs.readFileSync('docs/tools/map-editor/index.html', 'utf8');
const normalizationStart = editor.indexOf('function normalizeWorkspaceTileRecord(t)');
const normalizationEnd = editor.indexOf('function loadWorkspace()', normalizationStart);
const importStart = editor.indexOf('function importAny(obj');
const importEnd = editor.indexOf('// ── Wire up', importStart);
assert(normalizationStart >= 0 && normalizationEnd > normalizationStart && importStart >= 0 && importEnd > importStart, 'Map Editor import sources must be available');
const testWorkspace = { maps: [], activeId: '' }; // Mutable simulated Map Editor workspace used by the real importAny().
const baselineCalls = []; // Tracks exactly which maps rebaseline during the authoritative Town replacement.
const context = vm.createContext({
  ws: testWorkspace, window: { FurniturePuzzleProperties: { normalizeWiring: w => w || [] } },
  TerrainPreview: { VISUAL_HEIGHT_MIN: -1, VISUAL_HEIGHT_MAX: 1 },
  clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
  makeMap: (name, category, cols, rows) => ({ id: 'imported_id', name, category, cols, rows, tiles: {} }),
  updateAll() {}, fitView() {}, captureBaseline(map) { baselineCalls.push(map.id); }, migrateSubmapAnchors() {}, sanitizePlateauGaps() {}, setStatus() {},
  undoStack: [], redoStack: [], confirm: () => false,
  GAME: { layoutKey: 'unused' }, localStorage: { setItem() {} },
});
vm.runInContext(editor.slice(normalizationStart, normalizationEnd) + '\n' + editor.slice(importStart, importEnd), context);
context.importAny({ maps: [town], activeId: town.id });
assert.equal(testWorkspace.maps.length, 1, 'Workspace import must produce one town');
assert.equal(Object.keys(testWorkspace.maps[0].visualHeights).length, 653, 'Workspace import must not discard town height stamps');
assert(Object.hasOwn(testWorkspace.maps[0], 'visualHeightBase'), 'Workspace import must preserve the authoring base height layer');
assert.equal(Object.keys(testWorkspace.maps[0].visualHeightBase).length, 0);
const extraTile = { c: 1, r: 1, type: 'grass', crop: '', plateau: 'authored' }; // Round-trip fixture for non-default tile metadata.
const standalone = { ...town, tiles: [extraTile], visualHeights: { '1,1': 0.5 }, visualHeightBase: {} };
context.importAny(standalone);
assert.equal(testWorkspace.maps.length, 2, 'Standalone import must append the imported map');
assert.equal(testWorkspace.maps[1].visualHeights['1,1'], 0.5, 'Standalone import must retain visual heights');
assert.equal(testWorkspace.maps[1].tiles['1,1'].plateau, 'authored', 'Standalone import must retain authored tile properties');
assert(Object.hasOwn(testWorkspace.maps[1], 'visualHeightBase'), 'Standalone import must preserve foundation base metadata');

const staleTown = testWorkspace.maps.find(map => map.id === town.id); // Simulates a user's saved Town that differs from the bundled game map.
staleTown.name = 'Locally edited Town';
const unrelatedMap = testWorkspace.maps.find(map => map.id !== town.id); // Must survive a bundled Town refresh unchanged.
const replacementTown = { ...town, name: 'Reloaded bundled Town' }; // Represents the canonical Town fetched by the Load Town button.
baselineCalls.length = 0; // Ignore earlier baseline setup; only confirmed reload calls matter here.
context.importAny({ maps: [replacementTown], activeId: town.id }, { mergeIntoWorkspace: true, replaceMapIds: [town.id] });
assert.deepEqual(baselineCalls, [town.id], 'Explicit Town reload must not rebaseline unrelated maps');
assert.equal(testWorkspace.maps.length, 2, 'Reloading Town must not duplicate it or discard unrelated editor maps');
assert.equal(testWorkspace.maps.find(map => map.id === town.id).name, 'Reloaded bundled Town', 'Explicitly reloaded Town must replace stale local state');
assert.equal(testWorkspace.maps.find(map => map.id === unrelatedMap.id), unrelatedMap, 'Unrelated map must survive a Town refresh');
assert.equal(testWorkspace.activeId, town.id, 'Reloaded Town must become the selected map');
assert.equal(Object.keys(testWorkspace.maps.find(map => map.id === town.id).visualHeights).length, 653, 'Reloaded Town must use bundled elevation cells');
context.importAny({ maps: [{ ...town, name: 'Ignored conflict' }], activeId: town.id }, { mergeIntoWorkspace: true });
assert.equal(testWorkspace.maps.find(map => map.id === town.id).name, 'Reloaded bundled Town', 'Ordinary workspace merges must still preserve existing maps');

console.log('Town runtime/editor data, map-import elevations, and explicit Town reload passed.');
