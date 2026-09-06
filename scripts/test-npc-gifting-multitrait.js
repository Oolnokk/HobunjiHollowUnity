#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/npc-gifting.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(source, { filename: 'npc-gifting.js' }), 'npc-gifting.js must parse as JavaScript');

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
  NpcRapport: {
    adjust() {
      throw new Error('ordinary gifts must not be diverted into temporary Rapport');
    },
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

const walker = { rec: { id: 'test_npc', name: 'Test NPC', gifts: prefs } };
assert.equal(gifting.offerGift(walker), true, 'mixed gift is accepted');
assert.deepEqual(favorAdjustments, [{ npcId: 'test_npc', amount: 4, reason: 'gift_liked' }], 'runtime applies the balanced permanent Favor result once, not once per winning trait');
assert.equal(inventory.mixedGift, 1, 'accepted gift still consumes exactly one item');
assert.match(toasts.at(-1), /is happy with the Mixed Gift/, 'dialogue/toast reflects the net liked verdict');

const discovered = gifting.getDiscoveredGiftTraits('test_npc');
assert.deepEqual(Array.from(discovered.liked), ['warm', 'bright'], 'relationship discovery records every liked trait on the gift');
assert.deepEqual(Array.from(discovered.disliked), ['blue'], 'relationship discovery records every disliked trait on the gift');

console.log('Multi-trait NPC gifting regression checks passed.');
