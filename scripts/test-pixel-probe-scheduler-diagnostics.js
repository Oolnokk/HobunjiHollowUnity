#!/usr/bin/env node
'use strict';

// Regression for the Stage 9 RAF-ownership follow-up: Pixel Probe's mobile
// report gains a RuntimeFrameScheduler diagnostics summary
// (_pixelProbeSchedulerLines, merged into the probe report the same way as
// the file's other _pixelProbeXxxLines helpers), so a broken/erroring
// per-frame subscriber or frame driver is visible in a copyable report
// without desktop console access — see runtime-frame-scheduler.js's
// reportError() comment, which has said "Stored for Pixel Probe" since
// Stage 4 but had no reader until this change.
//
// pixel-probe.js as a whole needs a full renderer/deps/Three.js fixture to
// vm-execute (see its own _pixelProbeHandler), which every other test in
// this repo that touches this file avoids by asserting on its source text
// instead of executing it. _pixelProbeSchedulerLines is self-contained
// (only reads window.RuntimeFrameScheduler.getDebug()), so this test
// extracts and vm-executes that one real function body directly — genuine
// behavioral coverage of the shipped source, without the rest of the
// file's heavy dependencies.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');
assert(source.includes('const schedulerLines = _pixelProbeSchedulerLines();'), 'the probe report must merge in the frame-scheduler diagnostics');
assert(source.includes('if (schedulerLines) lines.push(...schedulerLines);'), 'the frame-scheduler diagnostics must be spread into the report the same way as the other _pixelProbeXxxLines helpers');
assert(source.includes('const animalSleepLines = _pixelProbeAnimalSleepLines();'), 'the copyable probe report must request animal-sleep scheduler diagnostics');
assert(source.includes('if (animalSleepLines) lines.push(...animalSleepLines);'), 'animal-sleep diagnostics must be merged into the same mobile report');

const match = source.match(/function _pixelProbeSchedulerLines\(\) \{[\s\S]*?\n  \}\n/);
assert(match, 'could not locate _pixelProbeSchedulerLines in the shipped source');

const sleepMatch = source.match(/function _pixelProbeAnimalSleepLines\(\) \{[\s\S]*?\n  \}\n/);
assert(sleepMatch, 'could not locate _pixelProbeAnimalSleepLines in the shipped source');

function run(getDebugResult) {
  const context = { window: { RuntimeFrameScheduler: getDebugResult === undefined ? undefined : { getDebug: () => getDebugResult } } };
  vm.createContext(context);
  vm.runInContext(`${match[0]}\nresult = _pixelProbeSchedulerLines();`, context);
  return context.result;
}

function runSleep(getDebugResult) {
  const context = { window: { AnimalSleepPresentation: getDebugResult === undefined ? undefined : { getDebug: () => getDebugResult } } };
  vm.createContext(context);
  vm.runInContext(`${sleepMatch[0]}\nresult = _pixelProbeAnimalSleepLines();`, context);
  return context.result;
}

// --- Scheduler unavailable (e.g. an editor tool page) -> no section -------
assert.equal(run(undefined), null, 'returns null when RuntimeFrameScheduler is not present, so the report simply omits this section');

// --- Healthy scheduler: summary line only, no error line ------------------
{
  const lines = run({
    registered: 12, enabled: 9, scheduled: true, hasFrameDriver: true,
    frameDriverErrorCount: 0, frameDriverLastError: null,
    entries: [
      { id: 'a', owner: 'A', errorCount: 0, lastError: null },
      { id: 'b', owner: 'B', errorCount: 0, lastError: null },
    ],
  });
  assert.equal(lines.length, 1, 'a healthy scheduler reports exactly one summary line, no error line');
  assert.equal(lines[0], 'Frame scheduler: registered=12 enabled=9 scheduled=1 frameDriver=attached');
}

// --- Missing frame driver + a failing subscriber -> both surfaced ---------
{
  const lines = run({
    registered: 5, enabled: 4, scheduled: true, hasFrameDriver: false,
    frameDriverErrorCount: 0, frameDriverLastError: null,
    entries: [
      { id: 'broken-thing', owner: 'BrokenOwner', errorCount: 3, lastError: 'TypeError: x is not a function\n    at foo.js:12' },
      { id: 'fine-thing', owner: 'FineOwner', errorCount: 0, lastError: null },
    ],
  });
  assert.equal(lines.length, 2, 'a missing frame driver plus a failing subscriber add exactly one summary line and one error line');
  assert(lines[0].includes('frameDriver=MISSING'), 'a missing frame driver must be flagged, not silently omitted');
  assert.equal(lines[1], '>>> Frame scheduler subscriber errors: broken-thing(BrokenOwner) x3: TypeError: x is not a function', 'the error line names the failing subscriber, its owner, error count, and first line of its last error - and only that healthy subscriber is excluded');
}

// --- Frame driver itself erroring is surfaced in the summary line ---------
{
  const lines = run({
    registered: 1, enabled: 1, scheduled: true, hasFrameDriver: true,
    frameDriverErrorCount: 2, frameDriverLastError: 'ReferenceError: y is not defined',
    entries: [],
  });
  assert(lines[0].includes('driverErrors=2 lastDriverError=ReferenceError: y is not defined'), 'a failing frame driver (gameLoop) must be visible in the summary line');
}

// --- Animal sleep presentation cadence/cost is actually mobile-readable ---
assert.equal(runSleep(undefined), null, 'animal-sleep diagnostics omit themselves when that feature is unavailable');

{
  const lines = runSleep({
    schedulerRegistered: true,
    schedulerCadence: 'pre-render-once/post-game-restore',
    preparedFrames: 40,
    restoredFrames: 40,
    lastPreparedFrameId: 40,
    lastRestoredFrameId: 40,
    lastPreparedBoundsScans: 6,
    boundsScans: 240,
    activeTemporaryTransforms: 0,
    staticSleepers: 1,
    cachedSleepFrames: 3,
    lastContext: 'farm:test',
  });
  assert.equal(lines.length, 1, 'healthy animal-sleep cadence reports one compact line');
  assert(lines[0].includes('frames=40/40'), 'animal-sleep probe line exposes prepare/restore cadence');
  assert(lines[0].includes('boundsLast=6 boundsTotal=240'), 'animal-sleep probe line exposes the remaining hierarchy-bounds cost');
  assert(lines[0].includes('activeTemp=0'), 'animal-sleep probe line exposes whether a temporary render transform leaked past post-game');
}

{
  const lines = runSleep({
    schedulerRegistered: false,
    schedulerCadence: 'pre-render-once/post-game-restore',
    preparedFrames: 9,
    restoredFrames: 8,
    lastPreparedFrameId: 9,
    lastRestoredFrameId: 8,
    lastPreparedBoundsScans: 2,
    boundsScans: 18,
    activeTemporaryTransforms: 1,
    staticSleepers: 0,
    cachedSleepFrames: 1,
    lastContext: 'wild:drenkirra',
  });
  assert.equal(lines.length, 2, 'broken animal-sleep ownership adds a visible mismatch line');
  assert(lines[1].includes('scheduler=MISSING'), 'animal-sleep mismatch identifies missing scheduler ownership');
  assert(lines[1].includes('prepared=9 restored=8 activeTemp=1'), 'animal-sleep mismatch exposes an unbalanced render transform lifetime');
}

console.log('pixel probe frame-scheduler diagnostics passed');
