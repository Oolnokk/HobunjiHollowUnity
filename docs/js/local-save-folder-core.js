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
    campfire: 'campfire.json',
    mapChange: 'map-change.json', // Independent map transition recovery checkpoint.
    auto: 'autosave-latest.json',
    autoPrevious: 'autosave-previous.json',
    preRestore: 'pre-restore.json',
  });
  const MANIFEST_FILE_NAME = 'manifest.json';
  const LEGACY_SAVE_FILE_NAME = 'hobunji-save.json';
  const SAVE_META_KEY = 'hobunjiSaveMeta';
  const PROVENANCE_KEY = 'folderSaveProvenance'; // Preserved on unchanged entities; writer history for full saves lives in the manifest.
  const FARM_LAYOUT_KEY_PREFIX = 'hobunji_farm_layout_v3:';
  const PORTABLE_SAVE_VERSION = 2;
  const RECOVERY_SAVE_VERSION = 1; // Manifest/debug marker for the independent recovery directory format.
  const AUTO_SYNC_MS = 30000;
  const CHANGE_POLL_MS = 5000; // Each poll re-reads the whole browser save (MBs with embedded clothing art; ~4 ms on a desktop). Syncs are debounced 4 s and held to one per 20 s anyway.
  const CHANGE_DEBOUNCE_MS = 4000; // Groups rapid browser-cache updates into one folder autosave.
  const CHANGE_MIN_SYNC_MS = 20000; // Stops frequent cache changes from triggering full disk writes every second.

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
    return (typeof window.showDirectoryPicker === 'function' || window.HobunjiBrowserDrive?.isSupported?.()) && typeof indexedDB !== 'undefined';
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
      req.onsuccess = () => { try { resolve(window.HobunjiAndroidFiles?.restoreHandle?.(req.result) ?? window.HobunjiBrowserDrive?.restoreHandle?.(req.result) ?? req.result ?? null); } catch (error) { reject(error); } }; // Restore native or browser Drive descriptor; never persist an access token.
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(window.HobunjiAndroidFiles?.serializeHandle?.(value) ?? window.HobunjiBrowserDrive?.serializeHandle?.(value) ?? value, key); // Preserve normal native handles; serialize Android SAF tokens.
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
  let _changeSyncTimer = null; // Delayed change-triggered sync; cleared when a regular autosave covers the changes.
  let _backgroundSyncQueued = false; // Coalesces idle callbacks so multiple automatic triggers share one live capture.
  let _autoSyncEpoch = 0; // Invalidates queued callbacks when the folder is disconnected or autosync rearmed.
  let _lastObservedFingerprint = null; // Array of browser-cache strings compared without assembling an enormous joined string.
  let _syncPromise = null; // Used to serialize filesystem writes so two save operations cannot overlap.
  let _lastKnownFolderMeta = null; // Last meta.json content known to actually be on disk; the data-loss guard's baseline.
  let _lastKnownFolderProvenance = null; // Last committed manifest writer, used for cross-device Resume diagnostics.
  let _lastKnownFarmLayoutFingerprint = null; // Tracks last loaded/written layout files, guarding external restorations from autosync.
  let _ignoredFarmLayoutBackupFiles = []; // Exposes version-copy filenames in existing mobile save diagnostics.
  let _lastDataLossRisk = null; // Set when a push was skipped because it looked like it would destroy folder data.
  let _lastPatternMirror = null; // Most recent custom-motif portability result, surfaced through save diagnostics.
  let _committedFileState = null; // Per-file content fingerprints and timestamps used to skip unchanged canonical writes.
  let _lastManifestStamp = null; // The completed manifest must still be present before a no-op autosave is permitted.
  let _lastSaveWork = { written: 0, unchanged: 0 }; // File-level save counts exposed in mobile diagnostics.
  let _unchangedAutosavesSkipped = 0; // Automatic saves avoided because captured live data did not change.
  let _recoveryNeedsRefresh = false; // A durable lock-progress-only write must receive its full recovery snapshot at the next ordinary autosave.
  let _lastBrowserMirrorWarning = ''; // Browser cache failures are secondary after the primary folder has been written.
  let _recoveryHandleFresh = false; // True only after a current-session user gesture supplies a new directory handle specifically safe to probe for recovery.
  const _listeners = new Set();

  function getStatus() {
    return {
      supported: isSupported(),
      state: _state,
      folderName: _handle?.name || null,
      lastSyncedAt: _lastSyncedAt || null,
      lastWriterProvenance: _lastKnownFolderProvenance ? { ..._lastKnownFolderProvenance } : null,
      lastError: _lastError || null,
      lastAction: _lastAction,
      farmLayoutCount: _farmLayoutCount,
      ignoredFarmLayoutBackupFiles: [..._ignoredFarmLayoutBackupFiles],
      portableFarmLayouts: _folderSupportsFarmLayouts,
      needsFarmLayoutUpgrade: _state === 'ready' && !_folderSupportsFarmLayouts,
      autoSyncArmed: _autoSyncArmed,
      changeSyncPending: _changeSyncTimer !== null,
      backgroundSyncQueued: _backgroundSyncQueued,
      dataLossRisk: _lastDataLossRisk,
      patternMirror: _lastPatternMirror,
      saveFileWork: { ..._lastSaveWork },
      unchangedAutosavesSkipped: _unchangedAutosavesSkipped,
      recoveryRefreshPending: _recoveryNeedsRefresh,
      browserMirrorWarning: _lastBrowserMirrorWarning || null,
      recoverySaveVersion: RECOVERY_SAVE_VERSION,
      recoveryHandleFresh: _recoveryHandleFresh,
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

  function notify({ refreshRecovery = true } = {}) {
    const status = getStatus();
    const change = { refreshRecovery }; // Save-status updates can skip the recovery manager’s full disk scan.
    for (const listener of _listeners) {
      try { listener(status, change); } catch {}
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
    _autoSyncEpoch++; // Any pending idle callback belongs to the old folder/arming session.
    _backgroundSyncQueued = false;
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
    if (_changePollTimer) { clearInterval(_changePollTimer); _changePollTimer = null; }
    if (_changeSyncTimer !== null) { clearTimeout(_changeSyncTimer); _changeSyncTimer = null; }
  }

  function requestBackgroundSync(reason) {
    if (_backgroundSyncQueued || !_autoSyncArmed || _state !== 'ready') return;
    _backgroundSyncQueued = true;
    const epoch = _autoSyncEpoch; // A delayed callback may not save through a later folder connection.
    const run = () => {
      if (epoch !== _autoSyncEpoch) return;
      _backgroundSyncQueued = false;
      if (_state !== 'ready' || !_autoSyncArmed) return;
      syncNow({ automatic: true, reason }).catch(error => {
        _lastError = String(error?.message || error);
        _lastAction = 'autosync-error';
        notify();
      });
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 50);
  }

  function scheduleChangeSync() {
    if (_changeSyncTimer !== null) clearTimeout(_changeSyncTimer);
    const earliest = Math.max(Date.now() + CHANGE_DEBOUNCE_MS, _lastSyncedAt + CHANGE_MIN_SYNC_MS);
    _changeSyncTimer = setTimeout(() => {
      _changeSyncTimer = null;
      requestBackgroundSync('folder-change');
    }, Math.max(0, earliest - Date.now()));
  }

  function startAutoSync() {
    if (_state !== 'ready' || !_handle) return;
    stopAutoSync(); // Rearming clears old polls, change debounce, and idle work in one place.
    _autoSyncArmed = true;
    _lastObservedFingerprint = observeBrowserFingerprint(_folderSupportsFarmLayouts);
    _autoTimer = setInterval(() => {
      if (_changeSyncTimer !== null) { clearTimeout(_changeSyncTimer); _changeSyncTimer = null; }
      requestBackgroundSync('folder-timer'); // The regular 30-second save remains the fallback for changes not reflected in browser storage.
    }, AUTO_SYNC_MS);
    _changePollTimer = setInterval(() => {
      if (_state !== 'ready' || !_autoSyncArmed) return;
      const nextFingerprint = observeBrowserFingerprint(_folderSupportsFarmLayouts);
      if (nextFingerprint === null) return; // Failed optional polling must not disable the independent 30-second folder timer.
      if (browserFingerprintMatches(nextFingerprint, _lastObservedFingerprint)) return;
      _lastObservedFingerprint = nextFingerprint;
      scheduleChangeSync();
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
    const handle = _handle; // Keep one physical directory for permission checking and the entire custom-motif write.
    if (_state !== 'ready' || !handle) return false;
    if (!(await ensurePermission(handle, false))) return false;
    const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0); // MotifStore supplies Uint8Array PNG bytes; this also accepts other ArrayBuffer views safely.
    if (!payload.byteLength) return false;
    const dirHandle = await handle.getDirectoryHandle(PATTERNS_DIR, { create: true });
    const fileHandle = await dirHandle.getFileHandle(patternFilename(id), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(payload);
    await writable.close();
    return true;
  }

  async function readPatternFile(id) {
    const handle = _handle; // A folder switch must not redirect a pending motif read after its permission check.
    if (_state !== 'ready' || !handle) return null;
    if (!(await ensurePermission(handle, false))) return null;
    try {
      const dirHandle = await handle.getDirectoryHandle(PATTERNS_DIR);
      const file = await (await dirHandle.getFileHandle(patternFilename(id))).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async function deletePatternFile(id) {
    const handle = _handle; // Delete only from the folder whose permission was checked, even during a switch.
    if (_state !== 'ready' || !handle) return false;
    if (!(await ensurePermission(handle, false))) return false;
    try {
      const dirHandle = await handle.getDirectoryHandle(PATTERNS_DIR);
      await dirHandle.removeEntry(patternFilename(id));
      return true;
    } catch (error) {
      if (error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  async function writeRecoveryCheckpoint(slot, record, { returnSerialized = false } = {}) {
    if (_state !== 'ready' || !_handle) throw new Error('No local save folder connected.');
    const filename = recoveryFilename(slot); // Validate the recovery slot before touching disk.
    const raw = JSON.stringify(record); // Snapshot once before I/O; the optional browser mirror uses exactly these committed bytes.
    const dirHandle = await _handle.getDirectoryHandle(RECOVERY_DIR, { create: true });
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(raw);
    await writable.close();
    return returnSerialized ? raw : record; // Preserve the historical public result for other callers.
  }

  async function readRecoveryCheckpoint(slot) {
    if (!_handle) return null; // Recovery history is independent of canonical-save health; an error state must not hide a still-readable recovery directory.
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


  function fileKey(dirName, filename) {
    return dirName + '/' + filename;
  }

  // Avoid pinning full copies of large JSON files in RAM between saves.
  function contentFingerprint(raw) {
    let a = 2166136261, b = 0x9e3779b9;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      a = Math.imul(a ^ ch, 16777619);
      b = Math.imul(b ^ ch, 2246822519);
    }
    return raw.length + ':' + (a >>> 0).toString(36) + ':' + (b >>> 0).toString(36);
  }

  function diskStamp(file) {
    return Number.isFinite(file?.size) && Number.isFinite(file?.lastModified)
      ? { size: file.size, modified: file.lastModified } : null;
  }

  function sameDiskStamp(a, b) {
    return !!a && !!b && a.size === b.size && a.modified === b.modified;
  }

  // Full and incremental saves serialize one entity at a time. Fingerprint
  // comparisons retain only short hashes, not duplicate multi-MB JSON strings.
  function writerProvenance() {
    const deviceId = window.FolderSaveDeviceProvenance?.getDeviceId?.(); // Anonymous installation id already used by the Resume source label.
    return deviceId ? { version: 1, lastWriterDeviceId: deviceId, writtenAt: Date.now() } : null;
  }

  function prepareChangedFiles(meta, layouts) {
    const committed = _committedFileState; // Existing canonical digests let unchanged entities be serialized exactly once.
    const stamp = writerProvenance(); // Per-entity stamps are applied only when the canonical entity's data actually changed.
    const digests = new Map(); // Expected file fingerprints, including new/removed entities.
    let changed = false; // Tracks canonical additions, edits, and deletions.
    const byId = entries => new Map((entries || []).filter(entry => entry?.id).map(entry => [String(entry.id), entry])); // Durable records for preserving prior per-entity writer metadata.
    const previousCharacters = byId(_lastKnownFolderMeta?.characters); // Character provenance must survive unrelated saves.
    const previousWorlds = byId(_lastKnownFolderMeta?.worlds); // World provenance must survive unrelated saves.
    const visit = (dirName, filename, value, previous = null) => {
      const key = fileKey(dirName, filename);
      if (stamp && (dirName === CHARACTERS_DIR || dirName === WORLDS_DIR)) {
        if (previous && Object.prototype.hasOwnProperty.call(previous, PROVENANCE_KEY)) {
          value[PROVENANCE_KEY] = previous[PROVENANCE_KEY];
        } else if (previous) {
          delete value[PROVENANCE_KEY]; // Ignore stale browser stamps when the known durable entity has no provenance.
        }
      }

      let raw = JSON.stringify(value); // One JSON pass for a normal unchanged entity, not an extra comparison pass.
      let digest = contentFingerprint(raw);
      const oldDigest = committed?.get(key)?.digest;
      if (stamp && (dirName === CHARACTERS_DIR || dirName === WORLDS_DIR)) {
        const entityChanged = !previous || (committed
          ? digest !== oldDigest
          : raw !== JSON.stringify(previous)); // On a cold baseline, compare with the actual imported entity.
        if (entityChanged) {
          value[PROVENANCE_KEY] = { ...stamp };
          raw = JSON.stringify(value); // A second pass is needed only for changed entities whose new writer is embedded.
          digest = contentFingerprint(raw);
        }
      }
      digests.set(key, digest);
      if (oldDigest !== digest) changed = true;
    };
    for (const character of meta.characters || []) {
      if (character?.id) visit(CHARACTERS_DIR, slugify(character.nickname) + '-' + character.id + '.json',
        character, previousCharacters.get(String(character.id)));
    }
    for (const world of meta.worlds || []) {
      if (world?.id) visit(WORLDS_DIR, slugify(world.label) + '-' + world.id + '.json',
        world, previousWorlds.get(String(world.id)));
    }
    for (const world of meta.worlds || []) {
      if (!world?.id || !Object.prototype.hasOwnProperty.call(layouts, world.id)) continue;
      visit(FARM_LAYOUTS_DIR, farmLayoutFilename(world.id), { worldId: world.id, layout: layouts[world.id] });
    }
    return committed ? { digests, changed: changed || digests.size !== committed.size } : null;
  }

  async function writeTrackedFile(dirHandle, dirName, filename, payload, delta, next, work) {
    const key = fileKey(dirName, filename);
    const old = _committedFileState?.get(key);
    const digest = delta?.digests.get(key);
    // Changed payloads are serialized only when written; no full JSON buffer
    // survives the delta scan while disk safety guards perform asynchronous I/O.
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    if (old && digest === old.digest && old.stamp) {
      // A deleted or externally modified disk file cannot be called saved just
      // because the browser's copy has not changed.
      let stamp = null;
      try { stamp = diskStamp(await fileHandle.getFile()); } catch {}
      if (sameDiskStamp(stamp, old.stamp)) {
        next.set(key, old);
        work.unchanged++;
        return;
      }
    }
    const raw = JSON.stringify(payload); // Only the single file currently being committed occupies a JSON string.
    const actualDigest = contentFingerprint(raw); // The catalog must describe bytes committed, never an earlier mutable snapshot.
    if (digest !== undefined && actualDigest !== digest) {
      throw new Error('Save snapshot changed during the folder write. Retry with a stable snapshot.');
    }
    const writable = await fileHandle.createWritable();
    await writable.write(raw);
    await writable.close();
    let stamp = null;
    try { stamp = diskStamp(await fileHandle.getFile()); } catch {}
    next.set(key, { digest: actualDigest, stamp });
    work.written++;
  }

  // A fast metadata pass is sufficient only for known, untouched farm files.
  // Unexpected/edited files fall back to the full JSON integrity check.
  async function canonicalFilesUnmodified() {
    if (!_committedFileState || !_lastManifestStamp) return false;
    // A no-op save is safe only if every canonical disk file remains present
    // and unchanged. On browsers without file timestamps we take the normal
    // guarded write path rather than trusting a stale in-memory fingerprint.
    try {
      const manifestHandle = await _handle.getFileHandle(MANIFEST_FILE_NAME); // Missing or externally changed manifest invalidates no-op autosaves.
      if (!sameDiskStamp(_lastManifestStamp, diskStamp(await manifestHandle.getFile()))) return false;
      for (const [key, previous] of _committedFileState) {
        if (!previous.stamp) return false;
        const separator = key.indexOf('/');
        if (separator < 0) return false;
        const directory = await _handle.getDirectoryHandle(key.slice(0, separator));
        const handle = await directory.getFileHandle(key.slice(separator + 1));
        if (!sameDiskStamp(previous.stamp, diskStamp(await handle.getFile()))) return false;
      }
      return true;
    } catch { return false; }
  }

  async function farmLayoutFilesUnmodified() {
    if (!_committedFileState) return false;
    const expected = new Map([..._committedFileState].filter(([key]) => key.startsWith(FARM_LAYOUTS_DIR + '/')));
    let dirHandle;
    try { dirHandle = await _handle.getDirectoryHandle(FARM_LAYOUTS_DIR); }
    catch { return expected.size === 0; }
    const seen = new Set(); // Canonical layout files verified against the last completed folder write.
    try {
      for await (const [name, entry] of dirHandle.entries()) {
        if (entry.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
        if (_ignoredFarmLayoutBackupFiles.includes(name)) continue;
        const key = fileKey(FARM_LAYOUTS_DIR, name);
        const stamp = expected.get(key)?.stamp;
        if (!stamp || !sameDiskStamp(stamp, diskStamp(await entry.getFile()))) return false;
        seen.add(key);
      }
    } catch { return false; }
    return seen.size === expected.size;
  }

  async function writeEntities(dirName, entities, nameField, delta, next, work) {
    const dirHandle = await _handle.getDirectoryHandle(dirName, { create: true });
    const keep = new Set();
    for (const entity of entities) {
      if (!entity?.id) continue;
      const filename = `${slugify(entity[nameField])}-${entity.id}.json`;
      keep.add(filename);
      await writeTrackedFile(dirHandle, dirName, filename, entity, delta, next, work);
    }
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && !keep.has(name)) {
        try { await dirHandle.removeEntry(name); } catch {}
      }
    }
  }

  async function readEntities(dirName) {
    const entities = [];
    const corruptFiles = []; // Canonical character/world parse failures must block folder import instead of masquerading as deleted save slots.
    const seenIds = new Set(); // Duplicate canonical IDs are ambiguous after interrupted rename/cleanup writes and must not be imported silently.
    let dirHandle;
    try { dirHandle = await _handle.getDirectoryHandle(dirName); }
    catch (error) {
      if (error?.name === 'NotFoundError') return { entities, corruptFiles }; // Truly absent legacy save directories are allowed.
      throw new Error('Could not access ' + dirName + ' save directory: ' + String(error?.message || error)); // Never mistake denied/offline storage for an empty save.
    }
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue; // OS metadata and user notes are not canonical save entities.
      try {
        const value = JSON.parse(await (await entry.getFile()).text());
        if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string' && value.id) {
          if (seenIds.has(value.id)) corruptFiles.push(`${dirName}/${name}: duplicate canonical entity id "${value.id}"`);
          else {
            seenIds.add(value.id);
            entities.push(value);
          }
        } else corruptFiles.push(`${dirName}/${name}: canonical entity JSON is missing a valid id`);
      } catch (error) {
        corruptFiles.push(`${dirName}/${name}: ${String(error?.message || error)}`);
      }
    }
    return { entities, corruptFiles };
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

  // The change poll runs every CHANGE_POLL_MS. Parsing the whole save meta
  // each tick just to learn the world ids was the dominant cost, so cache the
  // id list keyed by the raw meta string (any change to the meta changes the
  // string and invalidates it).
  let _fingerprintWorldIds = { raw: null, ids: null };

  function fingerprintWorldIds(metaRaw) {
    if (_fingerprintWorldIds.raw === metaRaw) return _fingerprintWorldIds.ids;
    let ids = null;
    try {
      const meta = metaRaw ? JSON.parse(metaRaw) : null;
      ids = (meta?.worlds || []).filter(world => world?.id).map(world => world.id);
    } catch { ids = null; }
    _fingerprintWorldIds = { raw: metaRaw, ids };
    return ids;
  }

  function browserFingerprint(includeFarmLayouts) {
    const metaRaw = localStorage.getItem(SAVE_META_KEY) || '';
    const parts = [metaRaw]; // Compare each browser string separately rather than allocating a joined full-save copy every second.
    if (!includeFarmLayouts) return parts;
    const ids = fingerprintWorldIds(metaRaw);
    if (!ids) return parts; // Unparseable meta: observe its raw string alone, as before.
    for (const id of ids) parts.push(id, localStorage.getItem(farmLayoutKey(id)) || '');
    return parts;
  }

  function browserFingerprintMatches(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => value === b[index]);
  }

  function observeBrowserFingerprint(includeFarmLayouts) {
    try { return browserFingerprint(includeFarmLayouts); }
    catch (error) {
      _lastBrowserMirrorWarning = `Browser cache bookkeeping failed: ${String(error?.message || error)}`;
      return null;
    }
  }

  function snapshotFromBrowser() {
    const meta = readBrowserMeta(); // Canonical browser metadata captured once so guards and writes operate on the same object.
    if (!meta) throw new Error('No browser save is available to write.');
    const farmLayouts = readBrowserFarmLayouts(meta, true); // Matching layout capture keeps the folder write atomic at the snapshot boundary.
    const snapshot = { snapshotVersion: 1, meta, farmLayouts }; // Also used when gameplay has not initialized the direct capture bridge.
    const browserBaselineParts = window.HobunjiSaveSnapshot?.browserCacheParts?.();
    if (Array.isArray(browserBaselineParts)) {
      Object.defineProperty(snapshot, 'browserBaselineParts', { value: browserBaselineParts, configurable: true }); // Protect browser edits made during a fallback folder write, without serializing the guard.
    }
    return snapshot;
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

  async function readFolderFarmLayouts(validWorldIds = null, { canonicalOnly = false } = {}) {
    const layouts = {};
    const corruptFiles = [];
    const backupFiles = []; // Noncanonical JSON filenames are recovery copies, never competing live layouts.
    const missingCanonicalBackups = []; // Prevent a folder with only version copies from silently yielding an empty farm.
    let dirHandle;
    try { dirHandle = await _handle.getDirectoryHandle(FARM_LAYOUTS_DIR); }
    catch (error) {
      if (error?.name === 'NotFoundError') return { layouts, corruptFiles, backupFiles, missingCanonicalBackups }; // Older saves legitimately lack this directory.
      throw new Error('Could not access farm-layouts save directory: ' + String(error?.message || error)); // A Google Drive access failure must never turn an existing farm into an empty one.
    }

    const backupsByWorld = new Map(); // Used after enumeration to tell harmless backups from missing canonical files.
    const canonicalNames = canonicalOnly && validWorldIds
      ? new Set([...validWorldIds].map(farmLayoutFilename)) : null; // On write checks, inspect only authoritative files, not gigabytes of numbered backups.
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
      if (canonicalNames && !canonicalNames.has(name)) continue; // Recovery copies are still fully scanned by folder import and diagnostics.
      try {
        const payload = JSON.parse(await (await entry.getFile()).text());
        if (!payload || typeof payload.worldId !== 'string' || !payload.worldId || !payload.layout || typeof payload.layout !== 'object' || Array.isArray(payload.layout)) {
          corruptFiles.push(name);
          continue;
        }
        if (name !== farmLayoutFilename(payload.worldId)) {
          backupFiles.push(name);
          if (!backupsByWorld.has(payload.worldId)) backupsByWorld.set(payload.worldId, []);
          backupsByWorld.get(payload.worldId).push(name);
          continue; // e.g. world_p6bt8ho6(3).json must not override world_p6bt8ho6.json.
        }
        if (Object.prototype.hasOwnProperty.call(layouts, payload.worldId)) {
          corruptFiles.push(name + ': duplicate canonical layout');
          continue;
        }
        layouts[payload.worldId] = payload.layout;
      } catch {
        corruptFiles.push(name);
      }
    }
    for (const [worldId, filenames] of backupsByWorld) {
      if ((!validWorldIds || validWorldIds.has(worldId)) && !Object.prototype.hasOwnProperty.call(layouts, worldId)) {
        missingCanonicalBackups.push(worldId + ': restore one copy as ' + farmLayoutFilename(worldId) + ' (found ' + filenames.join(', ') + ')');
      }
    }
    return { layouts, corruptFiles, backupFiles, missingCanonicalBackups };
  }

  async function writeFarmLayouts(meta, layouts, delta, next, work) {
    const dirHandle = await _handle.getDirectoryHandle(FARM_LAYOUTS_DIR, { create: true });
    const worldIds = new Set((meta?.worlds || []).map(world => String(world?.id || '')).filter(Boolean));
    const keep = new Set();
    let written = 0;

    for (const worldId of worldIds) {
      if (!Object.prototype.hasOwnProperty.call(layouts, worldId)) continue;
      const filename = farmLayoutFilename(worldId);
      keep.add(filename);
      await writeTrackedFile(dirHandle, FARM_LAYOUTS_DIR, filename, { worldId, layout: layouts[worldId] }, delta, next, work);
      written++;
    }

    // Only remove canonical layouts for worlds this folder previously owned.
    // Never parse every version-copy / recovery JSON on each autosave: a folder
    // containing many large "world(1).json" backups otherwise rereads them all.
    const oldWorldIds = (_lastKnownFolderMeta?.worlds || []).map(world => world?.id).filter(Boolean); // Last accepted folder snapshot, not arbitrary filenames.
    for (const oldId of oldWorldIds) {
      if (worldIds.has(String(oldId))) continue;
      const filename = farmLayoutFilename(oldId); // Known canonical name; versioned recovery copies are intentionally retained.
      if (keep.has(filename)) continue;
      try { await dirHandle.removeEntry(filename); } catch (error) {
        if (error?.name !== 'NotFoundError') throw error; // Unexpected disk errors still fail the canonical save.
      }
    }
    return written;
  }

  function legacyEntityWriterProvenance(characters, worlds) {
    let latest = null; // Older folders keep portable device history only on individual characters/worlds.
    for (const entry of [...characters, ...worlds]) {
      const writer = entry?.[PROVENANCE_KEY];
      const writtenAt = Number(writer?.writtenAt);
      if (typeof writer?.lastWriterDeviceId !== 'string' || !writer.lastWriterDeviceId
        || !Number.isFinite(writtenAt) || writtenAt <= 0) continue;
      if (!latest || writtenAt > latest.writtenAt) latest = { ...writer, writtenAt };
    }
    return latest;
  }

  async function readFolderSnapshot() {
    const characterRead = await readEntities(CHARACTERS_DIR); // Keeps unreadable canonical files visible to the caller instead of silently dropping them.
    const worldRead = await readEntities(WORLDS_DIR); // Same corruption tracking for worlds; missing a world can otherwise erase save selection.
    const characters = characterRead.entities;
    const worlds = worldRead.entities;
    const corruptEntityFiles = [...characterRead.corruptFiles, ...worldRead.corruptFiles]; // Used to block destructive folder-to-browser reconciliation.
    const farm = await readFolderFarmLayouts(new Set(worlds.map(world => world?.id).filter(Boolean)));
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

    if (manifestExists) {
      const declaredCharacterCount = Number(manifest?.characterCount); // Manifest counts let interrupted/missing canonical files fail closed instead of looking like intentional deletions.
      const declaredWorldCount = Number(manifest?.worldCount); // Same protection for world files, including a file that vanished rather than merely becoming malformed.
      if (Number.isInteger(declaredCharacterCount) && declaredCharacterCount >= 0 && declaredCharacterCount !== characters.length) {
        corruptEntityFiles.push(`manifest.json: expected ${declaredCharacterCount} character file(s), found ${characters.length}`);
      }
      if (Number.isInteger(declaredWorldCount) && declaredWorldCount >= 0 && declaredWorldCount !== worlds.length) {
        corruptEntityFiles.push(`manifest.json: expected ${declaredWorldCount} world file(s), found ${worlds.length}`);
      }
    }

    const portableVersion = Number(manifest?.portableSaveVersion) || 1;
    const declaredFarmCount = Number(manifest?.farmLayoutCount); // Canonical manifest count detects deleted/renamed farm files even without backup copies.
    const knownWorldIds = new Set(worlds.map(world => world?.id).filter(Boolean)); // Only layouts belonging to saved worlds count toward manifest integrity.
    const actualFarmCount = Object.keys(farm.layouts).filter(id => knownWorldIds.has(id)).length; // Compared to the last completed folder-save manifest.
    if (portableVersion >= PORTABLE_SAVE_VERSION && Number.isInteger(declaredFarmCount) && declaredFarmCount > actualFarmCount) {
      farm.missingCanonicalBackups.push('manifest.json: expected ' + declaredFarmCount + ' canonical farm layout(s), found ' + actualFarmCount);
    }
    const hasPortableFarmLayouts = portableVersion >= PORTABLE_SAVE_VERSION || Object.keys(farm.layouts).length > 0;
    return {
      exists: manifestExists || characters.length > 0 || worlds.length > 0 || corruptEntityFiles.length > 0,
      savedAt: Number(manifest?.savedAt) || 0,
      writerProvenance: manifest?.writerProvenance?.lastWriterDeviceId
        ? manifest.writerProvenance
        : legacyEntityWriterProvenance(characters, worlds), // Old folders are identified from their disk files, never a stale browser cache.
      hasPortableFarmLayouts,
      corruptEntityFiles,
      corruptFarmLayoutFiles: farm.corruptFiles,
      ignoredFarmLayoutBackupFiles: farm.backupFiles,
      missingCanonicalLayoutBackups: farm.missingCanonicalBackups,
      meta: {
        version: manifest?.version ?? 1,
        characters,
        worlds,
      },
      farmLayouts: farm.layouts,
    };
  }

  function canonicalCorruptionMessage(folder) {
    const files = folder?.corruptEntityFiles || []; // Canonical entity corruption is more severe than an optional farm-layout parse failure.
    if (!files.length) return '';
    return `Primary Save Folder contains unreadable character/world file(s): ${files.join('; ')}. The folder was not loaded so the browser save remains untouched; use Recovery before overwriting it.`;
  }

  async function readPrimarySnapshot() {
    if (_state !== 'ready' || !_handle) return null;
    const folder = await readFolderSnapshot(); // Current canonical folder state shown in recovery UI and preserved before restores.
    if (!folder.exists) return null;
    const corruption = canonicalCorruptionMessage(folder); // Prevent recovery baselines from treating a silently-skipped world/character as legitimate deletion.
    if (corruption) throw new Error(corruption);
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
    const canonicalCorruption = canonicalCorruptionMessage(folder); // Shown in diagnostics/settings while keeping the folder connected for deliberate recovery.
    _ignoredFarmLayoutBackupFiles = folder.ignoredFarmLayoutBackupFiles || []; // Visible through the mobile folder-save status.
    _folderSupportsFarmLayouts = !canonicalCorruption && !folder.missingCanonicalLayoutBackups?.length && folder.hasPortableFarmLayouts && folder.corruptFarmLayoutFiles.length === 0;
    _farmLayoutCount = Object.keys(folder.farmLayouts || {}).filter(worldId => validWorldIds.has(worldId)).length;
    _lastSyncedAt = folder.savedAt || 0;
    _lastError = canonicalCorruption || (folder.missingCanonicalLayoutBackups?.length
      ? `Canonical farm layout missing: ${folder.missingCanonicalLayoutBackups.join('; ')}`
      : folder.corruptFarmLayoutFiles.length
        ? `Skipped corrupt farm layout file(s): ${folder.corruptFarmLayoutFiles.join(', ')}.`
        : '');
    _lastKnownFolderMeta = folder.exists && !canonicalCorruption ? folder.meta : null;
    _lastKnownFolderProvenance = folder.exists && !canonicalCorruption ? folder.writerProvenance : null;
    if (_lastKnownFarmLayoutFingerprint === null && !folder.corruptFarmLayoutFiles.length && !folder.missingCanonicalLayoutBackups?.length) {
      _lastKnownFarmLayoutFingerprint = farmLayoutFingerprint(folder.farmLayouts); // Establish once; diagnostics must not silently bless a later external replacement.
    }
    return folder;
  }

  function farmLayoutFingerprint(layouts, fileState = null) {
    // Keep only compact, ordered fingerprints, not a second full-size JSON
    // mirror of every farm in memory between saves.
    return JSON.stringify(Object.keys(layouts || {}).sort().map(id => {
      const entry = fileState?.get(fileKey(FARM_LAYOUTS_DIR, farmLayoutFilename(id)));
      const committedDigest = typeof entry === 'string' ? entry : entry?.digest; // Successful writer can reuse its already-calculated file digest.
      return [id, committedDigest || contentFingerprint(JSON.stringify({ worldId: id, layout: layouts[id] }))];
    }));
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

  function uncheckpointedLockRegression(meta) {
    if (!_recoveryNeedsRefresh || !_lastKnownFolderMeta) return null;
    const latestByCharacter = new Map((meta.characters || []).filter(entry => entry?.id).map(entry => [String(entry.id), entry])); // New capture must retain the immediately durable lock penalty.
    for (const previous of _lastKnownFolderMeta.characters || []) {
      const latest = latestByCharacter.get(String(previous?.id));
      for (const [worldId, locks] of Object.entries(previous?.chestLockProgress || {})) {
        for (const [lockId, saved] of Object.entries(locks || {})) {
          if (saved?.version !== 2) continue; // All recorded lock penalties remain monotonic until the deferred recovery checkpoint finishes.
          const incoming = latest?.chestLockProgress?.[worldId]?.[lockId];
          if (incoming?.version !== 2 || Number(incoming.stage) < Number(saved.stage)
            || Number(incoming.misses) < Number(saved.misses)
            || !Number.isFinite(Number(incoming.stage)) || !Number.isFinite(Number(incoming.misses))) {
            return 'browser state is missing durable lock progress for ' + String(lockId);
          }
        }
      }
    }
    return null;
  }

  async function _syncNowImpl({ automatic = false, force = false, snapshot = null, recoveryKind = 'auto', reason = null } = {}) {
    if (_state !== 'ready' || !_handle) return getStatus();
    if (automatic && !_autoSyncArmed) return getStatus();
    if (automatic && window.HobunjiAutosavePause?.isPaused?.()) { // Dev Companion autosave pause freezes the canonical folder; explicit saves still pass.
      window.HobunjiAutosavePause.noteBlocked?.('folder-autosync');
      return getStatus();
    }

    const wasArmed = _autoSyncArmed; // The first save that arms a folder still imports its recovery history.
    try {
      const runtime = window.HobunjiRuntimeSave; // All ordinary folder writes, including timers and Settings, capture current gameplay without first writing browser storage.
      if (!snapshot && window.__hobunjiGameStarted === true && runtime?.isReady?.() && typeof runtime.captureSnapshot === 'function') {
        const captured = runtime.captureSnapshot({ reason: reason || 'folder-sync' }); // Restore/import snapshots remain exact and bypass live capture.
        if (!captured?.ok || !captured.snapshot) throw new Error(captured?.error || 'Could not capture the live folder save.');
        snapshot = captured.snapshot;
      }
      const saveSnapshot = normalizeSnapshot(snapshot || snapshotFromBrowser()); // Explicit manual/restore writes can pin the exact snapshot being committed.
      const meta = saveSnapshot.meta;
      const farmLayouts = saveSnapshot.farmLayouts;
      const missingLock = !force && uncheckpointedLockRegression(meta); // A browser quota failure must not undo a lock penalty already written to the primary folder.
      if (missingLock) {
        _lastDataLossRisk = missingLock;
        _lastError = 'Skipped folder save: ' + missingLock + '. Restore the pending character metadata or Load from Folder.';
        _lastAction = automatic ? 'autosync-blocked-lock-progress' : 'save-blocked-lock-progress';
        notify();
        return getStatus();
      }
      const driveVerified = _handle.assertDriveUnchanged ? await _handle.assertDriveUnchanged(force && recoveryKind === 'restore') : false; // Verify every Drive revision before any canonical write.
      const delta = prepareChangedFiles(meta, farmLayouts); // Compare the captured live snapshot, not only browser cache keys.
      if (automatic && !force && recoveryKind === 'auto' && !_recoveryNeedsRefresh && delta && !delta.changed && !_lastError
        && (driveVerified || (await canonicalFilesUnmodified() && await farmLayoutFilesUnmodified()))) {
        _lastSaveWork = { written: 0, unchanged: delta.digests.size };
        _unchangedAutosavesSkipped++;
        _lastAction = 'autosync-skipped-unchanged';
        // Browser edits can arrive while the disk metadata checks await I/O.
        // Don't hide them by replacing the change poll baseline silently.
        const browserChangedWhileChecking = Array.isArray(saveSnapshot.browserBaselineParts)
          ? !browserFingerprintMatches(window.HobunjiSaveSnapshot?.browserCacheParts?.(), saveSnapshot.browserBaselineParts)
          : saveSnapshot.browserBaselineFingerprint !== undefined
            && window.HobunjiSaveSnapshot?.fingerprint?.() !== saveSnapshot.browserBaselineFingerprint;
        _lastObservedFingerprint = observeBrowserFingerprint(_folderSupportsFarmLayouts);
        if (browserChangedWhileChecking && _autoSyncArmed) {
          _lastBrowserMirrorWarning = 'Primary folder unchanged; newer browser changes made during the disk check were queued for saving.';
          scheduleChangeSync(); // Save the new data instead of treating the stale snapshot as the last version.
        }
        notify({ refreshRecovery: false });
        return getStatus(); // Do not churn manifest, canonical files, browser mirrors or recovery checkpoints.
      }

      if (!force) {
        const risk = describeDataLossRisk(_lastKnownFolderMeta, meta);
        if (risk) {
          _lastDataLossRisk = risk;
          _lastError = `Skipped saving to the folder: this browser's save ${risk}. Save Now again to confirm the overwrite.`;
          _lastAction = automatic ? 'autosync-blocked-data-loss' : 'save-blocked-data-loss';
          notify();
          return getStatus();
        }
        if (_lastKnownFarmLayoutFingerprint !== null) {
          // Only a true no-op may use file timestamps. Any save that writes
          // bytes must compare the complete canonical farm content, including
          // same-size edits with preserved timestamps from external restores.
          const guardWorldIds = new Set([...(meta.worlds || []), ...(_lastKnownFolderMeta?.worlds || [])]
            .map(world => world?.id).filter(Boolean)); // Deleted worlds remain in the baseline until this write intentionally removes them.
          const disk = await readFolderFarmLayouts(guardWorldIds, { canonicalOnly: true });
          const diskFingerprint = farmLayoutFingerprint(disk.layouts);
          const incomingWorldIds = new Set((meta.worlds || []).map(world => world?.id).filter(Boolean)); // Worlds expected to survive this save.
          const missingIncomingLayouts = Object.keys(disk.layouts).filter(id =>
            incomingWorldIds.has(id) && !Object.prototype.hasOwnProperty.call(farmLayouts, id)); // Reject missing browser mirrors instead of advancing the manifest without the existing farm.
          if (missingIncomingLayouts.length) {
            _lastDataLossRisk = 'browser snapshot is missing the existing disk farm layout for ' + missingIncomingLayouts.join(', ');
            _lastError = 'Skipped folder save: ' + _lastDataLossRisk + '. Load from Folder or restore the missing layout before saving.';
            _lastAction = automatic ? 'autosync-blocked-missing-layout' : 'save-blocked-missing-layout';
            notify();
            return getStatus();
          }
          if (disk.corruptFiles.length || disk.missingCanonicalBackups.length || diskFingerprint !== _lastKnownFarmLayoutFingerprint) {
            _lastDataLossRisk = disk.corruptFiles.length
              ? 'farm-layout files on disk are unreadable'
              : disk.missingCanonicalBackups.length
                ? 'a canonical farm-layout filename is missing (only version copies remain)'
                : 'farm-layout files changed outside this game session';
            _lastError = 'Skipped folder save: ' + _lastDataLossRisk + '. Use Load from Folder to recover the new layout before saving.';
            _lastAction = automatic ? 'autosync-blocked-external-layout' : 'save-blocked-external-layout';
            notify();
            return getStatus();
          }
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

      const nextFiles = new Map(); // The new per-file baseline is published only after the canonical commit succeeds.
      const work = { written: 0, unchanged: 0 }; // Last save's filesystem work, visible without developer tools.
      await writeEntities(CHARACTERS_DIR, meta.characters || [], 'nickname', delta, nextFiles, work);
      await writeEntities(WORLDS_DIR, meta.worlds || [], 'label', delta, nextFiles, work);
      _farmLayoutCount = await writeFarmLayouts(meta, farmLayouts, delta, nextFiles, work);
      _lastKnownFarmLayoutFingerprint = farmLayoutFingerprint(farmLayouts, nextFiles); // A successful write becomes the next external-edit baseline.
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
      const committedWriter = writerProvenance(); // The manifest records farm-only saves without rewriting unrelated character/world JSON.
      await writeJsonFile(_handle, MANIFEST_FILE_NAME, {
        version: meta.version ?? 1,
        portableSaveVersion: PORTABLE_SAVE_VERSION,
        recoverySaveVersion: RECOVERY_SAVE_VERSION,
        farmLayoutsIncluded: true,
        savedAt,
        writerProvenance: committedWriter,
        characterCount: (meta.characters || []).length,
        worldCount: (meta.worlds || []).length,
        farmLayoutCount: _farmLayoutCount,
      });
      try { await _handle.removeEntry(LEGACY_SAVE_FILE_NAME); } catch {}

      _committedFileState = nextFiles;
      try { _lastManifestStamp = diskStamp(await (await _handle.getFileHandle(MANIFEST_FILE_NAME)).getFile()); }
      catch { _lastManifestStamp = null; }
      _lastSaveWork = work;
      _lastKnownFolderMeta = meta;
      _lastKnownFolderProvenance = committedWriter;
      _lastSyncedAt = savedAt;
      _lastAction = automatic ? 'autosaved-browser-to-folder' : 'saved-browser-to-folder';
      _lastError = '';
      _lastBrowserMirrorWarning = '';
      if (!automatic) startAutoSync();
      try {
        const browserChangedWhileWriting = Array.isArray(saveSnapshot.browserBaselineParts)
          ? !browserFingerprintMatches(window.HobunjiSaveSnapshot.browserCacheParts?.(), saveSnapshot.browserBaselineParts)
          : saveSnapshot.browserBaselineFingerprint !== undefined
            && window.HobunjiSaveSnapshot.fingerprint() !== saveSnapshot.browserBaselineFingerprint;
        if (browserChangedWhileWriting) {
          _lastBrowserMirrorWarning = 'Primary folder saved; newer browser changes made during the disk write were preserved.';
          if (_autoSyncArmed) scheduleChangeSync(); // The poll's new baseline below must not hide edits made during the disk write.
        } else {
          window.HobunjiSaveSnapshot?.apply?.(saveSnapshot, { folderBacked: true }); // Refresh only the canonical browser cache after the durable disk commit.
        }
      } catch (mirrorError) {
        _lastBrowserMirrorWarning = `Primary folder saved; browser cache could not be updated: ${String(mirrorError?.message || mirrorError)}`;
      }
      delete saveSnapshot.browserBaselineFingerprint; // Release legacy adapter guard before recording recovery history.
      delete saveSnapshot.browserBaselineParts; // Transient raw baseline must never remain pinned in a recovery checkpoint.
      _lastObservedFingerprint = observeBrowserFingerprint(true); // Optional browser bookkeeping cannot change the success of the completed disk commit.

      const checkpointWriter = window.HobunjiSaveCheckpoints?.onFolderSnapshotWritten; // Recovery history advances only after the canonical folder write succeeds.
      if (typeof checkpointWriter === 'function') {
        try {
          await checkpointWriter(saveSnapshot, { automatic, savedAt, recoveryKind, reason });
          _recoveryNeedsRefresh = false; // Full recovery was committed; small lock-progress changes no longer need catch-up.
        } catch (checkpointError) {
          _lastError = `Primary folder save succeeded, but recovery history could not be updated: ${String(checkpointError?.message || checkpointError)}`;
          _lastAction = automatic ? 'autosaved-primary-recovery-error' : 'saved-primary-recovery-error';
        }
      } else {
        _recoveryNeedsRefresh = false; // The recovery manager is optional in isolated tests and early startup.
      }

    } catch (error) {
      _committedFileState = null; // A partial file write cannot authorize later no-op saves.
      _lastManifestStamp = null;
      _lastError = String(error?.message || error);
      _lastAction = 'save-error';
      if (_handle.assertDriveUnchanged) stopAutoSync(); // Never repeatedly retry remote conflicts or partial writes.
    }
    // The checkpoint writer already mirrored the affected slots. Reconcile the full history
    // when a folder is first armed, a restore completes, or a write may have failed.
    notify({ refreshRecovery: !wasArmed || recoveryKind === 'restore' || Boolean(_lastError) });
    return getStatus();
  }

  async function syncNow(options = {}) {
    if (_syncPromise && options.automatic === true && !options.snapshot) return _syncPromise;
    while (_syncPromise) await _syncPromise; // Explicit saves and pinned travel/restore snapshots must each commit after every older writer, including another waiter.
    _syncPromise = _syncNowImpl(options).finally(() => { _syncPromise = null; });
    return _syncPromise;
  }

  async function syncSnapshot(snapshot, options = {}) {
    return syncNow({ ...options, snapshot });
  }
  // The first miss in a lock only modifies one character field. Persist it
  // independently of huge farm layouts and recovery JSON while retaining a
  // full recovery refresh on the next normal autosave. The disk character is
  // read and checked against its last committed fingerprint before patching;
  // unrelated character, world, and farm data are never replaced.
  function canSaveLockProgress(characterId) {
    if (_state !== 'ready' || !_autoSyncArmed || !_handle || !_committedFileState || !_lastManifestStamp || !_lastKnownFolderMeta) return false;
    const current = _lastKnownFolderMeta.characters?.find(character => String(character?.id) === String(characterId)); // Authoritative filename and character identity for the fast write.
    return !!current && _committedFileState.has(fileKey(CHARACTERS_DIR, slugify(current.nickname) + '-' + current.id + '.json'));
  }

  async function _saveLockProgressImpl({ characterId, worldId, lockId, record }) {
    try {
      if (!canSaveLockProgress(characterId)) throw new Error('Fast lock progress save has no verified folder baseline. Use the full save.');
      await _handle.assertDriveUnchanged?.();
      const profile = window.__hobunjiPlayerProfile; // Prevent an in-flight lock modal from changing another character after a world switch.
      if (String(profile?.characterId) !== String(characterId) || String(profile?.worldId) !== String(worldId)) {
        throw new Error('Lock progress save belongs to another active character or world.');
      }
      if (!(_lastKnownFolderMeta.worlds || []).some(world => String(world?.id) === String(worldId))) {
        throw new Error('Lock progress world does not exist in the committed folder.');
      }
      if (typeof worldId !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(worldId)
        || typeof lockId !== 'string' || !lockId || lockId.length > 1024
        || ['__proto__', 'prototype', 'constructor'].includes(lockId)
        || typeof record !== 'object' || !record || Array.isArray(record)
        || record.version !== 2 || record.folderUnsynced !== true || !Number.isInteger(record.stage)) {
        throw new Error('Lock progress record is invalid.');
      }
      const safeRecord = JSON.parse(JSON.stringify(record)); // Detached tiny payload cannot change during asynchronous folder I/O.
      safeRecord.folderUnsynced = false; // A completed canonical character-file write is sufficient to acknowledge this specific lock penalty after reload.
      const known = _lastKnownFolderMeta.characters.find(character => String(character?.id) === String(characterId)); // Same character catalog used to construct the canonical filename.
      const filename = slugify(known.nickname) + '-' + known.id + '.json';
      const key = fileKey(CHARACTERS_DIR, filename);
      const old = _committedFileState.get(key); // Prior successful canonical character write; required for external edit detection.
      const manifestHandle = await _handle.getFileHandle(MANIFEST_FILE_NAME);
      if (!sameDiskStamp(_lastManifestStamp, diskStamp(await manifestHandle.getFile()))) {
        throw new Error('Primary save manifest changed outside this session. Load from Folder before saving lock progress.');
      }
      const dir = await _handle.getDirectoryHandle(CHARACTERS_DIR);
      const handle = await dir.getFileHandle(filename);
      const diskRaw = await (await handle.getFile()).text();
      if (contentFingerprint(diskRaw) !== old?.digest) {
        throw new Error('Character save changed outside this session. Load from Folder before saving lock progress.');
      }
      const character = JSON.parse(diskRaw); // Patch the true disk copy, never the potentially stale browser character.
      if (String(character?.id) !== String(characterId)) throw new Error('Primary folder character id mismatch.');
      const locks = character.chestLockProgress;
      if (locks !== undefined && (!locks || typeof locks !== 'object' || Array.isArray(locks))) {
        throw new Error('Character lock progress is malformed.');
      }
      character.chestLockProgress ||= {};
      const worldLocks = character.chestLockProgress[worldId];
      if (worldLocks !== undefined && (!worldLocks || typeof worldLocks !== 'object' || Array.isArray(worldLocks))) {
        throw new Error('Character world lock progress is malformed.');
      }
      character.chestLockProgress[worldId] ||= {};
      character.chestLockProgress[worldId][lockId] = safeRecord;
      const raw = JSON.stringify(character); // One character, not the farm, its backups or rolling recovery snapshots.
      const writable = await handle.createWritable();
      await writable.write(raw);
      await writable.close();
      const stamp = diskStamp(await handle.getFile());
      const manifest = await readJsonFile(_handle, MANIFEST_FILE_NAME);
      if (!manifest || Number(manifest.savedAt) !== _lastSyncedAt) {
        throw new Error('Primary save manifest is inconsistent after the lock progress write.');
      }
      const savedAt = Math.max(Date.now(), _lastSyncedAt + 1); // Lock acknowledgements must advance even when two writes finish in the same millisecond.
      const committedWriter = writerProvenance() || manifest.writerProvenance || null; // Targeted lock commits also advance last-writer metadata.
      await writeJsonFile(_handle, MANIFEST_FILE_NAME, { ...manifest, savedAt, writerProvenance: committedWriter });
      const manifestStamp = diskStamp(await (await _handle.getFileHandle(MANIFEST_FILE_NAME)).getFile());
      _committedFileState = new Map(_committedFileState); // Publish the new character fingerprint only after both canonical writes succeed.
      _committedFileState.set(key, { digest: contentFingerprint(raw), stamp });
      _lastKnownFolderMeta = {
        ..._lastKnownFolderMeta,
        characters: _lastKnownFolderMeta.characters.map(entry => String(entry?.id) === String(characterId) ? character : entry),
      }; // Future ordinary saves compare against the actual patched on-disk character.
      _lastManifestStamp = manifestStamp;
      _lastKnownFolderProvenance = committedWriter;
      _lastSyncedAt = savedAt;
      _lastSaveWork = { written: 1, unchanged: Math.max(0, _committedFileState.size - 1) };
      _recoveryNeedsRefresh = true; // The regular timer upgrades this tiny durable commit to a complete recoverable checkpoint.
      _lastDataLossRisk = null;
      _lastError = '';
      _lastAction = 'autosaved-lock-progress';
    } catch (error) {
      _committedFileState = null; // Even a partial write cannot be treated as a verified incremental baseline.
      _lastManifestStamp = null;
      _lastError = String(error?.message || error);
      _lastAction = 'save-error';
      if (_handle.assertDriveUnchanged) stopAutoSync(); // Never repeatedly retry remote conflicts or partial writes.
    }
    notify({ refreshRecovery: Boolean(_lastError) }); // This targeted write changes no recovery checkpoint.
    return getStatus();
  }

  async function saveLockProgress(details) {
    while (_syncPromise) await _syncPromise; // Serialize against ordinary autosaves; never change a character during another folder write.
    _syncPromise = _saveLockProgressImpl(details).finally(() => { _syncPromise = null; });
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
      _committedFileState = null; // Explicit folder loads invalidate previous browser->disk comparisons.
      _lastManifestStamp = null;
      await _handle.beginDriveLoad?.(); // Capture a remote version baseline before the explicit import.
      const folder = await readFolderSnapshot();
      if (!folder.exists) {
        await _handle.finishDriveLoad?.(); // Empty folder initialization is an explicit user choice.
        _lastAction = 'initialized-empty-folder';
        const status = await syncNow({ automatic: false });
        return {
          ok: !status.lastError,
          action: _lastAction,
          changed: false,
          message: status.lastError ? status.lastError : 'Initialized the empty folder from this browser save.',
        };
      }

      const canonicalCorruption = canonicalCorruptionMessage(folder); // Never convert a parse failure into an apparent deleted character/world during import.
      if (canonicalCorruption) {
        stopAutoSync();
        _lastKnownFolderMeta = null;
        _lastError = canonicalCorruption;
        _lastAction = 'load-blocked-corrupt-canonical';
        notify();
        return {
          ok: false,
          action: _lastAction,
          changed: false,
          message: canonicalCorruption,
          corruptEntityFiles: [...folder.corruptEntityFiles],
        };
      }

      if (folder.missingCanonicalLayoutBackups?.length) {
        stopAutoSync();
        _lastError = 'Cannot load farm from version copies alone: ' + folder.missingCanonicalLayoutBackups.join('; ');
        _lastAction = 'load-blocked-missing-canonical-layout';
        notify();
        return { ok: false, action: _lastAction, changed: false, message: _lastError };
      }

      _ignoredFarmLayoutBackupFiles = folder.ignoredFarmLayoutBackupFiles || []; // Show ignored copies in the mobile save diagnostics.
      if (_handle.finishDriveLoad && folder.corruptFarmLayoutFiles.length) throw new Error('Google Drive farm files are corrupt. Recover them before writing.');
      await _handle.finishDriveLoad?.(); // Reject changes made during the folder read before importing or arming autosync.
      const browserMeta = readBrowserMeta();
      const browserLayouts = readBrowserFarmLayouts(browserMeta, false);
      const metaChanged = !browserMeta || !saveMetaMatches(browserMeta, folder.meta);
      const layoutsChanged = folderFarmLayoutsDiffer(folder.meta, browserLayouts, folder.farmLayouts);
      const changed = metaChanged || layoutsChanged;

      _lastKnownFolderMeta = folder.meta;
      _lastKnownFolderProvenance = folder.writerProvenance;
      const validWorldIds = new Set((folder.meta.worlds || []).map(world => String(world?.id || '')).filter(Boolean));
      const importSnapshot = () => { // Disk-backed imports must remain loadable even when their browser mirror cannot fit.
        localStorage.setItem(SAVE_META_KEY, JSON.stringify(folder.meta));
        for (const [worldId, layout] of Object.entries(folder.farmLayouts || {})) {
          if (!validWorldIds.has(worldId)) continue;
          localStorage.setItem(farmLayoutKey(worldId), JSON.stringify(layout));
        }
      };
      if (window.HobunjiStorageQuota?.importFolderSnapshot) window.HobunjiStorageQuota.importFolderSnapshot(importSnapshot);
      else importSnapshot();

      _folderSupportsFarmLayouts = folder.hasPortableFarmLayouts && folder.corruptFarmLayoutFiles.length === 0;
      _farmLayoutCount = Object.keys(folder.farmLayouts || {}).filter(worldId => validWorldIds.has(worldId)).length;
      if (!folder.corruptFarmLayoutFiles.length) _lastKnownFarmLayoutFingerprint = farmLayoutFingerprint(folder.farmLayouts); // An explicit folder load accepts the restored disk version.
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

      if (changed && reloadIfChanged) {
        if (window.__hobunjiGameStarted === true) window.HobunjiSessionPersistenceStartupGuard?.suppressExitFlush?.('folder-restore');
        reloadAfterFolderRestore();
      }
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
      _recoveryHandleFresh = false;
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

  // Persist a user-selected directory only after the old writer has drained.
  // Never redirect an in-flight autosave to a different physical directory.
  async function rememberSelectedFolder(handle) {
    const wasArmed = _autoSyncArmed; // Restores the original autosync if IndexedDB cannot remember the new handle.
    stopAutoSync();
    try {
      while (_syncPromise) await _syncPromise; // Current folder writes finish on their original handle.
      stopAutoSync(); // An explicit writer may have rearmed autosync while finishing.
      await idbSet(HANDLE_KEY, handle);
    } catch (error) {
      if (wasArmed && _state === 'ready' && _handle) startAutoSync(); // A failed switch must not disable the old folder's autosync.
      throw error;
    }
    _handle = handle; // No filesystem writer is active, and the handle is durably remembered.
    _committedFileState = null; // File fingerprints from the old directory cannot authorize no-op saves here.
    _lastManifestStamp = null; // The new directory must verify its own manifest.
  }

  // Picking/changing a folder only establishes access. If the folder is empty,
  // Save Now is still the explicit operation that initializes it.
  async function chooseFolder() {
    if (!isSupported()) return getStatus();
    const previouslyArmed = _autoSyncArmed; // Cancellation re-arms the original folder only when no new root was selected.
    let pickerCompleted = false; // Distinguishes a canceled Windows picker from a later IndexedDB/inspection failure.
    let switchCommitted = false; // Determines whether a failed inspection belongs to the newly remembered directory.
    stopAutoSync(); // Native Android Drive selection can commit the root before its picker Promise resolves.
    try {
      while (_syncPromise) await _syncPromise; // Finish every older writer before opening the native root chooser.
      stopAutoSync(); // A writer finishing during the drain must not re-arm the previous root.
      const handle = await (window.HobunjiBrowserDrive?.isSupported?.() ? window.HobunjiBrowserDrive.pickFolder() : window.showDirectoryPicker({ mode: 'readwrite' }));
      pickerCompleted = true;
      await rememberSelectedFolder(handle);
      switchCommitted = true;
      _state = 'ready';
      _lastError = '';
      _lastDataLossRisk = null;
      _lastKnownFolderMeta = null; // A newly picked folder has no relation to any previous baseline.
      _lastKnownFolderProvenance = null; // A different folder has its own latest-writer history.
      _lastKnownFarmLayoutFingerprint = null; // The new folder needs its own independent layout baseline.
      _ignoredFarmLayoutBackupFiles = []; // Clear the previous folder's version-copy diagnostics.
      _recoveryHandleFresh = true;
      await inspectConnectedFolder();
      _lastAction = 'folder-chosen-awaiting-choice';
      notify();
    } catch (error) {
      if (!pickerCompleted && previouslyArmed && _state === 'ready' && _handle) {
        startAutoSync(); // Cancelled or failed before selecting a new native root; old folder is still safe.
      }
      if (!pickerCompleted && error?.name === 'AbortError') {
        // Chromium uses AbortError for both Cancel and a restricted path denial.
        // No handle was changed and a previously armed folder remains writable.
        _lastError = 'Folder picker canceled or blocked access: ' + String(error?.message || 'No further reason supplied.') +
          ' If you selected a folder, choose the game-save directory itself rather than the Google Drive root.';
        _lastAction = 'folder-picker-aborted';
      } else {
        if (switchCommitted) _state = 'error'; // The selected folder was remembered but could not be inspected.
        _lastError = String(error?.message || error);
        _lastAction = 'choose-error'; // A failed picker or persistence attempt must never be mistaken for an old ready folder.
      }
      notify();
    }
    return getStatus();
  }

  const changeFolder = chooseFolder;

  async function chooseRecoveryFolder() {
    if (!isSupported()) return getStatus();
    const previousHandle = _handle; // Retained if recovery folder re-selection fails.
    const previousState = _state; // A canceled picker leaves the old primary folder state intact.
    const previouslyArmed = _autoSyncArmed; // Keep the original folder's writer paused while changing the recovery root.
    let pickerCompleted = false; // IndexedDB failures must not look like the user canceled the native picker.
    stopAutoSync();
    try {
      while (_syncPromise) await _syncPromise; // Native Drive picker may replace the selected root before returning.
      stopAutoSync();
      const handle = await (window.HobunjiBrowserDrive?.isSupported?.() ? window.HobunjiBrowserDrive.pickFolder() : window.showDirectoryPicker({ mode: 'readwrite' })); // Same native picker invocation as normal selection.
      pickerCompleted = true;
      await rememberSelectedFolder(handle);
      _state = 'ready';
      _lastError = '';
      _lastDataLossRisk = null;
      _lastKnownFolderMeta = null; // Recovery re-selection intentionally does not inspect canonical files.
      _lastKnownFolderProvenance = null;
      _lastKnownFarmLayoutFingerprint = null; // Switching folders must not compare different directories.
      _ignoredFarmLayoutBackupFiles = []; // Recompute version-copy diagnostics for this directory.
      _recoveryHandleFresh = true;
      _lastAction = 'recovery-folder-reselected';
      notify();
    } catch (error) {
      _handle = previousHandle;
      _state = previousState;
      _recoveryHandleFresh = false;
      if (!pickerCompleted && previouslyArmed && _state === 'ready' && _handle) startAutoSync();
      if (!pickerCompleted && error?.name === 'AbortError') {
        _lastError = 'Recovery folder selection canceled or blocked: ' + String(error?.message || error);
        _lastAction = 'recovery-folder-reselect-cancelled';
      } else {
        _lastError = String(error?.message || error);
        _lastAction = 'recovery-folder-reselect-error';
      }
      notify();
    }
    return getStatus();
  }

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
      _committedFileState = null; // Reconnection may follow external changes during a permissions gap.
      _lastManifestStamp = null;
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
    _lastKnownFolderProvenance = null;
    _lastKnownFarmLayoutFingerprint = null;
    _committedFileState = null;
    _lastManifestStamp = null;
    _lastSaveWork = { written: 0, unchanged: 0 };
    _ignoredFarmLayoutBackupFiles = [];
    _lastDataLossRisk = null;
    _lastPatternMirror = null;
    _recoveryHandleFresh = false;
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
      ...result,
      ok: true,
      message: result.changed ? result.message + ' Reload the page to apply it.' : result.message,
    };
  }

  window.addEventListener('beforeunload', () => {
    if (_state === 'ready' && _autoSyncArmed) syncNow({ automatic: true, reason: 'folder-unload' });
  });

  window.LocalSaveFolder = {
    isSupported,
    getStatus,
    onChange,
    chooseFolder,
    changeFolder,
    chooseRecoveryFolder,
    reconnect,
    forget,
    syncNow,
    syncSnapshot,
    canSaveLockProgress,
    saveLockProgress,
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
