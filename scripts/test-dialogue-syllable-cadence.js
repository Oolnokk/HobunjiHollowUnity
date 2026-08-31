#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const timers = [];
const window = {
  SCRATCHBONES_CONFIG: {
    game: {
      portrait: { breathing: { enabled: true }, yap: { flashMs: 120 } },
      npcDialogue: { text: { typewriter: { syllablesPerSecond: 6, punctuationPauseMs: 120 } } },
    },
  },
};
const context = {
  window,
  document: { readyState: 'loading', addEventListener() {} },
  fetch: async () => ({ ok: false }),
  setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
  clearTimeout() {},
  console,
  Date,
  Math,
  Object,
  Number,
  String,
  Map,
  Set,
  Array,
};
vm.createContext(context);
vm.runInContext(read('docs/js/portrait-breathing.js'), context);

const cadence = window.DialogueSpeechCadence;
const text = "Hello, Amo'i!";
const units = Array.from(cadence.buildUnits(text), unit => ({ ...unit }));
assert.equal(units.map(unit => unit.text).join(''), text, 'syllable chunks preserve the exact dialogue text');
assert.deepEqual(
  units.map(unit => unit.text),
  ['He', 'llo, ', 'A', 'mo', "'i!"],
  'one vowel and its surrounding consonants reveal as one visible chunk',
);
assert.equal(units.filter(unit => unit.vowel).length, 5, 'each written vowel creates exactly one cadence pulse');

const adjacentVowels = Array.from(cadence.buildUnits('Great'), unit => ({ ...unit }));
assert.deepEqual(adjacentVowels.map(unit => unit.text), ['Great'], 'a diphthong reveals as one spoken syllable');
assert.deepEqual(Array.from(adjacentVowels[0].vowels), ['e', 'a'], 'each written vowel inside that syllable remains a separate pulse');

const schedule = Array.from(cadence.buildSchedule('Go, now.', {
  syllablesPerSecond: 10,
  punctuationPauseMs: 200,
  whitespacePauseMs: 0,
}), unit => ({ ...unit }));
assert.deepEqual(schedule.map(unit => unit.revealAtMs), [100, 400], 'punctuation pauses are applied between whole-syllable reveals');

timers.length = 0;
window.portraitBreathingComposer.scheduleYapSequence('test-seat', text);
assert.equal(timers.length, 5, 'scheduled portrait yaps equal the written-vowel count');
assert.ok(Math.abs(timers[0].delay - 166.667) < 0.01, 'the first pulse follows the six-syllables-per-second cadence');
assert.ok(timers.every((timer, index) => index === 0 || timer.delay > timers[index - 1].delay), 'vowel yaps remain ordered across syllables');

timers.length = 0;
window.portraitBreathingComposer.scheduleYapSequence('test-seat', 'Great');
assert.equal(timers.length, 2, 'one revealed diphthong syllable still schedules one yap per vowel');
assert.ok(timers[1].delay > timers[0].delay, 'the diphthong vowel pulses are distributed inside one syllable interval');

const dialogueContent = read('docs/js/dialogue-content.js');
assert.match(dialogueContent, /_npcDialogueTextEl\.textContent \+= unit\.text/, 'NPC dialogue reveals a whole cadence unit per timer');
assert.match(dialogueContent, /_playNpcDialogueLetterSfx\(unit\.vowels\[index\]\)/, 'NPC dialogue plays exactly one tick for every vowel in a syllable');
assert.match(dialogueContent, /portraitBreathingComposer\?\.triggerYap/, 'the same vowel reveal directly triggers one mouth yap');
assert.doesNotMatch(dialogueContent, /while \(_npcDialogueTypeIndex < _npcDialogueTypeText\.length/, 'the regressed multi-character catch-up loop is removed');
assert.match(dialogueContent, /setTimeout\(\(\) => \{[\s\S]{0,260}_npcDialogueTextEl\.textContent \+= unit\.text[\s\S]{0,80}\}, unit\.revealAtMs\)/, 'each NPC syllable receives an independent deadline from the sequence start');
assert.doesNotMatch(dialogueContent, /nextUnit\.revealAtMs - unit\.revealAtMs/, 'NPC speech no longer chains the next delay from a late callback');

const ambientDialogue = read('docs/js/ambient-dialogue.js');
assert.match(ambientDialogue, /DialogueSpeechCadence\?\.buildSchedule/, 'ambient dialogue uses the shared syllable cadence');
assert.match(ambientDialogue, /DialogueContent\?\.playSpeechTick\?\.\(unit\.vowels\[index\]/, 'ambient dialogue ticks once for every vowel inside a revealed syllable');
assert.match(ambientDialogue, /portraitBreathingComposer\?\.triggerYap\(event\.seatId\)/, 'ambient chatheads yap on the same vowel reveal');
assert.match(ambientDialogue, /setTimeout\(\(\) => \{[\s\S]{0,220}visibleText \+= unit\.text[\s\S]{0,100}\}, unit\.revealAtMs\)/, 'ambient syllables use independent wall-clock timers instead of render-loop progress');
assert.doesNotMatch(ambientDialogue, /filter\(unit => unit\.revealAtMs <= elapsedMs\)/, 'ambient text reveal is no longer frame-loop driven');

const configText = read('docs/config/scratchbones-config.js');
assert.match(configText, /"npcDialogue"[\s\S]{0,500}"maxFps": 30/, 'dialogue portraits may sample the absolute yap clock at 30 FPS');

const index = read('docs/index.html');
assert.match(index, /portrait-breathing\.js\?v=20260831syllable4/);
assert.match(index, /dialogue-content\.js\?v=20260831syllable4/);
assert.match(index, /ambient-dialogue\.js\?v=20260831syllable4/);

console.log('Dialogue syllable cadence test passed');
