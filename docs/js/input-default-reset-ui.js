// Adds separate Reset to Defaults controls beneath the keyboard and controller
// binding lists without coupling the Settings renderer to reset semantics.
(() => {
  'use strict';

  if (window.InputDefaultsResetUI?.installed) return;

  const TARGETS = Object.freeze([
    { device: 'desktop', containerId: 'desktopInputBindings', rowId: 'desktopInputResetDefaultsRow', label: 'Reset Keyboard to Defaults' },
    { device: 'controller', containerId: 'controllerInputBindings', rowId: 'controllerInputResetDefaultsRow', label: 'Reset Controller to Defaults' },
  ]); // Used by the observer and explicit refresh hook so both input sections get independent reset controls.

  let observer = null; // Watches Settings re-renders because InputSettingsPanel replaces each binding list's innerHTML after every edit.
  let refreshQueued = false; // Coalesces bursts of DOM mutations into one reset-button reinsertion pass.

  function resetDevice(device, status) {
    const reset = window.InputBindings?.resetDeviceToDefaults; // Uses the binding layer's device-isolated reset so UI code never reconstructs defaults itself.
    if (typeof reset !== 'function') {
      if (status) status.textContent = 'Reset is unavailable until input bindings finish loading.';
      return false;
    }
    const ok = reset(device); // Restores this device only, including only this device's authored mode shifts.
    if (!ok) {
      if (status) status.textContent = 'Could not reset controls.';
      return false;
    }
    window.InputSettingsPanel?.render?.();
    return true;
  }

  function appendResetControl(target) {
    const container = document.getElementById(target.containerId); // Anchors the button directly inside the corresponding keyboard/controller section.
    if (!container || document.getElementById(target.rowId)) return false;

    const row = document.createElement('div'); // Uses the same row class as Copy Controls JSON so alignment stays consistent with existing Settings styling.
    row.id = target.rowId;
    row.className = 'input-binding-row input-reset-defaults-row';

    const spacer = document.createElement('span'); // Preserves the existing two-column binding row alignment without introducing a stylesheet dependency.
    const button = document.createElement('button'); // Gives keyboard/controller their own independently actionable reset affordance.
    button.type = 'button';
    button.className = 'settings-small-btn';
    button.textContent = target.label;

    const status = document.createElement('div'); // Surfaces reset failures in-game/mobile instead of relying on the browser console.
    status.className = 'input-binding-warning';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    button.addEventListener('click', () => resetDevice(target.device, status));
    row.append(spacer, button, status);
    container.appendChild(row);
    return true;
  }

  function ensureControls() {
    refreshQueued = false;
    for (const target of TARGETS) appendResetControl(target);
  }

  function queueEnsureControls() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(ensureControls);
  }

  function boot() {
    ensureControls();
    if (observer || !document.body || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(queueEnsureControls); // Re-adds only the missing reset row after InputSettingsPanel clears/rebuilds either binding list.
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('hobunji-input-bindings-reset', queueEnsureControls);

  window.InputDefaultsResetUI = Object.freeze({
    installed: true,
    refresh: ensureControls,
    resetDevice,
    getDebug: () => ({
      desktopButtonPresent: Boolean(document.getElementById('desktopInputResetDefaultsRow')),
      controllerButtonPresent: Boolean(document.getElementById('controllerInputResetDefaultsRow')),
      observing: Boolean(observer),
    }),
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();