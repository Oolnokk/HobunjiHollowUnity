(() => {
  'use strict';

  function loadScript(src, marker) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-${marker}]`)) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.setAttribute(`data-${marker}`, '1');
      script.addEventListener('load', resolve, { once:true });
      script.addEventListener('error', () => reject(new Error(`${src} failed to load`)), { once:true });
      document.head.appendChild(script);
    });
  }

  async function boot() {
    try {
      await loadScript('../../js/wilderness-entry-corridor.js', 'wilderness-entry-corridor');
      await loadScript('lab-terrain-experiments.js', 'wilderness-lab-terrain-experiments');
      await loadScript('lab-basin-rampify.js', 'wilderness-lab-basin-rampify');
      await loadScript('lab-terrain-finalize.js', 'wilderness-lab-terrain-finalize');
      await loadScript('lab-recipe-guard.js', 'wilderness-lab-recipe-guard');
      await loadScript('lab-experiment-settings.js', 'wilderness-lab-experiment-settings');
      await loadScript('lab-exported-object-index.js', 'wilderness-lab-exported-object-index');
      await loadScript('lab-object-markers.js', 'wilderness-lab-object-markers');
      await loadScript('lab-terrain-skin.js', 'wilderness-lab-terrain-skin');
      await loadScript('lab-environment-refresh.js', 'wilderness-lab-environment-refresh');

      // Live protected-band authoring is intentionally narrow: the Lab previews
      // the waterway bank mask, while the real EnvironmentSurfaceMicroPlateau
      // below previews Western Slope snow. Grass/slush/cliffs are not retuned.
      await loadScript('../../config/natural-surface-materials.js?v=20260914outline4', 'wilderness-lab-natural-surface-config');
      await loadScript('../../js/surface-stretch-uv-furniture.js?v=20260907farmcliff1', 'wilderness-lab-surface-stretch-uv');
      await loadScript('../../js/surface-stretch-tile-ring.js?v=20260914bank1', 'wilderness-lab-surface-tile-ring');
      await loadScript('../../js/surface-tile-material-parity.js?v=20260914snowonly1', 'wilderness-lab-surface-tile-parity');
      await loadScript('lab-surface-outline-live.js?v=20260914bank1', 'wilderness-lab-surface-outline-live');

      await loadScript('../../js/environment-surface-micro-plateau.js', 'wilderness-lab-environment-surface-micro-plateau');
      await loadScript('lab-real-environment-surface.js', 'wilderness-lab-real-environment-surface');
      await loadScript('lab-surface-outline-environment-sync.js?v=20260914snowonly1', 'wilderness-lab-surface-outline-environment-sync');
      await loadScript('lab-scale-reference.js', 'wilderness-lab-scale-reference');
      await loadScript('lab-entry-repair.js', 'wilderness-lab-entry-repair');
      await loadScript('lab-pixel-probe.js', 'wilderness-lab-pixel-probe');
      await loadScript('lab-locale-terrain.js', 'wilderness-lab-locale-terrain');
      await loadScript('lab-banubu-cave.js', 'wilderness-lab-banubu-cave');
      console.log('[WildernessLab] terrain authoring + water-bank/snow protected-band tuning + real environment surface loaded');
      const button = document.getElementById('generateBtn');
      setTimeout(() => { if (button && !button.disabled) button.click(); }, 0);
    } catch (error) {
      console.error('[WildernessLab] module bootstrap failed:', error);
    }
  }

  boot();
})();