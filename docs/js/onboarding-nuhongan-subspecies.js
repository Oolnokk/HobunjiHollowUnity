// Activates the existing Slagothim -> Nuhongan placeholder without promoting
// Nuhongan to the creator's top-level species row. onboarding-core still owns
// the actual saved speciesId; this adapter only maps the redesigned family UI
// onto that core button and repairs the family panel after core rerenders.
(() => {
  'use strict';

  const PATCH_ID = 'HOBUNJI_NUHONGAN_SUBSPECIES_STATUS'; // Mobile-readable creator integration status.
  if (window[PATCH_ID]?.installed) return;

  const status = {
    installed: true,
    coreSpeciesAvailable: false,
    placeholderActivated: false,
    topLevelHidden: false,
    active: false,
    lastError: null,
  }; // Used by Pixel Probe / mobile debugging when DevTools are unavailable.
  window[PATCH_ID] = status;

  let queued = false; // Coalesces onboarding-core + redesign DOM mutations into one repair pass.
  let bodyObserver = null; // Watches only for creator overlay mount/unmount.
  let overlayObserver = null; // Watches creator card replacement so the adapter survives core rerenders.
  let observedOverlay = null; // Tracks which overlay currently owns overlayObserver.

  const overlayElement = () => document.getElementById('ob-overlay');
  const coreButton = (overlay, speciesId) => overlay?.querySelector(`[data-ob-species="${speciesId}"]`) || null;
  const activeSpecies = overlay => String(overlay?.querySelector('[data-ob-species].ob-active')?.dataset?.obSpecies || '').toLowerCase();

  function familyDescriptionHtml(activeId) {
    const activeLabel = activeId === 'nuhongan' ? 'Nuhongan' : 'Tletingan';
    const activeText = activeId === 'nuhongan'
      ? 'A smaller Slagothim subspecies using the same authored Tletingan appearance and anatomy: 75% of Tletingan height and 80% of Tletingan width.'
      : 'Natives of the islands of Tletinga-taru and Tletinga-iku. The most populous of the Slagothim subspecies.';
    return `
      <div class="ob-species-description"><strong>Slagothim</strong>Sloth-folk of the Northern Archipelago, and the lifeblood of cross-continental trade.</div>
      <div class="ob-subspecies-wrap">
        <div class="ob-subspecies-title">Slagothim subspecies</div>
        <div class="ob-subspecies-group">
          <button type="button" class="ob-sel-btn${activeId === 'tletingan' ? ' ob-active' : ''}" data-ob-subspecies="tletingan">Tletingan</button>
          <button type="button" class="ob-sel-btn${activeId === 'nuhongan' ? ' ob-active' : ''}" data-ob-subspecies="nuhongan">Nuhongan</button>
          <button type="button" class="ob-sel-btn ob-disabled ob-subspecies-unavailable" data-ob-subspecies="longoran" disabled>Longoran</button>
        </div>
        <div class="ob-subspecies-description"><strong>${activeLabel}:</strong> ${activeText}</div>
      </div>`;
  }

  function bindSubspeciesButtons(overlay) {
    for (const button of overlay.querySelectorAll('[data-ob-subspecies]')) {
      const speciesId = button.dataset.obSubspecies;
      if (speciesId === 'nuhongan') {
        button.disabled = false;
        button.classList.remove('ob-disabled', 'ob-subspecies-unavailable');
        status.placeholderActivated = true;
      }
      if ((speciesId === 'tletingan' || speciesId === 'nuhongan') && button.dataset.nuhonganBound !== '1') {
        button.dataset.nuhonganBound = '1';
        button.addEventListener('click', event => {
          event.preventDefault();
          coreButton(overlay, speciesId)?.click();
        });
      }
    }
  }

  function enhance() {
    queued = false;
    try {
      const overlay = overlayElement();
      if (!overlay) return;
      const tletingan = coreButton(overlay, 'tletingan');
      const nuhongan = coreButton(overlay, 'nuhongan');
      status.coreSpeciesAvailable = !!nuhongan;
      if (!tletingan || !nuhongan) return;

      // Both real core buttons remain state owners but never appear as separate
      // top-level species beside the Slagothim family button.
      tletingan.hidden = true;
      nuhongan.hidden = true;
      status.topLevelHidden = true;

      const current = activeSpecies(overlay);
      status.active = current === 'nuhongan';
      const familyButton = overlay.querySelector('[data-ob-family="slagothim"]');
      if (familyButton) familyButton.classList.toggle('ob-active', current === 'tletingan' || current === 'nuhongan');

      // The redesign's original Nuhongan placeholder was deliberately disabled.
      // When Nuhongan is active its private familyOpen flag is reset by the core
      // species click, so rebuild only that one family-details panel here.
      if (current === 'nuhongan') {
        const group = familyButton?.closest?.('.ob-group') || tletingan.closest?.('.ob-group');
        const oldDetails = group?.parentElement?.querySelector('[data-ob-redesign-details="1"]');
        if (group) {
          const details = oldDetails || document.createElement('div');
          details.dataset.obRedesignDetails = '1';
          details.innerHTML = familyDescriptionHtml('nuhongan');
          if (!oldDetails) group.after(details);
        }
      }

      bindSubspeciesButtons(overlay);
      status.lastError = null;
    } catch (error) {
      status.lastError = String(error?.message || error);
    }
  }

  function scheduleEnhance() {
    if (queued) return;
    queued = true;
    queueMicrotask(enhance);
  }

  function observeOverlay() {
    const overlay = overlayElement();
    if (overlay === observedOverlay) return;
    overlayObserver?.disconnect();
    observedOverlay = overlay;
    if (!overlay) return;
    overlayObserver = new MutationObserver(scheduleEnhance);
    overlayObserver.observe(overlay, { childList: true });
    scheduleEnhance();
  }

  bodyObserver = new MutationObserver(() => {
    observeOverlay();
    scheduleEnhance();
  });
  if (document.body) bodyObserver.observe(document.body, { childList: true });
  else document.addEventListener('DOMContentLoaded', () => {
    bodyObserver.observe(document.body, { childList: true });
    observeOverlay();
  }, { once: true });

  observeOverlay();
  scheduleEnhance();
})();
