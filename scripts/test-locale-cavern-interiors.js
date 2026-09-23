const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const banubu = require('../docs/config/locales/locale_banubu_cave_interior.json');
const colorPools = require('../docs/config/locales/locale_color_pools_cave.json');
const index = require('../docs/config/locales/index.json');

for (const locale of [banubu, colorPools]) {
  assert.strictEqual(locale.schema, 'hobunji_locale.v1');
  assert.strictEqual(locale.category, 'cave_interior');
  assert(locale.cavern?.mapId && locale.cavern?.seed, locale.id + ' needs a stable runtime map id and fixed seed');
  assert(locale.cavern?.primaryEntranceConnectorId, locale.id + ' needs a primary physical cave opening');
  assert(Object.keys(locale.tiles || {}).length > 0, locale.id + ' needs a painted footprint');
  assert((locale.connectors || []).some(c => c.id === locale.cavern.primaryEntranceConnectorId), locale.id + ' primary connector must exist');
  const idx = index.locales.find(entry => entry.id === locale.id);
  assert(idx && idx.category === 'cave_interior' && idx.mapId === locale.cavern.mapId, locale.id + ' must be discoverable by mapId through the locale index');
}

assert.strictEqual(banubu.cavern.creatureKind, 'grehlr', 'Banubu cavern must use the Grehlr cave-surface family');

const banubuDialogueCameras = banubu.cinematicCameras || [];
assert.strictEqual(banubuDialogueCameras.length, 2, 'Banubu cavern must author awake and sleeping world-space dialogue shots');
assert(banubuDialogueCameras.every(camera => camera.position?.y === 0), 'Banubu dialogue cameras must both sit at world Y=0');
assert(banubuDialogueCameras.every(camera => camera.targetNpcId === 'banubu'), 'Banubu shots must target Banubu by live NPC id instead of a fixed viewport portrait');
const secret = banubu.connectors.find(c => c.id === 'color_pools_door');
assert(secret, 'Banubu cave must author its hidden rear connector');
assert.strictEqual(secret.targetMap, 'map_i_color_pools');
assert.strictEqual(secret.targetSpotId, 'conn_banubu');
assert.strictEqual(secret.requiresKeyItem, 'color_pools_key');
assert.strictEqual(secret.hiddenUntilKeyItem, true);
assert.strictEqual(secret.doorFurnitureKey, 'door');

const back = colorPools.connectors.find(c => c.id === 'conn_banubu');
assert(back && back.targetMap === 'map_i_den_banubu' && back.targetSpotId === 'color_pools_door', 'Color Pools return connector must target Banubu\'s authored rear spot');

const pools = colorPools.cavern?.features?.colorPools || [];
assert.strictEqual(pools.length, 3, 'Color Pools cave needs red, green, and deep-blue pools');
assert.deepStrictEqual(pools.map(pool => pool.color), ['#a62f38', '#2e8b57', '#173f8f']);
const colorFloor = new Set(Object.keys(colorPools.tiles || {}));
for (const pool of pools) {
  assert.strictEqual(pool.tiles.length, 4, pool.id + ' must remain a 2x2 body of water');
  for (const [c, r] of pool.tiles) assert(colorFloor.has(c + ',' + r), pool.id + ' pool tiles must lie inside the authored cave footprint');
}
const altar = colorPools.objects.find(object => object.id === 'color_pools_altar');
assert(altar && altar.col === 7 && altar.row === 7, 'Color Pools altar remains authored at the room center');

