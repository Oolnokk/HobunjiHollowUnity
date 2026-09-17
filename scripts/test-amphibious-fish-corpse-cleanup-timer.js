#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of
// amphibious-fish-corpse-cleanup.js's presentationLoop: an unthrottled
// forever requestAnimationFrame loop whose only job is catching an
// infrequent state change (a newly spawned amphibious fish that still
// needs its land presentation applied once) becomes a real setInterval
// poll instead, since it never needed per-frame precision.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/amphibious-fish-corpse-cleanup.js', 'utf8');
assert(!/requestAnimationFrame\(/.test(source), 'presentationLoop must no longer self-schedule a raw requestAnimationFrame');
assert(source.includes('setInterval(presentationLoop, PRESENTATION_POLL_MS)'), 'presentationLoop must be driven by a real setInterval instead');

function buildFixture() {
  const intervals = [];
  const windowObject = {
    Fishing: null,
    FishCatalog: { get: () => null },
    BanditCamps: { init(deps) { this.deps = deps; return deps; } },
    WildlifeSpawn: { init(deps) { this.deps = deps; return deps; } },
  };
  const sandbox = {
    window: windowObject,
    console,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    Math, Number, Object, Map, String, Promise,
  };
  windowObject.window = windowObject;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'amphibious-fish-corpse-cleanup.js' });
  return { windowObject, intervals };
}

// --- Wiring wildlife spawn deps starts exactly one interval-based poll -----
{
  const { windowObject, intervals } = buildFixture();
  const spawnDeps = { hostileObjects: [], CREATURE_DB: { gurumahi: { amphibiousFish: true } } };
  windowObject.WildlifeSpawn.init(spawnDeps);
  assert.equal(intervals.length, 1, 'wiring wildlife spawn deps starts exactly one setInterval poll');
  assert.equal(intervals[0].ms, 250, 'the poll runs on the documented 250ms cadence');
  assert.doesNotThrow(() => intervals[0].fn(), 'the poll callback must tolerate an empty hostile list without throwing');
}

// --- Re-wiring deps a second time does not start a second interval ---------
{
  const { windowObject, intervals } = buildFixture();
  const spawnDeps = { hostileObjects: [], CREATURE_DB: {} };
  windowObject.WildlifeSpawn.init(spawnDeps);
  windowObject.WildlifeSpawn.init(spawnDeps);
  assert.equal(intervals.length, 1, 'repeated wildlife spawn init calls must not double-start the poll');
}

// --- A hostile with a pending amphibious-fish key does not throw -----------
{
  const { windowObject, intervals } = buildFixture();
  const creature = { _amphibiousFishItemKey: 'gurumahi', _amphibiousLandPresentationPending: false, _amphibiousLandPresentationApplied: false };
  const spawnDeps = { hostileObjects: [creature], CREATURE_DB: {} };
  windowObject.WildlifeSpawn.init(spawnDeps);
  assert.doesNotThrow(() => intervals[0].fn(), 'the poll callback must tolerate a hostile awaiting land presentation without throwing');
}

console.log('amphibious fish corpse cleanup timer conversion passed');
