// Character Studio loads scratchbones-config.js after panel-ui.js, so install a one-shot
// config assignment hook for runtime metadata plus a short-lived private-table capture
// so derived species inherit the Studio's complete authored slot definitions.
(() => {
  'use strict';
  const ID = 'mammakhbuur'; // NPC/editor species id used by Surveyor Harkhanash and authored Mammakhbuur appearances.
  const DONOR = 'mashtzarr'; // Mammakhbuur inherit Mashtzarr cosmetics except for front hair.
  const NUHONGAN_ID = 'nuhongan'; // Distinct saved/runtime identity for the smaller Slagothim subspecies.
  const NUHONGAN_DONOR = 'tletingan'; // Full Character Studio appearance/cosmetic authority for Nuhongan.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  const status = {
    configInstalled: false,
    privateSpeciesTableCaptured: false,
    nuhonganSlotCount: 0,
    lastError: null,
  }; // Mobile-readable proof that both lightweight config and full private Studio data were hydrated.

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

    // This lightweight record exists early for parent-chain consumers (hands,
    // feet, portrait placement). Character Studio's complete hair/face slots do
    // NOT live here; hydratePrivateSpeciesTable() clones those from its final
    // private Tletingan table after the page has merged all configured data.
    const nuhonganDonor = appearance?.species?.[NUHONGAN_DONOR];
    if (nuhonganDonor) {
      appearance.species[NUHONGAN_ID] = {
        ...clone(nuhonganDonor),
        label: 'Nuhongan',
        parentSpecies: NUHONGAN_DONOR,
        genders: clone(nuhonganDonor.genders || ['male', 'female']),
      };
      if (appearance.bodyPalettes?.[NUHONGAN_DONOR]) appearance.bodyPalettes[NUHONGAN_ID] = clone(appearance.bodyPalettes[NUHONGAN_DONOR]);
      status.configInstalled = true;
    }
    return config;
  }

  function hydratePrivateSpeciesTable(table) {
    const donor = table?.[NUHONGAN_DONOR];
    const looksLikeFinalStudioTable = table?.['mao-ao']?.label === 'Mao-ao'
      && table?.kenkari?.label === 'Kenkari'
      && donor?.label === 'Tletingan'
      && Array.isArray(donor?.male?.slots)
      && donor.male.slots.length > 0;
    if (!looksLikeFinalStudioTable) return false;

    const prior = table[NUHONGAN_ID] || {};
    const inherited = clone(donor);
    table[NUHONGAN_ID] = {
      ...inherited,
      ...clone(prior),
      label: 'Nuhongan',
      parentSpecies: NUHONGAN_DONOR,
      genders: clone(prior.genders || inherited.genders || ['male', 'female']),
      male: {
        ...(inherited.male || {}),
        ...(clone(prior.male) || {}),
        slots: clone(inherited.male?.slots || []), // Full Tletingan cosmetic controls are authoritative, never the lightweight config stub.
      },
      female: inherited.female || prior.female ? {
        ...(inherited.female || {}),
        ...(clone(prior.female) || {}),
        slots: clone(inherited.female?.slots || []),
      } : undefined,
    };

    // Re-run the metadata install now that scratchbones-config has completed its
    // post-assignment palette/species population; this guarantees parentSpecies
    // is available to runtime hand/foot fallback on this page too.
    install(window.SCRATCHBONES_CONFIG);
    status.privateSpeciesTableCaptured = true;
    status.nuhonganSlotCount = table[NUHONGAN_ID].male.slots.length;
    status.lastError = null;
    return true;
  }

  function installPrivateSpeciesTableCapture() {
    const originalEntries = Object.entries;
    if (originalEntries.__hobunjiCharacterStudioDerivedSpeciesCapture) return;
    const wrappedEntries = function hobunjiCharacterStudioDerivedSpeciesEntries(value) {
      let captured = false;
      try { captured = hydratePrivateSpeciesTable(value); }
      catch (error) { status.lastError = String(error?.message || error); }
      if (captured && Object.entries === wrappedEntries) Object.entries = originalEntries;
      return originalEntries(value);
    };
    wrappedEntries.__hobunjiCharacterStudioDerivedSpeciesCapture = true;
    Object.entries = wrappedEntries;
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

  installPrivateSpeciesTableCapture();

  window.HobunjiCharacterStudioMammakhbuurConfig = Object.freeze({
    speciesId: ID,
    donorSpeciesId: DONOR,
    nuhonganSpeciesId: NUHONGAN_ID,
    nuhonganDonorSpeciesId: NUHONGAN_DONOR,
    install,
    hydratePrivateSpeciesTable,
    status,
  });
})();
