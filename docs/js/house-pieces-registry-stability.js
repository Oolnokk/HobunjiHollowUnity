(() => {
  'use strict';

  // House save restoration in farm-editor.js keeps a local reference to the
  // live housePieces array while it clears and repopulates saved records.
  // HousePieces.clearAll historically replaced that array with a new [],
  // leaving the loader to repopulate a stale object that the rest of the
  // game (Buildings panel, saveFarmLayout, collision queries) no longer saw.
  // Preserve registry identity at the public clearAll boundary so every
  // existing reference continues to point at the authoritative collection.
  const housePieces = window.HousePieces;
  if (!housePieces || housePieces.__registryStabilityPatched) return;

  let deps = null; // Captures HousePieces.init dependencies so clearAll can restore the original registry object.
  let preservedClearCount = 0; // Mobile/debug-visible count of identity replacements prevented by this adapter.

  const originalInit = housePieces.init;
  housePieces.init = function registryStableInit(injectedDeps) {
    deps = injectedDeps;
    return originalInit.apply(this, arguments);
  };

  const originalClearAll = housePieces.clearAll;
  housePieces.clearAll = function registryStableClearAll() {
    const registryBefore = deps?.getHousePieces?.(); // The object other loaders/modules may already hold by reference.
    const result = originalClearAll.apply(this, arguments);
    const registryAfter = deps?.getHousePieces?.(); // Historically a brand-new [] allocated by core clearAll().

    if (Array.isArray(registryBefore) && Array.isArray(registryAfter) && registryBefore !== registryAfter) {
      registryBefore.length = 0;
      deps.setHousePieces?.(registryBefore);
      preservedClearCount += 1;
      deps.debugLog?.('House registry: preserved array identity across clearAll so save restoration remains authoritative.', 'warn');
    }
    return result;
  };

  housePieces.debugRegistryStability = () => ({
    installed: true,
    preservedClearCount,
    pieceCount: Array.isArray(deps?.getHousePieces?.()) ? deps.getHousePieces().length : null,
    hasStarter: Array.isArray(deps?.getHousePieces?.())
      ? deps.getHousePieces().some(piece => piece?.id === 'house_starter')
      : null,
  });
  housePieces.__registryStabilityPatched = true;
})();
