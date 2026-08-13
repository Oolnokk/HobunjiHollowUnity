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
  const FOOTING_FULL_RECOVERY_S = 5; // Used to derive the normal recovery rate from each entity's maximum Footing.
  const nowMs = () => performance.now();

  function recoveryDelayRemaining(entity) {
    const lastDamageAt = Number(entity?.lastFootingDamageAt);
    if (!Number.isFinite(lastDamageAt)) return 0;
    const elapsedS = Math.max(0, (nowMs() - lastDamageAt) / 1000);
    return Math.max(0, FOOTING_RECOVERY_DELAY_S - elapsedS);
  }

  function defaultFootingRegenPerSec(entity) {
    const maxFooting = Math.max(0, Number(entity?.maxFooting) || 0); // Used here so the normal empty-to-full recovery duration stays five seconds at any maximum.
    return maxFooting / FOOTING_FULL_RECOVERY_S;
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
    const delayActive = recoveryDelayRemaining(entity) > 0; // Used below to preserve the no-regen grace period after the latest Footing loss.
    const explicitRate = Number(options.footingRegenPerSec); // Used below so an explicitly supplied encounter-specific rate can still override the normal five-second rate.
    const footingRegenPerSec = delayActive
      ? 0
      : (Number.isFinite(explicitRate) ? Math.max(0, explicitRate) : defaultFootingRegenPerSec(entity)); // Passed through ResourceSystem.tick's existing rate override.
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
      };
    },
  });
})();
