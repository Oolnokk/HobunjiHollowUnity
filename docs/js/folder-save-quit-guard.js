// Folder Save Quit Guard — replaces the legacy Quit click path in capture phase.
// Live gameplay is persisted first, then the primary folder is written, then the
// page may reload. This prevents a perfectly-successful folder sync of stale RAM.
(() => {
  'use strict';

  if (window.FolderSaveQuitGuard) return;

  const QUIT_BUTTON_ID = 'menuQuitBtn'; // Existing menu Quit button intercepted before local-save-flow's bubble listener.
  let busy = false; // Prevents double-clicks from starting overlapping runtime/folder saves.
  let quitAttempts = 0; // Mobile-visible count of guarded quit attempts.
  let successfulFolderFlushes = 0; // Mobile-visible count of folder writes completed before a quit reload.
  let lastError = ''; // Mobile-visible latest guarded-quit error.

  function localSave() {
    return window.LocalSaveFolder || null;
  }

  function setBusy(button, value, label = 'Saving…') {
    if (!button) return;
    if (!button.dataset.folderQuitLabel) button.dataset.folderQuitLabel = button.textContent || '🚪 Quit';
    button.disabled = value;
    button.textContent = value ? label : button.dataset.folderQuitLabel;
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
    const button = event.target?.closest?.(`#${QUIT_BUTTON_ID}`);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    guardedQuit(button);
  }, true);

  // A browser refresh/close that bypasses the menu cannot await folder I/O,
  // but the live localStorage snapshot itself is synchronous. Capture phase on
  // window runs before the core module's normal beforeunload folder-sync handler,
  // giving that best-effort folder write the freshest possible browser state.
  window.addEventListener('beforeunload', () => {
    window.HobunjiRuntimeSave?.flushNow?.({ reason: 'beforeunload' });
  }, { capture: true });

  window.FolderSaveQuitGuard = { guardedQuit };
  window.__hobunjiFolderSaveQuitDebug = {
    snapshot: () => ({ busy, quitAttempts, successfulFolderFlushes, lastError: lastError || null }),
  };
})();
