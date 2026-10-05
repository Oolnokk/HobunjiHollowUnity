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
    await loadClassicScript('foliage-furniture-mode-core.js?v=20260907a');
    await loadClassicScript('../../js/furniture-piece-animation-runtime.js?v=20260907a');
    await loadClassicScript('../../js/tankan-script-layout.js?v=20260915tankan8');
    await loadClassicScript('furniture-decals.js?v=20261003h7cf2f60');
    await loadClassicScript('furniture-wall-ornaments.js?v=20260924fullheight3');
    await loadClassicScript('furniture-daylight-windows.js?v=20261003hc970385');
    await loadClassicScript('furniture-decal-catalog.js?v=20260907a');
    await loadClassicScript('furniture-piece-animations.js?v=20261004hd781699');
    await loadClassicScript('../../js/color-fill.js?v=20260923colorfill7');
    await loadClassicScript('../../js/motif-store.js?v=20260920patterns1');
    await loadClassicScript('../../js/pattern-library.js?v=20261003h0ad42ee');
    await loadClassicScript('../../js/repo-pattern-library.js?v=20261005hf072713');
    await loadClassicScript('../../js/pattern-authoring.js?v=20261003h8825bc4');
    await loadClassicScript('../../js/clothing-weaving-system.js?v=20261003h25b5015');
    await loadClassicScript('../../js/furniture-pattern-surfaces.js?v=20261004h1cbdbdd');
    await loadClassicScript('furniture-patterns.js?v=20261005h45601fe');
  })().catch(error => console.error('[Furniture Author Extensions]', error));
})();
