'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/outdoor-livestock-presence.js', 'utf8');

const records = [
  { id: 'uum-a', kind: 'uumkaoii', name: 'Uum A', lifeStage: 'adult', barnId: 'barn1', troughIndex: 0, col: 4, row: 4 },
  { id: 'dren-b', kind: 'drenkirra', name: 'Dren B', lifeStage: 'adult', barnId: 'barn1', troughIndex: 1, col: 5, row: 4 },
  { id: 'grehlr-c', kind: 'grehlr', name: 'Grehlr C', lifeStage: 'adult', barnId: null, troughIndex: null, col: 8, row: 8 },
  { id: 'baby-d', kind: 'grehlr', name: 'Baby D', lifeStage: 'baby', barnId: null, troughIndex: null },
];
const barn = { id: 'barn1', kind: 'barn', stage: 'built', tier: 'small', col: 10, row: 10, w: 4, h: 3 };
const nursery = { id: 'farm_nursery', kind: 'barn', stage: 'built', tier: 'nursery', nursery: true, col: 2, row: 2, w: 3, h: 2 };
const buildings = [barn, nursery];
const animalObjects = new Set();
const worldObjects = new Map();
const saves = [];
let destructiveCoreUnassignCalls = 0;
let welfareRefreshes = 0;
let welfarePatches = 0;
let depsRef = null;

function makeAnimal(entry, col, row, hidden = false) {
  return {
    livestockId: entry.id,
    animalKey: entry.kind,
    col, row, targetCol: col, targetRow: row,
    homeCol: col, homeRow: row,
    wx: col + 0.5, wz: row + 0.5,
    wanderTargetCol: null, wanderTargetRow: null, wanderWaitT: 0, wanderPhase: 'pick',
    _barnHome: hidden,
    avatarRef: { group: { visible: !hidden } },
  };
}

const liveA = makeAnimal(records[0], 4, 4, false);
const liveB = makeAnimal(records[1], 5, 4, true);
animalObjects.add(liveA);
animalObjects.add(liveB);
worldObjects.set('4,4', liveA);

const FarmAnimals = {
  init(injectedDeps) { depsRef = injectedDeps; },
  canSpawnAt() { return true; },
  clearVatWorkerPose() {},
  unassignFromBarn() {
    destructiveCoreUnassignCalls++;
    throw new Error('presence wrapper must replace the old destructive unassign path');
  },
  respawnWorldLivestock() {
    // Models the old authoritative behavior: explicit barnId:null is stasis,
    // while a temporarily housed record uses the normal species factory path.
    for (const entry of depsRef.loadWorldLivestock()) {
      if (!entry.barnId) continue;
      if (entry.lifeStage === 'baby') continue;
      if ([...animalObjects].some(animal => animal.livestockId === entry.id)) continue;
      const anchor = buildings.find(building => building.id === entry.barnId);
      if (!anchor) continue;
      const spot = FarmBuildings.findOpenTileNear(anchor);
      const animal = makeAnimal(entry, spot.col, spot.row, false);
      animalObjects.add(animal);
      worldObjects.set(spot.col + ',' + spot.row, animal);
    }
  },
};

const FarmBuildings = {
  findOpenTileNear(anchor) {
    return { col: Math.max(0, anchor.col - 1), row: anchor.row };
  },
};

const context = {
  window: {
    FarmAnimals,
    FarmBuildings,
    OutdoorLivestockWelfare: {
      refreshStatuses() { welfareRefreshes++; },
      patchAllLiveAnimals() { welfarePatches++; },
    },
    GridTileAccessors: { getCurrentArea: () => 'farm' },
  },
  console,
  queueMicrotask,
  Number,
  Object,
  Array,
  Set,
  Map,
  Math,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'outdoor-livestock-presence.js' });
context.window.OutdoorLivestockPresence.install();

