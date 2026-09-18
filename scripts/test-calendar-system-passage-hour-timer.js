#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of calendar-system.js's
// advanceOnePassageHour: its condition-wait loop
// (`await new Promise(resolve => requestAnimationFrame(resolve))`) polled
// each frame purely to wait for game.js's private day-rollover to finish -
// not genuine per-frame work - so it now polls on a 30ms setTimeout
// instead. The full module is DOM-heavy (Calendar tab UI, natural clock
// shim), so this extracts just the four self-contained pure functions
// advanceOnePassageHour actually depends on, straight from the shipped
// source via regex, and exercises them standalone - the same technique
// already used by scripts/test-pixel-probe-scheduler-diagnostics.js for a
// similarly heavy file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/calendar-system.js', 'utf8');
assert(!/requestAnimationFrame\(resolve\)/.test(source), 'advanceOnePassageHour must no longer poll via requestAnimationFrame');
assert(source.includes('await new Promise(resolve => setTimeout(resolve, 30));'), 'advanceOnePassageHour must poll via a real setTimeout instead');

function extractFunction(name) {
  const marker = `function ${name}(`;
  let start = source.indexOf(marker);
  assert(start >= 0, `could not find ${name} in calendar-system.js`);
  const asyncPrefix = 'async ';
  if (source.slice(start - asyncPrefix.length, start) === asyncPrefix) start -= asyncPrefix.length;
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

const harness = `
  ${extractFunction('positiveModulo')}
  ${extractFunction('setTime01Raw')}
  ${extractFunction('activeClockHours')}
  ${extractFunction('previewAfterHours')}
  ${extractFunction('advanceOnePassageHour')}
  global.__test = { advanceOnePassageHour, setTime01Raw };
`;

function buildFixture(calendar) {
  const sandbox = { deps: { calendar, NIGHT_HOUR: 22, MORNING_HOUR: 6 }, performance, setTimeout, Math, Number, global: {} };
  vm.createContext(sandbox);
  vm.runInContext(harness, sandbox, { filename: 'calendar-system-extract.js' });
  return sandbox.global.__test;
}

async function main() {
  // --- Same-day advance: resolves without ever entering the poll loop ------
  {
    const test = buildFixture({ day: 5, time01: 0.1 });
    const before = Date.now();
    await test.advanceOnePassageHour();
    assert(Date.now() - before < 50, 'a same-day hour advance resolves immediately with no polling');
  }

  // --- Day-crossing advance: polls until game.js's rollover updates state --
  {
    const calendar = { day: 5, time01: 0.97 }; // Near end of day; +1 hour crosses into day 6.
    const test = buildFixture(calendar);
    const promise = test.advanceOnePassageHour();
    // Simulate game.js's private rollover completing shortly after, well
    // within the 1800ms timeout but after at least one 30ms poll tick.
    setTimeout(() => { calendar.day = 6; calendar.time01 = 0.02; }, 60);
    await promise;
    assert.equal(calendar.time01, previewTime01(), 'resolving snaps to the exact target time, clearing accumulated poll drift');
    function previewTime01() {
      const total = 0.97 + 1 / 16;
      return ((total % 1) + 1) % 1;
    }
  }

  // --- Timeout path: throws if the rollover never completes in time --------
  {
    const calendar = { day: 5, time01: 0.97 };
    const test = buildFixture(calendar);
    await assert.rejects(
      test.advanceOnePassageHour(),
      /day rollover stalled/,
      'a stalled rollover must still throw a visible error after the 1800ms timeout',
    );
  }

  console.log('calendar system passage-hour timer conversion passed');
}

main().catch(err => { console.error(err); process.exit(1); });
