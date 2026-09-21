// Local Save Folder — portable save backend for Hobunji Hollow.
//
// Runtime saves remain in localStorage. A connected folder mirrors character,
// world, and per-world farm-layout data so the same save can move between
// devices. Direction is intentionally explicit after permission is restored:
// Reconnect only reconnects access; Save Now pushes this browser to disk; Load
// from Folder pulls disk into this browser. This avoids a reconnect choosing the
// wrong side during migrations or device transfers.
(() => {
  "use strict";

  const DB_NAME = 'hobunji-local-save-folder';
  const STORE = 'handles';
  const HANDLE_KEY = 'dir';
  const CHARACTERS_DIR = 'characters';
  const WORLDS_DIR = 'worlds';
  const FARM_LAYOUTS_DIR = 'farm-layouts';
  const PATTERNS_DIR = 'patterns'; // Portable custom motif PNGs live here beside the canonical character/world save directories.
  const RECOVERY_DIR = 'recovery'; // Folder-first recovery history lives beside, but never replaces, the canonical save directories.
  const RECOVERY_FILES = Object.freeze({ // Stable recovery slot filenames used by the checkpoint manager and recovery UI.
    manual: 'manual.json',
    auto: 'autosave-latest.json',
    autoPrevious: 'autosave-previous.json',
    preRestore: 'pre-restore.json',
  });
  const MANIFEST_FILE_NAME = 'manifest.json';
  const LEGACY_SAVE_FILE_NAME = 'hobunji-save.json';
  const SAVE_META_KEY = 'hobunjiSaveMeta';
  const FARM_LAYOUT_KEY_PREFIX = 'hobunji_farm_layout_v3:';
  const PORTABLE_SAVE_VERSION = 2;
  const RECOVERY_SAVE_VERSION = 1; // Manifest/debug marker for the independent recovery directory format.
  const AUTO_SYNC_MS = 30000;
  const CHANGE_POLL_MS = 1000;

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'unnamed';
  }

  function safeFilenamePart(value) {
    return String(value || 'world')
      .replace(/[<>:\"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 120) || 'world';
  }

  function farmLayoutKey(worldId) {
    return FARM_LAYOUT_KEY_PREFIX + worldId;
  }

  function farmLayoutFilename(worldId) {
    return safeFilenamePart(worldId) + '.json';
  }

  function recoveryFilename(slot) {
    const filename = RECOVERY_FILES[slot]; // Whitelisted filename prevents arbitrary folder writes through the public recovery API.
    if (!filename) throw new Error(`Unknown recovery slot: ${String(slot)}`);
    return filename;
  }

  function isSupported() {
    return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
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

  let _handle = null;
  let _state = 'unsupported';
  let _lastError = '';
  let _lastSyncedAt = 0;
  let _lastAction = 'none'; // Used by Settings/debug UI to explain the last folder operation.
  let _farmLayoutCount = 0;
  let _folderSupportsFarmLayouts = false; // Used to decide whether autosync may write farm layout files.
  let _autoSyncArmed = false; // Used to prevent writes until the player explicitly chooses push or pull after reconnect.
  let _autoTimer = null;
  let _changePollTimer = null;
  let _lastObservedFingerprint = null; // Used by the change poll to skip filesystem writes when nothing changed.
  let _syncPromise = null; // Used to serialize filesystem writes so two save operations cannot overlap.
  let _lastKnownFolderMeta = null; // Last meta.json content known to actually be on disk; the data-loss guard's baseline.
  let _lastDataLossRisk = null; // Set when a push was skipped because it looked like it would destroy folder data.
  let _lastPatternMirror = null; // Most recent custom-motif portability result, surfaced through save diagnostics.
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
      autoSyncArmed: _autoSyncArmed,
      dataLossRisk: _lastDataLossRisk,
      patternMirror: _lastPatternMirror,
      recoverySaveVersion: RECOVERY_SAVE_VERSION,
    };
  }

  function jsonSize(value) {
    try { return JSON.stringify(value ?? null).length; } catch { return 0; }
  }

  // Every push (autosync included) overwrites the folder with whatever this
  // browser currently has. If this browser's own save was damaged (a bug, a
  // bad reset, an over-eager stale tab), that push would just as happily
  // carry the damage into the folder -- silently, since nothing previously
  // checked what was about to be destroyed. This compares the payload about
  // to be written against the last folder content we actually know about and
  // flags anything that looks like real data loss rather than a normal,
  // intentional change (deleting a character on purpose, using up an item).
  const DATA_LOSS_SHRINK_RATIO = 0.4; // an existing entity shrinking below 40% of its prior size is suspicious
  const DATA_LOSS_MIN_OLD_SIZE = 200; // ignore trivially small entities to avoid false positives on brand-new characters

  function describeDataLossRisk(oldMeta, newMeta) {
    if (!oldMeta) return null; // no known baseline yet (e.g. first push into this folder) -- nothing to protect

    const oldChars = oldMeta.characters || [];
    const newChars = newMeta.characters || [];
    const oldWorlds = oldMeta.worlds || [];
    const newWorlds = newMeta.worlds || [];

    if (oldChars.length > 0 && newChars.length < oldChars.length) {
      return `would remove ${oldChars.length - newChars.length} character(s) that exist in the folder save`;
    }
    if (oldWorlds.length > 0 && newWorlds.length < oldWorlds.length) {
      return `would remove ${oldWorlds.length - newWorlds.length} world(s) that exist in the folder save`;
    }

    const newCharById = new Map(newChars.filter(c => c?.id).map(c => [c.id, c]));
    for (const oldChar of oldChars) {
      if (!oldChar?.id) continue;
      const newChar = newCharById.get(oldChar.id);
      if (!newChar) continue;
      const oldSize = jsonSize(oldChar);
      if (oldSize >= DATA_LOSS_MIN_OLD_SIZE && jsonSize(newChar) < oldSize * DATA_LOSS_SHRINK_RATIO) {
        return `"${oldChar.nickname || oldChar.id}" would shrink drastically (looks like lost inventory or progress)`;
      }
    }

    const newWorldById = new Map(newWorlds.filter(w => w?.id).map(w => [w.id, w]));
    for (const oldWorld of oldWorlds) {
      if (!oldWorld?.id) continue;
      const newWorld = newWorldById.get(oldWorld.id);
      if (!newWorld) continue;
      const oldSize = jsonSize(oldWorld);
      if (oldSize >= DATA_LOSS_MIN_OLD_SIZE && jsonSize(newWorld) < oldSize * DATA_LOSS_SHRINK_RATIO) {
        return `"${oldWorld.label || oldWorld.id}" would shrink drastically (looks like lost farm/world data)`;
      }
    }

    return null;
  }

  function notify() {
    const status = getStatus();
    for (const listener of _listeners) {
      try { listener(status); } catch {}
    }
  }

  function onChange(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  }

  async function ensurePermission(handle, requestIfNeeded) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (!requestIfNeeded) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  function stopAutoSync() {
    _autoSyncArmed = false;
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
    if (_changePollTimer) { clearInterval(_changePollTimer); _changePollTimer = null; }
  }

  function startAutoSync() {
    if (_state !== 'ready' || !_handle) return;
    if (_autoTimer) clearInterval(_autoTimer);
    if (_changePollTimer) clearInterval(_changePollTimer);
    _autoSyncArmed = true;
    _lastObservedFingerprint = browserFingerprint(_folderSupportsFarmLayouts);
    _autoTimer = setInterval(() => { syncNow({ automatic: true }); }, AUTO_SYNC_MS);
    _changePollTimer = setInterval(() => {
      if (_state !== 'ready' || !_autoSyncArmed) return;
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

  async function readJsonFile(dirHandle, filename) {
    try {
      const file = await (await dirHandle.getFileHandle(filename)).getFile();
      return JSON.parse(await file.text());
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }


  function patternFilename(id) {
    const value = String(id || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value) || value.includes('..')) throw new Error('Invalid custom pattern id.');
    return value + '.png';
  }

  async function mirrorPatternFile(id, bytes) {
    if (_state !== 'ready' || !_handle) return false;
    if (!(await ensurePermission(_handle, false))) return false;
    const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0); // MotifStore supplies Uint8Array PNG bytes; this also accepts other ArrayBuffer views safely.
    if (!payload.byteLength) return false;
    const dirHandle = await _handle.getDirectoryHandle(PATTERNS_DIR, { create: true });
    const fileHandle = await dirHandle.getFileHandle(patternFilename(id), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(payload);
    await writable.close();
    return true;
  }

  async function readPatternFile(id) {
    if (_state !== 'ready' || !_handle) return null;
    if (!(await ensurePermission(_handle, false))) return null;
    try {
      const dirHandle = await _handle.getDirectoryHandle(PATTERNS_DIR);
      const file = await (await dirHandle.getFileHandle(patternFilename(id))).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async function deletePatternFile(id) {
    if (_state !== 'ready' || !_handle) return false;
    if (!(await ensurePermission(_handle, false))) return false;
    try {
      const dirHandle = await _handle.getDirectoryHandle(PATTERNS_DIR);
      await dirHandle.removeEntry(patternFilename(id));
      return true;
    } catch (error) {
      if (error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  async function writeRecoveryCheckpoint(slot, record) {
    if (_state !== 'ready' || !_handle) throw new Error('No local save folder connected.');
    const dirHandle = await _handle.getDirectoryHandle(RECOVERY_DIR, { create: true }); // Recovery writes are isolated from canonical characters/worlds/layouts.
    await writeJsonFile(dirHandle, recoveryFilename(slot), record);
    return record;
  }

  async function readRecoveryCheckpoint(slot) {
    if (_state !== 'ready' || !_handle) return null;
    let dirHandle;
    try { dirHandle = await _handle.getDirectoryHandle(RECOVERY_DIR); }
    catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
    return readJsonFile(dirHandle, recoveryFilename(slot));
  }

  async function readRecoveryCheckpoints() {
    const result = {}; // Returned slot map is used to mirror folder-authoritative recovery history back into browser fallback storage.
    for (const slot of Object.keys(RECOVERY_FILES)) result[slot] = await readRecoveryCheckpoint(slot);
    return result;
  }

  async function writeEntities(dirName, entities, nameField) {
    const dirHandle = await _handle.getDirectoryHandle(dirName, { create: true });
    const keep = new Set();
    for (const entity of entities) {
      if (!entity?.id) continue;
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
      try {
        const value = JSON.parse(await (await entry.getFile()).text());
        if (value && typeof value === 'object') entities.push(value);
      } catch { /* unreadable entries are skipped */ }
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
      } catch (error) {
        if (strict) {
          throw new Error(`Farm layout for world "${world.label || world.id}" is unreadable: ${String(error?.message || error)}`);
        }
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

  function snapshotFromBrowser() {
    const meta = readBrowserMeta(); // Canonical browser metadata captured once so guards and writes operate on the same object.
    if (!meta) throw new Error('No browser save is available to write.');
    const farmLayouts = readBrowserFarmLayouts(meta, true); // Matching layout capture keeps the folder write atomic at the snapshot boundary.
    return { snapshotVersion: 1, meta, farmLayouts };
  }

  function normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Save snapshot is missing.');
    if (!snapshot.meta || !Array.isArray(snapshot.meta.characters) || !Array.isArray(snapshot.meta.worlds)) {
      throw new Error('Save snapshot metadata is invalid.');
    }
    if (!snapshot.farmLayouts || typeof snapshot.farmLayouts !== 'object' || Array.isArray(snapshot.farmLayouts)) {
      throw new Error('Save snapshot farm layouts are invalid.');
    }
    return snapshot;
  }

  async function readFolderFarmLayouts() {
    const layouts = {};
    const corruptFiles = [];
    let dirHandle;
    try { dirHandle = await _handle.getDirectoryHandle(FARM_LAYOUTS_DIR); }
    catch { return { layouts, corruptFiles }; }

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
    return { layouts, corruptFiles };
  }

  async function writeFarmLayouts(meta, layouts) {
    const dirHandle = await _handle.getDirectoryHandle(FARM_LAYOUTS_DIR, { create: true });
    const worldIds = new Set((meta?.worlds || []).map(world => String(world?.id || '')).filter(Boolean));
    const keep = new Set();
    let written = 0;

    for (const worldId of worldIds) {
      if (!Object.prototype.hasOwnProperty.call(layouts, worldId)) continue;
      const filename = farmLayoutFilename(worldId);
      keep.add(filename);
      await writeJsonFile(dirHandle, filename, { worldId, layout: layouts[worldId] });
      written++;
    }

    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file' || keep.has(name)) continue;
      try {
        const payload = JSON.parse(await (await entry.getFile()).text());
        if (payload?.worldId && !worldIds.has(String(payload.worldId))) await dirHandle.removeEntry(name);
      } catch { /* preserve unreadable files for recovery */ }
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
      manifest = JSON.parse(await manifestFile.text());
      manifestExists = true;
    } catch (error) {
      if (error?.name !== 'NotFoundError') {
        throw new Error('Could not read manifest.json: ' + String(error?.message || error));
      }
    }

    const portableVersion = Number(manifest?.portableSaveVersion) || 1;
    const hasPortableFarmLayouts = portableVersion >= PORTABLE_SAVE_VERSION || Object.keys(farm.layouts).length > 0;
    return {
      exists: manifestExists || characters.length > 0 || worlds.length > 0,
      savedAt: Number(manifest?.savedAt) || 0,
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

  async function readPrimarySnapshot() {
    if (_state !== 'ready' || !_handle) return null;
    const folder = await readFolderSnapshot(); // Current canonical folder state shown in recovery UI and preserved before restores.
    if (!folder.exists) return null;
    return {
      savedAt: folder.savedAt || 0,
      snapshot: {
        snapshotVersion: 1,
        meta: folder.meta,
        farmLayouts: folder.farmLayouts,
      },
    };
  }

  async function inspectConnectedFolder() {
    if (_state !== 'ready' || !_handle) return null;
    const folder = await readFolderSnapshot();
    const validWorldIds = new Set((folder.meta.worlds || []).map(world => String(world?.id || '')).filter(Boolean));
    _folderSupportsFarmLayouts = folder.hasPortableFarmLayouts && folder.corruptFarmLayoutFiles.length === 0;
    _farmLayoutCount = Object.keys(folder.farmLayouts || {}).filter(worldId => validWorldIds.has(worldId)).length;
    _lastSyncedAt = folder.savedAt || 0;
    _lastError = folder.corruptFarmLayoutFiles.length
      ? `Skipped corrupt farm layout file(s): ${folder.corruptFarmLayoutFiles.join(', ')}.`
      : '';
    if (folder.exists) _lastKnownFolderMeta = folder.meta;
    return folder;
  }

  function folderFarmLayoutsDiffer(folderMeta, browserLayouts, folderLayouts) {
    const validWorldIds = new Set((folderMeta?.worlds || []).map(world => String(world?.id || '')).filter(Boolean));
    for (const [worldId, folderLayout] of Object.entries(folderLayouts || {})) {
      if (!validWorldIds.has(worldId)) continue;
      if (!Object.prototype.hasOwnProperty.call(browserLayouts, worldId)) return true;
      if (JSON.stringify(browserLayouts[worldId]) !== JSON.stringify(folderLayout)) return true;
    }
    return false;
  }

  function checkpointIntegrityRisk(snapshot, options) {
    if (options.force) return null;
    const guard = window.HobunjiSaveCheckpoints?.evaluateSnapshotForFolderWrite; // Shared checkpoint heuristic blocks canonical writes before any folder file changes.
    if (typeof guard !== 'function') return null;
    try {
      const result = guard(snapshot, { automatic: !!options.automatic, recoveryKind: options.recoveryKind || 'auto' });
      return result?.ok === false ? (result.warning || 'recovery checkpoint integrity guard rejected this save') : null;
    } catch (error) {
      return `recovery checkpoint integrity check failed: ${String(error?.message || error)}`;
    }
  }

  async function _syncNowImpl({ automatic = false, force = false, snapshot = null, recoveryKind = 'auto' } = {}) {
    if (_state !== 'ready' || !_handle) return getStatus();
    if (automatic && !_autoSyncArmed) return getStatus();

    try {
      const saveSnapshot = normalizeSnapshot(snapshot || snapshotFromBrowser()); // Explicit manual/restore writes can pin the exact snapshot being committed.
      const meta = saveSnapshot.meta;
      const farmLayouts = saveSnapshot.farmLayouts;

      if (!force) {
        const risk = describeDataLossRisk(_lastKnownFolderMeta, meta);
        if (risk) {
          _lastDataLossRisk = risk;
          _lastError = `Skipped saving to the folder: this browser's save ${risk}. Save Now again to confirm the overwrite.`;
          _lastAction = automatic ? 'autosync-blocked-data-loss' : 'save-blocked-data-loss';
          notify();
          return getStatus();
        }
        const checkpointRisk = checkpointIntegrityRisk(saveSnapshot, { automatic, force, recoveryKind }); // Farm-specific inventory/storage/livestock reset detection runs before canonical writes.
        if (checkpointRisk) {
          _lastDataLossRisk = checkpointRisk;
          _lastError = `Skipped saving to the folder: ${checkpointRisk}. Use recovery or force an intentional overwrite.`;
          _lastAction = automatic ? 'autosync-blocked-checkpoint-integrity' : 'save-blocked-checkpoint-integrity';
          notify();
          return getStatus();
        }
      }
      _lastDataLossRisk = null;

      await writeEntities(CHARACTERS_DIR, meta.characters || [], 'nickname');
      await writeEntities(WORLDS_DIR, meta.worlds || [], 'label');
      _farmLayoutCount = await writeFarmLayouts(meta, farmLayouts);
      _folderSupportsFarmLayouts = true;

      // Custom pattern PNGs are stored outside character/world JSON. Mirror every
      // customMotifId referenced by the snapshot so connecting a folder after the
      // motif was authored still produces a complete portable save.
      _lastPatternMirror = null;
      const mirrorReferencedMotifs = window.MotifStore?.mirrorReferencedMotifs;
      if (typeof mirrorReferencedMotifs === 'function') {
        try { _lastPatternMirror = await mirrorReferencedMotifs(meta); }
        catch (error) { _lastPatternMirror = { error: String(error?.message || error) }; }
      }

      const savedAt = Date.now();
      await writeJsonFile(_handle, MANIFEST_FILE_NAME, {
        version: meta.version ?? 1,
        portableSaveVersion: PORTABLE_SAVE_VERSION,
        recoverySaveVersion: RECOVERY_SAVE_VERSION,
        farmLayoutsIncluded: true,
        savedAt,
        characterCount: (meta.characters || []).length,
        worldCount: (meta.worlds || []).length,
        farmLayoutCount: _farmLayoutCount,
      });
      try { await _handle.removeEntry(LEGACY_SAVE_FILE_NAME); } catch {}

      _lastKnownFolderMeta = meta;
      _lastSyncedAt = savedAt;
      _lastAction = automatic ? 'autosaved-browser-to-folder' : 'saved-browser-to-folder';
      _lastError = '';
      _lastObservedFingerprint = browserFingerprint(true);

      const checkpointWriter = window.HobunjiSaveCheckpoints?.onFolderSnapshotWritten; // Recovery history advances only after the canonical folder write succeeds.
      if (typeof checkpointWriter === 'function') {
        try {
          await checkpointWriter(saveSnapshot, { automatic, savedAt, recoveryKind });
        } catch (checkpointError) {
          _lastError = `Primary folder save succeeded, but recovery history could not be updated: ${String(checkpointError?.message || checkpointError)}`;
          _lastAction = automatic ? 'autosaved-primary-recovery-error' : 'saved-primary-recovery-error';
        }
      }

      if (!automatic) startAutoSync();
    } catch (error) {
      _lastError = String(error?.message || error);
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

  async function syncSnapshot(snapshot, options = {}) {
    if (_syncPromise) await _syncPromise; // Manual/restore snapshots must not be discarded behind an already-running autosync.
    return syncNow({ ...options, snapshot });
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
        _lastAction = 'initialized-empty-folder';
        const status = await syncNow({ automatic: false });
        return {
          ok: !status.lastError,
          action: _lastAction,
          changed: false,
          message: status.lastError ? status.lastError : 'Initialized the empty folder from this browser save.',
        };
      }

      const browserMeta = readBrowserMeta();
      const browserLayouts = readBrowserFarmLayouts(browserMeta, false);
      const metaChanged = !browserMeta || !saveMetaMatches(browserMeta, folder.meta);
      const layoutsChanged = folderFarmLayoutsDiffer(folder.meta, browserLayouts, folder.farmLayouts);
      const changed = metaChanged || layoutsChanged;

      _lastKnownFolderMeta = folder.meta;
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(folder.meta));
      const validWorldIds = new Set((folder.meta.worlds || []).map(world => String(world?.id || '')).filter(Boolean));
      for (const [worldId, layout] of Object.entries(folder.farmLayouts || {})) {
        if (!validWorldIds.has(worldId)) continue;
        localStorage.setItem(farmLayoutKey(worldId), JSON.stringify(layout));
      }

      _folderSupportsFarmLayouts = folder.hasPortableFarmLayouts && folder.corruptFarmLayoutFiles.length === 0;
      _farmLayoutCount = Object.keys(folder.farmLayouts || {}).filter(worldId => validWorldIds.has(worldId)).length;
      _lastSyncedAt = folder.savedAt || Date.now();
      _lastError = folder.corruptFarmLayoutFiles.length
        ? `Skipped corrupt farm layout file(s): ${folder.corruptFarmLayoutFiles.join(', ')}. Save Now only if this browser has the correct farm.`
        : '';
      _lastAction = changed
        ? 'loaded-folder-to-browser'
        : (_folderSupportsFarmLayouts ? 'folder-already-current' : 'legacy-folder-missing-farm-layouts');
      _lastObservedFingerprint = browserFingerprint(_folderSupportsFarmLayouts);
      startAutoSync();
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
            : 'Characters/worlds match, but this older folder has no portable farm layouts yet. Use Save Now on the device with the correct farm.'),
      };
    } catch (error) {
      _lastError = String(error?.message || error);
      _lastAction = 'reconcile-error';
      notify();
      return {
        ok: false,
        action: _lastAction,
        changed: false,
        message: 'Could not reconcile the local save folder: ' + _lastError,
      };
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
      if (_state === 'ready') {
        await inspectConnectedFolder();
        _lastAction = 'remembered-folder-ready-awaiting-choice';
        stopAutoSync();
      } else {
        _lastAction = 'permission-needed';
      }
    } catch (error) {
      _state = 'error';
      _lastError = String(error?.message || error);
      _lastAction = 'init-error';
    }
    notify();
  }

  // Picking/changing a folder only establishes access. If the folder is empty,
  // Save Now is still the explicit operation that initializes it.
  async function chooseFolder() {
    if (!isSupported()) return getStatus();
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      _handle = handle;
      await idbSet(HANDLE_KEY, handle);
      _state = 'ready';
      _lastError = '';
      _lastDataLossRisk = null;
      _lastKnownFolderMeta = null; // a newly picked folder has no relation to any previous baseline
      stopAutoSync();
      await inspectConnectedFolder();
      _lastAction = 'folder-chosen-awaiting-choice';
      notify();
    } catch (error) {
      if (error?.name !== 'AbortError') {
        _state = 'error';
        _lastError = String(error?.message || error);
        _lastAction = 'choose-error';
        notify();
      }
    }
    return getStatus();
  }

  const changeFolder = chooseFolder;

  // Reconnect is deliberately NON-DESTRUCTIVE. It only restores permission and
  // inspects the folder. It does not import, export, start autosync, or reload.
  // This keeps the current in-browser farm intact until the player chooses
  // Save Now (browser -> folder) or Load from Folder (folder -> browser).
  async function reconnect() {
    if (!_handle) return chooseFolder();
    try {
      const granted = await ensurePermission(_handle, true);
      _state = granted ? 'ready' : 'needs-permission';
      stopAutoSync();
      if (granted) {
        await inspectConnectedFolder();
        _lastAction = 'permission-restored-awaiting-choice';
        _lastError = '';
      } else {
        _lastAction = 'permission-needed';
      }
    } catch (error) {
      _state = 'error';
      _lastError = String(error?.message || error);
      _lastAction = 'reconnect-error';
    }
    notify();
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
    _lastKnownFolderMeta = null;
    _lastDataLossRisk = null;
    _lastPatternMirror = null;
    try { await idbDelete(HANDLE_KEY); } catch {}
    notify();
    return getStatus();
  }

  async function loadFromFolder() {
    const result = await reconcileConnectedFolder({ reloadIfChanged: false });
    if (!result.ok) return result;
    if (result.action === 'initialized-empty-folder') {
      return { ok: false, message: 'This folder was empty, so there was nothing to load.' };
    }
    return {
      ok: true,
      message: result.changed ? result.message + ' Reload the page to apply it.' : result.message,
    };
  }

  window.addEventListener('beforeunload', () => {
    if (_state === 'ready' && _autoSyncArmed) syncNow({ automatic: true });
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
    syncSnapshot,
    loadFromFolder,
    reconcileConnectedFolder,
    readPrimarySnapshot,
    readRecoveryCheckpoint,
    readRecoveryCheckpoints,
    writeRecoveryCheckpoint,
    mirrorPatternFile,
    readPatternFile,
    deletePatternFile,
  };

  // Mobile-accessible debug surface: inspect current persistence state without DevTools.
  window.__hobunjiLocalSaveDebug = {
    status: () => getStatus(),
    inspect: async () => {
      try {
        const folder = await inspectConnectedFolder();
        const recovery = await readRecoveryCheckpoints(); // Folder recovery slots are included so mobile diagnosis can confirm they exist without DevTools.
        return { status: getStatus(), folder, recovery };
      } catch (error) {
        return { status: getStatus(), error: String(error?.message || error) };
      }
    },
  };

  init();
})();
