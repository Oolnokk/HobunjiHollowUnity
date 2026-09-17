#!/usr/bin/env node
'use strict';

// Stage 4 (scheduler v2) contract test: proves the frame-order guarantees
// docs/architecture/runtime-frame-scheduler.md documents before anything
// sensitive (Quick Attack, hand/social runtimes) is allowed to depend on
// them. One frame must dispatch, in this exact order:
//   input subscribers -> pre-game subscribers -> the frame driver (which
//   itself calls checkpoint('pre-render') at the right internal point) ->
//   post-game subscribers.
// This file is deliberately the single source of truth for that ordering
// contract; a future change to runtime-frame-scheduler.js should be able
// to re-run this file alone and trust a pass means the contract still holds.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const schedulerSource = fs.readFileSync('docs/js/runtime-frame-scheduler.js', 'utf8');

function buildScheduler() {
  const frames = new Map();
  const cancelled = [];
  const errors = [];
  let nextFrameHandle = 0;
  const context = {
    window: {},
    console: { error: (...args) => errors.push(args) },
    performance: { now: () => 0 },
    requestAnimationFrame(callback) { const id = ++nextFrameHandle; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { cancelled.push(id); frames.delete(id); },
  };
  vm.runInNewContext(schedulerSource, context, { filename: 'runtime-frame-scheduler.js' });
  const scheduler = context.window.RuntimeFrameScheduler;
  function runFrame(timestamp) {
    assert.equal(frames.size, 1, 'scheduler owns exactly one browser RAF at the moment a frame fires');
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback(timestamp);
  }
  return { scheduler, frames, cancelled, errors, runFrame };
}

// --- The exact documented order, driven by a fixture frame driver -------
{
  const { scheduler, runFrame } = buildScheduler();
  const log = [];
  const contexts = [];

  scheduler.register('input-a', ctx => { log.push('input-A'); contexts.push(ctx); }, { phase: 'input', owner: 'test' });
  scheduler.register('input-b', ctx => { log.push('input-B'); contexts.push(ctx); }, { phase: 'input', owner: 'test' });
  scheduler.register('pre-game-a', ctx => { log.push('pre-game-A'); contexts.push(ctx); }, { phase: 'pre-game', owner: 'test' });
  scheduler.register('pre-render-a', ctx => { log.push('pre-render-A'); contexts.push(ctx); }, { phase: 'pre-render', owner: 'test' });
  scheduler.register('post-game-a', ctx => { log.push('post-game-A'); contexts.push(ctx); }, { phase: 'post-game', owner: 'test' });

  scheduler.setFrameDriver(() => {
    log.push('GAME-START');
    log.push('PRE-RENDER');
    scheduler.checkpoint('pre-render');
    log.push('RENDER');
    log.push('GAME-END');
  });

  runFrame(1000);
  assert.deepEqual(log, [
    'input-A', 'input-B',
    'pre-game-A',
    'GAME-START', 'PRE-RENDER', 'pre-render-A', 'RENDER', 'GAME-END',
    'post-game-A',
  ], 'one frame dispatches input, then pre-game, then the frame driver (which triggers pre-render via checkpoint at its own chosen point), then post-game');

  // Frame context object is reused, not reallocated per phase or per subscriber.
  assert(contexts.length === 5);
  for (const ctx of contexts) assert.equal(ctx, contexts[0], 'every subscriber in the same frame receives the identical reused frameContext object');
  assert.equal(contexts[0].frameId, 1, 'frameId increments once for the whole frame, not once per phase or subscriber');
}

// --- Within one phase, registration order is stable -----------------------
{
  const { scheduler, runFrame } = buildScheduler();
  const log = [];
  scheduler.register('post-b', () => log.push('post-B'), { phase: 'post-game' });
  scheduler.register('post-a', () => log.push('post-A'), { phase: 'post-game' });
  scheduler.register('post-c', () => log.push('post-C'), { phase: 'post-game' });
  runFrame(1000);
  assert.deepEqual(log, ['post-B', 'post-A', 'post-C'], 'subscribers within one phase run in the order they were registered, not alphabetically or by id');
}

// --- register() / checkpoint() reject bad input --------------------------
{
  const { scheduler } = buildScheduler();
  assert.throws(() => scheduler.register('bad-phase', () => {}, { phase: 'visual' }), /unknown phase/, 'register() rejects a phase outside the documented four');
  assert.throws(() => scheduler.checkpoint('input'), /is not a checkpoint phase/, 'checkpoint() rejects a valid phase name that is not the pre-render checkpoint');
  assert.throws(() => scheduler.checkpoint('nonsense'), /unknown phase/, 'checkpoint() rejects an unrecognized name entirely');
  assert.throws(() => scheduler.checkpoint('pre-render'), /outside an active frame driver/, 'checkpoint("pre-render") called outside any dispatched frame is rejected');
}

// --- checkpoint('pre-render') cannot fire twice in the same frame --------
{
  const { scheduler, runFrame, errors } = buildScheduler();
  let secondCallThrew = null;
  let secondFrameThrew = null;
  let frameNumber = 0;
  scheduler.register('pre-render-a', () => {}, { phase: 'pre-render' });
  scheduler.setFrameDriver(() => {
    frameNumber++;
    scheduler.checkpoint('pre-render');
    if (frameNumber === 1) {
      try { scheduler.checkpoint('pre-render'); } catch (error) { secondCallThrew = error; }
    } else {
      try { scheduler.checkpoint('pre-render'); } catch (error) { secondFrameThrew = error; }
    }
  });
  runFrame(1000);
  assert(secondCallThrew && /twice in the same frame/.test(secondCallThrew.message), 'a second checkpoint("pre-render") within the same frame driver call throws');

  // A fresh frame must allow exactly one checkpoint call again: the first
  // checkpoint() call in frame 2 above succeeds silently, and only the
  // *second* one in that same frame (deliberately triggered again) throws.
  runFrame(1016);
  assert(secondFrameThrew && /twice in the same frame/.test(secondFrameThrew.message), 'the pre-render checkpoint guard resets on the next frame — the first call succeeds, only a repeat within that frame throws');
}

// --- setFrameDriver: exactly one driver ------------------------------------
{
  const { scheduler } = buildScheduler();
  const driverA = () => {};
  const driverB = () => {};
  scheduler.setFrameDriver(driverA);
  assert.doesNotThrow(() => scheduler.setFrameDriver(driverA), 'setting the same frame driver again (e.g. a dev reload of the same script) is idempotent');
  assert.throws(() => scheduler.setFrameDriver(driverB), /a frame driver is already set/, 'setting a second, different frame driver is rejected — exactly one gameplay RAF cadence owner is allowed');
}

// --- A throwing subscriber does not block later phases or subscribers ----
{
  const { scheduler, runFrame, errors } = buildScheduler();
  const log = [];
  scheduler.register('pre-game-broken', () => { log.push('pre-game-broken'); throw new Error('boom'); }, { phase: 'pre-game' });
  scheduler.register('pre-game-after', () => log.push('pre-game-after'), { phase: 'pre-game' });
  scheduler.register('post-game-a', () => log.push('post-game-a'), { phase: 'post-game' });
  scheduler.setFrameDriver(() => log.push('driver-ran'));
  runFrame(1000);
  assert.deepEqual(log, ['pre-game-broken', 'pre-game-after', 'driver-ran', 'post-game-a'], 'a throwing subscriber does not stop later subscribers in the same phase, the frame driver, or later phases');
  assert.equal(errors.length, 1, 'the throwing subscriber\'s error is reported once');
}

// --- A throwing frame driver does not strand the scheduler ----------------
// Uses one stable driver reference across both frames (setFrameDriver
// deliberately rejects swapping to a *different* function — see the
// "exactly one driver" test above — so recovery here comes from the driver
// itself no longer throwing on frame 2, not from replacing it).
{
  const { scheduler, runFrame, frames, errors } = buildScheduler();
  const log = [];
  let frameNumber = 0;
  scheduler.register('post-game-a', () => log.push('post-game-a'), { phase: 'post-game' });
  scheduler.setFrameDriver(() => {
    frameNumber++;
    log.push(`driver-frame-${frameNumber}`);
    if (frameNumber === 1) throw new Error('simulation exploded');
  });
  runFrame(1000);
  assert.deepEqual(log, ['driver-frame-1', 'post-game-a'], 'post-game subscribers still run in the same frame even though the driver threw');
  assert.equal(frames.size, 1, 'the next browser frame is still scheduled after a driver failure');
  assert.equal(scheduler.getDebug().frameDriverErrorCount, 1, 'the driver failure is recorded in diagnostics');
  assert(scheduler.getDebug().frameDriverLastError.includes('simulation exploded'));

  runFrame(1016);
  assert.deepEqual(log, ['driver-frame-1', 'post-game-a', 'driver-frame-2', 'post-game-a'], 'the scheduler keeps dispatching normal frames after a driver failure');
}

// --- Registration during dispatch does not join the active frame ---------
{
  const { scheduler, runFrame } = buildScheduler();
  const log = [];
  let lateRegistered = false;
  scheduler.register('input-a', () => {
    log.push('input-a');
    if (!lateRegistered) {
      lateRegistered = true;
      scheduler.register('late', () => log.push('late'), { phase: 'input' });
    }
  }, { phase: 'input' });
  runFrame(1000);
  assert.deepEqual(log, ['input-a'], 'a subscriber registered mid-dispatch does not run until the next frame');
  runFrame(1016);
  assert.deepEqual(log, ['input-a', 'input-a', 'late'], 'the late subscriber joins starting on the very next frame');
}

// --- Unregistering during dispatch cannot corrupt iteration ---------------
{
  const { scheduler, runFrame } = buildScheduler();
  const log = [];
  scheduler.register('post-a', () => {
    log.push('post-a');
    scheduler.unregister('post-c'); // Removes a not-yet-visited same-phase subscriber mid-dispatch.
  }, { phase: 'post-game' });
  scheduler.register('post-b', () => log.push('post-b'), { phase: 'post-game' });
  scheduler.register('post-c', () => log.push('post-c'), { phase: 'post-game' });
  assert.doesNotThrow(() => runFrame(1000), 'unregistering a same-phase subscriber mid-dispatch does not throw or corrupt iteration');
  assert.deepEqual(log, ['post-a', 'post-b'], 'the unregistered subscriber does not run in the frame that removed it, and the surviving one still runs');
}

// --- Disabling a subscriber stops execution but keeps its diagnostics ----
{
  const { scheduler, runFrame } = buildScheduler();
  let calls = 0;
  scheduler.register('post-a', () => { calls++; }, { phase: 'post-game', owner: 'TestOwner', description: 'test subscriber' });
  runFrame(1000);
  assert.equal(calls, 1);
  scheduler.setEnabled('post-a', false);
  runFrame(1016);
  assert.equal(calls, 1, 'a disabled subscriber does not execute');
  const entry = scheduler.getDebug().entries.find(e => e.id === 'post-a');
  assert(entry, 'a disabled subscriber is still visible in diagnostics');
  assert.equal(entry.enabled, false);
  assert.equal(entry.owner, 'TestOwner');
  assert.equal(entry.callCount, 1, 'call history from before disabling is preserved, not reset');
}

// --- Omitting phase defaults sensibly rather than throwing ---------------
{
  const { scheduler, runFrame } = buildScheduler();
  const log = [];
  scheduler.register('no-phase', () => log.push('ran'), { owner: 'test' });
  runFrame(1000);
  assert.deepEqual(log, ['ran']);
  assert.equal(scheduler.getDebug().entries[0].phase, 'post-game', 'a subscriber registered without an explicit phase defaults to post-game');
}

console.log('runtime frame scheduler v2 ordering contract passed');
