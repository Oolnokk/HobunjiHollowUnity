#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies live ownership checks and gift side effects.
const fs = require('node:fs'); // Loads production modules for execution.
const vm = require('node:vm'); // Runs gifting with isolated inventory state.
const gearItem = { uid: 'gear-hat', cosmeticId: 'hat', label: 'Hat', slot: 'hat' }; // Permanent collected article.
const packItem = { uid: 'pack-hat', cosmeticId: 'hat', label: 'Hat', slot: 'hat' }; // Separate copy remains giftable.
const gear = { clothingItems: [gearItem], clothing: { hat: gearItem } }; // Worn and unworn ownership checks share this state.
let pack = [packItem]; // Mutated only when an eligible pack gift is kept.
let held = { kind: 'clothing', instance: gearItem }; // Allows direct attempts to bypass the inventory UI.
let accepted = 0; // Tracks whether blocked gifts reach the NPC wardrobe.
let saved = 0; // Tracks whether blocked gifts persist any changes.
const window = { // Minimal runtime services used by a successful clothing gift.
  ItemTraits: { computeItemTraits: () => [] },
  NpcWardrobe: { offerClothing: () => { accepted++; return { accepted: true }; } },
};
vm.runInNewContext(fs.readFileSync('docs/js/npc-gifting.js', 'utf8'), { window });
window.NpcGifting.init({
  inventory: {}, getItemDefs: () => ({}), getHeldGiftItem: () => held,
  getGearInventory: () => gear, getPackClothing: () => pack,
  setPackClothing: items => { pack = items; }, saveMemberWorldData: () => { saved++; },
});
const npc = { rec: { id: 'test-npc', name: 'Test NPC' } }; // Target for both offer visibility and direct gift attempts.
assert.equal(window.NpcGifting.isItemGiftable(held), false);
assert.equal(window.NpcGifting.getNpcGiftOfferAction(npc), null);
assert.equal(window.NpcGifting.offerGift(npc), false);
assert.equal(accepted, 0);
assert.equal(saved, 0);
assert.equal(gear.clothing.hat, gearItem);
assert.deepEqual(gear.clothingItems, [gearItem]);
gear.clothing.hat = null;
assert.equal(window.NpcGifting.isItemGiftable(held), false, 'unworn gear is still permanent');
gear.clothingItems = [];
gear.clothing.hat = gearItem;
assert.equal(window.NpcGifting.isItemGiftable(held), false, 'legacy worn-only gear is protected');
pack.push(gearItem);
assert.equal(window.NpcGifting.isItemGiftable(held), false, 'gear wins if a stale pack entry shares its UID');
pack = [packItem];
assert.equal(window.NpcGifting.isItemGiftable({ kind: 'clothing', instance: {} }), false);
assert.equal(window.NpcGifting.isItemGiftable({ kind: 'clothing', instance: { uid: 'missing' } }), false);
held = { kind: 'clothing', instance: packItem };
assert.equal(window.NpcGifting.isItemGiftable(held), true, 'another copy of the same cosmetic can be gifted from pack');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Executes the production manual-hold accessors without booting WebGL.
const holdSource = gameSource.slice(gameSource.indexOf('      let manualHeldItem = null;'), gameSource.indexOf('      function clampInventoryStack(')); // Bounded production block containing hold state/accessors.
const context = { window, packClothing: pack, inventory: {}, ITEM_DEFS: {}, refreshActionBar() {}, showToast() {}, getActiveInventoryItem: () => null }; // Runtime dependencies of the accessor block.
vm.createContext(context);
vm.runInContext(holdSource, context);
vm.runInContext("setManualHeldItem({ kind: 'clothing', uid: 'gear-hat' })", context);
assert.equal(vm.runInContext('getManualHeldItem()', context), null, 'gear cannot be manually held');
vm.runInContext("setManualHeldItem({ kind: 'clothing', uid: 'pack-hat' })", context);
assert.equal(vm.runInContext('getHeldGiftItem().instance.uid', context), 'pack-hat');
gear.clothingItems.push(packItem);
assert.equal(vm.runInContext('getHeldGiftItem()', context), null, 'transferred clothing cannot remain a gift');
assert.equal(vm.runInContext('getManualHeldItem()', context), null, 'stale hold clears');
assert.equal(window.NpcGifting.offerGift(npc), false, 'direct gift revalidates ownership after transfer');
gear.clothingItems = [];
assert.equal(window.NpcGifting.offerGift(npc), true);
assert.equal(accepted, 1);
assert.equal(saved, 1);
assert.deepEqual(pack, []);
assert.equal(gear.clothing.hat, gearItem, 'pack gifting preserves worn gear');
console.log('Permanent gear hold/gift protection passed.');
