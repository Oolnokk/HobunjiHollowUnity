(() => {
  'use strict';

  // Shop-counter action buttons for the three NPC-gated shops — the
  // Bronzeworks Smithy (Kzubug/Sloomi), Funji & Son's General Store and
  // Dzibim Khibu's Carpentry. Each has a config block under
  // SCRATCHBONES_CONFIG.game.mobileControls (action id, icon, label, which
  // NPCs/stations count), an "is this walker on duty" check, and the arch
  // button it contributes after Talk. Pulled out of game.js following the
  // usual window.<Namespace> + init(deps) pattern; game.js keeps the old
  // function names as aliases of these.
  let deps = null; // { getCurrentArea, getNearbyNpcWalker, npcMovementConfig }
  function init(injectedDeps) { deps = injectedDeps; }

  const mobileControls = () => window.SCRATCHBONES_CONFIG?.game?.mobileControls || {};
  const normalizeStationLabel = label => window.NpcScheduling?.normalizeStationLabel?.(label) ?? String(label || '').trim().toLowerCase();

  // General Store and Carpenter only count as open while their keeper is
  // standing idle at one of the configured counter stations.
  function isAtCounter(walker, cfg, defaultIds, defaultStationLabels) {
    const ids = Array.isArray(cfg.npcIds) ? cfg.npcIds : defaultIds;
    const stationLabels = Array.isArray(cfg.stationLabels) ? cfg.stationLabels : defaultStationLabels;
    const npcId = walker?.rec?.id || '';
    const target = walker?.currentScheduleTarget || null;
    const stationLabel = normalizeStationLabel(target?.label);
    const isAtStation = walker?.state === 'idle' && target && Number.isFinite(target.c) && Number.isFinite(target.r)
      && Math.hypot(walker.root.position.x - (target.c + 0.5), walker.root.position.z - (target.r + 0.5)) <= (deps?.npcMovementConfig?.().arrivalRadiusTiles ?? 0.18);
    return ids.includes(npcId) && isAtStation && stationLabels.some(label => stationLabel === normalizeStationLabel(label));
  }

  function shopButton(cfg, fallbackIcon, fallbackLabel, action) {
    const name = deps?.getNearbyNpcWalker?.()?.rec?.name;
    return {
      icon: cfg.icon || fallbackIcon,
      label: name ? `${cfg.label || fallbackLabel}: ${name}` : (cfg.label || fallbackLabel),
      action,
      style: cfg.style || 'primary',
      allowed: true,
    };
  }

  function smithyButtonConfig() { return mobileControls().smithyButton || {}; }
  function smithyAction() { return smithyButtonConfig().action || 'open_smithy'; }
  function isSmithyNpcInBronzeworks(walker) {
    const cfg = smithyButtonConfig();
    const ids = Array.isArray(cfg.npcIds) ? cfg.npcIds : ['kzubug', 'sloomi'];
    return deps?.getCurrentArea?.() === (cfg.areaId || 'map_i_smithy') && ids.includes(walker?.rec?.id || '');
  }
  function smithyButton() { return shopButton(smithyButtonConfig(), '🔨', 'Smithy', smithyAction()); }

  function generalStoreButtonConfig() { return mobileControls().generalStoreButton || {}; }
  function generalStoreAction() { return generalStoreButtonConfig().action || 'open_general_store'; }
  function isGeneralStoreNpcOnDuty(walker) { return isAtCounter(walker, generalStoreButtonConfig(), ['furunji_funji', 'foroji_funji'], []); }
  function generalStoreButton() { return shopButton(generalStoreButtonConfig(), '🛒', 'Shop', generalStoreAction()); }

  function carpenterButtonConfig() { return mobileControls().carpenterButton || {}; }
  function carpenterAction() { return carpenterButtonConfig().action || 'open_carpenter_shop'; }
  function isCarpenterNpcOnDuty(walker) { return isAtCounter(walker, carpenterButtonConfig(), ['dzibim_khibu'], ['Carpentry Work']); }
  function carpenterButton() { return shopButton(carpenterButtonConfig(), '🪚', 'Carpenter', carpenterAction()); }

  window.NpcShopButtons = Object.freeze({
    init,
    smithyButtonConfig, smithyAction, isSmithyNpcInBronzeworks, smithyButton,
    generalStoreButtonConfig, generalStoreAction, isGeneralStoreNpcOnDuty, generalStoreButton,
    carpenterButtonConfig, carpenterAction, isCarpenterNpcOnDuty, carpenterButton,
  });
})();
