// Google Drive Save Transport — narrow drive.file persistence for the canonical
// Hobunji save envelope. Access tokens remain memory-only; durable state stores
// only Drive file identity, last-common hashes, pending writes, and conflicts.
(() => {
  'use strict';

  if (window.HobunjiGoogleDriveSave) return;

  const config = window.HobunjiGoogleDriveSaveConfig; // Public OAuth/Picker configuration loaded immediately before this transport.
  const TARGET_ID = 'drive'; // Durable sync-store target name for pending writes, link metadata, baselines, and conflicts.
  const GIS_SCRIPT_ID = 'hobunjiGoogleIdentityServices'; // Lazy script element id for the Google Identity Services browser library.
  const PICKER_SCRIPT_ID = 'hobunjiGooglePickerApi'; // Lazy script element id for the Google APIs loader used by Picker.
  const GIS_SRC = 'https://accounts.google.com/gsi/client'; // Official Google Identity Services browser script.
  const PICKER_SRC = 'https://apis.google.com/js/api.js'; // Official Google API loader used to load the Picker module.
  const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'; // Drive v3 metadata/download endpoint root.
  const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'; // Drive v3 media upload endpoint root.
  const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,version,size,trashed'; // Minimal remote metadata needed for identity/version diagnostics and verification.
  const listeners = new Set(); // Status listeners used by future Settings/diagnostics UI without polling.
  const hooks = window.__hobunjiGoogleDriveSaveTestHooks || null; // Test-only injection for token, Picker, and fetch behavior.

  let state = config?.configured ? 'idle' : 'not-configured'; // High-level transport state shown in mobile diagnostics/Settings.
  let lastAction = 'none'; // Most recent Drive operation for mobile-readable diagnosis.
  let lastError = ''; // Most recent Drive transport error, excluding the secret access token.
  let link = null; // Non-secret remembered Drive file/folder metadata hydrated from the durable sync store.
  let accessToken = ''; // OAuth bearer token intentionally held in memory only and never written to IndexedDB/localStorage.
  let accessTokenExpiresAt = 0; // Memory-only approximate token expiration used to suppress background prompts.
  let tokenClient = null; // Lazy Google Identity Services token client initialized only after a user Drive action.
  let tokenPromise = null; // Coalesces simultaneous interactive token requests into one Google account/consent flow.
  let pickerLoadPromise = null; // Coalesces Google Picker script/module loading.
  let gisLoadPromise = null; // Coalesces Google Identity Services script loading.
  let busyOperation = null; // Human-readable operation name preventing overlapping Drive mutations.
  let lastRemoteVersion = null; // Latest Drive file version observed through metadata reads/writes.
  let lastRemoteModifiedTime = null; // Latest Drive modifiedTime observed for diagnostics only, never conflict winner selection.
  let lastRemoteHash = null; // Latest validated canonical envelope hash observed on Drive.
  let lastVerifiedAt = null; // Time of the latest successful post-write/download hash verification.

  class AuthRequiredError extends Error {
    constructor(message = 'Google Drive authorization is required.') {
      super(message);
      this.name = 'AuthRequiredError';
      this.authRequired = true;
    }
  }

  function storeApi() {
    return window.HobunjiSaveSyncStore || null;
  }

  function envelopeApi() {
    return window.HobunjiSaveEnvelope || null;
  }

  function snapshotApi() {
    return window.HobunjiSaveSnapshot || null;
  }

  function coordinatorApi() {
    return window.HobunjiSaveCoordinator || null;
  }

  function reconciliationApi() {
    return window.HobunjiSaveReconciliation || null;
  }

  function configured() {
    return Boolean(config?.configured && config?.clientId && config?.apiKey && config?.appId && config?.scope);
  }

  function getStatus() {
    return {
      configured: configured(),
      state,
      busyOperation,
      linked: Boolean(link?.fileId),
      fileId: link?.fileId || null,
      folderId: link?.folderId || null,
      fileName: link?.name || config?.canonicalFileName || 'hobunji-primary-save.json',
      remoteVersion: lastRemoteVersion || link?.version || null,
      remoteModifiedTime: lastRemoteModifiedTime || link?.modifiedTime || null,
      remoteContentHash: lastRemoteHash || null,
      tokenPresent: Boolean(accessToken && accessTokenExpiresAt > Date.now()),
      tokenExpiresAt: accessTokenExpiresAt || null,
      scope: config?.scope || null,
      lastVerifiedAt,
      lastAction,
      lastError: lastError || null,
    };
  }

  function notify() {
    const status = getStatus(); // Immutable-ish snapshot delivered synchronously after transport state changes.
    for (const listener of listeners) {
      try { listener(status); } catch {}
    }
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setTransportState(nextState, action = lastAction, error = '') {
    state = nextState;
    lastAction = action;
    lastError = error ? String(error) : '';
    notify();
  }

  async function recordEvent(type, details = {}) {
    try { await storeApi()?.appendEvent?.(type, details); } catch {}
  }

  function assertConfigured() {
    if (!configured()) throw new Error('Google Drive Save is not configured for this deployment.');
  }

  function loadScript(id, src) {
    if (typeof document === 'undefined') return Promise.reject(new Error('Google browser libraries require a document.'));
    const existing = document.getElementById(id); // Existing script element reused across repeated Drive actions.
    if (existing?.dataset?.loaded === 'true') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = existing || document.createElement('script'); // Lazy external script element created only after a Drive user action.
      script.id = id;
      script.src = src;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Could not load ${src}.`)), { once: true });
      if (!existing) document.head.appendChild(script);
    });
  }

  async function ensureGisLoaded() {
    if (hooks?.requestAccessToken) return;
    if (window.google?.accounts?.oauth2?.initTokenClient) return;
    if (!gisLoadPromise) gisLoadPromise = loadScript(GIS_SCRIPT_ID, GIS_SRC).finally(() => { gisLoadPromise = null; });
    await gisLoadPromise;
    if (!window.google?.accounts?.oauth2?.initTokenClient) throw new Error('Google Identity Services did not initialize.');
  }

  async function ensurePickerLoaded() {
    if (hooks?.pickFile || hooks?.pickFolder) return;
    if (window.google?.picker?.PickerBuilder) return;
    if (!pickerLoadPromise) {
      pickerLoadPromise = (async () => {
        await loadScript(PICKER_SCRIPT_ID, PICKER_SRC);
        if (!window.gapi?.load) throw new Error('Google API loader did not initialize.');
        await new Promise((resolve, reject) => {
          let settled = false; // Prevents Picker loader timeout/error callbacks from resolving twice.
          const finish = fn => value => {
            if (settled) return;
            settled = true;
            fn(value);
          };
          const timer = setTimeout(finish(reject), 10000, new Error('Google Picker module timed out while loading.')); // Mobile-visible failure instead of a permanently disabled button.
          window.gapi.load('picker', {
            callback: finish(() => { clearTimeout(timer); resolve(); }),
            onerror: finish(() => { clearTimeout(timer); reject(new Error('Google Picker module failed to load.')); }),
          });
        });
      })().finally(() => { pickerLoadPromise = null; });
    }
    await pickerLoadPromise;
    if (!window.google?.picker?.PickerBuilder) throw new Error('Google Picker did not initialize.');
  }

  function tokenStillValid() {
    return Boolean(accessToken && accessTokenExpiresAt > Date.now() + 15000); // Fifteen-second safety margin avoids starting an API request with an almost-expired token.
  }

  function acceptTokenResponse(response) {
    if (!response?.access_token) throw new AuthRequiredError(response?.error_description || response?.error || 'Google did not return an access token.');
    accessToken = String(response.access_token); // Memory-only bearer token used directly with Drive REST requests.
    const expiresIn = Math.max(60, Number(response.expires_in) || 3600); // Token lifetime supplied by GIS; conservative one-hour fallback for tests/older responses.
    accessTokenExpiresAt = Date.now() + expiresIn * 1000;
    state = link?.fileId ? 'ready' : 'authorized-unlinked';
    lastError = '';
    notify();
    return accessToken;
  }

  async function requestAccessToken({ interactive = false } = {}) {
    assertConfigured();
    if (tokenStillValid()) return accessToken;
    if (!interactive) {
      state = 'auth-required';
      lastAction = 'drive-auth-required';
      notify();
      throw new AuthRequiredError();
    }
    if (tokenPromise) return tokenPromise;

    tokenPromise = (async () => {
      setTransportState('authorizing', 'drive-authorize');
      if (hooks?.requestAccessToken) {
        const response = await hooks.requestAccessToken({ interactive: true, scope: config.scope }); // Test hook verifies exact scope without loading Google's browser library.
        return acceptTokenResponse(response);
      }

      await ensureGisLoaded();
      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: config.clientId,
          scope: config.scope,
          callback: () => {},
          error_callback: () => {},
        }); // GIS token client contains no client secret and is never persisted.
      }

      const response = await new Promise((resolve, reject) => {
        tokenClient.callback = value => {
          if (value?.error) reject(new AuthRequiredError(value.error_description || value.error));
          else resolve(value);
        };
        tokenClient.error_callback = error => reject(new AuthRequiredError(error?.message || error?.type || 'Google authorization failed.'));
        tokenClient.requestAccessToken({ prompt: '' }); // Called only from an explicit Drive user action; GIS chooses account/consent UI as needed.
      });
      return acceptTokenResponse(response);
    })().catch(error => {
      accessToken = '';
      accessTokenExpiresAt = 0;
      setTransportState(error?.authRequired ? 'auth-required' : 'error', 'drive-authorize-error', error?.message || error);
      throw error;
    }).finally(() => { tokenPromise = null; });

    return tokenPromise;
  }

  function fetchImpl() {
    return hooks?.fetch || window.fetch?.bind(window) || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  async function authorizedFetch(url, options = {}, { interactive = false } = {}) {
    const token = await requestAccessToken({ interactive }); // Background calls reuse only a still-valid memory token and never trigger consent UI.
    const doFetch = fetchImpl(); // Native fetch or deterministic test hook used for Drive REST requests.
    if (!doFetch) throw new Error('Fetch is unavailable for Google Drive requests.');
    const headers = new Headers(options.headers || {}); // Caller headers augmented with the memory-only OAuth bearer token.
    headers.set('Authorization', `Bearer ${token}`);
    const response = await doFetch(url, { ...options, headers });
    if (response.status === 401) {
      accessToken = '';
      accessTokenExpiresAt = 0;
      state = 'auth-required';
      lastAction = 'drive-token-expired';
      notify();
      throw new AuthRequiredError('Google Drive authorization expired. Use Sync Now or Link Google Drive to authorize again.');
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 600); } catch {}
      throw new Error(`Google Drive request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})${detail ? `: ${detail}` : ''}`);
    }
    return response;
  }

  function fileUrl(fileId, query = '') {
    return `${DRIVE_API}/${encodeURIComponent(fileId)}${query ? `?${query}` : ''}`;
  }

  async function fetchMetadata(fileId, { interactive = false } = {}) {
    const query = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: 'true' }); // Partial response avoids downloading unrelated Drive metadata.
    const response = await authorizedFetch(fileUrl(fileId, query.toString()), {}, { interactive });
    const metadata = await response.json(); // Drive file identity/version information cached for diagnostics and link persistence.
    if (metadata?.trashed) throw new Error('The linked Google Drive save file is in the trash.');
    lastRemoteVersion = metadata?.version != null ? String(metadata.version) : null;
    lastRemoteModifiedTime = metadata?.modifiedTime || null;
    return metadata;
  }

  async function downloadEnvelope(fileId, { interactive = false } = {}) {
    const query = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' }); // Media download returns only canonical JSON contents.
    const response = await authorizedFetch(fileUrl(fileId, query.toString()), {}, { interactive });
    const text = await response.text(); // Canonical envelope text verified by the shared SHA-256 parser before becoming trusted.
    const envelope = await envelopeApi()?.parse?.(text, { verifyHash: true });
    if (!envelope) throw new Error('Canonical save envelope API is unavailable.');
    lastRemoteHash = envelope.contentHash;
    lastVerifiedAt = Date.now();
    return envelope;
  }

  async function inspectRemote({ interactive = false } = {}) {
    if (!link?.fileId) throw new Error('No Google Drive save file is linked.');
    const metadata = await fetchMetadata(link.fileId, { interactive }); // Metadata/version read precedes content download for diagnostics and deleted/trash detection.
    const envelope = await downloadEnvelope(link.fileId, { interactive }); // Hash-verified canonical content used for reconciliation.
    link = {
      ...link,
      name: metadata.name || link.name,
      folderId: metadata.parents?.[0] || link.folderId || null,
      mimeType: metadata.mimeType || link.mimeType || 'application/json',
      version: metadata.version != null ? String(metadata.version) : link.version || null,
      modifiedTime: metadata.modifiedTime || link.modifiedTime || null,
    }; // Refreshed non-secret link metadata persisted so diagnostics survive reloads.
    await storeApi()?.setLink?.(TARGET_ID, link);
    await recordEvent('DRIVE READ', { fileId: link.fileId, version: link.version || null, contentHash: envelope.contentHash });
    state = 'ready';
    lastAction = 'drive-read';
    lastError = '';
    notify();
    return { metadata, envelope };
  }

  function makeMultipartBody(metadata, content) {
    const boundary = `hobunji_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`; // Per-request multipart boundary separating Drive metadata from canonical JSON media.
    const body = new Blob([
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      content,
      `\r\n--${boundary}--`,
    ], { type: `multipart/related; boundary=${boundary}` }); // Small canonical save plus metadata sent in one Drive create request.
    return { boundary, body };
  }

  async function createRemoteFile(folderId, envelope, { interactive = true } = {}) {
    const content = envelopeApi()?.serialize?.(envelope, { pretty: true }); // Shared canonical serialization guarantees Drive bytes represent the same envelope as desktop filesystem saves.
    if (!content) throw new Error('Canonical save envelope API is unavailable.');
    const metadata = {
      name: config.canonicalFileName,
      mimeType: 'application/json',
      parents: [folderId],
    }; // User-selected parent folder plus fixed canonical filename supplied during file creation.
    const multipart = makeMultipartBody(metadata, content); // Multipart create uploads metadata and the small JSON save in one request.
    const query = new URLSearchParams({ uploadType: 'multipart', fields: FILE_FIELDS, supportsAllDrives: 'true' });
    const response = await authorizedFetch(`${DRIVE_UPLOAD_API}?${query.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${multipart.boundary}` },
      body: multipart.body,
    }, { interactive });
    const created = await response.json(); // Newly-assigned Drive file id becomes the durable link identity for all future writes.
    if (!created?.id) throw new Error('Google Drive created the save file without returning a file id.');
    return created;
  }

  async function updateRemoteFile(fileId, envelope, { interactive = false } = {}) {
    const content = envelopeApi()?.serialize?.(envelope, { pretty: true }); // Complete small canonical save replaces the existing Drive file media in-place.
    if (!content) throw new Error('Canonical save envelope API is unavailable.');
    const query = new URLSearchParams({ uploadType: 'media', fields: FILE_FIELDS, supportsAllDrives: 'true' });
    const response = await authorizedFetch(`${DRIVE_UPLOAD_API}/${encodeURIComponent(fileId)}?${query.toString()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: content,
    }, { interactive }); // PATCH updates the existing file id rather than creating duplicates.
    const metadata = await response.json(); // Returned Drive version captured before post-write content verification.
    lastRemoteVersion = metadata?.version != null ? String(metadata.version) : lastRemoteVersion;
    lastRemoteModifiedTime = metadata?.modifiedTime || lastRemoteModifiedTime;

    const verified = await downloadEnvelope(fileId, { interactive }); // Immediate read-back ensures Drive contains a valid envelope with the intended gameplay hash.
    if (verified.contentHash !== envelope.contentHash) {
      throw new Error(`Google Drive verification mismatch: expected ${envelope.contentHash}, found ${verified.contentHash}.`);
    }
    lastVerifiedAt = Date.now();
    return { metadata, envelope: verified };
  }

  async function showPicker(kind) {
    await requestAccessToken({ interactive: true }); // Picker itself requires a current OAuth token supplied from the explicit user action.
    if (kind === 'file' && hooks?.pickFile) return hooks.pickFile();
    if (kind === 'folder' && hooks?.pickFolder) return hooks.pickFolder();
    await ensurePickerLoaded();

    return new Promise((resolve, reject) => {
      const picker = window.google.picker; // Picker namespace loaded lazily only for link/create actions.
      const view = kind === 'folder'
        ? new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true)
        : new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(false).setMimeTypes('application/json'); // Folder picker grants a parent; file picker grants one existing JSON save.
      let builder = new picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setMaxItems(1)
        .addView(view)
        .setCallback(data => {
          if (data?.action === picker.Action.CANCEL) {
            resolve(null);
            return;
          }
          if (data?.action !== picker.Action.PICKED) return;
          const docs = data?.docs || data?.[picker.Response?.DOCUMENTS] || []; // Picker response normalized across current/older field aliases.
          const documentValue = docs[0] || null; // Only one file/folder can be selected by this save workflow.
          const id = documentValue?.id || documentValue?.[picker.Document?.ID] || null;
          if (!id) reject(new Error('Google Picker selection did not include a Drive id.'));
          else resolve({ id, name: documentValue?.name || documentValue?.[picker.Document?.NAME] || null });
        });
      if (typeof location !== 'undefined' && location.origin && builder.setOrigin) builder = builder.setOrigin(location.origin); // Explicit origin keeps Picker iframe communication scoped to the current deployment.
      builder.build().setVisible(true);
    });
  }

  async function persistLink(metadata, { folderId = null } = {}) {
    link = {
      fileId: metadata.id,
      folderId: folderId || metadata.parents?.[0] || null,
      name: metadata.name || config.canonicalFileName,
      mimeType: metadata.mimeType || 'application/json',
      version: metadata.version != null ? String(metadata.version) : null,
      modifiedTime: metadata.modifiedTime || null,
      linkedAt: Date.now(),
    }; // Only non-secret Drive identity/version metadata is persisted across sessions.
    await storeApi()?.setLink?.(TARGET_ID, link);
    lastRemoteVersion = link.version;
    lastRemoteModifiedTime = link.modifiedTime;
    state = 'ready';
    lastError = '';
    notify();
    return link;
  }

  async function currentDurableEnvelope({ queueForDrive = false, reason = 'drive-sync' } = {}) {
    const store = storeApi(); // Durable local source of truth preferred over directly re-reading browser localStorage.
    let current = await store?.getCurrentEnvelope?.();
    if (!current || queueForDrive) {
      const committed = await coordinatorApi()?.commitCurrent?.({ reason, pendingTargets: queueForDrive ? [TARGET_ID] : [] }); // Explicit sync/create captures the latest browser state and optionally queues Drive atomically.
      if (!committed?.ok) throw new Error(committed?.error || 'Could not commit the current save before Google Drive sync.');
      current = committed.envelope;
    }
    if (!current) throw new Error('No durable local save is available for Google Drive.');
    return current;
  }

  async function withBusy(name, operation) {
    if (busyOperation) throw new Error(`Google Drive is already busy with ${busyOperation}.`);
    busyOperation = name;
    state = 'busy';
    lastAction = name;
    lastError = '';
    notify();
    try {
      return await operation();
    } catch (error) {
      const message = String(error?.message || error); // Error text shown in Settings/diagnostics without exposing bearer tokens.
      lastError = message;
      state = error?.authRequired ? 'auth-required' : 'error';
      await recordEvent('DRIVE ERROR', { action: name, error: message });
      notify();
      throw error;
    } finally {
      busyOperation = null;
      if (state === 'busy') state = link?.fileId ? 'ready' : (configured() ? 'idle' : 'not-configured');
      notify();
    }
  }

  async function linkExistingFile() {
    return withBusy('link-existing-drive-save', async () => {
      assertConfigured();
      const selection = await showPicker('file'); // Explicit Picker selection is the user grant surface for drive.file access to an existing save.
      if (!selection) {
        state = link?.fileId ? 'ready' : 'idle';
        lastAction = 'drive-link-cancelled';
        return { ok: false, cancelled: true, status: getStatus() };
      }
      const metadata = await fetchMetadata(selection.id, { interactive: true });
      const remoteEnvelope = await downloadEnvelope(selection.id, { interactive: true }); // Valid canonical envelope required before link metadata is remembered.
      await persistLink(metadata);

      const localEnvelope = await storeApi()?.getCurrentEnvelope?.(); // Existing local durable state compared without automatically choosing a winner on first link.
      const baseline = await storeApi()?.getBaseline?.(TARGET_ID);
      const decision = reconciliationApi()?.decide?.({
        localEnvelope,
        externalEnvelope: remoteEnvelope,
        baselineContentHash: baseline?.contentHash || null,
      }) || null;
      lastAction = 'drive-linked-existing';
      await recordEvent('DRIVE LINK EXISTING', { fileId: metadata.id, remoteHash: remoteEnvelope.contentHash, decision: decision?.state || null });
      notify();
      return { ok: true, link, metadata, remoteEnvelope, decision, status: getStatus() };
    });
  }

  async function createDriveSave() {
    return withBusy('create-drive-save', async () => {
      assertConfigured();
      const localEnvelope = await currentDurableEnvelope({ queueForDrive: true, reason: 'drive-create' }); // Latest local state becomes the initial Drive file contents.
      const selection = await showPicker('folder'); // Explicit folder selection grants the app a parent in which it can create its own canonical file.
      if (!selection) {
        state = link?.fileId ? 'ready' : 'idle';
        lastAction = 'drive-create-cancelled';
        return { ok: false, cancelled: true, status: getStatus() };
      }
      const created = await createRemoteFile(selection.id, localEnvelope, { interactive: true });
      await persistLink(created, { folderId: selection.id });
      const verified = await downloadEnvelope(created.id, { interactive: true }); // Newly-created file is immediately downloaded/hash-verified before becoming the common baseline.
      if (verified.contentHash !== localEnvelope.contentHash) throw new Error('New Google Drive save did not verify after creation.');
      await storeApi()?.setBaseline?.(TARGET_ID, localEnvelope);
      await storeApi()?.clearPending?.(TARGET_ID, { expectedContentHash: localEnvelope.contentHash });
      await storeApi()?.setConflict?.(TARGET_ID, null);
      lastAction = 'drive-created';
      await recordEvent('DRIVE CREATE', { fileId: created.id, folderId: selection.id, contentHash: localEnvelope.contentHash });
      notify();
      return { ok: true, link, envelope: verified, status: getStatus() };
    });
  }

  async function syncPending({ interactive = false } = {}) {
    return withBusy(interactive ? 'drive-sync-user' : 'drive-sync-background', async () => {
      assertConfigured();
      if (!link?.fileId) return { ok: false, unlinked: true, status: getStatus() };

      let pending = await storeApi()?.getPending?.(TARGET_ID); // Latest atomically queued local envelope is the only state eligible for automatic upload.
      if (!pending && interactive) {
        await currentDurableEnvelope({ queueForDrive: true, reason: 'drive-sync-user' });
        pending = await storeApi()?.getPending?.(TARGET_ID);
      }
      const localEnvelope = pending?.envelope || await storeApi()?.getCurrentEnvelope?.();
      if (!localEnvelope) return { ok: true, nothingToSync: true, status: getStatus() };

      const remote = await inspectRemote({ interactive }); // Mandatory preflight read prevents overwriting a Drive-for-Desktop/other-device change blindly.
      const baseline = await storeApi()?.getBaseline?.(TARGET_ID); // Last-common hash enables true three-way comparison after arbitrarily many offline local saves.
      const decision = reconciliationApi()?.decide?.({
        localEnvelope,
        externalEnvelope: remote.envelope,
        baselineContentHash: baseline?.contentHash || null,
      });
      if (!decision) throw new Error('Save reconciliation API is unavailable.');

      if (decision.state === 'identical') {
        await storeApi()?.setBaseline?.(TARGET_ID, remote.envelope);
        if (pending) await storeApi()?.clearPending?.(TARGET_ID, { expectedContentHash: localEnvelope.contentHash });
        await storeApi()?.setConflict?.(TARGET_ID, null);
        lastAction = 'drive-already-current';
        await recordEvent('DRIVE CURRENT', { contentHash: localEnvelope.contentHash, version: remote.metadata?.version || null });
        notify();
        return { ok: true, decision, remote, status: getStatus() };
      }

      if (decision.state === 'local-only-change') {
        const written = await updateRemoteFile(link.fileId, localEnvelope, { interactive }); // Existing Drive file id is PATCHed only after the preflight proves remote stayed at the common baseline.
        link = { ...link, version: written.metadata?.version != null ? String(written.metadata.version) : link.version, modifiedTime: written.metadata?.modifiedTime || link.modifiedTime };
        await storeApi()?.setLink?.(TARGET_ID, link);
        await storeApi()?.setBaseline?.(TARGET_ID, localEnvelope);
        await storeApi()?.clearPending?.(TARGET_ID, { expectedContentHash: localEnvelope.contentHash });
        await storeApi()?.setConflict?.(TARGET_ID, null);
        lastAction = 'drive-pushed-local';
        await recordEvent('DRIVE PUSH VERIFIED', { contentHash: localEnvelope.contentHash, version: link.version || null });
        notify();
        return { ok: true, pushed: true, decision, remote: written, status: getStatus() };
      }

      if (decision.state === 'conflict') {
        const conflict = {
          kind: 'divergent-edit',
          detectedAt: Date.now(),
          baselineContentHash: baseline?.contentHash || null,
          local: localEnvelope,
          external: remote.envelope,
          remoteMetadata: remote.metadata,
        }; // Both valid branches preserved durably; no timestamp-based winner is chosen.
        await storeApi()?.setConflict?.(TARGET_ID, conflict);
        state = 'conflict';
        lastAction = 'drive-conflict';
        await recordEvent('DRIVE CONFLICT', { localHash: localEnvelope.contentHash, remoteHash: remote.envelope.contentHash, baselineHash: baseline?.contentHash || null });
        notify();
        return { ok: false, conflict: true, decision, remote, status: getStatus() };
      }

      // Remote-only changes, first-link ambiguity, missing remote files, and other
      // non-local-only cases are deliberately never overwritten automatically.
      lastAction = `drive-${decision.state}`;
      state = decision.state === 'external-only-change' ? 'remote-update' : 'needs-resolution';
      await recordEvent('DRIVE NEEDS RESOLUTION', { decision: decision.state, localHash: localEnvelope.contentHash, remoteHash: remote.envelope.contentHash });
      notify();
      return { ok: false, needsResolution: true, decision, remote, status: getStatus() };
    });
  }

  async function useDriveVersion() {
    return withBusy('use-drive-version', async () => {
      assertConfigured();
      if (!link?.fileId) throw new Error('No Google Drive save file is linked.');
      const before = (() => { try { return snapshotApi()?.fingerprint?.() || ''; } catch { return ''; } })(); // Browser fingerprint used only to report whether UI/runtime refresh is necessary.
      const remote = await inspectRemote({ interactive: true });
      snapshotApi()?.apply?.(remote.envelope.snapshot); // Explicit user choice replaces browser cache with the validated Drive branch.
      await storeApi()?.commitEnvelope?.(remote.envelope); // Exact Drive save-set/revision becomes the durable local authority without manufacturing a new identity.
      await storeApi()?.setBaseline?.(TARGET_ID, remote.envelope);
      await storeApi()?.clearPending?.(TARGET_ID);
      await storeApi()?.setConflict?.(TARGET_ID, null);
      const after = (() => { try { return snapshotApi()?.fingerprint?.() || ''; } catch { return ''; } })(); // Post-apply fingerprint tells caller whether onboarding/gameplay should refresh.
      lastAction = 'drive-pulled';
      state = 'ready';
      await recordEvent('DRIVE PULL', { contentHash: remote.envelope.contentHash, version: remote.metadata?.version || null });
      notify();
      return { ok: true, changed: before !== after, remote, status: getStatus() };
    });
  }

  async function useLocalVersion() {
    return withBusy('use-local-version', async () => {
      assertConfigured();
      if (!link?.fileId) throw new Error('No Google Drive save file is linked.');
      const localEnvelope = await currentDurableEnvelope({ queueForDrive: true, reason: 'drive-resolve-local' }); // Explicit user choice makes the current durable local branch eligible to overwrite Drive.
      await inspectRemote({ interactive: true }); // Read first for diagnostics/recoverability even though this explicit resolution permits overwrite.
      const written = await updateRemoteFile(link.fileId, localEnvelope, { interactive: true });
      link = { ...link, version: written.metadata?.version != null ? String(written.metadata.version) : link.version, modifiedTime: written.metadata?.modifiedTime || link.modifiedTime };
      await storeApi()?.setLink?.(TARGET_ID, link);
      await storeApi()?.setBaseline?.(TARGET_ID, localEnvelope);
      await storeApi()?.clearPending?.(TARGET_ID, { expectedContentHash: localEnvelope.contentHash });
      await storeApi()?.setConflict?.(TARGET_ID, null);
      lastAction = 'drive-overwritten-with-local';
      state = 'ready';
      await recordEvent('DRIVE RESOLVE LOCAL', { contentHash: localEnvelope.contentHash, version: link.version || null });
      notify();
      return { ok: true, envelope: localEnvelope, remote: written, status: getStatus() };
    });
  }

  async function unlink() {
    return withBusy('drive-unlink', async () => {
      await storeApi()?.setLink?.(TARGET_ID, null);
      await storeApi()?.setBaseline?.(TARGET_ID, null);
      await storeApi()?.setConflict?.(TARGET_ID, null);
      await storeApi()?.clearPending?.(TARGET_ID);
      link = null;
      lastRemoteVersion = null;
      lastRemoteModifiedTime = null;
      lastRemoteHash = null;
      lastVerifiedAt = null;
      state = configured() ? 'idle' : 'not-configured';
      lastAction = 'drive-unlinked';
      await recordEvent('DRIVE UNLINK', {});
      notify();
      return getStatus();
    });
  }

  function forgetAccessToken() {
    accessToken = '';
    accessTokenExpiresAt = 0;
    state = link?.fileId ? 'auth-required' : (configured() ? 'idle' : 'not-configured');
    lastAction = 'drive-token-forgotten';
    notify();
  }

  async function hydrateLink() {
    try {
      link = await storeApi()?.getLink?.(TARGET_ID) || null; // Non-secret file identity survives reload while OAuth token intentionally does not.
      state = !configured() ? 'not-configured' : (link?.fileId ? 'auth-required' : 'idle');
      lastAction = link?.fileId ? 'drive-link-restored-auth-required' : 'drive-not-linked';
      lastError = '';
    } catch (error) {
      state = 'error';
      lastError = String(error?.message || error);
      lastAction = 'drive-link-hydrate-error';
    }
    notify();
  }

  window.HobunjiGoogleDriveSave = Object.freeze({
    getStatus,
    onChange,
    requestAccessToken,
    linkExistingFile,
    createDriveSave,
    inspectRemote,
    syncPending,
    useDriveVersion,
    useLocalVersion,
    unlink,
    forgetAccessToken,
  });

  window.__hobunjiGoogleDriveSaveDebug = {
    snapshot: getStatus,
  };

  hydrateLink();
})();
