// Targeted regression checks for the multi-avatar spouse kiss and its saved buff.
// Run: node scripts/test-spouse-kiss.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const motionSrc = read('docs/js/spouse-kiss-motion.js');
const romanceSrc = read('docs/js/romance-system.js');
const editorSrc = read('docs/tools/animation-author/index.html');
const gamePage = read('docs/index.html');

// Shared height solver: unequal, reversed and truly extreme size pairs are
// all solved in percent-of-rendered-height units, never by scaling either body.
const motionWindow = {};
vm.runInNewContext(motionSrc, { window: motionWindow, console });
const solver = motionWindow.SpouseKissMotion;
assert.equal(solver.DURATION_S, 2.4);
for (const [first, second] of [[1, 1], [1.5, .8], [5, .1], [.1, 5], [200, .001]]) {
  const solution = solver.solveHeights(first, second);
  assert.equal(solution.contactPossible, true, 'mouths can meet with dimensions ' + first + '/' + second);
  assert.ok(solution.remainingGap <= .025);
  assert.ok(solution.tallerSinkPct >= 0 && solution.tallerSinkPct <= solver.MAX_SINK_PCT);
  assert.equal(solution.shorterSinkPct, 0, 'shorter partner remains standing on the ground');
  assert.equal(solution.taller, first >= second ? 'first' : 'second');
}
assert.equal(solver.samplePose(0).blend, 0);
assert.equal(solver.samplePose(1.12).blend, 1);
assert.equal(solver.samplePose(2.4).blend, 0);
assert.equal(solver.samplePose(1.12).touch, true);
assert.equal(solver.samplePose(.8).touch, false);
assert.equal(solver.samplePose(1.9).touch, false);

// The author must show a concrete one-shot preset, preserve pair-relative
// exports, carry height/buff metadata, and load the same solver as gameplay.
for (const needle of [
  'KISS_PRESET_V1546', 'applyKissPresetV1546', 'kissBodySinkPctAtContact',
  'project.kiss', 'project.relationshipPreset', "animationAuthor.loop = false",
  "installKissPresetUiV1546", 'spouse-kiss-motion.js',
]) assert.ok(editorSrc.includes(needle), 'missing editor integration: ' + needle);
assert.ok(gamePage.includes('js/spouse-kiss-motion.js'), 'game must load paired motion module');
assert.ok(gamePage.indexOf('js/spouse-kiss-motion.js') < gamePage.indexOf('js/romance-system.js'), 'runtime loads before romance');

// A second VM contains only small public dependencies. A fake motion runtime
// explicitly delays the contact callback, proving a canceled kiss grants nothing.
let rawDay = 10;
let hour = 8;
let motionContact = null;
const renderedEffects = {};
const resourceProviders = [];
const player = { kind: 'player' };
const notices = [];
const spouseWalker = { rec: { id: 'spouse', name: 'Spouse', relationship: {} }, area: 'farm' };
const strangerWalker = { rec: { id: 'stranger', name: 'Stranger', relationship: {} }, area: 'farm' };
const w = {
  SCRATCHBONES_CONFIG: { game: {} },
  CalendarSystem: { getHour: () => hour, timeDebugSnapshot: () => ({ rawDay }) },
  Combat: { deps: { player } },
  NpcFollowing: { init() {}, clear() {} },
  DialogueContent: { registerActionHandler() {}, recordNpcMemory() {} },
  NpcScheduling: { registerTargetOverride() {} },
  HobunjiActivityEvents: { on() {}, emit() {} },
  RomanceFamily: { init() {}, restore() {}, commandOptionsFor: () => [], snapshot: () => null },
  RomanceWedding: { init() {}, tick() {} },
  EffectBuffBar: {
    registerProvider(id, provider) { renderedEffects[id] = provider; return true; },
    refresh() {},
  },
  InventoryCharacterEffects: { refresh() {} },
  ResourceSystem: { registerStatModifierProvider(provider) { resourceProviders.push(provider); } },
  SpouseKissMotion: {
    init() {},
    start(walker, contact) { motionContact = contact; return true; },
    diagnostics: () => ({ lastError: null }),
  },
};
const fixture = { window: w, setInterval: () => 1, console };
vm.runInNewContext(romanceSrc, fixture);
const romance = w.RomanceSystem;
romance.init({
  npcWalkers: [spouseWalker, strangerWalker],
  saveMemberWorldData() {},
  showToast(message) { notices.push(message); },
});
assert.equal(romance.commandOptionsFor(spouseWalker).some(option => option.id === 'spouse_kiss'), false, 'only married spouses may kiss');
romance.completeWedding('spouse');
assert.equal(romance.commandOptionsFor(strangerWalker).some(option => option.id === 'spouse_kiss'), false, 'strangers cannot kiss');
const kiss = romance.commandOptionsFor(spouseWalker).find(option => option.id === 'spouse_kiss');
assert.ok(kiss, 'spouse Kiss command appears');
assert.equal(kiss.run(), true);
assert.equal(romance.remainingKissHours(), 0, 'starting the animation does not grant the buff');
assert.equal(resourceProviders.length, 1, 'the stat provider only registers once');
motionContact();
assert.equal(romance.remainingKissHours(), 24, 'contact grants 24 in-game hours');
assert.equal(resourceProviders[0](player, 'staminaRegen'), 1.10);
assert.equal(resourceProviders[0]({}, 'staminaRegen'), 1);
assert.equal(resourceProviders[0](player, 'healthRegen'), 1);
assert.equal(renderedEffects['romance-spouse-kiss']()[0].remainingS, 24 * 3600);
assert.ok(notices.some(message => message.includes('Beloved')));

// Repeat contact refreshes the timer instead of multiplying the effect.
hour = 10;
assert.equal(romance.commandOptionsFor(spouseWalker).find(option => option.id === 'spouse_kiss').run(), true);
motionContact();
assert.equal(romance.remainingKissHours(), 24);
assert.equal(resourceProviders[0](player, 'staminaRegen'), 1.10);
const saved = romance.serialize();
assert.equal(saved.kissBuff.npcId, 'spouse');
romance.restore(saved);
assert.equal(romance.remainingKissHours(), 24, 'saved romance state restores buff duration');
rawDay = 11;
hour = 9.5;
assert.equal(romance.remainingKissHours(), .5, 'buff survives midnight');
hour = 10.01;
assert.equal(romance.remainingKissHours(), 0, 'buff expires at exact 24-hour boundary');
assert.equal(resourceProviders[0](player, 'staminaRegen'), 1);
assert.deepEqual(renderedEffects['romance-spouse-kiss'](), []);

console.log('Spouse kiss: adaptive height, one-shot author, command wheel, save/refresh/expiry and non-stacking buff OK.');
