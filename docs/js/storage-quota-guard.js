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
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // The compass tracks this one key without polling its full value.
  let saveMetaRevision = 0; // Advances whenever the guarded canonical metadata can change.
  let saveMetaLocaleRevision = 0; // Compass-only revision: ignores changes unrelated to locale discovery.
  let lastLocaleSections; // Serialized discoveredLocales fragments, not a second copy of the entire save.
  let guardedLocalStorage = null; // Virtual preview storage uses its own methods and must bypass revision caching.
  const stats = { quotaHits: 0, evicted: [], unresolved: 0, lastKey: '' };
  const folderStaging = new Map(); // Canonical values that no longer fit in the browser, read by the existing folder snapshot pipeline.
  let importingFolder = false; // Allows a validated folder import to stage before autosync is armed.
  let browserPersistenceRequired = false; // Browser-only restores must not report transient folder staging as durable storage.

  function canStageForFolder(key) {
    if (browserPersistenceRequired) return false;
    if (key !== SAVE_META_KEY && !key.startsWith('hobunji_farm_layout_v3:')) return false;
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

  // Extract discoveredLocales JSON values without parsing the complete metadata.
  // Performed on writes or cross-tab events, never during compass-frame polls.
  function localeSections(raw) {
    if (typeof raw !== 'string') return null;
    const needle = '"discoveredLocales"';
    const parts = [];
    let cursor = 0;
    while (cursor < raw.length) {
      const at = raw.indexOf(needle, cursor);
      if (at === -1) break;
      cursor = at + needle.length;
      if (raw[at - 1] === '\\') continue; // JSON-escaped key-like text inside a value is not a property.
      let pos = cursor;
      while (pos < raw.length && /\s/.test(raw[pos])) pos++;
      if (raw[pos] !== ':') continue;
      pos++;
      while (pos < raw.length && /\s/.test(raw[pos])) pos++;
      const start = pos;
      if (raw[pos] === '{' || raw[pos] === '[') {
        const stack = []; // Tracks only this one value's nested object/array boundaries.
        let quoted = false, escaped = false;
        for (; pos < raw.length; pos++) {
          const char = raw[pos];
          if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
          } else if (char === '"') quoted = true;
          else if (char === '{') stack.push('}');
          else if (char === '[') stack.push(']');
          else if (char === '}' || char === ']') {
            if (stack.pop() !== char) return raw; // Corrupt metadata must invalidate conservatively.
            if (!stack.length) { pos++; break; }
          }
        }
        if (stack.length || quoted) return raw;
      } else {
        while (pos < raw.length && !/[,}\]\s]/.test(raw[pos])) pos++;
      }
      parts.push(raw.slice(at, pos));
      cursor = Math.max(pos, start + 1);
    }
    return parts.join('\u001f');
  }
  function noteLocaleWrite(value, force = false) {
    const next = localeSections(value);
    if (force || lastLocaleSections !== next) saveMetaLocaleRevision++;
    lastLocaleSections = next;
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
      if (this === window.localStorage) {
        folderStaging.delete(key);
        if (key === SAVE_META_KEY) { saveMetaRevision++; noteLocaleWrite(null, true); }
      }
      return result;
    };
    if (originalClear) proto.clear = function () {
      const result = originalClear.call(this);
      if (this === window.localStorage) {
        folderStaging.clear();
        saveMetaRevision++;
        noteLocaleWrite(null, true);
      }
      return result;
    };
    const guardedSetItem = function hobunjiQuotaGuardedSetItem(key, value) {
      key = String(key);
      value = String(value);
      try {
        const result = originalSetItem.call(this, key, value);
        if (this === window.localStorage) {
          folderStaging.delete(key);
          if (key === SAVE_META_KEY) { saveMetaRevision++; noteLocaleWrite(value); }
        }
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
            if (key === SAVE_META_KEY) { saveMetaRevision++; noteLocaleWrite(value); }
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
          if (key === SAVE_META_KEY) { saveMetaRevision++; noteLocaleWrite(value); }
          return;
        }
        stats.unresolved += 1;
        throw error;
      }
    };
    guardedSetItem.__hobunjiQuotaGuard = true;
    proto.setItem = guardedSetItem;
    window.addEventListener?.('storage', event => {
      if (event.storageArea === window.localStorage && (event.key === SAVE_META_KEY || event.key === null)) {
        saveMetaRevision++;
        noteLocaleWrite(event.key === null ? null : event.newValue, event.key === null); // Cross-tab restore/delete.
      }
    });
    try {
      guardedLocalStorage = window.localStorage;
      lastLocaleSections = localeSections(originalGetItem.call(guardedLocalStorage, SAVE_META_KEY)); // One boot-time read, no JSON.parse.
    } catch (_) {}
    return true;
  }

  window.HobunjiStorageQuota = {
    install,
    isQuotaError,
    CHECKPOINT_EVICTION_ORDER,
    hasStagedValues: () => folderStaging.size > 0,
    getSaveMetaRevision() {
      try {
        if (guardedLocalStorage && guardedLocalStorage === window.localStorage) return saveMetaRevision;
      } catch (_) {}
      return undefined;
    },
    getSaveMetaLocaleRevision() {
      try {
        if (guardedLocalStorage && guardedLocalStorage === window.localStorage && lastLocaleSections !== undefined) return saveMetaLocaleRevision;
      } catch (_) {}
      return undefined; // Custom/preview storage uses the existing direct read path.
    },
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
