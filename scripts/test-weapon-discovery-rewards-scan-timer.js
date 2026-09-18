#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of
// weapon-discovery-rewards.js's scan: a forever requestAnimationFrame loop
// that only re-ran an idempotent, flag-guarded "safety scan" (the code's
// own comment) re-decorating any treasure-chest objects missed by the
// direct init/ensureZone/syncZoneInteractivity hook points becomes a real
// 500ms setInterval instead - cheap and non-urgent, no per-frame cadence
// needed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/weapon-discovery-rewards.js', 'utf8');
assert(!/requestAnimationFrame\(scan\)/.test(source), 'scan must no longer self-schedule a raw requestAnimationFrame');
assert(source.includes('scanFrame = global.setInterval(scan, 500)'), 'scan must be driven by a real setInterval instead');

function buildFixture({ isDialogueEditor = false } = {}) {
  const intervals = [];
  const decorated = [];
  const windowObject = {
    WEAPON_DISCOVERY_REWARD_CONFIG: { rewards: [] },
    WEAPON_TRUST_VISIT_CONFIG: { gifts: [] },
    location: { pathname: isDialogueEditor ? '/tools/dialogue-editor/' : '/' },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    console,
  };
  const sandbox = { window: windowObject, console, Object, Array, Map, WeakSet, Math, Number, String, JSON };
  windowObject.window = windowObject;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'weapon-discovery-rewards.js' });
  return { windowObject, intervals };
}

// --- Shipped-game context starts exactly one 500ms setInterval poll --------
{
  const { intervals } = buildFixture({ isDialogueEditor: false });
  assert.equal(intervals.length, 1, 'the shipped game starts exactly one setInterval safety scan');
  assert.equal(intervals[0].ms, 500, 'the scan runs on the documented 500ms cadence');
}

// --- The dialogue editor context never starts the scan at all --------------
{
  const { intervals } = buildFixture({ isDialogueEditor: true });
  assert.equal(intervals.length, 0, 'the dialogue editor context must never start the safety scan');
}

// --- Driving the scan callback with no treasureDeps yet does not throw -----
{
  const { intervals } = buildFixture();
  assert.doesNotThrow(() => intervals[0].fn(), 'the scan callback must tolerate no treasureDeps yet');
}

// --- Once WildTreasure.init wires treasureDeps, the scan sees zone objects -
{
  const { intervals, windowObject } = buildFixture();
  const chest = { userData: {} };
  const zoneMaps = new Map([['zone1', new Map([['chest1', chest]])]]);
  windowObject.WildTreasure = { init(deps) { this.deps = deps; } };
  windowObject.WildTreasure.init({ _zoneTreasureObjects: zoneMaps });
  assert.doesNotThrow(() => intervals[0].fn(), 'the scan callback must tolerate real zone treasure objects without throwing');
}

console.log('weapon discovery rewards scan timer conversion passed');
