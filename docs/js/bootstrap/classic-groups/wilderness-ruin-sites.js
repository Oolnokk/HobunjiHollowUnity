(() => {
  'use strict';
  // Tothal locale and authored-ruin entrance modules, in their original dependency order.
  // Update version tokens here, not in index.html; the common parser-time loader fetches this manifest fresh.
  const scriptUrls = [
    "js/ruin-site-locales.js?v=20261002hb4d3f2d",
    "js/stampable-locale-defs.js?v=20261118goldWesternSlope1",
    "js/tothal-zone-cache.js?v=20261110banubuNightAudit2",
    "js/ruin-sites.js?v=20261126torchEntrance1"
  ]; // Parser-ordered script URLs; dependency/load order stays unchanged.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
