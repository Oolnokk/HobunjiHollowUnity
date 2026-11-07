#!/usr/bin/env node
'use strict';

// The Wilderness AI snapshot's WILDLIFE section only lists creatures carrying a
// denKey/nestTreeKey/herdKey, which Tzatzul never have. The TZATZUL section
// must list them (and hatchlings) from hostileObjects and say so when none exist.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function run(hostiles, flight) {
  const win = {
    GridTileAccessors: { getCurrentArea: () => 'map_northern_cliffs' },
    CalendarSystem: { getHour: () => 8.5 },
    PorakanekiCamps: { debugSnapshot: () => ({ season: 'Stormtide', zones: {} }) },
    TzatzulFlightRuntime: flight ? { debugSnapshot: () => flight } : undefined,
  };
  vm.runInNewContext(fs.readFileSync('docs/js/wilderness-ai-snapshot.js', 'utf8'), { window: win, document: { getElementById: () => null } }, { filename: 'wilderness-ai-snapshot.js' });
  win.WildernessAiSnapshot.init({ TILE: 10, npcWalkers: [], showToast() {}, hostileObjects: new Set(hostiles) });
  return win.WildernessAiSnapshot.captureSnapshotText();
}

const empty = run([], { active: 0, populationKeys: 0, roosts: [{ area: 'map_northern_cliffs', count: 4 }], birds: [] });
assert.match(empty, /TZATZUL activeArea=map_northern_cliffs tzatzul=0 hatchlings=0 roosts=map_northern_cliffs:4 flightActive=0/);
assert.match(empty, /no Tzatzul currently instantiated/);

const bird = { id: 'tz1', creatureKey: 'tzatzul', areaId: 'map_northern_cliffs', state: 'idle', health: 40, x: 505, y: 1204, onPerch: {}, _tzFlight: { identity: { id: 'spire-3' } } };
const chick = { id: 'tz2', creatureKey: 'tzatzul-hatchling', areaId: 'map_northern_cliffs', state: 'idle', health: 8, x: 100, y: 100 };
const den = { id: 'g1', creatureKey: 'grehlr', areaId: 'map_northern_cliffs', state: 'idle', denKey: 'd', x: 0, y: 0, homeX: 0, homeY: 0 };
const text = run([bird, chick, den], { active: 1, populationKeys: 1, roosts: [{ area: 'map_northern_cliffs', count: 4 }],
  birds: [{ id: 'spire-3', area: 'map_northern_cliffs', phase: 'rest', pose: 'perched', target: 'player', captive: null }] });
assert.match(text, /tzatzul=1 hatchlings=1 roosts=map_northern_cliffs:4 flightActive=1 spawnedToday=1/);
assert.match(text, /id=tz1 species=tzatzul area=map_northern_cliffs state=idle phase=rest pose=perched perched=1 hp=40 tile=\(51,120\) target=player/);
assert.match(text, /id=tz2 species=tzatzul-hatchling/);
assert.doesNotMatch(text.split('TZATZUL')[1].split('DENS')[0], /id=g1/, 'den wildlife stays out of the Tzatzul section');
assert.match(text.split('WILDLIFE')[1].split('TZATZUL')[0], /id=g1/, 'den wildlife still appears under WILDLIFE');

console.log('Wilderness snapshot Tzatzul section passed.');
