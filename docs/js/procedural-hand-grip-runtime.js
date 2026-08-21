// Bridges optional animation `gripMode` metadata into live weapon visual playback.
// Installs after WeaponToolStances has wrapped Combat.deps, so this adapter stays
// outermost and does not interfere with its Neutral/pose conversions.
(function (global) {
  'use strict';

  const gripModes = global.HobunjiHandGripModes;
  if (!gripModes) return;

  let installed = false;
  let generation = 0;

  function validMode(raw) {
    const key = String(raw || '');
    return gripModes.modes[key] ? key : null;
  }

  function beginTemporaryMode(rawMode, durationS) {
    const key = validMode(rawMode);
    const token = ++generation;
    if (!key) {
      gripModes.clearRuntimeMode();
      return token;
    }
    gripModes.setRuntimeMode(key);
    const duration = Math.max(0, Number(durationS) || 0);
    setTimeout(() => {
      if (generation === token) gripModes.clearRuntimeMode();
    }, duration * 1000 + 40);
    return token;
  }

  function beginHeldMode(rawMode) {
    ++generation;
    const key = validMode(rawMode);
    if (key) gripModes.setRuntimeMode(key);
    else gripModes.clearRuntimeMode();
  }

  function endHeldMode() {
    ++generation;
    gripModes.clearRuntimeMode();
  }

  function install() {
    if (installed) return true;
    const deps = global.Combat?.deps;
    // Wait until WeaponToolStances has installed its own wrappers. This keeps
    // grip metadata additive and lets the existing combat pose system remain
    // authoritative for all tool motion.
    if (!deps?.__weaponToolStanceVisualHooks) return false;

    const swing = deps.triggerWeaponSwingVisual;
    if (typeof swing === 'function' && !swing.__hobunjiGripModeWrapped) {
      const wrappedSwing = function handGripModeSwing(durationS, opts = {}) {
        beginTemporaryMode(opts?.gripMode, durationS);
        return swing.call(this, durationS, opts);
      };
      wrappedSwing.__hobunjiGripModeWrapped = true;
      deps.triggerWeaponSwingVisual = wrappedSwing;
    }

    const hold = deps.triggerWeaponHoldVisual;
    if (typeof hold === 'function' && !hold.__hobunjiGripModeWrapped) {
      const wrappedHold = function handGripModeHold(durationS, opts = {}) {
        beginHeldMode(opts?.gripMode);
        return hold.call(this, durationS, opts);
      };
      wrappedHold.__hobunjiGripModeWrapped = true;
      deps.triggerWeaponHoldVisual = wrappedHold;
    }

    const release = deps.releaseWeaponSwingHold;
    if (typeof release === 'function' && !release.__hobunjiGripModeWrapped) {
      const wrappedRelease = function handGripModeRelease(...args) {
        endHeldMode();
        return release.apply(this, args);
      };
      wrappedRelease.__hobunjiGripModeWrapped = true;
      deps.releaseWeaponSwingHold = wrappedRelease;
    }

    const cancel = deps.cancelWeaponSwingHold;
    if (typeof cancel === 'function' && !cancel.__hobunjiGripModeWrapped) {
      const wrappedCancel = function handGripModeCancel(...args) {
        endHeldMode();
        return cancel.apply(this, args);
      };
      wrappedCancel.__hobunjiGripModeWrapped = true;
      deps.cancelWeaponSwingHold = wrappedCancel;
    }

    installed = true;
    return true;
  }

  function frame() {
    if (!install()) global.requestAnimationFrame(frame);
  }
  frame();

  global.ProceduralHandGripRuntime = {
    get installed() { return installed; },
    clear: endHeldMode,
  };
})(window);
