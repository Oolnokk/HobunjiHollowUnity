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
  let parsedMetaCache = { raw: null, meta: null, revision: undefined, storage: null }; // The guarded revision skips synchronous getItem when no save metadata changed.

  function readWorldCached(worldId) {
    const revision = window.HobunjiStorageQuota?.getSaveMetaRevision?.(); // Covers same-tab writes, folder staging, cross-tab events and browser reset.
    if (revision !== undefined && parsedMetaCache.revision === revision
        && parsedMetaCache.storage === localStorage && parsedMetaCache.raw !== null) {
      return (parsedMetaCache.meta?.worlds || []).find(w => w.id === worldId) || null; // No synchronous storage read on repeated HUD/tick calls.
    }
    const raw = localStorage.getItem(META_KEY) || 'null'; // Unguarded tests/previews retain the original per-call freshness check.
    if (parsedMetaCache.raw !== raw || parsedMetaCache.storage !== localStorage) {
      parsedMetaCache = { raw, meta: JSON.parse(raw), revision, storage: localStorage };
    } else {
      parsedMetaCache.revision = revision; // Unchanged metadata needs no parse after a revision-only transition.
    }
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

  // Collect livestock and credit the correct seller in one world-metadata
  // write. Separate roster/gold saves could lose an animal without payment
  // after a crash (or credit a second time after a partial retry).
  function completeAnimalSales(worldId, currentCharacterId, currentGold, day, candidateIds) {
    if (!worldId || !currentCharacterId || !Array.isArray(candidateIds)
        || !Number.isSafeInteger(day) || day < 1
        || !Number.isSafeInteger(currentGold) || currentGold < 0) {
      return { ok: false, error: 'Invalid animal collection context.' };
    }
    const wanted = new Set(candidateIds.map(id => String(id))); // Used only within this single collection transaction.
    if (!wanted.size) return { ok: true, sold: [], earned: 0, currentGold };
    try {
      const { meta, world } = readWorld(worldId);
      if (!world || !Array.isArray(world.livestock) || !world.members?.[currentCharacterId]) {
        return { ok: false, error: 'World or active farm member is unavailable.' };
      }
      const savedCurrentGold = Number(world.members[currentCharacterId].nonGearInventory?.gold ?? 0); // Verifies the caller's member flush really persisted the live wallet.
      if (savedCurrentGold !== currentGold) {
        return { ok: false, error: 'Active wallet has not been saved; animal collection deferred.' };
      }

      const sold = []; // Exact persisted animals collected, returned for scene/UI cleanup.
      const remaining = []; // Persisted farm roster after removing only eligible IDs.
      const earnedBySeller = new Map(); // Individual wallets receive their own queued sales, even after character switching.
      for (const animal of world.livestock) {
        const sale = animal?.pendingAnimalSale;
        const price = sale?.price;
        const eligibleDay = sale?.eligibleDay;
        if (!wanted.has(String(animal?.id)) || !Number.isSafeInteger(price) || price < 1
            || !Number.isSafeInteger(eligibleDay) || eligibleDay > day) {
          remaining.push(animal);
          continue;
        }
        const sellerId = String(sale.sellerCharacterId || currentCharacterId); // Older pending records are attributed to the active member.
        if (!world.members[sellerId]) return { ok: false, error: 'Animal seller no longer exists in this world.' };
        const subtotal = (earnedBySeller.get(sellerId) || 0) + price;
        if (!Number.isSafeInteger(subtotal)) return { ok: false, error: 'Animal sale total exceeds safe gold limits.' };
        earnedBySeller.set(sellerId, subtotal);
        sold.push(animal);
      }
      if (!sold.length) return { ok: true, sold: [], earned: 0, currentGold };

      let earned = 0;
      for (const [sellerId, subtotal] of earnedBySeller) {
        const member = world.members[sellerId];
        const savedGold = Number(member.nonGearInventory?.gold ?? 0);
        const base = sellerId === currentCharacterId ? currentGold : savedGold;
        if (!Number.isSafeInteger(base) || base < 0 || !Number.isSafeInteger(base + subtotal)) {
          return { ok: false, error: 'A seller wallet cannot accept the sale proceeds.' };
        }
        member.nonGearInventory ||= {};
        member.nonGearInventory.gold = base + subtotal;
        earned += subtotal;
      }
      if (!Number.isSafeInteger(earned)) return { ok: false, error: 'Animal sale total exceeds safe gold limits.' };

      const removedIds = new Set(sold.map(animal => String(animal.id))); // Also drops pair references in this same atomic commit.
      world.livestock = remaining;
      if (Array.isArray(world.breedingPairs)) {
        world.breedingPairs = world.breedingPairs.filter(pair =>
          ![pair?.parentA, pair?.parentB].some(ref => ref?.source === 'world' && removedIds.has(String(ref.id))));
      }
      localStorage.setItem(META_KEY, JSON.stringify(meta)); // Animal removal and seller payment commit together.
      return {
        ok: true, sold: cloneValue(sold), earned,
        currentGold: world.members[currentCharacterId].nonGearInventory.gold,
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  function fiveBlossomsFinder(worldId, civilYear) {
    const yearKey = String(civilYear); // Normalizes the festival year shared by all farmhands of one world.
    if (!worldId || !Number.isSafeInteger(Number(civilYear))) return null;
    const record = readWorldField(worldId, 'fiveBlossomsFinders')?.[yearKey];
    return record && typeof record.characterId === 'string' ? record : null;
  }
  function claimFiveBlossomsFinder(worldId, civilYear, characterId, characterName) {
    if (!worldId || !characterId || !Number.isSafeInteger(Number(civilYear))) return {ok:false,reason:'Missing world, character, or festival year'};
    const yearKey = String(civilYear); // The shared annual award is first-writer-wins and never guessed from an NPC's schedule.
    try {
      const {meta,world} = readWorld(worldId);
      if (!meta || !world) return {ok:false,reason:'World save unavailable'};
      const saved = world.fiveBlossomsFinders?.[yearKey]; // A later farmhand can never displace the first submitted player.
      if (saved) return {ok:true,first:String(saved.characterId)===String(characterId),winner:cloneValue(saved),claimed:false};
      const winner = {characterId:String(characterId),name:String(characterName || 'Farmer'),year:Number(civilYear)};
      world.fiveBlossomsFinders ||= {};
      world.fiveBlossomsFinders[yearKey] = winner;
      localStorage.setItem(META_KEY, JSON.stringify(meta)); // One synchronous world transaction prevents two same-device submissions from both winning.
      return {ok:true,first:true,winner:cloneValue(winner),claimed:true};
    } catch (error) { return {ok:false,reason:String(error?.message || error)}; }
  }

  function releaseFiveBlossomsFinder(worldId, civilYear, characterId) {
    if (!worldId || !characterId || !Number.isSafeInteger(Number(civilYear))) return false;
    try {
      const {meta,world} = readWorld(worldId); // Failed ceremonies release only their own world-year reservation, never another player's win.
      const yearKey = String(civilYear); // Mirrors the persisted civil-year identity in the claim function.
      if (!world?.fiveBlossomsFinders?.[yearKey] ||
          String(world.fiveBlossomsFinders[yearKey].characterId) !== String(characterId)) return false;
      delete world.fiveBlossomsFinders[yearKey];
      localStorage.setItem(META_KEY,JSON.stringify(meta));
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
    loadRuinProgress(worldId) { // Ruin checkpoint/wing state belongs to the shared world and to folder/cloud saves.
      try { return readWorldField(worldId, 'ruinProgress') || null; } catch { return null; }
    },
    saveRuinProgress: (worldId, value) => writeField(worldId, 'ruinProgress', value),
    loadCropProvenance(worldId) { // Corrupt or partially restored world metadata must not crash crop setup or world switching.
      try { return readWorldField(worldId, 'cropProvenance') || null; } catch { return null; }
    },
    saveCropProvenance: (worldId, ledger) => writeField(worldId, 'cropProvenance', ledger), // Same atomic world-field save path used by barn breeding and incubators.
    fiveBlossomsFinder, claimFiveBlossomsFinder, releaseFiveBlossomsFinder,
    loadStorage,
    saveStorage: (worldId, store) => writeField(worldId, 'storage', store),
    loadPendingSupplyOrders,
    completeSeedSupplyOrder,
    completeAnimalSales, // Single-write settlement; preserve both the livestock and the credited wallet on interruption.
  });
})();
