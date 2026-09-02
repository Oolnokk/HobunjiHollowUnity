'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const storeSource = fs.readFileSync(path.join(root, 'docs/js/general-store.js'), 'utf8');
const chest = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/furniture-authored/chest.json'), 'utf8'));

assert.match(storeSource, /`\$\{col\},\$\{row\}`[\s\S]*`\$\{col \+ 1\},\$\{row\}`/, 'Shipping Box footprint explicitly contains both horizontal tiles');
assert.match(storeSource, /keep\.forEach\(key => map\.set\(key, box\)\)/, 'both Shipping Box tiles register the same world object');
assert.match(storeSource, /box\.blocksMovement = true/, 'Shipping Box declares blocking collision metadata');
assert.match(storeSource, /getOccupiedTiles/, 'Shipping Box exposes both occupied tiles for diagnostics');
assert.match(storeSource, /authored\.load\('chest'\)/, 'Shipping Box loads the authored Chest furniture data');
assert.match(storeSource, /authored\.buildGroup\(\{ \.\.\.data, key: 'shippingBox', parts \}/, 'Shipping Box uses the authored furniture renderer');
assert.match(storeSource, /sx: Math\.max\(\.001, \(Number\(part\.transform\?\.sx\) \|\| \.001\) \* 2\)/, 'authored Chest geometry is stretched to two-tile width');
assert.ok(chest.parts.length >= 3, 'authored Chest has body/lid/latch parts');
assert.ok(chest.parts.every(part => part.materialTexture === 'carved_smooth.png'), 'authored Chest parts use carved_smooth.png');

// Runtime-smoke the footprint decorator without starting Three.js or the game.
const worldObjects = new Map();
const makeMockBox = (col, row) => {
  const position = { col, row };
  const mesh = { parent: null };
  const box = {
    id: 'sell_crate', type: 'sell_crate', w: 2, h: 1, mesh, lid: null,
    get col() { return position.col; },
    set col(value) { position.col = Number(value); },
    get row() { return position.row; },
    set row(value) { position.row = Number(value); },
    moveTo(nextCol, nextRow) { position.col = Number(nextCol); position.row = Number(nextRow); return { col: position.col, row: position.row }; },
    refreshVisual() {}, depositItem() { return 0; }, withdrawItem() { return 0; }, tick() {}, reset() {}, onAction() {},
    getTotalItems() { return 0; },
  };
  return box;
};
const context = {
  console,
  window: {
    FarmCrates: { makeSellCrate: (col, row) => makeMockBox(col, row) },
    FarmPanel: { init() {} },
    ProceduralFurniture: {},
    AuthoredFurniture: {},
  },
  document: {},
  setTimeout,
  clearTimeout,
};
context.window.window = context.window;
vm.runInNewContext(storeSource, context, { filename: 'general-store.js' });
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

console.log('shipping box world upgrade regression checks passed');
