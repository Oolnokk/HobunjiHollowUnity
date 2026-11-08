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
for (const [first, second] of [[1, 1], [1.5, .8], [5, .1], [.1, 5]]) {
  const solution = solver.solveHeights(first, second);
  assert.equal(solution.contactPossible, true, 'mouths can meet with dimensions ' + first + '/' + second);
  assert.ok(solution.remainingGap <= .025);
  assert.ok(solution.tallerSinkPct >= 0 && solution.tallerSinkPct <= solver.MAX_SINK_PCT);
  assert.ok(solution.tallerSinkWorld <= solution.kneeLimitWorld, 'kneeling respects the actual leg reach');
  assert.ok(solution.tallerBowDeg >= 0 && solution.tallerBowDeg <= solver.MAX_BOW_DEG);
  assert.equal(solution.shorterSinkPct, 0, 'shorter partner remains standing on the ground');
  assert.equal(solution.taller, first >= second ? 'first' : 'second');
}
const impossible = solver.solveHeights(200, .001);
assert.equal(impossible.contactPossible, false, 'unreachable pair must not receive false lip contact');
assert.ok(impossible.remainingGap > .025);
assert.equal(solver.solveHeights(5, 1, { tallerLegLengthWorld: .1, tallerHipHeightWorld: 2 }).contactPossible, false,
  'short actual legs must not be treated as imaginary long legs');
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
assert.equal(renderedEffects['romance-spouse-kiss']().length, 0, 'expired buff drops off the HUD'); // VM arrays have a distinct prototype realm.

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
  modelHeight: height, standingPosteriorY: height * .28, sink: 0, limit: .55,
  group: { getWorldScale(out) { out.x = 1; out.y = 1; out.z = 1; return out; } },
  motionAnatomy() { return [{ length: this.standingPosteriorY }, { length: this.standingPosteriorY }]; },
  setStanceDropLimitFraction(value) {
    const previous = this.limit;
    this.limit = Math.max(.55, Math.min(.95, Number(value) || .55));
    return previous;
  },
  getStanceDropLimitFraction() { return this.limit; },
  setStanceDrop(amount) { this.sink = Math.min(amount, this.standingPosteriorY * this.limit); },
  getStanceDrop() { return this.sink; },
});
const avatarRoot = root(0, 0, 0, 1);
const npcRoot = root(0, 0, .8, 5);
const npcRigRoot = { position: { y: 0 }, scale: { y: 1 }, userData: {} };
npcRoot.getObjectByName = name => name === 'npc_character_rig_root' ? npcRigRoot : null;
const playerLegs = legHandle(1);
const partnerLegs = legHandle(5);
const sceneWalker = {
  rec: { id: 'spouse' }, area: 'farm', root: npcRoot,
  avatarGroup: { userData: { portraitModelHeight: 5 }, rotation: { x: 0 } }, legs: partnerLegs,
};
let renderFrame = null;
const channels = new Map();
const activeTokens = new Set();
let lastLockParticipants = null; // Used to inspect that the kiss leaves the player composer operational.
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
    acquire(options) {
      lastLockParticipants = options.participants;
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
visualWindow.NpcPathfinding = { isNpcPositionWalkable: () => false };
assert.equal(visual.start(sceneWalker, () => contacts++), false, 'bow must refuse blocked floor space');
assert.equal(visual.diagnostics().lastError, 'not-enough-clear-floor-for-deep-bow');
assert.equal(activeTokens.size, 0, 'failed start must leave actors unlocked');
delete visualWindow.NpcPathfinding;
assert.equal(visual.start(sceneWalker, () => contacts++), true);
assert.equal(partnerLegs.limit, .95, 'only the kiss may deepen the kneel');
assert.equal(lastLockParticipants[0].channels.includes('pose'), false, 'player pose lock would disable the compositor');
for (let i = 0; i < 9; i++) renderFrame({ deltaMs: 80 });
assert.equal(contacts, 0, 'no blessing before the first contact frame');
assert.ok(partnerLegs.sink > 0 && playerLegs.sink === 0, 'tall NPC kneels and shorter player stays grounded');
assert.ok(sceneWalker.avatarGroup.rotation.x > 0, 'taller torso bends at the waist');
assert.ok(partnerLegs.sink <= partnerLegs.standingPosteriorY * .95, 'actual knee cap is never exceeded');
assert.ok(npcRoot.position.z > .8, 'taller partner retreats to allow space for a deep bow');
assert.equal(activeTokens.size, 1);
assert.equal(visual.stop('dodge'), true);
assert.equal(partnerLegs.sink, 0, 'cancel must restore both knee sinks');
assert.equal(npcRigRoot.position.y, 0, 'cancel must restore the NPC visual root');
assert.equal(sceneWalker.avatarGroup.rotation.x, 0, 'cancel unbends the torso');
assert.equal(playerLegs.limit, .55, 'player knee cap restored');
assert.equal(partnerLegs.limit, .55, 'NPC knee cap restored');
assert.equal(npcRoot.position.z, .8, 'cancel must restore the original approach position');
assert.equal(channels.size, 0, 'cancel must release the player pose channel');
assert.equal(activeTokens.size, 0, 'cancel must release both characters');
assert.equal(contacts, 0, 'early dodge must never grant the buff');
assert.equal(visual.start(sceneWalker, () => contacts++), true);
for (let i = 0; i < 34; i++) renderFrame({ deltaMs: 80 });
assert.equal(contacts, 1, 'contact callback fires exactly once per kiss');
assert.equal(visual.diagnostics().active, false, 'animation finishes and cleans up');
assert.equal(visual.diagnostics().lastResult.reason, 'completed');
assert.equal(partnerLegs.limit, .55, 'completed kiss restores normal knee cap');

// The taller player needs the real body composer and floor-anchored procedural legs.
avatarRoot.userData.portraitModelHeight = 5;
playerLegs.modelHeight = 5;
playerLegs.standingPosteriorY = 1.4;
sceneWalker.avatarGroup.userData.portraitModelHeight = 1;
partnerLegs.modelHeight = 1;
partnerLegs.standingPosteriorY = .28;
assert.equal(visual.start(sceneWalker, () => contacts++), true, 'reversed size pairing starts');
for (let i = 0; i < 9; i++) renderFrame({ deltaMs: 80 });
assert.ok(playerLegs.sink > 0, 'taller player knee actually folds');
assert.equal(partnerLegs.sink, 0, 'shorter NPC keeps its feet planted');
assert.ok(channels.get('spouse-kiss')?.rotation?.pitch > 0, 'player composer gets a genuine bow');
assert.equal(channels.get('spouse-kiss')?.absoluteLegs, true, 'player feet remain vertical');
assert.ok(channels.has('spouse-kiss-retreat'), 'player body makes room for the bow');
assert.equal(visual.stop('reversed-cancel'), true);
assert.equal(playerLegs.sink, 0);
assert.equal(playerLegs.limit, .55);
assert.equal(partnerLegs.limit, .55);
assert.equal(channels.size, 0);
assert.equal(activeTokens.size, 0);
assert.equal(activeTokens.size, 0);

const npcStateSrc = read('docs/js/npc-character-state.js');
assert.match(npcStateSrc, /!window\.SpouseKissMotion\?\.isPartner\?\.\(walker\)/,
  'NPC movement lock must not suppress the kiss leg solver');
const npcStateWindow = {
  CharacterActionLocks: { isLocked: () => true },
  SpouseKissMotion: { isPartner: () => true },
};
vm.runInNewContext(npcStateSrc, { window: npcStateWindow, console });
let npcSuppressed = null;
const heldWalker = {
  rec: { id: 'spouse' }, root: { position: { x: 1, y: 0, z: 2 } },
  legs: { update(dt, speed, suppressed) { npcSuppressed = suppressed; } },
};
assert.equal(npcStateWindow.NpcCharacterState.update(heldWalker, .016, {}), true);
assert.equal(npcSuppressed, false, 'kiss freezes NPC movement but not knee folding');
npcStateWindow.SpouseKissMotion.isPartner = () => false;
npcStateWindow.NpcCharacterState.update(heldWalker, .016, {});
assert.equal(npcSuppressed, true, 'unrelated NPC locks still suppress the leg pose');
const legsSrc = read('docs/js/procedural-leg-animation.js');
assert.match(legsSrc, /setStanceDropLimitFraction:/, 'real legs expose reversible deep-kneel allowance');
console.log('Spouse kiss: anatomical limits, torso bow, lock ownership, cancel/cleanup, author, save/expiry OK.');
