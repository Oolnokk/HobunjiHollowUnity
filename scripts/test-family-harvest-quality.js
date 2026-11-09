#!/usr/bin/env node
'use strict';

// Executes the actual quality/harvest closures extracted from the shipped game.js.
// No separate fake implementation of the harvesting algorithm is permitted here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');

// Exact production function extraction: failing anchors intentionally fail the test
// when future refactors move or alter these authorities.
function extractFunction(startMarker, endMarker, stripPrefix = '') {
  const start = game.indexOf(startMarker);
  assert.ok(start >= 0, 'game.js contains the authoritative ' + startMarker.trim());
  const end = game.indexOf(endMarker, start);
  assert.ok(end > start, 'game.js has the expected function boundary for ' + startMarker.trim());
  const code = game.slice(start + stripPrefix.length, end + (stripPrefix ? '\n        }'.length : 0)).trim();
  return code;
}

const recorded = []; // Captures real processing quality-bucket writes.
const inventory = {}; // Directly shared with both extracted production functions.
let processingRerolls = 0; // Detects player-skill quality accidentally applied to family goods.
const processingContext = {
  inventory, PROCESSING_METHOD_CLASSES: { squeezing: 'quick' },
  window: {
    SkillSystem: { rollProcessingQuality: () => { processingRerolls++; return 5; } },
    PerkSystem: { rank: () => 0 },
    GameRandom: { random: () => 0.99 },
    ItemProcessing: { ensureProcessedItemDef() {} },
    InventoryStacks: { MAX_TOTAL: 999 },
    CookingSystem: { recordItemQuality: (item, stars, count) => recorded.push({ item, stars, count }) },
  },
};
const addProcessedOutputs = vm.runInNewContext('(' +
  extractFunction('      function addProcessedOutputs(', '\n      function makeProcessingFurniture(') + ')', processingContext);

assert.match(game, /addProcessedOutputs\(finished\.outputs, finished\.inputStars, def\.method, finished\.yieldMultiplier, finished\.source === 'family'\)/,
  'timed vat completions pass their saved family source through to the quality resolver');
assert.equal(addProcessedOutputs([{ key: 'milk' }], 1, 'squeezing', 2, true), 1,
  'family toddler output remains 1★ despite a 5★ player-processing roll');
assert.equal(inventory.milk, 2, 'family worker still doubles squeezing quantity');
assert.deepEqual(recorded.at(-1), { item: 'milk', stars: 1, count: 2 }, 'quality bucket records actual 1★ family output');
assert.equal(processingRerolls, 0, 'family output never invokes player processing mastery');
assert.equal(addProcessedOutputs([{ key: 'milk' }], 2, 'squeezing', 1, false), 5,
  'ordinary processing retains the existing player quality reroll');
assert.equal(processingRerolls, 1, 'ordinary processing still calls player mastery once');

// Run the real family-grid callback instead of a stub in test-npc-farm-plots.
const tile = { type: 'tilled', crop: 'needlegrain', cropAge: 4, cropReady: true, fertilized: true };
const grid = [[], [null, tile]];
const farmQuality = []; // Family harvest quality is tracked as real inventory-quality bucket updates.
let persisted = 0; // A successful harvest must persist both the farm and inventory state.
let dirty = 0; // Real tiles must be invalidated for rendered crop removal.
const harvestContext = {
  grid, inventory, TileType: { TILLED: 'tilled', RAISED: 'raised', GRASS: 'grass', WEEDS: 'weeds', TRENCH: 'trench', ROCK: 'rock' },
  CropType: { NONE: '' },
  cropData: { needlegrain: { cropKey: 'needlegrain', seedKey: 'needlegrainSeeds' } },
  _loadWorldStorage: () => ({}), _saveWorldStorage: () => true,
  currentArea: 'farm', markTileDirty: () => { dirty++; },
  saveMemberWorldData: () => { persisted++; },
  window: {
    FarmPlotEditor: { plots: () => [{ id: 'field1', kind: 'till', tiles: [[1, 1]] }] },
    InventoryStacks: { MAX_TOTAL: 999 },
    CookingSystem: { recordItemQuality: (item, stars, count) => farmQuality.push({ item, stars, count }) },
    RomanceFamily: { rollWorkQuality: id => id === 'toddler1' ? 1 : 2 },
    WaterSystem: { recomputeWater() {} },
    FarmEditor: { saveFarmLayout() { persisted++; } },
  },
};
const marker = '        applyFarmJob: ';
const callback = extractFunction(marker, '\n        },\n      });', marker);
const applyFarmJob = vm.runInNewContext('(' + callback + ')', harvestContext);

