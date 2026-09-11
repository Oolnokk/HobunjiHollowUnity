(() => {
  'use strict';

  // Data and rules for cooking-adjacent processing that do not need access to
  // game.js's private world state. The host passes the active item definition,
  // area, RNG, and skill API through the narrow functions below.
  const SQUEEZING_VAT = Object.freeze({
    name: 'Squeezing Vat',
    desc: 'Placeable vat for squeezing berries and dew, pressing tree nuts into oil, and rendering meat or fish into cooking fats.',
  });

  const BUTTER_CHURN = Object.freeze({
    furnitureKey: 'butterChurn',
    itemKey: 'butterChurnFurniture',
    blueprintKey: 'butterChurnFurnitureBlueprint',
    name: 'Butter Churn',
    icon: '🧈',
    method: 'churning',
    color: 0x7A5732,
    desc: 'Open-barrel churn for turning white milk into butter and cooking oils into margarine.',
    price: 28,
  }); // Used by the runtime registry, carpenter blueprint, placer, and diagnostics below.

  const TREE_NUTS_BY_AREA = Object.freeze({
    map_northern_cliffs: Object.freeze({
      itemKey: 'crownedPineNuts',
      label: 'Crowned Pine Nuts',
      treeLabel: 'crowned pine',
    }),
    map_southern_cloud_forest: Object.freeze({
      itemKey: 'shadewoodNuts',
      label: 'Shadewood Nuts',
      treeLabel: 'shadewood tree',
    }),
  }); // Used to keep each wilderness tree paired with its own edible nut.

  const NUT_OILS = Object.freeze({
    crownedPineNuts: Object.freeze({ key: 'crownedPineNutOil', label: 'Crowned Pine Nut Oil', color: 0xD6B66A }),
    shadewoodNuts: Object.freeze({ key: 'shadewoodNutOil', label: 'Shadewood Nut Oil', color: 0x8F6A3F }),
  }); // Used to produce distinct oils instead of collapsing both trees into generic Nut Oil.

  const EXPANDED_MEAL_RECIPES = Object.freeze([
    {
      id: 'hearthPancakes',
      name: 'Hearth Griddle Cakes',
      description: 'Flour, egg, and white milk cooked into simple pancakes or griddle cakes.',
      baseOutputName: 'Hearth Griddle Cakes',
      slots: [
        { id: 'flour', label: 'Flour', accepts: ['flour'], required: true },
        { id: 'egg', label: 'Egg', accepts: ['egg'], required: true },
        { id: 'milk', label: 'White Milk', accepts: ['whiteMilk'], required: true },
      ],
      outputTags: ['Meal', 'Breakfast', 'Griddle'],
    },
    {
      id: 'sweetCustard',
      name: 'Sweet Custard',
      description: 'Egg, white milk, and something sweet cooked down into a soft custard.',
      baseOutputName: 'Sweet Custard',
      slots: [
        { id: 'egg', label: 'Egg', accepts: ['egg'], required: true },
        { id: 'milk', label: 'White Milk', accepts: ['whiteMilk'], required: true },
        { id: 'sweetPaste', label: 'Sweet Paste', accepts: ['sweetPaste'], required: true },
      ],
      outputTags: ['Meal', 'Dessert', 'Sweet'],
    },
    {
      id: 'eggToast',
      name: 'Egg Toast',
      description: 'Bread and egg fried together with cooking fat; somewhere between egg-on-toast and French toast.',
      baseOutputName: 'Egg Toast',
      slots: [
        { id: 'bread', label: 'Bread', accepts: ['bread'], required: true },
        { id: 'egg', label: 'Egg', accepts: ['egg'], required: true },
        { id: 'fat', label: 'Oil / Butter', accepts: ['oil', 'butter'], required: true },
      ],
      outputTags: ['Meal', 'Breakfast', 'Fried'],
    },
    {
      id: 'cheeseToast',
      name: 'Cheese Toast',
      description: 'Bread, cheese, and butter toasted together into a simple grilled-cheese-style meal.',
      baseOutputName: 'Cheese Toast',
      slots: [
        { id: 'bread', label: 'Bread', accepts: ['bread'], required: true },
        { id: 'cheese', label: 'Cheese', accepts: ['cheese'], required: true },
        { id: 'butter', label: 'Butter / Margarine', accepts: ['butter'], required: true },
      ],
      outputTags: ['Meal', 'Comfort', 'Toasted'],
    },
    {
      id: 'savorySandwich',
      name: 'Savory Sandwich',
      description: 'Bread with a protein, vegetables, and a sauce or pungent spread.',
      baseOutputName: 'Savory Sandwich',
      slots: [
        { id: 'bread', label: 'Bread', accepts: ['bread'], required: true },
        { id: 'protein', label: 'Meat / Poultry / Fish', accepts: ['meat', 'poultry', 'fish', 'mollusk'], required: true },
        { id: 'veg', label: 'Vegetable', accepts: ['vegetable'], required: true },
        { id: 'sauce', label: 'Sauce / Spread', accepts: ['sauce', 'mayonnaise', 'pungentPaste'], required: true },
      ],
      outputTags: ['Meal', 'Bread', 'Portable'],
    },
    {
      id: 'gardenSalad',
      name: 'Garden Salad',
      description: 'Fresh vegetables dressed with oil and herbs or spice.',
      baseOutputName: 'Garden Salad',
      slots: [
        { id: 'veg', label: 'Vegetable', accepts: ['vegetable'], required: true },
        { id: 'oil', label: 'Oil', accepts: ['oil'], required: true },
        { id: 'herb', label: 'Herb / Spice', accepts: ['herb', 'spice'], required: true },
      ],
      outputTags: ['Meal', 'Fresh', 'Vegetable'],
    },
    {
      id: 'vegetableSoup',
      name: 'Vegetable Soup',
      description: 'Vegetables simmered with a broth base and herbs or spice.',
      baseOutputName: 'Vegetable Soup',
      slots: [
        { id: 'veg', label: 'Vegetable', accepts: ['vegetable'], required: true },
        { id: 'broth', label: 'Broth Base', accepts: ['brothBase'], required: true },
        { id: 'herb', label: 'Herb / Spice', accepts: ['herb', 'spice'], required: true },
      ],
      outputTags: ['Meal', 'Soup', 'Vegetable'],
    },
    {
      id: 'roastDinner',
      name: 'Roast Dinner',
      description: 'A meat or poultry roast with a root or starch, vegetables, and seasoning.',
      baseOutputName: 'Roast Dinner',
      slots: [
        { id: 'protein', label: 'Meat / Poultry', accepts: ['meat', 'poultry'], required: true },
        { id: 'starch', label: 'Root / Starch Vegetable', accepts: ['starchVegetable'], required: true },
        { id: 'veg', label: 'Vegetable', accepts: ['vegetable'], required: true },
        { id: 'spice', label: 'Spice / Herb', accepts: ['spice', 'herb'], required: true },
      ],
      outputTags: ['Meal', 'Roasted', 'Heavy'],
    },
    {
      id: 'breakfastHash',
      name: 'Breakfast Hash',
      description: 'A fried hash of starch, egg, meat or poultry, and vegetables.',
      baseOutputName: 'Breakfast Hash',
      slots: [
        { id: 'starch', label: 'Root / Starch Vegetable', accepts: ['starchVegetable'], required: true },
        { id: 'egg', label: 'Egg', accepts: ['egg'], required: true },
        { id: 'protein', label: 'Meat / Poultry', accepts: ['meat', 'poultry'], required: true },
        { id: 'veg', label: 'Vegetable', accepts: ['vegetable'], required: true },
      ],
      outputTags: ['Meal', 'Breakfast', 'Skillet'],
    },
    {
      id: 'savorySkewers',
      name: 'Savory Skewers',
      description: 'Seasoned chunks of meat or poultry cooked with vegetables on skewers.',
      baseOutputName: 'Savory Skewers',
      slots: [
        { id: 'protein', label: 'Meat / Poultry', accepts: ['meat', 'poultry'], required: true },
        { id: 'veg', label: 'Vegetable', accepts: ['vegetable'], required: true },
        { id: 'spice', label: 'Spice / Herb', accepts: ['spice', 'herb'], required: true },
      ],
      outputTags: ['Meal', 'Roasted', 'Portable'],
    },
    {
      id: 'fishStew',
      name: 'Fish Stew',
      description: 'Fish or mollusk simmered in broth with vegetables and seasoning.',
      baseOutputName: 'Fish Stew',
      slots: [
        { id: 'fish', label: 'Fish / Mollusk', accepts: ['fish', 'mollusk'], required: true },
        { id: 'broth', label: 'Broth Base', accepts: ['brothBase'], required: true },
        { id: 'veg', label: 'Vegetable', accepts: ['vegetable'], required: true },
        { id: 'spice', label: 'Spice / Herb', accepts: ['spice', 'herb'], required: true },
      ],
      outputTags: ['Meal', 'Stew', 'Seafood'],
    },
    {
      id: 'sweetBreadPudding',
      name: 'Sweet Bread Pudding',
      description: 'Bread baked with egg, milk or sweet liquid, and a sweet paste.',
      baseOutputName: 'Sweet Bread Pudding',
      slots: [
        { id: 'bread', label: 'Bread', accepts: ['bread'], required: true },
        { id: 'egg', label: 'Egg', accepts: ['egg'], required: true },
        { id: 'liquid', label: 'White Milk / Sweet Liquid', accepts: ['whiteMilk', 'sweetLiquid'], required: true },
        { id: 'sweetPaste', label: 'Sweet Paste', accepts: ['sweetPaste'], required: true },
      ],
      outputTags: ['Meal', 'Dessert', 'Baked', 'Sweet'],
    },
    {
      id: 'hearthFlatbread',
      name: 'Topped Flatbread',
      description: 'Bread toasted with cheese, a savory sauce, and a vegetable or spice topping; broadly pizza-like.',
      baseOutputName: 'Topped Flatbread',
      slots: [
        { id: 'bread', label: 'Bread', accepts: ['bread'], required: true },
        { id: 'cheese', label: 'Cheese', accepts: ['cheese'], required: true },
        { id: 'sauce', label: 'Sauce / Pungent Paste', accepts: ['sauce', 'pungentPaste'], required: true },
        { id: 'topping', label: 'Vegetable / Spice', accepts: ['vegetable', 'spice'], required: true },
      ],
      outputTags: ['Meal', 'Bread', 'Toasted'],
    },
    {
      id: 'stuffedDumplings',
      name: 'Stuffed Dumplings',
      description: 'Flour dough wrapped around a meat, poultry, or vegetable filling with seasoning.',
      baseOutputName: 'Stuffed Dumplings',
      slots: [
        { id: 'flour', label: 'Flour', accepts: ['flour'], required: true },
        { id: 'filling', label: 'Meat / Poultry / Vegetable', accepts: ['meat', 'poultry', 'vegetable'], required: true },
        { id: 'seasoning', label: 'Spice / Pungent Paste', accepts: ['spice', 'pungentPaste'], required: true },
      ],
      outputTags: ['Meal', 'Dough', 'Stuffed'],
    },
    {
      id: 'fishCakes',
      name: 'Fish Cakes',
      description: 'Fish or mollusk bound with a root or starch and egg, then cooked into cakes.',
      baseOutputName: 'Fish Cakes',
      slots: [
        { id: 'fish', label: 'Fish / Mollusk', accepts: ['fish', 'mollusk'], required: true },
        { id: 'starch', label: 'Root / Starch Vegetable', accepts: ['starchVegetable'], required: true },
        { id: 'egg', label: 'Egg', accepts: ['egg'], required: true },
      ],
      outputTags: ['Meal', 'Seafood', 'Fried'],
    },
    {
      id: 'fruitFritters',
      name: 'Fruit Fritters',
      description: 'Fruit coated in flour, fried in cooking fat, and finished with something sweet.',
      baseOutputName: 'Fruit Fritters',
      slots: [
        { id: 'fruit', label: 'Fruit', accepts: ['fruit'], required: true },
        { id: 'flour', label: 'Flour', accepts: ['flour'], required: true },
        { id: 'fat', label: 'Oil / Butter', accepts: ['oil', 'butter'], required: true },
        { id: 'sweetPaste', label: 'Sweet Paste', accepts: ['sweetPaste'], required: true },
      ],
      outputTags: ['Meal', 'Dessert', 'Fried', 'Sweet'],
    },
  ]); // Used by the cooking-data overlay to fill common real-world meal archetype gaps with existing ingredient families.

  const EXPANDED_MEAL_NAME_RULES = Object.freeze({
    hearthPancakes: { pattern: '{flour} Griddle Cakes', namedSlots: ['flour'] },
    sweetCustard: { pattern: '{sweetPaste} Custard', namedSlots: ['sweetPaste'] },
    eggToast: { pattern: '{egg} Egg Toast', namedSlots: ['egg'] },
    cheeseToast: { pattern: '{cheese} Toast', namedSlots: ['cheese'] },
    savorySandwich: { pattern: '{protein} Sandwich', namedSlots: ['protein'] },
    gardenSalad: { pattern: '{veg} Salad', namedSlots: ['veg'] },
    vegetableSoup: { pattern: '{veg} Soup', namedSlots: ['veg'] },
    roastDinner: { pattern: '{protein} Roast Dinner', namedSlots: ['protein'] },
    breakfastHash: { pattern: '{protein} {starch} Hash', namedSlots: ['protein', 'starch'] },
    savorySkewers: { pattern: '{protein} Skewers', namedSlots: ['protein'] },
    fishStew: { pattern: '{fish} Stew', namedSlots: ['fish'] },
    sweetBreadPudding: { pattern: '{sweetPaste} Bread Pudding', namedSlots: ['sweetPaste'] },
    hearthFlatbread: { pattern: '{cheese} Flatbread', namedSlots: ['cheese'] },
    stuffedDumplings: { pattern: '{filling} Dumplings', namedSlots: ['filling'] },
    fishCakes: { pattern: '{fish} Cakes', namedSlots: ['fish'] },
    fruitFritters: { pattern: '{fruit} Fritters', namedSlots: ['fruit'] },
  }); // Used by cooking-system.js's existing ingredient-led naming path for the expanded meals.

  let processingDeps = null; // Captures ItemProcessing.init dependencies so churn eligibility can inspect live item metadata.

  function normalizedValues(values) {
    return (values || []).map(value => String(value).trim().toLowerCase());
  }

  function hasCategory(input, category) {
    const wanted = String(category || '').toLowerCase(); // Used for case-insensitive cooking-category matching.
    return normalizedValues(input?.cookingCategories).includes(wanted);
  }

  function hasTag(input, tag) {
    const wanted = String(tag || '').toLowerCase(); // Used for case-insensitive item-tag matching.
    return normalizedValues(input?.tags).includes(wanted);
  }

  function sourceEffect(input, fallback) {
    return input?.cookingPrimaryEffect || fallback; // Used so rendered fats retain the source ingredient's food identity.
  }

  function quickProcessedMetadata(input, categories, fallbackEffect) {
    return {
      cookingCategories: [...new Set(categories)],
      cookingPrimaryEffect: sourceEffect(input, fallbackEffect),
      cookingBaseBoost: Math.max(1, Number(input?.cookingBaseBoost) || 1),
      cookingProcessingTier: 'quick',
      cookingDefaultStars: Math.max(1, Math.min(5, Number(input?.cookingDefaultStars) || 3)),
    };
  }

  function ingredientColor(input, fallback) {
    const color = Number(input?.spriteColor); // Used to tint churn liquid/output from the actual held ingredient.
    return Number.isFinite(color) ? color : fallback;
  }

  function isStinkOil(inputKey, input) {
    const key = String(inputKey || '').toLowerCase(); // Used to preserve stink oil's unique result before generic oil matching.
    return key === 'grehlrstinkoil' || key.endsWith('stinkoil') || hasTag(input, 'stink oil');
  }

  function isWhiteMilk(inputKey, input) {
    if (hasCategory(input, 'whiteMilk') || hasTag(input, 'white milk')) return true;
    // These existing runtime resources predate cookingCategories on their base
    // ITEM_DEFS, but are canonically white and should work even before cooking
    // metadata has finished registering them.
    return inputKey === 'garWolfMilk' || inputKey === 'uumkaoiiWhiteDewMilk';
  }

  function isCookingOil(inputKey, input) {
    const key = String(inputKey || ''); // Used as a future-safe fallback for authored oil items that have not received cooking metadata yet.
    return hasCategory(input, 'oil') || hasTag(input, 'oil') || /Oil$/.test(key);
  }

  function butterOutput(inputKey, input) {
    return {
      key: 'butter',
      icon: '🧈',
      label: 'Butter',
      cat: 'processed',
      sellPrice: Math.max(8, (Number(input?.sellPrice) || 5) + 6),
      tags: ['Processed', 'Butter', 'Dairy'],
      desc: `Butter churned from ${String(input?.label || inputKey).toLowerCase()}.`,
      ingredientKeys: [inputKey],
      spriteIcon: 'cheese.png',
      spriteColor: ingredientColor(input, 0xF4E3A4),
      spriteMode: 'direct',
      ...quickProcessedMetadata(input, ['butter'], 'cooking'),
    };
  }

  function margarineOutput(inputKey, input) {
    return {
      key: 'margarine',
      icon: '🧈',
      label: 'Margarine',
      cat: 'processed',
      sellPrice: Math.max(8, (Number(input?.sellPrice) || 5) + 5),
      tags: ['Processed', 'Margarine', 'Butter Substitute'],
      desc: `Margarine churned from ${String(input?.label || inputKey).toLowerCase()}.`,
      ingredientKeys: [inputKey],
      spriteIcon: 'cheese.png',
      spriteColor: ingredientColor(input, 0xE7D79A),
      spriteMode: 'direct',
      // Margarine deliberately shares the butter cooking category. Recipe
      // slots therefore treat butter and margarine as true substitutes,
      // rather than broadening every butter recipe to all raw oils.
      ...quickProcessedMetadata(input, ['butter'], 'cooking'),
    };
  }

  function stinkButterOutput(inputKey, input) {
    const prototype = window.HobunjiCookingData?.items?.stinkButter; // Used to retain every cooking role formerly carried by denatured stink oil.
    const categories = [...new Set(['butter', ...(prototype?.categories || [])])]; // Used so stink butter works in butter recipes and the old stink-oil recipe niches.
    return {
      key: 'stinkButter',
      icon: '🧈',
      label: 'Stink Butter',
      cat: 'processed',
      sellPrice: Math.max(10, (Number(input?.sellPrice) || 8) + 5),
      tags: ['Processed', 'Butter', 'Margarine', 'Stink Oil', 'Grehlr'],
      desc: 'A violently pungent spread churned from stink oil. Technically margarine; nobody calls it that.',
      ingredientKeys: [inputKey],
      spriteIcon: 'cheese.png',
      spriteColor: ingredientColor(input, 0x8A9A3D),
      spriteMode: 'direct',
      ...quickProcessedMetadata(input, categories, prototype?.primaryEffect || 'combat'),
    };
  }

  function churnOutput(inputKey, input) {
    if (!inputKey || !input) return null;
    if (isStinkOil(inputKey, input)) return stinkButterOutput(inputKey, input);
    if (isWhiteMilk(inputKey, input)) return butterOutput(inputKey, input);
    if (isCookingOil(inputKey, input)) return margarineOutput(inputKey, input);
    return null;
  }

  function nutOilOutput(inputKey, input) {
    const oil = NUT_OILS[inputKey];
    if (!oil) return null;
    return {
      key: oil.key,
      icon: '🫗',
      label: oil.label,
      cat: 'processed',
      sellPrice: Math.max(9, (Number(input?.sellPrice) || 4) + 7),
      tags: ['Processed', 'Oil', 'Nut'],
      desc: `${oil.label} pressed in a squeezing vat.`,
      ingredientKeys: [inputKey],
      spriteIcon: 'jar_liquid.png',
      spriteColor: oil.color,
      spriteMode: 'keyed',
      ...quickProcessedMetadata(input, ['oil', 'butter'], 'cooking'),
    };
  }

  function lardOutput(inputKey, input) {
    if (!hasCategory(input, 'meat') && !hasTag(input, 'meat') && !/meat$/i.test(inputKey)) return null;
    const sourceLabel = String(input?.label || inputKey).replace(/\s+Meat$/i, ''); // Used to form a species-specific rendered-fat name.
    const outputKey = /Meat$/.test(inputKey) ? inputKey.replace(/Meat$/, 'Lard') : `${inputKey}Lard`;
    return {
      key: outputKey,
      icon: '🫙',
      label: `${sourceLabel} Lard`,
      cat: 'processed',
      sellPrice: Math.max(7, (Number(input?.sellPrice) || 4) + 5),
      tags: ['Processed', 'Lard', 'Rendered Fat', 'Meat'],
      desc: `Cooking fat rendered from ${String(input?.label || inputKey).toLowerCase()} in a squeezing vat.`,
      ingredientKeys: [inputKey],
      spriteIcon: 'jar_liquid.png',
      spriteColor: 0xE8D6AA,
      spriteMode: 'keyed',
      ...quickProcessedMetadata(input, ['oil', 'butter', 'processedProtein'], 'combat'),
    };
  }

  function fishOilOutput(inputKey, input) {
    if (!hasCategory(input, 'fish') && !hasTag(input, 'fish')) return null;
    return {
      key: `${inputKey}Oil`,
      icon: '🫗',
      label: `${input?.label || inputKey} Oil`,
      cat: 'processed',
      sellPrice: Math.max(7, Math.round((Number(input?.sellPrice) || 4) * 0.65) + 5),
      tags: ['Processed', 'Oil', 'Fish'],
      desc: `Cooking oil pressed from ${String(input?.label || inputKey).toLowerCase()} in a squeezing vat.`,
      ingredientKeys: [inputKey],
      spriteIcon: 'jar_liquid.png',
      spriteColor: 0x8DA7A6,
      spriteMode: 'keyed',
      ...quickProcessedMetadata(input, ['oil', 'processedProtein'], 'fishing'),
    };
  }

  function getProcessingOutputs(methodId, inputKey, input) {
    if (!inputKey || !input) return null;
    if (methodId === 'churning') {
      const output = churnOutput(inputKey, input); // Used as the single churn result while retaining the plural processor API.
      return output ? [output] : null;
    }
    if (methodId !== 'squeezing') return null;
    const output = nutOilOutput(inputKey, input) || lardOutput(inputKey, input) || fishOilOutput(inputKey, input);
    return output ? [output] : null;
  }

  function rollTreeNutDrop(areaId, random = Math.random, skillSystem = window.SkillSystem) {
    const definition = TREE_NUTS_BY_AREA[areaId];
    if (!definition) return null;
    const bonusChance = Math.max(0, Number(skillSystem?.bonusYieldChance?.('foraging')) || 0); // Used to scale nut quantity with effective Foraging, including food buffs.
    const baseAmount = 1 + (random() < 0.45 ? 1 : 0); // Used to give every associated tree a small, variable nut drop.
    const bonusAmount = random() < bonusChance ? 1 : 0; // Used as the explicit Foraging-driven extra-nut roll.
    const stars = Math.max(1, Math.min(5, Number(skillSystem?.rollQuality?.('foraging')) || 3)); // Used to make nut quality respond to Foraging.
    return { ...definition, amount: baseAmount + bonusAmount, bonusAmount, stars };
  }

  function installExpandedMealRecipes(data) {
    if (!Array.isArray(data?.recipes)) return;
    const existingRecipeIds = new Set(data.recipes.map(recipe => recipe.id)); // Used to make repeated runtime-hook installation idempotent.
    EXPANDED_MEAL_RECIPES.forEach(recipe => {
      if (!existingRecipeIds.has(recipe.id)) data.recipes.push(recipe);
    });
    data.identityNameRules ||= {};
    Object.entries(EXPANDED_MEAL_NAME_RULES).forEach(([recipeId, rule]) => {
      if (!data.identityNameRules[recipeId]) data.identityNameRules[recipeId] = rule;
    });
  }

  function installCookingDataOverlay() {
    const data = window.HobunjiCookingData;
    if (!data?.items) return;
    installExpandedMealRecipes(data);
    const legacy = data.items.denaturedStinkOil; // Used as the metadata source while migrating the old prototype ingredient in place.
    if (legacy && !data.items.stinkButter) {
      data.items.stinkButter = {
        ...legacy,
        id: 'stinkButter',
        name: 'Stink Butter',
        categories: [...new Set(['butter', ...(legacy.categories || [])])],
      };
    }
    delete data.items.denaturedStinkOil;
    data.categoryLabels ||= {};
    data.categoryLabels.butter ||= 'Butter';
    data.itemNameTokenOverrides ||= {};
    if (Object.prototype.hasOwnProperty.call(data.itemNameTokenOverrides, 'denaturedStinkOil')) {
      delete data.itemNameTokenOverrides.denaturedStinkOil;
    }
    data.itemNameTokenOverrides.stinkButter = 'Stink Butter';
  }

  function ensureProcessingFurnitureDef(defs) {
    if (!defs || defs[BUTTER_CHURN.furnitureKey]) return;
    defs[BUTTER_CHURN.furnitureKey] = {
      itemKey: BUTTER_CHURN.itemKey,
      icon: BUTTER_CHURN.icon,
      name: BUTTER_CHURN.name,
      method: BUTTER_CHURN.method,
      color: BUTTER_CHURN.color,
      desc: BUTTER_CHURN.desc,
    };
  }

  function ensureBlueprint(catalog) {
    if (!Array.isArray(catalog) || catalog.some(entry => entry.key === BUTTER_CHURN.blueprintKey)) return;
    catalog.push({
      key: BUTTER_CHURN.blueprintKey,
      furnitureKey: BUTTER_CHURN.itemKey,
      icon: BUTTER_CHURN.icon,
      name: BUTTER_CHURN.name,
      desc: BUTTER_CHURN.desc,
      price: Math.max(15, Math.round(BUTTER_CHURN.price * 1.5)),
      craftCost: { wood: 5, stone: 3 },
      category: 'processing',
    });
  }

  function openBarrelFallbackParts() {
    return [
      { kind: 'cup', tint: 0.95, segments: 20, innerScale: 0.78, basinDepth: 0.13, topScaleX: 1, topScaleZ: 1, bottomScaleX: 1, bottomScaleZ: 1, transform: { x: 0, y: 0.36, z: 0, sx: 0.68, sy: 0.72, sz: 0.68 } },
      { kind: 'hoop', tint: 0.62, segments: 20, transform: { x: 0, y: 0.13, z: 0, sx: 0.70, sy: 0.045, sz: 0.70 } },
      { kind: 'hoop', tint: 0.62, segments: 20, transform: { x: 0, y: 0.36, z: 0, sx: 0.70, sy: 0.045, sz: 0.70 } },
      { kind: 'hoop', tint: 0.62, segments: 20, transform: { x: 0, y: 0.61, z: 0, sx: 0.70, sy: 0.045, sz: 0.70 } },
    ];
  }

  function installProceduralFallbacks() {
    const catalog = window.ProceduralFurniture?.CATALOG;
    if (!catalog) return;
    if (!catalog.openBarrel) catalog.openBarrel = openBarrelFallbackParts();
    if (!catalog.butterChurn) {
      catalog.butterChurn = [
        ...openBarrelFallbackParts(),
        { kind: 'cylinder', tint: 0.78, segments: 12, transform: { x: 0, y: 0.82, z: 0, sx: 0.055, sy: 0.78, sz: 0.055 } },
        { kind: 'box', tint: 0.78, transform: { x: 0, y: 1.17, z: 0, sx: 0.34, sy: 0.055, sz: 0.055 } },
      ];
    }
  }

  function installItemProcessingHook() {
    const itemProcessing = window.ItemProcessing;
    if (!itemProcessing || itemProcessing.__butterChurnInstalled) return;
    const originalInit = itemProcessing.init; // Used to preserve the extracted module's normal dependency setup.
    const originalGetOutput = itemProcessing.getProcessingOutput; // Used for every non-churn processing recipe.
    const originalGetOutputs = itemProcessing.getProcessingOutputs; // Used for existing multi-output processor behavior.
    const originalButtonLabel = itemProcessing.processButtonLabel; // Used for existing station action labels.
    const originalIdleLabel = itemProcessing.methodIdleLabel; // Used for existing station idle prompts.
    const originalWheelEligible = itemProcessing.isWheelEligible; // Used so all existing item-wheel rules remain intact.

    itemProcessing.init = function butterChurnInit(injectedDeps) {
      processingDeps = injectedDeps;
      return originalInit.call(this, injectedDeps);
    };
    itemProcessing.getProcessingOutput = function butterChurnGetProcessingOutput(methodId, inputKey) {
      if (methodId === 'churning') {
        return getProcessingOutputs(methodId, inputKey, processingDeps?.ITEM_DEFS?.[inputKey])?.[0] || null;
      }
      return originalGetOutput.call(this, methodId, inputKey);
    };
    itemProcessing.getProcessingOutputs = function butterChurnGetProcessingOutputs(methodId, inputKey) {
      if (methodId === 'churning') {
        return getProcessingOutputs(methodId, inputKey, processingDeps?.ITEM_DEFS?.[inputKey]);
      }
      return originalGetOutputs.call(this, methodId, inputKey);
    };
    itemProcessing.processButtonLabel = function butterChurnProcessButtonLabel(methodId, inputKey, output) {
      if (methodId === 'churning') return `Churn → ${output?.icon || '🧈'}`;
      return originalButtonLabel.call(this, methodId, inputKey, output);
    };
    itemProcessing.methodIdleLabel = function butterChurnMethodIdleLabel(methodId) {
      if (methodId === 'churning') return 'Needs white milk or oil';
      return originalIdleLabel.call(this, methodId);
    };
    itemProcessing.isWheelEligible = function butterChurnWheelEligible(inputKey, ...rest) {
      if (originalWheelEligible.call(this, inputKey, ...rest)) return true;
      return !!churnOutput(inputKey, processingDeps?.ITEM_DEFS?.[inputKey]);
    };
    itemProcessing.__butterChurnInstalled = true;
  }

  function wrapInitWithFurnitureDef(namespace) {
    if (!namespace?.init || namespace.__butterChurnFurnitureHook) return;
    const originalInit = namespace.init; // Used to preserve the target module's own setup after mutating its shared registry reference.
    namespace.init = function butterChurnFurnitureInit(injectedDeps) {
      ensureProcessingFurnitureDef(injectedDeps?.PROCESSING_FURNITURE_DEFS);
      return originalInit.call(this, injectedDeps);
    };
    namespace.__butterChurnFurnitureHook = true;
  }

  function wrapInitWithBlueprint(namespace) {
    if (!namespace?.init || namespace.__butterChurnBlueprintHook) return;
    const originalInit = namespace.init; // Used to preserve normal carpenter/crafting initialization after catalog augmentation.
    namespace.init = function butterChurnBlueprintInit(injectedDeps) {
      ensureBlueprint(injectedDeps?.FURNITURE_BLUEPRINT_CATALOG);
      return originalInit.call(this, injectedDeps);
    };
    namespace.__butterChurnBlueprintHook = true;
  }

  function installRuntimeHooks() {
    installCookingDataOverlay();
    installProceduralFallbacks();
    installItemProcessingHook();
    wrapInitWithFurnitureDef(window.FarmEditor);
    wrapInitWithFurnitureDef(window.FurniturePlacer);
    wrapInitWithBlueprint(window.CarpenterShop);
    wrapInitWithBlueprint(window.CraftingPanel);
  }

  function installRuntimeHooksWhenReady() {
    installRuntimeHooks();
    // furniture-placer.js/carpenter-shop.js/crafting-panel.js load after this
    // script, so their namespaces don't exist on the first pass above; retry
    // once the rest of the document (and those scripts) has parsed.
    if (!window.FurniturePlacer || !window.CarpenterShop || !window.CraftingPanel) {
      if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installRuntimeHooks, { once: true });
      }
    }
  }

  function diagnosticsText() {
    return `Stations: ${SQUEEZING_VAT.name}, ${BUTTER_CHURN.name}\nExpanded meals: ${EXPANDED_MEAL_RECIPES.length}\nTree nut sources: ${Object.values(TREE_NUTS_BY_AREA).map(entry => entry.label).join(', ')}\nVat fats: nut oils, species lards, species fish oils\nChurn: white milk → butter; oil → margarine; stink oil → stink butter`;
  }

  window.HobunjiFoodProcessing = {
    SQUEEZING_VAT,
    BUTTER_CHURN,
    TREE_NUTS_BY_AREA,
    NUT_OILS,
    getProcessingOutputs,
    rollTreeNutDrop,
    diagnosticsText,
    isWhiteMilk,
    isCookingOil,
    isStinkOil,
    ensureProcessingFurnitureDef,
    ensureBlueprint,
  };

  installRuntimeHooksWhenReady();
})();
