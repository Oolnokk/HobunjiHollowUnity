// Wilderness foliage-furniture lifecycle. Generated stump/log records stay
// plain map data; this module owns their authored visuals, collision and sit
// interactions for exactly as long as the corresponding zone scene exists.
(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoliageFurnitureRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DEFAULT_SEAT_NORMAL_OFFSET = 0.01;
  const GENERATED_KIND_TO_FURNITURE = Object.freeze({ stump: 'chairstump', fallenLog: 'benchlog' });
  const recordsByMapId = new Map();
  const objectsByMapId = new Map();
  const spawnStatesByMapId = new Map();
  let deps = null;

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function debug(message, level = 'info') {
    const text = `[FoliageFurnitureRuntime] ${message}`;
    if (typeof deps?.debugLog === 'function') deps.debugLog(text, level);
    else if (typeof root.__farmLog === 'function') root.__farmLog(text, level);
    else if (level === 'error') console.error(text);
    else if (level === 'warn') console.warn(text);
    else console.log(text);
  }

  function furnitureKeyForGeneratedKind(kind) {
    return GENERATED_KIND_TO_FURNITURE[String(kind || '')] || null;
  }

  function normalizeGeneratedObject(object) {
    if (!object || typeof object !== 'object') return object;
    const kind = object.sourceObjectType || object.type;
    const key = object.furnitureKey || furnitureKeyForGeneratedKind(kind);
    if (!key) return object;
    if (kind === 'stump') {
      object.w = 1;
      object.h = 1;
    } else if (kind === 'fallenLog') {
      const vertical = Math.max(1, finite(object.h ?? object.footprintD, 1)) > Math.max(1, finite(object.w ?? object.footprintW, 1));
      object.w = vertical ? 1 : 2;
      object.h = vertical ? 2 : 1;
    }
    object.furnitureKey = key;
    object.foliageFurniture = true;
    object.foliageFurnitureVersion = 1;
    return object;
  }

  function generatedObjectsFrom(value) {
    if (Array.isArray(value?.wildernessFoliageFurniture)) return value.wildernessFoliageFurniture;
    if (Array.isArray(value?.foliageFurniture)) return value.foliageFurniture;
    if (Array.isArray(value?.objects)) return value.objects;
    if (Array.isArray(value?.map?.objects)) return value.map.objects;
    return [];
  }

  function recordFromGeneratedObject(object, mapId = '') {
    const kind = object?.sourceObjectType || object?.type;
    const key = object?.furnitureKey || furnitureKeyForGeneratedKind(kind);
    if (!key) return null;
    const col = finite(object.col ?? object.x);
    const row = finite(object.row ?? object.y);
    const w = Math.max(1, finite(object.footprintW ?? object.w, 1));
    const d = Math.max(1, finite(object.footprintD ?? object.h, 1));
    return {
      id: String(object.id || `${kind}_${col}_${row}`),
      mapId: String(mapId || object.mapId || ''),
      sourceObjectType: kind,
      furnitureKey: key,
      col,
      row,
      footprintW: w,
      footprintD: d,
      centerX: finite(object.centerX, col + w / 2),
      centerZ: finite(object.centerZ, row + d / 2),
      yawDeg: finite(object.yawDeg, kind === 'fallenLog' && d > w ? 90 : 0),
      elevTier: finite(object.elevTier ?? object.elevation ?? object.height, 0),
    };
  }

  function deriveRecords(value, mapId = '') {
    const records = [];
    for (const source of generatedObjectsFrom(value)) {
      const object = normalizeGeneratedObject({ ...source });
      const record = recordFromGeneratedObject(object, mapId);
      if (record) records.push(record);
    }
    return records;
  }

  function annotateWorkspace(workspace, fallbackMapId = '') {
    if (!workspace || typeof workspace !== 'object') return workspace;
    const mapId = workspace.maps?.[0]?.id || fallbackMapId || workspace.mapId || '';
    const records = deriveRecords(workspace, mapId);
    workspace.wildernessFoliageFurniture = records.map(clone);
    if (mapId) recordsByMapId.set(mapId, records);
    return workspace;
  }

  function recordsForMap(mapId, zoneData = deps?.zoneLayouts?.get?.(mapId)) {
    if (recordsByMapId.has(mapId)) return recordsByMapId.get(mapId);
    const records = deriveRecords(zoneData, mapId);
    recordsByMapId.set(mapId, records);
    return records;
  }

  function authoredFootprint(data) {
    return {
      w: Math.max(1, finite(data?.footprint?.w, 1)),
      d: Math.max(1, finite(data?.footprint?.d, 1)),
    };
  }

  function makeZoneSitObject(record, data, instance = null) {
    const footprint = authoredFootprint(data);
    const seatCol = record.centerX - footprint.w / 2;
    const seatRow = record.centerZ - footprint.d / 2;
    const seatCount = Array.isArray(data?.seatAnchors) ? data.seatAnchors.length : 0;
    return {
      id: `foliage_furniture_${record.id}`,
      type: 'decorative_furniture',
      furnitureKey: record.furnitureKey,
      foliageFurniture: true,
      col: Math.floor(record.col),
      row: Math.floor(record.row),
      mesh: instance,
      interactIcon: '💺',
      interactLabel: seatCount > 1 ? 'Sit on log' : 'Sit on stump',
      label: seatCount > 1 ? '🪵 Sit on log' : '🪵 Sit on stump',
      getButtons() {
        return Array.from({ length: seatCount }, (_, index) => ({
          icon: '💺',
          label: seatCount === 1 ? 'Sit' : `Sit · seat ${index + 1}`,
          action: `obj_foliage_sit_${index}`,
          style: 'primary',
          allowed: true,
        }));
      },
      onAction(action) {
        const match = /^obj_foliage_sit_(\d+)$/.exec(String(action || ''));
        if (!match) return { ok: false, message: 'Unknown action.' };
        if (typeof deps?.sit !== 'function') return { ok: false, message: 'Sitting is not ready yet.' };
        return deps.sit(record.furnitureKey, seatCol, seatRow, footprint.w, footprint.d, record.yawDeg || 0, Number(match[1]) || 0);
      },
    };
  }

  function registerInteraction(mapId, record, data, instance) {
    let registry = objectsByMapId.get(mapId);
    if (!registry) {
      registry = new Map();
      objectsByMapId.set(mapId, registry);
    }
    const object = makeZoneSitObject(record, data, instance);
    for (let dz = 0; dz < Math.ceil(record.footprintD); dz++) {
      for (let dx = 0; dx < Math.ceil(record.footprintW); dx++) {
        registry.set(`${Math.floor(record.col) + dx},${Math.floor(record.row) + dz}`, object);
      }
    }
    return object;
  }

  function objectAt(mapId, col, row) {
    return objectsByMapId.get(mapId)?.get(`${Math.floor(col)},${Math.floor(row)}`) || null;
  }

  function blocksPoint(mapId, x, z) {
    return recordsForMap(mapId).some(record =>
      x >= record.col && x < record.col + record.footprintW
      && z >= record.row && z < record.row + record.footprintD);
  }

  async function spawnForMap(mapId) {
    if (!deps || !root.FoliageFurnitureRenderer) return [];
    const scene = deps.zoneScenes?.get?.(mapId)?.scene;
    if (!scene) return [];
    const previous = spawnStatesByMapId.get(mapId);
    if (previous?.scene === scene) return previous.promise;
    disposeMap(mapId);
    const zoneData = deps.zoneLayouts?.get?.(mapId);
    const records = recordsForMap(mapId, zoneData);
    const state = { scene, status: 'loading', instances: new Map(), error: null, promise: null };
    const pending = (async () => {
      const built = [];
      const tracked = deps.zoneDecorFurnitureGroups?.get?.(mapId) || [];
      if (!deps.zoneDecorFurnitureGroups?.has?.(mapId)) deps.zoneDecorFurnitureGroups?.set?.(mapId, tracked);
      for (const record of records) {
        try {
          const { instance, data } = await root.FoliageFurnitureRenderer.buildInstance(record, zoneData, deps);
          if (spawnStatesByMapId.get(mapId) !== state || deps.zoneScenes?.get?.(mapId)?.scene !== scene) break;
          deps.markOutline?.(instance);
          deps.markFurnitureEdgeId?.(instance);
          scene.add(instance);
          tracked.push(instance);
          built.push(instance);
          state.instances.set(record.id, instance);
          registerInteraction(mapId, record, data, instance);
          debug(`Spawned ${record.furnitureKey} for ${record.id} with ${data.seatAnchors?.length || 0} seat(s).`);
        } catch (error) {
          debug(`Failed to spawn ${record.furnitureKey}: ${error?.message || error}`, 'warn');
        }
      }
      if (spawnStatesByMapId.get(mapId) === state) state.status = 'ready';
      return built;
    })().catch(error => {
      state.status = 'failed';
      state.error = String(error?.message || error);
      throw error;
    });
    state.promise = pending;
    spawnStatesByMapId.set(mapId, state);
    return pending;
  }

  function disposeMap(mapId) {
    spawnStatesByMapId.delete(mapId);
    recordsByMapId.delete(mapId);
    objectsByMapId.delete(mapId);
  }

  function debugState(mapId = '') {
    const ids = mapId ? [mapId] : [...new Set([...recordsByMapId.keys(), ...spawnStatesByMapId.keys(), ...objectsByMapId.keys()])];
    return ids.map(id => {
      const state = spawnStatesByMapId.get(id);
      return {
        mapId: id,
        recordCount: recordsForMap(id).length,
        interactionTileCount: objectsByMapId.get(id)?.size || 0,
        instanceCount: state?.instances?.size || 0,
        status: state?.status || 'not-spawned',
        error: state?.error || null,
      };
    });
  }

  function init(injectedDeps) {
    deps = injectedDeps || {};
    debug('Initialized wilderness stump/log authored-furniture lifecycle.');
    return api;
  }

  const api = {
    DEFAULT_SEAT_NORMAL_OFFSET,
    GENERATED_KIND_TO_FURNITURE,
    furnitureKeyForGeneratedKind,
    normalizeGeneratedObject,
    recordFromGeneratedObject,
    deriveRecords,
    annotateWorkspace,
    recordsForMap,
    makeZoneSitObject,
    objectAt,
    blocksPoint,
    spawnForMap,
    disposeMap,
    debugState,
    init,
  };
  return api;
});

// Baked full-size wilderness trees are optional. Load their adapter here
// because this module is already part of every wilderness-capable game boot and
// runs after foliage-generator.js. The adapter wraps the current public tree
// builders only after GLBs have loaded; absent assets keep the procedural path.
(function autoLoadBakedTreeAssets(root) {
  if (!root?.document || root.__treeAssetLibraryBootstrapped) return;
  root.__treeAssetLibraryBootstrapped = true;
  const activate = () => {
    try { root.TreeAssetLibrary?.install?.(root.FoliageGenerator); }
    catch (error) { console.warn('[TreeAssetLibrary] optional baked-tree install failed:', error); }
  };
  if (root.TreeAssetLibrary) { activate(); return; }
  const script = root.document.createElement('script');
  script.src = 'js/tree-asset-library.js?v=20260824-branched-lod-runtime';
  script.async = true;
  script.onload = activate;
  script.onerror = () => { /* optional runtime optimization; procedural fallback remains */ };
  root.document.head.appendChild(script);
})(typeof window !== 'undefined' ? window : null);
