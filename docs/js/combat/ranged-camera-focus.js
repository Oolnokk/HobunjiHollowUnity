// Tight shoulder-camera framing while a ranged weapon is actually ready to fire.
(() => {
  'use strict';

  const VERSION = 1;
  const SHOULDER_MODE = 'shoulderSurf';
  const TIGHT_DISTANCE_TILES = 1.55; // Used to pull the active shoulder camera in while a ranged focus state is active.
  const TIGHT_HORIZONTAL_OFFSET_TILES = 0.18; // Used to bring the shoulder framing closer to the player's head while focused.
  const FOCUS_EASE_PER_SEC = 9; // Used to ease both zoom and horizontal framing without a snap.
  const RESTORE_EPSILON = 0.002; // Used to stop tiny residual interpolation from keeping the camera in a modified state forever.

  let baseUpdate = null; // Used to preserve the ranged system's existing per-frame update before camera-focus work runs.
  let installed = false; // Used to avoid wrapping RangedWeapons.update more than once.
  let blend = 0; // Used to drive the current focus interpolation from 0 (normal) to 1 (tight).
  let baseDistanceTiles = null; // Used to restore the authored shoulder-camera distance after focus ends.
  let baseCombatHorizontal = null; // Used to restore the player's authored Combat horizontal shoulder offset after focus ends.
  let horizontalModified = false; // Used to know whether the hidden Combat preset still needs restoration after leaving combat stance.
  let previousCombatStance = false; // Used to detect a fresh melee/ranged combat-stance entry.
  let combatCapturePending = false; // Used to wait one frame for game.js to sync the Combat slider before capturing its authored value.
  let ownSliderDispatch = false; // Used to distinguish this module's synthetic slider writes from a player's live Settings edit.
  let sliderListenerInstalled = false; // Used to attach the Settings listener once even if this module loads before the slider exists.
  let lastFocusSignature = ''; // Used to keep the mobile-visible debug log transition-only instead of spamming every frame.
  let lastState = null; // Used by snapshot() for mobile/debug inspection without recomputing state mid-frame.

  function shoulderModeConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null;
  }

  function horizontalSlider() {
    return document.getElementById('settingShoulderSurfOffsetH');
  }

  function combatDeps() {
    return window.Combat?.deps || null;
  }

  function heldState() {
    const deps = combatDeps();
    const heldMode = deps?.getHeldMode?.();
    const activeTool = deps?.getActiveTool?.();
    return {
      heldMode,
      activeTool,
      combatStance: heldMode === 'tool' && (activeTool === 'weapon' || activeTool === 'ranged'),
      rangedOut: heldMode === 'tool' && activeTool === 'ranged',
    };
  }

  function thrownCharge(itemKey) {
    const snapshot = window.HobunjiRangedWeaponArchetypes?.debugSnapshot?.();
    return snapshot?.thrownCharge?.itemKey === itemKey ? snapshot.thrownCharge : null;
  }

  function focusState() {
    const ranged = window.RangedWeapons;
    const held = heldState();
    const itemKey = ranged?.equippedRangedKey?.() || null;
    const def = itemKey ? ranged?.config?.[itemKey] : null;
    const rangedType = def?.rangedType || 'load-fire';
    const charging = rangedType === 'thrown' && !!thrownCharge(itemKey);
    const loaded = rangedType !== 'thrown' && !!itemKey && ranged?.isLoaded?.(itemKey) === true;
    const active = held.rangedOut && !!itemKey && (charging || loaded);
    return {
      active,
      reason: !held.rangedOut ? 'ranged-not-out' : !itemKey ? 'no-ranged-item' : charging ? 'thrown-windup' : loaded ? 'loaded' : 'not-ready',
      itemKey,
      rangedType,
      charging,
      loaded,
      ...held,
    };
  }

  function easeToward(current, target, dt) {
    const seconds = Math.max(0, Math.min(0.1, Number(dt) || 0));
    const amount = 1 - Math.exp(-FOCUS_EASE_PER_SEC * seconds);
    return current + (target - current) * amount;
  }

  function dispatchHorizontal(value) {
    const slider = horizontalSlider();
    if (!slider || !Number.isFinite(value)) return false;
    ownSliderDispatch = true;
    try {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      ownSliderDispatch = false;
    }
    return true;
  }

  function captureCombatHorizontalAfterGameSync(state) {
    if (!state.combatStance) {
      combatCapturePending = false;
      return;
    }
    if (!previousCombatStance) {
      combatCapturePending = true;
      // If a prior focused session ended by putting combat away, game.js's
      // Combat preset can still be carrying our temporary value. Restore it
      // immediately on the next non-focused combat entry before it can become
      // visible as the new stance target.
      if (horizontalModified && !state.active && baseCombatHorizontal != null) {
        dispatchHorizontal(baseCombatHorizontal);
        horizontalModified = false;
      }
      return;
    }
    if (!combatCapturePending || baseCombatHorizontal != null || horizontalModified) return;
    const sliderValue = Number(horizontalSlider()?.value);
    if (Number.isFinite(sliderValue)) {
      baseCombatHorizontal = sliderValue;
      combatCapturePending = false;
    }
  }

  function applyDistance() {
    const mode = shoulderModeConfig();
    if (!mode) return null;
    if (baseDistanceTiles == null) {
      const authored = Number(mode.distanceTiles);
      if (Number.isFinite(authored) && authored > 0) baseDistanceTiles = authored;
    }
    if (baseDistanceTiles == null) return null;
    const next = baseDistanceTiles + (TIGHT_DISTANCE_TILES - baseDistanceTiles) * blend;
    mode.distanceTiles = next;
    return next;
  }

  function applyHorizontal(state) {
    if (!state.combatStance || baseCombatHorizontal == null) return null;
    const next = baseCombatHorizontal + (TIGHT_HORIZONTAL_OFFSET_TILES - baseCombatHorizontal) * blend;
    if (Math.abs(next - baseCombatHorizontal) > RESTORE_EPSILON) {
      if (dispatchHorizontal(next)) horizontalModified = true;
    } else if (horizontalModified) {
      if (dispatchHorizontal(baseCombatHorizontal)) horizontalModified = false;
    }
    return next;
  }

  function logTransition(state, distanceTiles, horizontalOffset) {
    const signature = `${state.active ? 1 : 0}|${state.reason}|${state.itemKey || '-'}|${state.rangedType}`;
    if (signature === lastFocusSignature) return;
    lastFocusSignature = signature;
    const distanceText = Number.isFinite(distanceTiles) ? distanceTiles.toFixed(2) : 'n/a';
    const horizontalText = Number.isFinite(horizontalOffset) ? horizontalOffset.toFixed(2) : 'n/a';
    window.__farmLog?.(`[ranged-camera] ${state.active ? 'focus ON' : 'focus off'}: ${state.reason}; ${state.itemKey || 'none'}; distance=${distanceText}; horizontal=${horizontalText}.`, 'combat');
  }

  function installSliderListener() {
    if (sliderListenerInstalled) return true;
    const slider = horizontalSlider();
    if (!slider) return false;
    slider.addEventListener('input', () => {
      if (ownSliderDispatch) return;
      const state = focusState();
      if (!state.combatStance) return;
      const value = Number(slider.value);
      if (Number.isFinite(value)) {
        baseCombatHorizontal = value;
        horizontalModified = false;
      }
    });
    sliderListenerInstalled = true;
    return true;
  }

  function updateCameraFocus(dt) {
    installSliderListener();
    const state = focusState();
    captureCombatHorizontalAfterGameSync(state);
    blend = easeToward(blend, state.active ? 1 : 0, dt);
    if (!state.active && blend < RESTORE_EPSILON) blend = 0;

    const distanceTiles = applyDistance();
    const horizontalOffset = applyHorizontal(state);

    lastState = {
      ...state,
      blend,
      distanceTiles,
      baseDistanceTiles,
      horizontalOffset,
      baseCombatHorizontal,
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      tightHorizontalOffsetTiles: TIGHT_HORIZONTAL_OFFSET_TILES,
      horizontalModified,
    };
    logTransition(state, distanceTiles, horizontalOffset);
    previousCombatStance = state.combatStance;
  }

  function install() {
    const ranged = window.RangedWeapons;
    if (!ranged || typeof ranged.update !== 'function' || installed) return !!ranged;
    baseUpdate = ranged.update.bind(ranged);
    ranged.update = function rangedUpdateWithCameraFocus(dt) {
      const result = baseUpdate(dt);
      updateCameraFocus(dt);
      return result;
    };
    installed = true;
    installSliderListener();
    if (!sliderListenerInstalled && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', installSliderListener, { once: true });
    }
    return true;
  }

  function restoreAuthoredCamera() {
    blend = 0;
    const mode = shoulderModeConfig();
    if (mode && baseDistanceTiles != null) mode.distanceTiles = baseDistanceTiles;
    const state = focusState();
    if (state.combatStance && baseCombatHorizontal != null) dispatchHorizontal(baseCombatHorizontal);
    horizontalModified = false;
  }

  window.HobunjiRangedCameraFocus = {
    version: VERSION,
    install,
    updateCameraFocus,
    restoreAuthoredCamera,
    snapshot: () => lastState ? { ...lastState } : { ...focusState(), blend, baseDistanceTiles, baseCombatHorizontal, horizontalModified },
    tuning: Object.freeze({
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      tightHorizontalOffsetTiles: TIGHT_HORIZONTAL_OFFSET_TILES,
      easePerSecond: FOCUS_EASE_PER_SEC,
    }),
  };
  window.__rangedCameraFocusDebug = window.HobunjiRangedCameraFocus;

  install();
})();
