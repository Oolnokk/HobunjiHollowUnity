#!/usr/bin/env node
// Run: node scripts/test-humanoid-voice-age.js
// Exercises the production voice-phase resolver and checks the three playback entry points.
'use strict';
const fs = require('node:fs'); // Reads the shipped files so tests cannot silently diverge from runtime code.
const vm = require('node:vm'); // Runs the real voice planner without spawning the full Three.js game.
const assert = require('node:assert/strict'); // Fails loudly on age, identity, or playback regressions.
const read = path => fs.readFileSync(path, 'utf8'); // Shared source reader for runtime and integration checks.
const voiceSource = read('docs/js/combat/combat-vocalizations.js'); // Production voice planner exercised below.
const config = JSON.parse(read('docs/config/combat/combat-vocalizations.json')); // Authored global age offsets and species profiles.
const stages = new Map(); // Simulates saved family phase changes for the same persistent NPC ID.
const first = voiceSource.indexOf('  function appearanceForEntity('); // Start of the real voice identity/planning functions.
const last = voiceSource.indexOf('  function setPitchPreservation(', first); // End after the live voice planner, before unrelated audio routing.
assert(first >= 0 && last > first, 'voice planner extraction found the current production functions');
const windowStub = {
  RomanceFamily: { voiceAgePhase: id => stages.get(id) || null },
}; // Only the existing family API is mocked; pitch math is executed from production.
const context = {
  window: windowStub,
  config,
  AGE_PITCH_DEFAULTS: Object.freeze({ baby: 9, toddler: 6, child: 3 }),
  SKELETON_VOICE_SPECIES: new Set(['mao-ao-skeleton', 'harlyao-skeleton']),
  clamp: (value, lo, hi) => Math.max(lo, Math.min(hi, value)),
  player: () => null,
}; // Runtime-free dependencies required by the extracted production planner.
vm.runInNewContext(voiceSource.slice(first, last) +
  '\nwindow.voiceAgeTest = { voicePlaybackPlan, voiceAgePhase, agePitchOffsetForStage };', context);
const api = windowStub.voiceAgeTest; // Real runtime functions accessed through the test-only VM export.
const adult = { id: 'adult', rec: { id: 'adult', appearance: { speciesId: 'mao-ao', gender: 'male' } } }; // Adult baseline voice.
const growing = { id: 'family-1', rec: { id: 'family-1', isChild: true, appearance: { speciesId: 'mao-ao', gender: 'male' } } }; // Same identity through all saved age stages.
const pitch = actor => api.voicePlaybackPlan(0, actor).pitchSemitones; // Deterministic non-random comparison.

assert.equal(pitch(adult), 1, 'adults preserve their authored Mao-ao male pitch');
for (const [phase, expected] of [['baby', 10], ['toddler', 7], ['child', 4]]) {
  stages.set('family-1', phase);
  assert.equal(pitch(growing), expected, phase + ' adds its offset to the +1 species/gender voice');
  assert.equal(api.voiceAgePhase(growing), phase, 'age is retrieved from the authoritative saved family stage');
}
stages.delete('family-1');
assert.equal(pitch(growing), 4, 'legacy isChild records fall back to child pitch, not adult');
assert.equal(pitch({ id: 'toddler-legacy', rec: { id: 'toddler-legacy', ageBand: 'toddler', appearance: { speciesId: 'kenkari', gender: 'female' } } }), 14.5,
  'authored toddler ageBand works without RomanceFamily');
assert.equal(pitch({ id: 'infant-legacy', appearance: { speciesId: 'kenkari', gender: 'male' }, lifeStage: 'infant' }), 13,
  'standalone infant records retain their own species/gender pitch');
assert.equal(pitch({ id: 'loud', rec: { ageBand: 'baby', appearance: { speciesId: 'nuhongan', gender: 'female' } } }), 23,
  'age offset is additive even with a high female species pitch');
const loud = { id: 'max', rec: { ageBand: 'baby', appearance: { speciesId: 'nuhongan', gender: 'female' } } }; // Clamp only the final summed pitch.
assert.equal(api.voicePlaybackPlan(5, loud).pitchSemitones, 24, 'total pitch clamps once at the renderer maximum');
config.utteranceModulation.agePitchSemitones.toddler = -2;
assert.equal(pitch({ ageBand: 'toddler', appearance: { speciesId: 'mao-ao', gender: 'male' } }), -1,
  'live age-slider changes replace the default offset without changing the species');
