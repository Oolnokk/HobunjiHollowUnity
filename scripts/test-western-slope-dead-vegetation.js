'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/game.js', 'utf8'); // Executes the shipped render dispatch and harvesting decisions.
const dispatch = source.slice(source.indexOf('              const isDeadTree ='), source.indexOf('              if (isDeadTree || isCrownedPine || isShadewood)'));
const names = ['buildDeadTreeMesh', 'buildDeadBushMesh', 'buildCrownedPineMesh', 'buildShadewoodMesh', 'buildWildernessBushMesh', 'buildStumpMesh', 'buildShrubMesh']; // Builder stubs identify which actual branch ran.
const FoliageGenerator = Object.fromEntries(names.map(name => [name, () => name]));
const render = new Function('window', 'mapId', 'tile', 'EXTERIOR_ZONES', 'c', 'r', dispatch + '; return vegGroup;'); // Runtime dispatch, not a copy of its logic.
for (const kind of ['copse', null, undefined]) assert.equal(render({ FoliageGenerator }, 'map_western_slope', { floraKind: kind }, {}, 2, 3), 'buildDeadTreeMesh');
for (const kind of ['bush', 'fruitBush', 'mushroomPatch', 'beehive']) assert.equal(render({ FoliageGenerator }, 'map_western_slope', { floraKind: kind }, {}, 2, 3), 'buildDeadBushMesh');
assert.equal(render({ FoliageGenerator }, 'map_northern_cliffs', { floraKind: 'copse' }, {}, 2, 3), 'buildCrownedPineMesh');
assert.equal(render({ FoliageGenerator }, 'map_southern_cloud_forest', { floraKind: 'copse' }, { map_southern_cloud_forest: { cloudForest: true } }, 2, 3), 'buildShadewoodMesh');
const harvest = source.slice(source.indexOf('      function isChoppableTreeTile('), source.indexOf('      // A generator-placed ore rock')); // Original hold gating and inventory reward key.
const grid = [[{ type: 'shrub', floraKind: 'copse' }]]; // A saved generated slope tree.
const canChop = new Function('window', 'currentArea', 'TileType', harvest + '; return [isChoppableTreeTile(0,0), treeLogItemKey()];');
assert.deepEqual(canChop({ GridTileAccessors: { getActiveGrid: () => grid } }, 'map_western_slope', { SHRUB: 'shrub' }), [true, 'pineLog']);
grid[0][0].floraKind = 'bush';
assert.equal(canChop({ GridTileAccessors: { getActiveGrid: () => grid } }, 'map_western_slope', { SHRUB: 'shrub' })[0], false);
new vm.Script(fs.readFileSync('docs/js/foliage-generator.js', 'utf8')); // Includes the actual leafless geometry branch in syntax validation.
console.log('Western Slope saved vegetation dispatch, tree hold gating and compatible pine log rewards passed.');

