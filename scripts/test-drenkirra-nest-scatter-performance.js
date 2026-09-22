#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for executable nest-distribution and mobile-snapshot regression assertions.
const fs = require('node:fs'); // Used to load the browser runtime modules without duplicating their logic in this test.
const path = require('node:path'); // Used to resolve repository-relative runtime paths.
const vm = require('node:vm'); // Used to execute the browser globals inside isolated lightweight window stubs.

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function seededUnit(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0x100000000;
}

const wildlifeWindow = {
  WildernessMapGenerator: {
    makeRng(seed) { return () => seededUnit(seed); },
  },
}; // Supplies the deterministic score source used by the real Drenkirra nest selector.
vm.runInNewContext(source('docs/js/wildlife-spawn.js'), { window: wildlifeWindow }, { filename: 'wildlife-spawn.js' });
const nestTestApi = wildlifeWindow.WildlifeSpawn.__test; // Runs the exact production selection helper exposed for regression diagnostics.
assert.equal(nestTestApi.minimumNestSeparationTiles, 72);

const arrivalChunkBranches = [
  { col: 1, row: 1 },
  { col: 5, row: 12 },
  { col: 12, row: 4 },
  { col: 15, row: 15 },
]; // Models every eligible branch visible when the streamer's first 16x16 arrival chunk is the only resident chunk.
const selection = [];
nestTestApi.extendScatteredNestSelection('map_southern_cloud_forest', arrivalChunkBranches, selection, 5);
assert.equal(selection.length, 1, 'the first streamed 16x16 chunk can never claim the whole five-nest quota');

const distantBranches = [
  ...arrivalChunkBranches,
  { col: 100, row: 0 },
  { col: 0, row: 100 },
  { col: 100, row: 100 },
  { col: 190, row: 0 },
  { col: 0, row: 190 },
]; // Models distant forest regions becoming resident as the player explores.
nestTestApi.extendScatteredNestSelection('map_southern_cloud_forest', distantBranches, selection, 5);
assert.equal(selection.length, 5, 'distant streamed regions progressively fill the intended five-nest population');
for (let i = 0; i < selection.length; i++) {
  for (let j = i + 1; j < selection.length; j++) {
    const distance = Math.hypot(selection[i].col - selection[j].col, selection[i].row - selection[j].row);
    assert(distance >= nestTestApi.minimumNestSeparationTiles,
      `selected nest trees ${selection[i].key} and ${selection[j].key} must remain spatially scattered`);
  }
}
const stableKeys = selection.map(entry => entry.key);
nestTestApi.extendScatteredNestSelection('map_southern_cloud_forest', [{ col: 2, row: 2 }, ...distantBranches], selection, 5);
assert.deepEqual(selection.map(entry => entry.key), stableKeys, 'later chunk rebuilds cannot reshuffle a completed nest selection');

const snapshotWindow = {
  GridTileAccessors: { getCurrentArea: () => 'map_southern_cloud_forest' },
  CalendarSystem: { getHour: () => 4.25 },
  PorakanekiCamps: {
    debugSnapshot: () => ({
      season: 'Deadgrass', chiefZoneId: 'map_western_slope', favor: -3,
      playerTile: { col: 80, row: 80 }, fullSimulationRadiusTiles: 12,
      fullSimulationReleaseRadiusTiles: 16, zones: {},
    }),
    __test: { isSleepingHour: () => true },
  },
}; // Supplies the globals needed by the real clipboard snapshot formatter.
const snapshotDocument = { getElementById: () => null };
vm.runInNewContext(source('docs/js/wilderness-ai-snapshot.js'), {
  window: snapshotWindow,
  document: snapshotDocument,
}, { filename: 'wilderness-ai-snapshot.js' });
snapshotWindow.WildernessAiSnapshot.init({
  TILE: 10,
  npcWalkers: [],
  showToast() {},
  hostileObjects: new Set([
    {
      id: 'wolf', creatureKey: 'gar-wolf', areaId: 'map_southern_cloud_forest',
      state: 'idle', denKey: 'cloud:den:1', x: 100, y: 200, homeX: 90, homeY: 190,
    },
    {
      id: 'bird', creatureKey: 'drenkirra', areaId: 'map_southern_cloud_forest',
      state: 'idle', nestTreeKey: 'cloud:nesttree:80,80', x: 800, y: 810,
      homeX: 800, homeY: 800, _cfDrenkirra: { mode: 'sleeping' },
    },
    {
      id: 'herd-mother', creatureKey: 'voorg-ass-herd-mother', areaId: 'map_southern_cloud_forest',
      state: 'herd-sleeping', herdKey: 'cloud:roaming-herd:0', x: 500, y: 510,
      homeX: 500, homeY: 500, isHerdMother: true, carriedBabyCount: 3, _animalSleeping: true,
    },
  ]),
});
const snapshot = snapshotWindow.WildernessAiSnapshot.captureSnapshotText();
assert.match(snapshot, /instantiatedWildlife=3 denCreatures=1 nestCreatures=1 herdCreatures=1 herdMothers=1 carriedBabies=3 sleepingHerdCreatures=1/,
  'wilderness snapshots count den packs, Drenkirra nest families, and roaming herds');
assert.match(snapshot, /id=bird source=nest:cloud:nesttree:80,80 species=drenkirra[\s\S]*mode=sleeping/,
  'the omitted Drenkirra now identifies its exact nest and current cloud-forest behavior');
assert.match(snapshot, /id=wolf source=den:cloud:den:1 species=gar-wolf/,
  'ordinary den residents retain an explicit den source in the same snapshot');
assert.match(snapshot, /id=herd-mother source=herd:cloud:roaming-herd:0 species=voorg-ass-herd-mother[\s\S]*mode=sleeping[\s\S]*role=Herd-Mother carriedBabies=3/,
  'roaming Herd-Mothers expose their herd source, sleep state, and carried young');

console.log('Drenkirra nest scatter and complete wilderness snapshot regression passed.');
