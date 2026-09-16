'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/inventory-held-override.js', 'utf8');
const inventory = {
  staleRecipe: 0,
  alchemy_recipe_healingPotion: 1,
  frostcapMoss: 1,
  healingPotionBottle: 1,
  cookedStew: 1,
  apple: 1,
  combatManualBlinkDodge: 1,
  techniqueScrollTier1: 1,
  mysteryDyeRed: 1,
  venomFlask: 1,
  breedingGigantism: 1,
  redberrySeeds: 3,
}; // Used to exercise every direct-use family plus target-dependent exclusions.
const ITEM_DEFS = {
  alchemy_recipe_healingPotion: { icon: '📜', label: 'Recipe: Healing Potion', cat: 'processed', tags: ['Alchemy'] }, // Intentionally stale: key fallback must still classify it as Read.
  frostcapMoss: { icon: '🌿', label: 'Frostcap Moss', cat: 'material' },
  healingPotionBottle: { icon: '🧪', label: 'Healing Potion', cat: 'processed', useMode: 'drink' },
  cookedStew: { icon: '🍲', label: 'Cooked Stew', cat: 'food', isCookedFood: true },
  apple: { icon: '🍎', label: 'Apple', cat: 'food', healthRestore: 5 },
  combatManualBlinkDodge: { icon: '📕', label: 'Blink Dodge Combat Manual', combatManualAbilityId: 'blinkDodge' },
  techniqueScrollTier1: { icon: '📜', label: 'Tier 1 Technique Scroll', techniqueScrollTier: 1 },
  mysteryDyeRed: { icon: '🔴', label: 'Red Mystery Dye', mysteryDyePoolId: 'red' },
  venomFlask: { icon: '☠️', label: 'Venom Flask', useMode: 'throw' },
  breedingGigantism: { icon: '🐘', label: 'Breeding Potion of Gigantism', useMode: 'livestock' },
  redberrySeeds: { icon: '🌱', label: 'Redberry Seeds', cat: 'seed', seedFor: 'redberries' },
};
const inventoryItems = Object.entries(ITEM_DEFS).map(([key, def]) => ({ key, label: def.label, icon: def.icon })); // Used by the detail-label resolver fallback.
let manualHeldItem = null; // Used to prove combat literature reuses TechniqueScrolls without changing the player's persistent Hold state.
let worldSaves = 0; // Used to verify direct mutations still reach the ordinary world-save path.
let gridRefreshes = 0; // Used to verify Inventory visibly updates after a direct action.
let toasts = []; // Used to verify direct-use feedback remains player-visible.
let recipeReads = 0; // Used to prove a physical recipe calls the reader rather than drink logic.
let drinks = 0; // Used to prove only real drinks enter the drink path.
let reagentEats = 0; // Used to prove raw reagents retain their authored alchemy behavior.
let cookedEats = 0; // Used to prove cooked meals delegate to CookingSystem.
let manualReads = 0; // Used to prove combat manuals delegate to TechniqueScrolls.
let scrollReads = 0; // Used to prove technique scrolls delegate to TechniqueScrolls.
let dyeUses = 0; // Used to prove mystery dyes delegate to DyeSystem's one mutation path.
const player = { health: 50, maxHealth: 100, stamina: 60, maxStamina: 100 }; // Used to verify generic food direct-use mirrors held-food restoration.

const noop = () => {};
const documentStub = {
  readyState: 'complete',
  addEventListener() {},
  getElementById() { return null; },
};
const windowStub = {
  Combat: { deps: { player } },
  ItemProcessing: { isWheelEligible() { return false; } },
  EquipmentPanel: { init() {} },
  ActionArcUI: { init() {} },
  HudUpdate: { init() {}, refreshItemScroll() {} },
  CookingSystem: {
    init() {},
    eat(key) {
      cookedEats++;
      if (!(inventory[key] > 0)) return { ok: false, message: 'Nothing edible is selected.' };
      inventory[key]--;
      return { ok: true, message: `Ate ${ITEM_DEFS[key].label}.` };
    },
  },
  FarmCrates: { init() {} },
  AlchemySystem: {
    RECIPE_DEFS: {
      healingPotion: { id: 'healingPotion', useMode: 'drink' },
      venomFlask: { id: 'venomFlask', useMode: 'throw' },
      breedingGigantism: { id: 'breedingGigantism', useMode: 'livestock' },
    },
    REAGENT_DEFS: { frostcapMoss: {} },
    POTION_ITEMS: {
      healingPotionBottle: { recipeId: 'healingPotion', potencyTier: 0 },
      venomFlask: { recipeId: 'venomFlask', potencyTier: 0 },
      breedingGigantism: { recipeId: 'breedingGigantism', potencyTier: 0 },
    },
    parseBrewedItemKey() { return null; },
    readRecipeItem(key) { recipeReads++; inventory[key]--; return { ok: true, message: 'Learned Healing Potion.' }; },
    consumeRawReagent(key) { reagentEats++; inventory[key]--; return { ok: true, message: `Ate ${ITEM_DEFS[key].label}.` }; },
    drinkPotion(key) { drinks++; inventory[key]--; return { ok: true, message: `Drank ${ITEM_DEFS[key].label}.` }; },
  },
  HobunjiDrunkGameplayBridge: {
    isPotionOrDrink(key, def) { return def?.useMode === 'drink'; },
    isFood(def) { return def?.cat === 'food'; },
  },
  TechniqueScrolls: {
    SCROLLS: { 1: { key: 'techniqueScrollTier1' } },
    isUnlocked() { return false; },
    consumeManual() {
      const key = manualHeldItem?.kind === 'bagItem' ? manualHeldItem.key : null;
      if (key !== 'combatManualBlinkDodge' || !(inventory[key] > 0)) return false;
      manualReads++; inventory[key]--; return true;
    },
    consumeScroll() {
      const key = manualHeldItem?.kind === 'bagItem' ? manualHeldItem.key : null;
      if (key !== 'techniqueScrollTier1' || !(inventory[key] > 0)) return false;
      scrollReads++; inventory[key]--; return true;
    },
  },
  DyeSystem: {
    useMysteryDye(key) { dyeUses++; inventory[key]--; return { ok: true, message: 'Unlocked Scarlet.' }; },
  },
};