// Run the actual axe reward branch, then the actual daily regrowth owner.
const tile = { type: 'shrub', floraKind: 'copse' }; // Saved slope copse metadata must survive felling and regrowth.
const persisted = new Map(); // Exact per-zone felling history saved by gameplay.
const inventory = { pineLog: 0, mulch: 0 }; // These are the existing any-wood inventory keys.
let removedTrees = 0; // Visual side effects must remove one tree without an immediate whole-zone rebuild.
const choppingWindow = { GridTileAccessors: { getActiveGrid: () => [[tile]] }, InventoryStacks: { MAX_TOTAL: 999 }, HobunjiFoodProcessing: { rollTreeNutDrop: () => null } };
const runtime = vm.createContext({ window: choppingWindow, currentArea: 'map_western_slope', TileType: { SHRUB: 'shrub', GRASS: 'grass' }, CropType: { NONE: null },
  col: 0, row: 0, tool: 'axe', action: 'chop', tile, inventory, calendar: { day: 3 }, rnd: () => 0,
  ITEM_DEFS: { pineLog: { label: 'Pine Log' } }, _zoneFelledTreePersist: persisted,
  removeZoneVegetationVisual() { removedTrees++; return true; }, awardToolUseMasteryXp() {},
}); // Only existing game services are mocked; the harvest code is executed directly.
vm.runInContext(harvest, runtime);
const chopStart = source.indexOf("        if (tool === 'axe' && action === 'chop' && isChoppableTreeTile(col, row)) {");
const chopEnd = source.indexOf("        if (tool === 'pick' && action === 'mine' && isMineableRockTile(col, row)) {", chopStart);
const result = vm.runInContext('(function(){' + source.slice(chopStart, chopEnd) + '})()', runtime); // Actual applied inventory and persistence output, rather than only the reward-key selector.
assert.equal(result.ok, true);
assert.equal(inventory.pineLog, 2);
assert.equal(inventory.mulch, 1);
assert.equal(tile.type, 'grass');
assert.equal(tile.floraKind, 'copse');
assert.equal(persisted.get('map_western_slope')[0].feltDay, 3);
assert.equal(removedTrees, 1);
vm.runInContext(fs.readFileSync('docs/js/zone-regrowth.js', 'utf8'), runtime);
choppingWindow.ZoneRegrowth.init({ _zoneFelledTreePersist: persisted, _zoneScenes: new Map([['map_western_slope', { grid: [[tile]] }]]),
  calendar: { day: 10 }, TREE_REGROWTH_DAYS: 7, TileType: { SHRUB: 'shrub' }, getCurrentArea: () => 'town',
}); // Offscreen regrowth still updates the stored grid; later scene dispatch uses the untouched copse metadata.
choppingWindow.ZoneRegrowth.tickFelledTreeRegrowth();
assert.equal(tile.type, 'shrub');
assert.equal(tile.floraKind, 'copse');
assert.equal(persisted.has('map_western_slope'), false);
assert.equal(render({ FoliageGenerator }, 'map_western_slope', tile, {}, 0, 0), 'buildDeadTreeMesh');
console.log('Western Slope actual axe yields, felling persistence and offscreen regrowth passed.');

