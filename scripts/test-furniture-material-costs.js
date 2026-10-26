'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Run the shipped definitions and projections: this catches lost mastery flags
// between definitions and catalogs, which source-only loom tests missed.
const game = fs.readFileSync('docs/game.js', 'utf8');
const context = { console, document: { getElementById: () => null, querySelectorAll: () => [] } };
context.window = context;
vm.createContext(context);
vm.runInContext(game.slice(game.indexOf('      const PROCESSING_FURNITURE_DEFS ='), game.indexOf('      // ── Authored furniture')), context);
vm.runInContext(game.slice(game.indexOf('      function blueprintItemKey('), game.indexOf('      const LIVESTOCK_CATALOG =')) + '\nwindow.catalog = FURNITURE_BLUEPRINT_CATALOG;', context);
vm.runInContext(fs.readFileSync('docs/js/crafting-panel.js', 'utf8'), context);
const catalog = context.catalog;
const bp = key => catalog.find(entry => entry.furnitureKey === key);
const loom = bp('advancedLoomFurniture');
assert.equal(loom.moteOnly, true, 'actual decorative catalog preserves moteOnly');
assert.equal(loom.masteryUnlockId, 'advancedLoomBlueprint', 'actual catalog preserves world mastery id');
assert.ok(bp('loomFurniture') && !bp('loomFurniture').moteOnly, 'simple loom stays ordinarily purchasable');
assert.equal(bp('groomingKitFurniture').alwaysKnown, true, 'grooming station needs no learned blueprint');
assert.equal(bp('campfireKitFurniture').alwaysKnown, true, 'campfire remains available after removing the starter paper');

const materials = {
  stone: { label: 'Stone', sellPrice: 3 },
  puktukWool: { label: 'Heavy Wool', sellPrice: 8 },
  lightWool: { label: 'Light Wool', sellPrice: 6 },
};
const metals = vm.runInContext(game.slice(game.indexOf('      const METAL_DEFS ='), game.indexOf('      const ORE_DEFS =')) + '\nMETAL_DEFS;', context);
for (const [key, definition] of Object.entries(metals)) materials['bar_' + key] = { label: definition.label + ' Bar' };
for (const entry of catalog) {
  assert.ok(Object.values(entry.craftCost).some(amount => amount > 0), entry.key + ' is never free');
  for (const [key, amount] of Object.entries(entry.craftCost)) {
    assert.ok(key === 'wood' || materials[key], entry.key + ' uses an existing material: ' + key);
    assert.ok(Number.isSafeInteger(amount) && amount >= 0);
  }
}
assert.equal(bp('bucketFurniture').craftCost.bar_tin, 2);
assert.equal(bp('standingLampFurniture').craftCost.bar_tinBronze, 2);
assert.equal(bp('washTubFurniture').craftCost.bar_nativeCopper, 3);
assert.equal(bp('rugFurniture').craftCost.puktukWool, 5);
assert.equal(bp('benchFurniture').craftCost.stone, 0, 'plain joinery needs no arbitrary stone');
assert.equal(bp('statueFurniture').craftCost.wood, 0, 'stone sculpture needs no arbitrary wood');

let unlocked = false;
let saves = 0;
const inventory = { pineLog: 30, shadewoodLog: 30, stone: 30 };
const api = context.CraftingPanel;
context.InventoryStacks = { MAX_TOTAL: 999 };
context.CraftingMasterySystem = { hasUnlock: () => unlocked };
api.init({ inventory, FURNITURE_BLUEPRINT_CATALOG: catalog, ITEM_DEFS: materials, ORE_DEFS: {}, METAL_BAR_RECIPES: {},
  clampInventoryStack() {}, recordHeldOres() {}, showToast() {}, buildInventoryGrid() {},
  saveMemberWorldData() { saves++; }, esc: String });
const snapshot = () => JSON.stringify(inventory);
const unlock = entry => { inventory[entry.key] = 1; assert.equal(api.readBlueprint(entry.key).ok, true); };
const state = entry => api.debugSnapshot().recipes.find(row => row.key === entry.key);
const chest = bp('chestFurniture');
unlock(chest);
let before = snapshot();
assert.equal(api.craftFurnitureFromBlueprint(chest.key), false, 'missing bronze blocks craft');
assert.equal(snapshot(), before, 'failed craft consumes no wood/stone');
assert.equal(state(chest).canBuild, false);
inventory.bar_lowTinBronze = 1;
assert.equal(state(chest).canBuild, true);
assert.ok(api.furnitureCostDescription(chest, true).includes('Low-Tin Bronze Bar (have 1)'));
assert.equal(api.craftFurnitureFromBlueprint(chest.key), true);
assert.equal(inventory.chestFurniture, 1);
assert.equal(inventory.bar_lowTinBronze, 0);
assert.equal(inventory.pineLog, 25);
assert.equal(inventory.stone, 30);
assert.equal(inventory[chest.key], 0, 'learning consumes the physical blueprint while building preserves the learned design');
assert.equal(saves, 2);

// Wool spending goes through the real quality owner, avoiding phantom stacks.
const woolCalls = [];
context.CookingSystem = { consumeQualityByPolicy(key, amount, policy) {
  woolCalls.push({ key, amount, policy });
  inventory[key] -= amount;
  return { stars: 2, groups: [{ stars: 2, amount }] };
} };
const bed = bp('basicBedFurniture');
unlock(bed);
inventory.puktukWool = 4;
inventory.pineLog = 2;
inventory.shadewoodLog = 5;
assert.equal(api.craftFurnitureFromBlueprint(bed.key), true);
assert.equal(inventory.puktukWool, 0);
assert.equal(inventory.pineLog, 0);
assert.equal(inventory.shadewoodLog, 1, 'wood remains pooled across both species');
assert.deepEqual(woolCalls, [{ key: 'puktukWool', amount: 4, policy: 'lowest' }]);

