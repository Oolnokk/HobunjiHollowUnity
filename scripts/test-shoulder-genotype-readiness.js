#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8'); // Test the real shoulder presentation function without standing up an entire Three.js scene.
const start = source.indexOf('  function ensureShoulderPetPresentationFrame('); // Owner function under test, including its current URL and readiness gates.
const end = source.indexOf('  function restoreAfterShoulderPet(', start); // Neighboring function marks the exact safe extraction boundary.
assert(start > 0 && end > start, 'shoulder appearance function remains extractable for the regression');
let clock = 1000; // Deterministic retry deadlines without sleeping in the test.
let signature = 'coat-A'; // Simulates a Color Pools change without changing the source sprite URL.
let attempts = 0; // Ensures the deferred first composite eventually receives a second request.
const avatarRef = { frontPlane: { material: { map: { isCanvasTexture: false } } } }; // Source art is a regular Texture even if its image was resized onto a canvas.
const companion = { avatarRef, genotype: { base: { color: '#765432' } }, currentFrameUrl: null };
const harness = {
  window: { CreatureGeneticsRender: { SPECIES: { wolf: {} }, genotypeSignature: () => signature } },
  Date: { now: () => clock },
  effectiveShoulderRest: () => null,
  authoredShoulderRestFor: () => null,
  shoulderIdleFrame: () => ({ url: 'wolf_idle.png', genotypeKind: 'wolf' }),
  shoulderRun1Frame: () => ({ url: 'wolf_run1.png', genotypeKind: 'wolf' }),
  needsSmallPetHead: () => false,
  ensureSmallPetHeadFrame: () => false,
  ensureSplitShoulderFrame: () => false,
  companion,
};
const deps = {
  setCreatureFrame() {
    attempts++;
    if (attempts !== 1) avatarRef.frontPlane.material.map = { isCanvasTexture: true }; // First request starts async compose, second binds the ready result.
    return true; // The real game may report that it applied its temporary plain fallback successfully.
  },
};
vm.createContext(harness);
vm.runInContext(source.slice(start, end) + '\nthis.present = ensureShoulderPetPresentationFrame;', harness);
assert.equal(harness.present(companion, deps), true);
assert.equal(attempts, 1);
assert.equal(companion.currentFrameUrl, 'wolf_idle.png', 'a plain fallback can be bound before its colored frame arrives');
harness.present(companion, deps);
assert.equal(attempts, 1, 'in-flight genotype compose is throttled, not polled each frame');
clock += 160;
harness.present(companion, deps);
assert.equal(attempts, 2, 'same-URL shoulder sprite is requested again after the first plain fallback');
assert.equal(companion._shoulderPresentedSignature, 'coat-A', 'only the bound canvas confirms the genotype is ready');
harness.present(companion, deps);
assert.equal(attempts, 2, 'fully painted frame is not redundantly rebound every frame');
signature = 'coat-B';
harness.present(companion, deps);
assert.equal(attempts, 3, 'genotype changes force a fresh request despite the unchanged source sprite URL');
assert.equal(companion._shoulderPresentedSignature, 'coat-B');
console.log('Shoulder genotype readiness/retry tests passed');
