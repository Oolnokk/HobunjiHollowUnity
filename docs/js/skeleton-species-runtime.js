// Shared bridge for NPC-only skeleton species (generalized from the original
// Harlyao Skeleton runtime). A skeleton reuses a living donor species' rig,
// wardrobe art and extremity models while keeping its own authored bone
// sprites and appearance restrictions:
//   - donor wardrobe variants, hands/feet, attachment rig and arm mask;
//   - a fixed procedural extremity (hand/foot) color, no randomized palette;
//   - skeleton heads/bodies with every appearance-only slot forced empty.
// Each species is a thin config file calling
// window.HobunjiSkeletonSpeciesBridge.create(config).install()
// (js/harlyao-skeleton-species-runtime.js, js/mao-ao-skeleton-species-runtime.js).
(() => {
  'use strict';

  if (window.HobunjiSkeletonSpeciesBridge) return;

  const DEFAULT_FORCED_EMPTY_SLOTS = Object.freeze(['eyes', 'upperFace', 'facialHair', 'hairFront', 'hairBack', 'hairSide', 'hairSideL']); // Appearance-only slots are always empty for skeletons.

  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  // config: { speciesId, label, bodySpeciesId, extremityColor, genders,
  //   scaleMultiplier, expectedAssets, behindHeads ({ gender: url } or null),
  //   allowedClothingIds, forcedEmptySlots?, armMaskSettings ({ gender: profile }
  //   or null to inherit the donor's authored PortraitArmCloudMask profile),
  //   defaultHandModel?, debugLabel }
  function create(config) {
    const SPECIES_ID = config.speciesId;
    const BODY_SPECIES_ID = config.bodySpeciesId;
    const EXTREMITY_COLOR = config.extremityColor;
    const GENDERS = Object.freeze([...(config.genders || ['male', 'female'])]);
    const ALLOWED_CLOTHING_IDS = Object.freeze([...(config.allowedClothingIds || [])]);
    const FORCED_EMPTY_SLOTS = Object.freeze([...(config.forcedEmptySlots || DEFAULT_FORCED_EMPTY_SLOTS)]);
    const EXPECTED_ASSETS = Object.freeze({ ...(config.expectedAssets || {}) }); // Exposed through mobile diagnostics so a bad asset path is visible without devtools.
    const MARKER = `__hobunjiSkeletonSpecies_${SPECIES_ID}`; // Per-species wrapper marker so several skeleton bridges can stack on the same shared functions.

    const status = { // Mutable installation state copied into debugSnapshot() for mobile-friendly verification.
      speciesId: SPECIES_ID,
      npcOnly: true,
      playerSelectable: false,
      bodySpecies: BODY_SPECIES_ID,
      extremityColor: EXTREMITY_COLOR,
      scaleMultiplier: config.scaleMultiplier ?? 1,
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
        label: config.label,
        parentSpecies: BODY_SPECIES_ID,
        genders: [...GENDERS],
        npcOnly: true,
        playerSelectable: false,
        editorPreviewSelectable: true, // Character Studio may author/preview this NPC-only species without making it legal for player creation.
        bodyColorCustomization: false, // Character Studio hides editable body-color controls for the authored skeleton PNG body.
        fixedBodyColorHex: EXTREMITY_COLOR, // Procedural hands/feet and editor diagnostics use the same fixed bone color.
      };
      status.appearanceConfigInstalled = true;
      return true;
    }

    function installBehindHeadSprites() {
      const headUrls = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.behindView?.headUrls; // Canonical rear-head lookup used by portrait and runtime avatar behind views.
      if (!headUrls || !config.behindHeads) return 0;
      headUrls[SPECIES_ID] = { ...config.behindHeads };
      status.behindHeadsInstalled = Object.keys(config.behindHeads).length;
      return status.behindHeadsInstalled;
    }

    function installExtremityModels() {
      const handProfiles = window.HobunjiHandModelProfiles; // Shared hand model registry.
      if (handProfiles?.mutate) {
        handProfiles.mutate(data => {
          data.speciesModels ||= {};
          const sourceModel = data.speciesModels[BODY_SPECIES_ID] || config.defaultHandModel || null; // Explicit fallback preserves the authored contract if the donor mapping loads late.
          if (sourceModel) data.speciesModels[SPECIES_ID] = sourceModel;
        });
        status.handModelKey = handProfiles.data?.speciesModels?.[SPECIES_ID] || null;
        status.handModelInherited = !!status.handModelKey;
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
      const anatomy = profile?.anatomy; // Donor anchors remain authoritative, while whole-rig factors resolve through the shared scale alias.
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
      let installed = 0; // Counts successful donor profile clones for diagnostics.
      for (const gender of GENDERS) {
        const source = characters[`${BODY_SPECIES_ID}::${gender}`]; // Matching-gender donor rig is the geometry source.
        if (!source) continue;
        const profile = clone(source); // Independent copy prevents skeleton adjustments from mutating the donor.
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
      const baseResolve = window.resolveOptionLayers; // Existing resolver stays authoritative outside this skeleton's wardrobe lookups.
      if (typeof baseResolve !== 'function') return false;
      if (baseResolve[MARKER]) {
        status.wardrobeResolverInstalled = true;
        return true;
      }
      const wrapped = function resolveSkeletonWardrobeLayers(option, fighter) {
        if (normalizeSpecies(fighter?.speciesId) !== SPECIES_ID) return baseResolve.apply(this, arguments);
        if (option?.variantLayers?.[`${SPECIES_ID}_${fighter.gender}`]?.length) return baseResolve.call(this, option, fighter); // Skeleton-authored wardrobe art takes priority over the donor.
        const inheritedFighter = { ...fighter, speciesId: BODY_SPECIES_ID }; // Clothing art resolves through matching-gender donor variants only.
        return baseResolve.call(this, option, inheritedFighter);
      };
      wrapped[MARKER] = true;
      wrapped[`${MARKER}_original`] = baseResolve;
      window.resolveOptionLayers = wrapped;
      status.wardrobeResolverInstalled = true;
      return true;
    }

    function fighterFor(gender) {
      const fighters = window.getPortraitFighters?.() || []; // Live registry populated by loadPortraitCosmetics() from config/species/index.json.
      return fighters.find(fighter => normalizeSpecies(fighter?.speciesId) === SPECIES_ID && String(fighter?.gender || '').toLowerCase() === gender) || null;
    }

    function applyCosmeticRestrictions(cosmetics) {
      const allowedByFighter = cosmetics?.allowedCosmeticsByFighter; // Final merged allow-lists are clamped because parent appearance entries would otherwise merge back in.
      const forcedByFighter = cosmetics?.forcedCosmeticsByFighter; // Forced none values keep every appearance-only slot empty during deterministic/random NPC profile generation.
      const ranges = cosmetics?.bodyColorRangesByGender; // Fixed hex is retained solely so procedural hands/feet resolve the requested bone color.
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
      if (baseBuildProfile[MARKER]) {
        status.profileColorGuardInstalled = true;
        return true;
      }
      const wrapped = function buildProfileWithSkeletonFixedColor(exportData) {
        const profile = baseBuildProfile.apply(this, arguments); // Preserve the canonical profile builder and only clamp its final body descriptor for this species.
        if (profile && normalizeSpecies(exportData?.appearance?.speciesId) === SPECIES_ID) {
          profile.bodyColors = { ...(profile.bodyColors || {}), ...fixedBodyColors() }; // Clamp only skeletal body A/B/C; preserve CLOTH/HOOD/TORSO and palette sub-slots already applied from the NPC's dye metadata.
          status.profileColorCorrections += 1;
        }
        return profile;
      };
      wrapped[MARKER] = true;
      wrapped[`${MARKER}_original`] = baseBuildProfile;
      api.buildProfileFromNpcExport = wrapped;
      status.profileColorGuardInstalled = true;
      return true;
    }

    function installCosmeticRestrictions() {
      const baseLoad = window.loadPortraitCosmetics; // Shared async cosmetics/species loader; wrapping once applies restrictions after parent-species merging finishes.
      if (typeof baseLoad !== 'function') return false;
      if (baseLoad[MARKER]) {
        status.cosmeticRestrictionsInstalled = true;
        return true;
      }
      const wrapped = async function loadPortraitCosmeticsWithSkeletonRestrictions() {
        const cosmetics = await baseLoad.apply(this, arguments);
        applyCosmeticRestrictions(cosmetics);
        return cosmetics;
      };
      wrapped[MARKER] = true;
      wrapped[`${MARKER}_original`] = baseLoad;
      window.loadPortraitCosmetics = wrapped;
      status.cosmeticRestrictionsInstalled = true;
      return true;
    }

    function installArmMaskProfiles() {
      const portraitConfig = window.SCRATCHBONES_CONFIG?.game?.portrait; // Existing arm-only opacity-mask config consumed at portrait render time.
      if (!portraitConfig) return 0;
      portraitConfig.armOnlyOpacityMask ||= {};
      portraitConfig.armOnlyOpacityMask.profiles ||= {};
      let installed = 0; // Counts matching-gender mask profiles exposed under the skeleton species key.
      for (const gender of GENDERS) {
        const settings = config.armMaskSettings?.[gender] || window.PortraitArmCloudMask?.authoredProfiles?.[`${BODY_SPECIES_ID}:${gender}`]; // Explicit authored settings, else the donor's authored profile.
        if (!settings) continue;
        portraitConfig.armOnlyOpacityMask.profiles[`${SPECIES_ID}:${gender}`] = { ...settings };
        installed += 1;
      }
      status.armMaskProfilesInstalled = installed;
      return installed;
    }

    function debugSnapshot() {
      const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Queried live so Pixel Probe/debug callers can expose stale bootstrap state.
      const scales = window.HobunjiCharacterRigScaleDefaults; // Loaded after the bridges; queried lazily rather than captured during installation.
      return {
        ...status,
        expectedAssets: { ...EXPECTED_ASSETS },
        allowedClothingIds: [...ALLOWED_CLOTHING_IDS],
        rigProfilesPresent: Object.fromEntries(GENDERS.map(gender => [gender, !!characters[`${SPECIES_ID}::${gender}`]])),
        resolvedScaleDefaults: Object.fromEntries(GENDERS.map(gender => [gender, scales?.scaleFor?.(SPECIES_ID, gender) || null])),
      };
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
      if (!status.profileColorGuardInstalled && typeof window.addEventListener === 'function') {
        window.addEventListener('load', () => installProfileColorGuard(), { once: true }); // NpcAvatarPreview may initialize after the attachment-rig bootstrap; retry once at page load without polling.
      }
      return debugSnapshot();
    }

    const n = GENDERS.length;
    return Object.freeze({
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
        return `${config.debugLabel || config.label}: npcOnly=${d.npcOnly} rig=${d.rigProfilesInstalled}/${n} hands=${d.handModelKey || 'missing'} feet=${d.footModelInherited} rearHeads=${d.behindHeadsInstalled}/${config.behindHeads ? n : 0} restrictions=${d.cosmeticRestrictionsApplied}/${n} fixedColor=${d.fixedColorProfilesApplied}/${n} profileColorGuard=${d.profileColorGuardInstalled} profileColorCorrections=${d.profileColorCorrections} hex=${d.extremityColor}`;
      },
    });
  }

  window.HobunjiSkeletonSpeciesBridge = Object.freeze({ create });
})();
