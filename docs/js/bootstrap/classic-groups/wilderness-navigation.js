(() => {
  'use strict';
  // Wilderness fog/discovery maps then navigation compass; both must precede game.js initialization.
  const scriptUrls = [
    "js/wilderness-landmark-scenery.js?v=20261123jumpSurface1",
    "js/wilderness-map.js?v=20261118blossomNoWaypoint1",
    "js/navigation-compass.js?v=20261119hca1a58d"
  ]; // Version tokens for these modules are owned in their feature manifest.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
