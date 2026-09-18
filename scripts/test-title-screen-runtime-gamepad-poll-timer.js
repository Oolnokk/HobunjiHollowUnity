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
assert(!/requestAnimationFrame\(\(\) => pollGamepad/.test(source), 'pollGamepad must no longer self-schedule a raw requestAnimationFrame');
assert(!source.includes('cancelAnimationFrame(gamepadPollRaf)'), 'stopping the poll must no longer cancel a raw animation frame');
assert(source.includes('gamepadPollRaf = setInterval(() => pollGamepad(realGetGamepads), 50)'), 'pollGamepad must be driven by a real setInterval instead');
assert(source.includes('clearInterval(gamepadPollRaf)'), 'stopping the poll must clear the setInterval instead');

function buildFixture(pads) {
  const intervals = [];
  const timeouts = [];
  const classList = new Set(['title-fixture']);
  const documentObject = {
    readyState: 'complete',
    documentElement: {
      classList: { add: (...c) => c.forEach(x => classList.add(x)), remove: (...c) => c.forEach(x => classList.delete(x)) },
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
  return { windowObject, intervals, timeouts, api: windowObject.HobunjiTitleScreen };
}

// --- Module load starts exactly one 50ms setInterval poll -------------------
{
  const { intervals } = buildFixture([]);
  assert.equal(intervals.length, 1, 'module load starts exactly one setInterval poll');
  assert.equal(intervals[0].ms, 50, 'the poll runs on the documented 50ms cadence');
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
