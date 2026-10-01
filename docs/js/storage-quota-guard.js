// localStorage quota guard.
//
// Browser recovery checkpoints (save-checkpoint-manager.js) each hold a full
// save snapshot, and up to five of them are mirrored into localStorage. On a
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
    'hobunjiSaveCheckpoint.campfire.v1',
    'hobunjiSaveCheckpoint.preRestore.v1',
    'hobunjiSaveCheckpoint.manual.v1',
  ]);
  const stats = { quotaHits: 0, evicted: [], unresolved: 0, lastKey: '' };

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
    const guardedSetItem = function hobunjiQuotaGuardedSetItem(key, value) {
      try {
        return originalSetItem.call(this, key, value);
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
            console.warn(`[storage-quota] freed space for "${key}" by dropping browser recovery copy "${victim}".`);
            return result;
          } catch (retryError) {
            if (!isQuotaError(retryError)) throw retryError;
          }
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
    debugSnapshot: () => ({ ...stats, evicted: stats.evicted.slice(-10) }),
  };
  install();
})();
