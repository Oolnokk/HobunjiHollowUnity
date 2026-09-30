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

// A zero-based Stamina band applied while the pool was already low extends
// the visible bar past current; a currentBack Health band always sits inside
// current and so adds nothing.
const ordinarilyAfflicted = makeTarget();
ResourceSystem.addAffliction(ordinarilyAfflicted, 'woundedStamina', 40);
ResourceSystem.addAffliction(ordinarilyAfflicted, 'bleedingHealth', 35);
assert.equal(ResourceSystem.getDepletionEquivalentCurrent(ordinarilyAfflicted, 'stamina'), 40, 'a Stamina band extending past current counts as the visible bar end');
assert.equal(ResourceSystem.getDepletionEquivalentCurrent(ordinarilyAfflicted, 'health'), 20, 'a currentBack Health band inside current is not added on top of current');
conditions = Combat.getQuickAttackConditions(deps, ordinarilyAfflicted);
assert.equal(conditions.exhausted, false, 'a visibly 40%-full afflicted Stamina bar does not enable Exhaust Cutter');
assert.equal(conditions.lowHealth, true, 'a 20% Health bar is low whether or not part of it is afflicted');
assert.equal(Combat.quickAttackData.lastConditionCheck.staminaForCondition, 40, 'Quick Attack diagnostics expose adjusted Stamina');
assert.equal(Combat.quickAttackData.lastConditionCheck.healthForCondition, 20, 'Quick Attack diagnostics expose adjusted Health');

// Regression: a band that lives inside current must never be double-counted.
const bandInsideCurrent = makeTarget();
bandInsideCurrent.stamina = 60;
ResourceSystem.addAffliction(bandInsideCurrent, 'woundedStamina', 15);
ResourceSystem.spendStamina(bandInsideCurrent, 42, 'test');
assert.equal(bandInsideCurrent.stamina, 18, 'spend above the band leaves 18 Stamina');
assert.equal(ResourceSystem.getAffliction(bandInsideCurrent, 'woundedStamina'), 15, 'spend above the band leaves it intact');
assert.equal(ResourceSystem.getDepletionEquivalentCurrent(bandInsideCurrent, 'stamina'), 18, 'band inside current adds nothing');
assert.equal(Combat.getQuickAttackConditions(deps, bandInsideCurrent).exhausted, true, 'an 18% Stamina target with an inner band still enables Exhaust Cutter');

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

// Opportunist's wider window is shared by damage and readiness indicators.
const opportunistTarget = makeTarget(); // Probe each real generic telegraph phase at impact time.
for (const [stage, expected] of [['windup', true], ['strike', true], ['recover', false], [null, false]]) {
  opportunistTarget.telegraphState = stage;
  assert.equal(Combat.getQuickAttackConditions(deps, opportunistTarget).enemyStriking, expected, `Opportunist window: ${stage}`);
}
vm.runInContext(fs.readFileSync('docs/js/combat/combat-animal-attacks.js', 'utf8'), context);
const namedAttack = { isWindingUp: state => state.stage === 'windup', isStriking: state => state.stage === 'leap' }; // A modular animal attack participates through its public phase hooks.
for (const [stage, expected] of [['windup', true], ['leap', true], ['recover', false]]) {
  opportunistTarget._animalAttack = { def: namedAttack, state: { stage } };
  assert.equal(Combat.getQuickAttackConditions(deps, opportunistTarget).enemyStriking, expected, `Named animal attack: ${stage}`);
}
Combat.animalAttacks.cancel(opportunistTarget);
assert.equal(Combat.getQuickAttackConditions(deps, opportunistTarget).enemyStriking, false, 'cancelled attacks do not grant the bonus');
