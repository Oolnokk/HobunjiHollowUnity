const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const porchMaterialSource = fs.readFileSync('docs/js/porch-surface-material.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
const inn = JSON.parse(fs.readFileSync('docs/config/maps/map_i_inn.json', 'utf8'));

new Function(porchMaterialSource);
new Function(loaderSource);

assert.match(porchMaterialSource, /DECK_TEXTURE_PATH = 'assets\/textures\/boards\.png'/, 'porch decks and stairs use boards.png');
assert.match(porchMaterialSource, /FENCE_TEXTURE_PATH = 'assets\/textures\/carved_smooth\.png'/, 'porch railings use carved_smooth.png');
assert.match(porchMaterialSource, /WOOD_TINT = '#8b6540'/, 'both porch materials use the furniture author wood base color');
assert.match(porchMaterialSource, /PORCH_TAGS = new Set\(\['porch', 'porchStair', 'railing'\]\)/, 'replacement is limited to the porch assembly');
assert.match(porchMaterialSource, /SURFACE_SPLIT_ANGLE_DEG = 24/, 'porch island detection keeps the furniture-style smooth-edge split angle');
assert.match(porchMaterialSource, /classA !== classB/, 'deck and fence material families cannot merge into one UV island');
assert.match(porchMaterialSource, /mapping: 'stretch-to-connected-surface-island'/, 'porch faces keep cross-tile connected-surface UV mapping');
assert.match(porchMaterialSource, /mode: 'shadeFill'/, 'both wood textures use the same luminance-preserving tint path');
assert.match(porchMaterialSource, /Object\.assign\(wrappedBuild, originalBuild\)/, 'existing HousePieceGen/elevation wrapper markers are preserved');
assert.match(porchMaterialSource, /porchMatDebug/, 'mobile-friendly porch material diagnostics remain available');

const windowMock = {
  THREE: {},
  HousePieceGen: { buildGroupFromPiece() { return null; } },
};
const context = {
  window: windowMock,
  location: { search: '' },
  URLSearchParams,
  console,
  Map,
  Set,
  Uint8Array,
  Float32Array,
  Math,
  Number,
  String,
  Object,
  Array,
};
windowMock.window = windowMock;
vm.runInNewContext(porchMaterialSource, context, { filename: 'porch-surface-material.js' });

const api = windowMock.HobunjiPorchSurfaceMaterial;
const detect = api?.detectConnectedSurfaceIslands;
assert.equal(typeof detect, 'function', 'connected porch surface detector remains exposed for diagnostics/tests');
assert.equal(api.texturePathForTag('porch'), 'assets/textures/boards.png');
assert.equal(api.texturePathForTag('porchStair'), 'assets/textures/boards.png');
assert.equal(api.texturePathForTag('railing'), 'assets/textures/carved_smooth.png');

const normal = (x, y, z) => ({ x, y, z, dot(other) { return x * other.x + y * other.y + z * other.z; } });
const records = [
  { tag: 'porch', vertices: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], normal: normal(0,1,0) },
  { tag: 'porch', vertices: [[1,0,0],[2,0,0],[2,0,1],[1,0,1]], normal: normal(0,1,0) },
  { tag: 'railing', vertices: [[2,0,0],[3,0,0],[3,0,1],[2,0,1]], normal: normal(0,1,0) },
  { tag: 'porch', vertices: [[2,0,0],[2,1,0],[2,1,1],[2,0,1]], normal: normal(1,0,0) },
  { tag: 'porch', vertices: [[4,0,0],[5,0,0],[5,0,1],[4,0,1]], normal: normal(0,1,0) },
];
const islands = detect(records);
assert.equal(islands.length, 4, 'material boundaries, sharp edges, and disconnected surfaces all split islands');
assert.equal(islands[0].length, 2, 'two edge-adjacent coplanar porch tiles remain one cross-tile deck surface');
assert.ok(islands[0].includes(records[0]) && islands[0].includes(records[1]), 'the deck island spans both neighboring map tiles');
assert.ok(!islands[0].includes(records[2]), 'a coplanar railing does not enlarge the boards.png deck UV frame');

const elevationIndex = loaderSource.indexOf('town-player-body-elevation-bridge.js');
const porchMaterialIndex = loaderSource.indexOf('porch-surface-material.js');
assert.ok(elevationIndex >= 0 && porchMaterialIndex > elevationIndex, 'porch material wrapper loads after the proven elevation bridge');

const stageStation = inn.npcStations.find(station => station.id === 'station_foroji_inn_music');
assert.ok(stageStation, 'Foroji inn music station exists');
const stageTable = inn.furniture.find(piece => piece.id === 'fmss04iltqngq');
assert.ok(stageTable, 'Foroji stage table exists');
assert.equal(stageTable.itemKey, 'tableLongFurniture');
assert.equal(stageTable.col, stageStation.col);
assert.equal(stageTable.row, stageStation.row);
assert.equal(stageTable.walkableElevation, true, 'Foroji stage table keeps geometry-derived elevation');
assert.deepEqual(inn.furniture.filter(piece => piece.walkableElevation).map(piece => piece.id), ['fmss04iltqngq'], 'no other inn furniture is made walkable');

console.log('Foroji stage elevation and split deck/fence porch material regression checks passed');
