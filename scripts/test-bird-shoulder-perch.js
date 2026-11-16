#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');

// Evaluate only the real runtime anchor resolver: no WebGL/browser boot needed.
const start = gameSource.indexOf('function creatureAttachmentAnchor(');
const end = gameSource.indexOf('function playerAttachmentAnchorY(', start);
assert(start >= 0 && end > start, 'runtime attachment anchor resolver exists');
const resolverSource = gameSource.slice(start, end).trim();
const buildResolver = new Function('window', 'CREATURE_DB', '_creatureAttachmentAnchorCache',
  'return (' + resolverSource + ');');

const creatureDefinitions = {
  pingdort: { modelWidth: 0.48, spriteAspect: 1000 / 1617, isFlyingSpecies: true },
  skeeri: { modelWidth: 0.65, spriteAspect: 1000 / 1617, isFlyingSpecies: true },
  'gar-wolf': { modelWidth: 1, spriteAspect: 0.5 },
  unknown: { modelWidth: 1, spriteAspect: 1 },
}; // Simulates the native CreatureDB definitions for perched flyers and non-flyers.
const originalGrip = { position: { x: 0.03, y: -0.22, z: 0.07 }, rotationDeg: { x: 0, y: -61, z: 0 } }; // Valid authored ground-pet grip that must take precedence.
const profiles = { creatures: { 'gar-wolf': { anchors: { shoulderGrip: originalGrip } } } }; // The real master has no Pingdort/Skeeri profiles.
const windowMock = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: profiles,
  CreatureGenetics: {
    SPECIES_ALIAS: {},
    creatureSizeScale(_kind, genotype) {
      const sizeClass = genotype?.sizeClass || 'small';
      return { sizeClass, x: sizeClass === 'large' ? 2 : 1, y: sizeClass === 'large' ? 2 : 1 };
    },
  },
}; // Minimal dependencies of the isolated production resolver.

function resolver() {
  return buildResolver(windowMock, creatureDefinitions, new Map());
}

for (const kind of ['pingdort', 'skeeri']) {
  const get = resolver();
  const nativeHeight = creatureDefinitions[kind].modelWidth * creatureDefinitions[kind].spriteAspect;
  const small = get(kind, 'shoulderGrip', { sizeClass: 'small' });
  const large = get(kind, 'shoulderGrip', { sizeClass: 'large' });
  assert.equal(small.source, 'native-flying-sprite-foot', kind + ' uses its native perched foot grip');
  assert.equal(small.x, 0);
  assert.equal(small.z, 0);
  assert.equal(small.y, -nativeHeight / 2, kind + ' feet align at the bottom of its unscaled native plane');
  assert.equal(small.localPosition.y, -nativeHeight / 2, kind + ' keeps a native foot position for rendered THREE scale');
  assert.equal(large.localPosition.y, -nativeHeight / 2, kind + ' raw socket does not double-apply genotype size');
  assert.equal(large.y, -nativeHeight, kind + ' feet respect the genotype size class');
  assert.strictEqual(get(kind, 'shoulderGrip', { sizeClass: 'small' }), small,
    kind + ' grip is cached per species/size, not recalculated each frame');
  assert.equal(get(kind, 'saddle', { sizeClass: 'small' }), null,
    kind + ' does not acquire a fictitious saddle');
}

const get = resolver();
const wolf = get('gar-wolf', 'shoulderGrip', { sizeClass: 'small' });
assert.deepEqual([wolf.x, wolf.y, wolf.z], [0.03, -0.22, 0.07], 'authored grip stays authoritative');
assert.equal(wolf.rotationDeg.y, -61, 'authored grip rotation stays authoritative');
assert.deepEqual([wolf.localPosition.x, wolf.localPosition.y, wolf.localPosition.z], [0.03, -0.22, 0.07],
  'authored native grip is retained separately from legacy genotype-scaled coordinate fields');
assert.equal(wolf.source, undefined, 'authored profiles retain their original structure');
assert.equal(get('unknown', 'shoulderGrip', { sizeClass: 'small' }), null,
  'ground and unknown species do not gain fake bird grips');

assert.match(gameSource, /const grip = creatureAttachmentAnchor\(c\.creatureKey, 'shoulderGrip', c\.genotype\);/g,
  'the gameplay attachment path reuses the same resolver');
assert.match(gameSource, /worldPosition: perchWorldPosition\.clone\(\)\.sub\(gripWorldOffset\)/,
  'pet root is solved from the real player perch minus the rotated foot grip');
assert.match(gameSource, /gripSource: finalTransform\.gripSource/,
  'the final attachment snapshot identifies the grip type');
assert.match(probeSource, /Pet shoulder grip:.*gripSource/,
  'mobile Pixel Probe reports whether a bird is using its virtual foot grip');

console.log('bird shoulder-perch resolver and diagnostic tests passed');
