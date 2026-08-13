// Footing damage scaling and post-hit recovery grace period.
//
// Every gameplay source already drains balance through ResourceSystem.spendFooting.
// This bridge keeps that choke point authoritative: requested Footing damage is
// doubled once here, and any successful loss restarts a short no-regen window.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  if (!RS?.spendFooting || !RS?.tick || RS.__footingDamageRecoveryBridgeInstalled) return;
  RS.__footingDamageRecoveryBridgeInstalled = true;

  const FOOTING_DAMAGE_MULTIPLIER = 2;
  const FOOTING_RECOVERY_DELAY_S = 1.5;
  const nowMs = () => performance.now();

  function recoveryDelayRemaining(entity) {
    const lastDamageAt = Number(entity?.lastFootingDamageAt);
    if (!Number.isFinite(lastDamageAt)) return 0;
    const elapsedS = Math.max(0, (nowMs() - lastDamageAt) / 1000);
    return Math.max(0, FOOTING_RECOVERY_DELAY_S - elapsedS);
  }

  const previousSpendFooting = RS.spendFooting.bind(RS);
  RS.spendFooting = function doubledFootingDamage(entity, amount, reason = 'hit') {
    const requested = Math.max(0, Number(amount) || 0) * FOOTING_DAMAGE_MULTIPLIER;
    const spent = previousSpendFooting(entity, requested, reason);
    if (spent > 0) entity.lastFootingDamageAt = nowMs();
    return spent;
  };

  const previousTick = RS.tick.bind(RS);
  RS.tick = function delayedFootingRecoveryTick(entity, dt, options = {}) {
    if (!(recoveryDelayRemaining(entity) > 0)) return previousTick(entity, dt, options);
    return previousTick(entity, dt, {
      ...options,
      footingRegenPerSec: 0,
    });
  };

  window.HobunjiFootingDamageRecovery = Object.freeze({
    damageMultiplier: FOOTING_DAMAGE_MULTIPLIER,
    recoveryDelaySeconds: FOOTING_RECOVERY_DELAY_S,
    recoveryDelayRemaining,
    getDebug(entity = window.Combat?.deps?.player) {
      return {
        damageMultiplier: FOOTING_DAMAGE_MULTIPLIER,
        recoveryDelaySeconds: FOOTING_RECOVERY_DELAY_S,
        recoveryDelayRemaining: recoveryDelayRemaining(entity),
        lastFootingDamageAt: Number.isFinite(Number(entity?.lastFootingDamageAt))
          ? Number(entity.lastFootingDamageAt)
          : null,
      };
    },
  });
})();
