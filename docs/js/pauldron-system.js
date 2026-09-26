// Smith-crafted metal pauldron lifecycle: crafting identity, Temper XP,
 // historical-mass-derived outfit weight, verdigris/plating visuals, and smith treatments.
(() => {
  'use strict';

  if (window.PauldronSystem) return;

  const VERSION = 1;
  const BASE_COSMETIC_ID = 'rounded_pauldron';
  const SLOT = 'pauldron';
  const CRAFT_ID_MARKER = '#smith:';
  const CRAFT_BAR_COST = 3;
  const CRAFT_LABOR_GOLD = 15;
  const TREATMENT_BAR_COST = 1;
  const TREATMENT_LABOR_GOLD = 8;
  const TEMPER_XP_THRESHOLDS = Object.freeze([40, 90, 150, 220, 300]); // Mirrors ordinary tool/weapon Mastery pacing; Temper itself never changes combat stats.
  const MAX_TEMPER_XP = TEMPER_XP_THRESHOLDS.at(-1);
  const REFERENCE_STEEL_PAULDRON_KG = 1.19; // Representative single field pauldron: museum examples cluster around ~0.94–1.49 kg, commonly ~1.16–1.22 kg.
  const REFERENCE_STEEL_DENSITY_G_CM3 = 7.85;
  const STANDARD_WOOL_OVERWEAR_KG = 1.60; // Existing ordinary overwear is 4 weight units; a ~1.6 kg wool cloak makes one outfit-weight unit ~0.4 kg.
  const STANDARD_WOOL_OVERWEAR_UNITS = 4;
  const KG_PER_WEIGHT_UNIT = STANDARD_WOOL_OVERWEAR_KG / STANDARD_WOOL_OVERWEAR_UNITS;
  const OXIDATION_CACHE_STEP = 0.10; // Matches the tool/weapon metal cache granularity, so Temper uses the same visible verdigris progression cadence.
  const PAULDRON_SOURCE_HEX = '#7DC89A'; // Authored pauldron art uses the portrait/cosmetic green source palette rather than weapon art's #5A8480 key.
  const PAULDRON_HUE_TOLERANCE_DEG = 55; // Broad enough to include shaded green metal pixels while still excluding the black outline/transparent field.
  const PAULDRON_SATURATION_TOLERANCE = 0.55; // Keeps pale highlights inside the metal mask without making grayscale/black outlines eligible.

  // Approximate room-temperature densities. The bronze values intentionally stay
  // within ordinary bronze's broad real-world range; exact historical recipes vary.
  const DENSITY_G_CM3 = Object.freeze({
    nativeCopper: 8.94,
    lowTinBronze: 8.80,
    tinBronze: 8.70,
    highTinBronze: 8.55,
    arsenicalBronze: 8.65,
    leadedBronze: 8.90,
  });

  // Pre-init visual fallback lets save-select/character previews render metal
  // pauldrons before game.js has injected its authoritative METAL_DEFS.
  const METAL_VISUAL_FALLBACKS = Object.freeze({
    nativeCopper: Object.freeze({ label: 'Native Copper', hex: '#B87333', verdigrisHex: '#3FAF9F', tier: 1 }),
    lowTinBronze: Object.freeze({ label: 'Low-Tin Bronze', hex: '#B66A2E', verdigrisHex: '#4EAA86', tier: 2 }),
    tinBronze: Object.freeze({ label: 'Tin Bronze', hex: '#CD7F32', verdigrisHex: '#57B38B', tier: 3 }),
    highTinBronze: Object.freeze({ label: 'High-Tin Bronze', hex: '#BAA06A', verdigrisHex: '#78BFA5', tier: 4 }),
    arsenicalBronze: Object.freeze({ label: 'Arsenical Bronze', hex: '#B4A78E', verdigrisHex: '#8ABFB0', tier: 5 }),
    leadedBronze: Object.freeze({ label: 'Leaded Bronze', hex: '#997047', verdigrisHex: '#4E9672', tier: 6 }),
    tin: Object.freeze({ label: 'Tin', hex: '#B8C0C7', verdigrisHex: null, tier: null }),
    lead: Object.freeze({ label: 'Lead', hex: '#5E6670', verdigrisHex: null, tier: null }),
    silver: Object.freeze({ label: 'Silver', hex: '#D7DCE0', verdigrisHex: null, tier: null }),
    gold: Object.freeze({ label: 'Gold', hex: '#D8AA2E', verdigrisHex: null, tier: null }),
    electrum: Object.freeze({ label: 'Electrum', hex: '#C7B65C', verdigrisHex: null, tier: null }),
    pewter: Object.freeze({ label: 'Pewter', hex: '#8C979B', verdigrisHex: null, tier: null }),
  });

  const SPRITE_BY_APPEARANCE = Object.freeze({
    'mao-ao::male': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_m.png',
    'mao-ao::female': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_f.png',
    'tletingan::male': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_tl_m.png',
    'tletingan::female': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_tl_f.png',
    'kenkari::male': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_kenk_m.png',
    'kenkari::female': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_kenk_f.png',
    'rakakoan::male': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_kenk_m.png',
    'rakakoan::female': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_kenk_f.png',
    'engh-sho::male': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_engh_m.png',
    'engh-sho::female': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_engh_f.png',
    'mashtzarr::male': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_mashtz_m.png',
    'mashtzarr::female': 'assets/cosmetics/clothes/pauldrons/rounded_pauldron_mashtz_f.png',
  });

  let deps = null;
  let skillXpHookInstalled = false;
  let lastError = null;
  let lastTemperReason = null;
  let visualRefreshes = 0;
  const processedLayerUrlPromises = new Map(); // Used to reuse final metal/verdigris PNG data URLs across repeated world/dialogue portrait renders.

  function clone(value) {
    if (value == null || typeof value !== 'object') return value;
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function normalizeSpecies(value) {
    return String(value || 'mao-ao').trim().toLowerCase().replace(/_/g, '-');
  }

  function normalizeGender(value) {
    return String(value || 'male').toLowerCase() === 'female' ? 'female' : 'male';
  }

  function metalDef(metalKey) {
    return deps?.METAL_DEFS?.[metalKey] || METAL_VISUAL_FALLBACKS[metalKey] || METAL_VISUAL_FALLBACKS.nativeCopper;
  }

  function baseCosmeticId(item) {
    if (!item) return '';
    if (item.baseCosmeticId) return String(item.baseCosmeticId);
    const id = String(item.cosmeticId || '');
    const markerAt = id.indexOf(CRAFT_ID_MARKER);
    return markerAt >= 0 ? id.slice(0, markerAt) : id;
  }

  function isMetalPauldron(item) {
    return !!item && item.slot === SLOT && baseCosmeticId(item) === BASE_COSMETIC_ID;
  }

  function temperXp(itemOrState) {
    return Math.max(0, Math.min(MAX_TEMPER_XP, Number(itemOrState?.temperXp) || 0));
  }

  function temperLevelForXp(xp) {
    const value = Math.max(0, Number(xp) || 0);
    let level = 0;
    while (level < TEMPER_XP_THRESHOLDS.length && value >= TEMPER_XP_THRESHOLDS[level]) level++;
    return level;
  }

  function temperLevel(itemOrState) {
    return temperLevelForXp(temperXp(itemOrState));
  }

  function verdigrisFraction(itemOrState) {
    return MAX_TEMPER_XP > 0 ? temperXp(itemOrState) / MAX_TEMPER_XP : 0;
  }

  function quantizedVerdigrisFraction(itemOrState) {
    const raw = verdigrisFraction(itemOrState);
    return Math.round(raw / OXIDATION_CACHE_STEP) * OXIDATION_CACHE_STEP;
  }

  function weightForMetal(metalKey) {
    const density = Number(DENSITY_G_CM3[metalKey] || DENSITY_G_CM3.nativeCopper);
    const massKg = REFERENCE_STEEL_PAULDRON_KG * (density / REFERENCE_STEEL_DENSITY_G_CM3); // Same authored pauldron volume, swapped to the chosen alloy's approximate density.
    const weightUnits = massKg / KG_PER_WEIGHT_UNIT;
    return {
      metalKey,
      densityGcm3: Math.round(density * 100) / 100,
      massKg: Math.round(massKg * 100) / 100,
      weightUnits: Math.round(weightUnits * 100) / 100,
    };
  }

  function spriteForAppearance(appearance) {
    const speciesId = normalizeSpecies(appearance?.speciesId || appearance?.species);
    const gender = normalizeGender(appearance?.gender);
    return SPRITE_BY_APPEARANCE[`${speciesId}::${gender}`]
      || SPRITE_BY_APPEARANCE[`mao-ao::${gender}`]
      || SPRITE_BY_APPEARANCE['mao-ao::male'];
  }

  function currentPlayerSprite() {
    return spriteForAppearance(deps?.getPlayerData?.()?.appearance);
  }

  function treatment(itemOrState) {
    return itemOrState?.smithTreatment && typeof itemOrState.smithTreatment === 'object'
      ? itemOrState.smithTreatment
      : null;
  }

  function portraitStateForItem(item) {
    const metalKey = String(item?.metalKey || 'nativeCopper');
    const metal = metalDef(metalKey);
    return {
      metalKey,
      temperXp: temperXp(item),
      smithTreatment: clone(treatment(item)),
      hex: metal.hex,
      tintMode: 'hexShadeFill',
    };
  }

  function defaultPortraitState() {
    return portraitStateForItem({ metalKey: 'nativeCopper', temperXp: 0, smithTreatment: null });
  }

  function normalizeItem(item) {
    if (!item || item.slot !== SLOT) return false;
    const looksLikeRounded = baseCosmeticId(item) === BASE_COSMETIC_ID || item.cosmeticId === BASE_COSMETIC_ID;
    if (!looksLikeRounded) return false;
    let changed = false;
    if (!item.baseCosmeticId) { item.baseCosmeticId = BASE_COSMETIC_ID; changed = true; }
    if (!item.metalKey || !DENSITY_G_CM3[item.metalKey]) { item.metalKey = 'nativeCopper'; changed = true; }
    const normalizedXp = temperXp(item);
    if (Number(item.temperXp) !== normalizedXp) { item.temperXp = normalizedXp; changed = true; }
    if (!Number.isFinite(Number(item.weightUnits)) || Number(item.weightUnits) <= 0) {
      item.weightUnits = weightForMetal(item.metalKey).weightUnits;
      changed = true;
    }
    if (item.dyeable !== false) { item.dyeable = false; changed = true; }
    if (item.colorA != null) { item.colorA = null; changed = true; }
    if (item.colorB != null) { item.colorB = null; changed = true; }
    if (item.colorC != null) { item.colorC = null; changed = true; }
    if (!Array.isArray(item.articleDyeIds) || item.articleDyeIds.length) { item.articleDyeIds = []; changed = true; }
    const expectedBaseLabel = 'Rounded Pauldrons';
    if (item.baseLabel !== expectedBaseLabel) { item.baseLabel = expectedBaseLabel; changed = true; }
    return changed;
  }

  function equippedPauldron() {
    const item = deps?.getGearInventory?.()?.clothing?.[SLOT] || null;
    if (!isMetalPauldron(item)) return null;
    normalizeItem(item);
    return item;
  }

  function ownedPauldrons() {
    return (deps?.getGearInventory?.()?.clothingItems || []).filter(isMetalPauldron);
  }

  function ownedForMetal(metalKey) {
    return ownedPauldrons().find(item => item.metalKey === metalKey) || null;
  }

  function treatmentText(itemOrState) {
    const active = treatment(itemOrState);
    if (!active) return `Live verdigris: ${Math.round(verdigrisFraction(itemOrState) * 100)}%`;
    if (active.mode === 'cosmetic') return `Plated: ${metalDef(active.metalKey)?.label || active.metalKey}`;
    if (active.mode === 'pattern') return 'Authored verdigris-removal pattern';
    if (active.mode === 'resistant') return 'Verdigris-resistant coat';
    return 'Smith-treated';
  }

  function detailText(item) {
    if (!isMetalPauldron(item)) return '';
    const mass = weightForMetal(item.metalKey);
    return `${metalDef(item.metalKey).label} · Temper ${temperLevel(item)}/5 · ${treatmentText(item)} · ~${mass.massKg.toFixed(2)} kg · ${mass.weightUnits.toFixed(2)} outfit-weight units.`;
  }

  function treatmentSignature(active) {
    if (!active) return 'live';
    const pattern = active.pattern || null;
    let patternHash = '';
    if (pattern) {
      const text = JSON.stringify(pattern);
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      patternHash = hash.toString(16);
    }
    return `${active.mode || 'unknown'}:${active.metalKey || ''}:${active.patternLibraryId || ''}:${patternHash}`;
  }

  function visualOptions(itemOrState) {
    const state = itemOrState || defaultPortraitState();
    const metalKey = String(state.metalKey || 'nativeCopper');
    const baseMetal = metalDef(metalKey);
    const active = treatment(state);
    const sourceOptions = {
      sourceHex: PAULDRON_SOURCE_HEX,
      hueToleranceDeg: PAULDRON_HUE_TOLERANCE_DEG,
      saturationTolerance: PAULDRON_SATURATION_TOLERANCE,
    }; // Shared by clean metal, live verdigris, plating, and authored removal-pattern rendering.
    if (active?.mode === 'cosmetic') {
      const platedMetal = metalDef(active.metalKey);
      return { ...sourceOptions, targetHex: platedMetal.hex, verdigrisHex: null, oxidationAmount: 0 };
    }
    if (active?.mode === 'resistant') {
      return { ...sourceOptions, targetHex: baseMetal.hex, verdigrisHex: null, oxidationAmount: 0 };
    }
    if (active?.mode === 'pattern') {
      const authoredPattern = active.pattern || window.PatternLibrary?.getById?.(active.patternLibraryId) || null;
      if (authoredPattern) return {
        ...sourceOptions,
        targetHex: baseMetal.hex,
        verdigrisHex: baseMetal.verdigrisHex,
        oxidationAmount: 1,
        authoredPattern,
      };
    }
    return {
      ...sourceOptions,
      targetHex: baseMetal.hex,
      verdigrisHex: baseMetal.verdigrisHex,
      oxidationAmount: quantizedVerdigrisFraction(state),
    };
  }

  async function processedLayerUrl(sourceUrl, state) {
    if (!sourceUrl || !window.ToolMetalRecolor?.getRecoloredCanvas) return sourceUrl;
    const opts = visualOptions(state);
    const key = [
      sourceUrl,
      String(state?.metalKey || 'nativeCopper'),
      Number(opts.oxidationAmount || 0).toFixed(2),
      treatmentSignature(treatment(state)),
      opts.targetHex || '',
      opts.verdigrisHex || '',
    ].join('|');
    if (!processedLayerUrlPromises.has(key)) {
      if (processedLayerUrlPromises.size > 80) processedLayerUrlPromises.clear(); // Small bounded visual-state cache; old Temper/plating states are not useful once superseded.
      processedLayerUrlPromises.set(key, window.ToolMetalRecolor.getRecoloredCanvas(sourceUrl, opts)
        .then(canvas => canvas?.toDataURL?.('image/png') || sourceUrl)
        .catch(error => {
          lastError = String(error?.message || error);
          return sourceUrl;
        }));
    }
    return processedLayerUrlPromises.get(key);
  }

  async function preparePortraitLayers(layers, state) {
    if (!Array.isArray(layers) || !layers.length) return layers || [];
    const normalizedState = state?.metalKey ? state : defaultPortraitState();
    return Promise.all(layers.map(async layer => {
      if (!layer?.url) return layer;
      const url = await processedLayerUrl(layer.url, normalizedState);
      return url === layer.url ? layer : { ...layer, url };
    }));
  }

  function applyImageVisual(img, sourceUrl, item) {
    if (!img || !sourceUrl || !isMetalPauldron(item) || !window.ToolMetalRecolor?.getRecoloredCanvas) return false;
    const state = portraitStateForItem(item);
    const token = `pauldron:${item.uid || item.cosmeticId || 'item'}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`; // Used to reject a late recolor after the DOM image has been recycled for another inventory cell.
    img.dataset.clothingTintToken = token;
    window.ToolMetalRecolor.getRecoloredCanvas(sourceUrl, visualOptions(state)).then(canvas => {
      if (!canvas || img.dataset.clothingTintToken !== token) return;
      img.src = canvas.toDataURL('image/png');
    }).catch(error => { lastError = String(error?.message || error); });
    return true;
  }

  function refreshVisuals() {
    processedLayerUrlPromises.clear();
    visualRefreshes++;
    try {
      const result = deps?.refreshPlayerAvatar?.();
      Promise.resolve(result).catch(error => { lastError = String(error?.message || error); });
    } catch (error) {
      lastError = String(error?.message || error);
    }
    deps?.buildEquipmentSlots?.();
    deps?.buildInventoryGrid?.();
    deps?.rerenderSmith?.();
  }

  function awardExperience(amount, reason = 'experience', options = {}) {
    const item = equippedPauldron();
    const gain = Math.max(0, Number(amount) || 0);
    if (!item || !(gain > 0) || temperXp(item) >= MAX_TEMPER_XP) return false;
    const beforeLevel = temperLevel(item);
    const beforeVisual = quantizedVerdigrisFraction(item);
    item.temperXp = Math.min(MAX_TEMPER_XP, temperXp(item) + gain);
    lastTemperReason = reason;
    const afterLevel = temperLevel(item);
    const afterVisual = quantizedVerdigrisFraction(item);
    if (options.save !== false) deps?.saveGearInventory?.();
    if (afterVisual !== beforeVisual || afterLevel !== beforeLevel) refreshVisuals();
    if (afterLevel > beforeLevel) deps?.showToast?.(`🛡 Rounded Pauldrons reached Temper ${afterLevel}/5.`, true);
    return true;
  }

  function skillExperience(skillKey) {
    return Number(window.SkillSystem?.snapshot?.(false)?.experience?.[skillKey]) || 0;
  }

  function installSkillXpHook() {
    const skillSystem = window.SkillSystem;
    if (!skillSystem || typeof skillSystem.award !== 'function') return false;
    if (skillSystem.award.__pauldronTemperXpHook) {
      skillXpHookInstalled = true;
      return true;
    }
    const original = skillSystem.award;
    const wrapped = function pauldronTemperSkillAward(skillKey, ...args) {
      const before = skillExperience(skillKey);
      const result = original.call(this, skillKey, ...args);
      const gained = Math.max(0, skillExperience(skillKey) - before);
      if (gained > 0) awardExperience(gained, `${skillKey} skill XP`);
      return result;
    };
    wrapped.__pauldronTemperXpHook = true;
    wrapped.__pauldronTemperOriginal = original;
    skillSystem.award = wrapped;
    skillXpHookInstalled = true;
    return true;
  }

  function makeCraftedItem(metalKey) {
    const metal = metalDef(metalKey);
    const weight = weightForMetal(metalKey);
    const uid = `gcloth_smith_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; // Used as the permanent identity for this literal pauldron article and its Temper/treatment state.
    return {
      uid,
      cosmeticId: `${BASE_COSMETIC_ID}${CRAFT_ID_MARKER}${uid}`,
      baseCosmeticId: BASE_COSMETIC_ID,
      slot: SLOT,
      label: `${metal.label} Rounded Pauldrons`,
      baseLabel: 'Rounded Pauldrons',
      description: `Smith-forged ${metal.label.toLowerCase()} shoulder armor. Temper records use and experience cosmetically; it never changes the armor's stats.`,
      sprite: currentPlayerSprite(),
      sellPrice: 0,
      metalKey,
      temperXp: 0,
      smithTreatment: null,
      weightUnits: weight.weightUnits,
      physicalMassKg: weight.massKg,
      dyeable: false,
      articleDyeIds: [],
      craftedAt: Date.now(),
    };
  }

  function craft(metalKey) {
    if (!deps || !deps.VERDIGRIS_METAL_KEYS?.includes(metalKey)) return false;
    if (ownedForMetal(metalKey)) {
      deps.showToast?.(`You already own ${metalDef(metalKey).label} Rounded Pauldrons.`, false);
      return false;
    }
    const metal = metalDef(metalKey);
    const barKey = deps.metalBarItemKey?.(metalKey);
    if (!barKey || Number(deps.inventory?.[barKey]) < CRAFT_BAR_COST) {
      deps.showToast?.(`Not enough ${metal.label} bars.`, false);
      return false;
    }
    if (Number(deps.inventory?.gold) < CRAFT_LABOR_GOLD) {
      deps.showToast?.("Not enough gold for the smith's labor.", false);
      return false;
    }
    const gear = deps.getGearInventory?.();
    if (!gear) return false;
    if (!gear.clothing || typeof gear.clothing !== 'object') gear.clothing = {};
    if (!Array.isArray(gear.clothingItems)) gear.clothingItems = [];
    deps.inventory[barKey] -= CRAFT_BAR_COST;
    deps.clampInventoryStack?.(barKey);
    deps.inventory.gold -= CRAFT_LABOR_GOLD;
    const item = makeCraftedItem(metalKey);
    gear.clothingItems.push(item);
    gear.clothing[SLOT] = item;
    deps.saveGearInventory?.();
    deps.saveMemberWorldData?.();
    refreshVisuals();
    deps.showToast?.(`Smithed ${metal.label} Rounded Pauldrons and equipped them.`, true);
    return true;
  }

  function canTreat(item) {
    return isMetalPauldron(item) && temperLevel(item) >= 5;
  }

  function refundTreatmentBar(item, active) {
    if (!active || !deps?.inventory) return;
    const metalKey = active.mode === 'cosmetic' ? active.metalKey : item.metalKey;
    const barKey = deps.metalBarItemKey?.(metalKey);
    if (barKey) deps.inventory[barKey] = Math.min(99, (Number(deps.inventory[barKey]) || 0) + TREATMENT_BAR_COST);
  }

  function commitTreatment(item, nextTreatment, toastText) {
    item.smithTreatment = nextTreatment ? clone(nextTreatment) : null;
    deps.saveGearInventory?.();
    deps.saveMemberWorldData?.();
    refreshVisuals();
    if (toastText) deps.showToast?.(toastText, true);
    return true;
  }

  function applyTreatment(item, choice) {
    if (!canTreat(item)) {
      deps?.showToast?.('Temper 5 is required for smithy cosmetic treatments.', false);
      return false;
    }
    const active = treatment(item);
    if (choice === 'clear') {
      if (!active) { deps.showToast?.('No pauldron treatment to clear.', false); return false; }
      refundTreatmentBar(item, active);
      return commitTreatment(item, null, 'Cleared pauldron treatment — live verdigris restored, materials returned.');
    }
    if (choice !== 'resistant' && !String(choice || '').startsWith('cosmetic:')) return false;
    const targetMetalKey = choice === 'resistant' ? item.metalKey : String(choice).slice('cosmetic:'.length);
    const targetMetal = metalDef(targetMetalKey);
    const barKey = deps.metalBarItemKey?.(targetMetalKey);
    if (!barKey || Number(deps.inventory?.[barKey]) < TREATMENT_BAR_COST) {
      deps.showToast?.(`Not enough ${targetMetal.label} bars.`, false);
      return false;
    }
    if (Number(deps.inventory?.gold) < TREATMENT_LABOR_GOLD) {
      deps.showToast?.('Not enough gold.', false);
      return false;
    }
    deps.inventory[barKey] -= TREATMENT_BAR_COST;
    deps.clampInventoryStack?.(barKey);
    deps.inventory.gold -= TREATMENT_LABOR_GOLD;
    const next = { mode: choice === 'resistant' ? 'resistant' : 'cosmetic', metalKey: targetMetalKey };
    return commitTreatment(item, next, choice === 'resistant'
      ? 'Applied a verdigris-resistant coat to the pauldrons.'
      : `Plated the pauldrons with ${targetMetal.label}.`);
  }

  async function resolvedForEditing(pattern) {
    if (!pattern || pattern.motifDataUrl || !pattern.customMotifId) return pattern;
    const motifDataUrl = await window.MotifStore?.loadMotif?.(pattern.customMotifId);
    return motifDataUrl ? { ...pattern, motifDataUrl } : pattern;
  }

  async function openVerdigrisPatternEditor(item) {
    if (!canTreat(item)) {
      deps?.showToast?.('Temper 5 is required to author a verdigris-removal pattern.', false);
      return false;
    }
    if (!window.PatternAuthoring?.openEditor || !window.ToolMetalRecolor?.getRecoloredCanvas) {
      deps?.showToast?.('Pattern authoring is unavailable.', false);
      return false;
    }
    const baseMetal = metalDef(item.metalKey);
    const active = treatment(item);
    const initialPattern = await resolvedForEditing(active?.mode === 'pattern'
      ? (active.pattern || window.PatternLibrary?.getById?.(active.patternLibraryId) || null)
      : null);
    window.PatternAuthoring.openEditor({
      title: `Author verdigris removal — ${baseMetal.label} Rounded Pauldrons`,
      motifHint: 'Draw the motif to strip back to bare metal — everything else stays fully oxidized.',
      initialPattern,
      initialPatternLibraryId: active?.mode === 'pattern' ? (active.patternLibraryId || null) : null,
      library: window.PatternLibrary ? {
        list: () => window.PatternLibrary.listAvailable(),
        get: id => window.PatternLibrary.getById(id),
        save: (label, patternData) => window.PatternLibrary.saveToLibrary(label, patternData),
        remove: id => window.PatternLibrary.removeSaved(id),
      } : null,
      renderPreview: patternData => window.ToolMetalRecolor.getRecoloredCanvas(currentPlayerSprite(), {
        ...visualOptions({ metalKey: item.metalKey, temperXp: MAX_TEMPER_XP, smithTreatment: null }),
        oxidationAmount: 1,
        authoredPattern: patternData,
      }),
      onSave: (patternData, sourceLibraryId) => {
        const barKey = deps.metalBarItemKey?.(item.metalKey);
        if (!barKey || Number(deps.inventory?.[barKey]) < TREATMENT_BAR_COST) {
          deps.showToast?.(`Not enough ${baseMetal.label} bars.`, false);
          return false;
        }
        if (Number(deps.inventory?.gold) < TREATMENT_LABOR_GOLD) {
          deps.showToast?.('Not enough gold.', false);
          return false;
        }
        deps.inventory[barKey] -= TREATMENT_BAR_COST;
        deps.clampInventoryStack?.(barKey);
        deps.inventory.gold -= TREATMENT_LABOR_GOLD;
        return commitTreatment(item, {
          mode: 'pattern',
          metalKey: item.metalKey,
          pattern: clone(patternData),
          patternLibraryId: sourceLibraryId || null,
        }, 'Verdigris carefully stripped into a pauldron pattern.');
      },
    });
    return true;
  }

  function treatmentOptionsHtml(item) {
    const baseMetal = metalDef(item.metalKey);
    const cosmeticOptions = Object.keys(deps?.METAL_DEFS || METAL_VISUAL_FALLBACKS)
      .filter(key => metalDef(key).tier == null && (Number(deps?.inventory?.[deps?.metalBarItemKey?.(key)]) || 0) > 0)
      .map(key => `<option value="cosmetic:${key}">Cosmetic: ${deps.esc?.(metalDef(key).label) || metalDef(key).label}</option>`);
    return [
      '<option value="clear">— live verdigris (clear treatment) —</option>',
      `<option value="resistant">Verdigris-resistant coat (${deps.esc?.(baseMetal.label) || baseMetal.label})</option>`,
      ...cosmeticOptions,
      '<option value="pattern">Author a verdigris-removal pattern…</option>',
    ].join('');
  }

  function renderSmithySection(list) {
    if (!list || !deps) return false;
    const section = document.createElement('div');
    section.className = 'shop-section-label';
    section.textContent = `🛡 Metal Clothing  (${CRAFT_BAR_COST} bars + ${CRAFT_LABOR_GOLD}g)`;
    list.appendChild(section);

    for (const metalKey of (deps.VERDIGRIS_METAL_KEYS || [])) {
      const metal = metalDef(metalKey);
      const barKey = deps.metalBarItemKey(metalKey);
      const ownedBars = Number(deps.inventory?.[barKey]) || 0;
      const alreadyOwned = !!ownedForMetal(metalKey);
      const weight = weightForMetal(metalKey);
      const row = document.createElement('div');
      row.className = 'shop-row mc-pauldron-craft-row';
      row.innerHTML = `
        <div class="sh-icon">🛡</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(metal.label)} Rounded Pauldrons</div>
          <div class="sh-desc">Single-pauldron mass ~${weight.massKg.toFixed(2)} kg · ${weight.weightUnits.toFixed(2)} outfit-weight units · bars owned: ${ownedBars}${alreadyOwned ? ' — already smithed' : ''}</div>
          <div class="sh-price">${CRAFT_BAR_COST} bars + ${CRAFT_LABOR_GOLD}g</div>
        </div>
        <button class="shop-buy-btn" data-pauldron-metal="${metalKey}" ${alreadyOwned ? 'disabled' : ''}>${alreadyOwned ? 'Owned' : 'Smith'}</button>
      `;
      row.querySelector('[data-pauldron-metal]')?.addEventListener('click', () => craft(metalKey));
      list.appendChild(row);
    }

    const owned = ownedPauldrons();
    if (!owned.length) return true;
    const treatmentHdr = document.createElement('div');
    treatmentHdr.className = 'shop-section-label';
    treatmentHdr.textContent = '🛡 Temper & Cosmetic Treatments';
    list.appendChild(treatmentHdr);

    for (const item of owned) {
      normalizeItem(item);
      const metal = metalDef(item.metalKey);
      const weight = weightForMetal(item.metalKey);
      const level = temperLevel(item);
      const row = document.createElement('div');
      row.className = 'shop-row mc-pauldron-treatment-row';
      const controls = level >= 5
        ? `<div class="mc-tool-controls">
             <select class="mc-pauldron-treatment-select">${treatmentOptionsHtml(item)}</select>
             <button class="shop-buy-btn mc-pauldron-treatment-btn">Apply</button>
           </div>`
        : `<div class="sh-price">Cosmetic smith treatments unlock at Temper 5.</div>`;
      row.innerHTML = `
        <div class="sh-icon">🛡</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(metal.label)} Rounded Pauldrons</div>
          <div class="sh-desc">Temper ${level}/5 · ${deps.esc(treatmentText(item))} · ~${weight.massKg.toFixed(2)} kg / ${weight.weightUnits.toFixed(2)} weight units</div>
          ${controls}
        </div>
      `;
      row.querySelector('.mc-pauldron-treatment-btn')?.addEventListener('click', () => {
        const choice = row.querySelector('.mc-pauldron-treatment-select')?.value;
        if (choice === 'pattern') openVerdigrisPatternEditor(item);
        else applyTreatment(item, choice);
      });
      list.appendChild(row);
    }
    return true;
  }

  function debugSnapshot() {
    const worn = equippedPauldron();
    return {
      version: VERSION,
      initialized: !!deps,
      skillXpHookInstalled,
      thresholds: [...TEMPER_XP_THRESHOLDS],
      lastTemperReason,
      visualRefreshes,
      processedVisualCacheSize: processedLayerUrlPromises.size,
      worn: worn ? {
        uid: worn.uid,
        metalKey: worn.metalKey,
        temperXp: temperXp(worn),
        temperLevel: temperLevel(worn),
        verdigrisFraction: verdigrisFraction(worn),
        treatment: clone(treatment(worn)),
        weight: weightForMetal(worn.metalKey),
      } : null,
      owned: ownedPauldrons().map(item => ({
        uid: item.uid,
        metalKey: item.metalKey,
        temperXp: temperXp(item),
        temperLevel: temperLevel(item),
        weightUnits: Number(item.weightUnits) || 0,
      })),
      lastError,
    };
  }

  function diagnosticsText() {
    const snapshot = debugSnapshot();
    if (!snapshot.worn) return `Pauldron Temper: none equipped · skill hook ${skillXpHookInstalled ? 'ready' : 'missing'}`;
    return `Pauldron Temper: ${snapshot.worn.metalKey} · ${snapshot.worn.temperXp}/${MAX_TEMPER_XP} XP · rank ${snapshot.worn.temperLevel}/5 · ${Math.round(snapshot.worn.verdigrisFraction * 100)}% verdigris · ${snapshot.worn.weight.weightUnits.toFixed(2)} weight units · skill hook ${skillXpHookInstalled ? 'ready' : 'missing'}`;
  }

  function init(injectedDeps) {
    deps = injectedDeps || deps;
    installSkillXpHook();
    const gear = deps?.getGearInventory?.();
    let changed = false;
    for (const item of (gear?.clothingItems || [])) if (normalizeItem(item)) changed = true;
    if (gear?.clothing?.[SLOT] && normalizeItem(gear.clothing[SLOT])) changed = true;
    if (changed) deps?.saveGearInventory?.();
    return true;
  }

  window.PauldronSystem = Object.freeze({
    version: VERSION,
    BASE_COSMETIC_ID,
    SLOT,
    CRAFT_BAR_COST,
    CRAFT_LABOR_GOLD,
    TREATMENT_BAR_COST,
    TREATMENT_LABOR_GOLD,
    TEMPER_XP_THRESHOLDS,
    MAX_TEMPER_XP,
    DENSITY_G_CM3,
    KG_PER_WEIGHT_UNIT,
    PAULDRON_SOURCE_HEX,
    init,
    isMetalPauldron,
    normalizeItem,
    temperXp,
    temperLevel,
    verdigrisFraction,
    weightForMetal,
    spriteForAppearance,
    portraitStateForItem,
    defaultPortraitState,
    visualOptions,
    preparePortraitLayers,
    applyImageVisual,
    awardExperience,
    ownedPauldrons,
    ownedForMetal,
    detailText,
    renderSmithySection,
    debugSnapshot,
    diagnosticsText,
    __test: Object.freeze({
      baseCosmeticId,
      temperLevelForXp,
      quantizedVerdigrisFraction,
      treatmentText,
      makeCraftedItem,
      treatmentSignature,
    }),
  });
  window.__pauldronDebug = debugSnapshot;
})();
