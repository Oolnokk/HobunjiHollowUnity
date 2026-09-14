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

vm.runInNewContext(source, { window: windowStub, console, Date, Proxy, WeakMap, Map, Math, Number, Object, Array, String });
const balance = windowStub.NpcFavorBalance;
assert(balance, 'NpcFavorBalance installs');
assert.equal(balance.favorPointsPerHeart, 40, 'forty Favor points equal one heart');
assert.equal(balance.favorPointsToHearts(10), 0.25, 'ten Favor points equal one quarter heart');
assert.equal(balance.maxRapportOvernightHearts(100, 0.10), 0.25, '100/100 Rapport settles to one quarter heart');
assert.equal(balance.giftQualityMultiplierForStars(5), 1, 'five-star gift keeps full value');
assert.equal(balance.giftQualityMultiplierForStars(3), 0.6, 'three-star gift keeps sixty percent value');

DialogueContent.init({ calendar: { day: 4 }, getNpcRecords: () => [] });
NpcGifting.init({
  getHeldGiftItem: () => held,
  inventory,
  clampInventoryStack() {},
});

// A five-star loved gift is exactly +10 Favor points = +1/4 heart.
NpcGifting.offerGift({ rec: { id: 'hreesh' }, giftScore: 10 });
assert.equal(rawState('hreesh').favor, 0.25, 'five-star loved gift adds one quarter heart');
assert.equal(inventory.egg, 2, 'gift consumes exactly one egg');
assert.deepEqual(consumedQuality.at(-1), { key: 'egg', stars: 5, amount: 1 }, 'gift consumes the matching five-star quality unit');
assert.equal(rewards.at(-1)?.text, '+10 Favor', 'player-facing Favor reward stays in Favor points');

// Multiple matching loved traits cannot make one physical gift worth more than one loved gift.
NpcGifting.offerGift({ rec: { id: 'multitrait' }, giftScore: 30 });
assert.equal(rawState('multitrait').favor, 0.25, 'multi-trait gift is capped at ten Favor points before quality scaling');

// Make the remaining physical egg a three-star unit, then verify the same loved result scales down.
qualityBuckets.egg[5] = 0;
qualityBuckets.egg[3] = 1;
NpcGifting.offerGift({ rec: { id: 'quality' }, giftScore: 10 });
assert.equal(rawState('quality').favor, 0.15, 'three-star loved gift adds .15 heart');
assert.equal(rewards.at(-1)?.text, '+6 Favor', 'three-star quality scales the visible Favor point award');
assert.equal(inventory.egg, 0, 'quality bookkeeping still consumes one inventory unit per gift');

// Rapport's private direct state mutation remains supported without making all absolute Favor assignments ambiguous.
const rapportState = DialogueContent.getNpcDlgState('rapport_npc');
rapportState.rapport = 100;
rapportState.rapport = 0;
rapportState.rapportDay = 2;
rapportState.favor = rapportState.favor + 10; // Mirrors NpcRapport.settle().
assert.equal(rawState('rapport_npc').favor, 0.25, 'NpcRapport direct +10 point rollover becomes one quarter heart');
rapportState.favor = -3;
assert.equal(rawState('rapport_npc').favor, -3, 'ordinary absolute Favor assignments remain authored heart-space');
rapportState.favor = 2;
assert.equal(rawState('rapport_npc').favor, 2, 'ordinary positive absolute Favor assignment is not mistaken for a point delta');

// Existing positive saves from the broken 1-Favor-per-heart build migrate once; negative dispositions stay intact.
const saved = {
  npcRelationships: {
    old_positive: { favor: 10, memory: [] },
    old_negative: { favor: -3, memory: [] },
  },
};
DialogueContent.loadNpcRelationships(saved);
assert.equal(rawState('old_positive').favor, 0.25, 'old +10 broken-scale save migrates to a quarter heart');
assert.equal(rawState('old_negative').favor, -3, 'negative authored disposition is preserved by migration');
assert(saved.npcRelationships.old_positive.memory.some(entry => entry.event === 'favor_points_40_per_heart_v1'), 'migration marker is persisted');
const migratedPositive = saved.npcRelationships.old_positive.favor;
DialogueContent.loadNpcRelationships(saved);
assert.equal(rawState('old_positive').favor, migratedPositive, 'migration marker prevents repeated rescaling');

console.log('Favor point / relationship heart balance regression checks passed.');
