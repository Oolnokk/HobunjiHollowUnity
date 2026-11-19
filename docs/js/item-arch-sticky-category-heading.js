// Retired compatibility entry point: Mobile edge-scroll continuity and Potion Select geometry.
// ItemArchCategoryColors now owns the real implementation, one observer and one UI-open frame loop.
// Old cached loaders and external preview pages may still request this script URL.
(() => {
  'use strict';
  const owner = window.ItemArchCategoryColors; // The only actual presenter; legacy API forwards to its existing methods.
  if (!owner || window.ItemArchStickyCategoryHeading?.installed) return;
  window.ItemArchStickyCategoryHeading = {
    installed: true,
    refresh: () => owner.refresh?.(),
    debugSnapshot: () => owner.debugSnapshot?.().presentation || {},
  };
})();
