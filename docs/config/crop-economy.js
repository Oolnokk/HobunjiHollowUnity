(() => {
  'use strict';

  // Crop sale values (3-star base, before CookingSystem.valueMultiplierForStars).
  // Single source for game.js's BASE_PRICES (shipping/store sale table) and
  // the crop entries in ITEM_DEFS, which used to repeat these numbers.
  // Balanced against beginner fishing income: see
  // config/economy-progression.js and scripts/test-economy-progression.js.
  const sellPrices = Object.freeze({
    needlegrain: 24, heftroot: 34, garlink: 22, ongyums: 22,
    redberries: 36, blueberries: 38, yellowberries: 36, whiteberries: 42, blackberries: 42,
    blackMustard: 28, greenMustard: 26,
  });

  window.HOBUNJI_CROP_ECONOMY = Object.freeze({ sellPrices });
})();
