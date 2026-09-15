#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let now = 1000; // Deterministic performance clock used for enemy iframe assertions.
let activeThreat = null; // Current player windup returned to the enemy dodge controller.
let originalInitDeps = null; // Confirms the BanditCombat initialization wrapper preserves dependencies.
let observedMoveSpeed = null; // Captures the weight-adjusted speed seen inside the original enemy AI.
let staminaSpent = 0; // Captures the real shared ResourceSystem dodge cost.

const player = { x: 0, y: 0, angle: 0, health: 100 }; // Player attacker used by threat cone calculations.
const hostileObjects = new Set(); // Live collection exposed through mobile-friendly dodge diagnostics.
const BanditCombat = {
  init(injected) { originalInitDeps = injected; return 'initialized'; },
  async makeEntity() {
    return {
      id: 'bandit-test', isBandit: true, banditRank: 'captain', health: 100,
      x: 70, y: 0, stamina: 100, maxStamina: 100, facing: Math.PI,
      def: { moveSpeed: 100, chaseSpeed: 200 },
      avatarRef: { group: { rotation: { z: 0 } } },
      rosterRecord: {
        equippedCosmetics: ['tankan_bodywrap', 'fine_hood', 'bandolier1'],
        cosmeticSlots: { tankan_bodywrap: 'overwear', fine_hood: 'hood', bandolier1: 'torso' },
      },
    };
  },
  updateCombatAI(entity) {
    observedMoveSpeed = { move: entity.def.moveSpeed, chase: entity.def.chaseSpeed };
    return { aimAngle: entity.facing, moving: true };
  },
};

function stats(weight) {
  return {
    weightUnits: weight,
    damageTakenMul: Math.max(0.45, 1 - weight * 0.025),
    footingTakenMul: Math.max(0.35, 1 - weight * 0.035),
    dodgeEfficacy: Math.max(0.5, 1 - weight * 0.025),
    combatMoveMul: Math.max(0.65, 1 - weight * 0.018),
  };
}

const ClothingWeavingSystem = {
  outfitItemsFromRoster(roster) { return roster.equippedCosmetics.map(cosmeticId => ({ cosmeticId, slot: roster.cosmeticSlots[cosmeticId] })); },
  totalOutfitWeight(items) { return items.reduce((sum, item) => sum + ({ overwear: 4, hood: 2 }[item.slot] || 0), 0); },
  armorStats: stats,
  armorStatsForEntity(entity) { return stats(entity.outfitWeightUnits || 0); },
};

const Combat = {
  currentPlayerMeleeThreat() { return activeThreat; },
};

const ResourceSystem = {
  spendStamina(_entity, amount) { staminaSpent += amount; return { spent: amount, excess: 0 }; },
};

const windowStub = { BanditCombat, ClothingWeavingSystem, Combat, ResourceSystem };
const context = vm.createContext({ window: windowStub, performance: { now: () => now }, Date, Math, console });
vm.runInContext(fs.readFileSync('docs/js/combat/combat-enemy-dodge.js', 'utf8'), context, { filename: 'combat-enemy-dodge.js' });

const deps = {
  TILE: 64,
  hostileObjects,
  rnd: () => 0,
  canOccupyAt: () => true,
  sweptMove(_x, _y, desiredX, desiredY) { return { x: desiredX, y: desiredY }; },
  tickCreatureFootsteps() {},
}; // Minimal real BanditCombat dependency surface consumed by the decoupled controller.
assert.equal(windowStub.BanditCombat.init(deps), 'initialized');
assert.equal(originalInitDeps, deps, 'enemy dodge wrapper preserves BanditCombat.init arguments and return value');

