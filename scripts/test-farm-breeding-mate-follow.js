#!/usr/bin/env node
'use strict';

// Exercises production livestock following against the real tile pathfinder.
// The test-only export injects private movement hooks in memory; no debug-only
// movement entry point ships to players.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Loads the current checkout rather than a copied test implementation.
const movementModule = fs.readFileSync(path.join(root, 'docs/js/farm-animals.js'), 'utf8'); // Real world-livestock follow/tile-hop implementation.
const hookAnchor = '    updateAnimalMeshes,\n'; // Injects a private tick export only into this test's isolated evaluation.
assert(movementModule.includes(hookAnchor), 'farm-animal export hook moved; update the test integration point');
const instrumentedModule = movementModule.replace(hookAnchor, hookAnchor + '    __testWanderTick: _farmAnimalWanderTick,\n    __testActiveBreedingParent: isActiveWorldBreedingParent,\n');
const pathfinderModule = fs.readFileSync(path.join(root, 'docs/js/tile-pathfinding.js'), 'utf8'); // Real A* (including diagonal-corner restrictions).

let clock = 1000; // Advances the same performance.now() clock as the production mate cache and path retry throttles.
const windowStub = {
  SCRATCHBONES_CONFIG: { game: { livestock: {} } },
  CreatureTextureCache: { create: () => ({}), genotypeFrameSetKey: () => null },
};
const context = vm.createContext({ window: windowStub, performance: { now: () => clock } }); // Browser-like sandbox; production globals stay private.
vm.runInContext(pathfinderModule, context, { filename: 'tile-pathfinding.js' });
vm.runInContext(instrumentedModule, context, { filename: 'farm-animals.js' });
const animals = windowStub.FarmAnimals; // Existing exported module, with the one test-only movement hook.

function fixture(leaderAt, followerAt, barns = []) {
  const COLS = 16, ROWS = 13; // Bounded walkable farm grid for all movement scenarios.
  const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ type: 'grass' })));
  const makeAnimal = (id, col, row) => ({
    livestockId: id, col, row, wx: col + 0.5, wz: row + 0.5, targetCol: col, targetRow: row,
    homeCol: col, homeRow: row, wanderPhase: 'pick', wanderTargetCol: null, wanderTargetRow: null,
    wanderWaitT: 0, _facingPlayer: false, avatarRef: { group: { visible: true } },
  }); // A minimal live animal with the actual logical/rendered tile fields.
  const leader = makeAnimal('a', ...leaderAt); // Parent A always leads while both parents are world livestock.
  const follower = makeAnimal('b', ...followerAt); // Parent B is driven by production wandering override.
  const worldObjects = new Map([[leader.col + ',' + leader.row, leader], [follower.col + ',' + follower.row, follower]]); // Occupancy must be updated by real tile hops.
  const obstacles = new Set(); // Additional hard-blocked tiles for diagonal and impassable barrier cases.
  const breedingPairs = [{ id: 'pair', parentA: { source: 'world', id: 'a' }, parentB: { source: 'world', id: 'b' } }]; // Saved-style parent references.
  let stepEffects = 0; // Counts existing onStep callbacks, e.g. uumkao'ii dew-pile opportunities.
  const deps = {
    COLS, ROWS, animalObjects: new Set([leader, follower]), worldObjects,
    getGrid: () => grid, getWorldObjectAt: (col, row) => worldObjects.get(col + ',' + row),
    getFarmBuildings: () => barns, _loadWorldBreedingPairs: () => breedingPairs,
    rnd: () => 0.65, isSolid: type => type === 'wall', TileType: { TRENCH: 'trench', RIVER: 'river', STREAM: 'stream' },
  }; // Existing collision, A*, save and movement seams required by the production routines.
  animals.init(deps);
  animals.invalidateBreedingFollowCache();
  const step = (deltaMs = 1300) => {
    clock += deltaMs;
    animals.__testWanderTick(follower, deltaMs / 1000, () => stepEffects++);
    follower.wx = follower.col + 0.5;
    follower.wz = follower.row + 0.5; // Simulates the real per-frame movement finishing before the next AI hop.
    return [follower.col, follower.row];
  }; // Advances one AI decision and completes its rendered tile interpolation.
  return { leader, follower, grid, barns, breedingPairs, obstacles, worldObjects, step, getStepEffects: () => stepEffects };
}

