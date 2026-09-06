// Tight shoulder-camera framing while a ranged weapon is actually ready to fire.
(() => {
  'use strict';

  const VERSION = 2;
  const SHOULDER_MODE = 'shoulderSurf';
  const TIGHT_DISTANCE_TILES = 1.55; // Used to pull the active shoulder camera in while a ranged focus state is active.
  const DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES = 0.18; // Used as the ranged-focus-only shoulder offset until the player authors another value.
  const FOCUS_HORIZONTAL_MIN_TILES = -1; // Used by the ranged-focus Settings slider and input validation.
  const FOCUS_HORIZONTAL_MAX_TILES = 1; // Used by the ranged-focus Settings slider and input validation.
  const FOCUS_HORIZONTAL_STEP_TILES = 0.05; // Used by the ranged-focus Settings slider for the same granularity as the normal shoulder offset.
  const FOCUS_HORIZONTAL_STORAGE_KEY = 'hobunjiRangedFocusShoulderOffsetH'; // Used to persist only the ranged-focus shoulder preset between sessions.
  const FOCUS_EASE_PER_SEC = 9; // Used to ease both zoom and horizontal framing without a snap.
  const RESTORE_EPSILON = 0.002; // Used to stop tiny residual interpolation from keeping the camera in a modified state forever.

  let baseUpdate = null; // Used to preserve the ranged system's existing per-frame update before camera-focus work runs.
  let installed = false; // Used to avoid wrapping RangedWeapons.update more than once.
  let blend = 0; // Used to drive the current focus interpolation from 0 (normal) to 1 (tight).
  let baseDistanceTiles = null; // Used to restore the authored shoulder-camera distance after focus ends.
  let baseCombatHorizontal = null; // Used to restore the player's authored Combat horizontal shoulder offset after focus ends.
  let focusHorizontalOffsetTiles = loadFocusHorizontalOffset(); // Used as the independent ranged-focus shoulder target instead of overwriting the authored Combat preset.
  let horizontalModified = false; // Used to know whether the hidden Combat preset still needs restoration after leaving combat stance.
  let previousCombatStance = false; // Used to detect a fresh melee/ranged combat-stance entry.
  let combatCapturePending = false; // Used to wait one frame for game.js to sync the Combat slider before capturing its authored value.
  let ownSliderDispatch = false; // Used to distinguish this module's synthetic Combat-slider writes from a player's live Settings edit.
  let sliderListenerInstalled = false; // Used to attach the normal Combat Settings listener once even if this module loads before the slider exists.
  let focusControlInstalled = false; // Used to create/bind the ranged-focus-only Settings row exactly once.
  let lastFocusSignature = ''; // Used to keep the mobile-visible debug log transition-only instead of spamming every frame.
  let lastState = null; // Used by snapshot() for mobile/debug inspection without recomputing state mid-frame.

  function shoulderModeConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null;
  }

  function horizontalSlider() {
    return document.getElementById('settingShoulderSurfOffsetH');
  }

  function focusHorizontalSlider() {
    return document.getElementById('settingRangedFocusShoulderOffsetH');
  }

  function focusHorizontalValueLabel() {
    return document.getElementById('settingRangedFocusShoulderOffsetHValue');
  }

  function clampFocusHorizontal(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES;
    return Math.max(FOCUS_HORIZONTAL_MIN_TILES, Math.min(FOCUS_HORIZONTAL_MAX_TILES, number));
  }

  function loadFocusHorizontalOffset() {
    try {
      const saved = window.localStorage?.getItem?.(FOCUS_HORIZONTAL_STORAGE_KEY);
      if (saved == null || saved === '') return DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES;
      return clampFocusHorizontal(saved);
    } catch (_) {
      return DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES;
    }
  }

  function saveFocusHorizontalOffset() {
    try { window.localStorage?.setItem?.(FOCUS_HORIZONTAL_STORAGE_KEY, String(focusHorizontalOffsetTiles)); } catch (_) {}
  }

  function setFocusHorizontalOffset(value, persist = true) {
    focusHorizontalOffsetTiles = clampFocusHorizontal(value);
    if (persist) saveFocusHorizontalOffset();
    const slider = focusHorizontalSlider();
    const valueLabel = focusHorizontalValueLabel();
    if (slider) slider.value = String(focusHorizontalOffsetTiles);
    if (valueLabel) valueLabel.textContent = focusHorizontalOffsetTiles.toFixed(2);
    return focusHorizontalOffsetTiles;
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
    const next = baseCombatHorizontal + (focusHorizontalOffsetTiles - baseCombatHorizontal) * blend;
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
    window.__farmLog?.(`[ranged-camera] ${state.active ? 'focus ON' : 'focus off'}: ${state.reason}; ${state.itemKey || 'none'}; distance=${distanceText}; focusShoulder=${focusHorizontalOffsetTiles.toFixed(2)}; appliedHorizontal=${horizontalText}.`, 'combat');
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

  function bindFocusControl(slider) {
    if (!slider || slider.dataset?.hobunjiRangedFocusBound === '1') return !!slider;
    if (slider.dataset) slider.dataset.hobunjiRangedFocusBound = '1';
    slider.value = String(focusHorizontalOffsetTiles);
    slider.addEventListener('input', () => setFocusHorizontalOffset(slider.value, true));
    const valueLabel = focusHorizontalValueLabel();
    if (valueLabel) valueLabel.textContent = focusHorizontalOffsetTiles.toFixed(2);
    focusControlInstalled = true;
    return true;
  }

  function installFocusOffsetControl() {
    const existing = focusHorizontalSlider();
    if (existing) return bindFocusControl(existing);
    const combatSlider = horizontalSlider();
    const combatRow = combatSlider?.closest?.('.settings-row') || combatSlider?.parentElement?.parentElement || null;
    if (!combatRow || typeof document.createElement !== 'function') return false;

    const row = document.createElement('label');
    row.className = 'settings-row';
    row.dataset.rangedFocusShoulderSetting = '1';
    row.innerHTML = `
      <div class="settings-label">
        <div class="settings-name">Ranged Focus Shoulder Offset</div>
        <div class="settings-desc">Horizontal shoulder framing used only while a ranged weapon is loaded or being wound up</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="range" id="settingRangedFocusShoulderOffsetH" min="${FOCUS_HORIZONTAL_MIN_TILES}" max="${FOCUS_HORIZONTAL_MAX_TILES}" step="${FOCUS_HORIZONTAL_STEP_TILES}" value="${focusHorizontalOffsetTiles}" style="align-self:center">
        <span id="settingRangedFocusShoulderOffsetHValue" class="settings-slider-value">${focusHorizontalOffsetTiles.toFixed(2)}</span>
      </div>`;
    if (typeof combatRow.insertAdjacentElement === 'function') combatRow.insertAdjacentElement('afterend', row);
    else combatRow.parentElement?.insertBefore?.(row, combatRow.nextSibling || null);
    return bindFocusControl(focusHorizontalSlider());
  }

  function updateCameraFocus(dt) {
    installSliderListener();
    installFocusOffsetControl();
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
      focusHorizontalOffsetTiles,
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      horizontalModified,
      focusControlInstalled,
      aimAlignment: 'core-camera-ray-convergence',
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
    installFocusOffsetControl();
    if ((!sliderListenerInstalled || !focusControlInstalled) && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        installSliderListener();
        installFocusOffsetControl();
      }, { once: true });
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
    setFocusHorizontalOffset,
    snapshot: () => lastState ? { ...lastState } : { ...focusState(), blend, baseDistanceTiles, baseCombatHorizontal, focusHorizontalOffsetTiles, horizontalModified, focusControlInstalled, aimAlignment: 'core-camera-ray-convergence' },
    tuning: {
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      get focusHorizontalOffsetTiles() { return focusHorizontalOffsetTiles; },
      defaultFocusHorizontalOffsetTiles: DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES,
      easePerSecond: FOCUS_EASE_PER_SEC,
    },
  };
  window.__rangedCameraFocusDebug = window.HobunjiRangedCameraFocus;

  install();
})();
