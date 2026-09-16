#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/favor-heart-balance.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(source, { filename: 'favor-heart-balance.js' }), 'favor-heart-balance.js must parse');

const states = new Map();
const rewards = [];
const consumedQuality = [];
const inventory = { egg: 3 };
const qualityBuckets = { egg: { 5: 3, 3: 0 } };
let held = { kind: 'item', key: 'egg', def: { label: 'Egg', cookingDefaultStars: 3 } };

function rawState(id) {
  if (!states.has(id)) states.set(id, { favor: 0, rapport: 0, rapportDay: 1, memory: [] });
  return states.get(id);
}

const DialogueContent = {
  init() {},
  loadNpcRelationships(playerData) {
    states.clear();
    for (const [id, relationship] of Object.entries(playerData?.npcRelationships || {})) {
      states.set(id, {
        favor: Number(relationship.favor) || 0,
        rapport: Number(relationship.rapport) || 0,
        rapportDay: Number(relationship.rapportDay) || 1,
        memory: [...(relationship.memory || [])],
      });
    }
  },
  getNpcDlgState(id) { return rawState(id); },
  adjustNpcFavor(id, amount) { rawState(id).favor += Number(amount) || 0; },
  recordNpcMemory(id, event) { rawState(id).memory.push({ event }); },
  renderRelationshipHearts() { return 'legacy'; },
};

const NpcGifting = {
  init() {},
  offerGift(walker) {
    const score = walker?.giftScore ?? 10;
    DialogueContent.adjustNpcFavor(walker.rec.id, score, 'gift_loved');
    inventory[held.key] = Math.max(0, (inventory[held.key] || 0) - 1);
    return true;
  },
};

const windowStub = {
  DialogueContent,
  NpcGifting,
  SCRATCHBONES_CONFIG: { game: { socialRelationships: { rapportToFavorRate: 0.10 } } },
  WorldPopupText: { queueReward(kind, text) { rewards.push({ kind, text }); } },
  CookingSystem: {
    peekLowestQuality(key) {
      const bucket = qualityBuckets[key] || {};
      return [1, 2, 3, 4, 5].find(stars => (bucket[stars] || 0) > 0) || 3;
    },
    consumeQuality(key, stars, amount = 1) {
      const bucket = qualityBuckets[key] || {};
      if ((bucket[stars] || 0) < amount) return false;
      bucket[stars] -= amount;
      inventory[key] = Math.max(0, (inventory[key] || 0) - amount);
      consumedQuality.push({ key, stars, amount });
      return true;
    },
  },
};

vm.runInNewContext(source, { window: windowStub, console, Date, Map, Math, Number, Object, Array, String });
const balance = windowStub.NpcFavorBalance;
assert(balance, 'NpcFavorBalance installs');
assert.equal(balance.version, 3, 'v3 installs the Favor-points storage model');
assert.equal(balance.storageUnit, 'favor-points', 'Favor is stored as Favor points, not fractional hearts');
assert.equal(balance.debugSnapshot().installedVia, 'direct', 'normal dependency-ready load records a direct install');
assert.equal(balance.favorPointsPerHeart, 40, 'forty Favor points equal one heart');
assert.equal(balance.favorPointsToHearts(10), 0.25, 'ten Favor points equal one quarter heart');
assert.equal(balance.maxRapportOvernightHearts(100, 0.10), 0.25, '100/100 Rapport settles to ten Favor = one quarter heart');
assert.equal(balance.giftQualityMultiplierForStars(5), 1, 'five-star gift keeps full value');
assert.equal(balance.giftQualityMultiplierForStars(3), 0.6, 'three-star gift keeps sixty percent value');

DialogueContent.init({ calendar: { day: 4 }, getNpcRecords: () => [] });
NpcGifting.init({
  getHeldGiftItem: () => held,
  inventory,
  clampInventoryStack() {},
});

// A five-star loved gift remains +10 Favor XP in storage and visually fills one quarter heart.
NpcGifting.offerGift({ rec: { id: 'hreesh' }, giftScore: 10 });
assert.equal(rawState('hreesh').favor, 10, 'five-star loved gift stores ten Favor points');
assert.equal(inventory.egg, 2, 'gift consumes exactly one egg');
assert.deepEqual(consumedQuality.at(-1), { key: 'egg', stars: 5, amount: 1 }, 'gift consumes the matching five-star quality unit');
assert.equal(rewards.at(-1)?.text, '+10 Favor', 'player-facing reward matches the stored Favor-point delta');
assert.match(DialogueContent.renderRelationshipHearts({ id: 'hreesh', relationship: true }), /width:25%/, 'ten Favor visually fills one quarter of the next heart');
assert.deepEqual(
  { favorPoints: balance.relationshipDebug('hreesh').favorPoints, heartProgress: balance.relationshipDebug('hreesh').heartProgress },
  { favorPoints: 10, heartProgress: 0.25 },
  'relationship debug reports both raw Favor XP and derived heart progress'
);

