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
const hunundiRoom = json('docs/config/maps/map_i_temple_basement_hunundi.json');

assert.doesNotThrow(() => new vm.Script(core, { filename: 'interior-fire-floor-runtime.js' }));
assert.doesNotThrow(() => new vm.Script(integration, { filename: 'interior-fire-floor-integration.js' }));
assert.doesNotThrow(() => new vm.Script(vessel, { filename: 'furniture-vessel-runtime.js' }));

assert(core.includes("campfireFurniture"), 'core runtime must register a real campfire furniture item');
assert(core.includes("bonfireFurniture"), 'core runtime must register a real bonfire furniture item');
assert(core.includes("name: 'Bonfire', icon: '🔥', fw: 2, fd: 2, procKey: 'bonfire'"),
  'bonfire runtime definition must have a real 2x2 footprint');
assert(core.includes('data.footprint = { w: 2, d: 2 }'),
  'derived authored bonfire data must retain the same 2x2 footprint');
assert(core.includes('const scale = 2'), 'bonfire must derive from the campfire at exactly double visual scale');
assert(core.includes("id: 'candle_table_fire'"), 'candle tables must receive the small authored fire emitter');
assert(core.includes('floorStyle'), 'runtime must support per-map floorStyle data');
assert(core.includes('tilesPerTile'), 'floor style must expose texture density in textures per tile');
assert(core.includes('applyFloorStyleToScene'), 'loaded building scenes must receive authored floor style');

assert(integration.includes("bonfireFurniture: Object.freeze({ key: 'bonfireFurniture', label: 'Bonfire', fw: 2, fd: 2"),
  'Interior Editor catalog compatibility entry must use the real 2x2 bonfire footprint');
assert(integration.includes("detail: '2x2 · centered on middle vertex'"),
  'Interior Editor must describe the bonfire as a centered 2x2 footprint');
assert(integration.includes("centerOffset: { x: 1, z: 1 }, anchor: 'center-vertex'"),
  'debug metadata must state the normal 2x2 center-vertex offset');
assert(!integration.includes('forceBonfireOneTile'), 'integration must never collapse the bonfire back to one tile');
assert(!integration.includes('defs[BONFIRE_ITEM_KEY].fw = 1'), 'gameplay footprint must not be overridden to one tile');
assert(integration.includes("campfireFurniture"), 'Interior Editor catalog must expose Campfire');
assert(integration.includes("bonfireFurniture"), 'Interior Editor catalog must expose Bonfire');
assert(integration.includes("biaFloorTexture"), 'Interior Editor must expose the PNG floor texture field');
assert(integration.includes("biaFloorTint"), 'Interior Editor must expose the floor tint field');
assert(integration.includes("biaFloorRepeat"), 'Interior Editor must expose textures-per-tile');
assert(integration.includes('function installEditorFloorMeshBridge()'),
  'Interior Editor must patch newly rebuilt floor meshes instead of trusting the wall-style-only material cache');
assert(integration.includes("geometry?.type === 'BoxGeometry'"),
  'floor preview bridge must narrowly identify the editor floor-tile geometry');
assert(integration.includes("Math.abs((p?.height ?? 0) - 0.08)"),
  'floor preview bridge must match the editor floor slab thickness');
assert(integration.includes("applyFloorStyleToMaterial?.(mat, style, '../../assets/')"),
  'floor preview bridge must apply the selected floorStyle to the cached shared floor material');
assert(integration.includes('THREE.Mesh = InteriorFloorAwareMesh'),
  'floor preview bridge must intercept later rebuilds even though the editor renderer already exists');

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
assert.deepStrictEqual([bonfire.col, bonfire.row], [9, 9], 'bonfire authored footprint origin must remain on the uploaded church coordinates');
assert.deepStrictEqual([bonfire.col + 1, bonfire.row + 1], [10, 10],
  'a 2x2 bonfire must center on the shared middle vertex, not a tile center');
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

assert.strictEqual(hunundiRoom.id, 'map_i_temple_basement_hunundi',
  'uploaded Father Hunundi room must replace the existing repo map under its canonical id');
assert.strictEqual(hunundiRoom.furniture.length, 7,
  'updated Father Hunundi room must retain all seven uploaded furniture records');
assert(hunundiRoom.furniture.some(piece => piece.id === 'fmtst9ykgmqf0' && piece.itemKey === 'chairSimpleFurniture' && piece.col === 9 && piece.row === 9 && piece.rotY === 180),
  'updated Father Hunundi room must retain the uploaded first added chair');
assert(hunundiRoom.furniture.some(piece => piece.id === 'fmtsteb7xjq80' && piece.itemKey === 'chairSimpleFurniture' && piece.col === 8 && piece.row === 9 && piece.rotY === 180),
  'updated Father Hunundi room must retain the uploaded second added chair');
assert.deepStrictEqual(hunundiRoom.entryPoints, [], 'uploaded Father Hunundi room entryPoints must be preserved');
assert.deepStrictEqual(hunundiRoom.layouts, [], 'uploaded Father Hunundi room layouts must be preserved');

console.log('interior fire/floor + floor preview + centered 2x2 bonfire + Hunundi room regression checks: PASS');
