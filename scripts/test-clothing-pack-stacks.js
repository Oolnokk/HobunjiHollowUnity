'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal browser nodes let the real equipment-panel render and dispatch its pack actions.
class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; // Tracks actual visible/source clothing cells for assertions.
    this.style = {}; // Used by the inventory detail and quantity badge.
    this.dataset = {}; // Used by the clothing editor and grid bridge.
    this.attributes = {}; // Tracks stable key and controller metadata.
    this.listeners = {}; // Dispatches clicks into the real action handlers.
    this.textContent = '';
    this.className = '';
  }
  set innerHTML(value) { this.children = []; this._html = value; }
  get innerHTML() { return this._html || ''; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] || null; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  click() { this.listeners.click?.(); this.onclick?.(); }
}
const nodes = new Map(); // One set of menu detail/source nodes is enough for all pack transactions.
for (const id of ['invPackClothing', 'iiEmpty', 'iiDetail', 'iiIcon', 'iiName', 'iiPrice', 'iiTags', 'iiDesc', 'iiActions']) {
  nodes.set(id, new Node());
}
const document = {
  getElementById: id => nodes.get(id) || null,
  createElement: tag => new Node(tag),
  addEventListener: () => {},
};
const windowStub = { InventoryUI: { init: () => {} } }; // Avoids an unrelated dynamic script load.
const script = fs.readFileSync(path.join(__dirname, '../docs/js/equipment-panel.js'), 'utf8');
vm.runInNewContext(script, { window: windowStub, document, console, Math, Date, Set, Map }, { filename: 'equipment-panel.js' });
const panel = windowStub.EquipmentPanel;
const { groupClothingForDisplay, clothingStackSignature } = panel.__test;

const base = {
  uid: 'shared-shop-listing',
  cosmeticId: 'rugged_poncho',
  slot: 'overwear',
  label: 'Brown Rugged Poncho',
  colorA: { dyeId: 'dye:CLOTH:brown', hex: '#654321' },
  qualityStars: 3,
  sellPrice: 10,
};
const copy = value => JSON.parse(JSON.stringify(value)); // Copies reflect independently owned saved articles.
const dyed = { ...copy(base), uid: 'blue', label: 'Blue Rugged Poncho',
  colorA: { dyeId: 'dye:CLOTH:blue', hex: '#0033ee' } };
const higherQuality = { ...copy(base), uid: 'quality', qualityStars: 4 };
const patterned = { ...copy(base), uid: 'pattern', weaving: { bands: [{ color: '#ff00ff', density: 2 }] } };
const differentTemper = { ...copy(base), uid: 'temper', temperXp: 20 };
const withHistory = { ...copy(base), uid: 'history', articleDyeIds: ['dye:CLOTH:purple'] };
const stableOrder = { ...copy(base), uid: 'order', colorA: { hex: '#654321', dyeId: 'dye:CLOTH:brown' } };
assert.equal(groupClothingForDisplay([base, stableOrder]).length, 1, 'property insertion order does not split identical articles');
assert.equal(groupClothingForDisplay([base, dyed, higherQuality, patterned, differentTemper, withHistory]).length, 6,
  'color, quality, weave, Temper and known article dyes each preserve distinct stacks');

const loomOne = { ...copy(base), uid: 'loom-a', cosmeticId: 'rugged_poncho#loom:loom-a',
  baseCosmeticId: 'rugged_poncho', craftedAt: 12345, weaveMaterial: 'light' };
const loomTwo = { ...copy(loomOne), uid: 'loom-b', cosmeticId: 'rugged_poncho#loom:loom-b', craftedAt: 98765 };
assert.equal(clothingStackSignature(loomOne), clothingStackSignature(loomTwo),
  'generated loom instance IDs and craft times do not split otherwise identical garments');
assert.equal(groupClothingForDisplay([loomOne, loomTwo]).length, 1, 'two identical loom copies display as one stack');
assert.equal(groupClothingForDisplay([loomOne, { ...loomTwo, weaveMaterial: 'heavy' }]).length, 2,
  'different textile weights stay separate');

let pack = [copy(base), copy(base), dyed]; // Old shop purchases reused a single listing UID.
let saves = 0; // Must only increase on actual ID repair or a real inventory transaction.
let selectedClears = 0; // Verifies sale actions use the existing detail-cleanup path.
const inventory = { gold: 0 };
panel.init({
  getPackClothing: () => pack,
  setPackClothing: items => { pack = items; },
  saveMemberWorldData: () => { saves++; },
  getGearInventory: () => ({ tools: {}, clothing: {}, clothingItems: [] }),
  inventory,
  clearInvSelection: () => {},
  clearInventoryDetail: () => { selectedClears++; },
  showToast: () => {},
  buildInventoryGrid: () => {},
});
panel.buildPackClothingSection();
const packNode = nodes.get('invPackClothing');
assert.equal(packNode.children.length, 2, 'two identical garments occupy one clothing tile');
assert.equal(packNode.children[0].children.find(child => child.className.includes('ipc-stack-count')).textContent,
  '×2', 'stack badge shows total article count');
assert.notEqual(pack[0].uid, pack[1].uid, 'duplicate legacy IDs are repaired separately');
assert.equal(saves, 1, 'legacy UID migration persists exactly once');
panel.buildPackClothingSection();
assert.equal(saves, 1, 're-rendering does not repeat the migration save');
packNode.children[0].click();
assert.match(nodes.get('iiName').textContent, /×2$/, 'selected detail identifies the whole stack');
assert.match(nodes.get('iiDesc').textContent, /affect one piece/, 'detail explains single-article actions');
const sell = nodes.get('iiActions').children.find(child => child.textContent.startsWith('Sell ('));
assert(sell, 'sale action is available on selected stacked clothing');
sell.click();
assert.equal(pack.length, 2, 'selling from a stack removes exactly one saved article');
assert.equal(pack.filter(item => item.label === base.label).length, 1, 'the remaining matching copy stays in the pack');
assert.equal(inventory.gold, 10, 'one sale pays for only one garment');
assert.equal(packNode.children.length, 2, 'a single remaining copy renders without another badge');
assert(!packNode.children[0].children.some(child => child.className.includes('ipc-stack-count')),
  'quantity badge disappears when the stack shrinks to one');
assert.equal(selectedClears, 1, 'the existing detail reset runs after the sale');
assert.deepEqual(panel.getClothingStackDebug(), { articles: 2, visibleTiles: 2, stackedTiles: 0 },
  'mobile diagnostics report current display counts');

console.log('Clothing stack rendering, migration, and single-article transactions passed');
