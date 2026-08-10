#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { console, Math }; // Supplies the browser-style globals used by the genetics module.
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/creature-genetics.js', 'utf8'), context);

const creatureDb = { // Supplies default sizes used by legacy and trait-summary fallbacks.
  'dabinggi-hound': { label: 'Dabinggi-hound', defaultSizeClass: 'medium' },
  'gar-wolf': { label: 'Gar-wolf', defaultSizeClass: 'medium' },
  grehlr: { label: 'Grehlr', defaultSizeClass: 'large' },
  drenkirra: { label: 'Drenkirra', defaultSizeClass: 'small' },
  uumkaoii: { label: "Uumkao'ii", defaultSizeClass: 'large' },
};
context.CreatureGenetics.init({ creatureDb, CREATURE_DB: creatureDb, clamp: (value, min, max) => Math.max(min, Math.min(max, value)) });

assert.deepEqual(
  { ...context.CreatureGenetics.creatureSizeScale('dabinggi-hound', 'large') },
  { sizeClass: 'large', x: 2, y: 2 },
  'gameplay consumes the Animation Author large-hound scale',
);
assert.deepEqual(
  { ...context.CreatureGenetics.creatureSizeScale('drenkirra', { sizeClass: 'medium' }) },
  { sizeClass: 'medium', x: 2, y: 2 },
  'genotype objects select the authored Drenkirra class scale',
);
assert.deepEqual(
  { ...context.CreatureGenetics.creatureSizeScale('unknown-creature', 'small') },
  { sizeClass: 'small', x: 1, y: 1 },
  'missing rig profiles fail safely at visible base scale',
);

const houndTraits = context.CreatureGenetics.genotypeTraits('dabinggi-hound', { // Exercises visible and hidden pattern presentation.
  sizeClass: 'large',
  base: { color: '#996515', copies: 2, inheritance: 'dominant' },
  mitts: { color: '#e5d3b3', copies: 1, inheritance: 'dominant', enabled: true },
  spectacles: { color: '#e5d3b3', copies: 1, inheritance: 'recessive', enabled: false, carrier: true },
  stripes: { color: '#e5d3b3', copies: 0, inheritance: 'dominant', enabled: false },
});
assert.equal(houndTraits.size.label, 'Large');
assert.equal(houndTraits.size.roleLabel, 'Mount');
assert.equal(houndTraits.size.isNonDefault, true);
assert.equal(houndTraits.colors[0].label, 'Base coat');
assert.deepEqual(Array.from(houndTraits.patterns, trait => [trait.label, trait.enabled, trait.carrier]), [
  ['Mitts', true, false],
  ['Spectacles', false, true],
]);

const uumTraits = context.CreatureGenetics.genotypeTraits('uumkaoii', { // Exercises permanent dual-region labels.
  sizeClass: 'large',
  fur: { color: '#7a6a58', copies: 2, inheritance: 'dominant' },
  plates: { color: '#c2a56e', copies: 2, inheritance: 'dominant' },
});
assert.deepEqual(Array.from(uumTraits.colors, trait => trait.label), ['Fur', 'Plates']);

const originalRandom = context.Math.random; // Restored after forcing one endpoint mutation through public breeding.
const rolls = [0.9, 0.9, 0.1, 0.01, 0.1]; // No color mutations; parent A; Size mutates; old endpoint logic would incorrectly stay small.
context.Math.random = () => rolls.shift() ?? 0.9;
const mutatedChild = context.CreatureGenetics.crossOffspring(
  { sizeClass: 'small', fur: { color: '#7a6a58' }, plates: { color: '#c2a56e' } },
  { sizeClass: 'small', fur: { color: '#7a6a58' }, plates: { color: '#c2a56e' } },
  'uumkaoii',
); // Uses the real offspring path rather than a test-only mutation export.
context.Math.random = originalRandom;
assert.equal(mutatedChild.sizeClass, 'medium', 'a successful endpoint mutation always changes Size class');

console.log('creature size scaling and trait-summary tests passed');
