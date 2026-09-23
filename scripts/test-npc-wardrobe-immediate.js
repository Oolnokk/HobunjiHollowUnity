#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/npc-wardrobe.js', 'utf8');
const giftingSource = fs.readFileSync('docs/js/npc-gifting.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.doesNotThrow(() => new vm.Script(source), 'NPC wardrobe runtime parses');
assert.doesNotThrow(() => new vm.Script(giftingSource), 'NPC gifting runtime parses');
assert.doesNotMatch(source, /rerollForSleep|Bedtime reroll|changes only at bedtime/, 'sleep-time wardrobe behavior is removed');
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
    bodyDeformation: { shoulderWidth: 0.82 },
  },
  equippedCosmetics: ['rugged_poncho'],
  appliedDyes: {
    TORSO: 'dye:CLOTH:orphaned_torso',
    CLOTH: 'dye:CLOTH:old_primary',
    CLOTH_B: 'dye:CLOTH:old_trim',
  },
  gifts: { loved: ['style:test'], liked: [], disliked: ['style:itchy'], hated: ['style:garish'] },
};
const fallbackRec = {
  id: 'legacy_identity_npc',
  name: 'Legacy Identity NPC',
  species: 'Engh-Sho',
  gender: 'female',
  appearance: {
    gender: 'female',
    cosmetics: { eyes: 'legacy_eyes' },
    bodyColors: { A: { h: 9, s: 0.4, v: 0.6 } },
    bodyDeformation: { shoulderWidth: 1.17 },
    customAppearanceMarker: { keep: true },
  },
  equippedCosmetics: ['plain_tunic'],
  appliedDyes: { TORSO: 'dye:CLOTH:legacy_torso' },
  gifts: { loved: ['style:test'], liked: [], disliked: [], hated: [] },
};
const walker = {
  rec,
  profile: { appearance: { speciesId: 'mao-ao', gender: 'male' } }, // Deliberately wrong stale profile reproduces the Teacup species bug if refresh reads profile.appearance.
  avatarGroup: { userData: { frontTexture: true } },
  avatarFrontCanvas: {},
  avatarBackCanvas: null,
};
const fallbackWalker = {
  rec: fallbackRec,
  profile: { appearance: { speciesId: 'mao-ao', gender: 'male' } },
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
  DialogueContent: { adjustNpcFavor() {} },
  ItemTraits: {
    computeItemTraits(cosmeticId, item) {
      if (cosmeticId === 'itchy_poncho') return ['style:test', 'style:itchy'];
      if (cosmeticId === 'garish_hat') return ['style:test', 'style:itchy', 'style:garish'];
      const traits = ['style:test'];
      if (item?.colorA === 'dye:CLOTH:old_primary') traits.push('color:old-primary');
      if (item?.colorB === 'dye:CLOTH:old_trim') traits.push('color:old-trim');
      return traits;
    },
    getTraitLabel(trait) { return trait; },
    isTraitDiscovered() { return true; },
  },
  NpcAvatarPreview: {
    buildProfileFromNpcExport(npc) {
      profileBuilds.push(JSON.parse(JSON.stringify(npc)));
      return { fighter: { id: `${npc.appearance?.speciesId}-${npc.appearance?.gender}` }, bodyColors: { ...(npc.appearance?.bodyColors || {}) } };
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
  npcWalkers: [walker, fallbackWalker],
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
    colorA: { dyeId: 'dye:CLOTH:new_primary' },
    colorB: { dyeId: 'dye:CLOTH:new_trim' },
  });
  assert.equal(verdict.accepted, true, 'compatible gift is accepted');
  assert.equal(verdict.worn, true, 'compatible non-disliked gift is tried on immediately');
  assert.equal(verdict.wearBlockedBy, null, 'ordinary accepted gift has no wear veto');
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['fine_poncho'], 'gift replaces the currently worn garment in the same slot immediately');
  assert.equal(rec.appliedDyes.CLOTH, 'dye:CLOTH:new_primary', 'overwear primary dye writes to the renderer\'s CLOTH channel');
  assert.equal(rec.appliedDyes.CLOTH_B, 'dye:CLOTH:new_trim', 'overwear secondary dye writes to the renderer\'s CLOTH_B channel');
  assert.equal(rec.appliedDyes.OVERWEAR, undefined, 'wardrobe does not invent a non-rendered OVERWEAR dye channel');
  assert.equal(rec.appliedDyes.TORSO, 'dye:CLOTH:orphaned_torso', 'equipping overwear leaves unrelated authored dye channels intact');
  const immediateRefresh = profileBuilds.at(-1);
  assert.equal(immediateRefresh.appearance.speciesId, 'engh-sho', 'gift-time rerender preserves canonical species instead of stale walker profile species');
  assert.equal(immediateRefresh.appearance.gender, 'female', 'gift-time rerender preserves canonical gender');
  assert.deepEqual(immediateRefresh.appearance.bodyDeformation, rec.appearance.bodyDeformation, 'gift-time rerender preserves body deformation');

  let contents = wardrobe.getWardrobeContents('test_npc');
  assert.equal(contents.worn[0].cosmeticId, 'fine_poncho', 'gift appears as currently worn without sleeping');
  assert.equal(contents.stored.length, 1, 'displaced original garment moves into storage');
  assert.equal(contents.stored[0].cosmeticId, 'rugged_poncho', 'previous garment remains recoverable');
  assert.equal(contents.stored[0].colorA, 'dye:CLOTH:old_primary', 'displaced garment stores its own slot-specific primary dye instead of the first arbitrary applied dye');
  assert.equal(contents.stored[0].colorB, 'dye:CLOTH:old_trim', 'displaced garment stores its own slot-specific secondary dye');

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
  assert.equal(hatedGift.wearBlockedBy, 'style:garish', 'hated refusal wins when the same garment also contains a disliked trait');
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
  assert.equal(rec.appliedDyes.CLOTH, 'dye:CLOTH:old_primary', 'Wear restores the stored garment\'s primary dye');
  assert.equal(rec.appliedDyes.CLOTH_B, 'dye:CLOTH:old_trim', 'Wear restores the stored garment\'s secondary dye');

  const snapshot = JSON.parse(JSON.stringify(wardrobe.serialize()));
  assert.equal(snapshot.version, 2, 'wardrobe save format includes outfit overrides');
  assert.deepEqual(snapshot.outfits.test_npc.equippedCosmetics, ['rugged_poncho'], 'corrected worn outfit is persisted');
  assert.equal(snapshot.outfits.test_npc.appliedDyes.CLOTH, 'dye:CLOTH:old_primary', 'corrected outfit dyes are persisted');

  rec.equippedCosmetics = ['bogus_after_save'];
  rec.appliedDyes = {};
  wardrobe.restore(snapshot);
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['rugged_poncho'], 'load restores the corrected worn outfit');
  assert.equal(rec.appliedDyes.CLOTH, 'dye:CLOTH:old_primary', 'load restores corrected outfit dyes');

  assert.equal(await wardrobe.storeWornItem('legacy_identity_npc', 'plain_tunic'), true, 'legacy-identity NPC can be rerendered through the same immediate Store path');
  const fallbackRefresh = profileBuilds.at(-1);
  assert.equal(fallbackRefresh.appearance.speciesId, 'engh-sho', 'missing appearance.speciesId falls back to the canonical record species');
  assert.equal(fallbackRefresh.appearance.gender, 'female', 'legacy fallback preserves authored appearance gender');
  assert.deepEqual(fallbackRefresh.appearance.cosmetics, fallbackRec.appearance.cosmetics, 'legacy fallback preserves authored cosmetics');
  assert.deepEqual(fallbackRefresh.appearance.bodyColors, fallbackRec.appearance.bodyColors, 'legacy fallback preserves body colors');
  assert.deepEqual(fallbackRefresh.appearance.bodyDeformation, fallbackRec.appearance.bodyDeformation, 'legacy fallback preserves body deformation');
  assert.deepEqual(fallbackRefresh.appearance.customAppearanceMarker, { keep: true }, 'legacy fallback preserves unknown/future appearance fields');

  wardrobe.restore({
    test_npc: [{ uid: 'legacy_store', cosmeticId: 'plain_hat', slot: 'hat', colorA: 'dye:CLOTH:legacy_hat' }],
  });
  const legacyContents = wardrobe.getWardrobeContents('test_npc');
  assert.equal(legacyContents.stored.length, 1, 'legacy stored-only wardrobe saves still load');
  assert.equal(legacyContents.stored[0].uid, 'legacy_store', 'legacy stored wardrobe identity survives migration');

  let held = {
    kind: 'clothing',
    instance: {
      uid: 'gear_gift',
      label: 'Fine Poncho',
      cosmeticId: 'fine_poncho',
      slot: 'overwear',
      colorA: { dyeId: 'dye:CLOTH:gift_primary' },
      colorB: { dyeId: 'dye:CLOTH:gift_trim' },
    },
  };
  gearInventory.clothingItems = [held.instance];
  gearInventory.clothing.overwear = held.instance;
  let giftingSaves = 0;
  vm.runInContext(giftingSource, context, { filename: 'npc-gifting.js' });
  context.NpcGifting.init({
    getItemDefs: () => ({}),
    getNpcRecordById: npcId => npcId === rec.id ? rec : null,
    getHeldGiftItem: () => held,
    clearManualHeldItem() { held = null; },
    getGearInventory: () => gearInventory,
    saveGearInventory() {},
    getPackClothing: () => [],
    setPackClothing() {},
    refreshPlayerAvatar() {},
    inventory: {},
    clampInventoryStack() {},
    showToast() {},
    refreshItemScroll() {},
    buildInventoryGrid() {},
    buildPackClothingSection() {},
    buildEquipmentSlots() {},
    refreshActionBar() {},
    saveMemberWorldData() { giftingSaves++; },
  });
  assert.equal(context.NpcGifting.offerGift(walker), true, 'real gifting flow accepts and processes the clothing gift');
  assert.equal(giftingSaves, 1, 'real gifting flow persists the immediate wardrobe/outfit mutation exactly once');
  assert.equal(held, null, 'accepted clothing gift clears the held instance');
  assert.equal(gearInventory.clothingItems.length, 0, 'accepted clothing gift leaves player gear ownership');
  assert.deepEqual(Array.from(rec.equippedCosmetics), ['fine_poncho'], 'real gifting flow leaves the accepted garment immediately equipped');
  assert.deepEqual(Array.from(wardrobe.serialize().outfits.test_npc.equippedCosmetics), ['fine_poncho'], 'real gifting save snapshot contains the immediately equipped garment');

  assert.ok(saves >= 3, 'manual Store/Wear operations request world persistence');
  console.log('Immediate NPC wardrobe behavior passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
