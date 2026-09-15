// Google Drive Link Safety — ensures every Picker comparison sees the newest
// browser save and that a newly-selected file can never inherit another Drive
// file's last-common reconciliation baseline.
(() => {
  'use strict';

  const drive = window.HobunjiGoogleDriveSave; // Existing frozen transport API is wrapped by replacing only the global API object, not mutating the transport itself.
  if (!drive?.linkExistingFile || window.HobunjiGoogleDriveLinkSafety) return;

  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used only to detect the unsafe IndexedDB-unavailable + existing browser-save edge case.
  const TARGET_ID = 'drive'; // Durable store namespace whose baseline/conflict belongs to exactly one currently linked Drive file id.
  const rawLinkExistingFile = drive.linkExistingFile.bind(drive); // Original Picker/download/reconciliation implementation retained after local recapture.
  let captures = 0; // Mobile-readable count of first-link browser recaptures attempted.
  let captureFailures = 0; // Count of safety failures that prevented an ambiguous link from proceeding.
  let fileIdentityChanges = 0; // Count of Picker links that selected a different Drive file id than the previously remembered one.
  let decisionsRecomputed = 0; // Count of link decisions recomputed after clearing an inapplicable prior-file baseline.
  let preservedAmbiguousLinks = 0; // Count of first-link/different-file branch pairs immediately copied into durable conflict storage.
  let lastCaptureHash = null; // Latest durable local hash established before Picker comparison.
  let lastLinkedFileId = null; // Latest selected Drive file id after identity-safe reconciliation.
  let lastError = ''; // Latest safety-layer error visible in diagnostics.

  function storeApi() { return window.HobunjiSaveSyncStore || null; }
  function reconciliationApi() { return window.HobunjiSaveReconciliation || null; }

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

  async function preserveAmbiguousLink(decision, localEnvelope, remoteEnvelope, remoteMetadata) {
    const state = String(decision?.state || '');
    if (!localEnvelope?.contentHash || !remoteEnvelope?.contentHash) return;
    if (state !== 'first-link-needs-direction' && state !== 'conflict') return;
    await storeApi()?.setConflict?.(TARGET_ID, {
      kind: 'drive-link-divergence',
      detectedAt: Date.now(),
      baselineContentHash: null,
      local: localEnvelope,
      external: remoteEnvelope,
      remoteMetadata: remoteMetadata || null,
      decision: state,
    }); // A crash/reload immediately after Picker selection still leaves both complete branches durably represented.
    preservedAmbiguousLinks++;
  }

  async function safeLinkExistingFile(...args) {
    await captureBrowserSaveBeforeLink(); // Must finish before Picker result is reconciled against store.getCurrentEnvelope().
    const store = storeApi(); // Link/baseline state captured before Picker so a different selected file can be identified afterward.
    const priorLink = await store?.getLink?.(TARGET_ID) || null;
    const priorFileId = priorLink?.fileId || drive.getStatus?.().fileId || null;

    const result = await rawLinkExistingFile(...args); // Reads/validates selected file but never overwrites either branch by itself.
    if (!result?.ok || result?.cancelled) return result;

    const nextFileId = result?.link?.fileId || result?.metadata?.id || null;
    lastLinkedFileId = nextFileId;
    const localEnvelope = await store?.getCurrentEnvelope?.() || null; // Freshly recaptured local authority used for any corrected decision/conflict record.
    let decision = result?.decision || null;

    if (nextFileId && priorFileId !== nextFileId) {
      fileIdentityChanges++;
      // A last-common hash is meaningful only for the exact external object it
      // described. Switching file ids makes the previous baseline/conflict
      // inapplicable even when both happen to have nearby Drive versions.
      await store?.setBaseline?.(TARGET_ID, null);
      await store?.setConflict?.(TARGET_ID, null);
      decision = reconciliationApi()?.decide?.({
        localEnvelope,
        externalEnvelope: result.remoteEnvelope || null,
        baselineContentHash: null,
      }) || decision;
      decisionsRecomputed++;
      await store?.appendEvent?.('DRIVE LINK FILE ID CHANGED', {
        previousFileId: priorFileId || null,
        nextFileId,
        decision: decision?.state || null,
      });
    }

    await preserveAmbiguousLink(decision, localEnvelope, result.remoteEnvelope, result.metadata);
    lastError = '';
    return { ...result, decision, fileIdentityChanged: Boolean(nextFileId && priorFileId !== nextFileId) };
  }

  const wrapped = Object.freeze({
    ...drive,
    linkExistingFile: safeLinkExistingFile,
  }); // All transport functions/status subscriptions are preserved; only exact-file linking gets the additional safety preconditions.
  window.HobunjiGoogleDriveSave = wrapped;

  window.HobunjiGoogleDriveLinkSafety = Object.freeze({ captureBrowserSaveBeforeLink });
  window.__hobunjiGoogleDriveLinkSafetyDebug = {
    snapshot: () => ({
      captures,
      captureFailures,
      fileIdentityChanges,
      decisionsRecomputed,
      preservedAmbiguousLinks,
      lastCaptureHash,
      lastLinkedFileId,
      lastError: lastError || null,
    }),
  };
})();
