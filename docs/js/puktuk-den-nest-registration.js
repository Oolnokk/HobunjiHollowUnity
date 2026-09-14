(() => {
  'use strict';

  const PUKTUK_KIND = 'puktuk'; // Species key shared by wild Puktuk, livestock, and the existing genotype renderer.
  const PUKTUK_BABY_ITEM_KEY = 'puktukBaby'; // Livestock item created when a Puktuk den baby is taken from its nest.

  // Den encounter authoring is shared by every Den-Mother species. This bridge
  // already occupies the parser-blocking point immediately before game.js, so
  // load the locale adapter here rather than adding another unrelated bootstrap.
  function ensureDenLocaleRuntime() {
    if (window.DenLocaleRuntime) return true;
    const src = 'js/den-locale-runtime.js?v=20260914a';
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}"><\/script>`);
      return true;
    }
    if (![...document.scripts].some(script => script.src?.includes('/den-locale-runtime.js'))) {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      document.head.appendChild(script);
    }
    return true;
  }

  function registerPuktukNestConfig() {
    const game = window.SCRATCHBONES_CONFIG?.game; // Config is loaded before this bridge and snapshotted later by game.js.
    if (!game) return false;

    const wildlife = game.wildlife || (game.wildlife = {}); // Supplies game.js's DEN_MOTHER_DEFS snapshot.
    const denMothers = wildlife.denMothers || (wildlife.denMothers = {}); // Existing Den-Mother registry consumed by cavern generation.
    const existingMother = denMothers[PUKTUK_KIND] || {}; // Preserves future authored Puktuk-specific mother overrides.
    denMothers[PUKTUK_KIND] = {
      ...existingMother,
      creatureKey: existingMother.creatureKey || PUKTUK_KIND,
      nestItemKey: existingMother.nestItemKey || PUKTUK_BABY_ITEM_KEY,
    };

    const livestock = game.livestock || (game.livestock = {}); // Existing farm/stable livestock config shared with FarmAnimals.
    const itemKinds = livestock.itemKinds || (livestock.itemKinds = {}); // Maps undeployed livestock items back to their species.
    itemKinds[PUKTUK_BABY_ITEM_KEY] = PUKTUK_KIND;
    return true;
  }

  function registerPuktukBabyItem(itemDefs) {
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
    return true;
  }

  function installDenNestInitBridge() {
    const api = window.DenNestSystem; // Loaded earlier than this module; game.js initializes it later with the live ITEM_DEFS object.
    if (!api?.init) return false;
    if (api.__puktukBabyItemBridgeInstalled) return true;
    const originalInit = api.init; // Preserves the existing nest renderer/listener initialization unchanged.
    api.init = function puktukBabyAwareDenNestInit(injectedDeps) {
      registerPuktukBabyItem(injectedDeps?.ITEM_DEFS);
      return originalInit.call(this, injectedDeps);
    };
    api.__puktukBabyItemBridgeInstalled = true;
    return true;
  }

  ensureDenLocaleRuntime();
  const configReady = registerPuktukNestConfig();
  const bridgeReady = installDenNestInitBridge();

  window.PuktukDenNestRegistration = {
    version: 1,
    PUKTUK_KIND,
    PUKTUK_BABY_ITEM_KEY,
    registerPuktukNestConfig,
    registerPuktukBabyItem,
    debugSnapshot: () => ({
      configReady: window.SCRATCHBONES_CONFIG?.game?.wildlife?.denMothers?.[PUKTUK_KIND]?.nestItemKey === PUKTUK_BABY_ITEM_KEY,
      livestockReady: window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.[PUKTUK_BABY_ITEM_KEY] === PUKTUK_KIND,
      initBridgeReady: !!window.DenNestSystem?.__puktukBabyItemBridgeInstalled,
      denLocaleReady: !!window.DenLocaleRuntime,
    }),
  };

  window.__farmLog?.(`[puktuk] den clutch registration config=${configReady ? 'ok' : 'missing'} itemBridge=${bridgeReady ? 'ok' : 'missing'} reward=${PUKTUK_BABY_ITEM_KEY}`, configReady && bridgeReady ? 'wildlife' : 'warn');
})();