(async () => {
  const enemy = await windowStub.BanditCombat.makeEntity(); // Entity receives immutable spawn-time outfit profiling.
  hostileObjects.add(enemy);
  assert.equal(enemy.outfitWeightUnits, 6, 'bandolier is ignored while bodywrap and hood total six units');
  assert.equal(enemy._usesOutfitWeight, true, 'enemy is opted into the same ResourceSystem armor hooks as the player');
  assert.equal(enemy.outfitArmorStats.dodgeEfficacy, 0.85);

  windowStub.EnemyDodge.applyConfig({
    chanceByRank: { grunt: 1, lieutenant: 1, captain: 1 },
    reactionDelayS: 0,
    cooldownS: 1,
    staminaCost: 18,
    speedPxS: 100,
    durationS: 0.2,
    iframeMs: 400,
    lungeThreatFraction: 1,
    reachPaddingTiles: 0,
  });
  activeThreat = {
    id: 1, attacker: player, rangePx: 100, halfConeRad: Math.PI / 4,
    lungePx: 0, yaw: 0, timeToImpactS: 0.2, source: 'Forehand Swing',
  }; // A genuine player windup whose cone currently contains this enemy.

  const start = windowStub.BanditCombat.updateCombatAI(enemy, 0.016, player, 70); // First frame commits the rank-based reaction.
  assert.equal(start.moving, true);
  assert.equal(enemy.dodging, true);
  assert.equal(staminaSpent, 18, 'enemy dodge spends the configured shared Stamina cost');
  assert(Math.abs(enemy.dodgeT - 0.17) < 1e-12, 'six weight units reduce enemy dodge duration/travel to 85%');
  assert.equal(enemy.invulnUntil, now + 340, 'enemy iframe duration uses the same 85% outfit efficacy');

  const before = { x: enemy.x, y: enemy.y }; // Starting position used to verify the next frame travels laterally.
  windowStub.BanditCombat.updateCombatAI(enemy, 0.1, player, 70);
  assert(Math.abs(enemy.x - before.x) < 1e-9, 'enemy dodge is perpendicular rather than retreating straight backward when a side lane is clear');
  assert(Math.abs(enemy.y - before.y) > 9.9, 'enemy dodge performs real swept movement');

  while (enemy.dodging) windowStub.BanditCombat.updateCombatAI(enemy, 0.1, player, 70);
  assert.equal(enemy.avatarRef.group.rotation.z, 0, 'roll presentation resets exactly when dodge movement ends');
  activeThreat = null;
  enemy._enemyDodgeCooldownT = 0;
  windowStub.BanditCombat.updateCombatAI(enemy, 0.016, player, 70);
  assert(Math.abs(observedMoveSpeed.move - 89.2) < 1e-9, 'original melee AI sees outfit-weighted combat movement speed');
  assert(Math.abs(observedMoveSpeed.chase - 178.4) < 1e-9, 'original ranged/chase AI sees outfit-weighted chase speed');
  assert.equal(enemy.def.moveSpeed, 100, 'authored movement speed is restored after the wrapped frame');
  assert.equal(enemy.def.chaseSpeed, 200, 'authored chase speed cannot compound across frames');

  const offAxis = windowStub.EnemyDodge.threatStatus(enemy, { id: 2, attacker: player, rangePx: 200, halfConeRad: 0.2, yaw: Math.PI, lungePx: 0 }); // Opposite-facing attack must not trigger psychic evasion.
  assert.equal(offAxis.exposed, false);
  assert.equal(windowStub.EnemyDodge.debugSnapshot().enemies[0].weightUnits, 6, 'mobile diagnostic exposes each enemy outfit and armor result');

  const core = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8'); // Verifies the shared active-windup registry remains the authority.
  assert.match(core, /currentPlayerMeleeThreat/);
  for (const file of ['combat-combo.js', 'combat-quickattacks.js', 'combat-flurry.js', 'combat-charged-breaker.js', 'combat-counter-shield.js']) {
    const source = fs.readFileSync(`docs/js/combat/${file}`, 'utf8'); // Every damaging player melee family must publish threat geometry.
    assert.match(source, /playerMeleeThreat\(/, `${file} publishes its real cone and range to enemy dodge AI`);
  }
  const game = fs.readFileSync('docs/game.js', 'utf8'); // Direct hit rejection must happen before all damage/Footing/affliction effects.
  assert.match(game, /invulnUntil[\s\S]{0,180}ignoreDodge[\s\S]{0,180}return false/);
  const combatLog = fs.readFileSync('docs/js/bandit-combat-log.js', 'utf8'); // In-page Testing Arena copy log is the mobile-friendly validation surface.
  for (const field of ['weight=', 'defMul=', 'footMul=', 'moveMul=', 'dodgeEff=', 'dodging=', 'dodgeT=', 'dodgeCdT=']) {
    assert.match(combatLog, new RegExp(field), `combat log exposes ${field} for device testing`);
  }

  console.log('enemy dodge and shared outfit-weight combat checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
