#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of input-settings-panel.js's
// controller-rebind "Listen for input" poll: repeated per-frame gamepad
// polling that existed only to detect the next controller press - an
// availability-wait, even though it self-terminates once input is
// captured or the capture is cancelled - becomes a real 50ms setInterval
// instead. Extracts the self-contained listenForControllerInput/
// stopControllerCapture pair straight from the shipped source, the same
// technique used for other DOM-heavy files' pure listening logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/input-settings-panel.js', 'utf8');
assert(!/requestAnimationFrame\(poll\)/.test(source), 'the controller capture poll must no longer self-schedule a raw requestAnimationFrame');
assert(!source.includes('cancelAnimationFrame(capture.frame)'), 'stopping the capture must no longer cancel a raw animation frame');
assert(source.includes('capture.frame = setInterval(poll, 50)'), 'the controller capture poll must be driven by a real setInterval instead');
assert(source.includes('clearInterval(capture.frame)'), 'stopping the capture must clear the setInterval instead');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `could not find ${name} in input-settings-panel.js`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

const harness = `
  let activeControllerCapture = null;
  ${extractFunction('stopControllerCapture')}
  ${extractFunction('listenForControllerInput')}
  global.__test = { listenForControllerInput, stopControllerCapture, getActive: () => activeControllerCapture };
`;

function buildFixture(pads = []) {
  const intervals = [];
  const button = { textContent: 'Bind', isConnected: true, classList: { add(){}, remove(){} }, getClientRects: () => [{}] };
  const windowObject = { ControllerInput: { getPressedBindingCodes: pad => pad.__pressed || [] } };
  const sandbox = {
    window: windowObject,
    navigator: { getGamepads: () => pads },
    setInterval(fn, ms) { const id = intervals.length + 1; intervals.push({ id, fn, ms, cleared: false }); return id; },
    clearInterval(id) { const entry = intervals.find(e => e.id === id); if (entry) entry.cleared = true; },
    Array, Set, global: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(harness, sandbox, { filename: 'input-settings-panel-extract.js' });
  return { test: sandbox.global.__test, intervals, button };
}

// --- Starting a listen session schedules exactly one 50ms setInterval ------
{
  const { test, intervals, button } = buildFixture();
  let captured = null;
  test.listenForControllerInput(button, code => { captured = code; }, null);
  assert.equal(intervals.length, 1, 'listening starts exactly one setInterval poll');
  assert.equal(intervals[0].ms, 50, 'the poll runs on the documented 50ms cadence');
  assert.equal(captured, null);
}

// --- A newly pressed binding on a poll tick captures it and clears the timer
{
  const pad = { index: 0, __pressed: [] };
  const { test, intervals, button } = buildFixture([pad]);
  let captured = null;
  test.listenForControllerInput(button, code => { captured = code; }, null);
  pad.__pressed = ['Button0'];
  intervals[0].fn();
  assert.equal(captured, 'Button0', 'a newly pressed binding on a poll tick is captured');
  assert.equal(intervals[0].cleared, true, 'capturing input clears the setInterval poll');
}

// --- Cancelling the capture clears the interval without calling onInput ----
{
  const pad = { index: 0, __pressed: [] };
  const { test, intervals, button } = buildFixture([pad]);
  let captured = null;
  test.listenForControllerInput(button, code => { captured = code; }, null);
  test.stopControllerCapture();
  assert.equal(intervals[0].cleared, true, 'cancelling the capture clears the setInterval poll');
  assert.equal(test.getActive(), null);
  pad.__pressed = ['Button1'];
  // The interval is cleared, but even a stray extra tick must still no-op
  // since activeControllerCapture no longer matches this session's capture.
  intervals[0].fn();
  assert.equal(captured, null, 'a stray poll tick after cancellation must not capture input');
}

console.log('input settings panel controller capture timer conversion passed');
