#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership migration of stable-animal-progression.js:
// its self-recursive alertFrame() loop (service-XP ticks plus shoulder-pet
// threat-alert aura animation) becomes a single RuntimeFrameScheduler
// registration, since neither piece has a render-order dependency (auras
// are ordinary scene sprites, not PlayerBodyTransformComposer channels).
// This module is only ever dynamically loaded by
// livestock-nursery-install-bridge.js in the shipped game, never by a
// docs/tools/* editor page, so it needs no requestAnimationFrame fallback
// at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/stable-animal-progression.js', 'utf8');
assert(source.includes("window.RuntimeFrameScheduler.register('stable-animal-progression-alert'"), 'alertFrame must register with the scheduler');
assert(!/requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

function buildFixture() {
  const registered = new Map();
  const windowObject = {
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
  };
  const document = { createElement: () => ({ style: {}, appendChild(){}, addEventListener(){} }), getElementById: () => null };
  const context = { window: windowObject, document, console, performance: { now: () => 1000 } };
  context.window = windowObject;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'stable-animal-progression.js' });
  return { windowObject, registered, api: windowObject.StableAnimalProgression };
}

// --- install() registers exactly once with the scheduler --------------------
{
  const { registered, api } = buildFixture();
  api.install();
  const entry = registered.get('stable-animal-progression-alert');
  assert(entry, 'alertFrame registers under a stable id after install()');
  assert.equal(entry.options.owner, 'StableAnimalProgression');
  assert.notEqual(entry.options.phase, 'pre-render', 'alert auras are ordinary scene sprites with no render-order dependency');
}

// --- install() called twice (real re-install path) registers only once -----
{
  const { registered, api } = buildFixture();
  api.install();
  api.install();
  assert.equal([...registered.keys()].filter(id => id === 'stable-animal-progression-alert').length, 1, 'repeated install() calls must not double-register the alert frame');
}

// --- driving the registered callback does not throw with no active pets ----
{
  const { registered, api } = buildFixture();
  api.install();
  const entry = registered.get('stable-animal-progression-alert');
  assert.doesNotThrow(() => entry.fn({ timestamp: 2000 }), 'the scheduler callback must tolerate an idle stable with no player/combat deps wired');
}

console.log('stable animal progression scheduler migration passed');
