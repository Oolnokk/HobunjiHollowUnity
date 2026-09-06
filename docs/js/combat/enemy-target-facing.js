(() => {
  'use strict';

  // BanditCombat owns the actual melee AI. This adapter only caps how quickly
  // its humanoid melee targets may rotate toward the player. The old path can
  // snap c.facing at attack start and otherwise eases by a fraction of the
  // remaining angle each frame, which makes a 180-degree turn catch up far too
  // quickly and leaves effectively no usable backstab window.
  const banditApi = window.BanditCombat; // Existing public BanditCombat API wrapped before game.js starts its hostile loop.
  if (!banditApi?.updateCombatAI || banditApi.__targetFacingDragInstalled) return;

  let turnRateRadS = 6; // Maximum melee target turn speed; attack-values.json bandit.targetTurnRateRadS overrides this.

  function angleDiff(target, current) {
    return Math.atan2(Math.sin(target - current), Math.cos(target - current));
  }

  function turnToward(current, desired, dt, rate = turnRateRadS) {
    const delta = angleDiff(desired, current); // Signed shortest angular distance remaining this frame.
    const maxStep = Math.max(0, Number(rate) || 0) * Math.max(0, Number(dt) || 0); // Fixed angular step makes turn duration proportional to angle.
    if (!(maxStep > 0) || Math.abs(delta) <= maxStep) return current + delta;
    return current + Math.sign(delta) * maxStep;
  }

  function applyConfig(config) {
    const configured = Number(config?.bandit?.targetTurnRateRadS); // Authored combat value used by the wrapper below.
    if (configured > 0) turnRateRadS = configured;
  }

  applyConfig(window.__attackValuesConfig);
  window.__attackValuesConfigPromise?.then(applyConfig).catch(() => {});
  window.addEventListener?.('hobunji-attack-values-loaded', event => applyConfig(event?.detail));

  const originalUpdateCombatAI = banditApi.updateCombatAI.bind(banditApi); // Underlying AI preserved so this module changes facing only.
  banditApi.updateCombatAI = function targetFacingDragCombatAI(entity, dt, targetPlayer, distToPlayer) {
    const before = Number(entity?.facing) || 0; // Facing at frame start, before BanditCombat gets a chance to snap/ease it.
    const result = originalUpdateCombatAI(entity, dt, targetPlayer, distToPlayer) || {};

    // Ranged weapons need exact projectile aim, and prone state is owned by the
    // later prone-exclusivity wrapper. The drag is specifically for melee
    // pursuit/attacks where circling behind the target must remain meaningful.
    if (!entity || entity.prone || entity._rangedMode || !targetPlayer) return result;
    const targetX = Number(targetPlayer.x);
    const targetY = Number(targetPlayer.y);
    const entityX = Number(entity.x);
    const entityY = Number(entity.y);
    if (![targetX, targetY, entityX, entityY].every(Number.isFinite)) return result;

    const desired = Math.atan2(targetY - entityY, targetX - entityX); // True player bearing; only rotation toward it is rate-limited.
    const after = turnToward(before, desired, dt);
    const deltaBefore = angleDiff(desired, before); // Used by mobile/headless diagnostics to show how much turn was requested.
    const rawAfter = Number(entity.facing); // BanditCombat's unbounded result retained only for diagnostics.

    entity.facing = after;
    // BanditCombat recomputes lunge travel direction from c.facing internally.
    // If this frame started or advanced a lunge, overwrite those cached axes too
    // so movement and hit-facing obey the exact same capped rotation.
    if (Number.isFinite(entity._banditLungeDirX) || Number.isFinite(entity._banditLungeDirY)) {
      entity._banditLungeDirX = Math.cos(after);
      entity._banditLungeDirY = Math.sin(after);
    }

    entity._targetFacingDebug = {
      before,
      desired,
      rawAfter: Number.isFinite(rawAfter) ? rawAfter : null,
      after,
      requestedTurnRad: deltaBefore,
      appliedTurnRad: angleDiff(after, before),
      turnRateRadS,
      dt: Number(dt) || 0,
      rangedBypass: false,
    };

    // BanditCombat's aimAngle is the facing handed back to the hostile loop.
    // Returning the capped value prevents that caller from immediately
    // re-applying the snap we just removed from the entity state.
    result.aimAngle = after;
    return result;
  };

  function debugSnapshot(entity = null) {
    const candidates = entity
      ? [entity]
      : Array.from(window.Combat?.deps?.hostileObjects || []).filter(candidate => candidate?.isBandit); // Live humanoid hostiles exposed for mobile diagnostics.
    return candidates.map(candidate => ({
      id: candidate.id || null,
      name: candidate.name || null,
      rangedMode: !!candidate._rangedMode,
      facing: Number(candidate.facing) || 0,
      ...(candidate._targetFacingDebug || { turnRateRadS }),
    }));
  }

  Object.defineProperty(banditApi, '__targetFacingDragInstalled', { value: true, configurable: true });
  window.EnemyTargetFacing = {
    version: 1,
    turnToward,
    applyConfig,
    debugSnapshot,
    get turnRateRadS() { return turnRateRadS; },
  };

  window.__farmLog?.('[enemy-target-facing] melee target turn drag installed', 'combat');
})();