// Fast integration test: mock only the expensive SDF call and exercise the real
// locale -> building-map synthesis, proving authored footprint/connectors survive.
let carveCall = null;
const context = {
  console,
  Math,
  JSON,
  window: null,
  WildernessMapGenerator: { makeRng: () => () => 0.5 },
  CavernSculptor: {
    carveFootprintCavern(floor, options) {
      carveCall = { floor: JSON.parse(JSON.stringify(floor)), options: JSON.parse(JSON.stringify(options)) };
      return { mesh: { positions: new Float32Array([0, 0, 0]), indices: [] } };
    },
  },
};
context.window = context;
vm.createContext(context);
vm.runInContext(read('docs/js/cavern-generator.js'), context, { filename: 'cavern-generator.js' });
const built = context.CavernGenerator.synthesizeLocaleCavernMapData(banubu);
assert.strictEqual(built.id, 'map_i_den_banubu');
assert.strictEqual(built.wallStyle, 'cavern');
assert.strictEqual(built.isLocaleCavern, true);
assert.strictEqual(built.denMotherKind, null, 'story cave locales must not inherit den encounter content');
assert.strictEqual(built.cavernCreatureKind, 'grehlr', 'locale synthesis must carry the authored creature habitat into runtime material selection');
assert.deepStrictEqual(JSON.parse(JSON.stringify(built.cinematicCameras)), JSON.parse(JSON.stringify(banubu.cinematicCameras)), 'locale cavern synthesis must preserve authored cinematic cameras');
assert.strictEqual(Object.keys(built.floorSurfaceByTile || {}).length, built.floor.length, 'every cavern floor tile must get a rendered-surface Y sample');
assert(Number.isFinite(built.floorSurfaceY), 'cavern synthesis must expose a finite fallback floor surface Y');
assert.strictEqual(built.floor.length, Object.keys(banubu.tiles).length);
assert.strictEqual(carveCall.floor.length, built.floor.length, 'the exact painted locale footprint must be handed to the cavern sculptor');
assert.deepStrictEqual(carveCall.options.entrance, { col: 6, row: 10, side: 'south' });
assert.strictEqual(built.keyGatedDoors[0].requiresKeyItem, 'color_pools_key');
assert.deepStrictEqual(JSON.parse(JSON.stringify(built.entrySpots.color_pools_door)), { col: 6, row: 1, side: 'north' });
assert(built.npcStations.some(station => station.id === 'station_banubu_cave_sleep' && station.pose === 'lie'));
assert(built.npcStations.some(station => station.id === 'station_banubu_cave_sleep' && station.col === 6 && station.row === 5), 'Banubu sleeps on the cave centerline rather than beside the entrance');

const sculptorSource = read('docs/js/cavern-sculptor.js');
const generatorSource = read('docs/js/cavern-generator.js');
const gameSource = read('docs/game.js');
const gameIndexSource = read('docs/index.html');
const dialogueSource = read('docs/js/dialogue-content.js');
const dialogueStyleSource = read('docs/style.css');
const cinematicCameraSource = read('docs/js/cinematic-camera-runtime.js');
const editorSource = read('docs/tools/locale-editor/index.html');
const interiorBuilderSource = read('docs/js/interior-scene-builder.js');
assert(sculptorSource.includes('function carveFootprintCavern(') && sculptorSource.includes('carveMazeCavern, carveFootprintCavern'), 'shared cavern sculptor must expose footprint-driven generation');
assert(generatorSource.includes('loadLocaleCavernDefinition') && generatorSource.includes('synthesizeLocaleCavernMapData'), 'runtime must resolve cave interiors through locale files');
assert(!generatorSource.includes("seedText === 'map_i_den_banubu'"), 'generic generator must not special-case Banubu by seed/map id');
assert(!generatorSource.includes('isBanubuHome'), 'Banubu-specific interior synthesis must be removed');

