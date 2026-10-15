// Finite projectile cover heights for solid terrain tiles (moved out of
// game.js). Projectile sweeps pass a world-space Y into game.js's
// tileSpeedAt/canOccupyAt; a solid tile only stops the shot while that Y is
// at or below the tile's cover top. Rocks use the generated mound/shell
// height cached on the tile (tile.projectileCoverHeightTiles, written by the
// rock/boulder geometry builders), choppable trees and cavern walls are
// infinitely tall, and decorative shrubs provide no cover at all. The same
// two functions feed DebugHitboxes' projectile-cover overlay so the drawn
// volume is exactly the gameplay one.
//
// game.js calls init(deps) once its terrain height constants exist.
(() => {
  'use strict';

  let deps = null; // { TileType, NORMAL_TOP, PLATEAU_UNIT, ROCK_H, isChoppableTreeTile, isCavernBuildingArea, getCurrentArea }

  function init(injectedDeps) { deps = injectedDeps; }

  // Floor height a rock/shrub tile's cover volume starts from.
  function coverBase(tile) {
    return Number.isFinite(Number(tile.surfaceY)) ? Number(tile.surfaceY) : deps.NORMAL_TOP + (tile.elevTier || 0) * deps.PLATEAU_UNIT;
  }

  // World-space Y of a solid tile's projectile cover top; null = no cover.
  function coverTop(tile, col, row) {
    if (tile?.type === deps.TileType.SHRUB) return deps.isChoppableTreeTile(col, row) ? Infinity : null;
    if (tile?.type !== deps.TileType.ROCK) return null;
    if (deps.isCavernBuildingArea(deps.getCurrentArea()) && tile.rockKind !== 'diggableRockOre') return Infinity;
    const baseY = coverBase(tile); // Same base used by rock renderers and debug volumes.
    const coverHeight = Number(tile.projectileCoverHeightTiles) || (tile.rockKind === 'undiggableBoulder' ? 1.46 : deps.ROCK_H); // Cached generated mound/shell height, with finite defaults before chunks load.
    return baseY + coverHeight;
  }

  window.ProjectileTileCover = { init, coverBase, coverTop };
})();
