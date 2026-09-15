(() => {
  'use strict';

  // Economy progression guardrails. Actual item sell values still live with
  // their item definitions (fish-catalog.js, ITEM_DEFS, processors, etc.) and
  // actual shop buy prices still live in config/shops/shop-stock.json. This
  // file defines the intended relationship between those independent values
  // so balance tests can catch drift without inventing a second price table.
  const config = {
    schema: 'hobunji_economy_progression.v1',
    referenceFishing: {
      zone: 'farm', // Used as the low-level shore-fishing baseline available from the start.
      allowAmphibious: false, // Used to exclude Gurumahi's combat-risk premium from the beginner income target.
      successfulCatchesPerDaylightDay: 25, // Used as the no-perk/low-level throughput target across a full non-night fishing day.
      seasons: ['spring', 'summer', 'fall', 'winter'], // Used to average seasonal fish availability rather than balancing around one lucky season.
      daylightSegmentsHours: { dawn: 2, day: 9, dusk: 3 }, // Used to mirror fishingTimeOfDay(): 06-08 dawn, 08-17 day, 17-20 dusk.
      rarityWeights: { common: 6, uncommon: 3, rare: 1 }, // Used to mirror fishing-minigame.js's no-perk rarity roll weights.
    },
    targets: {
      growthTonicsPerFishingDay: { target: 3.75, min: 3.5, max: 4.0 }, // Used to preserve the established beginner fishing-income guardrail after Growth Tonic moved from 500g to 200g.
      incubatorFishingDays: { target: 7, min: 6.25, max: 7.5 }, // Used to keep the Incubator at roughly one week of all-day fishing if nothing else is bought.
    },
  };

  window.ECONOMY_PROGRESSION_CONFIG = config;
})();
