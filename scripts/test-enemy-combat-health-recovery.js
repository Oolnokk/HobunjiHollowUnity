'use strict';

const fs = require('fs'); // Used to load the browser module under test from the repository.
const path = require('path'); // Used to resolve the module path portably from this script.
const vm = require('vm'); // Used to execute the browser module against a small deterministic window stub.
const assert = require('assert'); // Used for the regression expectations below.

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'combat', 'enemy-combat-health-recovery.js'); // Used as the single source file exercised by this regression test.
const source = fs.readFileSync(modulePath, 'utf8'); // Used as the script body evaluated in each isolated test context.

function makeContext({ hostile = true, companion = false, rested = false, congealed = 0, health = 50 } = {}) {
  const entity = { // Used as the simulated player-facing combat entity passed through ResourceSystem.tick.
    id: 'test-enemy',
    health,
    maxHealth: 100,
    isCompanion: companion,
    def: { label: 'Test Enemy', hostile },
    afflictions: { congealedHealth: congealed },
  };
  const hostileObjects = new Set(); // Used as the same authoritative hostile registry consulted by the runtime policy.
  if (hostile && !companion) hostileObjects.add(entity);
  let seenOptions = null; // Used to verify the policy only overrides Health regeneration for guarded enemy ticks.
  const ResourceSystem = { // Used as the minimum ResourceSystem surface needed by the production policy.
    config: () => ({ quietSeconds: 3 }),
    getRestInfo: () => ({ rested }),
    getAffliction: (target, id) => target.afflictions?.[id] || 0,
    enforceCaps: target => { target.health = Math.max(0, Math.min(target.maxHealth, target.health)); },
    tick(target, dt, options = {}) {
      seenOptions = options;
      const healthRate = options.healthRegenPerSec ?? 5; // Used to emulate the base ResourceSystem passive Health recovery path.
      target.health += healthRate * dt;
      const recovered = Math.min(target.afflictions.congealedHealth || 0, 2 * dt); // Used to emulate Congealed Health's separate current-Health restoration path.
      target.afflictions.congealedHealth = Math.max(0, (target.afflictions.congealedHealth || 0) - recovered);
      target.health += recovered;
      target.health -= 1 * dt; // Used to prove damage-over-time is preserved while recovery is removed.
      return { puked: null };
    },
  };
  const window = { // Used as the browser-global namespace expected by the production module.
    ResourceSystem,
    Combat: { deps: { hostileObjects } },
  };
  const context = vm.createContext({ window, console }); // Used to isolate module globals between individual test cases.
  vm.runInContext(source, context, { filename: modulePath });
  return { entity, window, getSeenOptions: () => seenOptions };
}

{
  const harness = makeContext({ hostile: true, rested: false, congealed: 10, health: 50 }); // Used to verify both passive and Congealed Health recovery are blocked during hostile combat.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.getSeenOptions().healthRegenPerSec, 0, 'combat enemy passive Health regeneration should be forced to zero');
  assert.strictEqual(harness.entity.afflictions.congealedHealth, 8, 'Congealed Health itself should still recover during combat');
  assert.strictEqual(harness.entity.health, 49, 'combat enemy should keep damage-over-time loss without gaining current Health from Congealed recovery');
  assert.strictEqual(harness.window.EnemyCombatHealthRecoveryPolicy.getDebug().blockedTickCount, 1, 'debug state should report the guarded enemy tick');
}

{
  const harness = makeContext({ hostile: true, rested: true, congealed: 10, health: 50 }); // Used to verify normal enemy recovery resumes after combat quiets.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.getSeenOptions().healthRegenPerSec, 7, 'out-of-combat enemy should retain its authored Health regeneration rate');
  assert.strictEqual(harness.entity.health, 58, 'out-of-combat enemy should recover normally while still taking the simulated tick damage');
}

{
  const harness = makeContext({ hostile: false, rested: false, congealed: 10, health: 50 }); // Used to verify passive/non-hostile creatures are not caught by the enemy-only policy.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.getSeenOptions().healthRegenPerSec, 7, 'non-hostile creature recovery should remain unchanged');
  assert.strictEqual(harness.entity.health, 58, 'non-hostile creature should keep ordinary recovery behavior');
}

{
  const harness = makeContext({ hostile: true, companion: true, rested: false, congealed: 10, health: 50 }); // Used to verify companions stay exempt even if their species definition is normally hostile.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.getSeenOptions().healthRegenPerSec, 7, 'companions should not lose Health regeneration because their species is normally hostile');
  assert.strictEqual(harness.entity.health, 58, 'companion recovery should remain unchanged');
}

console.log('Enemy combat Health recovery regression: PASS');
