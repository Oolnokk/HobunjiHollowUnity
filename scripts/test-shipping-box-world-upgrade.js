'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const worldSource = fs.readFileSync(path.join(root, 'docs/js/shipping-box-world.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'docs/js/general-store.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
const shippingBox = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/furniture-authored/shippingBox.json'), 'utf8'));

// First-class authored furniture database entry.
assert.strictEqual(shippingBox.key, 'shippingBox');
assert.deepStrictEqual(shippingBox.footprint, { w: 2, d: 1 });
assert.strictEqual(shippingBox.parts.length, 7, 'Shipping Box is body + lid panel + four rim strips + lock');
assert.ok(shippingBox.parts.every(part => part.materialTexture === 'carved_smooth.png'), 'every Shipping Box surface uses carved_smooth.png');
assert.ok(shippingBox.parts.every(part => part.textureTransparent === false), 'Shipping Box texture is opaque on side faces as well as top faces');

const woodParts = shippingBox.parts.filter(part => part.materialRole === 'wood');
const metalParts = shippingBox.parts.filter(part => part.materialRole === 'metal');
assert.deepStrictEqual(woodParts.map(part => part.id).sort(), ['shipping_box_body', 'shipping_box_lid_panel']);
assert.strictEqual(metalParts.length, 5, 'only four lid-rim strips and the lock are metal');
assert.ok(metalParts.every(part => /shipping_box_(?:lid_rim_|lock)/.test(part.id)), 'metal is restricted to lid rim and lock');
assert.ok(metalParts.every(part => part.color.toUpperCase() === '#3FAF9F'), 'metal uses native-copper weapon verdigris');
assert.match(gameSource, /nativeCopper:\s*\{[\s\S]{0,300}?verdigrisHex:'#3FAF9F'/, 'Shipping Box verdigris matches the weapon/native-copper source of truth');

// Runtime uses the Shipping Box database directly, not a stretched Storage Chest alias.
assert.match(worldSource, /const AUTHORED_KEY = 'shippingBox'/, 'world renderer names the Shipping Box authored database key');
assert.match(worldSource, /authored\.load\(AUTHORED_KEY\)/, 'world renderer loads shippingBox.json');
assert.doesNotMatch(worldSource, /authored\.load\('chest'\)/, 'world renderer no longer aliases Storage Chest');
assert.match(worldSource, /material\.color\.set\(part\.color\)/, 'authored color is multiplied back onto textured materials');
assert.match(worldSource, /top, bottom, front, back, left, and right surfaces/, 'all box surfaces are intentionally covered');
assert.match(worldSource, /id\.startsWith\('shipping_box_lid_rim_'\)/, 'all four rim meshes move with the lid');
assert.match(worldSource, /id === 'shipping_box_lock'/, 'the verdigris lock moves with the lid');
assert.doesNotMatch(storeSource, /Shipping Box world presentation\/footprint upgrade/, 'General Store no longer contains Shipping Box world implementation');
assert.match(storeSource, /shipping-box-world\.js/, 'dedicated Shipping Box module is loaded before game boot');

// Two-tile farm map/collision registration remains authoritative.
assert.match(worldSource, /`\$\{col\},\$\{row\}`[\s\S]*`\$\{col \+ 1\},\$\{row\}`/, 'Shipping Box footprint explicitly contains both horizontal tiles');
assert.match(worldSource, /wanted\.forEach\(key => map\.set\(key, box\)\)/, 'both Shipping Box tiles register the same world object');
assert.match(worldSource, /box\.blocksMovement = true/, 'Shipping Box declares blocking collision metadata');
assert.match(worldSource, /getOccupiedTiles/, 'Shipping Box exposes both occupied tiles for diagnostics');

// Runtime-smoke the footprint decorator without starting Three.js or the game.
const worldObjects = new Map();
const makeMockBox = (col, row) => {
  const position = { col, row };
  const mesh = { parent: null };
  return {
    id: 'sell_crate', type: 'sell_crate', w: 2, h: 1, mesh, lid: null,
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
    FarmCrates: { makeSellCrate: (col, row) => makeMockBox(col, row) },
    FarmPanel: { init() {} },
    AuthoredFurniture: {},
  },
};
context.window.window = context.window;
vm.runInNewContext(worldSource, context, { filename: 'shipping-box-world.js' });
context.window.FarmPanel.init({ worldObjects });
const box = context.window.FarmCrates.makeSellCrate(4, 7);
assert.strictEqual(worldObjects.get('4,7'), box, 'left Shipping Box tile is occupied');
assert.strictEqual(worldObjects.get('5,7'), box, 'right Shipping Box tile is occupied');
assert.strictEqual(box.blocksMovement, true, 'decorated Shipping Box blocks movement');
assert.deepStrictEqual(JSON.parse(JSON.stringify(box.getOccupiedTiles())), [{ col: 4, row: 7 }, { col: 5, row: 7 }]);
box.moveTo(9, 3);
assert.strictEqual(worldObjects.has('4,7'), false, 'old left tile clears after move');
assert.strictEqual(worldObjects.has('5,7'), false, 'old right tile clears after move');
assert.strictEqual(worldObjects.get('9,3'), box, 'new left tile is occupied after move');
assert.strictEqual(worldObjects.get('10,3'), box, 'new right tile is occupied after move');
box.col = 12;
assert.strictEqual(worldObjects.has('9,3'), false, 'direct col assignment clears the old left tile');
assert.strictEqual(worldObjects.has('10,3'), false, 'direct col assignment clears the old right tile');
assert.strictEqual(worldObjects.get('12,3'), box, 'direct col assignment registers the new left tile');
assert.strictEqual(worldObjects.get('13,3'), box, 'direct col assignment registers the new right tile');

console.log('shipping box authored-material + footprint regression checks passed');
