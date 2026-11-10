'use strict';
const assert = require('node:assert/strict'); // Checks real NPC-follow bridge methods, not just matching text.
const fs = require('node:fs'); // Reads the shipped instrument implementation directly.
const vm = require('node:vm'); // Executes extracted bridge methods in an isolated clock and audio fixture.
const engine = fs.readFileSync('docs/assets/minigames/lyre-performance.html','utf8'); // Keeps the test tied to the actual in-game iframe source.
function section(start,end) {
  const a=engine.indexOf(start),b=engine.indexOf(end,a+start.length); // Finds the production method block between stable signatures.
  assert(a>=0 && b>a,'missing instrument engine section: '+start);
  return engine.slice(a,b);
}
const baseIntro=[3,3,3,3],baseBody=Array(16).fill(3); // Distinguishes the original solo bars from an NPC's edited arrangement.
const state={
  ambientOnly:false,paused:false,game:{active:false,backupAccompaniment:false},
  bpm:104,harmonyBpm:96,harmonyStartTime:9500,tonicMidi:36,scaleName:'Major',
  kurrayaSongIntroSteps:baseIntro.slice(),kurrayaSongBodySteps:baseBody.slice(),
  rootPadEnabled:true,rootPadVoices:[],lastRootPadKey:'old',scheduledRootPadKey:'old',
  lastMetronomeBeat:12,scheduledMetronomeBeat:12,lastHarmonyStep:7,
  frettedSources:new Map(),pluckInputMode:'direct',leftStickSector:0,
  autoPickSlots:['direct','direct','direct','direct'],layoutPreset:'five-bank-auto',
  selectedSong:'when-the-kininjis-bloom',harmonyPattern:'4–5–3–6',
  gameTime:0
}; // Represents a player whose Kurraya is ready for Free Play before a nearby NPC starts.
let clockMs=10000,epochMs=1800000000000,stoppedRootPads=0,visualRefreshes=0;
const sixEight={numerator:6,denominator:8,groupStarts:[0,3],quarterUnitsPerBeat:0.5,measureQuarterBeats:3,label:'6/8'};
const threeFour={numerator:3,denominator:4,groupStarts:[0],quarterUnitsPerBeat:1,measureQuarterBeats:3,label:'3/4'};
function mixedPhase(quarter) {
  const bar=Math.min(19,Math.floor(quarter/3)),intro=bar<4;
  const beatsBefore=intro?bar*6:24+(bar-4)*3;
  const beatInto=(quarter-bar*3)/(intro?.5:1);
  return {cycleIndex:0,chordWithinCycle:bar,absoluteChord:bar,meter:intro?sixEight:threeFour,
    quarterBeatIntoChord:quarter-bar*3,performanceMeterBeatFloat:beatsBefore+beatInto,
    labMeterOverride:false,absoluteStartMeterBeat:beatsBefore};
} // Predictable seam for the already-covered fixed mixed-meter helper, not a replacement for bridge methods.
const context={
  state,nowMs:()=>clockMs,Date:{now:()=>epochMs},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
  stopRootPad:()=>{stoppedRootPads++;state.rootPadVoices=[];},
  stopSong:()=>{state.game.active=false;},
  updateHarmonyVisual:()=>visualRefreshes++,
  applyPerformanceScale:name=>{state.scaleName=name;},
  applyPerformanceTonic:note=>{state.tonicMidi=note;},
  normalizeKurrayaArrangementSteps:(steps,length)=>steps.slice(0,length),
  activeKurrayaSongArrangement:()=>({introSteps:state.kurrayaSongIntroSteps,bodySteps:state.kurrayaSongBodySteps}),
  gameTime:()=>0,gameClockElapsedMs:()=>clockMs-state.game.startTime,
  kurrayaSixEightMeter:()=>sixEight,activeKurrayaLabMeter:()=>null,
  activeSongMeter:()=>threeFour,usesFixedKurrayaHarmony:()=>true,
  fixedKurrayaMixedMeterPhase:mixedPhase,automaticPatternDefinition:()=>({short:'Single'}),
  leftStickModeIds:()=>['direct'],normalizeAutoPickSlots:()=>state.autoPickSlots,
  songTitle:()=> 'When the Kininjis Bloom',
  currentHarmonyStep:clock=>clock.mixedPhase.absoluteChord,
  currentHarmonyData:()=>({chordName:'C major'}),
  FIXED_HARMONY_CYCLE_CHORDS:20,FIXED_HARMONY_CHORD_QUARTER_BEATS:3
}; // All side effects are observable counters or state changes; no real audio, DOM, or timers are created.
vm.runInNewContext(
  'let jamLeaderSync = null;\n' +
  section('  function activeClockBpm() {','  function harmonyElapsedMs() {') + '\n' +
  'const bridge = {\n' +
  section('    jamLeaderSnapshot() {','    // Kept for standalone Music Lab preview compatibility') +
  section('    getState() {','  };\n\n  init();') +
  '\n}; this.bridge=bridge; this.follower=()=>jamLeaderSync;',
  context
);
const bridge=context.bridge; // Uses the real submitted NPC-follow API and state snapshot method.
const npcIntro=[0,1,2,3],npcBody=Array(16).fill(0);
npcBody[6]=4;
const leader={playing:true,songId:'when-the-kininjis-bloom',sampledEpochMs:epochMs,
  elapsedMs:15000,bpm:120,tonicMidi:48,scaleName:'Pentatonic Minor',
  countInMs:3000,countInBeats:6,introSteps:npcIntro,bodySteps:npcBody}; // NPC is 30 quarter beats into its authored performance.
