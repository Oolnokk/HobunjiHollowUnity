'use strict';
// Regression checks for Kurraya's real Auto Pick note handling and successful-preview transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const engine = fs.readFileSync(path.join(__dirname, '../docs/assets/minigames/lyre-performance.html'), 'utf8'); // Same hosted engine used by players and ambient performances.
const host = fs.readFileSync(path.join(__dirname, '../docs/js/music-minigame.js'), 'utf8'); // Ensures gameplay fetches this revision rather than a stale iframe.
function extractFunction(name, isAsync = false) {
  const startText = `  ${isAsync ? 'async ' : ''}function ${name}(`;
  const start = engine.indexOf(startText);
  assert.ok(start >= 0, `Missing engine function ${name}`);
  const end = engine.indexOf('\n  }\n', start);
  assert.ok(end > start, `Missing closing brace for ${name}`);
  return engine.slice(start, end + '\n  }'.length);
}

const state = { // Mutable test transport: starts partway through a roll with an older note still held.
  pluckInputMode: 'arp-forward-8',
  pluckTimer: 99,
  pluckStep: 7,
  pluckGeneration: 4,
  pluckNextPulseAt: 750,
  pluckLegatoHandoffs: 0,
  autoReleaseTail: null,
  frettedSources: new Map(),
  noteSources: Array.from({length: 4}, () => new Set()),
  triggerGestures: new Map()
};
const originalFret = {noteIndex:0,modeOffset:0,pressedAt:200,beatStopAt:750}; // Existing sustained note used to verify stacked melody handoffs.
state.frettedSources.set('held-A',originalFret);
state.noteSources[0].add('held-A');
const attacks = []; // Captures actual immediate melody attacks for duplicate-input assertions.
const restarts = []; // Flags any destructive phase reset during an overlapping-note handoff.
const tails = []; // Records release tails without relying on real browser timers.
const sandbox = {
  state,
  PULSE_LOOKAHEAD_MS: 30,
  NOTE_GLYPHS: ['X','A','B','Y'],
  nowMs: () => 500,
  noteMidi: (index,offset) => 60 + index + offset,
  midiName: midi => String(midi),
  automaticPatternDefinition: () => ({kind:state.pluckInputMode === 'direct' ? 'direct' : 'arp'}),
  automaticTapTiming: () => ({beatAnchorAt:500,beatMs:500,errorMs:0}),
  currentModeOffset: () => 0,
  currentFretData: () => Array.from(state.frettedSources.values()).at(-1) || null,
  isFrettedPluckLayout: () => false,
  isLatchedAutoBankLayout: () => true,
  playImmediateAutomaticMelody: fret => { attacks.push(fret.noteIndex); },
  primeAutomaticMediaChannels: () => {}, // Input transport test stubs out mobile audio activation; the pool itself is tested below.
  pluckIntervalMs: () => 250, // A held-note handoff at 500ms already has its next eighth note due at 750ms.
  nextAutomaticSubdivisionAt: () => 750, // Restoring the normal queue should not be necessary for this on-grid tail.
  armAutomaticPulseAt: () => { throw new Error('The existing 750ms note must not be rescheduled'); },
  restartActiveFrettedPluck: () => { restarts.push(state.pluckStep); },
  triggerNote: () => {},
  releaseNote: (index, sourceId) => state.noteSources[index].delete(sourceId),
  beginAutoReleaseTail: (fret,sourceId) => { tails.push(sourceId); state.autoReleaseTail = {fret,stopAt:750}; return true; },
  updateLayoutControlUI: () => {},
  updatePitchLabels: () => {},
  updateDebugState: () => {},
  log: () => {},
  clearTimeout: () => {},
};
vm.runInNewContext(
  [extractFunction('retainFrettedPluckPulse'), extractFunction('holdAutomaticPluckNote')].join('\n') +
  '\nthis.hold = holdAutomaticPluckNote;',
  sandbox
);
sandbox.hold(1,'held-B',true,null);
assert.equal(attacks.length,1,'a new melody must attack immediately');
assert.equal(state.pluckTimer,99,'a second held melody must keep the existing pulse timer');
assert.equal(state.pluckGeneration,4,'a melody handoff must not invalidate the current pulse');
assert.equal(state.pluckStep,7,'a melody handoff must not restart the arpeggio figure');
assert.equal(state.pluckNextPulseAt,750,'a melody handoff must preserve its next grid time');
assert.equal(state.pluckLegatoHandoffs,1,'the legato handoff should be recorded for Mobile Debug');
assert.equal(restarts.length,0,'the previous roll must not be restarted');
sandbox.hold(1,'held-B',true,null);
assert.equal(attacks.length,1,'repeat keydown / repeated pointer-down must not create phantom attacks');
sandbox.hold(0,'held-A',false,null);
assert.equal(state.pluckLegatoHandoffs,1,'lifting a background fret must not touch the active roll');
sandbox.hold(1,'held-B',false,null);
assert.deepEqual(tails,['held-B'],'lifting the final fret should arm the usual release tail');
assert.equal(state.pluckTimer,99,'the release tail should retain the scheduled clock');
sandbox.hold(2,'held-C',true,null);
assert.equal(state.autoReleaseTail,null,'the new melody must turn an imminent tail cleanup into a sounding pulse');
assert.equal(state.pluckStep,7,'release-tail re-entry must keep its previous roll phase');
assert.equal(state.pluckGeneration,4,'release-tail re-entry must not invalidate the pulse');
assert.equal(state.pluckLegatoHandoffs,2,'the resumed beat fill should be visible in Mobile Debug');
assert.equal(restarts.length,0,'release-tail re-entry must not restart the pattern');

