// Shared enemy target selection for player-owned ground companions.
// Enemy movement, perception, attack timing and damage remain in their existing owners.
(() => {
  'use strict';

  const RETAIN_RATIO = 0.76; // Beastmaster pets retain a current opponent until another is substantially closer.

  function viable(target, areaId) {
    return !!target && Number(target.health) > 0 && !target._downed &&
      !target._deathTransitionStarted && !target._denHidden &&
      Number.isFinite(target.x) && Number.isFinite(target.y) &&
      (!target.areaId || target.areaId === areaId);
  }

  function groundPet(target, areaId, players = null) {
    return viable(target, areaId) && target.isCompanion === true &&
      target.banditCompanion !== true && target.stableRole === 'companion' &&
      (!players || !target.master || players.includes(target.master)); // Match CompanionDowned ownership: NPC hounds are not player-owned pets.
  }

  function chooseAggroTarget(enemy, players, companions, areaId, radiusPx, canSee) {
    if (!enemy || !(radiusPx > 0)) return null;
    const radiusSq = radiusPx * radiusPx; // Reused for cheap proximity checks before line-of-sight work.
    let occluded = null; // Allocated only if the nearest opponent fails the shared sight/attack-cone test.
    for (;;) {
      let closest = null; // Nearest remaining viable opponent, checked against sight once.
      let closestDistanceSq = radiusSq; // Never run costly LOS against distant players or pets.
      function consider(candidate) {
        if (!viable(candidate, areaId) || candidate === enemy || occluded?.has(candidate)) return;
        const dx = candidate.x - enemy.x, dy = candidate.y - enemy.y; // Compared as squared distance without square-root churn.
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq <= closestDistanceSq && (!closest || distanceSq < closestDistanceSq)) {
          closest = candidate; closestDistanceSq = distanceSq;
        }
      }
      for (const person of players || []) consider(person);
      for (const companion of companions || []) if (groundPet(companion, areaId, players)) consider(companion);
      if (!closest) return null;
      if (!canSee || canSee(enemy, closest, radiusPx)) return closest;
      (occluded ||= new Set()).add(closest); // A blocked nearer pet must not conceal a visible player farther back.
    }
  }

  function shouldRetaliateToPetHit(enemy, attacker, players, areaId) {
    if (!groundPet(attacker, areaId, players) || !viable(enemy, areaId) ||
        enemy.def?.hostile === false || enemy.banditCompanion ||
        enemy._chunkCombatTarget || enemy._scentTarget ||
        enemy.state !== 'chase' || enemy.targetPlayer === attacker) return false;
    const radius = Math.max(0, Number(enemy.def?.aggroRangePx) || 0); // Uses existing normal sight/aggro reach, not unlimited awareness.
    const leash = Math.max(0, Number(enemy.def?.leashRangePx) || 0); // A pet cannot lure its pursuer beyond the existing home boundary.
    return radius > 0 && leash > 0 &&
      Math.hypot(attacker.x - enemy.x, attacker.y - enemy.y) <= radius &&
      Math.hypot(enemy.x - enemy.homeX, enemy.y - enemy.homeY) <= leash;
  }

  const beastmasterLeases = new WeakMap(); // Each pet owns a short target-decision lease; per-frame attack and movement remain live.
  function chooseBeastmasterTargetCached(enemyPet, master, players, companions, areaId, alertRangePx) {
    if (!enemyPet?.banditCompanion || !master || !(alertRangePx > 0)) return null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const lease = beastmasterLeases.get(enemyPet);
    const incumbent = enemyPet._beastmasterCombatTarget;
    const incumbentPresent = !incumbent || players?.includes?.(incumbent) || ((companions?.has?.(incumbent) || companions?.includes?.(incumbent)) && groundPet(incumbent, areaId, players));
    if (lease && lease.master === master && lease.area === areaId && lease.radius === alertRangePx && now < lease.until && incumbentPresent && (!incumbent || (viable(incumbent, areaId) && Math.hypot(incumbent.x - master.x, incumbent.y - master.y) <= alertRangePx))) return incumbent || null;
    beastmasterLeases.set(enemyPet, { master, area: areaId, radius: alertRangePx, until: now + 140 });
    return chooseBeastmasterTarget(enemyPet, master, players, companions, areaId, alertRangePx);
  }

  function chooseBeastmasterTarget(enemyPet, master, players, companions, areaId, alertRangePx) {
    if (!enemyPet?.banditCompanion || !master || !(alertRangePx > 0)) return null;
    let best = null; // Nearest player-side combatant inside the Beastmaster's alert circle.
    let bestDistanceSq = Infinity; // Compared with the incumbent to prevent mid-attack target thrashing.
    const alertDistanceSq = alertRangePx * alertRangePx; // Master-centered alert range stays unchanged.
    function consider(candidate) {
      if (!viable(candidate, areaId) || candidate === enemyPet) return;
      const mdx = candidate.x - master.x, mdy = candidate.y - master.y; // Keeps the existing owner-centered alert rule.
      if (mdx * mdx + mdy * mdy > alertDistanceSq) return;
      const dx = candidate.x - enemyPet.x, dy = candidate.y - enemyPet.y; // Uses the attacking pet's proximity.
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) { best = candidate; bestDistanceSq = distanceSq; }
    }
    for (const person of players || []) consider(person);
    for (const companion of companions || []) if (groundPet(companion, areaId, players)) consider(companion);
    const current = enemyPet._beastmasterCombatTarget; // Stores committed target on the instance, not shared creature definitions.
    const activeCompanion = companions?.has?.(current) || companions?.includes?.(current); // A saved target may have been despawned when the player switched pets.
    if (current && current !== best && viable(current, areaId) &&
        (players?.includes?.(current) || (activeCompanion && groundPet(current, areaId, players)))) {
      const mdx = current.x - master.x, mdy = current.y - master.y;
      const dx = current.x - enemyPet.x, dy = current.y - enemyPet.y;
      const currentSq = dx * dx + dy * dy;
      if (mdx * mdx + mdy * mdy <= alertDistanceSq &&
          currentSq * RETAIN_RATIO * RETAIN_RATIO <= bestDistanceSq) best = current;
    }
    if (best !== current) window.__farmLog?.('[enemy-pet-target] ' +
      (enemyPet.id || enemyPet.creatureKey || 'beastmaster pet') + ' -> ' +
      (best?.id || best?.creatureKey || (best ? 'player' : 'none')), 'combat');
    enemyPet._beastmasterCombatTarget = best; // Exposed for mobile diagnostics and preserved across attack frames.
    return best;
  }

  window.EnemyPetTargeting = Object.freeze({
    viable, groundPet, chooseAggroTarget, shouldRetaliateToPetHit, chooseBeastmasterTarget, chooseBeastmasterTargetCached,
    snapshot: enemy => ({
      target: enemy?.targetPlayer?.id || enemy?.targetPlayer?.creatureKey || null,
      targetIsPet: !!enemy?.targetPlayer?.isCompanion && !enemy?.targetPlayer?.banditCompanion,
      beastmasterTarget: enemy?._beastmasterCombatTarget?.id || enemy?._beastmasterCombatTarget?.creatureKey || null,
    }),
  });
})();
