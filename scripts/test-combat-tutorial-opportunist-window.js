#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const player = {
  id: 'player',
  x: 0, y: 0, angle: 0, facing: Math.PI,
  health: 100, maxHealth: 100,
  stamina: 100, maxStamina: 100,
  exhaustion: { active: false, blackStamina: 100 },
};
const active = new Set(); // Minimal staged-action registry used to exercise the shared condition wrapper.
const Combat = {
  deps: { player },
  quickAttackData: {},
  animalAttacks: {
    isWindingUp(actor) { return actor?._animalAttack?.state?.stage === 'windup'; },
    isStriking(actor) { return actor?._animalAttack?.state?.stage === 'leap'; },
  },
  beginStagedAction(options = {}) {
    const action = {
      windupS: Number(options.windupS) || 0,
      strikeS: Number(options.strikeS) || 0,
      recoverS: Number(options.recoverS) || 0,
      data: options.data || null,
      t: 0,
      phase: 'windup',
      cancelled: false,
    };
    action.totalS = action.windupS + action.strikeS + action.recoverS;
    action.cancel = () => {
      action.cancelled = true;
      action.phase = 'done';
      active.delete(action);
      options.onCancel?.(action);
    };
    active.add(action);
    return action;
  },
  update(dt) {
    for (const action of [...active]) {
      action.t += Number(dt) || 0;
      if (action.t >= action.totalS) {
        action.phase = 'done';
        active.delete(action);
      }
    }
  },
};
const ResourceSystem = {
  getDepletionEquivalentCurrent(target, resource) {
    return target[`condition_${resource}`] ?? target[resource];
  },
  getEffectiveMax(target, resource) {
    return target[`effective_${resource}_max`] ?? target[`max${resource[0].toUpperCase()}${resource.slice(1)}`];
  },
};
let playerRangedAction = null; // Live ranged action exposed through the same borrowed state used by gameplay animation.
let thrownChargeItemKey = null; // Held thrown-weapon windup used to verify pre-release Opportunist timing.
const RangedWeapons = {
  playerActionState: () => playerRangedAction,
  startPlayerAction(itemKey) {
    playerRangedAction = { itemKey, kind: 'fire', t: 0, durationS: 1, fired: false };
    return true;
  },
  cancelPlayerAction() { playerRangedAction = null; },
  update() {},
  updateBanditAI() {},
  cancelBanditAction(actor) { actor._rangedAction = null; },
};
const HobunjiRangedWeaponArchetypes = { activeThrownChargeItemKey: () => thrownChargeItemKey };
const window = { Combat, ResourceSystem, RangedWeapons, HobunjiRangedWeaponArchetypes };
vm.runInNewContext(
  fs.readFileSync('docs/js/combat/combat-tutorial-partner.js', 'utf8'),
  { window, console, Math },
  { filename: 'combat-tutorial-partner.js' },
);
const partner = window.CombatTutorialPartner;
partner.init({ TILE: 32 });

function actor(overrides = {}) {
  return {
    id: 'target',
    x: 0, y: 0, facing: 0,
    health: 100, maxHealth: 100,
    stamina: 100, maxStamina: 100,
    maxFooting: 100, footing: 100,
    exhaustion: { active: false, blackStamina: 100 },
    ...overrides,
  };
}

const enemy = actor();
const behindAttacker = { id: 'behind', x: -10, y: 0 };
const frontAttacker = { id: 'front', x: 10, y: 0 };

let conditions = Combat.getQuickAttackConditions(Combat.deps, enemy, behindAttacker);
assert.equal(conditions.behind, true, 'Backstab reads a creature target facing + attacker position');
conditions = Combat.getQuickAttackConditions(Combat.deps, enemy, frontAttacker);
assert.equal(conditions.behind, false, 'Backstab rejects an attacker in front');

