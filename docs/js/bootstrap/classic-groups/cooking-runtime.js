(() => {
  'use strict';
  // Cooking runtime: load after cooking data and processing, before key items and alchemy.
  const scriptUrls = [
    'js/cooking-system.js?v=20261124rootledoot1'
  ]; // Independently versioned child; subsequent feature patches never modify index.html.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
