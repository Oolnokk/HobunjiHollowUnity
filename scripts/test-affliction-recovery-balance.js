#!/usr/bin/env node
'use strict';

// Regression: resource HUD silhouettes are tied to fourfold slower brittles
// and 25%-longer-lived starves. DoT conversion speeds must remain unchanged.
// Run: node scripts/test-affliction-recovery-balance.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = {
  console, performance: { now: () => 0 },
  CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
  dispatchEvent: () => {},
  GameRandom: { random: () => 1 },
};
ctx.window = ctx;
vm.createContext(ctx);
for (const filename of [
  'docs/js/combat/resource-system.js',
  'docs/js/combat/combat-corroded-health.js',
]) vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });

const rs = ctx.ResourceSystem;
assert(rs, 'real ResourceSystem is installed');
const approx = (actual, expected, tolerance = .13) =>
  assert(Math.abs(actual - expected) <= tolerance,
    'expected ' + expected + '±' + tolerance + ', got ' + actual);
function actor() {
  const entity = {
    health: 100, maxHealth: 100, stamina: 100, maxStamina: 100,
    footing: 100, maxFooting: 100, afflictions: {},
    lastAttackAttemptAt: 0, lastAttackReceivedAt: 0,
  };
  rs.initEntity(entity);
  return entity;
}
function recoverOver(id, seconds, framesPerSecond = 60) {
  const entity = actor();
  rs.addAffliction(entity, id, 40);
  const initial = rs.getAffliction(entity, id);
  for (let i = 0; i < seconds * framesPerSecond; i++) rs.tick(entity, 1 / framesPerSecond);
  return { recovered: initial - rs.getAffliction(entity, id), entity };
}

for (const id of [
  'bruisedHealth', 'corrodedHealth', 'woundedStamina', 'infectedStamina',
  'frostbittenStamina', 'shatteredStamina', 'scentMarkedHealth', 'drunkenHealth',
]) assert.equal(rs.getAfflictionNaturalRecoveryScale(id), .25, id + ' recovers at quarter speed');
for (const id of [
  'congealedHealth', 'woundedHealth', 'windedStamina', 'drunkenFooting', 'shamblingFooting',
]) assert.equal(rs.getAfflictionNaturalRecoveryScale(id), .8, id + ' has 25% longer recovery time');
for (const id of ['bleedingHealth', 'burningHealth', 'kindlingHealth', 'poisonedHealth'])
  assert.equal(rs.getAfflictionNaturalRecoveryScale(id), 1, id + ' DoT conversion is unchanged');

approx(recoverOver('bruisedHealth', 1).recovered, .9);
approx(recoverOver('congealedHealth', 1).recovered, 2.88);
approx(recoverOver('windedStamina', 1).recovered, 3.6);

// Amphibious Fish installs Wounded Health after ResourceSystem initialized.
// It must still be in the cached generic-recovery loop.
rs.AFFLICTIONS.woundedHealth = {
  name: 'Wounded Health', resource: 'health', extend: 'zero',
  priority: 58, recovers: true, reducesEffectiveMax: true,
};
approx(recoverOver('woundedHealth', 1).recovered, 2.88);
delete rs.AFFLICTIONS.woundedHealth;

// Stamina-spend vulnerability keeps its action-avoidance multiplier, but
// the final recovered amount is reduced to a quarter, as intended.
const e = actor();
approx(rs.getAfflictionRecoveryMultiplier(e, 'woundedStamina', false), 1.25);
approx(recoverOver('woundedStamina', 1).recovered, 4.5);

// Slowly recovering Corroded Health requires fractional carry-forward.
// Previously its tiny frame update rounded to zero forever.
approx(recoverOver('corrodedHealth', 25).recovered, .1, .051);

const dotActor = actor();
rs.addAffliction(dotActor, 'bleedingHealth', 30);
rs.tick(dotActor, 1);
approx(30 - rs.getAffliction(dotActor, 'bleedingHealth'), rs.config().bleedTickPerSec, .11);

// Non-standard alcohol/blackout extensions share the same rate mechanism.
const core = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8');
const bridge = fs.readFileSync('docs/js/alcohol-gameplay-bridge.js', 'utf8');
assert(core.includes('recoverAfflictionNaturally(entity, DRUNK_FOOTING_ID'), 'Drunken Footing uses fractional recovery');
assert(core.includes('recoverAfflictionNaturally(entity, DRUNK_HEALTH_ID'), 'Drunken Health uses fractional recovery');
assert(bridge.includes('recoverAfflictionNaturally(entity, DRUNK_FOOTING_ID'), 'blackout uses Footing recovery factor');
assert(bridge.includes('recoverAfflictionNaturally(entity, DRUNK_HEALTH_ID'), 'blackout uses Health recovery factor');
const aquatic = fs.readFileSync('docs/js/amphibious-fishing.js', 'utf8');
assert(aquatic.includes("getAfflictionNaturalRecoveryScale('scentMarkedHealth')"), 'scent fade is scaled once');
console.log('affliction recovery balance tests passed');
