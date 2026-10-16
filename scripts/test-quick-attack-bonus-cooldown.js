'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let testNowMs = 1000;
const registered = {};
const context = {
  console,
  performance: { now: () => testNowMs },
};
context.window = context;
context.globalThis = context;
context.Combat = {
  abilities: {
    register(id, definition) { registered[id] = definition; },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/combat/combat-quickattacks.js', 'utf8'), context, {
  filename: 'docs/js/combat/combat-quickattacks.js',
});

const Q = context.Combat.quickAttackData;
const def = Q.TECHNIQUES.exhaustCutter;
const matching = { enemyStriking: false, exhausted: true, behind: false, lowHealth: false };

assert.equal(Q.BONUS_EFFECT_COOLDOWN_S, 5, 'Quick Attack bonus-effect cooldown defaults to five seconds');
assert.equal(Q.BONUS_EFFECT_POWER_MULTIPLIER, 2, 'mastery bonus payloads default to double power');

const readyTechnique = context.Combat.buildQuickAttack(def, matching, true);
assert.equal(readyTechnique.conditionMatched, true);
assert.equal(readyTechnique.bonusActive, true);
assert.equal(readyTechnique.damageMul, 3.9, 'Exhaust Cutter uses its stronger authored bonus while ready');
assert.equal(readyTechnique.knockbackMul, 2.5);

const wolf = { id: 'wolf' }; // The cooldown clock lives on the enemy that received the bonus.
const bandit = { id: 'bandit' };
assert.equal(Q.isBonusEffectReady(wolf), true);
assert.equal(Q.beginBonusEffectCooldown(wolf, def), 5);
assert.equal(Q.isBonusEffectReady(wolf), false);
assert.equal(Q.bonusEffectCooldownRemaining(wolf), 5);
assert.equal(Q.isBonusEffectReady(bandit), true, 'other enemies stay ready while one enemy cools down');
assert.equal(Q.bonusEffectCooldownRemaining(null), 0, 'no target means no cooldown');
assert.deepEqual({ ...Q.cooldownSnapshot() }, { wolf: 5 }, 'diagnostics list cooling enemies by id');

const coolingTechnique = context.Combat.buildQuickAttack(def, matching, Q.isBonusEffectReady(wolf));
assert.equal(coolingTechnique.conditionMatched, true, 'raw condition remains observable during cooldown');
assert.equal(coolingTechnique.bonusActive, false, 'bonus package is suppressed during cooldown');
assert.equal(coolingTechnique.damageMul, def.base.damageMul, 'cooling Quick Attack falls back to ordinary damage');
assert.match(coolingTechnique.sourceText, /cooling down/);

testNowMs += 5001;
assert.equal(Q.isBonusEffectReady(wolf), true, 'bonus automatically rearms after five seconds');
assert.equal(Q.bonusEffectCooldownRemaining(wolf), 0);
Q.beginBonusEffectCooldown(bandit, def);
assert.deepEqual(Object.keys(Q.cooldownSnapshot()), ['bandit'], 'expired enemy clocks are dropped');

context.Combat.applyQuickAttackConfig({
  BONUS_EFFECT_COOLDOWN_S: 3,
  BONUS_EFFECT_POWER_MULTIPLIER: 2.5,
});
assert.equal(Q.BONUS_EFFECT_COOLDOWN_S, 3, 'global cooldown is runtime-configurable');
assert.equal(Q.BONUS_EFFECT_POWER_MULTIPLIER, 2.5, 'bonus payload power is runtime-configurable');

Q.resetBonusEffectCooldowns();
assert.equal(Q.beginBonusEffectCooldown(wolf, def), 3);
assert.equal(Q.bonusEffectCooldownRemaining(wolf), 3);

Q.resetBonusEffectCooldowns();
def.bonusEffectCooldownS = 1.25;
assert.equal(Q.beginBonusEffectCooldown(wolf, def), 1.25, 'a technique may override the global cooldown');
testNowMs += 1251;
assert.equal(Q.isBonusEffectReady(wolf), true);
delete def.bonusEffectCooldownS;

assert.ok(!registered.opportunistJab && registered.exhaustCutter && registered.backstabFlick && registered.mercySpike, 'enabled Quick Attacks register and Opportunist Jab stays disabled');

console.log('Quick Attack bonus cooldown tests passed.');
