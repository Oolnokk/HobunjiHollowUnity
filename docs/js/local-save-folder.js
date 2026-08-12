// Local Save Folder — an optional real-folder save backend for hobunjiSaveMeta.
//
// Runtime saves still use localStorage because the rest of the game reads and
// writes hobunjiSaveMeta synchronously. Once a folder is connected, however,
// that folder is authoritative at connection/startup: existing folder data is
// loaded into localStorage BEFORE periodic browser -> folder mirroring begins.
// A genuinely new/empty folder is initialized from the browser save instead.
// This prevents Connect/Reconnect from overwriting a portable save before the
// game has had a chance to restore it.
//
// Each character and world is written as its OWN file (characters/<slug>-
// <id>.json, worlds/<slug>-<id>.json — see writeEntities), not one combined
// blob, so they're individually browsable/copyable/diffable outside the game.
// A small top-level manifest.json records the save-meta version plus counts.
// Folder loads re-scan the two subfolders directly rather than trusting the
// manifest for content.
//
// Only the chosen FileSystemDirectoryHandle is cached in IndexedDB. Save data
// itself lives in localStorage during runtime and in the selected real folder.
(() => {
  "use strict";
  const DB_NAME = 'hobunji-local-save-folder';
  const STORE = 'handles';
  const HANDLE_KEY = 'dir';
  const CHARACTERS_DIR = 'characters';
  const WORLDS_DIR = 'worlds';
  const MANIFEST_FILE_NAME = 'manifest.json';
  const LEGACY_SAVE_FILE_NAME = 'hobunji-save.json'; // pre-per-file format; cleaned up if found
  const SAVE_META_KEY = 'hobunjiSaveMeta';
  const AUTO_SYNC_MS = 30000;

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unnamed';
  }

  function isSupported() {
    return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // state: 'unsupported' | 'not-configured' | 'needs-permission' | 'ready' | 'error'
  let _handle = null;
  let _state = 'unsupported';
  let _lastError = '';
  let _lastSyncedAt = 0;
  let _lastAction = 'none'; // Shown through getStatus() so the save UI/debug tools can report the last folder decision.
  let _autoTimer = null;
  const _listeners = new Set();

  function getStatus() {
    return {
      supported: isSupported(),
      state: _state,
      folderName: _handle?.name || null,
      lastSyncedAt: _lastSyncedAt || null,
      lastError: _lastError || null,
      lastAction: _lastAction,
    };
  }

  function notify() { for (const fn of _listeners) { try { fn(getStatus()); } catch {} } }
  function onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

  async function ensurePermission(handle, requestIfNeeded) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (!requestIfNeeded) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  function startAutoSync() {
    stopAutoSync();
    _autoTimer = setInterval(() => { syncNow(); }, AUTO_SYNC_MS);
  }
  function stopAutoSync() {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
  }

  async function writeJsonFile(dirHandle, filename, data) {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
  }

  // Writes one file per entity (keyed by slugified name + id, so a rename
  // doesn't orphan the old file — see the stale-file sweep below) into
  // dirName, then removes any file in dirName that no longer corresponds to
  // a current entity (a deleted character/world, or one renamed since the
  // last sync).
  async function writeEntities(dirName, entities, nameField) {
    const dirHandle = await _handle.getDirectoryHandle(dirName, { create: true });
    const keep = new Set();
    for (const entity of entities) {
      const filename = `${slugify(entity[nameField])}-${entity.id}.json`;
      keep.add(filename);
      await writeJsonFile(dirHandle, filename, entity);
    }
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && !keep.has(name)) {
        try { await dirHandle.removeEntry(name); } catch {}
      }
    }
  }

  async function readEntities(dirName) {
    const entities = [];
    let dirHandle;
    try { dirHandle = await _handle.getDirectoryHandle(dirName); } catch { return entities; }
    for await (const [, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file') continue;
      try { entities.push(JSON.parse(await (await entry.getFile()).text())); } catch { /* skip unreadable/corrupt entry */ }
    }
    return entities;
  }

  function normalizeMetaForCompare(meta) {
    // Sorted copies keep folder directory iteration order from causing false conflicts/reload loops.
    const byId = (items) => [...(items || [])].sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
    return {
      version: meta?.version ?? 1,
      characters: byId(meta?.characters),
      worlds: byId(meta?.worlds),
    };
  }

  function saveMetaMatches(a, b) {
    return JSON.stringify(normalizeMetaForCompare(a)) === JSON.stringify(normalizeMetaForCompare(b));
  }

  function readBrowserMeta() {
    const raw = localStorage.getItem(SAVE_META_KEY);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async function readFolderSnapshot() {
    // Entity files are the actual folder save payload; manifest only supplies version/time metadata.
    const characters = await readEntities(CHARACTERS_DIR);
    const worlds = await readEntities(WORLDS_DIR);
    let manifest = null;
    let manifestExists = false; // Distinguishes a deliberately initialized empty save from a brand-new folder.
    try {
      const manifestFile = await (await _handle.getFileHandle(MANIFEST_FILE_NAME)).getFile();
      manifestExists = true;
      manifest = JSON.parse(await manifestFile.text());
    } catch (e) {
      if (e?.name !== 'NotFoundError') {
        throw new Error('Could not read manifest.json: ' + String(e?.message || e));
      }
    }
    return {
      exists: manifestExists || characters.length > 0 || worlds.length > 0,
      savedAt: Number(manifest?.savedAt) || 0,
      meta: {
        version: manifest?.version ?? 1,
        characters,
        worlds,
      },
    };
  }

  async function syncNow() {
    if (_state !== 'ready' || !_handle) return getStatus();
    try {
      const raw = localStorage.getItem(SAVE_META_KEY);
      if (raw != null) {
        const meta = JSON.parse(raw);
        await writeEntities(CHARACTERS_DIR, meta.characters || [], 'nickname');
        await writeEntities(WORLDS_DIR, meta.worlds || [], 'label');
        const savedAt = Date.now(); // Reused for the manifest and UI's last-synced timestamp.
        await writeJsonFile(_handle, MANIFEST_FILE_NAME, {
          version: meta.version ?? 1, savedAt,
          characterCount: (meta.characters || []).length, worldCount: (meta.worlds || []).length,
        });
        try { await _handle.removeEntry(LEGACY_SAVE_FILE_NAME); } catch { /* fine if it never existed */ }
        _lastSyncedAt = savedAt;
        _lastAction = 'saved-browser-to-folder';
      }
      _lastError = '';
    } catch (e) {
      _lastError = String(e?.message || e);
      _lastAction = 'save-error';
    }
    notify();
    return getStatus();
  }

  function reloadAfterFolderRestore() {
    // Delay lets the click/init promise settle and prevents folder->browser restore from racing a subsequent write.
    setTimeout(() => location.reload(), 0);
  }

  async function reconcileConnectedFolder({ reloadIfChanged = true } = {}) {
    if (_state !== 'ready' || !_handle) {
      return { ok: false, action: 'not-ready', changed: false, message: 'No local save folder connected.' };
    }
    try {
      const folder = await readFolderSnapshot();
      if (!folder.exists) {
        // A truly new folder has no manifest/entity files, so seed it from the current browser save instead of loading emptiness.
        _lastAction = 'initialized-empty-folder';
        await syncNow();
        return { ok: true, action: 'initialized-empty-folder', changed: false, message: 'Initialized the empty folder from this browser save.' };
      }

      const browserMeta = readBrowserMeta(); // Used only to decide whether the restored folder requires a one-time reload.
      const changed = !browserMeta || !saveMetaMatches(browserMeta, folder.meta);
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(folder.meta));
      _lastSyncedAt = folder.savedAt || Date.now();
      _lastError = '';
      _lastAction = changed ? 'loaded-folder-to-browser' : 'folder-already-current';
      notify();

      if (changed && reloadIfChanged) reloadAfterFolderRestore();
      return {
        ok: true,
        action: _lastAction,
        changed,
        reloadScheduled: changed && reloadIfChanged,
        message: changed
          ? `Loaded ${folder.meta.characters.length} character(s) and ${folder.meta.worlds.length} world(s) from the local folder.`
          : 'The browser save already matches the local folder.',
      };
    } catch (e) {
      _lastError = String(e?.message || e);
      _lastAction = 'reconcile-error';
      notify();
      return { ok: false, action: _lastAction, changed: false, message: 'Could not reconcile the local save folder: ' + _lastError };
    }
  }

  async function init() {
    if (!isSupported()) { _state = 'unsupported'; _lastAction = 'unsupported'; notify(); return; }
    try {
      const saved = await idbGet(HANDLE_KEY);
      if (!saved) { _state = 'not-configured'; _lastAction = 'not-configured'; notify(); return; }
      _handle = saved;
      _state = (await ensurePermission(_handle, false)) ? 'ready' : 'needs-permission';
      _lastAction = _state === 'ready' ? 'remembered-folder-ready' : 'permission-needed';
      notify();
      if (_state === 'ready') {
        const result = await reconcileConnectedFolder({ reloadIfChanged: true });
        if (result.ok) startAutoSync();
      }
    } catch (e) {
      _state = 'error'; _lastError = String(e?.message || e); _lastAction = 'init-error';
      notify();
    }
  }

  // Must run from a real user gesture (a button click) — the File System
  // Access API refuses to prompt otherwise. Existing folder saves are loaded
  // before any browser -> folder write; empty folders are initialized instead.
  async function chooseFolder() {
    if (!isSupported()) return getStatus();
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      _handle = handle;
      await idbSet(HANDLE_KEY, handle);
      _state = 'ready'; _lastError = ''; _lastAction = 'folder-chosen';
      notify();
      const result = await reconcileConnectedFolder({ reloadIfChanged: true });
      if (result.ok) startAutoSync();
    } catch (e) {
      if (e?.name !== 'AbortError') {
        _state = 'error'; _lastError = String(e?.message || e); _lastAction = 'choose-error'; notify();
      }
    }
    return getStatus();
  }

  // Same call as chooseFolder, kept as a distinctly-named action so the
  // settings UI can offer "Change Folder" once one's already configured.
  const changeFolder = chooseFolder;

  // Re-requests permission on the already-remembered handle. Once granted,
  // reconcileConnectedFolder loads disk first, so reconnect can no longer
  // overwrite an existing folder with stale browser storage.
  async function reconnect() {
    if (!_handle) return chooseFolder();
    try {
      const granted = await ensurePermission(_handle, true);
      _state = granted ? 'ready' : 'needs-permission';
      _lastAction = granted ? 'permission-restored' : 'permission-needed';
      notify();
      if (granted) {
        const result = await reconcileConnectedFolder({ reloadIfChanged: true });
        if (result.ok) startAutoSync();
      }
    } catch (e) {
      _state = 'error'; _lastError = String(e?.message || e); _lastAction = 'reconnect-error'; notify();
    }
    return getStatus();
  }

  async function forget() {
    stopAutoSync();
    _handle = null; _state = 'not-configured'; _lastError = ''; _lastSyncedAt = 0; _lastAction = 'forgot-folder';
    try { await idbDelete(HANDLE_KEY); } catch {}
    notify();
    return getStatus();
  }

  // Explicit manual restore retained for the existing UI. Normal
  // Choose/Reconnect now perform this automatically, but this remains useful
  // as a deliberate "restore from disk again" action while already connected.
  async function loadFromFolder() {
    const result = await reconcileConnectedFolder({ reloadIfChanged: false });
    if (!result.ok) return result;
    if (result.action === 'initialized-empty-folder') {
      return { ok: false, message: 'This folder did not contain a save, so it was initialized from the browser instead.' };
    }
    return {
      ok: true,
      message: result.changed
        ? result.message + ' Reload the page to apply it.'
        : result.message,
    };
  }

  // Best-effort only — an async file write isn't guaranteed to finish during
  // unload. The periodic timer and explicit Save Now path remain the reliable
  // write mechanisms after the connection handshake has reconciled disk first.
  window.addEventListener('beforeunload', () => { if (_state === 'ready') syncNow(); });

  window.LocalSaveFolder = {
    isSupported, getStatus, onChange,
    chooseFolder, changeFolder, reconnect, forget,
    syncNow, loadFromFolder, reconcileConnectedFolder,
  };

  init();
})();
