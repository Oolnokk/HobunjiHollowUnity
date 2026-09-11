// Harlyao NPC-only species bridge.
//
// Harlyao deliberately combines three existing character systems instead of
// duplicating their authored data:
//   - Engh-sho body/wardrobe sprites, hands/feet, and attachment-rig coordinates.
//   - Mao-ao body-color ranges.
//   - Harlyao-specific head sprites, authored separately under the Engh-sho
//     fighter directories (matching the existing Ghoul special-head pattern).
(() => {
  'use strict';

  const SPECIES_ID = 'harlyao'; // Used as the runtime/config key for every Harlyao-specific override below.
  const BODY_SPECIES_ID = 'engh-sho'; // Used whenever Harlyao must resolve Engh-sho-authored body, wardrobe, extremity, or rig data.
  const COLOR_SPECIES_ID = 'mao-ao'; // Used to inherit the live Mao-ao body-color ranges after species configs load.
  const GENDERS = Object.freeze(['male', 'female']); // Used to install both NPC gender variants without duplicating bridge logic.
  const EXPECTED_HEAD_SPRITES = Object.freeze({ // Exposed in mobile diagnostics so missing not-yet-authored head art is obvious.
    male: 'fightersprites/engh-sho-m/head_harlyao_m.png',
    female: 'fightersprites/engh-sho-f/head_harlyao_f.png',
  });
  const ENGH_ARM_MASK_SETTINGS = Object.freeze({ // Mirrors the existing Engh-sho authored arm-cloud cutout profiles.
    male: Object.freeze({ maskYScaleMultiplier: 1.04, axOffset: -0.07, cutThreshold: 0.18, wobbleStrength: 0.16, wobbleScale: 1, outlineWidth: 4, seed: 28480 }),
    female: Object.freeze({ maskYScaleMultiplier: 1.15, axOffset: 0.195, cutThreshold: 0.78, wobbleStrength: 0.16, wobbleScale: 1, outlineWidth: 2, seed: 28480 }),
  });

  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  const status = { // Updated by each installer and surfaced through HobunjiHarlyaoSpecies.debugSnapshot() for mobile debugging.
    speciesId: SPECIES_ID,
    npcOnly: true,
    playerSelectable: false,
    bodySpecies: BODY_SPECIES_ID,
    colorSpecies: COLOR_SPECIES_ID,
    scaleMultiplier: 1.2,
    expectedHeadSprites: EXPECTED_HEAD_SPRITES,
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
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species; // Runtime appearance registry consumed by NPC/player species selectors.
    if (!speciesConfig) return false;
    speciesConfig[SPECIES_ID] = {
      label: 'Harlyao',
      parentSpecies: BODY_SPECIES_ID,
      genders: [...GENDERS],
      npcOnly: true,
      playerSelectable: false,
    };
    status.appearanceConfigInstalled = true;
    return true;
  }

  function installExtremityModels() {
    const handProfiles = window.HobunjiHandModelProfiles; // Shared hand-model registry loaded before the attachment-rig bootstrap in held-action-animations.js.
    if (handProfiles?.mutate) {
      handProfiles.mutate(data => {
        data.speciesModels ||= {};
        const sourceModel = data.speciesModels[BODY_SPECIES_ID]; // Engh-sho currently maps to the feline hand GLB; copy the mapping instead of hardcoding the model key.
        if (sourceModel) data.speciesModels[SPECIES_ID] = sourceModel;
      });
      status.handModelInherited = !!handProfiles.data?.speciesModels?.[SPECIES_ID];
    }

    const feet = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet; // Shared procedural-foot config supplies per-species GLBs and material roles.
    if (feet?.models?.[BODY_SPECIES_ID]) {
      feet.models[SPECIES_ID] = clone(feet.models[BODY_SPECIES_ID]);
      status.footModelInherited = true;
    }
    return status.handModelInherited || status.footModelInherited;
  }

  function removeInheritedWholeRigScale(profile) {
    const anatomy = profile?.anatomy; // Engh-sho anatomy is retained except for whole-rig factors, which must resolve to Harlyao's explicit 1.2x defaults.
    if (!anatomy) return;
    delete anatomy.rigScale;
    delete anatomy.rigScaleX;
    delete anatomy.rigScaleY;
    delete anatomy.headScale;
    delete anatomy.headOffsetY;
  }

  function installRigProfiles() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Shared attachment-rig library used by hands, feet, posterior, shoulder pets, and whole-character scaling.
    if (!characters) return 0;
    let installed = 0;
    for (const gender of GENDERS) {
      const source = characters[`${BODY_SPECIES_ID}::${gender}`]; // Engh-sho is the authored geometry/anchor source for this Harlyao gender.
      if (!source) continue;
      const profile = clone(source); // Independent copy prevents Harlyao scale edits from mutating the canonical Engh-sho profile.
      profile.species = SPECIES_ID;
      profile.gender = gender;
      if (profile.shoulderPerchRule?.appearanceSpeciesId) profile.shoulderPerchRule.appearanceSpeciesId = SPECIES_ID;
      if (profile.posteriorRule?.appearanceSpeciesId) profile.posteriorRule.appearanceSpeciesId = SPECIES_ID;
      removeInheritedWholeRigScale(profile);
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
    const baseResolve = window.resolveOptionLayers; // Existing portrait option resolver remains authoritative for every non-Harlyao fighter.
    if (typeof baseResolve !== 'function') return false;
    if (baseResolve.__hobunjiHarlyaoWardrobeInheritance) {
      status.wardrobeResolverInstalled = true;
      return true;
    }
    const wrapped = function resolveHarlyaoWardrobeLayers(option, fighter) {
      if (normalizeSpecies(fighter?.speciesId) !== SPECIES_ID) return baseResolve.apply(this, arguments);
      const inheritedFighter = { ...fighter, speciesId: BODY_SPECIES_ID }; // Makes every clothing variant lookup use the matching Engh-sho male/female sprite set.
      return baseResolve.call(this, option, inheritedFighter);
    };
    wrapped.__hobunjiHarlyaoWardrobeInheritance = true;
    wrapped.__hobunjiHarlyaoWardrobeOriginal = baseResolve;
    window.resolveOptionLayers = wrapped;
    status.wardrobeResolverInstalled = true;
    return true;
  }

  function fighterFor(speciesId, gender) {
    const fighters = window.getPortraitFighters?.() || []; // Live fighter registry populated from config/species/index.json by loadPortraitCosmetics().
    const normalizedSpecies = normalizeSpecies(speciesId);
    return fighters.find(fighter => normalizeSpecies(fighter?.speciesId) === normalizedSpecies && String(fighter?.gender || '').toLowerCase() === gender) || null;
  }

  function inheritMaoAoBodyColors(cosmetics) {
    const ranges = cosmetics?.bodyColorRangesByGender; // Per-fighter body-color map consumed by randomPortraitProfileSeeded().
    if (!ranges) return 0;
    let inherited = 0;
    for (const gender of GENDERS) {
      const target = fighterFor(SPECIES_ID, gender); // Harlyao fighter receives the source gender's Mao-ao body-color range object.
      const source = fighterFor(COLOR_SPECIES_ID, gender); // Mao-ao fighter supplies the canonical live palette rather than a copied snapshot.
      if (!target || !source || !ranges[source.id]) continue;
      ranges[target.id] = ranges[source.id];
      inherited += 1;
    }
    return inherited;
  }

  function installPaletteInheritance() {
    const baseLoad = window.loadPortraitCosmetics; // Shared async species/cosmetics loader; wrapping once keeps every caller on the same source of truth.
    if (typeof baseLoad !== 'function') return false;
    if (baseLoad.__hobunjiHarlyaoPaletteInheritance) {
      status.paletteInheritanceInstalled = true;
      return true;
    }
    const wrapped = async function loadPortraitCosmeticsWithHarlyaoPalette() {
      const cosmetics = await baseLoad.apply(this, arguments);
      inheritMaoAoBodyColors(cosmetics);
      return cosmetics;
    };
    wrapped.__hobunjiHarlyaoPaletteInheritance = true;
    wrapped.__hobunjiHarlyaoPaletteOriginal = baseLoad;
    window.loadPortraitCosmetics = wrapped;
    status.paletteInheritanceInstalled = true;
    return true;
  }

  function installArmMaskProfiles() {
    const portraitConfig = window.SCRATCHBONES_CONFIG?.game?.portrait; // Existing arm-only opacity-mask config read by portrait-arm-cloud-mask.js at render time.
    if (!portraitConfig) return 0;
    portraitConfig.armOnlyOpacityMask ||= {};
    portraitConfig.armOnlyOpacityMask.profiles ||= {};
    let installed = 0;
    for (const gender of GENDERS) {
      portraitConfig.armOnlyOpacityMask.profiles[`${SPECIES_ID}:${gender}`] = { ...ENGH_ARM_MASK_SETTINGS[gender] };
      installed += 1;
    }
    status.armMaskProfilesInstalled = installed;
    return installed;
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
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Checked live so Pixel Probe/debug UI can reveal stale bootstrap ordering or missing profiles.
    const scales = window.HobunjiCharacterRigScaleDefaults; // May load immediately after this bridge; queried lazily rather than captured during installation.
    return {
      ...status,
      rigProfilesPresent: Object.fromEntries(GENDERS.map(gender => [gender, !!characters[`${SPECIES_ID}::${gender}`]])),
      resolvedScaleDefaults: Object.fromEntries(GENDERS.map(gender => [gender, scales?.scaleFor?.(SPECIES_ID, gender) || null])),
      expectedHeadSprites: { ...EXPECTED_HEAD_SPRITES },
    };
  }

  window.HobunjiHarlyaoSpecies = Object.freeze({
    speciesId: SPECIES_ID,
    bodySpeciesId: BODY_SPECIES_ID,
    colorSpeciesId: COLOR_SPECIES_ID,
    expectedHeadSprites: EXPECTED_HEAD_SPRITES,
    install,
    inheritMaoAoBodyColors,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      return `Harlyao: npcOnly=${d.npcOnly} rig=${d.rigProfilesInstalled}/2 hands=${d.handModelInherited} feet=${d.footModelInherited} paletteHook=${d.paletteInheritanceInstalled} wardrobeHook=${d.wardrobeResolverInstalled} armMask=${d.armMaskProfilesInstalled}/2 scale=${d.scaleMultiplier} heads=${d.expectedHeadSprites.male},${d.expectedHeadSprites.female}`;
    },
  });

  install();
})();
