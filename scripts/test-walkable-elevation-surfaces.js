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
      extensionType: 'porch', extensionFace: 'top',
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
assert.equal(api.supportAt(11.5, 20.5, 'town', 0.25), null, 'a deck higher than walking step reach is not an automatic floor');
assert.equal(api.worldSurfaceTopAt(11.5, 20.5, 0.2, 'town', 0.25), 0.2, 'walking below a deck remains at terrain Y');
assert.equal(Math.round(api.worldSurfaceTopAt(11.5, 20.5, 0.2, 'town', 0.4) * 1000), 380,
  'ascending the reachable porch step stands at its actual absolute top');

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
assert.equal(api.supportAt(2.5,3.5,'town',.35), null,
  'a character moving through the lower floor must not snap onto an overhead bridge');
assert.equal(Math.round(api.worldSurfaceTopAt(2.5,3.5,0,'town',.65)*1000),550,
  'a character at bridge stair height is allowed onto the adjacent deck');
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
context.window.THREE = {
  Vector3: class {
    constructor(x=0,y=0,z=0) { this.x=x; this.y=y; this.z=z; }
    applyMatrix4(matrix) {
      const e=matrix.elements,x=this.x,y=this.y,z=this.z; // Mirror THREE world-transform for one-time rail orientation baking.
      this.x=e[0]*x+e[4]*y+e[8]*z+e[12];
      this.y=e[1]*x+e[5]*y+e[9]*z+e[13];
      this.z=e[2]*x+e[6]*y+e[10]*z+e[14];
      return this;
    }
  },
  Box3: class {
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

// Authored bridge rails use the same provider but a cached oriented rectangle;
// no full bridge tile or vast diagonal AABB becomes an invisible solid wall.
const rotation=Math.PI/4, cosine=Math.cos(rotation), sine=Math.sin(rotation); // Rotates the representative long bridge railing.
const railMesh={
  isMesh:true,
  userData:{authoredPart:{railingCollision:true}},
  geometry:{boundingBox:{min:{x:-2,y:.55,z:-.09},max:{x:2,y:.88,z:.09}}},
  matrixWorld:{elements:[cosine,0,-sine,0,0,1,0,0,sine,0,cosine,0,30,0,35,1]},
  testMin:{x:28.4,y:.55,z:33.4},testMax:{x:31.6,y:.88,z:36.6},
}; // A rotated rail deliberately has a much larger AABB than its slender visible geometry.
const deckMesh={isMesh:true,userData:{authoredPart:{walkableElevation:true}}}; // Deck must never block its own walkable center.
const bridgeGroup={parent:scene,userData:{meshById:new Map([['rail',railMesh],['deck',deckMesh]])},
  updateWorldMatrix(){}};
assert.equal(api.registerFurnitureRails(bridgeGroup),1,'Only the authored beam is a rail collider');
assert.equal(registeredRailProviders.length,1,'Existing house and bridge rails share one collision provider');
assert.equal(api.debugSnapshot().bridgeRailColliders,1,'Mobile debug reports the precise bridge colliders');
assert(api.railBlocksBox(30,35,.12),'Physical rail midpoint blocks actor movement');
assert(!api.railBlocksBox(30,36,.12),'Far empty corner of rotated rail AABB remains walkable');
assert(!api.railBlocksBox(30,35,.12,1.6),'Projectiles above the rail are not stopped by its footprint');
assert.equal(api.registerFurnitureRails(bridgeGroup),1,'Re-registering a bridge replaces its old exact rail shapes');
assert.equal(api.unregisterFurnitureRails(bridgeGroup),1,'Town furniture teardown removes cached rail shapes');
assert(!api.railBlocksBox(30,35,.12),'Removed bridges do not leave ghost rail blockers');
assert(api.railBlocksBox(10.1,20.5,.12),'Removing a bridge preserves unrelated porch collision');

// Rooftops reuse the exact porch support registry, but cannot be reached from underneath.
const ikmcRoof=JSON.parse(fs.readFileSync('docs/config/pieces/ikmc-outpost.json','utf8')); // Canonical approved outpost fixture at 180-degree rotation.
const expectedRoofY=.5+ikmcRoof.balconies.find(entry=>entry.id==='ikmc_rooftop').height; // Building elevation plus authored roof walking height.
assert.equal(expectedRoofY,2.25,'raised IKMC rooftop clears upper wall logs on its elevated terrain');
context.window.HousePieceGen.buildGroupFromPiece(null,ikmcRoof,4,40,{elevationY:.5,rotationDeg:180});
const roof=api.supportAt(7.5,45.5,'town');
assert(roof && roof.kind==='balcony','roof support is registered at the rotated IKMC hatch');
assert.equal(roof.bounds.topY,expectedRoofY,'balcony top inherits building terrain height and the authored raised deck');
assert.equal(api.supportAt(7.5,45.5,'town',1.2),null,'ground-level actor cannot select an overhead roof support');
assert.equal(api.worldSurfaceTopAt(7.5,45.5,.5,'town',1.2),.5,'underneath the roof remains ordinary ground');
assert.equal(api.isBalconyAt(7.5,45.5,expectedRoofY,'town'),true,'height-aware collision allows walking on the roof');
assert.equal(api.isBalconyAt(7.5,45.5,expectedRoofY+.5,'town'),false,'hatch permission stays limited to the deck height');
assert.equal(api.isAboveBalconyAt(7.5,45.5,expectedRoofY+.5,'town'),true,'jumping above the rooftop is not blocked by the shell');
assert.equal(api.isAboveBalconyAt(7.5,45.5,.5,'town'),false,'the building still blocks actors beneath its roof');
assert.equal(api.isBalconyAt(7.5,45.5,.5,'town'),false,'height-aware collision keeps the building solid below the roof');
const roofHatch=api.roofHatchAt(7.5,45.5,'town');
assert(roofHatch && roofHatch.mapId==='map_i_ikmc_outpost','roof transition is linked only to the correct interior');
assert.equal(roofHatch.topY,expectedRoofY,'roof arrival must inherit current building elevation and authored deck height');
assert.equal(api.roofHatchAt(7.5,45.5,'farm'),null,'outside of town the IKMC roof may not be climbed');
console.log('walkable elevation regression checks passed');
