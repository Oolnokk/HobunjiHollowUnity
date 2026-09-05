const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync('docs/js/town-player-body-elevation-bridge.js', 'utf8');
const interiorEditorSource = fs.readFileSync('docs/js/building-interior-npc-wardrobe-editor.js', 'utf8');
const mapEditorEntrySource = fs.readFileSync('docs/js/map-editor-building-elevation.js', 'utf8');
const mapEditorCoreSource = fs.readFileSync('docs/js/map-editor-building-elevation-core.js', 'utf8');
const interiorSyncSource = fs.readFileSync('docs/js/map-editor-interior-instance-sync.js', 'utf8');

new Function(runtimeSource);
new Function(interiorEditorSource);
new Function(mapEditorEntrySource);
new Function(mapEditorCoreSource);
new Function(interiorSyncSource);

assert.match(runtimeSource, /FURNITURE_METADATA_KEY = 'walkableElevation'/, 'runtime uses stable instance metadata');
assert.match(runtimeSource, /new THREE\.Box3\(\)\.setFromObject\(object\)/, 'furniture collider is derived from complete rendered geometry');
assert.match(runtimeSource, /registerPiecePorches/, 'porches register authored support surfaces');
assert.match(runtimeSource, /syncNpcSupportLift/, 'NPC walkers share the support registry');
assert.match(runtimeSource, /walkElevDebug=1/, 'mobile runtime diagnostics are available without devtools');

assert.match(interiorEditorSource, /WALKABLE_ELEVATION_KEY = 'walkableElevation'/, 'Interior Author persists the same metadata');
assert.match(interiorEditorSource, /Walkable vertical elevation/, 'Interior Author exposes a selected-instance checkbox');

assert.match(mapEditorEntrySource, /WALKABLE_ELEVATION_KEY = 'walkableElevation'/, 'exterior Map Editor entry point persists the same metadata');
assert.match(mapEditorEntrySource, /Walkable Furniture/, 'exterior Map Editor exposes a mobile-friendly furniture panel');
assert.match(mapEditorEntrySource, /map-editor-building-elevation-core\.js/, 'walkable furniture is hosted by the building-elevation entry point');
assert.match(mapEditorCoreSource, /window\.MapEditorBuildingElevation/, 'original building elevation controller remains intact behind the entry point');
assert.doesNotMatch(interiorSyncSource, /WALKABLE_ELEVATION_KEY|Walkable Furniture|walkableElevation/, 'standalone interior sync stays unrelated to walkable furniture authoring');

const scene = {};
const group = { parent: scene };
const composer = {
  clearChannel() {},
  setChannel() {},
  getVisualRoots() { return []; },
  getPlayerMesh() { return null; },
};
const housePieceGen = {
  buildGroupFromPiece() { return group; },
};
const context = {
  console,
  Map,
  Set,
  Promise,
  Math,
  Number,
  String,
  Object,
  Array,
  JSON,
  window: {
    PlayerBodyTransformComposer: composer,
    HobunjiTownSubtleElevation: { sampleHeightAt() { return 0; } },
    HousePieceGen: housePieceGen,
    GridTileAccessors: { getActiveScene() { return scene; } },
  },
  location: { search: '', pathname: '/docs/index.html' },
  document: { readyState: 'complete', getElementById() { return null; } },
};
context.window.window = context.window;
vm.runInNewContext(runtimeSource, context, { filename: 'town-player-body-elevation-bridge.js' });

const api = context.window.HobunjiWalkableElevation;
assert.ok(api, 'walkable elevation API installs');

const piece = {
  id: 'test_house',
  tileSize: 1,
  base: {
    groundY: 0,
    faces: [{
      extensionType: 'porch',
      sourceTile: { x: 1, y: 0 },
      v: [[0, 0.18, 0], [1, 0.18, 0], [1, 0.18, 1], [0, 0.18, 1]],
    }],
  },
  footprint: {
    cells: [{ x: 0, y: 0 }],
    extensions: { porches: [{ x: 1, y: 0 }], porchStairs: [], railings: [] },
  },
};

context.window.HousePieceGen.buildGroupFromPiece(null, piece, 10, 20, { elevationY: 0.2, rotationDeg: 0 });
assert.equal(Math.round(api.surfaceLiftAt(11.5, 20.5, 'town') * 1000), 180, 'porch support uses authored deck height');
const porch = api.supportAt(11.5, 20.5, 'town');
assert.equal(porch.kind, 'porch');
assert.equal(Math.round(porch.bounds.topY * 1000), 380, 'porch support top includes building elevation');

console.log('walkable elevation regression checks passed');
