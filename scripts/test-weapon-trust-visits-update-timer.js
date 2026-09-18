#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of weapon-trust-visits.js's
// update: a forever requestAnimationFrame loop that only did substantive
// work on an area change or once a 1000ms sync throttle elapsed becomes a
// real 100ms setInterval instead - the per-frame cadence itself was never
// needed. Extracts the self-contained update()/currentArea() pair straight
// from the shipped source, with its surrounding business-logic calls
// (removeActiveVisitor, onFarmhouseExit, ensureDialogueTreesOnWalkers,
// syncSmithingShapeUnlocks - each covered by other existing tests)
// stubbed as tracked no-ops, the same technique used for other DOM/deps-
// heavy files' pure scheduling logic in this backlog.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/weapon-trust-visits.js', 'utf8');
assert(!/requestAnimationFrame\(update\)/.test(source), 'update must no longer self-schedule a raw requestAnimationFrame');
assert(source.includes('frameHandle = global.setInterval(update, 100)'), 'update must be driven by a real setInterval instead');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `could not find ${name} in weapon-trust-visits.js`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

function buildFixture() {
  const calls = { removeActiveVisitor: [], onFarmhouseExit: 0, ensureDialogueTreesOnWalkers: 0, syncSmithingShapeUnlocks: 0 };
  const state = {
    runtimeDeps: null,
    scheduleDeps: { getCurrentArea: () => state.area },
    activeVisit: null,
    lastArea: null,
    lastSyncAt: 0,
    cfg: { visitor: { farmhouseExteriorArea: 'farm', farmhouseInteriorArea: 'map_i_farmhouse' } },
    area: 'town',
  };
  const harness = `
    let runtimeDeps = null, scheduleDeps = __state.scheduleDeps, activeVisit = null, lastArea = null, lastSyncAt = 0;
    const cfg = __state.cfg;
    function removeActiveVisitor(reason) { __calls.removeActiveVisitor.push(reason); activeVisit = null; }
    function onFarmhouseExit() { __calls.onFarmhouseExit++; }
    function ensureDialogueTreesOnWalkers() { __calls.ensureDialogueTreesOnWalkers++; }
    function syncSmithingShapeUnlocks() { __calls.syncSmithingShapeUnlocks++; }
    ${extractFunction('currentArea')}
    ${extractFunction('update')}
    global.__test = {
      update,
      setArea: value => { __state.area = value; },
      setActiveVisit: value => { activeVisit = value; },
      getLastArea: () => lastArea,
      getLastSyncAt: () => lastSyncAt,
    };
  `;
  const intervals = [];
  const sandbox = {
    global: {}, __state: state, __calls: calls,
    performance: { now: () => state.now || 0 },
    Math, Number,
  };
  vm.createContext(sandbox);
  vm.runInContext(harness, sandbox, { filename: 'weapon-trust-visits-extract.js' });
  return { test: sandbox.global.__test, calls, state };
}

// --- An area change (farmhouse interior -> exterior) triggers onFarmhouseExit
{
  const { test, calls, state } = buildFixture();
  test.setArea('map_i_farmhouse');
  state.now = 0;
  test.update();
  assert.equal(test.getLastArea(), 'map_i_farmhouse');
  test.setArea('farm');
  state.now = 10;
  test.update();
  assert.equal(calls.onFarmhouseExit, 1, 'crossing from the farmhouse interior to its exterior triggers onFarmhouseExit');
}

// --- Leaving the exterior area with an active visitor removes them ---------
{
  const { test, calls, state } = buildFixture();
  test.setArea('farm');
  state.now = 0;
  test.update();
  test.setActiveVisit({ proxy: {} });
  test.setArea('town');
  state.now = 10;
  test.update();
  assert.deepEqual(calls.removeActiveVisitor, ['area-change'], 'leaving the visitor-exterior area removes the active visitor');
}

// --- The 1000ms sync throttle gates the dialogue/smithing sync calls -------
{
  const { test, calls, state } = buildFixture();
  state.now = 0;
  test.update();
  assert.equal(calls.ensureDialogueTreesOnWalkers, 0, 'a tick at time 0 has not yet crossed the 1000ms throttle since lastSyncAt also starts at 0');
  state.now = 500;
  test.update();
  assert.equal(calls.ensureDialogueTreesOnWalkers, 0, 'a tick within the 1000ms throttle window must not resync');
  state.now = 1600;
  test.update();
  assert.equal(calls.ensureDialogueTreesOnWalkers, 1, 'a tick past the 1000ms throttle window resyncs');
  state.now = 1700;
  test.update();
  assert.equal(calls.ensureDialogueTreesOnWalkers, 1, 'immediately after a resync, the throttle window must not have already reopened');
}

console.log('weapon trust visits update timer conversion passed');
