// Folder Save ↔ Onboarding bridge — makes folder reconciliation happen before
// onboarding snapshots localStorage, and refreshes save selection in place after
// an explicit folder restore instead of reloading the whole site.
(() => {
  'use strict';

  const onboarding = window.HobunjiOnboarding; // Existing onboarding API whose init is delayed until the primary folder is resolved.
  if (!onboarding?.init || window.FolderSaveOnboarding) return;

  const originalInit = onboarding.init.bind(onboarding); // Core onboarding init retained as the final render step after persistence is ready.
  let initGeneration = 0; // Invalidates an older pending startup if a newer in-page refresh is requested.
  let skipPrepareOnce = false; // Used by refreshFromStorage because that restore already reconciled the folder before rerendering.
  let initPending = false; // Exposed in debug so mobile tests can distinguish folder startup work from a stuck onboarding screen.
  let refreshCount = 0; // Counts successful in-page save-selection rebuilds after folder restores.
  let lastError = ''; // Records async startup failures without requiring the browser console.

  function folderAwareInit(options) {
    const generation = ++initGeneration;
    if (skipPrepareOnce) {
      skipPrepareOnce = false;
      initPending = false;
      return originalInit(options);
    }

    const prepare = window.FolderSavePrimary?.prepareBeforeOnboarding;
    if (typeof prepare !== 'function') return originalInit(options);

    initPending = true;
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
        return originalInit(options);
      });
  }

  function refreshFromStorage() {
    // FolderSavePrimary has already atomically selected a direction and written
    // the browser cache. Throw away only the pre-game onboarding DOM/private
    // model, then let its normal init rebuild from the new localStorage data.
    document.getElementById('ob-overlay')?.remove();
    skipPrepareOnce = true;
    refreshCount++;
    return window.HobunjiOnboarding.init();
  }

  folderAwareInit.__hobunjiFolderSavePrimary = true;
  onboarding.init = folderAwareInit;

  window.FolderSaveOnboarding = {
    refreshFromStorage,
  };

  window.__hobunjiFolderSaveOnboardingDebug = {
    snapshot: () => ({
      initGeneration,
      initPending,
      refreshCount,
      lastError: lastError || null,
      overlayPresent: Boolean(document.getElementById('ob-overlay')),
    }),
  };
})();
