// Baked wilderness-tree asset contract + optional runtime loader.
//
// The procedural foliage generator still owns tree shapes and is always the
// fallback.  When matching GLBs exist under docs/assets/models/trees/, this
// module preloads those six fixed geometry variants and transparently swaps
// them into FoliageGenerator's existing variant getters.  Wilderness placement,
// random yaw/scale, culling, and gameplay metadata therefore do not change.
(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TreeAssetLibrary = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const SCHEMA = 'hobunji_tree_assets.v1';
  const BASE_PATH = 'assets/models/trees/';
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
  let preloadPromise = null;
  let installedFoliage = null;

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
      note: 'These six filenames are the baked variants FoliageGenerator will prefer when present. Missing files fall back to procedural trees.',
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
      failures.set(key, 'GLTFLoader unavailable');
      return Promise.resolve(null);
    }
    const promise = new Promise(resolve => {
      let loader;
      try { loader = new Loader(); }
      catch (error) {
        failures.set(key, String(error?.message || error));
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
            failures.set(key, 'GLB contained no scene');
          }
          resolve(scene);
        },
        undefined,
        error => {
          // Missing files are expected before the exported batch is uploaded.
          // Stay silent and let the procedural generator remain authoritative.
          failures.set(key, String(error?.message || error || 'load failed'));
          resolve(null);
        }
      );
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  function preload() {
    if (!preloadPromise) preloadPromise = Promise.all(ASSETS.map(loadEntry));
    return preloadPromise;
  }

  function getLoadedVariant(species, index = 0) {
    const entry = entryFor(species, index);
    return entry ? loaded.get(keyFor(entry)) || null : null;
  }

  function install(foliage = root?.FoliageGenerator) {
    if (!foliage) return false;
    if (foliage.__bakedTreeAssetsInstalled) {
      installedFoliage = foliage;
      preload();
      return true;
    }

    const originalPine = typeof foliage.getCrownedPineVariant === 'function'
      ? foliage.getCrownedPineVariant.bind(foliage) : null;
    const originalShade = typeof foliage.getShadewoodVariant === 'function'
      ? foliage.getShadewoodVariant.bind(foliage) : null;
    if (!originalPine || !originalShade) return false;

    foliage.getCrownedPineVariant = function (index) {
      return getLoadedVariant('crowned_pine', index) || originalPine(index);
    };
    foliage.getShadewoodVariant = function (index) {
      return getLoadedVariant('shadewood', index) || originalShade(index);
    };
    Object.defineProperty(foliage, '__bakedTreeAssetsInstalled', { value: true, configurable: true });
    installedFoliage = foliage;
    preload();
    return true;
  }

  function status() {
    return {
      installed: !!installedFoliage,
      expected: ASSETS.length,
      loaded: loaded.size,
      failed: failures.size,
      pending: pending.size,
      assets: ASSETS.map(entry => {
        const key = keyFor(entry);
        return {
          ...entry,
          url: urlFor(entry),
          state: loaded.has(key) ? 'loaded' : pending.has(key) ? 'loading' : failures.has(key) ? 'procedural-fallback' : 'not-requested',
        };
      }),
    };
  }

  return Object.freeze({
    SCHEMA,
    BASE_PATH,
    ASSETS,
    normalizeSpecies,
    entriesFor,
    entryFor,
    urlFor,
    makeIndex,
    loadEntry,
    preload,
    getLoadedVariant,
    install,
    status,
  });
});
