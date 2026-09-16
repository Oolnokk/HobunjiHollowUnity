#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const bridgeSource = read('docs/js/alcohol-gameplay-bridge.js');
const combat = read('docs/js/combat/combat-core.js');
const game = read('docs/game.js');
const popup = read('docs/js/world-popup-text.js');
const alcoholUi = read('docs/js/alcohol-inventory-ui.js');
const npcCharacterState = read('docs/js/npc-character-state.js');
const drunk = read('docs/js/drunk-locomotion.js');
const ambient = read('docs/js/ambient-dialogue.js');
const editor = read('docs/tools/ambient-dialogue-editor/index.html');
const config = JSON.parse(read('docs/config/dialogue/ambient-dialogue.json'));

let now = 0;
const documentStub = {
  readyState: 'loading',
  addEventListener() {},
  getElementById() { return null; },
};
const windowStub = {
  ResourceSystem: {
    addDrunkenness() { return { blackout: false }; },
    removeAffliction() {},
    getEffectiveMax() { return 100; },
    enforceCaps() {},
  },
  FarmCrates: { init() { return this; } },
  Mounts: { init() { return this; } },
  AmbientDialogue: {
    resolveAlcoholOffer() { return { accepted: true, text: 'Gladly.' }; },
    showAlcoholOfferResponse() {},
  },
  HobunjiAlcohol: { profileForItem() { return { footing: 32, health: 14 }; } },
  addEventListener() {},
  dispatchEvent() {},
};
const context = {
  window: windowStub,
  document: documentStub,
  performance: { now: () => (now += 1000) },
  requestAnimationFrame() {},
  setTimeout() {},
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
  console,
};
vm.runInNewContext(bridgeSource, context);

const inventory = { wine: 2 };
const wine = { key: 'wine', label: 'Redberry Wine', icon: '🍷', tags: ['Wine'], swigsPerBottle: 4 };
let activeItem = wine; // Used to switch the simulated held stack from wine to a stale generated recipe entry without rebuilding the bridge.
windowStub.FarmCrates.init({
  inventory,
  calendar: { day: 1, time01: 0 },
  getHeldMode: () => 'item',
  getActiveInventoryItem: () => activeItem,
  clampInventoryStack: key => { if (inventory[key] <= 0) delete inventory[key]; },
  beginHeldDrinkAnimation: () => false,
  continueHeldDrinkAnimation() {},
  cancelHeldDrinkAnimation() {},
  abortHeldDrinkAnimation() {},
  canPlayNpcDrinkInteraction: () => true,
  playNpcDrinkInteraction: (walker, key, onDrink) => { onDrink(); return 180; },
  showToast() {}, refreshItemScroll() {}, buildInventoryGrid() {}, refreshActionBar() {}, saveMemberWorldData() {},
});

const bridge = windowStub.HobunjiDrunkGameplayBridge;
assert.deepEqual(JSON.parse(JSON.stringify(bridge.getBottleSwigStatus('wine', wine, inventory))),
  { key: 'wine', remaining: 4, total: 4, stars: 3, bottleCount: 2 });
assert.equal(bridge.consumeBottleSwig('wine', wine, inventory).remaining, 3,
  'the first swig leaves the bottle in inventory with three servings');
assert.equal(inventory.wine, 2, 'a partial bottle does not decrement the stack');
bridge.consumeBottleSwig('wine', wine, inventory);
bridge.consumeBottleSwig('wine', wine, inventory);
const emptied = bridge.consumeBottleSwig('wine', wine, inventory);
assert.equal(emptied.bottleFinished, true);
assert.equal(inventory.wine, 1, 'the inventory stack decrements only on the final swig');
assert.equal(bridge.getBottleSwigStatus('wine', wine, inventory).remaining, 4,
  'the next unopened bottle starts full');

for (let i = 0; i < 4; i++) assert.equal(bridge.offerNpcSwig({ rec: { id: 'kzubug', name: 'Kzubug' } }), true);
const npcState = bridge.getDebug().npcAlcoholState.kzubug;
assert.equal(npcState.sobriety, 0, 'four full-strength wine swigs deplete NPC sobriety');
assert.equal(bridge.isNpcBlackedOut('kzubug'), true, 'zero sobriety enters a timed no-teleport blackout');
assert(npcState.blackoutUntilMinute >= 100, 'blackout duration is derived from the sobriety deficit');

