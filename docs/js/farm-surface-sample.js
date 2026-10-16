// Continuous farm ground height at any world X/Z: the tile's gameplay surface
// with the shared house+barn subtle-elevation sample swapped in for the
// tile-centre lift already baked into elevTier. Extracted from game.js
// (farmSurfaceYAtWorld), wired back via FarmSurfaceSample.init(deps).
(() => {
  'use strict';

  let deps = null; // { getGrid, tileSurfaceYInArea, TileType }

  function init(injectedDeps) { deps = injectedDeps; }

  // The farmhouse/barn heightfield is also baked into farm tile elevTier
  // at each tile CENTER so legacy grounding keeps working. Consumers that
  // render between centers must replace that baked center sample with the
  // exact continuous sample, not add the exact sample on top a second time.
  function farmSurfaceYAtWorld(worldX, worldZ) {
    if (!deps) return 0;
    const x = Number(worldX); // Exact world X used by furniture, seats, and other smooth farm-surface followers.
    const z = Number(worldZ); // Exact world Z paired with x for the continuous building-height sample.
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const col = Math.floor(x); // Tile column used to recover the ordinary gameplay surface beneath the subtle hill.
    const row = Math.floor(z); // Tile row paired with col for the same base-surface lookup.
    const tile = deps.getGrid()?.[row]?.[col];
    if (!tile) return 0;
    const tileSurface = deps.tileSurfaceYInArea(tile, 'farm'); // Includes real plateau/ramp state plus any center-sampled house lift already baked into elevTier.
    const sampler = window.HobunjiFarmSubtleElevation?.sampleHeightAt; // Existing shared house+barn continuous sampler; no parallel heightfield is created here.
    if (typeof sampler !== 'function') return tileSurface;
    const exactLift = Number(sampler(x, z)) || 0; // Replaces the tile-center approximation at this rendered X/Z.
    const centerLift = tile.type === deps.TileType.RAMP
      ? 0
      : (Number(sampler(col + 0.5, row + 0.5)) || 0); // Non-ramp elevTier already contains this exact center contribution.
    return tileSurface + exactLift - centerLift;
  }

  window.FarmSurfaceSample = { init, farmSurfaceYAtWorld };
})();
