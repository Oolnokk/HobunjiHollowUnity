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

// Exercise the actual paired runtime (not a callback stub). This catches
// staging and cleanup mistakes without requiring WebGL or browser devtools.
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}
const root = (x, y, z, height) => ({
  position: { x, y, z }, rotation: { y: 0 }, visible: true,
  parent: {}, userData: { portraitModelHeight: height },
  updateWorldMatrix() {},
  getWorldPosition(out) { out.x = this.position.x; out.y = this.position.y; out.z = this.position.z; return out; },
  getWorldScale(out) { out.x = 1; out.y = 1; out.z = 1; return out; },
});
const legHandle = height => ({
  modelHeight: height, sink: 0,
  setStanceDrop(amount) { this.sink = amount; },
  getStanceDrop() { return this.sink; },
});
const avatarRoot = root(0, 0, 0, 1);
const npcRoot = root(0, 0, 1, 5);
const npcRigRoot = { position: { y: 0 }, scale: { y: 1 }, userData: {} };
npcRoot.getObjectByName = name => name === 'npc_character_rig_root' ? npcRigRoot : null;
const playerLegs = legHandle(1);
const partnerLegs = legHandle(5);
const sceneWalker = {
  rec: { id: 'spouse' }, root: npcRoot, avatarGroup: { userData: {} }, legs: partnerLegs,
};
let renderFrame = null;
const channels = new Map();
const activeTokens = new Set();
const visualWindow = {
  THREE: { Vector3 },
  PlayerBodyTransformComposer: {
    getPlayerMesh: () => avatarRoot,
    getPlayerLegHandle: () => playerLegs,
    setChannel(name, pose) { channels.set(name, pose); },
    clearChannel(name) { channels.delete(name); },
  },
  CharacterActionLocks: {
    isLocked: () => false,
    acquire() {
      const token = {};
      activeTokens.add(token);
      return { release: () => activeTokens.delete(token) };
    },
  },
  RuntimeFrameScheduler: { register(id, callback, options) {
    assert.equal(id, 'spouse-kiss');
    assert.equal(options.phase, 'pre-render');
    renderFrame = callback;
  } },
  RomanceSystem: { getSpouse: () => ({ npcId: 'spouse' }) },
  WorldActionInputClaims: { setClaims() {}, clearClaims() {} },
};
vm.runInNewContext(read('docs/js/actor-body-sink.js'), { window: visualWindow });
vm.runInNewContext(motionSrc, { window: visualWindow, console });
const visual = visualWindow.SpouseKissMotion;
assert.equal(visual.init(), true, 'live kiss must register on shared pre-render clock');
let contacts = 0;
assert.equal(visual.start(sceneWalker, () => contacts++), true);
for (let i = 0; i < 9; i++) renderFrame({ deltaMs: 80 });
assert.equal(contacts, 0, 'no blessing before the first contact frame');
assert.ok(partnerLegs.sink > 0 && playerLegs.sink === 0, 'tall NPC kneels and shorter player stays grounded');
assert.equal(activeTokens.size, 1);
assert.equal(visual.stop('dodge'), true);
assert.equal(partnerLegs.sink, 0, 'cancel must restore both knee sinks');
assert.equal(npcRigRoot.position.y, 0, 'cancel must restore the NPC visual root');
assert.equal(channels.size, 0, 'cancel must release the player pose channel');
assert.equal(activeTokens.size, 0, 'cancel must release both characters');
assert.equal(contacts, 0, 'early dodge must never grant the buff');
assert.equal(visual.start(sceneWalker, () => contacts++), true);
for (let i = 0; i < 34; i++) renderFrame({ deltaMs: 80 });
assert.equal(contacts, 1, 'contact callback fires exactly once per kiss');
assert.equal(visual.diagnostics().active, false, 'animation finishes and cleans up');
assert.equal(visual.diagnostics().lastResult.reason, 'completed');
assert.equal(activeTokens.size, 0);

console.log('Spouse kiss: height extremes, author, live contact/cancel/cleanup, spouse-only command, save/refresh/expiry and non-stacking buff OK.');
