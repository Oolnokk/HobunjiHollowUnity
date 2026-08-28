#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hub = read('docs/tools/index.html');
const editor = read('docs/tools/ambient-dialogue-editor/index.html');
const simpleVoiceEditor = read('docs/js/animal-voice-simple-editor.js');
const runtime = read('docs/js/ambient-dialogue.js');
const vocalRuntime = read('docs/js/animal-vocalizations.js');
const playback = read('docs/js/animal-voice-independent-playback.js');
const config = JSON.parse(read('docs/config/dialogue/ambient-dialogue.json'));

assert.doesNotThrow(() => new vm.Script(runtime), 'ambient dialogue runtime parses');
assert.doesNotThrow(() => new vm.Script(vocalRuntime), 'animal vocal runtime parses');
assert.doesNotThrow(() => new vm.Script(playback), 'fixed animal playback parses');
assert.doesNotThrow(() => new vm.Script(simpleVoiceEditor), 'simple animal voice editor parses');
assert(hub.includes('ambient-dialogue-editor/index.html'), 'tool hub links Ambient Dialogue editor');
assert(editor.includes('Greeting pool'), 'base editor still exposes NPC greeting settings');
assert(editor.includes('Audience reactions'), 'base editor still exposes crowd reactions');
assert(editor.includes('Nickname this NPC uses'), 'directional NPC nicknames remain authorable');
assert(editor.includes('ambient-dialogue.json'), 'editor imports/exports the shared runtime config');
assert(editor.includes('animal-voice-independent-playback.js'), 'animal editor loads the fixed voice playback helper');
assert.doesNotMatch(editor, /tempoMin|tempoMax|pitchMinSemitones|pitchMaxSemitones|tempoContour|pitchContourSemitones|frequency analysis|normalization/i, 'base editor no longer contains the dead modulation UI');

assert.match(simpleVoiceEditor, /Simple voice model:/, 'Animals tab is replaced by simple fixed voice model');
assert.match(simpleVoiceEditor, /Recording base tuning/, 'each source sound gets fixed base tuning');
assert.match(simpleVoiceEditor, /Base speed ×/, 'recording base speed is authorable');
assert.match(simpleVoiceEditor, /Base pitch \(st\)/, 'recording base pitch is authorable');
assert.match(simpleVoiceEditor, /Global size pitch · shared by every species/, 'one global Small/Medium/Large pitch map is authorable');
assert.match(simpleVoiceEditor, /Passive chatter/);
assert.match(simpleVoiceEditor, /Warning \/ discovery/);
assert.match(simpleVoiceEditor, /Threat growl/);
assert.match(simpleVoiceEditor, /Pick which recordings this response may use/, 'response-specific source selection remains authorable');
assert.match(simpleVoiceEditor, /data-utterance-field="tempo"/, 'each utterance has exact tempo');
assert.match(simpleVoiceEditor, /data-utterance-field="pitchSemitones"/, 'each utterance has exact pitch');
assert.match(simpleVoiceEditor, /Add utterance/, 'response length is explicit instead of randomized repeat modulation');
assert.match(simpleVoiceEditor, /Discovery announcements/, 'treasure/den/camp text authoring remains available');
assert.doesNotMatch(simpleVoiceEditor, /frequency analysis|normalization|contour|tempo min|tempo max|pitch min|pitch max/i, 'old modulation/analyzer controls are gone');

assert.match(vocalRuntime, /utterances/, 'runtime consumes explicit fixed utterance lists');
assert.match(vocalRuntime, /clipTuning/, 'runtime threads per-recording fixed tuning');
assert.match(vocalRuntime, /globalSizePitchMap/, 'runtime has one global size-pitch source');
assert.doesNotMatch(vocalRuntime, /tempoMin|tempoMax|pitchMinSemitones|pitchMaxSemitones|tempoContour|pitchContourSemitones/, 'runtime no longer interprets modulation ranges/curves');
assert.match(playback, /clipTuning\.tempo \* utteranceTempo/, 'playback combines base recording speed with exact utterance tempo');
assert.match(playback, /clipTuning\.pitchSemitones \+ utterancePitch \+ sizePitch/, 'playback combines only the three requested pitch layers');
assert.doesNotMatch(playback, /yinFrame|spectralCentroid|setNormalizationProfiles|spliceTempoChannels/, 'analysis/normalization/splice modulation code is removed');

const animalConfigText = JSON.stringify(config.animalVocalizations || {});
assert.doesNotMatch(animalConfigText, /tempoMin|tempoMax|pitchMinSemitones|pitchMaxSemitones|tempoContour|pitchContourSemitones/, 'saved config contains only fixed tuning');
assert.deepEqual(config.animalVocalizations?.default?.sizePitchSemitones, { small: 2.5, medium: 0, large: -2.5 }, 'size-class pitch is one global map');
assert.equal(config.animalVocalizations?.drenkirra?.clipTuning?.['sfx_drenkirra1.ogg']?.tempo, 1, 'Drenkirra recording base speed is explicit');
assert.ok(Array.isArray(config.animalVocalizations?.drenkirra?.warning?.utterances), 'Drenkirra warning has explicit utterance rows');
assert.ok(Array.isArray(config.animalVocalizations?.grehlr?.growl?.utterances), 'Grehlr growl has explicit utterance rows');

assert(runtime.includes('npcGreetings'), 'runtime consumes per-NPC greeting pools');
assert(runtime.includes('npcNicknames'), 'runtime consumes directional NPC nicknames');
assert(runtime.includes('firstNameWord'), 'NPC target-name fallback remains');
assert(runtime.includes('ConditionRegistry.pickBestEntry'), 'ambient nickname conditions still use main dialogue selector');
assert(runtime.includes('getWeekDay'), 'runtime resolves {weekDay} through calendar');
assert(runtime.includes('getDayPart'), 'runtime resolves {dayPart} through clock');
assert(Object.keys(config.npcGreetings || {}).length, 'sample NPC greeting data exists');
assert(Object.keys(config.companionTreasureLines || {}).length, 'sample animal treasure text exists');

const nick = config.npcNicknames || {};
assert.equal(nick.sloomi?.kzubug, 'Dad');
assert.equal(nick.nashka_khibu?.dzahiri_khibu, 'Mom');
assert.equal(nick.nashka_khibu?.dzibim_khibu, 'Dad');
assert.equal(nick.nashka_khibu?.kaboku_kunji, 'Grandpa');
assert.equal(nick.spearhead_unumanuk?.teacup_unumanuk, 'Mother');
assert.equal(nick.oddclaw_unumanuk?.spearhead_unumanuk, 'Father');
assert.equal(nick.oddclaw_unumanuk?.teacup_unumanuk, 'Grandmother');
assert.equal(nick.aliri_ginju?.gikali_ginju, 'Mama');
assert.equal(nick.aliri_ginju?.gorobi_ginju, 'Papa');
assert.equal(nick.gantami_ginju?.gikali_ginju, 'Mama');
assert.equal(nick.gantami_ginju?.gorobi_ginju, 'Papa');
assert.equal(nick.takua_ao_hakaru?.namui_u_hakaru, 'Sis');
assert.equal(nick.namui_u_hakaru?.takua_ao_hakaru, 'Tak');

console.log('Ambient Dialogue editor and simple animal voice checks passed.');
