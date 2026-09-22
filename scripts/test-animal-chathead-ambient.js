#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-vocalizations.js', 'utf8');
assert.doesNotThrow(() => new vm.Script(source), 'animal vocalization module parses after chathead wiring');

const shown = [];
const window = {
  AmbientDialogue: {
    show(root, text, opts) {
      shown.push({ root, text, opts });
      return {};
    },
  },
};
vm.runInNewContext(source, { window, Math, Date }, { filename: 'animal-vocalizations.js' });

window.AnimalVocalizations.init({
  random: () => 0,
  hasVoice: () => true,
  renderUtterance: (_creature, opts) => {
    opts.onStarted?.();
    return true;
  },
});
window.AnimalVocalizations.setAuthoredProfiles({
  default: {},
  grehlr: {
    warning: {
      intervalMs: 0,
      utterances: [{ tempo: 1, pitchSemitones: 0 }],
      textLines: ['Snrrk!'],
      textDurationMs: 1800,
    },
  },
});

const creature = {
  id: 'grehlr-wild-den-mother-17',
  creatureKey: 'grehlr-wild-den-mother',
  health: 10,
  genotype: { sizeClass: 'large', base: { color: '#aa8877' } },
  avatarRef: { group: { name: 'grehlr-root' } },
};
assert.equal(window.AnimalVocalizations.warning(creature, 'territorial-boundary'), true, 'warning request starts');
assert.equal(shown.length, 1, 'first audible utterance creates one ambient dialogue event');
const event = shown[0];
assert.equal(event.text, 'Snrrk!');
assert.equal(event.opts.mode, 'chathead', 'voiced animal text uses chathead mode');
assert.equal(event.opts.profile.chatheadCreatureKind, 'grehlr', 'den-mother variant inherits base Grehlr authored framing');
assert.equal(event.opts.profile.creatureGenotype.sizeClass, 'large', 'genotype is preserved for composed chathead art');
assert.equal(event.opts.profile.creatureGenotype.base.color, '#aa8877', 'genotype coloration reaches the shared renderer unchanged');
assert.equal(event.opts.tone, 'animal');

const ambientSource = fs.readFileSync('docs/js/ambient-dialogue.js', 'utf8');
assert.match(ambientSource, /function liveAnimalChatheadSource\(root\)/, 'ambient animal chatheads must reuse the already-rendered world texture');
assert.match(ambientSource, /event\.headPart\.staticAnimalRendered = true/, 'animal ambient portraits must become one-shot after their first render');
assert.match(ambientSource, /animalChatheadSkippedFrames/, 'skipped former portrait-FPS refreshes must remain visible in diagnostics');
assert.match(ambientSource, /profileFacesSpeechTarget\(profile\)/, 'ambient dialogue must honor authored no-face speech posture');
assert.match(ambientSource, /dialogueFacePlayer !== false/, 'the no-face posture flag must be checked before ambient facing updates');
assert.match(ambientSource, /chatheadRenderSource = 'live-animal-texture'/, 'live-texture fast path must identify itself for debugging');
assert.match(ambientSource, /PERMANENTLY_DISABLED_SPEAKERS = new Set\(\['banubu'\]\)/, 'Banubu must remain permanently excluded from ambient dialogue');
assert.match(ambientSource, /isSpeakerEnabled\(options\.speakerId, options\.profile\)/, 'ambient rendering must reject disabled speakers before creating a bubble');
const speciesOverrides = JSON.parse(fs.readFileSync('docs/config/npcs/species-overrides.json', 'utf8'));
assert.strictEqual(speciesOverrides.npcs.banubu.avatarExport.appearance.ambientDialogueEnabled, false, 'Banubu appearance records the ambient-dialogue opt-out');
console.log('animal ambient chathead wiring tests passed');
