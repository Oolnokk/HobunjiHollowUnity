(() => {
  'use strict';

  const TerrainPreview = window.TerrainPreview;
  if (!TerrainPreview || TerrainPreview.__wildernessLabBasinRampify) return;
  TerrainPreview.__wildernessLabBasinRampify = true;

  const previousBuildMergedZoneGrid = TerrainPreview.buildMergedZoneGrid.bind(TerrainPreview); // Wraps the spoon/river/karst transform and converts only the finished basin floor.
  TerrainPreview.buildMergedZoneGrid = (workspace, rootMapId) => {
    const merged = previousBuildMergedZoneGrid(workspace, rootMapId);
    const basin = merged?.wildernessLabTerrainReports?.basin;
    if (!basin?.applied) return merged;

    const carvedTypes = new Set(['river', 'stream', 'waterfall', 'trench', 'raised']); // These keep their authored carved geometry and merely inherit the spoon tier.
    let rampTiles = 0;
    for (const tile of merged.tiles.values()) {
      if (!tile || tile.labKarstTowerId || carvedTypes.has(tile.type)) continue;
      const height = tile.type === 'ramp' ? Number(tile.rampElevation) || 0 : Number(tile.elevTier) || 0; // Spoon profile already computed the desired absolute tier before this conversion.
      tile.type = 'ramp';
      tile.rampElevation = height;
      tile.elevTier = 0;
      tile.incline = false;
      tile.skipFloor = false;
      tile.labSurfaceMaterial = 'grass';
      tile.labGreatBasinRampField = true;
      rampTiles++;
    }
    merged.wildernessLabTerrainReports.basin.rampTiles = rampTiles;
    return merged;
  };
})();