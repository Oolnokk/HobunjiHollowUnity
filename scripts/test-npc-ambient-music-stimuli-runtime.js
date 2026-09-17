#!/usr/bin/env node
'use strict';

// Regression for the Stage 1 RAF-ownership migration: this module used to
// drive its own internally-throttled poll() off a permanent per-browser-frame
// RAF loop. It now drives the identical poll() off a 500ms setInterval
// instead (see docs/architecture/runtime-frame-scheduler.md), which must
// still renew ambient music stimuli well inside their 1500ms duration.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/npc-ambient-music-stimuli-runtime.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'the ambient music stimuli bridge must no longer own a direct requestAnimationFrame( call site');
assert(source.includes('global.setInterval(poll, POLL_MS)'), 'the bridge must drive poll() off a 500ms interval instead');

let now = 0;
const intervals = []; // Records every setInterval registration so the test can advance fake time deterministically.
const emitted = [];
const context = {
  window: {
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {},
  },
  console: { error: () => {}, warn: () => {} },
  performance: { now: () => now },
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'npc-ambient-music-stimuli-runtime.js' });

assert.equal(intervals.length, 1, 'exactly one interval drives poll()');
assert.equal(intervals[0].ms, 500, 'the interval must match the module\'s own POLL_MS constant');

const walkerRoot = { position: { x: 5, z: 7 } };
context.window.NpcSocialStimuli = { emit: payload => emitted.push(payload), clear: () => {} };
context.window.NpcScheduling = {
  listInstrumentPerformers: () => [{ npcId: 'npc-1', area: 'town', songId: 'song-1' }],
};
context.window.NpcAmbientMusicStimuli; // access to confirm install
const deps = { findNpcWalker: () => ({ root: walkerRoot, area: 'town' }) };
context.window.NpcActivityPlanner = { init: injected => { deps.injected = injected; } };
context.window.NpcActivityPlanner.init(deps); // simulates the planner wiring plannerDeps through the chained global.

function fireInterval() { intervals[0].fn(); }

fireInterval(); // t = 0: within the initial 500ms throttle window relative to lastPollAt=0, must not emit yet.
assert.equal(emitted.length, 0, 'the very first tick inside the throttle window must not emit (matches the pre-migration RAF behavior)');

now = 500;
fireInterval();
assert.equal(emitted.length, 1, 'once 500ms has elapsed, the interval tick emits an ambient music stimulus');
assert.equal(emitted[0].durationMs, 1500, 'the emitted stimulus keeps its original 1500ms duration');

now = 900; // Still well inside the 1500ms stimulus duration.
fireInterval(); // Throttled — only 400ms since the last real poll.
assert.equal(emitted.length, 1, 'a tick before 500ms has elapsed since the last poll is still throttled, same as before');

now = 1000; // 500ms after the previous emit — renews before the 1500ms duration would expire at t=2000.
fireInterval();
assert.equal(emitted.length, 2, 'the stimulus renews on the next 500ms tick, comfortably inside its own 1500ms duration');

console.log('npc ambient music stimuli setInterval migration passed');
