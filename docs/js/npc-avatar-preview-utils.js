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
    } = cosmetics;
    return window.randomPortraitProfileSeeded(seededRng(seedText), [fighter], hairFrontOptions, hairBackOptions,
      hairSideOptions, hairSideLOptions, eyesOptions, upperFaceOptions, facialHairOptions,
      bodyColorRangesByGender, allowedCosmeticsByFighter, hatOptions, hoodOptions,
      cosmeticWeightsByFighter, torsoPortraitOptions, armPortraitOptions,
      forcedCosmeticsByFighter, conditionalCosmeticsByFighter);
  }

  function buildProfileFromNpcExport(npc) {
    const cosmetics = cosmeticsCache;
    if (!cosmetics || !npc?.appearance) return null;
    installAccountShim();
    activeNpcForShim = npc;
    const appearance = npc.appearance || {};
    const profile = randomProfile(`npc-json:${npc.name || ''}:${JSON.stringify(appearance.cosmetics || {})}`, {
      speciesId: appearance.speciesId,
      gender: appearance.gender,
    });
    if (!profile) return null;

    const { optionCache, hatOptions, hoodOptions, torsoPortraitOptions, armPortraitOptions } = cosmetics;
    const savedCosmetics = appearance.cosmetics || {};
    const forced = cosmetics.forcedCosmeticsByFighter?.[profile.fighter?.id] ?? {};
    const forcedSlots = new Set(Object.keys(forced));
    const lookup = id => id ? (optionCache?.get(id) ?? null) : null;
    for (const [slot, profileKey] of Object.entries({
      hairFront: 'hairFront', hairBack: 'hairBack', hairSide: 'hairSide', hairSideL: 'hairSideL',
      eyes: 'eyes', upperFace: 'upperFace', facialHair: 'facialHair',
    })) {
      if (savedCosmetics[slot] !== undefined && !forcedSlots.has(slot)) profile[profileKey] = lookup(savedCosmetics[slot]);
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
      const equippedId = catalog.find(i => i.category === category && equippedIds.includes(i.id))?.id ?? null;
      const resolvedId = resolveVariantId(category, equippedId);
      profile[key] = (resolvedId && optionCache?.has(resolvedId)) ? optionCache.get(resolvedId) : (noneOpt || { id: 'none', tintSlot: null, layers: [] });
    };
    applyEquip('hat', 'hat', hatOptions?.[0]);
    applyEquip('hood', 'hood', hoodOptions?.[0]);
    applyEquip('torso', 'torsoCosmetic', torsoPortraitOptions?.[0]);
    applyEquip('overwear', 'armCosmetic', armPortraitOptions?.[0]);

    const defaultTintColors = window.SCRATCHBONES_CONFIG?.game?.portrait?.cosmetics?.defaultTintColors || {};
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
      if (dye) profile.bodyColors = { ...(profile.bodyColors || {}), [tintKey]: { ...dye.color } };
    }
    return profile;
  }

  async function renderProfileToCanvas(canvas, profile, renderOptions = {}) {
    if (!canvas || !profile || !window.renderPortraitProfile) return false;
    await window.renderPortraitProfile(canvas, profile, renderOptions);
    return true;
  }

  function normalizeNpcImport(data) {
    return Array.isArray(data) ? data.filter(Boolean) : (data ? [data] : []);
  }

  window.NpcAvatarPreview = {
    ensurePortraitCosmetics,
    buildProfileFromNpcExport,
    randomProfile,
    renderProfileToCanvas,
    normalizeNpcImport,
    seededRng,
  };
})();
