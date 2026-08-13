(() => {
  'use strict';

  // Parser-time entrypoint for the modular-house feature. The stable house
  // architecture core stays separate from optional terrain/elevation glue,
  // while index.html keeps a single long-lived js/house-pieces.js include.
  const current = document.currentScript;
  const baseUrl = current?.src ? new URL('.', current.src) : new URL('js/', document.baseURI);
  const scripts = [
    ['SurfaceTint', 'surface-tint.js?v=20260813b'],
    ['NaturalSurfaceMaterialConfig', '../config/natural-surface-materials.js?v=20260813a'],
    ['NaturalSurfaceTextureReady', 'natural-surface-texture-ready.js?v=20260813a'],
    ['NaturalSurfaceMaterials', 'natural-surface-materials.js?v=20260812a'],
    ['WildernessTerrainCleanupConfig', '../config/wilderness-terrain-cleanup.js?v=20260812a'],
    ['WildernessTerrainCleanup', 'wilderness-terrain-cleanup.js?v=20260812a'],
    ['NaturalSurfaceRuntimeFixes', 'natural-surface-runtime-fixes.js?v=20260813b'],
    ['StructurePreload', 'structure-preload.js?v=20260812a'],
    ['WildernessSimulationLOD', 'wilderness-simulation-lod.js?v=20260812a'],
    ['OutlineRenderPerformance', 'outline-render-performance.js?v=20260812a'],
    ['TerrainRenderChunks', 'terrain-render-chunks.js?v=20260812a'],
    ['BuildingSubtleElevation', 'building-subtle-elevation.js?v=20260811a'],
    ['PlayerHouseElevation', 'player-house-elevation.js?v=20260811b'],
    ['HousePieces', 'house-pieces-core.js?v=20260811a'],
    [null, 'house-pieces-elevation-bootstrap.js?v=20260811c'],
  ];

  function scriptUrl(file) { return new URL(file, baseUrl).href; }
  function needs(globalName) { return !globalName || !window[globalName]; }

  if (document.readyState === 'loading' && typeof document.write === 'function') {
    for (const [globalName, file] of scripts) {
      if (!needs(globalName)) continue;
      document.write(`<script src="${scriptUrl(file)}"><\/script>`);
    }
    return;
  }

  // Non-parser fallback for dev tools that load this entrypoint dynamically.
  // Main gameplay always takes the synchronous parser path above so game.js
  // cannot initialize HousePieces before its core/elevation adapter exist.
  let chain = Promise.resolve();
  for (const [globalName, file] of scripts) {
    chain = chain.then(() => {
      if (!needs(globalName)) return;
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = scriptUrl(file);
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${file}`));
        document.head.appendChild(script);
      });
    });
  }
  chain.catch(error => console.warn('[HousePieces loader]', error));
})();
