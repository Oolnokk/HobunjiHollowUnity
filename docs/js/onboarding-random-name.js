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

  function editDistance(a, b) {
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i); // Dynamic-programming row used to count spelling edits.
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = previous[j];
        previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return previous[b.length];
  }

  function suggestionRank(name, idea, originalIndex) {
    const candidate = String(name || '').toLowerCase(); // Case-folded spelling used only for ranking.
    const source = String(idea || '').toLowerCase(); // Keeps edit comparison independent of display capitalization.
    const distance = editDistance(candidate, source); // Finds the smallest number of edits needed for a lore spelling.
    const sameLength = candidate.length === source.length; // Gives substitution-only repairs priority when edit counts tie.
    const lengthChange = Math.abs(candidate.length - source.length); // Penalizes inserted or removed letters after edit distance.
    return { name, distance, sameLength, lengthChange, originalIndex };
  }

  function suggestNames(text, speciesId, gender, maxLength = 32) {
    const speciesKeys = { kenkari: 'kenkari', 'mao-ao': 'mao', 'engh-sho': 'engh', tletingan: 'slagothim', nuhongan: 'slagothim', slagothim: 'slagothim' };
    const speciesKey = speciesKeys[normalizeSpecies(speciesId)];
    const idea = String(text || '').slice(0, maxLength).trim();
    if (!speciesKey || !/[a-z]/i.test(idea.normalize('NFD')) || !window.HobunjiNameAdvisor) return [];
    const options = window.HobunjiNameAdvisor.makeIdeaOptions(speciesKey, speciesKey === 'slagothim' ? 'given' : 'first', idea, { gender: normalizeGender(gender) });
    const seen = new Set([idea.toLowerCase()]);
    return options.map((option, originalIndex) => ({ name: option.label, originalIndex }))
      .filter(({ name }) => {
        const key = String(name || '').toLowerCase();
        if (!name || name.length > maxLength || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .filter(({ name }) => speciesKey !== 'slagothim' || isValidSlagothimSuggestion(name, gender))
      .map(({ name, originalIndex }) => suggestionRank(name, idea, originalIndex))
      .sort((a, b) => a.distance - b.distance || Number(b.sameLength) - Number(a.sameLength) || a.lengthChange - b.lengthChange || a.substitutions - b.substitutions || a.originalIndex - b.originalIndex)
      .slice(0, 4)
      .map(entry => entry.name);
  }

  function isValidSlagothimSuggestion(name, gender) {
    const lower = String(name || '').toLowerCase();
    const female = normalizeGender(gender) === 'female';
    const suffix = female ? 'mira' : 'mir';
    const vowels = new Set('aeiou');
    const first = ['sl', 'shr', 'tr', 'gr', 'br', 'gl', 'b', 'g', 'n', 'p', 't', 'd', 'k', 'm'];
    const second = ['b', 'g', 'p', 't', 'd', 'k', 'r', 'n', 'ng', 'mn'];
    const allowedLetters = new Set([...vowels, ...'bgnptdkmrslh']);
    if (!lower.endsWith(suffix) || ![...lower].every(char => allowedLetters.has(char))) return false;
    const onset = first.slice().sort((a, b) => b.length - a.length).find(token => lower.startsWith(token));
    if (!onset) return false;
    const stem = lower.slice(onset.length, -suffix.length);
    if (!stem || !vowels.has(stem[0])) return false;
    const runs = stem.slice(1).match(/[bcdfghjklmnpqrstvwxyz]+/g) || [];
    return runs.every(run => second.includes(run));
  }
  function refreshSuggestions(overlay, input, suggestions) {
    const identity = activeIdentity(overlay); // Uses the same selected species/gender authority as random naming.
    const names = identity ? suggestNames(input.value, identity.speciesId, identity.gender, input.maxLength > 0 ? input.maxLength : 32) : []; // Current choices rendered directly beneath the input.
    suggestions.replaceChildren();
    suggestions.hidden = names.length === 0;
    for (const name of names) {
      const button = document.createElement('button'); // One compact, keyboard/mobile-accessible name choice.
      button.type = 'button';
      button.className = 'ob-sel-btn ob-name-suggestion';
      button.textContent = name;
      button.addEventListener('click', () => {
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      suggestions.appendChild(button);
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
#ob-overlay .ob-name-suggestions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
#ob-overlay .ob-name-suggestions[hidden]{display:none}
#ob-overlay .ob-name-suggestion{font-size:10px;padding:4px 7px;min-height:28px;max-width:100%;overflow-wrap:anywhere;opacity:.78}
#ob-overlay .ob-name-suggestion:hover,#ob-overlay .ob-name-suggestion:focus-visible{opacity:1}
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

    let suggestions = overlay.querySelector('.ob-name-suggestions'); // Reuses one suggestion row per rendered creator card.
    if (!suggestions) {
      suggestions = document.createElement('div');
      suggestions.className = 'ob-name-suggestions';
      suggestions.hidden = true;
      row.after(suggestions);
      input.addEventListener('input', event => {
        if (!event.isComposing) refreshSuggestions(overlay, input, suggestions);
      });
      input.addEventListener('compositionend', () => refreshSuggestions(overlay, input, suggestions));
      refreshSuggestions(overlay, input, suggestions);
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
    suggestNames, // Available to the existing in-page developer diagnostics and regression tests.
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
