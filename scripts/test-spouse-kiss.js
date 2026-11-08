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
// An ordinary Pahu/Leaf-sized difference never lifts feet off the floor.
const everyday = solver.solveHeights(.675, .855);
assert.equal(everyday.shorterPosteriorGrip, false, 'ordinary spouse kiss still kneels without a jump');
assert.equal(everyday.shorterJumpWorld, 0);
for (const [first, second] of [[1, .5], [.5, 1], [1, .3]]) {
  const jump = solver.solveHeights(first, second);
  assert.equal(jump.contactPossible, true, 'a straddled kiss must still align mouth heights');
  assert.equal(jump.shorterPosteriorGrip, true, 'a pronounced height mismatch needs a supported two-foot hop');
  assert.ok(jump.shorterJumpWorld > 0 && jump.shorterJumpWorld <= Math.min(first, second) * .75);
  assert.ok(jump.tallerSinkWorld <= jump.kneeLimitWorld, 'no jump makes the taller knee exceed its anatomical limit');
  assert.ok(jump.tallerBowDeg > 0 && jump.tallerBowDeg < solver.MAX_BOW_DEG);
  assert.ok(jump.jumpFootSpreadWorld > 0 && jump.jumpFootForwardWorld > 0);
}
assert.equal(solver.sampleJumpBlend(.37), 0, 'initial shoulder touch precedes both knee lowering and jumping');
assert.equal(solver.sampleJumpBlend(.52), 0, 'jump begins only when the tall spouse is ready');
assert.ok(solver.sampleJumpBlend(.82) > .6);
assert.equal(solver.sampleJumpBlend(1.12), 1, 'both jumping feet settle on the taller posterior at kiss contact');
assert.equal(solver.sampleJumpBlend(2.4), 0, 'the smaller spouse lands safely after separation');
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

// A shorter initiator reaches for shoulder landmarks while the taller spouse
// is still standing, then the knees lower; reverse height ordering waits for
// actual reach instead of teleporting hands onto the shorter partner.
assert.equal(solver.sampleKneelBlend(.37, true), 0, 'short initiator has hands up before taller spouse starts kneeling');
assert.equal(solver.sampleKneelBlend(.37, false) > 0, true, 'tall initiator can start lowering from the beginning');
assert.ok(solver.sampleKneelBlend(.72, true) > 0, 'taller spouse kneels after the grasp');
assert.equal(solver.sampleKneelBlend(1.12, true), 1);
assert.equal(solver.sampleKneelBlend(2.4, true), 0, 'knees recover at clip completion');
const earlyReach = solver.sampleInitiatorHandReach(.37, true, 1.5, .35);
assert.ok(earlyReach.blend > .9 && earlyReach.closestDistance > 0,
  'short initiator reaches toward the closest anatomically possible point, even if true shoulder is too high');
assert.equal(solver.sampleInitiatorHandReach(.37, false, 1.5, .35).blend, 0,
  'tall initiator cannot grip a shoulder still outside arm reach');
assert.ok(solver.sampleInitiatorHandReach(.72, false, .25, .35).blend > .9,
  'tall initiator grips as soon as lowering brings the shoulder within arm reach');
assert.equal(solver.sampleInitiatorHandReach(2.4, true, .25, .35).blend, 0,
  'hands let go again at animation completion');
class ShoulderVector {
  constructor(x=0,y=0,z=0) { this.isVector3=true;this.x=x;this.y=y;this.z=z; }
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  addScaledVector(v,scalar){this.x+=v.x*scalar;this.y+=v.y*scalar;this.z+=v.z*scalar;return this;}
}
const sourceShoulder = new ShoulderVector(0,.7,0);
const tallShoulder = new ShoulderVector(.15,2,0);
const gripPoint = new ShoulderVector();
const grip = solver.resolveShoulderGripWorld(sourceShoulder,tallShoulder,.38,gripPoint);
assert.ok(grip && !grip.exactShoulder, 'unreachable upper shoulder is explicitly marked as projected');
assert.ok(sourceShoulder.distanceTo(gripPoint) <= grip.armReach + 1e-6,
  'short initiator hand never extends beyond actual arm reach');
