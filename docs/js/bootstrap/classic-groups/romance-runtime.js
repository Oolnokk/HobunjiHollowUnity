(() => {
  'use strict';
  // Romance runtime: load after spouse kiss and relationship dependencies, before the NPC command wheel.
  const scriptUrls = [
    'js/romance-system.js?v=20261124traceClock4'
  ]; // Independently versioned child; subsequent feature patches never modify index.html.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
