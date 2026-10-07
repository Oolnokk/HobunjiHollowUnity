// NPC portrait JSON/random profile adapter for temporary PNG-plane avatar previews.
(function () {
  'use strict';

  let cosmeticsPromise = null;
  let cosmeticsCache = null;
  let accountShimInstalled = false;
  let activeNpcForShim = null;

  function setAssetBase(assetBase) {
    if (window.setPortraitAssetBase && assetBase) window.setPortraitAssetBase(assetBase);
  }

  async function ensurePortraitCosmetics(paths = {}) {
    if (cosmeticsCache) return cosmeticsCache;
    if (cosmeticsPromise) return cosmeticsPromise;
    setAssetBase(paths.assetBase || '../../assets/');
    cosmeticsPromise = window.loadPortraitCosmetics(paths.configBase || '../../config/')
      .then(cosmetics => {
        cosmeticsCache = cosmetics;
        return cosmeticsCache;
      })
      .finally(() => { cosmeticsPromise = null; });
    return cosmeticsPromise;
  }

  function installAccountShim() {
    if (accountShimInstalled) return;
    window.ScratchbonesAccount = {
      getShopCatalog: () => window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [],
      getDyeCatalog: () => window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [],
      getDyeCategories: () => window.SCRATCHBONES_CONFIG?.game?.dyes?.categories || [],
      getAppliedDyes: () => activeNpcForShim?.appliedDyes || {},
      getAppearance: () => activeNpcForShim?.appearance || { speciesId: 'mao-ao', gender: 'male', cosmetics: {} },
      isUnlocked: () => true,
      isDyeOwned: () => true,
      getEquippedForCategory: cat => {
        const catalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
        const ids = activeNpcForShim?.equippedCosmetics || [];
        return catalog.find(item => item.category === cat && ids.includes(item.id))?.id ?? null;
      },
    };
    accountShimInstalled = true;
  }

  function seededRng(seedText) {
    let s = 2166136261;
    const str = String(seedText || Date.now());
    for (let i = 0; i < str.length; i += 1) {
      s ^= str.charCodeAt(i);
      s = Math.imul(s, 16777619) >>> 0;
    }
    return function rng() {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalizeSpeciesId(speciesId) {
    return String(speciesId || '').replace(/_/g, '-');
  }

  function selectFighter(speciesId, gender) {
    const fighters = window.getPortraitFighters?.() || [];
    const normalized = normalizeSpeciesId(speciesId || 'mao-ao');
    const underscored = normalized.replace(/-/g, '_');
    const desiredGender = String(gender || 'male').toLowerCase();
    const fighterGender = f => f.gender ?? (f.id === 'M' ? 'male' : f.id === 'F' ? 'female' : null);
    return fighters.find(f =>
      (f.speciesId === normalized || f.speciesId === underscored) && fighterGender(f) === desiredGender
    ) || fighters[0] || null;
  }

  function randomProfile(seedText, options = {}) {
    const cosmetics = cosmeticsCache;
    if (!cosmetics || !window.randomPortraitProfileSeeded) return null;
    const fighter = selectFighter(options.speciesId, options.gender);
    if (!fighter) return null;
    const {
      hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions, eyesOptions,
      upperFaceOptions, facialHairOptions, hatOptions, hoodOptions, torsoPortraitOptions, armPortraitOptions,
      bodyColorRangesByGender, allowedCosmeticsByFighter, cosmeticWeightsByFighter,
      forcedCosmeticsByFighter, conditionalCosmeticsByFighter,
      mandatoryCosmeticSlotsByFighter, exclusiveCosmeticsByFighter,
    } = cosmetics;
    return window.randomPortraitProfileSeeded(seededRng(seedText), [fighter], hairFrontOptions, hairBackOptions,
      hairSideOptions, hairSideLOptions, eyesOptions, upperFaceOptions, facialHairOptions,
      bodyColorRangesByGender, allowedCosmeticsByFighter, hatOptions, hoodOptions,
      cosmeticWeightsByFighter, torsoPortraitOptions, armPortraitOptions,
      forcedCosmeticsByFighter, conditionalCosmeticsByFighter, undefined,
      mandatoryCosmeticSlotsByFighter, exclusiveCosmeticsByFighter);
  }

  // Authored NPC aging (appearance.aging), ported from
  // docs/references/HobunjiAvatarBodyAgingColorPreview-2.html (body color) and
  // HobunjiAvatarPosturePreview-11.html (posture):
  //   appearance.aging = { hunch: 0..1, bodyColor: { amount, desaturation, brightening } }
  // bodyColor values are the reference tool's percentages. Only body slots
  // A/B/C are aged; clothing and equipment dyes are untouched. `hunch` is the
  // HobunjiCharacterRigScale age fraction (the neck-bone head drop the posture
  // preview baked as pixels) and is read at avatar build time via ageFor().
  const AGING_BODY_COLOR_PRESETS = Object.freeze({
    mature: Object.freeze({ amount: 40, desaturation: 40, brightening: 14 }),
    old: Object.freeze({ amount: 70, desaturation: 65, brightening: 30 }),
    ancient: Object.freeze({ amount: 100, desaturation: 88, brightening: 48 }),
  });
  const AGING_BODY_SLOTS = ['A', 'B', 'C'];
  const clampPercent = value => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  };
  const srgbToLinear = c => {
    const v = Math.max(0, Math.min(1, Number(c) / 255));
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const linearToSrgb = c => {
    const v = Math.max(0, Math.min(1, Number(c) || 0));
    return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
  };
  function mixLinear(from, to, t) {
    return from.map((c, i) => linearToSrgb(srgbToLinear(c) + (srgbToLinear(to[i]) - srgbToLinear(c)) * t));
  }

  function normalizeBodyColorAging(raw) {
    const source = typeof raw === 'string' ? AGING_BODY_COLOR_PRESETS[raw] : (raw?.preset ? { ...AGING_BODY_COLOR_PRESETS[raw.preset], ...raw } : raw);
    if (!source || typeof source !== 'object') return null;
    const amount = clampPercent(source.amount);
    return amount > 0 ? { amount, desaturation: clampPercent(source.desaturation), brightening: clampPercent(source.brightening) } : null;
  }

  // Desaturates toward an equal-luminance gray, then brightens toward white,
  // both mixed in linear-light RGB (exactly the reference tool's ageBodyColorHex).
  function ageBodyColorRgb(rgb, settings) {
    const aging = normalizeBodyColorAging(settings);
    if (!aging || !Array.isArray(rgb)) return rgb;
    const age = aging.amount / 100;
    const luminance = 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
    const gray = linearToSrgb(luminance);
    const desaturated = mixLinear(rgb, [gray, gray, gray], age * aging.desaturation / 100);
    return mixLinear(desaturated, [255, 255, 255], age * aging.brightening / 100).map(c => Math.max(0, Math.min(255, Math.round(c))));
  }

  const toHex = rgb => `#${rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;

  // Resolves each body slot to the literal RGB the portrait renderer would tint
  // with (same species swatch-base simulation as portrait-utils.js's
  // bodySpriteTintForColor), ages it, and stores the result as a hex slot.
  function applyBodyColorAging(profile, settings) {
    const aging = normalizeBodyColorAging(settings);
    if (!profile || !aging) return profile;
    const resolveRgb = window._resolveTargetRgbColor;
    const referenceHexFor = window._dyeReferenceHexForSlot;
    if (typeof resolveRgb !== 'function' || typeof referenceHexFor !== 'function') return profile;
    const speciesId = profile.fighter?.speciesId || '';
    const next = { ...(profile.bodyColors || {}) };
    const slots = {};
    for (const slot of AGING_BODY_SLOTS) {
      const descriptor = next[slot];
      if (!descriptor) continue;
      const rgb = resolveRgb(descriptor, referenceHexFor(slot, speciesId));
      if (!rgb) continue;
      const agedHex = toHex(ageBodyColorRgb([...rgb], aging));
      next[slot] = { hex: agedHex };
      slots[slot] = { originalHex: toHex(rgb), agedHex };
    }
    profile.bodyColors = next;
    profile.agingBodyColorSlots = slots; // Diagnostics only.
    return profile;
  }

  function restingExpressionForRecord(rec) {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.expressions || {}; // Shared expression validation for world, dialogue and cutscene portraits.
    const available = Array.isArray(cfg.available) ? cfg.available.map(value => String(value).trim().toLowerCase()) : []; // Accepts the configured mouth expressions only.
    const fallback = String(cfg.defaultResting || 'neutral').trim().toLowerCase(); // Used for unset or invalid authored expressions.
    const authored = String(rec?.restingExpression || fallback).trim().toLowerCase(); // Keeps imported expressions consistent with editor selections.
    return !available.length || available.includes(authored) ? authored : fallback;
  }

  function buildProfileFromNpcExport(npc) {
    const cosmetics = cosmeticsCache;
    if (!cosmetics || !npc?.appearance) return null;
    if (npc.id !== 'player' && (npc.id || npc.clothingPatterns) && window.NpcWardrobe?.wornClothingItemsForRecord && window.ClothingWeavingSystem?.decorateAvatarDataWithWovenItems) {
      npc = window.ClothingWeavingSystem.decorateAvatarDataWithWovenItems(npc, window.NpcWardrobe.wornClothingItemsForRecord(npc, true));
    }
    installAccountShim();
    activeNpcForShim = npc;
    const appearance = npc.appearance || {};
    const profileSeed = appearance.randomSeed || `npc-json:${npc.name || ''}:${JSON.stringify(appearance.cosmetics || {})}`; // Lets generated NPCs vary authored species palettes without changing their visible names.
    const profile = randomProfile(profileSeed, {
      speciesId: appearance.speciesId,
      gender: appearance.gender,
    });
    if (!profile) return null;
    if (npc.id || Object.hasOwn(npc, 'restingExpression')) {
      profile.restingExpression = restingExpressionForRecord(npc);
      profile.portraitSeatId = npc.id || npc.name || 'npc';
    }

    const { optionCache, hatOptions, hoodOptions, torsoPortraitOptions, armPortraitOptions } = cosmetics;
    const savedCosmetics = appearance.cosmetics || {};
    const forced = cosmetics.forcedCosmeticsByFighter?.[profile.fighter?.id] ?? {};
    const forcedSlots = new Set(Object.keys(forced));
    const mandatorySlots = new Set(cosmetics.mandatoryCosmeticSlotsByFighter?.[profile.fighter?.id] || []);
    const exclusiveBySlot = cosmetics.exclusiveCosmeticsByFighter?.[profile.fighter?.id] || {};
    const isAllowedSavedCosmetic = (slot, id) => {
      const exclusive = exclusiveBySlot?.[slot];
      return !Array.isArray(exclusive) || !exclusive.length || exclusive.includes(id);
    };
    const lookup = id => id ? (optionCache?.get(id) ?? null) : null;
    for (const [slot, profileKey] of Object.entries({
      hairFront: 'hairFront', hairBack: 'hairBack', hairSide: 'hairSide', hairSideL: 'hairSideL',
      eyes: 'eyes', upperFace: 'upperFace', facialHair: 'facialHair',
    })) {
      if (savedCosmetics[slot] === undefined || forcedSlots.has(slot) || !isAllowedSavedCosmetic(slot, savedCosmetics[slot])) continue;
      if (slot === 'upperFace' && mandatorySlots.has(slot) && (!savedCosmetics[slot] || savedCosmetics[slot] === 'none')) continue;
      profile[profileKey] = lookup(savedCosmetics[slot]);
    }
    if (appearance.bodyColors) profile.bodyColors = { ...(profile.bodyColors || {}), ...appearance.bodyColors };
    if (Array.isArray(appearance.bodyDeform)) profile.bodyDeform = appearance.bodyDeform;

    const catalog = window.ScratchbonesAccount.getShopCatalog();
    const equippedIds = Array.isArray(npc.equippedCosmetics) ? npc.equippedCosmetics : [];
    const resolveVariantId = (category, equippedId) => {
      if (!equippedId) return null;
      const base = catalog.find(i => i.id === equippedId);
      if (!base) return equippedId;
      const speciesId = appearance.speciesId;
      const gender = appearance.gender;
      const candidates = catalog.filter(i =>
        i.category === category && i.label === base.label &&
        (i.material || null) === (base.material || null) &&
        i.species === speciesId && (!i.gender || i.gender === gender)
      );
      return [equippedId, ...candidates.map(i => i.id)].find(id => optionCache?.has(id)) ?? equippedId;
    };
    const applyEquip = (category, key, noneOpt) => {
      // Most equipped ids are shop-catalog items, whose category the catalog
      // itself carries. Bandit-exclusive/loot-only cosmetics (e.g. facewrap)
      // are deliberately never listed in the shop catalog -- so it never
      // shows up as a free pick in character creation's Collections tab --
      // which means their category has to come from the cosmetic JSON's own
      // `slot` (already recorded on the optionCache entry) instead.
      const equippedId = catalog.find(i => i.category === category && equippedIds.includes(i.id))?.id
        ?? equippedIds.find(id => optionCache?.get(id)?.slot === category)
        ?? null;
      const resolvedId = resolveVariantId(category, equippedId);
      profile[key] = (resolvedId && optionCache?.has(resolvedId)) ? optionCache.get(resolvedId) : (noneOpt || { id: 'none', tintSlot: null, layers: [] });
    };
    applyEquip('hat', 'hat', hatOptions?.[0]);
    applyEquip('hood', 'hood', hoodOptions?.[0]);
    applyEquip('pauldron', 'pauldron', { id: 'none', label: 'No Pauldrons', tintSlot: null, layers: [] });
    applyEquip('torso', 'torsoCosmetic', torsoPortraitOptions?.[0]);
    applyEquip('overwear', 'armCosmetic', armPortraitOptions?.[0]);

    const portraitCosmeticConfig = window.SCRATCHBONES_CONFIG?.game?.portrait?.cosmetics || {};
    const collaredTag = portraitCosmeticConfig.collaredTag;
    const collarLockedFacialHairIds = portraitCosmeticConfig.collarLockedFacialHairIds || portraitCosmeticConfig.shirtbeardIds || [];
    const hasCollaredClothing = collaredTag
      ? [profile.torsoCosmetic, profile.armCosmetic].some(c => c?.tags?.includes(collaredTag))
      : false;
    if (!hasCollaredClothing && collarLockedFacialHairIds.includes(profile.facialHair?.id)) {
      profile.facialHair = optionCache?.get('none') || { id: 'none', label: 'No Facial Hair', tintSlot: null, layers: [] };
    }

    const defaultTintColors = portraitCosmeticConfig.defaultTintColors || {};
    const defaults = profile.upperFace?.id ? defaultTintColors[profile.upperFace.id] : null;
    if (defaults) {
      for (const [tintKey, color] of Object.entries(defaults)) {
        profile.bodyColors = { ...(profile.bodyColors || {}), [tintKey]: { ...color } };
      }
    }
    const dyes = npc.appliedDyes || {};
    const dyeCatalog = window.ScratchbonesAccount.getDyeCatalog();
    for (const [tintKey, dyeId] of Object.entries(dyes)) {
      const dye = dyeCatalog.find(d => d.id === dyeId);
      if (dye) {
        const nextBodyColors = Object.assign({}, profile.bodyColors || {});
        const nextTint = Object.assign({}, dye.color || {});
        if (dye.hex) { nextTint.hex = dye.hex; nextTint.tintMode = 'hexShadeFill'; }
        nextBodyColors[tintKey] = nextTint;
        profile.bodyColors = nextBodyColors;
      }
    }
    const aging = appearance.aging;
    if (aging && typeof aging === 'object') {
      profile.aging = { ...aging }; // Carried on the profile so avatar builders (HobunjiCharacterRigScale.ageFor) find the authored hunch.
      applyBodyColorAging(profile, aging.bodyColor);
    }
    return profile;
  }

  async function renderProfileToCanvas(canvas, profile, renderOptions = {}) {
    const renderer = window.renderPortraitProfile; // Current live portrait renderer; later runtime wrappers are allowed to replace the original global function.
    if (!canvas || !profile || typeof renderer !== 'function') return false;
    if (Object.hasOwn(profile, 'restingExpression')) {
      const seatId = renderOptions.seatId ?? profile.portraitSeatId; // Cutscene/static bakes use the same seat as dialogue instead of the shared null seat.
      const composer = renderOptions.breathingComposer ?? window.portraitBreathingComposer; // Explicit frozen/emote composers remain authoritative.
      composer?.setDefaultExpression?.(seatId, profile.restingExpression); // Register the fallback even when a timed expression currently has the same face; timed overrides remain intact.
      renderOptions = { ...renderOptions, seatId };
    }
    const weaving = window.ClothingWeavingSystem; // Optional runtime bridge that reapplies woven rendering when a later wrapper replaced the initially woven global renderer.
    if (typeof weaving?.renderProfileWithWovenPatterns === 'function') {
      await weaving.renderProfileWithWovenPatterns(renderer, canvas, profile, renderOptions);
    } else {
      await renderer(canvas, profile, renderOptions);
    }
    return true;
  }

  function normalizeNpcImport(data) {
    return Array.isArray(data) ? data.filter(Boolean) : (data ? [data] : []);
  }

  window.NpcAvatarPreview = {
    restingExpressionForRecord,
    ensurePortraitCosmetics,
    buildProfileFromNpcExport,
    randomProfile,
    renderProfileToCanvas,
    normalizeNpcImport,
    agingBodyColorPresets: AGING_BODY_COLOR_PRESETS,
    ageBodyColorRgb,
    applyBodyColorAging,
    seededRng,
  };

})();
