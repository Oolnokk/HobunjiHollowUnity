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

const match = source.match(/function _pixelProbeSchedulerLines\(\) \{[\s\S]*?\n  \}\n/);
assert(match, 'could not locate _pixelProbeSchedulerLines in the shipped source');

function run(getDebugResult) {
  const context = { window: { RuntimeFrameScheduler: getDebugResult === undefined ? undefined : { getDebug: () => getDebugResult } } };
  vm.createContext(context);
  vm.runInContext(`${match[0]}\nresult = _pixelProbeSchedulerLines();`, context);
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

console.log('pixel probe frame-scheduler diagnostics passed');
