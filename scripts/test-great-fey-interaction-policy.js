#!/usr/bin/env node
'use strict';

// Regression: Great Fey keep quest dialogue but cannot accept gifts or generate
// incidental proximity, social, pet, or pet-recognition greetings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..'); // Repository location used by all shipped fixture reads.
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8'); // Read actual shipped modules, not duplicate mock policy code.
const index = read('docs/index.html'); // Ensures gameplay loads the policy before every interaction runtime.
const policyScript = read('docs/js/npc-interaction-policy.js'); // Single authoritative Great Fey ID list.
const window = { ItemTraits: { computeItemTraits: () => [] } }; // Minimal dependency bag for real NpcGifting methods.
const context = vm.createContext({ window, console, Set, Object, Math }); // VM isolates the browser-global modules from test process state.
vm.runInContext(policyScript, context, { filename: 'npc-interaction-policy.js' });
vm.runInContext(read('docs/js/npc-gifting.js'), context, { filename: 'npc-gifting.js' });

const excluded = ['banubu', 'hiki_hiki', 'mother_rahayobi', 'nohuknuk']; // Authored NPC IDs which cannot receive ordinary gifts.
const aliases = ['hiki-hiki', 'hikihiki', 'old_man_nohuknuk']; // Alternate editor/locale spellings that must also remain blocked.
for (const id of [...excluded, ...aliases]) {
  assert.equal(window.NpcInteractionPolicy.isPassiveGreatFey(id), true, `${id} must be excluded`);
  assert.equal(window.NpcInteractionPolicy.isPassiveGreatFey({ id }), true, `${id} record must be excluded`);
}
assert.equal(window.NpcInteractionPolicy.isPassiveGreatFey('sloomi'), false, 'ordinary villagers stay social and giftable');
assert(index.indexOf('js/npc-interaction-policy.js') > -1, 'the game imports the shared policy');
assert(index.indexOf('js/npc-interaction-policy.js') < index.indexOf('js/ambient-dialogue.js'), 'policy is loaded before the proximity runtime');
assert(index.indexOf('js/npc-interaction-policy.js') < index.indexOf('js/character-action-locks.js'), 'policy loads before the eager loader of NPC reaction modules');

const inventory = { apple: 4 }; // Gift stock whose unchanged quantity proves direct actions cannot consume a forbidden gift.
let relationWrites = 0; // Used to verify the rejected gift cannot adjust Favor/Rapport.
let saveWrites = 0; // Used to verify the rejected gift cannot persist a fake gift completion.
window.DialogueContent = { adjustNpcFavor: () => { relationWrites++; } };
window.NpcRapport = { adjust: () => { relationWrites++; }, markGiftedToday: () => { relationWrites++; } };
window.NpcGifting.init({
  inventory,
  getHeldGiftItem: () => ({ kind: 'item', key: 'apple' }),
  getItemDefs: () => ({ apple: { label: 'Apple' } }),
  saveMemberWorldData: () => { saveWrites++; },
});

for (const id of excluded) {
  const walker = { rec: { id, name: id, gifts: { loved: ['food'] } } };
  assert.equal(window.NpcGifting.getNpcGiftOfferAction(walker), null, `${id} cannot advertise a Gift button`);
  assert.equal(window.NpcGifting.offerGift(walker), false, `${id} cannot receive a direct/held gift`);
  assert.equal(inventory.apple, 4, `${id} did not consume the gift`);
}
assert.equal(relationWrites, 0, 'rejected gifts must not alter social relationships or daily gifting flags');
assert.equal(saveWrites, 0, 'rejected gifts must not modify saves');
assert(window.NpcGifting.getNpcGiftOfferAction({ rec: { id: 'sloomi', name: 'Sloomi', gifts: {} } }), 'regular NPC still offers gifts');

let emittedSocialReactions = 0; // Counts actual reaction bubbles shown by the live NPC reaction runtime.
window.AmbientDialogue = { show: () => { emittedSocialReactions++; return { startedAt: 0, durationMs: 1000 }; } };
vm.runInContext(read('docs/js/npc-silliness-reaction-runtime.js'), context, { filename: 'npc-silliness-reaction-runtime.js' });
for (const id of excluded) {
  assert.equal(window.NpcSillinessReactions.react({ rec: { id }, root: { position: { x: 0, z: 0 } } }), false, `${id} cannot react to the player`);
}
assert.equal(emittedSocialReactions, 0, 'excluded NPCs generated no social chatheads');
assert.equal(window.NpcSillinessReactions.react({ rec: { id: 'sloomi' }, root: { position: { x: 0, z: 0 } } }), true, 'other NPCs still react');
assert.equal(emittedSocialReactions, 1, 'normal NPC reactions still show');

