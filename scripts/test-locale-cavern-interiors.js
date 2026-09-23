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
assert.strictEqual(Object.keys(built.floorSurfaceByTile || {}).length, built.floor.length, 'every cavern floor tile must get a rendered-surface Y sample');
assert(Number.isFinite(built.floorSurfaceY), 'cavern synthesis must expose a finite fallback floor surface Y');
assert.strictEqual(built.floor.length, Object.keys(banubu.tiles).length);
assert.strictEqual(carveCall.floor.length, built.floor.length, 'the exact painted locale footprint must be handed to the cavern sculptor');
assert.deepStrictEqual(carveCall.options.entrance, { col: 6, row: 10, side: 'north' });
assert.strictEqual(built.keyGatedDoors[0].requiresKeyItem, 'color_pools_key');
assert.deepStrictEqual(JSON.parse(JSON.stringify(built.entrySpots.color_pools_door)), { col: 6, row: 1, side: 'north' });
assert(built.npcStations.some(station => station.id === 'station_banubu_cave_sleep' && station.pose === 'lie' && station.col === 6 && station.row === 5), 'Banubu\'s single physical sleeping station must stay at its latest authored location');
assert.strictEqual(built.npcStations.filter(station => station.npcId === 'banubu').length, 1, 'Banubu cavern must register one physical Banubu station, not separate awake/sleep NPC copies');
assert(!built.npcStations.some(station => station.id === 'station_banubu_cave_awake'), 'unused awake Banubu station must stay removed');
assert.deepStrictEqual(JSON.parse(JSON.stringify(built.cinematicCameras)), banubu.cinematicCameras, 'locale cavern synthesis must preserve authored cinematic camera records');

