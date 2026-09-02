'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dyeSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'dye-system.js'), 'utf8'); // Used to execute the real browser module inside a minimal Node sandbox.
const inventory = { mysteryDyeRed: 2 }; // Used to verify successful consumption and no-consume behavior once the pool is exhausted.
const gearInventory = { dyeCollection: [] }; // Used as the live character dye collection returned through DyeSystem's getter dependency.
const inventoryItems = []; // Used to verify mystery-dye inventory metadata is restored during item-system initialization.
const itemDefs = {}; // Used to verify the dye definition carries its canonical pool metadata.
let gearSaveCount = 0; // Used to verify unlocking persists through the existing gear-save path.
let worldSaveCount = 0; // Used to verify consuming the inventory stack persists through the existing world-save path.
let toastMessage = ''; // Used to verify mobile-visible feedback reports the unlocked shade.
let activeItem = { key: 'mysteryDyeRed' }; // Used as the currently selected held item for the semantic Item Action 1 path.

const consumableBridge = {
  getHeldItemAction() { return null; },
  consumeHeldItem() { return false; },
}; // Used as the ordinary held-consumable API that DyeSystem composes with.

const cookingSystem = {
  init(deps) { this.deps = deps; return true; },
}; // Used because its init dependency bag is one established source of inventory/item metadata.

const windowObject = {
  SCRATCHBONES_CONFIG: {
    game: {
      dyes: {
        starterDyeIds: [],
        mysteryDyePrice: 35,
        mysteryPools: [{ id: 'red', label: 'Red Mystery Dye', description: 'Contains a red-family shade.', hueFamilies: ['Red'] }],
        catalog: [{ id: 'scarlet', label: 'Scarlet', hueFamily: 'Red', hueFamilyId: 'red', neutral: false, sortOrder: 1, color: { h: 0, s: 0, v: 0 }, hex: '#c33' }],
      },
    },
  },
  HobunjiDrunkGameplayBridge: consumableBridge,
  CookingSystem: cookingSystem,
  FarmCrates: { init() { return true; } },
  HobunjiInventoryActionMetadataBridge: { refresh() {} },
}; // Used as the browser-global surface DyeSystem expects.

const sandboxMath = Object.create(Math); // Used to make the mystery-dye roll deterministic for this single-candidate test.
sandboxMath.random = () => 0;
const sandbox = { window: windowObject, Math: sandboxMath, Date, Object, Array, Set, Map, String, Number }; // Used as the minimal global scope for vm execution.
vm.runInNewContext(dyeSource, sandbox, { filename: 'dye-system.js' });

windowObject.DyeSystem.init({
  getGearInventory: () => gearInventory,
  saveGearInventory: () => { gearSaveCount++; },
});

windowObject.CookingSystem.init({
  inventory,
  inventoryItems,
  ITEM_DEFS: itemDefs,
  getHeldMode: () => 'item',
  getActiveInventoryItem: () => activeItem,
  clampInventoryStack: key => { inventory[key] = Math.max(0, Number(inventory[key]) || 0); },
  refreshItemScroll() {},
  buildInventoryGrid() {},
  refreshActionBar() {},
  saveMemberWorldData() { worldSaveCount++; },
  showToast(message) { toastMessage = message; },
});

assert.equal(itemDefs.mysteryDyeRed?.mysteryDyePoolId, 'red', 'mystery dye item metadata should be registered');
assert.equal(inventoryItems.some(item => item.key === 'mysteryDyeRed'), true, 'mystery dye should be present in inventory metadata');

const action = consumableBridge.getHeldItemAction(); // Used to verify dye packets occupy the normal configurable Item Action 1 slot.
assert.equal(action?.action, 'consume_held_item');
assert.match(action?.label || '', /Use/i);

assert.equal(consumableBridge.consumeHeldItem(), true, 'using a dye packet should be handled by DyeSystem');
assert.deepEqual(gearInventory.dyeCollection, ['scarlet'], 'using a dye packet should globally unlock its rolled shade');
assert.equal(inventory.mysteryDyeRed, 1, 'a successful unlock should consume exactly one dye packet');
assert.equal(gearSaveCount, 1, 'unlocking a dye should save gear ownership');
assert.equal(worldSaveCount, 1, 'consuming the packet should save inventory state');
assert.match(toastMessage, /Scarlet/, 'successful use should provide visible feedback naming the unlocked shade');

assert.equal(consumableBridge.consumeHeldItem(), false, 'a fully exhausted dye family should refuse consumption');
assert.equal(inventory.mysteryDyeRed, 1, 'refused use must not consume the packet');
assert.equal(worldSaveCount, 1, 'refused use must not write a false inventory mutation');

const debug = windowObject.DyeSystem.getDebug(); // Used to verify the no-devtools diagnostics expose the last successful dye event.
assert.equal(debug.lastDyeItemEvent?.dyeId, 'scarlet');
assert.equal(debug.heldPoolId, 'red');

activeItem = null;
assert.equal(consumableBridge.getHeldItemAction(), null, 'ordinary held-item behavior should remain untouched when no dye is selected');

console.log('Dye item consumption regression checks passed.');
