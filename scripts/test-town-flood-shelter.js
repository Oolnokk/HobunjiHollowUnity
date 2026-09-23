const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadModule(path, windowObject) {
  const context = vm.createContext({ window: windowObject, console, Math, Map, Set, Float32Array });
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
  return windowObject;
}

function makeGrid(rows, cols, type, water = 0) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ type, water, crop: '', depth: 1 })));
}

// --- Town drainage: ordinary rain clears, strength-3 storms can overwhelm. ---
{
  const ROWS = 5, COLS = 5;
  const TileType = {
    GRASS: 'grass', WEEDS: 'weeds', TILLED: 'tilled', RAISED: 'raised',
    PADDY: 'paddy', TRENCH: 'trench', ROCK: 'rock', SHRUB: 'shrub',
    PATH: 'path', RIVER: 'river', STREAM: 'stream',
  };
  const farmGrid = makeGrid(ROWS, COLS, TileType.PATH, 0);
  const townGrid = makeGrid(ROWS, COLS, TileType.PATH, 0);
  const calendar = { isRaining: true, rainStrength: 2 };
  const windowObject = {};
  loadModule('docs/js/water-system.js', windowObject);
  windowObject.WaterSystem.init({
    calendar, TileType, ROWS, COLS, MAX_WATER: 3, RAIN_RATE: 0.018,
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    debugLog() {}, isSolid: type => type === TileType.ROCK || type === TileType.SHRUB,
    markTileDirty() {}, tileSurfaceY() { return 0; }, _markTerrainEdgeId() {},
    getGrid: () => farmGrid, getTownGrid: () => townGrid,
    getTownZone: () => ({ rows: ROWS, cols: COLS }),
    getTownSouthLevel: () => new Float32Array(COLS),
    getZoneWaterMeshes: () => new Map(), getScene: () => null, getTownScene: () => null,
    getSlabH: () => 0.25, getWaterUnit: () => 1, getNormalTop: () => 0,
  });

  windowObject.WaterSystem.recomputeWater(false, townGrid, ROWS, COLS);
  assert.equal(townGrid[2][2].water, 0, 'ordinary strength-2 rain should not accumulate on town paths');

  windowObject.WaterSystem.recomputeWater(false, farmGrid, ROWS, COLS);
  assert(farmGrid[2][2].water > 0, 'the new passive drain must remain town-only');

  calendar.rainStrength = 3;
  for (let i = 0; i < 20; i++) windowObject.WaterSystem.recomputeWater(false, townGrid, ROWS, COLS);
  assert(townGrid[2][2].water > 0.1, 'strength-3 rain should overcome town drainage and build floodwater');

  const debug = windowObject.WaterSystem.debugFloodSnapshot();
  assert.equal(debug.town.stormDrainRainEquivalent, 1.65, 'debug snapshot should expose town drain calibration');
  assert.equal(debug.town.floodEmergencyEnterFraction, 0.88, 'shelter entry should be calibrated as a fraction of max depth');
  assert(Math.abs(debug.town.floodEmergencyEnterDepth - 2.64) < 1e-9, 'MAX_WATER=3 should put shelter entry near max at 2.64 depth');
  assert(Math.abs(debug.town.floodEmergencyExitDepth - 2.1) < 1e-9, 'release hysteresis should wait until flood depth falls to 2.10');
  assert.equal(windowObject.WaterSystem.setTownFloodEmergencyDebugOverride(true), true, 'debug override should force emergency on');
  assert.equal(windowObject.WaterSystem.isTownFloodEmergency(), true, 'forced emergency should be observable');
  windowObject.WaterSystem.setTownFloodEmergencyDebugOverride(null);

  // Exercise the real hysteresis state machine with the same normalized
  // baseline depth updateTownWaterMeshes supplies in-game.
  windowObject.WaterSystem.debugTownFloodEmergencyStep(0);
  assert.equal(windowObject.WaterSystem.isTownFloodEmergency(), false);
  windowObject.WaterSystem.debugTownFloodEmergencyStep(0.87);
  assert.equal(windowObject.WaterSystem.isTownFloodEmergency(), false, '87% flood depth must remain below emergency');
  windowObject.WaterSystem.debugTownFloodEmergencyStep(0.88);
  assert.equal(windowObject.WaterSystem.isTownFloodEmergency(), true, '88% flood depth must enter emergency');
  windowObject.WaterSystem.debugTownFloodEmergencyStep(0.75);
  assert.equal(windowObject.WaterSystem.isTownFloodEmergency(), true, 'emergency must remain latched between enter and release thresholds');
  windowObject.WaterSystem.debugTownFloodEmergencyStep(0.70);
  assert.equal(windowObject.WaterSystem.isTownFloodEmergency(), false, '70% flood depth must release the emergency');
}

