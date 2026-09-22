#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/npc-wardrobe.js', 'utf8'); // Runtime under test is executed exactly as shipped.
assert.doesNotThrow(() => new vm.Script(source), 'NPC wardrobe runtime parses');
assert.doesNotMatch(source, /rerollForSleep|Bedtime reroll/, 'sleep-time wardrobe rerolls are removed');

let saves = 0; // Counts persistence requests from manual wardrobe edits.
const rec = {
  id: 'test_npc',
  name: 'Test NPC',
  equippedCosmetics: ['rugged_poncho'],
  appliedDyes: { CLOTH: 'dye:CLOTH:old' },
  gifts: { liked: ['style:test'] },
};
const walker = { rec, profile: { appearance: {} }, avatarGroup: {} };
const gearInventory = { clothingItems: [], clothing: {} };

const context = {
  window: null,
  console,
  Math,
  document: {},
  ItemTraits: {
    computeItemTraits() { return ['style:test']; },
  },
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'npc-wardrobe.js' });

const wardrobe = context.NpcWardrobe;
wardrobe.init({
  npcWalkers: [walker],
  getGearInventory: () => gearInventory,
  saveGearInventory() {},
  saveMemberWorldData() { saves++; },
  showToast() {},
});

(async () => {
  const verdict = wardrobe.offerClothing('test_npc', {
    uid: 'player_owned_original',
    cosmeticId: 'fine_poncho',
    slot: 'overwear',
    colorA: { dyeId: 'dye:CLOTH:new' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(verdict)), { accepted: true, worn: true }, 'accepted gift is tried on immediately');
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['fine_poncho'], 'new gift replaces the currently worn garment in the same slot immediately');

  let contents = wardrobe.getWardrobeContents('test_npc');
  assert.equal(contents.worn[0].cosmeticId, 'fine_poncho', 'gift appears as currently worn without a sleep transition');
  assert.equal(contents.stored.length, 1, 'displaced original garment moves into storage');
  assert.equal(contents.stored[0].cosmeticId, 'rugged_poncho', 'the previous garment remains recoverable');

  assert.equal(await wardrobe.storeWornItem('test_npc', 'fine_poncho'), true, 'Store immediately removes a worn garment');
  assert.equal(rec.equippedCosmetics.length, 0, 'Store leaves the NPC no longer wearing the unwanted gift');
  contents = wardrobe.getWardrobeContents('test_npc');
  assert.equal(contents.stored.some(item => item.cosmeticId === 'fine_poncho'), true, 'stored unwanted gift remains in the NPC wardrobe');

  const oldGarment = contents.stored.find(item => item.cosmeticId === 'rugged_poncho');
  assert.ok(oldGarment?.uid, 'original garment has a stable wardrobe id');
  assert.equal(await wardrobe.wearStoredItem('test_npc', oldGarment.uid), true, 'Wear immediately equips a stored garment');
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['rugged_poncho'], 'manual correction is visible in runtime outfit state immediately');

  const snapshot = JSON.parse(JSON.stringify(wardrobe.serialize()));
  assert.equal(snapshot.version, 2, 'wardrobe save format includes outfit overrides');
  assert.deepEqual(snapshot.outfits.test_npc.equippedCosmetics, ['rugged_poncho'], 'corrected worn outfit is persisted');

  rec.equippedCosmetics = ['bogus_after_save'];
  rec.appliedDyes = {};
  wardrobe.restore(snapshot);
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['rugged_poncho'], 'load restores the manually corrected worn outfit');
  assert.ok(saves >= 2, 'manual Store/Wear operations request world persistence');

  console.log('Immediate NPC wardrobe behavior passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
