// Porakaneki NPC-only species bridge.
//
// Porakaneki deliberately combines existing character systems instead of
// duplicating their authored data:
//   - Kenkari male body/wardrobe sprites and attachment rig.
//   - Mao-ao body-color ranges.
//   - Pachyderm hands and feline feet as explicit cross-species extremity donors.
//   - Slagothim/Tletingan male hair cosmetics.
//   - Porakaneki-specific head, rear-head, untinted-head, and torso portrait sprites.
(() => {
  'use strict';

  const SPECIES_ID = 'porakaneki'; // Used as the runtime/config key for every Porakaneki-specific override below.
  const BODY_SPECIES_ID = 'kenkari'; // Used whenever Porakaneki resolves inherited body, wardrobe, or rig data.
  const COLOR_SPECIES_ID = 'mao-ao'; // Used to inherit the full live Mao-ao body-color palette independently of the Kenkari body donor.
  const HAND_DONOR_SPECIES_ID = 'mashtzarr'; // Used to resolve the canonical pachyderm hand-model family without duplicating its GLB path.
  const FOOT_DONOR_SPECIES_ID = 'engh-sho'; // Used to clone the canonical feline procedural-foot config without duplicating its GLB/material data.
  const HAIR_SPECIES_ID = 'tletingan'; // Documents the cosmetic donor used by config/species/porakaneki.json for male hairstyles.
  const GENDERS = Object.freeze(['male']); // Used to keep the species male-only until authored female assets are intentionally added.
  const ALLOWED_COSMETIC_IDS = Object.freeze([ // Replaces the merged Kenkari allow-list after portrait cosmetics load so only Porakaneki hair plus bandolier/body-wrap clothing survive inheritance.
    'tl_forwardtuft_long',
    'tl_forwardtuft_short',
    'tl_longponytail',
    'tl_splayedknot',
    'tl_wildbeard',
    'tl_braid-L',
    'tl_braid-R',
    'tl_braidcluster-R',
    'bandolier1',
    'tankan_bodywrap',
  ]);
  const EXPECTED_ASSETS = Object.freeze({ // Exposed in mobile diagnostics so missing or mis-resolved authored art is immediately visible.
    head: 'fightersprites/kenkari-m/head_porakaneki_m.png',
    behindHead: 'fightersprites/special_cases/head-behind_porakaneki_m.png',
    headUntinted: 'fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki.png',
    headUntintedBlink: 'fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki_blink.png',
    torso: 'portraitsprites/torso_porakaneki_m.png',
    bodywrapMale: 'cosmetics/clothes/overwear/portrait/tankanbodywrap_kenk_m.png',
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
    colorSpecies: COLOR_SPECIES_ID,
    handDonorSpecies: HAND_DONOR_SPECIES_ID,
    footDonorSpecies: FOOT_DONOR_SPECIES_ID,
    hairSpecies: HAIR_SPECIES_ID,
    allowedCosmeticIds: [...ALLOWED_COSMETIC_IDS],
    expectedAssets: EXPECTED_ASSETS,
    appearanceConfigInstalled: false,
    behindHeadInstalled: false,
    rigProfilesInstalled: 0,
    rigConfigCorrectionsReapplied: false,
    handModelInherited: false,
    handModelKey: null,
    footModelInherited: false,
    footGlb: null,
    wardrobeResolverInstalled: false,
    paletteInheritanceInstalled: false,
    cosmeticRestrictionsApplied: 0,
    eyeDisksSuppressed: false,
    banditWardrobeGuardInstalled: false,
    genderGuardInstalled: false,
    correctedUnsupportedGenderCount: 0,
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

  function installBehindHeadSprite() {
    const headUrls = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.behindView?.headUrls; // Shared back-plane head registry consumed by portrait-utils._getBehindHeadUrl().
    if (!headUrls) return false;
    headUrls[SPECIES_ID] = {
      ...(headUrls[SPECIES_ID] || {}),
      male: EXPECTED_ASSETS.behindHead,
    };
    status.behindHeadInstalled = true;
    return true;
  }

  function installExtremityModels() {
    const handProfiles = window.HobunjiHandModelProfiles; // Shared hand-model registry used by held-action and attachment-rig systems.
    if (handProfiles?.mutate) {
      handProfiles.mutate(data => {
        data.speciesModels ||= {};
        const sourceModel = data.speciesModels[HAND_DONOR_SPECIES_ID]; // Mashtzarr is the canonical pachyderm-hand donor.
        if (sourceModel) data.speciesModels[SPECIES_ID] = sourceModel;
      });
      status.handModelKey = handProfiles.data?.speciesModels?.[SPECIES_ID] || null;
      status.handModelInherited = !!status.handModelKey;
    }

    const feet = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet; // Shared per-species foot GLB/material config.
    if (feet?.models?.[FOOT_DONOR_SPECIES_ID]) {
      feet.models[SPECIES_ID] = clone(feet.models[FOOT_DONOR_SPECIES_ID]);
      status.footGlb = feet.models[SPECIES_ID]?.glb || null;
      status.footModelInherited = true;
    }
    return status.handModelInherited || status.footModelInherited;
  }

  function installRigProfiles() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Shared attachment geometry used by hands, feet, posterior, shoulder pets, and scaling.
    if (!characters) return 0;
    let installed = 0;
    for (const gender of GENDERS) {
      const source = characters[`${BODY_SPECIES_ID}::${gender}`]; // Kenkari male remains the authored geometry/anchor source even though visible extremity meshes come from other donors.
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
      const inheritedFighter = { ...fighter, speciesId: BODY_SPECIES_ID }; // Preserves Porakaneki gender while selecting the matching Kenkari body/wardrobe variant; male bodywrap therefore resolves to tankanbodywrap_kenk_m.png.
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

  function inheritMaoAoBodyColors(cosmetics) {
    const ranges = cosmetics?.bodyColorRangesByGender; // Per-fighter body-color map consumed by randomPortraitProfileSeeded().
    if (!ranges) return 0;
    let inherited = 0;
    for (const gender of GENDERS) {
      const target = fighterFor(SPECIES_ID, gender); // Porakaneki receives the matching live Mao-ao body-color range object.
      const source = fighterFor(COLOR_SPECIES_ID, gender); // Mao-ao remains the canonical palette source while Kenkari still supplies body geometry.
      if (!target || !source || !ranges[source.id]) continue;
      ranges[target.id] = ranges[source.id];
      inherited += 1;
    }
    return inherited;
  }

  function applyCosmeticRestrictions(cosmetics) {
    const allowedByFighter = cosmetics?.allowedCosmeticsByFighter; // Final merged allow-list produced by portrait-utils; clamped here because parentSpecies otherwise re-adds Kenkari clothing and eye disks.
    const forcedByFighter = cosmetics?.forcedCosmeticsByFighter; // Final forced-slot map; Porakaneki explicitly overrides inherited Kenkari eye/headwear choices to none.
    let applied = 0;
    for (const gender of GENDERS) {
      const target = fighterFor(SPECIES_ID, gender); // Restriction target resolved from the live fighter registry so config-generated fighter ids stay authoritative.
      if (!target) continue;

      const allowedEntry = allowedByFighter?.[target.id]; // Existing object may carry future metadata in addition to its Set, so mutate the Set in place when possible.
      const allowedSet = allowedEntry?.set;
      if (allowedSet && typeof allowedSet.clear === 'function' && typeof allowedSet.add === 'function') {
        allowedSet.clear();
        for (const cosmeticId of ALLOWED_COSMETIC_IDS) allowedSet.add(cosmeticId);
      } else if (allowedByFighter) {
        allowedByFighter[target.id] = { ...(allowedEntry || {}), set: new Set(ALLOWED_COSMETIC_IDS) };
      }

      if (forcedByFighter) {
        forcedByFighter[target.id] = {
          ...(forcedByFighter[target.id] || {}),
          eyes: 'none',
          hat: 'none',
          hood: 'none',
        };
      }

      if (allowedByFighter || forcedByFighter) applied += 1;
    }
    status.cosmeticRestrictionsApplied = applied;
    status.eyeDisksSuppressed = applied > 0;
    return applied;
  }

  function restrictPorakanekiBanditConfig(config) {
    const speciesWeights = config?.speciesWeights; // Identifies calls that deliberately hard-force the shared bandit entity builder to Porakaneki.
    const activeSpecies = Object.entries(speciesWeights || {}).filter(([, weight]) => Number(weight) > 0).map(([speciesId]) => normalizeSpecies(speciesId)); // Used to avoid changing ordinary multi-species bandit generation.
    if (activeSpecies.length !== 1 || activeSpecies[0] !== SPECIES_ID) return config;
    const clothingPool = config?.clothingPool || {}; // Source bandit pool is copied so combat tuning remains shared while wardrobe rules become Porakaneki-specific.
    return {
      ...config,
      clothingPool: {
        ...clothingPool,
        slots: ['torso', 'overwear'],
        itemsBySlot: {
          ...(clothingPool.itemsBySlot || {}),
          torso: ['bandolier1'],
          overwear: ['tankan_bodywrap'],
          hat: [],
          hood: [],
        },
        banditExclusiveIds: [],
      },
    };
  }

  function installBanditWardrobeGuard(api = window.BanditCombat) {
    const baseMakeEntity = api?.makeEntity; // Shared bandit entity factory also used by Porakaneki camp hunters and the dev spawner.
    if (typeof baseMakeEntity !== 'function') return false;
    if (baseMakeEntity.__hobunjiPorakanekiWardrobeGuard) {
      status.banditWardrobeGuardInstalled = true;
      return true;
    }
    const wrapped = function makeEntityWithPorakanekiWardrobeGuard() {
      const args = [...arguments]; // Forwarded unchanged except for a Porakaneki-only config copy in argument zero.
      args[0] = restrictPorakanekiBanditConfig(args[0]);
      return baseMakeEntity.apply(this, args);
    };
    wrapped.__hobunjiPorakanekiWardrobeGuard = true;
    wrapped.__hobunjiPorakanekiWardrobeOriginal = baseMakeEntity;
    api.makeEntity = wrapped;
    status.banditWardrobeGuardInstalled = true;
    return true;
  }

  function installGenderGuard(api = window.NpcAvatarPreview) {
    const baseBuildProfile = api?.buildProfileFromNpcExport; // Shared NPC-export profile builder used by the bandit avatar path after its species/gender roll.
    if (typeof baseBuildProfile !== 'function') return false;
    if (baseBuildProfile.__hobunjiPorakanekiGenderGuard) {
      status.genderGuardInstalled = true;
      return true;
    }
    const wrapped = function buildProfileWithPorakanekiGenderGuard(exportData) {
      const appearance = exportData?.appearance; // Mutated in place so the originating bandit roster, procedural limbs, corpse data, and debug record all agree on the corrected gender.
      const requestedGender = String(appearance?.gender || '').trim().toLowerCase(); // Used to reject any shared-generator result for which Porakaneki has no authored art.
      if (normalizeSpecies(appearance?.speciesId) === SPECIES_ID && !GENDERS.includes(requestedGender)) {
        appearance.gender = GENDERS[0];
        status.correctedUnsupportedGenderCount += 1;
        window.__farmLog?.(`[porakaneki] corrected unsupported gender "${requestedGender || 'unset'}" to ${GENDERS[0]} before portrait generation.`, 'wildlife');
      }
      return baseBuildProfile.apply(this, arguments);
    };
    wrapped.__hobunjiPorakanekiGenderGuard = true;
    wrapped.__hobunjiPorakanekiGenderGuardOriginal = baseBuildProfile;
    api.buildProfileFromNpcExport = wrapped;
    status.genderGuardInstalled = true;
    return true;
  }

  function installPaletteInheritance() {
    const baseLoad = window.loadPortraitCosmetics; // Shared async species/cosmetics loader; wrapping keeps the palette source live and clamps inherited cosmetics after its merge step.
    if (typeof baseLoad !== 'function') return false;
    if (baseLoad.__hobunjiPorakanekiPaletteInheritance) {
      status.paletteInheritanceInstalled = true;
      return true;
    }
    const wrapped = async function loadPortraitCosmeticsWithPorakanekiOverrides() {
      const cosmetics = await baseLoad.apply(this, arguments);
      inheritMaoAoBodyColors(cosmetics);
      applyCosmeticRestrictions(cosmetics);
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
    installBehindHeadSprite();
    installExtremityModels();
    installRigProfiles();
    installWardrobeResolver();
    installBanditWardrobeGuard();
    installGenderGuard();
    installPaletteInheritance();
    installArmMaskProfiles();
    return debugSnapshot();
  }

  function debugSnapshot() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Queried live so in-game debug can reveal missing bootstrap state.
    return {
      ...status,
      rigProfilesPresent: Object.fromEntries(GENDERS.map(gender => [gender, !!characters[`${SPECIES_ID}::${gender}`]])),
      allowedCosmeticIds: [...ALLOWED_COSMETIC_IDS],
      expectedAssets: { ...EXPECTED_ASSETS },
    };
  }

  window.HobunjiPorakanekiSpecies = Object.freeze({
    speciesId: SPECIES_ID,
    bodySpeciesId: BODY_SPECIES_ID,
    colorSpeciesId: COLOR_SPECIES_ID,
    handDonorSpeciesId: HAND_DONOR_SPECIES_ID,
    footDonorSpeciesId: FOOT_DONOR_SPECIES_ID,
    hairSpeciesId: HAIR_SPECIES_ID,
    allowedCosmeticIds: ALLOWED_COSMETIC_IDS,
    expectedAssets: EXPECTED_ASSETS,
    install,
    installBehindHeadSprite,
    inheritMaoAoBodyColors,
    applyCosmeticRestrictions,
    restrictPorakanekiBanditConfig,
    installBanditWardrobeGuard,
    installGenderGuard,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot();
      return `Porakaneki: npcOnly=${d.npcOnly} genders=${d.genders.join(',')} rig=${d.rigProfilesInstalled}/1 hand=${d.handModelKey || '-'}(${d.handDonorSpecies}) foot=${d.footGlb || '-'}(${d.footDonorSpecies}) paletteHook=${d.paletteInheritanceInstalled} colorSource=${d.colorSpecies} wardrobeHook=${d.wardrobeResolverInstalled} banditWardrobeGuard=${d.banditWardrobeGuardInstalled} genderGuard=${d.genderGuardInstalled} genderCorrections=${d.correctedUnsupportedGenderCount} cosmeticClamp=${d.cosmeticRestrictionsApplied}/1 eyeDisksSuppressed=${d.eyeDisksSuppressed} allowed=${d.allowedCosmeticIds.join(',')} armMask=${d.armMaskProfilesInstalled}/1 rearHead=${d.behindHeadInstalled ? d.expectedAssets.behindHead : '-'} bodywrap=${d.expectedAssets.bodywrapMale} head=${d.expectedAssets.head} torso=${d.expectedAssets.torso}`;
    },
  });

  install();
  if ((!status.banditWardrobeGuardInstalled || !status.genderGuardInstalled) && typeof window.addEventListener === 'function') {
    window.addEventListener('load', () => {
      if (!status.banditWardrobeGuardInstalled) installBanditWardrobeGuard();
      if (!status.genderGuardInstalled) installGenderGuard();
    }, { once: true });
  }
})();
