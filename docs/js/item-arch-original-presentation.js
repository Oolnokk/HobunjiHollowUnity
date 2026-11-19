// Retired compatibility entry point: Fixed item heading and six-pixel inset.
// ItemArchCategoryColors now owns the real implementation, one observer and one UI-open frame loop.
// Old cached loaders and external preview pages may still request this script URL.
(() => {
  'use strict';
  const owner = window.ItemArchCategoryColors; // The only actual presenter; legacy API forwards to its existing methods.
  if (!owner || window.ItemArchOriginalPresentation?.installed) return;
  window.ItemArchOriginalPresentation = {
    installed: true,
    refresh: () => owner.refresh?.(),
    debugSnapshot: () => owner.debugSnapshot?.().presentation || {},
  };
})();
