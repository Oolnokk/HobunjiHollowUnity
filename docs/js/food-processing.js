(() => {
  'use strict';

  // Data and rules for cooking-adjacent processing that do not need access to
  // game.js's private world state. The host passes the active item definition,
  // area, RNG, and skill API through the narrow functions below.
  const SQUEEZING_VAT = Object.freeze({
    name: 'Squeezing Vat',
    desc: 'Placeable vat for squeezing berries and dew, pressing tree nuts into oil, and rendering meat or fish into cooking fats.',
  });

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

  function hasCategory(input, category) {
    return (input?.cookingCategories || []).some(value => String(value).toLowerCase() === category);
  }

  function hasTag(input, tag) {
    return (input?.tags || []).some(value => String(value).toLowerCase() === tag);
  }

  function sourceEffect(input, fallback) {
    return input?.cookingPrimaryEffect || fallback; // Used so rendered fats retain the source ingredient's food identity.
  }

  function quickProcessedMetadata(input, categories, fallbackEffect) {
    return {
      cookingCategories: categories,
      cookingPrimaryEffect: sourceEffect(input, fallbackEffect),
      cookingBaseBoost: Math.max(1, Number(input?.cookingBaseBoost) || 1),
      cookingProcessingTier: 'quick',
      cookingDefaultStars: Math.max(1, Math.min(5, Number(input?.cookingDefaultStars) || 3)),
    };
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
    if (methodId !== 'squeezing' || !inputKey || !input) return null;
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

  function diagnosticsText() {
    return `Station: ${SQUEEZING_VAT.name}\nTree nut sources: ${Object.values(TREE_NUTS_BY_AREA).map(entry => entry.label).join(', ')}\nVat fats: nut oils, species lards, species fish oils`;
  }

  window.HobunjiFoodProcessing = {
    SQUEEZING_VAT,
    TREE_NUTS_BY_AREA,
    NUT_OILS,
    getProcessingOutputs,
    rollTreeNutDrop,
    diagnosticsText,
  };
})();
