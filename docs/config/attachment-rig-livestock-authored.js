// Authoritative post-master creature rig profiles for livestock species added after
// the original five-creature attachment-rig master. Values are copied from the
// Animation Author v10 export produced 2026-09-15T01:14:42.624Z. Runtime loads
// this immediately after attachment-rig-profiles.js and before creature/game init.
(() => {
  'use strict';

  const PATCH_ID = 'authored-livestock-rig-2026-09-15-v1';
  const EXPORTED_AT = '2026-09-15T01:14:42.624Z';
  const SOURCE = 'animation-author-export-2026-09-15';
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const deepFreeze = value => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  };

  const PROFILES = deepFreeze({
    puktuk: {
      kind: 'puktuk',
      anchors: {
        saddle: {
          position: { x: 0, y: 0.16937859550590686, z: -0.012420318741466083 },
          rotationDeg: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        shoulderGrip: {
          position: { x: 0.01, y: -0.29715994741785007, z: -0.0010889163404909086 },
          rotationDeg: { x: 0, y: -61, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      chatheadFrame: {
        x: 0.17142091899942474,
        y: 0.11029044613093768,
        width: 0.27636019798104444,
        height: 0.601013493102534,
        coordinateSpace: 'sprite-normalized-top-left',
        version: 1,
      },
      saddleRule: {
        source: SOURCE,
        defaultRuleVersion: 3,
        authoredDefaultVersion: 6,
        authoredFixed: true,
        recalculateOnPreview: false,
      },
      shoulderGripRule: {
        source: SOURCE,
        coordinateSpace: 'unscaled-idle-png-plane-local',
        defaultRuleVersion: 5,
        authoredDefaultVersion: 7,
        authoredFixed: true,
        recalculateOnPreview: false,
      },
      sizeScales: {
        large: { x: 1, y: 1 },
        medium: { x: 0.6, y: 0.6 },
        small: { x: 0.3, y: 0.3 },
      },
      sizeScaleRule: {
        version: 1,
        axes: 'png-plane-local-x-y',
        zScale: 1,
        applicationOrder: 'before-outer-prism-and-world-bounds',
        authoredDefaultVersion: 6,
        authoredFixed: true,
        source: SOURCE,
      },
      shoulderGripRotationDefaultVersion: 2,
      creatureShoulderGripDefaultVersion: 4,
      groundOffsets: { large: 0.4, medium: 0.24, small: 0.12 },
      sizeScalePercentages: {
        large: { x: 100, y: 100 },
        medium: { x: 60, y: 60 },
        small: { x: 30, y: 30 },
      },
    },
    'voorg-ass': {
      kind: 'voorg-ass',
      anchors: {
        saddle: {
          position: { x: -0.0016655977917167481, y: 0.12286908956931555, z: 0.043832914384796626 },
          rotationDeg: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        shoulderGrip: {
          position: { x: 0.01, y: -0.33453636625016553, z: 0.0181046276028018 },
          rotationDeg: { x: 0, y: -61, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      chatheadFrame: {
        x: 0.1235,
        y: 0.14,
        width: 0.3074,
        height: 0.3325,
        coordinateSpace: 'sprite-normalized-top-left',
        version: 1,
      },
      saddleRule: {
        source: SOURCE,
        defaultRuleVersion: 3,
        authoredDefaultVersion: 6,
        authoredFixed: true,
        recalculateOnPreview: false,
      },
      shoulderGripRule: {
        source: SOURCE,
        coordinateSpace: 'unscaled-idle-png-plane-local',
        defaultRuleVersion: 5,
        authoredDefaultVersion: 7,
        authoredFixed: true,
        recalculateOnPreview: false,
      },
      sizeScales: {
        large: { x: 0.97, y: 0.97 },
        medium: { x: 0.75, y: 0.75 },
        small: { x: 0.27, y: 0.27 },
      },
      sizeScaleRule: {
        version: 1,
        axes: 'png-plane-local-x-y',
        zScale: 1,
        applicationOrder: 'before-outer-prism-and-world-bounds',
        authoredDefaultVersion: 6,
        authoredFixed: true,
        source: SOURCE,
      },
      shoulderGripRotationDefaultVersion: 2,
      creatureShoulderGripDefaultVersion: 4,
      groundOffsets: { large: 0.26, medium: 0.325, small: 0.11 },
      sizeScalePercentages: {
        large: { x: 97, y: 97 },
        medium: { x: 75, y: 75 },
        small: { x: 27, y: 27 },
      },
    },
  });

  const DEFAULT_SIZE_CLASS = Object.freeze({ puktuk: 'medium', 'voorg-ass': 'large' });
  const VALID_SIZE_CLASSES = new Set(['small', 'medium', 'large']);

  function applyProfiles() {
    const library = window.HOBUNJI_ATTACHMENT_RIG_PROFILES ||= { characters: {}, creatures: {} };
    library.characters ||= {};
    library.creatures ||= {};
    library.creatureShoulderGripDefaults ||= {};
    for (const [kind, profile] of Object.entries(PROFILES)) {
      library.creatures[kind] = clone(profile);
      library.creatureShoulderGripDefaults[kind] = { ...profile.anchors.shoulderGrip.position };
    }
    const status = window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    status.authoredLivestockRig = {
      patchId: PATCH_ID,
      exportedAt: EXPORTED_AT,
      source: SOURCE,
      creatures: Object.keys(PROFILES),
      runtimeLibraryApplied: true,
    };
    return library;
  }

  function sizeClassFor(kind, genotypeOrSizeClass) {
    const explicit = typeof genotypeOrSizeClass === 'string' ? genotypeOrSizeClass : genotypeOrSizeClass?.sizeClass;
    return VALID_SIZE_CLASSES.has(explicit) ? explicit : DEFAULT_SIZE_CLASS[kind];
  }

  function authoredSizeScale(kind, genotypeOrSizeClass) {
    const profile = PROFILES[kind];
    if (!profile) return null;
    const sizeClass = sizeClassFor(kind, genotypeOrSizeClass);
    const scale = profile.sizeScales[sizeClass];
    return { sizeClass, x: Number(scale.x), y: Number(scale.y) };
  }

  function authoredGroundOffset(kind, genotypeOrSizeClass) {
    const profile = PROFILES[kind];
    if (!profile) return null;
    const sizeClass = sizeClassFor(kind, genotypeOrSizeClass);
    const value = Number(profile.groundOffsets[sizeClass]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function patchCreatureGeneticsApi() {
    const api = window.CreatureGenetics;
    if (!api?.creatureSizeScale || !api?.creatureGroundOffset) return false;
    if (api.__authoredLivestockRigPatch === PATCH_ID) return true;

    const originalSizeScale = api.creatureSizeScale.bind(api);
    const originalGroundOffset = api.creatureGroundOffset.bind(api);
    const originalSizeTrait = typeof api.creatureSizeTrait === 'function' ? api.creatureSizeTrait.bind(api) : null;
    const originalGenotypeTraits = typeof api.genotypeTraits === 'function' ? api.genotypeTraits.bind(api) : null;

    api.creatureSizeScale = function creatureSizeScaleWithAuthoredLivestock(kind, genotypeOrSizeClass) {
      return PROFILES[kind] ? authoredSizeScale(kind, genotypeOrSizeClass) : originalSizeScale(kind, genotypeOrSizeClass);
    };
    api.creatureGroundOffset = function creatureGroundOffsetWithAuthoredLivestock(kind, genotypeOrSizeClass) {
      return PROFILES[kind] ? authoredGroundOffset(kind, genotypeOrSizeClass) : originalGroundOffset(kind, genotypeOrSizeClass);
    };
    if (originalSizeTrait) {
      api.creatureSizeTrait = function creatureSizeTraitWithAuthoredLivestock(kind, genotype) {
        const trait = originalSizeTrait(kind, genotype);
        return PROFILES[kind] ? { ...trait, ...authoredSizeScale(kind, genotype) } : trait;
      };
    }
    if (originalGenotypeTraits) {
      api.genotypeTraits = function genotypeTraitsWithAuthoredLivestock(kind, genotype) {
        const traits = originalGenotypeTraits(kind, genotype);
        if (!PROFILES[kind] || !traits?.size) return traits;
        return { ...traits, size: { ...traits.size, ...authoredSizeScale(kind, genotype) } };
      };
    }
    Object.defineProperty(api, '__authoredLivestockRigPatch', { configurable: true, value: PATCH_ID });

    const status = window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    status.authoredLivestockRig ||= {};
    status.authoredLivestockRig.creatureGeneticsApiPatched = true;
    status.authoredLivestockRig.legacyBorrowingBypassed = ['puktuk->gar-wolf', 'voorg-ass->uumkaoii'];
    return true;
  }

  applyProfiles();
  window.HobunjiAuthoredLivestockRig = Object.freeze({
    PATCH_ID,
    EXPORTED_AT,
    SOURCE,
    profiles: PROFILES,
    applyProfiles,
    patchCreatureGeneticsApi,
    authoredSizeScale,
    authoredGroundOffset,
  });

  if (!patchCreatureGeneticsApi()) {
    window.addEventListener?.('DOMContentLoaded', patchCreatureGeneticsApi, { once: true });
    if (typeof window.setInterval === 'function') {
      let attempts = 0;
      const timer = window.setInterval(() => {
        if (patchCreatureGeneticsApi() || ++attempts >= 400) window.clearInterval(timer);
      }, 25);
    }
  }
})();
