'use strict';

// Closure-free renderer operation: Electron executes this in the sandboxed game
// window. The same function is called with fake save APIs by Node regression tests.
async function persistBeforeClose(game) {
  const folder = game.LocalSaveFolder; // Existing canonical local-folder save system, not another persistence backend.
  const status = folder?.getStatus?.() || null; // Checked once to distinguish armed sync from a disconnected folder.
  const hasLiveGame = game.__hobunjiGameStarted === true; // Determines whether a live snapshot needs to be captured.

  if (game.HobunjiAutosavePause?.isPaused?.()) {
    return { ok: true, mode: 'paused' }; // Respect the Dev Companion's deliberate save freeze.
  }

  if (status?.state === 'ready' && status.autoSyncArmed) {
    const runtime = game.HobunjiRuntimeSave; // Live serializer must be initialized before the folder writer is allowed to mirror cached state.
    if (hasLiveGame && (runtime?.isReady?.() !== true || typeof runtime.captureSnapshot !== 'function')) {
      return { ok: false, error: 'The live game serializer is not ready; refusing to overwrite the folder with a stale browser snapshot.' };
    }
    if (typeof folder?.syncNow !== 'function') {
      return { ok: false, error: 'The connected save folder does not have an available sync operation.' };
    }
    const result = await folder.syncNow({ reason: 'desktop-window-close' }); // Completion must precede the OS window closing.
    const action = String(result?.lastAction || 'unknown'); // Reports stopped/error writes in the existing core.
    if (!result || result.state !== 'ready' || result.dataLossRisk || /error|blocked|risk/i.test(action)) {
      return { ok: false, error: result?.lastError || result?.dataLossRisk || action };
    }
    return { ok: true, mode: 'folder', action };
  }

  if (hasLiveGame) {
    const runtime = game.HobunjiRuntimeSave; // Canonical live-to-browser fallback used by the existing quit guard.
    if (typeof runtime?.flushNow !== 'function') {
      return { ok: false, error: 'The live game save system is not ready. Retry after it finishes initializing.' };
    }
    const result = await runtime.flushNow({ reason: 'desktop-window-close' });
    if (result?.ok !== true || result.captured !== true) {
      return { ok: false, error: result?.error || 'The live game state was not captured; refusing to close with a stale browser save.' };
    }
    if (status?.folderName) {
      return { ok: false, error: status.state === 'ready'
        ? 'The save folder is connected but automatic synchronization is not armed. Load or save the folder explicitly before exiting.'
        : 'The save folder is disconnected or needs permission; only the browser fallback was saved.' };
    }
  }
  return { ok: true, mode: 'browser' };
}

const CLOSE_SAVE_SCRIPT = '(' + persistBeforeClose.toString() + ')(window)'; // Injects only this pure, sandbox-compatible function.

module.exports = { persistBeforeClose, CLOSE_SAVE_SCRIPT };