const open = fixture([7, 4], [1, 4]);
for (let i = 0; i < 10; i++) open.step();
assert.equal(open.follower._breedingMateId, 'a', 'the world-world pair establishes its leader');
assert(Math.hypot(open.follower.wx - open.leader.wx, open.follower.wz - open.leader.wz) <= 1.75, 'following closes the distance but leaves personal space');
assert(open.getStepEffects() > 0, 'follow hops retain the old per-hop side effects');

open.leader._harvestFrozen = true;
const beforeFrozen = [open.follower.col, open.follower.row];
open.step();
assert.deepEqual([open.follower.col, open.follower.row], beforeFrozen, 'follower stays near partner during a harvest');
assert.equal(open.follower._breedingMateId, 'a', 'harvesting does not dissolve the pairing');
assert.equal(open.follower.wanderTargetCol, null, 'temporary partner interaction does not schedule an independent station');
open.leader._harvestFrozen = false;
open.leader._barnHome = true;
open.step();
assert.equal(open.follower._breedingMateId, 'a', 'barn-hidden partner keeps the mate paired rather than starting a new wander');
open.leader._barnHome = false;

open.breedingPairs.length = 0;
open.follower._wanderPath = [{ col: 15, row: 12 }];
animals.invalidateBreedingFollowCache();
open.step();
assert.equal(open.follower._breedingMateId, null, 'following ends as soon as the active breeding pair is removed');
assert.equal(open.follower._wanderPath, null, 'old station detours cannot survive the follow-to-wander handoff');

const aroundBarn = fixture([9, 5], [2, 5], [{ col: 6, row: 3, w: 1, h: 4 }]);
const route = [];
for (let i = 0; i < 30; i++) route.push(aroundBarn.step());
assert(route.some(([col, row]) => row <= 1 || row >= 8), 'the follower detours around the occupied barn and its personal-space ring');
assert(Math.hypot(aroundBarn.follower.wx - aroundBarn.leader.wx, aroundBarn.follower.wz - aroundBarn.leader.wz) <= 1.75, 'after the detour the partners reunite');
assert(route.every(([col, row]) => !(col >= 5 && col <= 7 && row >= 2 && row <= 7)), 'no hop ever enters a barn or its collision ring');

const corner = fixture([5, 5], [2, 2]);
corner.grid[2][3].type = 'wall';
corner.grid[3][2].type = 'wall';
corner.step();
assert.notDeepEqual([corner.follower.col, corner.follower.row], [3, 3], 'follower may not cut diagonally between two blocked side tiles');
assert(Math.abs(corner.follower.col - 2) + Math.abs(corner.follower.row - 2) <= 1, 'a valid A* detour may first step backward, but must not leap through the blocked corner');

const mixed = fixture([7, 4], [1, 4]);
mixed.breedingPairs[0].parentA = { source: 'stable', id: 'a', characterId: 'owner' };
animals.invalidateBreedingFollowCache();
assert.equal(animals.breedingFollowDebug().followers.length, 0, 'a personal-Stable pairing never enrolls a farm follower');
assert.equal(animals.__testActiveBreedingParent('b'), true, 'a world parent paired with a Stable parent remains a valid direct Fertility target');
assert.equal(animals.__testActiveBreedingParent('a'), false, 'a personal-Stable parent never acquires a world-animal prompt');

console.log('farm breeding mate following: real pathfinding, separation, harvest/barn pause, path handoff, corners and Stable exclusion passed');
