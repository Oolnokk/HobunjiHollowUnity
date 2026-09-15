// Google Drive Save Startup — pre-onboarding reconciliation for browsers that
// cannot use the desktop File System Access folder path. OAuth remains a user gesture.
(() => {
  'use strict';

  if (window.HobunjiGoogleDriveSaveStartup) return;

  const GATE_ID = 'googleDriveSaveStartupGate'; // Blocking pre-save-selection surface shown only for a remembered mobile Drive link.
  const TARGET_ID = 'drive'; // Durable store target shared with the Drive transport.
  let preparePromise = null; // Coalesces repeated onboarding init calls into one startup reconciliation.
  let gateResolve = null; // Resolver for the currently displayed startup gate.
  let lastMode = 'pending'; // Mobile-readable startup outcome.
  let lastDecision = null; // Latest three-way decision made after a Drive preflight.
  let lastError = ''; // Mobile-readable startup error without requiring DevTools.
  let checks = 0; // Count of explicit authorized Drive preflight checks.
  let pulls = 0; // Count of startup Drive branches safely loaded before onboarding.
  let pushes = 0; // Count of startup local-only branches safely uploaded after preflight.

  function driveApi() { return window.HobunjiGoogleDriveSave || null; }
  function storeApi() { return window.HobunjiSaveSyncStore || null; }
  function coordinatorApi() { return window.HobunjiSaveCoordinator || null; }
  function reconciliationApi() { return window.HobunjiSaveReconciliation || null; }
  function folderApi() { return window.LocalSaveFolder || null; }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function removeGate() {
    document.getElementById(GATE_ID)?.remove();
  }

  function finish(mode) {
    lastMode = mode;
    removeGate();
    const resolve = gateResolve; // Current gate promise resolved once; clearing first prevents duplicate button/event completion.
    gateResolve = null;
    resolve?.(mode);
  }

  async function localEnvelopeForComparison() {
    const coordinator = coordinatorApi(); // Browser localStorage may be newer than a prior-session IDB envelope if the page was suspended immediately after a save.
    const committed = await coordinator?.commitCurrent?.({ reason: 'drive-startup-local-capture' }); // Always recapture browser state first; unchanged content reuses the existing revision.
    if (committed?.ok) return committed.envelope;

    if (/No browser save is available/i.test(String(committed?.error || ''))) {
      return await storeApi()?.getCurrentEnvelope?.() || null; // Fresh browser may legitimately have only a previously pulled durable envelope or no local branch at all.
    }
    if (committed?.unavailable) {
      return await storeApi()?.getCurrentEnvelope?.() || null; // IndexedDB-unavailable browser can still explicitly pull Drive into localStorage.
    }
    if (committed?.error) throw new Error(committed.error);
    return await storeApi()?.getCurrentEnvelope?.() || null;
  }

  function gateShell(statusText, detailText, buttonsHtml) {
    removeGate();
    const gate = document.createElement('div'); // Drive-specific startup gate mirrors the existing folder reconnect surface without sharing its DOM id.
    gate.id = GATE_ID;
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-label', 'Reconnect Google Drive save');
    gate.innerHTML = `
      <div class="folder-save-primary-gate-card google-drive-startup-card">
        <div class="folder-save-primary-gate-title">☁ Google Drive Save</div>
        <div class="folder-save-primary-gate-copy">${esc(statusText)}</div>
        <div class="folder-save-primary-gate-status" data-drive-startup-status>${esc(detailText || '')}</div>
        <div class="folder-save-primary-gate-actions">${buttonsHtml}</div>
      </div>`;
    document.body.appendChild(gate);
    return gate;
  }

  function showInitialGate(status) {
    const fileName = status?.fileName || 'hobunji-primary-save.json';
    const gate = gateShell(
      `This browser is linked to “${fileName}”. Authorize Google Drive to check it before farmers and worlds are shown.`,
      'Your durable local save remains available if you are offline or prefer not to connect right now.',
      '<button type="button" class="folder-save-primary-gate-fallback" data-drive-startup-local>Use Local Save Offline</button>' +
      '<button type="button" class="folder-save-primary-gate-main google-drive-startup-main" data-drive-startup-check>Authorize & Check Drive</button>'
    );
    gate.querySelector('[data-drive-startup-local]')?.addEventListener('click', () => finish('local-offline'), { once: true });
    gate.querySelector('[data-drive-startup-check]')?.addEventListener('click', () => authorizedCheck(gate), { once: true });
  }

  function showResolutionGate(decision, localEnvelope) {
    const state = decision?.state || 'needs-resolution';
    const hasLocal = Boolean(localEnvelope?.contentHash);
    const description = state === 'conflict'
      ? 'Both this device and Google Drive changed since their last common save. Neither version was overwritten.'
      : state === 'first-link-needs-direction'
        ? 'This device and Google Drive contain different saves and there is no trusted common baseline yet.'
        : state === 'external-only-no-baseline'
          ? 'Google Drive has a save, but this browser has no trusted common baseline yet.'
          : state === 'local-only-no-baseline'
            ? 'This device has a save, but Google Drive has no trusted common baseline yet.'
            : 'The Drive and local save need an explicit direction before continuing.';
    const localButton = hasLocal
      ? '<button type="button" class="folder-save-primary-gate-fallback" data-drive-startup-use-local>Use This Device</button>'
      : '';
    const gate = gateShell(
      description,
      'Choose explicitly. Timestamps do not decide which save wins.',
      localButton + '<button type="button" class="folder-save-primary-gate-main google-drive-startup-main" data-drive-startup-use-drive>Use Google Drive Save</button>'
    );
    gate.querySelector('[data-drive-startup-use-local]')?.addEventListener('click', async event => {
      setGateBusy(gate, event.currentTarget, 'Saving this device to Drive…');
      try {
        await driveApi().useLocalVersion(); // Explicit resolution authorizes overwriting Drive only after user chooses the local branch.
        pushes++;
        finish('local-chosen');
      } catch (error) {
        showGateError(gate, error);
      }
    });
    gate.querySelector('[data-drive-startup-use-drive]')?.addEventListener('click', async event => {
      setGateBusy(gate, event.currentTarget, 'Loading Drive save…');
      try {
        await driveApi().useDriveVersion(); // Safe before onboarding/gameplay: validated Drive snapshot becomes local authority before UI models initialize.
        pulls++;
        finish('drive-chosen');
      } catch (error) {
        showGateError(gate, error);
      }
    });
  }

  function setGateBusy(gate, button, label) {
    gate?.querySelectorAll('button').forEach(value => { value.disabled = true; });
    const status = gate?.querySelector('[data-drive-startup-status]');
    if (status) status.textContent = label;
    if (button) button.textContent = '…';
  }

  function showGateError(gate, error) {
    lastError = String(error?.message || error);
    const status = gate?.querySelector('[data-drive-startup-status]');
    if (status) status.textContent = lastError;
    gate?.querySelectorAll('button').forEach(value => { value.disabled = false; });
  }

  async function authorizedCheck(gate) {
    const drive = driveApi(); // Explicit button click is the Google OAuth user gesture; no startup/background code requests consent on its own.
    try {
      setGateBusy(gate, gate.querySelector('[data-drive-startup-check]'), 'Authorizing and checking Drive…');
      await drive.requestAccessToken({ interactive: true });
      const remote = await drive.inspectRemote({ interactive: true }); // Hash-verified Drive branch read before any write decision.
      const localEnvelope = await localEnvelopeForComparison();
      const baseline = await storeApi()?.getBaseline?.(TARGET_ID);
      const decision = reconciliationApi()?.decide?.({
        localEnvelope,
        externalEnvelope: remote.envelope,
        baselineContentHash: baseline?.contentHash || null,
      });
      if (!decision) throw new Error('Save reconciliation is unavailable.');
      checks++;
      lastDecision = decision;
      lastError = '';

      if (decision.state === 'identical') {
        await storeApi()?.setBaseline?.(TARGET_ID, remote.envelope); // Matching sides become an explicit common baseline for future three-way comparisons.
        if (localEnvelope) await storeApi()?.clearPending?.(TARGET_ID, { expectedContentHash: localEnvelope.contentHash });
        await storeApi()?.setConflict?.(TARGET_ID, null);
        finish('drive-current');
        return;
      }

      if (decision.state === 'external-only-change') {
        await drive.useDriveVersion(); // Safe automatic pull: only Drive changed from the remembered common baseline and gameplay has not initialized.
        pulls++;
        finish('drive-newer-loaded');
        return;
      }

      if (decision.state === 'local-only-change') {
        const synced = await drive.syncPending({ interactive: true }); // Safe automatic push: remote remained at the trusted common baseline.
        if (!synced?.ok) throw new Error(synced?.status?.lastError || 'Could not sync the local-only save to Drive.');
        pushes++;
        finish('local-newer-synced');
        return;
      }

      showResolutionGate(decision, localEnvelope); // First-link ambiguity/conflict remains explicit; neither timestamp nor revision chooses a winner.
    } catch (error) {
      showGateError(gate, error);
      const localButton = gate?.querySelector('[data-drive-startup-local]');
      if (localButton) localButton.disabled = false; // Network/auth failure never prevents the player choosing their durable local save.
      const checkButton = gate?.querySelector('[data-drive-startup-check]');
      if (checkButton) {
        checkButton.disabled = false;
        checkButton.textContent = 'Try Drive Again';
        checkButton.addEventListener('click', () => authorizedCheck(gate), { once: true });
      }
    }
  }

  async function prepareBeforeOnboarding() {
    if (preparePromise) return preparePromise;
    preparePromise = new Promise(resolve => {
      const folderSupported = Boolean(folderApi()?.isSupported?.()); // Desktop filesystem startup remains authoritative whenever File System Access is actually available.
      const driveStatus = driveApi()?.getStatus?.();
      if (folderSupported) {
        lastMode = 'desktop-folder-capable';
        resolve(lastMode);
        return;
      }
      if (!driveStatus?.configured || !driveStatus?.linked) {
        lastMode = driveStatus?.configured ? 'drive-unlinked' : 'drive-not-configured';
        resolve(lastMode);
        return;
      }
      gateResolve = resolve;
      showInitialGate(driveStatus);
    });
    return preparePromise;
  }

  window.HobunjiGoogleDriveSaveStartup = Object.freeze({ prepareBeforeOnboarding });
  window.__hobunjiGoogleDriveSaveStartupDebug = {
    snapshot: () => ({ lastMode, lastDecision, lastError: lastError || null, checks, pulls, pushes, gateVisible: Boolean(document.getElementById(GATE_ID)) }),
  };
})();
