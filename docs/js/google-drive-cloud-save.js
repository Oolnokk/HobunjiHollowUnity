// Google Drive Cloud Save — direct browser-to-Drive mirror for Hobunji saves.
// Browser/localStorage remains authoritative during play; Drive sync is optional and never blocks local saves.
(() => {
  'use strict';

  const CONFIG = window.HobunjiGoogleDriveConfig || {}; // Public OAuth/Picker ids used by the Google client libraries below.
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const SAVE_FILE_NAME = 'Hobunji Hollow Save.json';
  const SAVE_SCHEMA_VERSION = 1;
  const DEVICE_ID_KEY = 'hobunjiCloudDeviceId';
  const LINK_STATE_KEY = 'hobunjiGoogleDriveSaveState:v1';
  const FOLDER_STATE_KEY = 'hobunjiGoogleDriveFolder:v1';
  const AUTO_SYNC_MS = 30000;
  const CHANGE_POLL_MS = 1000;
  const TOKEN_SAFETY_MS = 60000;
  const PANEL_ID = 'hobunjiCloudSavePanel';
  const LAUNCHER_ID = 'hobunjiCloudSaveLauncher';
  const SETTINGS_ROW_ID = 'hobunjiCloudSaveSettingsRow';

  let _availability = 'loading';
  let _accessToken = null;
  let _accessTokenExpiresAt = 0;
  let _account = null;
  let _remote = null;
  let _lastError = '';
  let _lastMessage = '';
  let _conflict = null;
  let _busy = false;
  let _panelOpen = false;
  let _autoTimer = null;
  let _changePollTimer = null;
  let _lastObservedFingerprint = '';
  let _dirty = false;
  let _tokenClient = null;
  let _authPromise = null;
  let _librariesPromise = null;
  const _listeners = new Set();

  function snapshotApi() {
    return window.HobunjiSaveSnapshot || null;
  }

  function configReady() {
    return !!(String(CONFIG.clientId || '').trim() && String(CONFIG.apiKey || '').trim() && String(CONFIG.appId || '').trim());
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (id) return id;
    id = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  }

  function readJsonStorage(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function readLinkState() {
    return readJsonStorage(LINK_STATE_KEY);
  }

  function writeLinkState(next) {
    localStorage.setItem(LINK_STATE_KEY, JSON.stringify(next));
  }

  function clearLinkState() {
    localStorage.removeItem(LINK_STATE_KEY);
  }

  function readFolderState() {
    return readJsonStorage(FOLDER_STATE_KEY);
  }

  function writeFolderState(folder) {
    localStorage.setItem(FOLDER_STATE_KEY, JSON.stringify(folder));
  }

  function clearFolderState() {
    localStorage.removeItem(FOLDER_STATE_KEY);
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(timestamp) {
    if (!timestamp) return 'Never';
    try { return new Date(timestamp).toLocaleString(); }
    catch { return String(timestamp); }
  }

  function localFingerprint() {
    try { return snapshotApi()?.fingerprint?.() || ''; }
    catch { return ''; }
  }

  function hasLiveToken() {
    return !!(_accessToken && Date.now() < _accessTokenExpiresAt - TOKEN_SAFETY_MS);
  }

  function getStatus() {
    const folder = readFolderState();
    const link = readLinkState();
    return {
      provider: 'google-drive',
      availability: _availability,
      connected: hasLiveToken(),
      account: _account ? { ..._account } : null,
      folder: folder ? { ...folder } : null,
      remote: _remote ? { ..._remote } : null,
      conflict: _conflict ? { ..._conflict } : null,
      busy: _busy,
      panelOpen: _panelOpen,
      autoSyncArmed: !!(_autoTimer && link?.autoSyncArmed),
      dirty: _dirty,
      link,
      deviceId: getDeviceId(),
      tokenExpiresAt: _accessTokenExpiresAt || null,
      lastError: _lastError || null,
      lastMessage: _lastMessage || null,
      configReady: configReady(),
    };
  }

  function notify() {
    const status = getStatus();
    for (const listener of _listeners) {
      try { listener(status); } catch {}
    }
    renderAll();
  }

  function onChange(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  }

  function setBusy(value, message = '') {
    _busy = value;
    if (message) _lastMessage = message;
    notify();
  }

  function stopAutoSync() {
    if (_autoTimer) clearInterval(_autoTimer);
    if (_changePollTimer) clearInterval(_changePollTimer);
    _autoTimer = null;
    _changePollTimer = null;
  }

  function armAutoSync() {
    const link = readLinkState();
    if (!readFolderState() || _conflict || !link?.autoSyncArmed) return;
    stopAutoSync();
    _lastObservedFingerprint = localFingerprint();
    _dirty = false;
    _changePollTimer = setInterval(() => {
      const next = localFingerprint();
      if (!next || next === _lastObservedFingerprint) return;
      _lastObservedFingerprint = next;
      _dirty = true;
      notify();
    }, CHANGE_POLL_MS);
    _autoTimer = setInterval(() => {
      if (!_dirty || _busy || _conflict) return;
      safeSync({ automatic: true }).catch(() => {});
    }, AUTO_SYNC_MS);
  }

  function saveSuccessfulLink(remote, fingerprint) {
    const folder = readFolderState();
    writeLinkState({
      folderId: folder?.id || null,
      revision: Number(remote?.revision) || 0,
      remoteFileId: remote?.fileId || null,
      lastSyncedFingerprint: fingerprint || localFingerprint(),
      lastSyncedAt: Date.now(),
      autoSyncArmed: true,
    });
    _remote = remote || null;
    _conflict = null;
    _dirty = false;
    _lastObservedFingerprint = fingerprint || localFingerprint();
    armAutoSync();
  }

  function setConflict(remote, reason, message) {
    _remote = remote || _remote;
    _conflict = {
      reason,
      remoteRevision: Number(remote?.revision) || 0,
      remoteUpdatedAt: Number(remote?.updatedAt) || 0,
      remoteDeviceId: remote?.deviceId || null,
      message: message || 'The Google Drive save changed on another device.',
    };
    const link = readLinkState();
    if (link) writeLinkState({ ...link, autoSyncArmed: false });
    stopAutoSync();
    _lastMessage = _conflict.message;
    notify();
  }

  function loadScript(src, readyTest) {
    if (readyTest?.()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find(script => script.src === src);
      if (existing) {
        const poll = setInterval(() => {
          if (!readyTest?.()) return;
          clearInterval(poll);
          resolve();
        }, 25);
        setTimeout(() => {
          clearInterval(poll);
          if (readyTest?.()) resolve();
          else reject(new Error(`Timed out loading ${src}`));
        }, 15000);
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureLibraries() {
    if (_librariesPromise) return _librariesPromise;
    _librariesPromise = (async () => {
      if (!configReady()) {
        _availability = 'config-required';
        throw new Error('Google Drive cloud save needs clientId, apiKey, and appId in google-drive-cloud-save-config.js.');
      }
      await Promise.all([
        loadScript('https://accounts.google.com/gsi/client', () => !!window.google?.accounts?.oauth2),
        loadScript('https://apis.google.com/js/api.js', () => !!window.gapi),
      ]);
      await new Promise((resolve, reject) => {
        try { window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker failed to load.')) }); }
        catch (error) { reject(error); }
      });
      _tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.clientId,
        scope: DRIVE_SCOPE,
        callback: () => {},
      });
      _availability = 'ready';
    })().catch(error => {
      if (_availability !== 'config-required') _availability = 'error';
      _lastError = String(error?.message || error);
      throw error;
    });
    return _librariesPromise;
  }

  async function requestAccessToken({ interactive = true } = {}) {
    await ensureLibraries();
    if (hasLiveToken()) return _accessToken;
    if (_authPromise) return _authPromise;
    _authPromise = new Promise((resolve, reject) => {
      _tokenClient.callback = response => {
        _authPromise = null;
        if (response?.error) {
          const error = new Error(response.error_description || response.error);
          if (interactive) _lastError = error.message;
          notify();
          reject(error);
          return;
        }
        _accessToken = response.access_token;
        _accessTokenExpiresAt = Date.now() + Math.max(0, Number(response.expires_in || 3600) * 1000);
        _lastError = '';
        _availability = 'ready';
        resolve(_accessToken);
      };
      _tokenClient.error_callback = error => {
        _authPromise = null;
        const wrapped = new Error(error?.message || error?.type || 'Google authorization failed.');
        if (interactive) _lastError = wrapped.message;
        notify();
        reject(wrapped);
      };
      try {
        _tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      } catch (error) {
        _authPromise = null;
        reject(error);
      }
    });
    return _authPromise;
  }

  async function driveFetch(url, options = {}, { interactiveAuth = false } = {}) {
    const token = await requestAccessToken({ interactive: interactiveAuth });
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      _accessToken = null;
      _accessTokenExpiresAt = 0;
      if (!interactiveAuth) throw new Error('Google Drive authorization expired. Open Cloud Save and reconnect.');
    }
    return response;
  }

  async function readResponseJson(response, fallbackMessage) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const message = payload?.error?.message || fallbackMessage || `Google Drive request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload;
  }

  async function refreshAccount() {
    if (!hasLiveToken()) {
      _account = null;
      return null;
    }
    const response = await driveFetch(`${DRIVE_API}/about?fields=user(displayName,emailAddress,permissionId)`, {}, { interactiveAuth: false });
    const data = await readResponseJson(response, 'Could not read Google Drive account information.');
    _account = data.user || null;
    return _account;
  }

  function pickerFolder() {
    return new Promise(async (resolve, reject) => {
      try {
        const token = await requestAccessToken({ interactive: true });
        const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true);
        const picker = new window.google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token)
          .setDeveloperKey(CONFIG.apiKey)
          .setAppId(String(CONFIG.appId))
          .setTitle('Choose a Hobunji Hollow save folder')
          .setCallback(data => {
            const action = data?.[window.google.picker.Response.ACTION];
            if (action === window.google.picker.Action.CANCEL) {
              resolve(null);
              return;
            }
            if (action !== window.google.picker.Action.PICKED) return;
            const doc = data?.[window.google.picker.Response.DOCUMENTS]?.[0];
            if (!doc) {
              reject(new Error('Google Picker returned no folder.'));
              return;
            }
            resolve({
              id: doc[window.google.picker.Document.ID],
              name: doc[window.google.picker.Document.NAME] || 'Google Drive folder',
              selectedAt: Date.now(),
            });
          })
          .build();
        picker.setVisible(true);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function chooseFolder() {
    setBusy(true, 'Opening Google Drive folder picker…');
    try {
      const folder = await pickerFolder();
      if (!folder) return null;
      const previous = readFolderState();
      writeFolderState(folder);
      if (!previous || previous.id !== folder.id) clearLinkState();
      _remote = null;
      _conflict = null;
      _lastError = '';
      _lastMessage = `Using Google Drive folder “${folder.name}”.`;
      await refreshAccount().catch(() => null);
      await refreshRemoteStatus({ interactiveAuth: false });
      const link = readLinkState();
      if (_remote && (!link || link.folderId !== folder.id || Number(link.revision) !== Number(_remote.revision))) {
        setConflict(_remote, link ? 'remote-newer' : 'unlinked-device', 'A Drive save already exists in this folder. Choose which copy to keep before autosync starts.');
      }
      return folder;
    } catch (error) {
      _lastError = String(error?.message || error);
      return null;
    } finally {
      _busy = false;
      notify();
    }
  }

  function driveQueryValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  async function findSaveFile({ interactiveAuth = false } = {}) {
    const folder = readFolderState();
    if (!folder?.id) return null;
    const q = `'${driveQueryValue(folder.id)}' in parents and name = '${driveQueryValue(SAVE_FILE_NAME)}' and trashed = false`;
    const params = new URLSearchParams({
      q,
      spaces: 'drive',
      pageSize: '10',
      fields: 'files(id,name,modifiedTime,size,md5Checksum)',
      orderBy: 'modifiedTime desc',
    });
    const response = await driveFetch(`${DRIVE_API}/files?${params}`, {}, { interactiveAuth });
    const data = await readResponseJson(response, 'Could not list the selected Google Drive folder.');
    return data.files?.[0] || null;
  }

  async function downloadRemotePayload(file, { interactiveAuth = false } = {}) {
    if (!file?.id) return null;
    const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`, {}, { interactiveAuth });
    if (!response.ok) await readResponseJson(response, 'Could not download the Google Drive save.');
    let payload;
    try { payload = JSON.parse(await response.text()); }
    catch (error) { throw new Error(`Google Drive save is unreadable: ${String(error?.message || error)}`); }
    if (!payload || typeof payload !== 'object' || !payload.snapshot) throw new Error('Google Drive save has an invalid format.');
    return payload;
  }

  function remoteSummary(file, payload) {
    return {
      fileId: file?.id || payload?.fileId || null,
      revision: Number(payload?.revision) || 0,
      updatedAt: Number(payload?.updatedAt) || (file?.modifiedTime ? Date.parse(file.modifiedTime) : 0),
      deviceId: payload?.deviceId || null,
      fingerprint: payload?.fingerprint || null,
      modifiedTime: file?.modifiedTime || null,
      size: Number(file?.size) || null,
    };
  }

  async function refreshRemoteStatus({ interactiveAuth = false } = {}) {
    if (!readFolderState()) {
      _remote = null;
      return null;
    }
    const file = await findSaveFile({ interactiveAuth });
    if (!file) {
      _remote = null;
      return null;
    }
    const payload = await downloadRemotePayload(file, { interactiveAuth });
    _remote = remoteSummary(file, payload);
    return _remote;
  }

  async function createRemoteFile(payload, { interactiveAuth = false } = {}) {
    const folder = readFolderState();
    if (!folder?.id) throw new Error('Choose a Google Drive folder first.');
    const boundary = `hobunji_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const metadata = { name: SAVE_FILE_NAME, parents: [folder.id], mimeType: 'application/json' };
    const body = new Blob([
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      delimiter,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(payload),
      closeDelimiter,
    ], { type: `multipart/related; boundary=${boundary}` });
    const response = await driveFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime,size,md5Checksum`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }, { interactiveAuth });
    return readResponseJson(response, 'Could not create the Google Drive save file.');
  }

  async function updateRemoteFile(fileId, payload, { interactiveAuth = false } = {}) {
    const response = await driveFetch(`${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime,size,md5Checksum`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
    }, { interactiveAuth });
    return readResponseJson(response, 'Could not update the Google Drive save file.');
  }

  async function pushNow({ force = false, automatic = false, interactiveAuth = false } = {}) {
    const folder = readFolderState();
    if (!folder?.id) throw new Error('Choose a Google Drive folder first.');
    const snapshots = snapshotApi();
    if (!snapshots) throw new Error('Save snapshot adapter is not loaded.');
    const snapshot = snapshots.capture({ strict: true });
    const fingerprint = snapshots.fingerprint(snapshot);
    const link = readLinkState();
    const existingFile = await findSaveFile({ interactiveAuth });
    let existingPayload = null;
    if (existingFile) existingPayload = await downloadRemotePayload(existingFile, { interactiveAuth });
    const remote = existingFile ? remoteSummary(existingFile, existingPayload) : null;

    if (!force && remote && Number(link?.revision) !== Number(remote.revision)) {
      setConflict(remote, 'write-conflict', 'Google Drive changed since this browser last synced. Choose which copy to keep.');
      return null;
    }

    const nextRevision = Math.max(Number(remote?.revision) || 0, Number(link?.revision) || 0) + 1;
    const payload = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      revision: nextRevision,
      updatedAt: Date.now(),
      deviceId: getDeviceId(),
      fingerprint,
      snapshot,
    };
    const file = existingFile
      ? await updateRemoteFile(existingFile.id, payload, { interactiveAuth })
      : await createRemoteFile(payload, { interactiveAuth });
    const nextRemote = remoteSummary(file, payload);
    saveSuccessfulLink(nextRemote, fingerprint);
    _lastError = '';
    _lastMessage = automatic ? 'Google Drive autosave complete.' : 'Saved this device to Google Drive.';
    notify();
    return { ok: true, remote: nextRemote };
  }

  async function pullNow({ confirmOverwrite = true, interactiveAuth = true } = {}) {
    const folder = readFolderState();
    if (!folder?.id) throw new Error('Choose a Google Drive folder first.');
    if (confirmOverwrite && !confirm('Replace this browser save with the Google Drive copy? The browser copy will be overwritten.')) return null;
    const file = await findSaveFile({ interactiveAuth });
    if (!file) throw new Error('No Hobunji Hollow save exists in the selected Google Drive folder.');
    const payload = await downloadRemotePayload(file, { interactiveAuth });
    const snapshots = snapshotApi();
    if (!snapshots) throw new Error('Save snapshot adapter is not loaded.');
    snapshots.apply(payload.snapshot);
    const fingerprint = snapshots.fingerprint(payload.snapshot);
    const remote = remoteSummary(file, payload);
    saveSuccessfulLink(remote, fingerprint);
    _lastError = '';
    _lastMessage = 'Loaded Google Drive save into this browser.';
    sessionStorage.setItem('hobunjiCloudSaveReloaded', '1');
    notify();
    setTimeout(() => location.reload(), 0);
    return { ok: true, remote };
  }

  async function safeSync({ automatic = false } = {}) {
    if (_busy || _conflict || !readFolderState()) return null;
    _busy = true;
    try {
      const snapshots = snapshotApi();
      if (!snapshots) throw new Error('Save snapshot adapter is not loaded.');
      const local = snapshots.capture({ strict: true });
      const fingerprint = snapshots.fingerprint(local);
      const link = readLinkState();
      const remote = await refreshRemoteStatus({ interactiveAuth: !automatic });

      if (!remote) return await pushNow({ force: false, automatic, interactiveAuth: !automatic });
      if (!link || link.folderId !== readFolderState()?.id) {
        setConflict(remote, 'unlinked-device', 'This browser has never synced with the save in this Drive folder. Choose which copy to keep.');
        return null;
      }
      if (Number(link.revision) !== Number(remote.revision)) {
        if (!automatic && fingerprint === link.lastSyncedFingerprint) {
          return await pullNow({ confirmOverwrite: false, interactiveAuth: true });
        }
        setConflict(remote, 'remote-newer', 'Google Drive changed since this browser last synced. Choose which copy to keep.');
        return null;
      }
      if (fingerprint === link.lastSyncedFingerprint) {
        _dirty = false;
        _lastMessage = 'Google Drive save is already current.';
        if (!automatic && !link.autoSyncArmed) {
          writeLinkState({ ...link, autoSyncArmed: true });
          armAutoSync();
        }
        notify();
        return { ok: true, unchanged: true };
      }
      return await pushNow({ force: false, automatic, interactiveAuth: !automatic });
    } catch (error) {
      _lastError = String(error?.message || error);
      _lastMessage = automatic
        ? 'Drive autosave paused; browser save remains intact. Open Cloud Save to reconnect.'
        : 'Google Drive sync failed.';
      if (automatic) stopAutoSync();
      notify();
      if (!automatic) throw error;
      return null;
    } finally {
      _busy = false;
      notify();
    }
  }

  async function forcePushCurrentDevice() {
    if (!confirm('Overwrite the Google Drive save with this browser copy? This replaces the other device’s cloud revision.')) return;
    setBusy(true, 'Replacing Google Drive save…');
    try {
      await pushNow({ force: true, automatic: false, interactiveAuth: true });
    } catch (error) {
      _lastError = String(error?.message || error);
    } finally {
      _busy = false;
      notify();
    }
  }

  async function connectDrive() {
    setBusy(true, 'Connecting Google Drive…');
    try {
      await requestAccessToken({ interactive: true });
      await refreshAccount().catch(() => null);
      _lastError = '';
      _lastMessage = 'Google Drive connected.';
      const folder = readFolderState();
      if (folder) {
        await refreshRemoteStatus({ interactiveAuth: false });
        const link = readLinkState();
        if (_remote && (!link || link.folderId !== folder.id || Number(link.revision) !== Number(_remote.revision))) {
          setConflict(_remote, link ? 'remote-newer' : 'unlinked-device', 'Drive save found. Choose which copy to use before autosync starts.');
        } else if (link?.autoSyncArmed) {
          armAutoSync();
        }
      }
      return getStatus();
    } catch (error) {
      _lastError = String(error?.message || error);
      return getStatus();
    } finally {
      _busy = false;
      notify();
    }
  }

  async function disconnectDrive({ forgetFolder = false } = {}) {
    stopAutoSync();
    const token = _accessToken;
    _accessToken = null;
    _accessTokenExpiresAt = 0;
    _account = null;
    _remote = null;
    _conflict = null;
    if (forgetFolder) {
      clearFolderState();
      clearLinkState();
    }
    if (token && window.google?.accounts?.oauth2?.revoke) {
      try { window.google.accounts.oauth2.revoke(token, () => {}); } catch {}
    }
    _lastError = '';
    _lastMessage = forgetFolder ? 'Google Drive disconnected and the linked folder was forgotten.' : 'Google Drive disconnected. The linked folder was kept for next time.';
    notify();
  }

  function injectStyles() {
    if (document.getElementById('hobunjiCloudSaveStyles')) return;
    const style = document.createElement('style');
    style.id = 'hobunjiCloudSaveStyles';
    style.textContent = `
      #${LAUNCHER_ID}{position:fixed;top:10px;right:10px;z-index:2147483000;border:1px solid rgba(255,255,255,.28);border-radius:8px;background:rgba(20,29,34,.94);color:#eaf5f9;padding:8px 10px;font:600 13px/1.1 "Pixelify Sans",system-ui,sans-serif;box-shadow:0 5px 22px rgba(0,0,0,.35);cursor:pointer;display:none}
      #${PANEL_ID}{position:fixed;inset:0;z-index:2147483500;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(5,8,11,.78);backdrop-filter:blur(3px);box-sizing:border-box;font-family:"Pixelify Sans",system-ui,sans-serif}
      #${PANEL_ID}.open{display:flex}
      #${PANEL_ID} .hcs-card{width:min(640px,96vw);max-height:90vh;overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:#151d22;color:#edf4f6;padding:18px;box-shadow:0 20px 70px rgba(0,0,0,.55)}
      #${PANEL_ID} .hcs-head{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px}
      #${PANEL_ID} .hcs-title{font-size:21px;font-weight:800}
      #${PANEL_ID} .hcs-close{border:0;background:transparent;color:#d8e1e5;font-size:24px;cursor:pointer;padding:3px 8px}
      #${PANEL_ID} .hcs-note{font-size:12px;line-height:1.45;color:#9db0ba;margin:5px 0 10px}
      #${PANEL_ID} .hcs-status{padding:9px 10px;border-radius:8px;background:#202b31;font-size:12px;line-height:1.45;margin:8px 0}
      #${PANEL_ID} .hcs-error{background:rgba(155,51,51,.22);color:#ffbcbc}
      #${PANEL_ID} .hcs-conflict{background:rgba(168,117,37,.24);color:#ffe0a3}
      #${PANEL_ID} .hcs-row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
      #${PANEL_ID} button.hcs-btn{border:1px solid #62757e;border-radius:7px;background:#29363d;color:#eef6f7;padding:9px 11px;font:inherit;cursor:pointer}
      #${PANEL_ID} button.hcs-btn.primary{border-color:#6ca47a;background:#315b3b}
      #${PANEL_ID} button.hcs-btn.warn{border-color:#b68b49;background:#5a4328}
      #${PANEL_ID} button.hcs-btn.danger{border-color:#aa6666;background:#572f2f}
      #${PANEL_ID} button:disabled{opacity:.5;cursor:default}
      #${PANEL_ID} details{margin-top:10px;font-size:11px;color:#9fb0b7}
      #${PANEL_ID} code{white-space:pre-wrap;word-break:break-all}
      #${SETTINGS_ROW_ID} .hcs-inline-buttons{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
      #${SETTINGS_ROW_ID} button{font:inherit}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Cloud Save');
    panel.addEventListener('click', event => {
      if (event.target === panel) closePanel();
    });
    document.body.appendChild(panel);
    return panel;
  }

  function openPanel() {
    _panelOpen = true;
    notify();
  }

  function closePanel() {
    _panelOpen = false;
    notify();
  }

  function mainControlsHtml() {
    const folder = readFolderState();
    const link = readLinkState();
    const accountLabel = _account?.emailAddress || _account?.displayName || 'Google account';
    const tokenText = hasLiveToken() ? `Connected as ${esc(accountLabel)}` : 'Not currently authorized';
    const folderText = folder ? `Folder: ${esc(folder.name || folder.id)}` : 'No Google Drive folder selected.';
    const remoteText = _remote
      ? `Drive revision ${_remote.revision} · ${esc(formatTime(_remote.updatedAt))}${_remote.deviceId ? ` · device ${esc(_remote.deviceId.slice(0, 12))}` : ''}`
      : (folder ? 'No Hobunji Hollow save found in this folder.' : 'Choose a folder to begin.');
    const autoText = link?.autoSyncArmed && !_conflict
      ? `Autosync armed${_dirty ? ' · local changes waiting to upload' : ''}`
      : 'Autosync paused until a successful explicit sync.';
    let conflictHtml = '';
    if (_conflict) {
      conflictHtml = `
        <div class="hcs-status hcs-conflict"><strong>Save conflict:</strong> ${esc(_conflict.message)}<br>Drive: revision ${esc(_conflict.remoteRevision)}, ${esc(formatTime(_conflict.remoteUpdatedAt))}.</div>
        <div class="hcs-row">
          <button class="hcs-btn warn" id="hcsKeepDevice">Keep This Device → Drive</button>
          <button class="hcs-btn primary" id="hcsUseCloud">Use Drive → This Device</button>
        </div>`;
    }
    return `
      <div class="hcs-status">${tokenText}<br>${folderText}<br>${remoteText}<br>${esc(autoText)}</div>
      ${conflictHtml}
      <div class="hcs-row">
        <button class="hcs-btn primary" id="hcsConnect">${hasLiveToken() ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>
        <button class="hcs-btn" id="hcsChooseFolder" ${hasLiveToken() ? '' : 'disabled'}>${folder ? 'Change Folder' : 'Choose Save Folder'}</button>
      </div>
      <div class="hcs-row">
        <button class="hcs-btn primary" id="hcsSyncNow" ${folder ? '' : 'disabled'}>Sync Now</button>
        <button class="hcs-btn" id="hcsPushNow" ${folder ? '' : 'disabled'}>Save Device → Drive</button>
        <button class="hcs-btn" id="hcsPullNow" ${_remote ? '' : 'disabled'}>Load Drive → Device</button>
      </div>
      <div class="hcs-row">
        <button class="hcs-btn danger" id="hcsDisconnect">Disconnect</button>
        <button class="hcs-btn danger" id="hcsForgetFolder" ${folder ? '' : 'disabled'}>Disconnect + Forget Folder</button>
      </div>`;
  }

  function renderPanel() {
    const panel = ensurePanel();
    panel.classList.toggle('open', _panelOpen);
    if (!_panelOpen) return;
    const configProblem = _availability === 'config-required' || !configReady();
    const availabilityHtml = configProblem
      ? '<div class="hcs-status hcs-error">Google Drive cloud save is not configured yet. Fill clientId, apiKey, and appId in <code>js/google-drive-cloud-save-config.js</code>.</div>'
      : (_availability === 'error' ? `<div class="hcs-status hcs-error">${esc(_lastError || 'Google Drive libraries could not initialize.')}</div>` : '');
    const errorHtml = _lastError && !configProblem && _availability !== 'error' ? `<div class="hcs-status hcs-error">${esc(_lastError)}</div>` : '';
    const messageHtml = _lastMessage ? `<div class="hcs-status">${esc(_lastMessage)}</div>` : '';
    panel.innerHTML = `
      <div class="hcs-card">
        <div class="hcs-head"><div class="hcs-title">☁ Google Drive Save</div><button class="hcs-close" id="hcsClose" aria-label="Close">×</button></div>
        <div class="hcs-note">The browser save remains the live gameplay copy. Google Drive mirrors it into a folder you choose; Drive failures never block ordinary local saving.</div>
        ${availabilityHtml}${errorHtml}${messageHtml}${mainControlsHtml()}
        <details><summary>Cloud save debug</summary><code>${esc(JSON.stringify({
          provider: 'google-drive',
          deviceId: getDeviceId(),
          availability: _availability,
          tokenActive: hasLiveToken(),
          tokenExpiresAt: _accessTokenExpiresAt || null,
          account: _account,
          folder: readFolderState(),
          remote: _remote,
          link: readLinkState(),
          dirty: _dirty,
          configReady: configReady(),
        }, null, 2))}</code></details>
      </div>`;
    panel.querySelector('#hcsClose')?.addEventListener('click', closePanel);
    panel.querySelectorAll('button').forEach(el => { if (_busy && el.id !== 'hcsClose') el.disabled = true; });
    panel.querySelector('#hcsConnect')?.addEventListener('click', connectDrive);
    panel.querySelector('#hcsChooseFolder')?.addEventListener('click', chooseFolder);
    panel.querySelector('#hcsSyncNow')?.addEventListener('click', () => safeSync({ automatic: false }).catch(error => { _lastError = String(error?.message || error); notify(); }));
    panel.querySelector('#hcsPushNow')?.addEventListener('click', () => pushNow({ force: false, automatic: false, interactiveAuth: true }).catch(error => { _lastError = String(error?.message || error); notify(); }));
    panel.querySelector('#hcsPullNow')?.addEventListener('click', () => pullNow({ confirmOverwrite: true, interactiveAuth: true }).catch(error => { _lastError = String(error?.message || error); notify(); }));
    panel.querySelector('#hcsKeepDevice')?.addEventListener('click', forcePushCurrentDevice);
    panel.querySelector('#hcsUseCloud')?.addEventListener('click', () => pullNow({ confirmOverwrite: true, interactiveAuth: true }).catch(error => { _lastError = String(error?.message || error); notify(); }));
    panel.querySelector('#hcsDisconnect')?.addEventListener('click', () => disconnectDrive({ forgetFolder: false }));
    panel.querySelector('#hcsForgetFolder')?.addEventListener('click', () => {
      if (!confirm('Disconnect Google Drive and forget the selected save folder on this browser? Your Drive files will not be deleted.')) return;
      disconnectDrive({ forgetFolder: true });
    });
  }

  function ensureLauncher() {
    let button = document.getElementById(LAUNCHER_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = LAUNCHER_ID;
      button.type = 'button';
      button.textContent = '☁ Cloud Save';
      button.addEventListener('click', openPanel);
      document.body.appendChild(button);
    }
    button.style.display = document.querySelector('.sl-card') ? 'block' : 'none';
  }

  function ensureSettingsRow() {
    if (document.getElementById(SETTINGS_ROW_ID)) return;
    const anchor = document.getElementById('localSaveFolderRow');
    if (!anchor?.parentNode) return;
    const title = document.createElement('div');
    title.className = 'settings-section-title';
    title.style.marginTop = '10px';
    title.textContent = 'Cloud Save';
    const row = document.createElement('div');
    row.className = 'settings-row settings-row--stacked';
    row.id = SETTINGS_ROW_ID;
    row.innerHTML = `
      <div class="settings-label">
        <div class="settings-name">Google Drive Cloud Save</div>
        <div class="settings-desc" data-hcs-inline-status>Checking Google Drive…</div>
      </div>
      <div class="hcs-inline-buttons"><button type="button" data-hcs-open>☁ Open Cloud Save</button></div>`;
    anchor.parentNode.insertBefore(title, anchor.nextSibling);
    anchor.parentNode.insertBefore(row, title.nextSibling);
    row.querySelector('[data-hcs-open]')?.addEventListener('click', openPanel);
  }

  function renderSettingsRow() {
    ensureSettingsRow();
    const row = document.getElementById(SETTINGS_ROW_ID);
    if (!row) return;
    const status = row.querySelector('[data-hcs-inline-status]');
    if (!status) return;
    const folder = readFolderState();
    let text;
    if (!configReady()) text = 'Google Drive cloud save needs its public client configuration.';
    else if (_availability === 'loading') text = 'Loading Google Drive integration…';
    else if (_availability === 'error') text = 'Google Drive integration could not initialize.';
    else if (!folder) text = 'Not linked. Connect Google Drive and choose a save folder.';
    else if (_conflict) text = `Folder “${folder.name || folder.id}” has a save conflict that needs a choice.`;
    else if (hasLiveToken()) text = `Folder “${folder.name || folder.id}” linked; ${readLinkState()?.autoSyncArmed ? 'autosync on' : 'autosync paused'}.`;
    else text = `Folder “${folder.name || folder.id}” remembered; reconnect Google Drive to sync.`;
    if (status.textContent !== text) status.textContent = text;
  }

  function renderAll() {
    if (!document.body) return;
    injectStyles();
    ensureLauncher();
    renderSettingsRow();
    renderPanel();
  }

  async function init() {
    if (!document.body) return;
    injectStyles();
    ensurePanel();
    ensureLauncher();
    ensureSettingsRow();
    if (!configReady()) {
      _availability = 'config-required';
      _lastError = 'Google Drive client configuration is missing.';
      notify();
    } else {
      ensureLibraries().then(() => {
        _availability = 'ready';
        notify();
      }).catch(() => notify());
    }
    if (sessionStorage.getItem('hobunjiCloudSaveReloaded')) {
      sessionStorage.removeItem('hobunjiCloudSaveReloaded');
      _lastMessage = 'Google Drive save loaded successfully.';
      notify();
    }

    let bodyObserverScheduled = false;
    const observer = new MutationObserver(() => {
      if (bodyObserverScheduled) return;
      bodyObserverScheduled = true;
      requestAnimationFrame(() => {
        bodyObserverScheduled = false;
        ensureLauncher();
        ensureSettingsRow();
        renderSettingsRow();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && _dirty && !_busy && !_conflict) {
        safeSync({ automatic: true }).catch(() => {});
      }
    });
  }

  const api = {
    getStatus,
    onChange,
    openPanel,
    closePanel,
    connect: connectDrive,
    chooseFolder,
    syncNow: () => safeSync({ automatic: false }),
    pushNow: () => pushNow({ force: false, automatic: false, interactiveAuth: true }),
    pullNow: () => pullNow({ confirmOverwrite: true, interactiveAuth: true }),
    forcePushCurrentDevice,
    disconnect: disconnectDrive,
  };

  window.HobunjiCloudSave = api;
  window.GoogleDriveCloudSave = api;

  // Mobile-accessible diagnostics and actions; no console is required to inspect Drive state.
  window.__hobunjiCloudSaveDebug = {
    status: getStatus,
    captureLocal: () => snapshotApi()?.capture?.({ strict: false }) || null,
    connect: connectDrive,
    chooseFolder,
    refreshRemote: () => refreshRemoteStatus({ interactiveAuth: true }),
    sync: () => safeSync({ automatic: false }),
    clearLink: () => {
      clearLinkState();
      const remote = _remote;
      _conflict = remote ? {
        reason: 'unlinked-device',
        remoteRevision: remote.revision,
        remoteUpdatedAt: remote.updatedAt,
        remoteDeviceId: remote.deviceId,
        message: 'Local Drive-link metadata cleared.',
      } : null;
      stopAutoSync();
      notify();
      return getStatus();
    },
    forgetFolder: () => disconnectDrive({ forgetFolder: true }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
