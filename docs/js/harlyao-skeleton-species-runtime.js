// Harlyao Skeleton NPC-only species bridge.
//
// Harlyao Skeleton reuses Engh-sho/Harlyao character infrastructure while
// keeping its authored skeleton pixels and appearance restrictions distinct:
//   - Engh-sho wardrobe variants, feline hands/feet, attachment rig, and arm mask.
//   - Harlyao's 1.2x Engh-sho whole-character scale via the shared scale alias.
//   - Fixed #D4D6C9 procedural extremity color with no randomized body palette.
//   - Skeleton-specific front/rear heads and body sprites, with no ur-head/eyes.
//   - Female structural hair rendered in the existing pauldron layer slot.
(() => {
  'use strict';

  const SPECIES_ID = 'harlyao-skeleton'; // Runtime/config key used by every skeleton-specific override below.
  const BODY_SPECIES_ID = 'engh-sho'; // Canonical donor for wardrobe variants, rig coordinates, and feline extremity meshes.
  const EXTREMITY_COLOR = '#D4D6C9'; // Fixed A/B/C descriptor consumed by procedural hand/foot body-material paths.
  const GENDERS = Object.freeze(['male', 'female']); // Both authored skeleton gender variants are installed together.
  const ALLOWED_CLOTHING_IDS = Object.freeze(['fine_hood', 'tankan_tunic', 'bandolier1', 'tankan_bodywrap', 'rugged_poncho', 'fine_poncho']); // Broad species-level clothing support survives while Minion randomization itself is restricted to bodywrap/poncho/bandolier.
  const FORCED_EMPTY_SLOTS = Object.freeze(['eyes', 'upperFace', 'facialHair', 'hairFront', 'hairBack', 'hairSide', 'hairSideL', 'hat']); // Appearance-only slots are always empty for skeletons.
  const EXPECTED_ASSETS = Object.freeze({ // Exposed through mobile diagnostics so a bad asset path is visible without devtools.
    maleHead: 'fightersprites/engh-sho-m/head_hskel_m.png',
    femaleHead: 'fightersprites/engh-sho-f/head_hskel_f.png',
    maleBehindHead: 'fightersprites/special_cases/head-behind_hskel_m.png',
    femaleBehindHead: 'fightersprites/special_cases/head-behind_hskel_f.png',
    maleTorso: 'portraitsprites/torso_hskel_m.png',
    femaleTorso: 'portraitsprites/torso_hskel_f.png',
    femalePauldronHair: 'cosmetics/appearance/harlyao_skeleton/hairdefault-right_hskel_f.png',
  });
  const ENGH_ARM_MASK_SETTINGS = Object.freeze({ // Mirrors the existing Engh-sho authored arm-cloud cutout profiles.
    male: Object.freeze({ maskYScaleMultiplier: 1.04, axOffset: -0.07, cutThreshold: 0.18, wobbleStrength: 0.16, wobbleScale: 1, outlineWidth: 4, seed: 28480 }),
    female: Object.freeze({ maskYScaleMultiplier: 1.15, axOffset: 0.195, cutThreshold: 0.78, wobbleStrength: 0.16, wobbleScale: 1, outlineWidth: 2, seed: 28480 }),
  });

  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  const status = { // Mutable installation state copied into debugSnapshot() for mobile-friendly verification.
    speciesId: SPECIES_ID,
    npcOnly: true,
    playerSelectable: false,
    bodySpecies: BODY_SPECIES_ID,
    extremityColor: EXTREMITY_COLOR,
    scaleMultiplier: 1.2,
    appearanceConfigInstalled: false,
    behindHeadsInstalled: 0,
    rigProfilesInstalled: 0,
    rigConfigCorrectionsReapplied: false,
    handModelInherited: false,
    handModelKey: null,
    footModelInherited: false,
    footGlb: null,
    wardrobeResolverInstalled: false,
    cosmeticRestrictionsInstalled: false,
    cosmeticRestrictionsApplied: 0,
    fixedColorProfilesApplied: 0,
    profileColorGuardInstalled: false,
    profileColorCorrections: 0,
    armMaskProfilesInstalled: 0,
  };

  function installAppearanceSpeciesConfig() {
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species; // Runtime registry consumed by avatar/NPC species resolution.
    if (!speciesConfig) return false;
    speciesConfig[SPECIES_ID] = {
      label: 'Harlyao Skeleton',
      parentSpecies: BODY_SPECIES_ID,
      genders: [...GENDERS],
      npcOnly: true,
      playerSelectable: false,
    };
    status.appearanceConfigInstalled = true;
    return true;
  }

  function installBehindHeadSprites() {
    const headUrls = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.behindView?.headUrls; // Canonical rear-head lookup used by portrait and runtime avatar behind views.
    if (!headUrls) return 0;
    headUrls[SPECIES_ID] = {
      male: EXPECTED_ASSETS.maleBehindHead,
      female: EXPECTED_ASSETS.femaleBehindHead,
    };
    status.behindHeadsInstalled = 2;
    return 2;
  }

  function installExtremityModels() {
    const handProfiles = window.HobunjiHandModelProfiles; // Shared hand model registry; Engh-sho currently resolves to the feline GLB.
    if (handProfiles?.mutate) {
      handProfiles.mutate(data => {
        data.speciesModels ||= {};
        const sourceModel = data.speciesModels[BODY_SPECIES_ID] || 'feline'; // Explicit feline fallback preserves the authored skeleton contract if Engh-sho mapping loads late.
        data.speciesModels[SPECIES_ID] = sourceModel;
      });
      status.handModelKey = handProfiles.data?.speciesModels?.[SPECIES_ID] || null;
      status.handModelInherited = status.handModelKey === 'feline' || !!status.handModelKey;
    }

    const feet = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet; // Shared procedural-foot config stores the live model table under species (older tests used models).
    const footModels = feet?.species || feet?.models; // Compatibility alias keeps tools/tests that still expose the old table name working.
    if (footModels?.[BODY_SPECIES_ID]) {
      footModels[SPECIES_ID] = clone(footModels[BODY_SPECIES_ID]);
      status.footGlb = footModels[SPECIES_ID]?.glb || null;
      status.footModelInherited = true;
    }
    return status.handModelInherited || status.footModelInherited;
  }

  function removeInheritedWholeRigScale(profile) {
    const anatomy = profile?.anatomy; // Engh-sho anchors remain authoritative, while whole-rig factors resolve through the Harlyao Skeleton scale alias.
    if (!anatomy) return;
    delete anatomy.rigScale;
    delete anatomy.rigScaleX;
    delete anatomy.rigScaleY;
    delete anatomy.headScale;
    delete anatomy.headOffsetY;
  }

  function installRigProfiles() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Shared attachment geometry used by hands, feet, posterior, shoulder pets, and scale runtime.
    if (!characters) return 0;
    let installed = 0; // Counts successful male/female Engh-sho profile clones for diagnostics.
    for (const gender of GENDERS) {
      const source = characters[`${BODY_SPECIES_ID}::${gender}`]; // Matching-gender Engh-sho rig is the geometry source.
      if (!source) continue;
      const profile = clone(source); // Independent copy prevents skeleton adjustments from mutating Engh-sho.
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
    const baseResolve = window.resolveOptionLayers; // Existing resolver stays authoritative outside Harlyao Skeleton wardrobe lookups.
    if (typeof baseResolve !== 'function') return false;
    if (baseResolve.__hobunjiHarlyaoSkeletonWardrobeInheritance) {
      status.wardrobeResolverInstalled = true;
      return true;
    }
    const wrapped = function resolveHarlyaoSkeletonWardrobeLayers(option, fighter) {
      if (normalizeSpecies(fighter?.speciesId) !== SPECIES_ID) return baseResolve.apply(this, arguments);
      const inheritedFighter = { ...fighter, speciesId: BODY_SPECIES_ID }; // Clothing art resolves through matching-gender Engh-sho variants only.
      return baseResolve.call(this, option, inheritedFighter);
    };
    wrapped.__hobunjiHarlyaoSkeletonWardrobeInheritance = true;
    wrapped.__hobunjiHarlyaoSkeletonWardrobeOriginal = baseResolve;
    window.resolveOptionLayers = wrapped;
    status.wardrobeResolverInstalled = true;
    return true;
  }

  function fighterFor(gender) {
    const fighters = window.getPortraitFighters?.() || []; // Live registry populated by loadPortraitCosmetics() from config/species/index.json.
    return fighters.find(fighter => normalizeSpecies(fighter?.speciesId) === SPECIES_ID && String(fighter?.gender || '').toLowerCase() === gender) || null;
  }

  function applyCosmeticRestrictions(cosmetics) {
    const allowedByFighter = cosmetics?.allowedCosmeticsByFighter; // Final merged allow-lists are clamped because parent Engh-sho appearance entries would otherwise merge back in.
    const forcedByFighter = cosmetics?.forcedCosmeticsByFighter; // Forced none values keep every appearance-only slot empty during deterministic/random NPC profile generation.
    const ranges = cosmetics?.bodyColorRangesByGender; // Fixed hex is retained solely so procedural feline hands/feet resolve the requested bone color.
    let applied = 0; // Number of live skeleton fighter records successfully restricted.
    let fixedColors = 0; // Number of live skeleton fighter records given the fixed extremity descriptor.
    for (const gender of GENDERS) {
      const target = fighterFor(gender); // Gender-specific live fighter record used as the cosmetics-map key.
      if (!target) continue;

      const allowedEntry = allowedByFighter?.[target.id]; // Preserve any future metadata stored beside the mutable Set.
      const allowedSet = allowedEntry?.set;
      if (allowedSet && typeof allowedSet.clear === 'function' && typeof allowedSet.add === 'function') {
        allowedSet.clear();
        for (const cosmeticId of ALLOWED_CLOTHING_IDS) allowedSet.add(cosmeticId);
      } else if (allowedByFighter) {
        allowedByFighter[target.id] = { ...(allowedEntry || {}), set: new Set(ALLOWED_CLOTHING_IDS) };
      }

      if (forcedByFighter) {
        const forced = { ...(forcedByFighter[target.id] || {}) }; // Slot map remains independently mutable for callers that adjust clothing after generation.
        for (const slot of FORCED_EMPTY_SLOTS) forced[slot] = 'none';
        forcedByFighter[target.id] = forced;
      }

      if (ranges) {
        ranges[target.id] = { fixedHex: EXTREMITY_COLOR };
        fixedColors += 1;
      }
      if (allowedByFighter || forcedByFighter) applied += 1;
    }
    status.cosmeticRestrictionsApplied = applied;
    status.fixedColorProfilesApplied = fixedColors;
    return applied;
  }

  function fixedBodyColors() {
    return {
      A: { hex: EXTREMITY_COLOR },
      B: { hex: EXTREMITY_COLOR },
      C: { hex: EXTREMITY_COLOR },
    };
  }

  function installProfileColorGuard(api = window.NpcAvatarPreview) {
    const baseBuildProfile = api?.buildProfileFromNpcExport; // Shared authored-NPC profile path can otherwise reapply arbitrary exported body colors after species defaults resolve.
    if (typeof baseBuildProfile !== 'function') return false;
    if (baseBuildProfile.__hobunjiHarlyaoSkeletonColorGuard) {
      status.profileColorGuardInstalled = true;
      return true;
    }
    const wrapped = function buildProfileWithHarlyaoSkeletonFixedColor(exportData) {
      const profile = baseBuildProfile.apply(this, arguments); // Preserve the canonical profile builder and only clamp its final body descriptor for this species.
      if (profile && normalizeSpecies(exportData?.appearance?.speciesId) === SPECIES_ID) {
        profile.bodyColors = fixedBodyColors();
        status.profileColorCorrections += 1;
      }
      return profile;
    };
    wrapped.__hobunjiHarlyaoSkeletonColorGuard = true;
    wrapped.__hobunjiHarlyaoSkeletonColorGuardOriginal = baseBuildProfile;
    api.buildProfileFromNpcExport = wrapped;
    status.profileColorGuardInstalled = true;
    return true;
  }

  function installCosmeticRestrictions() {
    const baseLoad = window.loadPortraitCosmetics; // Shared async cosmetics/species loader; wrapping once applies restrictions after parent-species merging finishes.
    if (typeof baseLoad !== 'function') return false;
    if (baseLoad.__hobunjiHarlyaoSkeletonRestrictions) {
      status.cosmeticRestrictionsInstalled = true;
      return true;
    }
    const wrapped = async function loadPortraitCosmeticsWithHarlyaoSkeletonRestrictions() {
      const cosmetics = await baseLoad.apply(this, arguments);
      applyCosmeticRestrictions(cosmetics);
      return cosmetics;
    };
    wrapped.__hobunjiHarlyaoSkeletonRestrictions = true;
    wrapped.__hobunjiHarlyaoSkeletonRestrictionsOriginal = baseLoad;
    window.loadPortraitCosmetics = wrapped;
    status.cosmeticRestrictionsInstalled = true;
    return true;
  }

  function installArmMaskProfiles() {
    const portraitConfig = window.SCRATCHBONES_CONFIG?.game?.portrait; // Existing arm-only opacity-mask config consumed at portrait render time.
    if (!portraitConfig) return 0;
    portraitConfig.armOnlyOpacityMask ||= {};
    portraitConfig.armOnlyOpacityMask.profiles ||= {};
    let installed = 0; // Counts matching-gender Engh-sho mask copies exposed under the skeleton species key.
    for (const gender of GENDERS) {
      portraitConfig.armOnlyOpacityMask.profiles[`${SPECIES_ID}:${gender}`] = { ...ENGH_ARM_MASK_SETTINGS[gender] };
      installed += 1;
    }
    status.armMaskProfilesInstalled = installed;
    return installed;
  }

  function install() {
    installAppearanceSpeciesConfig();
    installBehindHeadSprites();
    installExtremityModels();
    installRigProfiles();
    installWardrobeResolver();
    installCosmeticRestrictions();
    installProfileColorGuard();
    installArmMaskProfiles();
    return debugSnapshot();
  }

  function debugSnapshot() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Queried live so Pixel Probe/debug callers can expose stale bootstrap state.
    const scales = window.HobunjiCharacterRigScaleDefaults; // Loaded immediately after this bridge; queried lazily rather than captured during installation.
    return {
      ...status,
      expectedAssets: { ...EXPECTED_ASSETS },
      allowedClothingIds: [...ALLOWED_CLOTHING_IDS],
      rigProfilesPresent: Object.fromEntries(GENDERS.map(gender => [gender, !!characters[`${SPECIES_ID}::${gender}`]])),
      resolvedScaleDefaults: Object.fromEntries(GENDERS.map(gender => [gender, scales?.scaleFor?.(SPECIES_ID, gender) || null])),
    };
  }

  window.HobunjiHarlyaoSkeletonSpecies = Object.freeze({
    speciesId: SPECIES_ID,
    bodySpeciesId: BODY_SPECIES_ID,
    extremityColor: EXTREMITY_COLOR,
    expectedAssets: EXPECTED_ASSETS,
    install,
    fixedBodyColors,
    applyCosmeticRestrictions,
    installProfileColorGuard,
    debugSnapshot,
    formatDebug: () => {
      const d = debugSnapshot(); // Compact copyable status line intended for the existing mobile-visible debug surfaces.
      return `Harlyao Skeleton: npcOnly=${d.npcOnly} rig=${d.rigProfilesInstalled}/2 hands=${d.handModelKey || 'missing'} feet=${d.footModelInherited} rearHeads=${d.behindHeadsInstalled}/2 restrictions=${d.cosmeticRestrictionsApplied}/2 fixedColor=${d.fixedColorProfilesApplied}/2 profileColorGuard=${d.profileColorGuardInstalled} profileColorCorrections=${d.profileColorCorrections} hex=${d.extremityColor}`;
    },
  });

  install();
  if (!status.profileColorGuardInstalled && typeof window.addEventListener === 'function') {
    window.addEventListener('load', () => installProfileColorGuard(), { once: true }); // NpcAvatarPreview may initialize after the attachment-rig bootstrap; retry once at page load without polling.
  }
})();
