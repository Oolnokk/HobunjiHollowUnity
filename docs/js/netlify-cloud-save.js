// Netlify Cloud Save — Identity + revisioned Netlify Blobs transport for Hobunji saves.
// Browser/localStorage remains authoritative during play; cloud sync is an optional mirror.
(() => {
  'use strict';

  const AUTH_URL = '/.netlify/functions/hobunji-auth';
  const SAVE_URL = '/.netlify/functions/hobunji-cloud-save';
  const DEVICE_ID_KEY = 'hobunjiCloudDeviceId';
  const STATE_KEY_PREFIX = 'hobunjiCloudSaveState:v1:';
  const AUTO_SYNC_MS = 30000;
  const CHANGE_POLL_MS = 1000;
  const PANEL_ID = 'hobunjiCloudSavePanel';
  const LAUNCHER_ID = 'hobunjiCloudSaveLauncher';
  const SETTINGS_ROW_ID = 'hobunjiCloudSaveSettingsRow';

  let _user = null;
  let _remote = null;
  let _availability = 'checking';
  let _lastError = '';
  let _lastMessage = '';
  let _conflict = null;
  let _busy = false;
  let _panelOpen = false;
  let _autoTimer = null;
  let _changePollTimer = null;
  let _lastObservedFingerprint = '';
  let _dirty = false;
  let _pendingAuthCallback = null;
  const _listeners = new Set();

  function snapshotApi() {
    return window.HobunjiSaveSnapshot || null;
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (id) return id;
    // Persistent per-browser device id; used only for conflict/debug labels in cloud metadata.
    id = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  }

  function stateKey(userId) {
    return STATE_KEY_PREFIX + userId;
  }

  function readLinkState(userId = _user?.id) {
    if (!userId) return null;
    try {
      const value = JSON.parse(localStorage.getItem(stateKey(userId)) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function writeLinkState(next, userId = _user?.id) {
    if (!userId) return;
    localStorage.setItem(stateKey(userId), JSON.stringify(next));
  }

  function clearLinkState(userId = _user?.id) {
    if (!userId) return;
    localStorage.removeItem(stateKey(userId));
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

  function getStatus() {
    const link = readLinkState();
    return {
      availability: _availability,
      user: _user ? { ..._user } : null,
      remote: _remote ? { ..._remote } : null,
      conflict: _conflict ? { ..._conflict } : null,
      busy: _busy,
      panelOpen: _panelOpen,
      autoSyncArmed: !!(_autoTimer && link?.autoSyncArmed),
      dirty: _dirty,
      link,
      deviceId: getDeviceId(),
      lastError: _lastError || null,
      lastMessage: _lastMessage || null,
      pendingAuthCallback: _pendingAuthCallback ? { type: _pendingAuthCallback.type } : null,
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

  class CloudRequestError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'CloudRequestError';
      this.status = status;
      this.payload = payload;
    }
  }

  async function postJson(url, payload) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
    } catch (error) {
      throw new CloudRequestError(`Network unavailable: ${String(error?.message || error)}`, 0, null);
    }

    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok || data?.ok === false) {
      throw new CloudRequestError(data?.error || `Request failed (${response.status}).`, response.status, data);
    }
    return data || { ok: true };
  }

  function auth(action, payload = {}) {
    return postJson(AUTH_URL, { action, ...payload });
  }

  function cloud(action, payload = {}) {
    return postJson(SAVE_URL, { action, ...payload });
  }

  function markUnavailable(error) {
    _availability = error?.status === 404 ? 'not-netlify' : 'error';
    _lastError = String(error?.message || error);
    stopAutoSync();
    notify();
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
    if (!_user || _conflict) return;
    const link = readLinkState();
    if (!link?.autoSyncArmed) return;
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
    const now = Date.now();
    writeLinkState({
      revision: Number(remote?.revision) || 0,
      lastSyncedFingerprint: fingerprint || localFingerprint(),
      lastSyncedAt: now,
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
      message: message || 'The cloud save changed on another device.',
    };
    const link = readLinkState();
    if (link) writeLinkState({ ...link, autoSyncArmed: false });
    stopAutoSync();
    _lastMessage = _conflict.message;
    notify();
  }

  async function refreshRemoteStatus() {
    if (!_user) {
      _remote = null;
      return null;
    }
    const result = await cloud('status');
    _remote = result.remote || null;
    return _remote;
  }

  async function refreshAuthAndRemote() {
    try {
      const result = await auth('status');
      _availability = 'ready';
      _user = result.user || null;
      _lastError = '';
      _conflict = null;
      stopAutoSync();

      if (!_user) {
        _remote = null;
        notify();
        return getStatus();
      }

      await refreshRemoteStatus();
      const link = readLinkState();
      if (_remote && (!link || Number(link.revision) !== Number(_remote.revision))) {
        setConflict(_remote, link ? 'remote-newer' : 'unlinked-device',
          link ? 'Cloud revision differs from this device.' : 'This account already has a cloud save that this browser has never synced.');
      } else if (link?.autoSyncArmed) {
        armAutoSync();
      }
      notify();
      return getStatus();
    } catch (error) {
      markUnavailable(error);
      return getStatus();
    }
  }

  async function pushNow({ force = false, automatic = false } = {}) {
    if (!_user) throw new Error('Sign in to use cloud saves.');
    const snapshots = snapshotApi();
    if (!snapshots) throw new Error('Save snapshot adapter is not loaded.');
    const snapshot = snapshots.capture({ strict: true });
    const fingerprint = snapshots.fingerprint(snapshot);
    const link = readLinkState();
    const baseRevision = Number(link?.revision) || 0;

    try {
      const result = await cloud('push', {
        snapshot,
        baseRevision,
        force,
        deviceId: getDeviceId(),
      });
      saveSuccessfulLink(result.remote, fingerprint);
      _lastError = '';
      _lastMessage = automatic ? 'Cloud autosave complete.' : 'Saved this device to the cloud.';
      notify();
      return result;
    } catch (error) {
      if (error?.status === 409 && error.payload?.conflict) {
        setConflict(error.payload.remote, 'write-conflict', error.payload.error);
        return null;
      }
      _lastError = String(error?.message || error);
      if (automatic) {
        _lastMessage = 'Cloud autosave failed; local browser save is still intact.';
        notify();
        return null;
      }
      throw error;
    }
  }

  async function pullNow({ confirmOverwrite = true } = {}) {
    if (!_user) throw new Error('Sign in to use cloud saves.');
    if (confirmOverwrite && !confirm('Replace this browser save with the current cloud save? The browser copy will be overwritten.')) return null;
    const result = await cloud('pull');
    const snapshots = snapshotApi();
    if (!snapshots) throw new Error('Save snapshot adapter is not loaded.');
    snapshots.apply(result.snapshot);
    const fingerprint = snapshots.fingerprint(result.snapshot);
    saveSuccessfulLink(result.remote, fingerprint);
    _lastError = '';
    _lastMessage = 'Loaded cloud save into this browser.';
    sessionStorage.setItem('hobunjiCloudSaveReloaded', '1');
    notify();
    setTimeout(() => location.reload(), 0);
    return result;
  }

  async function safeSync({ automatic = false } = {}) {
    if (!_user || _busy) return null;
    if (_conflict) return null;

    _busy = true;
    try {
      const snapshots = snapshotApi();
      if (!snapshots) throw new Error('Save snapshot adapter is not loaded.');
      const local = snapshots.capture({ strict: true });
      const fingerprint = snapshots.fingerprint(local);
      const link = readLinkState();
      const remote = await refreshRemoteStatus();

      if (!remote) return await pushNow({ force: false, automatic });

      if (!link) {
        setConflict(remote, 'unlinked-device', 'This browser has never synced with the existing cloud save. Choose which copy to keep.');
        return null;
      }

      if (Number(link.revision) !== Number(remote.revision)) {
        if (!automatic && fingerprint === link.lastSyncedFingerprint) {
          return await pullNow({ confirmOverwrite: false });
        }
        setConflict(remote, 'remote-newer', 'Cloud changed since this browser last synced. Choose which copy to keep.');
        return null;
      }

      if (fingerprint === link.lastSyncedFingerprint) {
        _dirty = false;
        _lastMessage = 'Cloud save is already current.';
        if (!automatic && !link.autoSyncArmed) {
          writeLinkState({ ...link, autoSyncArmed: true });
          armAutoSync();
        }
        notify();
        return { ok: true, unchanged: true };
      }

      return await pushNow({ force: false, automatic });
    } catch (error) {
      _lastError = String(error?.message || error);
      _lastMessage = automatic ? 'Cloud autosave failed; browser save remains available.' : 'Cloud sync failed.';
      notify();
      if (!automatic) throw error;
      return null;
    } finally {
      _busy = false;
      notify();
    }
  }

  async function forcePushCurrentDevice() {
    if (!_user) return;
    if (!confirm('Overwrite the cloud save with this browser copy? This replaces the other device’s cloud revision.')) return;
    _busy = true;
    try {
      await pushNow({ force: true, automatic: false });
    } catch (error) {
      _lastError = String(error?.message || error);
    } finally {
      _busy = false;
      notify();
    }
  }

  async function loginUser(email, password) {
    setBusy(true, 'Signing in…');
    try {
      const result = await auth('login', { email, password });
      _user = result.user || null;
      _availability = 'ready';
      _lastError = '';
      _lastMessage = 'Signed in.';
      await refreshRemoteStatus();
      const link = readLinkState();
      if (_remote && (!link || Number(link.revision) !== Number(_remote.revision))) {
        setConflict(_remote, link ? 'remote-newer' : 'unlinked-device', 'Cloud save found. Choose which copy to use before autosync starts.');
      }
    } catch (error) {
      _lastError = String(error?.message || error);
    } finally {
      _busy = false;
      notify();
    }
  }

  async function signupUser(email, password, name) {
    setBusy(true, 'Creating account…');
    try {
      const result = await auth('signup', { email, password, name });
      _user = result.user || null;
      _availability = 'ready';
      _lastError = '';
      _lastMessage = result.message || 'Account created.';
      if (_user) await refreshRemoteStatus();
    } catch (error) {
      _lastError = String(error?.message || error);
    } finally {
      _busy = false;
      notify();
    }
  }

  async function logoutUser() {
    setBusy(true, 'Signing out…');
    try {
      await auth('logout');
      _user = null;
      _remote = null;
      _conflict = null;
      _lastError = '';
      _lastMessage = 'Signed out. Browser saves remain untouched.';
      stopAutoSync();
    } catch (error) {
      _lastError = String(error?.message || error);
    } finally {
      _busy = false;
      notify();
    }
  }

  function parseAuthCallback() {
    const hash = location.hash?.replace(/^#/, '');
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const pairs = [
      ['confirmation_token', 'confirm'],
      ['recovery_token', 'recover'],
      ['invite_token', 'invite'],
    ];
    for (const [key, type] of pairs) {
      const token = params.get(key);
      if (token) return { type, token };
    }
    return null;
  }

  async function processSimpleCallback(callback) {
    if (!callback || callback.type !== 'confirm') return false;
    setBusy(true, 'Confirming account…');
    try {
      const result = await auth('confirm', { token: callback.token });
      _user = result.user || null;
      _lastMessage = result.message || 'Account confirmed.';
      _lastError = '';
      history.replaceState(null, '', location.pathname + location.search);
      _pendingAuthCallback = null;
      if (_user) await refreshRemoteStatus();
      return true;
    } catch (error) {
      _lastError = String(error?.message || error);
      return false;
    } finally {
      _busy = false;
      _panelOpen = true;
      notify();
    }
  }

  async function finishPasswordCallback(password) {
    if (!_pendingAuthCallback || !password) return;
    const callback = _pendingAuthCallback;
    setBusy(true, callback.type === 'invite' ? 'Accepting invitation…' : 'Updating password…');
    try {
      const action = callback.type === 'invite' ? 'accept-invite' : 'recover';
      const result = await auth(action, { token: callback.token, password });
      _user = result.user || null;
      _lastMessage = result.message || 'Account ready.';
      _lastError = '';
      _pendingAuthCallback = null;
      history.replaceState(null, '', location.pathname + location.search);
      if (_user) await refreshRemoteStatus();
    } catch (error) {
      _lastError = String(error?.message || error);
    } finally {
      _busy = false;
      notify();
    }
  }

  function injectStyles() {
    if (document.getElementById('hobunjiCloudSaveStyles')) return;
    const style = document.createElement('style');
    style.id = 'hobunjiCloudSaveStyles';
    style.textContent = `
      #${LAUNCHER_ID}{position:fixed;top:10px;right:10px;z-index:2147483000;border:1px solid rgba(255,255,255,.28);border-radius:8px;background:rgba(20,29,34,.94);color:#eaf5f9;padding:8px 10px;font:600 13px/1.1 "Pixelify Sans",system-ui,sans-serif;box-shadow:0 5px 22px rgba(0,0,0,.35);cursor:pointer;display:none}
      #${PANEL_ID}{position:fixed;inset:0;z-index:2147483500;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(5,8,11,.78);backdrop-filter:blur(3px);box-sizing:border-box;font-family:"Pixelify Sans",system-ui,sans-serif}
      #${PANEL_ID}.open{display:flex}
      #${PANEL_ID} .hcs-card{width:min(600px,96vw);max-height:90vh;overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:#151d22;color:#edf4f6;padding:18px;box-shadow:0 20px 70px rgba(0,0,0,.55)}
      #${PANEL_ID} .hcs-head{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px}
      #${PANEL_ID} .hcs-title{font-size:21px;font-weight:800}
      #${PANEL_ID} .hcs-close{border:0;background:transparent;color:#d8e1e5;font-size:24px;cursor:pointer;padding:3px 8px}
      #${PANEL_ID} .hcs-note{font-size:12px;line-height:1.45;color:#9db0ba;margin:5px 0 10px}
      #${PANEL_ID} .hcs-status{padding:9px 10px;border-radius:8px;background:#202b31;font-size:12px;line-height:1.45;margin:8px 0}
      #${PANEL_ID} .hcs-error{background:rgba(155,51,51,.22);color:#ffbcbc}
      #${PANEL_ID} .hcs-conflict{background:rgba(168,117,37,.24);color:#ffe0a3}
      #${PANEL_ID} .hcs-row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
      #${PANEL_ID} input{flex:1 1 180px;min-width:0;border:1px solid #52626b;border-radius:7px;background:#0f1519;color:#f1f7f8;padding:9px 10px;font:inherit}
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

  function accountFormHtml() {
    return `
      <div class="hcs-note">Sign in with a Netlify Identity account. Your ordinary browser save still works offline and remains the live gameplay copy.</div>
      <div class="hcs-row"><input id="hcsEmail" type="email" autocomplete="email" placeholder="Email"></div>
      <div class="hcs-row"><input id="hcsPassword" type="password" autocomplete="current-password" placeholder="Password"></div>
      <div class="hcs-row"><input id="hcsName" type="text" autocomplete="name" placeholder="Display name (only for new account)"></div>
      <div class="hcs-row">
        <button class="hcs-btn primary" id="hcsLogin">Sign In</button>
        <button class="hcs-btn" id="hcsSignup">Create Account</button>
        <button class="hcs-btn" id="hcsRecovery">Forgot Password</button>
      </div>`;
  }

  function callbackFormHtml() {
    const invite = _pendingAuthCallback?.type === 'invite';
    return `
      <div class="hcs-status">${invite ? 'Invitation found. Choose a password to finish creating this account.' : 'Password recovery link found. Choose a new password.'}</div>
      <div class="hcs-row"><input id="hcsCallbackPassword" type="password" autocomplete="new-password" placeholder="New password"></div>
      <div class="hcs-row"><button class="hcs-btn primary" id="hcsFinishCallback">${invite ? 'Accept Invitation' : 'Set New Password'}</button></div>`;
  }

  function signedInHtml() {
    const link = readLinkState();
    const remoteText = _remote
      ? `Cloud revision ${_remote.revision} · ${esc(formatTime(_remote.updatedAt))}${_remote.deviceId ? ` · device ${esc(_remote.deviceId.slice(0, 12))}` : ''}`
      : 'No cloud save exists yet for this account.';
    const autoText = link?.autoSyncArmed && !_conflict
      ? `Autosync armed${_dirty ? ' · local changes waiting to upload' : ''}`
      : 'Autosync paused until a successful explicit sync.';

    let conflictHtml = '';
    if (_conflict) {
      conflictHtml = `
        <div class="hcs-status hcs-conflict"><strong>Save conflict:</strong> ${esc(_conflict.message)}<br>Remote: revision ${esc(_conflict.remoteRevision)}, ${esc(formatTime(_conflict.remoteUpdatedAt))}.</div>
        <div class="hcs-row">
          <button class="hcs-btn warn" id="hcsKeepDevice">Keep This Device → Cloud</button>
          <button class="hcs-btn primary" id="hcsUseCloud">Use Cloud → This Device</button>
        </div>`;
    }

    return `
      <div class="hcs-status">Signed in as <strong>${esc(_user.email || _user.name)}</strong><br>${remoteText}<br>${esc(autoText)}</div>
      ${conflictHtml}
      <div class="hcs-row">
        <button class="hcs-btn primary" id="hcsSyncNow">Sync Now</button>
        <button class="hcs-btn" id="hcsPushNow">Save Device → Cloud</button>
        <button class="hcs-btn" id="hcsPullNow" ${_remote ? '' : 'disabled'}>Load Cloud → Device</button>
        <button class="hcs-btn danger" id="hcsLogout">Sign Out</button>
      </div>`;
  }

  function renderPanel() {
    const panel = ensurePanel();
    panel.classList.toggle('open', _panelOpen);
    if (!_panelOpen) return;

    const unavailable = _availability !== 'ready' && _availability !== 'checking';
    const availabilityHtml = unavailable
      ? `<div class="hcs-status hcs-error">Cloud backend unavailable here. ${esc(_lastError || 'Open the Netlify deployment and make sure Identity is enabled.')}</div>`
      : (_availability === 'checking' ? '<div class="hcs-status">Checking Netlify cloud-save service…</div>' : '');
    const errorHtml = _lastError && !unavailable ? `<div class="hcs-status hcs-error">${esc(_lastError)}</div>` : '';
    const messageHtml = _lastMessage ? `<div class="hcs-status">${esc(_lastMessage)}</div>` : '';
    const bodyHtml = _pendingAuthCallback
      ? callbackFormHtml()
      : (_user ? signedInHtml() : accountFormHtml());

    panel.innerHTML = `
      <div class="hcs-card">
        <div class="hcs-head"><div class="hcs-title">☁ Cloud Save</div><button class="hcs-close" id="hcsClose" aria-label="Close">×</button></div>
        <div class="hcs-note">Netlify cloud storage mirrors the same save used by the browser and local-folder backup. Conflicting device revisions never overwrite each other automatically.</div>
        ${availabilityHtml}${errorHtml}${messageHtml}${bodyHtml}
        <details><summary>Cloud save debug</summary><code>${esc(JSON.stringify({
          deviceId: getDeviceId(),
          availability: _availability,
          remote: _remote,
          link: readLinkState(),
          dirty: _dirty,
        }, null, 2))}</code></details>
      </div>`;

    panel.querySelector('#hcsClose')?.addEventListener('click', closePanel);
    panel.querySelectorAll('button,input').forEach(el => { if (_busy && el.id !== 'hcsClose') el.disabled = true; });

    panel.querySelector('#hcsLogin')?.addEventListener('click', () => {
      loginUser(panel.querySelector('#hcsEmail')?.value, panel.querySelector('#hcsPassword')?.value);
    });
    panel.querySelector('#hcsSignup')?.addEventListener('click', () => {
      signupUser(panel.querySelector('#hcsEmail')?.value, panel.querySelector('#hcsPassword')?.value, panel.querySelector('#hcsName')?.value);
    });
    panel.querySelector('#hcsRecovery')?.addEventListener('click', async () => {
      const email = panel.querySelector('#hcsEmail')?.value;
      if (!email) { _lastError = 'Enter the account email first.'; notify(); return; }
      setBusy(true, 'Sending recovery email…');
      try {
        const result = await auth('request-recovery', { email });
        _lastError = '';
        _lastMessage = result.message || 'Recovery email sent.';
      } catch (error) {
        _lastError = String(error?.message || error);
      } finally {
        _busy = false;
        notify();
      }
    });
    panel.querySelector('#hcsFinishCallback')?.addEventListener('click', () => {
      finishPasswordCallback(panel.querySelector('#hcsCallbackPassword')?.value);
    });
    panel.querySelector('#hcsSyncNow')?.addEventListener('click', () => safeSync({ automatic: false }));
    panel.querySelector('#hcsPushNow')?.addEventListener('click', () => pushNow({ force: false, automatic: false }).catch(error => { _lastError = String(error?.message || error); notify(); }));
    panel.querySelector('#hcsPullNow')?.addEventListener('click', () => pullNow({ confirmOverwrite: true }).catch(error => { _lastError = String(error?.message || error); notify(); }));
    panel.querySelector('#hcsKeepDevice')?.addEventListener('click', forcePushCurrentDevice);
    panel.querySelector('#hcsUseCloud')?.addEventListener('click', () => pullNow({ confirmOverwrite: true }).catch(error => { _lastError = String(error?.message || error); notify(); }));
    panel.querySelector('#hcsLogout')?.addEventListener('click', logoutUser);
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
    // Save-selection cards exist before gameplay. Keep cloud access visible there,
    // but do not leave a floating gameplay button once the game itself is running.
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
        <div class="settings-name">Netlify Cloud Save</div>
        <div class="settings-desc" data-hcs-inline-status>Checking account…</div>
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
    let text;
    if (_availability === 'checking') text = 'Checking Netlify cloud service…';
    else if (_availability !== 'ready') text = 'Unavailable here; open the Netlify deployment or enable Identity.';
    else if (!_user) text = 'Not signed in. Browser/local-folder saves still work normally.';
    else if (_conflict) text = `Signed in as ${_user.email}. Conflict requires a choice before autosync.`;
    else if (_remote) text = `Signed in as ${_user.email}. Cloud revision ${_remote.revision}; ${readLinkState()?.autoSyncArmed ? 'autosync on' : 'autosync paused'}.`;
    else text = `Signed in as ${_user.email}. No cloud save yet.`;
    // Assigning textContent always replaces the child text node, even when
    // the string is unchanged -- that's a childList mutation, which the
    // document.body observer below reacts to by calling this function again,
    // forever. Skipping no-op writes breaks that self-triggering loop.
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

    _pendingAuthCallback = parseAuthCallback();
    if (_pendingAuthCallback?.type === 'confirm') {
      await processSimpleCallback(_pendingAuthCallback);
    } else {
      if (_pendingAuthCallback) _panelOpen = true;
      await refreshAuthAndRemote();
    }

    if (sessionStorage.getItem('hobunjiCloudSaveReloaded')) {
      sessionStorage.removeItem('hobunjiCloudSaveReloaded');
      _lastMessage = 'Cloud save loaded successfully.';
      notify();
    }

    // rAF-throttled (not a raw per-mutation callback): renderSettingsRow()
    // itself mutates the observed subtree (see its own comment), so an
    // unthrottled callback here would re-trigger itself every microtask
    // instead of every frame -- a storm that never lets the browser paint,
    // run rAF, or dispatch input events, so it looks like the whole page has
    // hung. Coalescing to one pass per frame keeps this self-triggering but
    // bounded, same as save-startup-gate.js's own document.body observer.
    let _bodyObserverScheduled = false;
    const observer = new MutationObserver(() => {
      if (_bodyObserverScheduled) return;
      _bodyObserverScheduled = true;
      requestAnimationFrame(() => {
        _bodyObserverScheduled = false;
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

  window.NetlifyCloudSave = {
    getStatus,
    onChange,
    openPanel,
    closePanel,
    refresh: refreshAuthAndRemote,
    syncNow: () => safeSync({ automatic: false }),
    pushNow: () => pushNow({ force: false, automatic: false }),
    pullNow: () => pullNow({ confirmOverwrite: true }),
    forcePushCurrentDevice,
    signOut: logoutUser,
  };

  // Mobile-accessible diagnostics: all useful state/actions are reachable without DevTools.
  window.__hobunjiCloudSaveDebug = {
    status: getStatus,
    captureLocal: () => snapshotApi()?.capture?.({ strict: false }) || null,
    refresh: refreshAuthAndRemote,
    sync: () => safeSync({ automatic: false }),
    clearLink: () => {
      clearLinkState();
      _conflict = _remote ? { reason: 'unlinked-device', remoteRevision: _remote.revision, remoteUpdatedAt: _remote.updatedAt, remoteDeviceId: _remote.deviceId, message: 'Local cloud-link metadata cleared.' } : null;
      stopAutoSync();
      notify();
      return getStatus();
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
