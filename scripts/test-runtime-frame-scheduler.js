#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies scheduler lifecycle, ordering, and migration contracts.
const fs = require('node:fs'); // Loads the browser modules and architecture guide under test.
const vm = require('node:vm'); // Runs the real scheduler against a deterministic browser-frame fixture.

const read = path => fs.readFileSync(path, 'utf8'); // Shared source loader for runtime and structural checks.
const schedulerSource = read('docs/js/runtime-frame-scheduler.js'); // Executed below to test the actual public API.
const frames = new Map(); // Represents the browser's pending RAF queue and proves there is only one shared callback.
const cancelled = []; // Records cancellation when the final subscriber is removed.
const errors = []; // Captures isolated subscriber failures without polluting test output.
let nextFrameHandle = 0; // Supplies deterministic browser RAF handles.
let profileNow = 100; // Supplies deterministic opt-in profiling timestamps.
const context = {
  window: {},
  console: { error: (...args) => errors.push(args) },
  performance: { now: () => profileNow++ },
  requestAnimationFrame(callback) { const id = ++nextFrameHandle; frames.set(id, callback); return id; },
  cancelAnimationFrame(id) { cancelled.push(id); frames.delete(id); },
}; // Minimal browser environment used by the unmodified scheduler.
vm.runInNewContext(schedulerSource, context, { filename: 'runtime-frame-scheduler.js' });
const scheduler = context.window.RuntimeFrameScheduler; // Public API used by feature modules.
const calls = []; // Records subscriber order and shared frame-context identity.
let firstContext = null; // Proves every subscriber receives the same allocation-free context object.
let lateRegistered = false; // Ensures a callback added during dispatch becomes eligible on the following frame only.
assert.equal(frames.size, 0, 'loading the scheduler alone does not start an empty permanent RAF');

scheduler.register('first', frame => {
  firstContext = frame;
  calls.push(['first', frame.frameId, frame.timestamp]);
  if (!lateRegistered) {
    lateRegistered = true;
    scheduler.register('late', lateFrame => calls.push(['late', lateFrame.frameId]));
  }
}, {
  owner: 'FirstRuntime', description: 'first test subscriber',
});
scheduler.register('broken', () => { calls.push(['broken']); throw new Error('expected failure'); }, {
  owner: 'BrokenRuntime', description: 'error-isolation fixture',
});
scheduler.register('last', frame => { calls.push(['last', frame === firstContext]); }, {
  owner: 'LastRuntime', description: 'last test subscriber',
});
assert.equal(frames.size, 1, 'many subscribers share one pending browser RAF');

function runFrame(timestamp) {
  assert.equal(frames.size, 1, 'scheduler owns exactly one browser RAF');
  const [id, callback] = frames.entries().next().value; // Removes the browser callback before replaying native RAF delivery.
  frames.delete(id);
  callback(timestamp);
}

runFrame(1000);
assert.deepEqual(calls, [['first', 1, 1000], ['broken'], ['last', true]], 'stable order and error isolation preserve later subscribers');
assert.equal(errors.length, 1, 'first subscriber failure is reported once');
assert.equal(scheduler.frameId(), 1, 'shared browser-frame serial advances once per RAF');
assert.equal(scheduler.getDebug().entries.find(entry => entry.id === 'late').callCount, 0, 'mid-dispatch registration cannot join the active frame');

calls.length = 0;
scheduler.setEnabled('first', false);
runFrame(1016);
assert.deepEqual(calls, [['broken'], ['last', true], ['late', 2]], 'new subscribers begin next frame while disabled subscribers stop');
assert.equal(errors.length, 1, 'identical repeated failures are console-throttled');

scheduler.setProfilingEnabled(true);
scheduler.register('last', frame => calls.push(['replacement', frame.frameId]), { enabled: true });
assert.equal(scheduler.getDebug().registered, 4, 'registering an existing ID updates rather than duplicates it');
calls.length = 0;
runFrame(1032);
assert.deepEqual(calls, [['broken'], ['replacement', 3], ['late', 3]], 'replacement keeps the original stable registration position');
const debug = scheduler.getDebug(); // Allocated on demand to verify mobile-readable ownership and failure data.
assert.equal(debug.enabled, 3);
assert.equal(debug.entries.find(entry => entry.id === 'broken').errorCount, 3);
assert.equal(debug.entries.find(entry => entry.id === 'broken').callCount, 3, 'failed attempts remain visible in the subscriber call count');
assert(debug.entries.find(entry => entry.id === 'last').averageDurationMs >= 0, 'opt-in profiling exposes subscriber duration');

