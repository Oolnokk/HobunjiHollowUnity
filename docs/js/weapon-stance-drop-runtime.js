// Lowers the player's whole rendered body while a weapon stance or attack is engaged, so stances read less rigid.
//
// The portrait, hands, held weapon and every other composer-owned visual sink by a fraction of the avatar's
// total height (proceduralFeet.stanceDrop.heightFraction). The feet stay on the ground: the leg handle drops its
// hips by the same amount and folds the knees at full bone length (ProceduralLegAnimation setStanceDrop), and the
// body channel is flagged `plantedLegs` so the composer moves the leg group back up. The leg handle owns the easing
// and the gating (seated, mounted, airborne...) and reports the drop it really applied; this channel lowers by exactly that.
(function (global) {
  'use strict';

  const CHANNEL = 'weapon-stance-drop';
  let lastDrop = 0;
  let lastReason = 'waiting';
  let lastComposer = null;
  let lastPlayerMesh = null;

  function settings() {
    const c = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.stanceDrop || {};
    const fraction = Number(c.heightFraction);
    return { enabled: c.enabled !== false, fraction: Number.isFinite(fraction) ? Math.max(0, Math.min(0.25, fraction)) : 0.06 };
  }

  function sync() {
    const composer = global.PlayerBodyTransformComposer;
    const legs = composer?.getPlayerLegHandle?.();
    const stances = global.WeaponToolStances;
    if (!composer?.setChannel || !legs?.setStanceDrop || !stances?.stanceEngaged) { lastReason = 'waiting-for-runtime'; return; }

    const playerMesh = composer.getPlayerMesh?.() || null;
    const composerChanged = composer !== lastComposer || playerMesh !== lastPlayerMesh;
    lastComposer = composer;
    lastPlayerMesh = playerMesh;

    const { enabled, fraction } = settings();
    const ownsBody = global.ImpactRagdollPlayback?.isActive?.() || global.PlayerCrawl?.isActive?.(); // Ragdoll / crawl write their own leg and body pose.
    if (ownsBody) {
      legs.setStanceDrop(0, true);
      lastReason = 'body-pose-owned';
    } else {
      const wanted = enabled && stances.stanceEngaged() ? fraction * (legs.modelHeight || 0) : 0;
      legs.setStanceDrop(wanted);
      lastReason = wanted > 0 ? 'weapon-stance' : 'no-stance';
    }

    const applied = ownsBody ? 0 : legs.getStanceDrop();
    if (applied > 1e-5) {
      if (composerChanged || applied !== lastDrop) composer.setChannel(CHANNEL, {
        priority: 4,
        mode: 'additive',
        plantedLegs: true,
        translation: { x: 0, y: -applied, z: 0 },
      });
    } else if (lastDrop > 0 || composerChanged) {
      composer.clearChannel(CHANNEL);
    }
    lastDrop = applied > 1e-5 ? applied : 0;
  }

  global.WeaponStanceDropRuntime = {
    channel: CHANNEL,
    getDebug: () => ({ drop: lastDrop, reason: lastReason, settings: settings() }),
  };

  global.RuntimeFrameScheduler.register('weapon-stance-drop-sync', sync, {
    phase: 'pre-render',
    owner: 'WeaponStanceDropRuntime',
    description: 'Lowers the player body for weapon stances and asks the legs to fold the knees to match.',
  });
})(window);
