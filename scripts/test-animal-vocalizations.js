#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('docs/js/animal-vocalizations.js');
const playback = read('docs/js/animal-voice-independent-playback.js');
const simpleEditor = read('docs/js/animal-voice-simple-editor.js');

assert.doesNotThrow(() => new vm.Script(source), 'animal vocal scheduler parses');
assert.doesNotThrow(() => new vm.Script(playback), 'fixed animal playback parses');
assert.doesNotThrow(() => new vm.Script(simpleEditor), 'simple animal voice editor parses');

for (const oldToken of ['tempoMin', 'tempoMax', 'pitchMinSemitones', 'pitchMaxSemitones', 'tempoContour', 'pitchContourSemitones']) {
  assert.doesNotMatch(source, new RegExp(oldToken), `scheduler does not use old ${oldToken} modulation`);
}
for (const oldToken of ['yinFrame', 'spectralCentroid', 'clipPitchByKey', 'setNormalizationProfiles', 'spliceTempoChannels', 'tempoBackend']) {
  assert.doesNotMatch(playback, new RegExp(oldToken), `playback does not retain old ${oldToken} path`);
}
assert.match(source, /utterances/, 'responses are explicit utterance lists');
assert.match(source, /clipTuning/, 'scheduler passes fixed per-recording tuning');
assert.match(source, /sizePitchSemitones/, 'scheduler passes the global size pitch layer');
assert.match(playback, /clipTuningFor/, 'playback reads fixed per-recording tuning');
assert.match(playback, /clipTuning\.tempo \* utteranceTempo/, 'recording speed multiplies exact utterance tempo');
assert.match(playback, /clipTuning\.pitchSemitones \+ utterancePitch \+ sizePitch/, 'recording, utterance and global-size pitch add once');
assert.match(playback, /capturePreparedAnimalElement/, 'AudioSystem still owns range/falloff/preload and initial clip preparation');
assert.match(playback, /wsolaStretch/, 'constant renderer retains only the minimum independent tempo/pitch compensation');

const overheadText = [];
const window = {
  AmbientDialogue: {
    show: (rootObject, text, opts) => { overheadText.push({ rootObject, text, opts }); return {}; },
  },
};
vm.runInNewContext(source, { window, Math, Date }, { filename: 'animal-vocalizations.js' });

let clock = 0;
let autoStart = true;
const pendingStarts = [];
const rendered = [];
window.AnimalVocalizations.init({
  random: () => 0.5,
  hasVoice: c => c.creatureKey !== 'unsupported',
  renderUtterance: (c, opts) => {
    rendered.push({ at: clock, id: c.id, ...opts });
    if (autoStart) opts.onStarted();
    else pendingStarts.push(opts.onStarted);
    return true;
  },
});

function creature(id, creatureKey = 'gar-wolf', sizeClass = 'medium') {
  return {
    id,
    creatureKey,
    health: 10,
    state: 'idle',
    genotype: { sizeClass },
    avatarRef: { group: { id: `${id}-group` } },
  };
}
function tick(c, seconds, opts) {
  clock += seconds;
  window.AnimalVocalizations.tickCreature(c, seconds, opts);
}

window.AnimalVocalizations.setAuthoredProfiles({
  default: {
    sizePitchSemitones: { small: 3, medium: 0, large: -4 },
  },
  'gar-wolf': {
    clipTuning: {
      'sfx_gar-wolf1.ogg': { tempo: 0.9, pitchSemitones: -1.5 },
      'sfx_gar-wolf2.ogg': { tempo: 1.1, pitchSemitones: 0.5 },
    },
    chatter: {
      intervalMs: 180,
      utterances: [
        { tempo: 1.2, pitchSemitones: 2 },
        { tempo: 0.95, pitchSemitones: -1 },
      ],
      allowedClips: ['sfx_gar-wolf1.ogg'],
    },
    warning: {
      intervalMs: 300,
      volume: 0.8,
      utterances: [
        { tempo: 1.05, pitchSemitones: 1 },
        { tempo: 0.9, pitchSemitones: -2 },
      ],
      allowedClips: ['sfx_gar-wolf1.ogg', 'sfx_gar-wolf2.ogg'],
      textLines: ['Warning!'],
    },
    growl: {
      intervalMs: 0,
      utterances: [{ tempo: 0.7, pitchSemitones: -5 }],
      allowedClips: ['sfx_gar-wolf2.ogg'],
    },
    discoveryText: { 'animal-den': ['Den!'] },
  },
});

