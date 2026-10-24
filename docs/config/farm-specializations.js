(() => {
  'use strict';
  const palettes = { // Natural, unpainted building finishes used by creation and the owner menu.
    stone: [['Slate', '#4d4d4d'], ['Granite', '#88847d'], ['Sandstone', '#b49b76'], ['Pale limestone', '#c8c1ac'], ['Dark basalt', '#343a38']],
    wood: [['Weathered wood', '#7d7355'], ['Honey wood', '#a7804c'], ['Dark heartwood', '#604632'], ['Pale wood', '#bcaa82'], ['Russet wood', '#895940']],
  };
  const families = { // Each family supplies the same recipe authority as its furniture counterpart.
    waterSilo: { label: 'Water Silo', icon: '💧', method: null },
    compostBin: { label: 'Compost Bin', icon: '♻️', method: 'composting', depthScale: .5 }, // Low shipping-box-like crate: width × ⌈width/2⌉ tiles.
    windmill: { label: 'Windmill', icon: '⚙️', method: 'grinding', base: 'handMill' },
    fodderMill: { label: 'Fodder Mill', icon: '🌿', method: 'grindingFeed', base: 'feedGrinder' },
    smokehouse: { label: 'Smokehouse', icon: '♨️', method: 'smoking', base: 'smoker' },
    jerkyDryer: { label: 'Jerky House', icon: '☀️', method: 'drying', inputTag: 'Meat', base: 'dryingRack' },
  };
  const buildings = {}; // Canonical plans, dimensions, yields, and world-time duration for all three tiers.
  for (const [family, definition] of Object.entries(families)) {
    ['small', 'medium', 'large'].forEach((tier, index) => {
      const key = family + tier[0].toUpperCase() + tier.slice(1); // Shared asset key and plan prefix.
      buildings[key] = { ...definition, key, family, tier, label: tier[0].toUpperCase() + tier.slice(1) + ' ' + definition.label,
        w: 2 + index, h: Math.max(1, Math.ceil((2 + index) * (definition.depthScale || 1))), planItem: key + 'Plan', price: [240, 650, 1400][index],
        yield: [3, 4, 5][index], daysPerInput: [.5, .4, .3][index], waterCapacity: [12000, 24000, 48000][index],
        minTownValue: [0, 1, 2][index] }; // Carpenter sale gate only (see FarmProduction.renderShop); farm presets still grant any tier.
    });
  }
  // Honeyfuzzle swarms are never barn animals: each lives in its own 1x1 house on the farm
  // (see js/honeyfuzzle-house.js). It is a production-style building — placed from a plan,
  // moved on the Farm map, managed from outside, never entered — whose one slot holds a
  // fertile egg waiting to hatch or the swarm that hatched from it.
  buildings.honeyfuzzleHouse = { label: 'Honeyfuzzle House', icon: '🍯', method: null, key: 'honeyfuzzleHouse', family: 'honeyfuzzleHouse', tier: 'single',
    w: 1, h: 1, planItem: 'honeyfuzzleHousePlan', price: 450, yield: 1, daysPerInput: 1, waterCapacity: 0, minTownValue: 0, hatchDays: 2,
    description: 'A hollow-log house for one honeyfuzzle swarm. Set a fertile egg inside and wait for it to hatch, or use a Growth Tonic to hatch it at once.' };
  const specializations = { // These supplies belong to shared world storage, granted once at creation.
    grower: { label: 'Farm', buildings: ['waterSiloSmall', 'compostBinSmall', 'windmillSmall'], storage: {
      needlegrainSeeds: 48, heftrootSeeds: 48, garlinkSeeds: 48, ongyumsSeeds: 48, redberrySeeds: 24, blueberrySeeds: 24,
      yellowberrySeeds: 24, whiteberrySeeds: 24, blackberrySeeds: 24, blackMustardSeed: 24, greenMustardSeed: 24,
    }, description: 'Grow crops, turn harvests into ingredients, and expand a productive farm. Suits players who enjoy industry, expansion, or cooking their own unique dishes with different combinations of buffs.',
      starterDescription: 'Starts with a small rainwater silo, compost bin and windmill, plus a generous seed stock in farm storage.' },
    rancher: { label: 'Ranch', buildings: ['barnMedium', 'barnIncubatorSmall', 'fodderMillSmall'], storage: {
      plantFodder: 99, meatFodder: 99,
      uumkaoiiEgg: 1, fertileDrenkirraEgg: 1, voorgAssBaby: 1, mootBaby: 1,
    }, description: 'Raise animals and experiment with breeding unique variants of wild species for livestock and adventuring companions. Suits players who love wildlife, discovery, and finding out what the next generation might become.',
      starterDescription: 'Starts with a completed medium barn with a one-slot incubator attached, a small fodder mill, fodder, two fertile eggs, a baby Voorg-ass and a baby Moot placeholder.' },
    preserver: { label: 'Smokery', buildings: ['smokehouseSmall', 'jerkyDryerSmall'], storage: {},
      description: 'Fish, explore the wilderness, and turn meat and fish into profitable preserved goods. Suits players who want to make the most of their adventures: queue a batch, head back into the wild, and let the buildings work without keeping you in the orbit of civilization.',
      starterDescription: 'Starts with a small smokehouse that accepts meat or fish and a small jerky dryer.' },
  };
  window.FARM_SPECIALIZATIONS_CONFIG = { palettes, buildings, specializations,
    nameWords: { first: ['Mist', 'Cloud', 'Dew', 'Fern', 'Moss', 'Thistle', 'Needlegrain', 'Larkspur', 'Willow', 'Stone'], last: ['Hollow', 'Glen', 'Meadow', 'Rise', 'Brook', 'Vale', 'Garden', 'Farmstead'] },
    siloReference: { crops: 24, lowWaterHarvestDays: 12, waterUnitsPerCropDay: 30, baselineStars: 3 },
  };
})();
