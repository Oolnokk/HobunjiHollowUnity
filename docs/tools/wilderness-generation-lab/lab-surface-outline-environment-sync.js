(() => {
  'use strict';

  if (window.WildernessLabSurfaceOutlineEnvironmentSync?.installed) return;
  let refreshRaf = 0;
  let installed = false;

  function snowPreviewActive() {
    return !!document.getElementById('winterEnabled')?.checked
      && document.getElementById('winterPreset')?.value === 'snow';
  }

  function refreshRealSnowSurface() {
    refreshRaf = 0;
    if (!snowPreviewActive()) return;
    const preview = window.WildernessLabPreview;
    if (typeof preview?.rebuildWinter === 'function') {
      preview.rebuildWinter();
      return;
    }
    window.EnvironmentSurfaceMicroPlateau?.forceRebuild?.();
  }

  function scheduleRefresh() {
    if (!snowPreviewActive() || refreshRaf) return;
    refreshRaf = requestAnimationFrame(refreshRealSnowSurface);
  }

  function install() {
    if (installed) return true;
    const range = document.getElementById('surfaceOutlineSourceEdge');
    const number = document.getElementById('surfaceOutlineSourceEdgeNum');
    const reset = document.getElementById('surfaceOutlineReset');
    if (!range || !number || !reset) return false;
    installed = true;
    range.addEventListener('input', scheduleRefresh);
    number.addEventListener('input', scheduleRefresh);
    reset.addEventListener('click', scheduleRefresh);
    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (install() || attempts >= 40) clearInterval(timer);
    }, 50);
  }

  window.WildernessLabSurfaceOutlineEnvironmentSync = {
    installed: true,
    scope: 'snow-only',
    refresh: scheduleRefresh,
  };
})();