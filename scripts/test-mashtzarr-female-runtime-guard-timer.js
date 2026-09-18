#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of
// onboarding-character-creation-mashtzarr-female.js's ensureRuntimeGuard:
// a wait-for-availability loop that polled every frame only to check
// whether the portrait randomizer/fighter-roster dependencies had finished
// loading yet, re-arming until both were ready and then stopping for good,
// becomes a 100ms setTimeout poll instead.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/onboarding-character-creation-mashtzarr-female.js', 'utf8');
assert(!/requestAnimationFrame\(ensureRuntimeGuard\)/.test(source), 'ensureRuntimeGuard must no longer self-schedule a raw requestAnimationFrame');
assert(source.includes('setTimeout(ensureRuntimeGuard, 100)'), 'ensureRuntimeGuard must poll via a real setTimeout instead');

function buildFixture() {
  const timeouts = [];
  const windowObject = {
    randomPortraitProfileSeeded: undefined,
    getPortraitFighters: undefined,
  };
  const sandbox = {
    window: windowObject,
    setTimeout(fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; },
    Object, Array, String, RegExp,
  };
  windowObject.window = windowObject;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'onboarding-character-creation-mashtzarr-female.js' });
  return { windowObject, timeouts };
}

// --- Neither dependency ready yet: reschedules via a 100ms setTimeout ------
{
  const { timeouts } = buildFixture();
  assert.equal(timeouts.length, 1, 'module load with no dependencies ready schedules exactly one poll');
  assert.equal(timeouts[0].ms, 100, 'the poll runs on the documented 100ms cadence');
}

// --- Once both dependencies become ready, the poll stops rescheduling ------
{
  const { windowObject, timeouts } = buildFixture();
  assert.equal(timeouts.length, 1);
  windowObject.randomPortraitProfileSeeded = profile => profile;
  windowObject.getPortraitFighters = () => [{ species: 'mashtzarr', gender: 'female' }];
  timeouts[0].fn();
  assert.equal(timeouts.length, 1, 'once both dependencies are ready, the guard must not reschedule another poll');
  assert.equal(typeof windowObject.randomPortraitProfileSeeded.__hobunjiMashtzarrFemaleNoFacialHair, 'boolean', 'the randomizer guard installs once ready');
}

// --- Only one dependency ready: keeps polling ------------------------------
{
  const { windowObject, timeouts } = buildFixture();
  windowObject.randomPortraitProfileSeeded = profile => profile;
  timeouts[0].fn();
  assert.equal(timeouts.length, 2, 'with only one dependency ready, the poll must reschedule again');
  assert.equal(timeouts[1].ms, 100);
}

console.log('mashtzarr female runtime guard timer conversion passed');