const sculptorSource = read('docs/js/cavern-sculptor.js');
const generatorSource = read('docs/js/cavern-generator.js');
const gameSource = read('docs/game.js');
const editorSource = read('docs/tools/locale-editor/index.html');
const interiorBuilderSource = read('docs/js/interior-scene-builder.js');
const localePreview3dSource = read('docs/tools/locale-editor/locale-preview3d.js');
const panelUiSource = read('docs/js/panel-ui.js');
const naturalSurfaceSource = read('docs/js/natural-surface-materials.js');
assert(sculptorSource.includes('function carveFootprintCavern(') && sculptorSource.includes('carveMazeCavern, carveFootprintCavern'), 'shared cavern sculptor must expose footprint-driven generation');
assert(generatorSource.includes('loadLocaleCavernDefinition') && generatorSource.includes('synthesizeLocaleCavernMapData'), 'runtime must resolve cave interiors through locale files');
assert(!generatorSource.includes("seedText === 'map_i_den_banubu'"), 'generic generator must not special-case Banubu by seed/map id');
assert(!generatorSource.includes('isBanubuHome'), 'Banubu-specific interior synthesis must be removed');
assert(gameSource.includes('loadLocaleCavernDefinition?.(mapId)') && gameSource.includes("loadSource = 'locale-cavern'"), 'building loader must prefer cave-interior locales');
assert(gameSource.includes('(!x.requiresKeyItem || !!window.KeyItemSystem?.has?.(x.requiresKeyItem))'), 'key-gated cave connectors must be mechanically inaccessible without their key');
assert(gameSource.includes("targetSpotId: exit.targetSpotId || ''") && gameSource.includes("_pendingEntrySpotId"), 'cave-to-cave travel must preserve named connector destinations across async generation');
assert(gameSource.includes('entranceLightTileSet'), 'secret exits must not affect the primary cave-mouth daylight');
assert(generatorSource.includes('function sampleMeshSurfaceAt(') && generatorSource.includes('floorSurfaceByTile: floorSurface.byTile'), 'cavern generation must sample the rendered shell and export per-tile ground Y');
assert(interiorBuilderSource.includes('function buildCavernFloorMesh(') && interiorBuilderSource.includes('cavernWalkableFloor'), 'caverns must render an explicit merged textured walkable floor');
assert(gameSource.includes('const exactSurfaceY = Number(tile?.surfaceY)') && gameSource.includes('bGrid[r][c].surfaceY = sampledSurfaceY'), 'player tile grounding must consume the exact cavern floor surface sample');
assert(gameSource.includes(': (_isZoneArea(area) ? surfaceYAtWorld(area, c + 0.5, r + 0.5) : tileSurfaceYInArea(tile, area))'), 'NPC building grounding must share the exact tile surface resolver with the player');
assert(!gameSource.includes('_isBuildingArea(area) ? 0 : npcSurfaceY(area, spawnPos.c, spawnPos.r)'), 'NPC building transfers must never force Y=0');
assert(gameSource.includes('InteriorSceneBuilder.buildCavernFloorMesh?.('), 'game cavern scenes must add the explicit textured walkable floor mesh');
assert(gameSource.includes('mapData.denMotherKind || mapData.cavernCreatureKind'), 'authored caverns must select texture family from their authored creature habitat');
assert(editorSource.includes('value="cave_interior"') && editorSource.includes('cavernSeed') && editorSource.includes('raw.cavern'), 'Locale Editor must author and preserve cave-interior generator metadata');
assert(localePreview3dSource.includes("currentPreviewMode = canRenderInterior ? 'interior' : 'exterior'"), 'cave_interior locales must default the live 3D preview to their generated cavern interior');
assert(localePreview3dSource.includes('CavernGenerator.synthesizeLocaleCavernMapData(locale)'), 'Locale Editor cavern preview must synthesize the same authored footprint map data as runtime');
assert(localePreview3dSource.includes('InteriorSceneBuilder.buildCarvedCavernMesh') && localePreview3dSource.includes('InteriorSceneBuilder.buildCavernFloorMesh'), 'Locale Editor cavern preview must render the shared runtime cavern shell and walkable floor');
assert(localePreview3dSource.includes("id=\"localeSandboxCamera\"") && localePreview3dSource.includes('applySelectedCinematicCamera'), 'Locale Editor 3D preview must allow looking through authored cinematic cameras');
assert(localePreview3dSource.includes("id=\"localeCavernWireframe\"") && localePreview3dSource.includes('applyCavernWireframe'), 'Locale Editor cavern preview must expose a shell wireframe diagnostic');
assert(localePreview3dSource.includes('ambientLight.intensity = interior ? 0.15 : 0.7') && localePreview3dSource.includes('sunLight.intensity = interior ? 0.08 : 1.1') && localePreview3dSource.includes('scene.fog = interior ? null'), 'cavern preview lighting/background must mirror the live den-interior scene instead of wilderness lighting');
assert(localePreview3dSource.includes('const authored = currentLocale?.cinematicCameras?.[0]'), 'cavern orbit inspection must start inside the shell from an authored camera when one exists');
assert(localePreview3dSource.includes("return localeSignature(locale) + '|preview:' + currentPreviewMode"), 'Locale preview must compare the same mode-qualified signature it stores after regeneration');
assert(localePreview3dSource.includes('const signature = previewSignature(locale);') && !localePreview3dSource.includes("const signature = localeSignature(locale) + '|preview:' + currentPreviewMode;"), 'Locale preview polling must not force a cavern SDF rebuild every 500 ms');
assert(localePreview3dSource.includes('let renderDirty = true') && localePreview3dSource.includes('if (!renderDirty) return;'), 'Locale preview must render on demand instead of redrawing a static scene every animation frame');
assert(localePreview3dSource.includes('renderer.shadowMap.enabled = false') && localePreview3dSource.includes('Math.min(1.25, window.devicePixelRatio || 1)'), 'Locale preview should avoid preview-only shadow and high-DPI GPU costs');
assert(localePreview3dSource.includes('cavern: locale.cavern,') && !localePreview3dSource.includes('cavern: locale.cavern, cinematicCameras: locale.cinematicCameras'), 'cavern geometry invalidation must ignore cinematic-camera-only edits so slider drags never re-run SDF generation');
assert(localePreview3dSource.includes('id="localeCameraSliderPanel"') && localePreview3dSource.includes('data-camera-slider="position.x"') && localePreview3dSource.includes('data-camera-slider="target.y"') && localePreview3dSource.includes('data-camera-slider="fovDeg"'), 'camera preview must expose live position, target, and FOV sliders while looking through the shot');
assert(localePreview3dSource.includes('updateCameraFromSlider(input, false)') && localePreview3dSource.includes('updateCameraFromSlider(input, true)'), 'camera sliders must preview continuously but commit only on slider release/change');
assert(localePreview3dSource.includes('window._localeEditorBridge?.updateCinematicCamera?.'), 'camera slider commits must persist through the Locale Editor workspace bridge without rebuilding geometry');
assert(localePreview3dSource.includes("const uniqueNpcIds = [...new Set") && localePreview3dSource.includes("marker.name = 'localeSandboxCavernNpc_' + npcId"), 'cavern preview must render one visible marker per NPC id even when a locale has several station anchors');
assert(localePreview3dSource.includes("record?.targetNpcId && path.startsWith('target.')") && localePreview3dSource.includes('Face offset'), 'NPC-targeted preview sliders must be small face-relative offsets rather than map-coordinate target sliders');
assert(localePreview3dSource.includes('previewNpcFacePosition') && localePreview3dSource.includes('resolvedPreviewCameraTarget'), 'Locale preview must resolve authored NPC target offsets from the preview NPC face');
assert(localePreview3dSource.includes("../../config/attachment-rig-profiles.js") && localePreview3dSource.includes('chatheadFrame'), 'Locale preview must use the source-controlled species face frame instead of a generic height guess');
assert(localePreview3dSource.includes('const grehlrBaseWidth = 2.2') && localePreview3dSource.includes('const banubuScaleMultiplier = 3') && localePreview3dSource.includes("anchor.pose === 'lie'"), 'Banubu camera preview must match his canonical Grehlr dimensions, named-animal scale, and sleep flattening');
assert(editorSource.includes('updateCinematicCamera: (localeId, cameraId, next) =>'), 'Locale Editor bridge must persist live preview camera edits');
assert(editorSource.includes('cinematicCameras: m.cinematicCameras || []') && editorSource.includes('cavern: m.cavern || null'), 'Locale JSON export must retain cinematic cameras and cavern metadata');
assert(panelUiSource.includes('locale-preview3d.js?v=20260922npctarget2'), 'Locale Editor must cache-bust the corrected visible-face camera preview sidecar');
assert(naturalSurfaceSource.includes('NATURAL_SURFACE_SCRIPT_SRC') && naturalSurfaceSource.includes("new URL('../' + raw.replace"), 'shared natural-surface textures must resolve from their script path so nested editor previews use the same assets as the game');
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

console.log('Locale-authored cavern footprint, fixed-seed synthesis, keyed connector, and editor integration checks passed');
