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

console.log('Town mine descent reveal checks passed.');