assert(!gameIndexSource.includes('id="npcPortraitCanvas"') && !gameIndexSource.includes('id="npcPortraitWrap"'), 'legacy screen-space NPC portrait canvas must be removed from gameplay HTML');
assert(!dialogueStyleSource.includes('#npcPortraitCanvas') && !dialogueStyleSource.includes('#npcPortraitWrap'), 'legacy screen-space NPC portrait CSS must be removed');
assert(!gameSource.includes('_npcPortraitCanvas'), 'game runtime must not retain a viewport portrait canvas handle');
assert(!dialogueSource.includes('_npcPortraitCanvas'), 'dialogue renderer must not draw expressions into a viewport portrait canvas');
assert(dialogueSource.includes('renderProfileToCanvas(walker.avatarFrontCanvas'), 'dialogue expression/yap rendering must update the existing world-space NPC avatar');
assert(gameIndexSource.indexOf('js/cinematic-camera-runtime.js') < gameIndexSource.indexOf('js/dialogue-content.js'), 'world-space camera runtime must load before dialogue content');
assert(gameSource.includes('function _namedAnimalFaceWorldPosition(walker)') && gameSource.includes('headBone.localToWorld(face)'), 'named-animal dialogue targeting must resolve the live transformed face rather than unscaled standing height');
assert(gameSource.includes('resolveSkinnedPixelWorldPosition(walker.avatarGroup, centroid)'), 'humanoid dialogue targeting must resolve the live skinned head centroid');
assert(gameSource.includes("setPlayerFacingInstant(-Math.PI / 2, { clearLook: true, syncCamera: true })"), 'Banubu async cave entry must reassert north across the complete facing authority');
assert(gameSource.includes('mouseLookAngle = nextFacing;') && gameSource.includes('controllerLookAngle = nextFacing;') && gameSource.includes('lastMoveAngle = nextFacing;'), 'instant entry facing must synchronize mouse, controller, and movement-facing authorities');
assert(cinematicCameraSource.includes('getNpcFacePosition') && cinematicCameraSource.includes('Number(face.y) + finite(camera.target?.y, 0)'), 'NPC-targeted authored cameras must resolve their target from the live face point each frame');
assert(gameSource.includes('loadLocaleCavernDefinition?.(mapId)') && gameSource.includes("loadSource = 'locale-cavern'"), 'building loader must prefer cave-interior locales');
assert(gameSource.includes('(!x.requiresKeyItem || !!window.KeyItemSystem?.has?.(x.requiresKeyItem))'), 'key-gated cave connectors must be mechanically inaccessible without their key');
assert(gameSource.includes("targetSpotId: exit.targetSpotId || ''") && gameSource.includes("_pendingEntrySpotId"), 'cave-to-cave travel must preserve named connector destinations across async generation');
assert(gameSource.includes('entranceLightTileSet'), 'secret exits must not affect the primary cave-mouth daylight');
assert(generatorSource.includes('function sampleMeshSurfaceAt(') && generatorSource.includes('floorSurfaceByTile: floorSurface.byTile'), 'cavern generation must sample the rendered shell and export per-tile ground Y');
assert(interiorBuilderSource.includes('function buildCavernFloorMesh(') && interiorBuilderSource.includes('cavernWalkableFloor'), 'caverns must render an explicit merged textured walkable floor');
assert(gameSource.includes('const exactSurfaceY = Number(tile?.surfaceY)') && gameSource.includes('bGrid[r][c].surfaceY = Number.isFinite(sampledSurfaceY)') && gameSource.includes('Number.isFinite(fallbackSurfaceY) ? fallbackSurfaceY : 0'), 'player tile grounding must preserve exact cavern floor samples while pinning ordinary interior floors to Y=0 before collider mutation');
assert(gameSource.includes(': (_isZoneArea(area) ? surfaceYAtWorld(area, c + 0.5, r + 0.5) : tileSurfaceYInArea(tile, area))'), 'NPC building grounding must share the exact tile surface resolver with the player');
assert(!gameSource.includes('_isBuildingArea(area) ? 0 : npcSurfaceY(area, spawnPos.c, spawnPos.r)'), 'NPC building transfers must never force Y=0');
assert(gameSource.includes('InteriorSceneBuilder.buildCavernFloorMesh?.('), 'game cavern scenes must add the explicit textured walkable floor mesh');
assert(gameSource.includes('mapData.denMotherKind || mapData.cavernCreatureKind'), 'authored caverns must select texture family from their authored creature habitat');
assert(editorSource.includes('value="cave_interior"') && editorSource.includes('cavernSeed') && editorSource.includes('raw.cavern'), 'Locale Editor must author and preserve cave-interior generator metadata');
assert.strictEqual(fs.existsSync(path.join(root, 'docs/config/maps/map_i_color_pools.json')), false, 'Color Pools must not retain a competing static rectangular map definition');

