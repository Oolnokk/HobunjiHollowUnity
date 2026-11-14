(() => {
  'use strict';
  // HUD action icons and item sprites, in their original parser order.
  const scriptUrls = [
    "js/tool-icon-render.js?v=20261114pregameservices1",
    "js/sprite-recolor.js?v=20261114inventoryPerf2",
    "js/object-sprite-catalog.js?v=20261114potionAudit2"
  ]; // Cache versions are owned by this feature area, rather than the shared index page.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
