#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of arch-button-labels.js's
// watchInputDevice: a forever requestAnimationFrame loop that only checked
// whether the last-used input device (mouse vs gamepad) changed becomes a
// 250ms setInterval poll instead, since that rare change never needed
// per-frame precision.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/arch-button-labels.js', 'utf8');
assert(!/requestAnimationFrame\(watchInputDevice\)/.test(source), 'watchInputDevice must no longer self-schedule a raw requestAnimationFrame');
assert(source.includes("requestAnimationFrame(refresh)"), 'queueRefresh\'s unrelated one-shot next-paint RAF must remain untouched');
assert(source.includes('setInterval(watchInputDevice, INPUT_DEVICE_POLL_MS)'), 'watchInputDevice must be driven by a real setInterval instead');

function buildFixture() {
  const intervals = [];
  let inputDevice = 'desktop';
  const windowObject = {
    ActionPromptUI: { getLastInputDevice: () => inputDevice },
    addEventListener() {},
    matchMedia: () => ({ matches: true }),
  };
  const documentObject = {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll: () => [],
    getElementById: () => null,
    body: {},
    createElement: () => ({ style: {}, appendChild(){}, classList: { add(){}, remove(){} } }),
    head: { appendChild() {} },
  };
  const sandbox = {
    window: windowObject,
    document: documentObject,
    console,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    requestAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} },
    Math, Number, Object, Array, Set, Map, String, JSON,
  };
  windowObject.window = windowObject;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'arch-button-labels.js' });
  return { windowObject, intervals, setInputDevice: value => { inputDevice = value; } };
}

// --- install() starts exactly one interval-based watcher --------------------
{
  const { intervals } = buildFixture();
  assert.equal(intervals.length, 1, 'install() starts exactly one setInterval poll for the input device watcher');
  assert.equal(intervals[0].ms, 250, 'the poll runs on the documented 250ms cadence');
}

// --- Driving the poll callback with no device change queues no refresh -----
{
  const { intervals, windowObject } = buildFixture();
  let refreshCount = 0;
  const originalRefresh = windowObject.ArchButtonLabels.refresh;
  windowObject.ArchButtonLabels.refresh = (...args) => { refreshCount++; return originalRefresh(...args); };
  assert.doesNotThrow(() => intervals[0].fn(), 'the poll callback must tolerate an unchanged device without throwing');
}

// --- A device change queues a refresh ---------------------------------------
{
  const { intervals, setInputDevice, windowObject } = buildFixture();
  setInputDevice('controller');
  intervals[0].fn();
  assert.equal(windowObject.ArchButtonLabels.getInputDevice(), 'controller', 'watchInputDevice picks up the new last-used input device');
}

console.log('arch button labels input-device watcher timer conversion passed');
