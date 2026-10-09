// Pants Rig Author: initialize the canonical portrait registry before the author boots.
// Loading portrait-utils.js alone leaves its fallback Mao'ao-only fighter table in place;
// loadPortraitCosmetics() is what replaces that fallback with config/species/index.json.
(() => {
  'use strict';

  if (window.PantsRigPortraitBootstrap?.ready) return;

  const state = { // Mobile-readable proof that the embedded author actually loaded the full portrait registry.
    started: false,
    ready: false,
    fighterCount: 0,
    fighterKeys: [],
    error: null,
  };

  function fighterKey(fighter) {
    const species = String(fighter?.speciesId || fighter?.id || '').trim().toLowerCase().replace(/_/g, '-');
    const gender = String(fighter?.gender || '').trim().toLowerCase();
    return `${species}::${gender}`;
  }

  async function initialize() {
    state.started = true;
    window.setPortraitAssetBase?.('../../assets/'); // Matches every other repository portrait authoring tool.

    if (typeof window.NpcAvatarPreview?.ensurePortraitCosmetics === 'function') {
      await window.NpcAvatarPreview.ensurePortraitCosmetics({
        assetBase: '../../assets/',
        configBase: '../../config/',
      }); // Populates portrait-utils' live FIGHTERS registry from the canonical cosmetics/species config.
    } else if (typeof window.loadPortraitCosmetics === 'function') {
      await window.loadPortraitCosmetics('../../config/');
    } else {
      throw new Error('Canonical portrait cosmetics loader is unavailable.');
    }

    const fighters = (window.getPortraitFighters?.() || []).filter(fighter =>
      fighter && fighter.speciesId && fighter.gender && Array.isArray(fighter.bodyLayers));
    const unique = [];
    const seen = new Set();
    for (const fighter of fighters) {
      const key = fighterKey(fighter);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(key);
    }
    state.fighterCount = unique.length;
    state.fighterKeys = unique;
    state.ready = unique.length > 0;
    if (!state.ready) throw new Error('Portrait cosmetics loaded but no species/gender fighters were registered.');
    console.info(`[Pants Rig Author] Canonical portrait registry ready: ${unique.length} species/gender entries.`, unique);
    return state;
  }

  const ready = initialize().catch(error => {
    state.error = error?.message || String(error);
    state.ready = false;
    console.error('[Pants Rig Author] Portrait runtime bootstrap failed.', error);
    throw error;
  });

  window.PantsRigPortraitBootstrap = Object.freeze({
    ready,
    snapshot: () => ({ ...state, fighterKeys: [...state.fighterKeys] }),
  });
})();
