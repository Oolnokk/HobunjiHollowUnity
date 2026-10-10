// Mao'ao Skeleton NPC-only species bridge (config for the shared skeleton
// bridge in js/skeleton-species-runtime.js). Used by the catacomb bodies in
// cave sites (js/cave-site-system.js).
//
// Reuses Mao'ao's rig, wardrobe art, hands/feet and arm mask with the authored
// "maoskel" bone sprites (male only so far), a fixed bone extremity color and
// every appearance-only slot forced empty.
(() => {
  'use strict';

  const bridge = window.HobunjiSkeletonSpeciesBridge.create({
    speciesId: 'mao-ao-skeleton',
    label: "Mao'ao Skeleton",
    debugLabel: "Mao'ao Skeleton",
    bodySpeciesId: 'mao-ao',
    extremityColor: '#BDBDB3', // Mid bone tone sampled from the maoskel sprites.
    genders: ['male'], // Only male maoskel sprites are authored.
    scaleMultiplier: 1,
    allowedClothingIds: ['ragged_hood', 'tankan_bodywrap', 'rugged_poncho', 'bandolier1'], // Grave rags only.
    behindHeads: null, // No authored rear skull yet; the renderer keeps its default rear head.
    expectedAssets: {
      maleHead: 'fightersprites/mao-ao-m/head_maoskel_m.png',
      maleTorso: 'portraitsprites/torso_maoskel_m.png',
      maleArmL: 'portraitsprites/arm-L_maoskel_m.png',
      maleArmR: 'portraitsprites/arm-R_maoskel_m.png',
    },
    armMaskSettings: null, // Inherit Mao'ao's authored PortraitArmCloudMask profile.
  });

  window.HobunjiMaoAoSkeletonSpecies = bridge;
  bridge.install();
})();
