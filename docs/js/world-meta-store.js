// World-scoped save fields — livestock, breeding pairs and the farm's shared
// storage pool. These belong to the world itself (not whichever character is
// playing it), so they live on the current world's entry in
// localStorage.hobunjiSaveMeta rather than in the per-character save.
//
// Extracted from game.js, which keeps thin _loadWorldLivestock /
// _saveWorldLivestock / _loadWorldBreedingPairs / ... wrappers that pass the
// current world id in, so no init(deps) ordering is needed.
(() => {
  'use strict';

  const META_KEY = 'hobunjiSaveMeta';

  // Set only while FarmAnimals.updateAnimalMeshes is iterating this frame's
  // animals — every farm-animal tick() reads livestock at least once
  // (_farmAnimalBarnTick, plus the uumkao'ii dew check), so without a cache a
  // farm with a handful of animals re-parsed the entire save blob from
  // localStorage hundreds of times per second, which reads as the whole game
  // freezing. Left null the rest of the time so every other (infrequent — UI
  // clicks, day-tick) caller still always gets a fresh read.
  let livestockFrameCache = null;

  function readWorld(worldId) {
    const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
    return { meta, world: (meta?.worlds || []).find(w => w.id === worldId) || null };
  }

  // Read-only loaders (called from per-frame and per-tick paths) used to
  // JSON.parse the whole save blob on every call. Keep the last parsed blob,
  // keyed by the raw localStorage string (an equality check is far cheaper
  // than a parse, and any write changes the string), and hand callers a deep
  // copy of just the field they asked for. The cached object itself is never
  // exposed, so callers can keep mutating what they receive exactly as they
  // could with a fresh parse. Writers keep using the uncached readWorld.
  let parsedMetaCache = { raw: null, meta: null };

  function readWorldCached(worldId) {
    const raw = localStorage.getItem(META_KEY) || 'null';
    if (parsedMetaCache.raw !== raw) parsedMetaCache = { raw, meta: JSON.parse(raw) };
    return (parsedMetaCache.meta?.worlds || []).find(w => w.id === worldId) || null;
  }

  function cloneValue(value) {
    if (value == null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function readWorldField(worldId, field) {
    return cloneValue(readWorldCached(worldId)?.[field]);
  }

  function writeField(worldId, field, value) {
    if (!worldId) return false;
    try {
      const { meta, world } = readWorld(worldId);
      if (!world) return false;
      world[field] = value;
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      return true;
    } catch { return false; }
  }

  // Caller tracing for livestock cache misses. Capturing a stack is far from
  // free, so it only runs while the profiler's own traceLivestockCallers flag
  // is on (it previously ran on every miss whenever PerfProfiler existed).
  function recordLivestockMissCaller() {
    const profiler = window.PerfProfiler;
    if (!profiler?.traceLivestockCallers) return;
    // Frame 0 is "Error", frame 1 this function, frame 2 loadLivestock,
    // frame 3 game.js's _loadWorldLivestock wrapper, frame 4 the real caller.
    const line = (new Error().stack || '').split('\n')[4] || '';
    const match = line.match(/([\w-]+\.js)(?:\?[^:()\s]*)?:(\d+):(\d+)/);
    const callerLabel = match ? `${match[1]}:${match[2]}` : (line.trim().slice(0, 60) || 'unknown caller');
    profiler.record('_loadWorldLivestock miss caller: ' + callerLabel, 0);
  }

  function loadLivestock(worldId) {
    if (livestockFrameCache) {
      window.PerfProfiler?.record('_loadWorldLivestock: cache hit', 0);
      return livestockFrameCache;
    }
    if (!worldId) return [];
    const parseStart = performance.now();
    try {
      return readWorldField(worldId, 'livestock') ?? [];
    } catch { return []; }
    finally {
      window.PerfProfiler?.record('_loadWorldLivestock: parse+find (cache miss)', performance.now() - parseStart);
      recordLivestockMissCaller();
    }
  }

  function loadBreedingPairs(worldId) {
    if (!worldId) return [];
    try { return readWorldField(worldId, 'breedingPairs') ?? []; } catch { return []; }
  }

  function loadStorage(worldId) {
    if (!worldId) return {};
    try { return readWorldField(worldId, 'storage') ?? {}; } catch { return {}; }
  }

  function loadPendingSupplyOrders(worldId) {
    if (!worldId) return [];
    try {
      const orders = readWorldField(worldId, 'pendingSupplyOrders');
      return Array.isArray(orders) ? orders.map(order => ({ ...order })) : [];
    } catch { return []; }
  }

  function completeSeedSupplyOrder(worldId, order, seedGives) {
    // Storage credit and removal of the paid order must commit in the SAME world
    // metadata write. A crash/reload between two independent saves would duplicate seeds.
    if (!worldId || !order || !seedGives || typeof seedGives !== 'object') return false;
    try {
      const { meta, world } = readWorld(worldId);
      if (!world || !Array.isArray(world.pendingSupplyOrders)) return false;
      const idx = world.pendingSupplyOrders.findIndex(saved => order.id
        ? saved.id === order.id
        : !saved.id && saved.key === order.key && saved.qty === order.qty && saved.arrivalDay === order.arrivalDay);
      if (idx < 0) return false; // Never credit an unknown/already completed delivery.
      const qty = Number(order.qty);
      if (!Number.isInteger(qty) || qty < 1) return false;
      const storage = { ...(world.storage || {}) }; // Copy-on-write: do not mutate a live inventory until persistence succeeds.
      for (const [key, count] of Object.entries(seedGives)) {
        if (!/^[A-Za-z0-9_]+$/.test(key) || !Number.isInteger(count) || count < 1) return false;
        const existing = Number(storage[key]) || 0;
        if (!Number.isSafeInteger(existing) || existing < 0 || !Number.isSafeInteger(existing + count * qty)) return false;
        storage[key] = existing + count * qty;
      }
      world.storage = storage;
      world.pendingSupplyOrders.splice(idx, 1);
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      return true;
    } catch { return false; }
  }

  window.WorldMetaStore = Object.freeze({
    loadLivestock,
    saveLivestock: (worldId, list) => writeField(worldId, 'livestock', list),
    setLivestockFrameCache: (list) => { livestockFrameCache = list || null; },
    loadBreedingPairs,
    saveBreedingPairs: (worldId, list) => writeField(worldId, 'breedingPairs', list),
    loadIncubators: worldId => readWorldField(worldId, 'incubators'), // Incubation travels with the canonical world and every recovery snapshot.
    saveIncubators(worldId, value) {
      const { meta, world } = readWorld(worldId); // Use the same world authority as livestock.
      if (!world) return false;
      world.incubators = value;
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      return true;
    },
    loadArtifactCollection(worldId) { // Shared by every member of the world and preserved in folder/recovery saves.
      try { return readWorldField(worldId, 'artifactCollection') || null; } catch { return null; }
    },
    saveArtifactCollection(worldId, value) {
      try {
        const { meta, world } = readWorld(worldId); // Save success must be observable before a donation consumes an item.
        if (!world) return false;
        world.artifactCollection = value;
        world.artifactCollectionValue = value.donated.length;
        localStorage.setItem(META_KEY, JSON.stringify(meta));
        return true;
      } catch { return false; }
    },
    loadStorage,
    saveStorage: (worldId, store) => writeField(worldId, 'storage', store),
    loadPendingSupplyOrders,
    completeSeedSupplyOrder,
  });
})();
