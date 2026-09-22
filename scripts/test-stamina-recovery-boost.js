#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies the global 25% Stamina-recovery increase without altering non-Stamina recovery.
const fs = require('node:fs'); // Reads the production ResourceSystem so the test exercises the shipped implementation.
const vm = require('node:vm'); // Executes the browser module in a small deterministic fixture.

const resourceSource = fs.readFileSync('docs/js/combat/resource-system.js', 'utf8'); // Production Stamina/exhaustion/affliction recovery authority under test.
let nowMs = 10000; // Used by ResourceSystem's quiet/rested timing checks.
class TestCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

const windowStub = {
  SCRATCHBONES_CONFIG: {
    game: {
      combat: {
        resourceSystem: {
          quietSeconds: 3,
          staminaRegenPerSec: 14,
          healthRegenPerSec: 1.2,
          afflictionRecoveryPerSec: 3.6,
          bleedTickPerSec: 5,
          burnTickPerSec: 18,
          poisonTickPerSec: 1.8,
          exhaustionRegenPerSec: 24,
          pukeChancePerSec: 0,
          footingMax: 100,
          footingRegenPerSec: 6,
        },
      },
    },
  },
  dispatchEvent() {},
}; // Minimal browser window used by the production module.

const context = {
  console,
  Math,
  Date,
  Number,
  Object,
  Set,
  Map,
  performance: { now: () => nowMs },
  CustomEvent: TestCustomEvent,
  window: windowStub,
}; // VM globals required by ResourceSystem.

vm.runInNewContext(resourceSource, context, { filename: 'resource-system.js' });
const ResourceSystem = windowStub.ResourceSystem; // Production API used for every numeric assertion below.
assert(ResourceSystem, 'ResourceSystem registers its browser API');

function makeEntity(overrides = {}) {
  const entity = {
    health: 100,
    maxHealth: 100,
    stamina: 0,
    maxStamina: 100,
    footing: 100,
    maxFooting: 100,
    lastAttackAttemptAt: nowMs,
    lastAttackReceivedAt: nowMs,
    ...overrides,
  }; // Neutral entity fixture; attack timestamps default to non-rested recovery.
  ResourceSystem.initEntity(entity);
  return entity;
}

// Ordinary non-rested recovery: 14/s becomes 17.5/s.
{
  const entity = makeEntity();
  ResourceSystem.tick(entity, 1, { healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(entity.stamina, 17.5, 'ordinary Stamina recovery is 25% faster');
}

// Quiet/rested recovery keeps the existing x2 bonus on top of the new x1.25 baseline.
{
  const entity = makeEntity({ lastAttackAttemptAt: nowMs - 4000, lastAttackReceivedAt: nowMs - 4000 });
  ResourceSystem.tick(entity, 1, { healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(entity.stamina, 35, 'rested Stamina recovery remains x2 after the global 25% increase');
}

// Existing player recovery buffs still multiply the faster baseline rather than replacing it.
{
  const entity = makeEntity();
  windowStub.Combat = { deps: { player: entity } };
  windowStub.AlchemySystem = { getStaminaRegenMultiplier: () => 1.2 };
  ResourceSystem.tick(entity, 1, { healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(entity.stamina, 21, 'player Stamina-regen buffs compose with the global x1.25 recovery rate');
  delete windowStub.Combat;
  delete windowStub.AlchemySystem;
}

// A held-action regeneration blocker pauses ordinary Stamina without suppressing unrelated resource ticks.
{
  const entity = makeEntity({ stamina: 10, health: 90 });
  ResourceSystem.setStaminaRegenBlocked(entity, 'blink-dodge-hold', true);
  ResourceSystem.tick(entity, 1, { healthRegenPerSec: 1, footingRegenPerSec: 0 });
  assert.equal(entity.stamina, 10, 'ordinary Stamina regeneration pauses while a hold blocker is active');
  assert.equal(entity.health, 91, 'Stamina regeneration blocking does not pause Health regeneration');
  assert.deepEqual(ResourceSystem.getStaminaRegenBlockers(entity), ['blink-dodge-hold'], 'debug API reports the active blocker source');
}

// Blockers compose by source: clearing one held action cannot re-enable regen while another still owns a lock.
{
  const entity = makeEntity({ stamina: 10 });
  ResourceSystem.setStaminaRegenBlocked(entity, 'blink-dodge-hold', true);
  ResourceSystem.setStaminaRegenBlocked(entity, 'counter-shield-hold', true);
  ResourceSystem.setStaminaRegenBlocked(entity, 'blink-dodge-hold', false);
  ResourceSystem.tick(entity, 1, { healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(entity.stamina, 10, 'remaining hold blocker keeps ordinary Stamina regeneration paused');
  ResourceSystem.setStaminaRegenBlocked(entity, 'counter-shield-hold', false);
  ResourceSystem.tick(entity, 1, { healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(entity.stamina, 27.5, 'ordinary Stamina regeneration resumes after the final blocker clears');
}

// Exhausted/black-Stamina recovery: 24/s becomes 30/s.
{
  const entity = makeEntity();
  entity.exhaustion.active = true;
  entity.exhaustion.blackStamina = 0;
  ResourceSystem.tick(entity, 1, { staminaRegenPerSec: 0, healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(entity.exhaustion.blackStamina, 30, 'Exhausted black-Stamina debt recovers 25% faster');
  assert.equal(entity.stamina, 0, 'ordinary Stamina stays locked while Exhausted');
}

// Held-action blockers also pause Exhausted black-Stamina regeneration until the hold releases.
{
  const entity = makeEntity();
  entity.exhaustion.active = true;
  entity.exhaustion.blackStamina = 25;
  ResourceSystem.setStaminaRegenBlocked(entity, 'counter-shield-hold', true);
  ResourceSystem.tick(entity, 1, { staminaRegenPerSec: 0, healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(entity.exhaustion.blackStamina, 25, 'black-Stamina regeneration pauses while a hold blocker is active');
  ResourceSystem.setStaminaRegenBlocked(entity, 'counter-shield-hold', false);
  ResourceSystem.tick(entity, 1, { staminaRegenPerSec: 0, healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(entity.exhaustion.blackStamina, 55, 'black-Stamina regeneration resumes after the hold blocker clears');
}

// Recovering Stamina afflictions gain x1.25, while recovering Health afflictions keep their old rate.
{
  const entity = makeEntity({ stamina: 50 });
  ResourceSystem.addAffliction(entity, 'windedStamina', 10);
  ResourceSystem.addAffliction(entity, 'bruisedHealth', 10);
  ResourceSystem.tick(entity, 1, { staminaRegenPerSec: 0, healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(ResourceSystem.getAffliction(entity, 'windedStamina'), 5.5, 'Stamina-affliction recovery rises from 3.6/s to 4.5/s');
  assert.equal(ResourceSystem.getAffliction(entity, 'bruisedHealth'), 6.4, 'Health-affliction recovery remains at 3.6/s');
}

console.log('Stamina recovery x1.25 regression passed');
