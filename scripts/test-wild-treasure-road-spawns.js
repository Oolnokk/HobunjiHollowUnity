#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for regression expectations against fresh scatter and save repair.
const fs = require('node:fs'); // Used to load the real runtime treasure module under test.
const vm = require('node:vm'); // Used to execute the browser-style module inside a controlled test context.

const source = fs.readFileSync('docs/js/wild-treasure.js', 'utf8'); // Used as the exact production source exercised by both road-placement scenarios.

class FakeGroup {
  constructor() {
    this.children = []; // Used to retain meshes added by the chest builder without needing Three.js.
    this.position = { set() {} }; // Used by ensureZone when positioning the buried chest group.
  }
  add(...children) { this.children.push(...children); }
}

class FakeMesh {
  constructor() {
    this.position = { y: 0, set() {} }; // Used by the chest builder for body/lid placement and by ensureZone for mesh positioning.
    this.castShadow = false; // Used by the chest builder's ordinary visual setup.
  }
}

class FakeBoxGeometry {}
class FakeMeshLambertMaterial {}

function createContext() {
  const context = { // Used as the browser-like global scope for the real wild-treasure module.
    window: {},
    console,
    Math,
    WildernessMapGenerator: {},
    THREE: {
      Group: FakeGroup,
      Mesh: FakeMesh,
      BoxGeometry: FakeBoxGeometry,
      MeshLambertMaterial: FakeMeshLambertMaterial,
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'wild-treasure.js' });
  return context;
}

function createHarness(context, persistedState = null) {
  const mapId = 'zone_road_test'; // Used as the shared zone key for scene, persistence, and treasure API calls.
  const TileType = { GRASS: 'grass', PATH: 'path', TRENCH: 'trench' }; // Used to distinguish a non-diggable road from legal soil and an exposed chest trench.
  const grid = [ // Used to force the empty-tile picker to encounter the road before the legal grass tile.
    [{ type: TileType.PATH, elevTier: 0 }, { type: TileType.GRASS, elevTier: 0 }],
    [{ type: TileType.GRASS, elevTier: 0 }, { type: TileType.GRASS, elevTier: 0 }],
  ];
  const sceneAdds = []; // Used to verify ensureZone can build the relocated/fresh chest without a real renderer.
  const scene = { // Used by ensureZone and cleanup while constructing fake treasure meshes.
    add(mesh) { sceneAdds.push(mesh); },
    remove(mesh) {
      const index = sceneAdds.indexOf(mesh); // Used to remove rebuilt fake meshes from the scene list.
      if (index >= 0) sceneAdds.splice(index, 1);
    },
  };
  const zoneScenes = new Map([[mapId, { cols: 2, rows: 2, grid, scene }]]); // Used by scatter, road scanning, burial depth, and save repair.
  const treasurePersist = new Map(); // Used as the live persistence store read/written by WildTreasure.
  if (persistedState) treasurePersist.set(mapId, persistedState);
  const treasureMeshGroups = new Map(); // Used by ensureZone to track built chest meshes and decide whether rebuilding is necessary.
  const treasureObjects = new Map(); // Used by syncZoneInteractivity while the chest remains buried.
  const reagentPersist = new Map(); // Used by scatter/repair avoidance; empty here so only roads constrain placement.
  const berryPersist = new Map(); // Used by scatter/repair avoidance; empty here so only roads constrain placement.
  const debugMessages = []; // Used to assert that legacy road repair reports what it did through the existing debug channel.
  const avoidSnapshots = []; // Used to prove PATH coordinates are handed to the shared empty-tile picker as occupied.

  function findZoneFlatEmptyTiles(_mapId, count, _rng, extraOccupied = []) {
    const occupied = new Set(extraOccupied.map(({ col, row }) => `${col},${row}`)); // Used to emulate the production picker's extraOccupied contract.
    avoidSnapshots.push(occupied);
    const spots = []; // Used to collect the first available coordinates in deterministic row-major order.
    for (let row = 0; row < grid.length && spots.length < count; row++) {
      for (let col = 0; col < grid[row].length && spots.length < count; col++) {
        if (!occupied.has(`${col},${row}`)) spots.push({ col, row });
      }
    }
    return spots;
  }

  const deps = { // Used to initialize WildTreasure with only the production dependencies touched by these scenarios.
    calendar: { day: 1 },
    rnd: () => 0.99,
    VERDIGRIS_METAL_KEYS: ['nativeCopper'],
    getLootPools: () => ({}),
    lootShopWorldState: () => ({}),
    MYSTERY_DYE_ITEM_KEY_BY_POOL: { default: 'mystery_dye_test' },
    _zoneScenes: zoneScenes,
    _zoneTreasurePersist: treasurePersist,
    _zoneTreasureMeshGroups: treasureMeshGroups,
    _zoneTreasureObjects: treasureObjects,
    _zoneReagentPersist: reagentPersist,
    _zoneBerryPersist: berryPersist,
    _mbRng: () => () => 0.5,
    _seedFromString: () => 12345,
    findZoneFlatEmptyTiles,
    TileType,
    NORMAL_TOP: 0,
    TRENCH_TOP: -0.5,
    PLATEAU_UNIT: 2.5,
    debugLog: message => debugMessages.push(message),
  };

  context.window.WildTreasure.init(deps);
  return { mapId, TileType, grid, treasurePersist, sceneAdds, debugMessages, avoidSnapshots };
}

