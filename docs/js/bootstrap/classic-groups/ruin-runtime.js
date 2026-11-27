(() => {
  'use strict';
  // Parser-time ruin runtime bootstrap, after the player's UI and before game.js.
  // Update version tokens here, not in index.html; the common parser-time loader fetches this manifest fresh.
  const scriptUrls = [
    "js/dev-random-ruin-bootstrap.js?v=20261127ruinSkeletonAudit4"
  ]; // Parser-ordered script URLs; dependency/load order stays unchanged.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
