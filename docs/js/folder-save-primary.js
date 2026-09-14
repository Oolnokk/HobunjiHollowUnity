// Folder Save Primary — promotes folder persistence over browser-only saves,
// removes avoidable restore reloads, and adds conservative persistence guards.
(() => {
  'use strict';

  const localSave = window.LocalSaveFolder; // Existing persistence core this UX layer coordinates without duplicating storage logic.
  if (!localSave || window.FolderSavePrimary) return;

  const LEGACY_STARTUP_SKIP_KEY = 'hobunjiLocalSaveSkipStartupOnce'; // Consumed by local-save-flow.js so its older post-DOM startup gate stays suppressed.
  const PRIMARY_SKIP_ONCE_KEY = 'hobunjiFolderPrimarySkipOnce'; // Used after an intentional runtime reload so startup does not ask about the folder again.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used to detect whether a folder restore actually changed onboarding-visible save data.
  const GATE_ID = 'folderSavePrimaryGate'; // DOM id for the only pre-onboarding folder permission gate.
  const LOCK_NAME = 'hobunji-primary-folder-save'; // Navigator Lock serializes explicit folder reads/writes across tabs when supported.

  let startupPromise = null; // Shared by repeated onboarding init callers so only one startup reconciliation can run.
  let startupMode = 'pending'; // Exposed to mobile diagnostics to show whether folder or browser fallback won startup.
  let lastUiAction = 'none'; // Exposed to mobile diagnostics as the latest user-facing folder operation.
  let lastUiError = ''; // Exposed to mobile diagnostics when a folder action fails without DevTools.
  let settingsBound = false; // Prevents duplicate Settings listeners when the panel is rebuilt/reparented.
  let mutationScheduled = false; // Coalesces broad DOM mutations into one hierarchy/style refresh per frame.

  // local-save-flow.js historically owns a second startup gate. FolderSavePrimary
  // runs earlier and resolves persistence before onboarding, so tell that module
  // to stand down when DOMContentLoaded eventually fires.
  try { sessionStorage.setItem(LEGACY_STARTUP_SKIP_KEY, 'folder-primary-owner'); } catch {}

  const rawLoadFromFolder = localSave.loadFromFolder.bind(localSave); // Core load retained so the wrapper can sanitize messaging and add a cross-tab lock.
  const rawSyncNow = localSave.syncNow.bind(localSave); // Core sync retained so explicit/manual flushes can share the cross-tab lock.

  function withFolderLock(operation) {
    if (!navigator?.locks?.request) return Promise.resolve().then(operation);
    return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, operation);
  }

  localSave.loadFromFolder = async (...args) => withFolderLock(async () => {
    const result = await rawLoadFromFolder(...args);
    if (result && typeof result.message === 'string') {
      result.message = result.message.replace(/\s*Reload the page to apply it\.?\s*$/i, '');
    }
    return result;
  });

  localSave.syncNow = async (options = {}) => withFolderLock(() => rawSyncNow(options));

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readBrowserMeta() {
    try {
      const raw = localStorage.getItem(SAVE_META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function browserSaveIsSafeToPush() {
    const meta = readBrowserMeta();
    if (!meta) return false;
    return Array.isArray(meta.characters) && Array.isArray(meta.worlds);
  }

  function folderActionSucceeded(result) {
    const status = localSave.getStatus();
    return Boolean(result?.ok || (!status.lastError && status.state === 'ready' && status.autoSyncArmed));
  }

  function waitForCoreStatus() {
    if (!localSave.isSupported?.()) return Promise.resolve(localSave.getStatus());
    const current = localSave.getStatus();
    if (current.state !== 'unsupported') return Promise.resolve(current);

    return new Promise(resolve => {
      let settled = false; // Guards the onChange callback and timeout from resolving the same wait twice.
      let unsubscribe = null; // Filled by onChange and called once core initialization leaves its sentinel state.
      const finish = status => {
        if (settled) return;
        settled = true;
        try { unsubscribe?.(); } catch {}
        resolve(status || localSave.getStatus());
      };
      unsubscribe = localSave.onChange(status => {
        if (status.state !== 'unsupported') finish(status);
      });
      setTimeout(() => finish(localSave.getStatus()), 2500);
    });
  }

  function removeGate() {
    document.getElementById(GATE_ID)?.remove();
  }

  function showReconnectGate(status) {
    return new Promise(resolve => {
      removeGate();
      const gate = document.createElement('div'); // Blocking startup surface used only when browser permission must be restored by a gesture.
      gate.id = GATE_ID;
      gate.setAttribute('role', 'dialog');
      gate.setAttribute('aria-modal', 'true');
      gate.setAttribute('aria-label', 'Reconnect primary save folder');
      gate.innerHTML = `
        <div class="folder-save-primary-gate-card">
          <div class="folder-save-primary-gate-title">💾 Primary Save Folder</div>
          <div class="folder-save-primary-gate-copy">Your save folder “${esc(status.folderName || 'Save Folder')}” is remembered. Reconnect it and the folder will be loaded before farmers and worlds are shown.</div>
          <div class="folder-save-primary-gate-status" data-folder-primary-status></div>
          <div class="folder-save-primary-gate-actions">
            <button type="button" class="folder-save-primary-gate-fallback" data-folder-primary-browser>Use browser fallback</button>
            <button type="button" class="folder-save-primary-gate-main" data-folder-primary-reconnect>Reconnect Save Folder</button>
          </div>
        </div>`;
      document.body.appendChild(gate);

      const statusEl = gate.querySelector('[data-folder-primary-status]'); // Updated while reconnect/read work is in progress.
      const browserBtn = gate.querySelector('[data-folder-primary-browser]'); // Secondary escape hatch that deliberately leaves folder autosync unarmed.
      const reconnectBtn = gate.querySelector('[data-folder-primary-reconnect]'); // Primary action that restores permission and immediately loads the folder.

      browserBtn?.addEventListener('click', () => {
        startupMode = 'browser-fallback';
        lastUiAction = 'startup-browser-fallback';
        removeGate();
        resolve('browser');
      }, { once: true });

      reconnectBtn?.addEventListener('click', async () => {
        if (statusEl) statusEl.textContent = 'Reconnecting…';
        if (reconnectBtn) reconnectBtn.disabled = true;
        if (browserBtn) browserBtn.disabled = true;
        try {
          const reconnected = await localSave.reconnect();
          if (reconnected.state !== 'ready') {
            if (statusEl) statusEl.textContent = 'Folder permission was not granted. Nothing was overwritten.';
            if (reconnectBtn) reconnectBtn.disabled = false;
            if (browserBtn) browserBtn.disabled = false;
            return;
          }
          if (statusEl) statusEl.textContent = 'Loading folder save…';
          const result = await localSave.loadFromFolder();
          if (!folderActionSucceeded(result)) {
            if (statusEl) statusEl.textContent = result?.message || localSave.getStatus().lastError || 'Could not load this folder.';
            if (reconnectBtn) reconnectBtn.disabled = false;
            if (browserBtn) browserBtn.disabled = false;
            return;
          }
          startupMode = 'folder';
          lastUiAction = 'startup-reconnected-folder';
          removeGate();
          resolve('folder');
        } catch (error) {
          lastUiError = String(error?.message || error);
          if (statusEl) statusEl.textContent = lastUiError;
          if (reconnectBtn) reconnectBtn.disabled = false;
          if (browserBtn) browserBtn.disabled = false;
        }
      });
    });
  }

  async function prepareBeforeOnboarding() {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      const skipOnce = (() => {
        try {
          const value = sessionStorage.getItem(PRIMARY_SKIP_ONCE_KEY);
          if (value) sessionStorage.removeItem(PRIMARY_SKIP_ONCE_KEY);
          return value;
        } catch {
          return null;
        }
      })();
      if (skipOnce) {
        startupMode = 'folder-already-applied';
        return startupMode;
      }

      const status = await waitForCoreStatus();
      if (!localSave.isSupported?.() || !status.folderName) {
        startupMode = 'browser-no-folder';
        return startupMode;
      }

      if (status.state === 'ready') {
        try {
          lastUiAction = 'startup-auto-load-folder';
          const result = await localSave.loadFromFolder();
          if (folderActionSucceeded(result)) {
            startupMode = 'folder';
            return startupMode;
          }
          lastUiError = result?.message || localSave.getStatus().lastError || '';
        } catch (error) {
          lastUiError = String(error?.message || error);
        }
      }

      if (status.state === 'needs-permission' || status.folderName) {
        return showReconnectGate(localSave.getStatus());
      }

      startupMode = 'browser-fallback';
      return startupMode;
    })();
    return startupPromise;
  }

  async function establishPrimaryFolder(mode) {
    const beforeMeta = localStorage.getItem(SAVE_META_KEY) || ''; // Compared after reconciliation to decide whether onboarding's private save model must be rebuilt.
    lastUiError = '';
    lastUiAction = `${mode}-folder`;

    let status = localSave.getStatus();
    if (!localSave.isSupported?.()) throw new Error('Save folders are not supported in this browser.');

    if (mode === 'choose') status = await localSave.chooseFolder();
    else if (mode === 'change') status = await localSave.changeFolder();
    else if (mode === 'reconnect') status = await localSave.reconnect();

    if (status.state !== 'ready') return { ok: false, changed: false, message: status.lastError || 'Folder access was not completed.' };

    const result = await localSave.loadFromFolder();
    const succeeded = folderActionSucceeded(result);
    const afterMeta = localStorage.getItem(SAVE_META_KEY) || ''; // Fresh local metadata after the folder either loaded or adopted the browser save.
    return {
      ...(result || {}),
      ok: succeeded,
      changed: beforeMeta !== afterMeta || Boolean(result?.changed),
      message: result?.message || (succeeded ? 'Primary save folder connected.' : 'Could not establish the primary save folder.'),
    };
  }

  async function refreshOnboardingIfNeeded(result) {
    if (!result?.ok || !result.changed) return;
    if (window.FolderSaveOnboarding?.refreshFromStorage) {
      window.FolderSaveOnboarding.refreshFromStorage();
      return;
    }
    // If the bridge has not loaded yet, the normal first init will read the new
    // localStorage metadata. No reload is needed.
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (!button.dataset.folderPrimaryLabel) button.dataset.folderPrimaryLabel = button.textContent || '';
    button.disabled = busy;
    button.textContent = busy ? (label || '…') : button.dataset.folderPrimaryLabel;
  }

  async function handleFolderSourceAction(button, mode) {
    setBusy(button, true, mode === 'reconnect' ? 'Reconnecting…' : 'Opening Folder…');
    try {
      const result = await establishPrimaryFolder(mode);
      if (!result.ok) {
        if (result.message) alert(result.message);
        return;
      }
      await refreshOnboardingIfNeeded(result);
      scheduleUiRefresh();
    } catch (error) {
      lastUiError = String(error?.message || error);
      alert('Could not use that save folder:\n' + lastUiError);
    } finally {
      setBusy(button, false);
    }
  }

  async function handleExplicitLoad(button) {
    if (!confirm('Use the folder save as the primary save? This replaces the browser fallback copy with the folder contents.')) return;
    const beforeMeta = localStorage.getItem(SAVE_META_KEY) || ''; // Compared after load so a changed save list can be rebuilt without a page reload.
    setBusy(button, true, 'Loading Folder…');
    try {
      const result = await localSave.loadFromFolder();
      if (!folderActionSucceeded(result)) {
        alert(result?.message || localSave.getStatus().lastError || 'Could not load the folder save.');
        return;
      }
      const afterMeta = localStorage.getItem(SAVE_META_KEY) || ''; // Updated browser cache after the folder read completes.
      result.changed = Boolean(result.changed || beforeMeta !== afterMeta);
      await refreshOnboardingIfNeeded(result);
      scheduleUiRefresh();
    } catch (error) {
      lastUiError = String(error?.message || error);
      alert('Could not load the folder save:\n' + lastUiError);
    } finally {
      setBusy(button, false);
    }
  }

  function captureFolderButtons(event) {
    const button = event.target?.closest?.('button');
    if (!button) return;
    const id = button.id;
    const actions = {
      slLocalSaveChoose: 'choose',
      slLocalSaveChange: 'change',
      slLocalSaveReconnect: 'reconnect',
      hobunjiEmptySaveFolder: 'empty-restore',
    };

    if (id === 'slLocalSaveLoad') {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleExplicitLoad(button);
      return;
    }

    if (!(id in actions)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (id === 'hobunjiEmptySaveFolder') {
      const status = localSave.getStatus();
      const mode = status.state === 'ready' ? null : (status.folderName ? 'reconnect' : 'choose');
      if (mode) {
        handleFolderSourceAction(button, mode);
      } else {
        handleExplicitLoad(button);
      }
      return;
    }
    handleFolderSourceAction(button, actions[id]);
  }

  document.addEventListener('click', captureFolderButtons, true);

  function promoteSaveSource() {
    const card = document.querySelector('#ob-overlay .sl-card');
    if (!card) return;
    const sections = [...card.querySelectorAll('.sl-section')]; // Current source-step sections inspected by their existing labels rather than duplicated markup.
    const folderSection = sections.find(section => section.querySelector('#slLocalSaveChoose, #slLocalSaveChange, #slLocalSaveReconnect, #slLocalSaveLoad'));
    const browserSection = sections.find(section => section.querySelector('.sl-section-label')?.textContent?.trim() === 'This Browser');
    if (!folderSection) return;

    folderSection.classList.add('folder-save-primary-section');
    const folderLabel = folderSection.querySelector('.sl-section-label'); // Existing label promoted in place so onboarding logic and listeners remain intact.
    if (folderLabel) folderLabel.textContent = 'Primary Save Folder';
    const row = folderSection.querySelector('.sl-local-save-row'); // Existing button row receives one persistent explanation instead of a second set of controls.
    if (row && !row.querySelector('.folder-save-primary-hint')) {
      const hint = document.createElement('div');
      hint.className = 'folder-save-primary-hint';
      hint.textContent = 'Your portable save lives here. Browser storage is the working cache/fallback while the game runs.';
      row.appendChild(hint);
    }

    const labelMap = {
      slLocalSaveChoose: 'Connect Save Folder',
      slLocalSaveChange: 'Change Folder',
      slLocalSaveReconnect: 'Reconnect Save Folder',
      slLocalSaveLoad: 'Use Folder Save',
    };
    for (const [id, label] of Object.entries(labelMap)) {
      const button = folderSection.querySelector(`#${id}`);
      if (button && !button.disabled) button.textContent = label;
    }

    if (browserSection) {
      browserSection.classList.add('folder-save-browser-fallback');
      browserSection.classList.toggle('folder-save-browser-fallback-active', !localSave.isSupported?.());
      const browserLabel = browserSection.querySelector('.sl-section-label'); // Browser-only storage remains visible but is explicitly described as fallback.
      if (browserLabel) browserLabel.textContent = 'Browser Fallback';
      const copy = [...browserSection.children].find(child => child !== browserLabel);
      if (copy) {
        const meta = readBrowserMeta();
        const count = Array.isArray(meta?.characters) ? meta.characters.length : 0;
        copy.textContent = count
          ? `${count} farmer${count === 1 ? '' : 's'} cached on this device. Use this only when the primary folder is unavailable.`
          : 'No fallback save is cached on this device.';
      }
      const footer = card.querySelector('.sl-footer');
      if (folderSection.nextElementSibling !== browserSection) card.insertBefore(folderSection, browserSection);
      if (footer && browserSection.nextElementSibling !== footer) card.insertBefore(browserSection, footer);
    }
  }

  function promoteEmptySaveGate() {
    const gate = document.getElementById('hobunjiEmptySaveGate');
    if (!gate) return;
    const folderButton = gate.querySelector('#hobunjiEmptySaveFolder'); // Existing restore action is enlarged rather than duplicated.
    if (folderButton) {
      folderButton.classList.add('folder-save-primary-action');
      const status = localSave.getStatus();
      folderButton.textContent = status.folderName ? `💾 Use “${status.folderName}”` : '💾 Choose Save Folder';
    }
    const restoreSection = folderButton?.closest('.sl-section'); // Primary-folder explanation is inserted alongside the existing Restore section.
    if (restoreSection && !restoreSection.querySelector('.folder-save-primary-copy')) {
      const copy = document.createElement('div');
      copy.className = 'folder-save-primary-copy';
      copy.textContent = 'Recommended: keep the save in a folder. The browser copy is only the local working fallback.';
      restoreSection.insertBefore(copy, restoreSection.querySelector('div[style*="display:flex"]') || restoreSection.lastElementChild);
    }
  }

  function updateSettingsStatus(status) {
    const statusEl = document.getElementById('localSaveFolderStatus'); // Existing visible status line doubles as mobile diagnostics.
    if (!statusEl) return;
    if (!status.supported) statusEl.textContent = 'Folder saves are not supported in this browser; using browser fallback.';
    else if (!status.folderName) statusEl.textContent = 'No primary save folder connected.';
    else if (status.state === 'needs-permission') statusEl.textContent = `Primary folder “${status.folderName}” needs permission.`;
    else if (status.lastError) statusEl.textContent = `Primary folder “${status.folderName}”: ${status.lastError}`;
    else if (status.autoSyncArmed) statusEl.textContent = `Primary folder “${status.folderName}” is connected and autosyncing.`;
    else statusEl.textContent = `Primary folder “${status.folderName}” is connected; load or save to choose direction.`;
  }

  function bindSettings() {
    const row = document.getElementById('localSaveFolderRow');
    if (!row) return;

    const title = row.previousElementSibling?.classList?.contains('settings-section-title') ? row.previousElementSibling : null; // Paired section title moved with the folder row to the top of Settings.
    const parent = row.parentElement; // Settings content container that owns all sections.
    if (parent && title) {
      const firstTitle = [...parent.children].find(child => child.classList?.contains('settings-section-title'));
      if (firstTitle && firstTitle !== title) {
        parent.insertBefore(title, firstTitle);
        parent.insertBefore(row, firstTitle);
      }
      title.textContent = 'Primary Save Folder';
      title.style.marginTop = '0';
    }

    row.classList.add('folder-save-settings-primary');
    const name = row.querySelector('.settings-name'); // Existing heading rewritten so folder storage is not described as a mere backup.
    const desc = row.querySelector('.settings-desc'); // Existing description explains runtime cache versus portable folder truth.
    if (name) name.textContent = 'Primary Save Folder';
    if (desc) desc.textContent = 'Recommended save method. The game uses browser storage as a working cache while running, then syncs characters, worlds, and farm layouts to this portable folder.';

    const controls = row.querySelector('div[style*="display:flex"]'); // Existing button/status container receives one small fallback note.
    if (controls && !controls.querySelector('.folder-save-settings-fallback-note')) {
      const note = document.createElement('div');
      note.className = 'folder-save-settings-fallback-note';
      note.textContent = 'Browser-only saves remain available as a fallback, but are not the recommended long-term save location.';
      controls.appendChild(note);
    }

    if (!settingsBound) {
      settingsBound = true;
      document.getElementById('localSaveFolderChooseBtn')?.addEventListener('click', event => handleSettingsFolderAction(event.currentTarget, 'choose'));
      document.getElementById('localSaveFolderChangeBtn')?.addEventListener('click', event => handleSettingsFolderAction(event.currentTarget, 'change'));
      document.getElementById('localSaveFolderReconnectBtn')?.addEventListener('click', event => handleSettingsFolderAction(event.currentTarget, 'reconnect'));
      document.getElementById('localSaveFolderSaveNowBtn')?.addEventListener('click', event => handleSettingsSave(event.currentTarget));
      document.getElementById('localSaveFolderLoadBtn')?.addEventListener('click', event => handleSettingsLoad(event.currentTarget));
    }
    refreshSettingsButtons(localSave.getStatus());
  }

  function refreshSettingsButtons(status) {
    updateSettingsStatus(status);
    const choose = document.getElementById('localSaveFolderChooseBtn'); // Shown only before a folder is configured.
    const change = document.getElementById('localSaveFolderChangeBtn'); // Secondary action once a folder exists.
    const reconnect = document.getElementById('localSaveFolderReconnectBtn'); // Primary action when permission expired.
    const save = document.getElementById('localSaveFolderSaveNowBtn'); // Manual browser-cache-to-folder flush.
    const load = document.getElementById('localSaveFolderLoadBtn'); // Explicit folder-to-browser restore while already in game.
    if (choose) choose.style.display = status.supported && !status.folderName ? '' : 'none';
    if (change) change.style.display = status.supported && Boolean(status.folderName) ? '' : 'none';
    if (reconnect) reconnect.style.display = status.supported && status.state === 'needs-permission' ? '' : 'none';
    if (save) {
      save.style.display = status.supported && status.state === 'ready' ? '' : 'none';
      save.textContent = 'Save to Folder';
    }
    if (load) {
      load.style.display = status.supported && status.state === 'ready' ? '' : 'none';
      load.textContent = 'Load Folder';
    }
  }

  async function handleSettingsFolderAction(button, mode) {
    setBusy(button, true, mode === 'reconnect' ? 'Reconnecting…' : 'Opening Folder…');
    try {
      const result = await establishPrimaryFolder(mode);
      if (!result.ok && result.message) alert(result.message);
      refreshSettingsButtons(localSave.getStatus());
    } catch (error) {
      lastUiError = String(error?.message || error);
      alert('Could not establish the primary save folder:\n' + lastUiError);
    } finally {
      setBusy(button, false);
    }
  }

  async function handleSettingsSave(button) {
    if (!browserSaveIsSafeToPush()) {
      alert('The browser fallback save is missing or unreadable, so it was not written over the folder save.');
      return;
    }
    setBusy(button, true, 'Saving…');
    try {
      let status = await localSave.syncNow();
      if (status.dataLossRisk) {
        const force = confirm(`The browser fallback ${status.dataLossRisk}.\n\nOverwrite the primary folder anyway?`);
        if (!force) return;
        status = await localSave.syncNow({ force: true });
      }
      if (status.lastError) alert(status.lastError);
      lastUiAction = 'settings-save-to-folder';
      refreshSettingsButtons(status);
    } catch (error) {
      lastUiError = String(error?.message || error);
      alert('Could not save to the primary folder:\n' + lastUiError);
    } finally {
      setBusy(button, false);
    }
  }

  async function handleSettingsLoad(button) {
    if (!confirm('Load the primary folder into this running game? If the save differs, the game will restart once so every runtime system uses the restored data.')) return;
    setBusy(button, true, 'Loading…');
    try {
      const result = await localSave.loadFromFolder();
      if (!folderActionSucceeded(result)) {
        alert(result?.message || localSave.getStatus().lastError || 'Could not load the primary folder.');
        return;
      }
      lastUiAction = 'settings-load-folder';
      if (result.changed) {
        try { sessionStorage.setItem(PRIMARY_SKIP_ONCE_KEY, 'folder-loaded-in-settings'); } catch {}
        location.reload();
        return;
      }
      refreshSettingsButtons(localSave.getStatus());
    } catch (error) {
      lastUiError = String(error?.message || error);
      alert('Could not load the primary folder:\n' + lastUiError);
    } finally {
      setBusy(button, false);
    }
  }

  function refreshUi() {
    mutationScheduled = false;
    promoteSaveSource();
    promoteEmptySaveGate();
    bindSettings();
  }

  function scheduleUiRefresh() {
    if (mutationScheduled) return;
    mutationScheduled = true;
    requestAnimationFrame(refreshUi);
  }

  localSave.onChange(status => {
    refreshSettingsButtons(status);
    scheduleUiRefresh();
  });

  const observer = new MutationObserver(scheduleUiRefresh); // Onboarding and Settings replace chunks of DOM, so hierarchy promotion follows those existing rerenders.
  const beginObserving = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleUiRefresh();
  };
  if (document.body) beginObserving();
  else document.addEventListener('DOMContentLoaded', beginObserving, { once: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    const status = localSave.getStatus(); // Current state checked before a best-effort background flush.
    if (status.state === 'ready' && status.autoSyncArmed) localSave.syncNow({ automatic: true }).catch(() => {});
  });

  window.addEventListener('pagehide', () => {
    const status = localSave.getStatus(); // Final best-effort flush complements the core's beforeunload handler on mobile tab switches.
    if (status.state === 'ready' && status.autoSyncArmed) localSave.syncNow({ automatic: true }).catch(() => {});
  });

  window.FolderSavePrimary = {
    prepareBeforeOnboarding,
    establishPrimaryFolder,
    refreshUi: scheduleUiRefresh,
    markFolderAlreadyApplied() {
      try { sessionStorage.setItem(PRIMARY_SKIP_ONCE_KEY, 'applied'); } catch {}
    },
  };

  window.__hobunjiFolderSavePrimaryDebug = {
    snapshot: () => ({
      startupMode,
      lastUiAction,
      lastUiError: lastUiError || null,
      status: localSave.getStatus(),
      browserMetaReadable: browserSaveIsSafeToPush(),
      legacyStartupGateSuppressed: (() => {
        try { return sessionStorage.getItem(LEGACY_STARTUP_SKIP_KEY) === 'folder-primary-owner'; } catch { return false; }
      })(),
      navigatorLocks: Boolean(navigator?.locks?.request),
    }),
  };
})();
