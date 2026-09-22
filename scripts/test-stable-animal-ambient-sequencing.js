'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const progressionSource = fs.readFileSync('docs/js/stable-animal-progression.js', 'utf8'); // Source guard verifies the slow 700 ms pet scan defers immediately when the NPC is already greeting the player.
assert.match(progressionSource, /AmbientDialogue\?\.hasActiveGreetingFor\?\.\(npcId\)/, 'pet ambient scan skips NPCs whose player greeting is already active');
const perkSource = fs.readFileSync('docs/js/stable-animal-perk-adjustments.js', 'utf8'); // Source guard keeps the sequencing fix event-driven rather than intercepting storage or adding polling.
assert.match(perkSource, /addEventListener\('hobunji-ambient-dialogue'/, 'pet sequencing listens to rendered ambient events');
assert.doesNotMatch(perkSource, /Storage\?\.prototype|stableAnimalGreetingLedgerSetItem/, 'pet sequencing no longer monkeypatches localStorage');

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

const ambientListeners = new Map(); // Event listeners reproduce AmbientDialogue's render-time CustomEvent handoff without polling or storage interception.
function addEventListener(type, listener) {
  if (!ambientListeners.has(type)) ambientListeners.set(type, []);
  ambientListeners.get(type).push(listener);
}
function emitAmbientDialogue(detail) {
  for (const listener of ambientListeners.get('hobunji-ambient-dialogue') || []) listener({ detail });
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
  addEventListener,
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
    init() { return this; },
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
context.AmbientDialogue.init({ getPendingRequestGreeting: () => null });

function privateGreeting(npcId, text, durationMs = 4200) {
  shown.push({ target: {}, text, options: { speakerId: npcId, greeting: true, directedAtPlayer: true }, at: now, privatePath: true });
  emitAmbientDialogue({ speakerId: npcId, text, greeting: true, directedAtPlayer: true, startedAt: now, durationMs }); // Mirrors AmbientDialogue.show's real render event, including private lexical greetings.
}

// Regression: real proximity greetings use AmbientDialogue's private lexical show(),
// so the public show wrapper never sees them. The rendered ambient event must
// still become the authoritative event-time signal for the animal follow-up.
privateGreeting('friend1', 'Hello there!');
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

assert.equal(shown.length, 1, 'the private ordinary greeting renders immediately while animal reactions queue');
assert.equal(shown[0].text, 'Hello there!');
advance(4199);
assert.equal(shown.length, 1, 'no animal reaction overlaps the private 4200 ms greeting');
advance(1);
assert.equal(shown.length, 2, 'exactly one animal reaction renders the instant the greeting finishes');
assert.equal(shown[1].text, 'Mount reaction', 'one random candidate is selected from companion, mount, and shoulder-pet reactions');
assert.equal(shown[1].at, 5200, 'the follow-up has zero post-greeting pause');
assert.equal(rapportCalls.length, 0, 'unchosen rapport-trained pets do not receive greeting rapport');

// Regression for the opposite ordering: StableAnimalProgression can notice the
// pet before AmbientDialogue's 300 ms greeting dwell gate fires. The later ledger
// write must replace the short grace timer with the greeting's full end time.
context.AmbientDialogue.show({}, 'Early companion reaction', {
  speakerId: 'friend2',
  directedAtPlayer: true,
  faceTarget: { root: companion.avatarRef.group },
});
advance(300);
privateGreeting('friend2', 'A slightly later hello!');
assert.equal(shown.length, 3, 'the early animal reaction remains queued when the delayed private greeting starts');
advance(4199);
assert.equal(shown.length, 3, 'the rescheduled early reaction still cannot overlap the greeting');
advance(1);
assert.equal(shown.length, 4, 'the early reaction is released exactly when the later greeting ends');
assert.equal(shown[3].text, 'Early companion reaction');
assert.equal(shown[3].at, 9700, 'the race-path follow-up also has zero post-greeting pause');
assert.equal(rapportCalls.length, 1, 'the chosen rapport-trained companion receives one greeting rapport award');

const debug = context.StableAnimalPerkAdjustments.getDebug();
assert.equal(debug.ambientReactionTiming.afterGreetingMs, 0, 'debug timing exposes the requested zero post-greeting pause');
assert.equal(debug.ambientDialogueEventHookInstalled, true, 'debug confirms the event-driven rendered-greeting event hook is installed');
assert.equal(debug.pendingAmbientReactions.length, 0, 'the candidate queue is emptied after each follow-up is chosen');
assert(debug.ambientSequenceTrace.some(row => row.type === 'greeting-shown' && row.source === 'ambient-event'), 'debug trace records private greetings observed through the ambient event');
assert.equal(debug.ambientSequenceTrace.filter(row => row.type === 'reaction-queued').some(row => row.candidateCount === 3), true, 'debug trace exposes all three coalesced candidates');
assert.equal(debug.ambientSequenceTrace.filter(row => row.type === 'reaction-shown').length, 2, 'debug trace proves one follow-up rendered for each greeting');
assert.equal(debug.ambientSequenceTrace.filter(row => row.type === 'reaction-shown')[0].role, 'mount', 'debug trace records which role won the random three-way choice');

console.log('Stable animal ambient sequencing regression tests passed.');