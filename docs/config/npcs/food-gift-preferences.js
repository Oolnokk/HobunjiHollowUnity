// NPC food-gift preferences — authored category/artisan/specific-ingredient likes.
// Runtime evaluation lives in js/npc-gifting.js; this file only owns reusable data.
(function (global) {
  'use strict';
  if (global.HobunjiNpcFoodGiftPreferences) return;

  global.HobunjiNpcFoodGiftPreferences = Object.freeze({
    version: 1,

    // Additive reaction weights. Specific ingredient likes intentionally carry
    // more weight than broad categories, and become stronger again when that
    // ingredient survives into an artisan good such as wine or jerky.
    weights: Object.freeze({
      ingredientType: 4,
      artisanType: 4,
      specificIngredient: 8,
      specificIngredientArtisan: 12,
    }),

    ingredientTypeLabels: Object.freeze({
      meat: 'Meat',
      poultry: 'Poultry',
      fish: 'Fish',
      mollusk: 'Mollusks',
      egg: 'Eggs',
      spice: 'Spices',
      herb: 'Herbs',
      grain: 'Grain',
      vegetable: 'Vegetables',
      fruit: 'Fruit',
      berry: 'Berries',
      dairy: 'Dairy',
      cheese: 'Cheese',
      nut: 'Nuts',
    }),

    artisanTypeLabels: Object.freeze({
      alcohol: 'Alcohol',
      jerky: 'Jerky',
    }),

    // Species-wide defaults layer underneath per-NPC likes.
    speciesLikes: Object.freeze({
      'engh-sho': Object.freeze({ ingredientTypes: Object.freeze(['meat']) }),
      'mao-ao': Object.freeze({ ingredientTypes: Object.freeze(['fish']) }),
      kenkari: Object.freeze({ ingredientTypes: Object.freeze(['fish']) }),
    }),

    // NPC-specific artisan likes layer on top of species defaults.
    npcLikes: Object.freeze({
      pahu: Object.freeze({ artisanTypes: Object.freeze(['alcohol']) }),
      hreesh: Object.freeze({ artisanTypes: Object.freeze(['alcohol']) }),
      tooth_hatayap: Object.freeze({ artisanTypes: Object.freeze(['alcohol']) }),
    }),
  });
})(window);