inventory[loom.key] = 1;
inventory.pineLog = 40;
inventory.bar_tinBronze = 2;
inventory.lightWool = 4;
before = snapshot();
assert.equal(api.craftFurnitureFromBlueprint(loom.key), false, 'legacy shop copy cannot bypass mastery');
assert.equal(snapshot(), before);
unlocked = true;
assert.equal(api.craftFurnitureFromBlueprint(loom.key), true);
assert.equal(inventory.advancedLoomFurniture, 1);
assert.equal(inventory.bar_tinBronze, 0);

// Stale button clicks, full output stacks and malformed costs never spend stock.
inventory.bar_lowTinBronze = 0;
before = snapshot();
assert.equal(api.craftFurnitureFromBlueprint(chest.key), false);
assert.equal(snapshot(), before);
inventory.bar_lowTinBronze = 5;
inventory.chestFurniture = 999;
before = snapshot();
assert.equal(api.craftFurnitureFromBlueprint(chest.key), false);
assert.equal(snapshot(), before);
inventory.chestFurniture = 0;
const originalCost = chest.craftCost;
for (const bad of [{ wood: -1 }, { wood: NaN }, { wood: 1.5 }, {}, { wood: 0 }]) {
  chest.craftCost = bad;
  before = snapshot();
  assert.equal(api.craftFurnitureFromBlueprint(chest.key), false);
  assert.equal(snapshot(), before);
}
chest.craftCost = originalCost;
assert.equal(api.craftFurnitureFromBlueprint('unknown'), false);

// Real render path shares material availability with click-time checks.
const list = { children: [], appendChild(row) { this.children.push(row); }, set innerHTML(value) { this.children = []; } };
context.document.getElementById = id => id === 'craftingList' ? list : null;
context.document.createElement = () => ({ querySelector: () => ({ addEventListener() {} }) });
api.render();
let row = list.children.find(row => row.innerHTML.includes('data-bp="' + chest.key + '"'));
assert.ok(row.innerHTML.includes('Low-Tin Bronze Bar'));
assert.ok(!/data-bp="[^"]+" disabled/.test(row.innerHTML));
inventory.bar_lowTinBronze = 0;
api.render();
row = list.children.find(row => row.innerHTML.includes('data-bp="' + chest.key + '"'));
assert.ok(/data-bp="[^"]+" disabled/.test(row.innerHTML));
// The actual shop renderer excludes the advanced blueprint but shows real
// material costs for ordinary ones, even after the loom has been unlocked.
vm.runInContext(fs.readFileSync('docs/js/carpenter-shop.js', 'utf8'), context);
context.ConditionRegistry = { entryEligible: () => true };
context.document.getElementById = id => id === 'carpenterShopList' ? list : null;
context.CarpenterShop.init({ inventory, FURNITURE_BLUEPRINT_CATALOG: catalog,
  getBarnTiers: () => ({}), getHousePieceDeeds: () => ({}), lootShopWorldState: () => ({}), esc: String });
context.CarpenterShop.render();
assert.ok(!list.children.some(row => row.innerHTML?.includes('Advanced Loom')));
assert.ok(list.children.some(row => row.innerHTML?.includes('Simple Loom')));
assert.ok(list.children.some(row => row.innerHTML?.includes('Tin Bronze Bar')));

// Exercise the existing mastery owner: seven motes cannot buy the node;
// eight unlock it once, spend exactly eight, and persist world ownership.
const storage = new Map([['hobunjiSaveMeta', JSON.stringify({ worlds: [{ id: 'test-world' }] })]]);
const masteryContext = { console, document: { getElementById: () => null },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  dispatchEvent() {}, CustomEvent: function(type, options) { this.type = type; this.detail = options?.detail; } };
masteryContext.window = masteryContext;
vm.createContext(masteryContext);
vm.runInContext(fs.readFileSync('docs/js/crafting-mastery-system.js', 'utf8'), masteryContext);
vm.runInContext(fs.readFileSync('docs/js/advanced-loom-system.js', 'utf8'), masteryContext);
const mastery = masteryContext.CraftingMasterySystem;
mastery.setWorldIdGetter(() => 'test-world');
mastery.awardMotes(7, 'test', { silent: true });
assert.equal(mastery.purchaseRank('advancedLoomBlueprint'), false);
mastery.awardMotes(1, 'test', { silent: true });
assert.equal(mastery.purchaseRank('advancedLoomBlueprint'), true);
assert.equal(mastery.hasUnlock('advancedLoomBlueprint'), true);
assert.equal(mastery.getState().motes, 0);
assert.equal(mastery.purchaseRank('advancedLoomBlueprint'), false);
// Commission payouts include bronze value rather than pricing only joinery.
vm.runInContext(fs.readFileSync('docs/js/npc-crafting-commission-generator.js', 'utf8'), context);
materials.bar_lowTinBronze.sellPrice = 400;
context.NpcCraftingCommissionGenerator.setDeps({
  taskDeps: { setQuestStatus() {}, calendar: { day: 1 } },
  craftingDeps: { FURNITURE_BLUEPRINT_CATALOG: [chest, loom], ITEM_DEFS: materials },
});
const commission = context.NpcCraftingCommissionGenerator.generateTask({ id: 'carpenter', role: 'carpenter' }, 1);
assert.equal(commission.commission.blueprintKey, chest.key);
assert.ok(commission.rewardGold > 400, 'payout covers valuable metal');
console.log('furniture material costs and mastery projection: ok');
