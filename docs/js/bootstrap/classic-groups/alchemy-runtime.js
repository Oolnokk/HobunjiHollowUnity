(() => {
  'use strict';
  // Alchemy runtime: load after key items and cooking, before tea-grinder/flask consumers.
  const scriptUrls = [
    'js/alchemy-system.js?v=20261125idleGate2'
  ]; // Independently versioned child; subsequent feature patches never modify index.html.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
