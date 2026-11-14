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

  function groundPet(target, areaId) {
    return viable(target, areaId) && target.isCompanion === true &&
      target.banditCompanion !== true && target.stableRole === 'companion';
  }

  function chooseAggroTarget(enemy, players, companions, areaId, radiusPx, canSee) {
    if (!enemy || !(radiusPx > 0)) return null;
    let best = null; // Nearest visible eligible opponent for one new aggro acquisition.
    let bestDistanceSq = radiusPx * radiusPx; // Squared range avoids sqrt for rejected candidates.
    function consider(candidate) {
      if (!viable(candidate, areaId) || candidate === enemy) return;
      const dx = candidate.x - enemy.x, dy = candidate.y - enemy.y; // Used for squared proximity comparison.
      const distanceSq = dx * dx + dy * dy; // Checked before any expensive line-of-sight probe.
      if (distanceSq > bestDistanceSq || (best && distanceSq === bestDistanceSq)) return;
      if (canSee && !canSee(enemy, candidate, radiusPx)) return;
      best = candidate; bestDistanceSq = distanceSq;
    }
    for (const person of players || []) consider(person);
    for (const companion of companions || []) if (groundPet(companion, areaId)) consider(companion);
    return best;
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
    for (const companion of companions || []) if (groundPet(companion, areaId)) consider(companion);
    const current = enemyPet._beastmasterCombatTarget; // Stores committed target on the instance, not shared creature definitions.
    if (current && current !== best && viable(current, areaId) &&
        (players?.includes?.(current) || groundPet(current, areaId))) {
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
    viable, groundPet, chooseAggroTarget, chooseBeastmasterTarget,
    snapshot: enemy => ({
      target: enemy?.targetPlayer?.id || enemy?.targetPlayer?.creatureKey || null,
      targetIsPet: !!enemy?.targetPlayer?.isCompanion && !enemy?.targetPlayer?.banditCompanion,
      beastmasterTarget: enemy?._beastmasterCombatTarget?.id || enemy?._beastmasterCombatTarget?.creatureKey || null,
    }),
  });
})();
