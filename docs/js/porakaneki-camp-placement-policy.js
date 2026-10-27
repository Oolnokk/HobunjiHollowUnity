(() => {
  'use strict';

  // Porakaneki camps are larger than ordinary temporary locales and are
  // intentionally allowed to displace ordinary procedural shrub/rock clutter.
  // Unique structures, dens, authored furniture, transitions, paths, water,
  // ramps, and other locales remain hard blockers. The runtime's placement
  // view labels procedural clutter with porakaneki_clutter_* ids; this adapter
  // converts only those records into TemporaryLocales-clearable clutter before
  // the camp runtime asks for a site.
  const TRIBE_PREFIXES = ['porakaneki_', 'omgurku_']; // Runtime locale instance ids of every tribe built by createTribeCamps (Omgurku shares the Porakaneki camp footprints and needs the same fallbacks).
  const CLUTTER_SUFFIX = 'clutter_'; // buildZoneView's ordinary procedural shrub/rock occupancy records are `${tribe}_clutter_*`.
  const WILDERNESS_ZONES = [
    'map_northern_cliffs',
    'map_southern_cloud_forest',
    'map_western_slope',
    'map_eastern_mire',
  ]; // Used to recover the owning map from a deterministic camp instance id.

  const placements = new Map(); // instanceId -> { zoneId, snapshots }; used to clear/restore the live grid when that camp is active.
  const appliedByZone = new Map(); // zoneId -> Set(instanceId) currently reflected in that live grid reference.
  const gridRefByZone = new Map(); // Detects a rebuilt/re-entered zone grid so active camp clearings are re-applied.
  const originalGridTiles = new WeakMap(); // Live grid -> coordinate metadata before the first camp clearing; avoids restoring unprefixed generator boulder IDs over map-prefixed runtime IDs.

  function isPorakanekiInstance(instanceId) {
    const text = String(instanceId || '');
    return TRIBE_PREFIXES.some(prefix => text.startsWith(prefix));
  }

  function zoneIdFromInstanceId(instanceId) {
    const text = String(instanceId || '');
    return WILDERNESS_ZONES.find(zoneId => text.includes(zoneId)) || null;
  }

  function prepareClutter(zone) {
    let converted = 0;
    for (const object of (zone?.objects || [])) {
      const id = String(object?.id || '');
      if (!TRIBE_PREFIXES.some(prefix => id.startsWith(prefix + CLUTTER_SUFFIX))) continue;
      const tile = zone?.tiles?.[object.y]?.[object.x];
      object.type = 'shrub'; // TemporaryLocales' clearable-type vocabulary; source terrain is retained separately below.
      object.localeMeta = false;
      object.srcType = tile?.terrain || object.srcType || 'shrub';
      object.srcRockKind = tile?.rockKind || null; // Original terrain collider flags to restore when a chief camp migrates.
      object.srcBoulderId = tile?.boulderId || null; // All cells of a boulder shell must be cleared together, not just those beneath tent tiles.
      object.srcGeneratedObjectId = tile?.generatedObjectId || null; // Retained for restoring the displaced source resource footprint.
      object.srcGeneratedObjectType = tile?.generatedObjectType || null; // Accompanies srcGeneratedObjectId during a reversible clearing.
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
    // Absolute last resort may give up only the SOFT center-distance buffer
    // (opts.avoidPoints). opts.avoidChunks is inherited from the caller through
    // the spread in wrappedStamp below, so the hard same-stream-chunk exclusion
    // can never be relaxed by this fallback.
    if (opts.avoidPoints?.length) attempts.push({ clearanceTiles: 0, minDistanceFromEntry: Math.min(authoredDistance, 6), requiresFlatGround: false, avoidPoints: [] });
    return attempts.filter((attempt, index, all) => all.findIndex(other =>
      other.clearanceTiles === attempt.clearanceTiles &&
      other.minDistanceFromEntry === attempt.minDistanceFromEntry &&
      other.requiresFlatGround === attempt.requiresFlatGround &&
      JSON.stringify(other.avoidPoints || null) === JSON.stringify(attempt.avoidPoints || null)
    ) === index);
  }

  function rectangleTiles(cols, rows) {
    const tiles = {};
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) tiles[`${col},${row}`] = { type: 'grass' };
    return tiles;
  } // Builds only the temporary placement footprint; the live wilderness terrain remains the source of elevation.

  function minimumCampFallbackLocales(locale) {
    const sourceObjects = Array.isArray(locale?.objects) ? locale.objects : [];
    const sourceTent = sourceObjects.find(object => object?.kind === 'tent');
    if (!sourceTent) return [];
    const sourceFire = sourceObjects.find(object => object?.key === 'bonfire');
    const sourceBench = sourceObjects.find(object => object?.key === 'benchlog');
    const compactObjects = [
      { ...sourceTent, id: 'minimum_tent', col: 0, row: 1, rot: 90 },
      ...(sourceFire ? [{ ...sourceFire, id: 'minimum_bonfire', col: 3, row: 1, rot: 0 }] : []),
      ...(sourceBench ? [{ ...sourceBench, id: 'minimum_bench', col: 2, row: 4, rot: 180 }] : []),
    ]; // 6x5 keeps a recognizable tent/fire/rest outpost while fitting terrain the normal 13x13 camp cannot.
    const compact = {
      ...locale,
      id: `${locale.id}_minimum_compact`,
      cols: 6,
      rows: 5,
      tiles: rectangleTiles(6, 5),
      objects: compactObjects,
      placement: { ...(locale.placement || {}), clearanceTiles: 0, requiresFlatGround: false, minDistanceFromEntry: 0 },
    };
    const tentOnly = {
      ...locale,
      id: `${locale.id}_minimum_tent`,
      cols: 2,
      rows: 2,
      tiles: rectangleTiles(2, 2),
      objects: [{ ...sourceTent, id: 'minimum_tent', col: 0, row: 0, rot: sourceTent.rot || 0 }],
      placement: { ...(locale.placement || {}), clearanceTiles: 0, requiresFlatGround: false, minDistanceFromEntry: 0 },
    }; // Final production floor: a visible 2x2 hunting tent still counts as a camp and preserves the resident group.
    return [compact, tentOnly];
  }

  function registerPlacement(instance, zone) {
    if (!instance?.id || !isPorakanekiInstance(instance.id)) return;
    const zoneId = zoneIdFromInstanceId(instance.id);
    if (!zoneId) return;
    const snapshots = (instance.removedObjectSnapshots || []).filter(snapshot => snapshot?.type === 'shrub').map(snapshot => ({ ...snapshot })); // Source clutter cells already removed by TemporaryLocales.
    const covered = new Set(snapshots.map(snapshot => `${snapshot.x},${snapshot.y}`)); // Initial locale clearing occupies this set; expanded boulder cells must not be snapshotted twice.
    const visited = new Set(); // Prevents rescanning the same connected boulder through multiple displaced tiles.
    for (const origin of snapshots) {
      if (origin.srcRockKind !== 'undiggableBoulder') continue;
      const groupId = origin.srcBoulderId || null; // A boulder may have no ID in legacy layouts; the renderer groups those by connected component.
      const queue = [[origin.x, origin.y]]; // Floods only physically connected boulder cells, avoiding other submaps that reuse the same generated object ID.
      for (let i = 0; i < queue.length; i++) {
        const [col, row] = queue[i];
        if (col < 0 || row < 0 || col >= (zone?.cols || 0) || row >= (zone?.rows || 0)) continue;
        const key = `${col},${row}`;
        if (visited.has(key)) continue;
        const tile = zone?.tiles?.[row]?.[col]; // The immutable source terrain survives a TemporaryLocales stamp.
        if (tile?.rockKind !== 'undiggableBoulder' || (tile.boulderId || null) !== groupId) continue;
        visited.add(key);
        if (!covered.has(key)) {
          snapshots.push({
            x: col, y: row, srcType: tile.terrain || 'rock',
            srcRockKind: tile.rockKind || null,
            srcBoulderId: tile.boulderId || null,
            srcGeneratedObjectId: tile.generatedObjectId || null,
            srcGeneratedObjectType: tile.generatedObjectType || null,
          }); // Preserve complete connected shell metadata for migration restoration.
          covered.add(key);
        }
        queue.push([col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]);
      }
    }
    placements.set(instance.id, { zoneId, snapshots });
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
      if (!instance && opts.minimumCampRequired) {
        for (const fallbackLocale of minimumCampFallbackLocales(locale)) {
          instance = originalStamp(zone, fallbackLocale, {
            ...opts,
            clearanceTiles: 0,
            minDistanceFromEntry: 0,
            requiresFlatGround: false,
            avoidPoints: [],
            clearableTypes,
          }); // Hard avoidChunks remains inherited, so compact recovery never creates a Porakaneki/bandit same-chunk collision.
          if (instance) break;
        }
      }
      if (instance) registerPlacement(instance, zone);
      return instance;
    };
    wrappedStamp.__porakanekiPlacementWrapped = true;
    wrappedStamp.__porakanekiPlacementOriginal = originalStamp;
    api.stamp = wrappedStamp;
    return true;
  }

  function activeCampIdsForZone(zoneId) {
    let debug = null;
    const ids = new Set();
    for (const runtime of (window.TribeCamps?.list?.() || [window.PorakanekiCamps])) {
      try { debug = runtime?.debugSnapshot?.() || null; } catch (_) { debug = null; }
      for (const camp of (debug?.zones?.[zoneId]?.camps || [])) if (camp?.id) ids.add(camp.id);
    }
    return ids;
  }

  function setSnapshotType(grid, snapshot, restore) {
    const tile = grid?.[snapshot.y]?.[snapshot.x];
    if (!tile) return false;
    let originals = originalGridTiles.get(grid); // One shared source for overlapping chief/hunting camp clearings on this live grid.
    if (!originals) { originals = new Map(); originalGridTiles.set(grid, originals); }
    const key = `${snapshot.x},${snapshot.y}`; // Coordinate key ensures overlapping camps restore the *first* untouched tile, not another camp's temporary grass.
    if (!restore && !originals.has(key)) {
      originals.set(key, {
        type: tile.type, rockKind: tile.rockKind, boulderId: tile.boulderId,
        generatedObjectId: tile.generatedObjectId, generatedObjectType: tile.generatedObjectType,
      }); // Preserve exact live-grid identities, including map-prefixed boulder IDs that the source locale cannot reconstruct.
    }
    const original = originals.get(key); // May be absent when restoring a legacy/preexisting clearing, so retain the source snapshot fallback.
    let changed = false;
    const assign = (field, value) => {
      if (value == null) {
        if (Object.prototype.hasOwnProperty.call(tile, field)) { delete tile[field]; changed = true; }
      } else if (tile[field] !== value) { tile[field] = value; changed = true; }
    };
    assign('type', restore ? (original?.type ?? snapshot.srcType ?? 'shrub') : 'grass');
    assign('rockKind', restore ? (original ? original.rockKind : snapshot.srcRockKind) : null);
    assign('boulderId', restore ? (original ? original.boulderId : snapshot.srcBoulderId) : null);
    assign('generatedObjectId', restore ? (original ? original.generatedObjectId : snapshot.srcGeneratedObjectId) : null);
    assign('generatedObjectType', restore ? (original ? original.generatedObjectType : snapshot.srcGeneratedObjectType) : null);
    return changed;
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
    let restored = false; // Forces all still-active camps to re-clear a rock shared with a migrating chief reservation.

    // Restore a seasonal chief clearing if the camp has migrated away while
    // the player is still standing in the old map.
    for (const instanceId of [...applied]) {
      if (desired.has(instanceId)) continue;
      const placement = placements.get(instanceId);
      if (placement?.zoneId === zoneId) for (const snapshot of placement.snapshots) {
        const altered = setSnapshotType(grid, snapshot, true);
        changed = altered || changed;
        restored = altered || restored;
      }
      applied.delete(instanceId);
    }

    for (const instanceId of desired) {
      if (applied.has(instanceId) && !restored) continue;
      const placement = placements.get(instanceId);
      if (!placement || placement.zoneId !== zoneId) continue;
      for (const snapshot of placement.snapshots) changed = setSnapshotType(grid, snapshot, false) || changed;
      applied.add(instanceId);
    }

    if (changed) {
      window.ZoneTerrainFeatures?.invalidateBoulderIndex?.(grid); // Cached welded shells otherwise survive a tile.type change and raise newly stamped tents.
      window.ZoneRegrowth?.refreshZoneGroundVisuals?.(zoneId);
    }
    if (!desired.size && !applied.size) originalGridTiles.delete(grid); // A fully vacated grid can capture newer regenerated/mined terrain on the next camp clearing.
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
    version: 4,
    syncCurrentZoneClutter,
    debugSnapshot: () => ({
      placements: [...placements].map(([id, entry]) => ({ id, zoneId: entry.zoneId, clearedTiles: entry.snapshots.length })),
      appliedByZone: Object.fromEntries([...appliedByZone].map(([zoneId, ids]) => [zoneId, [...ids]])),
    }),
    __test: Object.freeze({ isPorakanekiInstance, zoneIdFromInstanceId, prepareClutter, campStampAttempts, minimumCampFallbackLocales }),
  });

  installTemporaryLocales();
  watchNamespace('BanditCamps', installCampTick);
})();
