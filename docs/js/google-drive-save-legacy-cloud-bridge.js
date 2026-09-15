// Google Drive Legacy Cloud Bridge — during migration, captures the existing
// onboarding/fresh-browser "Cloud Save" controls before Netlify handlers fire
// and routes them through the canonical Google Drive restore flow instead.
(() => {
  'use strict';

  if (window.HobunjiGoogleDriveLegacyCloudBridge) return;

  const CLOUD_BUTTON_SELECTOR = '#hobunjiEmptySaveCloud, #slSourceCloud'; // Existing restore controls reused so the large onboarding core does not need a migration-specific fork.
  let restoreAttempts = 0; // Mobile-readable count of restore/link gestures routed to Drive.
  let successfulRestores = 0; // Count of Drive branches safely applied before gameplay.
  let ambiguousLinks = 0; // Count of first-link/conflict cases preserved for explicit resolution.
  let lastDecision = null; // Latest reconciliation decision returned by the Drive transport.
  let lastError = ''; // Latest migration-bridge error visible in Save Diagnostics.
  let relabelCount = 0; // Count of legacy Cloud labels replaced with Google Drive wording.
  let relabelScheduled = false; // Coalesces onboarding DOM rebuilds into one label pass per animation frame.

  function driveApi() { return window.HobunjiGoogleDriveSave || null; }

  function configuredDrive() {
    const drive = driveApi(); // Transport status is synchronous and contains no secret token value.
    const status = drive?.getStatus?.();
    if (!drive || !status?.configured) {
      throw new Error('Google Drive Save is not configured in this build yet. Add the public OAuth client ID, browser API key, and Google Cloud project number first.');
    }
    return drive;
  }

  async function refreshSaveSelection() {
    if (window.FolderSaveOnboarding?.refreshFromStorage) {
      await window.FolderSaveOnboarding.refreshFromStorage(); // Rebuild pre-game save cards directly from the newly applied browser cache.
      return;
    }
    location.reload(); // Compatibility fallback only when the in-place onboarding bridge has not initialized.
  }

  async function applyDriveBranch(drive) {
    if (window.__hobunjiGameStarted === true) throw new Error('Return to save selection before loading a Google Drive save. A running world is never hot-replaced.');
    const pulled = await drive.useDriveVersion(); // Transport re-downloads, validates the envelope/hash, applies browser cache, and establishes the common baseline.
    successfulRestores++;
    lastError = '';
    if (pulled?.changed) await refreshSaveSelection();
    return pulled;
  }

  async function restoreFromDrive() {
    restoreAttempts++;
    lastError = '';
    const drive = configuredDrive(); // Picker/OAuth remain inside the user click gesture that invoked this function.
    const linked = await drive.linkExistingFile(); // Exact-file Picker grant is the first-use mobile restore path.
    if (!linked?.ok || linked?.cancelled) return linked;

    const decision = linked.decision || null; // First link never chooses a winner solely from timestamps/revisions.
    lastDecision = decision;
    const state = String(decision?.state || '');

    if (state === 'external-only-no-baseline' || state === 'local-missing' || state === 'external-only-change') {
      return applyDriveBranch(drive); // No competing local change exists, so the explicit Restore-from-Drive gesture can safely load the selected remote branch.
    }

    if (state === 'identical') {
      const synced = await drive.syncPending({ interactive: true }); // Matching content establishes/refreshes the common baseline without replacing gameplay state.
      lastDecision = synced?.decision || decision;
      await refreshSaveSelection();
      return synced;
    }

    if (state === 'first-link-needs-direction' || state === 'conflict') {
      ambiguousLinks++;
      const loadDrive = confirm(
        'This device and the selected Google Drive save are different. Neither has been overwritten.\n\n' +
        'Load the Google Drive version on this device now?\n\n' +
        'OK = load Drive. Cancel = keep both unchanged and choose later in Google Drive Save settings.'
      ); // Explicit direction only; cancel preserves both branches and the remembered Drive link for Settings resolution.
      if (loadDrive) return applyDriveBranch(drive);
      return { ok: false, needsResolution: true, decision, linked: true };
    }

    if (state === 'local-only-change' || state === 'local-only-no-baseline') {
      ambiguousLinks++;
      alert('The selected Google Drive file is linked, but this device contains a different/newer local branch. Nothing was overwritten. Use Google Drive Save settings to choose “Use This Device” or “Use Drive Save.”');
      return { ok: false, needsResolution: true, decision, linked: true };
    }

    ambiguousLinks++;
    alert(`The selected Google Drive save is linked but needs explicit resolution (${state || 'unknown state'}). Nothing was overwritten.`);
    return { ok: false, needsResolution: true, decision, linked: true };
  }

  function relabelLegacyCloudButtons() {
    relabelScheduled = false;
    for (const button of document.querySelectorAll(CLOUD_BUTTON_SELECTOR)) {
      if (button.textContent !== '☁ Google Drive') {
        button.textContent = '☁ Google Drive'; // Existing DOM ids/listeners remain intact; capture routing below prevents old Netlify handlers from receiving the gesture.
        button.title = 'Restore or link the canonical Hobunji save through Google Drive';
        relabelCount++;
      }
    }
  }

  function scheduleRelabel() {
    if (relabelScheduled) return;
    relabelScheduled = true;
    requestAnimationFrame(relabelLegacyCloudButtons);
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.(CLOUD_BUTTON_SELECTOR);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation(); // Capture phase guarantees legacy Netlify Cloud Save handlers never receive this user-facing restore gesture.
    button.disabled = true;
    const oldLabel = button.textContent;
    button.textContent = 'Opening Drive…';
    restoreFromDrive().catch(error => {
      lastError = String(error?.message || error);
      alert('Google Drive Save:\n' + lastError);
    }).finally(() => {
      button.disabled = false;
      button.textContent = oldLabel === 'Opening Drive…' ? '☁ Google Drive' : oldLabel;
      scheduleRelabel();
    });
  }, true);

  const observer = new MutationObserver(scheduleRelabel); // Onboarding/fresh-save gates rebuild their cards; relabel the existing Cloud control each time.
  const begin = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleRelabel();
  };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });

  window.HobunjiGoogleDriveLegacyCloudBridge = Object.freeze({ restoreFromDrive });
  window.__hobunjiGoogleDriveLegacyCloudBridgeDebug = {
    snapshot: () => ({ restoreAttempts, successfulRestores, ambiguousLinks, lastDecision, lastError: lastError || null, relabelCount }),
  };
})();