delete config.utteranceModulation.agePitchSemitones;
assert.equal(pitch({ ageBand: 'toddler', appearance: { speciesId: 'mao-ao', gender: 'male' } }), 7,
  'old configs with no age map safely fall back to the three age defaults');
config.utteranceModulation.agePitchSemitones = { adult: 12, baby: null, toddler: '', child: 'invalid' };
assert.equal(pitch(adult), 1, 'an imported adult pitch key must never change an adult voice');
assert.equal(pitch({ ageBand: 'baby', appearance: { speciesId: 'mao-ao', gender: 'male' } }), 10,
  'null baby tuning uses the authored +9 default rather than becoming zero');
assert.equal(pitch({ ageBand: 'toddler', appearance: { speciesId: 'mao-ao', gender: 'male' } }), 7,
  'empty toddler tuning keeps +6 default');
assert.equal(pitch({ ageBand: 'child', appearance: { speciesId: 'mao-ao', gender: 'male' } }), 4,
  'invalid child tuning keeps +3 default');
assert.equal(pitch({ id: 'fallback-child', rec: { isChild: false, appearance: { speciesId: 'mao-ao', gender: 'male' } } }), 1,
  'a normal adult remains unshifted with no family or authored age stage');

const yawn = read('docs/js/npc-yawn-rest.js'); // VoiceFor remains a cached adult recording lookup.
const dialogue = read('docs/js/dialogue-content.js'); // Ordinary Talk and floating syllables share this audio owner.
const ambient = read('docs/js/ambient-dialogue.js'); // Floating family bubbles must pass the real speaker ID.
const family = read('docs/js/romance-family.js'); // Saved birthday and phaseOf are the only family age authority.
const editor = read('docs/tools/combat-vocalization-editor/index.html'); // Users can adjust all ages on mobile.
const loader = read('docs/js/combat/combat-config-loader.js'); // Runtime cache key must require the revised module.
assert.match(voiceSource, /getAgePitchOffset: \(entity, speakerId = null\)/, 'shared pitch accessor exists for non-combat voices');
assert.match(voiceSource, /mod\.pitchSemitones \+ agePitchSemitones \+ randomSemitones/, 'combat pitch includes age before final clamp');
assert.match(yawn, /const pitchSemitones = Math\.max\(-24, Math\.min\(24, plan\.pitch \+ agePitchSemitones\)\)/,
  'recorded and fallback yawns both include the age shift without affecting file lookup');
assert.match(yawn, /tempo: plan\.tempo, pitchSemitones, volume/, 'yawn renderer receives the age-adjusted pitch separately from tempo');
assert.match(dialogue, /getAgePitchOffset\?\.\(rec, speakerId\)/, 'dialogue sound uses the shared offset with a real speaker ID');
assert.match(dialogue, /osc\.frequency\.value = \(base \+ .*\) \* agePitchRatio/, 'synthetic dialogue ticks transpose oscillator frequency');
assert.match(dialogue, /snd\.preservesPitch = false/, 'recorded dialogue ticks actually transpose on pitch-preserving browsers');
assert.match(ambient, /playSpeechTick\?\.\(unit\.vowels\[index\], event\.profile, event\.speakerId\)/,
  'floating dialogue supplies the saved child speaker ID instead of relying on the portrait profile');
assert.match(family, /function voiceAgePhase\(npcId\)/, 'family exposes a narrow allocation-free age resolver');
assert.match(family, /return phase === 'basket' \? 'baby' : phase;/, 'basket-stage infants map to baby pitch');
assert.match(loader, /CombatVocalizations\?\.version\) >= 6/, 'game loader cannot reuse the previous voice planner from cache');
for (const stage of ['baby', 'toddler', 'child']) {
  assert.match(editor, new RegExp('id="' + stage + 'PitchSlider"'), stage + ' has a mobile slider');
  assert.match(editor, new RegExp('id="' + stage + 'PitchNumber"'), stage + ' has an editable numeric pitch field');
}
assert.match(editor, /id="previewAge"/, 'the existing sound audition can preview each age');
assert.match(editor, /function setAgePitch\(stage,value\)/, 'editor writes the exact age config consumed by runtime');
console.log('Humanoid age voice: species + stage + cache fallback + yawn + dialogue + mobile editor checks passed.');