const emptyState = { ...state, frettedSources:new Map(), noteSources:Array.from({length:4},()=>new Set()), pluckTimer:null, pluckNextPulseAt:0, autoReleaseTail:null };
sandbox.state = emptyState;
sandbox.hold(0,'fresh',true,null);
assert.equal(restarts.length,1,'a fresh note without an existing pulse must still start the automatic pattern');

const previewTimers = []; // Captures scheduled successful-preview pulses to check their song-wide beat positions.
const previewNotes = []; // Captures which pitch each preview subdivision plays after a melody change.
const eventA = {noteIndex:0,modeOffset:0,time:0,state:'pending'};
const eventB = {noteIndex:1,modeOffset:0,time:1500,state:'pending'};
const previewState = {
  game:{demoMode:'arp-forward-8',quarterBeatMs:500,beatMs:500,countInMs:0,endAt:2400,events:[eventA,eventB],active:true,demoActive:true},
  demoGeneration:6, demoTimers:new Set(), paused:false,previewCounter:0
};
const preview = {
  state:previewState,
  FRETTED_PLUCK_MODES:{'arp-forward-8':{kind:'arp',division:2},direct:{kind:'direct',division:1}},
  demoAutomaticPattern:event => ({melodyMidi:60 + event.noteIndex * 10,fret:{noteIndex:event.noteIndex},steps:[0,1,2,3].map(offset => ({type:'note',midi:60 + event.noteIndex * 10 + offset,velocity:1})),label:'roll'}),
  automaticPatternSteps:(midi,fret) => ({steps:[0,1,2,3].map(offset => ({type:'note',midi:midi + offset,velocity:1})),label:'roll'}),
  gameTime: () => 0,
  setTimeout: (fn,delay) => {previewTimers.push({fn,delay});return previewTimers.length;},
  playAuditoryOnlyMidi: midi => {previewNotes.push(midi);},
  log:()=>{}
};
vm.runInNewContext(extractFunction('scheduleSuccessfulPreviewContinuation') + '\nthis.schedule = scheduleSuccessfulPreviewContinuation;',preview);
preview.schedule(eventA,0);
preview.schedule(eventB,1);
assert.deepEqual(previewTimers.map(timer => timer.delay),[250,500,750,1000,1250,1750,2000,2250],
  'preview rolls must occupy all subdivisions between melodies without an extra attack on the melody itself');
