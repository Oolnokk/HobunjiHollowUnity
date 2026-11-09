#!/usr/bin/env node
'use strict';

// Tribe/bandit ecology fights (docs/js/porakaneki-camps-runtime.js) put
// hunters in 'chase' against another actor. That must not count as the
// player being in combat, or combat music fades in/out around them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');
const start = game.indexOf('      function isPlayerInCombat() {');
const end = game.indexOf('      function targetStickWorldAngle(');
assert.ok(start > 0 && end > start, 'isPlayerInCombat source located');

const context = { hostileObjects: [], currentArea: 'map_western_slope' };
vm.runInNewContext(game.slice(start, end), context);

const porakaneki = { health: 10, areaId: 'map_western_slope', state: 'return' };
const omgurku = { health: 10, areaId: 'map_western_slope', state: 'chase', _chunkCombatTarget: porakaneki };
context.hostileObjects.push(porakaneki, omgurku);
assert.equal(context.isPlayerInCombat(), false, 'a hunter chasing a rival hunter is not player combat');

omgurku._chunkCombatTarget = null; // Provoked hunters drop their ecology target and chase the player.
assert.equal(context.isPlayerInCombat(), true, 'a hunter chasing the player is combat');

omgurku._chunkCombatTarget = { health: 0 };
assert.equal(context.isPlayerInCombat(), true, 'a dead ecology target no longer exempts the chaser');

const neutral = { health: 10, areaId: 'map_western_slope', state: 'chase', _porakanekiPlannerControlled: true, _chunkCombatTarget: null };
context.hostileObjects.length = 0;
context.hostileObjects.push(neutral);
assert.equal(context.isPlayerInCombat(), false, 'a neutral tribe hunter between ecology targets (still in chase for up to one 5 Hz tick) is not player combat');
neutral._porakanekiPlannerControlled = false; // Provoked: hostile to the player again.
assert.equal(context.isPlayerInCombat(), true, 'a provoked hunter chasing the player is combat');

console.log('ecology fight combat-state tests passed');
