// Folder Save Quit Guard — owns the Quit-to-save-selection control and its safe
// persistence sequence. Live gameplay is persisted first, then committed to the
// durable sync store, then the primary folder is written, then the page may reload.
(() => {
  'use strict';

  if (window.FolderSaveQuitGuard) return;

  const QUIT_BUTTON_ID = 'menuQuitBtn'; // Stable menu Quit control created by this module and intercepted in capture phase below.
  let busy = false; // Prevents double-clicks from starting overlapping runtime/durable/folder saves.
  let quitAttempts = 0; // Mobile-visible count of guarded quit attempts.
  let successfulDurableCommits = 0; // Mobile-visible count of sync-store commits completed before quit reloads.
  let queuedDriveCommits = 0; // Counts durable quit commits atomically marked for later Google Drive upload.
  let durableCommitFallbacks = 0; // Counts IndexedDB-unavailable quits that deliberately retain the legacy localStorage/folder safety path.
  let successfulFolderFlushes = 0; // Mobile-visible count of folder writes completed before a quit reload.
  let lastError = ''; // Mobile-visible latest guarded-quit error.

  function localSave() {
    return window.LocalSaveFolder || null;
  }

  function pendingTransportTargets() {
    const driveStatus = window.HobunjiGoogleDriveSave?.getStatus?.(); // Linked Drive identity is enough to queue; authorization/network work happens separately.
    return driveStatus?.linked ? ['drive'] : [];
  }

  function installQuitButton() {
    if (document.getElementById(QUIT_BUTTON_ID)) return true;
    const controls = document.querySelector('#menuPanel .mp-ctrls'); // Existing menu control strip receives the persistence-owned Quit action.
    if (!controls) return false;

    const button = document.createElement('button'); // Created here so retiring local-save-flow cannot remove the only Quit affordance.
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

    const closeButton = controls.querySelector('#mpClose'); // Quit stays immediately before the existing menu close button as in the retired flow.
    controls.insertBefore(button, closeButton || null);
    return true;
  }

  function setBusy(button, value, label = 'Saving…') {
    if (!button) return;
    if (!button.dataset.folderQuitLabel) button.dataset.folderQuitLabel = button.textContent || '🚪 Quit';
    button.disabled = value;
    button.textContent = value ? label : button.dataset.folderQuitLabel;
  }

  async function ensurePrimaryFolderReady(button) {
    const save = localSave(); // Existing filesystem transport prepared before async save work while the Quit gesture is still active.
    if (!save?.isSupported?.()) return { ok: true, fallbackOnly: true };

    let status = save.getStatus(); // Current folder permission/connection state used to decide whether a picker gesture is needed.
    if (!status.folderName) {
      const choose = confirm('No Primary Save Folder is connected. Choose one before quitting?\n\nCancel keeps you in the game.'); // Existing desktop preference preserved during the Drive migration.
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
    const result = runtime.flushNow({ reason: 'quit-to-save-selection' }); // Synchronous runtime-to-localStorage flush must precede snapshot capture.
    if (!result?.ok || !result.captured) {
      return {
        ok: false,
        error: result?.error || 'The current gameplay state could not be written to the browser save.',
      };
    }
    return { ok: true };
  }

  async function commitDurableOrStop() {
    const coordinator = window.HobunjiSaveCoordinator; // Transport-neutral durable commit layer loaded before folder/Drive transports.
    if (!coordinator?.commitCurrent) {
      return { ok: false, error: 'The durable save coordinator is unavailable.' };
    }
    const pendingTargets = pendingTransportTargets(); // Drive link turns this local commit into a retryable pending upload without performing network work here.
    const result = await coordinator.commitCurrent({ reason: 'quit-to-save-selection', pendingTargets }); // Captures the freshly-flushed browser save and queue marker atomically.
    if (result?.ok) {
      successfulDurableCommits++;
      if (pendingTargets.includes('drive')) queuedDriveCommits++;
      return { ok: true, pendingTargets };
    }
    if (result?.unavailable) {
      // IndexedDB can be unavailable in unusual/private browser contexts. Keep
      // the pre-existing synchronous localStorage + explicit folder behavior
      // rather than turning Quit into an inescapable trap on those browsers.
      durableCommitFallbacks++;
      return { ok: true, fallbackOnly: true, warning: result.error || null };
    }
    return { ok: false, error: result?.error || 'The durable local save could not be committed.' };
  }

  async function flushFolderOrStop() {
    const save = localSave(); // Filesystem transport remains the desktop primary while the canonical bundle migration is being layered in.
    if (!save || !save.getStatus().folderName) return { ok: true, fallbackOnly: true };

    let status = await save.syncNow(); // Existing browser-cache-to-folder write with data-loss protection preserved.
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
      const folderReady = await ensurePrimaryFolderReady(button); // Filesystem permission gesture happens first, but no save data is written yet.
      if (!folderReady.ok) {
        if (folderReady.error) alert('Could not prepare the Primary Save Folder, so the game was not quit:\n' + folderReady.error);
        return;
      }

      setBusy(button, true, 'Saving Game…');
      const runtimeSaved = await flushRuntimeOrStop(); // Step 1: live gameplay state becomes the current browser snapshot.
      if (!runtimeSaved.ok) {
        lastError = runtimeSaved.error;
        alert('The current game was not safely saved, so the game was not quit:\n' + lastError);
        return;
      }

      setBusy(button, true, 'Securing Save…');
      const durableSaved = await commitDurableOrStop(); // Step 2: canonical envelope and any linked-Drive pending marker become durable locally before external work.
      if (!durableSaved.ok) {
        lastError = durableSaved.error;
        alert('The current game could not be committed to durable local save storage, so the game was not quit:\n' + lastError);
        return;
      }

      if (!folderReady.fallbackOnly) {
        setBusy(button, true, 'Saving Folder…');
        const folderSaved = await flushFolderOrStop(); // Step 3: desktop filesystem mirror follows the completed durable local commit.
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
    const button = event.target?.closest?.(`#${QUIT_BUTTON_ID}`); // Persistence-owned Quit control is handled before any unrelated bubble listeners.
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    guardedQuit(button);
  }, true);

  const install = () => installQuitButton(); // Explicit helper used at DOM readiness and exposed for diagnostics/tests.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  // A browser refresh/close that bypasses the menu cannot await IndexedDB or
  // folder I/O, but the live localStorage snapshot itself is synchronous.
  // Capture phase still gives later best-effort transport handlers fresh data.
  window.addEventListener('beforeunload', () => {
    window.HobunjiRuntimeSave?.flushNow?.({ reason: 'beforeunload' });
  }, { capture: true });

  window.FolderSaveQuitGuard = { guardedQuit, installQuitButton };
  window.__hobunjiFolderSaveQuitDebug = {
    snapshot: () => ({
      busy,
      quitButtonPresent: Boolean(document.getElementById(QUIT_BUTTON_ID)),
      quitAttempts,
      successfulDurableCommits,
      queuedDriveCommits,
      durableCommitFallbacks,
      successfulFolderFlushes,
      lastError: lastError || null,
    }),
  };
})();
