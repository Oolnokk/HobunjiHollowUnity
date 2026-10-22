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
assert.equal((syncSource.match(/state\\.lastRootPadKey = rootPadAudioKey\\(targetClock\\)/g) || []).length, 2,
  'Immediate root creation and live-root reuse must mark the bar as handled');
assert.match(syncSource, /if \\(!Number\\.isFinite\\(whenMs\\)\\) state\\.lastRootPadKey/,
  'Scheduled future roots must not consume the current measure');
assert.match(scripts[0], /state\.rootPadRootMidi === targetMidi && liveVoices\.some\(voice => voice\.kind === desiredKind\)/,
  'An ended pluck must not be mistaken for an active root voice');
assert.match(host, /lyre-performance\.html\?v=[A-Za-z0-9_-]+/,
  'Host iframe cache key must change when the embedded engine changes');
console.log('NPC patterns, repeat-bar roots, imported-pad sustain, audio lookahead, and script syntax OK');
