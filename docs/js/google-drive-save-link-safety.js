// Google Drive Link Safety — ensures every first-file Picker comparison sees the
// newest browser save, including legacy/localStorage-only sessions not yet in IDB.
(() => {
  'use strict';

  const drive = window.HobunjiGoogleDriveSave; // Existing frozen transport API is wrapped by replacing only the global API object, not mutating the transport itself.
  if (!drive?.linkExistingFile || window.HobunjiGoogleDriveLinkSafety) return;

  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used only to detect the unsafe IndexedDB-unavailable + existing browser-save edge case.
  const rawLinkExistingFile = drive.linkExistingFile.bind(drive); // Original Picker/download/reconciliation implementation retained after local recapture.
  let captures = 0; // Mobile-readable count of first-link browser recaptures attempted.
  let captureFailures = 0; // Count of safety failures that prevented an ambiguous link from proceeding.
  let lastCaptureHash = null; // Latest durable local hash established before Picker comparison.
  let lastError = ''; // Latest safety-layer error visible in diagnostics.

  function browserSaveExists() {
    try { return Boolean(localStorage.getItem(SAVE_META_KEY)); } catch { return false; }
  }

  async function captureBrowserSaveBeforeLink() {
    const coordinator = window.HobunjiSaveCoordinator; // Same canonical snapshot/envelope path used by Quit, creator, and routine gameplay checkpoints.
    if (!coordinator?.commitCurrent) throw new Error('Durable save coordinator is unavailable before Google Drive linking.');

    captures++;
    const result = await coordinator.commitCurrent({ reason: 'drive-link-local-capture' }); // Unchanged gameplay reuses the current revision, so this is safe to call before every Picker link.
    if (result?.ok) {
      lastCaptureHash = result.envelope?.contentHash || null;
      lastError = '';
      return result.envelope || null;
    }

    const message = String(result?.error || '');
    if (/No browser save is available/i.test(message)) {
      lastCaptureHash = null; // Fresh browser: raw transport may correctly compare Drive against null or an already-pulled durable envelope.
      lastError = '';
      return null;
    }

    if (result?.unavailable && !browserSaveExists()) {
      lastCaptureHash = null; // Truly empty IndexedDB-unsupported browser may still restore Drive directly into localStorage.
      lastError = '';
      return null;
    }

    captureFailures++;
    lastError = result?.unavailable && browserSaveExists()
      ? 'This browser has a local save but durable sync storage is unavailable, so Google Drive linking was stopped rather than treating the local branch as empty.'
      : (message || 'Could not safely capture the local save before Google Drive linking.');
    throw new Error(lastError);
  }

  async function safeLinkExistingFile(...args) {
    await captureBrowserSaveBeforeLink(); // Must finish before Picker result is reconciled against store.getCurrentEnvelope().
    return rawLinkExistingFile(...args);
  }

  const wrapped = Object.freeze({
    ...drive,
    linkExistingFile: safeLinkExistingFile,
  }); // All transport functions/status subscriptions are preserved; only exact-file first-link gets the safety precondition.
  window.HobunjiGoogleDriveSave = wrapped;

  window.HobunjiGoogleDriveLinkSafety = Object.freeze({ captureBrowserSaveBeforeLink });
  window.__hobunjiGoogleDriveLinkSafetyDebug = {
    snapshot: () => ({ captures, captureFailures, lastCaptureHash, lastError: lastError || null }),
  };
})();
