// Keeps daylight-window pane materials synchronized with outdoor RGB without
// taking ownership of the shared lighting canvas. The complete lighting
// composition now redraws atomically inside CloudForestFog's unified pass.
(() => {
  'use strict';

  const VERSION = 2; // Diagnostics contract for the pane-only scheduler.
  const PANE_TINT_MS = 220; // Pane material tint is cheap and can update independently of the ~100 ms unified canvas redraw cadence.
  let lastPaneTintAt = -Infinity; // Last successful pane-material synchronization timestamp.
  let lastError = null; // Most recent recoverable pane-tint error for mobile diagnostics.

  function updatePaneTint() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastPaneTintAt < PANE_TINT_MS) return false;
    lastPaneTintAt = now;
    const runtime = window.DaylightWindowRuntime; // Public runtime owns outdoor-state sampling and all registered pane materials.
    if (!runtime?.updatePaneTint || !runtime?.currentOutdoorLighting) return false;
    try {
      runtime.updatePaneTint(runtime.currentOutdoorLighting());
      return true;
    } catch (error) {
      lastError = error?.message || String(error);
      return false;
    }
  }

  updatePaneTint();
  const paneTintTimer = typeof window.setInterval === 'function'
    ? window.setInterval(updatePaneTint, PANE_TINT_MS)
    : null; // Low-frequency timer replaces the old alternating base-only/window-overlay draw wrapper.

  window.DaylightWindowOverlayScheduler = Object.freeze({
    version: VERSION,
    paneTintMs: PANE_TINT_MS,
    updateNow: updatePaneTint,
    getDebugState: () => ({ version: VERSION, paneTintMs: PANE_TINT_MS, timerActive: !!paneTintTimer, lastPaneTintAt, lastError }),
  });
})();
