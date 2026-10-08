// Smith-crafted metal armor lifecycle: recipe identity, Temper XP,
// physical outfit weight, verdigris/plating visuals, and smith treatments.
(() => {
  'use strict';

  if (window.MetalArmorSystem) return;

  const VERSION = 3;
  const CRAFT_ID_MARKER = '#smith:';
  const DEFAULT_CRAFT_BAR_COST = 3;
  const DEFAULT_CRAFT_LABOR_GOLD = 15;
  const TREATMENT_BAR_COST = 1;
  const TREATMENT_LABOR_GOLD = 8;
  const TEMPER_XP_THRESHOLDS = Object.freeze([40, 90, 150, 220, 300]); // Mirrors ordinary tool/weapon Mastery pacing; Temper itself never changes combat stats.
  const MAX_TEMPER_XP = TEMPER_XP_THRESHOLDS.at(-1);
  const REFERENCE_STEEL_DENSITY_G_CM3 = 7.85;
  const STANDARD_WOOL_OVERWEAR_KG = 1.60; // Existing ordinary overwear is 4 weight units; a ~1.6 kg wool cloak makes one outfit-weight unit ~0.4 kg.
  const STANDARD_WOOL_OVERWEAR_UNITS = 4;
  const KG_PER_WEIGHT_UNIT = STANDARD_WOOL_OVERWEAR_KG / STANDARD_WOOL_OVERWEAR_UNITS;
  const OXIDATION_CACHE_STEP = 0.10; // Matches the tool/weapon metal cache granularity, so Temper uses the same visible verdigris progression cadence.
  const PORTRAIT_MARKER_KEY = '__hobunjiMetalArmor'; // Temporary bodyColors metadata for literal equipped metal articles; ordinary/non-metal clothing in the same slots never gets this marker.

  const DENSITY_G_CM3 = Object.freeze({
    nativeCopper: 8.94,
    lowTinBronze: 8.80,
    tinBronze: 8.70,
    highTinBronze: 8.55,
    arsenicalBronze: 8.65,
    leadedBronze: 8.90,
  });

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

  // Metal behavior belongs to these smith recipes, not to a clothing slot.
  // Future helmets, cuirasses, greaves, etc. can reuse existing slots by
  // registering another blueprint here. Non-metal items in those slots remain
  // ordinary clothing and keep their own dye/material behavior.
  const ARMOR_BLUEPRINTS = Object.freeze({
    rounded_pauldron: Object.freeze({
      id: 'rounded_pauldron',
      label: 'Rounded Pauldrons',
      slot: 'pauldron',
      icon: '🛡',
      referenceSteelMassKg: 1.19, // Representative single field pauldron; density scaling swaps only the alloy.
      craftBarCost: DEFAULT_CRAFT_BAR_COST,
      craftLaborGold: DEFAULT_CRAFT_LABOR_GOLD,
      sourceHex: '#7DC89A',
      hueToleranceDeg: 55,
      saturationTolerance: 0.55,
      spriteByAppearance: Object.freeze({
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
      }),
    }),
  });

  let deps = null;
  let skillXpListenerInstalled = false;
  let skillXpUnsubscribe = null; // Used to detach the prior SkillSystem subscription if the runtime ever replaces the skill module during a character/world reload.
  let hookedSkillSystem = null; // Used to avoid duplicate Temper awards when MetalCraftShop reinitializes against the same SkillSystem object.
  let lastError = null;
  let lastTemperReason = null;
  let visualRefreshes = 0;
  const processedLayerUrlPromises = new Map(); // Used to reuse final metal/verdigris PNG data URLs across repeated world/dialogue portrait renders.
  const iconDataUrlByCanvas = new WeakMap(); // ToolMetalRecolor returns the same cached canvas per visual state; re-encoding it to PNG on every gear/inventory rebuild was wasted work.
  const portraitResolutionDebug = new Map(); // Used by Pixel Probe to show whether an equipped metal cosmetic resolved to drawable portrait layers on the current species/gender.

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

  function blueprintForId(id) {
    return ARMOR_BLUEPRINTS[String(id || '')] || null;
  }

  function blueprintForItem(item) {
    return blueprintForId(baseCosmeticId(item));
  }

  function isLegacySmithMetalItem(item) {
    const blueprint = blueprintForItem(item);
    if (!blueprint || !item?.metalKey) return false;
    return String(item.cosmeticId || '').includes(CRAFT_ID_MARKER)
      || String(item.uid || '').startsWith('gcloth_smith_');
  }

  function isMetalArmor(item) {
    if (!item || !blueprintForItem(item)) return false;
    return item.materialKind === 'metal' || item.smithMaterial?.kind === 'metal' || isLegacySmithMetalItem(item);
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

  function weightForBlueprintMetal(blueprintId, metalKey) {
    const blueprint = blueprintForId(blueprintId);
    if (!blueprint) return { blueprintId, metalKey, densityGcm3: 0, massKg: 0, weightUnits: 0 };
    const density = Number(DENSITY_G_CM3[metalKey] || DENSITY_G_CM3.nativeCopper);
    const referenceMass = Number(blueprint.referenceSteelMassKg) || 0;
    const massKg = referenceMass * (density / REFERENCE_STEEL_DENSITY_G_CM3);
    const weightUnits = massKg / KG_PER_WEIGHT_UNIT;
    return {
      blueprintId,
      metalKey,
      densityGcm3: Math.round(density * 100) / 100,
      massKg: Math.round(massKg * 100) / 100,
      weightUnits: Math.round(weightUnits * 100) / 100,
    };
  }

  function weightForItem(item) {
    return weightForBlueprintMetal(baseCosmeticId(item), item?.metalKey || 'nativeCopper');
  }

  function spriteForBlueprintAppearance(blueprintId, appearance) {
    const blueprint = blueprintForId(blueprintId);
    if (!blueprint) return null;
    const speciesId = normalizeSpecies(appearance?.speciesId || appearance?.species);
    const gender = normalizeGender(appearance?.gender);
    const sprites = blueprint.spriteByAppearance || {};
    return sprites[`${speciesId}::${gender}`]
      || sprites[`mao-ao::${gender}`]
      || sprites['mao-ao::male']
      || Object.values(sprites)[0]
      || null;
  }

  function currentPlayerSprite(blueprintId) {
    return spriteForBlueprintAppearance(blueprintId, deps?.getPlayerData?.()?.appearance);
  }

  function treatment(itemOrState) {
    return itemOrState?.smithTreatment && typeof itemOrState.smithTreatment === 'object'
      ? itemOrState.smithTreatment
      : null;
  }

  function portraitStateForItem(item) {
    const blueprintId = baseCosmeticId(item);
    const metalKey = String(item?.metalKey || 'nativeCopper');
    const metal = metalDef(metalKey);
    return {
      blueprintId,
      slot: item?.slot || blueprintForId(blueprintId)?.slot || '',
      metalKey,
      temperXp: temperXp(item),
      smithTreatment: clone(treatment(item)),
      hex: metal.hex,
      tintMode: 'metalArmor',
    };
  }

  function defaultBlueprintId() {
    return Object.keys(ARMOR_BLUEPRINTS)[0] || '';
  }

  function defaultPortraitState(blueprintId = defaultBlueprintId()) {
    const blueprint = blueprintForId(blueprintId);
    return portraitStateForItem({
      baseCosmeticId: blueprintId,
      slot: blueprint?.slot,
      materialKind: 'metal',
      metalKey: 'nativeCopper',
      temperXp: 0,
      smithTreatment: null,
    });
  }

  function metalArmorDescriptors(items = []) {
    return (items || []).filter(isMetalArmor).map(item => portraitStateForItem(item));
  }

  function decorateBodyColorsWithMetalArmor(bodyColors, items = []) {
    const out = { ...(bodyColors || {}) };
    const descriptors = metalArmorDescriptors(items);
    if (descriptors.length) out[PORTRAIT_MARKER_KEY] = descriptors;
    else delete out[PORTRAIT_MARKER_KEY];
    return out;
  }

  function decorateAvatarDataWithMetalArmor(avatarData, items = []) {
    const out = avatarData && typeof avatarData === 'object' ? avatarData : {};
    return {
      ...out,
      appearance: {
        ...(out.appearance || {}),
        bodyColors: decorateBodyColorsWithMetalArmor(out?.appearance?.bodyColors, items),
      },
    };
  }

  function portraitStateForGroup(group, bodyColors) {
    if (!group) return null;
    const descriptors = Array.isArray(bodyColors?.[PORTRAIT_MARKER_KEY]) ? bodyColors[PORTRAIT_MARKER_KEY] : [];
    const ids = [group.id, group.originalId].filter(Boolean).map(String);
    const slot = String(group.slot || '');
    const matched = descriptors.find(state =>
      ids.includes(String(state?.blueprintId || ''))
      && (!state?.slot || !slot || String(state.slot) === slot)
    );
    if (matched) return matched;
    const blueprintId = ids.find(id => !!blueprintForId(id));
    return blueprintId && String(group.materialTag || '').toLowerCase() === 'metal'
      ? defaultPortraitState(blueprintId)
      : null;
  }

  function normalizeItem(item) {
    if (!item || (!isMetalArmor(item) && !isLegacySmithMetalItem(item))) return false;
    const blueprint = blueprintForItem(item);
    if (!blueprint) return false;
    let changed = false;
    if (item.baseCosmeticId !== blueprint.id) { item.baseCosmeticId = blueprint.id; changed = true; }
    if (item.slot !== blueprint.slot) { item.slot = blueprint.slot; changed = true; }
    if (item.materialKind !== 'metal') { item.materialKind = 'metal'; changed = true; }
    if (!item.metalKey || !DENSITY_G_CM3[item.metalKey]) { item.metalKey = 'nativeCopper'; changed = true; }
    const normalizedXp = temperXp(item);
    if (Number(item.temperXp) !== normalizedXp) { item.temperXp = normalizedXp; changed = true; }
    const weight = weightForItem(item);
    if (Number(item.weightUnits) !== weight.weightUnits) { item.weightUnits = weight.weightUnits; changed = true; }
    if (Number(item.physicalMassKg) !== weight.massKg) { item.physicalMassKg = weight.massKg; changed = true; }
    if (item.dyeable !== false) { item.dyeable = false; changed = true; }
    if (item.colorA != null) { item.colorA = null; changed = true; }
    if (item.colorB != null) { item.colorB = null; changed = true; }
    if (item.colorC != null) { item.colorC = null; changed = true; }
    if (!Array.isArray(item.articleDyeIds) || item.articleDyeIds.length) { item.articleDyeIds = []; changed = true; }
    if (item.baseLabel !== blueprint.label) { item.baseLabel = blueprint.label; changed = true; }
    return changed;
  }

  function equippedMetalArmorItems() {
    const clothing = deps?.getGearInventory?.()?.clothing || {};
    const seen = new Set();
    return Object.values(clothing).filter(item => {
      if (!isMetalArmor(item)) return false;
      normalizeItem(item);
      const identity = item.uid || item.cosmeticId || item;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }

  function ownedMetalArmor() {
    return (deps?.getGearInventory?.()?.clothingItems || []).filter(isMetalArmor);
  }

  function ownedForBlueprintMetal(blueprintId, metalKey) {
    return ownedMetalArmor().find(item => baseCosmeticId(item) === blueprintId && item.metalKey === metalKey) || null;
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
    if (!isMetalArmor(item)) return '';
    const blueprint = blueprintForItem(item);
    const mass = weightForItem(item);
    return `${metalDef(item.metalKey).label} · Temper ${temperLevel(item)}/5 · ${treatmentText(item)} · ~${mass.massKg.toFixed(2)} kg · ${mass.weightUnits.toFixed(2)} outfit-weight units · ${blueprint?.label || 'Metal armor'}.`;
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
    const blueprintId = state.blueprintId || baseCosmeticId(state);
    const blueprint = blueprintForId(blueprintId) || blueprintForId(defaultBlueprintId());
    const metalKey = String(state.metalKey || 'nativeCopper');
    const baseMetal = metalDef(metalKey);
    const active = treatment(state);
    const sourceOptions = {
      sourceHex: blueprint.sourceHex,
      hueToleranceDeg: blueprint.hueToleranceDeg,
      saturationTolerance: blueprint.saturationTolerance,
    };
    if (active?.mode === 'cosmetic') {
      const platedMetal = metalDef(active.metalKey);
      return { ...sourceOptions, targetHex: platedMetal.hex, verdigrisHex: null, oxidationAmount: 0 };
    }
    if (active?.mode === 'resistant') {
      return { ...sourceOptions, targetHex: baseMetal.hex, verdigrisHex: null, oxidationAmount: 0 };
    }
    if (active?.mode === 'pattern') {
      const authoredPattern = active.pattern || window.PatternLibrary?.getById?.(active.patternLibraryId) || null;
      if (authoredPattern) {
        const motifUrl = authoredPattern.motifUrl; // Repository snapshots use docs-relative asset paths instead of the current page's directory.
        const resolvedPattern = motifUrl && !/^(?:[a-z]+:|\/\/)/i.test(motifUrl) && window.resolvePortraitAssetUrl
          ? { ...authoredPattern, motifUrl: window.resolvePortraitAssetUrl(motifUrl.replace(/^\.?\/?assets\//, '')) }
          : authoredPattern; // Resolves the render copy without changing saved treatment data.
        return { ...sourceOptions, targetHex: baseMetal.hex, verdigrisHex: baseMetal.verdigrisHex, oxidationAmount: 1, authoredPattern: resolvedPattern };
      }
    }
    return { ...sourceOptions, targetHex: baseMetal.hex, verdigrisHex: baseMetal.verdigrisHex, oxidationAmount: quantizedVerdigrisFraction(state) };
  }

  async function processedLayerUrl(sourceUrl, state) {
    if (!sourceUrl || !window.ToolMetalRecolor?.getRecoloredCanvas) return sourceUrl;
    const opts = visualOptions(state);
    const key = [
      sourceUrl,
      String(state?.blueprintId || ''),
      String(state?.metalKey || 'nativeCopper'),
      Number(opts.oxidationAmount || 0).toFixed(2),
      treatmentSignature(treatment(state)),
      opts.targetHex || '',
      opts.verdigrisHex || '',
    ].join('|');
    if (!processedLayerUrlPromises.has(key)) {
      if (processedLayerUrlPromises.size > 80) processedLayerUrlPromises.clear(); // Small bounded visual-state cache; old Temper/plating states are not useful once superseded.
      const resolvedSourceUrl = window.resolvePortraitAssetUrl?.(sourceUrl) || sourceUrl; // Portrait layers are stored asset-root-relative; ToolMetalRecolor otherwise interprets them relative to document.baseURI and misses the PNG.
      processedLayerUrlPromises.set(key, window.ToolMetalRecolor.getRecoloredCanvas(resolvedSourceUrl, opts)
        .then(canvas => canvas?.toDataURL?.('image/png') || sourceUrl)
        .catch(error => {
          lastError = String(error?.message || error);
          return sourceUrl;
        }));
    }
    return processedLayerUrlPromises.get(key);
  }

  function reportResolvedPortraitGroup(group, state, layerCount) {
    if (!state?.blueprintId) return;
    portraitResolutionDebug.set(state.blueprintId, {
      slot: state.slot || group?.slot || '',
      groupId: group?.id || group?.originalId || '',
      layerCount: Math.max(0, Number(layerCount) || 0),
    });
  }

  async function preparePortraitLayers(layers, state) {
    if (!Array.isArray(layers) || !layers.length || !state?.blueprintId) return layers || [];
    const normalizedState = state;
    return Promise.all(layers.map(async layer => {
      if (!layer?.url) return layer;
      const url = await processedLayerUrl(layer.url, normalizedState);
      return url === layer.url ? layer : { ...layer, url };
    }));
  }

  function applyImageVisual(img, sourceUrl, item) {
    if (!img || !sourceUrl || !isMetalArmor(item) || !window.ToolMetalRecolor?.getRecoloredCanvas) return false;
    const state = portraitStateForItem(item);
    const token = `metal-armor:${item.uid || item.cosmeticId || 'item'}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    img.dataset.clothingTintToken = token;
    window.ToolMetalRecolor.getRecoloredCanvas(sourceUrl, visualOptions(state)).then(canvas => {
      if (!canvas || img.dataset.clothingTintToken !== token) return;
      let url = iconDataUrlByCanvas.get(canvas);
      if (!url) { url = canvas.toDataURL('image/png'); iconDataUrlByCanvas.set(canvas, url); }
      img.src = url;
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
    const gain = Math.max(0, Number(amount) || 0);
    if (!(gain > 0)) return false;
    const items = equippedMetalArmorItems().filter(item => temperXp(item) < MAX_TEMPER_XP);
    if (!items.length) return false;
    const rankUps = [];
    let visualChanged = false;
    for (const item of items) {
      const beforeLevel = temperLevel(item);
      const beforeVisual = quantizedVerdigrisFraction(item);
      item.temperXp = Math.min(MAX_TEMPER_XP, temperXp(item) + gain);
      const afterLevel = temperLevel(item);
      const afterVisual = quantizedVerdigrisFraction(item);
      if (afterLevel > beforeLevel) rankUps.push({ item, level: afterLevel });
      if (afterVisual !== beforeVisual || afterLevel !== beforeLevel) visualChanged = true;
    }
    lastTemperReason = reason;
    if (options.save !== false) deps?.saveGearInventory?.();
    if (visualChanged) refreshVisuals();
    if (rankUps.length === 1) {
      const hit = rankUps[0];
      deps?.showToast?.(`🛡 ${hit.item.baseLabel || blueprintForItem(hit.item)?.label || 'Metal armor'} reached Temper ${hit.level}/5.`, true);
    } else if (rankUps.length > 1) {
      deps?.showToast?.(`🛡 ${rankUps.length} equipped metal armor pieces advanced in Temper.`, true);
    }
    return true;
  }

  function installSkillXpListener() {
    const skillSystem = window.SkillSystem;
    if (!skillSystem || typeof skillSystem.onAward !== 'function') {
      skillXpListenerInstalled = false;
      return false;
    }
    if (hookedSkillSystem === skillSystem && typeof skillXpUnsubscribe === 'function') {
      skillXpListenerInstalled = true;
      return true;
    }
    if (typeof skillXpUnsubscribe === 'function') skillXpUnsubscribe();
    hookedSkillSystem = skillSystem;
    skillXpUnsubscribe = skillSystem.onAward(event => {
      const gained = Math.max(0, Number(event?.amount) || 0);
      if (gained > 0) awardExperience(gained, `${event?.skillKey || 'skill'} skill XP`);
    });
    skillXpListenerInstalled = typeof skillXpUnsubscribe === 'function';
    return skillXpListenerInstalled;
  }

  // Inventory keys are deleted when a stack reaches 0 (game.js's
  // clampInventoryStack), so a missing key must read as 0 — a bare
  // Number(undefined) is NaN and `NaN < cost` is false, which used to let a
  // player with no bars smith and treat armor for free.
  function inventoryCount(key) {
    return Math.max(0, Number(deps?.inventory?.[key]) || 0);
  }

  function makeCraftedItem(blueprintId, metalKey) {
    const blueprint = blueprintForId(blueprintId);
    if (!blueprint) return null;
    const metal = metalDef(metalKey);
    const weight = weightForBlueprintMetal(blueprintId, metalKey);
    const uid = `gcloth_smith_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      uid,
      cosmeticId: `${blueprint.id}${CRAFT_ID_MARKER}${uid}`,
      baseCosmeticId: blueprint.id,
      slot: blueprint.slot,
      label: `${metal.label} ${blueprint.label}`,
      baseLabel: blueprint.label,
      description: `Smith-forged ${metal.label.toLowerCase()} ${blueprint.label.toLowerCase()}. Temper records use and experience cosmetically; it never changes the armor's stats.`,
      sprite: currentPlayerSprite(blueprint.id),
      sellPrice: 0,
      materialKind: 'metal',
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

  function craft(blueprintId, metalKey) {
    const blueprint = blueprintForId(blueprintId);
    if (!deps || !blueprint || !deps.VERDIGRIS_METAL_KEYS?.includes(metalKey)) return false;
    if (ownedForBlueprintMetal(blueprintId, metalKey)) {
      deps.showToast?.(`You already own ${metalDef(metalKey).label} ${blueprint.label}.`, false);
      return false;
    }
    const barCost = Number(blueprint.craftBarCost) || DEFAULT_CRAFT_BAR_COST;
    const laborGold = Number(blueprint.craftLaborGold) || DEFAULT_CRAFT_LABOR_GOLD;
    const metal = metalDef(metalKey);
    const barKey = deps.metalBarItemKey?.(metalKey);
    if (!barKey || inventoryCount(barKey) < barCost) {
      deps.showToast?.(`Not enough ${metal.label} bars.`, false);
      return false;
    }
    if (inventoryCount('gold') < laborGold) {
      deps.showToast?.("Not enough gold for the smith's labor.", false);
      return false;
    }
    const gear = deps.getGearInventory?.();
    if (!gear) return false;
    if (!gear.clothing || typeof gear.clothing !== 'object') gear.clothing = {};
    if (!Array.isArray(gear.clothingItems)) gear.clothingItems = [];
    deps.inventory[barKey] = inventoryCount(barKey) - barCost;
    deps.clampInventoryStack?.(barKey);
    deps.inventory.gold = inventoryCount('gold') - laborGold;
    const item = makeCraftedItem(blueprintId, metalKey);
    gear.clothingItems.push(item);
    gear.clothing[blueprint.slot] = item;
    deps.saveGearInventory?.();
    deps.saveMemberWorldData?.();
    refreshVisuals();
    deps.showToast?.(`Smithed ${metal.label} ${blueprint.label} and equipped it.`, true);
    return true;
  }

  function canTreat(item) {
    return isMetalArmor(item) && temperLevel(item) >= 5;
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
      if (!active) { deps.showToast?.('No metal-armor treatment to clear.', false); return false; }
      refundTreatmentBar(item, active);
      return commitTreatment(item, null, 'Cleared armor treatment — live verdigris restored, materials returned.');
    }
    if (choice !== 'resistant' && !String(choice || '').startsWith('cosmetic:')) return false;
    const targetMetalKey = choice === 'resistant' ? item.metalKey : String(choice).slice('cosmetic:'.length);
    const targetMetal = metalDef(targetMetalKey);
    const barKey = deps.metalBarItemKey?.(targetMetalKey);
    if (!barKey || inventoryCount(barKey) < TREATMENT_BAR_COST) {
      deps.showToast?.(`Not enough ${targetMetal.label} bars.`, false);
      return false;
    }
    if (inventoryCount('gold') < TREATMENT_LABOR_GOLD) {
      deps.showToast?.('Not enough gold.', false);
      return false;
    }
    deps.inventory[barKey] = inventoryCount(barKey) - TREATMENT_BAR_COST;
    deps.clampInventoryStack?.(barKey);
    deps.inventory.gold = inventoryCount('gold') - TREATMENT_LABOR_GOLD;
    refundTreatmentBar(item, active); // Replacing a treatment returns the old one's bar, same as clearing it does.
    const next = { mode: choice === 'resistant' ? 'resistant' : 'cosmetic', metalKey: targetMetalKey };
    return commitTreatment(item, next, choice === 'resistant'
      ? 'Applied a verdigris-resistant coat to the armor.'
      : `Plated the armor with ${targetMetal.label}.`);
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
      title: `Author verdigris removal — ${baseMetal.label} ${blueprintForItem(item)?.label || 'Metal Armor'}`,
      motifHint: 'Draw the motif to strip back to bare metal — everything else stays fully oxidized.',
      initialPattern,
      initialPatternLibraryId: active?.mode === 'pattern' ? (active.patternLibraryId || null) : null,
      library: window.PatternLibrary ? {
        list: () => window.PatternLibrary.listAvailable(),
        get: id => window.PatternLibrary.getById(id),
        save: (label, patternData) => window.PatternLibrary.saveToLibrary(label, patternData),
        remove: id => window.PatternLibrary.removeSaved(id),
      } : null,
      renderPreview: patternData => window.ToolMetalRecolor.getRecoloredCanvas(item.sprite || currentPlayerSprite(baseCosmeticId(item)), {
        ...visualOptions({ metalKey: item.metalKey, temperXp: MAX_TEMPER_XP, smithTreatment: null }),
        oxidationAmount: 1,
        authoredPattern: patternData,
      }),
      onSave: (patternData, sourceLibraryId) => {
        const barKey = deps.metalBarItemKey?.(item.metalKey);
        if (!barKey || inventoryCount(barKey) < TREATMENT_BAR_COST) {
          deps.showToast?.(`Not enough ${baseMetal.label} bars.`, false);
          return false;
        }
        if (inventoryCount('gold') < TREATMENT_LABOR_GOLD) {
          deps.showToast?.('Not enough gold.', false);
          return false;
        }
        deps.inventory[barKey] = inventoryCount(barKey) - TREATMENT_BAR_COST;
        deps.clampInventoryStack?.(barKey);
        deps.inventory.gold = inventoryCount('gold') - TREATMENT_LABOR_GOLD;
        refundTreatmentBar(item, treatment(item)); // Replacing a treatment returns the old one's bar, same as clearing it does.
        return commitTreatment(item, {
          mode: 'pattern',
          metalKey: item.metalKey,
          pattern: clone(patternData),
          patternLibraryId: sourceLibraryId || null,
        }, 'Verdigris carefully stripped into an armor pattern.');
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
    const blueprints = Object.values(ARMOR_BLUEPRINTS);
    if (!blueprints.length) return false;

    const section = document.createElement('div');
    section.className = 'shop-section-label';
    section.textContent = '🛡 Metal Clothing';
    list.appendChild(section);

    for (const blueprint of blueprints) {
      const recipeHdr = document.createElement('div');
      recipeHdr.className = 'shop-section-label mc-metal-armor-recipe-label';
      recipeHdr.textContent = blueprint.label;
      list.appendChild(recipeHdr);
      const barCost = Number(blueprint.craftBarCost) || DEFAULT_CRAFT_BAR_COST;
      const laborGold = Number(blueprint.craftLaborGold) || DEFAULT_CRAFT_LABOR_GOLD;

      for (const metalKey of (deps.VERDIGRIS_METAL_KEYS || [])) {
        const metal = metalDef(metalKey);
        const barKey = deps.metalBarItemKey(metalKey);
        const ownedBars = inventoryCount(barKey);
        const affordable = ownedBars >= barCost && inventoryCount('gold') >= laborGold; // Mirrors craft()'s own checks so the button never offers an impossible recipe.
        const alreadyOwned = !!ownedForBlueprintMetal(blueprint.id, metalKey);
        const weight = weightForBlueprintMetal(blueprint.id, metalKey);
        const row = document.createElement('div');
        row.className = 'shop-row mc-metal-armor-craft-row';
        row.innerHTML = `
          <div class="sh-icon">${blueprint.icon || '🛡'}</div>
          <div class="sh-info">
            <div class="sh-name">${deps.esc(metal.label)} ${deps.esc(blueprint.label)}</div>
            <div class="sh-desc">Approx. mass ~${weight.massKg.toFixed(2)} kg · ${weight.weightUnits.toFixed(2)} outfit-weight units · bars owned: ${ownedBars}${alreadyOwned ? ' — already smithed' : ''}</div>
            <div class="sh-price">${barCost} bars + ${laborGold}g</div>
          </div>
          <button class="shop-buy-btn" data-metal-armor-blueprint="${blueprint.id}" data-metal-armor-metal="${metalKey}" ${alreadyOwned || !affordable ? 'disabled' : ''}>${alreadyOwned ? 'Owned' : 'Smith'}</button>
        `;
        row.querySelector('[data-metal-armor-blueprint]')?.addEventListener('click', () => craft(blueprint.id, metalKey));
        list.appendChild(row);
      }
    }

    const owned = ownedMetalArmor();
    if (!owned.length) return true;
    const treatmentHdr = document.createElement('div');
    treatmentHdr.className = 'shop-section-label';
    treatmentHdr.textContent = '🛡 Metal Clothing — Temper & Cosmetic Treatments';
    list.appendChild(treatmentHdr);

    for (const item of owned) {
      normalizeItem(item);
      const blueprint = blueprintForItem(item);
      const metal = metalDef(item.metalKey);
      const weight = weightForItem(item);
      const level = temperLevel(item);
      const row = document.createElement('div');
      row.className = 'shop-row mc-metal-armor-treatment-row';
      const controls = level >= 5
        ? `<div class="mc-tool-controls">
             <select class="mc-metal-armor-treatment-select">${treatmentOptionsHtml(item)}</select>
             <button class="shop-buy-btn mc-metal-armor-treatment-btn">Apply</button>
           </div>`
        : '<div class="sh-price">Cosmetic smith treatments unlock at Temper 5.</div>';
      row.innerHTML = `
        <div class="sh-icon">${blueprint?.icon || '🛡'}</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(metal.label)} ${deps.esc(blueprint?.label || item.baseLabel || 'Metal Armor')}</div>
          <div class="sh-desc">Temper ${level}/5 · ${deps.esc(treatmentText(item))} · ~${weight.massKg.toFixed(2)} kg / ${weight.weightUnits.toFixed(2)} weight units</div>
          ${controls}
        </div>
      `;
      row.querySelector('.mc-metal-armor-treatment-btn')?.addEventListener('click', () => {
        const choice = row.querySelector('.mc-metal-armor-treatment-select')?.value;
        if (choice === 'pattern') openVerdigrisPatternEditor(item);
        else applyTreatment(item, choice);
      });
      list.appendChild(row);
    }
    return true;
  }

  function debugSnapshot() {
    const worn = equippedMetalArmorItems();
    return {
      version: VERSION,
      initialized: !!deps,
      skillXpListenerInstalled,
      thresholds: [...TEMPER_XP_THRESHOLDS],
      lastTemperReason,
      visualRefreshes,
      processedVisualCacheSize: processedLayerUrlPromises.size,
      portraitAssetResolverReady: typeof window.resolvePortraitAssetUrl === 'function', // Pixel Probe exposes whether metal source art can resolve through the portrait asset root.
      portraitResolution: Object.fromEntries(portraitResolutionDebug),
      worn: worn.map(item => ({
        uid: item.uid,
        blueprintId: baseCosmeticId(item),
        slot: item.slot,
        metalKey: item.metalKey,
        temperXp: temperXp(item),
        temperLevel: temperLevel(item),
        verdigrisFraction: verdigrisFraction(item),
        treatment: clone(treatment(item)),
        weight: weightForItem(item),
        visual: {
          sourceHex: blueprintForItem(item)?.sourceHex || null, // Pixel Probe confirms which authored source-key family is being replaced.
          targetHex: metalDef(item.metalKey)?.hex || null, // Used to verify the selected alloy color reached the material renderer.
        },
      })),
      owned: ownedMetalArmor().map(item => ({
        uid: item.uid,
        blueprintId: baseCosmeticId(item),
        slot: item.slot,
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
    if (!snapshot.worn.length) return `Metal armor Temper: none equipped · skill listener ${skillXpListenerInstalled ? 'ready' : 'missing'}`;
    const items = snapshot.worn.map(item => `${item.blueprintId}@${item.slot} ${item.metalKey} ${item.temperXp}/${MAX_TEMPER_XP}xp T${item.temperLevel}/5 ${Math.round(item.verdigrisFraction * 100)}%v ${item.weight.weightUnits.toFixed(2)}wu source=${item.visual?.sourceHex || '-'}→target=${item.visual?.targetHex || '-'}`).join(' | ');
    const renderState = Object.entries(snapshot.portraitResolution || {}).map(([id, rec]) => `${id}@${rec.slot || '?'} layers=${rec.layerCount}`).join(' | ') || 'no resolved metal portrait groups yet';
    const resolverState = snapshot.portraitAssetResolverReady ? 'asset-resolver=ready' : 'asset-resolver=MISSING';
    const errorState = snapshot.lastError ? ` error="${snapshot.lastError}"` : '';
    return `Metal armor Temper: ${items} · portrait ${renderState} · ${resolverState} · skill listener ${skillXpListenerInstalled ? 'ready' : 'missing'}${errorState}`;
  }

  function init(injectedDeps) {
    deps = injectedDeps || deps;
    installSkillXpListener();
    const gear = deps?.getGearInventory?.();
    let changed = false;
    for (const item of (gear?.clothingItems || [])) if (normalizeItem(item)) changed = true;
    for (const item of Object.values(gear?.clothing || {})) if (normalizeItem(item)) changed = true;
    if (changed) deps?.saveGearInventory?.();
    return true;
  }

  window.MetalArmorSystem = Object.freeze({
    version: VERSION,
    CRAFT_ID_MARKER,
    TREATMENT_BAR_COST,
    TREATMENT_LABOR_GOLD,
    TEMPER_XP_THRESHOLDS,
    MAX_TEMPER_XP,
    DENSITY_G_CM3,
    KG_PER_WEIGHT_UNIT,
    PORTRAIT_MARKER_KEY,
    ARMOR_BLUEPRINTS,
    init,
    baseCosmeticId,
    blueprintForId,
    blueprintForItem,
    isMetalArmor,
    normalizeItem,
    temperXp,
    temperLevel,
    verdigrisFraction,
    weightForBlueprintMetal,
    weightForItem,
    spriteForBlueprintAppearance,
    portraitStateForItem,
    portraitStateForGroup,
    reportResolvedPortraitGroup,
    defaultPortraitState,
    metalArmorDescriptors,
    decorateBodyColorsWithMetalArmor,
    decorateAvatarDataWithMetalArmor,
    visualOptions,
    preparePortraitLayers,
    applyImageVisual,
    awardExperience,
    equippedMetalArmorItems,
    ownedMetalArmor,
    ownedForBlueprintMetal,
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
      isLegacySmithMetalItem,
      craft,
      applyTreatment,
    }),
  });
  window.__metalArmorDebug = debugSnapshot;
})();
