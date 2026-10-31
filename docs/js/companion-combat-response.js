// Companion combat responsiveness — target prioritization, commitment and rescue arbitration.
// This module is pure except for per-companion diagnostics and remembered targets.
// Keep the decisions out of game.js's render/movement loop so they can be tested independently.
(() => {
  'use strict';
  const SWITCH_RATIO = 0.76; // A challenger must be at least 24% more urgent before breaking target commitment.
  const MASTER_WEIGHT = 0.65; // Protecting the master matters more than the pet's personal convenience.
  const ACTIVE_THREAT_MULTIPLIER = 0.67; // Enemies currently attacking the owner outrank passive enemies nearby.
  const APPROACH_RESTART_RATIO = 1.05; // Leave backup early once the target has escaped beyond ordinary reach.

  function validEnemy(enemy, areaId) {
    return !!enemy && Number(enemy.health) > 0 && !enemy._downed &&
      !enemy._deathTransitionStarted && !enemy._denHidden && enemy.def?.hostile !== false &&
      (!areaId || enemy.areaId === areaId); // Match game.js's original area check: unknown-zone enemies cannot be targeted through transitions.
  }

  function score(companion, master, enemy) {
    const distanceToMaster = Math.hypot(enemy.x - master.x, enemy.y - master.y); // Protects the owner's immediate neighborhood.
    const distanceToCompanion = Math.hypot(enemy.x - companion.x, enemy.y - companion.y); // Avoids running past enemies already in attack reach.
    const targetingOwner = enemy.targetPlayer === master || enemy.targetCreature === master ||
      enemy._banditTarget === master; // Prioritizes observed, actively aggressive hostiles.
    const targetingPet = enemy.targetCreature === companion || enemy.targetPlayer === companion; // React to direct attacks even away from owner.
    return (distanceToMaster * MASTER_WEIGHT + distanceToCompanion * (1 - MASTER_WEIGHT)) *
      (targetingPet ? 0.32 : targetingOwner ? ACTIVE_THREAT_MULTIPLIER : 1);
  }

  function chooseTarget(companion, master, enemies, areaId, alertPx) {
    const radius = Number(alertPx) > 0 ? Number(alertPx) : 0; // Masters' alert radius keeps pets from chasing faraway enemies.
    let chosen = null, chosenScore = Infinity, currentSeen = false; // Keep a stable target without creating a new array of hostile objects every frame.
    const current = companion._companionCombatTarget; // Current committed enemy is retained unless it becomes invalid or an urgent threat supersedes it.
    for (const enemy of enemies || []) {
      if (enemy === current) currentSeen = true;
      if (!validEnemy(enemy, areaId)) continue;
      const ownerDistance = Math.hypot(enemy.x - master.x, enemy.y - master.y); // Owner alert range normally anchors companion fights.
      const petDistance = Math.hypot(enemy.x - companion.x, enemy.y - companion.y); // A pet must still defend itself from nearby attacks outside that range.
      const attackingPet = enemy.targetCreature === companion || enemy.targetPlayer === companion;
      if (ownerDistance > radius && !(attackingPet && petDistance <= radius * 0.5)) continue;
      const priority = score(companion, master, enemy);
      if (priority < chosenScore) { chosenScore = priority; chosen = enemy; }
    }
    const currentEligible = currentSeen && validEnemy(current, areaId) &&
      (Math.hypot(current.x - master.x, current.y - master.y) <= radius ||
        ((current.targetCreature === companion || current.targetPlayer === companion)
         && Math.hypot(current.x - companion.x, current.y - companion.y) <= radius * 0.5));
    const currentScore = currentEligible ? score(companion, master, current) : Infinity; // Compare against an established target without stale-entry bias.
    const chosenThreatensOwner = chosen && (chosen.targetPlayer === master || chosen.targetCreature === master || chosen._banditTarget === master);
    const currentThreatensOwner = current && (current.targetPlayer === master || current.targetCreature === master || current._banditTarget === master);
    const chosenThreatensPet = chosen && (chosen.targetCreature === companion || chosen.targetPlayer === companion);
    const currentThreatensPet = current && (current.targetCreature === companion || current.targetPlayer === companion);
    const urgentSwitch = ((chosenThreatensOwner && !currentThreatensOwner) ||
      (chosenThreatensPet && !currentThreatensPet)) && chosenScore < currentScore; // Directly threatened allies beat the normal anti-thrashing margin.
    if (currentEligible && !urgentSwitch && (current === chosen || currentScore * SWITCH_RATIO <= chosenScore)) {
      chosen = current;
    }
    if (chosen !== current) {
      if (chosen && companion._stage?.mode === 'backingUp') {
        companion._stage.mode = 'active'; companion._stage.t = 0; // A new immediate threat cancels the old target's retreat beat without bypassing attack cooldowns.
      }
      window.__farmLog?.('[companion-response] ' + (companion.id || companion.creatureKey || 'pet') +
        ' target ' + (chosen?.id || chosen?.creatureKey || 'none'), 'combat');
    }
    companion._companionCombatTarget = chosen; // Mobile debug and future AI decisions read the committed target.
    companion._companionCombatPriority = chosen ? score(companion, master, chosen) : null; // Diagnostic of why a target was selected.
    return chosen;
  }

  function shouldRestartApproach(stage, targetDistance, attackReach, urgent = false) {
    return stage?.mode === 'backingUp' && (urgent ||
      Number(targetDistance) > Math.max(0, Number(attackReach) || 0) * APPROACH_RESTART_RATIO);
  }

  function debugSnapshot(companion) {
    return { target: companion?._companionCombatTarget?.id || companion?._companionCombatTarget?.creatureKey || null,
      priority: companion?._companionCombatPriority ?? null,
      rescuing: companion?._honeyfuzzleRescueTarget?.id || null,
      backingUp: companion?._stage?.mode === 'backingUp',
      cooldown: companion?.attackCooldownT ?? null };
  }

  window.CompanionCombatResponse = Object.freeze({ chooseTarget, validEnemy, shouldRestartApproach,
    debugSnapshot, tuning: Object.freeze({ SWITCH_RATIO, MASTER_WEIGHT, ACTIVE_THREAT_MULTIPLIER, APPROACH_RESTART_RATIO }) });
})();
