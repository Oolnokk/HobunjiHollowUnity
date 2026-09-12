'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const stable = [
  { id: 'hound1', kind: 'dabinggi-hound', name: 'Moro', role: 'companion', level: 20, stableXp: 999, animalPerks: {} },
  { id: 'mount1', kind: 'gar-wolf', name: 'Tallfoot', role: 'mount', level: 4, stableXp: 8, animalPerks: {} },
  { id: 'pet1', kind: 'uumkaoii', name: 'Pip', role: 'shoulderPet', level: 2, stableXp: 6, animalPerks: {} },
];
const player = { id: 'player', x: 0, y: 0 };
const companionActor = {
  id: 'live-hound', stableRole: 'companion', health: 50, areaId: 'town', master: player,
  def: { attackDamage: 10, attackCooldownS: 1.1, attackRangePx: 64, attackStaminaCost: 14 },
  avatarRef: { group: { visible: true } },
};
const companionObjects = new Set([companionActor]);
let activeCompanionId = 'hound1';
let showToastCalls = 0;

const farmDeps = {
  getStable: () => stable,
  getActiveCompanionId: () => activeCompanionId,
  showToast() { showToastCalls++; },
};

const trees = {
  companion: [
    { id: 'rapportBond', name: 'Trusted Company', maxRank: 5, desc: 'rapport' },
    { id: 'keenSenses', name: 'Keen Senses', maxRank: 5, desc: 'senses' },
  ],
  mount: [
    { id: 'mountSpeed', name: 'Fleet Stride', maxRank: 5, desc: 'speed' },
  ],
  shoulderPet: [
    { id: 'rapportBond', name: 'Social Perch', maxRank: 5, desc: 'rapport' },
  ],
};

function entryById(id) { return stable.find(entry => entry.id === id) || null; }
const progression = {
  trees,
  roleForEntry: entry => entry?.role || 'companion',
  perkRank(entry, perkId) { return Math.max(0, Math.floor(Number(entry?.animalPerks?.[perkId]) || 0)); },
  availablePoints(entry) {
    const spent = Object.values(entry?.animalPerks || {}).reduce((sum, rank) => sum + Math.max(0, Math.floor(Number(rank) || 0)), 0);
    return Math.max(0, (entry?.level || 0) - spent);
  },
  activeEntryForRole(role) {
    if (role !== 'companion') return null;
    return entryById(activeCompanionId);
  },
  xpToNext(level) { return 40 + Math.max(0, Number(level) || 0) * 20; },
  awardXp(entryOrId, amount) {
    const entry = typeof entryOrId === 'string' ? entryById(entryOrId) : entryOrId;
    if (!entry) return { ok: false, levels: 0, amount: 0 };
    entry.stableXp = (entry.stableXp || 0) + Math.max(0, Math.round(Number(amount) || 0));
    return { ok: true, levels: 0, amount: Math.max(0, Math.round(Number(amount) || 0)) };
  },
  spendPoint(entryId, perkId) {
    const entry = entryById(entryId);
    const def = trees[entry?.role || 'companion']?.find(candidate => candidate.id === perkId);
    if (!entry || !def) return { ok: false, message: 'bad perk' };
    if (this.availablePoints(entry) <= 0) return { ok: false, message: 'no points' };
    const rank = this.perkRank(entry, perkId);
    if (rank >= def.maxRank) return { ok: false, message: 'maxed' };
    entry.animalPerks[perkId] = rank + 1;
    return { ok: true, message: 'trained' };
  },
  debugSnapshot() { return { maxLevel: 20 }; },
};

