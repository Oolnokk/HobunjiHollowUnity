// Companion combat responsiveness — target prioritization, commitment and rescue arbitration.
// This module is pure except for per-companion diagnostics and remembered targets.
// Keep the decisions out of game.js's render/movement loop so they can be tested independently.
(() => {
  'use strict';
  const SWITCH_RATIO = 0.76; // A challenger must be at least 24% more urgent before breaking target commitment.
  const MASTER_WEIGHT = 0.65; // Protecting the master matters more than the pet's personal convenience.
  const ACTIVE_THREAT_MULTIPLIER = 0.67; // Enemies currently attacking the owner outrank passive enemies nearby.
  const APPROACH_RESTART_RATIO = 1.05; // Leave backup early once the target has escaped beyond ordinary reach.
  const DESCENT_ESCAPE_GRACE_MS = 2000; // After landing, keep following the fleeing owner long enough to leave nearby enemies behind.

  function validFocus(enemy, areaId) {
    return !!enemy && Number(enemy.health) > 0 && !enemy._downed && !enemy._deathTransitionStarted && !enemy._denHidden &&
      Number.isFinite(enemy.x) && Number.isFinite(enemy.y) && (!areaId || enemy.areaId == null || enemy.areaId === areaId); // Players may not carry an areaId; ordinary enemy selection below is stricter.
  }

  function validEnemy(enemy, areaId) {
    return validFocus(enemy, areaId) && enemy.def?.hostile !== false && (!areaId || enemy.areaId === areaId);
  }

  const attackSight = new WeakMap(); // Per-actor short geometry lease; full LOS is queried only at attack readiness, never during cooldown.
  const sightStats = { checks: 0, reuses: 0 }; // Mobile-readable operation counts.
  function canAttackThroughTerrain(companion, target) {
    if (!window.RangedWeapons?.hasLineOfSight) return true;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const cached = attackSight.get(companion);
    if (cached && cached.target === target && cached.area === companion.areaId && now < cached.until) {
      sightStats.reuses++; return cached.clear;
    }
    const clear = window.RangedWeapons.hasLineOfSight(companion, target, true);
    attackSight.set(companion, { target, area: companion.areaId, until: now + 100, clear });
    sightStats.checks++;
    return clear;
  }

  function syncEffectiveTarget(companion, target) {
    const previous = companion._companionEffectiveTarget || null; // Tracks the final focus, including explicit orders rather than just the ordinary scoring cache.
    if (previous === (target || null)) return;
    companion._companionEffectiveTarget = target || null;
    attackSight.delete(companion);
    companion._stage = null; // Never inherit a backup beat from a different opponent; leave actual attack cooldown intact.
    if (!companion._cliffClimb && !companion._cliffRouteTravel) {
      companion._travelPath = null; companion._travelPathTarget = null;
      companion._travelPathFailure = null; companion._travelStuckT = 0;
    }
    window.__farmLog?.('[companion-response] ' + (companion.id || companion.creatureKey || 'pet') + ' effective focus ' + (target?.id || target?.creatureKey || 'none'), 'combat');
  }

  function score(companion, master, enemy) {
    const distanceToMaster = Math.hypot(enemy.x - master.x, enemy.y - master.y); // Protects the owner's immediate neighborhood.
    const distanceToCompanion = Math.hypot(enemy.x - companion.x, enemy.y - companion.y); // Avoids running past enemies already in attack reach.
    const targetingOwner = enemy.targetPlayer === master || enemy.targetCreature === master ||
      enemy._banditTarget === master; // Prioritizes observed, actively aggressive hostiles.
    const targetingPet = enemy.targetCreature === companion || enemy.targetPlayer === companion; // React to direct attacks even away from owner.
    const marked = (window.ResourceSystem?.getAffliction?.(enemy, 'scentMarkedHealth') || 0) > 0; // Marked enemies are more attractive without overriding the existing leash or explicit Sicced orders.
    return (distanceToMaster * MASTER_WEIGHT + distanceToCompanion * (1 - MASTER_WEIGHT)) *
      (targetingPet ? 0.32 : targetingOwner ? ACTIVE_THREAT_MULTIPLIER : 1) * (marked ? 0.35 : 1);
  }

  // A follower stranded above its owner must descend before defending a cliff-top fight.
  // The shared terrain and tile size are read-only; no independent pathing or physics is created here.
  function shouldFollowOwnerDownCliff(companion, master, areaId) {
    const state = window.CompanionFollowNavigation?.descentState?.(companion, master, areaId);
    if (!state) return false;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(); // Same clock as the target-decision lease.
    if (state.inProgress) return true; // Do not restart combat during a cliff crossing.
    if (state.above) {
      companion._companionRetreatUntilMs = nowMs + DESCENT_ESCAPE_GRACE_MS; // Owner is still below.
      return true;
    }
    return companion._followOwnerDownCliff && state.sameTier &&
      nowMs < (companion._companionRetreatUntilMs || 0); // Post-landing flee grace before re-engaging.
  }

  const TARGET_DECISION_INTERVAL_MS = 140; // Full enemy prioritization runs at ~7Hz; a committed target still fights and moves each frame.
  function shouldReevaluate(companion, master, areaId, alertPx) {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(); // Time-based cadence independent of rendering speed.
    const followDown = shouldFollowOwnerDownCliff(companion, master, areaId); // Re-check terrain when the owner lands below a ledge.
    const descentChanged = followDown !== !!companion._followOwnerDownCliff; // Forces a response immediately on fall or reunion.
    companion._followOwnerDownCliff = followDown; // The mobile debug snapshot and chooser share this transient priority.
    if (descentChanged && followDown) {
      companion._travelPath = null; // Clear the old combat route only ONCE; repeated resets would starve stuck recovery/pathfinding.
      companion._travelPathTarget = null;
      companion._travelStuckT = 0;
    }
    if (descentChanged) companion._companionDecisionNextAt = 0;
    const target = companion._companionCombatTarget; // Live current target is validated without any roster scan.
    const radius = Math.max(0, Number(alertPx) || 0);
    const lostTarget = !!target && (!validEnemy(target, areaId) ||
      (Math.hypot(target.x - master.x, target.y - master.y) > radius &&
        !((target.targetCreature === companion || target.targetPlayer === companion) &&
          Math.hypot(target.x - companion.x, target.y - companion.y) <= radius * 0.5)));
    const changed = companion._companionDecisionMaster !== master ||
      companion._companionDecisionArea !== areaId || companion._companionDecisionRadius !== radius;
    if (!lostTarget && !changed && nowMs < (companion._companionDecisionNextAt || 0)) return false;
    companion._companionDecisionMaster = master;
    companion._companionDecisionArea = areaId;
    companion._companionDecisionRadius = radius;
    companion._companionDecisionNextAt = nowMs + TARGET_DECISION_INTERVAL_MS;
    return true;
  }

  function chooseTarget(companion, master, enemies, areaId, alertPx) {
    const followDown = shouldFollowOwnerDownCliff(companion, master, areaId); // Falling or jumping below your pet overrides local combat.
    companion._followOwnerDownCliff = followDown; // Prevent stale combat commitment from hiding a reachable lower landing.
    if (followDown) {
      if (companion._companionCombatTarget || companion._animalAttack || companion._stage) {
        window.Combat?.animalAttacks?.cancel?.(companion); // Stops named lunges before traversal takes movement ownership.
        companion._stage = null; // The ordinary telegraph/chase state must not reclaim a retreating follower.
        window.__farmLog?.('[companion-response] ' + (companion.id || companion.creatureKey || 'pet') +
          ' disengaged to follow owner below cliff', 'combat');
      }
      companion._companionCombatTarget = null;
      companion._companionCombatPriority = null;
      return null; // Preserve any route the follower calculated after entering escape mode.
    }
    const radius = Number(alertPx) > 0 ? Number(alertPx) : 0; // Masters' alert radius keeps pets from chasing faraway enemies.
    let chosen = null, chosenScore = Infinity, currentSeen = false; // Keep a stable target without creating a new array of hostile objects every frame.
    const current = companion._companionCombatTarget; // Current committed enemy is retained unless it becomes invalid or an urgent threat supersedes it.
    for (const enemy of enemies || []) {
      if (enemy === current) currentSeen = true;
      if (enemy === companion || enemy === master || !validEnemy(enemy, areaId)) continue;
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

  function isRescuing(companion, rescueHost) {
    if (companion?._followOwnerDownCliff || !rescueHost || !(rescueHost.health > 0)) return false;
    return !!window.Combat?.attach?.attachersOf?.(rescueHost)?.some(attacker =>
      window.Combat.attach.isAttached(attacker) && attacker.creatureKey === 'honeyfuzzle'); // A rescue never supersedes following an escaping owner.
  }

  function prioritizeOwnerRetreat(companion, target, dt, clearTreasureCue, clearWatchIdle) {
    if (!companion?._followOwnerDownCliff || companion.banditCompanion) return target;
    if (companion.treasureCue) clearTreasureCue?.(companion, dt, 'following owner below cliff');
    if (companion.watchPlayerIdle) clearWatchIdle?.(companion, 'following owner below cliff');
    return null; // Final arbiter runs AFTER Sicced, downed focus and committed-attack targeting.
  }

  function shouldRestartApproach(stage, targetDistance, attackReach, urgent = false) {
    return stage?.mode === 'backingUp' && (urgent ||
      Number(targetDistance) > Math.max(0, Number(attackReach) || 0) * APPROACH_RESTART_RATIO);
  }

  function debugSnapshot(companion) {
    return { target: companion?._companionCombatTarget?.id || companion?._companionCombatTarget?.creatureKey || null,
      effectiveTarget: companion?._companionEffectiveTarget?.id || companion?._companionEffectiveTarget?.creatureKey || null,
      scentMarked: !!companion?._companionEffectiveTarget && (window.ResourceSystem?.getAffliction?.(companion._companionEffectiveTarget, 'scentMarkedHealth') || 0) > 0, // Shows the actual order rather than just the proximity candidate.
      priority: companion?._companionCombatPriority ?? null,
      rescuing: companion?._honeyfuzzleRescueTarget?.id ||
        (companion?._honeyfuzzleRescueTarget === window.Combat?.deps?.player ? 'player' :
          companion?._honeyfuzzleRescueTarget?.creatureKey || companion?._honeyfuzzleRescueTarget?.name || null), // The player actor has no creature ID; show 'player' during an actual rescue.
      backingUp: companion?._stage?.mode === 'backingUp',
      groundFollow: companion?._companionGroundFollow || null, // Exposes the current ground/route destination to mobile Companion Combat diagnostics.
      stuckRecovery: companion?._companionStuckRecovery ? {
        stalledSeconds: Number(companion._companionStuckRecovery.stalled?.toFixed?.(1) || 0),
        retrySeconds: Number(companion._companionStuckRecovery.retry?.toFixed?.(1) || 0),
        cooldownSeconds: Number(companion._companionStuckRecovery.cooldown?.toFixed?.(1) || 0),
      } : null, // Mobile companion diagnostics show why a hidden follower has not teleported yet.
      recoverySummary: window.CompanionFollowNavigation?.debugSnapshot?.() || null, // Total unseen recoveries and latest refused reason.
      followingDownCliff: !!companion?._followOwnerDownCliff, // Explains immediate combat disengagement on mobile.
      escapeGraceRemainingMs: Math.max(0, (companion?._companionRetreatUntilMs || 0) -
        (typeof performance !== 'undefined' ? performance.now() : Date.now())), // Mobile-readable post-landing combat suppression.
      cooldown: companion?.attackCooldownT ?? null,
      attackSight: attackSight.get(companion)?.clear ?? null,
      sightChecks: sightStats.checks, sightReuses: sightStats.reuses };
  }

  window.CompanionCombatResponse = Object.freeze({ chooseTarget, shouldReevaluate, validEnemy, validFocus, syncEffectiveTarget, canAttackThroughTerrain, shouldRestartApproach,
    debugSnapshot, shouldFollowOwnerDownCliff, isRescuing, prioritizeOwnerRetreat,
    tuning: Object.freeze({ SWITCH_RATIO, MASTER_WEIGHT, ACTIVE_THREAT_MULTIPLIER, APPROACH_RESTART_RATIO }) });
})();
