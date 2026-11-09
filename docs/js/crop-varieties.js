(() => {
  'use strict';

  // Crop inheritance uses the livestock system's simple parent-pick approach:
  // two color genes, two ingredient-effect genes, and two climate genes.
  // Six base-6 digits hold inherited traits. New crosses also encode their exact
  // blended RGB color in the crop key to survive generations and save/restore;
  // the original six-digit cultivar keys remain backward compatible.
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
  const MUSHTARD_LABELS = Object.freeze({ blackMustard: 'Black Mushtard', greenMustard: 'Green Mushtard' }); // Player-facing names only; unchanged species IDs preserve existing saves and recipes.
  const mushtardDisplayText = value => String(value).replace(/mustard/gi, match => match === match.toUpperCase() ? 'MUSHTARD' : match[0] === 'M' ? 'Mushtard' : 'mushtard'); // Keeps mobile pack labels' original capitalization while changing only visible text.
  const NATIVE_COLORS = Object.freeze({
    needlegrain: 0xd4c526, heftroot: 0xf0d15a, garlink: 0xf2ead0, ongyums: 0xe09a4b,
    redberries: 0xff4f62, blueberries: 0x5f80ff, yellowberries: 0xffe86a,
    whiteberries: 0xffffff, blackberries: 0x17121f, blackMustard: 0x1f1812, greenMustard: 0x9bd66b,
  }); // Fallback ripe colors match VegetationCropRendering's existing native crop palette.
  const COLOR_FILTERS = Object.freeze([0xffffff, 0xd6ac72, 0xafc4aa, 0xb2c6ed, 0x72c7c8, 0xb98bce]); // Regional tint genes shared by renderer and seed catalog.
  const REGIONAL_EFFECTS = Object.freeze([null, 'foraging', 'fortitude', 'vigor', 'fishing', 'perception']); // Imported food traits reflect climate-driven cultivation, not a new buff system.
  const TRADE_OFFER_LIMIT = 4; // Used by both real caravan seed rolls and the item rarity estimate.
  const TRADE_QUANTITY_MIN = 2; // Smallest regional seed packet on one Slagothim caravan.
  const TRADE_QUANTITY_MAX = 5; // Largest regional seed packet on one Slagothim caravan.
  const BREED_MUTATION_CHANCE = .025; // Shared by the breeder and the acquisition-rarity estimator.
  const MAX_CODE = /^[0-5]{6}$/; // Prevents unbounded arbitrary keys from being installed as game items.
  const VARIANT_KEY = /^cv_(needlegrain|heftroot|garlink|ongyums|redberries|blueberries|yellowberries|whiteberries|blackberries|blackMustard|greenMustard)_([0-5]{6})(?:_([0-9a-f]{6}))?(Seeds)?$/;
  let cropData = null; // Shared runtime cropData mutated in place; read by growth, planting and the farm.
  let itemDefs = null; // Shared ITEM_DEFS mutated in place; read by inventory, trader and cooking.
  let inventory = null; // Current player's seed/harvest stacks used to rehydrate saved hybrids.
  let storageGetter = null; // The farm's shared storage is checked to display accessible cultivar seeds in the crop brush.
  let inventoryItems = null; // When supplied, register seed items in the standard pack picker alongside their produce.
  const known = new Set(); // Keys already registered as crops; avoids repeated catalog and UI work.
  const variants = new Map(); // Cached resolved traits: rendering thousands of frames must not rebuild item definitions.
  let lastChange = 'Regional crop varieties are gene-coded; no independent world save is required.';

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const seedKey = crop => crop + 'Seeds'; // Dynamic seed keys live in the ordinary inventory.
  const fromItemKey = key => {
    const match = VARIANT_KEY.exec(String(key || '')); // Used for saved produce, seed and tile crop IDs.
    return match && FAMILIES.includes(match[1]) ? { family: match[1], code: match[2], colorHex: match[3] || null } : null;
  };
  const idFor = (family, code, colorHex = null) => 'cv_' + family + '_' + code + (colorHex ? '_' + colorHex : ''); // One deterministic crop identity per genotype.
  function genesFor(key) {
    if (FAMILIES.includes(key)) return { family: key, genes: '000000', colorHex: null };
    const parsed = fromItemKey(key); // Hybrid items and seeds both identify the same parent genotype.
    return parsed ? { family: parsed.family, genes: parsed.code, colorHex: parsed.colorHex } : null;
  }
  function mixHex(a, b) {
    const channel = shift => Math.round((((a >>> shift) & 255) + ((b >>> shift) & 255)) / 2); // Blend inherited color alleles without shared material mutations.
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }
  function tintedColor(base, filter) {
    const channel = shift => Math.round(((base >>> shift) & 255) * (.42 + .58 * ((filter >>> shift) & 255) / 255)); // Keep recognisable colors while differentiating origins.
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }
  function phenotype(family, code, colorHex = null) {
    const base = cropData?.[family];
    if (!base || !MAX_CODE.test(code)) return null;
    const genes = [...code].map(Number); // Used to resolve two alleles in each of the three trait pairs.
    const color = colorHex == null ? mixHex(tintedColor(NATIVE_COLORS[family], COLOR_FILTERS[genes[0]]), tintedColor(NATIVE_COLORS[family], COLOR_FILTERS[genes[1]])) : Number.parseInt(colorHex, 16); // Save-compatible, exact parent-color midpoint.
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
    const pureRegion = genes.every(gene => gene === genes[0]); // Color-mixed plants should not be mislabeled as a pure regional import.
    const originalColor = mixHex(tintedColor(NATIVE_COLORS[family], COLOR_FILTERS[genes[0]]), tintedColor(NATIVE_COLORS[family], COLOR_FILTERS[genes[1]]));
    const region = colorHex != null && color !== originalColor ? 'Crossbred'
      : code === '000000' ? REGIONS[0].label : pureRegion ? REGIONS[genes[0]].label : 'Crossbred';
    return { family, genes: code, color, effects, idealMin: min, idealMax: max, growDays: Math.max(1, Math.round(Number(base.growDays || 3) * growth * 10) / 10), seasonGrowth, region };
  }
  function register(family, code, colorHex = null) {
    if (!FAMILIES.includes(family) || !MAX_CODE.test(code) || (colorHex != null && !/^[0-9a-f]{6}$/.test(colorHex)) || !cropData?.[family]) return null;
    const id = idFor(family, code, colorHex);
    if (variants.has(id) && cropData[id] && (!itemDefs || itemDefs[seedKey(id)])) return variants.get(id); // Hot path for rendering, crop growth and inventory.
    const traits = phenotype(family, code, colorHex);
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
        ...(baseProduce.spriteIcon ? { spriteIcon: baseProduce.spriteIcon, spriteMode: 'direct', spriteColor: traits.color } : {}), // Tint hybrid inventory PNGs, leave native sprites alone.
        sellPrice: Math.max(1, Math.round((Number(baseProduce.sellPrice) || 15) * 1.2)),
        cookingCategories: [...(baseProduce.cookingCategories || item?.categories || [])], cookingPrimaryEffect: Object.keys(traits.effects)[0],
        foodEffects: { ...traits.effects }, varietyColor: traits.color, ingredientColor: traits.color,
        tags: [...new Set([...(baseProduce.tags || []), 'Crop', 'Regional Variety'])],
        desc: traits.region + ' variety. Water ' + Math.round(traits.idealMin * 100) + '–' + Math.round(traits.idealMax * 100) + '%. ' + Object.keys(traits.effects).join(' / ') + ' ingredients.' };
      itemDefs[seedKey(id)] = { ...baseSeed, label: label + ' Seeds', icon: baseSeed.icon || '🌱', cat: baseSeed.cat || 'seed',
        sellPrice: Math.max(1, Math.round((Number(baseSeed.sellPrice) || 4) * 1.4)), varietyColor: traits.color,
        tags: [...new Set([...(baseSeed.tags || []), 'Seed', 'Regional Variety'])],
        desc: 'Plant on suitable soil. Origin: ' + traits.region + '. Prefers ' + Math.round(traits.idealMin * 100) + '–' + Math.round(traits.idealMax * 100) + '% water.' };
      if (Array.isArray(inventoryItems) && !inventoryItems.some(entry => entry.key === seedKey(id))) {
        inventoryItems.push({ key: seedKey(id), icon: itemDefs[seedKey(id)].icon, label: (label + ' Seeds').toUpperCase(), max: 999 });
      } // All seeds, including saved hybrids, remain regular inventory objects.
    }
    const variant = { id, seedKey: seedKey(id), label, ...traits }; // Stable public crop metadata cached until a world rebind.
    known.add(id); variants.set(id, variant);
    return variant;
  }
  function ensure(key) {
    const parsed = fromItemKey(key);
    if (!parsed) return null;
    const wasRegistered = !!cropData?.[idFor(parsed.family, parsed.code)]; // Only freshly restored genomes require another cooking catalog sync.
    const variety = register(parsed.family, parsed.code, parsed.colorHex);
    if (variety && !wasRegistered) window.CookingSystem?.registerIngredientItems?.();
    return variety;
  }
  function hydrate(stacks) {
    for (const key of Object.keys(stacks || {})) if (fromItemKey(key)) ensure(key);
  }
  function attach(deps = {}) {
    if (deps.cropData && deps.cropData !== cropData) { known.clear(); variants.clear(); } // World/replay rebinding restores the new runtime crop table.
    cropData = deps.cropData || cropData;
    itemDefs = deps.ITEM_DEFS || itemDefs;
    inventory = deps.inventory || inventory;
    inventoryItems = deps.inventoryItems || inventoryItems;
    storageGetter = deps.loadStorage || storageGetter;
    if (!cropData) return;
    for (const [family, label] of Object.entries(MUSHTARD_LABELS)) {
      const base = cropData[family]; // Native crop definition provides farm brushes and inherited variety labels.
      if (!base) continue;
      base.label = label;
      if (itemDefs?.[family]) itemDefs[family].label = label; // Harvested native produce shown in the pack.
      const nativeSeedKey = base.seedKey; // Uses the original seed ID, singular or plural, without save migration.
      if (nativeSeedKey && itemDefs?.[nativeSeedKey]) {
        itemDefs[nativeSeedKey].label = mushtardDisplayText(itemDefs[nativeSeedKey].label || label + ' Seeds');
      }
      for (const item of inventoryItems || []) {
        if (item?.key === family || item?.key === nativeSeedKey) {
          item.label = mushtardDisplayText(item.label || label); // Keep already-populated mobile pack choices consistent.
        }
      }
    }
    for (const family of FAMILIES) if (cropData[family]) for (let region = 1; region < REGIONS.length; region++)
      register(family, String(region).repeat(6)); // Every seed offer has a definition before traders roll stock.
    hydrate(inventory);
    if (itemDefs) window.CookingSystem?.registerIngredientItems?.(); // Populates the real cooking picker without a parallel food system.
    refreshBrushes();
  }
  function registered({ ownedOnly = false } = {}) {
    hydrate(inventory);
    let storage = {}; // Both bag and farm storage are valid sources for delegated farm planting.
    try { storage = storageGetter?.() || {}; } catch (_) { /* Early boot may not have farm storage yet. */ }
    hydrate(storage); // Seeds kept only in Farm Storage must reappear after loading a saved world.
    return [...known].filter(id => !ownedOnly || (Number(inventory?.[seedKey(id)]) || 0) > 0 || (Number(storage[seedKey(id)]) || 0) > 0)
      .map(id => ({ id, seedKey: seedKey(id), label: cropData?.[id]?.label || id }));
  }
  function refreshBrushes() {
    if (typeof document === 'undefined') return;
    const holder = document.getElementById('regionalCropBrushes'); // Existing Farm Editor remains the planting UI authority.
    if (!holder) return;
    holder.textContent = '';
    const available = registered({ ownedOnly: true }); // Never flood the Farm Editor with every theoretical genotype.
    holder.hidden = available.length === 0;
    for (const variety of available) {
      const button = document.createElement('button');
      button.className = 'fed-btn';
      button.type = 'button';
      button.dataset.btype = 'crop';
      button.dataset.bval = variety.id;
      button.textContent = '🌱 ' + variety.label;
      button.title = 'Select imported or crossbred seeds for painting farm plots';
      button.addEventListener('click', () => window._farmEditor?.setBrush('crop', variety.id));
      holder.append(button);
    }
  }
  function offers(rng = Math.random) {
    const families = FAMILIES.filter(family => cropData?.[family]); // Selected independently for each caravan; no new shop route.
    const count = Math.min(TRADE_OFFER_LIMIT, families.length);
    const pool = families.map(family => ({ family, n: rng() })).sort((a, b) => a.n - b.n).slice(0, count);
    return pool.map(({ family }) => {
      const region = 1 + Math.floor(rng() * (REGIONS.length - 1));
      const variety = register(family, String(region).repeat(6));
      return variety ? { key: variety.seedKey, qty: TRADE_QUANTITY_MIN + Math.floor(rng() * (TRADE_QUANTITY_MAX - TRADE_QUANTITY_MIN + 1)), region: variety.region } : null;
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
    const firstParent = genesFor(firstKey), secondParent = genesFor(secondKey); // Read both genotypes and existing phenotypes, including prior blends.
    const first = firstParent.genes, second = secondParent.genes;
    const colorA = phenotype(a, first, firstParent.colorHex).color;
    const colorB = phenotype(a, second, secondParent.colorHex).color;
    const mixedPigment = mixHex(colorA, colorB).toString(16).padStart(6, '0'); // Each RGB channel averages both parents, even after many generations.
    const pick = (code, start) => Number(code[start + (rng() < .5 ? 0 : 1)]);
    const child = '' + pick(first, 0) + pick(second, 0) + pick(first, 2) + pick(second, 2) + pick(first, 4) + pick(second, 4);
    const genes = [...child];
    if (rng() < BREED_MUTATION_CHANCE) { const locus = Math.floor(rng() * 6); genes[locus] = String(Math.floor(rng() * REGIONS.length)); } // Rare single-allele mutation, as in livestock.
    const childCode = genes.join(''); // Keep climate/effect genes at their original simple inherited complexity.
    const result = firstKey === a && secondKey === a && childCode === '000000'
      ? { id: a, seedKey: cropData[a]?.seedKey, label: cropData[a]?.label, ...phenotype(a, '000000') }
      : register(a, childCode, mixedPigment); // All other crosses visibly blend and preserve color in their ordinary seed IDs.
    if (result) {
      lastChange = 'Crossbred ' + firstKey + ' × ' + secondKey + ' → ' + result.label + '.';
      window.CookingSystem?.registerIngredientItems?.(); // The newly invented ingredient keeps its inherited buffs in every recipe picker.
    }
    return result;
  }
  function details(key) {
    const genes = genesFor(key);
    return genes && (genes.genes !== '000000' || genes.colorHex) ? phenotype(genes.family, genes.genes, genes.colorHex) : null;
  }
  function colorOf(key) {
    const parent = genesFor(key); // Seed maker preview and regression tests use the same display color.
    return parent ? phenotype(parent.family, parent.genes, parent.colorHex)?.color ?? null : null;
  }
  function seedColorOf(key) {
    const id = String(key || ''); // Used to resolve seed-pack pigment without guessing from an icon or localized display label.
    const cultivar = fromItemKey(id); // Includes serialized, multi-generation blends and pre-pigment six-digit cultivars.
    if (cultivar && id.endsWith('Seeds')) return colorOf(id);
    const family = FAMILIES.find(name => {
      const nativeKey = cropData?.[name]?.seedKey; // Canonical crop registry handles irregular plural/singular native seed IDs.
      return id === nativeKey || id === name + 'Seeds'
        || (name.endsWith('berries') && id === name.slice(0, -3) + 'ySeeds')
        || (name.endsWith('Mustard') && id === name + 'Seed');
    });
    return family ? NATIVE_COLORS[family] : null; // Same ripe pigment used by native planted/harvested vegetables.
  }
  function breedingOutcomeChance(firstKey, secondKey, targetKey) {
    const family = produceFamily(firstKey); // The seed maker only accepts harvested parents of the same crop family.
    if (!family || family !== produceFamily(secondKey)) return 0;
    const first = genesFor(firstKey), second = genesFor(secondKey), target = genesFor(targetKey); // Uses the breeder's exact two-allele parent genomes.
    if (!first || !second || !target || target.family !== family) return 0;
    const pigment = mixHex(colorOf(firstKey), colorOf(secondKey)).toString(16).padStart(6, '0'); // Pigment never mutates; it is the exact midpoint of two parent colors.
    const nativeFallback = firstKey === family && secondKey === family && targetKey === family;
    if (!nativeFallback && target.colorHex !== pigment) return 0;
    const inherited = [
      [first.genes[0], first.genes[1]], [second.genes[0], second.genes[1]],
      [first.genes[2], first.genes[3]], [second.genes[2], second.genes[3]],
      [first.genes[4], first.genes[5]], [second.genes[4], second.genes[5]],
    ]; // Mirrors six independent 50:50 parent-pick calls in breed().
    const probabilities = inherited.map((alleles,index) => (Number(alleles[0] === target.genes[index]) + Number(alleles[1] === target.genes[index])) / 2);
    const ordinary = probabilities.reduce((product,p) => product * p,1); // No-mutation probability for the exact six-digit child genotype.
    const mutation = probabilities.reduce((sum,_,locus) => sum +
      probabilities.reduce((product,p,index) => product * (index === locus ? 1 : p),1),0)
      / (6 * REGIONS.length); // 1/6 locus × 1/REGIONS.length allele; mutation can coincidentally restore a gene.
    const chance = (1 - BREED_MUTATION_CHANCE) * ordinary + BREED_MUTATION_CHANCE * mutation;
    return nativeFallback ? (target.genes === '000000' ? chance : 0)
      : Math.max(0, Math.min(1, chance));
  }
  function rarityProfile(key) {
    const id = String(key || ''); // Current produce or seed item key, including inherited pigment suffixes.
    const parsed = fromItemKey(id); // Saved gene codes use the same parser as real crop planting and breeding.
    const family = parsed?.family || (FAMILIES.includes(id) ? id : FAMILIES.find(name => cropData?.[name]?.seedKey === id));
    const base = family && cropData?.[family]; // Crop data remains the single authority for growing requirements and duration.
    if (!base) return null;
    const isSeed = id === base.seedKey || id.endsWith('Seeds');
    const cultivar = parsed ? (variants.get(id.replace(/Seeds$/, '')) || phenotype(family, parsed.code, parsed.colorHex)) : null;
    const readyFamilies = FAMILIES.filter(name => cropData?.[name]); // Every caravan draws exactly four distinct installed crop families.
    const familyPickChance = readyFamilies.length ? Math.min(TRADE_OFFER_LIMIT, readyFamilies.length) / readyFamilies.length : 0;
    const regionPickChance = 1 / Math.max(1, REGIONS.length - 1); // Only the five non-native regions are exported by Slagothim traders.
    const pureImport = !!parsed && !parsed.colorHex && /^([1-5])\1{5}$/.test(parsed.code);
    const breedingChoices = parsed ? Math.max(1, [...parsed.code].filter(gene => gene !== parsed.code[0]).length + (parsed.colorHex ? 2 : 0)) : 0;
    const seedMakerDays = Object.values(window.FARM_SPECIALIZATIONS_CONFIG?.buildings || {})
      .find(def => def?.family === 'seedMaker')?.daysPerInput; // Authoritative processing time, not a copied constant.
    return {
      family, native:!parsed, pureImport, isSeed,
      geneCode:parsed?.code || '000000', breedingChoices,
      mutationRate:BREED_MUTATION_CHANCE,
      familyPickChance, regionPickChance, chancePerCaravan:pureImport ? familyPickChance * regionPickChance : 0,
      meanOfferQuantity:(TRADE_QUANTITY_MIN + TRADE_QUANTITY_MAX) / 2,
      growDays:Math.max(1, Number(cultivar?.growDays || base.growDays) || 3),
      seedMakerDays:Number.isFinite(Number(seedMakerDays)) ? Number(seedMakerDays) : null,
      region:cultivar?.region || REGIONS[0].label,
    };
  }
  function blendedColor(firstKey, secondKey) {
    const a = produceFamily(firstKey), b = produceFamily(secondKey); // Incompatible crop species cannot mix.
    return a && a === b ? mixHex(colorOf(firstKey), colorOf(secondKey)) : null;
  }
  window.CropVarieties = Object.freeze({ REGIONS, FAMILIES, attach, ensure, hydrate, registered, refreshBrushes, offers, produceFamily, breed, breedingOutcomeChance, rarityProfile, details, colorOf, seedColorOf, blendedColor,
    get lastChange() { return lastChange; } }); // Exposed for mobile production diagnostics and regression tests.
})();