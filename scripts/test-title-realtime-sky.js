#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/title-realtime-sky.js', 'utf8');

assert(!source.includes('THREE'), 'title real-time sky must not create or depend on a Three.js renderer');
assert(!source.includes('requestAnimationFrame'), 'title real-time sky must not own a per-frame animation loop');
assert(source.includes('const DRAW_INTERVAL_MS = 250'), 'title sky must stay on the bounded low-frequency redraw cadence');
assert(source.includes('const MAX_BACKING_PIXELS = 900000'), 'title sky must keep a bounded Canvas2D backing-buffer budget');
assert(source.includes("renderer:'canvas2d'"), 'debug output must identify the low-cost Canvas2D renderer');

const windowObject = {};
const sandbox = {
  window: windowObject,
  Intl,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
  Promise,
  console,
};
windowObject.window = windowObject;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename:'title-realtime-sky.js' });

const api = windowObject.HobunjiTitleRealtimeSky;
assert(api?.installed, 'title real-time sky API must install without needing DOM/render startup');

function near(actual, expected, epsilon = 0.02) {
  assert(Math.abs(actual - expected) <= epsilon, 'expected ' + actual + ' to be near ' + expected);
}

// Civil-date compression maps Earth's Southern-Hemisphere seasons into the
// authored 3 x 28-day Khymeryyan seasons, while wall-clock time is preserved.
{
  const mapped = api.getRealtimeCalendar(new Date('2026-09-01T12:34:00-04:00'));
  assert.equal(mapped.season, 'Spring');
  assert.equal(mapped.monthName, 'Firstrise');
  assert.equal(mapped.dayOfMonth, 1);
  near(mapped.hour, 12 + 34 / 60);
}
{
  const mapped = api.getRealtimeCalendar(new Date('2026-12-01T07:15:00-05:00'));
  assert.equal(mapped.season, 'Summer');
  assert.equal(mapped.monthName, 'Waxingheat');
  assert.equal(mapped.dayOfMonth, 1);
  near(mapped.hour, 7.25);
}
{
  const mapped = api.getRealtimeCalendar(new Date('2026-03-01T21:45:00-05:00'));
  assert.equal(mapped.season, 'Fall');
  assert.equal(mapped.monthName, 'Firstfall');
  assert.equal(mapped.dayOfMonth, 1);
  near(mapped.hour, 21.75);
}
{
  const mapped = api.getRealtimeCalendar(new Date('2026-06-01T05:05:00-04:00'));
  assert.equal(mapped.season, 'Winter');
  assert.equal(mapped.monthName, 'Shallowfrost');
  assert.equal(mapped.dayOfMonth, 1);
  near(mapped.hour, 5 + 5 / 60);
}

console.log('title real-time sky mapping/performance regression passed');
