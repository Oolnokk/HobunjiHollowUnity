// Character-creator compatibility bridge for the already-authored female Mashtzarr profile.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingMashtzarrFemale'; // Prevents duplicate installation if the onboarding bootstrap is replayed from cache.
  if (window[PATCH_ID]) return;

  let observedOverlay = null; // Overlay whose direct card replacements are currently watched.
  let overlayObserver = null; // Direct-child-only observer; avoids the creator's old recursive nested-mutation freeze.
  let bodyObserver = null; // Reattaches the overlay observer when save-select/new-farmer swaps the overlay node.
  let temporaryFemaleGetter = null; // Narrow one-click bridge used to hydrate the core's private Mashtzarr species object.

  function configuredFemaleData() {
    return window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species?.mashtzarr?.female || null;
  }

  function creatorOverlay() {
    const overlay = document.getElementById('ob-overlay');
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function mashtzarrIsActive(overlay = creatorOverlay()) {
    return !!overlay?.querySelector('[data-ob-species="mashtzarr"].ob-active');
  }

  function enableFemaleButton() {
    const overlay = creatorOverlay();
    if (!overlay || !mashtzarrIsActive(overlay) || !configuredFemaleData()) return;
    const button = overlay.querySelector('[data-ob-gender="female"]');
    if (!button) return;
    button.disabled = false;
    button.classList.remove('ob-disabled');
    button.removeAttribute('aria-disabled');
    button.title = 'Female';
  }

  // onboarding-core intentionally keeps its species table private. Its generic
  // gender listener is nevertheless already attached to both gender buttons and
  // can handle female correctly as soon as SPECIES_DATA.mashtzarr.female exists.
  // Install a prototype getter only for the capture→bubble duration of the FIRST
  // female-Mashtzarr click. When the core asks its private Mashtzarr object for
  // `.female`, the getter recognizes that exact shape, copies in the canonical
  // config profile as an OWN property, adds female to its private genders array,
  // and immediately becomes unnecessary. This avoids maintaining a second copy
  // of the authored female slots/palette while keeping the global prototype clean
  // outside that one event dispatch.
  function armPrivateSpeciesHydration() {
    if (temporaryFemaleGetter || Object.prototype.hasOwnProperty.call(Object.prototype, 'female')) return;
    const femaleData = configuredFemaleData();
    if (!femaleData) return;

    temporaryFemaleGetter = function mashtzarrFemaleGetter() {
      if (this?.label !== 'Mashtzarr' || !Array.isArray(this?.genders) || !this?.male) return undefined;
      Object.defineProperty(this, 'female', {
        value: femaleData,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      if (!this.genders.includes('female')) this.genders.push('female');
      return femaleData;
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
    overlayObserver.observe(overlay, { childList: true }); // Core replaces the card directly on rerender; nested creator inserts cannot recurse here.
    enableFemaleButton();
  }

  function installObservers() {
    const start = () => {
      if (!bodyObserver) {
        bodyObserver = new MutationObserver(() => {
          attachOverlayObserver();
          enableFemaleButton();
        });
        bodyObserver.observe(document.body, { childList: true });
      }
      attachOverlayObserver();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  document.addEventListener('click', onCaptureClick, true);
  installObservers();
  window[PATCH_ID] = Object.freeze({ configuredFemaleData, enableFemaleButton });
})();
