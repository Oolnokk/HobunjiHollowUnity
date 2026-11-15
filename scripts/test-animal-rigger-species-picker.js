'use strict';

const assert = require('node:assert/strict'); // Checks that late-registered livestock still appears in the painter.
const fs = require('node:fs'); // Reads actual painter code instead of a separate simulated picker.
const vm = require('node:vm'); // Executes just the authoring species-picker functions without a browser DOM.

const part1 = fs.readFileSync('docs/tools/animal-head-rig/author-part1.js', 'utf8'); // Runtime-only metadata and sprite fallback.
const part4 = fs.readFileSync('docs/tools/animal-head-rig/author-part4.js', 'utf8'); // Real supplemental-list builder.
const speciesMatch = part1.match(/^const RUNTIME_RIGGER_SPECIES=(.+); \/\/ Runtime-only species/m);
assert(speciesMatch, 'painter exposes the metadata for runtime-only species');
const speciesMetadata = vm.runInNewContext(speciesMatch[1]); // Evaluates the actual static frozen species record.

const start = part4.indexOf('function runtimeRiggerSupplements(repoRecords){');
const end = part4.indexOf('\nfunction applyRecord(record,index=-1)', start);
assert(start >= 0 && end > start, 'painter still has a runtime supplement builder');
const source = part4.slice(start, end); // The real painter code, evaluated in an isolated DOM-free VM.
const context = {
  RUNTIME_RIGGER_SPECIES: speciesMetadata,
  window: {
    CreatureGeneticsRender: { SPECIES: {} }, // Reproduces a painter opened before wildlife registration.
    HobunjiAuthoredAnimalHeadRigs: { get: kind => ({ origin: kind, shoulderRest: { frameShiftX: .46 } }) },
  },
  numberOr: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
  deepClone: value => JSON.parse(JSON.stringify(value)),
};
const supplementsFor = vm.runInNewContext(source + '\nruntimeRiggerSupplements', context); // Returns the genuine supplemental picker entries.
const baseBestiary = [
  { id: 'uumkaoii', modelWidth: 1.6, spriteAspect: .703588143525741, tint: '#ffffff' },
  { id: 'gar-wolf', modelWidth: 2.1, spriteAspect: .43636 },
];
const supplements = supplementsFor(baseBestiary);
const vorg = supplements.find(item => item.id === 'voorg-ass');
assert(vorg, 'Voorg-Ass must appear even when its renderer species is not registered');
assert.equal(vorg.label, 'Voorg-Ass');
assert.equal(vorg.modelWidth, 1.5, 'Voorg-Ass uses its own display width rather than Uumkao\'ii size');
assert.equal(vorg.spriteAspect, 1, 'initial aspect is resolved from the loaded actual sprite');
assert.equal(vorg.sprites.idle, 'assets/creaturesprites/voorg-ass_idle.png');
assert.deepEqual(Array.from(vorg.sprites.run), [
  'assets/creaturesprites/voorg-ass_run1.png',
  'assets/creaturesprites/voorg-ass_run2.png',
]);
assert.equal(vorg.headRig.origin, 'voorg-ass', 'painter reads its own previously authored rig');
assert.equal(vorg.headRig.shoulderRest.frameShiftX, .46, 'Voorg-Ass uses its newly uploaded independent shoulder pose');
assert(supplements.some(item => item.id === 'moot'), 'Moot retains its standalone picker entry');

context.window.CreatureGeneticsRender.SPECIES['voorg-ass'] = {
  base: { idle: 'assets/creaturesprites/voorg-ass_idle.png', run1: 'assets/creaturesprites/voorg-ass_run1.png', run2: 'assets/creaturesprites/voorg-ass_run2.png' },
};
assert.equal(supplementsFor(baseBestiary).filter(item => item.id === 'voorg-ass').length, 1,
  'registered and fallback pathways never duplicate Voorg-Ass');
assert.equal(supplementsFor([...baseBestiary, { id: 'voorg-ass' }]).filter(item => item.id === 'voorg-ass').length, 0,
  'a real bestiary record suppresses the supplemental duplicate');
console.log('animal head rigger species picker: Voorg-Ass is selectable before registration and picks up its latest authored rig');
