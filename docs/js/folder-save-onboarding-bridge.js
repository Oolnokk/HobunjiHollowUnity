// Folder Save ↔ Onboarding bridge — makes folder reconciliation happen before
// onboarding snapshots localStorage, and refreshes save selection in place after
// an explicit folder restore instead of reloading the whole site.
(() => {
  'use strict';

  const onboarding = window.HobunjiOnboarding; // Existing onboarding API whose init is delayed until the primary folder is resolved.
  if (!onboarding?.init || window.FolderSaveOnboarding) return;

  const originalInit = onboarding.init.bind(onboarding); // Core onboarding init retained as the final render step after persistence is ready.
  const FAILURE_ID = 'hobunjiSaveStartupFailure'; // Emergency pre-onboarding surface used when the normal renderer crashes or startup stalls.
  const STARTUP_WATCHDOG_MS = 3500; // Long enough for normal IndexedDB/folder inspection, short enough to prevent an indefinitely blank boot.
  let initGeneration = 0; // Invalidates an older pending startup if a newer in-page refresh is requested.
  let skipPrepareOnce = false; // Used by refreshFromStorage because that restore already reconciled the folder before rerendering.
  let initPending = false; // Exposed in debug so mobile tests can distinguish folder startup work from a stuck onboarding screen.
  let refreshCount = 0; // Counts successful in-page save-selection rebuilds after folder restores.
  let lastError = ''; // Records async startup failures without requiring the browser console.
  let watchdogTimer = null; // One-shot blank-screen guard for a preparation promise that never reaches either onboarding or the folder gate.

  function removeFailureSurface() {
    document.getElementById(FAILURE_ID)?.remove();
  }

  function failureDetail(message) {
    const folderStatus = window.LocalSaveFolder?.getStatus?.() || null; // Included in visible failure text so mobile users can report state without DevTools.
    const folderError = folderStatus?.lastError ? ` Folder: ${folderStatus.lastError}` : '';
    return String(message || 'Save startup failed before the save-selection screen could open.') + folderError;
  }

  function showStartupFailure(message, { stalled = false } = {}) {
    lastError = failureDetail(message);
    let overlay = document.getElementById(FAILURE_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = FAILURE_ID;
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '18px',
        boxSizing: 'border-box', background: 'rgba(5,8,10,.92)', color: '#eef3f6',
        fontFamily: 'inherit',
      });
      const card = document.createElement('div');
      card.setAttribute('data-save-startup-failure-card', '');
      Object.assign(card.style, {
        width: 'min(680px,96vw)', maxHeight: '88vh', overflow: 'auto',
        padding: '20px', borderRadius: '12px', background: '#151b20',
        border: '1px solid rgba(255,255,255,.18)', boxShadow: '0 18px 60px rgba(0,0,0,.55)',
      });
      card.innerHTML = `
        <div style="font-size:21px;font-weight:700;margin-bottom:8px;">Save Startup Problem</div>
        <div data-save-startup-failure-message style="font-size:13px;line-height:1.5;white-space:pre-wrap;margin-bottom:14px;"></div>
        <div style="font-size:12px;line-height:1.45;color:#aebbc3;margin-bottom:14px;">Nothing has been overwritten. You can open Save Recovery directly from here even though normal onboarding did not render.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" data-save-startup-recovery>Save Recovery</button>
          <button type="button" data-save-startup-retry>Retry Save Startup</button>
        </div>`;
      overlay.appendChild(card);
      document.body?.appendChild(overlay);

      card.querySelector('[data-save-startup-recovery]')?.addEventListener('click', () => {
        const recovery = window.HobunjiSaveCheckpoints?.openRecoveryModal;
        if (typeof recovery === 'function') recovery();
        else {
          const messageEl = card.querySelector('[data-save-startup-failure-message]');
          if (messageEl) messageEl.textContent = lastError + '\n\nSave Recovery is unavailable because the checkpoint module did not load.';
        }
      });

      card.querySelector('[data-save-startup-retry]')?.addEventListener('click', () => {
        removeFailureSurface();
        initPending = false;
        folderAwareInit();
      });
    }
    const messageEl = overlay.querySelector('[data-save-startup-failure-message]');
    if (messageEl) messageEl.textContent = stalled
      ? `Save preparation did not finish and no save-selection or folder-recovery screen appeared.\n\n${lastError}`
      : lastError;
    return overlay;
  }

  function clearWatchdog() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  function armWatchdog(generation) {
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      if (generation !== initGeneration || !initPending) return;
      if (document.getElementById('ob-overlay') || document.getElementById('folderSavePrimaryGate')) return;
      showStartupFailure('The save startup pipeline is still waiting before onboarding.', { stalled: true });
    }, STARTUP_WATCHDOG_MS);
  }

  function safeOriginalInit(options) {
    try {
      removeFailureSurface();
      const result = originalInit(options);
      if (result && typeof result.then === 'function') {
        return result.catch(error => {
          initPending = false;
          clearWatchdog();
          showStartupFailure(`Onboarding failed while reading the browser save: ${String(error?.message || error)}`);
          return undefined;
        });
      }
      return result;
    } catch (error) {
      initPending = false;
      clearWatchdog();
      showStartupFailure(`Onboarding failed while reading the browser save: ${String(error?.message || error)}`);
      return undefined;
    }
  }

  function folderAwareInit(options) {
    const generation = ++initGeneration;
    if (skipPrepareOnce) {
      skipPrepareOnce = false;
      initPending = false;
      return safeOriginalInit(options);
    }

    const prepare = window.FolderSavePrimary?.prepareBeforeOnboarding;
    if (typeof prepare !== 'function') return safeOriginalInit(options);

    initPending = true;
    armWatchdog(generation);
    return Promise.resolve()
      .then(() => prepare())
      .catch(error => {
        // FolderSavePrimary already keeps browser storage as the safe fallback.
        // Do not strand onboarding if a browser/filesystem edge case escapes it.
        lastError = String(error?.message || error);
        console.warn('[folder-save] startup preparation failed; using browser fallback', error);
      })
      .then(() => {
        if (generation !== initGeneration) return undefined;
        initPending = false;
        clearWatchdog();
        return safeOriginalInit(options);
      })
      .catch(error => {
        // Last-resort boundary: no asynchronous startup exception is allowed to leave the page blank.
        initPending = false;
        clearWatchdog();
        showStartupFailure(`Save startup failed before onboarding could render: ${String(error?.message || error)}`);
        return undefined;
      });
  }

  function refreshFromStorage() {
    // FolderSavePrimary has already atomically selected a direction and written
    // the browser cache. Throw away only the pre-game onboarding DOM/private
    // model, then let its normal init rebuild from the new localStorage data.
    document.getElementById('ob-overlay')?.remove();
    removeFailureSurface();
    skipPrepareOnce = true;
    refreshCount++;
    return window.HobunjiOnboarding.init();
  }

  folderAwareInit.__hobunjiFolderSavePrimary = true;
  onboarding.init = folderAwareInit;

  window.FolderSaveOnboarding = {
    refreshFromStorage,
    showStartupFailure, // Used by diagnostics/tests to surface a pre-onboarding persistence failure without requiring DevTools.
  };

  window.__hobunjiFolderSaveOnboardingDebug = {
    snapshot: () => ({
      initGeneration,
      initPending,
      refreshCount,
      lastError: lastError || null,
      overlayPresent: Boolean(document.getElementById('ob-overlay')),
      failureSurfacePresent: Boolean(document.getElementById(FAILURE_ID)),
      folderGatePresent: Boolean(document.getElementById('folderSavePrimaryGate')),
    }),
  };
})();
