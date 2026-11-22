#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Checks gift offers and their side effects.
const fs = require('node:fs'); // Loads the production held-item resolver and gifting code.
const vm = require('node:vm'); // Runs real game functions without booting the renderer.

const source = fs.readFileSync('docs/game.js', 'utf8'); // Production authority for which object is actually held.
const from = source.indexOf('      let manualHeldItem = null;');
const to = source.indexOf('      function clampInventoryStack(', from);
assert(from >= 0 && to > from, 'canonical manual-hold/gift-accessor block exists');

const inventory = { apple: 4, acorn: 2, carriedTool: 2 }; // Tracks gift consumption and rejected transactions.
const definitions = { apple: { label: 'Apple', icon: '🍎' }, acorn: { label: 'Acorn', icon: '🌰' }, carriedTool: { label: 'Tool', icon: '🔧', cat: 'tool' } }; // Ordinary bag item metadata.
const packGarment = { uid: 'pack-cloak', cosmeticId: 'cloak', label: 'Cloak', slot: 'cape' }; // Explicit Pack Hold clothing case.
let selected = { key: 'apple' }; // Wheel's remembered selection, even when the player's hands are busy.
let heldBurden = null; // Physical Burden independently overrides the item wheel.
let festivalVessel = null; // Non-inventory festival bowl or cup, never a gift.
let festivalCup = null; // Existing virtual-cup guard must remain supported.
let favorWrites = 0; // Relationship changes must only happen on accepted gifts.
let dailyWrites = 0; // Daily gift limit cannot be consumed by a blocked attempt.
let saveWrites = 0; // A rejected gift must never write a save.
let wardrobeWrites = 0; // Garment offers cannot reach NPC wardrobe when stowed.
const toasts = []; // In-game feedback is available without browser developer tools.
const window = {
  Shattercasks: { heldBurdenInfo: () => heldBurden },
  FestivalSystem: { festivalCup: () => festivalCup, heldVessel: () => festivalVessel },
  MusicMinigame: { state: { instrumentItem: null } },
  ItemTraits: { computeItemTraits: () => [], isTraitDiscovered: () => false },
  DialogueContent: { adjustNpcFavor: () => { favorWrites++; } },
  NpcRapport: { adjust: () => {}, markGiftedToday: () => { dailyWrites++; } },
  NpcWardrobe: { offerClothing: () => { wardrobeWrites++; return { accepted: true }; } },
};
const context = vm.createContext({
  window, heldMode: 'item', packClothing: [packGarment], inventory, ITEM_DEFS: definitions,
  getActiveInventoryItem: () => selected,
  refreshActionBar() {},
  showToast: msg => { toasts.push(msg); },
});
vm.runInContext(fs.readFileSync('docs/js/held-gift-policy.js', 'utf8'), context, { filename: 'held-gift-policy.js' });
vm.runInContext(source.slice(from, to), context, { filename: 'game-held-gift-accessor.js' });
vm.runInContext(fs.readFileSync('docs/js/npc-gifting.js', 'utf8'), context, { filename: 'npc-gifting.js' });
const heldGift = () => vm.runInContext('getHeldGiftItem()', context);
window.NpcGifting.init({
  inventory,
  getHeldGiftItem: heldGift,
  getItemDefs: () => definitions,
  getPackClothing: () => context.packClothing,
  setPackClothing: items => { context.packClothing = items; },
  getGearInventory: () => ({ clothing: {}, clothingItems: [] }),
  clearManualHeldItem: () => vm.runInContext('clearManualHeldItem()', context),
  clampInventoryStack() {},
  showToast: message => { toasts.push(message); },
  saveMemberWorldData: () => { saveWrites++; },
});
const npc = { rec: { id: 'gift-test-npc', name: 'Neighbor', gifts: {} } }; // Ordinary recipient shared by all tested states.
const gifting = window.NpcGifting;
const stats = () => [inventory.apple, inventory.acorn, favorWrites, dailyWrites, saveWrites, wardrobeWrites]; // Captures all observable transfer side effects.
function rejectsWithoutSideEffects(reason) {
  const before = stats(); // Rejected transactions must not consume an item, Favor, daily limit or save.
  assert.equal(heldGift(), null, reason + ': no current gift');
  assert.equal(gifting.getNpcGiftOfferAction(npc), null, reason + ': no Gift button');
  assert.equal(gifting.offerGift(npc), false, reason + ': stale/direct Gift press rejected');
  assert.deepEqual(stats(), before, reason + ': no gift side effects');
}

