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
const utteranceIndex = JSON.parse(read('docs/assets/audio/sfx/utterances/index.json'));

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
assert.match(source, /clipTuning/, 'scheduler passes fixed global per-recording tuning');
assert.match(source, /clipTuning: \{ \.\.\.\(common\.clipTuning \|\| \{\}\) \}/, 'species cannot redefine a recording base tune');
assert.match(source, /sizePitchSemitones/, 'scheduler passes the global size pitch layer');
assert.match(playback, /UTTERANCE_BASE = 'assets\/audio\/sfx\/utterances\/'/, 'runtime selects from descriptive utterance library');
assert.match(playback, /LEGACY_SPECIES_DEFAULTS/, 'runtime preserves the old species sound choices when no allowlist is authored');
assert.match(playback, /normalizeLibraryName/, 'renamed old species files resolve to descriptive library filenames');
assert.match(playback, /clipTuningFor/, 'playback reads fixed per-recording tuning');
assert.match(playback, /clipTuning\.tempo \* utteranceTempo/, 'recording speed multiplies exact utterance tempo');
assert.match(playback, /clipTuning\.pitchSemitones \+ utterancePitch \+ sizePitch/, 'recording, utterance and global-size pitch add once');
assert.match(playback, /capturePreparedAnimalElement/, 'AudioSystem still owns range/falloff/preload and initial preparation');
assert.match(playback, /wsolaStretch/, 'constant renderer retains only minimum independent tempo/pitch compensation');

assert.equal(utteranceIndex.clips.length, 22, 'utterance manifest exposes all 22 uploaded sounds');
const indexedNames = new Set(utteranceIndex.clips.map(entry => entry.file));
for (const entry of utteranceIndex.clips) {
  assert.match(entry.file, /\.ogg$/i, `${entry.file} is an OGG utterance`);
  assert.ok(fs.existsSync(path.join(root, 'docs/assets/audio/sfx/utterances', entry.file)), `${entry.file} exists beside the index`);
}
for (const [legacy, replacement] of Object.entries(utteranceIndex.legacyAliases || {})) {
  assert.match(legacy, /\.ogg$/i);
  assert.ok(indexedNames.has(replacement), `${legacy} aliases an indexed descriptive sound`);
}
for (const [species, names] of Object.entries(utteranceIndex.legacySpeciesDefaults || {})) {
  assert.ok(names.length, `${species} retains at least one legacy default`);
  for (const name of names) assert.ok(indexedNames.has(name), `${species} default ${name} is indexed`);
}

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
    clipTuning: {
      'sfx_rattle-bark-rattle.ogg': { tempo: 0.9, pitchSemitones: -1.5 },
      'sfx_clicky_howl-bark.ogg': { tempo: 1.1, pitchSemitones: 0.5 },
    },
  },
  'gar-wolf': {
    // Deliberately bogus legacy species tuning: profileFor must ignore it now.
    clipTuning: {
      'sfx_rattle-bark-rattle.ogg': { tempo: 1.9, pitchSemitones: 9 },
    },
    chatter: {
      intervalMs: 180,
      utterances: [
        { tempo: 1.2, pitchSemitones: 2 },
        { tempo: 0.95, pitchSemitones: -1 },
      ],
      allowedClips: ['sfx_rattle-bark-rattle.ogg'],
    },
    warning: {
      intervalMs: 300,
      volume: 0.8,
      utterances: [
        { tempo: 1.05, pitchSemitones: 1 },
        { tempo: 0.9, pitchSemitones: -2 },
      ],
      allowedClips: ['sfx_rattle-bark-rattle.ogg', 'sfx_clicky_howl-bark.ogg'],
      textLines: ['Warning!'],
    },
    growl: {
      intervalMs: 0,
      utterances: [{ tempo: 0.7, pitchSemitones: -5 }],
      allowedClips: ['sfx_clicky_howl-bark.ogg'],
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
assert.equal(profile.clipTuning['sfx_rattle-bark-rattle.ogg'].tempo, 0.9, 'recording base speed comes from global clip tuning');
assert.equal(profile.clipTuning['sfx_rattle-bark-rattle.ogg'].pitchSemitones, -1.5, 'species-local base tuning cannot mutate the sound identity');

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
assert.deepEqual(Array.from(calls[0].allowedClips), ['sfx_rattle-bark-rattle.ogg', 'sfx_clicky_howl-bark.ogg']);
assert.equal(calls[0].clipTuning['sfx_clicky_howl-bark.ogg'].pitchSemitones, 0.5, 'global per-recording tuning travels with every utterance');
assert.equal(overheadText.at(-1)?.text, 'Den!', 'reason-specific discovery text remains synchronized to audible call');

const growler = creature('growler');
assert.equal(window.AnimalVocalizations.threatGrowl(growler, 'attack'), true);
const growl = rendered.find(entry => entry.id === 'growler');
assert.equal(growl.tempo, 0.7);
assert.equal(growl.pitchSemitones, -5);
assert.deepEqual(Array.from(growl.allowedClips), ['sfx_clicky_howl-bark.ogg']);
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

assert.match(simpleEditor, /UTTERANCE_INDEX_URL/);
assert.match(simpleEditor, /Global recording base tuning/);
assert.match(simpleEditor, /Base speed ×/);
assert.match(simpleEditor, /Base pitch \(st\)/);
assert.match(simpleEditor, /exact utterance tempo\/pitch/);
assert.match(simpleEditor, /data-utterance-field="tempo"/);
assert.match(simpleEditor, /data-utterance-field="pitchSemitones"/);
assert.match(simpleEditor, /Global size pitch · shared by every species/);
assert.match(simpleEditor, /data-call-clip=/, 'response cards choose allowed indexed recordings');
assert.match(simpleEditor, /Filter utterance library/, 'large sound library has a searchable experiment surface');
assert.doesNotMatch(simpleEditor, /frequency analysis|normalization|tempo min|tempo max|pitch min|pitch max|contour/i);

const gameSource = read('docs/game.js');
assert.match(gameSource, /AnimalVocalizations\?\.tickCreature\?\.\(c, dt\)/, 'hostile cadence still drives passive chatter');
assert.match(gameSource, /requestThreatGrowl:/, 'combat still requests semantic growl intent');
assert.match(gameSource, /setHeadAdditiveRotation\?\.\(vocalHeadNodDeg\)/, 'utterance nod remains an additive neck layer');

console.log('Indexed simple animal vocalization checks passed.');