const recipeKey = 'alchemy_recipe_healingPotion'; // Used to reproduce a generated physical recipe whose lightweight wheel entry has not received recipe metadata yet.
let recipeReads = 0; // Used to prove immediate Item Action dispatch reaches the alchemy reader exactly once.
let recipeDrinks = 0; // Used to prove a recipe whose label contains “Potion” never enters the drink animation/consumption path.
inventory[recipeKey] = 1;
activeItem = { key: recipeKey, label: 'Recipe: Healing Potion', icon: '📜', cat: 'processed', tags: ['Alchemy'] };
windowStub.AlchemySystem = {
  REAGENT_DEFS: {},
  RECIPE_DEFS: { healingPotion: { id: 'healingPotion', useMode: 'drink' } },
  POTION_ITEMS: {},
  getPotionEffectsFromKey() { return null; },
  readRecipeItem(key) {
    recipeReads++;
    inventory[key] = Math.max(0, Number(inventory[key]) - 1);
    return { ok: true, message: 'Learned Healing Potion.' };
  },
  drinkPotion() { recipeDrinks++; return { ok: false, message: 'No potion to drink.' }; },
};
const recipeAction = bridge.getHeldItemAction(); // Used to exercise the same semantic action descriptor shown by touch, keyboard, and controller action slots.
assert.equal(recipeAction?.action, 'consume_held_item', 'a generated recipe still uses the normal held-item action slot');
assert.match(recipeAction?.label || '', /^Read Recipe: Healing Potion$/, 'a stale generated recipe entry resolves to Read instead of Drink/Eat');
assert.equal(recipeAction?.holdToCommit, false, 'reading stays immediate and must not start the drink hold animation');
assert.equal(bridge.consumeHeldItemImmediate(), true, 'the immediate action dispatcher reads the physical recipe');
assert.equal(recipeReads, 1, 'the alchemy recipe reader runs exactly once');
assert.equal(recipeDrinks, 0, 'the potion-drinking path is never called for a physical recipe');
assert.equal(inventory[recipeKey], 0, 'reading consumes the physical recipe item');
const recipeDebug = bridge.getDebug().heldItemAction; // Used as the mobile-friendly route diagnostic after the recipe stack was consumed.
assert.equal(recipeDebug.key, recipeKey, 'held-item diagnostics retain the selected recipe key');
assert.equal(recipeDebug.keyedRecipeScrollId, 'healingPotion', 'held-item diagnostics expose key-derived recipe recognition');

assert.match(combat, /consumeBottleSwig[\s\S]*?RS\.addDrunkenness/,
  'every alcohol swig still applies the existing full drunkenness effect');
assert.match(alcoholUi, /alcohol-swig-badge[\s\S]*?status\.remaining.*status\.total/,
  'the decoupled alcohol UI renders remaining/total serving badges');
assert.match(game, /AlcoholInventoryUI\?\.init[\s\S]*?AlcoholInventoryUI\?\.applySwigBadge/,
  'inventory and HUD icon rendering delegates alcohol badges through a narrow adapter');
assert.match(game, /getNpcSwigOfferAction[\s\S]*?npc_offer_alcohol_swig/,
  'nearby NPC actions include the contextual held-bottle offer');
assert.match(bridgeSource, /playNpcDrinkInteraction[\s\S]*?applyNpcSwig/,
  'accepted offers defer NPC sobriety application to synchronized drink playback');
assert.match(popup, /function syncInteractionPrompts[\s\S]*?worldInteractions\.length > 0[\s\S]*?setInteractionPrompts/,
  'the popup module selects and labels contextual or multiple world interactions');
assert.match(game, /WorldPopupText\?\.syncInteractionPrompts/,
  'game.js delegates prompt-list synchronization instead of implementing it');
assert.match(popup, /function setInteractionPrompts[\s\S]*?interactionPrompt: true/,
  'world popup text owns persistent interaction-list entries');
assert(drunk.includes('drunkLossProvider') && drunk.includes('drunkBodyRoot'),
  'NPC leg rigs reuse the player drunken gait and body-sway layer');
assert.match(npcCharacterState, /movementSpeedMultiplier[\s\S]*?setBlackoutPose[\s\S]*?state = 'alcohol-blackout'/,
  'the NPC state module slows locomotion and holds a zero-sobriety NPC prone');
assert.doesNotMatch(game, /function applyAlcoholSwigBadge|worldInteractions\.length > 0|isNpcBlackedOut/,
  'alcohol badge, prompt selection, and blackout implementations stay out of game.js');
assert.equal(config.npcAlcoholOffers.default.acceptMode, 'always', 'all NPCs accept by default in this pass');
assert.match(ambient, /resolveAlcoholOffer[\s\S]*?acceptMode/,
  'ambient dialogue resolves NPC-specific accept/refuse rules');
assert.match(editor, /Offered alcohol[\s\S]*?Accept dialogue[\s\S]*?Refuse dialogue/,
  'the Ambient Dialogue editor exposes NPC alcohol responses');

console.log('Alcohol swig, held-recipe routing, contextual offer, and NPC sobriety checks passed.');