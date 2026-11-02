(() => {
  'use strict';

  // IndexedDB cache of performTothalShift's per-zone generator output
  // (moved out of game.js). Keyed by world+year+zone (the same string that
  // seeds the generator) plus the generator/fold scripts' own cache-busting
  // ?v= tags. generateZoneWorkspace + buildMergedZoneGrid are pure functions
  // of that seed and cost several seconds of main-thread work per zone, so a
  // same-year reload replays this cache instead of regenerating.
  //
  // IndexedDB, not localStorage: one zone's merged tile grid serializes to
  // several MB, beyond localStorage's quota; IndexedDB's structured clone
  // also stores the tiles Map directly with no JSON round-trip. This is a
  // disposable cache, not save data — every failure is swallowed and the
  // zone simply regenerates.
  //
  // Writes are a pure optimization for the NEXT page load, so the shift
  // doesn't wait for them (each one structured-clones several MB and commits
  // to disk). save() still snapshots its value synchronously when the
  // connection is already open (the normal case: load() opened it moments
  // earlier), so later in-memory tile edits can't leak into the cached copy.
  // One connection is reused for every request instead of reopening the
  // database per operation.
  const DB_NAME = 'hobunji-tothal-zone-cache'; // Used as the cache's own IndexedDB database (separate from save data).
  const STORE = 'zones'; // Used as the single object store holding one entry per world/year/zone key.
  const KEY_PREFIXES = ['hobunji_tothal_zonecache_v1_', 'hobunji_tothal_zonecache_v2_']; // Used by evictStale(); v1 entries lost stamped locale entrances and are always discarded.

  let db = null; // Open connection, reused until the browser closes it or another tab upgrades the schema.
  let dbPromise = null; // In-flight open request shared by concurrent callers.
  let versionTag = null; // Lazily read: generator/fold <script> tags may not be parsed yet when this module runs.

  function genVersionTag() {
    if (versionTag) return versionTag;
    const versionOf = (fileName) => {
      const el = document.querySelector(`script[src*="${fileName}"]`);
      const m = el && el.src.match(/[?&]v=([^&]+)/);
      return m ? m[1] : 'noversion';
    };
    versionTag = `${versionOf('wilderness-map-generator.js')}_${versionOf('terrain-preview.js')}`;
    return versionTag;
  }

  function forgetConnection(conn) {
    if (db === conn) { db = null; dbPromise = null; }
  }

  function openDb() {
    if (db) return Promise.resolve(db);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const conn = req.result;
        conn.onversionchange = () => { conn.close(); forgetConnection(conn); };
        conn.onclose = () => forgetConnection(conn);
        db = conn;
        resolve(conn);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  function request(mode, run) {
    const exec = conn => new Promise((resolve, reject) => {
      const tx = conn.transaction(STORE, mode);
      const result = run(tx.objectStore(STORE)); // Runs synchronously, so put() clones its value right now.
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    if (!db) return openDb().then(exec);
    const conn = db;
    return exec(conn).catch(error => {
      // transaction() throws InvalidStateError on a connection the browser
      // already closed: reopen once and retry.
      if (error?.name !== 'InvalidStateError') throw error;
      forgetConnection(conn);
      return openDb().then(exec);
    });
  }

  function key(worldId, year, zoneId) {
    return `hobunji_tothal_zonecache_v2_${genVersionTag()}_${worldId}_y${year}_${zoneId}`;
  }

  async function load(cacheKey) {
    try {
      const cached = await request('readonly', store => store.get(cacheKey));
      if (!cached?.merged || !cached?.workspace) return null;
      return cached; // merged.tiles is already a real Map (structured clone, not JSON).
    } catch (_) { return null; }
  }

  // All of one shift's zones at once: Map zoneId -> cached entry or null.
  async function loadAll(worldId, year, zoneIds) {
    const entries = await Promise.all(zoneIds.map(async zoneId => [zoneId, await load(key(worldId, year, zoneId))]));
    return new Map(entries);
  }

  function save(cacheKey, workspace, merged) {
    const value = {
      workspace: {
        entry: workspace.entry || null,
        tradeExit: workspace.tradeExit || null,
        animalDens: workspace.animalDens || [],
        localeInstances: workspace.localeInstances || [],
        localeTransitions: (workspace.maps || []).find(map => map && !map.isSubmap)?.transitions?.filter(t => t?.generatedLocaleId) || [], // Restored zones need the stamped cave entrances as well as their instance markers.
        rootTotems: workspace.rootTotems || [],
        foliagePatches: workspace.foliagePatches || [],
        wildernessFoliageFurniture: workspace.wildernessFoliageFurniture || [],
        ambushStations: workspace.ambushStations || [],
      },
      merged: {
        cols: merged.cols, rows: merged.rows, tiles: merged.tiles,
        mesas: merged.mesas, buildings: merged.buildings,
      },
    };
    // Quota exceeded, DataCloneError or storage unavailable — a pure
    // optimization; skip it and let the next session regenerate.
    return request('readwrite', store => store.put(value, cacheKey)).then(() => {}, () => {});
  }

  // Drops this world's stale zone caches (older years or a stale
  // generator/fold version) so a save played across many Tothal years
  // doesn't accumulate dead entries. Other worlds' caches are untouched.
  // Never deletes a current key, so it is safe to run alongside save().
  async function evictStale(worldId, year, zoneIds) {
    try {
      const keep = new Set(zoneIds.map(zoneId => key(worldId, year, zoneId)));
      const allKeys = await request('readonly', store => store.getAllKeys()) || [];
      const stale = allKeys.filter(k => typeof k === 'string' && KEY_PREFIXES.some(prefix => k.startsWith(prefix)) && k.includes(`_${worldId}_y`) && !keep.has(k));
      if (stale.length) await request('readwrite', store => { stale.forEach(k => store.delete(k)); });
    } catch (_) {}
  }

  window.TothalZoneCache = { key, load, loadAll, save, evictStale };
})();
