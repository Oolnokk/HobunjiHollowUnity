// Folder Save Runtime Flush — captures the game's canonical live save callbacks
// from FarmAnimals.init(deps), so quit/reload can persist live runtime state
// before LocalSaveFolder mirrors localStorage to disk.
(() => {
  'use strict';

  if (window.HobunjiRuntimeSave) return;

  let saveMemberWorldData = null; // Captured from FarmAnimals deps; used by quit/beforeunload to persist live inventory/member state.
  let saveFarmLayout = null; // Captured from FarmAnimals deps; used by quit/beforeunload to persist the current physical farm before folder sync.
  let captureMemberWorldData = null; // Shared gameplay serializer mutates a snapshot without any browser writes.
  let captureCount = 0; // Direct folder captures shown in mobile Save Diagnostics.
  let liveInventory = null; // Captured inventory object; used to detect livestock-resource inventory changes that need immediate persistence.
  let lastInventoryFingerprint = ''; // Tracks the last inventory state observed at a livestock save so resource collection cannot remain RAM-only.
  let flushCount = 0; // Mobile-visible successful explicit runtime flush count.
  let livestockInventoryFlushCount = 0; // Mobile-visible count of inventory changes persisted through livestock operations.
  let lastFlushReason = 'none'; // Mobile-visible reason for the latest explicit runtime flush.
  let lastError = ''; // Mobile-visible latest runtime-flush error.

  function inventoryFingerprint() {
    try { return JSON.stringify(liveInventory || {}); } catch { return ''; }
  }

  function persistMemberIfInventoryChanged() {
    const nextFingerprint = inventoryFingerprint(); // Snapshot of live bag contents after the livestock operation.
    if (!nextFingerprint || nextFingerprint === lastInventoryFingerprint) return;
    lastInventoryFingerprint = nextFingerprint;
    if (typeof saveMemberWorldData !== 'function') return;
    try {
      saveMemberWorldData();
      livestockInventoryFlushCount++;
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }

  function wrapFarmAnimalsInit(api) {
    if (!api?.init || api.init.__hobunjiFolderRuntimeFlush) return;
    const originalInit = api.init.bind(api); // Original livestock initializer retained after dependency capture/wrapping.

    const wrappedInit = function folderSaveAwareFarmAnimalsInit(injectedDeps) {
      saveMemberWorldData = typeof injectedDeps?.saveMemberWorldData === 'function'
        ? injectedDeps.saveMemberWorldData
        : saveMemberWorldData;
      saveFarmLayout = typeof injectedDeps?.saveFarmLayout === 'function'
        ? injectedDeps.saveFarmLayout
        : saveFarmLayout;
      captureMemberWorldData = typeof injectedDeps?.captureMemberWorldData === 'function'
        ? injectedDeps.captureMemberWorldData : captureMemberWorldData;
      liveInventory = injectedDeps?.inventory || liveInventory;
      lastInventoryFingerprint = inventoryFingerprint();

      if (injectedDeps?.saveWorldLivestock && !injectedDeps.saveWorldLivestock.__hobunjiFolderInventoryFlush) {
        const originalSaveWorldLivestock = injectedDeps.saveWorldLivestock.bind(injectedDeps); // Existing world-livestock persistence called before member inventory persistence.
        const wrappedSaveWorldLivestock = function folderSaveAwareLivestockSave(...args) {
          const result = originalSaveWorldLivestock(...args);
          // collectResource() adds milk/venom/stink oil to the live bag and then
          // saves livestock. Persist the bag in the same operation so a quit,
          // crash, or folder mirror immediately afterward cannot lose the item.
          persistMemberIfInventoryChanged();
          return result;
        };
        wrappedSaveWorldLivestock.__hobunjiFolderInventoryFlush = true;
        injectedDeps.saveWorldLivestock = wrappedSaveWorldLivestock;
      }

      return originalInit(injectedDeps);
    };
    wrappedInit.__hobunjiFolderRuntimeFlush = true;
    api.init = wrappedInit;
  }

  function installFarmAnimalsHook() {
    if (window.FarmAnimals) {
      wrapFarmAnimalsInit(window.FarmAnimals);
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(window, 'FarmAnimals'); // Existing descriptor checked before installing a temporary assignment hook.
    if (descriptor && descriptor.configurable === false) return;
    let pendingValue = undefined; // Temporarily stores FarmAnimals during its later module assignment.
    Object.defineProperty(window, 'FarmAnimals', {
      configurable: true,
      enumerable: true,
      get() { return pendingValue; },
      set(value) {
        pendingValue = value;
        Object.defineProperty(window, 'FarmAnimals', {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
        wrapFarmAnimalsInit(value);
      },
    });
  }

  function flushNow({ reason = 'manual' } = {}) {
    lastFlushReason = reason;
    const failuresBefore = window.HobunjiStorageQuota?.getWriteFailureCount?.() || 0; // Some canonical gameplay writers catch storage errors internally.
    try {
      // saveMemberWorldData is the canonical write of the live general bag,
      // relationships, quest/world-member state, etc. The folder mirror must
      // never run first or it can faithfully copy an older localStorage image.
      if (typeof saveMemberWorldData === 'function') saveMemberWorldData();
      if (typeof saveFarmLayout === 'function') saveFarmLayout();
      if ((window.HobunjiStorageQuota?.getWriteFailureCount?.() || 0) > failuresBefore) {
        throw new Error('Browser storage is full and the live save could not be captured. The Primary Save Folder must be connected and armed to save without a browser copy.');
      }
      lastInventoryFingerprint = inventoryFingerprint();
      flushCount++;
      lastError = '';
      return { ok: true, captured: typeof saveMemberWorldData === 'function', reason };
    } catch (error) {
      lastError = String(error?.message || error);
      return { ok: false, captured: typeof saveMemberWorldData === 'function', reason, error: lastError };
    }
  }

  function captureSnapshot({ reason = 'folder-save' } = {}) {
    lastFlushReason = reason;
    try {
      if (typeof captureMemberWorldData !== 'function' || typeof window.FarmEditor?.captureFarmLayout !== 'function') {
        throw new Error('The live folder-save serializers are not ready.');
      }
      const snapshot = window.HobunjiSaveSnapshot.capture({ strict: true }); // Existing saved characters/worlds and inactive layouts form the complete snapshot baseline.
      const browserBaseline = window.HobunjiSaveSnapshot.fingerprint(snapshot); // A completed disk write must not mirror over newer browser edits made while I/O was pending.
      const worldId = window.__hobunjiPlayerProfile?.worldId; // Only the active world's physical layout is replaced by live data.
      if (!worldId) throw new Error('The active world is unavailable for folder-save capture.');
      snapshot.meta = captureMemberWorldData(snapshot.meta);
      snapshot.farmLayouts[worldId] = window.FarmEditor.captureFarmLayout();
      window.HobunjiSaveSnapshot.validate(snapshot);
      const captured = JSON.parse(JSON.stringify(snapshot)); // Detach runtime arrays/objects before asynchronous disk writes begin.
      Object.defineProperty(captured, 'browserBaselineFingerprint', { value: browserBaseline, configurable: true }); // Transient capture metadata is excluded from JSON and released before recovery history retains this snapshot.
      captureCount++;
      lastError = '';
      return { ok: true, captured: true, snapshot: captured, reason };
    } catch (error) {
      lastError = String(error?.message || error);
      return { ok: false, captured: false, reason, error: lastError };
    }
  }

  installFarmAnimalsHook();

  window.HobunjiRuntimeSave = {
    flushNow,
    captureSnapshot,
    isReady: () => typeof saveMemberWorldData === 'function',
  };

  window.__hobunjiRuntimeSaveDebug = {
    snapshot: () => ({
      ready: typeof saveMemberWorldData === 'function',
      farmLayoutReady: typeof saveFarmLayout === 'function',
      flushCount,
      captureCount,
      directCaptureReady: typeof captureMemberWorldData === 'function' && typeof window.FarmEditor?.captureFarmLayout === 'function',
      latestChange: 'Folder saves capture live member and farm-layout data directly; browser backups are no longer required before disk writes.',
      livestockInventoryFlushCount,
      lastFlushReason,
      lastError: lastError || null,
    }),
  };
})();
