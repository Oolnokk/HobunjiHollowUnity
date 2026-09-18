// Applies the authored Heavy/Light idle-stance body yaw in gameplay.
//
// WeaponToolStances already applies idle x/y/z/pitch/yaw/roll to toolHolder and
// injects the full pose (including bodyYaw) into attacks. Its resting holder hook,
// however, cannot rotate playerMesh, so the idle bodyYaw field was never consumed.
// The Attack Editor does rotate the whole rig for that field, which made the same
// Light Weapon stance look different between editor and game.
(function (global) {
  'use strict';

  const CHANNEL = 'weapon-idle-stance-body-yaw';
  const DEG_TO_RAD = Math.PI / 180;
  let lastYawDeg = null;
  let lastReason = 'waiting';
  let lastComposer = null; // Used to restore the channel after a player-rig/composer rebuild even when the authored yaw value is unchanged.
  let lastPlayerMesh = null; // Used with lastComposer to recognize clearAllChannels during player replacement.
  const idleState = { active: false, yawDeg: 0, reason: 'waiting' }; // Refilled every frame by WeaponToolStances without allocating the full debug snapshot and four cloned poses.

  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function sync() {
    const composer = global.PlayerBodyTransformComposer;
    const stances = global.WeaponToolStances;
    if (!composer?.setChannel || !composer?.clearChannel || !stances?.idleBodyYawSnapshot) {
      lastReason = 'waiting-for-runtime';
      return;
    }

    const resolved = stances.idleBodyYawSnapshot(idleState);
    const playerMesh = composer.getPlayerMesh?.() || null;
    const composerChanged = composer !== lastComposer || playerMesh !== lastPlayerMesh;
    const resolvedYawDeg = finite(resolved.yawDeg);
    if (resolved.active && Math.abs(resolvedYawDeg) > 1e-6) {
      if (composerChanged || lastYawDeg !== resolvedYawDeg) composer.setChannel(CHANNEL, {
        priority: 5,
        mode: 'additive',
        rotation: { pitch: 0, yaw: resolvedYawDeg * DEG_TO_RAD, roll: 0 },
      });
      lastYawDeg = resolvedYawDeg;
    } else {
      if (lastYawDeg != null || composerChanged) composer.clearChannel(CHANNEL);
      lastYawDeg = null;
    }
    lastComposer = composer;
    lastPlayerMesh = playerMesh;
    lastReason = resolved.reason;
  }

  global.WeaponIdleBodyYawRuntime = {
    channel: CHANNEL,
    getDebug() {
      return {
        active: lastYawDeg != null,
        yawDeg: lastYawDeg,
        reason: lastReason,
      };
    },
  };

  global.RuntimeFrameScheduler.register('weapon-idle-body-yaw-sync', sync, {
    phase: 'pre-render',
    owner: 'WeaponIdleBodyYawRuntime',
    description: 'Applies the authored idle-stance body yaw into the player body transform composer.',
  });
})(window);
