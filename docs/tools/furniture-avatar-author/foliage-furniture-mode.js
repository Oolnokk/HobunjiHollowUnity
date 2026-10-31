// Furniture + Avatar Author extension loader.
// Keep optional authoring features in small sibling files so the giant V58
// editor remains stable and each feature can wrap export/import independently.
(() => {
  const loadClassicScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });

  (async () => {
    await loadClassicScript('foliage-furniture-mode-core.js?v=20261025h2a9d51a');
    await loadClassicScript('../../js/furniture-piece-animation-runtime.js?v=20260907a');
    await loadClassicScript('../../js/tankan-script-layout.js?v=20260915tankan8');
    await loadClassicScript('furniture-decals.js?v=20261003h7cf2f60');
    await loadClassicScript('furniture-wall-ornaments.js?v=20260924fullheight3');
    await loadClassicScript('furniture-daylight-windows.js?v=20261026ha5312a8');
    await loadClassicScript('furniture-decal-catalog.js?v=20260907a');
    await loadClassicScript('furniture-piece-animations.js?v=20261004hd781699');
    await loadClassicScript('../../js/color-fill.js?v=20260923colorfill7');
    await loadClassicScript('../../js/motif-store.js?v=20260920patterns1');
    await loadClassicScript('../../js/pattern-library.js?v=20261026hPlayerDefaults5');
    await loadClassicScript('../../js/repo-pattern-library.js?v=20261030lichPatterns3');
    await loadClassicScript('../../js/pattern-authoring.js?v=20261026hMotifPNG1');
    await loadClassicScript('../../js/clothing-weaving-system.js?v=20261031h39d1dc0');
    await loadClassicScript('../../js/furniture-pattern-surfaces.js?v=20261030lichWalls3');
    await loadClassicScript('furniture-patterns.js?v=20261026hOverpassInk3');
  })().catch(error => console.error('[Furniture Author Extensions]', error));
})();
