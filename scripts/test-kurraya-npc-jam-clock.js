'use strict';
const assert = require('node:assert/strict'); // Tests the shipped transport calculations rather than a second implementation.
const fs = require('node:fs'); // Reads the actual gameplay music engine and its host bridge.
const vm = require('node:vm'); // Isolates clock math with deterministic time and no browser/audio devices.

const source = fs.readFileSync('docs/assets/minigames/lyre-performance.html','utf8');
const host = fs.readFileSync('docs/js/music-minigame.js','utf8');
function section(start,end) {
  const i = source.indexOf(start), j = source.indexOf(end,i + start.length); // Extracts complete real functions, not edited test copies.
  assert(i >= 0 && j > i, 'missing shipped engine section: ' + start);
  return source.slice(i,j);
}

const intro = [0,1,2,3]; // NPC’s authored four 6/8 bars.
const body = Array(16).fill(0); // NPC’s following 3/4 bars, including a deliberately different tonic chord.
body[6] = 4;
const state = {
  game:{active:false},harmonyBpm:96,harmonyStartTime:9500,
  kurrayaSongIntroSteps:intro,kurrayaSongBodySteps:body
}; // Mimics the player’s idle free-play engine before they follow the NPC.
const sixEight = {numerator:6,quarterUnitsPerBeat:0.5,label:'6/8',groupStarts:[0,3]};
const threeFour = {numerator:3,quarterUnitsPerBeat:1,label:'3/4',groupStarts:[0]};
const mixedPhase = quarter => {
  const bar = Math.min(19,Math.floor(quarter/3)); // Fixture supplies only the fixed-meter calculation seam.
  const inIntro = bar < 4;
  return {cycleIndex:0,chordWithinCycle:bar,absoluteChord:bar,chordQuarterBeats:3,
    meter:inIntro?sixEight:threeFour,labMeterOverride:false,
    absoluteStartMeterBeat:inIntro?bar*6:24+(bar-4)*3,
    performanceMeterBeatFloat:inIntro?quarter*2:24+(quarter-12)};
};
const segments = (steps,startChord) => steps.map((step,i) =>
  ({startBar:i,lengthBars:1,step,startChord:startChord+i})); // Builds the same shape returned by cached Kurraya arrangement segments.
const sandbox = vm.createContext({
  state,nowMs:()=>10000,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
  activeKurrayaLabMeter:()=>null,kurrayaSixEightMeter:()=>sixEight,activeSongMeter:()=>threeFour,
  usesFixedKurrayaHarmony:()=>true,fixedKurrayaMixedMeterPhase:mixedPhase,
  FIXED_HARMONY_CHORD_QUARTER_BEATS:3,FIXED_HARMONY_CYCLE_CHORDS:20,
  FIXED_HARMONY_SIX_EIGHT_CHORDS:4,FIXED_HARMONY_METER_BEATS_PER_CYCLE:72,
  KURRAYA_TIME_SIGNATURE:[6,8],KURRAYA_THREE_FOUR_TIME_SIGNATURE:[3,4], // Authored mixed-meter leader needs both numerators when resolving chord spans.
  fixedKurrayaProgressionStepForChord:bar=>bar%4,
  activeKurrayaSongArrangement:()=>({introSegments:segments(state.kurrayaSongIntroSteps,0),
    bodySegments:segments(state.kurrayaSongBodySteps,4)}),
});
vm.runInContext(
  'let jamLeaderSync = null;\n' +
  section('  function activeClockBpm() {','  function harmonyElapsedMs() {') + '\n' +
  section('  function fixedKurrayaHarmonyCadence(','  function currentHarmonyStep(') + '\n' +
  'this.follow = leader => {jamLeaderSync = leader}; this.clockAt = sharedTransportData; this.cadenceAt = fixedKurrayaHarmonyCadence;',
  sandbox
);
const leader = {songId:'when-the-kininjis-bloom',bpm:120,elapsedMs:15000,
  receivedAtMs:10000,countInMs:3000,countInBeats:6}; // NPC 30 quarter-beats into a 120-BPM song.
sandbox.follow(leader);
const joined = sandbox.clockAt(10000);
assert.equal(joined.bpm,120,'the player’s transport inherits NPC quarter-note tempo');
assert.equal(joined.transportElapsedMs,15000,'joining mid-performance does not restart the NPC phrase');
assert.equal(joined.performanceElapsedMs,12000,'the NPC count-in is preserved in the shared song transport');
assert.equal(joined.meter.label,'3/4','the follower enters the NPC melody section at the actual meter');
assert.equal(joined.harmonyQuarterBeatFloat,30,'the NPC chord timeline keeps its 6/8 introduction when calculating its position');
assert.equal(sandbox.cadenceAt(joined).progressionStep,4,'the player resolves the NPC-authored tonic chord, not their solo four-chord loop');
const halfSecondLater = sandbox.clockAt(10500);
assert.equal(halfSecondLater.harmonyQuarterBeatFloat,31,'the player’s beat clock advances continuously between cheap one-second resyncs');
assert.equal(halfSecondLater.bpm,120);
sandbox.follow({...leader,elapsedMs:2500,receivedAtMs:10000});
const introPhase = sandbox.clockAt(10000);
assert.equal(introPhase.meter.label,'6/8','rejoining during the 6/8 intro uses the NPC’s original meter');
assert.equal(sandbox.cadenceAt(introPhase).progressionStep,1,'intro chord progression is also copied from the NPC');
sandbox.follow(null);
const solo = sandbox.clockAt(10000);
assert.equal(solo.bpm,96,'disengaging restores the player’s separate solo tempo');
assert.equal(solo.countInBeats,0,'a solo player does not inherit the NPC count-in after leaving');
assert.match(host,/syncPlayerWithNpc\(performers\)/,'existing ambient scheduler corrects drift without a second polling loop');
assert.match(source,/type:'ambient-transport-changed'/,'each NPC song regeneration triggers an immediate event-driven sync');
assert.match(source,/iteration < 10/,'audio lookahead uses the bounded sub-millisecond binary search optimization');
assert.ok(source.includes('if (!jamLeaderSync || state.ambientOnly) {'),'following the NPC must skip duplicate player metronome scheduling');
assert.ok(source.includes('if (!state.rootPadEnabled || HOSTED_FLUTE_PERFORMANCE || jamLeaderSync) return;'),'flute and NPC-following Kurraya performances must skip duplicated pad scheduling');
assert.ok(host.includes('data-perf="jam"'),'mobile performance HUD must show NPC synchronization status');
assert.ok(host.includes('lastJamHudAt'),'mobile sync diagnostics must reuse the existing HUD cadence rather than spawning another timer');
console.log('NPC jam clock, 6/8→3/4 harmony, mid-song joining, solo restore and transport optimization passed.');
