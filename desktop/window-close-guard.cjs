'use strict';

// Electron main-process shutdown guard. Native dialogs remain available even if
// the sandboxed renderer is hung; an unsaved exit always requires explicit consent.
const DEFAULT_SAVE_STALL_MS = 12000; // Time before offering native recovery options for a stalled final save.

function createWindowCloseGuard({
  win, dialog, saveBeforeClose, authorizeClose,
  forceClose = () => win.destroy(),
  setTimer = setTimeout, clearTimer = clearTimeout,
  stallMs = DEFAULT_SAVE_STALL_MS, logger = console,
}) {
  let closeRequested = false; // Tracks whether a pending save should automatically close the game once it finishes.
  let saving = false; // Prevents multiple simultaneous final saves and corrupt concurrent folder writes.
  let promptTask = null; // Deduplicates native dialogs when the titlebar X is clicked repeatedly.
  let watchdog = null; // Can be cleared on completion, cancellation, or a deliberate forced exit.
  let closing = false; // No new save or dialog is allowed once an approved close has started.
  let lastAction = 'idle'; // Exposed through Shutdown Status without needing the renderer or DevTools.
  let lastError = ''; // The last failed close operation remains inspectable after Cancel.
  let saveStartedAt = 0; // The main process clock determines how long a save has been pending.
  let closeEpoch = 0; // Increments whenever a new close request follows Cancel; separates old from new save intent.
  let activeSaveEpoch = 0; // Captures the epoch at the start of each final save so stale results cannot authorize closing.

  function stillOpen() { return !closing && !win.isDestroyed(); }

  function clearWatchdog() {
    if (watchdog !== null) clearTimer(watchdog);
    watchdog = null;
  }

  function finishNormalClose() {
    if (!stillOpen()) return;
    closing = true;
    closeRequested = false;
    lastAction = 'saved-and-closing';
    clearWatchdog();
    authorizeClose(); // The ordinary BrowserWindow close event must not intercept this approved exit again.
    win.close();
  }

  function finishExplicitUnsafeClose() {
    if (!stillOpen()) return;
    closing = true;
    closeRequested = false;
    lastAction = 'user-chose-quit-without-saving';
    clearWatchdog();
    authorizeClose();
    forceClose(); // destroy() avoids another renderer beforeunload/unresponsive round trip.
  }

  function showPrompt(type, options, onResponse) {
    if (promptTask || !stillOpen()) return promptTask;
    const task = (async () => {
      try {
        const { response } = await dialog.showMessageBox(win, options);
        if (stillOpen()) await onResponse(response);
      } catch (error) {
        lastError = String(error?.message || error);
        lastAction = type + '-dialog-error';
        logger.error?.('[Hobunji desktop] Could not show shutdown dialog', error);
        closeRequested = false; // Fail safely: never silently destroy a window when the dialog fails.
      }
    })();
    promptTask = task; // Other close requests share this one native dialog instead of stacking prompts.
    void task.finally(() => { if (promptTask === task) promptTask = null; });
    return task;
  }

  function armWatchdog() {
    clearWatchdog();
    if (!saving || !closeRequested || !stillOpen()) return;
    watchdog = setTimer(() => {
      watchdog = null;
      if (saving && closeRequested && stillOpen()) void showStalledSavePrompt();
    }, stallMs);
  }

  function showStalledSavePrompt() {
    if (promptTask || !stillOpen()) return promptTask;
    clearWatchdog();
    lastAction = 'save-taking-too-long';
    return showPrompt('stall', {
      type: 'warning',
      title: 'Hobunji Hollow — Save is still running',
      message: 'The final save has not finished.',
      detail: 'The game or Google Drive may be unresponsive. You can keep waiting, cancel closing, or explicitly quit without saving.\n\n' +
        'Quit Without Saving immediately terminates the game and may lose recent progress or interrupt a disk write.',
      buttons: ['Keep Waiting', 'Quit Without Saving', 'Cancel Close'],
      defaultId: 0, cancelId: 2, noLink: true,
    }, response => {
      if (response === 1) finishExplicitUnsafeClose();
      else if (response === 2) {
        closeRequested = false; // The in-flight save may finish, but is no longer authorized to close the window.
        lastAction = 'close-cancelled-while-saving';
      } else {
        lastAction = 'still-waiting-for-save';
        armWatchdog();
      }
    });
  }

  async function showFailedSavePrompt(outcome) {
    const reason = String(outcome?.error || 'The game did not confirm a completed save.');
    lastError = reason;
    lastAction = 'final-save-failed';
    let retry = false; // Set by the dialog and acted on only after the native prompt has closed.
    await showPrompt('failure', {
      type: 'error',
      title: 'Hobunji Hollow — Save failed',
      message: 'The game could not finish saving before exit.',
      detail: reason + '\nYour Google Drive folder might not have the latest changes.',
      buttons: ['Retry Save', 'Quit Without Saving', 'Cancel Close'],
      defaultId: 0, cancelId: 2, noLink: true,
    }, response => {
      if (response === 1) finishExplicitUnsafeClose();
      else if (response === 2) {
        closeRequested = false;
        lastAction = 'close-cancelled-after-failed-save';
      } else {
        lastAction = 'retrying-final-save';
        retry = true;
      }
    });
    // Do not retry while promptTask still points to the now-dismissed native dialog.
    if (retry && closeRequested && stillOpen()) requestClose();
  }

  async function runSave() {
    if (saving || !stillOpen()) return;
    saving = true;
    activeSaveEpoch = closeEpoch; // A resumed close after Cancel requires a new snapshot, not a stale in-flight save.
    saveStartedAt = Date.now();
    lastAction = 'saving-before-close';
    lastError = '';
    armWatchdog();
    let outcome;
    try {
      outcome = await saveBeforeClose();
    } catch (error) {
      outcome = { ok: false, error: String(error?.message || error) };
    } finally {
      saving = false;
      clearWatchdog();
    }
    // If the native stalled-save dialog appeared while Chromium was blocked,
    // its explicit Cancel/Quit decision takes priority over an eventual save.
    if (promptTask) await promptTask;
    if (!closeRequested || !stillOpen()) return;
    if (activeSaveEpoch !== closeEpoch) {
      // An earlier attempt was cancelled while its disk write was still running.
      // Serialize a fresh snapshot after that write; never close from the old result.
      void runSave();
      return;
    }
    if (outcome?.ok === true) { finishNormalClose(); return; }
    await showFailedSavePrompt(outcome);
  }

  function requestClose() {
    if (!stillOpen()) return;
    if (!closeRequested) closeEpoch += 1; // A retry after Cancel creates a distinct save/close transaction.
    closeRequested = true;
    if (promptTask) return; // A visible native dialog is already waiting for a decision.
    if (saving) {
      void showStalledSavePrompt(); // A second X click offers a deliberate escape immediately.
      return;
    }
    void runSave();
  }

  function handleClose(event) {
    if (closing || win.isDestroyed()) return;
    event.preventDefault();
    requestClose();
  }

  function requestQuitWithoutSaving() {
    if (!stillOpen() || promptTask) return promptTask;
    return showPrompt('unsafe-quit', {
      type: 'warning',
      title: 'Hobunji Hollow — Quit without saving?',
      message: 'Close the game without saving?',
      detail: 'Recent progress could be lost, and an in-progress Google Drive write may be interrupted.\n' +
        'Use Save and Quit if the game is responsive.',
      buttons: ['Quit Without Saving', 'Cancel'],
      defaultId: 1, cancelId: 1, noLink: true,
    }, response => {
      if (response === 0) finishExplicitUnsafeClose();
      else if (saving && closeRequested && watchdog === null) {
        // A cancelled manual force-quit must not permanently consume the pending save watchdog.
        armWatchdog();
      }
    });
  }

  function getStatus() {
    return {
      lastAction, lastError, saveInProgress: saving, closeRequested,
      dialogOpen: !!promptTask,
      elapsedMs: saving ? Math.max(0, Date.now() - saveStartedAt) : 0,
    }; // Native View → Shutdown Status can inspect a frozen game without renderer APIs.
  }

  return { handleClose, requestClose, requestQuitWithoutSaving, getStatus };
}

module.exports = { DEFAULT_SAVE_STALL_MS, createWindowCloseGuard };
