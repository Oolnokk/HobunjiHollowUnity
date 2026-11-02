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
const toasts = []; // Player-facing refusals from the production hold accessor.
const context = { window, packClothing: pack, inventory: {}, ITEM_DEFS: {}, refreshActionBar() {}, showToast: message => { toasts.push(message); }, getActiveInventoryItem: () => null }; // Runtime dependencies of the accessor block.
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
// A cursed garment (looted lich circlet / Maskbound mask) can be neither held for gifting nor handed to an NPC.
const cursedItem = { uid: 'cursed-circlet', cosmeticId: 'lich_circlet', label: 'Cursed Circlet', slot: 'hat', cursed: { kind: 'circlet', dispelBy: 'garanki', originalLabel: 'Circlet' } };
pack.push(cursedItem); context.packClothing.push(cursedItem);
const cursedHeld = { kind: 'clothing', instance: cursedItem };
assert.equal(window.NpcGifting.isItemGiftable(cursedHeld), false, 'cursed pack clothing is not giftable');
toasts.length = 0;
vm.runInContext("setManualHeldItem({ kind: 'clothing', uid: 'cursed-circlet' })", context);
assert.equal(vm.runInContext('getManualHeldItem()', context), null, 'cursed clothing cannot be held for gifting');
assert.match(toasts[0] || '', /cursed/i, 'the refusal says why');
held = cursedHeld;
assert.equal(window.NpcGifting.getNpcGiftOfferAction(npc), null, 'no gift action is offered for cursed clothing');
const acceptedBefore = accepted, savedBefore = saved;
assert.equal(window.NpcGifting.offerGift(npc), false, 'a direct gift attempt is refused');
assert.equal(accepted, acceptedBefore, 'a cursed gift never reaches the NPC wardrobe');
assert.equal(saved, savedBefore);
assert(pack.includes(cursedItem), 'the cursed garment stays in the pack');
delete cursedItem.cursed; // Once Garanki lifts the curse it is an ordinary pack garment again.
assert.equal(window.NpcGifting.isItemGiftable(cursedHeld), true, 'a dispelled garment is giftable');
console.log('Permanent gear hold/gift protection passed.');
