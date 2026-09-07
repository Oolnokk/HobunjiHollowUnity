// Character-creator compatibility bridge for the already-authored female Mashtzarr profile.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingMashtzarrFemale'; // Prevents duplicate installation if the onboarding bootstrap is replayed from cache.
  const NASHKA_ID = 'nashka_khibu'; // Canonical NPC whose authored hairstyle group is shared with playable female Mashtzarr.
  const HAIR_SLOTS = Object.freeze(['hairFront', 'hairBack', 'hairSide', 'hairSideL']); // Appearance slots that make up one hairstyle group.
  if (window[PATCH_ID]) return;

  let observedOverlay = null; // Overlay whose direct card replacements are currently watched.
  let overlayObserver = null; // Direct-child-only observer; avoids the creator's old recursive nested-mutation freeze.
  let bodyObserver = null; // Reattaches the overlay observer when save-select/new-farmer swaps the overlay node.
  let temporaryFemaleGetter = null; // Narrow one-click bridge used to hydrate the core's private Mashtzarr species object.
  let nashkaHairPromise = null; // One async lookup shared by every creator rerender.
  let nashkaHairGroups = []; // Cosmetic-id namespace prefixes actually used by Nashka Khibu.

  const status = {
    nashkaHairState: 'pending',
    nashkaHairGroups: [],
    addedOptions: 0,
    lastError: null,
  }; // Mobile-readable status without requiring DevTools.

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

  function femaleMashtzarrIsActive(overlay = creatorOverlay()) {
    return mashtzarrIsActive(overlay) && !!overlay?.querySelector('[data-ob-gender="female"].ob-active');
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

  function npcRecords(data) {
    if (Array.isArray(data)) return data.filter(Boolean);
    if (!data || typeof data !== 'object') return [];
    for (const key of ['npcs', 'characters', 'records']) {
      if (Array.isArray(data[key])) return data[key].filter(Boolean);
    }
    return Object.values(data).filter(value => value && typeof value === 'object' && (value.id || value.name));
  }

  function normalizedNpcKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function cosmeticGroupPrefix(cosmeticId) {
    const id = String(cosmeticId || '');
    const match = id.match(/^(appearance::[^:]+::)/i);
    return match ? match[1] : null;
  }

  function nashkaFromDatabase(data) {
    return npcRecords(data).find(npc => normalizedNpcKey(npc?.id) === NASHKA_ID || normalizedNpcKey(npc?.name) === NASHKA_ID) || null;
  }

  function groupPrefixesFromNashka(npc) {
    const cosmetics = npc?.appearance?.cosmetics || {};
    const prefixes = new Set();
    for (const slot of HAIR_SLOTS) {
      const prefix = cosmeticGroupPrefix(cosmetics[slot]);
      if (prefix) prefixes.add(prefix);
    }
    return [...prefixes];
  }

  function mergeHairOptionsIntoFemaleData(cosmetics, prefixes) {
    const femaleData = configuredFemaleData();
    if (!femaleData || !Array.isArray(femaleData.slots) || !prefixes.length) return 0;
    const arrays = {
      hairFront: cosmetics?.hairFrontOptions || [],
      hairBack: cosmetics?.hairBackOptions || [],
      hairSide: cosmetics?.hairSideOptions || [],
      hairSideL: cosmetics?.hairSideLOptions || [],
    };
    const labels = {
      hairFront: 'Front Hair',
      hairBack: 'Back Hair',
      hairSide: 'Side Hair (R)',
      hairSideL: 'Side Hair (L)',
    };
    let added = 0;

    for (const slot of HAIR_SLOTS) {
      const groupOptions = arrays[slot].filter(option => {
        const id = String(option?.id || '');
        return id && prefixes.some(prefix => id.startsWith(prefix));
      });
      if (!groupOptions.length) continue;

      let slotDef = femaleData.slots.find(entry => entry?.slot === slot);
      if (!slotDef) {
        slotDef = { slot, label: labels[slot], options: [{ id: null, label: 'None' }] };
        femaleData.slots.push(slotDef);
      }
      if (!Array.isArray(slotDef.options)) slotDef.options = [{ id: null, label: 'None' }];
      const existing = new Set(slotDef.options.map(option => String(option?.id || '')));
      for (const option of groupOptions) {
        if (existing.has(String(option.id))) continue;
        slotDef.options.push({ id: option.id, label: option.label || option.id });
        existing.add(String(option.id));
        added += 1;
      }
    }
    return added;
  }

  function syncVisibleHairControls() {
    const overlay = creatorOverlay();
    const femaleData = configuredFemaleData();
    if (!overlay || !femaleMashtzarrIsActive(overlay) || !Array.isArray(femaleData?.slots)) return;
    for (const slotDef of femaleData.slots) {
      if (!HAIR_SLOTS.includes(slotDef?.slot)) continue;
      const select = overlay.querySelector(`[data-ob-slot="${slotDef.slot}"]`);
      if (!select) continue;
      const existing = new Set([...select.options].map(option => option.value));
      for (const option of (slotDef.options || [])) {
        const value = option?.id || '';
        if (existing.has(value)) continue;
        const node = document.createElement('option');
        node.value = value;
        node.textContent = option?.label || value || 'None';
        select.appendChild(node);
        existing.add(value);
      }
    }
  }

  async function hydrateNashkaHairstyles() {
    if (nashkaHairPromise) return nashkaHairPromise;
    nashkaHairPromise = (async () => {
      try {
        const response = await fetch('./config/npcs/hobunji-starter-npc-database.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`NPC database HTTP ${response.status}`);
        const database = await response.json();
        const nashka = nashkaFromDatabase(database);
        if (!nashka) throw new Error('Nashka Khibu is missing from the starter NPC database');
        const prefixes = groupPrefixesFromNashka(nashka);
        if (!prefixes.length) throw new Error('Nashka Khibu has no namespaced authored hairstyle cosmetic to identify her group');

        const cosmetics = window.NpcAvatarPreview?.ensurePortraitCosmetics
          ? await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: './assets/', configBase: './config/' })
          : await window.loadPortraitCosmetics?.('./config/');
        if (!cosmetics) throw new Error('Portrait cosmetics were unavailable while resolving Nashka hairstyle group');

        nashkaHairGroups = prefixes;
        const added = mergeHairOptionsIntoFemaleData(cosmetics, prefixes);
        status.nashkaHairState = 'ready';
        status.nashkaHairGroups = [...prefixes];
        status.addedOptions = added;
        status.lastError = null;
        syncVisibleHairControls();
        return prefixes;
      } catch (error) {
        status.nashkaHairState = 'error';
        status.lastError = error?.message || String(error);
        console.warn('[onboarding-mashtzarr-female] Nashka hairstyle group lookup failed', error);
        return [];
      }
    })();
    return nashkaHairPromise;
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
      syncVisibleHairControls();
      return;
    }
    overlayObserver?.disconnect();
    observedOverlay = overlay;
    if (!overlay) return;
    overlayObserver = new MutationObserver(() => {
      enableFemaleButton();
      syncVisibleHairControls();
    });
    overlayObserver.observe(overlay, { childList: true }); // Core replaces the card directly on rerender; nested creator inserts cannot recurse here.
    enableFemaleButton();
    syncVisibleHairControls();
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
  hydrateNashkaHairstyles();
  installObservers();
  window[PATCH_ID] = Object.freeze({ configuredFemaleData, enableFemaleButton, hydrateNashkaHairstyles, status, get nashkaHairGroups() { return [...nashkaHairGroups]; } });
})();
