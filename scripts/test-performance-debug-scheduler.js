#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership migration of performance-debug.js's two
// loops:
//   - frameLoop: opt-in FPS counter/profiler overlay. Registers once with
//     RuntimeFrameScheduler on first activation and is toggled via
//     setEnabled() from setFpsEnabled()/setProfilerEnabled() thereafter -
//     the event-driven setEnabled() gating pattern documented in
//     docs/architecture/runtime-frame-scheduler.md.
//   - lagWatchLoop: unconditional low-FPS auto cache-snapshot watcher.
//     Registers once, unconditionally, from install() via startLagWatch().
// Both are single-context (shipped game only, dynamically loaded by
// docs/debug.js, never a docs/tools/* editor page), so neither needs a
// requestAnimationFrame fallback.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/performance-debug.js', 'utf8');
assert(source.includes("root.RuntimeFrameScheduler.register(FRAME_LOOP_SCHEDULER_ID, frameLoop"), 'frameLoop must register with the scheduler');
assert(source.includes('root.RuntimeFrameScheduler.setEnabled(FRAME_LOOP_SCHEDULER_ID, active)'), 'frameLoop must be toggled via setEnabled once registered');
assert(source.includes("root.RuntimeFrameScheduler.register('performance-debug-lag-watch', lagWatchLoop"), 'lagWatchLoop must register with the scheduler');
assert(source.includes('root.RuntimeFrameScheduler?.setProfilingEnabled?.(profilerEnabled)'), 'Performance Profiler must toggle the scheduler\'s built-in per-subscriber timers');
assert(source.includes('scheduler: schedulerProfileSnapshot()'), 'PerfProfiler snapshots must expose the scheduler phase/subscriber breakdown');
assert(!/requestAnimationFrame\(frameLoop\)/.test(source), 'frameLoop must no longer self-schedule a raw requestAnimationFrame');
assert(!/requestAnimationFrame\(lagWatchLoop\)/.test(source), 'lagWatchLoop must no longer self-schedule a raw requestAnimationFrame');

function buildFixture() {
  const registered = new Map();
  const schedulerDebug = {
    registered: 0,
    enabled: 0,
    scheduled: true,
    hasFrameDriver: true,
    profilingEnabled: false,
    entries: [],
  };
  const windowObject = {
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options, enabled: true }); },
      setEnabled(id, enabled) {
        const entry = registered.get(id);
        if (!entry) return false;
        entry.enabled = !!enabled;
        return true;
      },
      setProfilingEnabled(enabled) { schedulerDebug.profilingEnabled = !!enabled; },
      getDebug() { return schedulerDebug; },
    },
    localStorage: { getItem: () => null, setItem() {} },
    __farmLog: null,
    performance: { now: () => 1000, memory: undefined },
  };
  const documentObject = {
    readyState: 'complete',
    addEventListener() {},
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, appendChild(){}, addEventListener(){}, classList: { add(){}, remove(){} } }),
    body: { appendChild() {} },
  };
  const sandbox = {
    window: windowObject,
    document: documentObject,
    console,
    performance: windowObject.performance,
    location: { search: '' },
    URLSearchParams,
    setTimeout: () => 0,
    Math, Number, Object, Array, Set, Map, WeakMap, String, JSON, Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'performance-debug.js' });
  return { windowObject, registered, schedulerDebug, api: windowObject.PerfProfiler };
}

// --- lagWatchLoop registers once, unconditionally, from install() ----------
{
  const { registered } = buildFixture();
  const entry = registered.get('performance-debug-lag-watch');
  assert(entry, 'lagWatchLoop registers unconditionally on install()');
  assert.equal(entry.options.owner, 'PerformanceDebug');
  assert.doesNotThrow(() => entry.fn({ timestamp: 2000 }), 'the lag-watch callback must tolerate a fresh sample window without throwing');
}

// --- frameLoop: setFpsEnabled(true) registers and enables it ---------------
{
  const { registered, api } = buildFixture();
  assert(!registered.has('performance-debug-frame-loop'), 'frameLoop must not register before fps/profiler is ever enabled');
  api.setFpsEnabled(true);
  const entry = registered.get('performance-debug-frame-loop');
  assert(entry, 'enabling the FPS counter registers frameLoop with the scheduler');
  assert.equal(entry.enabled, true);
  assert.doesNotThrow(() => entry.fn({ timestamp: 1500 }), 'frameLoop must tolerate a normal frame context without throwing');
}

// --- frameLoop: disabling both toggles it off rather than unregistering ----
{
  const { registered, schedulerDebug, api } = buildFixture();
  api.setFpsEnabled(true);
  const entry = registered.get('performance-debug-frame-loop');
  assert.equal(entry.enabled, true);
  api.setFpsEnabled(false);
  assert.equal(entry.enabled, false, 'disabling the FPS counter (with the profiler also off) must disable the scheduler subscription');
  api.setEnabled(true); // PerfProfiler.setEnabled maps to the internal setProfilerEnabled.
  assert.equal(entry.enabled, true, 'enabling the profiler alone must re-enable the same subscription');
  assert.equal(schedulerDebug.profilingEnabled, true, 'enabling the Performance Profiler enables RuntimeFrameScheduler per-subscriber timing');
  api.setEnabled(false);
  assert.equal(schedulerDebug.profilingEnabled, false, 'disabling the Performance Profiler disables RuntimeFrameScheduler timing overhead');
}

// --- scheduler snapshot separates outside-gameLoop from pre-render ----------
{
  const { schedulerDebug, api } = buildFixture();
  schedulerDebug.profilingEnabled = true;
  schedulerDebug.entries = [
    { id: 'controller', owner: 'ControllerInput', phase: 'input', enabled: true, averageDurationMs: 0.2, lastDurationMs: 0.3, callCount: 10 },
    { id: 'quick', owner: 'Quick', phase: 'pre-game', enabled: true, averageDurationMs: 0.4, lastDurationMs: 0.5, callCount: 10 },
    { id: 'sleep', owner: 'Sleep', phase: 'pre-render', enabled: true, averageDurationMs: 1.5, lastDurationMs: 1.2, callCount: 10 },
    { id: 'stable', owner: 'Stable', phase: 'post-game', enabled: true, averageDurationMs: 2.0, lastDurationMs: 2.2, callCount: 10 },
    { id: 'disabled', owner: 'Disabled', phase: 'post-game', enabled: false, averageDurationMs: 99, lastDurationMs: 99, callCount: 1 },
  ];
  const snap = api.snapshot().scheduler;
  assert(snap, 'PerfProfiler snapshot exposes scheduler timing data');
  assert.ok(Math.abs(snap.phases.input - 0.2) < 1e-9);
  assert.ok(Math.abs(snap.phases['pre-game'] - 0.4) < 1e-9);
  assert.ok(Math.abs(snap.phases['pre-render'] - 1.5) < 1e-9);
  assert.ok(Math.abs(snap.phases['post-game'] - 2.0) < 1e-9);
  assert.ok(Math.abs(snap.outsideGameLoopMs - 2.6) < 1e-9, 'outside-gameLoop total excludes pre-render because checkpoint work is already inside gameLoop');
  assert.equal(snap.subscribers[0].id, 'stable', 'subscriber list is sorted heaviest-first');
  assert.equal(snap.measuredSubscribers, 4, 'disabled subscribers are excluded from measured scheduler totals');
}

console.log('performance debug scheduler migration passed');