player.angle = Math.PI / 2;
player.facing = 0; // Deliberately conflicting legacy field proves the player uses angle.
conditions = Combat.getQuickAttackConditions(Combat.deps, player, { id: 'enemy-attacker', x: 0, y: -10 });
assert.equal(conditions.behind, true, 'Backstab uses player angle instead of creature-facing assumptions when the target is the player');
conditions = Combat.getQuickAttackConditions(Combat.deps, player, { id: 'enemy-attacker', x: 0, y: 10 });
assert.equal(conditions.behind, false, 'Player-facing front/behind test is symmetric');
player.angle = 0;

const resourceTarget = actor({ stamina: 21, health: 31 });
conditions = Combat.getQuickAttackConditions(Combat.deps, resourceTarget, frontAttacker);
assert.equal(conditions.exhausted, false);
assert.equal(conditions.lowHealth, false);
resourceTarget.stamina = 20;
resourceTarget.health = 30;
conditions = Combat.getQuickAttackConditions(Combat.deps, resourceTarget, frontAttacker);
assert.equal(conditions.exhausted, true, 'Exhaust Cutter includes the exact 20% Stamina threshold');
assert.equal(conditions.lowHealth, true, 'Mercy Spike includes the exact 30% Health threshold');
resourceTarget.health = 0;
conditions = Combat.getQuickAttackConditions(Combat.deps, resourceTarget, frontAttacker);
assert.equal(conditions.lowHealth, false, 'Dead targets never satisfy Mercy Spike');
resourceTarget.health = 100;
resourceTarget.stamina = 100;
resourceTarget.exhaustion.active = true;
assert.equal(Combat.getQuickAttackConditions(Combat.deps, resourceTarget, frontAttacker).exhausted, true, 'True Exhausted state always satisfies Exhaust Cutter');
resourceTarget.exhaustion.active = false;
resourceTarget.condition_stamina = 15;
resourceTarget.condition_health = 25;
assert.equal(Combat.getQuickAttackConditions(Combat.deps, resourceTarget, frontAttacker).exhausted, true, 'Adjusted usable Stamina drives Exhaust Cutter');
assert.equal(Combat.getQuickAttackConditions(Combat.deps, resourceTarget, frontAttacker).lowHealth, true, 'Adjusted usable Health drives Mercy Spike');

for (const [phase, expected] of [['windup', true], ['strike', true], ['recover', false], [null, false]]) {
  enemy.telegraphState = phase;
  assert.equal(
    Combat.getQuickAttackConditions(Combat.deps, enemy, frontAttacker).enemyStriking,
    expected,
    `generic telegraph ${phase || 'idle'} has correct Opportunist state`,
  );
}
enemy.telegraphState = null;
for (const [phase, expected] of [['windup', true], ['leap', true], ['recover', false]]) {
  enemy._animalAttack = { state: { stage: phase } };
  assert.equal(
    Combat.getQuickAttackConditions(Combat.deps, enemy, frontAttacker).enemyStriking,
    expected,
    `modular animal ${phase} has correct Opportunist state`,
  );
}
enemy._animalAttack = null;

const playerAction = Combat.beginStagedAction({
  windupS: 0.4, strikeS: 0.2, recoverS: 0.3,
  data: { meleeThreat: { source: 'player-test' } },
});
assert.equal(Combat.attackOpportunityPhase(player), 'windup', 'player staged attacks expose windup');
assert.equal(Combat.getQuickAttackConditions(Combat.deps, player, frontAttacker).enemyStriking, true, 'enemies can read player windup');
playerAction.t = 0.45;
Combat.update(0);
assert.equal(Combat.attackOpportunityPhase(player), 'strike', 'player staged attacks expose strike');
assert.equal(player.telegraphState, 'strike', 'legacy readers also receive the player strike phase');
playerAction.t = 0.7;
Combat.update(0);
assert.equal(Combat.attackOpportunityPhase(player), 'recover', 'player staged attacks expose recovery distinctly');
assert.equal(Combat.getQuickAttackConditions(Combat.deps, player, frontAttacker).enemyStriking, false, 'recovery is not an Opportunist opening');
playerAction.cancel();
assert.equal(Combat.attackOpportunityPhase(player), null, 'cancelled player attack clears the opening');

