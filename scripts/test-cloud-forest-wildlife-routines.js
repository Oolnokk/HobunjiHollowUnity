'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const wildlifePath = 'docs/js/wildlife-spawn.js'; // Used to evaluate the repository's browser module in an isolated test context.
const gamePath = 'docs/game.js'; // Used to verify the large integration file retained every required hook.
const indexPath = 'docs/index.html'; // Used to verify browsers receive the updated wildlife/game scripts instead of stale cached copies.
const context = {
  console, Math, Number, String, Object, Array, Map, Set,
  performance: { now: () => 1000 },
  document: { getElementById: () => null },
  window: null,
}; // Used as the minimal browser-like global for pure wildlife schedule tests.
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(wildlifePath, 'utf8'), context, { filename: wildlifePath });

assert(context.WildlifeSpawn, 'WildlifeSpawn export missing');
context.WildlifeSpawn.init({ MORNING_HOUR: 6, NIGHT_HOUR: 22 });
const test = context.WildlifeSpawn._test; // Used to exercise schedule and fight math without building a Three.js scene.

assert.equal(test.wolfShiftAtHour(4), true, 'sunrise shift should begin two hours before sunrise');
assert.equal(test.wolfShiftAtHour(8), true, 'sunrise shift should end two hours after sunrise');
assert.equal(test.wolfShiftAtHour(9), false, 'wolves should return to dens between shifts');
assert.equal(test.wolfShiftAtHour(20), true, 'sunset shift should begin two hours before sunset');
assert.equal(test.wolfShiftAtHour(0), true, 'sunset shift should wrap correctly through midnight');
assert.equal(test.cloudForestDaytime(6), true, 'Drenkirra should forage from sunrise');
assert.equal(test.cloudForestDaytime(21.99), true, 'Drenkirra should forage until sunset');
assert.equal(test.cloudForestDaytime(22), false, 'Drenkirra should sleep from sunset');

let simulatedHour = 6; // Used to exercise the public active/off-shift and on-ground prey gates.
const damageCalls = []; // Used to verify nearby predator damage enters shared combat with the wildlife-source marker.
context.WildlifeSpawn.init({
  MORNING_HOUR: 6, NIGHT_HOUR: 22, TILE: 100,
  getHour: () => simulatedHour,
  damageCreature: (...args) => damageCalls.push(args),
  HOSTILE_BITE_KNOCKBACK_PX_S: 200,
});
const wolf = { creatureKey: 'gar-wolf', areaId: 'map_southern_cloud_forest', health: 80, def: { attackTag: 'sharp' } }; // Used as the scheduled predator fixture.
const prey = { creatureKey: 'drenkirra', areaId: wolf.areaId, health: 60, maxHealth: 60, def: { diet: 'herbivore' } }; // Used as its reachable prey fixture.
assert.equal(context.WildlifeSpawn.canAggroPlayer(wolf), true, 'wolf should find the player during a shift');
assert.equal(context.WildlifeSpawn.isCloudForestHuntTarget(wolf, prey), true, 'active wolf should hunt on-ground Drenkirra');
prey.onBranch = {};
assert.equal(context.WildlifeSpawn.isCloudForestHuntTarget(wolf, prey), false, 'gar-wolf must not hunt prey after it climbs a branch');
prey.onBranch = null;
context.WildlifeSpawn.applyWildlifeSkirmishDamage(wolf, prey, 12);
assert.equal(damageCalls[0][5].wildlifeSource, true, 'nearby wildlife damage must bypass player progression');
simulatedHour = 12;
assert.equal(context.WildlifeSpawn.canAggroPlayer(wolf), false, 'wolf should not passively aggro between shifts');
assert.equal(context.WildlifeSpawn.isCloudForestHuntTarget(wolf, prey), false, 'wolf should stop hunting between shifts');

const strong = { health: 200, maxHealth: 200, def: { attackDamage: 20, chaseSpeed: 160 } }; // Used as the statistically favored coarse fighter.
const weak = { health: 50, maxHealth: 50, def: { attackDamage: 5, chaseSpeed: 80 } }; // Used as the statistically weaker coarse fighter.
assert(test.distantFightScore(strong, 0.5) > test.distantFightScore(weak, 0.5), 'offscreen fight math should honor creature stats');

const game = fs.readFileSync(gamePath, 'utf8'); // Used for integration contracts that are impractical to execute outside the full game boot.
const wildlife = fs.readFileSync(wildlifePath, 'utf8'); // Used for cross-file combat and schedule contracts.
assert(game.includes('const den = creature?.denBounds'), 'creatures need a narrow own-den collision exemption');
assert(game.includes('creatureCanEnterTile(c, desiredX, c.y)'), 'movement must pass the creature identity into collision');
assert(game.includes('creatureTileWalkable(c, col, row)'), 'pathfinding must preserve the same own-den exemption');
assert(game.includes('updateCloudForestCreature(c, dt, targetPlayer)'), 'hostile AI loop must invoke Cloud Forest routines');
assert(game.includes("action: 'branch_fruit_take'"), 'hanging fruit must expose an immediate player action');
assert(game.includes('if (!c._coarseSimulated) updateCreatureMesh'), 'distant dots must skip full visual simulation');
assert(game.includes('const wildlifeSource = !!dmgOpts?.wildlifeSource'), 'wildlife fights must not award player combat progression');
assert(wildlife.includes('wildlifeSource: true'), 'wildlife attacks must mark their source before entering shared damage');
const index = fs.readFileSync(indexPath, 'utf8'); // Used for loader cache-bust contracts.
assert(index.includes('wildlife-spawn.js?v=20260826cloudroutines1'), 'wildlife module cache bust missing');
assert(index.includes('game.js?v=20260826cloudroutines1'), 'game integration cache bust missing');

console.log('PASS Cloud Forest wildlife schedules, own-den pathing, fruit interaction, and coarse simulation contracts.');
