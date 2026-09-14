// Folder Save Runtime Flush — captures the game's canonical live save callbacks
// from FarmAnimals.init(deps), so quit/reload can persist live runtime state
// before LocalSaveFolder mirrors localStorage to disk.
(() => {
  'use strict';

  if (window.HobunjiRuntimeSave) return;

  let saveMemberWorldData = null; // Captured from FarmAnimals deps; used by quit/beforeunload to persist live inventory/member state.
  let saveFarmLayout = null; // Captured from FarmAnimals deps; used by quit/beforeunload to persist the current physical farm before folder sync.
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
    try {
      // saveMemberWorldData is the canonical write of the live general bag,
      // relationships, quest/world-member state, etc. The folder mirror must
      // never run first or it can faithfully copy an older localStorage image.
      if (typeof saveMemberWorldData === 'function') saveMemberWorldData();
      if (typeof saveFarmLayout === 'function') saveFarmLayout();
      lastInventoryFingerprint = inventoryFingerprint();
      flushCount++;
      lastError = '';
      return { ok: true, captured: typeof saveMemberWorldData === 'function', reason };
    } catch (error) {
      lastError = String(error?.message || error);
      return { ok: false, captured: typeof saveMemberWorldData === 'function', reason, error: lastError };
    }
  }

  installFarmAnimalsHook();

  window.HobunjiRuntimeSave = {
    flushNow,
    isReady: () => typeof saveMemberWorldData === 'function',
  };

  window.__hobunjiRuntimeSaveDebug = {
    snapshot: () => ({
      ready: typeof saveMemberWorldData === 'function',
      farmLayoutReady: typeof saveFarmLayout === 'function',
      flushCount,
      livestockInventoryFlushCount,
      lastFlushReason,
      lastError: lastError || null,
    }),
  };
})();
