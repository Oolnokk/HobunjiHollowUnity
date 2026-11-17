// Character View mode (window.CharacterViewMode).
// Moved out of game.js. The utility-wheel "Character View" pins the player's
// logical facing, rendered body yaw and neck aim while the camera orbits
// freely around them. game.js keeps `characterViewMode` as an alias of
// `state` below (every reader there checks `characterViewMode.enabled` and
// the locked* fields) and calls init(deps) once during setup.
//
// Held weapons must honour the same pin: game.js's updateToolMesh skips the
// ready-ranged reticle tracking while `state.enabled` is true, otherwise the
// weapon orbits with the camera and leaves the pinned body/hands behind.
(() => {
  'use strict';

  const state = {
    enabled: false,
    lockedFacingAngle: -Math.PI / 2, // Re-seeded from game.js's facingAngle in init().
    lockedPlayerAngle: -Math.PI / 2,
    lockedPlayerFacing: 0,
    lockedNeckX: 0,
    lockedNeckY: 0,
    lastChangeReason: 'boot',
    changedAtMs: 0,
  };

  // { getFacingAngle(), getPlayerAngle(), getPlayerFacing(), getNeckJoint(),
  //   requestPointerLock(), releasePointerLock(), cursorlessMouseAimRequested(), showToast(msg, ok, silent) }
  let deps = null;

  function publishStatus() {
    window.HOBUNJI_CHARACTER_VIEW_STATUS = {
      enabled: state.enabled,
      lastChangeReason: state.lastChangeReason,
      changedAtMs: state.changedAtMs,
      facingAngleDeg: state.lockedFacingAngle * 180 / Math.PI,
      bodyYawDeg: state.lockedPlayerFacing * 180 / Math.PI,
      neckYawDeg: state.lockedNeckY * 180 / Math.PI,
    }; // Mobile Pixel Probe reads this copy without reaching into game.js's private closure.
  }

  function set(enabled, reason = 'utility-wheel') {
    const nextEnabled = Boolean(enabled);
    if (!deps || nextEnabled === state.enabled) return;
    if (nextEnabled) {
      const neck = deps.getNeckJoint();
      state.lockedFacingAngle = deps.getFacingAngle();
      state.lockedPlayerAngle = deps.getPlayerAngle();
      state.lockedPlayerFacing = deps.getPlayerFacing();
      state.lockedNeckX = neck?.rotation?.x || 0;
      state.lockedNeckY = neck?.rotation?.y || 0;
    }
    state.enabled = nextEnabled;
    if (nextEnabled) {
      deps.requestPointerLock();
    } else if (!deps.cursorlessMouseAimRequested()) {
      deps.releasePointerLock();
    }
    state.lastChangeReason = reason;
    state.changedAtMs = Date.now();
    publishStatus();
    deps.showToast(nextEnabled ? 'Character View: On' : (reason === 'movement' ? 'Character View: Off — movement' : 'Character View: Off'), true, false);
  }

  function init(nextDeps) {
    deps = nextDeps || null;
    const facing = deps?.getFacingAngle?.();
    if (Number.isFinite(facing)) {
      state.lockedFacingAngle = facing;
      state.lockedPlayerAngle = facing;
    }
    publishStatus();
  }

  window.CharacterViewMode = {
    state,
    init,
    set,
    isEnabled: () => state.enabled,
    publishStatus,
  };
})();