assert.equal(bridge.followJamLeader({...leader,introSteps:[]}),false,'malformed bars must never override player state');
assert.equal(context.follower(),null,'rejected snapshot must not activate the jam');
assert.equal(bridge.followJamLeader(leader),true,'a valid NPC snapshot establishes the follower');
assert.equal(stoppedRootPads,1,'joining drops the original player bass rather than doubling NPC accompaniment');
assert.equal(state.tonicMidi,48,'player tonic follows the NPC without overwriting solo settings');
assert.equal(state.scaleName,'Pentatonic Minor','player note scale follows the NPC');
assert.equal(state.kurrayaSongBodySteps[6],4,'NPC authored C chord is copied into the live follower');
assert.equal(bridge.getState().bpm,120,'the public performance state advertises NPC tempo, not the old 104 BPM');
assert.equal(bridge.getState().measureIndex,10,'the public measure index resolves the real NPC 3/4 song bar');
assert.equal(bridge.getState().measurePhaseMs,0,'joining at an exact NPC bar starts on that bar beat');
assert.equal(bridge.getState().measureDurationMs,1500,'a 3/4 bar at 120 quarter-BPM lasts 1500 ms');
clockMs+=500; epochMs+=500;
assert.equal(bridge.getState().measurePhaseMs,500,'between sync messages, the shared clock advances smoothly');
assert.equal(bridge.followJamLeader({...leader,elapsedMs:15510,sampledEpochMs:epochMs}),true);
assert.ok(Math.abs(context.follower().elapsedMs-15503.5)<.001,'a 10 ms drift smooths by 35% instead of causing a clock jump');
assert.equal(stoppedRootPads,1,'periodic drift checks must not stop and restart the bass repeatedly');
clockMs+=200;epochMs+=200;
assert.equal(bridge.followJamLeader({...leader,elapsedMs:2500,sampledEpochMs:epochMs}),true,'the song loop can reset sharply');
assert.equal(bridge.getState().measureIndex,1,'the follower resets into the NPC 6/8 intro instead of continuing a stale 3/4 bar');
assert.equal(bridge.getState().measureDurationMs,1500,'the 6/8 measure still contains three quarter-note units');
assert.equal(bridge.getState().measurePhaseMs,1000,'the mixed-meter phase resolves the intro measure offset');
assert.equal(bridge.stopJamFollow(),true,'leaving the NPC restores a solo instrument');
assert.equal(bridge.stopJamFollow(),false,'repeated cleanup is idempotent');
assert.equal(context.follower(),null,'no NPC time remains after closing the follower');
assert.equal(state.tonicMidi,36,'the original solo tonic is restored');
assert.equal(state.scaleName,'Major','the original solo note set is restored');
assert.deepEqual(Array.from(state.kurrayaSongIntroSteps),baseIntro,'solo authored intro bars are restored');
assert.equal(bridge.getState().bpm,104,'solo HUD returns to the original independent BPM');
assert.equal(visualRefreshes>=2,true,'jam start and stop refresh the harmony HUD');
state.ambientOnly=true;state.game.active=true;
state.game.songType='when-the-kininjis-bloom';
state.game.startTime=5000;state.game.pauseAccum=0;state.game.pausedAt=0;
const ambient=bridge.jamLeaderSnapshot();
assert.equal(ambient.bpm,104,'NPC snapshots use their own active song tempo');
assert.equal(ambient.elapsedMs,clockMs-5000,'snapshot uses the NPC local monotonic game clock');
assert.equal(ambient.introSteps.length,4,'snapshot includes four authored intro bars');
assert.equal(ambient.bodySteps.length,16,'snapshot includes 16 melody bars');
assert.ok(ambient.introSteps!==state.kurrayaSongIntroSteps,'snapshot does not expose mutable NPC arrangement arrays');
console.log('Live NPC follow bridge, 6/8→3/4 HUD clock, drift correction, resync, bass handoff and solo restore passed.');
