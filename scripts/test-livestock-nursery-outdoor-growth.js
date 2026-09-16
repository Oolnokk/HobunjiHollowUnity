'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/livestock-nursery-outdoor-growth.js', 'utf8');
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');

let livestock = [
  { id: 'baby-a', name: 'Pebble', kind: 'grehlr', lifeStage: 'baby', barnId: null, troughIndex: null },
  { id: 'adult-a', name: 'Adult', kind: 'grehlr', lifeStage: 'adult', barnId: 'barn-1', troughIndex: 0 },
];
let saveCount = 0;
let respawnCount = 0;
let rerollCount = 0;
let baseGrowCalls = 0;
let baseGrowResult = { ok: false, message: 'No adult barn space is available (4/4). Build or upgrade a barn first.' };

const context = {
  console,
  window: null,
  FarmAnimals: {
    init() {},
    respawnWorldLivestock() { respawnCount++; },
  },
  LivestockNursery: {
    isBaby(entry) { return entry?.lifeStage === 'baby'; },
    adultCount() { return livestock.filter(entry => entry.lifeStage === 'adult').length; },
    adultCapacity() { return 1; },
    rerollSwarm() { rerollCount++; },
    growBaby() { baseGrowCalls++; return baseGrowResult; },
  },
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'livestock-nursery-outdoor-growth.js' });

const deps = {
  loadWorldLivestock() { return livestock; },
  saveWorldLivestock(next) { livestock = next; saveCount++; },
  hasFarmPermission(permission) { return permission === 'livestock'; },
  getCurrentArea() { return 'farm'; },
};
context.FarmAnimals.init(deps);

const result = context.LivestockNursery.growBaby('baby-a');
assert.equal(baseGrowCalls, 1, 'normal Nursery grow path is attempted first');
assert.equal(result.ok, true, 'full-barn failure becomes successful outdoor maturation');
assert.equal(result.outdoors, true, 'result explicitly reports the outdoors fallback');
assert.match(result.message, /living outdoors/i, 'player-facing result explains where the grown animal went');
assert.equal(livestock[0].lifeStage, 'adult', 'baby is persisted as an adult');
assert.equal(livestock[0].barnId, null, 'grown animal remains unhoused when barns are full');
assert.equal(livestock[0].troughIndex, null, 'outdoor adult has no stale trough assignment');
assert.equal(saveCount, 1, 'outdoor maturation persists livestock once');
assert.equal(respawnCount, 1, 'farm exterior is refreshed so the new adult can materialize immediately');
assert.equal(rerollCount, 1, 'Nursery interior swarm drops the matured baby');

// Ordinary open-barn success remains authoritative and must not run the fallback.
livestock[0].lifeStage = 'baby';
saveCount = 0;
respawnCount = 0;
rerollCount = 0;
baseGrowResult = { ok: true, message: 'Pebble grew up and moved into the Small Barn!' };
const ordinary = context.LivestockNursery.growBaby('baby-a');
assert.equal(ordinary.ok, true, 'ordinary Nursery success passes through');
assert.equal(ordinary.outdoors, undefined, 'ordinary success is not rewritten as an outdoor grow');
assert.equal(saveCount, 0, 'compatibility layer does not duplicate persistence for ordinary success');
assert.equal(respawnCount, 0, 'compatibility layer does not respawn the farm for ordinary success');
assert.equal(rerollCount, 0, 'compatibility layer does not duplicate Nursery reroll for ordinary success');

const outdoorIndex = bridgeSource.indexOf("globalKey: 'LivestockNurseryOutdoorGrowth'");
const animalGrowthIndex = bridgeSource.indexOf("globalKey: 'AnimalGrowth'");
assert(outdoorIndex >= 0 && animalGrowthIndex >= 0 && outdoorIndex < animalGrowthIndex,
  'outdoor maturation wraps LivestockNursery before AnimalGrowth so the existing Growth Tonic wrapper remains authoritative');
assert.match(bridgeSource, /installNurseryOutdoorGrowth\(\)[\s\S]*installAnimalGrowth\(\)/,
  'FarmPanel handoff preserves outdoor-grow-inside / Growth-Tonic-outside wrapper order');

console.log('livestock nursery outdoor growth regression checks passed');
