(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ItemAcquisitionRarity = api;
})(typeof self !== 'undefined' ? self : globalThis, function (G) {
  'use strict';

  // Probabilities are per explicitly named opportunity; unknown factors stay unknown,
  // rather than being silently replaced by invented world-generation odds.
  const MIN_PROBABILITY = 1e-12; // Protects inverse-rarity prices against unbounded growth.
  const PRICE_EXPONENT = 0.35; // Dampens rarity's impact on proposed sale values.
  const PRICE_CAP = 8; // Maximum rarity premium relative to an authored base price.
  const RUIN_TIERS = Object.freeze({
    cave: Object.freeze({ floors: 2, wings: 3, roomsPerWing: 2 }),
    hole: Object.freeze({ floors: 3, wings: 4, roomsPerWing: 3 }),
    lich: Object.freeze({ floors: 4, wings: 5, roomsPerWing: 3 }),
  }); // Mirrors RuinLayerPlan.TIERS; used only when the runtime planner is unavailable.

  const clampProbability = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : null;
  function chain(stages) {
    let probability = 1; // Joint probability of all supplied conditional stages.
    const breakdown = []; // Mobile diagnostics retain the source of every multiplier.
    const unknown = []; // Missing opportunities must not masquerade as zero rarity.
    for (const stage of stages || []) {
      const chance = clampProbability(stage?.probability);
      if (chance === null) { unknown.push(stage?.label || 'unknown'); continue; }
      probability *= chance;
      breakdown.push({ label: String(stage.label || 'opportunity'), probability: chance });
    }
    return { probability: unknown.length ? null : probability, conditionalProbability: probability, stages: breakdown, unknown };
  }
  function atLeastOne(chance, opportunities) {
    const p = clampProbability(chance), n = Number(opportunities);
    return p === null || !Number.isInteger(n) || n < 0 ? null : -Math.expm1(n * Math.log1p(-p));
  }
  function expected(chance, opportunities) {
    const p = clampProbability(chance), n = Number(opportunities);
    return p === null || !Number.isFinite(n) || n < 0 ? null : p * n;
  }
  function tierLayout(tier) {
    const authored = G.RuinLayerPlan?.TIERS?.[tier] || RUIN_TIERS[tier]; // Use actual generator settings when available.
    if (!authored) return null;
    const floors = Number(authored.floors), wings = Number(authored.wings);
    const roomsPerWing = Number(authored.wingRooms ?? authored.roomsPerWing);
    return { tier, floors, wings, roomsPerWing, rooms: wings * roomsPerWing + floors,
      challengeRooms: wings * (roomsPerWing - 1), brazierRooms: wings };
  }
  function ruinChest({ tier = 'hole', chestTier = 1, chestsPerRoom = null, chestChance = null,
    lootChance = null, siteChance = null, source = 'room' } = {}) {
    const layout = tierLayout(tier);
    if (!layout) return null;
    const roomCount = source === 'challenge' ? layout.challengeRooms : layout.rooms;
    const opportunities = chestsPerRoom === null ? null : roomCount * Number(chestsPerRoom);
    const chancePerChest = clampProbability(lootChance);
    const chestProbability = clampProbability(chestChance);
    const stages = [
      { label: 'Ruin site of this tier', probability: siteChance },
      { label: 'Chest in eligible room', probability: chestProbability },
      { label: 'Item in tier-' + chestTier + ' chest', probability: chancePerChest },
    ];
    const result = chain(stages);
    return { ...layout, chestTier, eligibleRooms: roomCount, opportunities,
      perChest: result, expectedChests: opportunities === null ? null : expected(chestProbability, opportunities),
      expectedItems: opportunities === null || chestProbability === null || chancePerChest === null
        ? null : opportunities * chestProbability * chancePerChest,
      chanceAtLeastOne: opportunities === null || chestProbability === null || chancePerChest === null
        ? null : atLeastOne(chestProbability * chancePerChest, opportunities) };
  }
  function caravanSeed({ townValue = 1, familyCount = 11, offeredFamilies = 4, importRegions = 5,
    targetFamily = null, targetRegion = null, caravanEligible = true } = {}) {
    const value = Math.max(0, Math.floor(Number(townValue) || 0));
    const daily = value < 1 ? 0 : Math.min(.7, .15 + (value - 1) * .06); // SlagothimTraders.TUNING daily arrival roll.
    const family = Math.min(1, offeredFamilies / Math.max(1, familyCount));
    const region = 1 / Math.max(1, importRegions);
    const stages = [{ label: 'Daily caravan arrival roll', probability: caravanEligible ? daily : null }];
    if (targetFamily !== null) stages.push({ label: 'Chosen crop family', probability: family });
    if (targetRegion !== null) stages.push({ label: 'Chosen import region', probability: region });
    const result = chain(stages);
    return { ...result, dailyCaravanChance: daily, familyChancePerCaravan: family,
      regionChanceGivenFamily: region, specificSeedChancePerCaravan: family * region,
      specificSeedChancePerDay: caravanEligible ? daily * family * region : null,
      caveat: 'Assumes a caravan can spawn and its stock is rolled; route access, active-caravan caps and purchases are separate constraints.' };
  }
  function inheritance({ parentA, parentB, target, mutationChance = .025, alleleCount = 6 } = {}) {
    if (![parentA, parentB,target].every(code => typeof code === 'string' && /^[0-5]{6}$/.test(code))) return null;
    let noMutation = 1; // Product of independent Mendelian picks at each locus.
    for (let i = 0; i < alleleCount; i++) {
      const parent = i % 2 === 0 ? parentA : parentB;
      const start = i - i % 2;
      const matches = Number(parent[start] === target[i]) + Number(parent[start + 1] === target[i]);
      noMutation *= matches / 2;
    }
    let mutated = 0; // Mutation replaces one uniformly selected locus with a random regional allele.
    for (let locus = 0; locus < alleleCount; locus++) {
      let chance = 1 / 6;
      for (let i = 0; i < alleleCount; i++) {
        if (i === locus) continue;
        const parent = i % 2 === 0 ? parentA : parentB;
        const start = i - i % 2;
        chance *= (Number(parent[start] === target[i]) + Number(parent[start + 1] === target[i])) / 2;
      }
      mutated += chance / alleleCount;
    }
    return { probability: (1 - mutationChance) * noMutation + mutationChance * mutated,
      withoutMutation: noMutation, mutationContribution: mutationChance * mutated,
      caveat: 'Conditional on breeding this specific pair. Exact blended RGB color follows deterministic parent averaging.' };
  }
  function source({ stages = [], opportunities = 1, baseSellPrice = null, referenceProbability = 1 } = {}) {
    const result = chain(stages);
    const p = result.probability;
    const proposedSellPrice = p === null || p <= 0 || !Number.isFinite(Number(baseSellPrice))
      || Number(baseSellPrice) < 0 ? null
      : Math.max(1, Math.round(Number(baseSellPrice) * Math.min(PRICE_CAP,
        Math.pow(Math.max(MIN_PROBABILITY, referenceProbability) / Math.max(MIN_PROBABILITY, p), PRICE_EXPONENT))));
    return { ...result, opportunities, expectedCount: p === null ? null : expected(p, opportunities),
      chanceAtLeastOne: p === null ? null : atLeastOne(p, opportunities),
      proposedSellPrice };
  }
  function item(key, context = {}) {
    const def = context.itemDefs?.[key] || G.ITEM_DEFS?.[key] || {};
    const cultivar = /^cv_(needlegrain|heftroot|garlink|ongyums|redberries|blueberries|yellowberries|whiteberries|blackberries|blackMustard|greenMustard)_([0-5]{6})(?:_([0-9a-f]{6}))?(Seeds)?$/.exec(String(key));
    if (cultivar) {
      const offer = caravanSeed({ townValue: context.townValue ?? G.TownMine?.getTownValue?.() ?? 1,
        targetFamily: cultivar[1], targetRegion: cultivar[2].split('').every(v => v === cultivar[2][0]) && cultivar[2][0] !== '0' ? cultivar[2][0] : null });
      const pureImport = !cultivar[3] && offer.stages.length === 3;
      return { key, kind: 'cultivar', origin: pureImport ? 'slagothim-import' : 'crossbred-or-inherited',
        ...offer, acquisition: pureImport ? source({ stages: offer.stages, baseSellPrice: def.sellPrice }) : null,
        note: pureImport ? 'Per-day estimate before route and caravan-cap restrictions.' : 'Crossbred genotype probability requires known parent genes and number of breeding attempts.' };
    }
    return { key, kind: def.cat || 'unknown', acquisition: context.stages
      ? source({ stages: context.stages, opportunities: context.opportunities ?? 1, baseSellPrice: def.sellPrice }) : null,
      note: context.stages ? null : 'Supply source probabilities not yet registered; authored sell price remains authoritative.' };
  }
  return Object.freeze({ chain, atLeastOne, expected, tierLayout, ruinChest, caravanSeed, inheritance, source, item,
    debugSnapshot: key => key ? item(key) : { supported: ['cultivar','ruin-chest','custom-source','inheritance'], priceMode: 'proposal-only', noSilentFallback: true } });
});
