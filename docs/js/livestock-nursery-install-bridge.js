(() => {
  'use strict';

  // Parser-time farm feature bootstrap. Keep the ordered config/runtime pairs
  // synchronous during ordinary index.html parsing so the wrappers exist before
  // FarmPanel/game.js call the underlying modules' init() methods.
  const featureScripts = [ // Used to load each modular feature's config before its runtime implementation.
    { globalKey: 'ANIMAL_GROWTH_CONFIG', src: 'config/animal-growth-config.js?v=20260903growth2' },
    { globalKey: 'AnimalGrowth', src: 'js/animal-growth.js?v=20260903growth2' },
    { globalKey: 'BARN_INCUBATOR_CONFIG', src: 'config/barn-incubator-config.js?v=20260903incubator1' },
    { globalKey: 'BarnIncubator', src: 'js/barn-incubator.js?v=20260903incubator1' },
  ];

  function ensureFeaturesLoaded() {
    if (document.readyState === 'loading') {
      for (const entry of featureScripts) {
        if (!window[entry.globalKey]) document.write(`<script src="${entry.src}"><\/script>`);
      }
      return;
    }
    const loadAt = index => {
      if (index >= featureScripts.length) {
        window.AnimalGrowth?.install?.();
        window.BarnIncubator?.install?.();
        return;
      }
      const entry = featureScripts[index];
      if (window[entry.globalKey]) { loadAt(index + 1); return; }
      const script = document.createElement('script');
      script.src = entry.src;
      script.onload = () => loadAt(index + 1);
      script.onerror = () => console.warn(`[FarmFeatures] failed to load ${entry.src}.`);
      document.head.appendChild(script);
    };
    loadAt(0);
  }
  ensureFeaturesLoaded();

  // Parser-time bridge for the decoupled farm modules. FarmTroughs loads before
  // FarmPanel, while LivestockNursery/AnimalGrowth/BarnIncubator all need the
  // public farm APIs before game.js initializes them. Capture FarmPanel's one
  // global assignment and install synchronously at that exact point; afterward
  // FarmPanel is a normal writable global again, so there is no permanent proxy.
  const installNursery = () => window.LivestockNursery?.install?.();
  const installAnimalGrowth = () => window.AnimalGrowth?.install?.();
  const installBarnIncubator = () => window.BarnIncubator?.install?.();

  // The vegetation extraction currently has one ROCK fallback that can publish a
  // plain {_windAmp: 0} sentinel into vegFoliageMeshes when no mound geometry was
  // generated. The render loop's public contract is stricter: every active entry
  // is a THREE.Object3D and therefore supports traverse(). Until that producer is
  // folded back into main, keep this branch safe by pruning invalid active slots
  // immediately after every public path that can rebuild farm vegetation.
  const installVegetationFoliageContractGuard = () => {
    const vegetation = window.VegetationCropRendering;
    if (!vegetation || vegetation.__foliageContractGuardInstalled) return false;
    vegetation.__foliageContractGuardInstalled = true;

    const pruneInvalidFoliage = () => {
      const meshes = vegetation.vegFoliageMeshes;
      const active = vegetation.vegFoliageActive;
      if (!Array.isArray(meshes) || !active?.delete) return;
      for (const index of [...active]) {
        const mesh = meshes[index];
        if (mesh && typeof mesh.traverse === 'function') continue;
        meshes[index] = null;
        active.delete(index);
      }
    };

    for (const methodName of ['buildTileMeshes', 'refreshTileMesh', 'rebuildWeedTiles']) {
      const original = vegetation[methodName];
      if (typeof original !== 'function') continue;
      const wrapped = function foliageContractGuardedRebuild(...args) {
        const result = original.apply(this, args);
        pruneInvalidFoliage();
        return result;
      };
      wrapped.__foliageContractGuard = true;
      vegetation[methodName] = wrapped;
    }
    pruneInvalidFoliage();
    return true;
  };

  const installBridges = () => {
    installVegetationFoliageContractGuard();
    installNursery();
    installAnimalGrowth();
    installBarnIncubator();
  };

  if (window.FarmPanel) {
    installBridges();
    return;
  }

  let pendingFarmPanel = null; // Holds the assignment only for the setter's single synchronous handoff.
  try {
    Object.defineProperty(window, 'FarmPanel', {
      configurable: true,
      enumerable: true,
      get() { return pendingFarmPanel; },
      set(value) {
        pendingFarmPanel = value;
        Object.defineProperty(window, 'FarmPanel', {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
        installBridges();
      },
    });
  } catch (_) {
    // Very old/locked-down browsers may refuse redefining globals. This fallback
    // still installs before ordinary user interaction; supported browsers use the
    // synchronous setter path above.
    const timer = setInterval(() => {
      if (!window.FarmPanel) return;
      clearInterval(timer);
      installBridges();
    }, 0);
  }
})();
