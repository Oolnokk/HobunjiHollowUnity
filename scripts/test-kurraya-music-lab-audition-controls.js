'use strict';
// Verifies the Music Lab's optional arpeggio and time-signature controls against the real Kurraya engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = fs.readFileSync(path.join(__dirname,'../docs/assets/minigames/lyre-performance.html'),'utf8'); // Same script loaded in the game and Music Lab.
const lab = fs.readFileSync(path.join(__dirname,'../docs/tools/kurraya-music-lab/index.html'),'utf8'); // User-visible form and its bridge wiring.
const host = fs.readFileSync(path.join(__dirname,'../docs/js/music-minigame.js'),'utf8'); // Gameplay's iframe loader for cache-version parity.

function sourceOf(name) {
  const prefix = `  function ${name}(`;
  const start = engine.indexOf(prefix);
  assert.ok(start >= 0,`Missing function ${name}`);
  const finish = engine.indexOf('\n  }\n',start);
  assert.ok(finish > start,`No function terminator for ${name}`);
  return engine.slice(start,finish + '\n  }'.length);
}
const clamp = (value,min,max) => Math.max(min,Math.min(max,value)); // Same numeric normalization as the real engine.
const modulo = (value,span) => ((value % span) + span) % span; // Repeats the song's twenty-bar phrase.
const originals = {
  KURRAYA_TIME_SIGNATURE:[6,8],KURRAYA_BEAT_GROUPING:[3,3],
  KURRAYA_THREE_FOUR_TIME_SIGNATURE:[3,4],KURRAYA_THREE_FOUR_BEAT_GROUPING:[3],
  FIXED_HARMONY_CYCLE_QUARTER_BEATS:60,FIXED_HARMONY_CHORD_QUARTER_BEATS:3,
  FIXED_HARMONY_CYCLE_CHORDS:20,FIXED_HARMONY_SIX_EIGHT_CHORDS:4,
  FIXED_HARMONY_THREE_FOUR_CHORDS:16,FIXED_HARMONY_METER_BEATS_PER_CYCLE:72,
  kurrayaSixEightMeterCache:null,kurrayaThreeFourMeterCache:null
};
const originalState = {game:{active:false,songType:null,labMeterOverride:null},selectedSong:'when-the-kininjis-bloom'};
const meterContext = {state:originalState,clamp,modulo,...originals};
vm.runInNewContext([
  'let kurrayaSixEightMeterCache = null; let kurrayaThreeFourMeterCache = null;',
  sourceOf('normalizeTimeSignature'),sourceOf('automaticBeatGrouping'),
  sourceOf('normalizeBeatGrouping'),sourceOf('timeSignatureData'),sourceOf('kurrayaSixEightMeter'),
  sourceOf('activeKurrayaLabMeter'),sourceOf('fixedKurrayaMixedMeterPhase'),
  'this.meter = timeSignatureData; this.phase = fixedKurrayaMixedMeterPhase;'
].join('\n'),meterContext);
const originalPhase = meterContext.phase(15.25);
assert.equal(originalPhase.chordWithinCycle,5,'original six-eight to three-four meter must retain five completed 3-quarter bars');
assert.equal(originalPhase.meter.label,'3/4','original song body must remain in 3/4');
assert.equal(meterContext.meter([7,8]).grouping.join('+'),'2+2+3','seven-eight uses readable grouped accents');
assert.equal(meterContext.meter([9,8]).grouping.join('+'),'3+3+3','nine-eight uses compound triple accents');
for(const [signature,barUnits,beats] of [['2/4',2,2],['3/4',3,3],['4/4',4,4],['5/4',5,5],['6/8',3,6],['7/8',3.5,7],['9/8',4.5,9],['12/8',6,12]]) {
  originalState.game = {active:true,songType:'when-the-kininjis-bloom',labMeterOverride:signature};
  const first = meterContext.phase(barUnits * 4);
  assert.equal(first.chordWithinCycle,4,signature+' must begin the melody on the fifth authored bar');
  assert.equal(first.meter.label,signature,signature+' must supply real transport beat timing');
  assert.equal(first.absoluteStartMeterBeat,4*beats,signature+' must preserve every bar downbeat');
  const last = meterContext.phase(barUnits * 19);
  assert.equal(last.chordWithinCycle,19,signature+' must preserve the final C chord section');
  assert.equal(last.absoluteStartMeterBeat,19*beats,signature+' must preserve all 20 bar accents');
  const wrapped = meterContext.phase(barUnits * 20 + barUnits * 2);
  assert.equal(wrapped.cycleIndex,1,signature+' must wrap exactly after twenty bars');
  assert.equal(wrapped.chordWithinCycle,2,signature+' must land in bar three on repeat');
}
originalState.game.active = false;
assert.equal(meterContext.phase(15.25).meter.label,'3/4','a Lab meter choice must never alter non-audition freeplay');

