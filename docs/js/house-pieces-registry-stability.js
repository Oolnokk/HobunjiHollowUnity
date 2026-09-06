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

  const farmEditor = window.FarmEditor; // Already loaded before house-pieces.js; used for save/load protection around the same registry.
  const BACKUP_SUFFIX = ':house-layout-backup-v1'; // Keeps one last-known-good complete farm layout beside the authoritative layout key.
  let deps = null; // Captures HousePieces.init dependencies so clearAll can restore the original registry object.
  let preservedClearCount = 0; // Mobile/debug-visible count of identity replacements prevented by this adapter.
  let blockedInvalidSaveCount = 0; // Counts saves rejected because a previously valid house suddenly vanished from the live registry.
  let recoveredBackupCount = 0; // Counts layout loads whose house records were restored from the last-known-good backup.

  function hasStarterRecords(records) {
    return Array.isArray(records) && records.some(piece => piece?.id === 'house_starter');
  }

  function validHouseLayout(layout) {
    return !!layout && layout.version === 3 && hasStarterRecords(layout.housePieces);
  }

  function layoutKey() {
    try { return farmEditor?.farmLayoutKey?.() || null; }
    catch (_) { return null; }
  }

  function readStoredJson(key) {
    if (!key || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function writeBackup(layout, key = layoutKey()) {
    if (!validHouseLayout(layout) || !key || typeof localStorage === 'undefined') return false;
    try {
      localStorage.setItem(key + BACKUP_SUFFIX, JSON.stringify(layout));
      return true;
    } catch (_) { return false; }
  }

  function backupLayout(key = layoutKey()) {
    return key ? readStoredJson(key + BACKUP_SUFFIX) : null;
  }

  // Seed a last-known-good copy as soon as the farm layout is read. This runs
  // before applyFarmLayoutObjects mutates the live house registry, so a valid
  // stored house survives even if a later runtime regression corrupts live
  // state or an internal farm-editor save writes while that state is bad.
  if (farmEditor?.loadFarmLayout && !farmEditor.loadFarmLayout.__houseRegistryGuarded) {
    const originalLoadFarmLayout = farmEditor.loadFarmLayout;
    const guardedLoadFarmLayout = function houseRegistryGuardedLoad() {
      const key = layoutKey();
      const layout = originalLoadFarmLayout.apply(this, arguments);
      if (validHouseLayout(layout)) {
        writeBackup(layout, key);
        return layout;
      }
      const backup = backupLayout(key);
      if (!validHouseLayout(backup)) return layout;
      recoveredBackupCount += 1;
      deps?.debugLog?.('House layout: restored missing housePieces from the last-known-good farm-layout backup.', 'warn');
      if (layout && layout.version === 3) return { ...layout, housePieces: backup.housePieces.map(piece => ({ ...piece })) };
      return backup;
    };
    guardedLoadFarmLayout.__houseRegistryGuarded = true;
    guardedLoadFarmLayout.__originalLoadFarmLayout = originalLoadFarmLayout;
    farmEditor.loadFarmLayout = guardedLoadFarmLayout;
  }

  // Most gameplay and the pagehide/beforeunload flush call the exported
  // FarmEditor.saveFarmLayout function. If this world already has a valid
  // saved house, never allow a transient live registry without house_starter
  // to replace it. FarmEditor-internal lexical saves are additionally covered
  // by the load-time backup above: a subsequent load repairs their house data.
  if (farmEditor?.saveFarmLayout && !farmEditor.saveFarmLayout.__houseRegistryGuarded) {
    const originalSaveFarmLayout = farmEditor.saveFarmLayout;
    const guardedSaveFarmLayout = function houseRegistryGuardedSave() {
      const liveRegistry = deps?.getHousePieces?.();
      const key = layoutKey();
      const prior = key ? readStoredJson(key) : null;
      const backup = backupLayout(key);
      if (Array.isArray(liveRegistry) && !hasStarterRecords(liveRegistry)
          && (validHouseLayout(prior) || validHouseLayout(backup))) {
        blockedInvalidSaveCount += 1;
        deps?.debugLog?.('Farm layout save blocked: live house registry lost house_starter; preserving the last valid house save.', 'error');
        return false;
      }
      const result = originalSaveFarmLayout.apply(this, arguments);
      if (result !== false && key) {
        const written = readStoredJson(key);
        if (validHouseLayout(written)) writeBackup(written, key);
      }
      return result;
    };
    guardedSaveFarmLayout.__houseRegistryGuarded = true;
    guardedSaveFarmLayout.__originalSaveFarmLayout = originalSaveFarmLayout;
    farmEditor.saveFarmLayout = guardedSaveFarmLayout;
  }

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
    blockedInvalidSaveCount,
    recoveredBackupCount,
    backupKey: layoutKey() ? layoutKey() + BACKUP_SUFFIX : null,
    backupHasStarter: validHouseLayout(backupLayout()),
    pieceCount: Array.isArray(deps?.getHousePieces?.()) ? deps.getHousePieces().length : null,
    hasStarter: Array.isArray(deps?.getHousePieces?.())
      ? deps.getHousePieces().some(piece => piece?.id === 'house_starter')
      : null,
  });
  housePieces.__registryStabilityPatched = true;
})();