// Exercise real triangle sampling, including sub-tile tessellation and missing coverage.
const samplingLocale = { ...banubu, tiles: { '0,0': {}, '1,0': {}, '2,0': {} } }; // Tiny footprint isolates sample and fallback behavior.
const samplingMesh = { positions: [], indices: [] }; // Fixture contains a small flat floor and a steep wall below it.
function addSampleTriangle(vertices) {
  const offset = samplingMesh.positions.length / 3; // Vertex offset for this independently authored triangle.
  samplingMesh.positions.push(...vertices.flat());
  samplingMesh.indices.push(offset, offset + 1, offset + 2);
}
addSampleTriangle([[0.4, 2, 0.4], [0.6, 2, 0.4], [0.5, 2, 0.7]]);
addSampleTriangle([[0, -10, 0], [1, 10, 0], [0.5, -10, 1]]);
addSampleTriangle([[1, 3, 0], [2, 3, 0], [1.5, 3, 1]]);
context.CavernSculptor.carveFootprintCavern = () => ({ mesh: samplingMesh });
const sampled = context.CavernGenerator.synthesizeLocaleCavernMapData(samplingLocale); // Real synthesis must preserve tiny floor faces and reject steep walls.
assert.strictEqual(sampled.floorSurfaceByTile['0,0'], 2, 'small horizontal triangles are valid regardless of projected area');
assert.strictEqual(sampled.floorSurfaceByTile['1,0'], 3, 'independent floor heights remain intact');
assert.strictEqual(sampled.floorSurfaceByTile['2,0'], 3, 'uncovered tiles use the valid-sample median');

// Count mesh reads instead of timing a machine-dependent benchmark.
let meshReads = 0; // Sampling should read each triangle only during index construction.
samplingMesh.positions = new Proxy(samplingMesh.positions, { get(target, key) {
  if (/^\d+$/.test(String(key))) meshReads++;
  return Reflect.get(target, key);
} });
context.CavernGenerator.synthesizeLocaleCavernMapData(banubu);
assert(meshReads <= samplingMesh.indices.length * 3, 'sampling must not reread every triangle for every tile');


{
  const cameraContext = { console, performance: { now: () => 100 }, window: null };
  cameraContext.window = cameraContext;
  vm.createContext(cameraContext);
  vm.runInContext(cinematicCameraSource, cameraContext, { filename: 'cinematic-camera-runtime.js' });
  const walker = { rec: { id: 'banubu' }, root: { position: { x: 6.5, y: 0, z: 5.5 } } };
  cameraContext.CinematicCameraRuntime.init({
    getCurrentArea: () => 'map_i_den_banubu',
    getNpcWalker: () => walker,
    getNpcFacePosition: () => ({ x: 6.5, y: 4.25, z: 5.5 }),
    getCompanionObjects: () => [],
    getPlayer: () => ({}),
  });
  cameraContext.CinematicCameraRuntime.registerArea('map_i_den_banubu', [{
    id: 'test_face',
    position: { x: 7.2, y: 0, z: 9.4 },
    target: { x: 0.25, y: 0.5, z: -0.25 },
    dialogueNpcId: 'banubu',
    targetNpcId: 'banubu',
  }]);
  cameraContext.CinematicCameraRuntime.beginDialogue({ areaId: 'map_i_den_banubu', npcId: 'banubu', walker });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(cameraContext.CinematicCameraRuntime.resolvedTarget())),
    { x: 6.75, y: 4.75, z: 5.25 },
    'world-space cinematic target resolves live face offsets instead of a screen-space portrait center'
  );
  assert.strictEqual(cameraContext.CinematicCameraRuntime.activeCamera().position.y, 0, 'authored camera runtime must preserve exact world Y=0');
}

console.log('Locale-authored cavern footprint, fixed-seed synthesis, keyed connector, and editor integration checks passed');
