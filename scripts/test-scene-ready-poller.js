#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of game.js's
// waitForBuildingSceneReady: its self-recursive requestAnimationFrame
// condition-wait loop (poll _buildingScenes.get(mapId) until ready or a
// timeout) becomes a generic setTimeout-based poller, extracted into its
// own docs/js/scene-ready-poller.js module per CLAUDE.md's standing
// opportunistic-extraction guidance, since it has no per-frame visual work
// and no dependency beyond the caller-supplied predicate.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const pollerSource = fs.readFileSync('docs/js/scene-ready-poller.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
assert(!/requestAnimationFrame\(/.test(pollerSource), 'the extracted poller must use a real timer, not requestAnimationFrame');
assert(pollerSource.includes('global.setTimeout(poll, intervalMs)'), 'the poller must reschedule itself on a timer');
const pollerAt = indexSource.indexOf('js/scene-ready-poller.js?v=');
const livestockLoaderAt = indexSource.indexOf('js/combat/combat-loadout-ui.js?v=');
const porakanekiLoaderAt = indexSource.indexOf('js/house-pieces.js?v=');
assert(pollerAt >= 0, 'the shipped page loads SceneReadyPoller explicitly');
assert(pollerAt < livestockLoaderAt, 'SceneReadyPoller loads before combat-loadout-ui can inject livestock genotype persistence');
assert(pollerAt < porakanekiLoaderAt, 'SceneReadyPoller loads before house-pieces can inject Porakaneki faction rules');
assert.equal(indexSource.indexOf('js/scene-ready-poller.js?v=', pollerAt + 1), -1, 'SceneReadyPoller is loaded exactly once');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert(gameSource.includes('return window.SceneReadyPoller.pollUntilReady(() => !!_buildingScenes.get(mapId), timeoutMs);'), 'waitForBuildingSceneReady must delegate to the extracted poller');
assert(!gameSource.includes('requestAnimationFrame(poll)'), 'game.js must no longer self-schedule the old raw RAF poll loop');

function buildFixture() {
  const timers = [];
  const sandbox = {
    performance: { now: () => 0 },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pollerSource, sandbox, { filename: 'scene-ready-poller.js' });
  return { windowObject: sandbox, timers };
}

// --- Resolves immediately when the condition is already true ---------------
{
  const { windowObject } = buildFixture();
  let resolved = false;
  windowObject.SceneReadyPoller.pollUntilReady(() => true, 4000).then(() => { resolved = true; });
  assert.equal(resolved, false, 'promise resolution is always asynchronous, even for an already-true predicate');
}

// --- Reschedules on a real timer, not a raw RAF -----------------------------
{
  const { windowObject, timers } = buildFixture();
  let ready = false;
  let done = false;
  windowObject.SceneReadyPoller.pollUntilReady(() => ready, 4000, 50).then(() => { done = true; });
  assert.equal(timers.length, 1, 'the poller schedules its first re-check via setTimeout');
  assert.equal(timers[0].ms, 50, 'the poller honors the configured interval');
  ready = true;
  timers[0].fn();
  assert.equal(done, false, 'resolution happens on a microtask after the predicate becomes true');
}

// --- Times out and resolves anyway when the predicate never becomes true ---
{
  const windowObject = { performance: { now: () => 0 } };
  let now = 0;
  windowObject.performance.now = () => now;
  const timers = [];
  windowObject.setTimeout = (fn, ms) => { timers.push({ fn, ms }); };
  windowObject.window = windowObject;
  vm.createContext(windowObject);
  vm.runInContext(pollerSource, windowObject, { filename: 'scene-ready-poller.js' });
  let done = false;
  windowObject.SceneReadyPoller.pollUntilReady(() => false, 100, 10).then(() => { done = true; });
  now = 150;
  timers[0].fn();
  assert.equal(timers.length, 1, 'once the timeout has elapsed, the poller must not reschedule again');
}

console.log('scene ready poller extraction/conversion regression passed');
