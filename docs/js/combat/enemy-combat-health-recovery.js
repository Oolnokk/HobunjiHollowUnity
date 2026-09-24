// Shared combat Health-recovery policy.
// Automatic current-Health recovery is disabled for every live combatant while
// combat is active. Explicit player actions such as food, potions, and bandages
// remain separate; Stamina/Footing and affliction maintenance continue normally.
(() => {
  'use strict';

  const RS = window.ResourceSystem; // Used as the existing authoritative resource/combat-recovery system.
  if (!RS?.tick || !RS?.getRestInfo || !RS?.config || window.CombatHealthRecoveryPolicy || window.EnemyCombatHealthRecoveryPolicy) return;

  const previousTick = RS.tick.bind(RS); // Used to preserve every existing ResourceSystem tick behavior before enforcing the combat Health rule.
  const ACTIVE_COMBAT_STATES = new Set(['attack', 'attacking', 'chase', 'chasing', 'aggro', 'patrol-chase', 'flee', 'fleeing', 'fleeing-low-health']); // Used to keep engaged AI in combat even after the short last-hit quiet timer expires.
  let blockedTickCount = 0; // Used by mobile-readable diagnostics to confirm the guard is actively catching combat ticks.
  let lastBlockedTick = null; // Used by mobile-readable diagnostics to expose the most recent suppressed recovery.

  function isHostileEntity(entity) {
    if (!entity || entity.isCompanion) return false;
    const hostileObjects = window.Combat?.deps?.hostileObjects; // Used as the runtime source of truth for current enemies, including bandits and hostile animals.
    if (hostileObjects?.has?.(entity)) return true;
    return entity.def?.hostile === true || entity.hostile === true;
  }

  function explicitCombatReason(entity) {
    const state = String(entity?.state || '').trim().toLowerCase(); // Used to recognize long-lived AI engagement states such as Gurumahi's current "chasing" state.
    if (ACTIVE_COMBAT_STATES.has(state)) return `state:${state}`;
    if (window.Combat?.telegraph?.isBusy?.(entity)) return 'enemy-telegraph';
    if (window.Combat?.animalAttacks?.isBusy?.(entity)) return 'animal-attack';
    if (entity?._banditAction || entity?._rangedAction || entity?._banditLunging) return 'enemy-action';
    return null;
  }

  function combatReason(entity) {
    if (!entity || !(Number(entity.health) > 0)) return null;
    const explicitReason = explicitCombatReason(entity); // Used before the quiet timer so active pursuit cannot become "rested" during a long attack lull.
    if (explicitReason) return explicitReason;
    const cfg = RS.config(); // Used with ResourceSystem's existing quietSeconds value instead of inventing a second recent-combat timeout.
    const rest = RS.getRestInfo(entity, cfg); // Used to catch players, companions, and creatures that recently attacked or received damage even without an AI state.
    return rest?.rested === false ? 'resource-quiet-window' : null;
  }

  function combatActive(entity) {
    return !!combatReason(entity);
  }

  function entityLabel(entity) {
    return entity?.def?.label || entity?.name || entity?.id || 'combatant';
  }

  function entityKind(entity) {
    if (entity === window.Combat?.deps?.player) return 'player';
    if (entity?.isCompanion) return 'companion';
    if (isHostileEntity(entity)) return 'hostile';
    return 'creature';
  }

  RS.tick = function combatHealthRecoveryTick(entity, dt, options = {}) {
    const reason = combatReason(entity); // Used to apply one shared automatic-Health lock to every actor that is actually in combat.
    if (!reason) return previousTick(entity, dt, options);

    const healthBefore = Number(entity.health) || 0; // Used by diagnostics to verify automatic current Health never rises during a guarded tick.
    const congealedBefore = Number(RS.getAffliction?.(entity, 'congealedHealth')) || 0; // Used by diagnostics to prove the affliction can still recover while its current-Health restoration is blocked.
    const bleedingBefore = Number(RS.getAffliction?.(entity, 'bleedingHealth')) || 0; // Used by diagnostics to confirm rested Bleeding is treated as combat damage rather than healing.
    const guardedOptions = { ...options, healthRecoveryBlocked: true, healthRegenPerSec: 0 }; // Used to disable every ResourceSystem automatic current-Health gain while preserving non-Health maintenance.
    const result = previousTick(entity, dt, guardedOptions); // Used to preserve damage-over-time, Stamina, Footing, exhaustion, and affliction recovery.
    const healthAfter = Number(entity.health) || 0; // Used by diagnostics to expose the final Health after the guarded resource tick.
    const congealedAfter = Number(RS.getAffliction?.(entity, 'congealedHealth')) || 0; // Used to report how much Congealed buildup recovered without restoring current Health.
    const bleedingAfter = Number(RS.getAffliction?.(entity, 'bleedingHealth')) || 0; // Used to report how much Bleeding resolved as combat damage.

    blockedTickCount += 1;
    lastBlockedTick = {
      label: entityLabel(entity),
      kind: entityKind(entity),
      reason,
      healthBefore,
      healthAfter,
      congealedRecovered: Math.max(0, congealedBefore - congealedAfter),
      bleedingResolved: Math.max(0, bleedingBefore - bleedingAfter),
      dt: Number(dt) || 0,
    };
    return result;
  };

  RS.__combatHealthRecoveryInstalled = true;
  RS.__enemyCombatHealthRecoveryInstalled = true;

  const policy = Object.freeze({ // Used as both the new shared API and the legacy EnemyCombatHealthRecoveryPolicy alias.
    version: 2,
    activeCombatStates: Object.freeze([...ACTIVE_COMBAT_STATES]),
    isHostileEntity,
    explicitCombatReason,
    combatReason,
    combatActive,
    getDebug() {
      return {
        installed: true,
        blockedTickCount,
        lastBlockedTick,
      };
    },
  });

  window.CombatHealthRecoveryPolicy = policy;
  window.EnemyCombatHealthRecoveryPolicy = policy;
  window.__combatHealthRecoveryDebug = () => policy.getDebug();
  window.__enemyCombatHealthRecoveryDebug = window.__combatHealthRecoveryDebug;
})();
