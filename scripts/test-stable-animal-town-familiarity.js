'use strict';

const assert = require('node:assert/strict'); // Assertions cover persistence, attribution, Favor-heart scaling, name gating, and recognition gating.
const fs = require('node:fs'); // Test reads the shipped runtime source directly from the local staged file.
const vm = require('node:vm'); // VM supplies an isolated browser-like global for wrapper-chain regression checks.

const moduleSource = fs.readFileSync('docs/js/stable-animal-town-familiarity.js', 'utf8'); // Runtime under test is executed exactly as shipped by the repository.
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8'); // Loader assertion keeps the familiarity runtime wired into normal game boot.
assert.match(bridgeSource, /StableAnimalTownFamiliarity/, 'farm feature bridge loads and installs town familiarity');

const companionRoot = {}; // Avatar root lets AmbientDialogue faceTarget resolve the active companion.
const player = {}; // Player identity is used by live companion ownership checks.
const companion = { id: 'companion-actor', health: 100, stableRole: 'companion', master: player, areaId: 'town', avatarRef: { group: companionRoot } }; // Live companion actor matched to the stable entry.
const stable = [{ id: 'comp1', name: 'Moss', kind: 'grehlr', stableRole: 'companion', animalPerks: { rapportBond: 3 } }]; // Existing-save entry intentionally lacks townFavor to verify migration to zero Favor XP.
let saveCount = 0; // Stable persistence counter proves familiarity mutations use the existing save pipeline.
let rapportRemaining = Infinity; // NPC Rapport headroom lets the test verify cap-proportional attribution.
const renderedLines = []; // Final AmbientDialogue text verifies names stay hidden before ten whole-town hearts.
const recognitionResults = []; // Conversation branch verifies old per-NPC recognition cannot reveal names early.

const progression = { // Minimal StableAnimalProgression public API consumed by the familiarity runtime.
  activeEntryForRole(role) { return role === 'companion' ? stable[0] : null; },
  perkRank(entry, perkId) { return Number(entry?.animalPerks?.[perkId]) || 0; },
  rapportMultiplierDetails() {
    const rank = Number(stable[0]?.animalPerks?.rapportBond) || 0; // Companion math mirrors +6% per rank from the real progression module.
    const add = rank * 0.06; // Per-animal additive share is what normal player actions should credit to familiarity.
    return { multiplier: 1 + add, bonus: add, details: add > 0 ? [{ role: 'companion', id: 'comp1', name: 'Moss', rank, add }] : [] };
  },
};

const farmDeps = { getStable: () => stable, saveStable: () => { saveCount++; }, showToast() {} }; // Existing stable storage/persistence dependency surface.
const DialogueContent = { // Inner beginNpcConversation emulates StableAnimalProgression's old recognition candidate rank check.
  getNpcDlgState: () => ({ favor: 400, memory: [] }),
  beginNpcConversation() {
    const recognized = progression.perkRank(stable[0], 'rapportBond') >= 3; // Wrapper must temporarily hide this rank while town hearts < 10.
    recognitionResults.push(recognized ? 'animal-recognition' : 'ordinary');
    return recognitionResults.at(-1);
  },
};

