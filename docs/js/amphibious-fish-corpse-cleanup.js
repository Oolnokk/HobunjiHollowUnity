// Cleanup/presentation adapter for amphibious-fish corpses and land Gurumahi.
// Loaded after amphibious-fishing.js so exact-fish retrieval can use BanditCamps'
// private cleanup deps and land fish can reuse FishCatalog's authored item render.
(() => {
  'use strict';

  const GURUMAHI_LAND_MODEL_WIDTH = 0.22; // Used to keep the Gurumahi land/combat form at one tenth of its original 2.2-unit width.
  const GURUMAHI_SPRITE_PATH = 'assets/objectsprites/fish_gurumahi.png'; // Used as the same source sprite the inventory fish renderer recolors/shades.
  let corpseDeps = null; // Used to grant/save the fish and fully despawn retrieved corpses through the existing corpse-loot pipeline.
  let spawnDeps = null; // Used to update live land Gurumahi frames through the ordinary creature renderer.
  let presentationLoopStarted = false; // Used to install only one live-creature shading pass.
  const landFrameUrlByKey = new Map(); // Used to cache one FishCatalog-rendered data URL per Gurumahi variant.

  function wrap(api) {
    if (!api?.init || !api?.makeCorpseWorldObject || api.__amphibiousFishCorpseCleanupWrapped) return api;
    const originalInit = api.init;
    const originalMake = api.makeCorpseWorldObject;
    api.init = injectedDeps => {
      corpseDeps = injectedDeps;
      return originalInit.call(api, injectedDeps);
    };
    api.makeCorpseWorldObject = c => {
      if (!c?.isAmphibiousFishCorpse) return originalMake.call(api, c);
      const key = c._amphibiousFishItemKey;
      const label = c._amphibiousFishLabel || window.FishCatalog?.get?.(key)?.label || 'amphibious fish';
      const stars = Math.max(1, Math.min(5, Math.round(Number(c._amphibiousFishStars) || 3)));
      return {
        id: 'corpse_' + c.id,
        type: 'amphibious_fish_corpse',
        promptRoot: c.avatarRef?.group || null,
        getButtons() {
          return [{ icon: '🐟', label: 'Retrieve ' + label, action: 'obj_loot_corpse', style: 'primary', allowed: true }];
        },
        onAction(action) {
          if (action !== 'obj_loot_corpse') return { ok: false, message: 'Unknown action.' };
          if (!key || !corpseDeps?.inventory) return { ok: false, message: 'The fish could not be retrieved.' };
          corpseDeps.inventory[key] = Math.min(99, (corpseDeps.inventory[key] || 0) + 1);
          corpseDeps.clampInventoryStack?.(key);
          window.CookingSystem?.recordItemQuality?.(key, stars, 1);
          corpseDeps.corpseObjects?.delete?.(c);
          corpseDeps.despawnCreature?.(c);
          corpseDeps.refreshItemScroll?.();
          corpseDeps.buildInventoryGrid?.();
          corpseDeps.refreshActionBar?.();
          corpseDeps.saveMemberWorldData?.();
          window.__farmLog?.(`[amphibious-fishing] retrieved ${stars}★ ${label} from corpse #${c.id}`, 'fish');
          return { ok: true, message: `Retrieved ${stars}★ ${label}.` };
        },
      };
    };
    Object.defineProperty(api, '__amphibiousFishCorpseCleanupWrapped', { value: true, configurable: true });
    return api;
  }

  function landFrameUrl(key) {
    if (!key || !window.FishCatalog?.getRecoloredCanvas) return Promise.resolve(null);
    if (!landFrameUrlByKey.has(key)) {
      const promise = window.FishCatalog.getRecoloredCanvas(GURUMAHI_SPRITE_PATH, key)
        .then(canvas => canvas?.toDataURL?.('image/png') || null)
        .catch(error => {
          landFrameUrlByKey.delete(key);
          window.__farmLog?.(`[amphibious-fishing] Gurumahi land shading failed for ${key}: ${error?.message || error}`, 'fish');
          return null;
        });
      landFrameUrlByKey.set(key, promise);
    }
    return landFrameUrlByKey.get(key);
  }

  function applyLandPresentation(creature) {
    const key = creature?._amphibiousFishItemKey;
    if (!key || creature._amphibiousLandPresentationPending || creature._amphibiousLandPresentationApplied) return;
    creature._amphibiousLandPresentationPending = true;
    landFrameUrl(key).then(frameUrl => {
      creature._amphibiousLandPresentationPending = false;
      if (!frameUrl || creature.state === 'corpse') return;
      // Clone the per-creature definition so different Gurumahi variants can
      // coexist without overwriting the shared species sprite for one another.
      creature.def = {
        ...(creature.def || {}),
        modelWidth: GURUMAHI_LAND_MODEL_WIDTH,
        sprites: { idle: frameUrl, run: [frameUrl, frameUrl] },
      };
      creature.visualModelWidth = GURUMAHI_LAND_MODEL_WIDTH;
      const genotypeKind = spawnDeps?.genotypeKindFor?.(creature) || null;
      spawnDeps?.setCreatureFrame?.(creature.avatarRef, frameUrl, genotypeKind, 'idle', creature.genotype);
      creature.currentFrameUrl = frameUrl;
      creature._amphibiousLandPresentationApplied = true;
      window.__farmLog?.(`[amphibious-fishing] land ${key} now uses FishCatalog item shading at width=${GURUMAHI_LAND_MODEL_WIDTH}`, 'fish');
    });
  }

  function presentationLoop() {
    for (const creature of spawnDeps?.hostileObjects || []) {
      if (creature?._amphibiousFishItemKey) applyLandPresentation(creature);
    }
    requestAnimationFrame(presentationLoop);
  }

  function wrapWildlifeSpawn(api) {
    if (!api?.init || api.__gurumahiLandScaleWrapped) return api;
    const originalInit = api.init;
    api.init = injectedDeps => {
      const result = originalInit.call(api, injectedDeps);
      spawnDeps = injectedDeps;
      const def = injectedDeps?.CREATURE_DB?.gurumahi;
      if (def?.amphibiousFish) {
        def.modelWidth = GURUMAHI_LAND_MODEL_WIDTH;
        window.__farmLog?.(`[amphibious-fishing] Gurumahi land width=${GURUMAHI_LAND_MODEL_WIDTH}`, 'fish');
      }
      if (!presentationLoopStarted) {
        presentationLoopStarted = true;
        requestAnimationFrame(presentationLoop);
      }
      return result;
    };
    Object.defineProperty(api, '__gurumahiLandScaleWrapped', { value: true, configurable: true });
    return api;
  }

  function hookWindowApi(name, wrapper) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: () => descriptor.get.call(window),
        set: value => {
          descriptor.set.call(window, value);
          wrapper(descriptor.get.call(window));
        },
      });
      wrapper(descriptor.get.call(window));
      return;
    }
    wrapper(window[name]);
  }

  hookWindowApi('BanditCamps', wrap);
  hookWindowApi('WildlifeSpawn', wrapWildlifeSpawn);
})();
