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
  const RECOVERY_DIR = 'recovery'; // Folder-first recovery history lives beside, but never replaces, the canonical save directories.
  const RECOVERY_FILES = Object.freeze({ // Stable recovery slot filenames used by the checkpoint manager and recovery UI.
    manual: 'manual.json',
    auto: 'autosave-latest.json',
    autoPrevious: 'autosave-previous.json',
    preRestore: 'pre-restore.json',
  });
  const TRANSACTION_DIR = 'transaction-journal'; // Single write-ahead journal protecting the multi-file canonical save boundary.
  const TRANSACTION_PENDING_FILE = 'pending.json'; // Exists only while a canonical folder transaction is unresolved.
  const TRANSACTION_LOCK_NAME = 'hobunji-folder-transaction'; // Core-level Web Lock serializes every canonical read/repair/write across tabs.
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

  function transactionJournalApi() {
    return window.HobunjiFolderTransactionJournal || null;
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
  let _syncPromise = null; // Used to serialize filesystem writes within this tab before the cross-tab transaction lock is requested.
  let _lastKnownFolderMeta = null; // Last meta.json content known to actually be on disk; the data-loss guard's baseline.
  let _lastDataLossRisk = null; // Set when a push was skipped because it looked like it would destroy folder data.
  let _transactionPending = false; // Debug-visible marker showing whether pending.json currently needs resolution.
  let _lastTransactionAction = 'none'; // Latest transaction commit/finalize/rollback action shown in diagnostics.
  let _lastTransactionId = null; // Latest transaction id shown in diagnostics without exposing save contents.
  let _transactionRecoveries = 0; // Count of interrupted transactions resolved after their initial write path stopped.
  let _transactionRollbacks = 0; // Count of interrupted writes restored to their pre-write canonical snapshot.
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
      recoverySaveVersion: RECOVERY_SAVE_VERSION,
      transactionJournalVersion: transactionJournalApi()?.VERSION || null,
      transactionPending: _transactionPending,
      lastTransactionAction: _lastTransactionAction,
      lastTransactionId: _lastTransactionId,
      transactionRecoveries: _transactionRecoveries,
      transactionRollbacks: _transactionRollbacks,
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

  function withTransactionLock(operation) {
    const lockApi = window.navigator?.locks; // Web Lock covers core autosync/syncSnapshot paths that bypass the higher-level UI wrapper.
    if (!lockApi?.request) return Promise.resolve().then(operation);
    return lockApi.request(TRANSACTION_LOCK_NAME, { mode: 'exclusive' }, operation);
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

  function snapshotEnvelopeFromFolder(folder) {
    if (!folder?.exists) return null;
    return {
      savedAt: Number(folder.savedAt) || 0,
      snapshot: {
        snapshotVersion: 1,
        meta: folder.meta,
        farmLayouts: folder.farmLayouts,
      },
    };
  }

  async function readFolderSnapshotRaw() {
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

  function manifestFarmLayoutCount(snapshot) {
    const worldIds = new Set((snapshot?.meta?.worlds || []).map(world => String(world?.id || '')).filter(Boolean));
    return Object.keys(snapshot?.farmLayouts || {}).filter(worldId => worldIds.has(worldId)).length;
  }

  async function writeManifestUnlocked(snapshot, savedAt, farmLayoutCount = manifestFarmLayoutCount(snapshot)) {
    const meta = snapshot.meta;
    await writeJsonFile(_handle, MANIFEST_FILE_NAME, {
      version: meta.version ?? 1,
      portableSaveVersion: PORTABLE_SAVE_VERSION,
      recoverySaveVersion: RECOVERY_SAVE_VERSION,
      transactionJournalVersion: transactionJournalApi()?.VERSION || 1,
      farmLayoutsIncluded: true,
      savedAt,
      characterCount: (meta.characters || []).length,
      worldCount: (meta.worlds || []).length,
      farmLayoutCount,
    });
    try { await _handle.removeEntry(LEGACY_SAVE_FILE_NAME); } catch {}
    return farmLayoutCount;
  }

  async function writeCanonicalSnapshotUnlocked(snapshot, savedAt) {
    const saveSnapshot = normalizeSnapshot(snapshot);
    const meta = saveSnapshot.meta;
    await writeEntities(CHARACTERS_DIR, meta.characters || [], 'nickname');
    await writeEntities(WORLDS_DIR, meta.worlds || [], 'label');
    const farmLayoutCount = await writeFarmLayouts(meta, saveSnapshot.farmLayouts);
    await writeManifestUnlocked(saveSnapshot, savedAt, farmLayoutCount);
    _farmLayoutCount = farmLayoutCount;
    _folderSupportsFarmLayouts = true;
    return { savedAt, farmLayoutCount };
  }

  async function transactionDirectory(create = false) {
    try {
      return await _handle.getDirectoryHandle(TRANSACTION_DIR, create ? { create: true } : undefined);
    } catch (error) {
      if (!create && error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async function readPendingTransactionUnlocked() {
    const dirHandle = await transactionDirectory(false);
    if (!dirHandle) {
      _transactionPending = false;
      return null;
    }
    const record = await readJsonFile(dirHandle, TRANSACTION_PENDING_FILE);
    if (!record) {
      _transactionPending = false;
      return null;
    }
    const api = transactionJournalApi();
    if (!api?.validateRecord) throw new Error('Folder transaction journal helpers are unavailable.');
    const valid = api.validateRecord(record);
    _transactionPending = true;
    _lastTransactionId = valid.transactionId;
    return valid;
  }

  async function writePendingTransactionUnlocked(record) {
    const api = transactionJournalApi();
    if (!api?.validateRecord) throw new Error('Folder transaction journal helpers are unavailable.');
    const valid = api.validateRecord(record);
    const dirHandle = await transactionDirectory(true);
    await writeJsonFile(dirHandle, TRANSACTION_PENDING_FILE, valid);
    _transactionPending = true;
    _lastTransactionId = valid.transactionId;
    _lastTransactionAction = 'pending-written';
    return valid;
  }

  async function clearPendingTransactionUnlocked() {
    const dirHandle = await transactionDirectory(false);
    if (dirHandle) {
      try { await dirHandle.removeEntry(TRANSACTION_PENDING_FILE); }
      catch (error) { if (error?.name !== 'NotFoundError') throw error; }
    }
    _transactionPending = false;
  }

  function newTransactionId(savedAt) {
    const randomId = window.crypto?.randomUUID?.(); // UUID is diagnostic/provenance only; transaction correctness never depends on randomness.
    return randomId ? `${savedAt}-${randomId}` : `${savedAt}-${Math.random().toString(36).slice(2)}`;
  }

  async function repairPendingTransactionUnlocked({ reason = 'read' } = {}) {
    const pending = await readPendingTransactionUnlocked();
    if (!pending) return { ok: true, action: 'none', committedTarget: false };

    const api = transactionJournalApi();
    if (!api?.decideRecovery) throw new Error('Folder transaction journal helpers are unavailable.');
    const currentFolder = await readFolderSnapshotRaw();
    const currentEnvelope = snapshotEnvelopeFromFolder(currentFolder);
    const decision = api.decideRecovery(pending, currentEnvelope?.snapshot || null);

    if (decision.action === 'finalize-target') {
      _farmLayoutCount = await writeManifestUnlocked(decision.envelope.snapshot, decision.envelope.savedAt);
      _folderSupportsFarmLayouts = true;
    } else {
      await writeCanonicalSnapshotUnlocked(decision.envelope.snapshot, decision.envelope.savedAt);
    }

    await clearPendingTransactionUnlocked();
    _transactionRecoveries++;
    if (decision.action === 'rollback-before') _transactionRollbacks++;
    _lastTransactionId = pending.transactionId;
    _lastTransactionAction = `${decision.action}:${reason}`;
    _lastKnownFolderMeta = decision.envelope.snapshot.meta;
    _lastSyncedAt = decision.envelope.savedAt;
    return {
      ok: true,
      action: decision.action,
      committedTarget: decision.action !== 'rollback-before',
      transactionId: pending.transactionId,
    };
  }

  async function readFolderSnapshot() {
    return withTransactionLock(async () => {
      await repairPendingTransactionUnlocked({ reason: 'before-read' });
      return readFolderSnapshotRaw();
    });
  }

  async function readPrimarySnapshot() {
    if (_state !== 'ready' || !_handle) return null;
    const folder = await readFolderSnapshot(); // Canonical read first repairs/finalizes any interrupted multi-file write.
    if (!folder.exists) return null;
    return snapshotEnvelopeFromFolder(folder);
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

  async function beginCanonicalTransactionUnlocked(saveSnapshot, { automatic = false, recoveryKind = 'auto' } = {}) {
    await repairPendingTransactionUnlocked({ reason: 'before-new-save' });
    const folderBefore = await readFolderSnapshotRaw(); // Captured before pending.json is written so rollback is a complete pre-write canonical snapshot.
    const savedAt = Date.now();
    const api = transactionJournalApi();
    if (!api?.createRecord) throw new Error('Folder transaction journal helpers are unavailable.');
    const record = api.createRecord({
      transactionId: newTransactionId(savedAt),
      startedAt: savedAt,
      source: `${automatic ? 'automatic' : 'explicit'}:${recoveryKind}`,
      before: snapshotEnvelopeFromFolder(folderBefore),
      target: { savedAt, snapshot: saveSnapshot },
    });
    return writePendingTransactionUnlocked(record);
  }

  async function _syncNowImpl({ automatic = false, force = false, snapshot = null, recoveryKind = 'auto' } = {}) {
    if (_state !== 'ready' || !_handle) return getStatus();
    if (automatic && !_autoSyncArmed) return getStatus();

    try {
      await repairPendingTransactionUnlocked({ reason: 'before-save' });
      const saveSnapshot = normalizeSnapshot(snapshot || snapshotFromBrowser()); // Explicit manual/restore writes can pin the exact snapshot being committed.
      const meta = saveSnapshot.meta;

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

      const transaction = await beginCanonicalTransactionUnlocked(saveSnapshot, { automatic, recoveryKind });
      let canonicalCommitted = false; // Becomes true after normal commit or after recovery can safely finish the intended target.
      try {
        await writeCanonicalSnapshotUnlocked(saveSnapshot, transaction.target.savedAt);
        await clearPendingTransactionUnlocked();
        _lastTransactionId = transaction.transactionId;
        _lastTransactionAction = 'committed';
        canonicalCommitted = true;
      } catch (writeError) {
        try {
          const repair = await repairPendingTransactionUnlocked({ reason: 'write-error' });
          if (repair.committedTarget) {
            canonicalCommitted = true;
          } else {
            _lastError = `Folder save failed, but transaction ${repair.transactionId || transaction.transactionId} rolled the canonical folder back safely: ${String(writeError?.message || writeError)}`;
            _lastAction = 'save-transaction-rolled-back';
            notify();
            return getStatus();
          }
        } catch (repairError) {
          _transactionPending = true;
          _lastError = `Folder save was interrupted and automatic rollback could not finish. The write-ahead journal was kept for the next startup. Save error: ${String(writeError?.message || writeError)}; repair error: ${String(repairError?.message || repairError)}`;
          _lastAction = 'save-transaction-pending-error';
          notify();
          return getStatus();
        }
      }

      if (!canonicalCommitted) throw new Error('Canonical folder transaction did not reach a committed state.');
      const savedAt = transaction.target.savedAt;
      _lastKnownFolderMeta = meta;
      _lastSyncedAt = savedAt;
      _lastAction = automatic ? 'autosaved-browser-to-folder' : 'saved-browser-to-folder';
      _lastError = '';
      _lastObservedFingerprint = browserFingerprint(true);

      const checkpointWriter = window.HobunjiSaveCheckpoints?.onFolderSnapshotWritten; // Recovery history advances only after the canonical transaction has fully resolved.
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
    _syncPromise = withTransactionLock(() => _syncNowImpl(options)).finally(() => { _syncPromise = null; });
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
      const folder = await readFolderSnapshot(); // Reading canonical state resolves any interrupted transaction before it can be imported into browser storage.
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
        await inspectConnectedFolder(); // Startup inspection repairs/finalizes pending.json before reporting the folder as usable.
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
    _transactionPending = false;
    _lastTransactionAction = 'none';
    _lastTransactionId = null;
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

  async function inspectTransactionJournal() {
    if (_state !== 'ready' || !_handle) return { version: transactionJournalApi()?.VERSION || null, pending: null };
    return withTransactionLock(async () => {
      const pending = await readPendingTransactionUnlocked();
      return {
        version: transactionJournalApi()?.VERSION || null,
        pending: pending ? {
          transactionId: pending.transactionId,
          startedAt: pending.startedAt,
          source: pending.source,
          hasBeforeSnapshot: !!pending.before?.snapshot,
        } : null,
        lastAction: _lastTransactionAction,
        recoveries: _transactionRecoveries,
        rollbacks: _transactionRollbacks,
      };
    });
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
    inspectTransactionJournal,
  };

  // Mobile-accessible debug surface: inspect current persistence state without DevTools.
  window.__hobunjiLocalSaveDebug = {
    status: () => getStatus(),
    inspect: async () => {
      try {
        const folder = await inspectConnectedFolder();
        const recovery = await readRecoveryCheckpoints(); // Folder recovery slots are included so mobile diagnosis can confirm they exist without DevTools.
        const transaction = await inspectTransactionJournal(); // Journal state confirms whether an interrupted canonical write is still pending.
        return { status: getStatus(), folder, recovery, transaction };
      } catch (error) {
        return { status: getStatus(), error: String(error?.message || error) };
      }
    },
  };

  init();
})();
