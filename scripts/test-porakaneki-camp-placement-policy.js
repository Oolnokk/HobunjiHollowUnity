const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const temporaryLocalesSource = fs.readFileSync('docs/js/temporary-locales.js', 'utf8'); // Real generic locale placement engine exercised below.
const policySource = fs.readFileSync('docs/js/porakaneki-camp-placement-policy.js', 'utf8'); // Real Porakaneki clutter/fallback adapter under test.
const loaderSource = fs.readFileSync('docs/js/house-pieces.js', 'utf8'); // Production parser-time ordering contract.

function makeDenseZone(cols = 30, rows = 30) {
  const tiles = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => ({
    height: 0,
    water: false,
    path: false,
    ramp: false,
    waterfall: false,
    terrain: (col + row) % 2 ? 'shrub' : 'rock',
    occupiedBy: `porakaneki_clutter_${col}_${row}`,
  })));
  const objects = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    objects.push({
      id: `porakaneki_clutter_${col}_${row}`,
      type: 'unique',
      x: col,
      y: row,
      w: 1,
      h: 1,
      localeMeta: true,
    });
  }
  return { cols, rows, tiles, objects, entry: { x: 0, y: 0 } };
}

function makeChiefLocale() {
  return {
    id: 'locale_porakaneki_camp_chief',
    tiles: {
      '0,0': { type: 'grass' },
      '12,0': { type: 'grass' },
      '0,10': { type: 'grass' },
      '12,10': { type: 'grass' },
      '6,5': { type: 'grass' },
    },
    objects: [
      { id: 'tent', kind: 'tent', key: 'tent', label: 'Tent', col: 1, row: 1, w: 2, h: 2 },
    ],
    placement: {
      clearanceTiles: 3,
      requiresFlatGround: true,
      minDistanceFromEntry: 14,
    },
  };
}

let currentArea = 'map_western_slope';
let campSnapshot = { zones: { map_western_slope: { camps: [] } } };
let liveGrid = Array.from({ length: 30 }, (_, row) => Array.from({ length: 30 }, (_, col) => ({
  type: (col + row) % 2 ? 'shrub' : 'rock',
})));
let refreshCount = 0;
let banditTickCount = 0;

const contextWindow = {
  BanditCamps: {
    updateCampBanners() { banditTickCount += 1; return 'bandit-tick'; },
  },
  GridTileAccessors: {
    getCurrentArea: () => currentArea,
    getActiveGrid: () => liveGrid,
  },
  ZoneRegrowth: {
    refreshZoneGroundVisuals(zoneId) {
      assert.equal(zoneId, currentArea);
      refreshCount += 1;
    },
  },
  PorakanekiCamps: {
    debugSnapshot: () => campSnapshot,
  },
};
contextWindow.window = contextWindow;
const context = vm.createContext({
  window: contextWindow,
  globalThis: contextWindow,
  console,
  Math,
  Date,
  Set,
  Map,
  Object,
  Number,
  String,
});

vm.runInContext(temporaryLocalesSource, context, { filename: 'temporary-locales.js' });
vm.runInContext(policySource, context, { filename: 'porakaneki-camp-placement-policy.js' });

assert.equal(contextWindow.PorakanekiCampPlacementPolicy.version, 1);
assert(loaderSource.indexOf("['PorakanekiCampPlacementPolicy', 'porakaneki-camp-placement-policy.js?v=20260912a']") >= 0, 'placement policy is parser-loaded');
assert(loaderSource.indexOf("['PorakanekiCampPlacementPolicy'") < loaderSource.indexOf("['PorakanekiCamps'"), 'placement policy loads before camp generation');
assert(loaderSource.indexOf("['PorakanekiCamps'") < loaderSource.indexOf("['PorakanekiMapMarkers'"), 'camp state still updates before map proxies');

// This is the production failure shape: every otherwise-valid tile has an
// ordinary procedural shrub/rock occupancy record. Before the policy, the
// large chief footprint has no legal site at all because every one of those
// records is type=unique + localeMeta=true.
const denseZone = makeDenseZone();
const chiefLocale = makeChiefLocale();
const instance = contextWindow.TemporaryLocales.stamp(denseZone, chiefLocale, {
  instanceId: 'porakaneki_chief_reservation_map_western_slope',
  clearableTypes: new Set(),
  clearanceTiles: 3,
  requiresFlatGround: true,
  minDistanceFromEntry: 14,
  rng: () => 0.5,
});
assert(instance, 'Porakaneki chief camp must still receive a site in shrub/rock-dense wilderness');
assert(instance.removedObjectSnapshots.length > 0, 'placement records the ordinary clutter displaced by the camp');
assert(instance.removedObjectSnapshots.every(snapshot => snapshot.type === 'shrub'), 'only the feature-tagged procedural clutter becomes clearable');
assert(instance.removedObjectSnapshots.every(snapshot => snapshot.srcType === 'shrub' || snapshot.srcType === 'rock'), 'original terrain type is retained for live-grid restoration');

// The adapter must not weaken TemporaryLocales globally. The same synthetic
// occupancy remains a hard blocker for unrelated temporary locales.
const unrelatedZone = makeDenseZone();
const unrelated = contextWindow.TemporaryLocales.stamp(unrelatedZone, chiefLocale, {
  instanceId: 'some_other_runtime_locale',
  clearableTypes: new Set(),
  clearanceTiles: 0,
  requiresFlatGround: true,
  minDistanceFromEntry: 0,
  rng: () => 0.5,
});
assert.equal(unrelated, null, 'non-Porakaneki temporary locales keep the original blocker policy');

