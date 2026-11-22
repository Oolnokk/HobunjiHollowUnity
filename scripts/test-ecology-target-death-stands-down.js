#!/usr/bin/env node
'use strict';

// When a bandit/tribe actor's ecology target dies (or leaves the area), the
// actor must stop 'chase'-ing instead of being left chasing the player it never
// fought -- isPlayerInCombat counts a target-less chase/searching hostile as the
// player being in combat, which started combat music for other actors' fights.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const start = source.indexOf('  function resolvedBanditCombatTarget(');
const end = source.indexOf('  // Mirrors combat-quickattacks.js', start);
assert(start > 0 && end > start, 'resolvedBanditCombatTarget source located');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);
const player = { health: 100, x: 500, y: 500 };

const live = { health: 5, areaId: 'z' };
const fighter = { areaId: 'z', state: 'chase', _chunkCombatTarget: live };
assert.equal(ctx.resolvedBanditCombatTarget(fighter, player), live, 'a living same-area ecology target is kept');
assert.equal(fighter.state, 'chase');

live.health = 0;
assert.equal(ctx.resolvedBanditCombatTarget(fighter, player), player, 'a dead target falls back to the ordinary player target');
assert.equal(fighter._chunkCombatTarget, null);
assert.equal(fighter.state, 'return', 'the actor stands down rather than staying in a target-less chase');

const searcher = { areaId: 'z', state: 'searching', _chunkCombatTarget: { health: 5, areaId: 'other' } };
ctx.resolvedBanditCombatTarget(searcher, player);
assert.equal(searcher.state, 'return', 'a target that left the area ends the fight too');

const idle = { areaId: 'z', state: 'idle', _chunkCombatTarget: { health: 0 } };
ctx.resolvedBanditCombatTarget(idle, player);
assert.equal(idle.state, 'idle', 'other states are left alone');

const ordinary = { areaId: 'z', state: 'chase', _chunkCombatTarget: null };
assert.equal(ctx.resolvedBanditCombatTarget(ordinary, player), player);
assert.equal(ordinary.state, 'chase', 'a hostile with no ecology target keeps chasing the player normally');


// A later player-aggro assignment must not override an explicitly commissioned
// rival-tribe ecology target inside game.js's chase-target reconciliation.
const ecology = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8'); // Real tribe planner is the sole owner of ecology target handoffs.
const ecologyStart = ecology.indexOf('  function setHumanoidEcologyTarget(');
const ecologyEnd = ecology.indexOf('  function setPredatorEcologyTarget(', ecologyStart);
assert(ecologyStart > 0 && ecologyEnd > ecologyStart, 'tribe planner target assignment remains extractable');
const tribeCtx = { tribeOf: () => 'porakaneki', isSharedEnemyOf: () => false, nowMs: () => 1000 };
vm.createContext(tribeCtx);
vm.runInContext(ecology.slice(ecologyStart, ecologyEnd), tribeCtx);
const retainedPlayer = { health: 100, id: 'player' };
const rival = { health: 18, areaId: 'z', id: 'omgurku-rival' };
const tribeHunter = { areaId: 'z', state: 'chase', health: 18, def: { aggroRangePx: 500 }, targetPlayer: retainedPlayer };
tribeCtx.setHumanoidEcologyTarget(tribeHunter, rival);
assert.equal(tribeHunter._chunkCombatTarget, rival, 'tribal ecology target stays authoritative');
assert.equal(tribeHunter.targetPlayer, null, 'stale player lock cannot override an active rival fight');
assert.equal(tribeHunter._porakanekiPlannerControlled, true, 'neutral tribe still uses the existing planner control');
assert.equal(tribeHunter.def.aggroRangePx, 0, 'neutral tribe remains non-hostile to the player');
assert.equal(tribeHunter.state, 'chase', 'rival-combat chase continues without an intermediate return');
tribeCtx.setHumanoidEcologyTarget(tribeHunter, null);
assert.equal(tribeHunter.state, 'return', 'an ended rival engagement stands down through the original cleanup path');

console.log('Ecology target death stand-down regression passed.');
