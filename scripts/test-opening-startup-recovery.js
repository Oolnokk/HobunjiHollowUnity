'use strict';
const assert = require('node:assert/strict'); // Verifies slow-start, retry and required-opening fallback behavior below.
const fs = require('node:fs'); // Reads the shipping opening-story source exactly as the browser receives it.
const vm = require('node:vm'); // Executes the browser module against deterministic mobile-style startup fixtures.
const source = fs.readFileSync('docs/js/opening-story-cutscene.js', 'utf8'); // Shared source under test for every startup scenario.
const npcRecords = ['jubmir', 'father_hunundi_hodu', 'spearhead_unumanuk', 'khannibarri_agent'].map(id => ({ id })); // Supplies every story-critical NPC required before rescue setup.

function storage() {
  const values = new Map(); // Persists the per-world pending/complete keys during one deterministic test boot.
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function successfulRuntime(onRescueRun = null) {
  return { // Completes the two authored scenes without reproducing the large live cutscene engine.
    preloadOpeningMeeting: async () => {},
    placeOutsideTemple: async () => {},
    run: async (payload, options) => {
      if (payload.title === 'Rescue') {
        onRescueRun?.();
        await options.onEnvironmentReady?.();
        await options.onActorsReady?.();
        await options.onReady?.();
        return;
      }
      options.onDialogueContinue?.({ id: 'meeting_hunundi_final' });
    },
  };
}

function basicDocument(onPlayerReady = null) {
  return { // Minimal DOM used by successful starts; failure UI is exercised by the dedicated fixture below.
    addEventListener(name, handler) { if (name === 'hobunjiPlayerReady') onPlayerReady?.(handler); },
    getElementById() { return null; },
    createElement() { throw new Error('Failure UI should not be created in this scenario.'); },
    body: { appendChild() {} },
  };
}

async function testSlowMobileRuntime() {
  let clock = 0; // Advances only through waitForGameRuntime polling to reproduce a >30 second cold boot instantly.
  const context = { // Browser globals used by the opening module while the gameplay runtime appears late.
    window: {
      __hobunjiGameStarted: false,
      LocalDBOverrides: { loadDatabase: async () => ({ npcs: npcRecords }) },
    },
    document: basicDocument(),
    localStorage: storage(),
    performance: { now: () => clock },
    console,
    setTimeout(fn, ms) {
      clock += Number(ms) || 0;
      if (clock >= 31000 && !context.window.AuthoredCutsceneRuntime) {
        context.window.AuthoredCutsceneRuntime = successfulRuntime();
        context.window.__hobunjiGameStarted = true;
      }
      queueMicrotask(fn);
    },
  };
  vm.runInNewContext(source, context, { filename: 'opening-story-cutscene.js' });
  const result = await context.window.OpeningStoryCutscene.play({ characterId: 'slow-owner', worldId: 'slow-world' }); // Public replay path still exercises identical runtime waiting and rescue setup.
  assert.equal(result, true, 'a runtime that becomes ready after the old 30s deadline must still enter the rescue');
  assert(clock >= 31000, 'fixture must actually cross the previous 30 second timeout');
  assert(context.window.OpeningStoryCutscene.debugSnapshot().runtimeWaitMs >= 31000, 'mobile diagnostics record the slow runtime wait');
}

async function testTransientRescueSetupRetry() {
  let rescueRuns = 0; // Counts live rescue setup attempts so the pre-reveal retry is observable.
  const runtime = successfulRuntime(() => { // First setup fails before any readiness hook; second attempt must recover automatically.
    rescueRuns += 1;
    if (rescueRuns === 1) throw new Error('transient mini-wilderness setup failure');
  });
  const context = { // Immediate gameplay runtime isolates the rescue retry from the slow-start test above.
    window: {
      __hobunjiGameStarted: true,
      AuthoredCutsceneRuntime: runtime,
      LocalDBOverrides: { loadDatabase: async () => ({ npcs: npcRecords }) },
    },
    document: basicDocument(),
    localStorage: storage(),
    performance: { now: () => 0 },
    console,
    setTimeout: fn => queueMicrotask(fn),
  };
  vm.runInNewContext(source, context, { filename: 'opening-story-cutscene.js' });
  const result = await context.window.OpeningStoryCutscene.play({ characterId: 'retry-owner', worldId: 'retry-world' }); // Uses replay only to get a directly awaitable public Promise.
  const debug = context.window.OpeningStoryCutscene.debugSnapshot(); // Confirms the retry was the guarded pre-reveal path rather than duplicate scene playback.
  assert.equal(result, true);
  assert.equal(rescueRuns, 2);
  assert.equal(debug.setupAttempts, 2);
  assert.equal(debug.startupRetries, 1);
}

async function testRequiredOpeningNeverFallsThroughToTown() {
  let playerReadyHandler = null; // Captures the private required-opening listener so this test uses the real non-replay path.
  let animationFrames = 0; // clearBootCover would increment this, exposing the old town-fallback behavior.
  const nodes = new Map(); // Tracks the black failure/retry surface created after all safe setup retries are exhausted.
  const fade = { style: {} }; // Represents the shared cutscene cover that must remain opaque on required-opening failure.
  const document = { // Small DOM implementation supports the mobile-visible startup failure panel.
    addEventListener(name, handler) { if (name === 'hobunjiPlayerReady') playerReadyHandler = handler; },
    getElementById(id) { if (id === 'cutscenePreviewFade') return fade; return nodes.get(id) || null; },
    createElement() {
      const events = new Map(); // Stores Retry click wiring without requiring a browser DOM implementation.
      return {
        id: '', type: '', textContent: '', disabled: false, style: {}, events,
        addEventListener(name, handler) { events.set(name, handler); },
        append() {},
        remove() { if (this.id) nodes.delete(this.id); },
      };
    },
    body: { appendChild(node) { if (node.id) nodes.set(node.id, node); } },
  };
  const worldStorage = storage(); // Keeps the listener-written 'pending' marker visible to the failure handler.
  const context = { // Rescue setup always fails before reveal, forcing the protected required-opening failure path.
    window: {
      __hobunjiGameStarted: true,
      CutscenePreviewHelpers: { cutscenePreviewFadeEl: () => fade },
      LocalDBOverrides: { loadDatabase: async () => ({ npcs: npcRecords }) },
      AuthoredCutsceneRuntime: {
        preloadOpeningMeeting: async () => {},
        run: async payload => { if (payload.title === 'Rescue') throw new Error('persistent rescue setup failure'); },
      },
    },
    document,
    localStorage: worldStorage,
    performance: { now: () => 0 },
    console,
    requestAnimationFrame(fn) { animationFrames += 1; fn(); },
    setTimeout: fn => queueMicrotask(fn),
    queueMicrotask,
    CustomEvent: class {},
  };
  vm.runInNewContext(source, context, { filename: 'opening-story-cutscene.js' });
  assert.equal(typeof playerReadyHandler, 'function');
  playerReadyHandler({ detail: { characterId: 'blocked-owner', worldId: 'blocked-world', isWorldOwner: true } });
  await Promise.resolve(); // Lets the listener's queued opening start before polling its running state.
  for (let tick = 0; tick < 100 && context.window.OpeningStoryCutscene.debugSnapshot().running; tick += 1) await Promise.resolve();
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve(); // Drains the final retry/catch/finally microtasks deterministically.
  const debug = context.window.OpeningStoryCutscene.debugSnapshot(); // Required failure must remain pending and visibly blocked rather than uncovering gameplay.
  assert.equal(debug.phase, 'blocked');
  assert.equal(debug.pending, true);
  assert.equal(debug.setupAttempts, 3);
  assert.equal(debug.startupRetries, 2);
  assert.equal(fade.style.opacity, '1');
  assert.equal(animationFrames, 0, 'required-opening failure must never call clearBootCover and reveal the town spawn');
  assert(nodes.has('openingStoryStartupFailure'), 'mobile player receives an in-game Retry surface instead of a silent town fallback');
}

(async () => {
  await testSlowMobileRuntime();
  await testTransientRescueSetupRetry();
  await testRequiredOpeningNeverFallsThroughToTown();
  console.log('Opening startup recovery passed: slow mobile runtime, pre-reveal retry, and no town fall-through');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
