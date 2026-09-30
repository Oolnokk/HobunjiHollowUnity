// Sub-tile movement blockers for areas whose solid props do not line up with
// the 1x1 tile grid. game.js's canOccupyAt() (player, creatures, knockback,
// projectile terrain sweeps) and furnitureBlocksMovementAt() (NPC pathing)
// consult every enabled provider registered here, so a provider only has to
// answer "does this square footprint overlap anything solid?" in tile/world
// units. Providers own their own geometry and spatial indexing. Projectile
// sweeps also pass the shot's world Y so providers can let shots clear
// props lower than (or overhangs higher than) the projectile.
(() => {
  'use strict';

  const providers = new Map(); // id -> { area, blocksBox(x, z, half, worldY, area), enabled() }

  function register(id, provider) {
    if (!id || typeof provider?.blocksBox !== 'function') return () => {};
    providers.set(String(id), provider);
    return () => remove(id);
  }

  function remove(id) {
    providers.delete(String(id));
  }

  // x/z are tile units (world units); half is the half-width of the mover's
  // axis-aligned square footprint in the same units (0 for a point sample).
  // worldY is null for walkers (full-height blocking).
  function blocksBox(area, x, z, half = 0, worldY = null) {
    if (!providers.size) return false;
    for (const provider of providers.values()) {
      if (provider.area != null && provider.area !== area) continue;
      if (provider.enabled && !provider.enabled()) continue;
      if (provider.blocksBox(x, z, Math.max(0, Number(half) || 0), Number.isFinite(worldY) ? worldY : null, area)) return true; // area lets area-agnostic providers answer NPC queries for non-current areas.
    }
    return false;
  }

  // Optional true-floor heights for areas whose grid tiles are flat but whose
  // walkable floor is not (the Random Test Ruin's basins/plateaus). Only
  // projectile ground hits consult this; grid-height readers are unchanged.
  const surfaceProviders = new Map(); // id -> { area, surfaceYAt(x, z), enabled() }
  function registerSurface(id, provider) {
    if (!id || typeof provider?.surfaceYAt !== 'function') return () => {};
    surfaceProviders.set(String(id), provider);
    return () => surfaceProviders.delete(String(id));
  }
  function surfaceYAt(area, x, z) {
    for (const provider of surfaceProviders.values()) {
      if (provider.area != null && provider.area !== area) continue;
      if (provider.enabled && !provider.enabled()) continue;
      const y = provider.surfaceYAt(x, z);
      if (Number.isFinite(y)) return y;
    }
    return null;
  }

  window.AreaFootprintBlockers = Object.freeze({
    register,
    remove,
    registerSurface,
    surfaceYAt,
    blocksBox,
    blocksPoint:(area, x, z) => blocksBox(area, x, z, 0),
    providerIds:() => [...providers.keys()],
  });
})();
