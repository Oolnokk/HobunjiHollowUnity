// Character Studio loads scratchbones-config.js after panel-ui.js, so install a one-shot
// config assignment hook that exposes derived species there without duplicating the editor.
(() => {
  'use strict';
  const ID = 'mammakhbuur'; // NPC/editor species id used by Surveyor Harkhanash and authored Mammakhbuur appearances.
  const DONOR = 'mashtzarr'; // Mammakhbuur inherit Mashtzarr cosmetics except for front hair.
  const NUHONGAN_ID = 'nuhongan'; // Character Studio species id used for the smaller Tletingan-derived Slagothim.
  const NUHONGAN_DONOR = 'tletingan'; // Supplies every Nuhongan appearance option while rig scale remains species-specific elsewhere.
  const clone = value => JSON.parse(JSON.stringify(value));

  function stripFrontHair(genderData) {
    const data = clone(genderData || {});
    if (Array.isArray(data.slots)) data.slots = data.slots.filter(slot => slot?.slot !== 'hairFront');
    data.defaultCosmetics = { ...(data.defaultCosmetics || {}) };
    delete data.defaultCosmetics.hairFront;
    data.forcedCosmetics = { ...(data.forcedCosmetics || {}), hairFront: null }; // Prevents stale saved Mammakhbuur front hair from resurfacing in previews.
    return data;
  }

  function install(config) {
    const appearance = config?.game?.appearanceEditor;
    const donor = appearance?.species?.[DONOR];
    if (donor) {
      const donorCopy = clone(donor);
      appearance.species[ID] = {
        ...donorCopy,
        label: 'Mammakhbuur',
        parentSpecies: DONOR,
        genders: ['male', 'female'],
        male: stripFrontHair(donorCopy.male),
        female: stripFrontHair(donorCopy.female || donorCopy.male),
      };
      if (appearance.bodyPalettes?.[DONOR]) appearance.bodyPalettes[ID] = clone(appearance.bodyPalettes[DONOR]);
    }

    const nuhonganDonor = appearance?.species?.[NUHONGAN_DONOR]; // Used to expose Nuhongan as an exact appearance clone of Tletingan in Character Studio.
    if (nuhonganDonor) {
      appearance.species[NUHONGAN_ID] = {
        ...clone(nuhonganDonor),
        label: 'Nuhongan',
        parentSpecies: NUHONGAN_DONOR,
        genders: clone(nuhonganDonor.genders || ['male', 'female']),
      };
      if (appearance.bodyPalettes?.[NUHONGAN_DONOR]) appearance.bodyPalettes[NUHONGAN_ID] = clone(appearance.bodyPalettes[NUHONGAN_DONOR]);
    }
    return config;
  }

  if (window.SCRATCHBONES_CONFIG) {
    install(window.SCRATCHBONES_CONFIG);
  } else {
    let pendingConfig;
    Object.defineProperty(window, 'SCRATCHBONES_CONFIG', {
      configurable: true,
      enumerable: true,
      get: () => pendingConfig,
      set(value) {
        pendingConfig = install(value);
        Object.defineProperty(window, 'SCRATCHBONES_CONFIG', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: pendingConfig,
        });
      },
    });
  }

  window.HobunjiCharacterStudioMammakhbuurConfig = Object.freeze({ speciesId: ID, donorSpeciesId: DONOR, nuhonganSpeciesId: NUHONGAN_ID, nuhonganDonorSpeciesId: NUHONGAN_DONOR, install });
})();
