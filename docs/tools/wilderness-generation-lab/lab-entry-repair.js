(() => {
  'use strict';

  const Preview = window.WildernessLabPreview;
  if (!Preview || Preview.__entryRepairAssertionInstalled) return;
  Preview.__entryRepairAssertionInstalled = true;

  const LIVE_ZONE_BY_RECIPE = Object.freeze({
    liveNorthernCliffs: 'map_northern_cliffs',
    liveSouthernCloudForest: 'map_southern_cloud_forest',
    liveWesternSlope: 'map_western_slope',
    liveEasternMire: 'map_eastern_mire',
  });

  const previousRender = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = (workspace, ...args) => {
    const repair = window.WildernessEntryCorridor;
    if (workspace && repair?.applyWorkspace) {
      const recipeId = document.getElementById('recipeSelect')?.value || '';
      const zoneId = LIVE_ZONE_BY_RECIPE[recipeId] || workspace?.wildernessLabLiveRecipe?.zoneId || null;
      // Game's north-wall replacement is independent of the over-wide approach
      // causeway. Apply both to the SAME exported tiles before any 3D markers
      // are derived; CloudForestRuntimeV2 only wraps generateZoneWorkspace,
      // whereas the standalone Lab calls generateWorkspace.
      if (zoneId === 'map_southern_cloud_forest' && window.CloudForestRuntimeV2?.removeCloudForestNorthCliffs) {
        const northRepair = window.CloudForestRuntimeV2.removeCloudForestNorthCliffs(workspace);
        workspace.wildernessLabCloudForestNorthRepair = {
          ...northRepair,
          backfilledTrees: workspace.maps?.find(map => !map.isSubmap)?.generatedFrom?.northBoundaryForestTrees || 0,
        };
      }
      const result = repair.applyWorkspace(workspace, { zoneId });
      workspace.wildernessLabEntryRepairObserved = {
        available: true,
        recipeId,
        zoneId,
        result,
      };
      if (result?.applied) {
        console.log('[WildernessLab] Applied shared exported-path causeway repair before preview:', result);
      }
    } else if (workspace) {
      workspace.wildernessLabEntryRepairObserved = {
        available: false,
        reason: 'WildernessEntryCorridor not loaded yet',
      };
    }
    return previousRender(workspace, ...args);
  };
})();
