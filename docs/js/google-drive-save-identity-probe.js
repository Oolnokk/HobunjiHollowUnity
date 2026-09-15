// Google Drive Save Identity Probe — manual validation aid for proving that a
// Drive-for-Desktop overwrite keeps the same cloud file id while Drive version advances.
(() => {
  'use strict';

  if (window.HobunjiGoogleDriveIdentityProbe) return;

  const TARGET_ID = 'drive'; // Sync-store transport whose remembered link contains the exact Drive file id.
  const ROW_ID = 'googleDriveSaveRow'; // Existing Drive Settings row where the manual probe belongs.
  const BUTTON_ID = 'googleDriveIdentityProbeBtn'; // Explicit user-gesture button; the probe never runs in the background.
  const RESULT_ID = 'googleDriveIdentityProbeResult'; // Inline result readable on mobile/desktop without DevTools.
  const SESSION_KEY = 'hobunjiDriveIdentityProbe.v1'; // Non-secret prior sample retained only for this tab/session so reloads do not lose the comparison.

  let samples = 0; // Number of successful metadata/hash samples captured in this page session.
  let stableIdentityPasses = 0; // Count of comparisons where the same file id survived a Drive version change.
  let identityFailures = 0; // Count of comparisons where the linked cloud file id unexpectedly changed.
  let lastSample = null; // Latest sample displayed to the user and diagnostics.
  let lastComparison = 'not-run'; // Human-readable probe outcome.
  let lastError = ''; // Latest probe error visible in Save Diagnostics.

  function driveApi() { return window.HobunjiGoogleDriveSave || null; }
  function storeApi() { return window.HobunjiSaveSyncStore || null; }

  function readPreviousSample() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function rememberSample(sample) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(sample)); } catch {}
  }

  function short(value, length = 14) {
    const text = String(value || '');
    if (!text) return 'none';
    const bare = text.replace(/^sha256:/i, '');
    return bare.length > length ? `${bare.slice(0, length)}…` : bare;
  }

  function compareSamples(previous, current) {
    if (!previous) return {
      state: 'baseline-recorded',
      message: 'Baseline recorded. Edit/save the same desktop file through Drive for Desktop, wait for Drive to sync, then run the probe again.',
    };
    if (previous.fileId !== current.fileId) {
      identityFailures++;
      return {
        state: 'file-id-changed',
        message: `FAIL: Drive file id changed (${short(previous.fileId, 10)} → ${short(current.fileId, 10)}). The desktop write appears to have replaced the cloud object instead of updating it in place.`,
      };
    }
    if (previous.version !== current.version) {
      stableIdentityPasses++;
      return {
        state: 'stable-id-version-advanced',
        message: `PASS: same Drive file id; Drive version advanced ${previous.version || '?'} → ${current.version || '?'}. Desktop mirroring preserved cloud identity.`,
      };
    }
    if (previous.contentHash !== current.contentHash) {
      return {
        state: 'hash-changed-version-static',
        message: 'WARNING: canonical content changed but Drive version did not. Recheck after Drive finishes syncing before trusting this result.',
      };
    }
    return {
      state: 'unchanged',
      message: 'No remote change detected yet. Make a desktop save to the same canonical file, allow Drive for Desktop to sync, then sample again.',
    };
  }

  function install() {
    const row = document.getElementById(ROW_ID); // Drive row may appear after Settings initializes.
    const controls = row?.querySelector('.google-drive-save-controls');
    if (!controls || document.getElementById(BUTTON_ID)) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'settings-small-btn google-drive-secondary-btn';
    button.textContent = 'Drive Identity Probe';
    button.title = 'Sample the linked Drive file id/version/hash without writing anything.';
    button.addEventListener('click', () => runProbe(button));

    const result = document.createElement('div');
    result.id = RESULT_ID;
    Object.assign(result.style, {
      flexBasis: '100%',
      width: '100%',
      fontSize: '10px',
      lineHeight: '1.4',
      opacity: '0.78',
      display: 'none',
    });
    controls.appendChild(button);
    controls.appendChild(result);
    renderAvailability();
  }

  function renderAvailability() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    const status = driveApi()?.getStatus?.() || {};
    button.style.display = status.configured && status.linked ? '' : 'none';
  }

  async function runProbe(button) {
    const drive = driveApi(); // Current transport resolved at the user click so OAuth is always gesture-bound.
    if (!drive) return;
    const oldLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Checking…';
    lastError = '';

    try {
      const status = drive.getStatus?.() || {};
      if (!status.configured) throw new Error('Google Drive Save is not configured in this build.');
      if (!status.linked) throw new Error('Link the canonical Google Drive save before running the identity probe.');
      if (!status.tokenPresent) await drive.requestAccessToken({ interactive: true }); // Explicit probe click may authorize; no background path uses this.

      const remote = await drive.inspectRemote({ interactive: true }); // Read-only metadata + canonical envelope fetch; no Drive content is modified.
      const link = await storeApi()?.getLink?.(TARGET_ID) || null;
      const sample = {
        fileId: link?.fileId || remote?.metadata?.id || status.fileId || null,
        fileName: remote?.metadata?.name || link?.fileName || status.fileName || null,
        version: remote?.metadata?.version != null ? String(remote.metadata.version) : null,
        modifiedTime: remote?.metadata?.modifiedTime || null,
        contentHash: remote?.envelope?.contentHash || null,
        sampledAt: Date.now(),
      }; // Public/non-secret Drive identity and canonical hash only; no OAuth material is stored.
      if (!sample.fileId) throw new Error('Drive did not return the linked file id for the identity probe.');

      const previous = readPreviousSample();
      const comparison = compareSamples(previous, sample);
      samples++;
      lastSample = sample;
      lastComparison = comparison.state;
      rememberSample(sample);
      await storeApi()?.appendEvent?.('DRIVE IDENTITY PROBE', {
        comparison: comparison.state,
        fileIdStable: previous ? previous.fileId === sample.fileId : null,
        previousVersion: previous?.version || null,
        currentVersion: sample.version,
        contentHash: sample.contentHash,
      });

      const result = document.getElementById(RESULT_ID);
      if (result) {
        result.style.display = '';
        result.textContent = `${comparison.message} File ${short(sample.fileId, 12)} · version ${sample.version || '?'} · hash ${short(sample.contentHash)}${sample.modifiedTime ? ` · ${sample.modifiedTime}` : ''}`;
      }
    } catch (error) {
      lastError = String(error?.message || error);
      lastComparison = 'error';
      const result = document.getElementById(RESULT_ID);
      if (result) {
        result.style.display = '';
        result.textContent = `Identity probe failed: ${lastError}`;
      }
    } finally {
      button.disabled = false;
      button.textContent = oldLabel;
      renderAvailability();
    }
  }

  const observer = new MutationObserver(() => {
    install();
    renderAvailability();
  }); // Settings can rebuild/reparent; keep one probe control attached to the active Drive row.
  const begin = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    install();
  };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });
  driveApi()?.onChange?.(renderAvailability);

  window.HobunjiGoogleDriveIdentityProbe = Object.freeze({ run: () => {
    const button = document.getElementById(BUTTON_ID);
    if (!button) throw new Error('Drive Identity Probe button is not available yet.');
    return runProbe(button);
  } });
  window.__hobunjiGoogleDriveIdentityProbeDebug = {
    snapshot: () => ({ samples, stableIdentityPasses, identityFailures, lastSample, lastComparison, lastError: lastError || null, previousSample: readPreviousSample() }),
  };
})();
