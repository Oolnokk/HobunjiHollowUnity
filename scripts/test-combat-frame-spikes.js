'use strict';

// Exercise the real opt-in mobile profiler with a deterministic frame clock.
// No browser/devtools/GPU required: node scripts/test-combat-frame-spikes.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/performance-debug.js', 'utf8'); // Actual shipped profiler, not a mock implementation.
let clock = 1000; // Controlled performance.now() for exclusive-time and inter-frame tests.
const renderer = { render() {}, info: {} }; // Prevents deferred renderer installation during this headless test.
const runtime = { register() {}, setEnabled() {}, setProfilingEnabled() {} }; // Scheduler stub: no additional tick or rAF.
const win = {
  __hobunjiGameRenderer: renderer,
  RuntimeFrameScheduler: runtime,
  localStorage: { getItem() { return null; }, setItem() {} },
  performance: { now: () => clock },
};
const doc = {
  readyState: 'loading', addEventListener() {}, getElementById() { return null; },
  createElement() { return { style: {}, dataset: {} }; },
  body: { appendChild() {} },
};
vm.runInNewContext(source, { window: win, document: doc, performance: win.performance, console }, { filename: 'performance-debug.js' });
const profiler = win.PerfProfiler;
assert.ok(profiler, 'performance-debug installs its existing public API');
assert.equal(profiler.begin('gameLoop total'), null, 'ordinary gameplay has no timing tokens');
profiler.count('ringRebuilds');
assert.equal(profiler.combatSpikeSnapshot().sampledFrames, 0, 'disabled metric capture is a no-op');

profiler.setEnabled(true);
let frame = profiler.begin('gameLoop total');
clock += 10;
profiler.end(frame);
let state = profiler.combatSpikeSnapshot();
assert.equal(state.sampledFrames, 1);
assert.equal(state.cpuSpikeFrames, 0);
assert.equal(state.recent.length, 0, 'normal frames do not retain expensive detail');
assert.equal(Object.hasOwn(state.latest, 'top'), false, 'ordinary frames skip sorting the detailed breakdown');

// Measure a 42ms game loop: hostiles (28ms) contain 16ms of bandit AI.
clock += 10;
frame = profiler.begin('gameLoop total');
clock += 2;
const hostiles = profiler.begin('hostiles');
clock += 8;
const bandit = profiler.begin('Combat: bandit tactical AI');
clock += 16;
profiler.end(bandit);
clock += 4;
profiler.end(hostiles);
profiler.count('ringRebuilds', 3);
profiler.count('afterimageSnapshots');
profiler.gauge('hostiles', 16);
profiler.gauge('engagedHostiles', 9);
const render = profiler.begin('render passes');
clock += 10;
profiler.end(render);
clock += 2;
profiler.end(frame);
state = profiler.combatSpikeSnapshot();
assert.equal(state.cpuSpikeFrames, 1);
assert.equal(state.intervalSpikeFrames, 0);
assert.equal(state.recent.length, 1);
assert.equal(state.recent[0].reason, 'cpu');
assert.equal(state.recent[0].cpuMs, 42);
assert.equal(state.recent[0].renderPassCpuMs, 10);
assert.equal(state.recent[0].counts.ringRebuilds, 3);
assert.equal(state.recent[0].counts.afterimageSnapshots, 1);
assert.equal(state.recent[0].gauges.engagedHostiles, 9);
assert.equal(state.recent[0].top.find(entry => entry.name === 'hostiles').exclusiveMs, 12, 'child bandit AI must not be double-counted as hostiles');
assert.equal(state.recent[0].top.find(entry => entry.name === 'Combat: bandit tactical AI').exclusiveMs, 16);
assert.equal(state.recent[0].top.find(entry => entry.name === 'render passes').exclusiveMs, 10);
assert.equal(state.recent[0].top.find(entry => entry.name === 'gameLoop uninstrumented').exclusiveMs, 4, 'remaining game-loop CPU is reported rather than silently omitted');
assert.equal(profiler.snapshot().combatSpikes.cpuSpikeFrames, 1, 'existing copyable performance snapshot includes the capture');

// A delayed start belongs to the PREVIOUS frame; the current CPU work may
// still be fast, so do not label this as a current-frame CPU spike.
clock += 80;
frame = profiler.begin('gameLoop total');
clock += 18;
profiler.end(frame);
state = profiler.combatSpikeSnapshot();
assert.equal(state.cpuSpikeFrames, 1);
assert.equal(state.intervalSpikeFrames, 1);
assert.equal(state.recent[1].reason, 'interval-only (preceding frame)');
assert.equal(state.recent[1].cpuMs, 18);

// History must remain bounded even during sustained lag.
for (let i = 0; i < 20; i++) {
  clock += 17;
  frame = profiler.begin('gameLoop total');
  clock += 40;
  profiler.end(frame);
}
state = profiler.combatSpikeSnapshot();
assert.equal(state.recent.length, 12, 'circular recent history stays bounded');
assert.equal(state.cpuSpikeFrames, 21);
assert.ok(state.worstCpu, 'slowest retained CPU sample is available to mobile export');

profiler.resetCombatSpikes();
state = profiler.combatSpikeSnapshot();
assert.equal(state.sampledFrames, 0);
assert.equal(state.recent.length, 0);
profiler.setEnabled(false);
assert.equal(profiler.begin('gameLoop total'), null, 'disabled mode does no profiling');
profiler.count('ringRebuilds');
assert.equal(profiler.combatSpikeSnapshot().sampledFrames, 0);
console.log('combat slow-frame attribution tests passed');
