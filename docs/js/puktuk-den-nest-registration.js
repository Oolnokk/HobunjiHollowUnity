(() => {
  'use strict';

  const PUKTUK_KIND = 'puktuk'; // Species key shared by wild Puktuk, livestock, and the existing genotype renderer.
  const PUKTUK_BABY_ITEM_KEY = 'puktukBaby'; // Livestock item created when a Puktuk den baby is taken from its nest.
  const HEAVY_WOOL_ITEM_KEY = 'puktukWool'; // Save-compatible key presented to players as Heavy Wool.
  const VOORG_ASS_KIND = 'voorg-ass'; // Species key used by the Northern Cliffs roaming-herd population.
  const VOORG_ASS_ZONE_ID = 'map_northern_cliffs'; // Exterior-zone key whose open-air herd ecology owns Voorg-Asses.
  const VOORG_ASS_BABY_ITEM_KEY = 'voorgAssBaby'; // Livestock item recovered from a killed Voorg-Ass Herd-Mother.
  const LIGHT_WOOL_ITEM_KEY = 'lightWool'; // Voorg-Ass shearing output presented to players as Light Wool.

  function registerDenNestConfig() {
    const game = window.SCRATCHBONES_CONFIG?.game; // Config is loaded before this bridge and snapshotted later by game.js.
    if (!game) return false;

    const wildlife = game.wildlife || (game.wildlife = {}); // Supplies game.js's DEN_MOTHER_DEFS snapshot.
    const denMothers = wildlife.denMothers || (wildlife.denMothers = {}); // Existing Den-Mother registry consumed by cavern generation.

    const existingPuktukMother = denMothers[PUKTUK_KIND] || {}; // Preserves future authored Puktuk-specific mother overrides.
    denMothers[PUKTUK_KIND] = {
      ...existingPuktukMother,
      creatureKey: existingPuktukMother.creatureKey || PUKTUK_KIND,
      nestItemKey: existingPuktukMother.nestItemKey || PUKTUK_BABY_ITEM_KEY,
    };

    // Voorg-Asses do not use cavern Den-Mothers or nest pickups. Remove any
    // stale pre-v3 registration before game.js snapshots DEN_MOTHER_DEFS.
    delete denMothers[VOORG_ASS_KIND];

    const livestock = game.livestock || (game.livestock = {}); // Existing farm/stable livestock config shared with FarmAnimals.
    const itemKinds = livestock.itemKinds || (livestock.itemKinds = {}); // Maps undeployed livestock items back to their species.
    itemKinds[PUKTUK_BABY_ITEM_KEY] = PUKTUK_KIND;
    itemKinds[VOORG_ASS_BABY_ITEM_KEY] = VOORG_ASS_KIND;
    return true;
  }

  function registerDenBabyItems(itemDefs) {
    if (!itemDefs) return false;
    itemDefs[PUKTUK_BABY_ITEM_KEY] = {
      icon: '🐾',
      label: 'Puktuk Baby',
      cat: 'livestock',
      sellPrice: 0,
      tags: ['Livestock', 'Baby'],
      desc: 'A Puktuk baby taken from a western-slope den. Add it to a farm or stable to raise it.',
      ...(itemDefs[PUKTUK_BABY_ITEM_KEY] || {}),
    };
    itemDefs[VOORG_ASS_BABY_ITEM_KEY] = {
      icon: '🐾',
      label: 'Voorg-Ass Baby',
      cat: 'livestock',
      sellPrice: 0,
      tags: ['Livestock', 'Baby'],
      desc: 'A Voorg-Ass baby recovered from a fallen Herd-Mother. Add it to a farm or stable to raise it.',
      ...(itemDefs[VOORG_ASS_BABY_ITEM_KEY] || {}),
    };
    return true;
  }

  function registerWoolInventoryItems(injectedDeps) {
    const itemDefs = injectedDeps?.ITEM_DEFS;
    const inventoryItems = injectedDeps?.inventoryItems;
    if (!itemDefs || !Array.isArray(inventoryItems)) return false;
    const specs = [
      { key: HEAVY_WOOL_ITEM_KEY, label: 'Heavy Wool', species: 'Puktuk', weightTag: 'Heavy', desc: 'Dense wool shorn from a Puktuk. Used for heavy woven clothing.' },
      { key: LIGHT_WOOL_ITEM_KEY, label: 'Light Wool', species: 'Voorg-Ass', weightTag: 'Light', desc: 'Light wool shorn from a Voorg-Ass. Used for light woven clothing.' },
    ];
    for (const spec of specs) {
      const source = window.HobunjiCookingData?.items?.[spec.key] || {};
      const old = itemDefs[spec.key] || {};
      itemDefs[spec.key] = {
        ...old,
        icon: old.icon || '🧶',
        label: spec.label,
        cat: old.cat || 'material',
        sellPrice: old.sellPrice ?? 0,
        tags: [...new Set([...(old.tags || []), 'Material', 'Wool', ...(source.tags || []), spec.species, spec.weightTag])],
        desc: old.desc || spec.desc,
      };
      const existing = inventoryItems.find(entry => entry?.key === spec.key);
      if (existing) {
        existing.icon = existing.icon || itemDefs[spec.key].icon;
        existing.label = spec.label.toUpperCase();
        existing.max = existing.max || 99;
      } else {
        inventoryItems.push({ key: spec.key, icon: itemDefs[spec.key].icon, label: spec.label.toUpperCase(), max: 99 });
      }
    }
    return true;
  }

  function registerVoorgAssHerdRuntime(injectedDeps) {
    // Zone/Den-Mother migration is shared with creature-genetics.js and
    // wildlife-spawn.js via js/voorg-ass-registration.js.
    const herds = window.VoorgAssRegistration?.ensureNorthernCliffsHerds?.(injectedDeps);
    if (!herds?.zone) return false;
    window.__farmLog?.(`[voorg-ass] herd registration zone=${VOORG_ASS_ZONE_ID} roaming=[${herds.roaming.join(',')}] herdCount=${herds.zone.roamingHerdCount} denSpecies=[${herds.denSpecies?.join(',') || 'legacy'}] denMother=none herbivores=[${herds.herbivores.join(',')}]`, herds.ready ? 'wildlife' : 'warn');
    return herds.ready;
  }

  function patchWildlifeSpawn(api) {
    if (!api?.init) return false;
    if (api.__voorgAssHerdRegistrationInstalled) return true;
    const originalInit = api.init; // Preserves CreatureGenetics and every other WildlifeSpawn.init wrapper already in the chain.
    api.init = function voorgAssHerdAwareWildlifeInit(injectedDeps) {
      registerVoorgAssHerdRuntime(injectedDeps);
      return originalInit.call(this, injectedDeps);
    };
    api.__voorgAssHerdRegistrationInstalled = true;
    return true;
  }

  function watchWildlifeSpawnAssignment() {
    if (patchWildlifeSpawn(window.WildlifeSpawn)) return true;
    const existing = Object.getOwnPropertyDescriptor(window, 'WildlifeSpawn'); // Used to compose with den/territorial modules that also trap the later assignment.
    if (existing?.set) {
      const chainedSet = existing.set; // Existing loader-order trap remains authoritative for storing the assigned WildlifeSpawn API.
      Object.defineProperty(window, 'WildlifeSpawn', {
        configurable: existing.configurable !== false,
        enumerable: existing.enumerable ?? true,
        get: existing.get,
        set(value) {
          chainedSet.call(window, value);
          patchWildlifeSpawn(window.WildlifeSpawn);
        },
      });
      return true;
    }

    let assigned = existing?.value; // Temporary slot used until wildlife-spawn.js assigns its namespace later in parser order.
    Object.defineProperty(window, 'WildlifeSpawn', {
      configurable: true,
      enumerable: existing?.enumerable ?? true,
      get() { return assigned; },
      set(value) {
        assigned = value;
        patchWildlifeSpawn(assigned);
      },
    });
    return true;
  }

  function patchCookingSystem(api) {
    if (!api?.init) return false;
    if (api.__livestockWoolItemBridgeInstalled) return true;
    const originalInit = api.init; // Cooking keeps ownership of the dependency bag; this only fills the two wool material entries it intentionally skips.
    api.init = function livestockWoolAwareCookingInit(injectedDeps, ...rest) {
      registerWoolInventoryItems(injectedDeps);
      return originalInit.call(this, injectedDeps, ...rest);
    };
    api.__livestockWoolItemBridgeInstalled = true;
    return true;
  }

  function watchCookingSystemAssignment() {
    if (patchCookingSystem(window.CookingSystem)) return true;
    const existing = Object.getOwnPropertyDescriptor(window, 'CookingSystem');
    if (existing?.set) {
      const chainedSet = existing.set;
      Object.defineProperty(window, 'CookingSystem', {
        configurable: existing.configurable !== false,
        enumerable: existing.enumerable ?? true,
        get: existing.get,
        set(value) {
          chainedSet.call(window, value);
          patchCookingSystem(window.CookingSystem);
        },
      });
      return true;
    }

    let assigned = existing?.value;
    Object.defineProperty(window, 'CookingSystem', {
      configurable: true,
      enumerable: existing?.enumerable ?? true,
      get() { return assigned; },
      set(value) {
        assigned = value;
        patchCookingSystem(assigned);
      },
    });
    return true;
  }

  function installDenNestInitBridge() {
    const api = window.DenNestSystem; // Loaded earlier than this module; game.js initializes it later with the live ITEM_DEFS object.
    if (!api?.init) return false;
    if (api.__denBabyItemBridgeInstalled) return true;
    const originalInit = api.init; // Preserves the existing nest renderer/listener initialization unchanged.
    api.init = function denBabyAwareDenNestInit(injectedDeps) {
      registerDenBabyItems(injectedDeps?.ITEM_DEFS);
      return originalInit.call(this, injectedDeps);
    };
    api.__denBabyItemBridgeInstalled = true;
    api.__puktukBabyItemBridgeInstalled = true; // Compatibility marker retained for existing diagnostics/tests.
    return true;
  }

  // Keep this module deliberately species/config-only. DenLocaleRuntime is loaded
  // as its own sibling entry by combat-config-loader.js; nesting another parser-time
  // script injection here could disturb unrelated held-item/stance bootstrap ordering.
  const configReady = registerDenNestConfig();
  const bridgeReady = installDenNestInitBridge();
  const wildlifeBridgeReady = watchWildlifeSpawnAssignment();
  const woolBridgeReady = watchCookingSystemAssignment();

  window.PuktukDenNestRegistration = {
    version: 3,
    PUKTUK_KIND,
    PUKTUK_BABY_ITEM_KEY,
    HEAVY_WOOL_ITEM_KEY,
    VOORG_ASS_KIND,
    VOORG_ASS_ZONE_ID,
    VOORG_ASS_BABY_ITEM_KEY,
    LIGHT_WOOL_ITEM_KEY,
    registerPuktukNestConfig: registerDenNestConfig,
    registerPuktukBabyItem: registerDenBabyItems,
    registerDenNestConfig,
    registerDenBabyItems,
    registerWoolInventoryItems,
    registerVoorgAssHerdRuntime,
    registerVoorgAssDenRuntime: registerVoorgAssHerdRuntime, // Compatibility alias for older diagnostics; v3 no longer creates a den.
    debugSnapshot: () => ({
      configReady: window.SCRATCHBONES_CONFIG?.game?.wildlife?.denMothers?.[PUKTUK_KIND]?.nestItemKey === PUKTUK_BABY_ITEM_KEY,
      livestockReady: window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.[PUKTUK_BABY_ITEM_KEY] === PUKTUK_KIND,
      voorgConfigReady: !window.SCRATCHBONES_CONFIG?.game?.wildlife?.denMothers?.[VOORG_ASS_KIND],
      voorgLivestockReady: window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.[VOORG_ASS_BABY_ITEM_KEY] === VOORG_ASS_KIND,
      initBridgeReady: !!window.DenNestSystem?.__denBabyItemBridgeInstalled,
      wildlifeBridgeReady: !!window.WildlifeSpawn?.__voorgAssHerdRegistrationInstalled || wildlifeBridgeReady,
      woolBridgeReady: !!window.CookingSystem?.__livestockWoolItemBridgeInstalled || woolBridgeReady,
      denLocaleReady: !!window.DenLocaleRuntime,
    }),
  };

  window.__farmLog?.(`[livestock-young] registration config=${configReady ? 'ok' : 'missing'} itemBridge=${bridgeReady ? 'ok' : 'missing'} wildlifeBridge=${wildlifeBridgeReady ? 'ok' : 'missing'} woolBridge=${woolBridgeReady ? 'ok' : 'missing'} items=${PUKTUK_BABY_ITEM_KEY},${VOORG_ASS_BABY_ITEM_KEY}`, configReady && bridgeReady && wildlifeBridgeReady && woolBridgeReady ? 'wildlife' : 'warn');
})();