assert.equal(heldGift().key, 'apple', 'a drawn item resolves the selected inventory stack');
assert.equal(vm.runInContext('getVisibleInventoryItem().key', context), 'apple', 'normal item rendering reads the same source');
assert(gifting.getNpcGiftOfferAction(npc), 'Gift action appears while an item is really held');
context.heldMode = 'tool';
context.activeTool = 'shovel';
rejectsWithoutSideEffects('shovel drawn');
context.activeTool = 'weapon';
rejectsWithoutSideEffects('weapon drawn');
context.activeTool = 'ranged';
rejectsWithoutSideEffects('ranged weapon drawn');
context.heldMode = 'none';
rejectsWithoutSideEffects('hands stowed, wheel selection remembered');

context.heldMode = 'item';
assert(gifting.getNpcGiftOfferAction(npc), 'Gift prompt recovers after selecting the item again');
context.heldMode = 'tool'; // Simulates a mode switch after the button was built but before its action executes.
rejectsWithoutSideEffects('stale prompt after switching to a tool');

context.heldMode = 'item';
heldBurden = { id: 'physical-cask' };
rejectsWithoutSideEffects('burden in hands while item mode is stale');
heldBurden = null;
festivalVessel = { id: 'festival-bowl' };
rejectsWithoutSideEffects('festival bowl covers the selected item');
festivalVessel = null;
festivalCup = { id: 'festival-cup' };
rejectsWithoutSideEffects('festival cup covers the selected item');
festivalCup = null;
window.MusicMinigame.state.instrumentItem = { key: 'kurraya', icon: '🎼' };
rejectsWithoutSideEffects('instrument performance takes the hand pose');
window.MusicMinigame.state.instrumentItem = null;

selected = { key: 'carriedTool' };
const toolBefore = stats(); // A Pack tool must not be gifted just because item mode is selected.
assert.equal(gifting.isItemGiftable(heldGift()), false, 'tools are not gift items');
assert.equal(gifting.getNpcGiftOfferAction(npc), null, 'no Gift prompt for a Pack tool');
assert.equal(gifting.offerGift(npc), false, 'direct tool gifting is denied');
assert.deepEqual(stats(), toolBefore, 'blocked tool gift has no mutation');
selected = { key: 'apple' };

assert.equal(gifting.offerGift(npc), true, 'a drawn item can still be gifted');
assert.equal(inventory.apple, 3, 'one actual held item is consumed');
assert.equal(favorWrites, 1, 'an accepted gift grants Favor once');
assert.equal(dailyWrites, 1, 'accepted gifts use the normal quota');
assert.equal(saveWrites, 1, 'accepted gifts save');

vm.runInContext("setManualHeldItem({ kind: 'bagItem', key: 'acorn' })", context);
assert.equal(heldGift(), null, 'manual Pack selection cannot gift before the held-item override moves the visible arch');
selected = { key: 'acorn' }; // InventoryHeldOverride's actual sync operation makes the Pack item the displayed item.
assert.equal(heldGift().key, 'acorn', 'explicit Pack Hold overrides the selected wheel item once it is visible');
context.heldMode = 'none';
rejectsWithoutSideEffects('explicit Pack Hold is stowed');
context.heldMode = 'item';
assert.equal(gifting.offerGift(npc), true, 'explicitly held off-arch Pack item remains giftable');
assert.equal(inventory.acorn, 1, 'Pack Hold consumes the held stack, not the remembered wheel stack');
vm.runInContext('clearManualHeldItem()', context);
selected = { key: 'apple' };

context.heldMode = 'tool';
vm.runInContext("setManualHeldItem({ kind: 'clothing', uid: 'pack-cloak' })", context);
assert.equal(context.heldMode, 'item', 'the Pack clothing Hold button actually draws the garment');
assert.equal(vm.runInContext('getVisibleInventoryItem().key', context), 'pack-clothing:pack-cloak', 'the held renderer now selects the same garment that gifting can give');
assert.equal(heldGift().kind, 'clothing', 'explicitly held uncollected clothing remains giftable');
context.heldMode = 'tool';
rejectsWithoutSideEffects('Pack clothing not in hands while holding a tool');
context.heldMode = 'none';
rejectsWithoutSideEffects('Pack clothing not in hands while fully stowed');
context.heldMode = 'item';
assert.equal(gifting.offerGift(npc), true, 'explicitly held Pack clothing can be given in item mode');
assert.equal(wardrobeWrites, 1, 'valid garment gift still reaches the wardrobe');
assert.equal(context.packClothing.length, 0, 'accepted garment leaves the pack');
assert.equal(vm.runInContext('getVisibleInventoryItem().key', context), 'apple', 'gifted clothing no longer occupies the visual hand slot');
console.log('NPC gifting requires a drawn item; tools, weapons, burdens, vessels, and stowed hands are blocked.');
