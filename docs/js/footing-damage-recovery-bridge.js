// Footing damage scaling, zero-Footing break context, and post-hit recovery grace period.
//
// Every gameplay source already drains balance through ResourceSystem.spendFooting.
// This bridge keeps that choke point authoritative: requested Footing damage is
// doubled once here, any successful loss restarts a short no-regen window, and
// crossing to zero emits one shared break event that presentation code can use
// without duplicating Footing rules in each attack implementation.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  if (!RS?.spendFooting || !RS?.tick || RS.__footingDamageRecoveryBridgeInstalled) return;
  RS.__footingDamageRecoveryBridgeInstalled = true;

  const FOOTING_DAMAGE_MULTIPLIER = 2;
  const FOOTING_RECOVERY_DELAY_S = 1.5;
  const FOOTING_FULL_RECOVERY_S = 3; // Used to derive the baseline recovery rate from each entity's maximum Footing.
  const MOTION_EPSILON = 0.01;
  const nowMs = () => performance.now();

  function recoveryDelayRemaining(entity) {
    const lastDamageAt = Number(entity?.lastFootingDamageAt);
    if (!Number.isFinite(lastDamageAt)) return 0;
    const elapsedS = Math.max(0, (nowMs() - lastDamageAt) / 1000);
    return Math.max(0, FOOTING_RECOVERY_DELAY_S - elapsedS);
  }

  function defaultFootingRegenPerSec(entity) {
    const maxFooting = Math.max(0, Number(entity?.maxFooting) || 0); // Used here so baseline empty-to-full recovery stays three seconds at any maximum.
    return maxFooting / FOOTING_FULL_RECOVERY_S;
  }

  function reasonInfo(reason) {
    if (reason && typeof reason === 'object') {
      const label = String(reason.label || reason.reason || reason.kind || reason.type || '').toLowerCase();
      return {
        label,
        strike: reason.strike === true || /hit|attack|strike|melee|weapon|projectile|shot|pounce|charge/.test(label),
        fromX: Number.isFinite(Number(reason.fromX ?? reason.sourceX)) ? Number(reason.fromX ?? reason.sourceX) : null,
        fromY: Number.isFinite(Number(reason.fromY ?? reason.sourceY)) ? Number(reason.fromY ?? reason.sourceY) : null,
      };
    }
    const label = String(reason || '').toLowerCase();
    return {
      label,
      strike: /hit|attack|strike|melee|weapon|projectile|shot|pounce|charge/.test(label),
      fromX: null,
      fromY: null,
    };
  }

  function normalizedVector(x, y) {
    const nx = Number(x) || 0;
    const ny = Number(y) || 0;
    const length = Math.hypot(nx, ny);
    return length > MOTION_EPSILON ? { x: nx / length, y: ny / length } : null;
  }

  function facingVector(entity) {
    const facing = Number(entity?.facing);
    if (Number.isFinite(facing)) return { x: Math.cos(facing), y: Math.sin(facing) };
    return { x: 1, y: 0 };
  }

  function resolveBreakMotion(entity, reason) {
    const info = reasonInfo(reason);
    if (info.strike) {
      if (info.fromX !== null && info.fromY !== null && Number.isFinite(Number(entity?.x)) && Number.isFinite(Number(entity?.y))) {
        const away = normalizedVector(Number(entity.x) - info.fromX, Number(entity.y) - info.fromY);
        if (away) return { ...away, cause: 'strike-source' };
      }
      // damagePlayer/damageCreature assign knockback before they spend Footing,
      // so this is the exact outgoing direction of the strike that broke it.
      const knockback = normalizedVector(entity?.knockbackVX, entity?.knockbackVY);
      if (knockback) return { ...knockback, cause: 'strike-knockback' };
    }

    // Non-strike Footing breaks fall along current travel rather than pretending
    // a force came from an arbitrary side.
    const movement = normalizedVector(entity?.vx, entity?.vy);
    if (movement) return { ...movement, cause: 'movement' };
    return { ...facingVector(entity), cause: 'facing' };
  }

  function emitFootingBreak(entity, reason) {
    const motion = resolveBreakMotion(entity, reason);
    const detail = {
      entity,
      reason: reasonInfo(reason).label || 'footing',
      fallX: motion.x,
      fallY: motion.y,
      cause: motion.cause,
      at: nowMs(),
    };
    entity.lastFootingBreak = detail;
    window.dispatchEvent(new CustomEvent('hobunji-footing-break', { detail }));

    // Some older callers only used the zero return value as a signal and set
    // prone immediately after spendFooting returns. Give them the current call
    // stack first; if a new/non-strike source forgets that caller-side step,
    // zero Footing still means the same shared prone state everywhere.
    queueMicrotask(() => {
      if (entity && Number(entity.footing) <= 0 && entity.health > 0 && !entity.prone) entity.prone = true;
    });
  }

  const previousSpendFooting = RS.spendFooting.bind(RS);
  RS.spendFooting = function doubledFootingDamage(entity, amount, reason = 'hit') {
    // Prone already makes an entity immune to Footing loss. Keep that rule
    // explicit at the delay-owning choke point too so hits received while
    // prone can never create or refresh lastFootingDamageAt.
    if (entity?.prone) return 0;
    const before = Number(entity?.footing);
    const requested = Math.max(0, Number(amount) || 0) * FOOTING_DAMAGE_MULTIPLIER;
    const spent = previousSpendFooting(entity, requested, reason);
    if (spent > 0) entity.lastFootingDamageAt = nowMs();
    if (spent > 0 && before > 0 && Number(entity?.footing) <= 0) emitFootingBreak(entity, reason);
    return spent;
  };

  const previousTick = RS.tick.bind(RS);
  RS.tick = function delayedFootingRecoveryTick(entity, dt, options = {}) {
    const delayActive = recoveryDelayRemaining(entity) > 0; // Used below to preserve the no-regen grace period after the latest standing Footing loss.
    const explicitRate = Number(options.footingRegenPerSec); // Used below so an explicitly supplied encounter-specific rate can still override the baseline three-second rate.
    const footingRegenPerSec = delayActive
      ? 0
      : (Number.isFinite(explicitRate) ? Math.max(0, explicitRate) : defaultFootingRegenPerSec(entity)); // Passed through ResourceSystem.tick's existing rate override; its pre-existing rested multiplier remains unchanged.
    return previousTick(entity, dt, {
      ...options,
      footingRegenPerSec,
    });
  };

  window.HobunjiFootingDamageRecovery = Object.freeze({
    damageMultiplier: FOOTING_DAMAGE_MULTIPLIER,
    recoveryDelaySeconds: FOOTING_RECOVERY_DELAY_S,
    fullRecoverySeconds: FOOTING_FULL_RECOVERY_S,
    recoveryDelayRemaining,
    defaultFootingRegenPerSec,
    resolveBreakMotion,
    getDebug(entity = window.Combat?.deps?.player) {
      return {
        damageMultiplier: FOOTING_DAMAGE_MULTIPLIER,
        recoveryDelaySeconds: FOOTING_RECOVERY_DELAY_S,
        fullRecoverySeconds: FOOTING_FULL_RECOVERY_S,
        defaultFootingRegenPerSec: defaultFootingRegenPerSec(entity),
        recoveryDelayRemaining: recoveryDelayRemaining(entity),
        lastFootingDamageAt: Number.isFinite(Number(entity?.lastFootingDamageAt))
          ? Number(entity.lastFootingDamageAt)
          : null,
        lastFootingBreak: entity?.lastFootingBreak || null,
      };
    },
  });
})();
