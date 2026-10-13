#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/npc-gifting.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(source, { filename: 'npc-gifting.js' }), 'npc-gifting.js must parse as JavaScript');

const rapportAdjustments = []; // Positive accepted gifts now also grant a flat quarter of the daily Rapport maximum.
const favorAdjustments = [];
const toasts = [];
const inventory = { mixedGift: 2 };
const held = { kind: 'item', key: 'mixedGift', def: { label: 'Mixed Gift', icon: '🎁' } };
const heldTraits = ['warm', 'bright', 'blue'];

const windowStub = {
  ItemTraits: {
    computeItemTraits() { return [...heldTraits]; },
    isTraitDiscovered() { return true; },
    getTraitLabel(id) { return id; },
  },
  MetalArmorSystem: {
    isMetalArmor(item) { return item?.materialKind === 'metal'; },
  },
  NpcRapport: {
    config: { rapportMax: 100 },
    adjust(npcId, amount, reason) { rapportAdjustments.push({ npcId, amount, reason }); },
  },
  DialogueContent: {
    adjustNpcFavor(npcId, amount, reason) {
      favorAdjustments.push({ npcId, amount, reason });
      return amount;
    },
  },
};

vm.runInNewContext(source, { window: windowStub, console });
const gifting = windowStub.NpcGifting;
assert(gifting, 'NpcGifting installs');

gifting.init({
  getHeldGiftItem: () => held,
  getItemDefs: () => ({ mixedGift: held.def }),
  inventory,
  clampInventoryStack() {},
  refreshItemScroll() {},
  buildInventoryGrid() {},
  buildEquipmentSlots() {},
  refreshActionBar() {},
  saveMemberWorldData() {},
  showToast(message) { toasts.push(message); },
});

const prefs = {
  loved: [],
  liked: ['warm', 'bright'],
  disliked: ['blue'],
  hated: [],
};

const evaluation = gifting.evaluateGiftReaction(prefs, heldTraits);
assert.equal(evaluation.score, 4, 'two liked traits and one disliked trait net to one liked-trait unit');
assert.equal(evaluation.favorDelta, 4, 'Favor delta preserves the full balanced score');
assert.equal(evaluation.tier, 'liked', 'positive net score produces a liked dialogue verdict');
assert.deepEqual(Array.from(evaluation.matches.liked), ['warm', 'bright'], 'all matching liked traits are retained');
assert.deepEqual(Array.from(evaluation.matches.disliked), ['blue'], 'all matching disliked traits are retained');

const cancellation = gifting.evaluateGiftReaction({ loved: [], liked: ['warm'], disliked: ['blue'], hated: [] }, ['warm', 'blue']);
assert.equal(cancellation.score, 0, 'one liked and one disliked trait cancel exactly');
assert.equal(cancellation.favorDelta, 0, 'a cancelling mixed gift produces no relationship change');
assert.equal(cancellation.tier, 'neutral', 'a cancelling mixed gift produces neutral dialogue');

const accumulatedLikes = gifting.evaluateGiftReaction({ loved: [], liked: ['a', 'b', 'c'], disliked: [], hated: [] }, ['a', 'b', 'c']);
assert.equal(accumulatedLikes.score, 12, 'each liked trait contributes independently');
assert.equal(accumulatedLikes.tier, 'loved', 'a sufficiently strong positive net result escalates the dialogue verdict');

