#!/usr/bin/env node
'use strict';
// Executes the shipped clock accessor and companion command together.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/calendar-system.js', 'utf8'); // Real calendar code used by this isolated fixture.
function extract(name) {
  const start = source.indexOf(`function ${name}(`); // Locates the existing owner without copying its implementation.
  assert.ok(start >= 0);
  let depth = 0; // Tracks the function body, including its nested callbacks.
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}
const calendar = { day: 1, time01: 0.2 }; // Represents the same mutable object injected by game.js.
const panels = []; // Captures the actual companion panel registration.
const context = vm.createContext({
  window: { __hobunjiGameStarted: true, DevCompanion: { registerPanel: panel => panels.push(panel) } },
  deps: { calendar },
  _timeScaleInstalled: false, _rawTimeWrite: false, _timePassageKind: null, _timePassageUi: null,
  MAX_NATURAL_TIME_WRITE: 0.02, NATURAL_TIME_WRITE_SCALE: 288 / 672,
  devTimeSpeed: 1,
}); // Supplies only the accessor's runtime dependencies, keeping DOM transitions outside this test.
vm.runInContext(['installNaturalTimeScale', 'setTime01Raw', 'registerDevCompanionPanel'].map(extract).join('\n'), context);
context.installNaturalTimeScale();
context.registerDevCompanionPanel();
const panel = panels[0]; // Uses the same action route exposed to the companion window.
const tick = () => { const before = calendar.time01; calendar.time01 += 0.001; return calendar.time01 - before; }; // Simulates a natural game-loop write.
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`); // Allows ordinary floating-point rounding.
close(tick(), 0.001 * 288 / 672);
assert.equal(panel.onAction('speed', { speed: 2 }).ok, true);
close(tick(), 0.002 * 288 / 672);
assert.equal(panel.onAction('speed', { speed: 0 }).ok, true);
close(tick(), 0);
context.setTime01Raw(0.3);
assert.equal(calendar.time01, 0.3, 'explicit time skips still work while natural time is paused');
for (const speed of [-1, 61, NaN, Infinity, 'invalid']) assert.equal(panel.onAction('speed', { speed }).ok, false);
close(tick(), 0, 'invalid requests retain the previous speed');
panel.onAction('speed', { speed: 60 });
close(tick(), 0.06 * 288 / 672);
context.window.__hobunjiGameStarted = false;
calendar.time01 += 0.001;
close(calendar.time01, 0.3 + 0.06 * 288 / 672 + 0.001);
context.window.__hobunjiGameStarted = true;
calendar.time01 -= 0.1;
close(calendar.time01, 0.2 + 0.06 * 288 / 672 + 0.001);
context._timePassageKind = 'wait';
context._timePassageUi = { backdrop: { classList: { contains: () => true } }, iris: { style: {} } };
close(tick(), 0, 'modal ownership still freezes clock drift');
console.log('test-dev-companion-clock-speed: ok');
