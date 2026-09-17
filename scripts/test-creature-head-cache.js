#!/usr/bin/env node
'use strict';

// Regression for the Stage 1 RAF-ownership migration: CreatureHeadCache used
// to own a permanent private requestAnimationFrame loop just to count
// browser frames. It now reads RuntimeFrameScheduler's already-advancing
// frame serial instead (see docs/architecture/runtime-frame-scheduler.md).
// This proves both that the private RAF is really gone and that the cache
// still invalidates exactly once per scheduler frame, not on every call.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const schedulerSource = read('docs/js/runtime-frame-scheduler.js');
const cacheSource = read('docs/js/creature-head-cache.js');

const frames = new Map(); // The browser's pending RAF queue, driven manually below.
let nextFrameHandle = 0;
const rafCalls = []; // Records every requestAnimationFrame(fn) call so we can prove creature-head-cache.js never makes one directly.
const context = {
  window: {},
  console: { error: () => {}, warn: () => {} },
  performance: { now: () => 0 },
  requestAnimationFrame(callback) {
    rafCalls.push(callback);
    const id = ++nextFrameHandle;
    frames.set(id, callback);
    return id;
  },
  cancelAnimationFrame(id) { frames.delete(id); },
};
vm.createContext(context);
vm.runInContext(schedulerSource, context, { filename: 'runtime-frame-scheduler.js' });
vm.runInContext(cacheSource, context, { filename: 'creature-head-cache.js' });

const scheduler = context.window.RuntimeFrameScheduler;
const cache = context.window.CreatureHeadCache;
assert(scheduler, 'scheduler must install itself on window');
assert(cache, 'CreatureHeadCache must install itself on window');
assert.equal(rafCalls.length, 0, 'loading creature-head-cache.js alone must not request a browser frame');

// Mirrors ControllerInput's permanent registration, which is what keeps
// RuntimeFrameScheduler's frame serial advancing on the real shipped page.
scheduler.register('controller-input', () => {}, { owner: 'ControllerInput', description: 'fixture' });
assert.equal(rafCalls.length, 1, 'the scheduler owns exactly one browser RAF; creature-head-cache.js must not add a second one');

function runFrame() {
  const [id, callback] = frames.entries().next().value;
  frames.delete(id);
  callback(performance.now());
}

let computeCount = 0;
const entity = {
  x: 1, y: 2,
  get avatarRef() { // A getter lets the test count how many times getHeadWorld() actually recomputes vs. serves the cache.
    computeCount++;
    return null; // No avatarRef -> _computeAnimalHeadWorld's cheap fallback path, still enough to prove call counting.
  },
};

runFrame(); // Frame 1.
const first = cache.getHeadWorld(entity, 'creature');
const second = cache.getHeadWorld(entity, 'creature');
assert.equal(computeCount, 1, 'two calls within the same scheduler frame must compute the head position once');
assert.equal(first, second, 'both calls within the same frame return the identical cached object');

runFrame(); // Frame 2 — the scheduler's own frame serial has now advanced.
const third = cache.getHeadWorld(entity, 'creature');
assert.equal(computeCount, 2, 'a call in a new scheduler frame must recompute rather than reuse the previous frame\'s cache entry');
assert.notEqual(third, first, 'a fresh frame yields a fresh cached object');

// The scheduler reschedules itself once per frame it drives (1 initial
// schedule + 1 per runFrame() call above == 3); if creature-head-cache.js
// requested a browser frame of its own, this count would be higher.
assert.equal(rafCalls.length, 3, 'across multiple frames, creature-head-cache.js still never requests its own browser frame');
assert(!cacheSource.includes('requestAnimationFrame('), 'creature-head-cache.js must not contain any direct requestAnimationFrame( call site');

// Before any scheduler subscriber exists at all (frameId() stays 0), the
// cache must still work rather than throwing — same graceful behavior a
// standalone/test context relying on the optional-chaining fallback needs.
const freshContext = {
  window: {},
  console: { error: () => {}, warn: () => {} },
  performance: { now: () => 0 },
};
vm.createContext(freshContext);
vm.runInContext(cacheSource, freshContext, { filename: 'creature-head-cache.js' });
const isolatedResult = freshContext.window.CreatureHeadCache.getHeadWorld({ x: 0, y: 0 }, 'creature');
assert(isolatedResult && typeof isolatedResult.worldY === 'number', 'getHeadWorld works even with no RuntimeFrameScheduler present at all (frameId() falls back to 0)');

console.log('creature head cache scheduler-driven frame token migration passed');
