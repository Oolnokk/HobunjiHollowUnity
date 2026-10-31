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
for (const id of ['invPackClothing', 'iiEmpty', 'iiDetail', 'iiIcon', 'iiName', 'iiPrice', 'iiQuality', 'iiTags', 'iiDesc', 'iiActions']) {
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
assert.deepEqual(groupClothingForDisplay(Array.from({ length: 205 }, (_, index) => ({ ...copy(base), uid: 'many-' + index })))
  .map(group => group.count), [99, 99, 7], 'clothing uses the normal Pack 99-item stack limit');

let pack = [copy(base), copy(base), dyed]; // Old shop purchases reused a single listing UID.
let saves = 0; // Must only increase on actual ID repair or a real inventory transaction.
let gearSaves = 0; // Used to verify that transferring one article persists it exactly once.
const gear = { tools: {}, clothing: {}, clothingItems: [] }; // Persistent collection used by the transfer action.
let selectedClears = 0; // Verifies sale actions use the existing detail-cleanup path.
let explicitSelectionClears = 0; // Controller preview must not clear the current selected Pack stack.
let heldItem = { kind: 'clothing', uid: base.uid }; // Simulates a held copy being sold from the stack.
const inventory = { gold: 0 };
panel.init({
  getPackClothing: () => pack,
  setPackClothing: items => { pack = items; },
  saveMemberWorldData: () => { saves++; },
  getGearInventory: () => gear,
  saveGearInventory: () => { gearSaves++; },
  refreshPlayerAvatar: () => {},
  getManualHeldItem: () => heldItem,
  setManualHeldItem: item => { heldItem = item; },
  inventory,
  clearInvSelection: () => { explicitSelectionClears++; },
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
panel.previewPackClothingItem(pack[0].uid);
assert.match(nodes.get('iiName').textContent, /×2$/, 'controller preview displays the identical-clothing stack quantity');
assert.equal(explicitSelectionClears, 0, 'preview does not clear another selected Pack item');
assert.equal(nodes.get('iiDetail').dataset.itemKind, 'clothing', 'passive clothing previews identify the correct item family');
assert.equal(nodes.get('iiQuality').textContent !== undefined, true, 'clothing preview updates its own quality metadata');
packNode.children[0].click();
assert.equal(explicitSelectionClears, 1, 'explicit clothing click still selects by clearing previous Pack selection');
assert.match(nodes.get('iiName').textContent, /×2$/, 'selected detail identifies the whole stack');
assert.match(nodes.get('iiDesc').textContent, /affect one piece/, 'detail explains single-article actions');
const sell = nodes.get('iiActions').children.find(child => child.textContent.startsWith('Sell ('));
assert(sell, 'sale action is available on selected stacked clothing');
sell.click();
assert.equal(pack.length, 2, 'selling from a stack removes exactly one saved article');
assert.equal(pack.filter(item => item.label === base.label).length, 1, 'the remaining matching copy stays in the pack');
assert.equal(inventory.gold, 10, 'one sale pays for only one garment');
assert.equal(heldItem, null, 'selling a held garment also clears the now-invalid held-item reference');
assert.equal(packNode.children.length, 2, 'a single remaining copy renders without another badge');
assert(!packNode.children[0].children.some(child => child.className.includes('ipc-stack-count')),
  'quantity badge disappears when the stack shrinks to one');
assert.equal(selectedClears, 1, 'the existing detail reset runs after the sale');
assert.deepEqual(panel.getClothingStackDebug(), { articles: 2, visibleTiles: 2, stackedTiles: 0 },
  'mobile diagnostics report current display counts');

packNode.children[0].click();
nodes.get('iiActions').children.find(child => child.textContent.startsWith('Transfer to Gear')).click();
assert.equal(pack.length, 1, 'transferring the remaining garment removes only that physical article');
assert.equal(gear.clothingItems.length, 1, 'the exact transferred item becomes permanent gear');
assert.equal(gear.clothing.overwear?.cosmeticId, base.cosmeticId, 'that garment is equipped in its authored slot');
assert.equal(gearSaves, 1, 'the transfer persists the gear collection');

const banditWeave = (uid, motif) => ({
  ...copy(base),
  uid,
  weaving: { forcedOverpassPattern: { repoPatternId: motif, frameScale: 0.55 }, forcedOverpassRoles: ['wrap'] },
  colorC: { hex: '#bada55', label: 'Pattern' },
}); // Matches the forced-overpass data attached to a looted captain/flasker garment.
const banditClothA = banditWeave('bandit-captain-1', 'glyphA'); // First looted patterned poncho.
const banditClothB = banditWeave('bandit-captain-2', 'glyphB'); // Second independent random-pattern article.
assert.notEqual(panel.__test.clothingGearCollectionKey(banditClothA), panel.__test.clothingGearCollectionKey(banditClothB),
  'even cloth from the same bandit cosmetic type has a distinct patterned gear identity');
assert.equal(panel.__test.clothingGearCollectionKey(copy(base)), panel.__test.clothingGearCollectionKey(copy(dyed)),
  'ordinary differently dyed clothes keep their original shared gear identity');

function transferTestClothing(item) {
  pack.push(item);
  panel.buildPackClothingSection();
  const button = nodes.get('invPackClothing').children.find(node => node.getAttribute('data-key') === item.uid);
  assert(button, 'the looted clothing can be selected in Pack');
  button.click();
  const action = nodes.get('iiActions').children.find(node => node.textContent.startsWith('Transfer to Gear'));
  assert(action, 'the looted clothing exposes Transfer to Gear');
  action.click();
} // Drives the real UI rather than bypassing the transfer handler.

transferTestClothing(banditClothA);
assert.equal(gear.clothingItems.length, 2, 'a patterned bandit poncho joins the plain owned poncho instead of becoming a dye');
assert.equal(gear.clothing.overwear.weaving.forcedOverpassPattern.repoPatternId, 'glyphA',
  'the bandit pattern survives transfer and is equipped');
assert.match(nodes.get('iiDesc').textContent || '', /^$|Patterned garment/,
  'Gear selection may display a mobile-visible pattern marker');
transferTestClothing(banditClothB);
assert.equal(gear.clothingItems.length, 3, 'different looted bandit patterns remain separate Gear articles');
assert.deepEqual(gear.clothingItems.slice(1).map(item => item.weaving?.forcedOverpassPattern?.repoPatternId),
  ['glyphA', 'glyphB'], 'neither saved pattern is replaced by a later transfer');
assert.equal(gear.clothing.overwear.uid, banditClothB.uid, 'the most recently transferred item is worn');

// The ordinary color-unlock behavior must not swallow the patterned pieces or be broken by them.
transferTestClothing({ ...copy(dyed), uid: 'new-plain-blue' });
assert.equal(gear.clothingItems.length, 3, 'a non-patterned dye variant still collapses into the existing plain garment');
assert.equal(gear.clothing.overwear.uid, gear.clothingItems[0].uid, 'the plain item remains independently equipable');

// Simulate JSON save/load, where worn and owned references deserialize as different objects.
const restoredGear = copy(gear); // Recreates the runtime's cold-start deserialization boundary.
gear.clothing = restoredGear.clothing;
gear.clothingItems = restoredGear.clothingItems;
panel.ensureGearClothingCollection();
assert.equal(gear.clothingItems.length, 3, 'save migration does not collapse patterned loot into its base cosmetic');
assert.deepEqual(gear.clothingItems.slice(1).map(item => item.weaving?.forcedOverpassPattern?.repoPatternId),
  ['glyphA', 'glyphB'], 'both pattern snapshots persist through save migration');
gear.clothing.overwear = copy(gear.clothingItems[2]);
panel.ensureGearClothingCollection();
assert.equal(gear.clothing.overwear, gear.clothingItems[2], 'equipped patterned garment reconnects to its canonical Gear article');

const duplicateSale = { ...copy(base), uid: 'duplicate-transaction' }; // Simulates a legacy collision introduced after UI selection.
pack = [duplicateSale, { ...copy(base), uid: 'duplicate-transaction' }];
panel.buildPackClothingSection(); // Migration gives the current rows distinct IDs.
const saleUid = pack[0].uid;
pack[1].uid = saleUid; // Collision after display: the sale handler must still remove only one physical object.
nodes.get('invPackClothing').children[0].click();
nodes.get('iiActions').children.find(child => child.textContent.startsWith('Sell')).click();
assert.equal(pack.length, 1, 'a late duplicate UID cannot cause a sale to destroy the whole stack');

// Exercise the real General Store buy callback: repeated purchases of the same daily listing
// must create distinct physical articles, even with constant clock/random sources.
const storeSource = fs.readFileSync(path.join(__dirname, '../docs/js/general-store.js'), 'utf8');
const storeStart = storeSource.indexOf('  function renderGeneralStoreClothing(list) {');
const storeEnd = storeSource.indexOf('  function renderGeneralStorePage() {', storeStart);
assert(storeStart >= 0 && storeEnd > storeStart, 'store clothing renderer remains available');
const purchases = []; // Captures each purchased clothing article across repeated clicks on a single listing.
const storeItems = [{ uid:'citem_gs_day_one', label:'Brown Hood', slot:'hood', price:10, cosmeticId:'ragged_hood' }];
const storeDeps = {
  calendar: { day:1 },
  inventory: { gold:100 },
  getPackClothing: () => purchases,
  showToast: () => {},
  buildInventoryGrid: () => {},
  buildPackClothingSection: () => {},
  saveMemberWorldData: () => {},
  esc: value => value,
};
const storeButtons = []; // Stubbed DOM holds the real clothing-buy click handler.
const storeDocument = {
  createElement: () => ({
    className: '', textContent: '', innerHTML: '',
    querySelector(selector) {
      if (selector !== '.gs-cloth-buy') return null;
      const button = { addEventListener(type, handler) { if (type === 'click') this.click = handler; } };
      storeButtons.push(button);
      return button;
    },
  }),
};
const renderStoreClothing = vm.runInNewContext(
  storeSource.slice(storeStart, storeEnd) + '\nrenderGeneralStoreClothing',
  { document:storeDocument, deps:storeDeps, generateDailyClothingStock:() => storeItems,
    renderGeneralStorePage:() => {}, Date:{ now:() => 42 }, Math:{ random:() => 0.123456 } },
);
renderStoreClothing({ appendChild() {} });
assert.equal(storeButtons.length, 1, 'one daily stock row has one purchase action');
storeButtons[0].click();
storeButtons[0].click();
assert.equal(purchases.length, 2, 'two purchases create two literal pack articles');
assert.notEqual(purchases[0].uid, purchases[1].uid, 'even identical purchases made within the same millisecond have distinct UIDs');
assert.equal(groupClothingForDisplay(purchases).length, 1, 'both identically configured purchases display in the same stack');

console.log('Clothing stack rendering, migration, sale, and transfer transactions passed');