const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  console,
  Date,
  Object,
  Array,
  Set,
  Map,
  String,
  Number,
  Math,
  queueMicrotask(fn) { fn(); },
  setTimeout(fn) { fn(); return 1; },
});
vm.runInContext(source, context, { filename: 'inventory-held-override.js' });

windowStub.EquipmentPanel.init({
  inventory,
  getManualHeldItem: () => manualHeldItem,
  setManualHeldItem: value => { manualHeldItem = value; },
  clearInventoryDetail: noop,
});
const itemDeps = {
  inventory,
  ITEM_DEFS,
  inventoryItems,
  clampInventoryStack: key => { inventory[key] = Math.max(0, Number(inventory[key]) || 0); },
  refreshItemScroll: noop,
  buildInventoryGrid() { gridRefreshes++; },
  refreshActionBar: noop,
  saveMemberWorldData() { worldSaves++; },
  showToast(message, ok) { toasts.push({ message, ok }); },
};
windowStub.CookingSystem.init(itemDeps);
windowStub.FarmCrates.init(itemDeps);

const api = windowStub.InventoryHeldOverride;
assert.equal(api.getInventoryUseAction('alchemy_recipe_healingPotion')?.verb, 'Read', 'stale physical recipe keys are directly readable from Inventory');
assert.equal(api.getInventoryUseAction('frostcapMoss')?.kind, 'rawReagent', 'raw reagents expose direct Eat');
assert.equal(api.getInventoryUseAction('healingPotionBottle')?.kind, 'drink', 'drinkable potions expose direct Drink');
assert.equal(api.getInventoryUseAction('cookedStew')?.kind, 'cookedFood', 'cooked meals expose direct Eat');
assert.equal(api.getInventoryUseAction('apple')?.kind, 'food', 'ordinary food exposes direct Eat');
assert.equal(api.getInventoryUseAction('combatManualBlinkDodge')?.kind, 'combatManual', 'combat manuals expose direct Read');
assert.equal(api.getInventoryUseAction('techniqueScrollTier1')?.kind, 'techniqueScroll', 'technique scrolls expose direct Read');
assert.equal(api.getInventoryUseAction('mysteryDyeRed')?.kind, 'mysteryDye', 'mystery dyes expose direct Use');
assert.equal(api.getInventoryUseAction('venomFlask'), null, 'throwing flasks remain Hold/aim only');
assert.equal(api.getInventoryUseAction('breedingGigantism'), null, 'livestock potions remain Hold/target only');
assert.equal(api.getInventoryUseAction('redberrySeeds'), null, 'seeds remain Hold/world-target only');

assert.equal(api.useInventoryItem('alchemy_recipe_healingPotion'), true);
assert.equal(recipeReads, 1, 'recipe direct-use calls readRecipeItem exactly once');
assert.equal(drinks, 0, 'recipe direct-use never enters potion drinking');
assert.equal(api.useInventoryItem('frostcapMoss'), true);
assert.equal(reagentEats, 1);
assert.equal(api.useInventoryItem('healingPotionBottle'), true);
assert.equal(drinks, 1);
assert.equal(api.useInventoryItem('cookedStew'), true);
assert.equal(cookedEats, 1);
assert.equal(api.useInventoryItem('apple'), true);
assert.equal(player.health, 55, 'ordinary food direct-use preserves held-food Health restoration');

manualHeldItem = { kind: 'bagItem', key: 'redberrySeeds' };
assert.equal(api.useInventoryItem('combatManualBlinkDodge'), true);
assert.equal(manualReads, 1);
assert.deepEqual(manualHeldItem, { kind: 'bagItem', key: 'redberrySeeds' }, 'direct manual reading restores the previously held target-dependent item');
assert.equal(api.useInventoryItem('techniqueScrollTier1'), true);
assert.equal(scrollReads, 1);
assert.deepEqual(manualHeldItem, { kind: 'bagItem', key: 'redberrySeeds' }, 'direct scroll reading also preserves the previous Hold state');
assert.equal(api.useInventoryItem('mysteryDyeRed'), true);
assert.equal(dyeUses, 1);

assert.equal(api.useInventoryItem('venomFlask'), false, 'Inventory cannot accidentally throw a flask without an aim target');
assert.equal(api.useInventoryItem('breedingGigantism'), false, 'Inventory cannot administer a livestock potion without a target');
assert.equal(api.useInventoryItem('redberrySeeds'), false, 'Inventory cannot plant without a world tile target');
assert(worldSaves > 0, 'successful direct uses persist through the existing world-save path');
assert(gridRefreshes > 0, 'successful direct uses refresh the existing Inventory grid');
assert(toasts.some(entry => /Learned Healing Potion/.test(entry.message)), 'direct recipe reading produces visible feedback');
assert.equal(api.getDebug().lastDirectUse?.key, 'redberrySeeds', 'mobile diagnostics expose the most recent blocked direct-use attempt');
assert.match(source, /inventoryDirectUseBtn/, 'Inventory detail UI owns one shared direct-use button');
assert.match(source, /ambiguous-label/, 'ambiguous same-label items fail closed instead of using the wrong stack');

console.log('Inventory direct item-use regression checks passed.');