const greeting = read('docs/js/ambient-dialogue.js'); // Player/NPC proximity greeting and pending greeting priority checks.
const social = read('docs/js/npc-silliness-reaction-runtime.js'); // Social stimuli and direct pet reactions.
const stable = read('docs/js/stable-animal-progression.js'); // Auto pet greetings and one-off pet recognition conversations.
const petQueue = read('docs/js/stable-animal-perk-adjustments.js'); // Async pet reaction queue and Rapport side effects.
assert.match(greeting, /function tryGreeting[\s\S]*?NpcInteractionPolicy\?\.isPassiveGreatFey/, 'proximity greetings reject the four Fey before dialogue selection');
assert.match(social, /function react[\s\S]*?NpcInteractionPolicy\?\.isPassiveGreatFey/, 'social reactions reject the four Fey');
assert.match(social, /function patchAnimalDialogueShow[\s\S]*?NpcInteractionPolicy\?\.isPassiveGreatFey/, 'direct pet reactions reject the four Fey');
assert.match(stable, /function updateAnimalAmbient[\s\S]*?NpcInteractionPolicy\?\.isPassiveGreatFey/, 'ambient pet reactions reject the four Fey');
assert.match(stable, /function recognitionCandidate[\s\S]*?NpcInteractionPolicy\?\.isPassiveGreatFey/, 'one-time recognition never displaces Great Fey quest/ordinary dialogue');
assert.match(petQueue, /function stableAnimalGreetingRapportShow[\s\S]*?NpcInteractionPolicy\?\.isPassiveGreatFey/, 'pet greeting is skipped before any pending queue or Rapport grant');

// Exercise the real AmbientDialogue renderer: the Great Fey must be refused
// before its 3D rendering dependencies, even if called by another feature.
const bareAmbientWindow = { NpcInteractionPolicy: window.NpcInteractionPolicy }; // Intentionally no scene or THREE; the exclusion guard must short-circuit first.
vm.runInNewContext(read('docs/js/ambient-dialogue.js'), { window: bareAmbientWindow, console });
for (const id of excluded) {
  assert.equal(bareAmbientWindow.AmbientDialogue.show({}, 'Unexpected greeting!', { speakerId: id }), null, `${id} cannot render direct ambient speech`);
}

// The pet reaction and Rapport wrappers install in either order depending on
// lazy module readiness. Both compositions must exclude Fey without blocking
// an ordinary villager's queued reaction.
for (const order of ['perks-first', 'reactions-first']) {
  const root = {}; // Exact companion render root used by the real wrapper to identify a pet-targeted line.
  const owner = {}; // Owner identity ensures this companion is controlled by the player.
  const actor = { stableRole: 'companion', health: 100, master: owner, avatarRef: { group: root } }; // Present stable animal for the wrapper's role matching.
  const pet = { id: 'pet1', name: 'Pip', kind: 'grehlr' }; // Stable entry supplying animal identity.
  const rendered = []; // Actual calls to the pre-wrapper AmbientDialogue.show implementation.
  const rapport = []; // Pet greeting rapport adjustments must remain empty for excluded Fey.
  const simWindow = {
    NpcInteractionPolicy: window.NpcInteractionPolicy,
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    StableAnimalProgression: {
      trees: { mount: [], companion: [], shoulderPet: [] },
      activeEntryForRole: role => role === 'companion' ? pet : null,
      perkRank: () => 3,
    },
    Combat: { deps: { player: owner, getCurrentArea: () => 'town', companionObjects: [actor] } },
    NpcRapport: { adjust: (...args) => { rapport.push(args); return 10; } },
    DialogueContent: { getNpcDlgState: () => ({ favor: 0, memory: [] }) },
    AmbientDialogue: {
      init() {},
      update() {},
      show: (target, text, options) => { rendered.push({ text, options }); return { startedAt: 100, durationMs: 1000 }; },
    },
  }; // Separate world for each order prevents installed hooks from masking integration failures.
  const sim = vm.createContext({
    window: simWindow, document: { baseURI: 'https://example.test/docs/' },
    fetch: async () => ({ ok: false, status: 404 }), URL, console, performance: { now: () => 1000 },
  }); // Missing remote JSON deliberately selects the runtime's own built-in personality fallback.
  const layers = order === 'perks-first'
    ? ['docs/js/stable-animal-perk-adjustments.js', 'docs/js/npc-silliness-reaction-runtime.js']
    : ['docs/js/npc-silliness-reaction-runtime.js', 'docs/js/stable-animal-perk-adjustments.js'];
  for (const filename of layers) vm.runInContext(read(filename), sim, { filename });

  for (const id of excluded) {
    const result = simWindow.AmbientDialogue.show({}, 'Hello, Pip!', {
      speakerId: id, directedAtPlayer: true, faceTarget: { root },
    });
    assert.equal(result, null, `${id} must not greet pets with ${order} initialization`);
  }
  const queued = simWindow.AmbientDialogue.show({}, 'Hello, Pip!', {
    speakerId: 'sloomi', directedAtPlayer: true, faceTarget: { root },
  });
  assert.equal(queued?.queued, true, `ordinary NPC pet greetings must still queue (${order})`);
  assert.equal(rendered.length, 0, `Great Fey pet reactions must not reach rendering (${order})`);
  assert.equal(rapport.length, 0, `Great Fey pet reactions must not adjust Rapport (${order})`);
  const pending = simWindow.StableAnimalPerkAdjustments.getDebug().pendingAmbientReactions; // Mobile-visible queue confirms no hidden deferred Fey reaction.
  assert.equal(pending.length, 1, `only the normal NPC should queue (${order})`);
  assert.equal(pending[0].npcId, 'sloomi', `the queued reaction belongs to Sloomi (${order})`);
}

const banubu = read('docs/js/banubu-quest-content.js'); // Existing fish-pie/tea quest content must be retained.
assert.doesNotMatch(banubu, /<Something that indicates that I like receiving fish as gifts\.>/, 'remove added Banubu gift hint');
assert.match(banubu, /Three-Fish Pie/);
assert.match(banubu, /Nine Leaf Tea/);
console.log('Great Fey gift/action/reactivity policy passed (4 NPCs, 3 alternate IDs; Banubu quests preserved).');
