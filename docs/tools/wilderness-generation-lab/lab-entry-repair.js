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
