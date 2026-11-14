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
assert.match(gameSource, /function npcSurfaceY\(area, c, r\)[\s\S]{0,1400}HobunjiWalkableElevation\?\.surfaceLiftAt\?\.\(c \+ 0\.5, r \+ 0\.5, area\)/, 'NPC walkers share the support registry after farm subtle-surface resolution');
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

// The weapon-depth policy must attach only to authored parts that actually
// support footsteps. These checks execute the production helper independently
// of THREE.Box3/scene placement and verify it isolates the shader material.
const topMarkerStart = runtimeSource.indexOf('  function markWalkableFurnitureTopForXray('); // Finds the one furniture x-ray policy used by stage and bridge supports.
const topMarkerEnd = runtimeSource.indexOf('  function registerObject(', topMarkerStart); // The next function marks its exact boundary.
assert(topMarkerStart >= 0 && topMarkerEnd > topMarkerStart);
const registeredTopFaces = []; // Collects actual meshes submitted to the existing held-render registry.
const markTopFace = new Function('window', runtimeSource.slice(topMarkerStart, topMarkerEnd)
  + '\nreturn markWalkableFurnitureTopForXray;')({
    HeldObjectRenderOrder: { markTopFaceGroundMesh(mesh) { registeredTopFaces.push(mesh); } },
  });
const sharedSolidMaterial = {
  key: 'shared-wood',
  clone() { return { key: 'isolated-wood' }; },
}; // Mimics the shared material used by rails and other authored furniture.
const deckPart = {
  isMesh: true,
  userData: { authoredPart: { walkableElevation: true } },
  geometry: { getAttribute(name) { return name === 'normal' ? {} : null; } },
  material: sharedSolidMaterial,
}; // An opted-in, normal-bearing bridge tread.
assert.equal(markTopFace(deckPart), true, 'walkable bridge tread opts into the top-only x-ray policy');
assert.equal(deckPart.userData.hobunjiGroundTopFacesOnly, true, 'top-face flag accompanies the marked bridge tread');
assert.notStrictEqual(deckPart.material, sharedSolidMaterial, 'bridge tread has its own shader material');
assert.strictEqual(registeredTopFaces[0], deckPart, 'late-registered furniture joins the existing held depth registry');
assert.equal(markTopFace(deckPart), false, 'repeat furniture registration does not re-clone its material');
assert.equal(registeredTopFaces.length, 1, 'late registration is idempotent');
const unnormaledPart = {
  isMesh: true, userData: {}, material: sharedSolidMaterial,
  geometry: { getAttribute() { return null; } },
}; // An unsupported geometry must keep ordinary solid depth.
assert.equal(markTopFace(unnormaledPart), false, 'unnormaled surfaces remain normal occluders');
assert.strictEqual(unnormaledPart.material, sharedSolidMaterial, 'unsupported surfaces preserve their original material');
assert.match(runtimeSource, /if \(registeredId\) for \(const mesh of supportParts\) markWalkableFurnitureTopForXray\(mesh\)/,
  'the marker is applied only after a real furniture support has been registered');

console.log('walkable elevation regression checks passed');
