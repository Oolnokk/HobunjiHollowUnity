#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  performance: { now: () => 1000 },
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  dispatchEvent() {},
};
context.window = context;
context.globalThis = context;
context.Combat = {
  abilities: { register() {} },
  animalAttacks: { isStriking: () => false },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/combat/resource-system.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/combat/combat-quickattacks.js', 'utf8'), context);

const { ResourceSystem, Combat } = context;

function makeTarget() {
  const target = {
    id: 'threshold-target',
    x: 32, y: 0, facing: 0,
    health: 20, maxHealth: 100,
    stamina: 10, maxStamina: 100,
    footing: 100, maxFooting: 100,
    exhaustion: { active: false, blackStamina: 100 },
    afflictions: {},
  };
  ResourceSystem.initEntity(target);
  return target;
}

const deps = { player: { x: 0, y: 0 } };
const plainLow = makeTarget();
let conditions = Combat.getQuickAttackConditions(deps, plainLow);
assert.equal(conditions.exhausted, true, 'genuinely low ordinary Stamina still enables Exhaust Cutter');
assert.equal(conditions.lowHealth, true, 'genuinely low ordinary Health still enables Mercy Spike');

const ordinarilyAfflicted = makeTarget();
ResourceSystem.addAffliction(ordinarilyAfflicted, 'woundedStamina', 40);
ResourceSystem.addAffliction(ordinarilyAfflicted, 'bleedingHealth', 35);
assert.equal(ResourceSystem.getDepletionEquivalentCurrent(ordinarilyAfflicted, 'stamina'), 50, 'ordinary Stamina-affliction band is added back for depletion checks');
assert.equal(ResourceSystem.getDepletionEquivalentCurrent(ordinarilyAfflicted, 'health'), 40, 'ordinary Health-affliction band is added back only across the Health-ring points it actually occupies');
conditions = Combat.getQuickAttackConditions(deps, ordinarilyAfflicted);
assert.equal(conditions.exhausted, false, 'afflicted Stamina alone does not enable Exhaust Cutter');
assert.equal(conditions.lowHealth, false, 'afflicted Health alone does not enable Mercy Spike');
assert.equal(Combat.quickAttackData.lastConditionCheck.staminaForCondition, 50, 'Quick Attack diagnostics expose adjusted Stamina');
assert.equal(Combat.quickAttackData.lastConditionCheck.healthForCondition, 40, 'Quick Attack diagnostics expose adjusted Health');

ResourceSystem.addAffliction(ordinarilyAfflicted, 'windedStamina', 85);
ResourceSystem.addAffliction(ordinarilyAfflicted, 'congealedHealth', 85);
ResourceSystem.enforceCaps(ordinarilyAfflicted);
assert.equal(ResourceSystem.getEffectiveMax(ordinarilyAfflicted, 'stamina'), 15, 'Winded Stamina lowers effective maximum Stamina');
assert.equal(ResourceSystem.getEffectiveMax(ordinarilyAfflicted, 'health'), 15, 'Congealed Health lowers effective maximum Health');
assert.equal(ResourceSystem.getDepletionEquivalentCurrent(ordinarilyAfflicted, 'stamina'), 15, 'ordinary affliction add-back cannot exceed a max-reduced Stamina pool');
assert.equal(ResourceSystem.getDepletionEquivalentCurrent(ordinarilyAfflicted, 'health'), 15, 'ordinary affliction add-back cannot exceed a max-reduced Health pool');
conditions = Combat.getQuickAttackConditions(deps, ordinarilyAfflicted);
assert.equal(conditions.exhausted, true, 'explicit effective-max Stamina reduction can enable Exhaust Cutter');
assert.equal(conditions.lowHealth, true, 'explicit effective-max Health reduction can enable Mercy Spike');

const blackStamina = makeTarget();
blackStamina.stamina = 100;
blackStamina.exhaustion.active = true;
conditions = Combat.getQuickAttackConditions(deps, blackStamina);
assert.equal(conditions.exhausted, true, 'true Exhausted state always enables Exhaust Cutter');

console.log('quick attack resource-threshold checks passed');