assert.ok(gripPoint.distanceTo(tallShoulder) < sourceShoulder.distanceTo(tallShoulder),
  'clamped grip is the nearest possible point toward the shoulder');
const torsoContact = solver.resolveShoulderGripWorld(sourceShoulder,tallShoulder,.38,gripPoint,
  new ShoulderVector(0,-1.2,0)); // Authored shoulder-to-upper-chest segment on the taller spouse.
assert.equal(torsoContact.onTorso, true, 'short initiator touches the closest reachable part of the partner torso, not midair');
assert.ok(gripPoint.distanceTo(sourceShoulder) <= torsoContact.armReach + .00001);
assert.equal(gripPoint.x, tallShoulder.x, 'contact remains on the actual target shoulder/upper-body surface');
assert.equal(gripPoint.z, tallShoulder.z, 'contact remains on the actual target torso depth plane');

// The jump reuses two world-coordinate leg IK targets. With real-sized poses,
// the targets end symmetrically beside the taller posterior, and the knee
// landing stays inside the smaller actor's leg reach.
class PosteriorVector extends ShoulderVector {
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
}
const mkWorld = (x,y,z) => ({
  updateWorldMatrix(){},
  localToWorld(v){v.x+=x;v.y+=y;v.z+=z;return v;},
});
const largeLegs = {
  group: mkWorld(0,.056,0), standingPosteriorY:.28,
  getStanceDrop:()=>.056,
  getRestStance:()=>({left:{hip:{x:-.08}},right:{hip:{x:.08}}}),
};
const smallLegs = {
  group:mkWorld(0,.084,.08),
  getRestStance:()=>({left:{hip:{x:-.04,y:.09,z:0},ankle:{x:-.04,y:.006,z:0}},
    right:{hip:{x:.04,y:.09,z:0},ankle:{x:.04,y:.006,z:0}}}),
};
const posteriorSolution = solver.solveHeights(1,.5);
const footTargets = solver.posteriorStraddleFootTargets({Vector3:PosteriorVector},
  largeLegs,smallLegs,posteriorSolution,1,{posteriorLocalOffsetY:-.056}); // Editor lowers portrait separately from raised leg group.
assert.ok(footTargets && footTargets.left.x > 0 && footTargets.right.x < 0,
  'the smaller partner places left and right feet on opposite sides of the larger posterior');
assert.ok(Math.abs(footTargets.left.y-(.28-.056)) < 1e-6,
  'the target follows the actual sunk posterior, not the floor or unbent torso');
assert.ok(Math.abs(footTargets.right.y-footTargets.left.y)<1e-6);
const gameplayTallLegs = { ...largeLegs, group: mkWorld(0,0,0) }; // Live NPC rig lowers as a unit: its hip Y is already lowered.
const gameplayFootTargets = solver.posteriorStraddleFootTargets({Vector3:PosteriorVector},
  gameplayTallLegs, smallLegs, posteriorSolution, 1);
assert.ok(Math.abs(gameplayFootTargets.left.y - footTargets.left.y) < 1e-6,
  'author and in-world NPC target the same true posterior even though their rig roots sink differently');
assert.ok(footTargets.left.distanceTo(footTargets.right)>0.01);
assert.equal(solver.posteriorStraddleFootTargets({Vector3:PosteriorVector},largeLegs,smallLegs,posteriorSolution,0),null,
  'no external foot ownership when the short partner has not taken off');
const challenged = {...posteriorSolution, jumpFootForwardWorld: 1.2}; // Deliberately unreachable intermediate ankle path.
const folded = solver.posteriorStraddleFootTargets({Vector3:PosteriorVector},
  largeLegs,smallLegs,challenged,.5,{posteriorLocalOffsetY:-.056});
