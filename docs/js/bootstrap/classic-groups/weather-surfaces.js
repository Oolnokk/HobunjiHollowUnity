(() => {
  'use strict';
  // Rain sheets (which load the sky dome) and outdoor snow/slush surfaces: classic scripts in their
  // original parser execution order. Add modules and bump their cache tokens here, not in index.html, so
  // unrelated PRs stop colliding on the shared page. Notes carried over from index.html:
  // Three reusable, UV-scrolling rain sheets in the existing world renderer.
  // Tile-driven environment surface overlay (window.EnvironmentSurfaceMicroPlateau)
  // — owns both Western Slope's permanent snow and seasonal Coldmuck
  // slush on every other outdoor zone, reading tile height straight from
  // grid data (elevTier/rampElevation) instead of scanning rendered
  // terrain geometry. Fully replaced the old triangle-copy job-queue
  // system in environment-surface-runtime.js (rain-planes.js loads that
  // above on demand, now an inert stub kept only so that bootstrap check
  // and the Pixel Probe adapter below still have something to find).
  // Feeds the surface overlay's build progress into the Pixel Probe
  // report line (window.EnvironmentSurfacePixelProbe) — intercepts
  // window.PixelProbe assignment if pixel-probe.js below hasn't loaded
  // yet.
  const scriptUrls = [
    "js/rain-planes.js?v=20261126hc3b219e",
    "js/environment-surface-micro-plateau.js?v=20261102snowMaterialIsolation1",
    "js/environment-surface-pixel-probe.js?v=20261106charge879"
  ]; // Versioned game modules owned by this group.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
