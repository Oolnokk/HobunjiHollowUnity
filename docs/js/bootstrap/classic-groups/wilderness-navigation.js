(() => {
  'use strict';
  // Wilderness fog/discovery maps then navigation compass; both must precede game.js initialization.
  const scriptUrls = [
    "js/wilderness-landmark-scenery.js?v=20261118mergedSharedStone4",
    "js/wilderness-map.js?v=20261118h6d5b1bb",
    "js/navigation-compass.js?v=20261118h9d00478"
  ]; // Version tokens for these modules are owned in their feature manifest.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
