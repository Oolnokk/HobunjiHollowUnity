// Local Save Folder — portable save backend for Hobunji Hollow.
//
// The game still reads/writes localStorage synchronously during play, but a
// connected folder is authoritative when it already contains a save. Existing
// characters/worlds and any portable per-world farm layouts are restored into
// localStorage before browser -> folder mirroring starts. A genuinely empty
// folder is initialized from the browser instead.
//
// Save payload on disk:
//   characters/<name>-<id>.json
//   worlds/<name>-<id>.json
//   farm-layouts/<world-id>.json
//   manifest.json
//
// Farm layout is intentionally separate because game.js stores physical farm
// state under hobunji_farm_layout_v3:<worldId>, not inside hobunjiSaveMeta.
// Older folders that predate farm-layout portability are never auto-upgraded:
// automatic syncing keeps their metadata current but does not invent a farm
// layout from whichever device happens to reconnect first. Use the explicit
// Save Now action once on the device that has the correct farm to upgrade one.
(() => {
  "use strict";

  const DB_NAME = 'hobunji-local-save-folder';
  const STORE = 'handles';
  const HANDLE_KEY = 'dir';
  const CHARACTERS_DIR = 'characters';
  const WORLDS_DIR = 'worlds';
  const FARM_LAYOUTS_DIR = 'farm-layouts';
  const MANIFEST_FILE_NAME = 'manifest.json';
  const LEGACY_SAVE_FILE_NAME = 'hobunji-save.json'; // pre-per-file format; cleaned up if found
  const SAVE_META_KEY = 'hobunjiSaveMeta';
  const FARM_LAYOUT_KEY_PREFIX = 'hobunji_farm_layout_v3:';
  const PORTABLE_SAVE_VERSION = 2;
  const AUTO_SYNC_MS = 30000;
  const CHANGE_POLL_MS = 1000;

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unnamed';
  }

  function safeFilenamePart(s) {
    return String(s || 'world')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 120) || 'world';
  }

  function farmLayoutKey(worldId) {
    return FARM_LAYOUT_KEY_PREFIX + worldId;
  }

  function farmLayoutFilename(worldId) {
    return safeFilenamePart(worldId) + '.json';
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
  let _lastAction = 'none'; // Used by Settings/debug UI to explain the most recent folder decision.
  let _farmLayoutCount = 0;
  let _folderSupportsFarmLayouts = false; // Gates automatic creation of layout files for legacy folders.
  let _autoTimer = null;
  let _changePollTimer = null;
  let _lastObservedFingerprint = null; // Used by the change poll to avoid unnecessary filesystem writes.
  let _syncPromise = null; // Serializes folder writes so rapid save changes cannot overlap createWritable calls.
  const _listeners = new Set();

  function getStatus() {
    return {
      supported: isSupported(),
      state: _state,
      folderName: _handle?.name || null,
      lastSyncedAt: _lastSyncedAt || null,
      lastError: _lastError || null,
      lastAction: _lastAction,
      farmLayoutCount: _farmLayoutCount,
      portableFarmLayouts: _folderSupportsFarmLayouts,
      needsFarmLayoutUpgrade: _state === 'ready' && !_folderSupportsFarmLayouts,
    };
  }

  function notify() {
    for (const fn of _listeners) {
      try { fn(getStatus()); } catch {}
    }
  }

  function onChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }

  async function ensurePermission(handle, requestIfNeeded) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (!requestIfNeeded) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  function stopAutoSync() {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
    if (_changePollTimer) { clearInterval(_changePollTimer); _changePollTimer = null; }
  }

  function startAutoSync() {
    stopAutoSync();
    _lastObservedFingerprint = browserFingerprint(_folderSupportsFarmLayouts);
    _autoTimer = setInterval(() => { syncNow({ automatic: true }); }, AUTO_SYNC_MS);
    _changePollTimer = setInterval(() => {
      if (_state !== 'ready') return;
      const nextFingerprint = browserFingerprint(_folderSupportsFarmLayouts);
      if (nextFingerprint === _lastObservedFingerprint) return;
      _lastObservedFingerprint = nextFingerprint;
      syncNow({ automatic: true });
    }, CHANGE_POLL_MS);
  }

  async function writeJsonFile(dirHandle, filename, data) {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
  }

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

  function readBrowserFarmLayouts(meta, strict = false) {
    const layouts = {};
    for (const world of (meta?.worlds || [])) {
      if (!world?.id) continue;
      const raw = localStorage.getItem(farmLayoutKey(world.id));
      if (raw == null) continue;
      try {
        layouts[world.id] = JSON.parse(raw);
      } catch (e) {
        if (strict) throw new Error(`Farm layout for world "${world.label || world.id}" is unreadable: ${String(e?.message || e)}`);
      }
    }
    return layouts;
  }

  function browserFingerprint(includeFarmLayouts) {
    const metaRaw = localStorage.getItem(SAVE_META_KEY) || '';
    if (!includeFarmLayouts) return metaRaw;
    let meta;
    try { meta = metaRaw ? JSON.parse(metaRaw) : null; } catch { return metaRaw; }
    const parts = [metaRaw];
    for (const world of (meta?.worlds || [])) {
      if (!world?.id) continue;
      parts.push(world.id, localStorage.getItem(farmLayoutKey(world.id)) || '');
    }
    return parts.join('\u001f');
  }

  async function readFolderFarmLayouts() {
    const layouts = {};
    const corruptFiles = [];
    let dirHandle;
    try {
      dirHandle = await _handle.getDirectoryHandle(FARM_LAYOUTS_DIR);
    } catch {
      return { dirExists: false, layouts, corruptFiles };
    }

    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file') continue;
      try {
        const payload = JSON.parse(await (await entry.getFile()).text());
        if (!payload || typeof payload.worldId !== 'string' || !payload.worldId || !payload.layout || typeof payload.layout !== 'object') {
          corruptFiles.push(name);
          continue;
        }
        layouts[payload.worldId] = payload.layout;
      } catch {
        corruptFiles.push(name);
      }
    }
    return { dirExists: true, layouts, corruptFiles };
  }

  async function writeFarmLayouts(meta, layouts, allowCreate) {
    let dirHandle;
    try {
      dirHandle = await _handle.getDirectoryHandle(FARM_LAYOUTS_DIR, { create: allowCreate });
    } catch {
      return 0;
    }

    const worldIds = new Set((meta?.worlds || []).map(w => String(w?.id || '')).filter(Boolean));
    let written = 0;
    for (const worldId of worldIds) {
      if (!Object.prototype.hasOwnProperty.call(layouts, worldId)) continue;
      const filename = farmLayoutFilename(worldId);
      if (!allowCreate) {
        try { await dirHandle.getFileHandle(filename); } catch { continue; }
      }
      await writeJsonFile(dirHandle, filename, { worldId, layout: layouts[worldId] });
      written++;
    }

    // Remove only parseable layout files for worlds that no longer exist.
    // Unknown/corrupt files are preserved so automatic cleanup cannot destroy
    // the only recoverable copy of damaged user data.
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file') continue;
      try {
        const payload = JSON.parse(await (await entry.getFile()).text());
        if (payload?.worldId && !worldIds.has(String(payload.worldId))) {
          await dirHandle.removeEntry(name);
        }
      } catch { /* preserve unreadable files */ }
    }
    return written;
  }

  async function readFolderSnapshot() {
    const characters = await readEntities(CHARACTERS_DIR);
    const worlds = await readEntities(WORLDS_DIR);
    const farm = await readFolderFarmLayouts();
    let manifest = null;
    let manifestExists = false;
    try {
      const manifestFile = await (await _handle.getFileHandle(MANIFEST_FILE_NAME)).getFile();
      manifestExists = true;
      manifest = JSON.parse(await manifestFile.text());
    } catch (e) {
      if (e?.name !== 'NotFoundError') {
        throw new Error('Could not read manifest.json: ' + String(e?.message || e));
      }
    }

    const portableVersion = Number(manifest?.portableSaveVersion) || 1;
    const hasPortableFarmLayouts = portableVersion >= PORTABLE_SAVE_VERSION || Object.keys(farm.layouts).length > 0;
    return {
      exists: manifestExists || characters.length > 0 || worlds.length > 0,
      savedAt: Number(manifest?.savedAt) || 0,
      portableVersion,
      hasPortableFarmLayouts,
      corruptFarmLayoutFiles: farm.corruptFiles,
      meta: {
        version: manifest?.version ?? 1,
        characters,
        worlds,
      },
      farmLayouts: farm.layouts,
    };
  }

  function folderFarmLayoutsDiffer(browserMeta, folderMeta, browserLayouts, folderLayouts) {
    const validWorldIds = new Set((folderMeta?.worlds || []).map(w => String(w?.id || '')).filter(Boolean));
    for (const [worldId, folderLayout] of Object.entries(folderLayouts || {})) {
      if (!validWorldIds.has(worldId)) continue;
      if (!Object.prototype.hasOwnProperty.call(browserLayouts, worldId)) return true;
      if (JSON.stringify(browserLayouts[worldId]) !== JSON.stringify(folderLayout)) return true;
    }
    return false;
  }

  async function _syncNowImpl({ automatic = false } = {}) {
    if (_state !== 'ready' || !_handle) return getStatus();
    try {
      const raw = localStorage.getItem(SAVE_META_KEY);
      if (raw != null) {
        const meta = JSON.parse(raw);
        const farmLayouts = readBrowserFarmLayouts(meta, true);
        const includeFarmLayouts = !automatic || _folderSupportsFarmLayouts;

        await writeEntities(CHARACTERS_DIR, meta.characters || [], 'nickname');
        await writeEntities(WORLDS_DIR, meta.worlds || [], 'label');
        if (includeFarmLayouts) {
          _farmLayoutCount = await writeFarmLayouts(meta, farmLayouts, true);
          _folderSupportsFarmLayouts = true;
        }

        const savedAt = Date.now();
        await writeJsonFile(_handle, MANIFEST_FILE_NAME, {
          version: meta.version ?? 1,
          portableSaveVersion: _folderSupportsFarmLayouts ? PORTABLE_SAVE_VERSION : 1,
          farmLayoutsIncluded: _folderSupportsFarmLayouts,
          savedAt,
          characterCount: (meta.characters || []).length,
          worldCount: (meta.worlds || []).length,
          farmLayoutCount: _farmLayoutCount,
        });
        try { await _handle.removeEntry(LEGACY_SAVE_FILE_NAME); } catch { /* fine if it never existed */ }
        _lastSyncedAt = savedAt;
        _lastAction = automatic ? 'autosaved-browser-to-folder' : 'saved-browser-to-folder';
        _lastError = '';
        _lastObservedFingerprint = browserFingerprint(_folderSupportsFarmLayouts);
      }
    } catch (e) {
      _lastError = String(e?.message || e);
      _lastAction = 'save-error';
    }
    notify();
    return getStatus();
  }

  async function syncNow(options = {}) {
    if (_syncPromise) return _syncPromise;
    _syncPromise = _syncNowImpl(options).finally(() => { _syncPromise = null; });
    return _syncPromise;
  }

  function reloadAfterFolderRestore() {
    setTimeout(() => location.reload(), 0);
  }

  async function reconcileConnectedFolder({ reloadIfChanged = true } = {}) {
    if (_state !== 'ready' || !_handle) {
      return { ok: false, action: 'not-ready', changed: false, message: 'No local save folder connected.' };
    }
    try {
      const folder = await readFolderSnapshot();
      if (!folder.exists) {
        _folderSupportsFarmLayouts = true;
        _lastAction = 'initialized-empty-folder';
        await syncNow({ automatic: false });
        return { ok: true, action: 'initialized-empty-folder', changed: false, message: 'Initialized the empty folder from this browser save.' };
      }

      const browserMeta = readBrowserMeta();
      const browserLayouts = readBrowserFarmLayouts(browserMeta, false);
      const metaChanged = !browserMeta || !saveMetaMatches(browserMeta, folder.meta);
      const layoutsChanged = folderFarmLayoutsDiffer(browserMeta, folder.meta, browserLayouts, folder.farmLayouts);
      const changed = metaChanged || layoutsChanged;

      localStorage.setItem(SAVE_META_KEY, JSON.stringify(folder.meta));
      const validWorldIds = new Set((folder.meta.worlds || []).map(w => String(w?.id || '')).filter(Boolean));
      for (const [worldId, layout] of Object.entries(folder.farmLayouts || {})) {
        if (!validWorldIds.has(worldId)) continue;
        localStorage.setItem(farmLayoutKey(worldId), JSON.stringify(layout));
      }

      _folderSupportsFarmLayouts = folder.hasPortableFarmLayouts && folder.corruptFarmLayoutFiles.length === 0;
      _farmLayoutCount = Object.keys(folder.farmLayouts || {}).filter(id => validWorldIds.has(id)).length;
      _lastSyncedAt = folder.savedAt || Date.now();
      _lastError = folder.corruptFarmLayoutFiles.length
        ? `Skipped corrupt farm layout file(s): ${folder.corruptFarmLayoutFiles.join(', ')}. Use Save Now only if this browser has the correct farm.`
        : '';
      _lastAction = changed
        ? 'loaded-folder-to-browser'
        : (_folderSupportsFarmLayouts ? 'folder-already-current' : 'legacy-folder-missing-farm-layouts');
      _lastObservedFingerprint = browserFingerprint(_folderSupportsFarmLayouts);
      notify();

      if (changed && reloadIfChanged) reloadAfterFolderRestore();
      return {
        ok: true,
        action: _lastAction,
        changed,
        reloadScheduled: changed && reloadIfChanged,
        needsFarmLayoutUpgrade: !_folderSupportsFarmLayouts,
        message: changed
          ? `Loaded ${folder.meta.characters.length} character(s), ${folder.meta.worlds.length} world(s), and ${_farmLayoutCount} farm layout(s) from the local folder.`
          : (_folderSupportsFarmLayouts
            ? 'The browser save already matches the local folder.'
            : 'Characters/worlds match, but this older folder has no portable farm layouts yet. Use Save Now on the device with the correct farm before moving it.'),
      };
    } catch (e) {
      _lastError = String(e?.message || e);
      _lastAction = 'reconcile-error';
      notify();
      return { ok: false, action: _lastAction, changed: false, message: 'Could not reconcile the local save folder: ' + _lastError };
    }
  }

  async function init() {
    if (!isSupported()) {
      _state = 'unsupported';
      _lastAction = 'unsupported';
      notify();
      return;
    }
    try {
      const saved = await idbGet(HANDLE_KEY);
      if (!saved) {
        _state = 'not-configured';
        _lastAction = 'not-configured';
        notify();
        return;
      }
      _handle = saved;
      _state = (await ensurePermission(_handle, false)) ? 'ready' : 'needs-permission';
      _lastAction = _state === 'ready' ? 'remembered-folder-ready' : 'permission-needed';
      notify();
      if (_state === 'ready') {
        const result = await reconcileConnectedFolder({ reloadIfChanged: true });
        if (result.ok) startAutoSync();
      }
    } catch (e) {
      _state = 'error';
      _lastError = String(e?.message || e);
      _lastAction = 'init-error';
      notify();
    }
  }

  async function chooseFolder() {
    if (!isSupported()) return getStatus();
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      _handle = handle;
      await idbSet(HANDLE_KEY, handle);
      _state = 'ready';
      _lastError = '';
      _lastAction = 'folder-chosen';
      notify();
      const result = await reconcileConnectedFolder({ reloadIfChanged: true });
      if (result.ok) startAutoSync();
    } catch (e) {
      if (e?.name !== 'AbortError') {
        _state = 'error';
        _lastError = String(e?.message || e);
        _lastAction = 'choose-error';
        notify();
      }
    }
    return getStatus();
  }

  const changeFolder = chooseFolder;

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
      _state = 'error';
      _lastError = String(e?.message || e);
      _lastAction = 'reconnect-error';
      notify();
    }
    return getStatus();
  }

  async function forget() {
    stopAutoSync();
    _handle = null;
    _state = 'not-configured';
    _lastError = '';
    _lastSyncedAt = 0;
    _lastAction = 'forgot-folder';
    _farmLayoutCount = 0;
    _folderSupportsFarmLayouts = false;
    _lastObservedFingerprint = null;
    try { await idbDelete(HANDLE_KEY); } catch {}
    notify();
    return getStatus();
  }

  async function loadFromFolder() {
    const result = await reconcileConnectedFolder({ reloadIfChanged: false });
    if (!result.ok) return result;
    if (result.action === 'initialized-empty-folder') {
      return { ok: false, message: 'This folder did not contain a save, so it was initialized from the browser instead.' };
    }
    return {
      ok: true,
      message: result.changed ? result.message + ' Reload the page to apply it.' : result.message,
    };
  }

  window.addEventListener('beforeunload', () => {
    if (_state === 'ready') syncNow({ automatic: true });
  });

  window.LocalSaveFolder = {
    isSupported,
    getStatus,
    onChange,
    chooseFolder,
    changeFolder,
    reconnect,
    forget,
    syncNow,
    loadFromFolder,
    reconcileConnectedFolder,
  };

  init();
})();
