// Player-adjustable tap-versus-hold timing, shared without flattening each action's authored base delay.
(() => {
  'use strict';
  if (window.InputHoldTiming) return;
  const STORAGE_KEY = 'hobunjiTapHoldExtraDelayMs.v1'; // Persists the player's preference independently of saves.
  const DEFAULT_EXTRA_MS = 30; // Slightly extends tap recognition for every participating control.
  const MIN_EXTRA_MS = -80; // Permits faster holds without removing the tap window.
  const MAX_EXTRA_MS = 200; // Caps slow holds so input stays responsive.
  const STEP_MS = 10; // Matches the Settings slider's increment.
  const MIN_THRESHOLD_MS = 80; // Lower safety limit for any adjusted authored action threshold.
  const desktopControls = window.SCRATCHBONES_CONFIG?.game?.desktopControls || null; // Feeds existing desktop selectors without touching game.js.
  const desktopBaseMs = Number(desktopControls?.tapWindowMs) || 350; // Preserves selector timing separately from combat.

  function normalize(value) {
    const numeric = Number(value); // Converts stored/slider input into a bounded millisecond adjustment.
    return Number.isFinite(numeric) ? Math.max(MIN_EXTRA_MS, Math.min(MAX_EXTRA_MS, Math.round(numeric / STEP_MS) * STEP_MS)) : DEFAULT_EXTRA_MS;
  }

  function load() {
    try {
      const saved = window.localStorage?.getItem(STORAGE_KEY); // Absence of a preference uses the small new default increase.
      return saved === null || saved === undefined ? DEFAULT_EXTRA_MS : normalize(saved);
    } catch (_) { return DEFAULT_EXTRA_MS; }
  }

  let extraMs = load(); // Live offset shared by combat, held items, selection wheels and contextual interactions.
  let slider = null; // Cached player Input-tab range control.
  let readout = null; // Visible milliseconds label that also works without a browser console.

  function thresholdMs(authoredMs) {
    const base = Number(authoredMs); // Action-specific baseline, never replaced by another system's baseline.
    return Number.isFinite(base) && base > 0 ? Math.max(MIN_THRESHOLD_MS, Math.round(base + extraMs)) : MIN_THRESHOLD_MS;
  }

  function syncDesktopSelectors() {
    if (desktopControls) desktopControls.tapWindowMs = thresholdMs(desktopBaseMs);
  }

  function syncSlider() {
    if (slider) slider.value = String(extraMs);
    if (readout) readout.textContent = `${extraMs > 0 ? '+' : ''}${extraMs} ms`;
  }

  function setExtraMs(value, options = {}) {
    const next = normalize(value); // Authoritative preference used for both persistence and gameplay.
    const changed = extraMs !== next; // Prevents redundant change notifications.
    extraMs = next;
    syncDesktopSelectors();
    syncSlider();
    if (options.persist !== false) {
      try { window.localStorage?.setItem(STORAGE_KEY, String(extraMs)); } catch (_) {}
    }
    if (changed) window.dispatchEvent?.(new CustomEvent('hobunji-tap-hold-timing-changed', { detail: { extraMs } }));
    return extraMs;
  }

  function mountSetting() {
    const control = document.getElementById('settingTapHoldExtraDelay'); // The ordinary, non-developer Input tab.
    if (!control) return false;
    slider = control;
    readout = document.getElementById('settingTapHoldExtraDelayValue');
    if (slider.dataset.tapHoldTimingBound !== '1') {
      slider.dataset.tapHoldTimingBound = '1';
      slider.addEventListener('input', () => setExtraMs(slider.value));
      slider.addEventListener('change', () => setExtraMs(slider.value));
    }
    syncSlider();
    return true;
  }

  window.InputHoldTiming = Object.freeze({
    thresholdMs,
    getExtraMs: () => extraMs,
    setExtraMs,
    mountSetting,
    getDebug: () => ({
      extraMs,
      combatThresholdMs: thresholdMs(240),
      selectorThresholdMs: thresholdMs(350),
      desktopTapWindowMs: desktopControls?.tapWindowMs ?? null,
      sliderMounted: !!slider,
      storageKey: STORAGE_KEY,
    }),
  });
  syncDesktopSelectors();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountSetting, { once: true });
  else mountSetting();
})();
