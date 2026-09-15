// Google Drive Save Lifecycle — non-interactive reconciliation when an already-
// authorized session returns online/foreground. It never opens OAuth UI and
// never hot-loads a remote branch into active gameplay.
(() => {
  'use strict';

  if (window.HobunjiGoogleDriveSaveLifecycle) return;

  const RECONNECT_DELAY_MS = 650; // Lets the existing pending-upload online handler run first; this pass then catches remote-only changes too.
  const BUSY_RETRY_MS = 1000; // One delayed retry avoids racing a manual/automatic Drive operation already in progress.
  let timer = null; // Coalesces online/visibility/pageshow bursts into one Drive preflight.
  let checkPromise = null; // Serializes lifecycle checks so foreground events cannot overlap one another.
  let scheduledReason = null; // Most recent event reason waiting for the debounce timer.
  let checks = 0; // Mobile-readable number of actual non-interactive Drive preflights attempted.
  let skippedNoToken = 0; // Checks skipped because this fresh session has not been explicitly authorized yet.
  let skippedOffline = 0; // Checks skipped while navigator reports offline.
  let busyRetries = 0; // Count of one-shot retries deferred behind another Drive operation.
  let remoteUpdates = 0; // Preflights that discovered a remote-only/needs-resolution state.
  let conflicts = 0; // Preflights that preserved a divergent conflict rather than overwriting either branch.
  let lastReason = 'none'; // Latest lifecycle event that reached the checker.
  let lastResult = null; // Compact latest result classification for diagnostics.
  let lastError = ''; // Latest non-interactive check failure visible without DevTools.

  function driveApi() { return window.HobunjiGoogleDriveSave || null; }

  function online() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  async function runCheck(reason = 'lifecycle') {
    if (checkPromise) return checkPromise;
    lastReason = reason;

    const drive = driveApi(); // Current transport status determines whether a silent preflight is allowed at all.
    const status = drive?.getStatus?.();
    if (!drive || !status?.configured || !status?.linked) {
      lastResult = 'not-linked';
      return { ok: false, skipped: 'not-linked' };
    }
    if (!online()) {
      skippedOffline++;
      lastResult = 'offline';
      return { ok: false, skipped: 'offline' };
    }
    if (!status.tokenPresent) {
      // Tokens intentionally do not survive a page reload. Only an explicit
      // Drive user gesture can reauthorize; lifecycle work must stay silent.
      skippedNoToken++;
      lastResult = 'auth-required';
      return { ok: false, skipped: 'auth-required' };
    }
    if (status.busyOperation) {
      busyRetries++;
      scheduleCheck(`${reason}-after-busy`, BUSY_RETRY_MS); // Retry once the active transport operation has had time to finish.
      lastResult = 'busy-retry';
      return { ok: false, skipped: 'busy' };
    }

    checkPromise = (async () => {
      checks++;
      lastError = '';
      try {
        const result = await drive.syncPending({ interactive: false }); // Mandatory transport preflight runs even when no local upload is pending.
        const state = result?.decision?.state || result?.status?.state || null; // Compact classification only; full branch data stays in the durable store.
        lastResult = state || (result?.ok ? 'current' : 'checked');
        if (result?.conflict || state === 'conflict') conflicts++;
        if (result?.needsResolution || state === 'external-only-change' || result?.status?.state === 'remote-update') remoteUpdates++;
        return result;
      } catch (error) {
        lastError = String(error?.message || error);
        lastResult = error?.authRequired ? 'auth-required' : 'error';
        // An expired token is expected lifecycle behavior: the transport keeps
        // any pending local envelope and Settings/startup can reauthorize later.
        return { ok: false, authRequired: !!error?.authRequired, error: lastError };
      } finally {
        checkPromise = null;
        window.HobunjiGoogleDriveSaveUI?.refresh?.().catch?.(() => {}); // Refresh visible status after a silent remote preflight/resolution stop.
      }
    })();
    return checkPromise;
  }

  function scheduleCheck(reason, delay = 0) {
    scheduledReason = reason;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const nextReason = scheduledReason || 'lifecycle';
      scheduledReason = null;
      runCheck(nextReason).catch(() => {});
    }, Math.max(0, Number(delay) || 0));
  }

  window.addEventListener('online', () => scheduleCheck('online', RECONNECT_DELAY_MS));
  window.addEventListener('pageshow', event => {
    if (event?.persisted) scheduleCheck('pageshow-bfcache', 0); // BFCache restore returns to a live session where the in-memory token may still be valid.
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleCheck('foreground', 0);
  });

  window.HobunjiGoogleDriveSaveLifecycle = Object.freeze({
    checkNow: reason => runCheck(reason || 'manual-lifecycle-check'),
    schedule: scheduleCheck,
  });

  window.__hobunjiGoogleDriveSaveLifecycleDebug = {
    snapshot: () => ({
      pending: Boolean(timer),
      checking: Boolean(checkPromise),
      scheduledReason,
      checks,
      skippedNoToken,
      skippedOffline,
      busyRetries,
      remoteUpdates,
      conflicts,
      lastReason,
      lastResult,
      lastError: lastError || null,
    }),
  };
})();
