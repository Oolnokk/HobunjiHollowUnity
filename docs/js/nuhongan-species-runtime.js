// Nuhongan are Tletingan-derived Slagothim: identical authored anatomy/assets,
// with distinct body proportions and authored world-size extremity compensation.
(() => {
  'use strict';

  const ID = 'nuhongan'; // Distinct saved/runtime species id so Nuhongan retain their own whole-rig scale.
  const DONOR = 'tletingan'; // Single appearance/anatomy authority for every non-scale Nuhongan system.
  const GENDERS = Object.freeze(['male', 'female']); // Used by all same-gender inheritance passes below.
  const PART_SCALE_AXES = window.HobunjiCharacterRigScaleDefaults?.nuhonganPartScaleAxes; // Reads fixed authored axes; this bridge never calculates a donor/body scale ratio.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value)); // Prevents Nuhongan edits from mutating Tletingan source records.
  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const config = window.SCRATCHBONES_CONFIG?.game; // Shared gameplay/editor configuration extended by this bridge.
  const appearance = config?.appearanceEditor; // Parent-species registry read by hands, feet, portrait placement and editor grouping.

  const status = {
    appearanceInstalled: false,
    behindHeadInstalled: false,
    rigProfilesInstalled: 0,
    rigCorrectionsApplied: false,
    handModelKey: null,
    handScale: {},
    footScale: {},
    poseOrbitScale: {},
    armMaskProfilesInstalled: 0,
    mouthInheritanceInstalled: false,
    metalArmorInheritanceInstalled: false,
    nameForgeInheritanceInstalled: false,
    nameAdvisorInheritanceInstalled: false,
    conditionSpeciesRegistered: false,
    creatorPrivateSpeciesTableCaptured: false,
    lastError: null,
  }; // Mobile-readable verification of the inheritance paths most likely to fail from load-order regressions.

  function installAppearanceInheritance() {
    const donorSpecies = appearance?.species?.[DONOR];
    if (!donorSpecies) return false;
    appearance.species[ID] = {
      ...clone(donorSpecies),
      label: 'Nuhongan',
      parentSpecies: DONOR,
      genders: clone(donorSpecies.genders || GENDERS),
    };
    if (appearance.bodyPalettes?.[DONOR]) appearance.bodyPalettes[ID] = clone(appearance.bodyPalettes[DONOR]);
    status.appearanceInstalled = appearance.species[ID]?.parentSpecies === DONOR;
    return status.appearanceInstalled;
  }

  function installBehindHeadInheritance() {
    const headUrls = config?.assets?.pngPlaneAvatar?.behindView?.headUrls; // portrait-utils uses a direct species lookup here rather than parentSpecies.
    if (!headUrls?.[DONOR]) return false;
    headUrls[ID] = clone(headUrls[DONOR]);
    status.behindHeadInstalled = true;
    return true;
  }

  function installRigInheritance() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Shared geometry/attachment source for hands, feet, posterior and shoulder perches.
    if (!characters) return 0;
    let installed = 0;
    for (const gender of GENDERS) {
      const source = characters[`${DONOR}::${gender}`];
      if (!source) continue;
      const profile = clone(source);
      profile.species = ID;
      profile.gender = gender;
      if (profile.shoulderPerchRule) profile.shoulderPerchRule.appearanceSpeciesId = ID;
      if (profile.posteriorRule) profile.posteriorRule.appearanceSpeciesId = ID;
      profile.anatomy ||= {};
      // Retain donor size controls; fixed per-axis authoring cancels only the
      // extremities' inherited body shrink, without moving their anchors.
      for (const key of ['rigScale', 'rigScaleX', 'rigScaleY', 'headScale', 'headOffsetY']) delete profile.anatomy[key];
      profile.anatomy.handScaleAxes = clone(PART_SCALE_AXES);
      profile.anatomy.footScaleAxes = clone(PART_SCALE_AXES);
      characters[`${ID}::${gender}`] = profile;
      installed += 1;
    }
    status.rigProfilesInstalled = installed;
    return installed;
  }

  function installExtremityInheritance() {
    const feet = config?.assets?.pngPlaneAvatar?.proceduralFeet; // Shared foot model/size/bend registries; most consumers also understand parentSpecies.
    for (const table of Object.values(feet || {})) {
      if (table && typeof table === 'object' && table[DONOR] != null) table[ID] = clone(table[DONOR]);
    }

    const handProfiles = window.HobunjiHandModelProfiles; // Shared GLB/model + species/gender hand-scale registry.
    handProfiles?.mutate?.(data => {
      data.speciesModels ||= {};
      if (data.speciesModels[DONOR]) data.speciesModels[ID] = data.speciesModels[DONOR];
    });

    // Re-running the canonical profile correction copies the retained Tletingan
    // anatomy.handScale/footScale from the cloned rig profiles into the runtime
    // scale tables under the Nuhongan key.
    status.rigCorrectionsApplied = !!window.applyHobunjiAttachmentRigProfileCorrections?.();
    status.handModelKey = handProfiles?.modelKeyForSpecies?.(ID) || handProfiles?.data?.speciesModels?.[ID] || null;
    for (const gender of GENDERS) {
      status.handScale[gender] = handProfiles?.speciesScaleFor?.(ID, gender) ?? handProfiles?.data?.speciesScaleOverrides?.[ID]?.[gender] ?? null;
      status.footScale[gender] = handProfiles?.footScaleFor?.(ID, gender) ?? feet?.footScale?.[ID]?.[gender] ?? null;
    }
  }

  function installPoseOrbitInheritance() {
    const poseScale = window.HobunjiSpeciesPoseScale; // Weapon pose system does not currently walk parentSpecies, so register the donor values explicitly.
    if (!poseScale?.resolveScale || !poseScale?.setScale) return false;
    for (const gender of GENDERS) {
      const donorScale = poseScale.resolveScale(DONOR, gender);
      if (Number.isFinite(Number(donorScale)) && Number(donorScale) > 0) {
        poseScale.setScale(ID, gender, donorScale);
        status.poseOrbitScale[gender] = donorScale;
      }
    }
    return Object.keys(status.poseOrbitScale).length > 0;
  }

  function installArmMaskInheritance() {
    const armMask = window.PortraitArmCloudMask; // Exposes the canonical authored per-species arm-cut profiles.
    const portrait = config?.portrait;
    if (!armMask?.authoredProfiles || !portrait) return 0;
    portrait.armOnlyOpacityMask ||= {};
    portrait.armOnlyOpacityMask.profiles ||= {};
    let installed = 0;
    for (const gender of GENDERS) {
      const donorProfile = armMask.authoredProfiles[`${DONOR}:${gender}`];
      if (!donorProfile) continue;
      portrait.armOnlyOpacityMask.profiles[`${ID}:${gender}`] = clone(donorProfile);
      installed += 1;
    }
    status.armMaskProfilesInstalled = installed;
    return installed;
  }

  function installMouthInheritance() {
    // Mouth-expression helpers predate parentSpecies and use a hard-coded map.
    // Wrap only Nuhongan calls through the Tletingan mapping while delegating all
    // other species unchanged; renderProfile's global bindings observe these assignments.
    const baseUrl = window._getMouthSpriteUrl;
    const baseMask = window._isMouthMask;
    const baseOpacity = window._getMouthExpressionOpacity;
    if (typeof baseUrl !== 'function' || baseUrl.__hobunjiNuhonganMouthInheritance) return false;

    const url = function nuhonganMouthSpriteUrl(expression, speciesId, gender) {
      return baseUrl.call(this, expression, normalizeSpecies(speciesId) === ID ? DONOR : speciesId, gender);
    };
    url.__hobunjiNuhonganMouthInheritance = true;
    window._getMouthSpriteUrl = url;

    if (typeof baseMask === 'function') window._isMouthMask = function nuhonganMouthMask(speciesId) {
      return baseMask.call(this, normalizeSpecies(speciesId) === ID ? DONOR : speciesId);
    };
    if (typeof baseOpacity === 'function') window._getMouthExpressionOpacity = function nuhonganMouthOpacity(expression, speciesId) {
      return baseOpacity.call(this, expression, normalizeSpecies(speciesId) === ID ? DONOR : speciesId);
    };
    status.mouthInheritanceInstalled = true;
    return true;
  }

  function installMetalArmorInheritance() {
    // Metal armor's authored sprite table is private/frozen and its current-player
    // lookup does not walk parentSpecies. Wrap the public init boundary so only
    // that module sees Nuhongan as Tletingan when it asks for appearance art.
    const system = window.MetalArmorSystem;
    if (!system || system.__hobunjiNuhonganInheritance) return !!system?.__hobunjiNuhonganInheritance;
    const baseInit = system.init;
    const baseSpriteForAppearance = system.spriteForBlueprintAppearance;
    if (typeof baseInit !== 'function' || typeof baseSpriteForAppearance !== 'function') return false;

    const donorAppearance = raw => {
      if (!raw || normalizeSpecies(raw.speciesId || raw.species) !== ID) return raw;
      return { ...raw, speciesId: DONOR, species: DONOR };
    };
    const wrapped = {
      ...system,
      __hobunjiNuhonganInheritance: true,
      spriteForBlueprintAppearance(blueprintId, rawAppearance) {
        return baseSpriteForAppearance.call(system, blueprintId, donorAppearance(rawAppearance));
      },
      init(injectedDeps) {
        if (!injectedDeps || typeof injectedDeps.getPlayerData !== 'function') return baseInit.call(system, injectedDeps);
        const baseGetPlayerData = injectedDeps.getPlayerData; // Used only inside MetalArmorSystem to choose current-player authored armor art.
        return baseInit.call(system, {
          ...injectedDeps,
          getPlayerData() {
            const data = baseGetPlayerData();
            return data?.appearance && normalizeSpecies(data.appearance.speciesId || data.appearance.species) === ID
              ? { ...data, appearance: donorAppearance(data.appearance) }
              : data;
          },
        });
      },
    };
    window.MetalArmorSystem = Object.freeze(wrapped);
    status.metalArmorInheritanceInstalled = true;
    return true;
  }

  function installFutureGlobalAdapter(globalName, wrapValue, statusKey) {
    // Name systems load after the hand/rig bootstrap on the game page. Install a
    // one-shot assignment hook so Nuhongan gets Slagothim/Tletingan phonetics
    // without editing or duplicating either naming engine.
    const descriptor = Object.getOwnPropertyDescriptor(window, globalName);
    const current = window[globalName];
    if (current) {
      window[globalName] = wrapValue(current);
      status[statusKey] = true;
      return true;
    }
    if (descriptor && descriptor.configurable === false) return false;
    let pending = null; // Holds the first late-loaded engine until it is wrapped and promoted to a normal writable property.
    Object.defineProperty(window, globalName, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => pending,
      set(value) {
        pending = wrapValue(value);
        Object.defineProperty(window, globalName, {
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
          writable: true,
          value: pending,
        });
        status[statusKey] = true;
      },
    });
    return true;
  }

  function installNameInheritance() {
    installFutureGlobalAdapter('BanditNameForge', forge => {
      if (!forge || forge.__hobunjiNuhonganInheritance) return forge;
      const baseGenerate = forge.generateCulturalIdentity;
      const baseCulture = forge.cultureIdForSpecies;
      return Object.freeze({
        ...forge,
        __hobunjiNuhonganInheritance: true,
        generateCulturalIdentity(options = {}) {
          const next = normalizeSpecies(options?.speciesId) === ID ? { ...options, speciesId: DONOR } : options;
          return typeof baseGenerate === 'function' ? baseGenerate.call(forge, next) : null;
        },
        cultureIdForSpecies(speciesId) {
          const next = normalizeSpecies(speciesId) === ID ? DONOR : speciesId;
          return typeof baseCulture === 'function' ? baseCulture.call(forge, next) : null;
        },
      });
    }, 'nameForgeInheritanceInstalled');

    installFutureGlobalAdapter('HobunjiNameAdvisor', advisor => {
      if (!advisor || advisor.__hobunjiNuhonganInheritance) return advisor;
      const baseMakeIdeaOptions = advisor.makeIdeaOptions;
      return Object.freeze({
        ...advisor,
        __hobunjiNuhonganInheritance: true,
        makeIdeaOptions(speciesId, slot, idea) {
          // Tletingan name suggestions are Slagothim phonetics; use the same
          // semantic family key so the advisor also selects the Slagothim slot.
          if (normalizeSpecies(speciesId) === ID) return baseMakeIdeaOptions?.call(advisor, 'slagothim', slot === 'first' ? 'given' : slot, idea) || [];
          return baseMakeIdeaOptions?.call(advisor, speciesId, slot, idea) || [];
        },
      });
    }, 'nameAdvisorInheritanceInstalled');
    return true;
  }

  function installConditionTaxonomy() {
    const species = window.ConditionRegistry?.PLAYER_SPECIES; // Dialogue/loot condition editor/runtime exposes a mutable shared species list.
    if (!Array.isArray(species)) return false;
    if (!species.includes(ID)) species.push(ID);
    status.conditionSpeciesRegistered = species.includes(ID);
    return status.conditionSpeciesRegistered;
  }

  // onboarding-core keeps its own private SPECIES_DATA. Add Nuhongan there by
  // cloning Tletingan at the first real table enumeration. The existing
  // Mashtzarr-female bridge may wrap Object.entries after this one; both wrappers
  // deliberately delegate and self-remove cleanly when they see the same table.
  function hydrateOnboardingSpeciesTable(table) {
    const donor = table?.[DONOR];
    const looksLikeCoreSpeciesTable = table?.['mao-ao']?.label === 'Mao-ao'
      && table?.kenkari?.label === 'Kenkari'
      && table?.['engh-sho']?.label === 'Engh-sho'
      && donor?.label === 'Tletingan'
      && Array.isArray(donor?.male?.slots);
    if (!looksLikeCoreSpeciesTable) return false;
    table[ID] = {
      ...clone(donor),
      label: 'Nuhongan',
      parentSpecies: DONOR,
    };
    status.creatorPrivateSpeciesTableCaptured = true;
    return true;
  }

  function installOnboardingSpeciesTableCapture() {
    const originalEntries = Object.entries;
    if (originalEntries.__hobunjiNuhonganSpeciesCapture) return false;
    let retired = false; // Returning players may skip creator enumeration; retire the wrapper once gameplay starts.
    const wrappedEntries = function hobunjiNuhonganSpeciesEntries(value) {
      if (retired) return originalEntries(value);
      const captured = hydrateOnboardingSpeciesTable(value);
      if (captured && Object.entries === wrappedEntries) Object.entries = originalEntries;
      return originalEntries(value);
    };
    wrappedEntries.__hobunjiNuhonganSpeciesCapture = true;
    Object.entries = wrappedEntries;
    if (typeof document !== 'undefined') document.addEventListener('hobunjiPlayerReady', () => {
      retired = true;
      if (Object.entries === wrappedEntries) Object.entries = originalEntries;
    }, { once: true });
    return true;
  }


  try {
    installAppearanceInheritance();
    installBehindHeadInheritance();
    installRigInheritance();
    installExtremityInheritance();
    installPoseOrbitInheritance();
    installArmMaskInheritance();
    installMouthInheritance();
    installMetalArmorInheritance();
    installNameInheritance();
    installConditionTaxonomy();
    installOnboardingSpeciesTableCapture();
  } catch (error) {
    status.lastError = String(error?.message || error);
    console.warn('[NuhonganSpecies] inheritance install failed:', error);
  }

  window.HobunjiNuhonganSpecies = Object.freeze({
    speciesId: ID,
    parentSpecies: DONOR,
    hydrateOnboardingSpeciesTable,
    debugSnapshot: () => ({
      ...clone(status),
      speciesId: ID,
      parentSpecies: DONOR,
      rigHeightMultiplier: 0.75,
      rigWidthMultiplier: 0.8,
      headScaleMultiplier: 1,
      inheritedMaleRig: !!window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${ID}::male`],
      inheritedFemaleRig: !!window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${ID}::female`],
      latestChange: 'Nuhongan remain a Slagothim/Tletingan child identity and inherit Tletingan cosmetics, hands, feet, rig anatomy, rear head, arm mask, mouth expressions, metal armor art, naming culture and weapon-pose orbit; only whole-body width/height differ.',
    }),
  });
})();