assert.equal(applyFarmJob('harvest', 1, 1, 'needlegrain', 'incorrectField', 'toddler1'), false,
  'a stale plot cannot harvest someone else’s field');
assert.equal(applyFarmJob('harvest', 1, 1, 'needlegrain', 'field1', null), false,
  'player-unsupported delegated harvests cannot bypass worker attribution');
assert.equal(applyFarmJob('harvest', 1, 1, 'needlegrain', 'field1', 'toddler1'), true);
assert.equal(inventory.needlegrain, 1, 'real delegated harvest increments player Pack inventory');
assert.deepEqual(farmQuality[0], { item: 'needlegrain', stars: 1, count: 1 },
  'toddler harvests grade at exactly 1★');
assert.equal(tile.crop, '', 'harvest clears live crop from its tile');
assert.equal(tile.fertilized, false, 'harvest consumes fertilizer and crop state');
assert.ok(dirty > 0 && persisted >= 2, 'harvest invalidates the mesh and persists');
assert.equal(applyFarmJob('harvest', 1, 1, 'needlegrain', 'field1', 'toddler1'), false,
  'the same harvest cannot be credited twice');

tile.crop = 'needlegrain'; tile.cropReady = true;
assert.equal(applyFarmJob('harvest', 1, 1, 'needlegrain', 'field1', 'spouse1'), true);
assert.deepEqual(farmQuality.at(-1), { item: 'needlegrain', stars: 2, count: 1 },
  'spouse harvests use the 2★ default usefulness level');

tile.crop = 'needlegrain'; tile.cropReady = true;
inventory.needlegrain = 999;
const writesBeforeCap = farmQuality.length;
assert.equal(applyFarmJob('harvest', 1, 1, 'needlegrain', 'field1', 'toddler1'), false,
  'full inventory blocks the harvest without deleting the crop');
assert.equal(tile.crop, 'needlegrain');
assert.equal(farmQuality.length, writesBeforeCap, 'full Pack cannot create orphaned quality bucket entries');

// Crossbred varieties may only be registered lazily; NPCs must resolve them just like player harvesting.
let varietyEnsures = 0; // Tracks whether the production callback consults the crop variety registry.
harvestContext.window.CropVarieties = { ensure(key) {
  varietyEnsures++;
  if (key === 'crossbred_needlegrain') {
    harvestContext.cropData[key] = { cropKey: 'crossbredHarvest', seedKey: 'crossbredSeeds' };
    return true;
  }
  return false;
} };
tile.crop = 'crossbred_needlegrain'; tile.cropReady = true;
assert.equal(applyFarmJob('harvest', 1, 1, 'crossbred_needlegrain', 'field1', 'toddler1'), true,
  'family harvest resolves a dynamically registered crossbred variety');
assert.equal(inventory.crossbredHarvest, 1, 'crossbred goods are deposited in the Pack');
assert.equal(varietyEnsures, 1, 'variety registry is only consulted for missing crop definitions');
assert.deepEqual(farmQuality.at(-1), { item: 'crossbredHarvest', stars: 1, count: 1 },
  'crossbred goods preserve the toddler worker’s quality');

console.log('ok - actual game.js family harvest and processing quality');
