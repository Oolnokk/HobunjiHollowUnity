'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const json = p => JSON.parse(read(p));

const core = read('docs/js/interior-fire-floor-runtime.js');
const integration = read('docs/js/interior-fire-floor-integration.js');
const vessel = read('docs/js/furniture-vessel-runtime.js');
const temple = json('docs/config/maps/map_i_temple.json');

assert.doesNotThrow(() => new vm.Script(core, { filename: 'interior-fire-floor-runtime.js' }));
assert.doesNotThrow(() => new vm.Script(integration, { filename: 'interior-fire-floor-integration.js' }));
assert.doesNotThrow(() => new vm.Script(vessel, { filename: 'furniture-vessel-runtime.js' }));

assert(core.includes("campfireFurniture"), 'core runtime must register a real campfire furniture item');
assert(core.includes("bonfireFurniture"), 'core runtime must register a real bonfire furniture item');
assert(core.includes('const scale = 2'), 'bonfire must derive from the campfire at exactly double visual scale');
assert(core.includes("id: 'candle_table_fire'"), 'candle tables must receive the small authored fire emitter');
assert(core.includes('floorStyle'), 'runtime must support per-map floorStyle data');
assert(core.includes('tilesPerTile'), 'floor style must expose texture density in textures per tile');
assert(core.includes('applyFloorStyleToScene'), 'loaded building scenes must receive authored floor style');

assert(integration.includes("BONFIRE_ITEM_KEY = 'bonfireFurniture'"), 'integration must keep bonfire placement centered on one authored tile');
assert(integration.includes("defs[BONFIRE_ITEM_KEY].fw = 1"), 'bonfire game footprint must remain one tile despite doubled visuals');
assert(integration.includes("campfireFurniture"), 'Interior Editor catalog must expose Campfire');
assert(integration.includes("bonfireFurniture"), 'Interior Editor catalog must expose Bonfire');
assert(integration.includes("biaFloorTexture"), 'Interior Editor must expose the PNG floor texture field');
assert(integration.includes("biaFloorTint"), 'Interior Editor must expose the floor tint field');
assert(integration.includes("biaFloorRepeat"), 'Interior Editor must expose textures-per-tile');

assert(vessel.includes('loadInteriorFireFloorCompanions'), 'normal furniture bootstrap must install fire/floor companions');
assert(vessel.includes('interior-fire-floor-runtime.js'), 'normal game/editor bootstrap must load the shared core runtime');
assert(vessel.includes('interior-fire-floor-integration.js'), 'normal game/editor bootstrap must load the integration layer');

assert.deepStrictEqual(temple.floorStyle, {
  texture: 'carved_smooth.png',
  tint: '#808080',
  tilesPerTile: 4,
}, 'updated church must use the requested gray carved_smooth floor at four textures per tile');

const communion = (temple.layouts || []).find(layout => layout.id === 'spirit_communion');
assert(communion, 'updated church must retain the Spirit Communion layout');
const bonfire = communion.furniture.find(piece => piece.id === 'sc_bonfire');
assert(bonfire, 'Spirit Communion must use the real bonfire');
assert.strictEqual(bonfire.itemKey, 'bonfireFurniture');
assert.deepStrictEqual([bonfire.col, bonfire.row], [9, 9], 'bonfire must remain centered on the counsel target tile');
assert.deepStrictEqual([bonfire.postSX, bonfire.postSY, bonfire.postSZ], [1, 1, 1],
  'bonfire must not retain the placeholder campfire extra scale because the preset is already doubled');
assert(!communion.furniture.some(piece => piece.itemKey === 'campfireKitFurniture'),
  'updated church must not retain the Campfire Kit placeholder');

assert(communion.furniture.some(piece => piece.id === 'sc_bench_w1' && piece.row === 3),
  'uploaded church west-bench repositioning must be preserved');
assert(communion.furniture.some(piece => piece.id === 'sc_bench_e1' && piece.col === 13),
  'uploaded church east-bench repositioning must be preserved');
assert(communion.furniture.some(piece => piece.id === 'fmtspjum0bi6z' && piece.itemKey === 'tableLongFurniture'),
  'uploaded church added long table must be preserved');
assert(communion.furniture.filter(piece => piece.itemKey === 'candleTableFurniture').length === 2,
  'uploaded church candle tables must remain present for the new candle flame VFX');

console.log('interior fire/floor + updated church regression checks: PASS');
