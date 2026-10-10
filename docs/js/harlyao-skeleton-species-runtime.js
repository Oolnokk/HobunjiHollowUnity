// Harlyao Skeleton NPC-only species bridge (config for the shared skeleton
// bridge in js/skeleton-species-runtime.js).
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

  const bridge = window.HobunjiSkeletonSpeciesBridge.create({
    speciesId: 'harlyao-skeleton',
    label: 'Harlyao Skeleton',
    debugLabel: 'Harlyao Skeleton',
    bodySpeciesId: 'engh-sho', // Canonical donor for wardrobe variants, rig coordinates, and feline extremity meshes.
    defaultHandModel: 'feline', // Explicit feline fallback preserves the authored skeleton contract if Engh-sho mapping loads late.
    extremityColor: '#D4D6C9', // Fixed A/B/C descriptor consumed by procedural hand/foot body-material paths.
    genders: ['male', 'female'],
    scaleMultiplier: 1.2,
    allowedClothingIds: ['fine_hood', 'ragged_hood', 'tankan_tunic', 'bandolier1', 'tankan_bodywrap', 'rugged_poncho', 'fine_poncho', 'rounded_pauldron', 'tangedcirclet'], // Broad species-level clothing support survives while Minion randomization itself is restricted to bodywrap/poncho/bandolier.
    behindHeads: {
      male: 'fightersprites/special_cases/head-behind_hskel_m.png',
      female: 'fightersprites/special_cases/head-behind_hskel_f.png',
    },
    expectedAssets: {
      maleHead: 'fightersprites/engh-sho-m/head_hskel_m.png',
      femaleHead: 'fightersprites/engh-sho-f/head_hskel_f.png',
      maleBehindHead: 'fightersprites/special_cases/head-behind_hskel_m.png',
      femaleBehindHead: 'fightersprites/special_cases/head-behind_hskel_f.png',
      maleTorso: 'portraitsprites/torso_hskel_m.png',
      femaleTorso: 'portraitsprites/torso_hskel_f.png',
      femalePauldronHair: 'cosmetics/appearance/harlyao_skeleton/hairdefault-right_hskel_f.png',
    },
    armMaskSettings: { // Mirrors the existing Engh-sho authored arm-cloud cutout profiles.
      male: { maskYScaleMultiplier: 1.04, axOffset: -0.07, cutThreshold: 0.18, wobbleStrength: 0.16, wobbleScale: 1, outlineWidth: 4, seed: 28480 },
      female: { maskYScaleMultiplier: 1.15, axOffset: 0.195, cutThreshold: 0.78, wobbleStrength: 0.16, wobbleScale: 1, outlineWidth: 2, seed: 28480 },
    },
  });

  window.HobunjiHarlyaoSkeletonSpecies = bridge;
  bridge.install();
})();