const FarmAnimals = { init() {}, addToStable() {} };
const FarmPanel = { init() {}, renderStablePanel() {} };
const context = {
  window: null,
  console,
  document: {
    getElementById() { return null; },
    createElement() { return { style: {}, classList: { contains() { return false; } }, appendChild() {}, addEventListener() {}, querySelector() { return null; }, setAttribute() {} }; },
  },
  StableAnimalProgression: progression,
  FarmAnimals,
  FarmPanel,
  Combat: { deps: { player, companionObjects, getCurrentArea: () => 'town' } },
  CREATURE_DB: { 'dabinggi-hound': { label: 'Dabinggi Hound' } },
  CreatureGenetics: { defaultLivestockName: kind => kind },
};
context.window = context;
vm.createContext(context);
const source = fs.readFileSync('docs/js/stable-animal-training-refinements.js', 'utf8');
vm.runInContext(source, context, { filename: 'stable-animal-training-refinements.js' });
const api = context.StableAnimalTrainingRefinements;
assert(api, 'refinement module registers');
api.install();
context.FarmAnimals.init(farmDeps);
context.FarmPanel.init(farmDeps);

assert.equal(api.maxLevel, 10, 'all stabled animals use the corrected level-10 cap');
assert.equal(stable[0].level, 10, 'an existing over-cap stable level is clamped to 10');
assert.equal(stable[0].stableXp, 0, 'max-level animals cannot retain progress toward an eleventh level');
progression.awardXp('hound1', 500, 'cap-check');
assert.equal(stable[0].level, 10, 'public XP awards cannot advance a max-level stable animal');
assert.equal(stable[0].stableXp, 0, 'public XP awards are discarded at the level cap');
assert.equal(progression.maxLevel, 10, 'the progression API exposes the corrected cap to UI/debug callers');

const houndPerks = api.speciesCombatPerksForEntry(stable[0]);
assert.deepEqual(Array.from(houndPerks, perk => perk.id), ['species_dabinggi_toxicPounce', 'species_dabinggi_pursuit'], 'Dabinggi companions receive their own combat branch');
assert(trees.companion.some(perk => perk.id === 'species_grehlr_burrowAmbush'), 'all authored species perk ids are registered in the persistence allow-list');
assert.equal(progression.spendPoint('hound1', 'species_grehlr_burrowAmbush').ok, false, 'a companion cannot spend a point in another species combat branch');

stable[0].animalPerks = { species_dabinggi_toxicPounce: 2, species_dabinggi_pursuit: 1 };
const modifiers = api.companionCombatModifiers(stable[0]);
assert(Math.abs(modifiers.damage - 1.2) < 1e-9, 'Toxic Pounce scales real companion attack damage');
assert(Math.abs(modifiers.cooldown - 0.94) < 1e-9, 'Pursuit Instinct shortens the existing attack cooldown');
api.syncCompanionCombatPerks();
assert(Math.abs(companionActor.def.attackDamage - 12) < 1e-9, 'live companion def receives species damage training');
assert(Math.abs(companionActor.def.attackCooldownS - 1.034) < 1e-9, 'live companion def receives species cooldown training');
assert.equal(companionActor._stableTrainingBaseDef.attackDamage, 10, 'species training preserves the original creature definition for restoration');

const fallback = api.speciesCombatPerksForEntry({ kind: 'future-beast', role: 'companion' });
assert.deepEqual(Array.from(fallback, perk => perk.id), ['species_generic_power', 'species_generic_tempo'], 'future companion species get a safe fallback branch');

const bridge = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
assert.match(bridge, /globalKey: 'StableAnimalTrainingRefinements'/, 'farm feature bridge loads stable training refinements');
assert.match(bridge, /installStableAnimalTrainingRefinements\(\)/, 'farm feature bridge installs stable training refinements after base progression');
assert.match(source, /document\.getElementById\('stableAnimalProgression'\)\?\.remove\(\)/, 'old separate Animal Training block is removed');
assert.match(source, /expandedStableId === entry\.id \? null : entry\.id/, 'tapping the open animal collapses it and tapping another switches the single expanded tree');
assert.match(source, /Lv\. \$\{entry\.level\}\/\$\{MAX_STABLE_LEVEL\}/, 'Stable row itself displays the current level and cap');
assert.equal(showToastCalls, 0, 'regression setup does not invent UI side effects');

console.log('Stable animal training refinements regression tests passed.');
