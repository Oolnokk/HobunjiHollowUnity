'use strict';

const assert = require('node:assert'); // Strict checks for per-hit condition resolution, reach, and stamina refund behavior.
const fs = require('node:fs'); // Reads the committed browser module directly from the checkout.
const path = require('node:path'); // Resolves the runtime source path from this script.
const vm = require('node:vm'); // Executes the browser IIFE against a deterministic combat mock.

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'combat', 'combat-quickattacks.js'), 'utf8'); // Exact runtime source under test.

function runBackstabScenario(targetFacing) {
  const registered = new Map(); // Ability registrations captured so the test can fire Backstab Flick exactly as gameplay does.
  const damageCalls = []; // Damage payloads used to prove the struck creature's conditional controls damage/vulnerability.
  const lungeCalls = []; // Lunge distances used to pin the authored 4.5-tile reach.
  const toasts = []; // In-game feedback retained to prove the refund is surfaced without devtools.
  const player = {
    x: 0, y: 0, angle: 0,
    stamina: 100, maxStamina: 100,
    exhaustion: { active: false, blackStamina: 100 },
  };
  const target = {
    x: 20, y: 0, facing: targetFacing,
    health: 100, maxHealth: 100,
    stamina: 100, maxStamina: 100,
    areaId: 'test',
    def: { label: 'Target' },
  };

  const ResourceSystem = {
    spendStamina(entity, amount) {
      const spent = Math.min(entity.stamina, amount);
      entity.stamina -= spent;
      const excess = amount - spent;
      if (excess > 0) {
        entity.exhaustion.active = true;
        entity.exhaustion.blackStamina = Math.max(0, 100 - excess);
      }
      return { spent, excess };
    },
    getExhaustionSpeed() { return 1; },
    getEffectiveMax(entity) { return entity.maxStamina; },
    enforceCaps() {},
  };

  const Combat = {
    abilities: {
      register(id, def) { registered.set(id, def); },
    },
    animalAttacks: { isStriking() { return false; } },
    isStaggered() { return false; },
    meleeHit() { return true; },
    beginStagedAction(options) {
      options.onStrike();
      options.onComplete();
      return null;
    },
    deps: {
      TILE: 32,
      player,
      hostileObjects: [target],
      currentWeaponKey() { return 'test_weapon'; },
      currentWeaponDamageType() { return 'sharp'; },
      weaponAbility() { return { damage: 10, rangePx: 64, knockbackPxS: 100 }; },
      triggerWeaponSwingVisual() {},
      beginCombatLunge(distancePx) { lungeCalls.push(distancePx); },
      clearVegetationInAttackCone() { return 0; },
      getPlayerMeleeAimPitch() { return 0; },
      getCurrentArea() { return 'test'; },
      damageCreature(creature, damage, x, y, knockbackPxS, options) {
        damageCalls.push({ creature, damage, knockbackPxS, options });
      },
      playWeaponHitSfx() {},
      showToast(message) { toasts.push(message); },
      awardWeaponMasteryXp() {},
      debugLog() {},
      // Deliberately wrong/irrelevant auto-target: the runtime must not use it
      // to decide the struck target's conditional anymore.
      findAutoTarget() { return { x: -999, y: -999, facing: 0, health: 1, maxHealth: 100, stamina: 0, maxStamina: 100 }; },
    },
  };

  const context = vm.createContext({
    console,
    performance: { now: () => 1000 },
    window: { Combat, ResourceSystem },
  });
  vm.runInContext(source, context, { filename: 'combat-quickattacks.js' });

  const backstab = registered.get('backstabFlick');
  assert(backstab, 'Backstab Flick should register');
  backstab.onTap();

  return { Combat, player, target, damageCalls, lungeCalls, toasts };
}

const behind = runBackstabScenario(0); // Target faces east while the player stands west of it: player is behind.
assert.strictEqual(behind.damageCalls.length, 1);
assert.strictEqual(behind.damageCalls[0].damage, 36, 'actual struck target should receive Backstab Flick conditional damage');
assert.strictEqual(behind.damageCalls[0].options.consumeHealthVulnerability, true, 'conditional hit should consume power-hit vulnerability');
assert.strictEqual(behind.player.stamina, 70, '60 stamina is spent and 30 is refunded after the correct conditional lands');
assert.strictEqual(behind.lungeCalls[0], 32 * 4.5, 'quick-attack forward reach should be 4.5 tiles');
assert.match(behind.toasts[0], /refunded 30 stamina/);
assert.strictEqual(behind.Combat.quickAttackData.lastResolution.conditionalHits, 1);
assert.strictEqual(behind.Combat.quickAttackData.lastResolution.actualCost, 60);
assert.strictEqual(behind.Combat.quickAttackData.lastResolution.refunded, 30);

const front = runBackstabScenario(Math.PI); // Target faces west toward the player: the player is in front, not behind.
assert.strictEqual(front.damageCalls.length, 1);
assert.strictEqual(front.damageCalls[0].damage, 6, 'non-conditional Backstab Flick should use its base damage against the actual hit target');
assert.strictEqual(front.damageCalls[0].options.consumeHealthVulnerability, false);
assert.strictEqual(front.player.stamina, 40, 'missing the conditional keeps the full 60-point stamina commitment spent');
assert.doesNotMatch(front.toasts[0], /refunded/);

// Refunds must also unwind black-stamina debt instead of only painting normal
// Stamina back onto an Exhausted entity.
const debtEntity = {
  stamina: 0, maxStamina: 100,
  exhaustion: { active: true, blackStamina: 80 },
};
const debtRefunded = behind.Combat.quickAttackData.refundStamina(debtEntity, 30);
assert.strictEqual(debtRefunded, 30);
assert.strictEqual(debtEntity.exhaustion.active, false, '20 points clear the debt');
assert.strictEqual(debtEntity.exhaustion.blackStamina, 100);
assert.strictEqual(debtEntity.stamina, 10, 'remaining 10 points return to normal Stamina after debt clears');

console.log('quick attack conditional/refund regression tests passed');