// --- Pathfinding topology reads must not load every building interior. ---
{
  let loads = 0;
  const windowObject = {};
  loadModule('docs/js/npc-pathfinding.js', windowObject);
  windowObject.NpcPathfinding.init({
    npcTransitionPool: area => area === 'town'
      ? [{ target: 'building', targetMapId: 'map_i_a', col: 10, row: 10 }]
      : [],
    buildingScenes: new Map(),
    loadBuildingScene() { loads++; },
    buildingSpawnFromExit: () => ({ col: 1, row: 1 }),
  });
  const topology = windowObject.NpcPathfinding.areaLinksFrom('town', { warmBuildings: false });
  assert.equal(topology[0].toArea, 'map_i_a');
  assert.equal(loads, 0, 'topology-only door queries must not warm interiors');
  windowObject.NpcPathfinding.areaLinksFrom('town');
  assert.equal(loads, 1, 'normal pathfinding should preserve eager destination warmup');
}

// --- Near-max flood cancels a town schedule, picks nearest building, and claims a free sit station. ---
{
  let emergency = true;
  let normalTarget = { area: 'town', c: 10, r: 10, activity: 'shopping' };
  const flooder = {
    rec: { id: 'npc_flooder' }, area: 'town',
    root: { position: { x: 10.5, z: 10.5 } }, currentScheduleTarget: null,
  };
  const blocker = {
    rec: { id: 'npc_blocker' }, area: 'map_i_a',
    root: { position: { x: 2.5, z: 2.5 } },
    currentScheduleTarget: { stationId: 'seat_a1' },
  };
  const walkers = [flooder, blocker];
  const scenes = new Map([
    ['map_i_a', { transitions: [{ target: 'exit_building', col: 1, row: 5 }] }],
    ['map_i_b', { transitions: [{ target: 'exit_building', col: 1, row: 5 }] }],
  ]);
  let loadCalls = 0;

  const townLinks = [
    { toArea: 'map_i_a', exit: { c: 9, r: 10 }, spawn: { c: 1, r: 4 } },
    { toArea: 'map_i_b', exit: { c: 45, r: 40 }, spawn: { c: 1, r: 4 } },
  ];
  const windowObject = {
    WaterSystem: {
      isTownFloodEmergency: () => emergency,
      debugFloodSnapshot: () => ({ town: { floodEmergency: emergency } }),
      setTownFloodEmergencyDebugOverride(value) { emergency = value === null ? emergency : !!value; return emergency; },
    },
    NpcPathfinding: {
      areaLinksFrom(area, options) {
        assert.equal(area, 'town');
        assert.equal(options?.warmBuildings, false, 'shelter selection must use topology-only town links');
        return townLinks;
      },
      findNpcAreaLink(from, to, options) {
        assert.equal(from, 'town');
        assert.equal(options?.warmBuildings, false);
        if (to === 'map_i_a') return townLinks[0];
        if (to === 'map_i_b') return townLinks[1];
        if (to === 'map_far_zone') return { toArea: 'map_far_zone', exit: { c: 59, r: 25 }, spawn: { c: 0, r: 0 } };
        return null;
      },
    },
    NpcActivityPlanner: {
      resolveNpcTarget: () => normalTarget,
    },
    SCRATCHBONES_CONFIG: { game: { movement: { npc: {} } } },
  };
  loadModule('docs/js/npc-scheduling.js', windowObject);
  windowObject.NpcScheduling.init({
    npcWalkers: walkers,
    calendar: { day: 1, time01: 0.5 },
    getCurrentArea: () => 'town',
    getWorldNpcPaths: () => [],
    getSharedSchedules: () => [],
    isBuildingArea: area => /^map_i_/.test(area || ''),
    buildingScenes: scenes,
    loadBuildingScene() { loadCalls++; },
    normalizeNpcArea: area => area || 'farm',
    getDecorativeFurnitureKeyByItemKey: () => '',
    decorativeFurnitureDefs: {},
  });
  windowObject.NpcScheduling.registerNpcStations([
    { id: 'seat_a1', area: 'map_i_a', c: 2, r: 2, pose: 'sit', roles: ['sit'], furnitureKey: 'chair' },
    { id: 'seat_a2', area: 'map_i_a', c: 3, r: 2, pose: 'sit', roles: ['sit'], furnitureKey: 'chair' },
    { id: 'seat_b1', area: 'map_i_b', c: 2, r: 2, pose: 'sit', roles: ['sit'], furnitureKey: 'chair' },
  ]);

  const shelter = windowObject.NpcScheduling.resolveNpcScheduleTarget(flooder.rec);
  assert.equal(shelter.floodShelter, true);
  assert.equal(shelter.area, 'map_i_a', 'nearest building should be chosen from scheduled town location');
  assert.equal(shelter.stationId, 'seat_a2', 'occupied seat should be skipped for a free sit station');
  assert.equal(shelter.pose, 'sit');
  assert.equal(shelter.obligation, 'critical', 'flood shelter should override ordinary schedule behavior');
  assert.equal(loadCalls, 0, 'already-loaded selected shelter should not trigger unrelated loads');

  normalTarget = { area: 'town', c: 50, r: 40, activity: 'changed schedule' };
  const heldShelter = windowObject.NpcScheduling.resolveNpcScheduleTarget(flooder.rec);
  assert.equal(heldShelter.area, 'map_i_a', 'NPC should stay committed to one shelter until emergency clears');

  emergency = false;
  const resumed = windowObject.NpcScheduling.resolveNpcScheduleTarget(flooder.rec);
  assert.equal(resumed.area, 'town');
  assert.equal(resumed.c, 50);
  assert.equal(resumed.r, 40);
  assert.equal(resumed.floodShelter, undefined, 'normal schedule should resume after hysteresis releases');

  const outsider = { id: 'npc_outside' };
  walkers.push({ rec: outsider, area: 'map_far_zone', root: { position: { x: 5, z: 5 } }, currentScheduleTarget: null });
  normalTarget = { area: 'map_far_zone', c: 6, r: 6, activity: 'wilderness work' };
  emergency = true;
  const untouched = windowObject.NpcScheduling.resolveNpcScheduleTarget(outsider);
  assert.equal(untouched.area, 'map_far_zone', 'non-town NPCs must not be pulled into Hobunji shelters');
  assert.equal(untouched.floodShelter, undefined);

  // An NPC already indoors in map_i_b whose schedule points at a street spot
  // right outside map_i_a must shelter in place, not cross the flooded town.
  const indoors = { id: 'npc_indoors' };
  walkers.push({ rec: indoors, area: 'map_i_b', root: { position: { x: 4.5, z: 3.5 } }, currentScheduleTarget: null });
  normalTarget = { area: 'town', c: 9, r: 10, activity: 'errand by building A' };
  const inPlace = windowObject.NpcScheduling.resolveNpcScheduleTarget(indoors);
  assert.equal(inPlace.floodShelter, true);
  assert.equal(inPlace.area, 'map_i_b', 'NPC already inside a town building must shelter where they are');
  assert.equal(inPlace.stationId, 'seat_b1', 'in-place shelter still takes a free seat in the current building');

  // Seatless in-place shelter holds the NPC's current indoor spot instead of the door.
  const indoorsSeatless = { id: 'npc_indoors_seatless' };
  walkers.push({ rec: indoorsSeatless, area: 'map_i_b', root: { position: { x: 6.5, z: 7.5 } }, currentScheduleTarget: null });
  const holdSpot = windowObject.NpcScheduling.resolveNpcScheduleTarget(indoorsSeatless);
  assert.equal(holdSpot.area, 'map_i_b');
  assert.equal(holdSpot.pose, 'stand');
  assert.equal(holdSpot.c, 6, 'no free seat → stay at current indoor column');
  assert.equal(holdSpot.r, 7, 'no free seat → stay at current indoor row');
}