const metalArmor = { // Used to exercise the category override without depending on a specific authored armor blueprint.
  kind: 'clothing',
  instance: { cosmeticId: 'test_metal_armor', label: 'Test Metal Armor', materialKind: 'metal', metalKey: 'nativeCopper' },
};
const genericArmorPrefs = { loved: ['warm'], liked: [], disliked: ['blue'], hated: [] };
for (const npcId of ['oddclaw_unumanuk', 'spearhead_unumanuk', 'jubmir', 'gantami_ginju', 'porakaneki_chief']) {
  const result = gifting.evaluateHeldGift({ id: npcId, gifts: genericArmorPrefs }, metalArmor);
  assert.equal(result.tier, 'loved', `${npcId} loves metal armor`);
  assert.equal(result.favorDelta, 10, `${npcId} receives the tier-1 loved Favor value`);
  assert.equal(result.metalTier, 1, `${npcId}'s Native Copper gift reports metal tier 1`);
  assert.deepEqual(Array.from(result.matches.loved), ['metalArmor'], `${npcId} discovers the Metal Armor preference`);
}
for (const npcId of ['leaf', 'pahu', 'garanki_gabu']) {
  const result = gifting.evaluateHeldGift({ id: npcId, gifts: genericArmorPrefs }, metalArmor);
  assert.equal(result.tier, 'liked', `${npcId} likes metal armor`);
  assert.equal(result.favorDelta, 4, `${npcId} receives the tier-1 liked Favor value`);
  assert.deepEqual(Array.from(result.matches.liked), ['metalArmor'], `${npcId} discovers the Metal Armor preference`);
}
const indifferentArmor = gifting.evaluateHeldGift({ id: 'father_hunundi_hodu', gifts: genericArmorPrefs }, metalArmor);
assert.equal(indifferentArmor.tier, 'neutral', 'unlisted NPCs are indifferent to metal armor even when they love another trait on the garment');
assert.equal(indifferentArmor.favorDelta, 1, 'tier-1 indifferent metal armor uses the ordinary neutral gift Favor value');
assert.equal(gifting.relationshipId({ rec: { id: 'porakaneki_hunter_test', species: 'porakaneki' } }), 'porakaneki_chief', 'all Porakaneki continue sharing the chief relationship/preference identity');
assert.equal(gifting.getPreferenceLabel('metalArmor'), 'Metal Armor', 'relationship discovery shows a readable Metal Armor label');

const metalTiers = [
  ['nativeCopper', 1],
  ['lowTinBronze', 2],
  ['tinBronze', 3],
  ['highTinBronze', 4],
  ['arsenicalBronze', 5],
  ['leadedBronze', 6],
];
for (const [metalKey, tier] of metalTiers) {
  const tieredArmor = { kind: 'clothing', instance: { ...metalArmor.instance, metalKey } }; // Same article with only its smith alloy changed.
  const loved = gifting.evaluateHeldGift({ id: 'spearhead_unumanuk', gifts: genericArmorPrefs }, tieredArmor);
  const liked = gifting.evaluateHeldGift({ id: 'garanki_gabu', gifts: genericArmorPrefs }, tieredArmor);
  const neutral = gifting.evaluateHeldGift({ id: 'father_hunundi_hodu', gifts: genericArmorPrefs }, tieredArmor);
  assert.equal(gifting.metalArmorValueTier(tieredArmor), tier, `${metalKey} maps to gift-value tier ${tier}`);
  assert.equal(loved.favorDelta, 10 * tier, `${metalKey} multiplies loved metal-armor Favor by tier`);
  assert.equal(liked.favorDelta, 4 * tier, `${metalKey} multiplies liked metal-armor Favor by tier`);
  assert.equal(neutral.favorDelta, tier, `${metalKey} multiplies neutral metal-armor Favor by tier`);
}
assert.equal(gifting.evaluateHeldGift({ id: 'spearhead_unumanuk', gifts: genericArmorPrefs }, { kind: 'clothing', instance: { ...metalArmor.instance, metalKey: 'unknownMetal' } }).favorDelta, 10, 'unknown/legacy metal keys safely fall back to tier 1');

const nonMetalClothing = { kind: 'clothing', instance: { cosmeticId: 'warm_cloth', label: 'Warm Cloth', materialKind: 'cloth' } };
const ordinaryClothing = gifting.evaluateHeldGift({ id: 'test_npc', gifts: { loved: ['warm'], liked: [], disliked: [], hated: [] } }, nonMetalClothing);
assert.equal(ordinaryClothing.tier, 'loved', 'non-metal clothing still uses the ordinary multi-trait gift evaluator');

const walker = { rec: { id: 'test_npc', name: 'Test NPC', gifts: prefs } };
assert.equal(gifting.offerGift(walker), true, 'mixed gift is accepted');
assert.deepEqual(favorAdjustments, [{ npcId: 'test_npc', amount: 4, reason: 'gift_liked' }], 'runtime applies the balanced permanent Favor result once, not once per winning trait');
assert.deepEqual(rapportAdjustments, [{ npcId: 'test_npc', amount: 25, reason: 'gift_liked' }]);
assert.equal(inventory.mixedGift, 1, 'accepted gift still consumes exactly one item');
assert.match(toasts.at(-1), /is happy with the Mixed Gift/, 'dialogue/toast reflects the net liked verdict');

const discovered = gifting.getDiscoveredGiftTraits('test_npc');
assert.deepEqual(Array.from(discovered.liked), ['warm', 'bright'], 'relationship discovery records every liked trait on the gift');
assert.deepEqual(Array.from(discovered.disliked), ['blue'], 'relationship discovery records every disliked trait on the gift');

console.log('Multi-trait and tier-scaled metal-armor NPC gifting regression checks passed.');
