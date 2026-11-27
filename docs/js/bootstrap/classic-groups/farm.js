(() => {
  'use strict';
  // Farm scripts must execute in their original parser-blocking order before game.js.
  // FarmEditor registers first; the shared family plot loader and farmwork UI follow.
  const scriptUrls = [
    "js/farm-editor.js?v=20261115farmStarterGrantSafe2",
    "js/farm-plot-editor.js?v=20261109family1",
    "js/farmwork-ui.js?v=20261126familyWork2"
  ]; // Feature-owned script versions; bump these here instead of touching index.html.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
