'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const configSource = read('docs/js/shipping-box-config.js');
const worldSource = read('docs/js/shipping-box-world.js');
const storeSource = read('docs/js/general-store.js');
const gameSource = read('docs/game.js');
const shippingBox = JSON.parse(read('docs/config/furniture-authored/shippingBox.json'));

const configContext = { window: {} };
vm.runInNewContext(configSource, configContext, { filename: 'shipping-box-config.js' });
const config = configContext.window.ShippingBoxConfig;
assert.ok(config, 'ShippingBoxConfig is exported');

// First-class authored furniture database entry and one configured material policy.
assert.strictEqual(shippingBox.key, config.object.authoredFurnitureKey);
assert.deepStrictEqual(shippingBox.footprint, { w: config.object.footprint.width, d: config.object.footprint.height });
assert.strictEqual(shippingBox.parts.length, 7, 'Shipping Box is body + lid panel + four rim strips + lock');
assert.ok(shippingBox.parts.every(part => part.materialTexture === config.material.texture), 'every authored Shipping Box part uses the configured PNG');
assert.ok(shippingBox.parts.every(part => part.textureTransparent === config.material.transparent), 'authored transparency matches config');

const woodParts = shippingBox.parts.filter(part => part.materialRole === 'wood');
const metalParts = shippingBox.parts.filter(part => part.materialRole === 'metal');
assert.deepStrictEqual(woodParts.map(part => part.id).sort(), [config.object.parts.body, config.object.parts.lid].sort());
assert.strictEqual(new Set(woodParts.map(part => part.color.toUpperCase())).size, 1, 'body and lid use exactly the same wood tint');
assert.strictEqual(metalParts.length, 5, 'only four lid-rim strips and the lock are metal');
assert.ok(metalParts.every(part => part.id === config.object.parts.lock || part.id.startsWith(config.object.parts.lidRimPrefix)), 'metal is restricted to configured rim/lock parts');
assert.ok(metalParts.every(part => part.color.toUpperCase() === config.material.copperVerdigris.toUpperCase()), 'metal uses configured native-copper verdigris');
assert.match(gameSource, new RegExp(`nativeCopper:\\s*\\{[\\s\\S]{0,300}?verdigrisHex:'${config.material.copperVerdigris}'`), 'Shipping Box verdigris matches the weapon/native-copper source of truth');

// Runtime waits for the PNG itself, then puts a resolved clone onto every part
// and restores the authored tint. This protects body/lid from async texture reset.
assert.match(worldSource, /authored\.load\(object\.authoredFurnitureKey\)/, 'world renderer loads the configured furniture key');
assert.match(worldSource, /await enforceConfiguredMaterials\(group\)/, 'world waits for configured material enforcement');
assert.match(worldSource, /material\.forceTextureOnEveryPart \? material\.texture : part\.materialTexture/, 'configured PNG can be forced onto every authored part');
assert.match(worldSource, /meshMaterial\.map = texture/, 'resolved texture clone is explicitly assigned to every material');
assert.match(worldSource, /meshMaterial\.color\.set\(part\.color\)/, 'authored tint is restored after PNG assignment');
assert.doesNotMatch(worldSource, /authored\.load\(['"]chest['"]\)/, 'world renderer never aliases Storage Chest');
assert.doesNotMatch(worldSource, /carved_smooth\.png/, 'world implementation does not hardcode texture filename');
assert.doesNotMatch(worldSource, /#3FAF9F/i, 'world implementation does not hardcode verdigris');
assert.doesNotMatch(storeSource, /Shipping Box world presentation\/footprint upgrade/, 'General Store no longer contains Shipping Box world implementation');
assert.match(storeSource, /shipping-box-config\.js/, 'General Store parser slot loads ShippingBoxConfig before game boot');
assert.match(storeSource, /shipping-box-world\.js/, 'dedicated world adapter loads before game boot');

// Replacing the fallback must work on the game's older Three.js runtime too.
// Do not rely solely on Object3D.removeFromParent(); hide first and use the
// universally available parent.remove(root) path before disposing resources.
assert.match(worldSource, /function detachRoot\(root\)[\s\S]*root\.visible = false/, 'legacy fallback is hidden immediately before detach');
assert.match(worldSource, /root\.parent\?\.remove[\s\S]*root\.parent\.remove\(root\)/, 'fallback uses parent.remove for Three.js r128 compatibility');
assert.match(worldSource, /function disposeRoot\(root\)[\s\S]*detachRoot\(root\)/, 'resource disposal always detaches the visual first');
assert.match(worldSource, /group\.position\.set\([\s\S]*scene\.add\(group\)[\s\S]*disposeRoot\(oldBody\)/, 'authored group is positioned before the fallback is removed');

// Footprint registration is generic over configured width × height.
assert.match(worldSource, /for \(let dz = 0; dz < height; dz\+\+\)/, 'footprint is generated from configured height');
assert.match(worldSource, /for \(let dx = 0; dx < width; dx\+\+\)/, 'footprint is generated from configured width');
assert.match(worldSource, /wanted\.forEach\(key => map\.set\(key, box\)\)/, 'all configured cells register the same world object');
assert.match(worldSource, /box\.blocksMovement = !!object\.blocksMovement/, 'collision flag is config-driven');

const worldObjects = new Map();
const makeMockBox = (col, row) => {
  const position = { col, row };
  const mesh = { parent: null };
  return {
    id: config.object.id, type: config.object.type, mesh, lid: null,
    get col() { return position.col; },
    set col(value) { position.col = Number(value); },
    get row() { return position.row; },
    set row(value) { position.row = Number(value); },
    moveTo(nextCol, nextRow) { position.col = Number(nextCol); position.row = Number(nextRow); return { col: position.col, row: position.row }; },
    refreshVisual() {}, depositItem() { return 0; }, withdrawItem() { return 0; }, tick() {}, reset() {}, onAction() {},
    getTotalItems() { return 0; },
  };
};
const context = {
  console,
  window: {
    ShippingBoxConfig: config,
    FarmCrates: { makeSellCrate: (col, row) => makeMockBox(col, row) },
    FarmPanel: { init() {} },
    AuthoredFurniture: {},
  },
};
context.window.window = context.window;
vm.runInNewContext(worldSource, context, { filename: 'shipping-box-world.js' });
context.window.FarmPanel.init({ worldObjects });
const box = context.window.FarmCrates.makeSellCrate(4, 7);
const expectedInitial = [];
for (let dz = 0; dz < config.object.footprint.height; dz++) {
  for (let dx = 0; dx < config.object.footprint.width; dx++) expectedInitial.push(`${4 + dx},${7 + dz}`);
}
expectedInitial.forEach(key => assert.strictEqual(worldObjects.get(key), box, `${key} is occupied by Shipping Box`));
assert.strictEqual(box.blocksMovement, config.object.blocksMovement);
assert.strictEqual(box.w, config.object.footprint.width);
assert.strictEqual(box.h, config.object.footprint.height);

box.moveTo(9, 3);
expectedInitial.forEach(key => assert.strictEqual(worldObjects.has(key), false, `${key} clears after move`));
for (let dz = 0; dz < config.object.footprint.height; dz++) {
  for (let dx = 0; dx < config.object.footprint.width; dx++) assert.strictEqual(worldObjects.get(`${9 + dx},${3 + dz}`), box);
}

console.log('shipping box config/material/footprint regression checks passed');
