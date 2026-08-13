(() => {
  'use strict';

  // Wilderness rendering cleanup / cliff-shape tuning.
  //
  // `slopeWidthTiles` controls how far the bottom of the old vertical
  // ramp/tier rock sheet spreads toward the lower side. 1.0 is one full tile,
  // matching the broad frustum language used by plateau cliffs.
  window.WildernessTerrainCleanupConfig = {
    hideLegacyWeedSlabs: true,
    naturalizeLegacyRockTiles: true,
    naturalizeDenMounds: true,
    frustumRockFormation: {
      enabled: true,
      slopeWidthTiles: 0.82,
      middleFraction: 0.50
    }
  };
})();
