(() => {
  'use strict';
  // Modular-house bootstrap: keep its independent surfaceUv generation alongside its own cache key.
  const scriptUrls = [
    'js/house-pieces.js?v=20261115houseDecoupled1&surfaceUv=20261113terrainpass2'
  ]; // Independently versioned child; subsequent feature patches never modify index.html.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
