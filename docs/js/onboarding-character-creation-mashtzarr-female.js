// Character-creator compatibility bridge: female Mashtzarr temporarily reuse the male Mashtzarr creator/profile data.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingMashtzarrFemale'; // Prevents duplicate installation if the onboarding bootstrap is replayed from cache.
  if (window[PATCH_ID]) return;

  let speciesTableCaptured = false; // True once the core's private SPECIES_DATA table has been found and patched.
  let entriesWrapped = false; // Tracks the short-lived Object.entries interception used to reach the private table.
  let portraitFallbackInstalled = false; // Tracks whether female Mashtzarr portraits resolve through the male fighter.
  let randomizerFallbackInstalled = false; // Tracks the guard that prevents the male fallback fighter from randomly generating facial hair.

  const status = {
    fallbackMode: 'male-mashtzarr',
    speciesTableCaptured: false,
    portraitFallbackInstalled: false,
    randomizerFallbackInstalled: false,
    hairSlotCount: 0,
    hairSlotLabels: [],
    facialHairAllowed: false,
    lastError: null,
  }; // Mobile-readable status without requiring DevTools.

  function normalizeSpeciesId(value) {
    return String(value || '').replace(/_/g, '-').toLowerCase();
  }

  function fighterGender(fighter) {
    return String(fighter?.gender ?? (fighter?.id === 'M' ? 'male' : fighter?.id === 'F' ? 'female' : '')).toLowerCase();
  }

  function isFemaleMashtzarrFallbackFighter(fighter) {
    return !!fighter?.__hobunjiMashtzarrFemaleFallback
      || (normalizeSpeciesId(fighter?.speciesId) === 'mashtzarr' && fighterGender(fighter) === 'female');
  }

  function stripFemaleFacialHair(profile) {
    if (!profile || !isFemaleMashtzarrFallbackFighter(profile.fighter)) return profile;
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

    // Reuse the known-good male Mashtzarr data while omitting only facial hair.
    // Hair controls and the body palette remain the same temporary fallback,
    // but females cannot select or randomize a beard/moustache cosmetic.
    const femaleSlots = mashtzarr.male.slots.filter(slot => slot?.slot !== 'facialHair');
    const femaleData = { ...mashtzarr.male, slots: femaleSlots };
    if (!Array.isArray(mashtzarr.genders)) mashtzarr.genders = ['male'];
    if (!mashtzarr.genders.includes('female')) mashtzarr.genders.push('female');
    mashtzarr.female = femaleData;

    const hairSlots = femaleSlots.filter(slot => String(slot?.slot || '').startsWith('hair'));
    speciesTableCaptured = true;
    status.speciesTableCaptured = true;
    status.hairSlotCount = hairSlots.length;
    status.hairSlotLabels = hairSlots.map(slot => slot.label || slot.slot);
    status.lastError = null;
    return true;
  }

  function installSpeciesTableCapture() {
    // onboarding-core intentionally keeps SPECIES_DATA private. Before init(),
    // its normal Appearance renderer enumerates that table with Object.entries.
    // Intercept only until that one recognizable object passes through, patch it,
    // then restore Object.entries immediately. This avoids the previous fragile
    // Object.prototype getter and lets the ordinary core render/listener path own
    // every female Mashtzarr control from then on.
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

  function installMalePortraitFallback() {
    const current = window.getPortraitFighters;
    if (typeof current !== 'function') return false;
    if (current.__hobunjiMashtzarrFemaleMaleFallback) {
      portraitFallbackInstalled = true;
      status.portraitFallbackInstalled = true;
      return true;
    }

    const original = current.bind(window);
    const wrapped = function getPortraitFightersWithMashtzarrFemaleFallback(...args) {
      const fighters = original(...args);
      if (!Array.isArray(fighters) || !fighters.length) return fighters;

      const male = fighters.find(fighter => normalizeSpeciesId(fighter?.speciesId) === 'mashtzarr' && fighterGender(fighter) === 'male');
      if (!male) return fighters;

      // Expose the known-good male fighter as the female candidate. Keep its
      // canonical id/assets so downstream resolvePortraitFighter() lands back
      // on the real male Mashtzarr sprites while the saved appearance remains female.
      const alias = { ...male, gender: 'female', __hobunjiMashtzarrFemaleFallback: true };
      const next = fighters.slice();
      const femaleIndex = next.findIndex(fighter => normalizeSpeciesId(fighter?.speciesId) === 'mashtzarr' && fighterGender(fighter) === 'female');
      if (femaleIndex >= 0) next[femaleIndex] = alias;
      else next.push(alias);
      return next;
    };
    wrapped.__hobunjiMashtzarrFemaleMaleFallback = true;
    wrapped.__hobunjiOriginalGetPortraitFighters = current;
    window.getPortraitFighters = wrapped;
    portraitFallbackInstalled = true;
    status.portraitFallbackInstalled = true;
    return true;
  }

  function installRandomizerFallback() {
    const current = window.randomPortraitProfileSeeded;
    if (typeof current !== 'function') return false;
    if (current.__hobunjiMashtzarrFemaleNoFacialHair) {
      randomizerFallbackInstalled = true;
      status.randomizerFallbackInstalled = true;
      return true;
    }

    const wrapped = function randomPortraitProfileSeededWithoutFemaleMashtzarrFacialHair(...args) {
      const profile = current.apply(this, args);
      const fighters = args[1];
      if (Array.isArray(fighters) && fighters.some(isFemaleMashtzarrFallbackFighter)) {
        stripFemaleFacialHair(profile);
      }
      return profile;
    };
    wrapped.__hobunjiMashtzarrFemaleNoFacialHair = true;
    wrapped.__hobunjiOriginalRandomPortraitProfileSeeded = current;
    window.randomPortraitProfileSeeded = wrapped;
    randomizerFallbackInstalled = true;
    status.randomizerFallbackInstalled = true;
    return true;
  }

  function ensureRuntimeFallbacks() {
    const portraitReady = installMalePortraitFallback();
    const randomizerReady = installRandomizerFallback();
    if (portraitReady && randomizerReady) return;
    requestAnimationFrame(ensureRuntimeFallbacks); // portrait-utils may finish loading after this compatibility layer.
  }

  installSpeciesTableCapture();
  ensureRuntimeFallbacks();

  window[PATCH_ID] = Object.freeze({
    fallbackMode: 'male-mashtzarr',
    hydratePrivateSpeciesTable,
    installMalePortraitFallback,
    installRandomizerFallback,
    stripFemaleFacialHair,
    status,
    get speciesTableCaptured() { return speciesTableCaptured; },
    get entriesWrapped() { return entriesWrapped; },
    get portraitFallbackInstalled() { return portraitFallbackInstalled; },
    get randomizerFallbackInstalled() { return randomizerFallbackInstalled; },
  });
})();
