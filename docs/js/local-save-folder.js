// Local Save Folder — an optional, best-effort mirror of hobunjiSaveMeta
// (the single localStorage blob every world/character save already lives
// in — see onboarding.js's SAVE_META_KEY) out to a real folder on disk via
// the File System Access API (Chromium-only; see isSupported()).
// localStorage stays the actual source of truth the game reads/writes
// during play — this only writes a JSON snapshot out to disk periodically
// and on demand, as a portable backup, and can import that snapshot back.
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
  const SAVE_FILE_NAME = 'hobunji-save.json';
  const SAVE_META_KEY = 'hobunjiSaveMeta';
  const AUTO_SYNC_MS = 30000;

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

  async function syncNow() {
    if (_state !== 'ready' || !_handle) return getStatus();
    try {
      const raw = localStorage.getItem(SAVE_META_KEY);
      if (raw != null) {
        const fileHandle = await _handle.getFileHandle(SAVE_FILE_NAME, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(raw);
        await writable.close();
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
  // folder's own snapshot file — destructive to whatever's currently
  // active, so the caller (the settings UI) is expected to confirm with
  // the player before calling this.
  async function loadFromFolder() {
    if (_state !== 'ready' || !_handle) return { ok: false, message: 'No local save folder connected.' };
    try {
      const fileHandle = await _handle.getFileHandle(SAVE_FILE_NAME);
      const file = await fileHandle.getFile();
      const text = await file.text();
      JSON.parse(text); // validates before touching localStorage
      localStorage.setItem(SAVE_META_KEY, text);
      _lastSyncedAt = Date.now(); _lastError = '';
      notify();
      return { ok: true, message: 'Loaded save from the local folder. Reload the page to apply it.' };
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
