const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const porchMaterialSource = fs.readFileSync('docs/js/porch-surface-material.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
const inn = JSON.parse(fs.readFileSync('docs/config/maps/map_i_inn.json', 'utf8'));

new Function(porchMaterialSource);
new Function(loaderSource);

assert.match(porchMaterialSource, /WOOD_TEXTURE_PATH = /, 'one configured texture path owns the entire entrance');
assert.match(porchMaterialSource, /entrance-wood/, 'all entrance types use the same material family');
assert.match(porchMaterialSource, /WOOD_TINT = '#8b6540'/, 'every entrance part uses the furniture author wood base tint');
assert.match(porchMaterialSource, /PORCH_TAGS = new Set\(\['porch', 'porchStair', 'railing'\]\)/, 'replacement is limited to the porch assembly');
assert.match(porchMaterialSource, /SURFACE_SPLIT_ANGLE_DEG = 24/, 'porch island detection keeps the furniture-style smooth-edge split angle');
assert.doesNotMatch(porchMaterialSource, /classA !== classB/, 'the unified finish never splits connected faces by deck/fence categories');
assert.match(porchMaterialSource, /mapping: 'stretch-to-connected-surface-island'/, 'porch faces keep cross-tile connected-surface UV mapping');
assert.match(porchMaterialSource, /mode: 'shadeFill'/, 'shared wood texture retains the luminance-preserving tint path');
assert.match(porchMaterialSource, /Object\.assign\(wrappedBuild, originalBuild\)/, 'existing HousePieceGen/elevation wrapper markers are preserved');
assert.match(porchMaterialSource, /porchMatDebug/, 'mobile-friendly porch material diagnostics remain available');

const requestedTextures = []; // Records actual texture requests from the shared material cache.
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  fromArray(v) { return this.set(v[0], v[1], v[2]); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  lengthSq() { return this.dot(this); }
  length() { return Math.sqrt(this.lengthSq()); }
  multiplyScalar(n) { return this.set(this.x * n, this.y * n, this.z * n); }
  normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
  addScaledVector(v, n) { return this.set(this.x + v.x * n, this.y + v.y * n, this.z + v.z * n); }
}
const THREE = {
  Vector3,
  DoubleSide: 2,
  ClampToEdgeWrapping: 1001,
  BufferAttribute: class { constructor(array, size) { this.array = array; this.itemSize = size; } },
  MeshLambertMaterial: class {
    constructor(opts) { this.color = { setHex(hex) { this.hex = hex; }, hex: opts.color }; this.side = opts.side; }
  },
  TextureLoader: class { load(path) { requestedTextures.push(path); } },
};
const windowMock = {
  THREE,
  HousePieceGen: {
    buildGroupFromPiece() { return null; },
    buildEntryTunnelPiece() { return framePiece; }, // Reuses the authored face fixture to represent generated farmhouse tunnel geometry.
    buildEntryTunnelGroup() { return frameGroup; }, // Simulates HousePieceGen's lexical build path, bypassing the authored wrapper.
  },
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
for (const tag of ['porch', 'porchStair', 'railing', 'door', 'doorwayFrame']) {
  assert.equal(api.texturePathForTag(tag), 'assets/textures/carved_smooth.png', tag + ' uses common carved wood');
}
const sharedMaterial = api.materialForTag('porch'); // The single material object all rendered components should reference.
assert.strictEqual(api.materialForTag('railing'), sharedMaterial);
assert.strictEqual(api.materialForTag('door'), sharedMaterial);
assert.deepEqual(requestedTextures, ['assets/textures/carved_smooth.png'], 'one texture load for every entrance component');
const doorMesh = { isMesh: true, userData: {}, material: null }; // Authored door leaf receives the shared material rather than its own texture.
const handleMesh = { isMesh: true, userData: {}, material: null }; // Authored door hardware participates in the uniform finish.
const doorGroup = { userData: {}, traverse(callback) { callback(doorMesh); callback(handleMesh); } };
assert.equal(api.applyToDoorGroup(doorGroup), 2);
assert.strictEqual(doorMesh.material, sharedMaterial);
assert.strictEqual(handleMesh.material, sharedMaterial);
assert.equal(doorGroup.userData.entranceWoodMaterial, 'assets/textures/carved_smooth.png');

const normal = (x, y, z) => ({ x, y, z, dot(other) { return x * other.x + y * other.y + z * other.z; } });
const records = [
  { tag: 'porch', vertices: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], normal: normal(0,1,0) },
  { tag: 'porch', vertices: [[1,0,0],[2,0,0],[2,0,1],[1,0,1]], normal: normal(0,1,0) },
  { tag: 'railing', vertices: [[2,0,0],[3,0,0],[3,0,1],[2,0,1]], normal: normal(0,1,0) },
  { tag: 'porch', vertices: [[2,0,0],[2,1,0],[2,1,1],[2,0,1]], normal: normal(1,0,0) },
  { tag: 'porch', vertices: [[4,0,0],[5,0,0],[5,0,1],[4,0,1]], normal: normal(0,1,0) },
];
const islands = detect(records);
assert.equal(islands.length, 3, 'sharp edges and disconnected surfaces still split islands; material categories do not');
assert.equal(islands[0].length, 3, 'connected coplanar porch and fence faces share one UV island');
assert.ok(islands[0].includes(records[0]) && islands[0].includes(records[1]), 'the deck island spans both neighboring map tiles');
assert.ok(islands[0].includes(records[2]), 'coplanar railing shares the same carved-wood UV frame');

const frameVertices = [[0,0,0],[0,1,0],[1,1,0],[1,0,0]]; // Authored entry-tunnel jamb used to test the real quad-matching path.
const framePositions = [0,1,2,0,2,3].map(index => frameVertices[index]).flat(); // Matches HousePieceGen triangle ordering.
const attributes = { position: {
  count: 6,
  getX(i) { return framePositions[i * 3]; },
  getY(i) { return framePositions[i * 3 + 1]; },
  getZ(i) { return framePositions[i * 3 + 2]; },
} }; // Lets material mapping write UVs to the matched face geometry.
const frameMesh = { isMesh: true, userData: {}, material: null, geometry: {
  getAttribute(name) { return attributes[name]; },
  setAttribute(name, attr) { attributes[name] = attr; },
} }; // Rendered doorway frame to be recolored through authored face metadata.
const frameGroup = { traverse(callback) { callback(frameMesh); } };
const framePiece = { gridSize: 1, footprint: { cells: [{ x: 0, y: 0 }] },
  base: { faces: [{ tag: 'entryTunnel', doorwayFrame: true, extensionFace: 'south', v: frameVertices }] } };
const convertedFrames = api.applyToBuiltGroup(frameGroup, framePiece, 0, 0);
assert.equal(convertedFrames.frameFaces, 1, 'doorway-frame faces are included, not left as stone');
assert.strictEqual(frameMesh.material, sharedMaterial, 'doorway frame and door share exactly the same material object');
assert.equal(frameMesh.userData.hobunjiPorchSurfaceMaterial.texture, 'assets/textures/carved_smooth.png');
assert.equal(attributes.uv.array.length, 12, 'doorway-frame geometry received connected-surface UV mapping');

frameMesh.material = null; // Clears the authored fixture's finish so the generated route must apply it itself.
const generatedTunnel = windowMock.HousePieceGen.buildEntryTunnelGroup({}, 0, 0, 'south', {});
assert.strictEqual(generatedTunnel, frameGroup, 'the generated tunnel retains the original HousePieceGen output');
assert.strictEqual(frameMesh.material, sharedMaterial, 'generated farm entry-tunnel doorframes receive the same finish');
assert.equal(api.debugSnapshot().generatedTunnelPatchInstalled, true, 'generated farm entrance material hook is installed');

const elevationIndex = loaderSource.indexOf('town-player-body-elevation-bridge.js');
const porchMaterialIndex = loaderSource.indexOf('porch-surface-material.js');
assert.ok(elevationIndex >= 0 && porchMaterialIndex > elevationIndex, 'porch material wrapper loads after the proven elevation bridge');

const stageStation = inn.npcStations.find(station => station.id === 'station_foroji_inn_music');
assert.ok(stageStation, 'Foroji inn music station exists');
const stageTable = inn.furniture.find(piece => piece.id === 'fmss04iltqngq');
assert.ok(stageTable, 'Foroji stage table exists');
assert.equal(stageTable.itemKey, 'tableLongFurniture');
const stageW = (stageTable.gridRot / 90) % 2 ? (stageTable.gridD || 1) : (stageTable.gridW || 1);
const stageD = (stageTable.gridRot / 90) % 2 ? (stageTable.gridW || 1) : (stageTable.gridD || 1);
assert.ok(stageStation.col >= stageTable.col && stageStation.col < stageTable.col + stageW
  && stageStation.row >= stageTable.row && stageStation.row < stageTable.row + stageD,
  'Foroji\'s music station stands on the stage table footprint');
assert.equal(stageTable.walkableElevation, true, 'Foroji stage table keeps geometry-derived elevation');
assert.deepEqual(inn.furniture.filter(piece => piece.walkableElevation).map(piece => piece.id), ['fmss04iltqngq'], 'no other inn furniture is made walkable');

console.log('Foroji stage elevation and unified entrance wood material regression checks passed');
