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
windowStub.FarmCrates.init({
  inventory,
  calendar: { day: 1, time01: 0 },
  getHeldMode: () => 'item',
  getActiveInventoryItem: () => wine,
  clampInventoryStack: key => { if (inventory[key] <= 0) delete inventory[key]; },
  triggerHeldDrinkAnimation: () => 0,
  canPlayNpcDrinkInteraction: () => true,
  playNpcDrinkInteraction: (walker, key, onDrink) => { onDrink(); return 180; },
  showToast() {}, refreshItemScroll() {}, buildInventoryGrid() {}, refreshActionBar() {}, saveMemberWorldData() {},
});

const bridge = windowStub.HobunjiDrunkGameplayBridge;
assert.deepEqual(JSON.parse(JSON.stringify(bridge.getBottleSwigStatus('wine', wine, inventory))),
  { key: 'wine', remaining: 4, total: 4, bottleCount: 2 });
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

assert.match(combat, /consumeBottleSwig[\s\S]*?RS\.addDrunkenness/,
  'every alcohol swig still applies the existing full drunkenness effect');
assert.match(game, /alcohol-swig-badge[\s\S]*?remaining.*total/,
  'inventory and HUD icons render remaining/total serving badges');
assert.match(game, /getNpcSwigOfferAction[\s\S]*?npc_offer_alcohol_swig/,
  'nearby NPC actions include the contextual held-bottle offer');
assert.match(bridgeSource, /playNpcDrinkInteraction[\s\S]*?applyNpcSwig/,
  'accepted offers defer NPC sobriety application to synchronized drink playback');
assert.match(game, /worldInteractions\.length > 1[\s\S]*?setInteractionPrompts/,
  'multiple world interactions use the shared popup-list prompt path');
assert.match(popup, /function setInteractionPrompts[\s\S]*?interactionPrompt: true/,
  'world popup text owns persistent interaction-list entries');
assert(drunk.includes('drunkLossProvider') && drunk.includes('drunkBodyRoot'),
  'NPC leg rigs reuse the player drunken gait and body-sway layer');
assert.match(game, /npcSpeedMultiplier[\s\S]*?alcoholBlackout[\s\S]*?state = 'alcohol-blackout'/,
  'NPC sobriety slows locomotion and holds a zero-sobriety NPC prone');
assert.equal(config.npcAlcoholOffers.default.acceptMode, 'always', 'all NPCs accept by default in this pass');
assert.match(ambient, /resolveAlcoholOffer[\s\S]*?acceptMode/,
  'ambient dialogue resolves NPC-specific accept/refuse rules');
assert.match(editor, /Offered alcohol[\s\S]*?Accept dialogue[\s\S]*?Refuse dialogue/,
  'the Ambient Dialogue editor exposes NPC alcohol responses');

console.log('Alcohol swig, contextual offer, and NPC sobriety checks passed.');
