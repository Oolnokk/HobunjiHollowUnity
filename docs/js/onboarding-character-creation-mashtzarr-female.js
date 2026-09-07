// Character-creator compatibility bridge: female Mashtzarr use their real female body/profile and temporarily borrow male hairstyle controls.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingMashtzarrFemale'; // Prevents duplicate installation if the onboarding bootstrap is replayed from cache.
  if (window[PATCH_ID]) return;

  let speciesTableCaptured = false; // True once the core's private SPECIES_DATA table has been found and patched.
  let entriesWrapped = false; // Tracks the short-lived Object.entries interception used to reach the private table.
  let randomizerGuardInstalled = false; // Tracks the guard that strips accidental female Mashtzarr facial hair.

  const status = {
    fallbackMode: 'female-body-male-hair-slots',
    speciesTableCaptured: false,
    randomizerGuardInstalled: false,
    hairSlotCount: 0,
    hairSlotLabels: [],
    facialHairAllowed: false,
    realFemaleFighterAvailable: null,
    lastError: null,
  }; // Mobile-readable status without requiring DevTools.

  function normalizeSpeciesId(value) {
    return String(value || '').replace(/_/g, '-').toLowerCase();
  }

  function fighterGender(fighter) {
    return String(fighter?.gender ?? (fighter?.id === 'M' ? 'male' : fighter?.id === 'F' ? 'female' : '')).toLowerCase();
  }

  function configuredFemaleData() {
    return window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species?.mashtzarr?.female || null;
  }

  function isFemaleMashtzarrFighter(fighter) {
    return normalizeSpeciesId(fighter?.speciesId) === 'mashtzarr' && fighterGender(fighter) === 'female';
  }

  function stripFemaleFacialHair(profile) {
    if (!profile || !isFemaleMashtzarrFighter(profile.fighter)) return profile;
    profile.facialHair = null;
    return profile;
  }

  function hydratePrivateSpeciesTable(table) {
    const looksLikeCoreSpeciesTable = table?.['mao-ao']?.label === 'Mao-ao'
      && table?.tletingan?.label === 'Tletingan'
      && table?.kenkari?.label === 'Kenkari'
      && table?.['engh-sho']?.label === 'Engh-sho';
    const mashtzarr = table?.mashtzarr;
    if (!looksLikeCoreSpeciesTable || !mashtzarr || mashtzarr.label !== 'Mashtzarr' || !mashtzarr.male || !Array.isArray(mashtzarr.male.slots)) return false;

    const authoredFemale = configuredFemaleData();
    const maleHairSlots = mashtzarr.male.slots.filter(slot => String(slot?.slot || '').startsWith('hair'));
    const femaleOwnSlots = Array.isArray(authoredFemale?.slots)
      ? authoredFemale.slots.filter(slot => slot?.slot !== 'facialHair' && !String(slot?.slot || '').startsWith('hair'))
      : [];

    // Female Mashtzarr keep their authored female profile/body data. Only the
    // temporary hairstyle-control list is borrowed from male Mashtzarr. Never
    // expose facialHair in the female creator data.
    const femaleData = {
      ...(authoredFemale || {}),
      slots: [...maleHairSlots, ...femaleOwnSlots],
      colorOptions: authoredFemale?.colorOptions
        || window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.bodyPalettes?.mashtzarr?.female
        || mashtzarr.male.colorOptions,
    };
    if (!Array.isArray(mashtzarr.genders)) mashtzarr.genders = ['male'];
    if (!mashtzarr.genders.includes('female')) mashtzarr.genders.push('female');
    mashtzarr.female = femaleData;

    speciesTableCaptured = true;
    status.speciesTableCaptured = true;
    status.hairSlotCount = maleHairSlots.length;
    status.hairSlotLabels = maleHairSlots.map(slot => slot.label || slot.slot);
    status.lastError = null;
    return true;
  }

  function installSpeciesTableCapture() {
    // onboarding-core keeps SPECIES_DATA private. Its normal Appearance renderer
    // enumerates that table with Object.entries; intercept only until that exact
    // table passes through, patch it, then restore Object.entries immediately.
    const originalEntries = Object.entries;
    if (originalEntries.__hobunjiMashtzarrFemaleCapture) return;

    const wrappedEntries = function hobunjiMashtzarrFemaleEntries(value) {
      const captured = hydratePrivateSpeciesTable(value);
      if (captured && Object.entries === wrappedEntries) {
        Object.entries = originalEntries;
        entriesWrapped = false;
      }
      return originalEntries(value);
    };
    wrappedEntries.__hobunjiMashtzarrFemaleCapture = true;
    Object.entries = wrappedEntries;
    entriesWrapped = true;
  }

  function installRandomizerGuard() {
    const current = window.randomPortraitProfileSeeded;
    if (typeof current !== 'function') return false;
    if (current.__hobunjiMashtzarrFemaleNoFacialHair) {
      randomizerGuardInstalled = true;
      status.randomizerGuardInstalled = true;
      return true;
    }

    const wrapped = function randomPortraitProfileSeededWithoutFemaleMashtzarrFacialHair(...args) {
      return stripFemaleFacialHair(current.apply(this, args));
    };
    wrapped.__hobunjiMashtzarrFemaleNoFacialHair = true;
    wrapped.__hobunjiOriginalRandomPortraitProfileSeeded = current;
    window.randomPortraitProfileSeeded = wrapped;
    randomizerGuardInstalled = true;
    status.randomizerGuardInstalled = true;
    return true;
  }

  function verifyFemaleFighter() {
    const fighters = window.getPortraitFighters?.();
    if (!Array.isArray(fighters)) return false;
    status.realFemaleFighterAvailable = fighters.some(isFemaleMashtzarrFighter);
    return true;
  }

  function ensureRuntimeGuard() {
    const randomizerReady = installRandomizerGuard();
    const fightersReady = verifyFemaleFighter();
    if (randomizerReady && fightersReady) return;
    requestAnimationFrame(ensureRuntimeGuard); // Portrait utilities may finish loading after this compatibility layer.
  }

  installSpeciesTableCapture();
  ensureRuntimeGuard();

  window[PATCH_ID] = Object.freeze({
    fallbackMode: 'female-body-male-hair-slots',
    configuredFemaleData,
    hydratePrivateSpeciesTable,
    installRandomizerGuard,
    stripFemaleFacialHair,
    status,
    get speciesTableCaptured() { return speciesTableCaptured; },
    get entriesWrapped() { return entriesWrapped; },
    get randomizerGuardInstalled() { return randomizerGuardInstalled; },
  });
})();
