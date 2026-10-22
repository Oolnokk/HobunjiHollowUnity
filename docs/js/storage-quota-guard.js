// localStorage quota guard.
//
// Browser recovery checkpoints (save-checkpoint-manager.js) each hold a full
// save snapshot, and up to six of them are mirrored into localStorage. On a
// large save they can fill the ~5 MB quota, after which the canonical save
// itself (hobunjiSaveMeta, farm layouts, ...) fails to write with
// "QuotaExceededError" -- which is far worse than losing a recovery copy.
//
// This guard wraps Storage.prototype.setItem for window.localStorage only.
// When a write hits the quota it evicts recovery-checkpoint mirrors, least
// valuable first, and retries after each eviction:
//   - any non-checkpoint key may evict every checkpoint slot;
//   - a checkpoint slot only evicts slots ranked below itself, so an autosave
//     can never push out a manual save.
// Loaded before every other script so all existing writers are covered.
(() => {
  'use strict';

  if (window.HobunjiStorageQuota) return;

  // Lowest value first. Folder-backed recovery keeps its own copies on disk,
  // so these browser mirrors are the cheapest data to give up.
  const CHECKPOINT_EVICTION_ORDER = Object.freeze([
    'hobunjiSaveCheckpoint.autoPrevious.v1',
    'hobunjiSaveCheckpoint.auto.v1',
    'hobunjiSaveCheckpoint.mapChange.v1', // Travel checkpoints are optional mirrors too.
    'hobunjiSaveCheckpoint.campfire.v1',
    'hobunjiSaveCheckpoint.preRestore.v1',
    'hobunjiSaveCheckpoint.manual.v1',
  ]);
  const stats = { quotaHits: 0, evicted: [], unresolved: 0, lastKey: '' };
  const folderStaging = new Map(); // Canonical values that no longer fit in the browser, read by the existing folder snapshot pipeline.
  let importingFolder = false; // Allows a validated folder import to stage before autosync is armed.
  let browserPersistenceRequired = false; // Browser-only restores must not report transient folder staging as durable storage.

  function canStageForFolder(key) {
    if (browserPersistenceRequired) return false;
    if (key !== 'hobunjiSaveMeta' && !key.startsWith('hobunji_farm_layout_v3:')) return false;
    const status = window.LocalSaveFolder?.getStatus?.(); // Only an explicitly armed primary folder permits a transient browser mirror.
    return importingFolder || (status?.state === 'ready' && status?.autoSyncArmed === true);
  }

  function isQuotaError(error) {
    if (!error) return false;
    return error.name === 'QuotaExceededError'
      || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || error.code === 22 || error.code === 1014
      || /quota/i.test(String(error.message || ''));
  }

  function evictionCandidates(key) {
    const rank = CHECKPOINT_EVICTION_ORDER.indexOf(String(key));
    return rank < 0 ? CHECKPOINT_EVICTION_ORDER : CHECKPOINT_EVICTION_ORDER.slice(0, rank);
  }

  function install() {
    const proto = window.Storage?.prototype;
    if (!proto || proto.setItem.__hobunjiQuotaGuard) return false;
    const originalSetItem = proto.setItem;
    const originalGetItem = proto.getItem; // Native reads remain available underneath staged canonical values.
    const originalRemoveItem = proto.removeItem; // Explicit deletes must also discard staged values.
    const originalClear = proto.clear; // Browser reset must clear both representations.
    proto.getItem = function (key) {
      key = String(key);
      if (this === window.localStorage && folderStaging.has(key)) return folderStaging.get(key);
      return originalGetItem.call(this, key);
    };
    proto.removeItem = function (key) {
      key = String(key);
      const result = originalRemoveItem.call(this, key); // Preserve native errors before changing staged state.
      if (this === window.localStorage) folderStaging.delete(key);
      return result;
    };
    if (originalClear) proto.clear = function () {
      const result = originalClear.call(this);
      if (this === window.localStorage) folderStaging.clear();
      return result;
    };
    const guardedSetItem = function hobunjiQuotaGuardedSetItem(key, value) {
      key = String(key);
      value = String(value);
      try {
        const result = originalSetItem.call(this, key, value);
        if (this === window.localStorage) folderStaging.delete(key);
        return result;
      } catch (error) {
        let local = null;
        try { local = window.localStorage; } catch (_) {}
        if (this !== local || !isQuotaError(error)) throw error;
        stats.quotaHits += 1;
        stats.lastKey = String(key);
        for (const victim of evictionCandidates(key)) {
          if (this.getItem(victim) == null) continue;
          this.removeItem(victim);
          stats.evicted.push(victim);
          try {
            const result = originalSetItem.call(this, key, value);
            folderStaging.delete(key);
            console.warn(`[storage-quota] freed space for "${key}" by dropping browser recovery copy "${victim}".`);
            return result;
          } catch (retryError) {
            if (!isQuotaError(retryError)) throw retryError;
          }
        }
        if (canStageForFolder(key)) {
          // Every existing writer/reader sees the latest canonical value. This
          // is staging, not durable success: syncSnapshot/syncNow must still
          // finish their actual disk writes before the UI reports a save.
          folderStaging.set(key, value);
          return;
        }
        stats.unresolved += 1;
        throw error;
      }
    };
    guardedSetItem.__hobunjiQuotaGuard = true;
    proto.setItem = guardedSetItem;
    return true;
  }

  window.HobunjiStorageQuota = {
    install,
    isQuotaError,
    CHECKPOINT_EVICTION_ORDER,
    hasStagedValues: () => folderStaging.size > 0,
    getWriteFailureCount: () => stats.unresolved,
    requireBrowserPersistence(callback) {
      const previous = browserPersistenceRequired; // Nested synchronous writes retain the caller's durability requirement.
      browserPersistenceRequired = true;
      try { return callback(); } finally { browserPersistenceRequired = previous; }
    },
    importFolderSnapshot(callback) {
      const previous = importingFolder; // Nested synchronous imports restore the previous staging scope.
      importingFolder = true;
      try { return callback(); } finally { importingFolder = previous; }
    },
    debugSnapshot: () => ({
      ...stats, evicted: stats.evicted.slice(-10), stagedKeys: [...folderStaging.keys()],
      latestChange: 'Canonical saves that exceed browser quota remain readable for the armed Primary Save Folder; disk writes still determine save success.',
    }),
  };
  install();
})();
