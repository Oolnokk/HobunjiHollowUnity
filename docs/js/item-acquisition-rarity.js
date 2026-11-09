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

  const clampProbability = value => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value))
    || Number(value) < 0 || Number(value) > 1 ? null : Number(value); // Invalid odds remain unknown; never silently clamp them to certainty.
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
    return p === null || opportunities == null || !Number.isInteger(n) || n < 0 ? null : n === 0 ? 0 : p === 1 ? 1 : -Math.expm1(n * Math.log1p(-p));
  }
  function expected(chance, opportunities) {
    const p = clampProbability(chance), n = Number(opportunities);
    return p === null || opportunities == null || !Number.isFinite(n) || n < 0 ? null : p * n;
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
    const opportunities = chestsPerRoom == null || !Number.isInteger(Number(chestsPerRoom)) || Number(chestsPerRoom) < 0
      ? null : roomCount * Number(chestsPerRoom); // Bernoulli opportunities must be whole, nonnegative chest slots.
    const chancePerChest = clampProbability(lootChance);
    const chestProbability = clampProbability(chestChance);
    const stages = [
      { label: 'Ruin site of this tier', probability: siteChance },
      { label: 'Chest in eligible room', probability: chestProbability },
      { label: 'Item in tier-' + chestTier + ' chest', probability: chancePerChest },
    ];
    const result = chain(stages);
    return { ...layout, chestTier, eligibleRooms: roomCount, opportunities, sourceBasis:'conditional on a generated ruin of this tier; site frequency is reported separately',
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
    const family = Number.isInteger(familyCount) && familyCount > 0 && Number.isInteger(offeredFamilies) && offeredFamilies >= 0
      ? Math.min(1, offeredFamilies / familyCount) : null;
    const region = Number.isInteger(importRegions) && importRegions > 0 ? 1 / importRegions : null;
    const possibleFamilies = G.CropVarieties?.FAMILIES; // Existing crop authority rejects unattainable family names when initialized.
    const chosenFamilyChance = Array.isArray(possibleFamilies) && targetFamily !== null && !possibleFamilies.includes(targetFamily) ? 0 : family;
    const chosenRegionChance = targetRegion != null && (!Number.isInteger(Number(targetRegion)) || Number(targetRegion) < 1 || Number(targetRegion) > importRegions) ? 0 : region;
    const arrival = caravanEligible === true ? daily : caravanEligible === false ? 0 : null;
    const stages = [{ label: 'Daily caravan arrival roll', probability: arrival }];
    if (targetFamily !== null) stages.push({ label: 'Chosen crop family', probability: chosenFamilyChance });
    if (targetRegion !== null) stages.push({ label: 'Chosen import region', probability: chosenRegionChance });
    const result = chain(stages);
    const specificStockChance = chosenFamilyChance == null || chosenRegionChance == null ? null : chosenFamilyChance * chosenRegionChance;
    return { ...result, dailyCaravanChance: daily, familyChancePerCaravan: family,
      regionChanceGivenFamily: region, specificSeedChancePerCaravan: specificStockChance,
      specificSeedChancePerDay: arrival == null || specificStockChance == null ? null : arrival * specificStockChance,
      caveat: 'Assumes a caravan can spawn and its stock is rolled; route access, active-caravan caps and purchases are separate constraints.' };
  }
  function inheritance({ parentA, parentB, target, mutationChance = .025, alleleCount = 6 } = {}) {
    if (![parentA, parentB,target].every(code => typeof code === 'string' && /^[0-5]{6}$/.test(code))
      || alleleCount !== 6 || clampProbability(mutationChance) === null) return null; // The production breeder always has six loci and one possible mutation.
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
    const proposedSellPrice = p === null || p <= 0 || baseSellPrice == null || !Number.isFinite(Number(baseSellPrice))
      || Number(baseSellPrice) <= 0 ? null
      : Math.max(1, Math.round(Number(baseSellPrice) * Math.min(PRICE_CAP,
        Math.pow(Math.max(MIN_PROBABILITY, referenceProbability) / Math.max(MIN_PROBABILITY, p), PRICE_EXPONENT))));
    return { ...result, opportunities, expectedCount: p === null ? null : expected(p, opportunities),
      chanceAtLeastOne: p === null ? null : atLeastOne(p, opportunities),
      proposedSellPrice };
  }

  // Native crops and ordinary ingredients have a neutral rarity factor until a real
  // acquisition source is known. These factors describe supply, not item quality.
  const CULTIVAR_KEY = /^cv_(needlegrain|heftroot|garlink|ongyums|redberries|blueberries|yellowberries|whiteberries|blackberries|blackMustard|greenMustard)_([0-5]{6})(?:_([0-9a-f]{6}))?(Seeds)?$/;
  const REFERENCE_DAY_CHANCE = .15; // A common-enough opportunity; used only to normalize contest/economy premiums.
  let boundItemDefs = null; // Live ITEM_DEFS passed by CropVarieties.attach for mobile diagnostics; replaces itself on world rebind.
  function bindItemDefs(defs) { if (defs && typeof defs === 'object') boundItemDefs = defs; }
  function rarityFactor(probability, options = {}) {
    const p = clampProbability(probability);
    if (p === null || p === 0) return null;
    const reference = clampProbability(options.reference ?? REFERENCE_DAY_CHANCE);
    const exponent = Number(options.exponent ?? .22);
    const cap = Number(options.cap ?? 3.5);
    if (reference === null || !Number.isFinite(exponent) || exponent < 0 || !Number.isFinite(cap) || cap < 1) return null;
    return Math.max(1, Math.min(cap, Math.pow(reference / p, exponent)));
  }
  function cultivarRarity(key) {
    const match = CULTIVAR_KEY.exec(String(key || ''));
    if (!match) return null;
    const code = match[2], digits = [...code].map(Number);
    const pureImport = !match[3] && digits[0] !== 0 && digits.every(v => v === digits[0]);
    const imported = pureImport ? caravanSeed({ townValue:1, targetFamily:match[1], targetRegion:digits[0] }) : null;
    const distinctRegions = new Set(digits.filter(v => v !== 0)).size;
    const mixedPairs = [0,2,4].filter(i => digits[i] !== digits[i+1]).length;
    // Crosses can be made by many genealogies; without saved parents this is
    // explicitly a complexity proxy, NEVER a claimed per-breeding probability.
    const heuristicFactor = Math.min(3.5, 1 + .2 * distinctRegions + .12 * mixedPairs + (match[3] ? .1 : 0));
    const factor = pureImport ? rarityFactor(imported.specificSeedChancePerDay) : Math.max(1, heuristicFactor);
    return { key, family:match[1], code, colorHex:match[3] || null, isSeed:!!match[4],
      kind:'cultivar', origin:pureImport ? 'slagothim-import' : 'crossbred-or-inherited',
      probability:pureImport ? imported.specificSeedChancePerDay : null, factor,
      model:pureImport ? 'daily independent caravan-stock roll at Town Value 1, before travel restrictions'
        : 'genotype-complexity proxy; actual breeding odds depend on parent genotypes and breeding opportunities',
      importStages:imported?.stages || null, distinctRegions, mixedPairs };
  }
  function cultivarSellPrice(key, nativeSellPrice) {
    const info = cultivarRarity(key);
    const baseline = Number(nativeSellPrice);
    if (!info || nativeSellPrice == null || !Number.isFinite(baseline) || baseline <= 0) return null;
    // Stable across town-growth changes; harvested crops replicate, while imported
    // seeds preserve a slightly higher scarcity premium. No speculative values for
    // other item categories are written into the ordinary economy.
    const authoredMarkup = info.isSeed ? 1.4 : 1.2;
    const exposure = info.isSeed ? .7 : .5;
    return Math.max(1, Math.round(baseline * authoredMarkup * Math.pow(info.factor, exposure)));
  }
  function foodRarity(key, defs = null, seen = new Set()) {
    if (!key || seen.has(key) || seen.size >= 10) return { factor:1, known:false, sources:[] };
    const crop = cultivarRarity(key);
    if (crop) return { factor:crop.factor, known:crop.origin === 'slagothim-import', sources:[crop] };
    const fish = fishRarity(key);
    if (fish) return { factor:fish.factor, known:true, sources:[fish] };
    const localDefs = defs || boundItemDefs || G.ITEM_DEFS || {};
    const def = localDefs[key] || G.HobunjiCookingData?.items?.[key] || {};
    // A processed item inherits its source ingredients' difficulty without
    // awarding an extra scarcity premium for its processing depth (Gorkunash
    // already doubles for each processing step).
    const ingredients = [...new Set((def.ingredientKeys?.length ? def.ingredientKeys : def.giftIngredientKeys || []).filter(x => typeof x === 'string' && x !== key))];
    if (!ingredients.length) return { factor:1, known:false, sources:[] };
    const next = new Set(seen); next.add(key);
    const parts = ingredients.map(child => foodRarity(child, localDefs, next));
    const factor = Math.exp(parts.reduce((sum, part) => sum + Math.log(Math.max(1, part.factor)), 0) / parts.length);
    return { factor, known:parts.some(part => part.known), sources:parts.flatMap(part => part.sources) };
  }
  function artifactChest(key, chestTier = 1, culture = 'harlyao', catalog = G.ArtifactCollection) {
    const artifacts = catalog?.ARTIFACTS, tuning = catalog?.LOOT_TUNING;
    const def = artifacts?.[key];
    if (!def || !tuning?.countsByTier) return null;
    const tier = Math.max(1, Math.min(4, Math.floor(Number(chestTier) || 1)));
    const kind = culture === 'hachutu' ? 'hachutu' : 'harlyao';
    const eligible = Object.entries(artifacts).filter(([id,item]) => id.startsWith('hachutu') === (kind === 'hachutu') && item.tier <= tier);
    const sum = eligible.reduce((total,[,item]) => total + Number(item.weight || 0),0);
    const weight = eligible.some(([id]) => id === key) ? Number(def.weight || 0) : 0;
    const counts = tuning.countsByTier[tier-1];
    if (!sum || !counts || !Number.isInteger(counts.min) || !Number.isInteger(counts.max) || counts.max < counts.min) return null;
    const drawProbability = weight / sum;
    const averageDraws = (counts.min + counts.max) / 2;
    let zeroChance = 0; // Average of no-copy outcomes over every equally likely chest batch size.
    for (let n = counts.min; n <= counts.max; n++) zeroChance += Math.pow(1 - drawProbability,n);
    zeroChance /= counts.max - counts.min + 1;
    return { key, chestTier:tier, culture:kind, eligible:weight > 0,
      drawProbability, probability:1 - zeroChance, expectedCopies:drawProbability * averageDraws,
      draws:{ min:counts.min, max:counts.max },
      model:'conditional on opening one generated chest of this tier; site and chest frequency are not assumed' };
  }
  function lootPoolItem(key, poolId, pools = G.LootRolling?.getLootPools?.()) {
    const pool = pools?.[poolId];
    if (!pool) return null;
    const matches = (pool.entries || []).filter(entry => entry?.itemKey === key);
    if (matches.length === 0) return { key, poolId, probability:0, eligible:false };
    const stages = matches.map(entry => ({
      label:entry.id || key,
      probability:entry.chance ?? 1,
      conditions:entry.conditions || {},
      eligibilityKnown:!Object.values(entry.conditions || {}).some(value => Array.isArray(value) ? value.length : value != null),
    }));
    // Multiple independent entries for the same key (rare) are a union, not a sum.
    const odds = stages.every(stage => stage.eligibilityKnown)
      ? 1 - stages.reduce((none,stage) => none * (1 - (clampProbability(stage.probability) ?? 0)),1)
      : null;
    return { key, poolId, probability:odds, entries:stages, eligible:odds !== 0,
      model:'per pool roll, before any unknown parent pool or encounter frequency' };
  }
  function denOffspring({ zoneId = null, species, denCount = null, denSpecies = null,
    clutchMin = null, clutchMax = null, nestChance = null } = {}) {
    const zone = G.WildlifeSpawn?.zoneConfigFor?.(zoneId) || G.SCRATCHBONES_CONFIG?.game?.wilderness?.zones?.[zoneId];
    const pool = denSpecies || zone?.denSpecies || null;
    const dens = denCount == null ? null : Number(denCount);
    const speciesPool = Array.isArray(pool) ? [...new Set(pool)] : [];
    const members = speciesPool.length;
    const exists = members > 0 && speciesPool.includes(species);
    let slots = null;
    if (dens != null && Number.isInteger(dens) && dens >= 0 && members) {
      const base = Math.floor(dens / members);
      const rank = speciesPool.map((id,index) => ({id,index,weight:id === 'nazgraku' ? .8 : 1}))
        .sort((a,b) => b.weight - a.weight || a.index - b.index);
      const extra = rank.slice(0,dens - base * members).some(x => x.id === species);
      slots = exists ? base + Number(extra) : 0;
    }
    const nest = clampProbability(nestChance);
    const clutchKnown = Number.isInteger(clutchMin) && Number.isInteger(clutchMax) && clutchMin > 0 && clutchMax >= clutchMin;
    const perRandomDen = slots === null || !dens ? null : slots / dens;
    const result = chain([
      {label:'Den assigned to this species',probability:perRandomDen},
      {label:'Nest survives/contains offspring',probability:nest},
    ]);
    return { zoneId,species,denCount:denCount ?? null,speciesDenCount:slots,perRandomDen,
      expectedOffspring:slots === null || !clutchKnown || nest === null ? null : slots * nest * (clutchMin + clutchMax) / 2,
      clutchRange:clutchKnown ? {min:clutchMin,max:clutchMax} : null,
      ...result, model:'balanced species allocation among real zone dens; nest probability and clutch supplied by caller' };
  }

  function liveDenOffspring(itemKey, { zoneId = null, census = null, mothers = null, clutch = null } = {}) {
    const allMothers = mothers || G.SCRATCHBONES_CONFIG?.game?.wildlife?.denMothers;
    const roster = census || (zoneId ? G.WildlifeSpawn?.denCensus?.(zoneId) : null);
    const clutchRules = clutch || G.SCRATCHBONES_CONFIG?.game?.wildlife?.nestClutch;
    if (!allMothers || !Array.isArray(roster)) return null;
    const matchingSpecies = Object.keys(allMothers).filter(kind => allMothers[kind]?.nestItemKey === itemKey);
    if (!matchingSpecies.length) return null; // Surface nests and roaming herds use different owners; don't invent a den probability.
    const accessible = roster.filter(den => den && !den.collapsed && den.stage !== 'collapsed');
    const assigned = accessible.filter(den => matchingSpecies.includes(den.species));
    const clutchMin = Number(clutchRules?.min), clutchMax = Number(clutchRules?.max);
    const validClutch = Number.isInteger(clutchMin) && Number.isInteger(clutchMax) && clutchMin > 0 && clutchMax >= clutchMin;
    const probability = roster.length ? assigned.length / roster.length : 0; // Exact conditional odds among real generated den sites.
    const recorded = assigned.map(den => {
      const mapId = zoneId != null ? G.WildlifeSpawn?.denCavernMapId?.(zoneId, den.denId) : null;
      const record = mapId ? G.WildlifeSpawn?.denTurnoverStateForCavern?.(mapId) : null;
      return record?.clutch?.itemKey === itemKey && record.clutch.remaining != null && Number.isFinite(Number(record.clutch.remaining))
        ? Math.max(0,Math.floor(Number(record.clutch.remaining))) : null;
    });
    const allRecorded = recorded.every(n => n !== null);
    return {itemKey,zoneId,species:matchingSpecies,denCount:roster.length,accessibleDens:accessible.length,
      speciesDenCount:assigned.length,probability,
      currentlyRecordedOffspring:allRecorded ? recorded.reduce((sum,n)=>sum+n,0) : null,
      potentialClutchRange:validClutch ? {min:clutchMin,max:clutchMax} : null,
      potentialMeanOffspring:validClutch ? assigned.length*(clutchMin+clutchMax)/2 : null,
      model:'Exact species assignment among current den sites; unless all clutch records exist, remaining loot and encounter viability are unverified.'};
  }
  const FISH_SEASON_LABELS = Object.freeze({ spring:'Stormtide', summer:'Deadgrass', fall:'Longpour', winter:'Coldmuck' }); // FishCatalog stores raw season codes; Fishing uses translated names.
  function fishSeasons(fish) {
    if (fish?.seasons === 'any') return 'any';
    const raw = Array.isArray(fish?.seasons) ? fish.seasons : String(fish?.seasons || '').split(',');
    return [...new Set(raw.map(season => FISH_SEASON_LABELS[season] || season).filter(Boolean))];
  }
  function fishCatch(key, {zone,season,timeOfDay,allowAmphibious = true,rareFishWeightMultiplier = null,perkRank = 0,
    entries = G.FishCatalog?.entries} = {}) {
    if (!Array.isArray(entries) || !zone || !season || !timeOfDay) return null;
    const zoneKeys = zone === 'westernSlope' ? ['westernSlope','northernCliffs'] : [zone]; // Fishing.buildFishingDefs duplicates the northern pool for Western Slope.
    const all = entries.filter(fish => Array.isArray(fish.zones) && fish.zones.some(z => zoneKeys.includes(z))
      && (allowAmphibious || !fish.amphibious)); // The canonical minigame excludes amphibious fish when fishing from shore.
    if (!all.length) return { key,zone,season,timeOfDay,probability:null,reason:'no fish in zone' };
    const seasonName = FISH_SEASON_LABELS[season] || season;
    let eligible = all.filter(fish => (fishSeasons(fish) === 'any' || fishSeasons(fish).includes(seasonName))
      && (fish.timesOfDay === 'any' || fish.timesOfDay?.includes?.(timeOfDay)));
    if (!eligible.length) eligible = all; // Canonical fishing minigame fallback when a time band has no eligible fish.
    const baseWeights = {common:6,uncommon:3,rare:1};
    const rank = Math.max(0,Number(perkRank)||0);
    const weight = fish => (baseWeights[fish.rarity] || 1)
      * (typeof rareFishWeightMultiplier === 'function' ? rareFishWeightMultiplier(fish.rarity) : 1)
      * (fish.rarity === 'uncommon' ? 1 + rank*.25 : fish.rarity === 'rare' ? 1 + rank*.55 : 1);
    const total = eligible.reduce((sum,fish) => sum + Math.max(0,Number(weight(fish))||0),0);
    const probability = total ? eligible.filter(fish=>fish.key===key).reduce((sum,fish)=>sum+Math.max(0,Number(weight(fish))||0),0)/total : null;
    return {key,zone,season:seasonName,timeOfDay,allowAmphibious,eligibleCount:eligible.length,probability,
      model:'conditional on one fish selection in this zone/season/time band; catching/reeling, habitat access and equipment are separate' };
  }
  function fishRarity(key, entries = G.FishCatalog?.entries) {
    const fish = entries?.find?.(f => f.key === key);
    if (!fish) return null;
    const weights = {common:6,uncommon:3,rare:1};
    const sourceWeight = weights[fish.rarity] || 1;
    const seasonal = fishSeasons(fish);
    const seasons = seasonal === 'any' ? 4 : seasonal.length;
    const hours = {dawn:8,day:9,dusk:3,night:4}; // Same 08/17/20 fishing-time boundaries in fishing-minigame.js.
    const timeHours = fish.timesOfDay === 'any' ? 24
      : Array.isArray(fish.timesOfDay) ? [...new Set(fish.timesOfDay)].reduce((sum,phase)=>sum+(hours[phase]||0),0) : 24;
    // Authored rarity class × season and daypart availability; without zone
    // distribution this is a bounded contest proxy, not an unconditional catch probability.
    const opportunityFraction = Math.max(1/96,Math.min(1,seasons/4)*Math.max(1,timeHours)/24);
    const factor = Math.min(3.5,Math.pow(6/sourceWeight/opportunityFraction,.22));
    return {key,fishRarity:fish.rarity,sourceWeight,opportunityFraction,availableSeasons:seasonal,factor,
      model:'availability/rarity proxy, not unconditional acquisition probability' };
  }
  function ruinArtifactOpportunity(key, {chests = G.DevRandomRuinDungeonChests?.snapshot?.(),sourceKind = 'entrance',
    siteProbability = sourceKind === 'buried-hole' ? G.RuinSites?.treasureHoleChance?.() : null,
    culture = key.startsWith('hachutu') ? 'hachutu' : 'harlyao'} = {}) {
    if (!Array.isArray(chests)) return null;
    const relevant = chests.filter(chest => (chest.culture || 'harlyao') === culture);
    const outcomes = relevant.map(chest => artifactChest(key,chest.tier,culture)).filter(Boolean);
    const perRuin = 1 - outcomes.reduce((none,x) => none * (1-x.probability),1); // Independent chest-loot rolls, conditional on opening all displayed chests.
    const copies = outcomes.reduce((sum,x) => sum + x.expectedCopies,0);
    const origin = chain([{label:'Ruin site reached',probability:siteProbability},
      {label:'At least one copy in the generated chests',probability:perRuin}]);
    return {key,sourceKind,chestCount:outcomes.length,tierCounts:outcomes.reduce((counts,x)=>(counts[x.chestTier]=(counts[x.chestTier]||0)+1,counts),{}),
      conditionalChancePerRuin:perRuin,expectedCopiesPerRuin:copies,siteAndLoot:origin,
      model:'Uses actual generated chest roster. Site probability is known only for buried holes per treasure location.' };
  }
  function item(key, context = {}) {
    const defs = context.itemDefs || boundItemDefs || G.ITEM_DEFS || {};
    const def = defs[key] || {};
    const cultivar = cultivarRarity(key);
    if (cultivar) {
      const currentRoll = cultivar.origin === 'slagothim-import' ? caravanSeed({
        townValue:context.townValue ?? G.TownMine?.getTownValue?.() ?? 1,
        targetFamily:cultivar.family,targetRegion:Number(cultivar.code[0]) }) : null;
      return { ...cultivar, acquisition:cultivar.probability === null ? null
        : source({ stages:cultivar.importStages }), // Acquisition report must not apply a second rarity markup to the live sale price.
        currentDailyRollChance:currentRoll?.specificSeedChancePerDay ?? null,
        actualSellPrice:Number.isFinite(Number(def.sellPrice)) ? Number(def.sellPrice) : null,
        proposedSellPrice:cultivarSellPrice(key,context.nativeSellPrice ?? def.rarityBaseSellPrice ?? null),
        note:cultivar.model };
    }
    const offspring = context.zoneId ? liveDenOffspring(key,{zoneId:context.zoneId}) : null;
    if (offspring) return {key,kind:'offspring',acquisition:offspring,note:offspring.model};
    const fish = fishRarity(key);
    if (fish) return {key,kind:'fish',rarity:fish,acquisition:context.fishZone && context.season && context.timeOfDay
      ? fishCatch(key,{zone:context.fishZone,season:context.season,timeOfDay:context.timeOfDay,perkRank:context.perkRank||0}) : null};
    const culture = String(key).startsWith('hachutu') ? 'hachutu' : 'harlyao';
    const artifact = G.ArtifactCollection?.ARTIFACTS?.[key] ? artifactChest(key,context.chestTier || 4,culture) : null;
    if (artifact) return { key,kind:'artifact',acquisition:artifact,
      note:'The conditional chest probability is exact for the weighted artifact draw; generator/site rates remain unquantified.' };
    const pools = context.lootPools || G.LootRolling?.getLootPools?.();
    const sourced = context.poolId ? lootPoolItem(key,context.poolId,pools) : null;
    if (sourced) return {key,kind:def.cat || 'loot',acquisition:sourced,note:sourced.model};
    const ingredients = foodRarity(key,defs);
    return { key,kind:def.cat || 'unknown',foodRarity:ingredients.factor,
      acquisition:context.stages ? source({stages:context.stages,opportunities:context.opportunities ?? 1,baseSellPrice:def.sellPrice}) : null,
      note:context.stages ? null : 'Unquantified source; no automatic rarity price or contest premium.' };
  }
  return Object.freeze({ chain, atLeastOne, expected, tierLayout, ruinChest, caravanSeed, inheritance, source,
    bindItemDefs, rarityFactor, cultivarRarity, cultivarSellPrice, foodRarity, artifactChest, lootPoolItem, denOffspring, liveDenOffspring, fishCatch, fishRarity, ruinArtifactOpportunity, item,
    debugSnapshot: key => key ? item(key) : { supported:['cultivar','artifact-chest','ruin-chest','loot-pool','den-offspring','live-den-offspring','fish-catch','generated-ruin','food-ancestry','inheritance'],
      priceMode:'cultivar-integrated; other categories retain their authored value', noSilentFallback:true } });

});
