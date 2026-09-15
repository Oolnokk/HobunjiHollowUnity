// Google Drive Save Conflict UI — makes the durable preserve-both state visible
// and keeps destructive recovery choices explicit in Settings.
(() => {
  'use strict';

  if (window.HobunjiGoogleDriveConflictUI) return;

  const TARGET_ID = 'drive'; // Durable sync-store transport id whose conflict record contains both complete envelopes.
  const ROW_ID = 'googleDriveSaveRow'; // Existing Drive Settings row owned by google-drive-save-ui.js.
  const PANEL_ID = 'googleDriveConflictPanel'; // Conflict summary inserted into the existing Drive controls instead of creating another settings section.
  const KEEP_BOTH_ID = 'googleDriveKeepBothBtn'; // Explicit non-destructive acknowledgement that leaves both preserved branches untouched.
  const USE_LOCAL_BUTTON_ID = 'googleDriveSaveUseLocalBtn'; // Existing destructive local-wins action relabeled more precisely while conflict UI is active.
  const USE_DRIVE_BUTTON_ID = 'googleDriveSaveUseDriveBtn'; // Existing destructive Drive-wins action relabeled more precisely while conflict UI is active.
  const UNLINK_BUTTON_ID = 'googleDriveSaveUnlinkBtn'; // Existing unlink action intercepted so unresolved conflict metadata cannot be discarded casually.

  let scheduled = false; // Coalesces settings/transport mutations into one asynchronous conflict refresh.
  let keepBothAcknowledgements = 0; // Mobile-visible count of deliberate no-overwrite acknowledgements.
  let unlinkAttempts = 0; // Count of Settings unlink gestures handled by the conflict-aware guard.
  let conflictUnlinks = 0; // Count of confirmed unlinks that deliberately discarded an unresolved conflict record.
  let unlinkBusy = false; // Prevents repeated taps from racing unlink/store cleanup.
  let lastConflictKind = null; // Latest durable conflict kind rendered into Settings.
  let lastLocalHash = null; // Latest local branch hash shown to the player.
  let lastExternalHash = null; // Latest external/Drive branch hash shown to the player.
  let lastError = ''; // Latest conflict-panel refresh/unlink failure visible in Save Diagnostics.

  function storeApi() { return window.HobunjiSaveSyncStore || null; }
  function driveApi() { return window.HobunjiGoogleDriveSave || null; }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shortHash(value) {
    const text = String(value || '');
    if (!text) return 'none';
    const bare = text.replace(/^sha256:/i, '');
    return bare.length > 14 ? `${bare.slice(0, 14)}…` : bare;
  }

  function branchSummary(label, envelope) {
    const snapshot = envelope?.snapshot || {}; // Canonical gameplay bundle summarized without exposing full save contents in Settings.
    const meta = snapshot.meta || {};
    const farmers = Array.isArray(meta.characters) ? meta.characters.length : 0;
    const worlds = Array.isArray(meta.worlds) ? meta.worlds.length : 0;
    const revision = Number.isFinite(Number(envelope?.revision)) ? Number(envelope.revision) : '?';
    return `${label}: rev ${revision} · ${farmers} farmer${farmers === 1 ? '' : 's'} · ${worlds} world${worlds === 1 ? '' : 's'} · ${shortHash(envelope?.contentHash)}`;
  }

  function installPanel() {
    const row = document.getElementById(ROW_ID); // Existing Drive row may be rebuilt/reparented by Settings.
    const controls = row?.querySelector('.google-drive-save-controls');
    if (!controls) return null;

    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'google-drive-conflict-panel';
    panel.style.display = 'none';
    Object.assign(panel.style, {
      flexBasis: '100%',
      width: '100%',
      boxSizing: 'border-box',
      padding: '9px 10px',
      border: '1px solid rgba(255, 190, 95, .45)',
      borderRadius: '7px',
      background: 'rgba(130, 82, 24, .14)',
      fontSize: '11px',
      lineHeight: '1.45',
    });
    panel.innerHTML = `
      <div data-drive-conflict-heading style="font-weight:700;margin-bottom:4px;">Both saves are preserved</div>
      <div data-drive-conflict-copy style="opacity:.88;margin-bottom:6px;"></div>
      <div data-drive-conflict-local style="font-family:monospace;opacity:.8;"></div>
      <div data-drive-conflict-external style="font-family:monospace;opacity:.8;margin-bottom:7px;"></div>
      <button type="button" id="${KEEP_BOTH_ID}" class="settings-small-btn">Keep Both · Decide Later</button>`;
    controls.appendChild(panel);

    panel.querySelector(`#${KEEP_BOTH_ID}`)?.addEventListener('click', async () => {
      keepBothAcknowledgements++;
      lastError = '';
      const copy = panel.querySelector('[data-drive-conflict-copy]');
      if (copy) copy.textContent = 'No overwrite was performed. This device keeps running from its local branch while the Drive branch remains preserved for later resolution.';
      try {
        await storeApi()?.appendEvent?.('DRIVE KEEP BOTH', {
          localHash: lastLocalHash,
          externalHash: lastExternalHash,
          conflictKind: lastConflictKind,
        }); // Records the explicit no-op decision without clearing or mutating either saved branch.
      } catch (error) {
        lastError = String(error?.message || error);
      }
    });
    return panel;
  }

  function relabelResolutionButtons(conflictPresent) {
    const localButton = document.getElementById(USE_LOCAL_BUTTON_ID); // Existing handler remains authoritative; only wording changes.
    if (localButton) {
      localButton.textContent = conflictPresent ? 'Replace Drive with This Device' : 'Use This Device';
      localButton.title = conflictPresent ? 'Overwrite the linked Drive file with this device only after the preserved conflict is reviewed.' : '';
    }
    const driveButton = document.getElementById(USE_DRIVE_BUTTON_ID); // Existing gameplay-running disable rules remain owned by google-drive-save-ui.js.
    if (driveButton) {
      driveButton.textContent = conflictPresent ? 'Replace This Device with Drive' : 'Use Drive Save';
      if (conflictPresent && !driveButton.disabled) driveButton.title = 'Replace this device cache with the validated Drive branch. Only available outside a running world.';
    }
  }

  async function conflictAwareUnlink(button) {
    if (unlinkBusy) return;
    unlinkBusy = true;
    unlinkAttempts++;
    lastError = '';
    const oldLabel = button?.textContent || 'Unlink'; // Existing label restored even if unlink is cancelled or fails.
    if (button) {
      button.disabled = true;
      button.textContent = 'Checking…';
    }

    try {
      const conflict = await storeApi()?.getConflict?.(TARGET_ID) || null; // Fresh durable read avoids relying on potentially stale panel-render state.
      const hasConflict = Boolean(conflict?.local?.contentHash && conflict?.external?.contentHash);
      const message = hasConflict
        ? 'An unresolved Google Drive conflict is still preserved in this browser.\n\nUnlinking will NOT delete this device\'s save or the Google Drive file, but this browser will forget the preserved conflict copy, common baseline, pending Drive queue, and link metadata. You would need to link the Drive file again to compare the branches later.\n\nUnlink anyway?'
        : 'Unlink Google Drive from this browser? Your Drive file and local save are not deleted.';
      if (!confirm(message)) return { cancelled: true, conflictPreserved: hasConflict };

      if (hasConflict) conflictUnlinks++;
      const result = await driveApi()?.unlink?.(); // Transport performs the canonical link/baseline/conflict/pending cleanup only after the explicit warning.
      await window.HobunjiGoogleDriveSaveUI?.refresh?.();
      scheduleRefresh();
      return result;
    } catch (error) {
      lastError = String(error?.message || error);
      alert('Google Drive Save:\n' + lastError);
      return null;
    } finally {
      unlinkBusy = false;
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = oldLabel;
      }
    }
  }

  async function refresh() {
    scheduled = false;
    const panel = installPanel();
    if (!panel) return;

    try {
      const conflict = await storeApi()?.getConflict?.(TARGET_ID) || null; // Complete local/external envelopes are already durable before this panel renders.
      const present = Boolean(conflict?.local?.contentHash && conflict?.external?.contentHash);
      relabelResolutionButtons(present);
      if (!present) {
        panel.style.display = 'none';
        lastConflictKind = null;
        lastLocalHash = null;
        lastExternalHash = null;
        lastError = '';
        return;
      }

      lastConflictKind = conflict.kind || conflict.decision || 'drive-conflict';
      lastLocalHash = conflict.local.contentHash;
      lastExternalHash = conflict.external.contentHash;
      panel.style.display = '';

      const heading = panel.querySelector('[data-drive-conflict-heading]');
      if (heading) heading.textContent = 'Both saves are preserved — choose only when ready';
      const copy = panel.querySelector('[data-drive-conflict-copy]');
      if (copy) {
        const detected = conflict.detectedAt ? new Date(conflict.detectedAt).toLocaleString() : 'an earlier sync check';
        copy.textContent = `Conflict detected ${detected}. Keep Both writes neither side; the two replace buttons below are destructive resolutions.`;
      }
      const local = panel.querySelector('[data-drive-conflict-local]');
      if (local) local.textContent = branchSummary('This device', conflict.local);
      const external = panel.querySelector('[data-drive-conflict-external]');
      if (external) external.textContent = branchSummary('Google Drive', conflict.external);
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
      panel.style.display = 'none';
    }
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => refresh().catch(() => {}));
  }

  // Capture phase replaces only the base Settings unlink click so conflict-aware
  // warning/cleanup happens before google-drive-save-ui.js's ordinary handler.
  document.addEventListener('click', event => {
    const button = event.target?.closest?.(`#${UNLINK_BUTTON_ID}`);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    conflictAwareUnlink(button);
  }, true);

  const observer = new MutationObserver(scheduleRefresh); // Settings DOM and Drive row visibility can change after this module loads.
  const begin = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleRefresh();
  };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });

  driveApi()?.onChange?.(scheduleRefresh); // Successful conflict resolution clears the durable record and hides this panel immediately.

  window.HobunjiGoogleDriveConflictUI = Object.freeze({ refresh, conflictAwareUnlink });
  window.__hobunjiGoogleDriveConflictUIDebug = {
    snapshot: () => ({
      visible: document.getElementById(PANEL_ID)?.style.display !== 'none',
      keepBothAcknowledgements,
      unlinkAttempts,
      conflictUnlinks,
      unlinkBusy,
      lastConflictKind,
      lastLocalHash,
      lastExternalHash,
      lastError: lastError || null,
    }),
  };
})();
