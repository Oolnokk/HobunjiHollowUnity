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
  masteryTablet: 1,
  masteryScroll: 1,
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
  masteryTablet: { icon: '🪨', label: 'Test Mastery Tablet', masteryUnlock: { type: 'sharp', rank: 1, effectId: 'test' } },
  masteryScroll: { icon: '📜', label: 'Test Mastery Scroll', masteryUnlock: { type: 'sharp', rank: 1, effectId: 'test' } },
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
let detailClears = 0; // Used to prove the direct-use panel clears only when its last copy is consumed.
let dyeUses = 0; // Used to prove mystery dyes delegate to DyeSystem's one mutation path.
const player = { health: 50, maxHealth: 100, stamina: 60, maxStamina: 100 }; // Used to verify generic food direct-use mirrors held-food restoration.

const noop = () => {};
const elementMap = new Map(); // Used to switch the test from headless API checks into a tiny Inventory-detail DOM for button rendering.
const documentStub = {
  readyState: 'complete',
  addEventListener() {},
  getElementById(id) { return elementMap.get(id) || null; },
  createElement() {
    const element = {
      id: '', className: '', dataset: {}, style: {}, disabled: false, textContent: '', title: '', onclick: null, parentElement: null,
      remove() {
        if (this.parentElement?.children) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        if (this.id) elementMap.delete(this.id);
        this.parentElement = null;
      },
    }; // Used as the minimal button surface renderDirectUseButton mutates.
    return element;
  },
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
  CombatProgression: { hasEffectUnlock: () => false, readMasteryItem(key) { if (!(inventory[key] > 0)) return false; inventory[key]--; return true; } },
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
  clearInventoryDetail: () => { detailClears++; },
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
assert.equal(api.getInventoryUseAction('masteryTablet')?.kind, 'masteryUnlock', 'mastery tablets expose direct Read');
assert.equal(api.getInventoryUseAction('masteryScroll')?.kind, 'masteryUnlock', 'mastery scrolls expose direct Read');
assert.equal(api.getInventoryUseAction('mysteryDyeRed')?.kind, 'mysteryDye', 'mystery dyes expose direct Use');
assert.equal(api.getInventoryUseAction('venomFlask'), null, 'throwing flasks remain Hold/aim only');
assert.equal(api.getInventoryUseAction('breedingGigantism'), null, 'livestock potions remain Hold/target only');
assert.equal(api.getInventoryUseAction('redberrySeeds'), null, 'seeds remain Hold/world-target only');

// Inventory detail rendering: direct-use items receive one semantic button; target-dependent items do not.
inventory.alchemy_recipe_healingPotion = 1;
const actionsEl = {
  children: [],
  prepend(child) {
    child.parentElement = this;
    this.children.unshift(child);
    if (child.id) elementMap.set(child.id, child);
  },
}; // Used as #iiActions without recreating the rest of the game's Inventory DOM.
elementMap.set('iiActions', actionsEl);
elementMap.set('iiDetail', { style: { display: '' } });
elementMap.set('iiName', { textContent: 'Recipe: Healing Potion ×1' }); // Matches game.js's real Pack detail, which appends ×count to the item name.
api.refreshInventoryUseButton();
let directButton = elementMap.get('inventoryDirectUseBtn');
assert(directButton, 'a directly usable selected item gains an Inventory action button');
assert.equal(directButton.dataset.itemKey, 'alchemy_recipe_healingPotion');
assert.equal(api.getDebug().lastDirectUseUi.reason, 'resolved', 'quantity-suffixed Pack details still resolve their direct-use item');
assert.match(directButton.textContent, /Read/, 'the Inventory button uses the resolved semantic verb');
elementMap.get('iiName').textContent = 'Venom Flask';
api.refreshInventoryUseButton();
directButton = elementMap.get('inventoryDirectUseBtn');
assert.equal(directButton, undefined, 'a target-dependent flask removes the direct-use button instead of pretending it can fire from Inventory');
assert.equal(api.getDebug().lastDirectUseUi?.reason, 'not-direct-usable', 'mobile diagnostics explain the missing target-dependent action');

// The actual selected Pack tile is authoritative for generated mastery items.
// Switching away from an ordinary item must resolve the tablet without scanning
// every owned item or reusing the stale previous action.
let selectedPackKey = 'apple'; // Emulates the grid's selected class after game.js handles a click.
documentStub.querySelector = selector => selector.includes('.inv-item-box.selected') && selectedPackKey
  ? { dataset: { key: selectedPackKey } } : null;
elementMap.get('iiName').textContent = 'Apple ×1';
api.refreshInventoryUseButton();
assert.equal(elementMap.get('inventoryDirectUseBtn')?.dataset.itemKey, 'apple');
selectedPackKey = 'masteryTablet';
elementMap.get('iiName').textContent = 'Test Mastery Tablet ×1';
api.refreshInventoryUseButton();
assert.equal(elementMap.get('inventoryDirectUseBtn')?.dataset.itemKey, 'masteryTablet', 'switching from food to a mastery tablet resolves its exact item');
assert.equal(api.getDebug().lastDirectUseUi.reason, 'selected-slot');
assert.match(elementMap.get('inventoryDirectUseBtn')?.textContent || '', /Read/);
selectedPackKey = 'apple';
api.refreshInventoryUseButton();
assert.equal(elementMap.get('inventoryDirectUseBtn'), undefined, 'stale mastery name cannot Read the newly selected food item');
assert.equal(api.getDebug().lastDirectUseUi.reason, 'stale-selection');
selectedPackKey = 'masteryTablet';
api.refreshInventoryUseButton();
assert.equal(elementMap.get('inventoryDirectUseBtn')?.dataset.itemKey, 'masteryTablet', 'tablet action returns when the matching slot is selected');
selectedPackKey = 'masteryScroll';
elementMap.get('iiName').textContent = 'Test Mastery Scroll ×1';
api.refreshInventoryUseButton();
assert.equal(elementMap.get('inventoryDirectUseBtn')?.dataset.itemKey, 'masteryScroll', 'switching directly from a tablet to a scroll resolves the new lesson');
assert.match(elementMap.get('inventoryDirectUseBtn')?.textContent || '', /Read/);
assert.equal(elementMap.get('inventoryDirectUseBtn')?.onclick(), true, 'newly selected mastery scroll Read button invokes its own item key');
assert.equal(inventory.masteryScroll, 0, 'reading the scroll does not consume the previously selected tablet or food');
assert.equal(inventory.masteryTablet, 1, 'reading the scroll leaves the tablet for its own independent Read action');
selectedPackKey = null; // Remaining direct-use tests simulate a programmatic panel, not a grid click.
documentStub.querySelector = undefined;


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
const priorDetailClears = detailClears; // Used to verify the final mastery tablet does not leave a stale selected item.
assert.equal(api.useInventoryItem('masteryTablet'), true);
assert.equal(inventory.masteryTablet, 0, 'direct mastery reading consumes its last copy');
assert.equal(detailClears, priorDetailClears + 1, 'a successful final-copy mastery read clears stale Inventory detail');
manualHeldItem = { kind: 'bagItem', key: 'masteryTablet' };
assert.equal(api.clearExhaustedBagHold('masteryTablet'), true, 'exhausted manual Hold can be cleared explicitly');
assert.equal(manualHeldItem, null, 'the empty held stack is no longer selected');
assert.equal(api.useInventoryItem('mysteryDyeRed'), true);
assert.equal(dyeUses, 1);

assert.equal(api.useInventoryItem('venomFlask'), false, 'Inventory cannot accidentally throw a flask without an aim target');
assert.equal(api.useInventoryItem('breedingGigantism'), false, 'Inventory cannot administer a livestock potion without a target');
assert.equal(api.useInventoryItem('redberrySeeds'), false, 'Inventory cannot plant without a world tile target');
assert(worldSaves > 0, 'successful direct uses persist through the existing world-save path');
assert(gridRefreshes > 0, 'successful direct uses refresh the existing Inventory grid');
assert(toasts.some(entry => /Learned Healing Potion/.test(entry.message)), 'direct recipe reading produces visible feedback');
assert.equal(api.getDebug().lastDirectUse?.key, 'redberrySeeds', 'mobile diagnostics expose the most recent blocked direct-use attempt');
assert.match(source, /ambiguous-label/, 'ambiguous same-label items fail closed instead of using the wrong stack');


// Run the real furniture lesson owner through the same bag-use bridge.
vm.runInContext(fs.readFileSync('docs/js/crafting-panel.js', 'utf8'), context);
const furnitureBlueprint = { key: 'chairBlueprint', name: 'Chair', furnitureKey: 'chair', craftCost: { wood: 2 } }; // Physical lesson used to exercise consumption and member restoration.
inventory.chairBlueprint = 2;
ITEM_DEFS.chairBlueprint = { label: 'Chair Blueprint', cat: 'blueprint', icon: '📜' };
windowStub.CraftingPanel.init({ inventory, FURNITURE_BLUEPRINT_CATALOG: [furnitureBlueprint], clampInventoryStack() {}, saveMemberWorldData() { worldSaves++; } });
assert.equal(api.getInventoryUseAction('chairBlueprint').verb, 'Read');
elementMap.get('iiName').textContent = 'Chair Blueprint ×2'; // Real UI caption for two purchased copies.
api.refreshInventoryUseButton();
assert.equal(elementMap.get('inventoryDirectUseBtn')?.dataset.itemKey, 'chairBlueprint', 'a purchased furniture blueprint gets a Read button despite its displayed quantity');
assert.match(elementMap.get('inventoryDirectUseBtn')?.textContent || '', /Read/, 'the furniture lesson is visibly readable from its Pack detail');
assert.equal(elementMap.get('inventoryDirectUseBtn').onclick(), true, 'the actual Pack Read button consumes a furniture lesson');
assert.equal(inventory.chairBlueprint, 1, 'learning consumes exactly one copy');
assert.equal(elementMap.get('iiName').textContent, 'Chair Blueprint ×1', 'reading updates the displayed remaining blueprint count without reopening Pack detail');
assert.equal(windowStub.CraftingPanel.ownsBlueprint(furnitureBlueprint), true);
assert.equal(api.getInventoryUseAction('chairBlueprint').allowed, false);
assert.equal(elementMap.get('inventoryDirectUseBtn')?.disabled, true, 'duplicate physical blueprints cannot consume again after learning');
assert.equal(api.useInventoryItem('chairBlueprint'), false, 'duplicates are not consumed');
assert.equal(inventory.chairBlueprint, 1);
const savedBlueprints = windowStub.CraftingPanel.serializeBlueprints(); // Round-trips the active member lessons without requiring a physical copy.
windowStub.CraftingPanel.restoreBlueprints([]);
assert.equal(windowStub.CraftingPanel.ownsBlueprint(furnitureBlueprint), false, 'another character/world has its own lessons');
windowStub.CraftingPanel.restoreBlueprints(savedBlueprints);
assert.equal(windowStub.CraftingPanel.ownsBlueprint(furnitureBlueprint), true, 'returning to the original member restores the lesson');

console.log('Inventory direct item-use regression checks passed.');