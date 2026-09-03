(() => {
  'use strict';

  // Parser-time bridge for the decoupled farm modules. FarmTroughs loads before
  // FarmPanel, while LivestockNursery needs both public APIs before game.js calls
  // their init() functions. Capture FarmPanel's one global assignment and install
  // Nursery synchronously at that exact point; afterward FarmPanel is a normal
  // writable global again, so there is no permanent proxy/setter in the runtime.
  const installNursery = () => window.LivestockNursery?.install?.();

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
