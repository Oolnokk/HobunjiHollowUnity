// Local Save Folder — an optional, best-effort mirror of hobunjiSaveMeta
// (the single localStorage blob every world/character save already lives
// in — see onboarding.js's SAVE_META_KEY, { version, characters: [...],
// worlds: [...] }) out to a real folder on disk via the File System Access
// API (Chromium-only; see isSupported()). localStorage stays the actual
// source of truth the game reads/writes during play — this only mirrors it
// out to disk periodically and on demand, as a portable/browsable backup,
// and can import it back.
//
// Each character and world is written as its OWN file (characters/<slug>-
// <id>.json, worlds/<slug>-<id>.json — see writeEntities), not one combined
// blob, so they're individually browsable/copyable/diffable outside the
// game. A small top-level manifest.json records the save-meta version plus
// counts for humans browsing the folder; loadFromFolder re-derives
// characters/worlds by re-scanning the two subfolders directly rather than
// trusting the manifest for content.
//
// What's cached, and where: ONLY the chosen folder's own
// FileSystemDirectoryHandle, in a tiny dedicated IndexedDB database
// (see DB_NAME/STORE below) — not the world/character save data itself,
// which already lives in localStorage and stays there. A handle is a
// structured-cloneable object IndexedDB can persist across sessions
// (localStorage can't hold one); the browser still requires re-confirming
// permission each session (see ensurePermission), which is why status can
// be 'needs-permission' even with a remembered folder. Re-picking a folder
// — whether none was chosen before, or the player wants to point somewhere
// else entirely ("correct the directory") — is the same chooseFolder call
// either way; see changeFolder.
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
  let _autoTimer = null;
  const _listeners = new Set();

  function getStatus() {
    return {
      supported: isSupported(),
      state: _state,
      folderName: _handle?.name || null,
      lastSyncedAt: _lastSyncedAt || null,
      lastError: _lastError || null,
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

  async function init() {
    if (!isSupported()) { _state = 'unsupported'; notify(); return; }
    try {
      const saved = await idbGet(HANDLE_KEY);
      if (!saved) { _state = 'not-configured'; notify(); return; }
      _handle = saved;
      _state = (await ensurePermission(_handle, false)) ? 'ready' : 'needs-permission';
    } catch (e) {
      _state = 'error'; _lastError = String(e?.message || e);
    }
    notify();
    if (_state === 'ready') startAutoSync();
  }

  // Must run from a real user gesture (a button click) — the File System
  // Access API refuses to prompt otherwise.
  async function chooseFolder() {
    if (!isSupported()) return getStatus();
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      _handle = handle;
      await idbSet(HANDLE_KEY, handle);
      _state = 'ready'; _lastError = '';
      notify();
      await syncNow();
      startAutoSync();
    } catch (e) {
      if (e?.name !== 'AbortError') { _state = 'error'; _lastError = String(e?.message || e); notify(); }
    }
    return getStatus();
  }

  // Same call as chooseFolder, kept as a distinctly-named action so the
  // settings UI can offer "Change Folder" once one's already configured,
  // without implying anything different happens under the hood.
  const changeFolder = chooseFolder;

  // Re-requests permission on the already-remembered handle without
  // re-opening the picker — the normal path back to 'ready' after a fresh
  // page load (browsers don't remember a granted permission across
  // sessions, only the handle itself).
  async function reconnect() {
    if (!_handle) return chooseFolder();
    try {
      const granted = await ensurePermission(_handle, true);
      _state = granted ? 'ready' : 'needs-permission';
      notify();
      if (granted) { await syncNow(); startAutoSync(); }
    } catch (e) { _state = 'error'; _lastError = String(e?.message || e); notify(); }
    return getStatus();
  }

  async function forget() {
    stopAutoSync();
    _handle = null; _state = 'not-configured'; _lastError = ''; _lastSyncedAt = 0;
    try { await idbDelete(HANDLE_KEY); } catch {}
    notify();
    return getStatus();
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

  async function syncNow() {
    if (_state !== 'ready' || !_handle) return getStatus();
    try {
      const raw = localStorage.getItem(SAVE_META_KEY);
      if (raw != null) {
        const meta = JSON.parse(raw);
        await writeEntities(CHARACTERS_DIR, meta.characters || [], 'nickname');
        await writeEntities(WORLDS_DIR, meta.worlds || [], 'label');
        await writeJsonFile(_handle, MANIFEST_FILE_NAME, {
          version: meta.version ?? 1, savedAt: Date.now(),
          characterCount: (meta.characters || []).length, worldCount: (meta.worlds || []).length,
        });
        try { await _handle.removeEntry(LEGACY_SAVE_FILE_NAME); } catch { /* fine if it never existed */ }
        _lastSyncedAt = Date.now();
      }
      _lastError = '';
    } catch (e) {
      _lastError = String(e?.message || e);
    }
    notify();
    return getStatus();
  }

  // Overwrites localStorage's hobunjiSaveMeta with whatever's in the
  // folder's characters/ and worlds/ subfolders (not the manifest, which is
  // informational only) — destructive to whatever's currently active, so
  // the caller (the settings UI) is expected to confirm with the player
  // before calling this.
  async function loadFromFolder() {
    if (_state !== 'ready' || !_handle) return { ok: false, message: 'No local save folder connected.' };
    try {
      const characters = await readEntities(CHARACTERS_DIR);
      const worlds = await readEntities(WORLDS_DIR);
      if (!characters.length && !worlds.length) {
        return { ok: false, message: 'No characters or worlds found in this folder.' };
      }
      let version = 1;
      try {
        const manifestFile = await (await _handle.getFileHandle(MANIFEST_FILE_NAME)).getFile();
        version = JSON.parse(await manifestFile.text())?.version ?? 1;
      } catch { /* manifest is informational only; fall back to version 1 */ }
      localStorage.setItem(SAVE_META_KEY, JSON.stringify({ version, characters, worlds }));
      _lastSyncedAt = Date.now(); _lastError = '';
      notify();
      return { ok: true, message: `Loaded ${characters.length} character(s) and ${worlds.length} world(s) from the local folder. Reload the page to apply it.` };
    } catch (e) {
      _lastError = String(e?.message || e); notify();
      return { ok: false, message: 'Could not load from the local folder: ' + _lastError };
    }
  }

  // Best-effort only — an async file write isn't guaranteed to finish
  // during unload. The periodic timer and the explicit "Save Now" button
  // are the real mechanism; this just doesn't hurt to try.
  window.addEventListener('beforeunload', () => { if (_state === 'ready') syncNow(); });

  window.LocalSaveFolder = {
    isSupported, getStatus, onChange,
    chooseFolder, changeFolder, reconnect, forget,
    syncNow, loadFromFolder,
  };

  init();
})();
