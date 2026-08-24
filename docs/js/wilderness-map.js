(() => {
  'use strict';

  // This remains the parser-ordered entry already referenced by index.html.
  // The loading runtime goes first, then the original WildernessMap module,
  // then its dependency-capture hook is installed before game.js initializes it.
  if (document.readyState === 'loading') {
    document.write('<script src="js/loading-screen.js?v=20260824a"><\/script>');
    document.write('<script src="js/wilderness-map-core.js?v=20260807a"><\/script>');
    document.write('<script>window.HobunjiLoadingScreen?.attachWildernessMapHook();<\/script>');
    return;
  }

  // Dev-tool/manual-injection fallback preserves the same order without document.write.
  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script'); // Used below to sequentially load each bootstrap dependency.
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  loadScript('js/loading-screen.js?v=20260824a')
    .then(() => loadScript('js/wilderness-map-core.js?v=20260807a'))
    .then(() => window.HobunjiLoadingScreen?.attachWildernessMapHook())
    .catch(error => console.error('[wilderness-map bootstrap]', error));
})();