const profile = window.AnimalVocalizations.profileForDebug(creature('profile'));
assert.deepEqual(Array.from(profile.warning.utterances, u => ({ ...u })), [
  { tempo: 1.05, pitchSemitones: 1 },
  { tempo: 0.9, pitchSemitones: -2 },
]);
assert.deepEqual({ ...profile.sizePitchSemitones }, { small: 3, medium: 0, large: -4 }, 'size map comes only from global default');
assert.equal(profile.clipTuning['sfx_gar-wolf1.ogg'].tempo, 0.9, 'recording owns one fixed base speed');

const large = creature('large', 'gar-wolf', 'large');
const start = clock;
assert.equal(window.AnimalVocalizations.companionDiscovery(large, 'animal-den'), true);
tick(large, 0.3);
const calls = rendered.filter(entry => entry.id === 'large');
assert.equal(calls.length, 2, 'explicit warning utterance list determines beat count');
assert.deepEqual(calls.map(entry => Number((entry.at - start).toFixed(2))), [0, 0.3], 'one shared response gap determines cadence');
assert.deepEqual(calls.map(entry => entry.tempo), [1.05, 0.9], 'each utterance has exact authored tempo');
assert.deepEqual(calls.map(entry => entry.pitchSemitones), [1, -2], 'each utterance has exact authored pitch before size');
assert.ok(calls.every(entry => entry.sizePitchSemitones === -4), 'global Large pitch is threaded separately to playback');
assert.deepEqual(Array.from(calls[0].allowedClips), ['sfx_gar-wolf1.ogg', 'sfx_gar-wolf2.ogg']);
assert.equal(calls[0].clipTuning['sfx_gar-wolf2.ogg'].pitchSemitones, 0.5, 'per-recording tuning travels with every utterance');
assert.equal(overheadText.at(-1)?.text, 'Den!', 'reason-specific discovery text remains synchronized to audible call');

const growler = creature('growler');
assert.equal(window.AnimalVocalizations.threatGrowl(growler, 'attack'), true);
const growl = rendered.find(entry => entry.id === 'growler');
assert.equal(growl.tempo, 0.7);
assert.equal(growl.pitchSemitones, -5);
assert.deepEqual(Array.from(growl.allowedClips), ['sfx_gar-wolf2.ogg']);
assert.equal(window.AnimalVocalizations.scalePulse(growler), 1);
tick(growler, 0.045, { threatened: true });
assert.ok(window.AnimalVocalizations.headNodOffsetDeg(growler) < 0, 'audible utterance still drives additive upward nod');

const delayed = creature('delayed');
autoStart = false;
assert.equal(window.AnimalVocalizations.threatGrowl(delayed, 'mobile-buffer-test'), true);
tick(delayed, 0.09, { threatened: true });
assert.equal(window.AnimalVocalizations.headNodOffsetDeg(delayed), 0, 'nod waits for actual audio start');
assert.equal(pendingStarts.length, 1);
pendingStarts.shift()();
tick(delayed, 0.045, { threatened: true });
assert.ok(window.AnimalVocalizations.headNodOffsetDeg(delayed) < 0);
autoStart = true;

const prioritized = creature('priority');
assert.equal(window.AnimalVocalizations.warning(prioritized, 'territorial-boundary'), true);
assert.equal(window.AnimalVocalizations.threatGrowl(prioritized, 'attack'), false, 'growl still cannot interrupt higher-priority warning');
assert.equal(window.AnimalVocalizations.companionDiscovery(creature('none', 'unsupported'), 'treasure'), false);

assert.match(simpleEditor, /Recording base tuning/);
assert.match(simpleEditor, /Base speed ×/);
assert.match(simpleEditor, /Base pitch \(st\)/);
assert.match(simpleEditor, /Each vocal beat below has one exact tempo and pitch/);
assert.match(simpleEditor, /data-utterance-field="tempo"/);
assert.match(simpleEditor, /data-utterance-field="pitchSemitones"/);
assert.match(simpleEditor, /Global size pitch · shared by every species/);
assert.match(simpleEditor, /data-call-clip=/, 'response cards choose allowed source recordings');
assert.doesNotMatch(simpleEditor, /frequency analysis|normalization|tempo min|tempo max|pitch min|pitch max|contour/i);

const gameSource = read('docs/game.js');
assert.match(gameSource, /AnimalVocalizations\?\.tickCreature\?\.\(c, dt\)/, 'hostile cadence still drives passive chatter');
assert.match(gameSource, /requestThreatGrowl:/, 'combat still requests semantic growl intent');
assert.match(gameSource, /setHeadAdditiveRotation\?\.\(vocalHeadNodDeg\)/, 'utterance nod remains an additive neck layer');

console.log('Simple animal vocalization checks passed.');
