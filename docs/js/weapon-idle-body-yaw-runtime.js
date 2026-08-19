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

  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function resolveIdleYaw(snapshot) {
    if (!snapshot || snapshot.activeSlot !== 'weapon') return { active: false, yawDeg: 0, reason: 'not-weapon-slot' };
    if (snapshot.combatNeutralInjected) return { active: false, yawDeg: 0, reason: 'attack-owns-body-yaw' };

    const idleClass = snapshot.weaponIdleClass;
    const pose = idleClass === 'light'
      ? snapshot.poses?.lightWeapon
      : idleClass === 'heavy'
        ? snapshot.poses?.heavyWeapon
        : null;
    if (!pose) return { active: false, yawDeg: 0, reason: 'no-idle-pose' };

    return {
      active: true,
      yawDeg: finite(pose.bodyYaw),
      reason: `${idleClass}-weapon-idle`,
    };
  }

  function sync() {
    const composer = global.PlayerBodyTransformComposer;
    const stances = global.WeaponToolStances;
    if (!composer?.setChannel || !composer?.clearChannel || !stances?.debugSnapshot) {
      lastReason = 'waiting-for-runtime';
      global.requestAnimationFrame(sync);
      return;
    }

    const resolved = resolveIdleYaw(stances.debugSnapshot());
    if (resolved.active && Math.abs(resolved.yawDeg) > 1e-6) {
      composer.setChannel(CHANNEL, {
        priority: 5,
        mode: 'additive',
        rotation: { pitch: 0, yaw: resolved.yawDeg * DEG_TO_RAD, roll: 0 },
      });
      lastYawDeg = resolved.yawDeg;
    } else {
      composer.clearChannel(CHANNEL);
      lastYawDeg = null;
    }
    lastReason = resolved.reason;
    global.requestAnimationFrame(sync);
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

  global.requestAnimationFrame(sync);
})(window);