const melody = {timeSignature:[6,8],beatGrouping:[3,3],notes:[[0,3],[1,3],[2,42]]}; // Three melody events spanning the authored 48 quarters.
const generateContext = {
  clamp,getSongDefinition:id=>id==='when-the-kininjis-bloom' ? melody : null,
  melodyInputForDegree:degree=>({noteIndex:degree,modeOffset:0}),
  currentModeOffsets:()=>[0,4,8,12,16],
  timeSignatureData:meterContext.meter,
  FIXED_HARMONY_SIX_EIGHT_CHORDS:4,FIXED_HARMONY_CHORD_QUARTER_BEATS:3
};
vm.runInNewContext(sourceOf('generateSong')+'\nthis.song = generateSong;',generateContext);
const original = generateContext.song('when-the-kininjis-bloom',120);
assert.equal(original.countInBeats,24,'original four-bar six-eight intro is unchanged');
assert.equal(original.countInMs,6000,'original intro retains twelve quarters at 120 BPM');
assert.equal(original.events[1].time-original.events[0].time,1500,'original note durations remain unchanged');
const five = generateContext.song('when-the-kininjis-bloom',120,{labMeterOverride:[5,4]});
assert.equal(five.countInBeats,20,'five-four introduces four bars of five quarter notes each');
assert.equal(five.countInMs,10000,'five-four intro must reach the fifth bar at twenty quarter notes');
assert.equal(five.events[1].time-five.events[0].time,2500,'re-metering must actually stretch melody note spacing');
assert.equal(five.timeSignature.join('/'),'5/4','the actual game state must use the selected meter');
assert.equal(five.totalSongBeats,80,'sixteen melody bars must span exactly eighty quarter beats');
const seven = generateContext.song('when-the-kininjis-bloom',120,{labMeterOverride:[7,8]});
assert.equal(seven.countInMs,7000,'seven-eight intro must contain fourteen quarter-note units');
assert.equal(seven.timeSignature.join('/'),'7/8','seven-eight must remain distinguishable from 3/4');
assert.equal(seven.beatGrouping.join('+'),'2+2+3','seven-eight accent pattern must be grouped');
assert.equal(seven.totalSongBeats,56,'sixteen seven-eight melody bars must span 56 quarter notes');
assert.equal(seven.events[1].time-seven.events[0].time,1750,'seven-eight melody must stretch exactly 7/6 from original bar length');

const engineVersion = /lyre-performance\.html\?v=([A-Za-z0-9_-]+)/; // Matches any bumped cache token.
assert.equal(host.match(engineVersion)?.[1],lab.match(engineVersion)?.[1],'gameplay and Music Lab must use the same engine revision');
assert.match(engine,/startSong\(state\.selectedSong,\{demoMode:state\.songAuditionPattern,labMeterOverride/,'song audition must use the selected Auto Pick pattern and chosen meter');
assert.match(engine,/autoPickAuditionState\(\)/,'the bridge must expose the authoritative pattern definitions');
assert.match(engine,/setAutoPickAuditionPattern\(mode\)/,'the bridge must validate and update the Lab pattern');
assert.match(engine,/setSongAuditionMeter\(mode\)/,'the bridge must validate and update the Lab meter');
assert.match(engine,/options\.labMeterOverride \? timeSignatureData/,'the actual generated song must use the new time signature');
assert.match(engine,/spanQuarterBeats:segment\.lengthBars \* \(phase\.chordQuarterBeats/,'chord sustains must stretch with the selected meter');
assert.match(lab,/id="auditionPatternSelect"/,'the picker must be visible in Music Lab');
assert.match(lab,/id="auditionMeterSelect"/,'the time signature control must be visible in Music Lab');
assert.match(lab,/auditionPatternSelect\.addEventListener\('change'/,'changing the pattern must control the engine');
assert.match(lab,/auditionMeterSelect\.addEventListener\('change'/,'changing the meter must control the engine');
assert.match(lab,/note\.authoredDurationQuarterBeats \?\? note\.durationQuarterBeats/,'experimental meter must not change exported melody source durations');

console.log('Kurraya Music Lab Auto Pick and meter audition controls passed.');
