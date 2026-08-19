// Baked wilderness-tree asset contract + optional runtime loader.
//
// The procedural foliage generator still owns tree shapes and is always the
// fallback. When matching GLBs exist under docs/assets/models/trees/, this
// module preloads those six fixed geometry variants and transparently swaps
// them into FoliageGenerator's existing variant getters. Wilderness placement,
// random yaw/scale, culling, and gameplay metadata therefore do not change.
(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TreeAssetLibrary = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const SCHEMA = 'hobunji_tree_assets.v1';
  const BASE_PATH = 'assets/models/trees/';
  const MODE_KEY = 'hobunji_tree_asset_mode_v1';
  const MODES = Object.freeze(['baked', 'procedural']);
  const ASSETS = Object.freeze([
    Object.freeze({ species: 'crowned_pine', variant: 1, filename: 'crowned_pine_01.glb', builder: 'buildCrownedPineMesh', seed: 1 }),
    Object.freeze({ species: 'crowned_pine', variant: 2, filename: 'crowned_pine_02.glb', builder: 'buildCrownedPineMesh', seed: 2 }),
    Object.freeze({ species: 'crowned_pine', variant: 3, filename: 'crowned_pine_03.glb', builder: 'buildCrownedPineMesh', seed: 3 }),
    Object.freeze({ species: 'shadewood', variant: 1, filename: 'shadewood_01.glb', builder: 'buildShadewoodMesh', seed: 1 }),
    Object.freeze({ species: 'shadewood', variant: 2, filename: 'shadewood_02.glb', builder: 'buildShadewoodMesh', seed: 2 }),
    Object.freeze({ species: 'shadewood', variant: 3, filename: 'shadewood_03.glb', builder: 'buildShadewoodMesh', seed: 3 }),
  ]);

  const loaded = new Map();
  const failures = new Map();
  const pending = new Map();
  const warned = new Set();
  let preloadPromise = null;
  let installedFoliage = null;
  let originals = null;
  let mode = readMode();

  function debug(message, level = 'info') {
    const text = `[TreeAssets] ${message}`;
    if (typeof root?.__farmLog === 'function') root.__farmLog(text, level, 'assets');
    else if (level === 'warn' || level === 'error') console.warn(text);
    else console.log(text);
  }

  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    debug(message, 'warn');
  }

  function readMode() {
    try {
      const stored = String(root?.localStorage?.getItem(MODE_KEY) || 'baked').toLowerCase();
      return stored === 'procedural' ? 'procedural' : 'baked';
    } catch (_) { return 'baked'; }
  }

  function getMode() { return mode; }

  function setMode(nextMode) {
    const normalized = String(nextMode || '').toLowerCase() === 'procedural' ? 'procedural' : 'baked';
    mode = normalized;
    try { root?.localStorage?.setItem(MODE_KEY, normalized); } catch (_) {}
    warned.clear();
    if (mode === 'baked') preload();
    debug(`Tree source mode set to ${mode}. Existing spawned trees keep their current geometry until the zone/game is rebuilt.`, 'info');
    return mode;
  }

  function normalizeSpecies(value) {
    const s = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (s === 'crownedpine' || s === 'pine') return 'crowned_pine';
    if (s === 'shadewood_tree') return 'shadewood';
    return s;
  }

  function entriesFor(species) {
    const normalized = normalizeSpecies(species);
    return ASSETS.filter(entry => entry.species === normalized);
  }

  function entryFor(species, index = 0) {
    const list = entriesFor(species);
    if (!list.length) return null;
    const n = Number.isFinite(Number(index)) ? Math.floor(Number(index)) : 0;
    return list[((n % list.length) + list.length) % list.length];
  }

  function keyFor(entry) {
    return entry ? `${entry.species}:${entry.variant}` : '';
  }

  function urlFor(entryOrSpecies, index = 0) {
    const entry = typeof entryOrSpecies === 'object' ? entryOrSpecies : entryFor(entryOrSpecies, index);
    return entry ? `${BASE_PATH}${entry.filename}` : null;
  }

  function makeIndex() {
    return {
      schema: SCHEMA,
      basePath: BASE_PATH,
      generatedBy: 'docs/tools/tree-asset-exporter/index.html',
      note: 'These six filenames are the baked variants FoliageGenerator will prefer when baked mode is selected. Missing files fall back to procedural trees.',
      assets: ASSETS.map(entry => ({ ...entry })),
    };
  }

  function loaderClass() {
    return root?.THREE?.GLTFLoader || root?.GLTFLoader || null;
  }

  function normalizeLoadedScene(entry, gltf) {
    const scene = gltf?.scene || gltf?.scenes?.[0] || null;
    if (!scene) return null;
    scene.name = `BakedTree_${entry.species}_${String(entry.variant).padStart(2, '0')}`;
    scene.userData = { ...(scene.userData || {}), bakedTreeAsset: true, treeSpecies: entry.species, treeVariant: entry.variant };
    scene.updateMatrixWorld?.(true);
    scene.traverse?.(child => {
      if (!child?.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = true;
      child.userData = { ...(child.userData || {}), bakedTreeAsset: true };
    });
    return scene;
  }

  function loadEntry(entry) {
    if (!entry) return Promise.resolve(null);
    const key = keyFor(entry);
    if (loaded.has(key)) return Promise.resolve(loaded.get(key));
    if (pending.has(key)) return pending.get(key);
    const Loader = loaderClass();
    if (!Loader) {
      const reason = 'GLTFLoader unavailable';
      failures.set(key, reason);
      if (mode === 'baked') warnOnce(`loader:${key}`, `${entry.filename} cannot load (${reason}); using procedural ${entry.species} variant ${entry.variant}.`);
      return Promise.resolve(null);
    }
    const promise = new Promise(resolve => {
      let loader;
      try { loader = new Loader(); }
      catch (error) {
        const reason = String(error?.message || error);
        failures.set(key, reason);
        if (mode === 'baked') warnOnce(`loader:${key}`, `${entry.filename} loader creation failed (${reason}); using procedural fallback.`);
        resolve(null);
        return;
      }
      loader.load(
        urlFor(entry),
        gltf => {
          const scene = normalizeLoadedScene(entry, gltf);
          if (scene) {
            loaded.set(key, scene);
            failures.delete(key);
          } else {
            const reason = 'GLB contained no scene';
            failures.set(key, reason);
            if (mode === 'baked') warnOnce(`empty:${key}`, `${entry.filename} ${reason}; using procedural fallback.`);
          }
          resolve(scene);
        },
        undefined,
        error => {
          const reason = String(error?.message || error || 'load failed');
          failures.set(key, reason);
          if (mode === 'baked') warnOnce(`load:${key}`, `${entry.filename} failed to load (${reason}); using procedural fallback.`);
          resolve(null);
        }
      );
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  function preload(options = {}) {
    const force = options?.force === true;
    if (force) {
      preloadPromise = null;
      for (const key of failures.keys()) pending.delete(key);
    }
    if (!preloadPromise) preloadPromise = Promise.all(ASSETS.map(loadEntry));
    return preloadPromise;
  }

  function getLoadedVariant(species, index = 0) {
    const entry = entryFor(species, index);
    return entry ? loaded.get(keyFor(entry)) || null : null;
  }

  function fallbackReason(entry) {
    const key = keyFor(entry);
    if (pending.has(key)) return 'still loading';
    if (failures.has(key)) return failures.get(key);
    return 'not loaded';
  }

  function resolveVariant(species, index, proceduralGetter) {
    if (mode === 'procedural') return proceduralGetter(index);
    const entry = entryFor(species, index);
    const baked = entry ? loaded.get(keyFor(entry)) : null;
    if (baked) return baked;
    if (entry) {
      warnOnce(`fallback:${keyFor(entry)}`,
        `Baked mode requested ${entry.filename}, but it is ${fallbackReason(entry)}; this variant is using procedural fallback.`);
      loadEntry(entry);
    }
    return proceduralGetter(index);
  }

  function install(foliage = root?.FoliageGenerator) {
    if (!foliage) {
      if (mode === 'baked') warnOnce('install:no-foliage', 'FoliageGenerator is unavailable; baked tree assets cannot be installed.');
      return false;
    }
    if (foliage.__bakedTreeAssetsInstalled) {
      installedFoliage = foliage;
      if (mode === 'baked') preload();
      return true;
    }

    const originalPine = typeof foliage.getCrownedPineVariant === 'function'
      ? foliage.getCrownedPineVariant.bind(foliage) : null;
    const originalShade = typeof foliage.getShadewoodVariant === 'function'
      ? foliage.getShadewoodVariant.bind(foliage) : null;
    if (!originalPine || !originalShade) {
      if (mode === 'baked') warnOnce('install:getters', 'Tree variant getters are unavailable; baked tree mode cannot replace procedural geometry.');
      return false;
    }

    originals = { pine: originalPine, shade: originalShade };
    foliage.getCrownedPineVariant = function (index) {
      return resolveVariant('crowned_pine', index, originalPine);
    };
    foliage.getShadewoodVariant = function (index) {
      return resolveVariant('shadewood', index, originalShade);
    };
    Object.defineProperty(foliage, '__bakedTreeAssetsInstalled', { value: true, configurable: true });
    installedFoliage = foliage;
    if (mode === 'baked') preload();
    return true;
  }

  function status() {
    return {
      mode,
      installed: !!installedFoliage,
      expected: ASSETS.length,
      loaded: loaded.size,
      failed: failures.size,
      pending: pending.size,
      proceduralGettersCaptured: !!originals,
      assets: ASSETS.map(entry => {
        const key = keyFor(entry);
        return {
          ...entry,
          url: urlFor(entry),
          state: mode === 'procedural'
            ? 'procedural-selected'
            : loaded.has(key) ? 'loaded'
            : pending.has(key) ? 'loading'
            : failures.has(key) ? 'procedural-fallback'
            : 'not-requested',
          error: failures.get(key) || null,
        };
      }),
    };
  }

  return Object.freeze({
    SCHEMA,
    BASE_PATH,
    MODE_KEY,
    MODES,
    ASSETS,
    normalizeSpecies,
    entriesFor,
    entryFor,
    urlFor,
    makeIndex,
    getMode,
    setMode,
    loadEntry,
    preload,
    getLoadedVariant,
    install,
    status,
  });
});