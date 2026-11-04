// Regression: projectile opacity fades must not recompile an unchanged shader.
// Run from repository root: node scripts/test-ranged-projectile-fade-performance.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8');
const start = source.indexOf('  function setProjectileVisualOpacity(');
const end = source.indexOf('\n  function disposeProjectileTrails(', start);
assert(start >= 0 && end > start, 'test must execute the real projectile fade helper');
const fade = vm.runInNewContext('(' + source.slice(start, end).trim() + ')');

// Opaque material needs one shader variant switch when fading begins, and
// later opacity values only need uniform updates. A second material already
// configured for transparency must not request an unnecessary shader rebuild.
const opaque = { transparent: false, opacity: 1, needsUpdate: false };
const transparent = { transparent: true, opacity: 1, needsUpdate: false };
const mesh = { material: [opaque, transparent] };
const projectile = { visual: { traverse(visitor) { visitor(mesh); } } };

fade(projectile, 0.8);
assert.equal(opaque.transparent, true);
assert.equal(opaque.needsUpdate, true, 'first transparency transition recompiles once');
assert.equal(transparent.needsUpdate, false, 'existing transparent shaders stay compiled');
opaque.needsUpdate = false; // Simulates Three.js consuming the first shader change.

for (const alpha of [0.6, 0.4, 0.2, 0, 0.2, 1]) {
  fade(projectile, alpha);
  assert.equal(opaque.opacity, alpha);
  assert.equal(transparent.opacity, alpha);
  assert.equal(opaque.needsUpdate, false, 'opacity updates must not recompile');
  assert.equal(transparent.needsUpdate, false, 'already-transparent materials need no recompilation');
}
fade(projectile, -1);
assert.equal(opaque.opacity, 0, 'negative opacity clamps');
fade(projectile, 2);
assert.equal(opaque.opacity, 1, 'opacity above one clamps');
assert.equal(opaque.needsUpdate, false);
console.log('Projectile fade: transparency setup and uniform-only opacity updates passed');
