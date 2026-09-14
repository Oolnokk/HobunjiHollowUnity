// Enemy combat Health-recovery policy.
// Hostile entities keep normal Stamina/Footing and affliction maintenance, but
// cannot regain current Health until the shared ResourceSystem combat quiet
// window has elapsed. Player and companion recovery are intentionally unchanged.
(() => {
  'use strict';

  const RS = window.ResourceSystem; // Used as the existing authoritative resource/combat-recovery system.
  if (!RS?.tick || !RS?.getRestInfo || !RS?.config || window.EnemyCombatHealthRecoveryPolicy) return;

  const previousTick = RS.tick.bind(RS); // Used to preserve every existing ResourceSystem tick behavior before enforcing the enemy-only Health rule.
  let blockedTickCount = 0; // Used by mobile-readable diagnostics to confirm the guard is actively catching hostile combat ticks.
  let lastBlockedTick = null; // Used by mobile-readable diagnostics to expose the most recent suppressed recovery.

  function isHostileEntity(entity) {
    if (!entity || entity.isCompanion) return false;
    const hostileObjects = window.Combat?.deps?.hostileObjects; // Used as the runtime source of truth for current enemies, including bandits and hostile animals.
    if (hostileObjects?.has?.(entity)) return true;
    return entity.def?.hostile === true || entity.hostile === true;
  }

  function combatActive(entity) {
    const cfg = RS.config(); // Used with the ResourceSystem's own quietSeconds value instead of inventing a second combat timeout.
    const rest = RS.getRestInfo(entity, cfg); // Used to share the same last-attack combat bookkeeping as normal resource recovery.
    return !rest?.rested;
  }

  function entityLabel(entity) {
    return entity?.def?.label || entity?.name || entity?.id || 'hostile';
  }

  RS.tick = function enemyCombatHealthRecoveryTick(entity, dt, options = {}) {
    const blockHealthRecovery = isHostileEntity(entity) && combatActive(entity); // Used to leave players, companions, passive wildlife, and out-of-combat enemies unchanged.
    if (!blockHealthRecovery) return previousTick(entity, dt, options);

    const healthBefore = Number(entity.health) || 0; // Used by diagnostics and as the baseline for the corrected post-tick Health delta.
    const congealedBefore = Number(RS.getAffliction?.(entity, 'congealedHealth')) || 0; // Used to remove Congealed Health's current-Health restoration while still letting the affliction itself recover.
    const guardedOptions = { ...options, healthRegenPerSec: 0 }; // Used to disable ordinary passive Health regeneration for this hostile combat tick only.
    const result = previousTick(entity, dt, guardedOptions); // Used to preserve damage-over-time, Stamina, Footing, exhaustion, and affliction recovery.
    const congealedAfter = Number(RS.getAffliction?.(entity, 'congealedHealth')) || 0; // Used to measure only the Congealed amount actually recovered by the wrapped tick.
    const congealedRecovered = Math.max(0, congealedBefore - congealedAfter); // Used to undo only the Health points Congealed recovery added, without canceling Bleeding/Poison damage from the same tick.

    if (congealedRecovered > 0 && entity.health > 0) {
      entity.health = Math.max(0, (Number(entity.health) || 0) - congealedRecovered);
      RS.enforceCaps?.(entity);
    }

    const healthAfter = Number(entity.health) || 0; // Used by diagnostics to verify the enemy did not gain Health during the guarded tick.
    blockedTickCount += 1;
    lastBlockedTick = {
      label: entityLabel(entity),
      healthBefore,
      healthAfter,
      congealedRecovered,
      dt: Number(dt) || 0,
    };
    return result;
  };

  RS.__enemyCombatHealthRecoveryInstalled = true;

  window.EnemyCombatHealthRecoveryPolicy = Object.freeze({
    version: 1,
    isHostileEntity,
    combatActive,
    getDebug() {
      return {
        installed: true,
        blockedTickCount,
        lastBlockedTick,
      };
    },
  });

  window.__enemyCombatHealthRecoveryDebug = () => window.EnemyCombatHealthRecoveryPolicy.getDebug();
})();
