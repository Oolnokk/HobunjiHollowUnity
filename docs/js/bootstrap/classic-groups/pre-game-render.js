(() => {
  'use strict';
  // Weapon x-ray owns the shared surface policy and held-overlay renderer; no icon-HUD coupling.
  const scriptUrls = [
    "js/surface-occlusion-composer.js?v=20261102composer2",
    "js/held-object-render-order.js?v=20261114cloneowner4"
  ]; // Cache versions are owned by this feature area, rather than the shared index page.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
