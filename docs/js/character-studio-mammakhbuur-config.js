// Character Studio loads scratchbones-config.js after panel-ui.js, so install a one-shot
// config assignment hook that exposes Mammakhbuur there without duplicating the editor.
(() => {
  'use strict';
  if (window.HobunjiCharacterStudioMammakhbuurConfig) return; // Makes the helper safe if PR #917 later also preloads it through panel-ui.js.
  const ID = 'mammakhbuur'; // NPC/editor species id used by Surveyor Harkhanash and authored Mammakhbuur appearances.
  const DONOR = 'mashtzarr'; // Mammakhbuur inherit Mashtzarr cosmetics except for front hair.
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
    if (!donor) return config;
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

  window.HobunjiCharacterStudioMammakhbuurConfig = Object.freeze({ speciesId: ID, donorSpeciesId: DONOR, install });
})();
