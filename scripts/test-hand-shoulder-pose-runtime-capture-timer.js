#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of
// hand-shoulder-pose-runtime.js's captureLoop: a forever
// requestAnimationFrame loop that exists purely to poll for
// global.Combat.deps to become available (so it can install a melee-visual
// capture wrapper once) becomes a real 250ms setInterval instead - once
// installed it's a cheap no-op check that never needed per-frame cadence.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/hand-shoulder-pose-runtime.js', 'utf8');
assert(!/requestAnimationFrame\?\.\(captureLoop\)/.test(source), 'captureLoop must no longer self-schedule a raw requestAnimationFrame');
assert(source.includes('global.setInterval?.(captureLoop, 250)'), 'captureLoop must be driven by a real setInterval instead');

function buildFixture() {
  const intervals = [];
  const windowObject = {
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    Combat: null,
  };
  const sandbox = { window: windowObject, performance: { now: () => 1000 }, Math, Number, Object };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'hand-shoulder-pose-runtime.js' });
  return { windowObject, intervals };
}

// --- Loading the module starts exactly one 250ms setInterval poll ----------
{
  const { intervals } = buildFixture();
  assert.equal(intervals.length, 1, 'module load starts exactly one setInterval poll');
  assert.equal(intervals[0].ms, 250, 'the poll runs on the documented 250ms cadence');
}

// --- Before Combat.deps exists, the poll callback tolerates it silently ----
{
  const { intervals } = buildFixture();
  assert.doesNotThrow(() => intervals[0].fn(), 'the poll callback must tolerate a missing Combat.deps without throwing');
}

// --- Once Combat.deps carries the visual hooks marker, the wrapper installs
{
  const { intervals, windowObject } = buildFixture();
  const original = { triggerWeaponSwingVisual(durationS, opts) { return 'swing-called'; } };
  windowObject.Combat = { deps: { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual: original.triggerWeaponSwingVisual } };
  intervals[0].fn();
  assert.equal(windowObject.Combat.deps.__hobunjiShoulderPoseCapture, true, 'the poll installs the capture wrapper once the visual hooks marker is present');
  assert.notEqual(windowObject.Combat.deps.triggerWeaponSwingVisual, original.triggerWeaponSwingVisual, 'triggerWeaponSwingVisual is wrapped in place');
}

// --- Repeated ticks after install remain a cheap no-op, never re-wrapping --
{
  const { intervals, windowObject } = buildFixture();
  windowObject.Combat = { deps: { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual() {} } };
  intervals[0].fn();
  const wrapped = windowObject.Combat.deps.triggerWeaponSwingVisual;
  intervals[0].fn();
  assert.equal(windowObject.Combat.deps.triggerWeaponSwingVisual, wrapped, 'a second tick after install must not re-wrap the already-captured deps');
}

console.log('hand shoulder pose runtime capture-loop timer conversion passed');
