#!/usr/bin/env node
'use strict';

// The Knotworked Armament must also trigger if a player obtains Fey magic on an
// owned, non-relic weapon through the canonical enchantment APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const profile = { worldId: 'fey-weapon-acquisition', questProgress: {} }; // Holds the member-scoped quest record used in this regression.
const inventory = { gold: 100 }; // Empty of bound Fey weapons to isolate enchantment acquisition from relic rewards.
let gear = { tools: { sword: true }, weaponEnchantments: {} }; // Owned weapon and authoritative enchantment storage, replaced between scenarios.
let saves = 0; // Counts real quest persistence calls, which must happen only on first Fey acquisition.
let gearSaves = 0; // Confirms the enchantment API still saves gear through its normal owner.
const notices = []; // Captures quest notifications without a browser.
const context = {
  console, Date, Math,
  performance: { now: () => 123 },
  document: { addEventListener() {} },
  __hobunjiPlayerProfile: profile,
  Combat: {
    deps: { getGearInventory: () => gear, saveGearInventory: () => { gearSaves++; }, currentWeaponKey: () => 'sword' },
    loadout: { SLOT_IDS: ['tap1', 'tap2', 'hold1', 'hold2'] },
  },
  CombatAttackEvents: { on() {} },
  DialogueContent: { registerContextProvider() {}, registerNodeEnterHandler() {} },
};
context.window = context; // Gameplay modules deliberately use window for shared services.
context.globalThis = context;
vm.createContext(context);
for (const path of ['docs/js/combat/combat-enchantments.js', 'docs/js/fey-armament-quest.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
}
const quest = context.FeyArmamentQuest;
const es = context.EnchantmentSystem;
quest.bindInventoryDeps({
  inventory,
  getGearInventory: () => gear,
  saveMemberWorldData() { saves++; },
  showToast(message) { notices.push(message); },
});
quest.bindQuestDeps({ getQuestProgress: () => profile.questProgress });

assert.equal(es.addBase('unownedWeapon', 'feyPhantomWound'), true);
assert.equal(quest.debugSnapshot().status, 'not-started', 'enchanting an unowned weapon must not start a quest');
assert.equal(saves, 0);

assert.equal(es.addBase('sword', 'burning'), true);
assert.equal(quest.debugSnapshot().status, 'not-started', 'ordinary planar enchanting must not start the Fey quest');
assert.equal(saves, 0);

assert.equal(es.setFlourish('sword', 'tap1', 'feyMazeStep'), true);
assert.equal(quest.debugSnapshot().stage, 0, 'a newly acquired Fey Flourish starts the quest');
assert.equal(saves, 1, 'the new quest immediately persists to the member profile');
assert.equal(quest.ownedFeyWeaponKeys().includes('sword'), true);

assert.equal(es.setFlourish('sword', 'hold2', 'feyEchoDread'), true);
assert.equal(saves, 1, 'further Fey enchantments never restart or re-save the quest');

profile.questProgress = {}; // Simulates a different member who hasn't encountered Fey magic.
gear = { tools: { sword: true }, weaponEnchantments: {} }; // The second member owns a different clean sword.
assert.equal(es.addBase('sword', 'feyPhantomWound'), true);
assert.equal(quest.debugSnapshot().stage, 0, 'acquiring a Fey Base enchantment also starts the quest');
assert.equal(saves, 2);
assert(gearSaves >= 5, 'gear writes are still handled by EnchantmentSystem');
assert.equal(notices.filter(message => message.includes('Quest started:')).length, 2, 'one quest notice per member');

console.log('Fey quest: non-relic Base/Flourish acquisition, ordinary magic, ownership, repeat safety and persistence passed.');
