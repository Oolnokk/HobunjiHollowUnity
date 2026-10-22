#!/usr/bin/env node
'use strict';

// Regression coverage for hidden NPC Kurraya performance selection and measure-root timing.
// Run with: node scripts/run-tests.js npc-kurraya-measure-roots
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../docs/assets/minigames/lyre-performance.html'), 'utf8');
const host = fs.readFileSync(path.join(__dirname, '../docs/js/music-minigame.js'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(scripts.length, 2, 'Kurraya should retain its app and hosted bridge scripts');
scripts.forEach((script, index) => new vm.Script(script, {filename: 'lyre-performance-inline-' + index + '.js'}));

function section(start, end) {
  const from = scripts[0].indexOf(start); // Finds the actual production implementation, not a separate test copy.
  const to = scripts[0].indexOf(end, from + start.length); // Bounds isolated evaluation before the next declaration.
  assert.ok(from >= 0 && to > from, 'Missing or reordered music function: ' + start);
  return scripts[0].slice(from, to);
}

const patterns = section('  const NPC_AUTO_PICK_PATTERNS', '  const DEFAULT_AUTO_PICK_SLOTS');
const library = {
  direct: {kind:'direct'},
  'tremolo-16': {kind:'tremolo'},
  'tremolo-burst-16': {kind:'tremolo'},
  'arp-forward-8': {kind:'arp'},
  'arp-reverse-8': {kind:'arp'},
  'strum-reggae-8': {kind:'strum'},
};
for (let i = 0; i <= 100; i++) {
  const selected = vm.runInNewContext(patterns + '\nrandomNpcAutoPickPattern();', {
    AUTO_PICK_PATTERN_LIBRARY: library,
    Math: {random: () => i / 101, floor: Math.floor},
  });
  assert.ok(['arp','strum'].includes(library[selected]?.kind), 'NPC picked forbidden pattern: ' + selected);
}
const backupStart = section('    async startBackupPreviewSong(songId)', '    // Ambient NPC performance'); // Backup audio represents the NPC lead, not the human's own picking pattern.
assert.match(backupStart, /const mode = randomNpcAutoPickPattern\(\)/,
  'The audible NPC lead must never revert to the player Single Note/tremolo mode while the player joins');
assert.match(backupStart, /state\.rootPadEnabled = true/,
  'Replacing an NPC frame with the visible backup must preserve the NPC root accompaniment');
const ambientStart = section('    async startAmbientLead(songId, footstepSampleUrl)', '    setBackupPlayerEquipped(equipped)');
assert.match(ambientStart, /const mode = randomNpcAutoPickPattern\(\)/, 'NPC start must choose an NPC-only pattern');
assert.match(scripts[0], /state\.ambientOnly\s*\?\s*randomNpcAutoPickPattern\(\)/, 'NPC loops must reselect from allowed patterns');

const rootKeyFn = section('  function rootPadAudioKey(', '  function currentHarmonyData(');
const rootPadState = {rootPadSampleBuffer:null}; // Switches between transient plucked roots and sustained imported-pad behavior.
const rootKey = vm.runInNewContext(rootKeyFn + '\nrootPadAudioKey;', {
  state: rootPadState,
  currentHarmonyStep: clock => clock.chordStep,
});
const atBar = (measure, chordStep) => ({mixedPhase:{absoluteChord:measure}, chordStep, meter:{numerator:3}, performanceMeterBeatFloat:measure * 3});
assert.equal(rootKey(atBar(7, 2)), 'pluck:7:2');
assert.equal(rootKey(atBar(8, 2)), 'pluck:8:2', 'Repeated chord must get a new root pluck every bar');
assert.equal(rootKey(atBar(8, 3)), 'pluck:8:3', 'Mid-measure chord changes must remain distinguishable');
assert.equal(rootKey({mixedPhase:null, meter:{numerator:4}, performanceMeterBeatFloat:12, chordStep:1}), 'pluck:3:1');
rootPadState.rootPadSampleBuffer = {};
assert.equal(rootKey(atBar(7, 2)), 'chord:2');
assert.equal(rootKey(atBar(8, 2)), 'chord:2', 'Imported pad must not be restarted merely for a repeated measure');
assert.equal(rootKey(atBar(8, 3)), 'chord:3', 'Imported pad must respond to chord changes');

const schedulerFn = section('  function scheduleTransportAudioAhead()', '  function restartCssAnimation(');
const schedulerState = {
  paused:false,
  audioContext:{state:'running'},
  master:{},
  rootPadEnabled:true,
  scheduledMetronomeBeat:null,
  scheduledRootPadKey:null,
  rootPadSampleBuffer:null,
};
let queued = 0; // Counts successful pad scheduling; prevents duplicate submissions inside the lookahead window.
const scheduleAudio = vm.runInNewContext(schedulerFn + '\nscheduleTransportAudioAhead;', {
  state:schedulerState,
  document:{hidden:false},
  rootPadAudioKey:rootKey,
  findUpcomingTransportBoundary: callback => callback === rootKey ? {value:'pluck:8:2',atMs:1234,clock:atBar(8, 2)} : null,
  syncRootPad: (force, whenMs) => {
    assert.equal(force, true);
    assert.equal(whenMs, 1234);
    queued++;
    return true;
  },
});
scheduleAudio();
scheduleAudio();
assert.equal(queued, 1, 'One lookahead root voice per measure, not one per frame');
assert.equal(schedulerState.scheduledRootPadKey, 'pluck:8:2');

const syncSource = section('  function syncRootPad(', '  function bankFooterMarkup('); // Actual root-pad function under review.
assert.equal((syncSource.match(/state\.lastRootPadKey = rootPadAudioKey\(targetClock\)/g) || []).length, 2,
  'Immediate root creation and live-root reuse must mark the bar as handled');
assert.match(syncSource, /if \(!Number\.isFinite\(whenMs\)\) state\.lastRootPadKey/,
  'Scheduled future roots must not consume the current measure');
const played = []; // Records actual root voices created by the production sync function under a fake AudioContext.
const live = {rootPadEnabled:true,paused:false,audioContext:{state:'running'},master:{},
  rootPadSampleBuffer:null,rootPadVoices:[],rootPadRootMidi:null,lastRootPadKey:null,rootPadLevel:.02};
const playRoot = vm.runInNewContext(syncSource + '\nsyncRootPad;', {
  state:live,document:{hidden:false},sharedTransportData:() => atBar(0,2),
  rootPadAudioKey:rootKey,rootPadTargetMidi:() => 40,PAD_SYNTH_CROSSFADE_S:.8,
  createRootPadVoice:midi => {
    const voice = {midi,kind:'kurraya',active:true,stopping:false}; // Tracks each mock root attack through normal root voice bookkeeping.
    live.rootPadVoices.push(voice); played.push(midi); return voice;
  },
  fadeOutRootPadVoice:voice => { voice.stopping = true; },
  midiName:() => 'E2',log:() => {},
});
assert.equal(playRoot(true,null,atBar(8,2)),true);
assert.equal(live.lastRootPadKey,'pluck:8:2');
assert.equal(playRoot(true,null,atBar(9,2)),true);
assert.deepEqual(played,[40,40], 'Even an unchanged chord gets one new root attack at the next measure');
assert.equal(live.lastRootPadKey,'pluck:9:2');
assert.equal(playRoot(true,1234,atBar(10,2)),true);
assert.equal(live.lastRootPadKey,'pluck:9:2', 'Lookahead must not mark the future measure as already reached');

assert.match(scripts[0], /state\.rootPadRootMidi === targetMidi && liveVoices\.some\(voice => voice\.kind === desiredKind\)/,
  'An ended pluck must not be mistaken for an active root voice');
assert.match(host, /lyre-performance\.html\?v=[A-Za-z0-9_-]+/,
  'Host iframe cache key must change when the embedded engine changes');
const lab = fs.readFileSync(path.join(__dirname, '../docs/tools/kurraya-music-lab/index.html'), 'utf8'); // Ensures both music frontends run the same shipped engine revision.
const engineVersionPattern = /lyre-performance\.html\?v=([A-Za-z0-9_-]+)/; // Extracts cache identity without pinning a particular commit's token.
const gameplayEngineVersion = host.match(engineVersionPattern)?.[1]; // Game iframe revision checked against Music Lab below.
const labEngineVersion = lab.match(engineVersionPattern)?.[1]; // Audition iframe must not serve an earlier root/pattern engine.
assert.ok(gameplayEngineVersion, 'Gameplay Kurraya engine must carry a cache token');
assert.equal(labEngineVersion,gameplayEngineVersion,'Music Lab and gameplay must load the same versioned Kurraya engine');
console.log('NPC patterns, repeat-bar roots, imported-pad sustain, audio lookahead, and script syntax OK');
