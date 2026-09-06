(() => {
  'use strict';

  function loadScript(src, marker) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-${marker}]`)) { resolve(); return; }
      const script = document.createElement('script'); // Small bootstrap keeps each Wilderness Lab authoring subsystem independently maintainable.
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
      await loadScript('lab-terrain-experiments.js', 'wilderness-lab-terrain-experiments'); // Calculates Great Basin spoon heights, river canyon overrides, and karst placement.
      await loadScript('lab-basin-rampify.js', 'wilderness-lab-basin-rampify'); // Converts the spoon floor into one continuous walkable rampElevation field instead of tiny terraces.
      await loadScript('lab-terrain-finalize.js', 'wilderness-lab-terrain-finalize'); // Reconciles transformed cells with old plateau mesa masks.
      await loadScript('lab-recipe-guard.js', 'wilderness-lab-recipe-guard'); // Keeps exact/live recipes from inheriting stale karst or river experimental toggles.
      await loadScript('lab-experiment-settings.js', 'wilderness-lab-experiment-settings'); // Copy/download settings includes the dynamically injected terrain controls.
      await loadScript('lab-exported-object-index.js', 'wilderness-lab-exported-object-index'); // Reconstructs unique generator objects from the Map Editor workspace's generatedObjectId/generatedObjectType tile metadata.
      await loadScript('lab-object-markers.js', 'wilderness-lab-object-markers'); // Schematic cube marker renderer consumes the reconstructed object array and wraps the adjusted terrain preview.
      await loadScript('lab-terrain-skin.js', 'wilderness-lab-terrain-skin'); // Final pass keeps the broad Great Basin ramp field grass-skinned rather than path-skinned.
      await loadScript('lab-environment-refresh.js', 'wilderness-lab-environment-refresh'); // Corrects old generic winter terminology: Coldmuck is localized slush; Western Slope snow is persistent avalanche deposition.
      console.log('[WildernessLab] terrain experiments + basin ramp field + finalizer + recipe guard + settings export + exported-object index + cube markers + terrain skin + environment refresh loaded');
      const button = document.getElementById('generateBtn'); // Lab-features may have triggered one early render when this bootstrap loaded; rerun once all child modules are ready.
      setTimeout(() => { if (button && !button.disabled) button.click(); }, 0);
    } catch (error) {
      console.error('[WildernessLab] module bootstrap failed:', error);
    }
  }

  boot();
})();