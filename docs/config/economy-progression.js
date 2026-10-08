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
    referenceFarming: {
      plots: 30, // Used as an early-game field: roughly what a player tills in their first week.
      midGamePlots: 60, // Used by skillPacing as a mid-game field's daily harvest volume.
    },
    targets: {
      growthTonicsPerFishingDay: { target: 3.75, min: 3.5, max: 4.0 }, // Used to preserve the established beginner fishing-income guardrail after Growth Tonic moved from 500g to 200g.
      incubatorFishingDays: { target: 7, min: 6.25, max: 7.5 }, // Used to keep the Incubator at roughly one week of all-day fishing if nothing else is bought.
      // Farming: income scales with land instead of time, so a plot should
      // net a few ganang per day after seed cost; an early field is a solid
      // side income and a ~100-plot farm rivals a full day of fishing.
      boughtSeedCropNetPerPlotDay: { min: 5, max: 8 }, // Net of seed cost, at 3-star value, for crops whose seed is sold.
      boughtSeedCropSpread: { max: 1.35 }, // Best/worst net per plot-day: no single crop should dominate.
      wildSeedCropNetPerPlotDay: { min: 7, max: 11 }, // Berries need ditches and wild-found seed, so they earn a premium.
      earlyFieldShareOfFishingDay: { min: 0.2, max: 0.4 }, // referenceFarming.plots of average crops vs a beginner fishing day.
      seedCostShareOfCrop: { min: 0.15, max: 0.3 }, // Per-seed price / crop sell value.
      startingGoldCoversOneOfEachSeedPack: true,
      stapleRetailOverSell: { min: 1.25 }, // General-store staple price / base 3-star sell value: no buy-then-ship profit.
      processingGainAtCheapInput: { min: 1.25 }, // Every processor's output / input value at a 10g input...
      processingGainAtExpensiveInput: { min: 1.25 }, // ...and at a 60g input (old flat +N offsets failed this).
      cookedDishPremium: { min: 1.15, max: 1.6 }, // Dish base value / summed ingredient base values.
      // Big-ticket purchases, in beginner fishing days, should climb as a ladder.
      purchaseFishingDays: {
        houseSmallRoom: { min: 0.75, max: 2 },
        barnMedium: { min: 2.5, max: 4.5 },
        houseLargeWing: { min: 3, max: 5 },
        barnLarge: { min: 5, max: 7 },
      },
      bountyTierFishingDays: { min: 0.2, max: 1.6 }, // Clearing a bandit camp, lowest to highest tier.
    },
    // Skill pacing: XP per focused in-game day (672 real seconds) of one
    // activity. Action counts are design assumptions, not measurements;
    // re-tune them from playtest data. Combat is intentionally slower
    // (SkillSystem.XP_GAIN_MULTIPLIERS.combat) and not covered here.
    skillPacing: {
      actionsPerFocusedDay: {
        fishing: { fish: 25 }, // Same as referenceFishing.successfulCatchesPerDaylightDay.
        foraging: { tree: 18, forage: 15 },
        mining: { rock: 22 },
        farming: { crop: 'midGameHarvests', dig: 10 }, // Harvests derived from referenceFarming.midGamePlots / average growDays.
        cooking: { cook: 20 },
      },
      daysToLevel10: { min: 4, max: 10 },
      daysToLevel20: { min: 18, max: 40 },
    },
  };

  window.ECONOMY_PROGRESSION_CONFIG = config;
})();
