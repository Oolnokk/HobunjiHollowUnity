// Scent-marked Health target pressure for wild animals and hostile animal companions.
// Pure selection helpers leave movement, attack costs, hitboxes and committed attacks in game.js.
(() => {
  'use strict';

  const SCENT_ID = 'scentMarkedHealth'; // Shared ResourceSystem key read for target selection and diagnostics.
  const stats = { wildChoices: 0, hostilePetChoices: 0, wildReleases: 0, last: null }; // Mobile-readable diagnostics for target pressure.

  function scent(entity) {
    return Math.max(0, Number(window.ResourceSystem?.getAffliction?.(entity, SCENT_ID)) || 0);
  }

  function viable(observer, target, areaId, maxDistance, homeDistance) {
    if (!target || target === observer || !(Number(target.health) > 0) || target._downed ||
        target._deathTransitionStarted || target._denHidden ||
        !Number.isFinite(target.x) || !Number.isFinite(target.y) ||
        (areaId != null && target.areaId != null && target.areaId !== areaId)) return false;
    if (Math.hypot(target.x - observer.x, target.y - observer.y) > maxDistance) return false;
    return homeDistance == null || Math.hypot(target.x - observer.homeX, target.y - observer.homeY) <= homeDistance;
  }

  function nearestScented(observer, candidates, areaId, radius, homeDistance, canSee) {
    let best = null, distance = Infinity; // Select nearest marked opponent, not the biggest artificial status stack.
    for (const candidate of candidates) {
      if (!(scent(candidate) > 0) || !viable(observer, candidate, areaId, radius, homeDistance) ||
          (canSee && !canSee(candidate))) continue;
      const d = Math.hypot(candidate.x - observer.x, candidate.y - observer.y);
      if (d < distance) { best = candidate; distance = d; }
    }
    return best;
  }

  function releaseWild(creature) {
    const focus = creature?._scentTarget;
    if (!focus) return;
    const previous = creature._scentPreviousTarget; // Original engagement is restored instead of fabricating a fresh enemy.
    if ((creature.state === 'chase' || creature.state === 'patrol-chase') &&
        (creature.targetCreature === focus || creature.targetPlayer === focus)) { // Never cancel an independently ordered retreat, recovery, or sleep.
      if (previous?.target && previous.target.health > 0 &&
          (previous.target.areaId == null || previous.target.areaId === creature.areaId)) {
        creature.state = previous.state;
        creature.targetPlayer = previous.state === 'chase' ? previous.target : null;
        creature.targetCreature = previous.state === 'patrol-chase' ? previous.target : null;
      } else {
        creature.state = 'idle';
        creature.targetPlayer = null;
        creature.targetCreature = null;
      }
    } else {
      if (creature.targetCreature === focus) creature.targetCreature = null; // Clear stale scent pursuit without overwriting higher-priority behavioral state.
      if (creature.targetPlayer === focus) creature.targetPlayer = null;
    }
    creature._scentTarget = null;
    creature._scentPreviousTarget = null;
    stats.wildReleases++;
  }

  function prioritizeWild(creature, players, companions, areaId, canSee, leashReenterFraction = 0.85) {
    if (!creature || creature.isCompanion || creature.isBandit || creature.maskboundTroop) return null;
    const previousFocus = creature._scentTarget;
    if (previousFocus && (!(scent(previousFocus) > 0) ||
        !viable(creature, previousFocus, areaId, creature.def?.aggroRangePx || 0, creature.def?.leashRangePx || 0))) {
      releaseWild(creature);
    }
    if (creature._fleeCooldownUntil > (window.performance?.now?.() ?? Date.now())) { // A marked opponent cannot bypass a wild animal's post-retreat grace period.
      releaseWild(creature);
      return null;
    }
    if (creature.state === 'herd-panic' || creature.state === 'fleeing-low-health' || creature.state === 'return' || creature._animalSleeping ||
        creature._denHidden || creature.prone || creature.knockbackT > 0) return null;
    // Passive wildlife is allowed to finish an existing defensive/prey fight, not start attacking peaceful bystanders.
    const engaged = creature.state === 'chase' || creature.state === 'patrol-chase' || creature.state === 'searching';
    if (creature.def?.hostile === false && !engaged) return null;
    const radius = Math.max(0, Number(creature.def?.aggroRangePx) || 0);
    const leash = Math.max(0, Number(creature.def?.leashRangePx) || 0);
    if (!radius || !leash || Math.hypot(creature.x - creature.homeX, creature.y - creature.homeY) > leash) return null;
    if (!engaged && Math.hypot(creature.x - creature.homeX, creature.y - creature.homeY) > leash * leashReenterFraction) return null; // Match existing wildlife leash-reentry hysteresis; scent cannot force new combat just inside the outer leash.
    // No roster copies or filters in the wild-animal hot path. Existing focus
    // only needs one cheap check; when none is marked there are no LOS calls.
    let marked = previousFocus && creature._scentTarget === previousFocus && scent(previousFocus) > 0 &&
      viable(creature, previousFocus, areaId, radius, leash) && (!canSee || canSee(previousFocus)) ? previousFocus : null;
    if (!marked) {
      let distanceSq = Infinity; // Only closer marked candidates need a geometry check.
      const consider = candidate => {
        if (!candidate || !(scent(candidate) > 0) || !viable(creature, candidate, areaId, radius, leash)) return;
        const dx = candidate.x - creature.x, dy = candidate.y - creature.y, d = dx * dx + dy * dy;
        if (d < distanceSq && (!canSee || canSee(candidate))) { distanceSq = d; marked = candidate; }
      };
      for (const person of players || []) consider(person);
      for (const pet of companions || []) if (pet.isCompanion && !pet.banditCompanion && (!pet.stableRole || pet.stableRole === 'companion')) consider(pet);
      if (creature.targetCreature && !creature.targetCreature.isCompanion) consider(creature.targetCreature);
    }
    if (!marked) { releaseWild(creature); return null; }
    if (window.Combat?.animalAttacks?.isBusy?.(creature) || window.Combat?.telegraph?.isBusy?.(creature)) return creature._scentTarget || null;
    if (!creature._scentTarget) {
      creature._scentPreviousTarget = {
        state: creature.state,
        target: creature.state === 'patrol-chase' ? creature.targetCreature : creature.state === 'chase' ? creature.targetPlayer : null,
      };
    }
    creature._scentTarget = marked;
    if ((players || []).includes(marked)) {
      creature.state = 'chase'; creature.targetPlayer = marked; creature.targetCreature = null;
    } else {
      creature.state = 'patrol-chase'; creature.targetCreature = marked; creature.targetPlayer = null;
    }
    if (previousFocus !== marked) {
      stats.wildChoices++;
      stats.last = { kind: 'wild', actor: creature.id || creature.creatureKey, target: marked.id || marked.creatureKey || 'player' };
    } // Count decisions/changes rather than allocate a diagnostic record every frame.
    return marked;
  }

  function prioritizeEnemyCompanion(creature, master, player, companions, areaId, alertRange, fallback) {
    if (!creature?.banditCompanion || !master || !(alertRange > 0)) return fallback;
    let selected = null, bestSq = Infinity; // Compare only marked, live opponents without copying the companion roster.
    const consider = target => {
      if (!target || !(scent(target) > 0) || !viable(creature, target, areaId, alertRange, null)) return;
      const mx = target.x - master.x, my = target.y - master.y;
      if (mx * mx + my * my > alertRange * alertRange) return;
      const dx = target.x - creature.x, dy = target.y - creature.y, d = dx * dx + dy * dy;
      if (d < bestSq) { selected = target; bestSq = d; }
    };
    consider(player);
    for (const pet of companions || []) if (pet.isCompanion && !pet.banditCompanion && (!pet.stableRole || pet.stableRole === 'companion') && (!pet.master || pet.master === player)) consider(pet);
    if (selected !== creature._hostileScentFocus) {
      creature._hostileScentFocus = selected;
      if (selected) {
        stats.hostilePetChoices++;
        stats.last = { kind: 'enemyCompanion', actor: creature.id || creature.creatureKey, target: selected.id || selected.creatureKey || 'player' };
      }
    }
    if (!selected) return fallback;
    return selected;
  }

  window.AnimalScentTargeting = Object.freeze({
    scent, prioritizeWild, prioritizeEnemyCompanion, releaseWild,
    getDebug: () => ({ ...stats }),
  });
})();
