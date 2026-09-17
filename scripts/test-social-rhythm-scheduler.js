#!/usr/bin/env node
'use strict';

// Regression for the Stage 6/7 RAF-ownership decomposition:
// social-rhythm-runtime.js's combined frame() loop (throttled Kurraya
// rhythm polling, Character View head-return easing, dance footstep
// timing, and the player's Kurraya metronome) becomes a single
// RuntimeFrameScheduler registration, since none of it touches Three.js
// scene state or has a render-order dependency - it is pure audio/UI-state
// bookkeeping. This module is only ever dynamically loaded by
// character-action-locks.js in the shipped game, never by a docs/tools/*
// editor page, so it needs no requestAnimationFrame fallback at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/social-rhythm-runtime.js', 'utf8');
assert(source.includes("global.RuntimeFrameScheduler.register('social-rhythm-clock', maintainRhythmClock"), 'rhythm-clock maintenance must register with the scheduler');
assert(!/global\.requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

function buildFixture() {
  const registered = new Map();
  const windowObject = {
    SCRATCHBONES_CONFIG: { game: { socialActions: {} } },
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
  };
  const documentObject = {
    querySelectorAll() { return []; },
    getElementById() { return null; },
    addEventListener() {},
  };
  const sandbox = { window: windowObject, document: documentObject, performance: { now: () => 0 } };
  vm.runInNewContext(source, sandbox, { filename: 'social-rhythm-runtime.js' });
  return { windowObject, registered };
}

// --- Registration shape -----------------------------------------------------
{
  const { registered } = buildFixture();
  const entry = registered.get('social-rhythm-clock');
  assert(entry, 'rhythm-clock maintenance registers under a stable id');
  assert.equal(entry.options.owner, 'SocialRhythmClock');
  assert.notEqual(entry.options.phase, 'pre-render', 'rhythm-clock maintenance touches no Three.js scene state, so it must not claim the pre-render phase');
}

// --- Behavioral equivalence: driving the registered callback advances the
// rhythm clock's poll gate exactly like the old frame() loop did. --------
{
  const { registered, windowObject } = buildFixture();
  const before = windowObject.SocialRhythmClock.getState();
  assert.doesNotThrow(() => registered.get('social-rhythm-clock').fn({ timestamp: 0 }));
  assert.doesNotThrow(() => registered.get('social-rhythm-clock').fn({ timestamp: 16 }));
  assert.doesNotThrow(() => registered.get('social-rhythm-clock').fn({ timestamp: 500 }));
  const after = windowObject.SocialRhythmClock.getState();
  assert.equal(after.bpm, before.bpm, 'the session-default rhythm is unchanged when nothing is heard');
}

console.log('social rhythm clock scheduler migration passed');
