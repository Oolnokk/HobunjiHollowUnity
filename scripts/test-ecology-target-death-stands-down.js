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

console.log('Ecology target death stand-down regression passed.');
