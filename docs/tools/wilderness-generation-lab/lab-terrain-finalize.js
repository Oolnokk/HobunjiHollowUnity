(() => {
  'use strict';

  const TerrainPreview = window.TerrainPreview;
  if (!TerrainPreview || TerrainPreview.__wildernessLabTerrainFinalize) return;
  TerrainPreview.__wildernessLabTerrainFinalize = true;

  function cutKeysFromMesas(merged, predicate) {
    if (!Array.isArray(merged?.mesas) || !merged.mesas.length) return 0;
    let removed = 0; // Count is reported in debug metadata so carved corridors can be diagnosed without inspecting geometry.
    for (const mesa of merged.mesas) {
      if (!(mesa.maskWorldKeys instanceof Set)) continue;
      for (const key of [...mesa.maskWorldKeys]) {
        const tile = merged.tiles.get(key);
        if (!predicate(tile, key)) continue;
        mesa.maskWorldKeys.delete(key);
        removed++;
      }
    }
    merged.mesas = merged.mesas.filter(mesa => !(mesa.maskWorldKeys instanceof Set) || mesa.maskWorldKeys.size > 0);
    return removed;
  }

  const previousBuildMergedZoneGrid = TerrainPreview.buildMergedZoneGrid.bind(TerrainPreview); // This wraps the terrain-experiment transform installed just before this module.
  TerrainPreview.buildMergedZoneGrid = (workspace, rootMapId) => {
    const merged = previousBuildMergedZoneGrid(workspace, rootMapId);
    const reports = merged?.wildernessLabTerrainReports || {};
    if (!merged?.rootMap) return merged;

    let mesaCuts = 0;
    if (reports.basin?.applied) {
      // The corrected Great Basin is intentionally one continuous spoon-shaped heightfield.
      // Old generated plateau mesa lids would preserve the former tier layout and obscure the new profile,
      // so the authoring preview renders every merged tile directly and lets buildRockFormationGeometry
      // create the vertical rock faces implied by the new height differences.
      for (const tile of merged.tiles.values()) {
        if (!tile) continue;
        tile.skipFloor = false;
        tile.incline = false;
      }
      mesaCuts += (merged.mesas || []).reduce((sum, mesa) => sum + (mesa.maskWorldKeys?.size || 0), 0);
      merged.mesas = [];
    } else {
      if (reports.river?.applied) {
        for (const tile of merged.tiles.values()) if (tile?.labRiverCarved) tile.skipFloor = false; // Carved river/bank cells must expose their newly lowered floor instead of retaining a plateau lid.
        mesaCuts += cutKeysFromMesas(merged, tile => !!tile?.labRiverCarved);
      }
      if (reports.karst?.applied) {
        for (const tile of merged.tiles.values()) if (tile?.labKarstTowerId) tile.skipFloor = false; // Karst tops render as ordinary high floor quads; rock spans provide their sheer sides.
        mesaCuts += cutKeysFromMesas(merged, tile => !!tile?.labKarstTowerId);
      }
    }

    merged.wildernessLabTerrainFinalize = { mesaCuts, remainingMesas:(merged.mesas || []).length };
    return merged;
  };
})();