// Multiple matching loved traits cannot make one physical gift worth more than one loved gift.
NpcGifting.offerGift({ rec: { id: 'multitrait' }, giftScore: 30 });
assert.equal(rawState('multitrait').favor, 10, 'multi-trait gift is capped at ten Favor points before quality scaling');

// Make the remaining physical egg a three-star unit, then verify the same loved result scales down.
qualityBuckets.egg[5] = 0;
qualityBuckets.egg[3] = 1;
NpcGifting.offerGift({ rec: { id: 'quality' }, giftScore: 10 });
assert.equal(rawState('quality').favor, 6, 'three-star loved gift stores six Favor points');
assert.equal(rewards.at(-1)?.text, '+6 Favor', 'three-star quality scales the visible Favor-point award');
assert.equal(inventory.egg, 0, 'quality bookkeeping still consumes one inventory unit per gift');

// NpcRapport already mutates state.favor by point deltas; v3 deliberately leaves that point-space mutation alone.
const rapportState = DialogueContent.getNpcDlgState('rapport_npc');
rapportState.favor = rapportState.favor + 10;
assert.equal(rawState('rapport_npc').favor, 10, 'direct +10 Rapport rollover remains ten Favor points');
assert.equal(balance.relationshipHeartsForNpc('rapport_npc'), 0.25, 'ten rollover Favor derives to one quarter heart');

// Existing real saves are already point-space; loading them must not divide or otherwise rewrite Favor.
const saved = {
  npcRelationships: {
    screenshot_hreesh: { favor: 12.2, memory: [{ event: 'gift_loved' }] },
    screenshot_pahu: { favor: 12, memory: [] },
    negative: { favor: -3, memory: [] },
  },
};
DialogueContent.loadNpcRelationships(saved);
assert.equal(rawState('screenshot_hreesh').favor, 12.2, 'existing 12.2 Favor stays 12.2 Favor');
assert.equal(rawState('screenshot_pahu').favor, 12, 'existing 12 Favor stays 12 Favor');
assert.equal(rawState('negative').favor, -3, 'negative Favor also stays in point-space');
assert.match(DialogueContent.renderRelationshipHearts({ id: 'screenshot_hreesh', relationship: true }), /width:30\.5%/, '12.2 Favor shows 30.5% progress through one positive heart instead of maxing the meter');

// RelationshipsPanel consumes ProceduralTasks.friendshipTierProgress; patch that public API into point-space too.
windowStub.ProceduralTasks = {
  friendshipFavor() { return -999; },
  friendshipTier() { return 5; },
  friendshipTierProgress() { return { tier: 5, favor: 999, next: null }; },
};
assert.equal(windowStub.ProceduralTasks.__favorPointHeartScalePatched, true, 'late ProceduralTasks assignment is patched');
{
  const progress = windowStub.ProceduralTasks.friendshipTierProgress('screenshot_pahu');
  assert.equal(progress.tier, 0, '12 Favor remains Tier 0');
  assert.equal(progress.favor, 12, 'relationship panel keeps showing twelve raw Favor points');
  assert.equal(progress.next, 80, 'Tier 1 remains the two-heart / eighty-Favor threshold');
}
rawState('tier_one').favor = 80;
{
  const progress = windowStub.ProceduralTasks.friendshipTierProgress('tier_one');
  assert.equal(progress.tier, 1, '80 Favor equals two hearts and therefore Friendship Tier 1');
  assert.equal(progress.favor, 80, 'Tier 1 progress keeps the raw Favor-point value');
  assert.equal(progress.next, 160, 'Tier 2 remains the four-heart / 160-Favor threshold');
}

