#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of
// day-progress-review.js's advanceOnePassageHour: identical pattern to
// calendar-system.js's rollover wait (see
// scripts/test-calendar-system-passage-hour-timer.js) - a condition-wait
// loop that polled each frame purely to detect game.js's private day
// rollover finishing, not genuine per-frame work, now polls via a 30ms
// setTimeout instead. Extracts the self-contained pure functions this
// depends on straight from the shipped source, the same technique used for
// calendar-system.js's equivalent.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/day-progress-review.js', 'utf8');
assert(!/requestAnimationFrame\(resolve\)/.test(source), 'advanceOnePassageHour must no longer poll via requestAnimationFrame');
assert(source.includes('await new Promise(resolve => setTimeout(resolve, 30));'), 'advanceOnePassageHour must poll via a real setTimeout instead');

function extractFunction(name) {
  const marker = `function ${name}(`;
  let start = source.indexOf(marker);
  assert(start >= 0, `could not find ${name} in day-progress-review.js`);
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
  ${extractFunction('finiteNumber')}
  ${extractFunction('representedHour')}
  ${extractFunction('activeClockHours')}
  function crossesCivilMidnight() { return false; } // Midnight-review branching is out of scope for this poll-conversion regression.
  async function requestMidnightReview() {}
  ${extractFunction('advanceOnePassageHour')}
  global.__test = { advanceOnePassageHour };
`;

function buildFixture(calendar, { previewAfterHours } = {}) {
  const sandbox = {
    calendarDeps: { calendar, NIGHT_HOUR: 22, MORNING_HOUR: 6 },
    calendarApi: { previewAfterHours: previewAfterHours || defaultPreview },
    performance, setTimeout, Math, Number, global: {},
  };
  function defaultPreview(hours, day, time01) {
    const clockHours = 16;
    const total = time01 + hours / clockHours;
    const dayOffset = Math.floor(total);
    return { day: day + dayOffset, time01: ((total % 1) + 1) % 1, hours };
  }
  vm.createContext(sandbox);
  vm.runInContext(harness, sandbox, { filename: 'day-progress-review-extract.js' });
  return sandbox.global.__test;
}

async function main() {
  // --- Same-day advance never touches the day-rollover poll ------------------
  {
    const test = buildFixture({ day: 5, time01: 0.1 });
    const before = Date.now();
    await test.advanceOnePassageHour('wait');
    assert(Date.now() - before < 50, 'a same-day hour advance resolves immediately with no polling');
  }

  // --- Day-crossing advance polls via setTimeout until the rollover lands ---
  {
    const calendar = { day: 5, time01: 0.97 };
    const test = buildFixture(calendar);
    const promise = test.advanceOnePassageHour('sleep');
    setTimeout(() => { calendar.day = 6; calendar.time01 = 0.02; }, 60);
    await promise;
    assert.equal(calendar.day, 6, 'the awaited call only resolves once the private rollover has actually landed');
  }

  // --- A stalled rollover still throws a visible error after the timeout ----
  {
    const calendar = { day: 5, time01: 0.97 };
    const test = buildFixture(calendar);
    await assert.rejects(
      test.advanceOnePassageHour('wait'),
      /day rollover stalled/,
      'a stalled rollover must still throw a visible error after the 1800ms timeout',
    );
  }

  console.log('day progress review passage-hour timer conversion passed');
}

main().catch(err => { console.error(err); process.exit(1); });
