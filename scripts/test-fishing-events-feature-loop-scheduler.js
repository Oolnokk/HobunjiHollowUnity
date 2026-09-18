#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership migration of fishing-events.js:
// featureLoop() (Frenzy-event timers plus Gullet fish AI/animation) becomes
// a single RuntimeFrameScheduler registration on the default phase, since
// it has no render-order dependency (it doesn't write into a
// PlayerBodyTransformComposer channel). This module is only ever
// dynamically loaded by sprite-recolor.js when #fishingOverlay exists in
// the shipped game, never by a docs/tools/* editor page, so it needs no
// requestAnimationFrame fallback at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/fishing-events.js', 'utf8');
assert(source.includes("window.RuntimeFrameScheduler.register('fishing-events-feature-loop'"), 'featureLoop must register with the scheduler');
assert(!/requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

function buildFixture() {
  const registered = new Map();
  const windowObject = {
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
    Fishing: { init(deps) { this.deps = deps; }, state: null },
  };
  const documentObject = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add(){}, remove(){} }, appendChild(){}, addEventListener(){}, remove(){} }),
    body: { appendChild() {} },
  };
  const sandbox = {
    window: windowObject,
    document: documentObject,
    console,
    performance: { now: () => 1000 },
    location: { search: '' },
    URLSearchParams,
    localStorage: { getItem: () => null, setItem() {} },
    Math, Number, Object, Array, Set, Map, String, JSON, Date,
  };
  windowObject.window = windowObject;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'fishing-events.js' });
  return { windowObject, registered };
}

// --- Registration shape -----------------------------------------------------
{
  const { registered } = buildFixture();
  const entry = registered.get('fishing-events-feature-loop');
  assert(entry, 'featureLoop registers under a stable id');
  assert.equal(entry.options.owner, 'FishingFeatureDebug');
  assert.notEqual(entry.options.phase, 'pre-render', 'Frenzy/Gullet updates have no render-order dependency');
}

// --- Before Fishing.init() runs, fishingDeps is unset: callback no-ops -----
{
  const { registered } = buildFixture();
  const entry = registered.get('fishing-events-feature-loop');
  assert.doesNotThrow(() => entry.fn({ timestamp: 1000 }), 'the scheduler callback must tolerate no fishingDeps yet');
}

// --- After Fishing.init() wires fishingDeps, the callback runs the loop body
{
  const { registered, windowObject } = buildFixture();
  windowObject.Fishing.init({ getCurrentArea: () => null, showToast() {} });
  const entry = registered.get('fishing-events-feature-loop');
  assert.doesNotThrow(() => entry.fn({ timestamp: 1000 }), 'the scheduler callback must tolerate a minimal fishingDeps bag');
  assert.doesNotThrow(() => entry.fn({ timestamp: 1016 }), 'a second call advances featureLoopLastMs without throwing');
}

console.log('fishing events feature loop scheduler migration passed');
