(() => {
  'use strict';

  // Grid half of the camera boom's collision (game.js occlusionSafeCameraPosition
  // and its interior radial clearance ring). Extracted out of game.js following
  // the same window.<Namespace> + init(deps) pattern as its sibling systems.
  //
  // The navigation grid is the second authority for collision in addition
  // to visible wall/furniture meshes. Most solid room tiles have no
  // cameraObstacle mesh, and furniture footprints can be collision-solid
  // without any render triangle at the ray's center. Sample the boom
  // through every crossed tile, caching tile-level walkability until the
  // beam enters a new cell. Height bounds prevent a short object acting
  // like an infinitely tall wall.
  let deps = null;

  function init(injectedDeps) { deps = injectedDeps; }

  // Returns the distance along from→to where the boom first enters a blocked
  // tile's height band, or null when the segment is clear (or no grid exists).
  function distance(fromX, fromY, fromZ, toX, toY, toZ, structuralOnly = false) {
    const area = deps?.getCurrentArea?.();
    const grid = deps?.npcGridForArea?.(area) || null;
    if (!grid) return null;
    const dx = toX - fromX, dy = toY - fromY, dz = toZ - fromZ;
    const len = Math.hypot(dx, dy, dz), flat = Math.hypot(dx, dz);
    if (flat < 0.025 || len < 0.025) return null;
    const samples = Math.max(1, Math.min(160, Math.ceil(flat / 0.12))); // Sub-tile heights and near corners cannot slip between adjacent cells.
    let lastC = null, lastR = null, isBlocked = false, floor = 0, roof = 0;
    for (let i = 1; i <= samples; i++) {
      const fraction = i / samples;
      const x = fromX + dx * fraction, z = fromZ + dz * fraction;
      const c = Math.floor(x), r = Math.floor(z);
      if (c !== lastC || r !== lastR) {
        lastC = c; lastR = r;
        const tile = grid[r]?.[c];
        // The same collision-grid authority used by NPC pathing covers
        // manual colliders, structural walls, occupied furniture tiles,
        // closed doors, and area footprint blockers.
        // Radial gameplay checks structural cells only. NPC walkability
        // expands small props to whole tiles, including a clear tile
        // corner occupied by the player. Real meshes supply furniture
        // shape/height; preserve the authored cutscene's grid fallback.
        isBlocked = structuralOnly
          ? !tile || (deps.isSolid(tile.type) && !tile.npcFurnitureCollider)
          : !deps.isNpcTileWalkable(area, c, r);
        if (!isBlocked) continue;
        floor = area === 'interior' ? 0 : tile ? deps.tileSurfaceYInArea(tile, area) : 0;
        const furnitureFootprint = !!tile?.npcFurnitureCollider;
        roof = floor + (area === 'interior' ? deps.interiorWallHeight() : furnitureFootprint ? 1.45 : deps.isBuildingArea(area) ? 2.6 : 1.6);
      }
      if (!isBlocked) continue;
      const y = fromY + dy * fraction;
      if (y >= floor - 0.04 && y <= roof) {
        // Refine the entry distance so dense tile clipping does not make
        // the camera jump in discrete .12-tile increments.
        let before = (i - 1) / samples, after = fraction;
        for (let j = 0; j < 6; j++) {
          const mid = (before + after) * 0.5;
          const mc = Math.floor(fromX + dx * mid), mr = Math.floor(fromZ + dz * mid);
          const my = fromY + dy * mid;
          if (mc === c && mr === r && my >= floor - 0.04 && my <= roof) after = mid;
          else before = mid;
        }
        return len * after;
      }
    }
    return null;
  }

  window.CameraTileCollision = { init, distance };
})();
