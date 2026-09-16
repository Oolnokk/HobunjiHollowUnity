// Folder Save Quit Guard — replaces the legacy Quit click path in capture phase.
// Live gameplay is persisted first, then the primary folder is written, then the
// page may reload. This prevents a perfectly-successful folder sync of stale RAM.
(() => {
  'use strict';

  if (window.FolderSaveQuitGuard) return;

  const QUIT_BUTTON_ID = 'menuQuitBtn'; // Existing menu Quit button intercepted before local-save-flow's bubble listener.
  const RESET_BUTTON_ID = 'menuResetBtn'; // Legacy one-click farm reset control kept inert and hidden so it cannot be triggered accidentally.
  const MENU_CONTROL_LABELS = Object.freeze([ // Visible labels applied to the icon-only menu controls, including buttons installed later by checkpoint code.
    { id: 'menuPauseBtn', text: '⏯ Pause / Resume', minWidth: '112px' },
    { id: 'menuManualSaveBtn', text: '💾 Manual Save', minWidth: '104px' },
    { id: 'menuRecoveryBtn', text: '🛟 Recovery', minWidth: '90px' },
    { id: 'mpClose', text: '✕ Close', minWidth: '72px' },
  ]);
  let busy = false; // Prevents double-clicks from starting overlapping runtime/folder saves.
  let quitAttempts = 0; // Mobile-visible count of guarded quit attempts.
  let successfulFolderFlushes = 0; // Mobile-visible count of folder writes completed before a quit reload.
  let lastError = ''; // Mobile-visible latest guarded-quit error.
  let menuControlsObserver = null; // Watches the menu because Manual Save and Recovery are injected after initial markup.

  function localSave() {
    return window.LocalSaveFolder || null;
  }

  function setBusy(button, value, label = 'Saving…') {
    if (!button) return;
    if (!button.dataset.folderQuitLabel) button.dataset.folderQuitLabel = button.textContent || '🚪 Quit';
    button.disabled = value;
    button.textContent = value ? label : button.dataset.folderQuitLabel;
  }

  function disableFarmResetControl() {
    if (typeof document?.getElementById !== 'function') return false;
    const resetButton = document.getElementById(RESET_BUTTON_ID); // Existing reset node stays in the DOM for legacy code that expects the element to exist.
    if (!resetButton) return false;
    resetButton.disabled = true;
    resetButton.hidden = true;
    resetButton.tabIndex = -1;
    resetButton.style.display = 'none';
    resetButton.setAttribute('aria-hidden', 'true');
    resetButton.setAttribute('data-farm-reset-disabled', 'true');
    return true;
  }

  function labelMenuControls() {
    if (typeof document?.querySelector !== 'function' || typeof document?.getElementById !== 'function') return false;
    const controls = document.querySelector('#menuPanel .mp-ctrls'); // Control-row parent is also adjusted so the now-readable buttons can wrap instead of overlapping tabs.
    if (!controls) return false;
    controls.style.flexWrap = 'wrap';
    controls.style.justifyContent = 'flex-end';

    for (const spec of MENU_CONTROL_LABELS) { // Each spec keeps one menu action readable without changing its existing click handler or id.
      const button = document.getElementById(spec.id); // Existing button may be static markup or dynamically installed by the checkpoint manager.
      if (!button) continue;
      if (button.textContent !== spec.text) button.textContent = spec.text;
      button.style.width = 'auto';
      button.style.minWidth = spec.minWidth;
      button.style.padding = '0 9px';
      button.style.whiteSpace = 'nowrap';
    }

    disableFarmResetControl();
    return true;
  }

  function installMenuSafetyUi() {
    if (typeof document?.querySelector !== 'function' || typeof document?.getElementById !== 'function') return false;
    labelMenuControls();
    if (menuControlsObserver || typeof MutationObserver !== 'function') return true;
    const menuPanel = document.getElementById('menuPanel'); // Narrow observation root catches late Manual Save/Recovery insertion and pause-icon rewrites.
    if (!menuPanel) return false;
    menuControlsObserver = new MutationObserver(() => { labelMenuControls(); });
    menuControlsObserver.observe(menuPanel, { childList: true, subtree: true });
    return true;
  }

  async function ensurePrimaryFolderReady(button) {
    const save = localSave();
    if (!save?.isSupported?.()) return { ok: true, fallbackOnly: true };

    let status = save.getStatus();
    if (!status.folderName) {
      const choose = confirm('No Primary Save Folder is connected. Choose one before quitting?\n\nCancel keeps you in the game.');
      if (!choose) return { ok: false, cancelled: true };
      setBusy(button, true, 'Choosing Folder…');
      status = await save.chooseFolder();
    } else if (status.state !== 'ready') {
      // Do permission work before the runtime-save await so this remains directly
      // associated with the user's Quit gesture in browsers that gate requests.
      setBusy(button, true, 'Reconnecting…');
      status = await save.reconnect();
    }

    if (status.state !== 'ready') {
      return {
        ok: false,
        error: status.lastError || 'Primary save folder permission was not granted.',
      };
    }
    return { ok: true, fallbackOnly: false };
  }

  async function flushRuntimeOrStop() {
    const runtime = window.HobunjiRuntimeSave; // Canonical live-game flush bridge installed before gameplay modules initialize.
    if (!runtime?.flushNow) return { ok: false, error: 'The live save bridge is unavailable; quitting was stopped to avoid copying stale save data.' };
    const result = runtime.flushNow({ reason: 'quit-to-save-selection' });
    if (!result?.ok || !result.captured) {
      return {
        ok: false,
        error: result?.error || 'The current gameplay state could not be written to the browser save.',
      };
    }
    return { ok: true };
  }

  async function flushFolderOrStop() {
    const save = localSave();
    if (!save || !save.getStatus().folderName) return { ok: true, fallbackOnly: true };

    let status = await save.syncNow();
    if (status.dataLossRisk) {
      const overwrite = confirm(
        `Warning: this browser save ${status.dataLossRisk}.\n\n` +
        'Overwrite the Primary Save Folder anyway?'
      );
      if (!overwrite) return { ok: false, cancelled: true };
      status = await save.syncNow({ force: true });
    }
    if (status.lastError) return { ok: false, error: status.lastError };
    successfulFolderFlushes++;
    return { ok: true, fallbackOnly: false };
  }

  async function guardedQuit(button) {
    if (busy) return;
    busy = true;
    quitAttempts++;
    lastError = '';
    setBusy(button, true);

    try {
      const folderReady = await ensurePrimaryFolderReady(button);
      if (!folderReady.ok) {
        if (folderReady.error) alert('Could not prepare the Primary Save Folder, so the game was not quit:\n' + folderReady.error);
        return;
      }

      setBusy(button, true, 'Saving Game…');
      const runtimeSaved = await flushRuntimeOrStop();
      if (!runtimeSaved.ok) {
        lastError = runtimeSaved.error;
        alert('The current game was not safely saved, so the game was not quit:\n' + lastError);
        return;
      }

      if (!folderReady.fallbackOnly) {
        setBusy(button, true, 'Saving Folder…');
        const folderSaved = await flushFolderOrStop();
        if (!folderSaved.ok) {
          if (folderSaved.cancelled) {
            alert('The Primary Save Folder was not overwritten, so the game was not quit.');
          } else {
            lastError = folderSaved.error || 'Unknown folder-save error.';
            alert('Could not save the Primary Save Folder, so the game was not quit:\n' + lastError);
          }
          return;
        }
      }

      setBusy(button, true, 'Opening Saves…');
      location.reload();
    } catch (error) {
      lastError = String(error?.message || error);
      alert('Could not safely quit:\n' + lastError);
    } finally {
      busy = false;
      setBusy(button, false);
    }
  }

  document.addEventListener('click', event => {
    const resetButton = event.target?.closest?.(`#${RESET_BUTTON_ID}`); // Capture-phase guard blocks any legacy click path even if another script unhides the reset node.
    if (!resetButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('click', event => {
    const button = event.target?.closest?.(`#${QUIT_BUTTON_ID}`);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    guardedQuit(button);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installMenuSafetyUi, { once: true });
  } else {
    installMenuSafetyUi();
  }

  // A browser refresh/close that bypasses the menu cannot await folder I/O,
  // but the live localStorage snapshot itself is synchronous. Capture phase on
  // window runs before the core module's normal beforeunload folder-sync handler,
  // giving that best-effort folder write the freshest possible browser state.
  window.addEventListener('beforeunload', () => {
    window.HobunjiRuntimeSave?.flushNow?.({ reason: 'beforeunload' });
  }, { capture: true });

  window.FolderSaveQuitGuard = { guardedQuit, labelMenuControls, disableFarmResetControl };
  window.__hobunjiFolderSaveQuitDebug = {
    snapshot: () => ({
      busy,
      quitAttempts,
      successfulFolderFlushes,
      lastError: lastError || null,
      farmResetDisabled: typeof document?.getElementById === 'function' && document.getElementById(RESET_BUTTON_ID)?.disabled === true,
      labeledMenuButtons: typeof document?.getElementById === 'function'
        ? MENU_CONTROL_LABELS.filter(spec => document.getElementById(spec.id)?.textContent === spec.text).length
        : 0,
    }),
  };
})();
