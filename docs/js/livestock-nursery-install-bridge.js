(() => {
  'use strict';

  // Parser-time farm feature bootstrap. Keep the ordered config/runtime pairs
  // synchronous during ordinary index.html parsing so the wrappers exist before
  // FarmPanel/game.js call the underlying modules' init() methods.
  const featureScripts = [ // Used to load each modular feature's config before its runtime implementation.
    { globalKey: 'LivestockNurseryObserverScope', src: 'js/livestock-nursery-observer-scope.js?v=20260916scope1' },
    { globalKey: 'LivestockNurseryOutdoorGrowth', src: 'js/livestock-nursery-outdoor-growth.js?v=20260916outdoor1' },
    { globalKey: 'AnimalSleepPresentation', src: 'js/animal-sleep-presentation.js?v=20260921namednpc1' },
    { globalKey: 'OutdoorLivestockWelfare', src: 'js/outdoor-livestock-welfare.js?v=20260916outdoor1' },
    { globalKey: 'OutdoorLivestockPresence', src: 'js/outdoor-livestock-presence.js?v=20260916presence1' },
    { globalKey: 'ANIMAL_GROWTH_CONFIG', src: 'config/animal-growth-config.js?v=20260903growth2' },
    { globalKey: 'AnimalGrowth', src: 'js/animal-growth.js?v=20260903growth2' },
    { globalKey: 'StableAnimalProgression', src: 'js/stable-animal-progression.js?v=20260912pets1' },
    { globalKey: 'StableAnimalPerkAdjustments', src: 'js/stable-animal-perk-adjustments.js?v=20260915ambient2' },
    { globalKey: 'StableAnimalTownFamiliarity', src: 'js/stable-animal-town-familiarity.js?v=20260917rapport2' },
    { globalKey: 'StableAnimalTrainingRefinements', src: 'js/stable-animal-training-refinements.js?v=20260912pets3' },
    { globalKey: 'StableAnimalXpEvents', src: 'js/stable-animal-xp-events.js?v=20260920startup1' },
    { globalKey: 'StableTrainingCompendiumPatch', src: 'js/stable-training-compendium-patch.js?v=20260912stableNative1' },
    { globalKey: 'BARN_INCUBATOR_CONFIG', src: 'config/barn-incubator-config.js?v=20260916sleep1' },
    { globalKey: 'BarnIncubator', src: 'js/barn-incubator.js?v=20260903incubator1' },
    { globalKey: 'FarmMenuLayout', src: 'js/farm-menu-layout.js?v=20260915farmui2' },
    { globalKey: 'FarmGlancePalette', src: 'js/farm-glance-palette.js?v=20260916palette1' },
    { globalKey: 'LivestockNurseryGrid', src: 'js/livestock-nursery-grid.js?v=20260916nurserygrid3' },
    { globalKey: 'LivestockNurseryInventoryPaging', src: 'js/livestock-nursery-inventory-paging.js?v=20260916nurserypage6' },
    { globalKey: 'LivestockNurseryGridUiFix', src: 'js/livestock-nursery-grid-ui-fix.js?v=20260916uifix1' },
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
        window.LivestockNurseryOutdoorGrowth?.install?.();
        window.AnimalSleepPresentation?.install?.();
        window.OutdoorLivestockWelfare?.install?.();
        window.OutdoorLivestockPresence?.install?.();
        window.AnimalGrowth?.install?.();
        window.StableAnimalProgression?.install?.();
        window.StableAnimalTownFamiliarity?.install?.();
        window.StableAnimalTrainingRefinements?.install?.();
        window.StableAnimalXpEvents?.install?.();
        window.BarnIncubator?.install?.();
        window.FarmMenuLayout?.install?.();
        window.FarmGlancePalette?.install?.();
        window.LivestockNurseryGrid?.install?.();
        window.LivestockNurseryInventoryPaging?.install?.();
        window.LivestockNurseryGridUiFix?.install?.();
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
  // FarmPanel, while AnimalSleepPresentation/OutdoorLivestockWelfare/
  // OutdoorLivestockPresence/LivestockNursery/AnimalGrowth/StableAnimalProgression/
  // StableAnimalTownFamiliarity/StableAnimalTrainingRefinements/StableAnimalXpEvents/BarnIncubator/
  // FarmMenuLayout/FarmGlancePalette/LivestockNurseryGrid/
  // LivestockNurseryInventoryPaging all need the public farm APIs before game.js
  // initializes them. Capture FarmPanel's one global assignment and install
  // synchronously at that exact point; afterward FarmPanel is a normal writable
  // global again, so there is no permanent proxy.
  const installAnimalSleepPresentation = () => window.AnimalSleepPresentation?.install?.();
  const installOutdoorLivestockWelfare = () => window.OutdoorLivestockWelfare?.install?.();
  const installNursery = () => window.LivestockNursery?.install?.();
  const installNurseryOutdoorGrowth = () => window.LivestockNurseryOutdoorGrowth?.install?.();
  const installOutdoorLivestockPresence = () => window.OutdoorLivestockPresence?.install?.();
  const installAnimalGrowth = () => window.AnimalGrowth?.install?.();
  const installStableAnimalProgression = () => window.StableAnimalProgression?.install?.();
  const installStableAnimalTownFamiliarity = () => window.StableAnimalTownFamiliarity?.install?.();
  const installStableAnimalTrainingRefinements = () => window.StableAnimalTrainingRefinements?.install?.();
  const installStableAnimalXpEvents = () => window.StableAnimalXpEvents?.install?.();
  const installBarnIncubator = () => window.BarnIncubator?.install?.();
  const installFarmMenuLayout = () => window.FarmMenuLayout?.install?.();
  const installFarmGlancePalette = () => window.FarmGlancePalette?.install?.();
  const installLivestockNurseryGrid = () => window.LivestockNurseryGrid?.install?.();
  const installLivestockNurseryInventoryPaging = () => window.LivestockNurseryInventoryPaging?.install?.();
  const installLivestockNurseryGridUiFix = () => window.LivestockNurseryGridUiFix?.install?.();

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
    installAnimalSleepPresentation();
    installOutdoorLivestockWelfare();
    installNursery();
    installNurseryOutdoorGrowth();
    // Presence must wrap Nursery's final unassign/respawn seams, otherwise
    // Nursery's older remove-then-respawn adapter would overwrite this fix.
    installOutdoorLivestockPresence();
    installAnimalGrowth();
    installStableAnimalProgression();
    installStableAnimalTownFamiliarity();
    installStableAnimalTrainingRefinements();
    installStableProgressionDepsBridge();
    installStableAnimalXpEvents();
    installBarnIncubator();
    installFarmMenuLayout();
    installFarmGlancePalette();
    installLivestockNurseryGrid();
    installLivestockNurseryInventoryPaging();
    installLivestockNurseryGridUiFix();
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
