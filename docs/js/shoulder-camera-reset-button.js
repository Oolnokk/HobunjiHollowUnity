// Player-facing Shoulder Cam reset button for Settings -> Camera.
(() => {
  'use strict';

  const VERSION = 1; // Exposed through the debug API so mobile reports can identify this reset behavior.
  const DEFAULT_OFFSET_H = 0.35; // Used when resetting the ordinary/default Shoulder Cam stance.
  const DEFAULT_OFFSET_V = -0.05; // Used when resetting the ordinary/default Shoulder Cam stance.
  const COMBAT_OFFSET_H = 0.60; // Used when resetting the combat Shoulder Cam stance.
  const COMBAT_OFFSET_V = -0.05; // Used when resetting the combat Shoulder Cam stance.
  const RESET_BUTTON_ID = 'resetShoulderCamBtn'; // Used to prevent duplicate Settings rows when the runtime bootstrap is reloaded.
  let lastReset = null; // Reported through snapshot() so mobile diagnostics can confirm what the most recent tap restored.

  function gameDebug() {
    return window.__hobunjiFurnitureDebug || null;
  }

  function activePreset() {
    return gameDebug()?.shoulderSurfCombatStance ? 'combat' : 'default';
  }

  function dispatchValue(input, value) {
    if (!input) return false;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function resetToDefaults() {
    const toggle = document.getElementById('settingShoulderSurf'); // Re-enabled below so the reset always lands in Shoulder Cam rather than silently editing an inactive preset.
    const horizontal = document.getElementById('settingShoulderSurfOffsetH'); // Existing game.js listener owns the real private stance value; dispatching its native input path avoids duplicating camera state.
    const vertical = document.getElementById('settingShoulderSurfOffsetV'); // Existing game.js listener owns the real private stance value; dispatching its native input path avoids duplicating camera state.
    if (!horizontal || !vertical) return false;

    if (toggle) {
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const preset = activePreset();
    const defaultH = preset === 'combat' ? COMBAT_OFFSET_H : DEFAULT_OFFSET_H;
    const defaultV = preset === 'combat' ? COMBAT_OFFSET_V : DEFAULT_OFFSET_V;
    dispatchValue(horizontal, defaultH);
    dispatchValue(vertical, defaultV);

    window.HobunjiShoulderCameraCharacterFraming?.refreshPlayerFraming?.(undefined, {}, 'settings-reset');

    lastReset = {
      at: Date.now(),
      preset,
      horizontal: defaultH,
      vertical: defaultV,
      shoulderCamEnabled: toggle ? !!toggle.checked : null,
    };
    window.__farmLog?.(`[shoulder-camera] reset ${preset} stance to H=${defaultH.toFixed(2)} V=${defaultV.toFixed(2)} and reapplied species framing.`, 'info', 'camera');
    return true;
  }

  function installButton() {
    if (document.getElementById(RESET_BUTTON_ID)) return true;
    const vertical = document.getElementById('settingShoulderSurfOffsetV'); // Used as the stable existing Camera-settings anchor for inserting the reset row directly after the two Shoulder Cam sliders.
    const anchorRow = vertical?.closest?.('.settings-row');
    if (!anchorRow?.parentNode) return false;

    const row = document.createElement('div'); // Added once to the existing Settings list; uses the same row/button classes as the game's other reset controls.
    row.className = 'settings-row';
    row.innerHTML = '<div class="settings-label"><div class="settings-name">Shoulder Cam Defaults</div><div class="settings-desc">Re-enables Shoulder Cam, recenters it, restores the currently active Default/Combat shoulder offsets, and reapplies species-relative neck/height framing.</div></div><button type="button" class="settings-small-btn" id="resetShoulderCamBtn">Set to Default</button>';
    anchorRow.parentNode.insertBefore(row, anchorRow.nextSibling);
    row.querySelector(`#${RESET_BUTTON_ID}`)?.addEventListener('click', resetToDefaults);
    return true;
  }

  function snapshot() {
    return {
      version: VERSION,
      installed: !!document.getElementById(RESET_BUTTON_ID),
      activePreset: activePreset(),
      lastReset: lastReset ? { ...lastReset } : null,
    };
  }

  window.HobunjiShoulderCameraReset = Object.freeze({
    version: VERSION,
    installButton,
    resetToDefaults,
    snapshot,
  });
  window.__shoulderCameraResetDebug = window.HobunjiShoulderCameraReset;

  let attempts = 0; // Bounds the temporary DOM-ready retry so the head-loaded runtime cannot poll forever if Settings markup is absent in a tool page.
  let timer = null; // Holds the temporary retry interval until the existing Shoulder Cam Settings controls have been parsed.
  timer = setInterval(() => {
    if (installButton() || ++attempts >= 200) clearInterval(timer);
  }, 50);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installButton, { once: true });
  else installButton();
})();
