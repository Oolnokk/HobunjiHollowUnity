(() => {
  'use strict';

  // Retired. This runtime used to build both Western Slope's permanent
  // snow (until environment-surface-micro-plateau.js v3 replaced it — a
  // direct grid-height overlay instead of a scan of rendered terrain
  // geometry) and seasonal Coldmuck slush on every other outdoor zone
  // (until that same module's v4 generalized to cover slush too, using the
  // exact same mechanism, just a different material). Nothing left needs
  // this file's old triangle-copy job-queue/continuous-shell machinery —
  // kept only as an inert stub so js/rain-planes.js's own bootstrap (which
  // loads this file when window.EnvironmentSurfaceRuntime doesn't already
  // exist) and environment-surface-pixel-probe.js's debugSnapshot() read
  // still have something to find.
  if (typeof window === 'undefined' || window.EnvironmentSurfaceRuntime?.__retiredV5) return;

  window.EnvironmentSurfaceRuntime = Object.freeze({
    __retiredV5: true,
    init() {},
    update() {},
    forceRebuild() { return this.debugSnapshot(); },
    debugSnapshot() {
      return {
        installed: true,
        version: 5,
        initialized: true,
        mode: 'none',
        activeMode: 'none',
        pendingJobs: 0,
        activeJob: null,
        ownerSurfaces: 0,
        completedJobs: 0,
        lastReason: 'retired; environment-surface-micro-plateau.js owns both snow and slush now',
      };
    },
  });
})();


(() => {
  'use strict';

  // Shared scenery depth shaders must load before the Northern Cliffs plateau
  // calculates the visible Western Slope mountains' actual world-space bounds.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const modules = [
    { global: 'WesternSlopeMountainBackdrops', src: 'js/western-slope-mountain-backdrops.js?v=20261114farCull1' },
    { global: 'NorthernCliffsPlateauBackdrop', src: 'js/northern-cliffs-plateau-backdrop.js?v=20261115giantRockFog3' },
    { global: 'DistantSceneryViewCull', src: 'js/distant-scenery-view-cull.js?v=20261127boundedProbes1' },
  ]; // One ordered boot slot for both visual-only background scenery systems.
  for (const module of modules) {
    if (window[module.global]) continue;
    if (document.readyState === 'loading') {
      document.write('<script src="' + module.src + '"><\/script>');
    } else {
      const script = document.createElement('script');
      script.src = module.src;
      script.async = false; // Dynamically inserted classic scripts execute in insertion order.
      document.head?.appendChild(script);
    }
  }
})();
