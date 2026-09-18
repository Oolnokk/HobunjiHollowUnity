#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership migration of
// environment-surface-micro-plateau.js: its self-recursive tick() loop
// registers with RuntimeFrameScheduler on the default (post-game) phase
// when the scheduler is present (the shipped game's only load site), since
// rebuilding/maintaining the snow/slush surface mesh has no render-order
// dependency. The standalone Wilderness Generation Lab and
// docs/snow-runtime-test.html tool pages load this module directly without
// RuntimeFrameScheduler, so a guarded raw RAF fallback remains for those
// isolated contexts.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');
assert(source.includes("window.RuntimeFrameScheduler.register('environment-surface-micro-plateau-tick'"), 'tick must register with the scheduler when present');
assert(source.includes('requestAnimationFrame(fallbackTick)'), 'an isolated-context fallback RAF loop must remain for tool pages without the scheduler');

function buildFixture({ withScheduler = true } = {}) {
  const registered = new Map();
  let rafCalls = 0;
  const windowObject = {
    RuntimeFrameScheduler: withScheduler ? {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    } : undefined,
    THREE: undefined,
    GridTileAccessors: undefined,
  };
  const documentObject = { currentScript: { src: 'https://example.test/docs/js/environment-surface-micro-plateau.js' } };
  const sandbox = {
    window: windowObject,
    document: documentObject,
    globalThis: { performance: { now: () => 0 } },
    requestAnimationFrame(fn) { rafCalls++; return rafCalls; },
    URL,
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: 'environment-surface-micro-plateau.js' });
  return { windowObject, registered, getRafCalls: () => rafCalls };
}

// --- Scheduler path: registers once, starts no private RAF loop ------------
{
  const { registered, getRafCalls } = buildFixture({ withScheduler: true });
  const entry = registered.get('environment-surface-micro-plateau-tick');
  assert(entry, 'tick registers under a stable id when the scheduler is present');
  assert.equal(entry.options.owner, 'EnvironmentSurfaceMicroPlateau');
  assert.notEqual(entry.options.phase, 'pre-render', 'mesh rebuild has no render-order dependency, so it must not claim the pre-render phase');
  assert.equal(getRafCalls(), 0, 'scheduler-backed registration must not also start a private requestAnimationFrame loop');
  assert.doesNotThrow(() => entry.fn({ timestamp: 100 }), 'the registered callback must tolerate missing THREE/GridTileAccessors without throwing');
}

// --- Isolated-context fallback: no scheduler means the raw RAF loop starts -
{
  const { getRafCalls } = buildFixture({ withScheduler: false });
  assert.equal(getRafCalls(), 1, 'without RuntimeFrameScheduler, the module must fall back to one requestAnimationFrame kickoff');
}

console.log('environment surface micro-plateau scheduler migration passed');
