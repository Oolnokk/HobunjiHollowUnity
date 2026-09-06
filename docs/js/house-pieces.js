(() => {
  'use strict';

  // Parser-time entrypoint for the modular-house feature. The stable house
  // architecture core stays separate from optional terrain/elevation glue,
  // while index.html keeps a single long-lived js/house-pieces.js include.
  const current = document.currentScript;
  const baseUrl = current?.src ? new URL('.', current.src) : new URL('js/', document.baseURI);
  const scripts = [
    ['SurfaceTint', 'surface-tint.js?v=20260813c'],
    ['NaturalSurfaceMaterialConfig', '../config/natural-surface-materials.js?v=20260813b'],
    ['NaturalSurfaceTextureReady', 'natural-surface-texture-ready.js?v=20260813a'],
    ['NaturalSurfaceMaterials', 'natural-surface-materials.js?v=20260812a'],
    ['WildernessTerrainCleanupConfig', '../config/wilderness-terrain-cleanup.js?v=20260812a'],
    ['WildernessTerrainCleanup', 'wilderness-terrain-cleanup.js?v=20260812a'],
    ['NaturalSurfaceRuntimeFixes', 'natural-surface-runtime-fixes.js?v=20260813d'],
    // Uses the Furniture + Avatar Author's shared-edge/adjacent-normal surface recognition before mapping one complete PNG square onto each detected natural terrain surface.
    ['HobunjiSurfaceStretchUV', 'surface-stretch-uv-furniture.js?v=20260902a'],
    // A gradual 24° face chain may walk over a rounded ridge, so split upward terrain from cliff-facing triangles before the final side-only unwrap.
    ['NaturalSurfaceCliffRidgeIsolation', 'natural-surface-cliff-ridge-isolation.js?v=20260902a'],
    // Used after every older natural-surface/runtime wrapper so flat fallback textures self-heal and legacy cliff UV repair cannot remain authoritative.
    ['NaturalSurfaceStretchRuntime', 'natural-surface-stretch-runtime.js?v=20260902b'],
    // Natural rocks/cliffs have their own authoritative UV mapper now; keep Terrain Jigsaw from cloning/reinterpreting those finished UVs.
    ['NaturalSurfaceJigsawExclusion', 'natural-surface-jigsaw-exclusion.js?v=20260902a'],
    // Faceted masonry keeps its authored texture-edge treatment and skips the general shell-outline pass; rounded meshes remain eligible for shells.
    ['FacetedStructureShellReduction', 'faceted-structure-shell-reduction.js?v=20260905a'],
    ['StructurePreload', 'structure-preload.js?v=20260812a'],
    ['WildernessSimulationLOD', 'wilderness-simulation-lod.js?v=20260812a'],
    // Keep Cloud Forest mist in the ordinary scene render. The retired soft-depth
    // post-composite pass disabled depth testing and could wash mist over the player
    // and nearby world geometry even when every cylinder surface was behind them.
    // Shoulder-pet layering intentionally disables the player's visible portrait
    // depth writes, so provide a colorless order-889 depth copy before mist 890-892
    // without changing the visible player/pet ordering that relies on depthWrite=false.
    ['CloudForestAvatarDepthOccluder', 'cloud-forest-avatar-depth-occluder.js?v=20260906a'],
    ['OutlineRenderPerformance', 'outline-render-performance.js?v=20260905c'],
    // Rocks and cliffs already use the farm-cliff-style irregular-surface PNG mapper; this policy makes that authored edge treatment authoritative and removes redundant shell participation.
    ['FacetedNaturalSurfaceShellReduction', 'faceted-natural-surface-shell-reduction.js?v=20260905a'],
    ['FarmCliffRockOutline', 'farm-cliff-rock-outline.js?v=20260905a'],
    ['TerrainRenderChunks', 'terrain-render-chunks.js?v=20260812a'],
    // Terrain Jigsaw still exists for other opaque terrain. This final wrapper remains as a safety net for old/untagged natural surfaces before spatial chunking and drawing.
    ['NaturalSurfaceStretchPostJigsaw', 'natural-surface-stretch-post-jigsaw.js?v=20260902b'],
    // Adds canvas.png as one fitted 20%-opacity visual layer across each connected rendered grass surface, reusing HobunjiSurfaceStretchUV rather than stretching separately per farm tile/chunk.
    ['GrassSurfaceCanvasOverlay', 'grass-surface-canvas-overlay.js?v=20260904a'],
    ['BuildingSubtleElevation', 'building-subtle-elevation.js?v=20260811a'],
    ['BuildingGrassSuppression', 'building-grass-suppression.js?v=20260823b'],
    ['PlayerHouseElevation', 'player-house-elevation.js?v=20260823b'],
    ['FarmBuildingElevationParity', 'farm-building-elevation-parity.js?v=20260823a'],
    ['HousePieces', 'house-pieces-core.js?v=20260815b'],
    [null, 'house-pieces-registry-stability.js?v=20260906a'],
    [null, 'house-pieces-elevation-bootstrap.js?v=20260823a'],
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