const freshContext = createContext(); // Used for the brand-new weekly scatter regression case.
const freshHarness = createHarness(freshContext); // Used to capture fresh placement state and picker avoidance inputs.
freshContext.window.WildTreasure.ensureZone(freshHarness.mapId);
const freshState = freshContext.window.WildTreasure.serializeState()[freshHarness.mapId]; // Used to inspect the generated treasure coordinate.
assert.equal(freshState.placements.length, 1, 'fresh scatter still creates the expected buried chest');
assert.deepEqual(
  { col: freshState.placements[0].col, row: freshState.placements[0].row },
  { col: 1, row: 0 },
  'fresh treasure skips the first PATH road tile and lands on diggable ground',
);
assert.ok(freshHarness.avoidSnapshots[0].has('0,0'), 'fresh scatter reserves PATH road coordinates in the shared picker');

const legacyLoot = { marker: 'preserve-me' }; // Used to prove road repair moves an existing chest without rerolling its contents.
const legacyPlacement = { col: 0, row: 0, found: false, loot: legacyLoot }; // Used as a pre-fix save placement buried under the road tile.
const legacyContext = createContext(); // Used for the current-week persisted-save repair regression case.
const legacyHarness = createHarness(legacyContext, { week: 0, placements: [legacyPlacement] }); // Used to feed the inaccessible road chest into ensureZone.
legacyContext.window.WildTreasure.ensureZone(legacyHarness.mapId);
const repairedState = legacyContext.window.WildTreasure.serializeState()[legacyHarness.mapId]; // Used to inspect the migrated persisted placement after ensureZone.
assert.equal(repairedState.placements.length, 1, 'legacy repair keeps the accessible treasure rather than respawning or duplicating it');
assert.deepEqual(
  { col: repairedState.placements[0].col, row: repairedState.placements[0].row },
  { col: 1, row: 0 },
  'legacy PATH treasure is relocated onto a legal diggable tile',
);
assert.equal(repairedState.placements[0].loot, legacyLoot, 'legacy relocation preserves the chest\'s already-rolled loot bundle');
assert.ok(legacyHarness.avoidSnapshots[0].has('0,0'), 'legacy repair also reserves every PATH road coordinate');
assert.ok(
  legacyHarness.debugMessages.some(message => /relocated 1, dropped 0/.test(message)),
  'legacy repair reports its relocation through the existing debug log',
);

console.log('Wild treasure road-spawn regression checks passed.');
