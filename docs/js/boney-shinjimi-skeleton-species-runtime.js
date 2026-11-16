// Boney-only Mao'ao skeleton profile. Ordinary skeletons retain their beard-free restrictions.
(() => {
  'use strict';
  if (window.HobunjiBoneyShinjimiSkeleton) return;
  const bridge = window.HobunjiSkeletonSpeciesBridge?.create?.({
    speciesId: 'boney-shinjimi-skeleton', label: "Boney Shinjimi's Skeleton",
    bodySpeciesId: 'mao-ao', debugLabel: 'Boney Shinjimi',
    extremityColor: '#BDBDB3', genders: ['male'], scaleMultiplier: 1,
    allowedClothingIds: ['ragged_hood', 'tankan_bodywrap', 'rugged_poncho', 'bandolier1',
      'appearance::Mao-ao_M::mao-ao_grandbeard', 'appearance::hat::riverlandskasa_wide'],
    forcedEmptySlots: ['eyes', 'upperFace', 'hairFront', 'hairBack', 'hairSide', 'hairSideL'],
    behindHeads: { male: 'fightersprites/special_cases/head-behind_mskel_m.png' },
    expectedAssets: {
      maleHead: 'fightersprites/mao-ao-m/head_maoskel_m.png',
      maleBehindHead: 'fightersprites/special_cases/head-behind_mskel_m.png',
      maleTorso: 'portraitsprites/torso_maoskel_m.png',
      maleArmL: 'portraitsprites/arm-L_maoskel_m.png',
      maleArmR: 'portraitsprites/arm-R_maoskel_m.png',
      beard: 'assets/cosmetics/appearance/mao-ao/facialhair/grandbeard_mao_m.png',
      hatPlaceholder: 'assets/cosmetics/clothes/hat/riverlandskasa_wide-back.png',
    },
  });
  if (!bridge) return;
  window.HobunjiBoneyShinjimiSkeleton = bridge;
  bridge.install();
})();
