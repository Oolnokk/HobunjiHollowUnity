#!/usr/bin/env node
'use strict';

// Executes js/town-mine-descent.js (extracted from game.js): rock, enemy and
// Shattercask-rubble rolls share one per-floor countdown, and running out of
// rocks/enemies always opens the hole on a walkable tile.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Obj3D {
  constructor() { this.children = []; this.position = { set: (x, y, z) => Object.assign(this.position, { x, y, z }) }; this.rotation = {}; }
  add(child) { this.children.push(child); }
}
const THREE = {
  Group: Obj3D,
  Mesh: class extends Obj3D {},
  CircleGeometry: class {}, TorusGeometry: class {},
  MeshBasicMaterial: class {}, MeshLambertMaterial: class {},
};

let random = 0.99; // Never wins a chance roll unless a test lowers it.
const context = {
  Math: Object.assign(Object.create(Math), { random: () => random }),
  window: {
    THREE,
    TownMine: {
      floorFromMapId: id => Number(id.slice(-3)),
      mapIdForFloor: floor => 'map_i_town_mine_f_' + String(floor).padStart(3, '0'),
      descentChance: source => ({ rock: 0.08, enemy: 0.16, rubble: 0.35 })[source],
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/town-mine-descent.js', 'utf8'), context);
const descent = context.window.TownMineDescent;

const TileType = { ROCK: 'rock', GRASS: 'grass' };
const mapId = 'map_i_town_mine_f_004';
const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({ type: TileType.GRASS })));
grid[2][2].type = TileType.ROCK; // The rock being broken; the hole must land beside it.
const scene = new Obj3D();
const buildingScenes = new Map([[mapId, { scene, grid, transitions: [] }]]);
const holeMeshes = new Map();
const runStates = new Map([[mapId, { floor: 4, canDescend: true, descentRevealed: false, remainingRocks: 2, remainingEnemies: 1 }]]);
descent.init({ buildingScenes, holeMeshes, runStates, TileType });

assert.strictEqual(descent.tryReveal(mapId, 2, 2, 'rock'), false, 'A failed rock roll opens nothing');
assert.strictEqual(descent.tryReveal(mapId, 2, 2, 'rubble'), false, 'A failed rubble roll opens nothing');
assert.strictEqual(runStates.get(mapId).remainingRocks, 0, 'Collected rubble counts down the floor rocks like a broken rock');

random = 0.3; // Below the rubble chance, above the rock chance.
runStates.get(mapId).remainingRocks = 5;
assert.strictEqual(descent.tryReveal(mapId, 2, 2, 'rock'), false, 'A 30% roll does not beat the 8% rock chance');
assert.strictEqual(descent.tryReveal(mapId, 2, 2, 'rubble'), true, 'The same roll beats the much higher rubble chance');
const info = buildingScenes.get(mapId);
assert.strictEqual(info.transitions.length, 1, 'Exactly one descent transition is added');
assert.strictEqual(info.transitions[0].targetMapId, 'map_i_town_mine_f_005', 'The hole leads one floor deeper');
assert.notStrictEqual(grid[info.transitions[0].row][info.transitions[0].col].type, TileType.ROCK, 'The hole opens on a walkable tile');
assert.strictEqual(scene.children.length, 1, 'The hole mesh is added to the floor scene');
assert.strictEqual(descent.tryReveal(mapId, 2, 2, 'rubble'), false, 'A floor reveals its hole only once');

// Guaranteed fallback once nothing is left to break or kill.
random = 0.99;
const lastMap = 'map_i_town_mine_f_007';
buildingScenes.set(lastMap, { scene: new Obj3D(), grid, transitions: [] });
runStates.set(lastMap, { floor: 7, canDescend: true, descentRevealed: false, remainingRocks: 1, remainingEnemies: 0 });
assert.strictEqual(descent.tryReveal(lastMap, 2, 2, 'rubble'), true, 'Collecting the last rubble always opens the descent');

// The chance is based on *previous* breaks: the first rock keeps its base
// odds, and ten failed rocks add exactly 20 percentage points to the eleventh.
const pityMap = 'map_i_town_mine_f_008';
buildingScenes.set(pityMap, { scene: new Obj3D(), grid, transitions: [] });
runStates.set(pityMap, { floor: 8, canDescend: true, descentRevealed: false, remainingRocks: 25, remainingEnemies: 2 });
random = 0.99;
for (let index = 0; index < 10; index++) {
  assert.strictEqual(descent.tryReveal(pityMap, 2, 2, 'rock'), false, 'High rolls do not reveal a hole during the first ten breaks');
}
const pityStatus = descent.debugStatus(pityMap);
assert.strictEqual(pityStatus.rocksBrokenOnFloor, 10, 'Ten rock breaks are tracked for this floor');
assert.ok(Math.abs(pityStatus.nextRockChance - 0.28) < 1e-10, 'Eleventh rock has base 8% plus 20 percentage points');
assert.ok(Math.abs(pityStatus.nextRubbleChance - 0.55) < 1e-10, 'Shattercask rubble also benefits from previous rocks');
random = 0.279;
assert.strictEqual(descent.tryReveal(pityMap, 2, 2, 'rock'), true, 'The eleventh rock opens a hole at a roll above the old base chance');
assert.strictEqual(descent.debugStatus(pityMap).rocksBrokenOnFloor, 11, 'A successful break counts exactly once');
assert.strictEqual(descent.tryReveal(pityMap, 2, 2, 'rock'), false, 'No subsequent breaks count after the floor has revealed its hole');

// Entering a different floor creates a distinct run state and starts at base odds.
const nextMap = 'map_i_town_mine_f_009';
buildingScenes.set(nextMap, { scene: new Obj3D(), grid, transitions: [] });
runStates.set(nextMap, { floor: 9, canDescend: true, descentRevealed: false, remainingRocks: 15, remainingEnemies: 2 });
assert.strictEqual(descent.debugStatus(nextMap).rocksBrokenOnFloor, 0, 'The next floor has no accumulated breaks');
assert.ok(Math.abs(descent.debugStatus(nextMap).nextRockChance - 0.08) < 1e-10, 'The next floor starts at the base rock chance');
random = 0.1;
assert.strictEqual(descent.tryReveal(nextMap, 2, 2, 'rock'), false, 'A 10% roll fails on a fresh floor');
assert.ok(Math.abs(descent.debugStatus(nextMap).nextRockChance - 0.10) < 1e-10, 'The first break adds 2 percentage points to the next roll');

// Rubble is equivalent to one rock break for the cumulative chance, but
// enemy rolls keep their own separate base odds.
random = 0.99;
assert.strictEqual(descent.tryReveal(nextMap, 2, 2, 'rubble'), false, 'A failed rubble roll adds one mined-rock break');
assert.strictEqual(descent.debugStatus(nextMap).rocksBrokenOnFloor, 2, 'Rubble increments the same per-floor counter');
assert.ok(Math.abs(descent.debugStatus(nextMap).nextRockChance - 0.12) < 1e-10, 'Pickaxe odds also increase after rubble');
random = 0.17; // Above the independent enemy base chance (16%).
assert.strictEqual(descent.tryReveal(nextMap, 2, 2, 'enemy'), false, 'Rock break bonus never inflates enemy kill odds');
assert.strictEqual(descent.debugStatus(nextMap).rocksBrokenOnFloor, 2, 'Enemy kills do not increment the rock count');

// The additive chance saturates at 100%, never exceeds it.
const capMap = 'map_i_town_mine_f_010';
buildingScenes.set(capMap, { scene: new Obj3D(), grid, transitions: [] });
runStates.set(capMap, { floor: 10, canDescend: true, descentRevealed: false, remainingRocks: 2, remainingEnemies: 1, rocksBrokenOnFloor: 100 });
assert.strictEqual(descent.debugStatus(capMap).nextRockChance, 1, 'Accumulated chance is capped at 100%');

console.log('Town mine descent reveal checks passed.');
