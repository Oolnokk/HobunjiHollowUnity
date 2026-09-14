// Hobunji Hollow — species/gender-aware random first names for character creation.
// Reuses the same BanditNameForge cultural generator as bandit identities; only givenName is used here.
(() => {
  'use strict';

  const MODULE_ID = 'hobunjiOnboardingRandomName'; // Used to prevent duplicate installation if onboarding assets are reloaded.
  if (window[MODULE_ID]) return;

  const status = {
    installed: true,
    speciesId: null,
    gender: null,
    cultureId: null,
    lastName: null,
    lastReason: null,
    rolls: 0,
    lastError: null,
  }; // Used by the creator's mobile-visible error state and optional diagnostics.

  let bodyObserver = null; // Watches only for the onboarding overlay being mounted or removed.
  let overlayObserver = null; // Watches direct onboarding-core card replacements inside the current overlay.
  let observedOverlay = null; // Overlay currently connected to overlayObserver.
  let enhanceQueued = false; // Coalesces mutation bursts from onboarding-core rerenders into one enhancement pass.
  let creatorSessionActive = false; // Distinguishes leaving character creation from merely switching to Collections.
  let lastAutoIdentityKey = null; // Prevents unrelated rerenders from changing a manually accepted/generated name.

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  }

  function currentOverlay() {
    return document.getElementById('ob-overlay');
  }

  function isCreatorFlow(overlay) {
    return !!overlay?.querySelector('[data-ob-tab="appearance"]');
  }

  function activeIdentity(overlay) {
    const speciesButton = overlay?.querySelector('[data-ob-species].ob-active');
    const genderButton = overlay?.querySelector('[data-ob-gender].ob-active');
    const speciesId = normalizeSpecies(speciesButton?.dataset?.obSpecies);
    const gender = normalizeGender(genderButton?.dataset?.obGender);
    return speciesId ? { speciesId, gender } : null;
  }

  function statusElement(overlay) {
    return overlay?.querySelector('[data-ob-random-name-status="1"]') || null;
  }

  function showError(overlay, message) {
    status.lastError = String(message || 'Unknown random-name error');
    const el = statusElement(overlay);
    if (!el) return;
    el.textContent = `Random-name generator unavailable: ${status.lastError}`;
    el.classList.add('ob-error');
    el.hidden = false;
  }

  function clearError(overlay) {
    status.lastError = null;
    const el = statusElement(overlay);
    if (!el) return;
    el.textContent = '';
    el.classList.remove('ob-error');
    el.hidden = true;
  }

  function generateFirstName(speciesId, gender) {
    const forge = window.BanditNameForge;
    if (!forge?.generateCulturalIdentity) throw new Error('BanditNameForge has not loaded');
    const identity = forge.generateCulturalIdentity({ speciesId, gender });
    const givenName = String(identity?.givenName || '').trim();
    if (!givenName) throw new Error(`BanditNameForge returned no givenName for ${speciesId}/${gender}`);
    return { givenName, cultureId: identity.cultureId || forge.cultureIdForSpecies?.(speciesId) || null };
  }

  function applyRandomName(overlay, reason = 'button') {
    const input = overlay?.querySelector('#ob-nickname');
    const identity = activeIdentity(overlay);
    if (!input || !identity) return false;

    try {
      const generated = generateFirstName(identity.speciesId, identity.gender);
      input.value = generated.givenName;
      input.dispatchEvent(new Event('input', { bubbles: true })); // Updates onboarding-core's authoritative _state.nickname.
      status.speciesId = identity.speciesId;
      status.gender = identity.gender;
      status.cultureId = generated.cultureId;
      status.lastName = generated.givenName;
      status.lastReason = reason;
      status.rolls += 1;
      clearError(overlay);
      return true;
    } catch (error) {
      showError(overlay, error?.message || error);
      return false;
    }
  }

  function installStyle() {
    if (document.getElementById(`${MODULE_ID}Style`)) return;
    const style = document.createElement('style');
    style.id = `${MODULE_ID}Style`;
    style.textContent = `
#ob-overlay .ob-random-name-row{display:flex;gap:6px;align-items:stretch}
#ob-overlay .ob-random-name-row .ob-input{flex:1 1 auto;min-width:0}
#ob-overlay .ob-random-name-btn{flex:0 0 auto;white-space:nowrap;padding-inline:10px}
#ob-overlay .ob-random-name-status{margin-top:5px;font-size:9px;line-height:1.35;color:#8aad8f}
#ob-overlay .ob-random-name-status.ob-error{color:#ffb59e}
@media (max-width:560px){#ob-overlay .ob-random-name-row{align-items:stretch}.ob-random-name-btn{padding-inline:8px!important}}
`;
    document.head.appendChild(style);
  }

  function ensureNameControls(overlay) {
    const input = overlay?.querySelector('#ob-nickname');
    if (!input) return null;

    let row = input.closest('.ob-random-name-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'ob-random-name-row';
      input.before(row);
      row.appendChild(input);
    }

    let button = row.querySelector('[data-ob-random-name="1"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ob-sel-btn ob-random-name-btn';
      button.dataset.obRandomName = '1';
      button.textContent = '🎲 Random Name';
      button.title = 'Generate a first name using the same species/gender cultural rules as bandits.';
      button.addEventListener('click', () => applyRandomName(overlay, 'button'));
      row.appendChild(button);
    }

    let diagnostic = statusElement(overlay);
    if (!diagnostic) {
      diagnostic = document.createElement('div');
      diagnostic.className = 'ob-random-name-status';
      diagnostic.dataset.obRandomNameStatus = '1';
      diagnostic.hidden = true;
      diagnostic.setAttribute('aria-live', 'polite');
      row.after(diagnostic);
    }

    return input;
  }

  function enhanceCreator() {
    enhanceQueued = false;
    const overlay = currentOverlay();
    const inCreator = isCreatorFlow(overlay);

    if (!inCreator) {
      creatorSessionActive = false;
      lastAutoIdentityKey = null;
      return;
    }

    if (!creatorSessionActive) {
      creatorSessionActive = true;
      lastAutoIdentityKey = null;
    }

    installStyle();
    const input = ensureNameControls(overlay);
    if (!input) return; // Collections tab: keep the session identity key, but there is no name field to enhance.

    const identity = activeIdentity(overlay);
    if (!identity) return;
    const identityKey = `${identity.speciesId}:${identity.gender}`;
    if (lastAutoIdentityKey === identityKey) return;

    const reason = lastAutoIdentityKey === null ? 'initial-species-gender' : 'species-gender-change';
    lastAutoIdentityKey = identityKey;
    applyRandomName(overlay, reason);
  }

  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    queueMicrotask(enhanceCreator);
  }

  function syncOverlayObserver() {
    const overlay = currentOverlay();
    if (overlay === observedOverlay) return;
    overlayObserver?.disconnect();
    overlayObserver = null;
    observedOverlay = overlay;
    if (overlay) {
      overlayObserver = new MutationObserver(queueEnhance);
      overlayObserver.observe(overlay, { childList: true });
    }
    queueEnhance();
  }

  function install() {
    installStyle();
    bodyObserver = new MutationObserver(syncOverlayObserver);
    bodyObserver.observe(document.body, { childList: true });
    syncOverlayObserver();
  }

  window[MODULE_ID] = {
    status,
    reroll() {
      return applyRandomName(currentOverlay(), 'debug-reroll');
    },
    generateFor(speciesId, gender) {
      return generateFirstName(normalizeSpecies(speciesId), normalizeGender(gender)).givenName;
    },
  };

  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
