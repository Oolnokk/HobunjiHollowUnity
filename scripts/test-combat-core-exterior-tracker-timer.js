#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of combat-core.js's
// startExteriorTracker: a forever requestAnimationFrame loop whose only
// job was caching the player's last exterior-area tile position for a
// rare fallback lookup (inferredExteriorForArea) becomes a real 250ms
// setInterval instead - it never needed per-frame freshness.
//
// This was already being intercepted and throttled to exactly this same
// 250ms cadence by performance-loop-optimizations.js's dedicated
// DevSpawner-init/requestAnimationFrame interception (unlike
// alcohol-gameplay-bridge.js's adaptive idle-stop wrapper, that
// interception was a flat, unconditional throttle with no adaptive
// behavior to lose), so this change also removes that now-dead
// interception code from performance-loop-optimizations.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const coreSource = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8');
assert(!/requestAnimationFrame\(track\)/.test(coreSource), 'startExteriorTracker must no longer self-schedule a raw requestAnimationFrame');
assert(coreSource.includes('setInterval(track, 250)'), 'startExteriorTracker must poll via a real setInterval instead');

const perfSource = fs.readFileSync('docs/js/performance-loop-optimizations.js', 'utf8');
for (const dead of ['isExteriorTrackerCallback', 'patchDevSpawner', 'scheduleExterior', 'runExteriorTracker', 'exteriorCallback', 'EXTERIOR_TRACK_INTERVAL_MS', 'exteriorTicks', 'exteriorCaptured', 'exteriorTrackHz', 'EXTERIOR_TRACK_HZ']) {
  assert(!perfSource.includes(dead), `performance-loop-optimizations.js must no longer reference the dead exterior-tracker interception (${dead})`);
}

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = coreSource.indexOf(marker);
  assert(start >= 0, `could not find ${name} in combat-core.js`);
  let depth = 0, i = coreSource.indexOf('{', start);
  for (; i < coreSource.length; i++) {
    if (coreSource[i] === '{') depth++;
    else if (coreSource[i] === '}') { depth--; if (depth === 0) break; }
  }
  return coreSource.slice(start, i + 1);
}

const harness = `
  let devDeps = null;
  let lastExteriorAnchor = null;
  let exteriorTrackerStarted = false;
  ${extractFunction('isExteriorArea')}
  ${extractFunction('startExteriorTracker')}
  global.__test = {
    start: deps => { devDeps = deps; startExteriorTracker(); },
    getAnchor: () => lastExteriorAnchor,
  };
`;

function buildFixture() {
  const intervals = [];
  const sandbox = { setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; }, Math, Number, global: {} };
  vm.createContext(sandbox);
  vm.runInContext(harness, sandbox, { filename: 'combat-core-extract.js' });
  return { intervals, test: sandbox.global.__test };
}

// --- Starting the tracker schedules exactly one 250ms setInterval ----------
{
  const { intervals, test } = buildFixture();
  const devDeps = { getCurrentArea: () => 'town', player: { x: 128, y: 64 }, TILE: 32, _isZoneArea: () => false };
  test.start(devDeps);
  assert.equal(intervals.length, 1, 'starting the tracker schedules exactly one setInterval poll');
  assert.equal(intervals[0].ms, 250, 'the poll runs on the documented 250ms cadence');
}

// --- Starting it twice does not double-schedule -----------------------------
{
  const { intervals, test } = buildFixture();
  const devDeps = { getCurrentArea: () => 'town', player: { x: 0, y: 0 }, TILE: 32, _isZoneArea: () => false };
  test.start(devDeps);
  test.start(devDeps);
  assert.equal(intervals.length, 1, 'repeated start calls must not double-start the tracker');
}

// --- An exterior area updates the cached anchor on each tick ----------------
{
  const { intervals, test } = buildFixture();
  const devDeps = { getCurrentArea: () => 'farm', player: { x: 96, y: 64 }, TILE: 32, _isZoneArea: () => false };
  test.start(devDeps);
  intervals[0].fn();
  const anchor = test.getAnchor();
  assert.equal(anchor?.area, 'farm');
  assert.equal(anchor?.col, 3);
  assert.equal(anchor?.row, 2);
}

// --- A non-exterior area leaves the cached anchor untouched -----------------
{
  const { intervals, test } = buildFixture();
  const devDeps = { getCurrentArea: () => 'town', player: { x: 32, y: 32 }, TILE: 32, _isZoneArea: () => false };
  test.start(devDeps);
  intervals[0].fn();
  const before = test.getAnchor();
  devDeps.getCurrentArea = () => 'map_i_barn_farm_nursery';
  intervals[0].fn();
  assert.deepEqual(test.getAnchor(), before, 'an interior area tick must not overwrite the last exterior anchor');
}

console.log('combat core exterior tracker timer conversion passed');
