// Porakaneki NPC-only species bridge.
//
// Porakaneki deliberately combines existing character systems instead of
// duplicating their authored data:
//   - Kenkari male body/wardrobe sprites, hands/feet, attachment rig, and body colors.
//   - Slagothim/Tletingan male hair cosmetics.
//   - Porakaneki-specific head, untinted-head, and torso portrait sprites.
(() => {
  'use strict';

  const SPECIES_ID = 'porakaneki'; // Used as the runtime/config key for every Porakaneki-specific override below.
  const BODY_SPECIES_ID = 'kenkari'; // Used whenever Porakaneki resolves inherited body, wardrobe, extremity, rig, or palette data.
  const HAIR_SPECIES_ID = 'tletingan'; // Documents the cosmetic donor used by config/species/porakaneki.json for male hairstyles.
  const GENDERS = Object.freeze(['male']); // Used to keep the species male-only until authored female assets are intentionally added.
  const EXPECTED_ASSETS = Object.freeze({ // Exposed in mobile diagnostics so missing authored art is immediately visible.
    head: 'fightersprites/kenkari-m/head_porakaneki_m.png',
    headUntinted: 'fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki.png',
    headUntintedBlink: 'fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki_blink.png',
    torso: 'portraitsprites/torso_porakaneki_m.png',
  });
  const KENKARI_ARM_MASK_SETTINGS = Object.freeze({ // Mirrors the canonical Kenkari male authored arm-cloud cutout profile.
    maskYScaleMultiplier: 1.14,
    axOffset: 0.45,
    cutThreshold: 0.56,
    wobbleStrength: 0.16,
    wobbleScale: 1,
    outlineWidth: 2,
    seed: 28480,
  });

  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  const status = { // Updated by installers and surfaced through HobunjiPorakanekiSpecies.debugSnapshot() for mobile debugging.
    speciesId: SPECIES_ID,
    npcOnly: true,
    playerSelectable: false,
    genders: [...GENDERS],
    bodySpecies: BODY_SPECIES_ID,
    hairSpecies: HAIR_SPECIES_ID,
    expectedAssets: EXPECTED_ASSETS,
    appearanceConfigInstalled: false,
    rigProfilesInstalled: 0,
    rigConfigCorrectionsReapplied: false,
    handModelInherited: false,
    footModelInherited: false,
    wardrobeResolverInstalled: false,
    paletteInheritanceInstalled: false,
    armMaskProfilesInstalled: 0,
  };

  function installAppearanceSpeciesConfig() {
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species; // Runtime registry consumed by NPC/player species selectors.
    if (!speciesConfig) return false;
    speciesConfig[SPECIES_ID] = {
      label: 'Porakaneki',
      parentSpecies: BODY_SPECIES_ID,
      genders: [...GENDERS],
      npcOnly: true,
      playerSelectable: false,
    };
    status.appearanceConfigInstalled = true;
    return true;
  }

  function installExtremityModels() {
    const handProfiles = window.HobunjiHandModelProfiles; // Shared hand-model registry used by held-action and attachment-rig systems.
    if (handProfiles?.mutate) {
      handProfiles.mutate(data => {
        data.speciesModels ||= {};
        const sourceModel = data.speciesModels[BODY_SPECIES_ID]; // Reuses Kenkari's live model mapping instead of hardcoding its GLB family.
        if (sourceModel) data.speciesModels[SPECIES_ID] = sourceModel;
      });
      status.handModelInherited = !!handProfiles.data?.speciesModels?.[SPECIES_ID];
    }

    const feet = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet; // Shared per-species foot GLB/material config.
    if (feet?.models?.[BODY_SPECIES_ID]) {
      feet.models[SPECIES_ID] = clone(feet.models[BODY_SPECIES_ID]);
      status.footModelInherited = true;
    }
    return status.handModelInherited || status.footModelInherited;
  }

  function installRigProfiles() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Shared attachment geometry used by hands, feet, posterior, shoulder pets, and scaling.
    if (!characters) return 0;
    let installed = 0;
    for (const gender of GENDERS) {
      const source = characters[`${BODY_SPECIES_ID}::${gender}`]; // Kenkari male is the authored geometry/anchor source.
      if (!source) continue;
      const profile = clone(source); // Independent copy prevents future Porakaneki edits from mutating Kenkari.
      profile.species = SPECIES_ID;
      profile.gender = gender;
      if (profile.shoulderPerchRule?.appearanceSpeciesId) profile.shoulderPerchRule.appearanceSpeciesId = SPECIES_ID;
      if (profile.posteriorRule?.appearanceSpeciesId) profile.posteriorRule.appearanceSpeciesId = SPECIES_ID;
      characters[`${SPECIES_ID}::${gender}`] = profile;
      installed += 1;
    }
    status.rigProfilesInstalled = installed;
    if (installed && typeof window.applyHobunjiAttachmentRigProfileCorrections === 'function') {
      status.rigConfigCorrectionsReapplied = !!window.applyHobunjiAttachmentRigProfileCorrections();
    }
    return installed;
  }

  function installWardrobeResolver() {
    const baseResolve = window.resolveOptionLayers; // Existing resolver remains authoritative for every non-Porakaneki fighter.
    if (typeof baseResolve !== 'function') return false;
    if (baseResolve.__hobunjiPorakanekiWardrobeInheritance) {
      status.wardrobeResolverInstalled = true;
      return true;
    }
    const wrapped = function resolvePorakanekiWardrobeLayers(option, fighter) {
      if (normalizeSpecies(fighter?.speciesId) !== SPECIES_ID) return baseResolve.apply(this, arguments);
      const inheritedFighter = { ...fighter, speciesId: BODY_SPECIES_ID }; // Clothing/body variants resolve through Kenkari while direct Tletingan hair layer URLs remain authored by their cosmetic records.
      return baseResolve.call(this, option, inheritedFighter);
    };
    wrapped.__hobunjiPorakanekiWardrobeInheritance = true;
    wrapped.__hobunjiPorakanekiWardrobeOriginal = baseResolve;
    window.resolveOptionLayers = wrapped;
    status.wardrobeResolverInstalled = true;
    return true;
  }

  function fighterFor(speciesId, gender) {
    const fighters = window.getPortraitFighters?.() || []; // Live registry populated from config/species/index.json by loadPortraitCosmetics().
    const normalizedSpecies = normalizeSpecies(speciesId);
    return fighters.find(fighter => normalizeSpecies(fighter?.speciesId) === normalizedSpecies && String(fighter?.gender || '').toLowerCase() === gender) || null;
  }

  function inheritKenkariBodyColors(cosmetics) {
    const ranges = cosmetics?.bodyColorRangesByGender; // Per-fighter body-color map consumed by randomPortraitProfileSeeded().
    if (!ranges) return 0;
    let inherited = 0;
    for (const gender of GENDERS) {
      const target = fighterFor(SPECIES_ID, gender); // Porakaneki receives the matching live Kenkari body-color range object.
      const source = fighterFor(BODY_SPECIES_ID, gender); // Kenkari remains the canonical palette source.
      if (!target || !source || !ranges[source.id]) continue;
      ranges[target.id] = ranges[source.id];
      inherited += 1;
    }
    return inherited;
  }

  function installPaletteInheritance() {
    const baseLoad = window.loadPortraitCosmetics; // Shared async species/cosmetics loader; wrapping keeps the palette source live.
    if (typeof baseLoad !== 'function') return false;
    if (baseLoad.__hobunjiPorakanekiPaletteInheritance) {
      status.paletteInheritanceInstalled = true;
      return true;
    }
    const wrapped = async function loadPortraitCosmeticsWithPorakanekiPalette() {
      const cosmetics = await baseLoad.apply(this, arguments);
      inheritKenkariBodyColors(cosmetics);
      return cosmetics;
    };
    wrapped.__hobunjiPorakanekiPaletteInheritance = true;
    wrapped.__hobunjiPorakanekiPaletteOriginal = baseLoad;
    window.loadPortraitCosmetics = wrapped;
    status.paletteInheritanceInstalled = true;
    return true;
  }

  function installArmMaskProfiles() {
    const portraitConfig = window.SCRATCHBONES_CONFIG?.game?.portrait; // Existing arm-only opacity-mask config read by portrait-arm-cloud-mask.js.
    if (!portraitConfig) return 0;
    portraitConfig.armOnlyOpacityMask ||= {};
    portraitConfig.armOnlyOpacityMask.profiles ||= {};
    portraitConfig.armOnlyOpacityMask.profiles[`${SPECIES_ID}:male`] = { ...KENKARI_ARM_MASK_SETTINGS };
    status.armMaskProfilesInstalled = 1;
    return 1;
  }

  function install() {
    installAppearanceSpeciesConfig();
    installExtremityModels();
    installRigProfiles();
    installWardrobeResolver();
    installPaletteInheritance();
    installArmMaskProfiles();
    return debugSnapshot();
  }

  function debugSnapshot() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Queried live so in-game debug can reveal missing bootstrap state.
    return {
      ...status,
      rigProfilesPresent: Object.fromEntries(GENDERS.map(gender => [gender, !!characters[`${SPECIES_ID}::${gender}`]])),
      expectedAssets: { ...EXPECTED_ASSETS },
    };
  }

  window.HobunjiPorakanekiSpecies = Object.freeze({
    speciesId: SPECIES_ID,
    bodySpeciesId: BODY_SPECIES_ID,
    hairSpeciesId: HAIR_SPECIES_ID,
    expectedAssets: EXPECTED_ASSETS,
    install,
    inheritKenkariBodyColors,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      return `Porakaneki: npcOnly=${d.npcOnly} genders=${d.genders.join(',')} rig=${d.rigProfilesInstalled}/1 hands=${d.handModelInherited} feet=${d.footModelInherited} paletteHook=${d.paletteInheritanceInstalled} wardrobeHook=${d.wardrobeResolverInstalled} armMask=${d.armMaskProfilesInstalled}/1 head=${d.expectedAssets.head} torso=${d.expectedAssets.torso}`;
    },
  });

  install();
})();
