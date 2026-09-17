#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership migration of livestock-nursery.js's
// startSwarmLoop()/stopSwarmLoop() pair: the self-perpetuating baby-swarm
// RAF loop becomes a RuntimeFrameScheduler register()/unregister() pair,
// the same context-scoped shape already used by
// docs/js/combat/melee-hud-reticle.js. The loop starts on entering the
// nursery interior (via the wrapped FarmBuildings enterBuilding hook) and
// self-unregisters (via stopSwarmLoop) once it has genuinely been active
// and then leaves.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/livestock-nursery.js', 'utf8');
assert(source.includes("window.RuntimeFrameScheduler.register(SWARM_SCHEDULER_ID"), 'startSwarmLoop must register with the scheduler');
assert(source.includes('window.RuntimeFrameScheduler.unregister(SWARM_SCHEDULER_ID)'), 'stopSwarmLoop must unregister from the scheduler');
assert(!/requestAnimationFrame\(/.test(source), 'the swarm loop must no longer self-schedule a raw requestAnimationFrame');

const NURSERY_MAP_ID = 'map_i_barn_farm_nursery';

function buildFixture() {
  const registered = new Map();
  let area = 'farm';
  const windowObject = {
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); return () => registered.delete(id); },
      unregister(id) { return registered.delete(id); },
    },
    FarmAnimals: { init() {} },
    FarmBuildings: { BARN_PIECES: { small: { file: 'config/pieces/barn-small.json', w: 4, h: 3 } }, init() {} },
    FarmTroughs: { init() {} },
    FarmPanel: { init() {} },
    Music: { isNightTime() { return false; } },
    CreatureGenetics: { creatureSizeScale() { return { x: 1, y: 1 }; } },
    SCRATCHBONES_CONFIG: { game: { livestock: { animalWidths: {} } } },
  };
  windowObject.window = windowObject;
  const documentObject = {
    readyState: 'complete',
    body: null,
    getElementById() { return null; },
    addEventListener() {},
  };
  const sandbox = {
    window: windowObject,
    document: documentObject,
    console,
    navigator: {},
    MutationObserver: undefined,
    queueMicrotask,
    performance: { now: () => 1000 },
    Math, Number, Object, Array, Set, Map, Promise, String, RegExp, JSON, Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'livestock-nursery.js' });

  const buildings = [];
  const animalDeps = {
    loadWorldLivestock: () => [],
    saveWorldLivestock() {},
    _loadWorldBreedingPairs: () => [],
    _saveWorldBreedingPairs() {},
    hasFarmPermission: () => true,
    animalObjects: new Set(),
    worldObjects: new Map(),
    getFarmBuildings: () => buildings,
    getCurrentArea: () => area,
    getPlayerFaceTarget: () => ({ x: 1, z: 1, worldY: 1 }),
    player: { x: 0, y: 0 },
    TILE: 48,
    COLS: 60,
    ROWS: 50,
    CREATURE_DB: {},
    showToast() {},
  };
  const buildingDeps = {
    getFarmBuildings: () => buildings,
    getBarnTiers: () => ({}),
    COLS: 60,
    ROWS: 50,
    saveFarmLayout() {},
    saveMemberWorldData() {},
    hasFarmPermission: () => true,
    enterBuilding() {},
    setFarmLivestockFocusBarnId() {},
    openMenu() {},
  };
  windowObject.FarmAnimals.init(animalDeps);
  windowObject.FarmBuildings.init(buildingDeps);
  windowObject.FarmTroughs.init({});
  windowObject.FarmPanel.init({});

  return { windowObject, registered, setArea: value => { area = value; }, buildingDeps };
}

// --- Entering the nursery registers once with a stable id -------------------
{
  const { registered, buildingDeps, setArea } = buildFixture();
  setArea(NURSERY_MAP_ID);
  buildingDeps.enterBuilding(NURSERY_MAP_ID); // installHooks() wrapped this to call startSwarmLoop().
  const entry = registered.get('livestock-nursery-swarm');
  assert(entry, 'entering the nursery registers the swarm loop with the scheduler');
  assert.equal(entry.options.owner, 'LivestockNursery');
}

// --- Re-entering while already registered does not double-register ---------
{
  const { registered, buildingDeps, setArea } = buildFixture();
  setArea(NURSERY_MAP_ID);
  buildingDeps.enterBuilding(NURSERY_MAP_ID);
  const firstFn = registered.get('livestock-nursery-swarm').fn;
  buildingDeps.enterBuilding(NURSERY_MAP_ID);
  assert.equal(registered.get('livestock-nursery-swarm').fn, firstFn, 'repeated entry must not re-register a second subscription');
}

// --- Driving the callback while inside does not throw and does not unregister
{
  const { registered, buildingDeps, setArea } = buildFixture();
  setArea(NURSERY_MAP_ID);
  buildingDeps.enterBuilding(NURSERY_MAP_ID);
  const entry = registered.get('livestock-nursery-swarm');
  assert.doesNotThrow(() => entry.fn({ timestamp: 1000 }), 'the scheduler callback must tolerate an empty swarm without throwing');
  assert.doesNotThrow(() => entry.fn({ timestamp: 1016 }));
  assert(registered.has('livestock-nursery-swarm'), 'the subscription must remain registered while still inside the nursery');
}

// --- Leaving after genuinely being inside self-unregisters immediately -----
{
  const { registered, buildingDeps, setArea } = buildFixture();
  setArea(NURSERY_MAP_ID);
  buildingDeps.enterBuilding(NURSERY_MAP_ID);
  const entry = registered.get('livestock-nursery-swarm');
  entry.fn({ timestamp: 1000 }); // Marks swarmEntered = true.
  setArea('farm');
  entry.fn({ timestamp: 1016 }); // Now outside after having been inside: stops immediately.
  assert(!registered.has('livestock-nursery-swarm'), 'leaving after being inside must unregister the swarm loop right away');
}

// --- A brief transition out (never truly entered) tolerates a grace period -
{
  const { registered, buildingDeps, setArea } = buildFixture();
  setArea('farm'); // Never actually inside NURSERY_MAP_ID for this run.
  buildingDeps.enterBuilding(NURSERY_MAP_ID); // Still registers: the hook fires on entry regardless of the area check's own state.
  const entry = registered.get('livestock-nursery-swarm');
  for (let i = 0; i < 120; i++) entry.fn({ timestamp: 1000 + i });
  assert(registered.has('livestock-nursery-swarm'), 'must not unregister before the ~120-frame grace period elapses');
  entry.fn({ timestamp: 1200 });
  assert(!registered.has('livestock-nursery-swarm'), 'must unregister once the grace period is exceeded');
}

console.log('livestock nursery swarm scheduler migration passed');