// --- A shelter interior that is still loading (null sentinel) is loaded only once. ---
{
  const walkers = [{ rec: { id: 'npc_wait' }, area: 'town', root: { position: { x: 9.5, z: 10.5 } }, currentScheduleTarget: null }];
  const scenes = new Map();
  let loadCalls = 0;
  const links = [{ toArea: 'map_i_a', exit: { c: 9, r: 10 }, spawn: { c: 1, r: 4 } }];
  const windowObject = {
    WaterSystem: { isTownFloodEmergency: () => true },
    NpcPathfinding: {
      areaLinksFrom: () => links,
      findNpcAreaLink: (from, to) => (to === 'map_i_a' ? links[0] : null),
    },
    NpcActivityPlanner: { resolveNpcTarget: () => ({ area: 'town', c: 9, r: 11, activity: 'shopping' }) },
    SCRATCHBONES_CONFIG: { game: { movement: { npc: {} } } },
  };
  loadModule('docs/js/npc-scheduling.js', windowObject);
  windowObject.NpcScheduling.init({
    npcWalkers: walkers,
    calendar: { day: 1, time01: 0.5 },
    getCurrentArea: () => 'town',
    getWorldNpcPaths: () => [],
    getSharedSchedules: () => [],
    isBuildingArea: area => /^map_i_/.test(area || ''),
    buildingScenes: scenes,
    loadBuildingScene(mapId) { loadCalls++; scenes.set(mapId, null); }, // Mirrors game.js: in-flight sentinel stays null until the scene resolves.
    normalizeNpcArea: area => area || 'farm',
    getDecorativeFurnitureKeyByItemKey: () => '',
    decorativeFurnitureDefs: {},
  });
  for (let frame = 0; frame < 5; frame++) {
    const waiting = windowObject.NpcScheduling.resolveNpcScheduleTarget(walkers[0].rec);
    assert.equal(waiting.floodShelterWaitingForInterior, true);
  }
  assert.equal(loadCalls, 1, 'per-frame resolves must not restart an in-flight shelter interior load');
}

console.log('Town flood drainage + shelter regression: PASS');
