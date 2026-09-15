// Folder Save V3 Reconciliation — protects the canonical desktop file from
// blind overwrites when Drive-for-Desktop or another process changes it.
// This wrapper stays separate from the V2 core and canonical file adapter.
(() => {
  'use strict';

  const save = window.LocalSaveFolder; // V3-aware filesystem API wrapped after folder-save-v3-canonical.js.
  const canonical = window.FolderSaveV3Canonical; // Stable canonical-file reader used for the mandatory external preflight.
  if (!save?.syncNow || !canonical?.readCanonicalEnvelope || window.FolderSaveV3Reconciliation) return;

  const TARGET_ID = 'folder'; // Durable baseline/conflict target dedicated to the desktop canonical folder file.
  const rawSyncNow = save.syncNow.bind(save); // Existing V3 adapter writer invoked only after this module proves the write direction is safe.
  const rawGetStatus = save.getStatus.bind(save); // Existing combined V2/V3 status retained and augmented with preflight diagnostics.

  let lastDecision = null; // Latest three-way comparison visible in mobile diagnostics.
  let lastExternalHash = null; // Hash observed during the latest valid canonical preflight.
  let lastLocalHash = null; // Durable local hash observed during the latest preflight.
  let lastBaselineHash = null; // Last-common folder hash used for the latest three-way decision.
  let lastError = ''; // Preflight validation/read failure; a corrupt canonical file must never be blindly overwritten.
  let blockedWrites = 0; // Count of external/divergent writes stopped before any filesystem mutation.
  let forcedOverwrites = 0; // Count of explicit force retries that knowingly chose the local branch.
  let safeWrites = 0; // Count of safe/identical/no-canonical sync attempts passed through to the V3 adapter.

  function storeApi() { return window.HobunjiSaveSyncStore || null; }
  function coordinatorApi() { return window.HobunjiSaveCoordinator || null; }
  function reconciliationApi() { return window.HobunjiSaveReconciliation || null; }

  function augmentedStatus(base = rawGetStatus()) {
    return {
      ...base,
      canonicalPreflightDecision: lastDecision?.state || null,
      canonicalPreflightBlocked: Boolean(lastDecision && !lastDecision.safeAutomatic),
      canonicalPreflightError: lastError || null,
    };
  }

  function riskForDecision(decision) {
    const state = String(decision?.state || 'needs-resolution');
    if (state === 'external-only-change') return 'would overwrite a canonical folder save that changed since this browser last shared it';
    if (state === 'conflict') return 'would overwrite divergent canonical folder progress; both this browser and the folder changed since their last common save';
    if (state === 'first-link-needs-direction') return 'would overwrite a different canonical folder save before a trusted common baseline exists';
    if (state === 'external-only-no-baseline') return 'would overwrite a canonical folder save before this browser has established a trusted common baseline';
    if (state === 'local-missing') return 'cannot safely choose a direction because the local canonical save is missing';
    return `cannot safely overwrite the canonical folder save (${state})`;
  }

  async function currentLocalEnvelope() {
    const coordinator = coordinatorApi(); // Latest browser/localStorage state must be durable before it is compared with the external file.
    if (!coordinator?.commitCurrent) throw new Error('Durable save coordinator is unavailable for folder preflight.');
    const result = await coordinator.commitCurrent({ reason: 'folder-v3-preflight' });
    if (!result?.ok) throw new Error(result?.error || 'Could not capture the durable local save before folder preflight.');
    return result.envelope;
  }

  async function rememberUnsafeDecision(decision, localEnvelope, externalEnvelope, baseline) {
    await storeApi()?.setConflict?.(TARGET_ID, {
      kind: 'folder-canonical-divergence',
      detectedAt: Date.now(),
      baselineContentHash: baseline?.contentHash || null,
      local: localEnvelope,
      external: externalEnvelope,
      decision: decision?.state || null,
    }); // Both valid branches remain durable until the user explicitly chooses overwrite/load direction.
  }

  async function preflight({ force = false } = {}) {
    lastError = '';
    let externalEnvelope;
    try {
      externalEnvelope = await canonical.readCanonicalEnvelope({ verifyHash: true }); // Mandatory hash-verified read before overwriting an existing V3 file.
    } catch (error) {
      lastError = `Canonical folder preflight failed: ${String(error?.message || error)}`;
      lastDecision = { state: 'invalid-external', safeAutomatic: false };
      blockedWrites++;
      return { ok: false, invalidExternal: true, risk: 'cannot safely overwrite the canonical folder save because the existing canonical file is invalid or unreadable' };
    }

    if (!externalEnvelope) {
      lastDecision = { state: 'no-canonical-file', safeAutomatic: true };
      lastExternalHash = null;
      lastBaselineHash = null;
      return { ok: true, noCanonical: true };
    }

    const localEnvelope = await currentLocalEnvelope(); // Local branch is captured only after a canonical external file is known to exist.
    const baseline = await storeApi()?.getBaseline?.(TARGET_ID);
    const decision = reconciliationApi()?.decide?.({
      localEnvelope,
      externalEnvelope,
      baselineContentHash: baseline?.contentHash || null,
    });
    if (!decision) throw new Error('Save reconciliation API is unavailable for folder preflight.');

    lastDecision = decision;
    lastLocalHash = localEnvelope?.contentHash || null;
    lastExternalHash = externalEnvelope?.contentHash || null;
    lastBaselineHash = baseline?.contentHash || null;

    if (decision.state === 'identical') {
      await storeApi()?.setBaseline?.(TARGET_ID, externalEnvelope); // Matching sides establish/refresh a trustworthy common baseline.
      await storeApi()?.setConflict?.(TARGET_ID, null);
      return { ok: true, decision, localEnvelope, externalEnvelope };
    }

    if (decision.state === 'local-only-change') {
      return { ok: true, decision, localEnvelope, externalEnvelope };
    }

    await rememberUnsafeDecision(decision, localEnvelope, externalEnvelope, baseline);
    if (force) {
      forcedOverwrites++;
      return { ok: true, forced: true, decision, localEnvelope, externalEnvelope };
    }

    blockedWrites++;
    return { ok: false, decision, localEnvelope, externalEnvelope, risk: riskForDecision(decision) };
  }

  async function syncNow(options = {}) {
    const check = await preflight({ force: !!options?.force });
    if (!check.ok) {
      return augmentedStatus({
        ...rawGetStatus(),
        dataLossRisk: check.risk || 'cannot safely overwrite the canonical folder save',
        lastError: check.invalidExternal ? lastError : rawGetStatus()?.lastError || null,
      }); // Crucially, rawSyncNow is never called, so neither V2 recovery files nor the V3 canonical file are touched.
    }

    const result = await rawSyncNow(options); // Existing V2 guard + V3 read-back verification remain intact beneath the preflight.
    if (!result?.lastError && !result?.dataLossRisk && result?.state === 'ready') {
      safeWrites++;
      const written = await canonical.readCanonicalEnvelope({ verifyHash: true }).catch(() => null); // Confirm final canonical authority before advancing/clearing conflict state.
      if (written) {
        await storeApi()?.setBaseline?.(TARGET_ID, written);
        await storeApi()?.setConflict?.(TARGET_ID, null);
        lastExternalHash = written.contentHash;
        lastLocalHash = written.contentHash;
        lastBaselineHash = written.contentHash;
        lastDecision = { state: check.forced ? 'forced-local-overwrite' : (check.decision?.state || 'canonical-created'), safeAutomatic: !check.forced };
      }
    }
    return augmentedStatus(result);
  }

  save.syncNow = syncNow;
  save.getStatus = () => augmentedStatus();

  window.FolderSaveV3Reconciliation = Object.freeze({ preflight, getStatus: () => augmentedStatus() });
  window.__hobunjiFolderSaveV3ReconciliationDebug = {
    snapshot: () => ({
      decision: lastDecision?.state || null,
      localHash: lastLocalHash,
      externalHash: lastExternalHash,
      baselineHash: lastBaselineHash,
      blockedWrites,
      forcedOverwrites,
      safeWrites,
      lastError: lastError || null,
    }),
  };
})();
