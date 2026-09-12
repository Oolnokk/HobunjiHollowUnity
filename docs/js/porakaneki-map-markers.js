(() => {
  'use strict';

  // Publishes the runtime Porakaneki camp network as ordinary wilderness-map
  // locale instances. The seasonal chief camp is always visible; each small
  // camp receives its own stable locale id so the existing fog/discovery
  // system reveals them independently instead of revealing every copy of the
  // shared small-camp locale at once.
  const MARKER_FLAG = '__porakanekiCampMapMarker'; // Used to replace only this adapter's map-only locale proxies during seasonal migration/regeneration.
  const SMALL_LOCALE_PREFIX = 'locale_porakaneki_camp_small_runtime_'; // Per-camp discovery ids consumed by WildernessMap's existing discoveredLocales save data.
  const CHIEF_LOCALE_ID = 'locale_porakaneki_camp_chief'; // Stable always-visible id lets a selected chief-camp waypoint follow seasonal migration automatically.

  let mapDeps = null; // Captured from WildernessMap.init; supplies the authoritative generated _zoneLayouts map.
  let lastSignature = ''; // Avoids rewriting layout.localeInstances on every 0.2 s camp tick when nothing moved.

  function snapshot() {
    try { return window.PorakanekiCamps?.debugSnapshot?.() || null; }
    catch { return null; }
  }

  function campLocaleId(zoneId, camp) {
    if (camp.kind === 'chief') return CHIEF_LOCALE_ID;
    const suffix = String(camp.id || `${zoneId}_${camp.center?.col}_${camp.center?.row}`)
      .replace(/^porakaneki_small_/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_');
    return `${SMALL_LOCALE_PREFIX}${suffix}`;
  }

  function desiredMarkers(debug) {
    const markers = [];
    for (const [zoneId, zone] of Object.entries(debug?.zones || {})) {
      for (const camp of (zone.camps || [])) {
        if (!camp?.center || !Number.isFinite(camp.center.col) || !Number.isFinite(camp.center.row)) continue;
        const chief = camp.kind === 'chief';
        const localeId = campLocaleId(zoneId, camp);
        markers.push({
          zoneId,
          id: `porakaneki_map_${localeId}`,
          localeId,
          templateLocaleId: chief ? CHIEF_LOCALE_ID : 'locale_porakaneki_camp_small',
          name: chief ? 'Porakaneki Chief Camp' : 'Porakaneki Hunting Camp',
          category: 'porakaneki_camp',
          // WildernessMap centers locale markers by adding 0.5 to x/y.
          x: camp.center.col - 0.5,
          y: camp.center.row - 0.5,
          alwaysVisible: chief,
          objects: [],
          [MARKER_FLAG]: true,
        });
      }
    }
    return markers;
  }

  function signatureFor(markers) {
    return markers
      .map(marker => `${marker.zoneId}:${marker.localeId}:${marker.x.toFixed(2)},${marker.y.toFixed(2)}:${marker.alwaysVisible ? 1 : 0}`)
      .sort()
      .join('|');
  }

  function markersAlreadyAttached(markers) {
    if (!mapDeps?._zoneLayouts) return false;
    const desiredIds = new Set(markers.map(marker => marker.id));
    const attachedIds = new Set();
    for (const [, layout] of mapDeps._zoneLayouts) {
      for (const instance of (layout?.localeInstances || [])) {
        if (instance?.[MARKER_FLAG]) attachedIds.add(instance.id);
      }
    }
    if (attachedIds.size !== desiredIds.size) return false;
    for (const id of desiredIds) if (!attachedIds.has(id)) return false;
    return true;
  }

  function syncMarkers() {
    if (!mapDeps?._zoneLayouts || !window.PorakanekiCamps?.debugSnapshot) return false;
    const markers = desiredMarkers(snapshot());
    const signature = signatureFor(markers);
    if (signature === lastSignature && markersAlreadyAttached(markers)) return false;

    const byZone = new Map();
    for (const marker of markers) {
      if (!byZone.has(marker.zoneId)) byZone.set(marker.zoneId, []);
      byZone.get(marker.zoneId).push(marker);
    }

    // Strip stale proxies from every generated wilderness layout first. This
    // is what physically moves the one chief marker when the season changes.
    for (const [zoneId, layout] of mapDeps._zoneLayouts) {
      if (!layout) continue;
      const retained = (layout.localeInstances || []).filter(instance => !instance?.[MARKER_FLAG]);
      layout.localeInstances = [...retained, ...(byZone.get(zoneId) || [])];
    }
    lastSignature = signature;
    return true;
  }

  function installWildernessMap(api = window.WildernessMap) {
    if (!api || typeof api.init !== 'function' || api.__porakanekiMapMarkersWrapped) return !!api?.__porakanekiMapMarkersWrapped;

    const originalInit = api.init.bind(api); // Existing map initialization remains authoritative; we only retain its dependency bundle.
    api.init = function porakanekiMapInit(injected) {
      mapDeps = injected;
      const result = originalInit(injected);
      syncMarkers();
      return result;
    };

    if (typeof api.updateFogAroundPlayer === 'function') {
      const originalFog = api.updateFogAroundPlayer.bind(api);
      api.updateFogAroundPlayer = function porakanekiMapFog(...args) {
        syncMarkers(); // Must run before locale discovery so approaching one small camp can discover exactly that instance.
        return originalFog(...args);
      };
    }

    if (typeof api.renderMapPanel === 'function') {
      const originalRender = api.renderMapPanel.bind(api);
      api.renderMapPanel = function porakanekiMapRender(...args) {
        syncMarkers(); // Ensures the always-visible chief marker reflects a just-completed seasonal migration before drawing.
        return originalRender(...args);
      };
    }

    api.__porakanekiMapMarkersWrapped = true;
    return true;
  }

  function installCampTick(api = window.BanditCamps) {
    if (!api || typeof api.updateCampBanners !== 'function' || api.updateCampBanners.__porakanekiMapMarkersWrapped) return !!api?.updateCampBanners?.__porakanekiMapMarkersWrapped;
    const original = api.updateCampBanners.bind(api);
    const wrapped = function porakanekiMapMarkerTick(dt) {
      const result = original(dt); // PorakanekiCamps' earlier wrapper updates seasonal/camp state first.
      syncMarkers();
      return result;
    };
    wrapped.__porakanekiMapMarkersWrapped = true;
    api.updateCampBanners = wrapped;
    return true;
  }

  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) return;
    let assigned = descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get: () => assigned,
      set(value) {
        assigned = value;
        Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value });
        installer(value);
      },
    });
  }

  window.PorakanekiMapMarkers = Object.freeze({
    version: 1,
    sync: syncMarkers,
    debugSnapshot: () => ({ ready: !!mapDeps, signature: lastSignature, markers: desiredMarkers(snapshot()) }),
    __test: Object.freeze({ campLocaleId, desiredMarkers, markersAlreadyAttached }),
  });

  watchNamespace('WildernessMap', installWildernessMap);
  watchNamespace('BanditCamps', installCampTick);
})();
