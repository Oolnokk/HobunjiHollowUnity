#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of
// procedural-hand-grip-runtime.js's install retry loop: it reschedules
// itself until Combat.deps.__weaponToolStanceVisualHooks becomes true
// (only guaranteed after weapon-tool-stances.js's own render-driven retry
// settles, not synchronously after WeaponToolStances.init() returns - a
// prior Stage 1 attempt at a one-shot init() hook was confirmed broken via
// headless-game-test). This keeps the same retry-until-ready shape, just
// swapping requestAnimationFrame for a 20ms setTimeout poll, verified
// again via a real headless run (see the session notes on this file).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/procedural-hand-grip-runtime.js', 'utf8');
assert(!/requestAnimationFrame\(frame\)/.test(source), 'frame must no longer self-schedule a raw requestAnimationFrame');
assert(source.includes('global.setTimeout(frame, 20)'), 'frame must retry via a real setTimeout instead');

function buildFixture() {
  const timeouts = [];
  const windowObject = {
    HobunjiHandGripModes: { modes: { twoHanded: {} }, setRuntimeMode() {}, clearRuntimeMode() {} },
    Combat: null,
    setTimeout(fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; },
  };
  const sandbox = { window: windowObject, Object, Number, String, Math };
  windowObject.window = windowObject;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'procedural-hand-grip-runtime.js' });
  return { windowObject, timeouts };
}

// --- Before Combat.deps carries the visual hooks marker, it retries --------
{
  const { timeouts } = buildFixture();
  assert.equal(timeouts.length, 1, 'module load with no visual hooks ready schedules exactly one retry');
  assert.equal(timeouts[0].ms, 20, 'the retry runs on the documented 20ms cadence');
}

// --- Repeated retries continue until the visual hooks marker appears -------
{
  const { windowObject, timeouts } = buildFixture();
  timeouts[0].fn();
  assert.equal(timeouts.length, 2, 'still not ready, so a second retry is scheduled');
  windowObject.Combat = { deps: { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {}, releaseWeaponSwingHold() {}, cancelWeaponSwingHold() {} } };
  timeouts[1].fn();
  assert.equal(timeouts.length, 2, 'once the visual hooks marker is present, no further retry is scheduled');
  assert.equal(windowObject.ProceduralHandGripRuntime.installed, true, 'the runtime reports itself installed once install() succeeds');
}

console.log('procedural hand grip runtime timer conversion passed');
