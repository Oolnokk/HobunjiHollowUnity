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
assert.strictEqual(built.floor.length, Object.keys(banubu.tiles).length);
assert.strictEqual(carveCall.floor.length, built.floor.length, 'the exact painted locale footprint must be handed to the cavern sculptor');
assert.deepStrictEqual(carveCall.options.entrance, { col: 6, row: 10, side: 'south' });
assert.strictEqual(built.keyGatedDoors[0].requiresKeyItem, 'color_pools_key');
assert.deepStrictEqual(JSON.parse(JSON.stringify(built.entrySpots.color_pools_door)), { col: 6, row: 1, side: 'north' });
assert(built.npcStations.some(station => station.id === 'station_banubu_cave_sleep' && station.pose === 'lie'));

const sculptorSource = read('docs/js/cavern-sculptor.js');
const generatorSource = read('docs/js/cavern-generator.js');
const gameSource = read('docs/game.js');
const editorSource = read('docs/tools/locale-editor/index.html');
assert(sculptorSource.includes('function carveFootprintCavern(') && sculptorSource.includes('carveMazeCavern, carveFootprintCavern'), 'shared cavern sculptor must expose footprint-driven generation');
assert(generatorSource.includes('loadLocaleCavernDefinition') && generatorSource.includes('synthesizeLocaleCavernMapData'), 'runtime must resolve cave interiors through locale files');
assert(!generatorSource.includes("seedText === 'map_i_den_banubu'"), 'generic generator must not special-case Banubu by seed/map id');
assert(!generatorSource.includes('isBanubuHome'), 'Banubu-specific interior synthesis must be removed');
assert(gameSource.includes('loadLocaleCavernDefinition?.(mapId)') && gameSource.includes("loadSource = 'locale-cavern'"), 'building loader must prefer cave-interior locales');
assert(gameSource.includes('(!x.requiresKeyItem || !!window.KeyItemSystem?.has?.(x.requiresKeyItem))'), 'key-gated cave connectors must be mechanically inaccessible without their key');
assert(gameSource.includes("targetSpotId: exit.targetSpotId || ''") && gameSource.includes("_pendingEntrySpotId"), 'cave-to-cave travel must preserve named connector destinations across async generation');
assert(gameSource.includes('entranceLightTileSet'), 'secret exits must not affect the primary cave-mouth daylight');
assert(editorSource.includes('value="cave_interior"') && editorSource.includes('cavernSeed') && editorSource.includes('raw.cavern'), 'Locale Editor must author and preserve cave-interior generator metadata');
assert.strictEqual(fs.existsSync(path.join(root, 'docs/config/maps/map_i_color_pools.json')), false, 'Color Pools must not retain a competing static rectangular map definition');

console.log('Locale-authored cavern footprint, fixed-seed synthesis, keyed connector, and editor integration checks passed');
