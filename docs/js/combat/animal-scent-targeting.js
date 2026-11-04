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
    if (creature.targetCreature === focus || creature.targetPlayer === focus) {
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
    }
    creature._scentTarget = null;
    creature._scentPreviousTarget = null;
    stats.wildReleases++;
  }

  function prioritizeWild(creature, players, companions, areaId, canSee) {
    if (!creature || creature.isCompanion || creature.isBandit || creature.maskboundTroop) return null;
    const previousFocus = creature._scentTarget;
    if (previousFocus && (!(scent(previousFocus) > 0) ||
        !viable(creature, previousFocus, areaId, creature.def?.aggroRangePx || 0, creature.def?.leashRangePx || 0))) {
      releaseWild(creature);
    }
    if (creature.state === 'fleeing-low-health' || creature.state === 'return' || creature._animalSleeping ||
        creature._denHidden || creature.prone || creature.knockbackT > 0) return null;
    // Passive wildlife is allowed to finish an existing defensive/prey fight, not start attacking peaceful bystanders.
    const engaged = creature.state === 'chase' || creature.state === 'patrol-chase' || creature.state === 'searching';
    if (creature.def?.hostile === false && !engaged) return null;
    const radius = Math.max(0, Number(creature.def?.aggroRangePx) || 0);
    const leash = Math.max(0, Number(creature.def?.leashRangePx) || 0);
    if (!radius || !leash || Math.hypot(creature.x - creature.homeX, creature.y - creature.homeY) > leash) return null;
    const opposingCompanions = [...(companions || [])].filter(p => p.isCompanion && !p.banditCompanion); // Enemy-owned pets are allies, never scent targets.
    const opponents = [...(players || []), ...opposingCompanions];
    if (creature.targetCreature && !opponents.includes(creature.targetCreature)) opponents.push(creature.targetCreature); // Preserve ecological skirmish opponents, never recruit arbitrary neighboring wildlife.
    const marked = previousFocus && scent(previousFocus) > 0 &&
      viable(creature, previousFocus, areaId, radius, leash) && (!canSee || canSee(previousFocus))
      ? previousFocus : nearestScented(creature, opponents, areaId, radius, leash, canSee);
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
    stats.wildChoices++;
    stats.last = { kind: 'wild', actor: creature.id || creature.creatureKey, target: marked.id || marked.creatureKey || 'player' };
    return marked;
  }

  function prioritizeEnemyCompanion(creature, master, player, companions, areaId, alertRange, fallback) {
    if (!creature?.banditCompanion || !master || !(alertRange > 0)) return fallback;
    const candidates = [player, ...(companions || [])].filter(target => target && target !== creature &&
      (target === player || target.isCompanion && !target.banditCompanion) &&
      Math.hypot(target.x - master.x, target.y - master.y) <= alertRange);
    const selected = nearestScented(creature, candidates, areaId, alertRange, null);
    if (!selected) return fallback;
    stats.hostilePetChoices++;
    stats.last = { kind: 'enemyCompanion', actor: creature.id || creature.creatureKey, target: selected.id || selected.creatureKey || 'player' };
    return selected;
  }

  window.AnimalScentTargeting = Object.freeze({
    scent, prioritizeWild, prioritizeEnemyCompanion, releaseWild,
    getDebug: () => ({ ...stats }),
  });
})();