const context = { // Browser-like globals used by the runtime under test.
  console, Date, Math, JSON, Object, Array, Map, Set, RegExp, String, Number,
  navigator: { clipboard: { writeText: async () => {} } }, prompt() {},
  NpcFavorBalance: Object.freeze({
    version: 3,
    storageUnit: 'favor-points',
    favorPointsPerHeart: 40,
    favorPointsToHearts: points => Number(points) / 40,
    heartsToFavorPoints: hearts => Number(hearts) * 40,
  }),
  CREATURE_DB: { grehlr: { label: 'Grehlr' } }, StableAnimalProgression: progression,
  FarmAnimals: { init() { return true; }, addToStable(entry) { stable.push(entry); return { ok: true, entry }; } },
  Combat: { deps: { player, getCurrentArea: () => 'town', companionObjects: new Set([companion]) } }, Mounts: { rideEntity: null },
  AmbientDialogue: { show(target, text) { renderedLines.push(text); return { target, text }; } }, DialogueContent,
  NpcRapport: Object.freeze({ adjust(npcId, amount) {
    const requested = Number(amount) * progression.rapportMultiplierDetails().multiplier; // Simulates the existing progression wrapper applying pet bonuses first.
    const actual = Math.max(0, Math.min(requested, rapportRemaining)); // Simulates NpcRapport's cap by returning only Rapport actually obtained.
    rapportRemaining -= actual;
    return actual;
  } }),
  __farmLog() {},
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(moduleSource, context, { filename: 'stable-animal-town-familiarity.js' });
context.StableAnimalTownFamiliarity.install();
context.FarmAnimals.init(farmDeps);

assert.equal(stable[0].townFavor, 0, 'old stable animals start with 0 whole-town Favor XP');
assert(saveCount > 0, 'townFavor migration persists through the existing stable save function');
assert.equal(context.StableAnimalTownFamiliarity.getTownHearts('comp1'), 0, 'zero Favor XP derives to zero hearts');

assert.equal(context.DialogueContent.beginNpcConversation({ id: 'friend1' }), 'ordinary', 'per-NPC recognition is suppressed until whole-town familiarity reaches 10 hearts');
assert.equal(stable[0].animalPerks.rapportBond, 3, 'recognition suppression restores the real perk rank immediately');

context.AmbientDialogue.show({}, 'Moss listens well. Keep Moss close.', { speakerId: 'friend1', directedAtPlayer: true, faceTarget: { root: companionRoot } });
assert.equal(renderedLines.at(-1), 'Grehlr listens well. Keep Grehlr close.', 'pre-threshold dialogue uses species instead of the player-given name');

rapportRemaining = Infinity;
assert.equal(context.NpcRapport.adjust('friend1', 2, 'gift'), 2.36, 'existing +18% companion rapport multiplier remains unchanged');
assert.equal(stable[0].townFavor, 0.36, 'normal player action credits only the extra Rapport created by the pet perk as Favor XP');
assert.equal(context.StableAnimalTownFamiliarity.getTownHearts('comp1'), 0.009, 'Favor XP uses the canonical 40 points per heart scale');

stable[0].townFavor = 0;
rapportRemaining = 1;
context.NpcRapport.adjust('friend1', 2, 'gift');
assert(Math.abs(stable[0].townFavor - 0.1525) < 0.0001, 'Favor attribution scales down when NPC Rapport is capped');

stable[0].townFavor = 0;
rapportRemaining = Infinity;
const greetingDelta = context.NpcRapport.adjust('friend1', 10, 'pet_greeting:comp1'); // Existing direct animal greeting reward is entirely presence-caused.
assert(Math.abs(greetingDelta - 11.8) < 1e-9, 'direct pet greeting still receives the existing rapport multiplier');
assert.equal(stable[0].townFavor, 11.8, 'direct pet-created Rapport becomes equal Favor XP rather than ten-heart familiarity');
assert(Math.abs(context.StableAnimalTownFamiliarity.getTownHearts('comp1') - 0.295) < 1e-9, '11.8 Favor XP derives to 0.295 heart');
assert.equal(context.StableAnimalTownFamiliarity.isKnownByTown('comp1'), false, 'one pet greeting does not reveal the name town-wide');

stable[0].townFavor = 399;
rapportRemaining = Infinity;
context.NpcRapport.adjust('friend1', 10, 'pet_greeting:comp1');
assert.equal(stable[0].townFavor, 400, 'whole-town Favor XP caps at the ten-heart equivalent');
assert.equal(context.StableAnimalTownFamiliarity.getTownHearts('comp1'), 10, '400 Favor XP derives to ten hearts');
assert.equal(context.StableAnimalTownFamiliarity.isKnownByTown('comp1'), true, 'ten hearts is the single town-wide name threshold');

context.AmbientDialogue.show({}, 'Hello, Moss!', { speakerId: 'friend2', directedAtPlayer: true, faceTarget: { root: companionRoot } });
assert.equal(renderedLines.at(-1), 'Hello, Moss!', 'a different NPC may use the real name once whole-town familiarity reaches ten hearts');
assert.equal(context.DialogueContent.beginNpcConversation({ id: 'friend2' }), 'animal-recognition', 'existing recognition conversation can proceed after the town threshold');

const debug = context.StableAnimalTownFamiliarity.getDebug(); // Public snapshot is intended for mobile copy/paste diagnostics.
assert.equal(debug.storageUnit, 'favor-points', 'diagnostics make the stored unit explicit');
assert.equal(debug.favorPointsPerHeart, 40, 'diagnostics expose the canonical Favor-heart conversion');
assert.equal(debug.maxTownFavor, 400, 'diagnostics expose the ten-heart Favor XP cap');
assert.equal(debug.animals[0].townFavor, 400, 'diagnostics expose saved Favor XP');
assert.equal(debug.animals[0].townHearts, 10, 'diagnostics expose derived heart progress');
assert(debug.recentAwards.length >= 3, 'diagnostics retain recent rapport-to-Favor attribution events');

console.log('Stable animal town familiarity Favor-XP regression tests passed.');