RangedWeapons.startPlayerAction('crossbow');
assert.equal(Combat.attackOpportunityPhase(player), 'windup', 'player ranged pre-release fire exposes an Opportunist windup');
assert.equal(player.telegraphState, 'windup', 'legacy Quick Attack readers see player ranged windup');
playerRangedAction.fired = true;
RangedWeapons.update(0);
assert.equal(Combat.attackOpportunityPhase(player), 'recover', 'projectile release ends the player ranged opportunity');
assert.equal(Combat.getQuickAttackConditions(Combat.deps, player, frontAttacker).enemyStriking, false, 'post-shot ranged recovery does not qualify');
RangedWeapons.cancelPlayerAction();

thrownChargeItemKey = 'throwing_spear';
assert.equal(Combat.attackOpportunityPhase(player), 'windup', 'held thrown-weapon charge is an Opportunist windup');
thrownChargeItemKey = null;

const rangedEnemy = actor({ id: 'ranged-enemy', _rangedAction: { kind: 'fire', t: 0, durationS: 1, fired: false } });
RangedWeapons.updateBanditAI(rangedEnemy, 0, player, 100);
assert.equal(Combat.attackOpportunityPhase(rangedEnemy), 'windup', 'enemy ranged pre-release fire exposes an Opportunist windup');
assert.equal(Combat.getQuickAttackConditions(Combat.deps, rangedEnemy, player).enemyStriking, true);
rangedEnemy._rangedAction.fired = true;
RangedWeapons.updateBanditAI(rangedEnemy, 0, player, 100);
assert.equal(Combat.attackOpportunityPhase(rangedEnemy), 'recover', 'enemy projectile release ends the Opportunist opening');
assert.equal(Combat.getQuickAttackConditions(Combat.deps, rangedEnemy, player).enemyStriking, false);

const stagedEnemy = actor({ id: 'humanoid-enemy' });
const enemyAction = Combat.beginStagedAction({
  windupS: 0.5, strikeS: 0.2, recoverS: 0.1,
  data: { isBandit: true, attacker: stagedEnemy },
});
assert.equal(Combat.attackOpportunityPhase(stagedEnemy), 'windup', 'humanoid/special staged enemies expose windup');
assert.equal(Combat.getQuickAttackConditions(Combat.deps, stagedEnemy, player).enemyStriking, true);
enemyAction.t = 0.55;
Combat.update(0);
assert.equal(Combat.attackOpportunityPhase(stagedEnemy), 'strike', 'humanoid/special staged enemies expose strike');
enemyAction.t = 0.75;
Combat.update(0);
assert.equal(Combat.getQuickAttackConditions(Combat.deps, stagedEnemy, player).enemyStriking, false, 'humanoid recovery does not qualify');

const tutorialTarget = actor({ id: 'oddclaw', combatTutorialHostile: true });
tutorialTarget._banditAction = { t: 0.1, windupS: 0.5, strikeS: 0.2, recoverS: 0, phase: 'windup', cancelled: false };
partner.maintain(tutorialTarget, { id: 'jab', check: 'quickBonus', ability: 'opportunistJab', hostile: true });
assert.equal(tutorialTarget.combatTutorialAttackWindow, 'windup', 'Spearhead diagnostics use the same shared attack-window contract');

enemyAction.cancel();
stagedEnemy.telegraphState = 'strike';
Combat.getQuickAttackConditions(Combat.deps, stagedEnemy, player);
assert.equal(Combat.quickAttackData.lastConditionCheck.attackWindow, 'strike', 'mobile condition diagnostics retain the last exact attack phase');
assert.equal(typeof Combat.quickAttackData.lastConditionCheck.behindDot, 'number', 'mobile condition diagnostics expose Backstab geometry');
console.log('shared Quick Attack condition contract tests passed');
