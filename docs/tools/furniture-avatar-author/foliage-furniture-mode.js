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
    // Shared rigid-piece animation math is also used by the live game runtime.
    await loadClassicScript('../../js/furniture-piece-animation-runtime.js?v=20260907a');
    await loadClassicScript('furniture-decals.js?v=20260907a');
    await loadClassicScript('furniture-decal-catalog.js?v=20260907a');
    await loadClassicScript('furniture-piece-animations.js?v=20260907a');
  })().catch(error => console.error('[Furniture Author Extensions]', error));
})();
