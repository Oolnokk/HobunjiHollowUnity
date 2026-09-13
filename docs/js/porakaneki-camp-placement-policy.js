(() => {
  'use strict';

  // Porakaneki camps are larger than ordinary temporary locales and are
  // intentionally allowed to displace ordinary procedural shrub/rock clutter.
  // Unique structures, dens, authored furniture, transitions, paths, water,
  // ramps, and other locales remain hard blockers. The runtime's placement
  // view labels procedural clutter with porakaneki_clutter_* ids; this adapter
  // converts only those records into TemporaryLocales-clearable clutter before
  // the camp runtime asks for a site.
  const PORAKANEKI_PREFIX = 'porakaneki_'; // Used only for this feature's runtime locale instance ids.
  const CLUTTER_PREFIX = 'porakaneki_clutter_'; // buildZoneView's ordinary procedural shrub/rock occupancy records.
  const WILDERNESS_ZONES = [
    'map_northern_cliffs',
    'map_southern_cloud_forest',
    'map_western_slope',
    'map_eastern_mire',
  ]; // Used to recover the owning map from a deterministic camp instance id.

  const placements = new Map(); // instanceId -> { zoneId, snapshots }; used to clear/restore the live grid when that camp is active.
  const appliedByZone = new Map(); // zoneId -> Set(instanceId) currently reflected in that live grid reference.
  const gridRefByZone = new Map(); // Detects a rebuilt/re-entered zone grid so active camp clearings are re-applied.

  function isPorakanekiInstance(instanceId) {
    return String(instanceId || '').startsWith(PORAKANEKI_PREFIX);
  }

  function zoneIdFromInstanceId(instanceId) {
    const text = String(instanceId || '');
    return WILDERNESS_ZONES.find(zoneId => text.includes(zoneId)) || null;
  }

  function prepareClutter(zone) {
    let converted = 0;
    for (const object of (zone?.objects || [])) {
      if (!String(object?.id || '').startsWith(CLUTTER_PREFIX)) continue;
      const tile = zone?.tiles?.[object.y]?.[object.x];
      object.type = 'shrub'; // TemporaryLocales' clearable-type vocabulary; source terrain is retained separately below.
      object.localeMeta = false;
      object.srcType = tile?.terrain || object.srcType || 'shrub';
      converted += 1;
    }
    return converted;
  }

  function campStampAttempts(locale, opts) {
    const placement = locale?.placement || {};
    const authoredClearance = Math.max(0, Math.round(Number(opts.clearanceTiles ?? placement.clearanceTiles ?? 0) || 0));
    const authoredDistance = Math.max(0, Number(opts.minDistanceFromEntry ?? placement.minDistanceFromEntry) || 0);
    const attempts = [
      { clearanceTiles: authoredClearance, minDistanceFromEntry: authoredDistance, requiresFlatGround: opts.requiresFlatGround ?? placement.requiresFlatGround },
    ];
    if (authoredClearance > 1) attempts.push({ clearanceTiles: 1, minDistanceFromEntry: authoredDistance, requiresFlatGround: opts.requiresFlatGround ?? placement.requiresFlatGround });
    if (authoredClearance > 0) attempts.push({ clearanceTiles: 0, minDistanceFromEntry: Math.min(authoredDistance, 8), requiresFlatGround: opts.requiresFlatGround ?? placement.requiresFlatGround });
    // Last-resort fallback: still refuses water/path/ramp/unique-object tiles,
    // but permits a camp's individual tents to sit on neighboring elevation
    // tiers instead of deleting the camp entirely on cliff-heavy generations.
    attempts.push({ clearanceTiles: 0, minDistanceFromEntry: Math.min(authoredDistance, 6), requiresFlatGround: false });
    return attempts.filter((attempt, index, all) => all.findIndex(other =>
      other.clearanceTiles === attempt.clearanceTiles &&
      other.minDistanceFromEntry === attempt.minDistanceFromEntry &&
      other.requiresFlatGround === attempt.requiresFlatGround
    ) === index);
  }

  function registerPlacement(instance) {
    if (!instance?.id || !isPorakanekiInstance(instance.id)) return;
    const zoneId = zoneIdFromInstanceId(instance.id);
    if (!zoneId) return;
    placements.set(instance.id, {
      zoneId,
      snapshots: (instance.removedObjectSnapshots || []).filter(snapshot => snapshot?.type === 'shrub').map(snapshot => ({ ...snapshot })),
    });
  }

  function installTemporaryLocales(api = window.TemporaryLocales) {
    if (!api || typeof api.stamp !== 'function') return false;
    if (api.stamp.__porakanekiPlacementWrapped) return true;
    const originalStamp = api.stamp.bind(api);
    const wrappedStamp = function porakanekiPlacementStamp(zone, locale, opts = {}) {
      if (!isPorakanekiInstance(opts.instanceId)) return originalStamp(zone, locale, opts);
      prepareClutter(zone);
      const clearableTypes = new Set(opts.clearableTypes || []);
      clearableTypes.add('shrub');
      let instance = null;
      for (const attempt of campStampAttempts(locale, opts)) {
        instance = originalStamp(zone, locale, { ...opts, ...attempt, clearableTypes });
        if (instance) break;
      }
      if (instance) registerPlacement(instance);
      return instance;
    };
    wrappedStamp.__porakanekiPlacementWrapped = true;
    wrappedStamp.__porakanekiPlacementOriginal = originalStamp;
    api.stamp = wrappedStamp;
    return true;
  }

  function activeCampIdsForZone(zoneId) {
    let debug = null;
    try { debug = window.PorakanekiCamps?.debugSnapshot?.() || null; } catch (_) {}
    return new Set((debug?.zones?.[zoneId]?.camps || []).map(camp => camp?.id).filter(Boolean));
  }

  function setSnapshotType(grid, snapshot, restore) {
    const tile = grid?.[snapshot.y]?.[snapshot.x];
    if (!tile) return false;
    const nextType = restore ? (snapshot.srcType || 'shrub') : 'grass';
    if (tile.type === nextType) return false;
    tile.type = nextType;
    return true;
  }

  function syncCurrentZoneClutter() {
    const accessors = window.GridTileAccessors;
    const zoneId = accessors?.getCurrentArea?.();
    if (!WILDERNESS_ZONES.includes(zoneId)) return false;
    const grid = accessors.getActiveGrid?.();
    if (!grid) return false;

    if (gridRefByZone.get(zoneId) !== grid) {
      gridRefByZone.set(zoneId, grid);
      appliedByZone.set(zoneId, new Set()); // A rebuilt grid needs all currently active clearings re-applied.
    }
    const applied = appliedByZone.get(zoneId) || new Set();
    appliedByZone.set(zoneId, applied);
    const desired = activeCampIdsForZone(zoneId);
    let changed = false;

    // Restore a seasonal chief clearing if the camp has migrated away while
    // the player is still standing in the old map.
    for (const instanceId of [...applied]) {
      if (desired.has(instanceId)) continue;
      const placement = placements.get(instanceId);
      if (placement?.zoneId === zoneId) for (const snapshot of placement.snapshots) changed = setSnapshotType(grid, snapshot, true) || changed;
      applied.delete(instanceId);
    }

    for (const instanceId of desired) {
      if (applied.has(instanceId)) continue;
      const placement = placements.get(instanceId);
      if (!placement || placement.zoneId !== zoneId) continue;
      for (const snapshot of placement.snapshots) changed = setSnapshotType(grid, snapshot, false) || changed;
      applied.add(instanceId);
    }

    if (changed) window.ZoneRegrowth?.refreshZoneGroundVisuals?.(zoneId);
    return changed;
  }

  function installCampTick(api = window.BanditCamps) {
    if (!api || typeof api.updateCampBanners !== 'function') return false;
    if (api.updateCampBanners.__porakanekiPlacementWrapped) return true;
    const original = api.updateCampBanners.bind(api);
    const wrapped = function porakanekiPlacementTick(dt) {
      const result = original(dt);
      syncCurrentZoneClutter(); // Runs after PorakanekiCamps' state update once that wrapper is installed later in the loader.
      return result;
    };
    wrapped.__porakanekiPlacementWrapped = true;
    api.updateCampBanners = wrapped;
    return true;
  }

  function watchNamespace(name, installer) {
    if (installer(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) return;
    const priorGet = descriptor?.get;
    const priorSet = descriptor?.set;
    let assigned = priorGet ? priorGet.call(window) : descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return priorGet ? priorGet.call(window) : assigned; },
      set(value) {
        if (priorSet) priorSet.call(window, value);
        else assigned = value;
        const resolved = priorGet ? priorGet.call(window) : assigned;
        installer(resolved);
      },
    });
  }

  window.PorakanekiCampPlacementPolicy = Object.freeze({
    version: 1,
    syncCurrentZoneClutter,
    debugSnapshot: () => ({
      placements: [...placements].map(([id, entry]) => ({ id, zoneId: entry.zoneId, clearedTiles: entry.snapshots.length })),
      appliedByZone: Object.fromEntries([...appliedByZone].map(([zoneId, ids]) => [zoneId, [...ids]])),
    }),
    __test: Object.freeze({ isPorakanekiInstance, zoneIdFromInstanceId, prepareClutter, campStampAttempts }),
  });

  installTemporaryLocales();
  watchNamespace('BanditCamps', installCampTick);
})();
