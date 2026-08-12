// Local Save Flow — startup load gate + explicit quit/save flow.
// Loaded immediately after local-save-folder-core.js. It owns only UX/orchestration;
// the core module remains the single owner of folder persistence and permissions.
(() => {
  'use strict';

  const STARTUP_GATE_ID = 'localSaveStartupGate';
  const QUIT_BUTTON_ID = 'menuQuitBtn';
  const SKIP_STARTUP_ONCE_KEY = 'hobunjiLocalSaveSkipStartupOnce';

  let _domReady = false;
  let _startupResolved = false;

  function api() {
    return window.LocalSaveFolder || null;
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function removeStartupGate() {
    document.getElementById(STARTUP_GATE_ID)?.remove();
  }

  function ensureStartupGate() {
    let gate = document.getElementById(STARTUP_GATE_ID);
    if (gate) return gate;

    gate = document.createElement('div');
    gate.id = STARTUP_GATE_ID;
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-label', 'Local save folder startup choice');
    Object.assign(gate.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      boxSizing: 'border-box',
      background: 'rgba(7, 10, 13, 0.82)',
      backdropFilter: 'blur(3px)',
      WebkitBackdropFilter: 'blur(3px)',
      fontFamily: '"Pixelify Sans", system-ui, sans-serif',
    });
    document.body.appendChild(gate);
    return gate;
  }

  function renderStartupChecking() {
    const gate = ensureStartupGate();
    gate.innerHTML = `
      <div style="width:min(520px,94vw);padding:22px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:#151b20;color:#eef3f6;box-shadow:0 18px 60px rgba(0,0,0,.5);">
        <div style="font-size:21px;font-weight:700;margin-bottom:8px;">💾 Local Save Folder</div>
        <div style="font-size:14px;line-height:1.45;color:#bac6cd;">Checking your remembered save folder before showing farmers and worlds…</div>
      </div>`;
  }

  function setStartupBusy(label) {
    const gate = ensureStartupGate();
    gate.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const status = gate.querySelector('[data-local-save-gate-status]');
    if (status) status.textContent = label;
  }

  function renderStartupChoice(status, errorMessage = '') {
    const gate = ensureStartupGate();
    const folderName = status.folderName || 'your local save folder';
    const needsReconnect = status.state === 'needs-permission' || status.state === 'error';
    const primaryLabel = needsReconnect ? 'Reconnect & Load' : 'Load From Folder';
    const detail = needsReconnect
      ? `Reconnect to “${esc(folderName)}” and load it before choosing a farmer or world?`
      : `Load “${esc(folderName)}” before choosing a farmer or world?`;
    const errorHtml = errorMessage
      ? `<div style="margin-top:10px;padding:9px 10px;border-radius:7px;background:rgba(180,60,60,.18);color:#ffb8b8;font-size:12px;line-height:1.4;">${esc(errorMessage)}</div>`
      : '';

    gate.innerHTML = `
      <div style="width:min(560px,94vw);padding:22px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:#151b20;color:#eef3f6;box-shadow:0 18px 60px rgba(0,0,0,.5);">
        <div style="font-size:22px;font-weight:700;margin-bottom:7px;">💾 Local Save Folder</div>
        <div style="font-size:14px;line-height:1.5;color:#c2cdd3;">${detail}</div>
        <div style="font-size:12px;line-height:1.45;color:#8697a1;margin-top:8px;">Folder loading happens before save selection so the farmer, world, livestock, and physical farm layout all come from the same source.</div>
        ${errorHtml}
        <div data-local-save-gate-status style="min-height:18px;margin-top:10px;font-size:12px;color:#9fb1bb;"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin-top:8px;">
          <button type="button" id="localSaveStartupBrowser" style="border:1px solid #64737b;border-radius:7px;background:#273138;color:#e5ecef;padding:9px 13px;font:inherit;cursor:pointer;">Use Browser Save</button>
          <button type="button" id="localSaveStartupLoad" style="border:1px solid #89b892;border-radius:7px;background:#31583a;color:#f2fff4;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer;">${primaryLabel}</button>
        </div>
      </div>`;

    gate.querySelector('#localSaveStartupBrowser')?.addEventListener('click', () => {
      _startupResolved = true;
      removeStartupGate();
    });

    gate.querySelector('#localSaveStartupLoad')?.addEventListener('click', async () => {
      const localSave = api();
      if (!localSave) return;
      try {
        setStartupBusy(needsReconnect ? 'Reconnecting…' : 'Loading folder…');
        let current = localSave.getStatus();
        if (current.state !== 'ready') {
          current = await localSave.reconnect();
          if (current.state !== 'ready') {
            renderStartupChoice(current, 'Folder permission was not granted. Nothing was loaded or overwritten.');
            return;
          }
          setStartupBusy('Loading folder…');
        }

        const result = await localSave.loadFromFolder();
        if (!result?.ok) {
          renderStartupChoice(localSave.getStatus(), result?.message || 'The folder could not be loaded.');
          return;
        }

        // Onboarding has already initialized its in-memory save-select model by
        // the time DOMContentLoaded fires, so reload once after import. The
        // one-shot marker prevents the startup gate from immediately asking the
        // same question again on that reload.
        sessionStorage.setItem(SKIP_STARTUP_ONCE_KEY, 'loaded');
        location.reload();
      } catch (error) {
        renderStartupChoice(localSave.getStatus(), String(error?.message || error));
      }
    });
  }

  async function evaluateStartupGate(status) {
    if (!_domReady || _startupResolved) return;
    const localSave = api();
    if (!localSave) {
      _startupResolved = true;
      removeStartupGate();
      return;
    }

    const skipReason = sessionStorage.getItem(SKIP_STARTUP_ONCE_KEY);
    if (skipReason) {
      sessionStorage.removeItem(SKIP_STARTUP_ONCE_KEY);
      _startupResolved = true;
      removeStartupGate();

      // A just-loaded folder and the browser now match. Re-arm normal autosync
      // without asking again or changing save direction.
      if (skipReason === 'loaded' && localSave.getStatus().state === 'ready') {
        localSave.syncNow().catch?.(() => {});
      }
      return;
    }

    if (!localSave.isSupported()) {
      _startupResolved = true;
      removeStartupGate();
      return;
    }

    const current = status || localSave.getStatus();

    // `unsupported` is also the core module's initial sentinel state while its
    // asynchronous IndexedDB handle lookup is still in flight. Since support is
    // known true here, keep blocking save selection until the first real state.
    if (current.state === 'unsupported') {
      renderStartupChecking();
      return;
    }

    if (!current.folderName && current.state === 'not-configured') {
      _startupResolved = true;
      removeStartupGate();
      return;
    }

    if (!current.folderName && current.state === 'error') {
      _startupResolved = true;
      removeStartupGate();
      return;
    }

    renderStartupChoice(current, current.state === 'error' ? (current.lastError || 'Could not inspect the remembered folder.') : '');
  }

  async function quitToSaveSelection(button) {
    const localSave = api();
    if (!localSave) {
      location.reload();
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = '…';

    try {
      let status = localSave.getStatus();
      const folderLabel = status.folderName ? `“${status.folderName}”` : 'a local save folder';
      const wantsFolderSave = status.folderName
        ? confirm(`Save to ${folderLabel} before quitting to save selection?`)
        : confirm('Choose a local save folder and save before quitting to save selection?');

      if (wantsFolderSave) {
        if (!localSave.isSupported()) {
          alert('Local save folders are not supported in this browser, so the game was not quit.');
          return;
        }

        if (status.state !== 'ready') {
          status = status.folderName ? await localSave.reconnect() : await localSave.chooseFolder();
        }
        if (status.state !== 'ready') {
          // Picker cancellation / denied permission means the requested save did
          // not happen, so stay in-game rather than silently quitting anyway.
          return;
        }

        const savedStatus = await localSave.syncNow();
        if (savedStatus.lastError) {
          alert('Could not save to the local folder, so the game was not quit:\n' + savedStatus.lastError);
          return;
        }
      } else if (status.state === 'ready' && status.autoSyncArmed) {
        // `beforeunload` normally performs a best-effort autosave. Explicitly
        // disarm it when the player answered No so that No really means no
        // folder write on this quit. reconnect() is non-destructive and, with
        // already-granted permission, does not prompt again.
        await localSave.reconnect();
      }

      location.reload();
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function installQuitButton() {
    if (document.getElementById(QUIT_BUTTON_ID)) return;
    const controls = document.querySelector('#menuPanel .mp-ctrls');
    if (!controls) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = QUIT_BUTTON_ID;
    button.className = 'mp-ctrl-btn danger';
    button.title = 'Quit to save selection';
    button.setAttribute('aria-label', 'Quit to save selection');
    button.textContent = '🚪 Quit';
    Object.assign(button.style, {
      width: 'auto',
      minWidth: '72px',
      padding: '0 9px',
      whiteSpace: 'nowrap',
    });
    button.addEventListener('click', () => quitToSaveSelection(button));

    const closeButton = controls.querySelector('#mpClose');
    controls.insertBefore(button, closeButton || null);
  }

  const localSave = api();
  localSave?.onChange(status => evaluateStartupGate(status));

  document.addEventListener('DOMContentLoaded', () => {
    _domReady = true;
    installQuitButton();
    evaluateStartupGate(localSave?.getStatus());
  }, { once: true });
})();
