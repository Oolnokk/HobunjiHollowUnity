// Maskbound Guardians share the Mao'ao skeleton art and rig but their
// animated wooden bones accept separate, per-troop body palettes.
(() => {
  'use strict';

  const WOOD_HEX = '#493426'; // Default dark-wood tone used for extremities and fallback NPC portraits.
  const MASK_ID = 'hachutu_binding_mask_ii'; // Guardian mask-slot article also worn by living Mao'ao/Mashtzarr.
  const BEHIND_HEAD = 'fightersprites/special_cases/head-behind_mskel_m.png'; // Same rear skull as ordinary Mao'ao skeleton enemies.
  const bridge = window.HobunjiSkeletonSpeciesBridge?.create({
    speciesId: 'maskbound-guardian',
    label: 'Maskbound Guardian',
    debugLabel: 'Maskbound Guardian',
    bodySpeciesId: 'mao-ao',
    extremityColor: WOOD_HEX,
    genders: ['male'], // Current Mao'ao skeleton body art is male-only.
    variableBodyColors: true, // Unlike ordinary bones, wooden puppets use troop-authored A/B/C color values.
    scaleMultiplier: 1,
    allowedClothingIds: [MASK_ID, 'ragged_hood', 'fine_hood', 'facewrap', 'rugged_poncho', 'tankan_bodywrap', 'bandolier1'],
    behindHeads: { male: BEHIND_HEAD },
    expectedAssets: {
      maleHead: 'fightersprites/mao-ao-m/head_maoskel_m.png',
      maleBehindHead: BEHIND_HEAD,
      maleTorso: 'portraitsprites/torso_maoskel_m.png',
      maleArmL: 'portraitsprites/arm-L_maoskel_m.png',
      maleArmR: 'portraitsprites/arm-R_maoskel_m.png',
      mask: 'cosmetics/clothes/masks/bindingmask_2_m.png',
    },
    armMaskSettings: null, // Reuse Mao'ao's arm-cloud mask, hand/foot meshes and attachment points.
  });

  if (!bridge) throw new Error('SkeletonSpeciesBridge must load before MaskboundGuardianSpecies.');
  window.HobunjiMaskboundGuardianSpecies = bridge;
  bridge.install();
})();
