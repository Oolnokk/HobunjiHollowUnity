#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership migration of
// onboarding-character-creation-weapon-polish.js: its self-perpetuating
// frame() loop (re-applying idle-sprite-basis corrections whenever the
// character creator preview's tool plane changes) becomes a
// single RuntimeFrameScheduler registration on the default phase, since it
// mutates plane transforms directly rather than reading/writing a
// PlayerBodyTransformComposer channel. This module is only ever
// dynamically loaded by docs/onboarding.js in the shipped game, never by a
// docs/tools/* editor page, so it needs no requestAnimationFrame fallback
// at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/onboarding-character-creation-weapon-polish.js', 'utf8');
assert(source.includes("window.RuntimeFrameScheduler.register('onboarding-character-creation-weapon-polish', frame"), 'frame must register with the scheduler');
assert(!/requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

function buildFixture({ toolPlane = null } = {}) {
  const registered = new Map();
  const windowObject = {
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
    hobunjiOnboardingCharacterCreationWeaponViewFix: { state: { toolPlane, choice: toolPlane ? { shape: 'hatchet' } : null } },
    hobunjiOnboardingCharacterCreationLifePreview: { life: { model: 'm1', speciesId: 'kenkari' } },
  };
  const sandbox = { window: windowObject };
  vm.runInNewContext(source, sandbox, { filename: 'onboarding-character-creation-weapon-polish.js' });
  return { windowObject, registered };
}

// --- Registration shape -----------------------------------------------------
{
  const { registered } = buildFixture();
  const entry = registered.get('onboarding-character-creation-weapon-polish');
  assert(entry, 'frame registers under a stable id');
  assert.equal(entry.options.owner, 'OnboardingCharacterCreationWeaponPolish');
  assert.notEqual(entry.options.phase, 'pre-render', 'plane corrections are not a PlayerBodyTransformComposer channel write, so no pre-render dependency');
}

// --- No tool plane: callback tolerates an idle creator without throwing ----
{
  const { registered } = buildFixture({ toolPlane: null });
  const entry = registered.get('onboarding-character-creation-weapon-polish');
  assert.doesNotThrow(() => entry.fn(), 'the scheduler callback must tolerate no active tool plane');
}

// --- With a tool plane: no species-specific size correction remains ---------
{
  const plane = { scale: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 }, quaternion: null, updateMatrix() {}, updateMatrixWorld() {} };
  const { registered, windowObject } = buildFixture({ toolPlane: plane });
  const entry = registered.get('onboarding-character-creation-weapon-polish');
  const status = {};
  windowObject.HOBUNJI_ONBOARDING_REDESIGN_STATUS = status;
  assert.doesNotThrow(() => entry.fn(), 'polish callback should tolerate a plane without quaternion helpers');
  assert.deepEqual(plane.scale, { x: 1, y: 1, z: 1 }, 'creator polish must not apply a hardcoded species-specific weapon scale');
  assert.equal(status.previewWeaponScaleSource, 'calculated-character-height', 'diagnostics should identify the shared calculated-height scale source');
}

console.log('onboarding character creation weapon polish scheduler migration passed');
