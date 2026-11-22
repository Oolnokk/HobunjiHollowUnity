'use strict';

const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');

global.window = { InventoryStacks: require('./lib/inventory-stacks') };
global.document = { dispatchEvent: () => {} };
require(path.join(root, 'docs/js/alchemy-system.js'));
require(path.join(root, 'docs/js/reagent-plants.js'));

const ZONES = [
  'map_northern_cliffs',
  'map_southern_cloud_forest',
  'map_western_slope',
  'map_eastern_mire',
];

function makeGrid(cols = 20, rows = 20) {
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ type:'grass', elevTier:0 })));

  for (let c = 2; c < cols - 2; c++) grid[2][c] = { type:'river', elevTier:0 }; // Water-edge habitat.
  for (let c = 2; c < cols - 2; c++) grid[7][c] = { type:'cliff', elevTier:1 }; // Lower adjacent grass is the cliff-base habitat.
  for (let c = 2; c < cols - 2; c += 2) grid[11][c] = { type:'rock', elevTier:0, rockKind:'diggableRockOre' }; // Rock-edge habitat.
  for (let c = 2; c < cols - 2; c += 2) grid[15][c] = { type:'shrub', elevTier:0, floraKind:'bush' }; // Shrub-edge habitat.
  for (let c = 3; c < cols - 2; c += 3) grid[18][c] = { type:'shrub', elevTier:0, floraKind:'copse' }; // Tree-root habitat.

  return grid;
}

function seedFromString(value) {
  let h = 2166136261;
  for (const ch of String(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const calendar = { day: 10 };
const zoneScenes = new Map(ZONES.map(zoneId => [zoneId, { cols:20, rows:20, grid:makeGrid() }]));
const reagentPersist = new Map();
const reagentMeshes = new Map();
const reagentObjects = new Map();
const inventory = {};
const debugMessages = [];

function findZoneFlatEmptyTiles(mapId, count, rng, extraOccupied = []) {
  const occupied = new Set((extraOccupied || []).map(({ col, row }) => `${col},${row}`)); // Matches the production helper's occupied-tile contract.
  const grid = zoneScenes.get(mapId).grid;
  const candidates = [];
  for (let row = 0; row < grid.length; row++) for (let col = 0; col < grid[row].length; col++) {
    const tile = grid[row][col];
    if (tile.type !== 'grass' || occupied.has(`${col},${row}`)) continue;
    candidates.push({ col, row });
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

window.ReagentPlants.init({
  calendar,
  _zoneScenes: zoneScenes,
  _zoneReagentPersist: reagentPersist,
  _zoneReagentMeshGroups: reagentMeshes,
  _zoneReagentObjects: reagentObjects,
  _mbRng: makeRng,
  _seedFromString: seedFromString,
  findZoneFlatEmptyTiles,
  inventory,
  random: () => 1,
  bonusYieldChance: () => 0,
  awardForagingXp: () => {},
  refreshItemScroll: () => {},
  debugLog: message => debugMessages.push(message),
  getCurrentArea: () => ZONES[0],
});

for (const zoneId of ZONES) {
  const first = window.ReagentPlants.scatterReagentsForZone(zoneId);
  const repeated = window.ReagentPlants.scatterReagentsForZone(zoneId);
  assert.deepStrictEqual(repeated, first, `${zoneId} must stay deterministic within one day`);
  assert.ok(first.length >= 5, `${zoneId} should place enough herbs to represent its five species`);

  const species = new Set(first.map(placement => placement.key));
  for (const key of window.AlchemySystem.reagentsForZone(zoneId)) {
    assert.ok(species.has(key), `${zoneId} should represent ${key} when its habitat is available`);
  }
  for (const placement of first) {
    assert.ok(window.ReagentPlants.placementMatchesHabitat(zoneId, placement), `${placement.key} must spawn inside its configured sub-habitat`);
  }

  calendar.day++;
  const next = window.ReagentPlants.scatterReagentsForZone(zoneId, first);
  const previousTiles = new Set(first.map(({ col, row }) => `${col},${row}`));
  assert.ok(next.every(({ col, row }) => !previousTiles.has(`${col},${row}`)), `${zoneId} must not reuse a herb tile on the next respawn`);
  calendar.day++;
}

const sampleZone = ZONES[0];
const sample = window.ReagentPlants.scatterReagentsForZone(sampleZone)[0];
reagentPersist.set(sampleZone, { version:window.ReagentPlants.HABITAT_VERSION, day:calendar.day, placements:[{ ...sample, harvested:false }] });
reagentMeshes.set(sampleZone, [ {} ]);
reagentObjects.set(sampleZone, new Map([[sample.col + ',' + sample.row, {}]]));
zoneScenes.get(sampleZone).scene = { remove: () => {} };
const plantObject = window.ReagentPlants.makeReagentPlantObject(sampleZone, sample.col, sample.row, sample.key, reagentMeshes.get(sampleZone)[0]);
assert.strictEqual(plantObject.onAction('obj_pick_reagent').ok, true, 'harvesting a habitat herb should still use the ordinary reagent pick flow');
assert.strictEqual(reagentPersist.get(sampleZone).placements.length, 1, 'harvested placement history must be retained for next-day exclusion');
assert.strictEqual(reagentPersist.get(sampleZone).placements[0].harvested, true, 'harvested placement history must be marked inactive');

const saved = window.ReagentPlants.serializeZoneReagentState();
assert.strictEqual(saved[sampleZone].version, window.ReagentPlants.HABITAT_VERSION, 'habitat save version must persist');
assert.strictEqual(saved[sampleZone].placements[0].harvested, true, 'harvested history must survive save serialization');


// An already-generated habitat-v2 day must keep its gathered plants and
// positions through the new mushroom catalog upgrade. New fungi join the next
// daily scatter, never replacing today's known/harvested wild herbs mid-save.
global.WildernessMapGenerator = { zoneMapIds: () => ZONES };
const oldDay = { version:2, day:calendar.day, placements:[
  { col:1, row:2, key:'frostcapMoss', harvested:true },
  { col:3, row:5, key:'graniteThistle', harvested:true },
] }; // Picked-only layout avoids needing a graphical THREE world in this migration check.
reagentPersist.set(sampleZone, oldDay);
reagentMeshes.delete(sampleZone);
reagentObjects.delete(sampleZone);
window.ReagentPlants.ensureZoneReagents(sampleZone);
const upgraded = reagentPersist.get(sampleZone);
assert.strictEqual(upgraded.version, window.ReagentPlants.HABITAT_VERSION,
  'same-day v2 forage record promotes its schema without regenerating habitat placements');
assert.deepStrictEqual(upgraded.placements, oldDay.placements,
  'the schema bump preserves already picked locations and species until tomorrow');
assert.strictEqual(upgraded.placements.every(row => row.harvested), true,
  'schema bump cannot make previously harvested plants pickable again today');

console.log('reagent habitat tests passed');
