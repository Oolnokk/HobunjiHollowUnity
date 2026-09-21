#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of title-screen-runtime.js's
// pollGamepad: a bounded wait-for-input poll (rescheduling itself every
// frame purely to detect a gamepad button press that starts the game,
// stopping entirely once the title screen becomes inactive) becomes a
// real 50ms setInterval instead, since it never needed per-frame cadence.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/title-screen-runtime.js', 'utf8');
const onboardingCss = fs.readFileSync('docs/onboarding.css', 'utf8');
const onboardingCore = fs.readFileSync('docs/onboarding-core.js', 'utf8');
const loadingSource = fs.readFileSync('docs/js/loading-screen-runtime.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.match(onboardingCss, /#ob-overlay button,\s*#ob-overlay button \*\s*\{[\s\S]*?text-shadow:/,
  'onboarding button labels must receive their black outline explicitly rather than relying on form-control inheritance');
assert(!/requestAnimationFrame\(\(\) => pollGamepad/.test(source), 'pollGamepad must no longer self-schedule a raw requestAnimationFrame');
assert(!source.includes('cancelAnimationFrame(gamepadPollRaf)'), 'stopping the poll must no longer cancel a raw animation frame');
assert(source.includes('gamepadPollRaf = setInterval(() => pollGamepad(realGetGamepads), 50)'), 'pollGamepad must be driven by a real setInterval instead');
assert(source.includes('clearInterval(gamepadPollRaf)'), 'stopping the poll must clear the setInterval instead');
assert.match(source, /hobunji-preworld-sky-active/, 'title runtime must mark the shared pre-world sky lifecycle');
assert.match(source, /releaseBackdrop/, 'title runtime must expose an explicit gameplay handoff for the shared sky');
assert.match(onboardingCss, /html\.hobunji-preworld-sky-active #ob-overlay\s*\{\s*background:\s*transparent;/,
  'onboarding must reveal the shared sky only while the pre-world lifecycle is active');
assert.match(loadingSource, /html\.hobunji-preworld-sky-active #hobunjiLoadScreen\s*\{background:transparent\}/,
  'loading screens must reveal the shared sky only before gameplay begins');
assert.match(loadingSource, /#hobunjiLoadScreen\.suppressed-by-onboarding\{visibility:hidden\}/,
  'loading-screen art and Tankan text must be fully hidden while onboarding owns the foreground');
assert.match(loadingSource, /html\.hobunji-onboarding-foreground #hlsScriptViewport\{visibility:hidden!important\}/,
  'Tankan columns must be synchronously hidden by the onboarding foreground class');
assert.match(loadingSource, /html\.hobunji-onboarding-foreground #hobunjiLoadScreen\{visibility:hidden\}/,
  'the loading overlay must synchronously yield before the onboarding overlay is painted');
const mountHelper = onboardingCore.match(/function mountOnboardingOverlay\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert(mountHelper.indexOf("classList?.add('hobunji-onboarding-foreground')") >= 0,
  'onboarding mount must claim the foreground class');
assert(mountHelper.indexOf("classList?.add('hobunji-onboarding-foreground')") < mountHelper.indexOf("document.body.appendChild(overlay)"),
  'onboarding must claim the foreground before inserting the overlay, eliminating a one-frame Tankan flash');
assert.match(loadingSource, /new MutationObserver\(\(\) => syncOnboardingForeground\(\)\)/,
  'loading runtime must react when the direct onboarding overlay mounts or is removed');
assert.match(loadingSource, /document\.getElementById\?\.\('ob-overlay'\)/,
  'loading suppression must be keyed to the actual onboarding overlay rather than timing guesses');
assert.match(gameSource, /let preworldBackdropReleased = false;/,
  'the game loop must track the one-time pre-world backdrop handoff');
assert.doesNotMatch(gameSource, /window\.__hobunjiGameStarted = true;\s*window\.HobunjiTitleScreen/,
  'hydration must not tear down the shared sky before the first world frame is drawn');
assert.match(gameSource, /window\.HudUpdate\.updateHud\(\);[\s\S]{0,500}window\.HobunjiTitleScreen\.releaseBackdrop\('first-world-frame'\)/,
  'the shared sky must release only after the first hydrated world frame and HUD have been drawn');

function buildFixture(pads) {
  const intervals = [];
  const timeouts = [];
  const classList = new Set(['title-fixture']);
  const skyState = { starts: 0, destroys: 0 }; // Used to verify the shared sky survives title exit and tears down exactly once at gameplay handoff.
  const documentObject = {
    readyState: 'complete',
    documentElement: {
      classList: {
        add: (...c) => c.forEach(x => classList.add(x)),
        remove: (...c) => c.forEach(x => classList.delete(x)),
        contains: (name) => classList.has(name),
      },
      style: {},
    },
    createElement: () => ({ style: {}, sheet: { insertRule() {} }, setAttribute(){}, appendChild(){} }),
    head: { appendChild() {} },
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const windowObject = {
    navigator: { getGamepads: () => pads },
    setTimeout(fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval(id) { const entry = intervals[id - 1]; if (entry) entry.cleared = true; },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    FontFace: class FontFace { load() { return Promise.resolve(this); } },
    fonts: { add() {} },
    HobunjiTitleRealtimeSky: {
      installed: true,
      start() { skyState.starts += 1; },
      destroy() { skyState.destroys += 1; },
      getDebug() { return { active: skyState.destroys === 0 }; },
    },
  };
  windowObject.window = windowObject;
  windowObject.navigator = windowObject.navigator;
  const sandbox = {
    window: windowObject,
    document: documentObject,
    navigator: windowObject.navigator,
    console,
    Object, Array, Set, Map, Math, Number, String, JSON, Promise,
    CustomEvent: windowObject.CustomEvent,
    FontFace: windowObject.FontFace,
    setTimeout: windowObject.setTimeout,
    setInterval: windowObject.setInterval,
    clearInterval: windowObject.clearInterval,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'title-screen-runtime.js' });
  return { windowObject, intervals, timeouts, classList, skyState, api: windowObject.HobunjiTitleScreen };
}

// --- Module load starts exactly one 50ms setInterval poll -------------------
{
  const { intervals } = buildFixture([]);
  assert.equal(intervals.length, 1, 'module load starts exactly one setInterval poll');
  assert.equal(intervals[0].ms, 50, 'the poll runs on the documented 50ms cadence');
}

// --- The shared sky survives title exit until gameplay is hydrated ----------
{
  const { timeouts, classList, skyState, api } = buildFixture([]);
  assert.equal(skyState.starts, 1, 'the real-time sky starts once during title boot');
  assert.equal(classList.has('hobunji-preworld-sky-active'), true, 'pre-world lifecycle class is present during title/onboarding');
  api.start();
  timeouts[timeouts.length - 1].fn(); // Completes the title fade without a hydrated world.
  assert.equal(api.isActive(), false, 'title input gate ends after the exit fade');
  assert.equal(skyState.destroys, 0, 'title exit alone must not destroy the shared sky');
  assert.equal(classList.has('hobunji-preworld-sky-active'), true, 'sky lifecycle stays active for onboarding/loading');
  assert.equal(api.releaseBackdrop('game-started'), true, 'gameplay handoff releases the shared sky');
  assert.equal(skyState.destroys, 1, 'gameplay handoff destroys the sky exactly once');
  assert.equal(classList.has('hobunji-preworld-sky-active'), false, 'gameplay handoff removes the transparent-overlay lifecycle class');
  api.releaseBackdrop('duplicate-game-started');
  assert.equal(skyState.destroys, 1, 'duplicate gameplay handoffs cannot destroy the sky twice');
}

// --- A returning save may hydrate before the title is dismissed -------------
{
  const { timeouts, skyState, api } = buildFixture([]);
  assert.equal(api.releaseBackdrop('game-started'), false, 'hydration cannot remove the sky while the title is still active');
  assert.equal(skyState.destroys, 0, 'early hydration keeps the title sky visible');
  api.start();
  timeouts[timeouts.length - 1].fn();
  assert.equal(skyState.destroys, 1, 'pending hydration releases the sky immediately after title exit');
}

// --- A rising-edge gamepad button press starts the game ---------------------
{
  const pad = { buttons: [{ pressed: false }], axes: [0, 0] };
  const { intervals, api } = buildFixture([pad]);
  intervals[0].fn(); // Primes the poll with the initial (not-pressed) snapshot.
  pad.buttons[0].pressed = true;
  intervals[0].fn(); // Rising edge detected here.
  assert.equal(api.isActive(), true, 'the title screen stays active through the exit fade window');
}

// --- Stopping the title screen clears the setInterval poll ------------------
{
  const { intervals, timeouts, api } = buildFixture([]);
  api.start();
  assert.equal(intervals[0].cleared, undefined, 'the interval is only cleared once the exit-fade setTimeout fires');
  timeouts[timeouts.length - 1].fn(); // Fires the EXIT_MS setTimeout inside beginStart.
  assert.equal(intervals[0].cleared, true, 'ending the title screen clears the setInterval poll');
}

console.log('title screen runtime gamepad poll timer conversion passed');
