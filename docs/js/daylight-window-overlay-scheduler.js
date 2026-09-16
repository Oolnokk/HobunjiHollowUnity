// Keeps daylight-window mask composition on the same low-frequency cadence as
// the existing unified lighting canvas. CloudForestFog intentionally reuses
// its previous canvas for ~100 ms between redraws; reapplying destination-out
// window gradients on every render frame would otherwise accumulate at edges.
(() => {
  'use strict';

  const WINDOW_REDRAW_MS = 110; // Slightly longer than the base overlay's 100 ms throttle so a daylight pass normally follows a fresh base redraw.
  const PANE_TINT_MS = 220; // Outdoor-facing pane RGB can update much more cheaply/slower than rendering without looking stepped.
  let installAttempts = 0; // Finite boot retries while WeatherFX/CloudForestFog/DaylightWindowRuntime wrappers settle.
  let lastWindowDrawAt = -Infinity; // Last time the expensive aperture gradients were allowed to run.
  let lastPaneTintAt = -Infinity; // Last time pane materials were synchronized while outside interiors too.

  function install() {
    installAttempts += 1;
    const api = window.WeatherFX; // Shared lighting authority patched by CloudForestFog and DaylightWindowRuntime.
    const current = api?.drawLightingOverlay; // Daylight wrapper must exist before this cadence shim can safely separate base vs aperture work.
    if (!api || typeof current !== 'function' || !current.__daylightWindowWrapped) {
      if (installAttempts < 30) window.setTimeout(install, 100);
      return false;
    }
    if (current.__daylightWindowCadenceWrapped) return true;
    const baseDraw = current.__daylightWindowOriginal; // Base unified overlay without the daylight-window post-pass; still handles lightning/transition redraws on every call.
    if (typeof baseDraw !== 'function') {
      if (installAttempts < 30) window.setTimeout(install, 100);
      return false;
    }
    const daylightDraw = current.bind(api); // Existing post-pass remains the single implementation of aperture projection/compositing.
    const wrapped = function scheduledDaylightWindowOverlay(...args) {
      const now = performance.now(); // Shared timing source with the base overlay's own throttle.
      if (now - lastPaneTintAt >= PANE_TINT_MS) {
        lastPaneTintAt = now;
        const runtime = window.DaylightWindowRuntime; // Public runtime API lets exterior-facing panes follow outdoor RGB even when no interior aperture is being drawn.
        try { runtime?.updatePaneTint?.(runtime.currentOutdoorLighting?.()); } catch (_) {}
      }
      if (now - lastWindowDrawAt >= WINDOW_REDRAW_MS) {
        lastWindowDrawAt = now;
        return daylightDraw(...args);
      }
      return baseDraw(...args); // Preserve base overlay's special lightning/scene-transition behavior without accumulating window masks.
    };
    wrapped.__daylightWindowWrapped = true; // Prevents DaylightWindowRuntime's finite boot retry from wrapping this cadence shim a second time.
    wrapped.__daylightWindowCadenceWrapped = true;
    wrapped.__daylightWindowOriginal = baseDraw; // Retains the same unwrapped base for diagnostics/future wrapper cooperation.
    api.drawLightingOverlay = wrapped;
    return true;
  }

  install();
})();