// Regress the actual production natural-surface wrapper: both leafless builders
// should receive the identical crowned-pine bark PNG, tint and full-mesh UV fit.
const foliageCode = fs.readFileSync('docs/js/foliage-generator.js', 'utf8'); // Checks source presets rather than a second hard-coded tint in the test.
for (const species of ['deadTree', 'deadBush']) {
  assert.match(foliageCode, new RegExp('TREE_PRESETS\\.' + species + '\\s*=\\s*\\{[^;]*barkColorHex:\\s*TREE_PRESETS\\.crownedPine\\.barkColorHex'));
}
const naturalCode = fs.readFileSync('docs/js/natural-surface-materials.js', 'utf8'); // Executes the live material/UV adapter with lightweight Three mocks.
const naturalConfigCode = fs.readFileSync('docs/config/natural-surface-materials.js', 'utf8'); // Reads the same configurable trunk PNG path as live trees.
class BarkTestColor {
  constructor(value) {
    const hex = typeof value === 'number' ? value : parseInt(String(value).replace('#', ''), 16); // Mock source/override color used for tint quantization.
    this.isColor = true;
    this.r = ((hex >>> 16) & 255) / 255;
    this.g = ((hex >>> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
  }
}
let nextTextureId = 0; // Distinguishes created mock PNG textures to verify material-cache sharing.
const barkThree = {
  Color: BarkTestColor,
  CanvasTexture: class {
    constructor(image) { this.image = image; this.uuid = 'bark-test-' + (++nextTextureId); this.userData = {}; }
  },
  MeshBasicMaterial: class {
    constructor(options) { Object.assign(this, options); this.isMeshBasicMaterial = true; this.userData = {}; }
  },
  BufferAttribute: class {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
  },
  ClampToEdgeWrapping: 1001,
  RepeatWrapping: 1002,
};
function makeBarkTestGroup() {
  const position = { // Geometry spans height 2 and radius 1, making the UV normalization observable.
    count: 4,
    getX: i => [1, 0, -1, 0][i],
    getY: i => [0, 1, 2, 1][i],
    getZ: i => [0, 1, 0, -1][i],
  };
  const geometry = {
    attributes: { position },
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, attribute) { this.attributes[name] = attribute; },
    computeBoundingBox() { this.boundingBox = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } }; },
  };
  const mesh = { isMesh: true, geometry, material: { color: new BarkTestColor(0x4a3b33), isMeshLambertMaterial: true }, userData: {} };
  return { children: [mesh] };
}
const barkBuilders = Object.fromEntries(
  ['buildCrownedPineMesh', 'buildDeadTreeMesh', 'buildDeadBushMesh'].map(name => [name, makeBarkTestGroup])
); // All builder outputs enter NaturalSurfaceMaterials through the same original FoliageGenerator API.
const barkWindow = { THREE: barkThree, FoliageGenerator: barkBuilders }; // Production wrapper installs on this namespace.
vm.runInNewContext(naturalConfigCode, { window: barkWindow });
const barkCanvasDocument = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) }; // No browser required for initial tinted-PNG placeholder.
class BarkTestImage { set src(value) { this.requestedPath = value; } } // Keeps authored PNG load inert; inspect its material request instead.
vm.runInNewContext(naturalCode, { window: barkWindow, document: barkCanvasDocument, Image: BarkTestImage, console });
const pineBark = barkBuilders.buildCrownedPineMesh(0, 0).children[0]; // Baseline uses the real crowned-pine wrapper branch.
const barkTexturePath = barkWindow.NaturalSurfaceMaterialConfig.surfaces.trunks.texture; // Authored path comes from config (not a guessed filename).
const pineTint = pineBark.material.map.userData.naturalSurfaceBodySpriteTintTarget; // Resolved/cached color of the original pine wood.
for (const name of ['buildDeadTreeMesh', 'buildDeadBushMesh']) {
  const mesh = barkBuilders[name](0, 0).children[0]; // Calls the production FoliageGenerator wrapper, not a copied function.
  assert.equal(mesh.userData.naturalSurface, 'trunks', name + ' must be recognized as wooden foliage');
  assert.equal(mesh.geometry.userData.naturalSurfaceUvMapping, 'cylindrical-stretch', name + ' must stretch-map like a pine');
  assert.equal(mesh.geometry.attributes.uv.array.length, 8, name + ' must create one UV per position');
  assert.equal(mesh.geometry.attributes.uv.array[1], 0, name + ' must start the bark texture at the root');
  assert.equal(mesh.geometry.attributes.uv.array[5], 1, name + ' must reach the bark top');
  assert.equal(mesh.material.map.userData.hobunjiAuthoredSurfacePath, barkTexturePath, name + ' must use the pine PNG');
  assert.equal(mesh.material.map.userData.naturalSurfaceBodySpriteTintTarget, pineTint, name + ' must match the pine bark tint');
  assert.strictEqual(mesh.material.map, pineBark.material.map, name + ' should reuse the same tinted PNG cache entry');
}
console.log('Western Slope leafless trunks/bushes use crowned-pine stretch UVs, tint, and cached bark PNG: PASS');

const indexHtml = fs.readFileSync('docs/index.html', 'utf8'); // Runtime HTML must request freshly versioned foliage and house loaders after this change.
const houseLoader = fs.readFileSync('docs/js/house-pieces.js', 'utf8'); // The house loader must in turn request the new NaturalSurfaceMaterials wrapper.
const foliageVersion = indexHtml.match(/js\/foliage-generator\.js\?v=([A-Za-z0-9_-]+)/)?.[1]; // Cache generation for the actual procedural leafless geometry builder.
const houseVersion = indexHtml.match(/js\/house-pieces\.js\?v=([A-Za-z0-9_-]+)/)?.[1]; // Cache generation for the authoritative natural-surface child loader.
const naturalVersion = houseLoader.match(/'natural-surface-materials\.js\?v=([A-Za-z0-9_-]+)'/)?.[1]; // Cache generation for the new dead-tree/dead-bush wrapper registrations.
assert(foliageVersion, 'the shipped game must load a cache-busted foliage-generator.js (any token; check-cache-busts.js keeps it current)');
assert(houseVersion, 'the shipped game must load a cache-busted house-pieces.js (any token; check-cache-busts.js keeps it current)');
assert(naturalVersion, 'house-pieces.js must load a cache-busted natural-surface-materials.js (any token; check-cache-busts.js keeps it current)');
assert(fs.existsSync('docs/' + barkTexturePath), 'the authored trunk PNG requested by the pine and leafless vegetation must exist');
console.log('Western Slope PNG asset and mobile game cache-generation checks: PASS');