// Regression for the real browser load order: balance may execute before DialogueContent and ProceduralTasks are published.
const lateStates = new Map();
const lateRawState = id => {
  if (!lateStates.has(id)) lateStates.set(id, { favor: 0, rapport: 0, memory: [] });
  return lateStates.get(id);
};
const lateDialogue = {
  init() {},
  loadNpcRelationships() {},
  getNpcDlgState(id) { return lateRawState(id); },
  adjustNpcFavor(id, amount) { lateRawState(id).favor += Number(amount) || 0; },
  recordNpcMemory(id, event) { lateRawState(id).memory.push({ event }); },
  renderRelationshipHearts() { return 'legacy'; },
};
const lateWindow = {
  NpcGifting: { init() {}, offerGift() { return false; } },
  SCRATCHBONES_CONFIG: { game: { socialRelationships: { rapportToFavorRate: 0.10 } } },
};
vm.runInNewContext(source, { window: lateWindow, console, Date, Map, Math, Number, Object, Array, String });
assert.equal(lateWindow.NpcFavorBalance, undefined, 'balance waits instead of silently giving up when DialogueContent is not loaded yet');
lateWindow.DialogueContent = lateDialogue;
assert.equal(lateWindow.NpcFavorBalance?.version, 3, 'publishing DialogueContent synchronously installs the deferred Favor-point hooks');
assert.equal(lateWindow.NpcFavorBalance.debugSnapshot().installedVia, 'dialogue-assignment', 'debug state records the deferred dependency path');
lateDialogue.adjustNpcFavor('late_hreesh', 10, 'gift_loved');
assert.equal(lateRawState('late_hreesh').favor, 10, 'late-installed balance still stores +10 as ten Favor points');
assert.match(lateDialogue.renderRelationshipHearts({ id: 'late_hreesh', relationship: true }), /width:25%/, 'late-installed renderer still derives quarter-heart progress');
lateWindow.ProceduralTasks = { friendshipTierProgress() { return { tier: 5, favor: 999, next: null }; } };
{
  const progress = lateWindow.ProceduralTasks.friendshipTierProgress('late_hreesh');
  assert.equal(progress.tier, 0, 'late-loaded ProceduralTasks receives the Favor-point tier conversion');
  assert.equal(progress.favor, 10, 'late-loaded tier progress keeps ten raw Favor points');
  assert.equal(progress.next, 80, 'late-loaded tier progress uses eighty Favor for Tier 1');
}

// Regression for the actual browser conflict: another module may already own a configurable lazy accessor for DialogueContent.
const chainedStates = new Map();
const chainedRawState = id => {
  if (!chainedStates.has(id)) chainedStates.set(id, { favor: 0, rapport: 0, memory: [] });
  return chainedStates.get(id);
};
const chainedDialogue = {
  init() {},
  loadNpcRelationships() {},
  getNpcDlgState(id) { return chainedRawState(id); },
  adjustNpcFavor(id, amount) { chainedRawState(id).favor += Number(amount) || 0; },
  recordNpcMemory(id, event) { chainedRawState(id).memory.push({ event }); },
  renderRelationshipHearts() { return 'legacy'; },
};
const chainedWindow = {
  NpcGifting: { init() {}, offerGift() { return false; } },
  SCRATCHBONES_CONFIG: { game: { socialRelationships: { rapportToFavorRate: 0.10 } } },
};
let chainedDialogueValue = null; // Existing module-owned lazy global backing value; Favor balance must chain through it rather than refusing to install.
Object.defineProperty(chainedWindow, 'DialogueContent', {
  configurable: true,
  enumerable: true,
  get() { return chainedDialogueValue; },
  set(value) {
    chainedDialogueValue = value;
    Object.defineProperty(chainedWindow, 'DialogueContent', { configurable: true, enumerable: true, writable: true, value });
  },
});
vm.runInNewContext(source, { window: chainedWindow, console, Date, Map, Math, Number, Object, Array, String });
assert.equal(chainedWindow.NpcFavorBalance, undefined, 'pre-existing DialogueContent accessor still leaves Favor balance waiting for the real API');
chainedWindow.DialogueContent = chainedDialogue;
assert.equal(chainedWindow.NpcFavorBalance?.version, 3, 'Favor balance chains through a pre-existing DialogueContent accessor and installs');
chainedRawState('chained_hreesh').favor = 12.2;
assert.match(chainedDialogue.renderRelationshipHearts({ id: 'chained_hreesh', relationship: true }), /width:30\.5%/, 'chained browser hook uses 12.2 Favor as 30.5% of one heart instead of twelve hearts');

console.log('Favor point / relationship heart balance regression checks passed.');