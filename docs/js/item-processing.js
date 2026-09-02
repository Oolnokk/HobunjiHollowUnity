(() => {
  'use strict';

  // Processing-station recipe resolution (getProcessingOutput/
  // getProcessingOutputs), berry/dew/alcohol key & color derivation, and
  // item-wheel eligibility (isWheelEligible), extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // siblings. Every dependency here is a `const` never reassigned
  // wholesale or a stable `function` declaration, except `inventoryItems`
  // (declared later in game.js than this cluster originally sat, so it's
  // a getter to stay forward-reference-safe regardless of init() timing).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function processButtonLabel(methodId, inputKey, output) {
    const methodVerb = ({ mashing: 'Mash', squeezing: 'Squeeze', grinding: 'Grind', drying: 'Dry', smoking: 'Smoke', barrelAging: 'Age', vaseAging: 'Age' })[methodId] || 'Process';
    return methodVerb + ' → ' + output.icon;
  }

  function methodIdleLabel(methodId) {
    return ({
      mashing: 'Needs mashable item', squeezing: 'Needs squeezable item', grinding: 'Needs grindable item',
      drying: 'Needs wet/fresh item', smoking: 'Needs meat/fish', barrelAging: 'Needs juice/dew', vaseAging: 'Needs milk/curd'
    })[methodId] || 'Needs ingredient';
  }

  function isBerryKey(key) {
    return ['redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries'].includes(key);
  }

  function berryBaseName(key) {
    return ({ redberries: 'Redberry', blueberries: 'Blueberry', yellowberries: 'Yellowberry', whiteberries: 'Whiteberry', blackberries: 'Blackberry' })[key] || (deps.ITEM_DEFS[key]?.label || key);
  }

  // Berries literally have their color in their name — used to recolor
  // their Jam (jar_liquid.png) and Wine (bottle_wine.png) sprites.
  const BERRY_COLORS = {
    redberries: 0xD93A3A, blueberries: 0x3F63D9, yellowberries: 0xE0C93A,
    whiteberries: 0xF2EFE6, blackberries: 0x241A2E,
  };

  // Ingredient colors used by alcohol recipes whose raw item has no
  // recolorable sprite of its own. These feed mixedIngredientColor below.
  const ALCOHOL_INGREDIENT_COLORS = {
    needlegrain: 0x2F4A2E,
    // Match ripe heftroot: vodka uses the animal-color shade-fill so the
    // bottle keeps its painted highlights, shadows, and transparency.
    heftroot: 0xF0D15A,
  };
  // Alcohol words accepted by normalizeAlcoholItemDef, shared with the
  // drinking system's classification so every alcoholic output gets the
  // same bottle treatment even when a new recipe is added later.
  const ALCOHOL_ITEM_TERMS = new Set(['alcohol', 'wine', 'sake', 'vodka', 'nectar', 'airag', 'liquor', 'spirit', 'spirits', 'beer', 'ale', 'mead', 'cider']);

  function isAlcoholItemDef(def) {
    if (!def) return false;
    // Normalized tags are checked exactly before the label/tag text fallback.
    const tags = (def.tags || []).map(tag => String(tag).toLowerCase());
    if (tags.some(tag => ALCOHOL_ITEM_TERMS.has(tag))) return true;
    // The fallback catches authored alcohol labels that omitted a canonical tag.
    const searchable = `${def.label || ''} ${tags.join(' ')}`.toLowerCase();
    return /\b(alcohol|wine|sake|vodka|nectar|airag|liquor|spirits?|beer|ale|mead|cider)\b/.test(searchable);
  }

  function ingredientColorForItem(key) {
    // The resolved definition supplies colors for bottled milk/dew ingredients.
    const def = deps.ITEM_DEFS[key];
    return def?.spriteColor ?? BERRY_COLORS[key] ?? ALCOHOL_INGREDIENT_COLORS[key] ?? null;
  }

  function mixedIngredientColor(ingredientKeys, fallback = 0x8A5FB0) {
    // Valid ingredient colors are averaged here for multi-ingredient alcohol.
    const colors = (ingredientKeys || []).map(ingredientColorForItem).filter(color => Number.isFinite(color));
    if (!colors.length) return fallback;
    // RGB totals are consumed by the average returned below.
    const totals = colors.reduce((sum, color) => ({
      r: sum.r + ((color >> 16) & 255),
      g: sum.g + ((color >> 8) & 255),
      b: sum.b + (color & 255),
    }), { r: 0, g: 0, b: 0 });
    // Count keeps each channel's ingredient average consistent.
    const count = colors.length;
    return (Math.round(totals.r / count) << 16)
      | (Math.round(totals.g / count) << 8)
      | Math.round(totals.b / count);
  }

  function normalizeAlcoholItemDef(def) {
    if (!isAlcoholItemDef(def)) return def;
    def.swigsPerBottle = Math.max(1, Math.round(Number(def.swigsPerBottle) || 4));
    def.spriteIcon = 'bottle_wine.png';
    def.spriteMode = 'keyed';
    def.spriteColor = mixedIngredientColor(def.ingredientKeys, def.spriteColor ?? 0x8A5FB0);
    return def;
  }

  // The 7 Uumkao'ii dew colors and their per-color processed-item keys —
  // shared by getProcessingOutputs (squeezing dew -> milk+curds) and
  // getProcessingOutput's barrelAging branch (milk -> nectar). "white"
  // uses the uumkaoii-prefixed key spelling from the reference cooking
  // spec (avoids colliding with any future generic "white dairy" family).
  const DEW_COLOR_KEYS = ['yellow', 'green', 'blue', 'orange', 'red', 'purple', 'white'];
  function dewItemKey(color) { return color + 'Dew'; }
  function dewMilkKey(color) { return color === 'white' ? 'uumkaoiiWhiteDewMilk' : color + 'DewMilk'; }
  function dewCurdsKey(color) { return color === 'white' ? 'uumkaoiiWhiteDewCurds' : color + 'DewCurds'; }
  function dewColorFromMilkOrCurdsKey(key) {
    for (const color of DEW_COLOR_KEYS) {
      if (key === dewMilkKey(color) || key === dewCurdsKey(color)) return color;
    }
    return null;
  }

  // Single-output recipes. getProcessingOutputs (below) wraps this for
  // the common case and special-cases the one recipe — squeezing
  // Uumkao'ii dew — that jointly produces two outputs from one input.
  function getProcessingOutput(methodId, inputKey) {
    const input = deps.ITEM_DEFS[inputKey];
    if (!input) return null;
    if (methodId === 'squeezing' && isBerryKey(inputKey)) {
      const base = berryBaseName(inputKey);
      return { key: inputKey + 'Juice', icon: '🧃', label: base + ' Juice', cat: 'processed', sellPrice: Math.max(4, (input.sellPrice || 4) + 5), tags: ['Processed', 'Juice', 'Fruit'], desc: 'Sweet liquid squeezed from ' + input.label.toLowerCase() + '.' };
    }
    if (methodId === 'squeezing' && inputKey === 'garWolfMilk') {
      return { key: 'garWolfButter', icon: '🧈', label: 'Gar-wolf Butter', cat: 'processed', sellPrice: Math.max(6, (input.sellPrice || 6) + 6), tags: ['Processed', 'Butter', 'Gar-wolf'], desc: 'Butter pressed from gar-wolf milk.', spriteIcon: 'cheese.png', spriteColor: input.spriteColor, spriteMode: 'direct' };
    }
    if (methodId === 'mashing' && isBerryKey(inputKey)) {
      const base = berryBaseName(inputKey);
      return { key: inputKey + 'Jam', icon: input.icon, label: base + ' Jam', cat: 'processed', sellPrice: Math.max(5, (input.sellPrice || 4) + 7), tags: ['Processed', 'Jam', 'Sweet Paste'], desc: 'Thick berry preserve made at a pestle station.', spriteIcon: 'jar_liquid.png', spriteColor: BERRY_COLORS[inputKey], spriteMode: 'keyed' };
    }
    if (methodId === 'mashing' && inputKey === 'garWolfMilk') {
      return { key: 'garWolfCream', icon: '🍦', label: 'Gar-wolf Cream', cat: 'processed', sellPrice: Math.max(6, (input.sellPrice || 6) + 4), tags: ['Processed', 'Cream', 'Gar-wolf'], desc: 'Cream worked from gar-wolf milk.', spriteIcon: 'cheese.png', spriteColor: input.spriteColor, spriteMode: 'direct' };
    }
    if (methodId === 'mashing' && inputKey === 'blackMustardSeed') return { key: 'blackMustardPaste', icon: '🟤', label: 'Black Mustard Paste', cat: 'processed', sellPrice: 13, tags: ['Processed', 'Pungent Paste', 'Spice'], desc: 'Hot pungent paste made from black mustard seed.' };
    if (methodId === 'mashing' && inputKey === 'greenMustardSeed') return { key: 'greenMustardPaste', icon: '🟢', label: 'Green Mustard Paste', cat: 'processed', sellPrice: 12, tags: ['Processed', 'Pungent Paste', 'Spice'], desc: 'Fresh pungent paste made from green mustard seed.' };
    if (methodId === 'mashing' && ['heftroot', 'garlink', 'ongyums', 'blackMustard', 'greenMustard'].includes(inputKey)) return { key: inputKey + 'Mash', icon: '🥣', label: 'Mashed ' + input.label, cat: 'processed', sellPrice: Math.max(3, (input.sellPrice || 3) + 3), tags: ['Processed', 'Mash'], desc: 'Mashed crop base for future cooking recipes.' };
    if (methodId === 'grinding' && inputKey === 'needlegrain') return { key: 'needlegrainFlour', icon: '🌾', label: 'Needlegrain Flour', cat: 'processed', sellPrice: 12, tags: ['Processed', 'Flour', 'Grain'], desc: 'Ground needlegrain flour for noodles and bread.' };
    if (methodId === 'grinding' && inputKey === 'heftroot') return { key: 'heftrootFlour', icon: '🟡', label: 'Heftroot Flour', cat: 'processed', sellPrice: 15, tags: ['Processed', 'Flour', 'Starch'], desc: 'Ground heftroot flour for yellow noodles and bread.' };
    if (methodId === 'grinding' && inputKey === 'blackMustardSeed') return { key: 'blackMustardPowder', icon: '⚫', label: 'Black Mustard Powder', cat: 'processed', sellPrice: 11, tags: ['Processed', 'Powder', 'Spice'], desc: 'Ground black mustard powder.' };
    if (methodId === 'grinding' && inputKey === 'greenMustardSeed') return { key: 'greenMustardPowder', icon: '🥬', label: 'Green Mustard Powder', cat: 'processed', sellPrice: 10, tags: ['Processed', 'Powder', 'Spice'], desc: 'Ground green mustard powder.' };
    // Feed Grinder (barn interior fixture) — harvested crops grind into
    // Plant Fodder, raw meat and fish grind into Meat Fodder. Mulch is
    // deliberately not a valid input (it's clearing waste, not feed).
    // Checked live off cropData/ITEM_DEFS tags rather than a Set
    // snapshotted at load — fish items in particular only get merged
    // into ITEM_DEFS asynchronously (see fish-catalog.js's
    // registerItems), well after this file's own top-level code runs.
    // Reuses this same generic "hold a valid item, interact" processing
    // pipeline rather than a one-off — see PROCESSING_FURNITURE_DEFS.feedGrinder.
    if (methodId === 'grindingFeed' && deps.cropData[inputKey]) {
      return { key: 'plantFodder', icon: deps.ITEM_DEFS.plantFodder.icon, label: deps.ITEM_DEFS.plantFodder.label, cat: 'material', sellPrice: deps.ITEM_DEFS.plantFodder.sellPrice, tags: deps.ITEM_DEFS.plantFodder.tags, desc: deps.ITEM_DEFS.plantFodder.desc };
    }
    if (methodId === 'grindingFeed' && (input.tags?.includes('Meat') || input.tags?.includes('Fish'))) {
      return { key: 'meatFodder', icon: deps.ITEM_DEFS.meatFodder.icon, label: deps.ITEM_DEFS.meatFodder.label, cat: 'material', sellPrice: deps.ITEM_DEFS.meatFodder.sellPrice, tags: deps.ITEM_DEFS.meatFodder.tags, desc: deps.ITEM_DEFS.meatFodder.desc };
    }
    if (methodId === 'drying' && isBerryKey(inputKey)) return { key: inputKey + 'Dried', icon: input.icon, label: 'Dried ' + input.label, cat: 'processed', sellPrice: Math.max(4, (input.sellPrice || 4) + 4), tags: ['Processed', 'Dried', 'Fruit'], desc: 'Dried berries. Dry-default crops are not valid drying inputs.' };
    if (methodId === 'barrelAging' && /Juice$/.test(inputKey)) {
      const berryKey = inputKey.replace(/Juice$/, '');
      return { key: inputKey.replace(/Juice$/, 'Wine'), icon: '🍷', label: input.label.replace(/ Juice$/, ' Wine'), cat: 'processed', sellPrice: Math.max(10, (input.sellPrice || 10) + 12), tags: ['Processed', 'Wine', 'Aged'], desc: 'Barrel-aged fruit wine.', ingredientKeys: [berryKey], spriteIcon: 'bottle_wine.png', spriteColor: BERRY_COLORS[berryKey], spriteMode: 'keyed' };
    }
    if (methodId === 'barrelAging' && dewColorFromMilkOrCurdsKey(inputKey) && /Milk$/.test(inputKey)) {
      const color = dewColorFromMilkOrCurdsKey(inputKey);
      const properLabel = color.charAt(0).toUpperCase() + color.slice(1);
      return { key: inputKey.replace(/Milk$/, 'Nectar'), icon: '🍷', label: properLabel + " Uumkao'ii Nectar", cat: 'processed', sellPrice: Math.max(14, (input.sellPrice || 14) + 10), tags: ['Processed', 'Nectar', "Uumkao'ii", 'Aged'], desc: 'Barrel-aged Uumkao\'ii milk.', ingredientKeys: [inputKey], spriteIcon: 'bottle_wine.png', spriteColor: input.spriteColor, spriteMode: 'keyed' };
    }
    if (methodId === 'barrelAging' && inputKey === 'needlegrain') {
      return { key: 'needlegrainSake', icon: '🍶', label: 'Needlegrain Sake', cat: 'processed', sellPrice: 24, tags: ['Processed', 'Sake', 'Aged', 'Needlegrain'], desc: 'Barrel-aged needlegrain liquor, colored like dark pine needles.', ingredientKeys: [inputKey], spriteIcon: 'bottle_wine.png', spriteColor: 0x2F4A2E, spriteMode: 'keyed' };
    }
    if (methodId === 'barrelAging' && inputKey === 'heftroot') {
      return { key: 'heftrootVodka', icon: '🥃', label: 'Heftroot Vodka', cat: 'processed', sellPrice: 26, tags: ['Processed', 'Vodka', 'Aged', 'Heftroot'], desc: 'Barrel-aged heftroot spirit, golden-yellow like ripe heftroot.', ingredientKeys: [inputKey], spriteIcon: 'bottle_wine.png', spriteColor: 0xF0D15A, spriteMode: 'keyed' };
    }
    if (methodId === 'barrelAging' && inputKey === 'garWolfMilk') {
      return { key: 'garWolfAirag', icon: '🍶', label: 'Gar-wolf Airag', cat: 'processed', sellPrice: 22, tags: ['Processed', 'Airag', 'Aged', 'Gar-wolf'], desc: 'Barrel-fermented gar-wolf milk.', ingredientKeys: [inputKey], spriteIcon: 'bottle_wine.png', spriteColor: input.spriteColor, spriteMode: 'keyed' };
    }
    if (methodId === 'vaseAging' && dewColorFromMilkOrCurdsKey(inputKey) && /Curds$/.test(inputKey)) {
      return { key: 'uumkaoiiCheese', icon: '🧀', label: "Uumkao'ii Cheese", cat: 'processed', sellPrice: 28, tags: ['Processed', 'Cheese', "Uumkao'ii", 'Aged'], desc: 'Vase-aged Uumkao\'ii curds — every dew color ferments into the same cheese.', spriteIcon: 'cheese.png', spriteColor: 0xD9A441, spriteMode: 'direct' };
    }
    if (methodId === 'vaseAging' && inputKey === 'garWolfMilk') {
      return { key: 'garWolfCheese', icon: '🧀', label: 'Gar-wolf Cheese', cat: 'processed', sellPrice: 24, tags: ['Processed', 'Cheese', 'Gar-wolf', 'Aged'], desc: 'Vase-aged gar-wolf milk.', spriteIcon: 'cheese.png', spriteColor: input.spriteColor, spriteMode: 'direct' };
    }
    return null;
  }

  // Wraps getProcessingOutput in an array, except for the one recipe that
  // jointly produces two items from a single input in a single action:
  // squeezing raw Uumkao'ii dew into both Milk and Curds at once.
  function getProcessingOutputs(methodId, inputKey) {
    const input = deps.ITEM_DEFS[inputKey];
    if (!input) return null;
    const dewColorMatch = DEW_COLOR_KEYS.find(color => dewItemKey(color) === inputKey);
    if (methodId === 'squeezing' && dewColorMatch) {
      const color = dewColorMatch;
      const properLabel = color.charAt(0).toUpperCase() + color.slice(1);
      const dewColorHex = input.spriteColor;
      return [
        { key: dewMilkKey(color), icon: '🥛', label: properLabel + " Uumkao'ii Milk", cat: 'processed', sellPrice: Math.max(6, (input.sellPrice || 6) + 3), tags: ['Processed', 'Milk', "Uumkao'ii", 'Squeezed', 'Not Animal Milk'], desc: 'Milk squeezed from ' + input.label.toLowerCase() + '.', spriteIcon: 'jar_liquid.png', spriteColor: dewColorHex, spriteMode: 'keyed' },
        { key: dewCurdsKey(color), icon: '🧀', label: properLabel + " Uumkao'ii Curds", cat: 'processed', sellPrice: Math.max(6, (input.sellPrice || 6) + 4), tags: ['Processed', 'Curds', "Uumkao'ii", 'Squeezed', 'Not Dairy'], desc: 'Curds squeezed from ' + input.label.toLowerCase() + '.', spriteIcon: 'cheese.png', spriteColor: dewColorHex, spriteMode: 'direct' },
      ];
    }
    const modularOutputs = window.HobunjiFoodProcessing?.getProcessingOutputs?.(methodId, inputKey, input); // Used for decoupled nut-oil, lard, and fish-oil vat recipes.
    if (modularOutputs?.length) return modularOutputs;
    const single = getProcessingOutput(methodId, inputKey);
    return single ? [single] : null;
  }

  // World-object placement items whose only "held" action is being set
  // up on the ground — see the campfireKitFurniture check in
  // computeActionButtons' held-item branch. Small and hand-maintained
  // because nothing else in the file currently follows this pattern
  // (see the isWheelEligible callers' own audit notes below).
  const HELD_PLACEMENT_ITEM_KEYS = new Set(['campfireKitFurniture']);

  // Whether `key` belongs on the item wheel/scroller at all — i.e.
  // whether selecting it as the held item does anything, either
  // directly (eat/drink/play/plant/flask-throw/read/place) or as the
  // chosen ingredient for a nearby processing station (press, mill,
  // drying rack, smoker, aging barrel/vase, feed grinder). Pure
  // sell-fodder/crafting materials (wood, ore, hides, scrap, treasure
  // tokens, mystery dyes, uncrafted tools, ...) fail every check here —
  // they're still fully visible/usable from the Inventory grid (sell,
  // craft, gift via its own Hold button), just not wheel-cyclable.
  //
  // Every consumer of getActiveInventoryItem()/getInventoryStackItems()
  // was audited before adding this filter (see the commit that
  // introduced it) to confirm nothing legitimately needs a
  // wheel-ineligible item wheel-selected — cooking and alchemy brewing
  // both have their own dedicated ingredient pickers, independent of
  // the wheel.
  function isWheelEligible(key) {
    const def = deps.ITEM_DEFS[key];
    if (!def) return false;
    if (def.isCookedFood || def.isInstrument) return true;
    if (def.alchemyRecipeScrollId) return true;
    if (HELD_PLACEMENT_ITEM_KEYS.has(key)) return true;
    if (window.AlchemySystem?.REAGENT_DEFS?.[key]) return true;
    const potionPayload = window.AlchemySystem?.POTION_ITEMS?.[key];
    if (potionPayload) {
      const recipe = window.AlchemySystem?.RECIPE_DEFS?.[potionPayload.recipeId];
      if (recipe?.useMode === 'throw' || recipe?.useMode === 'drink' || potionPayload.legacyEffects) return true;
    }
    const bridge = window.HobunjiDrunkGameplayBridge;
    if (bridge?.isFood?.(def) || bridge?.isPotionOrDrink?.(key, def)) return true;
    if (def.seedFor || deps.getInventoryItems().find(item => item.key === key)?.seedFor) return true;
    if (deps.PROCESSING_METHODS.some(method => getProcessingOutputs(method, key))) return true;
    return false;
  }

  function ensureProcessedItemDef(output) {
    const presentationMetadata = {
      ...(output.icon ? { icon: output.icon } : {}),
      ...(output.label ? { label: output.label } : {}),
      ...(output.cat ? { cat: output.cat } : {}),
      ...(output.sellPrice ? { sellPrice: output.sellPrice } : {}),
      ...(output.tags ? { tags: [...output.tags] } : {}),
      ...(output.desc ? { desc: output.desc } : {}),
      ...(output.spriteIcon ? { spriteIcon: output.spriteIcon, spriteColor: output.spriteColor, spriteMode: output.spriteMode } : {}),
    }; // Used to replace future-source placeholders once an item gains a real processor recipe.
    const cookingMetadata = {
      ...(output.cookingCategories ? { cookingCategories: [...output.cookingCategories] } : {}),
      ...(output.cookingPrimaryEffect ? { cookingPrimaryEffect: output.cookingPrimaryEffect } : {}),
      ...(output.cookingBaseBoost ? { cookingBaseBoost: output.cookingBaseBoost } : {}),
      ...(output.cookingProcessingTier ? { cookingProcessingTier: output.cookingProcessingTier } : {}),
      ...(output.cookingDefaultStars ? { cookingDefaultStars: output.cookingDefaultStars } : {}),
    }; // Used to make dynamically generated fats valid hearth ingredients immediately.
    if (deps.ITEM_DEFS[output.key]) {
      if (output.ingredientKeys?.length) deps.ITEM_DEFS[output.key].ingredientKeys = [...output.ingredientKeys];
      Object.assign(deps.ITEM_DEFS[output.key], presentationMetadata, cookingMetadata);
      normalizeAlcoholItemDef(deps.ITEM_DEFS[output.key]);
      return;
    }
    deps.ITEM_DEFS[output.key] = normalizeAlcoholItemDef({
      icon: output.icon,
      label: output.label,
      cat: output.cat || 'processed',
      sellPrice: output.sellPrice || 1,
      tags: output.tags || ['Processed'],
      desc: output.desc || 'Processed food item.',
      ingredientKeys: output.ingredientKeys || [],
      ...cookingMetadata,
      ...(output.spriteIcon ? { spriteIcon: output.spriteIcon, spriteColor: output.spriteColor, spriteMode: output.spriteMode } : {}),
    });
  }

  window.ItemProcessing = {
    init,
    processButtonLabel,
    methodIdleLabel,
    isBerryKey,
    berryBaseName,
    BERRY_COLORS,
    isAlcoholItemDef,
    ingredientColorForItem,
    mixedIngredientColor,
    normalizeAlcoholItemDef,
    dewItemKey,
    dewMilkKey,
    dewCurdsKey,
    dewColorFromMilkOrCurdsKey,
    getProcessingOutput,
    getProcessingOutputs,
    isWheelEligible,
    ensureProcessedItemDef,
  };
})();
