(() => {
  'use strict';

  // Parser-time farm feature bootstrap. Keep the ordered config/runtime pairs
  // synchronous during ordinary index.html parsing so the wrappers exist before
  // FarmPanel/game.js call the underlying modules' init() methods.
  const featureScripts = [ // Used to load each modular feature's config before its runtime implementation.
    { globalKey: 'ANIMAL_GROWTH_CONFIG', src: 'config/animal-growth-config.js?v=20260903growth2' },
    { globalKey: 'AnimalGrowth', src: 'js/animal-growth.js?v=20260903growth2' },
    { globalKey: 'StableAnimalProgression', src: 'js/stable-animal-progression.js?v=20260912pets1' },
    { globalKey: 'StableAnimalPerkAdjustments', src: 'js/stable-animal-perk-adjustments.js?v=20260915ambient2' },
    { globalKey: 'StableAnimalTrainingRefinements', src: 'js/stable-animal-training-refinements.js?v=20260912pets3' },
    { globalKey: 'StableAnimalXpEvents', src: 'js/stable-animal-xp-events.js?v=20260913xp1' },
    { globalKey: 'StableTrainingCompendiumPatch', src: 'js/stable-training-compendium-patch.js?v=20260912stableNative1' },
    { globalKey: 'BARN_INCUBATOR_CONFIG', src: 'config/barn-incubator-config.js?v=20260903incubator1' },
    { globalKey: 'BarnIncubator', src: 'js/barn-incubator.js?v=20260903incubator1' },
    { globalKey: 'FarmMenuLayout', src: 'js/farm-menu-layout.js?v=20260915farmui2' },
    { globalKey: 'LivestockNurseryGrid', src: 'js/livestock-nursery-grid.js?v=20260916nurserygrid1' },
    { globalKey: 'LivestockNurseryInventoryPaging', src: 'js/livestock-nursery-inventory-paging.js?v=20260916nurserypage2' },
  ];
  const STABLE_ROLE_DEP_METHODS = Object.freeze([
    'getActiveCompanionId',
    'getActiveMountId',
    'getActiveShoulderPetId',
  ]); // Mirrored from FarmPanel deps into the FarmAnimals deps object retained by Stable progression.

  let stableProgressionFarmDeps = null; // Captured FarmAnimals deps object; StableAnimalProgression keeps this exact reference.
  let stableProgressionPanelDeps = null; // Captured FarmPanel deps object; authoritative source for active animal IDs.

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
        window.StableAnimalProgression?.install?.();
        window.StableAnimalTrainingRefinements?.install?.();
        window.StableAnimalXpEvents?.install?.();
        window.BarnIncubator?.install?.();
        window.FarmMenuLayout?.install?.();
        window.LivestockNurseryGrid?.install?.();
        window.LivestockNurseryInventoryPaging?.install?.();
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
  // FarmPanel, while LivestockNursery/AnimalGrowth/StableAnimalProgression/
  // StableAnimalTrainingRefinements/StableAnimalXpEvents/BarnIncubator/
  // LivestockNurseryGrid/LivestockNurseryInventoryPaging all need the public
  // farm APIs before game.js initializes them. Capture FarmPanel's one global
  // assignment and install synchronously at that exact point; afterward
  // FarmPanel is a normal writable global again, so there is no permanent proxy.
  const installNursery = () => window.LivestockNursery?.install?.();
  const installAnimalGrowth = () => window.AnimalGrowth?.install?.();
  const installStableAnimalProgression = () => window.StableAnimalProgression?.install?.();
  const installStableAnimalTrainingRefinements = () => window.StableAnimalTrainingRefinements?.install?.();
  const installStableAnimalXpEvents = () => window.StableAnimalXpEvents?.install?.();
  const installBarnIncubator = () => window.BarnIncubator?.install?.();
  const installFarmMenuLayout = () => window.FarmMenuLayout?.install?.();
  const installLivestockNurseryGrid = () => window.LivestockNurseryGrid?.install?.();
  const installLivestockNurseryInventoryPaging = () => window.LivestockNurseryInventoryPaging?.install?.();

  // FarmPanel's native Stable renderer intentionally blocks the old progression
  // render wrapper, but that also blocks the old FarmPanel.init dependency
  // capture. StableAnimalProgression then falls back to its FarmAnimals deps,
  // which own stable storage but not the active companion/mount/shoulder IDs.
  // Mirror only those live role getters into the already-captured FarmAnimals
  // deps object so every XP source sees the active animal again without
  // reintroducing the retired Stable UI decorator.
  function syncStableProgressionRoleDeps() {
    const target = stableProgressionFarmDeps; // Mutated in place because StableAnimalProgression retains this object reference.
    const source = stableProgressionPanelDeps; // Supplies the authoritative active-role getter functions.
    if (!target || !source) return false;
    let changed = false; // Reported by diagnostics/tests when a missing getter is repaired.
    for (const methodName of STABLE_ROLE_DEP_METHODS) {
      if (typeof target[methodName] === 'function') continue;
      const sourceMethod = source[methodName]; // Proxied rather than snapshotted so later active-animal changes remain live.
      if (typeof sourceMethod !== 'function') continue;
      try {
        target[methodName] = (...args) => sourceMethod.apply(source, args);
        changed = true;
      } catch (error) {
        console.warn(`[FarmFeatures] could not mirror ${methodName} into Stable progression deps.`, error);
      }
    }
    return changed;
  }

  function installStableProgressionDepsBridge() {
    const farmAnimals = window.FarmAnimals; // Wrapped here to remember the deps object progression captures during FarmAnimals.init.
    if (farmAnimals && typeof farmAnimals.init === 'function' && !farmAnimals.init.__stableProgressionDepsBridge) {
      const originalFarmInit = farmAnimals.init; // Preserved so existing AnimalGrowth/progression wrappers remain in the chain.
      const wrappedFarmInit = function stableProgressionDepsFarmInit(injectedDeps, ...rest) {
        stableProgressionFarmDeps = injectedDeps || null;
        const result = originalFarmInit.call(this, injectedDeps, ...rest); // Existing FarmAnimals initialization remains authoritative.
        syncStableProgressionRoleDeps();
        return result;
      };
      Object.defineProperty(wrappedFarmInit, '__stableProgressionDepsBridge', { value: true });
      farmAnimals.init = wrappedFarmInit;
    }

    const farmPanel = window.FarmPanel; // Wrapped separately because its deps contain the active stable-role getters missing above.
    if (farmPanel && typeof farmPanel.init === 'function' && !farmPanel.init.__stableProgressionDepsBridge) {
      const originalPanelInit = farmPanel.init; // Preserved so the native Stable panel and core panel still initialize normally.
      const wrappedPanelInit = function stableProgressionDepsPanelInit(injectedDeps, ...rest) {
        stableProgressionPanelDeps = injectedDeps || null;
        syncStableProgressionRoleDeps();
        const result = originalPanelInit.call(this, injectedDeps, ...rest); // Native Stable panel captures its own deps as before.
        syncStableProgressionRoleDeps();
        return result;
      };
      Object.defineProperty(wrappedPanelInit, '__stableProgressionDepsBridge', { value: true });
      farmPanel.init = wrappedPanelInit;
    }

    window.__stableAnimalProgressionDepsDebug = () => ({
      farmDepsReady: !!stableProgressionFarmDeps,
      panelDepsReady: !!stableProgressionPanelDeps,
      getters: Object.fromEntries(STABLE_ROLE_DEP_METHODS.map(methodName => [methodName, {
        farm: typeof stableProgressionFarmDeps?.[methodName] === 'function',
        panel: typeof stableProgressionPanelDeps?.[methodName] === 'function',
      }])),
    });
  }

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
      if (typeof vegetation[methodName] !== 'function') continue;
      const original = vegetation[methodName];
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
    installStableAnimalProgression();
    installStableAnimalTrainingRefinements();
    installStableProgressionDepsBridge();
    installStableAnimalXpEvents();
    installBarnIncubator();
    installFarmMenuLayout();
    installLivestockNurseryGrid();
    installLivestockNurseryInventoryPaging();
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