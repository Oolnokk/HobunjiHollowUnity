(() => {
  'use strict';
  // Parser-blocking classic script. Must execute at its original position in index.html.
  const tag = document.currentScript; // The script tag supplying the group name.
  const group = tag?.getAttribute('data-classic-group'); // Selects one independently owned script manifest.
  if (!group || !/^[a-z][a-z0-9-]*$/.test(group)) throw new Error('Invalid classic script group');
  if (document.readyState !== 'loading') throw new Error('Classic script groups must load while HTML is parsing');
  // Each tiny manifest is fetched fresh. Its component URLs retain their own versioned cache keys.
  const manifestUrl = 'js/bootstrap/classic-groups/' + group + '.js?load=' + Date.now();
  document.write('<script src="' + manifestUrl + '"><\/script>');
})();
