#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/npc-wardrobe.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.doesNotThrow(() => new vm.Script(source), 'NPC wardrobe runtime parses');
assert.doesNotMatch(source, /rerollForSleep|Bedtime reroll/, 'sleep-time wardrobe rerolls are removed');
assert.doesNotMatch(gameSource, /NpcWardrobe\?\.rerollForSleep|_prevScheduleActivity/, 'game no longer waits for an NPC sleep transition to change clothing');

let saves = 0;
const profileBuilds = [];
const rec = {
  id: 'test_npc',
  name: 'Test NPC',
  species: 'Engh-Sho',
  gender: 'female',
  appearance: {
    speciesId: 'engh-sho',
    gender: 'female',
    cosmetics: { eyes: 'engh_snowgoggles' },
    bodyColors: { A: { h: 17, s: -0.9, v: 0.223 } },
  },
  equippedCosmetics: ['rugged_poncho'],
  appliedDyes: { CLOTH: 'dye:CLOTH:old' },
  gifts: { loved: ['style:test'], liked: [], disliked: ['style:itchy'], hated: ['style:garish'] },
};
const walker = {
  rec,
  profile: { appearance: { speciesId: 'mao-ao', gender: 'male' } }, // Deliberately wrong stale profile reproduces the Teacup species bug if refresh reads profile.appearance.
  avatarGroup: { userData: { frontTexture: true } },
  avatarFrontCanvas: {},
  avatarBackCanvas: null,
};
const gearInventory = { clothingItems: [], clothing: {} };

const context = {
  window: null,
  console,
  Math,
  document: {},
  ItemTraits: {
    computeItemTraits(cosmeticId) {
      if (cosmeticId === 'itchy_poncho') return ['style:test', 'style:itchy'];
      if (cosmeticId === 'garish_hat') return ['style:test', 'style:garish'];
      return ['style:test'];
    },
    getTraitLabel(trait) { return trait; },
  },
  NpcAvatarPreview: {
    buildProfileFromNpcExport(npc) {
      profileBuilds.push(JSON.parse(JSON.stringify(npc)));
      return { fighter: { id: 'engh-sho-female' }, bodyColors: { ...(npc.appearance?.bodyColors || {}) } };
    },
    async renderProfileToCanvas() { return true; },
  },
  PNGPlaneAvatar: {
    refreshSinglePlaneAvatarModel() { return true; },
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
  assert.equal(verdict.accepted, true, 'compatible gift is accepted');
  assert.equal(verdict.worn, true, 'compatible non-disliked gift is tried on immediately');
  assert.equal(verdict.wearBlockedBy, null, 'ordinary accepted gift has no wear veto');
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['fine_poncho'], 'gift replaces the currently worn garment in the same slot immediately');

  let contents = wardrobe.getWardrobeContents('test_npc');
  assert.equal(contents.worn[0].cosmeticId, 'fine_poncho', 'gift appears as currently worn without sleeping');
  assert.equal(contents.stored.length, 1, 'displaced original garment moves into storage');
  assert.equal(contents.stored[0].cosmeticId, 'rugged_poncho', 'previous garment remains recoverable');

  const dislikedGift = wardrobe.offerClothing('test_npc', {
    uid: 'player_owned_disliked',
    cosmeticId: 'itchy_poncho',
    slot: 'overwear',
    colorA: null,
  });
  assert.equal(dislikedGift.accepted, true, 'compatible disliked clothing may still enter storage');
  assert.equal(dislikedGift.worn, false, 'any disliked clothing trait vetoes immediate wearing even when another trait is loved');
  assert.equal(dislikedGift.wearBlockedBy, 'style:itchy', 'gift result reports the exact disliked trait that blocked wearing');
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['fine_poncho'], 'disliked gift does not replace the current garment');

  const dislikedStored = wardrobe.getWardrobeContents('test_npc').stored.find(item => item.cosmeticId === 'itchy_poncho');
  assert.ok(dislikedStored?.uid, 'disliked accepted clothing remains stored');
  assert.equal(await wardrobe.wearStoredItem('test_npc', dislikedStored.uid), false, 'manual Wear also refuses a disliked garment');

  const hatedGift = wardrobe.offerClothing('test_npc', {
    uid: 'player_owned_hated',
    cosmeticId: 'garish_hat',
    slot: 'hat',
    colorA: null,
  });
  assert.equal(hatedGift.accepted, true, 'compatible hated-trait clothing can still be stored');
  assert.equal(hatedGift.worn, false, 'any hated trait vetoes wearing');
  assert.equal(hatedGift.wearBlockTier, 'hated', 'hated refusal keeps the stronger tier');

  assert.equal(await wardrobe.storeWornItem('test_npc', 'fine_poncho'), true, 'Store immediately removes a worn garment');
  assert.equal(rec.equippedCosmetics.length, 0, 'Store immediately leaves the NPC no longer wearing the unwanted garment');
  const storeRefresh = profileBuilds.at(-1);
  assert.equal(storeRefresh.appearance.speciesId, 'engh-sho', 'wardrobe rerender preserves NPC species from rec.appearance');
  assert.equal(storeRefresh.appearance.gender, 'female', 'wardrobe rerender preserves NPC gender');
  assert.deepEqual(storeRefresh.appearance.bodyColors, rec.appearance.bodyColors, 'wardrobe rerender preserves authored body colors');

  contents = wardrobe.getWardrobeContents('test_npc');
  const oldGarment = contents.stored.find(item => item.cosmeticId === 'rugged_poncho');
  assert.ok(oldGarment?.uid, 'original garment has a stable wardrobe id');
  assert.equal(await wardrobe.wearStoredItem('test_npc', oldGarment.uid), true, 'Wear immediately equips a stored garment');
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['rugged_poncho'], 'manual wardrobe correction is immediately visible in runtime state');

  const snapshot = JSON.parse(JSON.stringify(wardrobe.serialize()));
  assert.equal(snapshot.version, 2, 'wardrobe save format includes outfit overrides');
  assert.deepEqual(snapshot.outfits.test_npc.equippedCosmetics, ['rugged_poncho'], 'corrected worn outfit is persisted');

  rec.equippedCosmetics = ['bogus_after_save'];
  rec.appliedDyes = {};
  wardrobe.restore(snapshot);
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['rugged_poncho'], 'load restores the corrected worn outfit');
  assert.ok(saves >= 2, 'manual Store/Wear operations request world persistence');

  console.log('Immediate NPC wardrobe behavior passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