// When the camp is actually active in the map the same saved snapshots clear
// its live grid; seasonal migration restores the old chief-camp clearing.
campSnapshot.zones.map_western_slope.camps = [{ id: instance.id }];
assert.equal(contextWindow.BanditCamps.updateCampBanners(0.2), 'bandit-tick');
assert.equal(banditTickCount, 1);
assert(refreshCount >= 1, 'active camp clearing refreshes the current wilderness visuals');
for (const snapshot of instance.removedObjectSnapshots.slice(0, 12)) {
  assert.equal(liveGrid[snapshot.y][snapshot.x].type, 'grass', 'active camp removes procedural clutter from its live footprint');
}

campSnapshot.zones.map_western_slope.camps = [];
contextWindow.BanditCamps.updateCampBanners(0.2);
assert.equal(banditTickCount, 2);
for (const snapshot of instance.removedObjectSnapshots.slice(0, 12)) {
  assert.equal(liveGrid[snapshot.y][snapshot.x].type, snapshot.srcType, 'inactive seasonal chief reservation restores its prior terrain type');
}

// A rebuilt/re-entered grid is a new object, so the policy must not assume an
// old applied-set means the clearing is still present.
liveGrid = Array.from({ length: 30 }, (_, row) => Array.from({ length: 30 }, (_, col) => ({
  type: (col + row) % 2 ? 'shrub' : 'rock',
})));
campSnapshot.zones.map_western_slope.camps = [{ id: instance.id }];
contextWindow.BanditCamps.updateCampBanners(0.2);
for (const snapshot of instance.removedObjectSnapshots.slice(0, 12)) {
  assert.equal(liveGrid[snapshot.y][snapshot.x].type, 'grass', 'camp clearing is re-applied after a wilderness grid rebuild/re-entry');
}

// avoidPoints: a generic minimum-distance-from-arbitrary-points constraint
// on TemporaryLocales.stamp itself (not Porakaneki-specific -- see its own
// comment), used by both porakaneki-camps-runtime.js and bandit-camps.js so
// neither system's camps land right next to the other's regardless of which
// one claims its site first.
function makeFlatZone(cols, rows) {
  const tiles = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
    height: 0, water: false, path: false, ramp: false, waterfall: false, terrain: 'grass', occupiedBy: null,
  })));
  return { cols, rows, tiles, objects: [], entry: { x: 0, y: 0 } };
}
function makeSmallLocale(id = 'locale_test_small') {
  return {
    id,
    tiles: { '0,0': { type: 'grass' }, '2,0': { type: 'grass' }, '0,2': { type: 'grass' }, '2,2': { type: 'grass' } },
    objects: [],
    placement: { clearanceTiles: 0, requiresFlatGround: true, minDistanceFromEntry: 0 },
  };
}

{
  const zone = makeFlatZone(20, 20);
  const locale = makeSmallLocale();
  const avoidPoints = [{ col: 5, row: 5, minDistance: 6 }];
  const instance = contextWindow.TemporaryLocales.stamp(zone, locale, {
    instanceId: 'avoid_points_check',
    clearableTypes: new Set(),
    clearanceTiles: 0,
    requiresFlatGround: true,
    minDistanceFromEntry: 0,
    avoidPoints,
    rng: () => 0.999, // Picks from the end of the shuffled candidate list deterministically.
  });
  assert(instance, 'a site still exists plenty far from the single avoided point in an open zone');
  const cx = instance.site.x + instance.site.w / 2, cy = instance.site.y + instance.site.h / 2;
  const dist = Math.hypot(cx - avoidPoints[0].col, cy - avoidPoints[0].row);
  assert(dist >= avoidPoints[0].minDistance, `placed site (dist=${dist}) must respect avoidPoints' minDistance`);
}

{
  // A zone small enough that the ONLY fitting site is inside the avoided
  // radius: campStampAttempts' last-resort attempt must still place the
  // camp (better than not placing one at all) by dropping avoidPoints,
  // rather than TemporaryLocales.stamp itself ever bending the rule.
  const zone = makeFlatZone(4, 4);
  const locale = makeSmallLocale('porakaneki_tiny_test');
  const avoidPoints = [{ col: 1, row: 1, minDistance: 20 }];
  const direct = contextWindow.TemporaryLocales.stamp(zone, locale, {
    instanceId: 'other_tiny_direct', // Not porakaneki-prefixed: bypasses the wrapped retry chain entirely.
    clearableTypes: new Set(),
    clearanceTiles: 0,
    requiresFlatGround: true,
    minDistanceFromEntry: 0,
    avoidPoints,
    rng: () => 0.5,
  });
  assert.equal(direct, null, 'TemporaryLocales.stamp itself never bends avoidPoints on its own');

  const viaPolicy = contextWindow.TemporaryLocales.stamp(zone, locale, {
    instanceId: 'porakaneki_tiny_via_policy',
    clearableTypes: new Set(),
    clearanceTiles: 0,
    requiresFlatGround: true,
    minDistanceFromEntry: 0,
    avoidPoints,
    rng: () => 0.5,
  });
  assert(viaPolicy, 'the porakaneki-prefixed instanceId lets the placement policy fall back to dropping avoidPoints rather than placing nothing');
}

console.log('Porakaneki dense-wilderness camp placement policy regression passed.');
