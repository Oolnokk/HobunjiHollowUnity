(() => {
  'use strict';
  // qol: classic scripts in their original parser execution order. Add modules here, not in index.html.
  const scriptUrls = [
    "js/toast-notifications.js?v=20261025qol1",
    "js/location-arrival.js?v=20261030harrivalreview2",
    "js/qol-hotkeys.js?v=20261025qol1",
    "js/inventory-search.js?v=20261025qol1"
]; // Versioned game modules owned by this group.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
