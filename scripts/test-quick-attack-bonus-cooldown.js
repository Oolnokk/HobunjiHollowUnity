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
const def = Q.TECHNIQUES.opportunistJab;
const matching = { enemyStriking: true, exhausted: false, behind: false, lowHealth: false };

assert.equal(Q.BONUS_EFFECT_COOLDOWN_S, 5, 'Quick Attack bonus-effect cooldown defaults to five seconds');
assert.equal(Q.BONUS_EFFECT_POWER_MULTIPLIER, 2, 'mastery bonus payloads default to double power');

const readyTechnique = context.Combat.buildQuickAttack(def, matching, true);
assert.equal(readyTechnique.conditionMatched, true);
assert.equal(readyTechnique.bonusActive, true);
assert.equal(readyTechnique.damageMul, 4, 'Opportunist Jab uses its stronger authored bonus while ready');
assert.equal(readyTechnique.knockbackMul, 2.4);

assert.equal(Q.isBonusEffectReady('sword', 'opportunistJab', def), true);
assert.equal(Q.beginBonusEffectCooldown('sword', 'opportunistJab', def), 5);
assert.equal(Q.isBonusEffectReady('sword', 'opportunistJab', def), false);
assert.equal(Q.bonusEffectCooldownRemaining('sword', 'opportunistJab', def), 5);

const coolingTechnique = context.Combat.buildQuickAttack(def, matching, Q.isBonusEffectReady('sword', 'opportunistJab', def));
assert.equal(coolingTechnique.conditionMatched, true, 'raw condition remains observable during cooldown');
assert.equal(coolingTechnique.bonusActive, false, 'bonus package is suppressed during cooldown');
assert.equal(coolingTechnique.damageMul, def.base.damageMul, 'cooling Quick Attack falls back to ordinary damage');
assert.match(coolingTechnique.sourceText, /cooling down/);

testNowMs += 5001;
assert.equal(Q.isBonusEffectReady('sword', 'opportunistJab', def), true, 'bonus automatically rearms after five seconds');
assert.equal(Q.bonusEffectCooldownRemaining('sword', 'opportunistJab', def), 0);

context.Combat.applyQuickAttackConfig({
  BONUS_EFFECT_COOLDOWN_S: 3,
  BONUS_EFFECT_POWER_MULTIPLIER: 2.5,
});
assert.equal(Q.BONUS_EFFECT_COOLDOWN_S, 3, 'global cooldown is runtime-configurable');
assert.equal(Q.BONUS_EFFECT_POWER_MULTIPLIER, 2.5, 'bonus payload power is runtime-configurable');

Q.resetBonusEffectCooldowns();
assert.equal(Q.beginBonusEffectCooldown('sword', 'opportunistJab', def), 3);
assert.equal(Q.bonusEffectCooldownRemaining('sword', 'opportunistJab', def), 3);

Q.resetBonusEffectCooldowns();
def.bonusEffectCooldownS = 1.25;
assert.equal(Q.beginBonusEffectCooldown('sword', 'opportunistJab', def), 1.25, 'a technique may override the global cooldown');
testNowMs += 1251;
assert.equal(Q.isBonusEffectReady('sword', 'opportunistJab', def), true);
delete def.bonusEffectCooldownS;

assert.ok(registered.opportunistJab && registered.exhaustCutter && registered.backstabFlick && registered.mercySpike, 'all Quick Attacks still register');

console.log('Quick Attack bonus cooldown tests passed.');
