(() => {
  'use strict';
  // Wilderness Shift generation, bounded sightlines and terrain-aware locale placement; blocking load order matters.
  const scriptUrls = [
    "js/wilderness-seclusion.js?v=20261114tothalSecretLos1",
    "js/wilderness-map-generator.js?v=20261118fiveBlossomsLocaleCache1",
    "js/locale-terrain-placement.js?v=20261118fiveBlossomDiscovery1"
  ]; // Version tokens for these modules are owned in their feature manifest.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
