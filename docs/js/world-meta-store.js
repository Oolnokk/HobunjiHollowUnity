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

  function writeField(worldId, field, value) {
    if (!worldId) return;
    try {
      const { meta, world } = readWorld(worldId);
      if (!world) return;
      world[field] = value;
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {}
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
      return readWorld(worldId).world?.livestock ?? [];
    } catch { return []; }
    finally {
      window.PerfProfiler?.record('_loadWorldLivestock: parse+find (cache miss)', performance.now() - parseStart);
      recordLivestockMissCaller();
    }
  }

  function loadBreedingPairs(worldId) {
    if (!worldId) return [];
    try { return readWorld(worldId).world?.breedingPairs ?? []; } catch { return []; }
  }

  function loadStorage(worldId) {
    if (!worldId) return {};
    try { return readWorld(worldId).world?.storage ?? {}; } catch { return {}; }
  }

  window.WorldMetaStore = Object.freeze({
    loadLivestock,
    saveLivestock: (worldId, list) => writeField(worldId, 'livestock', list),
    setLivestockFrameCache: (list) => { livestockFrameCache = list || null; },
    loadBreedingPairs,
    saveBreedingPairs: (worldId, list) => writeField(worldId, 'breedingPairs', list),
    loadStorage,
    saveStorage: (worldId, store) => writeField(worldId, 'storage', store),
  });
})();
