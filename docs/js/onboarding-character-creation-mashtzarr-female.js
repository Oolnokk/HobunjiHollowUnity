// Character-creator compatibility bridge: female Mashtzarr temporarily reuse the male Mashtzarr visual/profile data.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingMashtzarrFemale'; // Prevents duplicate installation if the onboarding bootstrap is replayed from cache.
  if (window[PATCH_ID]) return;

  let observedOverlay = null; // Overlay whose direct card replacements are currently watched.
  let overlayObserver = null; // Direct-child-only observer; avoids the creator's old recursive nested-mutation freeze.
  let bodyObserver = null; // Reattaches the overlay observer when save-select/new-farmer swaps the overlay node.
  let temporaryFemaleGetter = null; // Narrow one-click bridge used to hydrate the core's private Mashtzarr species object.
  let portraitFallbackInstalled = false; // Tracks whether getPortraitFighters now aliases female Mashtzarr to the male fighter.

  const status = {
    fallbackMode: 'male-mashtzarr',
    portraitFallbackInstalled: false,
    lastError: null,
  }; // Mobile-readable status without requiring DevTools.

  function creatorOverlay() {
    const overlay = document.getElementById('ob-overlay');
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function mashtzarrIsActive(overlay = creatorOverlay()) {
    return !!overlay?.querySelector('[data-ob-species="mashtzarr"].ob-active');
  }

  function normalizeSpeciesId(value) {
    return String(value || '').replace(/_/g, '-').toLowerCase();
  }

  function fighterGender(fighter) {
    return String(fighter?.gender ?? (fighter?.id === 'M' ? 'male' : fighter?.id === 'F' ? 'female' : '')).toLowerCase();
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

      // Keep the male fighter's canonical id/assets so downstream portrait resolution
      // lands on the real male Mashtzarr data, but expose it as a female candidate so
      // callers selecting species+gender can still save/use gender:'female'.
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

  function enableFemaleButton() {
    const overlay = creatorOverlay();
    if (!overlay || !mashtzarrIsActive(overlay)) return;
    const button = overlay.querySelector('[data-ob-gender="female"]');
    if (!button) return;
    button.disabled = false;
    button.classList.remove('ob-disabled');
    button.removeAttribute('aria-disabled');
    button.title = 'Female (temporarily uses male Mashtzarr visuals)';
  }

  // onboarding-core keeps SPECIES_DATA private. Its normal gender handler already
  // does everything needed once SPECIES_DATA.mashtzarr.female exists, so for the
  // first female click we temporarily expose a getter on Object.prototype. The
  // getter only recognizes that private Mashtzarr species object, installs its own
  // `.female` property pointing at its already-working `.male` data, adds female to
  // the private gender list, then removes itself after the event dispatch.
  function armPrivateSpeciesHydration() {
    if (temporaryFemaleGetter || Object.prototype.hasOwnProperty.call(Object.prototype, 'female')) return;

    temporaryFemaleGetter = function mashtzarrFemaleGetter() {
      if (this?.label !== 'Mashtzarr' || !Array.isArray(this?.genders) || !this?.male) return undefined;
      Object.defineProperty(this, 'female', {
        value: this.male,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      if (!this.genders.includes('female')) this.genders.push('female');
      return this.male;
    };

    Object.defineProperty(Object.prototype, 'female', {
      configurable: true,
      enumerable: false,
      get: temporaryFemaleGetter,
    });

    queueMicrotask(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'female');
      if (descriptor?.get === temporaryFemaleGetter) delete Object.prototype.female;
      temporaryFemaleGetter = null;
    });
  }

  function onCaptureClick(event) {
    const button = event.target?.closest?.('[data-ob-gender="female"]');
    if (!button || button.disabled || !mashtzarrIsActive()) return;
    armPrivateSpeciesHydration(); // Runs before onboarding-core's existing bubble-phase gender listener.
  }

  function attachOverlayObserver() {
    const overlay = document.getElementById('ob-overlay');
    if (overlay === observedOverlay) {
      enableFemaleButton();
      return;
    }
    overlayObserver?.disconnect();
    observedOverlay = overlay;
    if (!overlay) return;
    overlayObserver = new MutationObserver(enableFemaleButton);
    overlayObserver.observe(overlay, { childList: true }); // Core replaces the card directly; nested creator inserts cannot recurse here.
    enableFemaleButton();
  }

  function installObservers() {
    const start = () => {
      if (!bodyObserver) {
        bodyObserver = new MutationObserver(attachOverlayObserver);
        bodyObserver.observe(document.body, { childList: true });
      }
      attachOverlayObserver();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  document.addEventListener('click', onCaptureClick, true);
  installMalePortraitFallback();
  installObservers();

  window[PATCH_ID] = Object.freeze({
    fallbackMode: 'male-mashtzarr',
    enableFemaleButton,
    installMalePortraitFallback,
    status,
    get portraitFallbackInstalled() { return portraitFallbackInstalled; },
  });
})();
