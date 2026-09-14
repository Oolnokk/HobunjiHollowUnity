'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let now = 1000;
let nextTimerId = 1;
const timers = new Map();
const shown = [];
const rapportCalls = [];

function setFakeTimeout(callback, delay = 0) {
  const id = nextTimerId++;
  timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
  return id;
}

function clearFakeTimeout(id) {
  timers.delete(id);
}

function advance(ms) {
  const target = now + ms;
  while (true) {
    let nextId = null;
    let nextAt = Infinity;
    for (const [id, timer] of timers) {
      if (timer.at < nextAt) {
        nextId = id;
        nextAt = timer.at;
      }
    }
    if (nextId == null || nextAt > target) break;
    now = nextAt;
    const timer = timers.get(nextId);
    timers.delete(nextId);
    timer.callback();
  }
  now = target;
}

const player = { id: 'player' };
const entries = {
  companion: { id: 'comp1', role: 'companion', animalPerks: { rapportBond: 1 } },
  mount: { id: 'mount1', role: 'mount', animalPerks: {} },
  shoulderPet: { id: 'pet1', role: 'shoulderPet', animalPerks: { rapportBond: 1 } },
};
const companion = { id: 'companionActor', stableRole: 'companion', health: 10, master: player, areaId: 'town', avatarRef: { group: { visible: true } } };
const mount = { id: 'mountActor', stableRole: 'mount', health: 10, master: player, areaId: 'town', def: { mountSpeed: 100 }, avatarRef: { group: { visible: true } } };
const shoulderPet = { id: 'shoulderActor', stableRole: 'shoulderPet', health: 10, master: player, areaId: 'town', avatarRef: { group: { visible: true } } };

const progression = {
  trees: { companion: [], mount: [], shoulderPet: [] },
  activeEntryForRole(role) { return entries[role] || null; },
  perkRank(entry, perkId) { return Number(entry?.animalPerks?.[perkId]) || 0; },
};

const context = {
  window: null,
  globalThis: null,
  console,
  performance: { now: () => now },
  Date,
  Math: Object.create(Math),
  setTimeout: setFakeTimeout,
  clearTimeout: clearFakeTimeout,
  StableAnimalProgression: progression,
  Combat: {
    deps: {
      player,
      companionObjects: new Set([companion, shoulderPet]),
      getCurrentArea: () => 'town',
    },
  },
  Mounts: { rideEntity: mount },
  DialogueContent: { getNpcDlgState: () => ({ memory: [] }) },
  NpcRapport: {
    currentGameDay: () => 1,
    adjust(npcId, amount, source) {
      rapportCalls.push({ npcId, amount, source });
      return amount;
    },
  },
  AmbientDialogue: {
    show(target, text, options = {}) {
      shown.push({ target, text, options, at: now });
      return { startedAt: now, durationMs: Number(options.durationMs) || 4200 };
    },
  },
};
context.window = context;
context.globalThis = context;
context.Math.random = () => 0.5; // Three queued candidates -> index 1, the mount.

vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/stable-animal-perk-adjustments.js', 'utf8'), context, { filename: 'stable-animal-perk-adjustments.js' });

context.AmbientDialogue.show({}, 'Hello there!', {
  speakerId: 'friend1',
  greeting: true,
  directedAtPlayer: true,
});
context.AmbientDialogue.show({}, 'Companion reaction', {
  speakerId: 'friend1',
  directedAtPlayer: true,
  faceTarget: { root: companion.avatarRef.group },
});
context.AmbientDialogue.show({}, 'Mount reaction', {
  speakerId: 'friend1',
  directedAtPlayer: true,
  faceTarget: { root: mount.avatarRef.group },
});
context.AmbientDialogue.show({}, 'Shoulder reaction', {
  speakerId: 'friend1',
  directedAtPlayer: true,
  faceTarget: { root: shoulderPet.avatarRef.group },
});

assert.equal(shown.length, 1, 'the ordinary greeting renders immediately while animal reactions queue');
assert.equal(shown[0].text, 'Hello there!');

advance(4649);
assert.equal(shown.length, 1, 'no animal reaction overlaps the greeting or its post-greeting beat');
advance(1);
assert.equal(shown.length, 2, 'exactly one animal reaction renders after the greeting finishes');
assert.equal(shown[1].text, 'Mount reaction', 'one random candidate is selected from companion, mount, and shoulder-pet reactions');
assert.equal(shown[1].at, 5650, 'the follow-up waits for the full 4200 ms greeting plus a 450 ms beat');
assert.equal(rapportCalls.length, 0, 'unchosen rapport-trained pets do not receive greeting rapport');

const debug = context.StableAnimalPerkAdjustments.getDebug();
assert.equal(debug.pendingAmbientReactions.length, 0, 'the candidate queue is emptied after one follow-up is chosen');
assert(debug.ambientSequenceTrace.some(row => row.type === 'greeting-shown'), 'debug trace records the greeting');
assert.equal(debug.ambientSequenceTrace.filter(row => row.type === 'reaction-queued').at(-1).candidateCount, 3, 'debug trace exposes all three coalesced candidates');
assert.equal(debug.ambientSequenceTrace.filter(row => row.type === 'reaction-shown').length, 1, 'debug trace proves only one follow-up rendered');
assert.equal(debug.ambientSequenceTrace.find(row => row.type === 'reaction-shown').role, 'mount', 'debug trace records which role won the random choice');

console.log('Stable animal ambient sequencing regression tests passed.');