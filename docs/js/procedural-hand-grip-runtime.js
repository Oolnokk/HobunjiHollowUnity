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

  function visualStillActive() {
    return global.WeaponToolStances?.debugSnapshot?.()?.combatNeutralInjected === true;
  }

  function clearWhenVisualEnds(token, notBeforeMs = 0) {
    const check = () => {
      if (generation !== token) return;
      if (performance.now() < notBeforeMs || visualStillActive()) {
        global.requestAnimationFrame(check);
        return;
      }
      gripModes.clearRuntimeMode();
    };
    global.requestAnimationFrame(check);
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
    // durationS does not always include a wrapper-authored hold/return tail. Keep
    // the mode at least through the requested duration, then wait for the stance
    // visual itself to report completion before restoring the normal tool default.
    clearWhenVisualEnds(token, performance.now() + duration * 1000);
    return token;
  }

  function beginHeldMode(rawMode) {
    ++generation;
    const key = validMode(rawMode);
    if (key) gripModes.setRuntimeMode(key);
    else gripModes.clearRuntimeMode();
  }

  function releaseHeldModeAfterVisual() {
    const token = ++generation;
    // Do not clear here. releaseWeaponSwingHold() advances the existing held
    // windup into its strike/return, and the same authored grip must survive that
    // continuation. The next visual completion restores the ordinary grip mode.
    clearWhenVisualEnds(token);
  }

  function cancelHeldMode() {
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
        const result = release.apply(this, args);
        releaseHeldModeAfterVisual();
        return result;
      };
      wrappedRelease.__hobunjiGripModeWrapped = true;
      deps.releaseWeaponSwingHold = wrappedRelease;
    }

    const cancel = deps.cancelWeaponSwingHold;
    if (typeof cancel === 'function' && !cancel.__hobunjiGripModeWrapped) {
      const wrappedCancel = function handGripModeCancel(...args) {
        cancelHeldMode();
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
    clear: cancelHeldMode,
  };
})(window);