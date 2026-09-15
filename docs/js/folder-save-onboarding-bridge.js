// Save persistence ↔ Onboarding bridge — makes the active persistence transport
// reconcile before onboarding snapshots localStorage, then refreshes save selection
// in place after an explicit restore instead of reloading the whole site.
(() => {
  'use strict';

  const onboarding = window.HobunjiOnboarding; // Existing onboarding API whose init is delayed until folder/Drive startup reconciliation resolves.
  if (!onboarding?.init || window.FolderSaveOnboarding) return;

  const originalInit = onboarding.init.bind(onboarding); // Core onboarding init retained as the final render step after persistence is ready.
  let initGeneration = 0; // Invalidates an older pending startup if a newer in-page refresh is requested.
  let skipPrepareOnce = false; // Used by refreshFromStorage because that restore already reconciled persistence before rerendering.
  let initPending = false; // Exposed in debug so mobile tests can distinguish persistence startup work from a stuck onboarding screen.
  let refreshCount = 0; // Counts successful in-page save-selection rebuilds after folder/Drive restores.
  let lastError = ''; // Records async startup failures without requiring the browser console.

  function persistenceAwareInit(options) {
    const generation = ++initGeneration;
    if (skipPrepareOnce) {
      skipPrepareOnce = false;
      initPending = false;
      return originalInit(options);
    }

    const prepare = window.HobunjiSaveCoordinator?.prepareBeforeOnboarding; // Coordinator chooses desktop folder or mobile Drive by actual capability.
    if (typeof prepare !== 'function') return originalInit(options);

    initPending = true;
    return Promise.resolve()
      .then(() => prepare())
      .catch(error => {
        // The coordinator preserves browser/durable local state as fallback.
        // Do not strand onboarding if a browser/filesystem/Drive edge case escapes it.
        lastError = String(error?.message || error);
        console.warn('[save-persistence] startup preparation failed; using local fallback', error);
      })
      .then(() => {
        if (generation !== initGeneration) return undefined;
        initPending = false;
        return originalInit(options);
      });
  }

  function refreshFromStorage() {
    // Persistence has already selected a direction and written the browser cache.
    // Throw away only the pre-game onboarding DOM/private model, then let normal
    // init rebuild from the new localStorage data without re-running startup gates.
    document.getElementById('ob-overlay')?.remove();
    skipPrepareOnce = true;
    refreshCount++;
    return window.HobunjiOnboarding.init();
  }

  persistenceAwareInit.__hobunjiSaveCoordinator = true;
  onboarding.init = persistenceAwareInit;

  window.FolderSaveOnboarding = {
    refreshFromStorage,
  };

  window.__hobunjiFolderSaveOnboardingDebug = {
    snapshot: () => ({
      initGeneration,
      initPending,
      refreshCount,
      lastError: lastError || null,
      coordinatorStartupMode: window.HobunjiSaveCoordinator?.getStatus?.().startupMode || null,
      overlayPresent: Boolean(document.getElementById('ob-overlay')),
    }),
  };
})();
