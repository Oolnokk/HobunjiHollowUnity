const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const porchMaterialSource = fs.readFileSync('docs/js/porch-surface-material.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
const inn = JSON.parse(fs.readFileSync('docs/config/maps/map_i_inn.json', 'utf8'));

new Function(porchMaterialSource);
new Function(loaderSource);

assert.match(porchMaterialSource, /TEXTURE_PATH = 'assets\/textures\/carved_smooth\.png'/, 'porches use carved_smooth.png');
assert.match(porchMaterialSource, /WOOD_TINT = '#8b6540'/, 'porches use the furniture author wood base color');
assert.match(porchMaterialSource, /PORCH_TAGS = new Set\(\['porch', 'porchStair', 'railing'\]\)/, 'replacement is limited to the porch assembly');
assert.match(porchMaterialSource, /SURFACE_SPLIT_ANGLE_DEG = 24/, 'porch island detection uses the furniture-style smooth-edge split angle');
assert.match(porchMaterialSource, /detectConnectedSurfaceIslands/, 'porch UV mapping detects connected surface islands before writing UVs');
assert.match(porchMaterialSource, /mapping: 'stretch-to-connected-surface-island'/, 'porch faces share one UV frame per connected surface island');
assert.match(porchMaterialSource, /mode: 'shadeFill'/, 'wood tint preserves carved texture shading via the shared shade-fill path');
assert.match(porchMaterialSource, /Object\.assign\(wrappedBuild, originalBuild\)/, 'existing HousePieceGen/elevation wrapper markers are preserved');
assert.match(porchMaterialSource, /porchMatDebug/, 'mobile-friendly porch material diagnostics can be enabled without devtools');

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
const detect = windowMock.HobunjiPorchSurfaceMaterial?.detectConnectedSurfaceIslands;
assert.equal(typeof detect, 'function', 'connected porch surface detector is exposed for diagnostics/tests');
const normal = (x, y, z) => ({ x, y, z, dot(other) { return x * other.x + y * other.y + z * other.z; } });
const records = [
  { vertices: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], normal: normal(0,1,0) },
  { vertices: [[1,0,0],[2,0,0],[2,0,1],[1,0,1]], normal: normal(0,1,0) },
  { vertices: [[2,0,0],[2,1,0],[2,1,1],[2,0,1]], normal: normal(1,0,0) },
  { vertices: [[4,0,0],[5,0,0],[5,0,1],[4,0,1]], normal: normal(0,1,0) },
];
const islands = detect(records);
assert.equal(islands.length, 3, 'sharp or disconnected surfaces remain separate islands');
assert.equal(islands[0].length, 2, 'two edge-adjacent coplanar porch tiles become one cross-tile surface');
assert.ok(islands[0].includes(records[0]) && islands[0].includes(records[1]), 'the connected island spans both neighboring map tiles');

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
assert.equal(stageTable.walkableElevation, true, 'Foroji stage table opts into geometry-derived elevation');
assert.deepEqual(inn.furniture.filter(piece => piece.walkableElevation).map(piece => piece.id), ['fmss04iltqngq'], 'no other inn furniture is made walkable by this authored change');

console.log('Foroji stage elevation and cross-tile porch material regression checks passed');
