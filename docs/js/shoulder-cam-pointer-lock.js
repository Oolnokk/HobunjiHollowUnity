// Shoulder Cam / Character View Pointer Lock (window.ShoulderCamPointerLock).
// Moved out of game.js. Shoulder Cam's mouse-look wants genuine FPS-style
// relative look — the OS cursor itself must never move (a free-roaming cursor
// runs out of screen/desk space and pins at the display edge, capping how far
// you can turn) — so it Pointer-Locks the canvas instead of just reading
// movementX/Y off a visible cursor. Locked or not, game.js's mousemove handler
// always reads movementX/Y the same way; locking only stops the OS cursor from
// moving/being visible at all.
(() => {
  'use strict';

  let deps = null; // { threeContainer, isDesktop, isCharacterViewEnabled(), getActiveCameraMode(), shoulderSurfMode, isShoulderSurfEnabled() } from game.js init.

  function init(nextDeps) {
    deps = nextDeps || null;
  }

  // True while the active camera wants cursorless (locked) mouse aim.
  function cursorlessMouseAimRequested() {
    if (!deps) return false;
    return !!deps.isCharacterViewEnabled()
      || (!!deps.isShoulderSurfEnabled() && deps.getActiveCameraMode() === deps.shoulderSurfMode);
  }

  function isActive() {
    return !!deps?.threeContainer && document.pointerLockElement === deps.threeContainer;
  }

  function request() {
    if (!cursorlessMouseAimRequested() || !deps.isDesktop || isActive()) return;
    // Can reject (no transient user activation, or the browser's own
    // rate-limit on repeated requests) — that's fine, game.js's click-to-relock
    // handler gives the player another chance.
    try { deps.threeContainer.requestPointerLock()?.catch?.(() => {}); } catch (err) {}
  }

  function release() {
    if (isActive()) { try { document.exitPointerLock(); } catch (err) {} }
  }

  window.ShoulderCamPointerLock = Object.freeze({
    init,
    cursorlessMouseAimRequested,
    isActive,
    request,
    release,
  });
})();