previewTimers.forEach(timer => timer.fn());
assert.deepEqual(previewNotes,[61,62,63,60,61,73,70,71],
  'after a melody transition the preview must keep its global roll phase instead of starting over');
previewState.game.demoMode = 'direct';
preview.schedule(eventA,0);
assert.equal(previewTimers.length,8,'Single Note must never acquire an automatic tail');

const frameSource = extractFunction('updateGameFrame');
assert.doesNotMatch(frameSource,/restartActiveFrettedPluck\(/,'harmony changes must not restart an existing arpeggio');
const pulseSource = extractFunction('playFrettedPluckPulse',true);
assert.match(pulseSource,/sharedTransportData\(pulseTarget\)[\s\S]*?automaticPatternSteps\(fretMidi,fret,state\.pluckInputMode,pulseClock\)/,
  'ahead-of-time arpeggios must voice the next pulse against its future harmony chord');
assert.ok(pulseSource.indexOf('state.pluckTimer = setTimeout') < pulseSource.indexOf('await playAuditoryOnlyMidi'),
  'the next timed pulse must be armed before asynchronous Web Audio initialization');
assert.match(engine,/if \(!usesAutomaticPluckInput\(\)\) interruptAutoReleaseTail\(/,
  'changing melody bank must not prematurely cancel the running automatic figure');
assert.match(host,/lyre-performance\.html\?v=[A-Za-z0-9_-]+/,
  'gameplay must use the revised instrument iframe cache key');

// Exercise the real tail timer scheduler: interrupted or missing timers must not silence the remaining beat.
let tailNow = 300; // Controlled transport timestamp used to reproduce a lost pulse timer and later re-entry.
const armedTailTimers = []; // Records the actual subdivision targets and deadlines without starting browser timers.
const tailState = {
  pluckInputMode:'arp-forward-8', pluckGeneration:6, pluckStep:7, pluckLegatoHandoffs:0,
  pluckTimer:null, pluckNextPulseAt:0, autoReleaseTail:null
};
const tailHarness = {
  state:tailState,
  nowMs:() => tailNow,
  PULSE_LOOKAHEAD_MS:90,
  pluckIntervalMs:() => 125,
  sharedTransportData:()=>({performanceElapsedMs:tailNow}),
  nextSharedBeatAt:()=>1000,
  automaticPulseTimerDelay:at => Math.max(0,at - tailNow - 90),
  setTimeout:(callback,delay) => {armedTailTimers.push({callback,delay});return armedTailTimers.length;},
  clearTimeout:() => {},
  playFrettedPluckPulse:()=>{},
  automaticPluckLabel:()=> 'Forward Roll',
  noteMidi:()=>60,
  midiName:()=> 'C4',
  refs:{transportStatus:{}},
  log:()=>{}
};
vm.runInNewContext([
  extractFunction('nextAutomaticSubdivisionAt'),
  extractFunction('armAutomaticPulseAt'),
  extractFunction('beginAutoReleaseTail'),
  extractFunction('retainFrettedPluckPulse')
].join('\n') + '\nthis.releaseTail = beginAutoReleaseTail; this.handoff = retainFrettedPluckPulse; this.arm = armAutomaticPulseAt;',tailHarness);
assert.ok(tailHarness.releaseTail({noteIndex:0,modeOffset:0,beatStopAt:1000},'test-source'));
assert.equal(tailState.pluckNextPulseAt,375,'missing tail timer must recover the next 125ms grid tick rather than wait silently until 1000ms');
assert.equal(armedTailTimers[0].delay,0,'WebAudio may schedule the recovered 375ms note immediately for precise playback');
assert.equal(tailState.pluckStep,7,'recovering a release tail must retain the current arpeggio step');

tailNow = 500;
tailState.pluckNextPulseAt = 1000; // Simulate an already-scheduled silent cleanup with no remaining attacks.
tailState.pluckTimer = 88;
assert.ok(tailHarness.handoff('new melody while cleanup is pending'));
assert.equal(tailState.autoReleaseTail,null,'the new melody must cancel the previous note’s release boundary');
assert.equal(tailState.pluckNextPulseAt,625,'a resumed roll must replace a stranded cleanup timer with the next beat subdivision');
assert.equal(tailState.pluckGeneration,6,'resuming the beat must not restart the arpeggio generation');
assert.equal(tailState.pluckStep,7,'resuming the beat must not rewind the pattern');
assert.equal(tailState.pluckLegatoHandoffs,1,'recovery must remain visible in Mobile Debug');

tailNow = 930;
tailState.pluckTimer = null;
tailState.pluckNextPulseAt = 0;
tailState.autoReleaseTail = {stopAt:1000};
tailHarness.arm(1000);
assert.equal(armedTailTimers.at(-1).delay,70,'a silent cleanup must remain available until the actual 1000ms boundary');
assert.equal(tailState.pluckNextPulseAt,1000,'a silent cleanup should never create an extra early note');

const compatibilityState = {
  sampleObjectUrl:'test-audio', playbackEngine:'compat',sampleImported:true,
  gestureMediaChannels:new Map(), autoPickCompatChannelIndex:0
}; // Fake mobile sampler, including the persistent voices that must not be rewound by each melody press.
const primedChannels = []; // Records which mobile voices require their first user-gesture authorization.
const compatibility = {
  state:compatibilityState, AUTO_PICK_COMPAT_VOICES:8,PULSE_LOOKAHEAD_MS:90,
  nowMs: () => 500,
  canUseCompatibilitySampler:() => compatibilityState.playbackEngine === 'compat',
  primeGestureMediaChannel:key => {
    primedChannels.push(key);
    compatibilityState.gestureMediaChannels.set(key,{sourceUrl:'test-audio',media:{paused:false}});
  }
};
vm.runInNewContext([
  extractFunction('primeAutomaticMediaChannels'),
  extractFunction('nextAutomaticMediaChannel'),
  extractFunction('automaticPulseTimerDelay')
].join('\n') + '\nthis.prime = primeAutomaticMediaChannels; this.nextChannel = nextAutomaticMediaChannel; this.timerDelay = automaticPulseTimerDelay;',compatibility);
compatibility.prime();
assert.equal(primedChannels.length,8,'a melody gesture should preauthorize all eight compatibility voices');
compatibility.prime();
assert.equal(primedChannels.length,8,'another melody must not rewind or re-prime already sounding media voices');
assert.equal(new Set(Array.from({length:8},() => compatibility.nextChannel())).size,8,
  'each of eight successive automatic attacks should get a different media channel');
assert.equal(compatibility.nextChannel(),'touch-left-fretted-pluck-0',
  'the prepared voice pool should wrap around rather than creating unbounded media nodes');
assert.equal(compatibility.timerDelay(750),250,'HTMLAudio fallback must fire on the actual subdivision, not 90ms early');
compatibilityState.playbackEngine = 'webAudio';
assert.equal(compatibility.timerDelay(750),160,'Web Audio must retain its existing 90ms sample-accurate lookahead');
assert.match(pulseSource,/nextAutomaticMediaChannel\(\)/,
  'automated notes and strums must use the rotating mobile media channels rather than one shared voice');
assert.match(engine,/primeAutomaticMediaChannels\(\); \/\/ The human note press authorizes the entire mobile polyphony pool/,
  'mobile notes should prepare polyphony within the next real human gesture');
console.log('Kurraya arpeggio legato regression checks passed.');
