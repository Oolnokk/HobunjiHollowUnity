'use strict';

const assert = require('node:assert/strict'); // Water must stay in step with actual calendar progression.
const fs = require('node:fs'); // Read the shipped calendar, simulation and call site together.
const vm = require('node:vm'); // Execute both full modules with presentation-only DOM stubs.
const calendarSource = fs.readFileSync('docs/js/calendar-system.js', 'utf8'); // Natural clock owner under test.
const waterSource = fs.readFileSync('docs/js/water-system.js', 'utf8'); // Existing simulation accumulator under test.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Ensures gameplay passes the same rate the test exercises.
const waterRateExpression = gameSource.match(/gameHoursPerSecond:\s*([^,\n]+)/)?.[1]; // Evaluate the real expression rather than copying its clock constants.

function element() {
  const children = new Map(), classes = new Set(), listeners = new Map(); // Enough DOM state to open/close the actual Sleep/Wait menu.
  return { style: {}, dataset: {}, appendChild() {}, setAttribute() {}, focus() {},
    classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
    querySelector: selector => { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); },
    addEventListener: (name, listener) => listeners.set(name, listener), listeners };
}

function fixture() {
  const calendar = { day: 1, time01: 0, weather: 'clear' }; // Live clock object receives the production time01 accessor.
  const panels = new Map(), roots = []; // Capture the real dev speed control and time-passage cancel button.
  const document = { body: null, head: { appendChild() {} }, documentElement: { dataset: {} },
    getElementById: () => null, addEventListener() {}, createElement: () => element() }; // Init can run before any calendar UI exists.
  const window = { __hobunjiGameStarted: true, addEventListener() {}, __farmLog() {},
    DevCompanion: { registerPanel: panel => panels.set(panel.id, panel) } }; // Uses the same public speed control as the mobile companion.
  class Color { setHSL() { return this; } } // Season colors do not affect clock behavior.
  const context = vm.createContext({ window, document, THREE: { Color }, console,
    MORNING_HOUR: 6, NIGHT_HOUR: 22, DAY_LENGTH_SECONDS: Number(gameSource.match(/const DAY_LENGTH_SECONDS = (\d+)/)[1]),
    setInterval: () => 1, clearInterval() {}, requestAnimationFrame: callback => callback() }); // Menu timers are presentation-only in this fixture.
  vm.runInContext(calendarSource, context);
  const clock = window.CalendarSystem; // Public owner exposes the same rate before/after its init.
  clock.init({ calendar, MORNING_HOUR: 6, NIGHT_HOUR: 22 });
  vm.runInContext(waterSource, context);
  const water = window.WaterSystem; // Keep the real cadence; count only the expensive simulation callbacks.
  let ticks = 0; // Number of actual farm/town simulation steps.
  water.init({ getTownZone: () => null, getTownGrid: () => [] });
  water.recomputeWater = () => ticks++;
  const baseDayLength = Number(gameSource.match(/const DAY_LENGTH_SECONDS = (\d+)/)[1]); // Follow the private game-loop increment through the installed accessor.
  function advance(seconds, area = 'farm') {
    const frames = Math.round(seconds * 60); // Frame increments stay below the calendar's explicit-jump threshold.
    for (let frame = 0; frame < frames; frame++) {
      calendar.time01 += 1 / 60 / baseDayLength;
      water.tickSimulation(1 / 60, area, { gameHoursPerSecond: vm.runInContext(waterRateExpression, context) });
    }
  }
  return { clock, calendar, advance, ticks: () => ticks,
    setSpeed: speed => panels.get('time-weather').onAction('speed', { speed }),
    openWait() {
      document.body = { appendChild: root => roots.push(root) };
      assert.equal(clock.openTimePassage('wait'), true);
    },
    closeWait: () => roots.find(root => root.className === 'time-passage-backdrop').querySelector('#timePassageCancel').listeners.get('click')(),
  };
}

for (const speed of [0.25, 1, 2, 60]) {
  const game = fixture(); // Independent accumulators avoid carrying fractional ticks between clock-speed cases.
  assert.equal(game.setSpeed(speed).ok, true);
  game.advance(42 / speed + 1 / 60);
  assert(Math.abs(game.calendar.time01 * 16 - 1) < 0.03, 'one game hour elapsed through the actual calendar accessor');
  assert.equal(game.ticks(), 8, `water ticks eight times per actual game hour at ${speed}× clock speed`);
}

const paused = fixture(); // Pausing the dev clock freezes calendar-driven water work too.
paused.setSpeed(0); paused.advance(60);
assert.equal(paused.calendar.time01, 0);
assert.equal(paused.ticks(), 0);

const modal = fixture(); // Selecting Sleep/Wait must not drain or irrigate against a frozen clock.
modal.openWait(); modal.advance(20);
assert.equal(modal.calendar.time01, 0);
assert.equal(modal.ticks(), 0);
modal.closeWait(); modal.advance(42 + 1 / 60, 'town');
assert.equal(modal.ticks(), 8, 'closing the menu resumes the same clock-owned cadence in town');

const away = fixture(); // Time spent outside farm/town must not accumulate water catch-up work.
away.advance(120, 'wilderness');
assert.equal(away.ticks(), 0);
away.advance(1);
assert.equal(away.ticks(), 0);

console.log('water/calendar cadence: eight ticks per game hour across speed changes; paused clocks, Sleep/Wait locks and off-map gating passed');
