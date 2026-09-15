// Folder Save V3 Canonical Adapter — adds one stable canonical save file beside
// the existing split V2 recovery tree without moving filesystem policy back into
// local-save-folder-core.js.
(() => {
  'use strict';

  const save = window.LocalSaveFolder; // Existing V2 filesystem API wrapped in place so all current UI/permission flows keep working.
  if (!save?.syncNow || !save?.loadFromFolder || window.FolderSaveV3Canonical) return;

  const CANONICAL_FILE_NAME = 'hobunji-primary-save.json'; // Stable filename used by desktop filesystem sync and, later, Google Drive file-id sync.
  const HANDLE_DB_NAME = 'hobunji-local-save-folder'; // Existing core IndexedDB database containing the remembered directory handle.
  const HANDLE_STORE_NAME = 'handles'; // Existing core object store used only to recover the already-selected directory handle.
  const HANDLE_KEY = 'dir'; // Existing core key holding the selected FileSystemDirectoryHandle.
  const TARGET_ID = 'folder'; // Durable sync-store target name used for the folder's remembered three-way baseline.

  const rawSyncNow = save.syncNow.bind(save); // V2 split-tree writer retained as the recovery-mirror write performed before the canonical file.
  const rawLoadFromFolder = save.loadFromFolder.bind(save); // V2 split-tree loader retained for fallback/mirroring while V3 becomes authoritative when present.
  const rawGetStatus = save.getStatus.bind(save); // Core status getter retained and augmented synchronously with cached V3 inspection state.
  const rawOnChange = typeof save.onChange === 'function' ? save.onChange.bind(save) : null; // Core status subscription wrapped so callers receive augmented V3 state.
  const rawReconnect = typeof save.reconnect === 'function' ? save.reconnect.bind(save) : null; // Permission reconnect retained with a post-reconnect V3 inspection.
  const rawChooseFolder = typeof save.chooseFolder === 'function' ? save.chooseFolder.bind(save) : null; // Folder picker retained with a post-selection V3 inspection.
  const rawChangeFolder = typeof save.changeFolder === 'function' ? save.changeFolder.bind(save) : null; // Folder-change alias retained with a post-selection V3 inspection.
  const listeners = new Set(); // Adapter-level listeners receive core changes plus asynchronous canonical-file inspection changes.

  let canonicalAvailable = false; // Cached existence flag surfaced through getStatus() without requiring async filesystem work.
  let canonicalContentHash = null; // Cached canonical payload hash shown in diagnostics and used to identify the inspected file.
  let canonicalRevision = null; // Cached canonical app-level revision shown in Settings/mobile diagnostics.
  let canonicalSaveSetId = null; // Cached stable save-set identity shown only through diagnostics, never used as conflict winner authority.
  let canonicalWrittenAt = null; // Cached informational write time from the canonical envelope.
  let canonicalLastCheckedAt = null; // Timestamp of the latest canonical filesystem inspection attempt.
  let canonicalError = ''; // Latest V3-only filesystem/validation failure merged into status without destroying the V2 core state.
  let canonicalSource = 'not-checked'; // Diagnostic source label describing whether V3 or V2 most recently supplied a folder load.
  let refreshPromise = null; // Coalesces simultaneous status-triggered canonical inspections.
  let syncPromise = null; // Serializes canonical wrapper writes above the core's own per-tab write serialization.
  let loadPromise = null; // Serializes canonical wrapper loads so two restore actions cannot interleave.

  function envelopeApi() {
    return window.HobunjiSaveEnvelope || null;
  }

  function snapshotApi() {
    return window.HobunjiSaveSnapshot || null;
  }

  function storeApi() {
    return window.HobunjiSaveSyncStore || null;
  }

  function coordinatorApi() {
    return window.HobunjiSaveCoordinator || null;
  }

  function isNotFound(error) {
    return error?.name === 'NotFoundError' || /not\s*found/i.test(String(error?.message || ''));
  }

  function clearCanonicalCache({ source = canonicalSource } = {}) {
    canonicalAvailable = false;
    canonicalContentHash = null;
    canonicalRevision = null;
    canonicalSaveSetId = null;
    canonicalWrittenAt = null;
    canonicalSource = source;
  }

  function cacheEnvelope(envelope, source) {
    canonicalAvailable = true;
    canonicalContentHash = envelope?.contentHash || null;
    canonicalRevision = Number(envelope?.revision) || null;
    canonicalSaveSetId = envelope?.saveSetId || null;
    canonicalWrittenAt = Number(envelope?.writtenAt) || null;
    canonicalSource = source || canonicalSource;
    canonicalError = '';
    canonicalLastCheckedAt = Date.now();
  }

  function augmentedStatus(base = rawGetStatus()) {
    return {
      ...base,
      lastError: canonicalError || base?.lastError || null,
      canonicalFileName: CANONICAL_FILE_NAME,
      canonicalAvailable,
      canonicalContentHash,
      canonicalRevision,
      canonicalSaveSetId,
      canonicalWrittenAt,
      canonicalLastCheckedAt,
      canonicalSource,
      portableSaveVersion: canonicalAvailable ? 3 : (base?.portableFarmLayouts ? 2 : 1),
    };
  }

  function notify() {
    const status = augmentedStatus(); // Snapshot delivered to adapter listeners after either core or V3 state changes.
    for (const listener of listeners) {
      try { listener(status); } catch {}
    }
  }

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(HANDLE_DB_NAME, 1); // Opens the same handle database as the existing filesystem core without creating a second picker state.
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the remembered save-folder handle database.'));
    });
  }

  async function rememberedFolderHandle() {
    const injected = window.__hobunjiFolderSaveV3Handle; // Test/debug injection avoids browser picker/IndexedDB dependencies while exercising real adapter logic.
    if (injected) return injected;
    if (typeof indexedDB === 'undefined') return null;
    const db = await openHandleDb(); // Existing handle database connection used for one readonly directory-handle lookup.
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(HANDLE_STORE_NAME, 'readonly'); // Readonly access cannot alter the folder core's remembered picker state.
        const request = transaction.objectStore(HANDLE_STORE_NAME).get(HANDLE_KEY); // Directory handle already selected by the existing core.
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error || transaction.error || new Error('Could not read the remembered save-folder handle.'));
      });
    } finally {
      try { db.close(); } catch {}
    }
  }

  async function ensureReadWritePermission(handle, requestIfNeeded = false) {
    if (!handle) return false;
    if (typeof handle.queryPermission !== 'function') return true;
    const options = { mode: 'readwrite' }; // Matches the permission mode already requested by the V2 filesystem core.
    if ((await handle.queryPermission(options)) === 'granted') return true;
    if (!requestIfNeeded || typeof handle.requestPermission !== 'function') return false;
    return (await handle.requestPermission(options)) === 'granted';
  }

  async function readCanonicalEnvelope({ verifyHash = true } = {}) {
    const handle = await rememberedFolderHandle(); // Existing selected folder handle is reused rather than prompting for a second directory.
    if (!handle) return null;
    const permission = await ensureReadWritePermission(handle, false); // Passive inspection never triggers a permission prompt.
    if (!permission) return null;

    let fileHandle; // Stable canonical FileSystemFileHandle retrieved by fixed filename, preserving external file identity across overwrites.
    try {
      fileHandle = await handle.getFileHandle(CANONICAL_FILE_NAME);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const file = await fileHandle.getFile(); // Current canonical file contents read immediately before validation/reconciliation.
    const text = await file.text(); // UTF-8 JSON envelope consumed by the shared transport-neutral parser.
    const envelope = await envelopeApi()?.parse?.(text, { verifyHash });
    if (!envelope) throw new Error('Canonical save envelope API is unavailable.');
    return envelope;
  }

  async function writeCanonicalEnvelope(envelope) {
    const api = envelopeApi(); // Shared envelope serializer guarantees filesystem and future Drive transports write identical payloads.
    if (!api?.serialize || !api?.verify) throw new Error('Canonical save envelope API is unavailable.');
    const verification = await api.verify(envelope); // Refuses to serialize an envelope whose declared gameplay hash no longer matches its snapshot.
    if (!verification.ok) throw new Error('Canonical save envelope failed verification before the folder write.');

    const handle = await rememberedFolderHandle(); // Existing selected directory reused for the fixed canonical file.
    if (!handle) throw new Error('No remembered Primary Save Folder handle is available.');
    if (!(await ensureReadWritePermission(handle, false))) throw new Error('Primary Save Folder permission is not currently granted.');

    const fileHandle = await handle.getFileHandle(CANONICAL_FILE_NAME, { create: true }); // Fixed file handle is overwritten in place so Drive-for-Desktop can retain one file identity.
    const writable = await fileHandle.createWritable(); // File System Access writable stream truncates/replaces the prior canonical JSON atomically at close on supporting browsers.
    const text = api.serialize(envelope, { pretty: true }); // Human-readable canonical file remains recoverable/inspectable outside the game.
    try {
      await writable.write(text);
      await writable.close();
    } catch (error) {
      try { await writable.abort?.(); } catch {}
      throw error;
    }

    const roundTripFile = await fileHandle.getFile(); // Immediate read-back verifies that the filesystem contains exactly a valid canonical envelope after close.
    const roundTrip = await api.parse(await roundTripFile.text(), { verifyHash: true }); // Hash validation catches partial/truncated filesystem writes before success is reported.
    if (roundTrip.contentHash !== envelope.contentHash) {
      throw new Error(`Canonical save verification mismatch after write: expected ${envelope.contentHash}, found ${roundTrip.contentHash}.`);
    }
    cacheEnvelope(roundTrip, 'v3-written');
    return roundTrip;
  }

  async function refreshCanonicalStatus() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      canonicalLastCheckedAt = Date.now();
      try {
        const envelope = await readCanonicalEnvelope({ verifyHash: true }); // Passive V3 inspection updates status but never changes browser gameplay state.
        if (envelope) cacheEnvelope(envelope, canonicalSource === 'not-checked' ? 'v3-present' : canonicalSource);
        else {
          clearCanonicalCache({ source: canonicalSource === 'not-checked' ? 'v2-only' : canonicalSource });
          canonicalError = '';
        }
      } catch (error) {
        canonicalError = `Canonical V3 save could not be inspected: ${String(error?.message || error)}`;
        canonicalSource = 'v3-invalid';
      }
      notify();
      return augmentedStatus();
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function durableEnvelopeForCurrentBrowser() {
    const coordinator = coordinatorApi(); // Coordinator captures the same validated browser save boundary used by cloud/folder persistence.
    if (!coordinator?.commitCurrent) throw new Error('Durable save coordinator is unavailable.');
    const committed = await coordinator.commitCurrent({ reason: 'folder-v3-canonical-write' }); // Reuses the prior envelope when gameplay content is unchanged.
    if (!committed?.ok) {
      if (committed?.unavailable) throw new Error(committed.error || 'Durable save storage is unavailable for the canonical folder write.');
      throw new Error(committed?.error || 'Could not commit the canonical local save before writing the folder.');
    }
    return committed.envelope;
  }

  async function syncNow(options = {}) {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const v2Status = await rawSyncNow(options); // Existing split-tree write/data-loss guard runs first and remains a complete recovery mirror.
      if (v2Status?.lastError || v2Status?.dataLossRisk || v2Status?.state !== 'ready') return augmentedStatus(v2Status);

      try {
        const envelope = await durableEnvelopeForCurrentBrowser(); // Current validated gameplay snapshot is wrapped only after the existing folder write succeeds.
        const written = await writeCanonicalEnvelope(envelope); // Fixed-name V3 canonical file is overwritten in place and read back for verification.
        await storeApi()?.setBaseline?.(TARGET_ID, written); // Successful folder write establishes the new last-common baseline for future three-way reconciliation.
        await storeApi()?.appendEvent?.('FOLDER V3 WRITE', {
          contentHash: written.contentHash,
          revision: written.revision,
          automatic: !!options?.automatic,
        });
        canonicalError = '';
      } catch (error) {
        canonicalError = `Canonical V3 save failed: ${String(error?.message || error)}`;
        canonicalSource = 'v3-write-error';
        try { await storeApi()?.appendEvent?.('FOLDER V3 WRITE ERROR', { error: canonicalError }); } catch {}
      }
      notify();
      return augmentedStatus(v2Status);
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function browserFingerprint() {
    try { return snapshotApi()?.fingerprint?.() || ''; } catch { return ''; }
  }

  async function loadCanonical(envelope) {
    const before = browserFingerprint(); // Existing browser save fingerprint used only to report whether onboarding-visible state actually changed.
    snapshotApi()?.apply?.(envelope.snapshot); // V3 snapshot becomes authoritative browser state before the V2 core is engaged for compatibility/autosync.

    // Let the V2 core perform its normal permission/reconciliation path so its
    // legacy autosync and recovery-mirror machinery remains armed. It may read
    // older split files, so the canonical V3 snapshot is applied again afterward.
    const v2Result = await rawLoadFromFolder(); // Existing V2 load/empty-folder bootstrap behavior retained beneath the canonical authority.
    snapshotApi()?.apply?.(envelope.snapshot); // Reassert canonical V3 state after any stale recovery mirror was temporarily read by the legacy core.

    await storeApi()?.commitEnvelope?.(envelope); // Preserve the exact external saveSet/revision/hash locally rather than manufacturing a new identity during restore.
    await storeApi()?.setBaseline?.(TARGET_ID, envelope); // The just-loaded folder and durable local state are now known to share this exact content.
    await storeApi()?.appendEvent?.('FOLDER V3 LOAD', {
      contentHash: envelope.contentHash,
      revision: envelope.revision,
    });
    cacheEnvelope(envelope, 'v3-loaded');

    const after = browserFingerprint(); // Post-restore fingerprint determines whether onboarding/gameplay must refresh/reload.
    return {
      ok: true,
      changed: before !== after,
      action: 'loaded-v3-canonical-folder',
      message: `Loaded canonical V3 save from ${CANONICAL_FILE_NAME}.`,
      canonical: true,
      recoveryMirrorResult: v2Result || null,
    };
  }

  async function loadFromFolder(...args) {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      canonicalLastCheckedAt = Date.now();
      try {
        const envelope = await readCanonicalEnvelope({ verifyHash: true }); // V3 is checked first and wins whenever the fixed canonical file exists and validates.
        if (envelope) {
          const result = await loadCanonical(envelope);
          canonicalError = '';
          notify();
          return result;
        }
        clearCanonicalCache({ source: 'v2-loaded' });
        canonicalError = '';
      } catch (error) {
        // A present-but-invalid canonical file is never silently ignored in favor
        // of potentially stale recovery mirrors. Preserve both and make the
        // corruption visible so the player can recover deliberately.
        canonicalError = `Canonical V3 save is invalid and was not bypassed: ${String(error?.message || error)}`;
        canonicalSource = 'v3-invalid';
        notify();
        return { ok: false, changed: false, action: 'v3-invalid', message: canonicalError };
      }

      const result = await rawLoadFromFolder(...args); // No canonical file: legacy V2 remains the source and is not upgraded merely by loading it.
      canonicalSource = result?.ok ? 'v2-loaded' : canonicalSource;
      await refreshCanonicalStatus();
      return result;
    })().finally(() => { loadPromise = null; });
    return loadPromise;
  }

  async function wrapFolderSelection(operation, ...args) {
    const status = await operation(...args); // Existing picker/reconnect operation remains authoritative for permission/handle state.
    clearCanonicalCache({ source: 'not-checked' });
    canonicalError = '';
    await refreshCanonicalStatus(); // Newly-selected/reconnected folder is immediately inspected for a V3 canonical file.
    return augmentedStatus(status);
  }

  save.getStatus = () => augmentedStatus();
  save.syncNow = syncNow;
  save.loadFromFolder = loadFromFolder;
  if (rawReconnect) save.reconnect = (...args) => wrapFolderSelection(rawReconnect, ...args);
  if (rawChooseFolder) save.chooseFolder = (...args) => wrapFolderSelection(rawChooseFolder, ...args);
  if (rawChangeFolder) save.changeFolder = (...args) => wrapFolderSelection(rawChangeFolder, ...args);
  if (rawOnChange) {
    save.onChange = listener => {
      listeners.add(listener);
      const unsubscribeCore = rawOnChange(status => {
        try { listener(augmentedStatus(status)); } catch {}
        if (status?.state === 'ready') refreshCanonicalStatus().catch(() => {});
      });
      return () => {
        listeners.delete(listener);
        try { unsubscribeCore?.(); } catch {}
      };
    };
  }

  window.FolderSaveV3Canonical = Object.freeze({
    CANONICAL_FILE_NAME,
    refresh: refreshCanonicalStatus,
    readCanonicalEnvelope,
    writeCanonicalEnvelope,
    getStatus: () => augmentedStatus(),
  });

  window.__hobunjiFolderSaveV3Debug = {
    snapshot: () => ({
      fileName: CANONICAL_FILE_NAME,
      available: canonicalAvailable,
      contentHash: canonicalContentHash,
      revision: canonicalRevision,
      saveSetId: canonicalSaveSetId,
      writtenAt: canonicalWrittenAt,
      lastCheckedAt: canonicalLastCheckedAt,
      source: canonicalSource,
      error: canonicalError || null,
    }),
  };

  // Core initialization restores the directory handle asynchronously; its
  // onChange callback above will re-run this inspection once state becomes ready.
  refreshCanonicalStatus().catch(() => {});
})();
