#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-tutorial-partner.js', 'utf8'), { window });
const partner = window.CombatTutorialPartner;
partner.init({ TILE: 32 });

const target = {
  maxHealth: 10000,
  health: 10000,
  maxStamina: 100,
  stamina: 100,
  maxFooting: 100,
  footing: 100,
  combatTutorialHostile: true,
  telegraphState: null,
  _banditAction: { phase: 'windup' },
};
const lesson = { id: 'jab', check: 'quickBonus', ability: 'opportunistJab', hostile: true };

partner.maintain(target, lesson);
assert.equal(target.telegraphState, 'windup', 'tutorial partner mirrors staged bandit windup for Opportunist readiness');
assert.equal(target.combatTutorialAttackWindow, 'windup');

target._banditAction.phase = 'strike';
partner.maintain(target, lesson);
assert.equal(target.telegraphState, 'strike', 'tutorial partner mirrors staged bandit strike');

target._banditAction.phase = 'recover';
partner.maintain(target, lesson);
assert.equal(target.telegraphState, null, 'recovery no longer qualifies for Opportunist');
assert.equal(target.combatTutorialAttackWindow, 'recover');

target.combatTutorialHostile = false;
target.telegraphState = 'windup';
partner.maintain(target, lesson);
assert.equal(target.telegraphState, 'windup', 'paused tutorial logic does not invent a hostile phase; pause() owns hard cancellation');

console.log('combat tutorial opportunist window tests passed');
