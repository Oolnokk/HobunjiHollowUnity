const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync('docs/js/town-player-body-elevation-bridge.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
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
assert.match(gameSource, /function npcSurfaceY\(area, c, r\)[\s\S]{0,1400}HobunjiWalkableElevation\?\.worldSurfaceTopAt\?\.\(x, z, base, area\)/, 'NPC walkers use the same absolute physical support as the player');
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

// An angled bridge must not turn its much larger axis-aligned bounding box into invisible walkable water.
const bridgeId=api.registerBox({
  minX:-1,maxX:7,minZ:0,maxZ:8,baseY:0,topY:.55
}, {id:'test-angled-bridge',kind:'furniture',area:'town',bridgeBaseY:0,bridgeFootprints:[
  {ax:0,az:0,ux:6,uz:6,vx:-1,vz:1,det:12,topY:.55},
  {ax:6,az:6,ux:.7,uz:.7,vx:-1,vz:1,det:1.4,topY:.12}
]});
assert.equal(bridgeId,'test-angled-bridge','bridge support must register without creating duplicate regions');
assert.equal(Math.round(api.surfaceLiftAt(2.5,3.5,'town')*1000),550,
  'a player in the diagonal bridge deck rises to its surface');
assert.equal(api.surfaceLiftAt(5,1,'town'),0,
  'a player in the bounding rectangle but outside the actual bridge remains at water level');
assert.equal(Math.round(api.surfaceLiftAt(5.85,6.85,'town')*1000),120,
  'one-tile stair flights use the actual tread top, not the deck height');
assert.equal(api.surfaceLiftAt(2.5,3.5,'farm'),0,
  'the town bridge never adds a raised surface in other areas');
assert.equal(api.unregister(bridgeId),true,'bridge support unregisters cleanly after replacement');
assert.equal(api.surfaceLiftAt(2.5,3.5,'town'),0,'no ghost walkable surface survives teardown');

assert.equal(api.worldSurfaceTopAt(0.5,0.5,0.73,'town'),0.73,
  "no active support means terrain's actual world Y remains authoritative");
const registeredRailProviders = []; // Captures the narrow physical guard registered through the game's existing footprint provider.
context.window.THREE = { Box3: class {
  setFromObject(mesh) { this.min = mesh.testMin; this.max = mesh.testMax; return this; }
  isEmpty() { return false; }
} }; // Only the Box3 interface needed by the railing regression fixture.
context.window.AreaFootprintBlockers = { register(id, provider) { registeredRailProviders.push({ id, provider }); } };
const rail = { isMesh: true, userData: { housePieceFaceTag: 'railing' },
  testMin: { x: 10.05, y: 0.18, z: 20.05 },
  testMax: { x: 10.18, y: 0.88, z: 20.85 } }; // Physically narrow railing, not its 1x1 authored footprint tile.
const railGroup = { parent: scene, traverse(visitor) { visitor(rail); } };
assert.equal(api.registerPieceRails(railGroup, { id: 'test-porch-rails' }, 10, 20), 1);
assert.equal(registeredRailProviders.length, 1, 'rail collider reuses one shared movement-provider registration');
assert.equal(api.railBlocksBox(10.1,20.5,0.12), true, 'a character cannot pass through modeled railing geometry');
assert.equal(api.railBlocksBox(10.65,20.5,0.12), false, 'the clear interior of the same rail tile stays walkable');
assert.equal(api.railBlocksBox(10.1,20.5,0.12,1.3), false, 'airborne feet above the rail are not blocked by its 2D footprint');
assert.equal(api.registerPieceRails(railGroup, { id: 'test-porch-rails' }, 10, 20), 1);
assert.equal(registeredRailProviders.length, 1, 'replacing a piece does not duplicate the provider');


console.log('walkable elevation regression checks passed');