for(const side of ['left','right']) {
  const hip = smallLegs.getRestStance()[side].hip;
  const worldHip = new PosteriorVector(hip.x,hip.y+.084,hip.z+.08);
  assert.ok(worldHip.distanceTo(folded[side]) <= (.09-.006)*.995 + .000001,
    'during lift/landing, temporary ankle target stays inside true two-bone leg reach');
}
// Gameplay's player composer moves the entire avatar only while rendering.
// Its uncomposed leg IK target must be correspondingly lower, so after the
// composer lift the two actual soles still land on the taller posterior.
const composerGroup = {...smallLegs, group: mkWorld(0,0,.08)};
const playerComposerFeet = solver.posteriorStraddleFootTargets({Vector3:PosteriorVector},
  largeLegs, composerGroup, posteriorSolution, 1, { composerLift:true, posteriorLocalOffsetY:-.056 });
assert.ok(Math.abs(playerComposerFeet.left.y + posteriorSolution.shorterJumpWorld - footTargets.left.y) < 1e-6,
  'player-owned foot target compensates temporary render-only lift');
assert.ok(Math.abs(playerComposerFeet.right.y + posteriorSolution.shorterJumpWorld - footTargets.right.y) < 1e-6,
  'both player feet stay planted when the composer raises the smaller spouse');
const nearShoulder = new ShoulderVector(0,.8,0);
const exactGrip = solver.resolveShoulderGripWorld(sourceShoulder,nearShoulder,.38,gripPoint);
assert.ok(exactGrip.exactShoulder && gripPoint.distanceTo(nearShoulder) < 1e-6,
  'reachable shoulders receive genuine, unoffset contact');

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

// Live in-world jump works in both directions and restores the exact previous
// NPC root elevation after cancel. A missing hand/foot model in this mock is
// handled gracefully while the real browser exercises actual IK.
avatarRoot.userData.portraitModelHeight=1;playerLegs.modelHeight=1;playerLegs.standingPosteriorY=.28;
sceneWalker.avatarGroup.userData.portraitModelHeight=2;partnerLegs.modelHeight=2;partnerLegs.standingPosteriorY=.56;
assert.equal(visual.start(sceneWalker,()=>contacts++),true);
assert.equal(visual.diagnostics().session.height.shorterPosteriorGrip,true,'shorter live player should hop');
for(let i=0;i<13;i++)renderFrame({deltaMs:80});
assert.ok(channels.get('spouse-kiss').translation.y > .01,'shorter player actually rises toward the spouse posterior');
assert.equal(npcRoot.position.y,0,'the taller NPC continues to stand on the floor');
assert.equal(visual.stop('short-player-hop-cancel'),true);
assert.equal(channels.size,0,'cancel removes the player leap composer channel');
avatarRoot.userData.portraitModelHeight=2;playerLegs.modelHeight=2;playerLegs.standingPosteriorY=.56;
sceneWalker.avatarGroup.userData.portraitModelHeight=1;partnerLegs.modelHeight=1;partnerLegs.standingPosteriorY=.28;
assert.equal(visual.start(sceneWalker,()=>contacts++),true);
assert.equal(visual.diagnostics().session.height.shorterPosteriorGrip,true,'shorter NPC should hop');
for(let i=0;i<13;i++)renderFrame({deltaMs:80});
assert.ok(npcRoot.position.y > 0,'shorter NPC receives actual vertical leap root motion');
assert.equal(visual.stop('short-npc-hop-cancel'),true);
assert.equal(npcRoot.position.y,0,'cancel fully restores NPC floor elevation');
assert.equal(playerLegs.limit,.55);assert.equal(partnerLegs.limit,.55);

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
assert.match(legsSrc, /allowDeepFold/, 'shared procedural-leg IK supports posterior straddling without leg overextension');
console.log('Spouse kiss: anatomical kneel + posteror-straddle jump, paired IK, lock/cancel cleanup, buff, author OK.');