scheduler.unregister('first');
scheduler.unregister('broken');
scheduler.unregister('last');
scheduler.unregister('late');
assert.equal(frames.size, 0, 'removing the final subscriber cancels the shared RAF');
assert(cancelled.length > 0, 'final unregistration reached cancelAnimationFrame');

const index = read('docs/index.html'); // Guards the shipped bootstrap/load-order contract smaller-context models depend on.
const authority = read('docs/js/controller-input.js'); // Main's current parser bootstrap when index lacks an explicit scheduler tag.
const melee = read('docs/js/combat/melee-hud-reticle.js'); // Guards conservative ownership-only migration.
const ranged = read('docs/js/combat/ranged-hud-reticle.js'); // Guards conservative ownership-only migration.
const quick = read('docs/js/combat/quick-attack-bonus-indicator.js'); // Guards animated fallback cadence ownership.
const guide = read('docs/architecture/runtime-frame-scheduler.md'); // Ensures the extension contract ships beside the runtime.
const authorityAt = index.indexOf('js/controller-input.js?v='); // Used to validate either explicit or parser-bootstrap scheduler startup.
const schedulerAt = index.indexOf('js/runtime-frame-scheduler.js?v='); // Optional explicit load path; current main uses ControllerInput's parser bootstrap.
assert(authorityAt >= 0, 'ControllerInput must remain in the shipped page');
if (schedulerAt >= 0) {
  assert(schedulerAt < authorityAt, 'an explicit scheduler tag must load before ControllerInput');
} else {
  assert(authority.includes('runtime-frame-scheduler.js?v=20260916main1'), 'ControllerInput must parser-bootstrap the scheduler when index omits the explicit tag');
  assert(authority.includes('document.write'), 'the current bootstrap must remain parser-synchronous so later HUD modules cannot race it');
}
for (const [name, source, id] of [
  ['melee', melee, 'melee-hud-reticle'],
  ['ranged', ranged, 'ranged-hud-reticle'],
]) {
  assert(source.includes(`SCHEDULER_ID = '${id}'`), `${name} exposes a stable scheduler identity`);
  assert(source.includes('RuntimeFrameScheduler.register'), `${name} registers with the shared browser-frame owner`);
  assert(!source.includes('requestAnimationFrame('), `${name} no longer owns a private RAF`);
}
assert(!quick.includes('requestAnimationFrame('), 'Quick Attack no longer owns a private RAF');
assert(quick.includes("RuntimeFrameScheduler.register"), 'Quick Attack registers with the shared browser-frame owner');
assert(quick.includes("phase: 'pre-game'"), 'Quick Attack must be on the pre-game phase so it keeps running before gameLoop, now expressed as an explicit phase instead of independent RAF registration order');
const quickAt = index.indexOf('quick-attack-bonus-indicator.js');
const popupAt = index.indexOf('world-popup-text.js');
const gameAt = index.indexOf('<script src="game.js?');
assert(quickAt > popupAt, 'Quick Attack loads only after WorldPopupText exposes avatarCentroidWorld');
assert(quickAt < gameAt, 'Quick Attack still loads before game.js so its pre-game scheduler subscription is ready for gameplay');
assert(melee.includes("document.addEventListener('DOMContentLoaded', init"), 'melee scheduler registration remains after gameLoop setup');
assert(ranged.includes("document.addEventListener('DOMContentLoaded', init"), 'ranged scheduler registration remains after gameLoop setup');
assert(quick.includes('drawProceduralReticle(sight, nowMs)'), 'Quick Attack keeps its animated procedural fallback');
assert(guide.includes('No search through `game.js`'), 'architecture guide explicitly supports local subsystem comprehension');
assert(read('AGENTS.md').includes('docs/architecture/runtime-frame-scheduler.md'), 'root coding instructions route small-context models to the cadence contract');
console.log('runtime frame scheduler, current-main bootstrap, conservative HUD migration, and Quick Attack pre-game migration contracts passed');
