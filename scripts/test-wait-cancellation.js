'use strict';
const assert = require('node:assert/strict'); // Verifies the real hourly loop stops at the displayed hour.
const fs = require('node:fs'); // Reads the calendar owner rather than duplicating its loop.
const vm = require('node:vm'); // Drives the browser functions with deterministic hour ticks.
const source = fs.readFileSync('docs/js/calendar-system.js', 'utf8'); // Calendar functions under test.
function extract(name) {
  const start = source.indexOf(`  ${name === 'advanceBySelectedHours' ? 'async ' : ''}function ${name}(`); // Locates the production declaration.
  const end = source.indexOf('\n  }', start) + 4; // Ends at the outer function's closing indentation.
  assert(start >= 0 && end > start);
  return source.slice(start, end);
}
async function run(cancelAt, reviewAware = false) {
  const ticks = []; // Records each displayed elapsed hour.
  let advances = 0; // Counts actual calendar writes.
  let releases = 0; // A cancel must retain the input and clock lock until iris completion.
  const context = vm.createContext({
    MAX_PASSAGE_HOURS: 24, TIME_PASSAGE_FIRST_TICK_MS: 1000, TIME_PASSAGE_TICK_DECAY: .8,
    _passageRunning: true, _passageCancelled: false, _passageElapsedHours: 0,
    _timePassageKind: 'wait', _timePassageUi: { backdrop: { classList: { remove() { throw new Error('closed before iris completion'); } } } },
    clearInterval() {}, releaseTimePassageLock() { releases++; },
    delayMs: async () => { if (advances === cancelAt) vm.runInContext('closeTimePassageMenu()', context); },
    advanceOnePassageHour: async () => { advances++; },
  }); // Mocks only external effects; cancellation and iteration use shipped code.
  vm.runInContext(`${extract('closeTimePassageMenu')}\n${extract('advanceBySelectedHours')}`, context);
  if (reviewAware) {
    const review = fs.readFileSync('docs/js/day-progress-review.js', 'utf8'); // The installed midnight gate takes over the normal Confirm handler.
    const start = review.indexOf('  async function advancePassageHours('); // Executes the actual override, which must share CalendarSystem cancellation.
    const end = review.indexOf('\n  }', start) + 4;
    Object.assign(context, {
      PASSAGE_FIRST_TICK_MS: 1000, PASSAGE_TICK_DECAY: .8,
      finiteNumber: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      calendarApi: { isTimePassageCancelled: () => context._passageCancelled,
        recordTimePassageHour: elapsed => { context._passageElapsedHours = elapsed; } },
      renderPassageTick: (kind, remaining) => ticks.push(8 - remaining),
    });
    vm.runInContext(review.slice(start, end), context);
    assert.equal(await context.advancePassageHours('wait', 8), cancelAt, 'midnight-aware runner returns actual elapsed hours');
  } else {
    await context.advanceBySelectedHours(8, remaining => ticks.push(8 - remaining));
  }
  assert.equal(advances, cancelAt);
  assert.equal(context._passageElapsedHours, cancelAt);
  assert.equal(ticks.at(-1), advances, 'stops at the last displayed hour');
  assert.equal(context._timePassageKind, 'wait', 'clock stays frozen while iris reopens');
  assert.equal(releases, 0, 'cancel cannot release the passage lock early');
}
(async () => {
  await run(0);
  await run(1);
  await run(4);
  await run(0, true);
  await run(1, true);
  await run(4, true);
  console.log('Wait cancellation preserves the displayed hour and passage lock.');
})().catch(error => { console.error(error); process.exitCode = 1; });
