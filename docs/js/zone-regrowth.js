(() => {
  'use strict';

  // Wilderness zone ground-visual refresh after a runtime tile edit
  // (updateClearedZoneVegetationVisual/refreshZoneGroundVisuals) and the
  // daily felled-tree/mined-rock regrowth ticks that call back into it
  // (tickFelledTreeRegrowth/tickMinedRockRegrowth), extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern as
  // its siblings. Every Map here (_zoneScenes/_zoneFloorMeshGroups/
  // _zoneGrassMeshes/_zoneFelledTreePersist/_zoneMinedRockPersist) is a
  // `const Map()` never reassigned wholesale, so all are passed by direct
  // reference; currentArea/calendar are read-only here too (getters).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function updateClearedZoneVegetationVisual(mapId, col, row, previousType) {
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return false;
    const removedFoliage = deps.removeZoneVegetationVisual(mapId, col, row);
    if (previousType !== deps.TileType.WEEDS) return removedFoliage;

    // WEEDS are part of the zone's merged material buckets rather than
    // individual foliage groups. Cover only the cleared tile with a
    // grass patch; the next ordinary terrain refresh folds it back into
    // the merged grass mesh. This keeps a weapon swing O(AoE tiles)
    // instead of O(the entire wilderness map).
    const tile = zi.grid?.[row]?.[col];
    if (!tile) return removedFoliage;
    const geometry = window.TerrainGeometry.makeFloorGeo(col, row); // Used by the one-tile grass cover mesh below.
    deps.displaceZoneGeometry(geometry, mapId, col + 0.5, row + 0.5);
    const patch = new THREE.Mesh(geometry, deps.resolveTileMat(mapId, deps.TileType.GRASS)); // Covers the stale merged WEEDS surface.
    patch.receiveShadow = true;
    patch.position.set(
      col + 0.5,
      deps.tileYCenter(deps.TileType.GRASS) + (tile.elevTier || 0) * deps.PLATEAU_UNIT + 0.008,
      row + 0.5
    );
    if (!window.WildernessChunks?.attachObject(mapId, col, row, patch)) zi.scene.add(patch);
    deps.markTerrainEdgeId(patch, deps.TileType.GRASS);
    deps._zoneFloorMeshGroups.get(mapId)?.push(patch);
    return true;
  }

  // Rebuilds just a zone's ground floor + grass tufts (see
  // _buildZoneFloorMeshes/_buildZoneGrassBillboards) from its current
  // grid, in place — used after a shovel/pick action changes a tile's
  // type at runtime (digging/filling/raising — see applyAction) while
  // standing inside a wilderness zone. A zone's terrain is built once as
  // merged meshes rather than the farm's per-tile mesh array, so without
  // this a freshly dug trench would be "physically" real (tile.type/
  // height read live every frame) while its grass never disappears —
  // the player would see themselves sink through still-standing grass.
  // Deliberately narrower than _disposeZoneScene + buildZoneScene: it
  // leaves buildings/decor/creatures/NPCs/reagents/berries/treasure
  // alone, so it's safe to call immediately while the player is
  // standing in the zone (unlike a full zone rebuild — see
  // _dirtyZoneScenes' comments on why that's deferred to zone re-entry).
  function refreshZoneGroundVisuals(mapId, col = null, row = null) {
    const zi = deps._zoneScenes.get(mapId);
    if (!zi) return;
    if (zi.chunkController && window.WildernessChunks) {
      // The route network's grass apron is zone-wide, but its index ranges
      // are recorded per tile when it is first built. Toggle this edited
      // tile and its one-cell cliff seam instead of regenerating the entire
      // route heightfield (which previously froze large wilderness maps
      // for several seconds). Filling/smoothing restores the original
      // indices through the same path.
      window.ZonePlateauMesa.rebuildZoneMesaMeshes(mapId); // Re-tags exact steep-face ownership before the apron decides whether this tile belongs to rock.
      const routeApronUpdated = zi.pathNet?.refreshTileAndSeam?.(col, row) || false; // Reported in the mobile-visible debug log below.
      // The live grid already contains the authoritative edit. Rebuild
      // only its resident chunk plus one-chunk seam halo; unloaded chunks
      // will naturally read the updated grid when they are next streamed.
      const rebuiltChunks = window.WildernessChunks.rebuildZone(mapId, col, row); // Reported below to diagnose future mobile-only refresh failures.
      window.WildTreasure.syncZoneInteractivity(mapId);
      deps.debugLog(`[terrain-refresh] ${mapId} c${col},r${row}: routeApron=${routeApronUpdated ? 'updated' : 'outside'} chunks=${rebuiltChunks}`);
      return;
    }
    window.ZonePlateauMesa.rebuildZoneMesaMeshes(mapId); // Refresh geometry-derived cliff ownership before rebuilding ordinary/path ground.
    const oldFloor = deps._zoneFloorMeshGroups.get(mapId);
    if (oldFloor) for (const mesh of oldFloor) { zi.scene.remove(mesh); mesh.traverse?.(o => { if (o.geometry) o.geometry.dispose(); }); if (mesh.geometry) mesh.geometry.dispose(); }
    const oldGrass = deps._zoneGrassMeshes.get(mapId);
    if (oldGrass) { zi.scene.remove(oldGrass); oldGrass.geometry?.dispose(); }
    deps._zoneFloorMeshGroups.set(mapId, deps._buildZoneFloorMeshes(zi.scene, zi.grid, zi.cols, zi.rows, mapId));
    deps._zoneGrassMeshes.set(mapId, window.ZoneGrassBillboards.buildZoneGrassBillboards(zi.scene, zi.grid, zi.cols, zi.rows));
    // Re-derive canopy clamp zones and cullables (see buildZoneScene) — a
    // felled tree's mesh is gone after this rebuild, and leaving its stale
    // entries around would keep hard-limiting zoom / culling nothing over
    // an empty stump.
    const canopyZones = [];
    zi.scene.traverse(o => { if (o.userData?.canopyClamp) canopyZones.push(o.userData.canopyClamp); });
    zi.canopyZones = canopyZones;
    const cullables = [];
    zi.scene.traverse(o => { if (o.userData?.cullSphere) cullables.push(o); });
    zi.cullables = cullables;
    // The mesa rebuild above also keeps a dug/filled plateau-top lid from
    // covering or exposing the wrong side of a real trench.
    // A dig/fill/raise here may have just turned a buried chest's tile
    // into (or out of) a real trench — see syncZoneTreasureInteractivity.
    window.WildTreasure.syncZoneInteractivity(mapId);
  }

  // Regrows trees felled with the axe once TREE_REGROWTH_DAYS have
  // passed (see _zoneFelledTreePersist/applyAction's axe branch).
  // Called once per day from advanceDay()/sleepInBed(), the same
  // trigger tickCropDay() uses for the farm grid's crop aging.
  function tickFelledTreeRegrowth() {
    for (const [mapId, entries] of deps._zoneFelledTreePersist) {
      if (!entries.length) { deps._zoneFelledTreePersist.delete(mapId); continue; }
      const zi = deps._zoneScenes.get(mapId);
      // Zone isn't currently built (never visited this session, or its
      // scene was disposed) — nothing to mutate live. Leave every entry
      // exactly as-is; buildZoneScene re-derives due/not-due from
      // feltDay itself the next time this zone is actually built (see
      // there), so dropping entries here without a grid to apply them
      // to would just lose the regrowth timer entirely.
      if (!zi) continue;
      const stillFelled = [];
      let regrewAny = false;
      for (const entry of entries) {
        if (deps.calendar.day - entry.feltDay < deps.TREE_REGROWTH_DAYS) { stillFelled.push(entry); continue; }
        if (zi.grid?.[entry.row]?.[entry.col]) zi.grid[entry.row][entry.col].type = deps.TileType.SHRUB;
        regrewAny = true;
      }
      if (stillFelled.length) deps._zoneFelledTreePersist.set(mapId, stillFelled);
      else deps._zoneFelledTreePersist.delete(mapId);
      if (regrewAny && mapId === deps.getCurrentArea()) refreshZoneGroundVisuals(mapId);
    }
  }

  // Regrows ore rocks broken with the pick once ROCK_REGROWTH_DAYS have
  // passed — mirrors tickFelledTreeRegrowth above for ROCK/rockKind.
  function tickMinedRockRegrowth() {
    for (const [mapId, entries] of deps._zoneMinedRockPersist) {
      if (!entries.length) { deps._zoneMinedRockPersist.delete(mapId); continue; }
      const zi = deps._zoneScenes.get(mapId);
      if (!zi) continue;
      const stillMined = [];
      let regrewAny = false;
      for (const entry of entries) {
        if (deps.calendar.day - entry.minedDay < deps.ROCK_REGROWTH_DAYS) { stillMined.push(entry); continue; }
        if (zi.grid?.[entry.row]?.[entry.col]) zi.grid[entry.row][entry.col].type = deps.TileType.ROCK;
        regrewAny = true;
      }
      if (stillMined.length) deps._zoneMinedRockPersist.set(mapId, stillMined);
      else deps._zoneMinedRockPersist.delete(mapId);
      if (regrewAny && mapId === deps.getCurrentArea()) refreshZoneGroundVisuals(mapId);
    }
  }

  window.ZoneRegrowth = {
    init,
    updateClearedZoneVegetationVisual,
    refreshZoneGroundVisuals,
    tickFelledTreeRegrowth,
    tickMinedRockRegrowth,
  };
})();
