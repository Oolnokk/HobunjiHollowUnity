(() => {
  'use strict';

  // Cave interior shape tuning, read by docs/js/cavern-generator.js each time
  // a cave or mine floor is carved (procedural dens, cave sites and town-mine
  // floors; authored locale caves keep their own shape).
  //
  // Heights are multiples of the original carved shell height.
  //   fullHeightScale     - roof height right around a ruin door.
  //   minHeightFraction   - every other cave (and ruin caves away from the
  //                         door) is carved at this fraction of the full
  //                         height. 0.6 of 2.5 = 1.5x the original shell.
  //   tallRadiusTiles     - [full height within, eased down to the minimum by]
  //                         tiles from a ruin door.
  //   entranceOpenSideColumns - extra solid columns opened on EACH side of a
  //                         procedural cave mouth; 0 keeps the original width.
  //
  // Changing these only affects caves carved afterwards; already-visited
  // caves are re-carved the next time the page loads.
  window.HobunjiCaveShapeConfig = {
    fullHeightScale: 2.5,
    minHeightFraction: 0.6,
    tallRadiusTiles: [6, 16],
    entranceOpenSideColumns: 2,
  };
})();
