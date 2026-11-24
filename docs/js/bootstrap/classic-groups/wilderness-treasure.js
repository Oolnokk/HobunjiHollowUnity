(() => {
  'use strict';
  // Chest lockpicking and wilderness treasure, emitted in their original parser order.
  // Update version tokens here, not in index.html; the common parser-time loader fetches this manifest fresh.
  const scriptUrls = [
    "js/chest-lockpicking.js?v=20261124RelaxedLockQueue2",
    "js/wild-treasure.js?v=20261118ChestClaims1"
  ]; // Parser-ordered script URLs; dependency/load order stays unchanged.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
