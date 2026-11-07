(() => {
  'use strict';

  // Crop inheritance uses the livestock system's simple parent-pick approach:
  // two color genes, two ingredient-effect genes, and two climate genes.
  // The six base-4 digits are the entire genotype, encoded in the crop key;
  // seeds, harvested goods, planted tiles and processor saves can restore it.
  const REGIONS = Object.freeze([
    { label: 'Hobunji Hollow', climate: 'foggy northwestern upland forest with heavy rain', ideal: null, growth: 1,
      season: { Deadgrass: 1, Stormtide: 1, Coldmuck: 1, Longpour: 1 } },
    { label: 'Eastern Rainforest', climate: 'hot equatorial lowlands and persistent humidity', ideal: [.61, .88], growth: .88,
      season: { Deadgrass: 1.08, Stormtide: 1.12, Coldmuck: .65, Longpour: 1.12 } },
    { label: 'Eastern Highplains', climate: 'Mashtzarr permafrost and exposed yellow-grass plains with occasional snow', ideal: [.16, .42], growth: 1.2,
      season: { Deadgrass: .82, Stormtide: 1.02, Coldmuck: 1.18, Longpour: .98 } },
    { label: 'Western Highlands', climate: 'eternally snowy western plateau, blizzards and snow forests', ideal: [.3, .59], growth: 1.35,
      season: { Deadgrass: .62, Stormtide: .95, Coldmuck: 1.3, Longpour: .94 } },
    { label: 'Northern Archipelago', climate: 'humid, sea-wind-driven islands with frequent squalls', ideal: [.46, .73], growth: 1.02,
      season: { Deadgrass: .84, Stormtide: 1.06, Coldmuck: .93, Longpour: 1.13 } },
    { label: 'Southern Archipelago', climate: 'steep cliff islands with cloud forests and windward rains', ideal: [.52, .83], growth: 1.06,
      season: { Deadgrass: .79, Stormtide: 1.15, Coldmuck: .92, Longpour: 1.17 } },
  ]); // Distinct canonical geography: the Mashtzarr Eastern Highplains are NOT the snowy western Highlands.
  // Season rates translate a plant's inherited climate tolerance into Hobunji's four local seasons, not a universal Khymeryyan weather calendar.
  const FAMILIES = Object.freeze([
    'needlegrain', 'heftroot', 'garlink', 'ongyums', 'redberries', 'blueberries',
    'yellowberries', 'whiteberries', 'blackberries', 'blackMustard', 'greenMustard',
  ]); // Existing farm crops remain the species boundary for uncomplicated crossbreeding.
  const NATIVE_COLORS = Object.freeze({
    needlegrain: 0xd4c526, heftroot: 0xf0d15a, garlink: 0xf2ead0, ongyums: 0xe09a4b,
    redberries: 0xff4f62, blueberries: 0x5f80ff, yellowberries: 0xffe86a,
    whiteberries: 0xffffff, blackberries: 0x17121f, blackMustard: 0x1f1812, greenMustard: 0x9bd66b,
  }); // Fallback ripe colors match VegetationCropRendering's existing native crop palette.
  const COLOR_FILTERS = Object.freeze([0xffffff, 0xd6ac72, 0xafc4aa, 0xb2c6ed, 0x72c7c8, 0xb98bce]); // Regional tint genes shared by renderer and seed catalog.
  const REGIONAL_EFFECTS = Object.freeze([null, 'foraging', 'fortitude', 'vigor', 'fishing', 'perception']); // Imported food traits reflect climate-driven cultivation, not a new buff system.
  const MAX_CODE = /^[0-5]{6}$/; // Prevents unbounded arbitrary keys from being installed as game items.
  const VARIANT_KEY = /^cv_(needlegrain|heftroot|garlink|ongyums|redberries|blueberries|yellowberries|whiteberries|blackberries|blackMustard|greenMustard)_([0-5]{6})(Seeds)?$/;
  let cropData = null; // Shared runtime cropData mutated in place; read by growth, planting and the farm.
  let itemDefs = null; // Shared ITEM_DEFS mutated in place; read by inventory, trader and cooking.
  let inventory = null; // Current player's seed/harvest stacks used to rehydrate saved hybrids.
  const known = new Set(); // Keys already registered as crops; avoids repeated catalog and UI work.
  const variants = new Map(); // Cached resolved traits: rendering thousands of frames must not rebuild item definitions.
  let lastChange = 'Regional crop varieties are gene-coded; no independent world save is required.';

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const seedKey = crop => crop + 'Seeds'; // Dynamic seed keys live in the ordinary inventory.
  const fromItemKey = key => {
    const match = VARIANT_KEY.exec(String(key || '')); // Used for saved produce, seed and tile crop IDs.
    return match && FAMILIES.includes(match[1]) ? { family: match[1], code: match[2] } : null;
  };
  const idFor = (family, code) => 'cv_' + family + '_' + code; // One deterministic crop identity per genotype.
  function genesFor(key) {
    if (FAMILIES.includes(key)) return { family: key, genes: '000000' };
    const parsed = fromItemKey(key); // Hybrid items and seeds both identify the same parent genotype.
    return parsed ? { family: parsed.family, genes: parsed.code } : null;
  }
  function mixHex(a, b) {
    const channel = shift => Math.round((((a >>> shift) & 255) + ((b >>> shift) & 255)) / 2); // Blend inherited color alleles without shared material mutations.
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }
  function tintedColor(base, filter) {
    const channel = shift => Math.round(((base >>> shift) & 255) * (.42 + .58 * ((filter >>> shift) & 255) / 255)); // Keep recognisable colors while differentiating origins.
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }
  function phenotype(family, code) {
    const base = cropData?.[family];
    if (!base || !MAX_CODE.test(code)) return null;
    const genes = [...code].map(Number); // Used to resolve two alleles in each of the three trait pairs.
    const color = mixHex(tintedColor(NATIVE_COLORS[family], COLOR_FILTERS[genes[0]]), tintedColor(NATIVE_COLORS[family], COLOR_FILTERS[genes[1]]));
    const nativeEffect = window.HobunjiCookingData?.items?.[base.cropKey]?.primaryEffect || 'farming'; // Canonical local ingredient buff.
    const effectA = REGIONAL_EFFECTS[genes[2]] || nativeEffect;
    const effectB = REGIONAL_EFFECTS[genes[3]] || nativeEffect;
    const effects = effectA === effectB ? { [effectA]: 2 } : { [effectA]: 1, [effectB]: 1 }; // Mixed crops carry both effects, without doubling total buff power.
    const moisture = [genes[4], genes[5]].map(index => REGIONS[index].ideal || [base.idealMin, base.idealMax]);
    const min = clamp((moisture[0][0] + moisture[1][0]) / 2, 0, 1);
    const max = clamp((moisture[0][1] + moisture[1][1]) / 2, min, 1);
    const growth = (REGIONS[genes[4]].growth + REGIONS[genes[5]].growth) / 2;
    const seasonGrowth = Object.fromEntries(Object.keys(REGIONS[0].season).map(season =>
      [season, (REGIONS[genes[4]].season[season] + REGIONS[genes[5]].season[season]) / 2])); // Climate genes influence cold/dry/wet-season performance separately from water needs.
    const region = code === '000000' ? REGIONS[0].label : genes.every(gene => gene === genes[0]) ? REGIONS[genes[0]].label : 'Crossbred';
    return { family, genes: code, color, effects, idealMin: min, idealMax: max, growDays: Math.max(1, Math.round(Number(base.growDays || 3) * growth * 10) / 10), seasonGrowth, region };
  }
  function register(family, code) {
    if (!FAMILIES.includes(family) || !MAX_CODE.test(code) || !cropData?.[family]) return null;
    const id = idFor(family, code);
    if (variants.has(id) && cropData[id] && (!itemDefs || itemDefs[seedKey(id)])) return variants.get(id); // Hot path for rendering, crop growth and inventory.
    const traits = phenotype(family, code);
    if (!traits) return null;
    const base = cropData[family];
    const label = traits.region + ' ' + (base.label || family);
    cropData[id] = { ...base, label, seedKey: seedKey(id), cropKey: id, baseCrop: family, idealMin: traits.idealMin,
      idealMax: traits.idealMax, growDays: traits.growDays, seasonGrowth: traits.seasonGrowth,
      varietyColor: traits.color, varietyGenes: code, varietyOrigin: traits.region };
    if (itemDefs) {
      const baseProduce = itemDefs[base.cropKey] || {}; // Existing produce properties continue to drive selling, shipping and cooking.
      const baseSeed = itemDefs[base.seedKey] || {}; // Existing seed category and icons stay compatible with inventory filters.
      const item = window.HobunjiCookingData?.items?.[base.cropKey]; // Dynamic varieties accept all of the original ingredient's recipe categories.
      if (item && window.HobunjiCookingData?.items) window.HobunjiCookingData.items[id] = {
        ...item, id, name: label, primaryEffect: Object.keys(traits.effects)[0], foodEffects: { ...traits.effects },
        tags: [...new Set([...(item.tags || []), 'Regional Variety'])],
      };
      itemDefs[id] = { ...baseProduce, label, icon: baseProduce.icon || base.emoji || '🌾', cat: baseProduce.cat || 'crop',
        sellPrice: Math.max(1, Math.round((Number(baseProduce.sellPrice) || 15) * 1.2)),
        cookingCategories: [...(baseProduce.cookingCategories || item?.categories || [])], cookingPrimaryEffect: Object.keys(traits.effects)[0],
        foodEffects: { ...traits.effects }, varietyColor: traits.color,
        tags: [...new Set([...(baseProduce.tags || []), 'Crop', 'Regional Variety'])],
        desc: traits.region + ' variety. Water ' + Math.round(traits.idealMin * 100) + '–' + Math.round(traits.idealMax * 100) + '%. ' + Object.keys(traits.effects).join(' / ') + ' ingredients.' };
      itemDefs[seedKey(id)] = { ...baseSeed, label: label + ' Seeds', icon: baseSeed.icon || '🌱', cat: baseSeed.cat || 'seed',
        sellPrice: Math.max(1, Math.round((Number(baseSeed.sellPrice) || 4) * 1.4)), varietyColor: traits.color,
        tags: [...new Set([...(baseSeed.tags || []), 'Seed', 'Regional Variety'])],
        desc: 'Plant on suitable soil. Origin: ' + traits.region + '. Prefers ' + Math.round(traits.idealMin * 100) + '–' + Math.round(traits.idealMax * 100) + '% water.' };
    }
    const variant = { id, seedKey: seedKey(id), label, ...traits }; // Stable public crop metadata cached until a world rebind.
    known.add(id); variants.set(id, variant);
    return variant;
  }
  function ensure(key) {
    const parsed = fromItemKey(key);
    return parsed ? register(parsed.family, parsed.code) : null;
  }
  function hydrate(stacks) {
    for (const key of Object.keys(stacks || {})) if (fromItemKey(key)) ensure(key);
  }
  function attach(deps = {}) {
    if (deps.cropData && deps.cropData !== cropData) { known.clear(); variants.clear(); } // World/replay rebinding restores the new runtime crop table.
    cropData = deps.cropData || cropData;
    itemDefs = deps.ITEM_DEFS || itemDefs;
    inventory = deps.inventory || inventory;
    if (!cropData) return;
    for (const family of FAMILIES) if (cropData[family]) for (let region = 1; region < REGIONS.length; region++)
      register(family, String(region).repeat(6)); // Every seed offer has a definition before traders roll stock.
    hydrate(inventory);
    if (itemDefs) window.CookingSystem?.registerIngredientItems?.(); // Populates the real cooking picker without creating a parallel food system.
  }
  function registered() {
    hydrate(inventory);
    return [...known].map(id => ({ id, seedKey: seedKey(id), label: cropData?.[id]?.label || id }));
  }
  function offers(rng = Math.random) {
    const families = FAMILIES.filter(family => cropData?.[family]); // Selected independently for each caravan; no new shop route.
    const count = Math.min(4, families.length);
    const pool = families.map(family => ({ family, n: rng() })).sort((a, b) => a.n - b.n).slice(0, count);
    return pool.map(({ family }) => {
      const region = 1 + Math.floor(rng() * (REGIONS.length - 1));
      const variety = register(family, String(region).repeat(6));
      return variety ? { key: variety.seedKey, qty: 2 + Math.floor(rng() * 4), region: variety.region } : null;
    }).filter(Boolean);
  }
  function produceFamily(key) {
    if (FAMILIES.includes(key)) return key;
    const parsed = fromItemKey(key); // Reject seeds: processors consume harvested crops, never seed stacks.
    return !String(key).endsWith('Seeds') && parsed ? parsed.family : null;
  }
  function breed(firstKey, secondKey, rng = Math.random) {
    const a = produceFamily(firstKey), b = produceFamily(secondKey);
    if (!a || !b || a !== b) return null; // Same crop species only, equivalent in complexity to livestock breeding.
    const first = genesFor(firstKey).genes, second = genesFor(secondKey).genes;
    const pick = (code, start) => Number(code[start + (rng() < .5 ? 0 : 1)]);
    const child = '' + pick(first, 0) + pick(second, 0) + pick(first, 2) + pick(second, 2) + pick(first, 4) + pick(second, 4);
    const genes = [...child];
    if (rng() < .025) { const locus = Math.floor(rng() * 6); genes[locus] = String(Math.floor(rng() * 4)); } // Rare single-allele mutation, as in livestock.
    const result = register(a, genes.join(''));
    if (result) lastChange = 'Crossbred ' + firstKey + ' × ' + secondKey + ' → ' + result.label + '.';
    return result;
  }
  function details(key) {
    const genes = genesFor(key);
    return genes && genes.genes !== '000000' ? phenotype(genes.family, genes.genes) : null;
  }
  window.CropVarieties = Object.freeze({ REGIONS, FAMILIES, attach, ensure, hydrate, registered, offers, produceFamily, breed, details,
    get lastChange() { return lastChange; } }); // Exposed for mobile production diagnostics and regression tests.
})();