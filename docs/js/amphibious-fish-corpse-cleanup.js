// Cleanup adapter for amphibious-fish corpses. Loaded after amphibious-fishing.js
// so its exact-fish Retrieve interaction uses BanditCamps' real corpse deps,
// including the game's private despawnCreature callback.
(() => {
  'use strict';

  const GURUMAHI_LAND_MODEL_WIDTH = 0.22; // Used to render the Gurumahi land/combat form at one tenth of its previous 2.2-unit width.
  let deps = null; // Used to grant/save the fish and fully despawn the retrieved corpse through the existing corpse-loot pipeline.

  function wrap(api) {
    if (!api?.init || !api?.makeCorpseWorldObject || api.__amphibiousFishCorpseCleanupWrapped) return api;
    const originalInit = api.init;
    const originalMake = api.makeCorpseWorldObject;
    api.init = injectedDeps => {
      deps = injectedDeps;
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
          if (!key || !deps?.inventory) return { ok: false, message: 'The fish could not be retrieved.' };
          deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + 1);
          deps.clampInventoryStack?.(key);
          window.CookingSystem?.recordItemQuality?.(key, stars, 1);
          deps.corpseObjects?.delete?.(c);
          deps.despawnCreature?.(c);
          deps.refreshItemScroll?.();
          deps.buildInventoryGrid?.();
          deps.refreshActionBar?.();
          deps.saveMemberWorldData?.();
          window.__farmLog?.(`[amphibious-fishing] retrieved ${stars}★ ${label} from corpse #${c.id}`, 'fish');
          return { ok: true, message: `Retrieved ${stars}★ ${label}.` };
        },
      };
    };
    Object.defineProperty(api, '__amphibiousFishCorpseCleanupWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapWildlifeSpawn(api) {
    if (!api?.init || api.__gurumahiLandScaleWrapped) return api;
    const originalInit = api.init;
    api.init = injectedDeps => {
      const result = originalInit.call(api, injectedDeps);
      const def = injectedDeps?.CREATURE_DB?.gurumahi;
      if (def?.amphibiousFish) {
        def.modelWidth = GURUMAHI_LAND_MODEL_WIDTH;
        window.__farmLog?.(`[amphibious-fishing] Gurumahi land width=${GURUMAHI_LAND_MODEL_WIDTH}`, 'fish');
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