const deps = {
  getCurrentArea: () => 'farm',
  getFarmBuildings: () => buildings,
  loadWorldLivestock: () => records,
  saveWorldLivestock: list => saves.push(list.map(entry => ({ id: entry.id, barnId: entry.barnId ?? null, col: entry.col ?? null, row: entry.row ?? null }))),
  hasFarmPermission: () => true,
  findOpenTileNearBarn: anchor => FarmBuildings.findOpenTileNear(anchor),
  animalObjects,
  worldObjects,
  COLS: 60,
  ROWS: 50,
};
context.window.FarmAnimals.init(deps);

const resultA = context.window.FarmAnimals.unassignFromBarn('uum-a');
assert.equal(resultA.ok, true, 'housed Uumkao’ii can be moved outdoors');
assert.equal(records[0].barnId, null, 'unbarned Uumkao’ii is saved as outdoors');
assert.equal(destructiveCoreUnassignCalls, 0, 'unbarning never enters the old destructive stasis transition');
assert.strictEqual([...animalObjects].find(animal => animal.livestockId === 'uum-a'), liveA, 'daytime unbarning preserves the exact already-live Uumkao’ii entity');
assert.strictEqual(worldObjects.get('4,4'), liveA, 'preserved daytime outdoor animal remains registered on its current farm tile');

const resultB = context.window.FarmAnimals.unassignFromBarn('dren-b');
assert.equal(resultB.ok, true, 'a second species uses the same generic outdoor transition');
assert.equal(records[1].barnId, null, 'night-hidden Drenkirra is saved as outdoors');
assert.strictEqual([...animalObjects].find(animal => animal.livestockId === 'dren-b'), liveB, 'night unbarning reuses the same hidden barn entity rather than replacing it');
assert.equal(liveB._barnHome, false, 'night-hidden livestock is released from barn-home state immediately');
assert.equal(liveB.avatarRef.group.visible, true, 'night-hidden livestock becomes visible outside immediately');
assert.strictEqual(worldObjects.get(liveB.col + ',' + liveB.row), liveB, 'released nighttime animal is restored to world-object occupancy');

assert.equal([...animalObjects].some(animal => animal.livestockId === 'grehlr-c'), false, 'fixture starts with an already-broken saved outdoor adult missing from the world');
context.window.FarmAnimals.respawnWorldLivestock();
const repairedC = [...animalObjects].find(animal => animal.livestockId === 'grehlr-c');
assert(repairedC, 'full farm respawn repairs an outdoor adult that has no live world entity');
assert.equal(records[2].barnId, null, 'repair only borrows a barn as a native spawn anchor; persisted housing remains outdoors');
assert.strictEqual(worldObjects.get(repairedC.col + ',' + repairedC.row), repairedC, 'repaired outdoor adult is registered on the farm map/world occupancy');
assert.equal([...animalObjects].some(animal => animal.livestockId === 'baby-d'), false, 'Nursery babies remain non-world-present');

assert(saves.length > 0, 'outdoor presence transitions persist coordinates/state through the existing save seam');
for (const snapshot of saves) {
  const c = snapshot.find(entry => entry.id === 'grehlr-c');
  if (c) assert.equal(c.barnId, null, 'temporary repair spawn anchor is never persisted as real housing');
}
assert(welfareRefreshes > 0 && welfarePatches > 0, 'presence transitions refresh the existing outdoor welfare cache/visual wrappers');

const debug = context.window.__outdoorLivestockPresenceDebug.snapshot();
assert.equal(debug.outdoorAdults.length, 3, 'debug snapshot lists all outdoor adults independent of species');
assert.deepEqual(Array.from(debug.missingOutdoorAdults), [], 'debug snapshot confirms no saved outdoor adult is missing a live entity after repair');
assert(debug.lastTransitions.some(event => event.reason === 'unbarn-preserved'), 'debug history records non-destructive unbarning');
assert(debug.lastTransitions.some(event => event.action === 'respawned-missing'), 'debug history records repair of a previously missing outdoor adult');

console.log('Outdoor livestock world-presence regression tests passed.');