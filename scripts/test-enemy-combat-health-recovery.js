'use strict';

const fs = require('fs'); // Used to load the production browser modules under test from the repository.
const path = require('path'); // Used to resolve production module paths portably.
const vm = require('vm'); // Used to execute the browser modules against a deterministic lightweight window.
const assert = require('assert'); // Used for the combat-recovery regression expectations below.

const resourceSystemPath = path.join(__dirname, '..', 'docs', 'js', 'combat', 'resource-system.js'); // Used as the real automatic Health-recovery implementation exercised by this integration test.
const recoveryPolicyPath = path.join(__dirname, '..', 'docs', 'js', 'combat', 'enemy-combat-health-recovery.js'); // Used as the shared combat-state policy layered over ResourceSystem.
const resourceSystemSource = fs.readFileSync(resourceSystemPath, 'utf8'); // Used as the production ResourceSystem script body evaluated in each isolated test context.
const recoveryPolicySource = fs.readFileSync(recoveryPolicyPath, 'utf8'); // Used as the production combat-recovery policy script body evaluated after ResourceSystem.
const NOW_MS = 10000; // Used as a stable clock so recent-combat and rested cases are deterministic.

function makeContext({
  hostile = true,
  companion = false,
  player = false,
  rested = false,
  state = 'idle',
  health = 50,
  bleeding = 0,
  congealed = 0,
  amphibiousFish = false,
} = {}) {
  const dispatched = []; // Used to retain ResourceSystem change events for optional diagnostic assertions without requiring a browser EventTarget.
  const window = { // Used as the minimum browser-global namespace needed by the two production modules.
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
            proneRecoveryDelayS: 1.5,
          },
        },
      },
    },
    Combat: {
      deps: {
        player: null,
        hostileObjects: new Set(),
      },
      telegraph: { isBusy: () => false },
      animalAttacks: { isBusy: () => false },
    },
    dispatchEvent(event) {
      dispatched.push(event);
    },
  };

  class CustomEvent { // Used by ResourceSystem's existing resource-change dispatch without pulling in a DOM implementation.
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const context = vm.createContext({ // Used to isolate globals and the deterministic performance clock between test cases.
    window,
    console,
    CustomEvent,
    performance: { now: () => NOW_MS },
  });
  vm.runInContext(resourceSystemSource, context, { filename: resourceSystemPath });
  vm.runInContext(recoveryPolicySource, context, { filename: recoveryPolicyPath });

  const entity = { // Used as the live actor passed through the actual ResourceSystem + combat-recovery wrapper.
    id: amphibiousFish ? 'test-gurumahi' : 'test-actor',
    name: amphibiousFish ? 'Gurumahi' : 'Test Actor',
    state,
    health,
    maxHealth: 100,
    stamina: 50,
    maxStamina: 100,
    footing: 100,
    maxFooting: 100,
    isCompanion: companion,
    def: {
      label: amphibiousFish ? 'Gurumahi' : 'Test Actor',
      hostile,
      amphibiousFish,
    },
  };
  window.ResourceSystem.initEntity(entity);
  entity.lastAttackAttemptAt = rested ? NOW_MS - 4000 : NOW_MS - 1000;
  entity.lastAttackReceivedAt = rested ? NOW_MS - 4000 : NOW_MS - 1000;
  window.ResourceSystem.setAffliction(entity, 'bleedingHealth', bleeding);
  window.ResourceSystem.setAffliction(entity, 'congealedHealth', congealed);

  if (hostile && !companion) window.Combat.deps.hostileObjects.add(entity);
  if (player) window.Combat.deps.player = entity;

  return { entity, window, dispatched };
}

{
  const harness = makeContext({ hostile: true, rested: false, bleeding: 5, congealed: 10 }); // Used to verify recent hostile combat blocks every automatic current-Health gain while damage continues.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.entity.health, 45, 'recent-combat hostile keeps Bleeding damage and gains no passive or Congealed Health');
  assert.strictEqual(harness.window.ResourceSystem.getAffliction(harness.entity, 'bleedingHealth'), 0, 'Bleeding still resolves during combat');
  assert.strictEqual(harness.window.ResourceSystem.getAffliction(harness.entity, 'congealedHealth'), 6.4, 'Congealed buildup still recovers during combat without restoring current Health');
}

{
  const harness = makeContext({ hostile: true, rested: true, state: 'chasing', bleeding: 5, congealed: 10, amphibiousFish: true }); // Used to reproduce the Gurumahi bug: AI combat persists after the three-second attack timer becomes rested.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.entity.health, 45, 'amphibious fish cannot heal during a long combat lull');
  assert.strictEqual(harness.window.ResourceSystem.getAffliction(harness.entity, 'bleedingHealth'), 0, 'rested-timer Bleeding still damages an actively chasing fish instead of healing it');
  assert.strictEqual(harness.window.ResourceSystem.getAffliction(harness.entity, 'congealedHealth'), 2.8, 'rested-rate Congealed maintenance may continue without restoring fish Health');
  assert.strictEqual(harness.window.CombatHealthRecoveryPolicy.getDebug().lastBlockedTick.reason, 'state:chasing', 'debug state identifies the persistent Gurumahi combat state that blocked recovery');
}

{
  const harness = makeContext({ hostile: false, player: true, rested: false }); // Used to verify the player is covered by the same recent-combat automatic-Health rule.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.entity.health, 50, 'player passive Health regeneration is blocked during recent combat');
  assert.strictEqual(harness.window.CombatHealthRecoveryPolicy.getDebug().lastBlockedTick.kind, 'player', 'debug state identifies player recovery blocks');
}

{
  const harness = makeContext({ hostile: true, companion: true, rested: false }); // Used to verify companions no longer bypass the shared combat recovery rule.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.entity.health, 50, 'companion passive Health regeneration is blocked during recent combat');
  assert.strictEqual(harness.window.CombatHealthRecoveryPolicy.getDebug().lastBlockedTick.kind, 'companion', 'debug state identifies companion recovery blocks');
}

{
  const harness = makeContext({ hostile: false, rested: false }); // Used to verify attacked passive wildlife also cannot passively recover Health until combat quiets.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.entity.health, 50, 'recently attacked passive creature cannot regenerate Health during combat');
}

{
  const harness = makeContext({ hostile: false, rested: true }); // Used to verify passive wildlife resumes ordinary recovery after combat is actually over.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.entity.health, 64, 'out-of-combat passive creature retains doubled rested Health regeneration');
}

{
  const harness = makeContext({ hostile: true, rested: true, state: 'idle' }); // Used to verify disengaged enemies still recover normally once both AI state and quiet window are clear.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.entity.health, 64, 'out-of-combat enemy retains ordinary rested Health regeneration');
}

{
  const harness = makeContext({ hostile: true, rested: true, state: 'chase' }); // Used to verify the canonical hostile chase state also blocks recovery beyond the timer.
  harness.window.ResourceSystem.tick(harness.entity, 1, { healthRegenPerSec: 7 });
  assert.strictEqual(harness.entity.health, 50, 'canonical chase state blocks passive Health regeneration even after the recent-hit timer expires');
}

{
  const harness = makeContext({ hostile: true, rested: true, state: 'idle' }); // Used to verify the shared API and legacy alias remain the same object for existing callers.
  assert.strictEqual(harness.window.CombatHealthRecoveryPolicy.version, 2, 'shared combat Health policy exposes version 2');
  assert.strictEqual(harness.window.EnemyCombatHealthRecoveryPolicy, harness.window.CombatHealthRecoveryPolicy, 'legacy enemy policy alias remains compatible');
}

console.log('Combat Health recovery regression: PASS');
