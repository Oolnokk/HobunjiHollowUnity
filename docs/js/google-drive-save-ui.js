// Google Drive Save UI — mobile-friendly controls layered onto the existing
// persistence Settings panel. Transport/network work remains in the Drive module.
(() => {
  'use strict';

  if (window.HobunjiGoogleDriveSaveUI) return;

  const TITLE_ID = 'googleDriveSaveTitle'; // Settings section title inserted next to the existing folder-save controls.
  const ROW_ID = 'googleDriveSaveRow'; // Stable Drive Settings row used by styling, tests, and mobile diagnostics.
  const STATUS_ID = 'googleDriveSaveStatus'; // Live transport/durable-queue summary visible without DevTools.
  const DETAIL_ID = 'googleDriveSaveDetail'; // Secondary line explaining pending/auth/conflict state.
  const LINK_BUTTON_ID = 'googleDriveSaveLinkBtn'; // Existing canonical-file Picker action.
  const CREATE_BUTTON_ID = 'googleDriveSaveCreateBtn'; // Folder Picker action that creates the app-owned canonical file.
  const SYNC_BUTTON_ID = 'googleDriveSaveSyncBtn'; // Explicit authorization + preflight reconciliation + sync action.
  const USE_LOCAL_BUTTON_ID = 'googleDriveSaveUseLocalBtn'; // Explicit conflict/first-link resolution that overwrites Drive.
  const USE_DRIVE_BUTTON_ID = 'googleDriveSaveUseDriveBtn'; // Explicit safe-selection-time pull of the Drive branch.
  const UNLINK_BUTTON_ID = 'googleDriveSaveUnlinkBtn'; // Removes only remembered Drive identity/baseline/queue metadata.

  let installed = false; // Prevents duplicate row creation while Settings DOM mutations are observed.
  let scheduled = false; // Coalesces transport/DOM changes into one async UI refresh.
  let busy = false; // Serializes explicit Drive UI actions so buttons cannot race each other.
  let lastUiAction = 'none'; // Mobile-readable latest user action from this Settings surface.
  let lastUiError = ''; // Mobile-readable latest UI/action failure.
  let lastDecision = null; // Latest reconciliation decision shown in diagnostics/resolution controls.
  let lastDiagnostics = null; // Cached async sync-store summary used by synchronous debug snapshots.

  function driveApi() {
    return window.HobunjiGoogleDriveSave || null;
  }

  function storeApi() {
    return window.HobunjiSaveSyncStore || null;
  }

  function folderApi() {
    return window.LocalSaveFolder || null;
  }

  function gameIsRunning() {
    return window.__hobunjiGameStarted === true; // Drive pulls must never hot-replace the live in-memory game state.
  }

  function setBusy(value) {
    busy = value;
    const row = document.getElementById(ROW_ID); // Current Settings row whose controls are disabled together during one Drive operation.
    row?.querySelectorAll('button').forEach(button => { button.disabled = value || button.dataset.driveDisabled === 'true'; });
  }

  function makeButton(id, label, className = 'settings-small-btn') {
    const button = document.createElement('button'); // Shared compact Settings button matching existing save controls.
    button.type = 'button';
    button.id = id;
    button.className = className;
    button.textContent = label;
    return button;
  }

  function install() {
    scheduled = false;
    const folderRow = document.getElementById('localSaveFolderRow'); // Existing save row is the stable insertion anchor across current Settings layouts.
    if (!folderRow?.parentNode) return;

    let row = document.getElementById(ROW_ID);
    if (!row) {
      const title = document.createElement('div'); // Drive gets its own section instead of crowding folder controls into one row.
      title.id = TITLE_ID;
      title.className = 'settings-section-title google-drive-save-title';
      title.textContent = 'Google Drive Save';

      row = document.createElement('div');
      row.id = ROW_ID;
      row.className = 'settings-row settings-row--stacked google-drive-save-row';
      row.innerHTML = `
        <div class="settings-label">
          <div class="settings-name">Google Drive Save</div>
          <div class="settings-desc">On phones and other browsers without folder access, sync the same canonical Hobunji save file directly through Google Drive. Local durable saving always completes before network sync.</div>
        </div>
        <div class="google-drive-save-controls">
          <span id="${STATUS_ID}" class="google-drive-save-status" role="status" aria-live="polite"></span>
          <button type="button" id="${LINK_BUTTON_ID}" class="settings-small-btn">Link Existing Save</button>
          <button type="button" id="${CREATE_BUTTON_ID}" class="settings-small-btn">Create in Drive</button>
          <button type="button" id="${SYNC_BUTTON_ID}" class="settings-small-btn">Sync Now</button>
          <button type="button" id="${USE_LOCAL_BUTTON_ID}" class="settings-small-btn google-drive-resolution-btn">Use This Device</button>
          <button type="button" id="${USE_DRIVE_BUTTON_ID}" class="settings-small-btn google-drive-resolution-btn">Use Drive Save</button>
          <button type="button" id="${UNLINK_BUTTON_ID}" class="settings-small-btn google-drive-secondary-btn">Unlink</button>
          <div id="${DETAIL_ID}" class="google-drive-save-detail"></div>
        </div>`;

      const after = folderRow.nextSibling; // Insert immediately after the desktop folder row; legacy Netlify UI may remain below during migration.
      folderRow.parentNode.insertBefore(title, after);
      folderRow.parentNode.insertBefore(row, title.nextSibling);
      bindButtons();
      installed = true;
    }

    refresh().catch(error => {
      lastUiError = String(error?.message || error);
      renderSyncOnly();
    });
  }

  function bindButtons() {
    document.getElementById(LINK_BUTTON_ID)?.addEventListener('click', () => runAction('link-existing', async drive => {
      const result = await drive.linkExistingFile(); // Picker grants exact-file drive.file access; first-link direction remains explicit unless hashes match.
      lastDecision = result?.decision || null;
      if (result?.ok && result?.decision?.state === 'identical') {
        const synced = await drive.syncPending({ interactive: true }); // Safe identical link establishes the last-common baseline without a write.
        lastDecision = synced?.decision || result.decision;
      }
      return result;
    }));

    document.getElementById(CREATE_BUTTON_ID)?.addEventListener('click', () => runAction('create-drive-save', drive => drive.createDriveSave()));
    document.getElementById(SYNC_BUTTON_ID)?.addEventListener('click', () => runAction('sync-now', async drive => {
      const result = await drive.syncPending({ interactive: true }); // User gesture may authorize; mandatory remote preflight still prevents blind overwrite.
      lastDecision = result?.decision || lastDecision;
      return result;
    }));

    document.getElementById(USE_LOCAL_BUTTON_ID)?.addEventListener('click', () => runAction('use-local-version', async drive => {
      if (!confirm('Use this device\'s save and overwrite the linked Google Drive version? The Drive version is preserved in local conflict diagnostics until this operation completes.')) return { cancelled: true };
      const result = await drive.useLocalVersion(); // Explicit user resolution is the only path allowed to overwrite a divergent remote branch.
      lastDecision = null;
      return result;
    }));

    document.getElementById(USE_DRIVE_BUTTON_ID)?.addEventListener('click', () => runAction('use-drive-version', async drive => {
      if (gameIsRunning()) throw new Error('Return to save selection before loading the Google Drive version. A running world is never hot-replaced.');
      if (!confirm('Load the Google Drive save onto this device?')) return { cancelled: true };
      const result = await drive.useDriveVersion(); // Safe only before gameplay; transport validates/hash-checks before applying the snapshot.
      lastDecision = null;
      if (result?.changed) {
        if (window.FolderSaveOnboarding?.refreshFromStorage) await window.FolderSaveOnboarding.refreshFromStorage();
        else location.reload();
      }
      return result;
    }));

    document.getElementById(UNLINK_BUTTON_ID)?.addEventListener('click', () => runAction('unlink', async drive => {
      if (!confirm('Unlink Google Drive from this browser? Your Drive file and local save are not deleted.')) return { cancelled: true };
      lastDecision = null;
      return drive.unlink();
    }));
  }

  async function runAction(name, operation) {
    if (busy) return;
    const drive = driveApi(); // Transport resolved at click time so lazy script initialization order remains tolerant.
    if (!drive) {
      lastUiError = 'Google Drive Save has not initialized.';
      await refresh();
      return;
    }
    busy = true;
    lastUiAction = name;
    lastUiError = '';
    setBusy(true);
    try {
      const result = await operation(drive);
      if (result?.cancelled) lastUiAction = `${name}-cancelled`;
      return result;
    } catch (error) {
      lastUiError = String(error?.message || error);
      alert('Google Drive Save:\n' + lastUiError);
      return null;
    } finally {
      busy = false;
      setBusy(false);
      await refresh();
    }
  }

  function decisionNeedsChoice(state) {
    return new Set([
      'first-link-needs-direction',
      'local-only-no-baseline',
      'external-only-no-baseline',
      'external-only-change',
      'external-missing',
      'local-missing',
      'conflict',
    ]).has(String(state || ''));
  }

  function humanStatus(status, diagnostics) {
    if (!status?.configured) return 'Not configured in this build';
    if (status.busyOperation) return 'Working…';
    if (status.state === 'conflict' || diagnostics?.conflict) return 'Conflict — both versions preserved';
    if (status.state === 'remote-update') return 'Newer/different Drive version available';
    if (status.state === 'needs-resolution') return 'Choose which save to keep';
    if (!status.linked) return 'Not linked';
    if (status.state === 'auth-required') return diagnostics?.pendingHash ? 'Saved locally · Drive authorization needed' : 'Linked · authorization needed';
    if (diagnostics?.pendingHash) return 'Saved locally · Drive sync pending';
    if (status.state === 'ready') return 'Linked and synced';
    return status.state || 'Ready';
  }

  function humanDetail(status, diagnostics) {
    const pieces = [];
    if (status?.linked && status.fileName) pieces.push(status.fileName);
    if (status?.remoteVersion) pieces.push(`Drive version ${status.remoteVersion}`);
    if (diagnostics?.currentRevision != null) pieces.push(`local rev ${diagnostics.currentRevision}`);
    if (diagnostics?.pendingHash) pieces.push('pending upload preserved locally');
    if (diagnostics?.conflict) pieces.push('automatic overwrite blocked');
    if (lastDecision?.state) pieces.push(`decision: ${lastDecision.state}`);
    if (lastUiError) pieces.push(lastUiError);
    if (!status?.configured) pieces.push('Set the public OAuth client ID, browser API key, and Google Cloud project number to enable Drive.');
    if (gameIsRunning() && (diagnostics?.conflict || status?.state === 'remote-update' || status?.state === 'needs-resolution')) {
      pieces.push('Drive pulls are disabled while gameplay is running; return to save selection to load the Drive branch.');
    }
    return pieces.join(' · ');
  }

  function renderSyncOnly() {
    const drive = driveApi();
    const status = drive?.getStatus?.() || { configured: false, state: 'unavailable', linked: false };
    render(status, lastDiagnostics);
  }

  function render(status, diagnostics) {
    const row = document.getElementById(ROW_ID); // Current Drive row styled/promoted according to browser folder capability and Drive availability.
    if (!row) return;
    const folderSupported = Boolean(folderApi()?.isSupported?.()); // Capability detection, not user-agent detection, decides mobile/no-folder prominence.
    const shouldPromoteDrive = !folderSupported && Boolean(status?.configured);
    row.classList.toggle('google-drive-save-primary', shouldPromoteDrive);
    document.getElementById('localSaveFolderRow')?.classList.toggle('folder-save-settings-secondary', shouldPromoteDrive);

    const title = document.getElementById(TITLE_ID); // Section title mirrors promotion so mobile users see the recommended path first visually.
    title?.classList.toggle('google-drive-save-title-primary', shouldPromoteDrive);

    const statusEl = document.getElementById(STATUS_ID);
    if (statusEl) statusEl.textContent = humanStatus(status, diagnostics);
    const detailEl = document.getElementById(DETAIL_ID);
    if (detailEl) detailEl.textContent = humanDetail(status, diagnostics);

    const linked = Boolean(status?.linked);
    const configured = Boolean(status?.configured);
    const choiceState = lastDecision?.state || (diagnostics?.conflict ? 'conflict' : status?.state);
    const needsChoice = decisionNeedsChoice(choiceState);
    const useDriveAllowed = needsChoice && !gameIsRunning();

    const linkBtn = document.getElementById(LINK_BUTTON_ID); // File Picker remains available to switch/relink even after a prior file link.
    if (linkBtn) {
      linkBtn.style.display = configured ? '' : 'none';
      linkBtn.textContent = linked ? 'Link Different Save' : 'Link Existing Save';
    }
    const createBtn = document.getElementById(CREATE_BUTTON_ID); // Create flow remains available for first setup or intentionally choosing another Drive folder.
    if (createBtn) createBtn.style.display = configured && !linked ? '' : 'none';
    const syncBtn = document.getElementById(SYNC_BUTTON_ID);
    if (syncBtn) {
      syncBtn.style.display = configured && linked ? '' : 'none';
      syncBtn.textContent = status?.state === 'auth-required' ? 'Authorize & Sync' : 'Sync Now';
    }
    const localBtn = document.getElementById(USE_LOCAL_BUTTON_ID);
    if (localBtn) localBtn.style.display = configured && linked && needsChoice ? '' : 'none';
    const driveBtn = document.getElementById(USE_DRIVE_BUTTON_ID);
    if (driveBtn) {
      driveBtn.style.display = configured && linked && needsChoice ? '' : 'none';
      driveBtn.dataset.driveDisabled = useDriveAllowed ? 'false' : 'true';
      driveBtn.disabled = busy || !useDriveAllowed;
      driveBtn.title = useDriveAllowed ? 'Replace this device cache with the validated Drive save.' : 'Return to save selection before loading the Drive version.';
    }
    const unlinkBtn = document.getElementById(UNLINK_BUTTON_ID);
    if (unlinkBtn) unlinkBtn.style.display = linked ? '' : 'none';
  }

  async function refresh() {
    const drive = driveApi(); // Status is synchronous; durable queue/conflict diagnostics are read asynchronously from IndexedDB.
    const status = drive?.getStatus?.() || { configured: false, state: 'unavailable', linked: false };
    try { lastDiagnostics = await storeApi()?.diagnostics?.('drive') || null; } catch (error) {
      lastDiagnostics = { error: String(error?.message || error) };
    }
    render(status, lastDiagnostics);
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(install);
  }

  const observer = new MutationObserver(scheduleRefresh); // Settings may be reparented/rebuilt; the Drive row follows the existing folder row automatically.
  const begin = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleRefresh();
  };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });

  driveApi()?.onChange?.(() => refresh().catch(() => {})); // Transport state changes immediately update visible mobile status.
  window.addEventListener('online', () => {
    const drive = driveApi(); // Returning online retries only when an in-memory token still exists; never summons Google UI in the background.
    const status = drive?.getStatus?.();
    if (!status?.linked || !status?.tokenPresent) return;
    storeApi()?.getPending?.('drive').then(pending => {
      if (pending) drive.syncPending({ interactive: false }).catch(() => {}).finally(() => refresh().catch(() => {}));
    }).catch(() => {});
  });

  window.HobunjiGoogleDriveSaveUI = Object.freeze({
    refresh,
    getStatus: () => ({ installed, busy, lastUiAction, lastUiError: lastUiError || null, lastDecision, diagnostics: lastDiagnostics }),
  });

  window.__hobunjiGoogleDriveSaveUIDebug = {
    snapshot: () => ({ installed, busy, lastUiAction, lastUiError: lastUiError || null, lastDecision, diagnostics: lastDiagnostics }),
  };
})();
