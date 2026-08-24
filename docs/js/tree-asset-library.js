// Baked wilderness-tree asset contract + runtime LOD adapter.
//
// Procedural foliage remains the authoritative gameplay fallback and owns each
// placed tree's transform plus shadewood's per-tree climb-branch roll. Baked
// GLBs replace only the visual body. A shadewood whose procedural instance
// rolled a perch uses the dedicated shadewood-branched asset family; its
// climbBranchLocal metadata stays procedural so gameplay never depends on GLB
// extras being present or correctly named.
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
  const LOD_SWITCH_DISTANCE = 3.0; // 90% solid-geometry LOD is visually close; keep full detail only in the immediate vicinity.
  const ASSETS = Object.freeze([
    Object.freeze({ species: 'crowned_pine', variant: 1, filename: 'crowned_pine_01.glb', lodFilename: 'crowned_pine_01_lod-decimate-90.glb', builder: 'buildCrownedPineMesh', seed: 1 }),
    Object.freeze({ species: 'crowned_pine', variant: 2, filename: 'crowned_pine_02.glb', lodFilename: 'crowned_pine_02_lod-decimate-90.glb', builder: 'buildCrownedPineMesh', seed: 2 }),
    Object.freeze({ species: 'crowned_pine', variant: 3, filename: 'crowned_pine_03.glb', lodFilename: 'crowned_pine_03_lod-decimate-90.glb', builder: 'buildCrownedPineMesh', seed: 3 }),
    Object.freeze({ species: 'shadewood', variant: 1, filename: 'shadewood_01.glb', lodFilename: 'shadewood_01_lod-decimate-90.glb', branchedFilename: 'shadewood-branched_01.glb', branchedLodFilename: 'shadewood-branched_01_lod-decimate-90.glb', builder: 'buildShadewoodMesh', seed: 1 }),
    Object.freeze({ species: 'shadewood', variant: 2, filename: 'shadewood_02.glb', lodFilename: 'shadewood_02_lod-decimate-90.glb', branchedFilename: 'shadewood-branched_02.glb', branchedLodFilename: 'shadewood-branched_02_lod-decimate-90.glb', builder: 'buildShadewoodMesh', seed: 2 }),
    Object.freeze({ species: 'shadewood', variant: 3, filename: 'shadewood_03.glb', lodFilename: 'shadewood_03_lod-decimate-90.glb', branchedFilename: 'shadewood-branched_03.glb', branchedLodFilename: 'shadewood-branched_03_lod-decimate-90.glb', builder: 'buildShadewoodMesh', seed: 3 }),
  ]);

  const loadedNear = new Map();
  const loadedFar = new Map();
  const loadedBranchedNear = new Map();
  const loadedBranchedFar = new Map();
  const failures = new Map();
  const pending = new Map();
  const warned = new Set();
  let preloadPromise = null;
  let installedFoliage = null;
  let originals = null;
  let installMode = null;
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
    if (s === 'shadewood_tree' || s === 'shadewood_branched') return 'shadewood';
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

  function xfnv1a(value) {
    const text = String(value ?? '');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function entryForCoordinates(species, col = 0, row = 0) {
    const list = entriesFor(species);
    if (!list.length) return null;
    return list[xfnv1a(`${normalizeSpecies(species)}:${col}:${row}`) % list.length];
  }

  function urlFor(entryOrSpecies, index = 0) {
    const entry = typeof entryOrSpecies === 'object' ? entryOrSpecies : entryFor(entryOrSpecies, index);
    return entry ? `${BASE_PATH}${entry.filename}` : null;
  }

  function lodUrlFor(entryOrSpecies, index = 0) {
    const entry = typeof entryOrSpecies === 'object' ? entryOrSpecies : entryFor(entryOrSpecies, index);
    return entry?.lodFilename ? `${BASE_PATH}${entry.lodFilename}` : null;
  }

  function branchedUrlFor(entryOrSpecies, index = 0) {
    const entry = typeof entryOrSpecies === 'object' ? entryOrSpecies : entryFor(entryOrSpecies, index);
    return entry?.branchedFilename ? `${BASE_PATH}${entry.branchedFilename}` : null;
  }

  function branchedLodUrlFor(entryOrSpecies, index = 0) {
    const entry = typeof entryOrSpecies === 'object' ? entryOrSpecies : entryFor(entryOrSpecies, index);
    return entry?.branchedLodFilename ? `${BASE_PATH}${entry.branchedLodFilename}` : null;
  }

  function makeIndex() {
    return {
      schema: SCHEMA,
      basePath: BASE_PATH,
      generatedBy: 'docs/tools/tree-asset-exporter/index.html',
      note: 'Near GLBs are used only within the immediate player vicinity. Far 90% LODs take over at lodSwitchDistance. Shadewoods that rolled a climbable perch use branchedFilename/branchedLodFilename while gameplay branch coordinates remain procedural.',
      lodSwitchDistance: LOD_SWITCH_DISTANCE,
      assets: ASSETS.map(entry => ({ ...entry })),
    };
  }

  function loaderClass() {
    return root?.THREE?.GLTFLoader || root?.GLTFLoader || null;
  }

  function findTreeRoot(entry, gltf) {
    const scene = gltf?.scene || gltf?.scenes?.[0] || null;
    if (!scene) return null;
    if (scene.userData?.treeSpecies === entry.species) return scene;
    const direct = scene.children?.find?.(child => child?.userData?.treeSpecies === entry.species);
    if (direct) return direct;
    if (scene.children?.length === 1) return scene.children[0];
    return scene;
  }

  function normalizeLoadedRoot(entry, gltf, level, branched) {
    const treeRoot = findTreeRoot(entry, gltf);
    if (!treeRoot) return null;
    treeRoot.name = treeRoot.name || `BakedTree_${entry.species}_${String(entry.variant).padStart(2, '0')}`;
    treeRoot.userData = {
      ...(treeRoot.userData || {}),
      bakedTreeAsset: true,
      treeSpecies: entry.species,
      treeVariant: entry.variant,
      treeAssetLevel: level,
      treeAssetBranched: !!branched,
    };
    treeRoot.updateMatrixWorld?.(true);
    treeRoot.traverse?.(child => {
      if (!child?.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = true;
      child.userData = { ...(child.userData || {}), bakedTreeAsset: true, treeAssetLevel: level, treeAssetBranched: !!branched };
    });
    return treeRoot;
  }

  function stateKey(entry, level, branched = false) {
    return `${branched ? 'branched-' : ''}${level}:${keyFor(entry)}`;
  }

  function loadedMapFor(level, branched = false) {
    if (branched) return level === 'far' ? loadedBranchedFar : loadedBranchedNear;
    return level === 'far' ? loadedFar : loadedNear;
  }

  function fileForLevel(entry, level, branched = false) {
    if (branched) return level === 'far' ? entry?.branchedLodFilename : entry?.branchedFilename;
    return level === 'far' ? entry?.lodFilename : entry?.filename;
  }

  function loadEntry(entry, level = 'near', branched = false) {
    if (!entry) return Promise.resolve(null);
    const filename = fileForLevel(entry, level, branched);
    if (!filename) return Promise.resolve(null);
    const cache = loadedMapFor(level, branched);
    const key = keyFor(entry);
    const state = stateKey(entry, level, branched);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(state)) return pending.get(state);
    const Loader = loaderClass();
    if (!Loader) {
      const reason = 'GLTFLoader unavailable';
      failures.set(state, reason);
      if (mode === 'baked') warnOnce(`loader:${state}`, `${filename} cannot load (${reason}); using available fallback.`);
      return Promise.resolve(null);
    }
    const promise = new Promise(resolve => {
      let loader;
      try { loader = new Loader(); }
      catch (error) {
        const reason = String(error?.message || error);
        failures.set(state, reason);
        if (mode === 'baked') warnOnce(`loader:${state}`, `${filename} loader creation failed (${reason}); using available fallback.`);
        resolve(null);
        return;
      }
      loader.load(
        `${BASE_PATH}${filename}`,
        gltf => {
          const treeRoot = normalizeLoadedRoot(entry, gltf, level, branched);
          if (treeRoot) {
            cache.set(key, treeRoot);
            failures.delete(state);
          } else {
            const reason = 'GLB contained no tree scene';
            failures.set(state, reason);
            if (mode === 'baked') warnOnce(`empty:${state}`, `${filename} ${reason}; using available fallback.`);
          }
          resolve(treeRoot);
        },
        undefined,
        error => {
          const reason = String(error?.message || error || 'load failed');
          failures.set(state, reason);
          if (mode === 'baked') warnOnce(`load:${state}`, `${filename} failed to load (${reason}); using available fallback.`);
          resolve(null);
        }
      );
    }).finally(() => pending.delete(state));
    pending.set(state, promise);
    return promise;
  }

  function preload(options = {}) {
    const force = options?.force === true;
    if (force) {
      preloadPromise = null;
      pending.clear();
      failures.clear();
    }
    if (!preloadPromise) {
      const jobs = [];
      for (const entry of ASSETS) {
        jobs.push(loadEntry(entry, 'near', false));
        if (entry.lodFilename) jobs.push(loadEntry(entry, 'far', false));
        if (entry.branchedFilename) jobs.push(loadEntry(entry, 'near', true));
        if (entry.branchedLodFilename) jobs.push(loadEntry(entry, 'far', true));
      }
      preloadPromise = Promise.all(jobs);
    }
    return preloadPromise;
  }

  function getLoadedVariant(species, index = 0, level = 'near', branched = false) {
    const entry = entryFor(species, index);
    return entry ? loadedMapFor(level, branched).get(keyFor(entry)) || null : null;
  }

  function cloneJson(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  function stripRecognizedClimbBranches(rootObject) {
    const remove = [];
    rootObject?.traverse?.(child => {
      if (child !== rootObject && (child?.name === 'climbBranch' || child?.userData?.isClimbBranch)) remove.push(child);
    });
    for (const child of remove) child.parent?.remove?.(child);
  }

  function cloneLevelRoot(template, keepBranchedVisual) {
    if (!template) return null;
    const clone = template.clone(true);
    // Exported GLBs include the exporter source instance's yaw/scale. Runtime
    // transform comes from the per-tile procedural oracle, so normalize the
    // baked local root before applying that outer transform.
    clone.position?.set?.(0, 0, 0);
    clone.quaternion?.identity?.();
    clone.scale?.set?.(1, 1, 1);
    clone.matrixAutoUpdate = true;
    if (!keepBranchedVisual) stripRecognizedClimbBranches(clone);
    clone.updateMatrix?.();
    clone.updateMatrixWorld?.(true);
    return clone;
  }

  function makeBakedTree(species, col, row, opts, proceduralBuilder) {
    const procedural = proceduralBuilder(col, row, opts);
    if (mode === 'procedural') return procedural;

    const entry = entryForCoordinates(species, col, row);
    if (!entry) return procedural;
    const key = keyFor(entry);
    const wantsClimbBranch = species === 'shadewood' && !!procedural?.userData?.climbBranchLocal;
    const nearMap = loadedMapFor('near', wantsClimbBranch);
    const farMap = loadedMapFor('far', wantsClimbBranch);
    const nearTemplate = nearMap.get(key);
    const farTemplate = farMap.get(key);

    if (!nearTemplate && !farTemplate) {
      loadEntry(entry, 'near', wantsClimbBranch);
      loadEntry(entry, 'far', wantsClimbBranch);
      // A branched tree must stay visibly branched if its dedicated GLB pair is
      // unavailable. Never substitute the unbranched baked family for it.
      return procedural;
    }

    const T = root?.THREE;
    if (!T?.Group) return procedural;

    const outer = new T.Group();
    outer.name = `BakedTreeLOD_${entry.species}_${String(entry.variant).padStart(2, '0')}${wantsClimbBranch ? '_branched' : ''}`;
    outer.position.copy?.(procedural.position);
    outer.quaternion.copy?.(procedural.quaternion);
    outer.scale.copy?.(procedural.scale);

    const nearFilename = fileForLevel(entry, 'near', wantsClimbBranch);
    const farFilename = fileForLevel(entry, 'far', wantsClimbBranch);
    outer.userData = {
      ...(procedural.userData || {}), // Keeps climbBranchLocal from the authoritative per-tree procedural roll.
      bakedTreeAsset: true,
      treeLodEnabled: !!farTemplate,
      treeSpecies: entry.species,
      treeVariant: entry.variant,
      treeVisualBranched: wantsClimbBranch,
      nearFilename: nearTemplate ? nearFilename : farFilename,
      farFilename: farTemplate ? farFilename : null,
      lodSwitchDistance: LOD_SWITCH_DISTANCE,
    };

    const canopyLocal = nearTemplate?.userData?.canopyLocal || farTemplate?.userData?.canopyLocal || procedural?.userData?.canopyLocal;
    if (canopyLocal) outer.userData.canopyLocal = cloneJson(canopyLocal);

    const near = cloneLevelRoot(nearTemplate || farTemplate, wantsClimbBranch);
    const far = farTemplate ? cloneLevelRoot(farTemplate, wantsClimbBranch) : null;
    if (T.LOD && near) {
      const lod = new T.LOD();
      lod.name = 'treeVisualLOD';
      lod.userData.treeLodController = true;
      lod.userData.treeVisualBranched = wantsClimbBranch;
      lod.addLevel(near, 0);
      if (far) lod.addLevel(far, LOD_SWITCH_DISTANCE);
      outer.add(lod);
    } else if (near) {
      outer.add(near);
    }

    outer.updateMatrixWorld?.(true);
    return outer;
  }

  function fallbackReason(entry, level = 'near', branched = false) {
    const state = stateKey(entry, level, branched);
    if (pending.has(state)) return 'still loading';
    if (failures.has(state)) return failures.get(state);
    return 'not loaded';
  }

  // Legacy getter adapter retained for old tools/tests. Current runtime uses the
  // public buildCrownedPineMesh/buildShadewoodMesh functions instead.
  function resolveVariant(species, index, proceduralGetter) {
    if (mode === 'procedural') return proceduralGetter(index);
    const entry = entryFor(species, index);
    const baked = entry ? loadedNear.get(keyFor(entry)) : null;
    if (baked) return baked;
    if (entry) {
      warnOnce(`fallback:${keyFor(entry)}`, `Baked mode requested ${entry.filename}, but it is ${fallbackReason(entry)}; this variant is using procedural fallback.`);
      loadEntry(entry, 'near', false);
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

    const originalPineBuilder = typeof foliage.buildCrownedPineMesh === 'function'
      ? foliage.buildCrownedPineMesh.bind(foliage) : null;
    const originalShadeBuilder = typeof foliage.buildShadewoodMesh === 'function'
      ? foliage.buildShadewoodMesh.bind(foliage) : null;

    if (originalPineBuilder && originalShadeBuilder) {
      originals = { pine: originalPineBuilder, shade: originalShadeBuilder };
      foliage.buildCrownedPineMesh = function (col, row, opts) {
        return makeBakedTree('crowned_pine', col, row, opts, originalPineBuilder);
      };
      foliage.buildShadewoodMesh = function (col, row, opts) {
        return makeBakedTree('shadewood', col, row, opts, originalShadeBuilder);
      };
      installMode = 'builders';
    } else {
      const originalPineGetter = typeof foliage.getCrownedPineVariant === 'function'
        ? foliage.getCrownedPineVariant.bind(foliage) : null;
      const originalShadeGetter = typeof foliage.getShadewoodVariant === 'function'
        ? foliage.getShadewoodVariant.bind(foliage) : null;
      if (!originalPineGetter || !originalShadeGetter) {
        if (mode === 'baked') warnOnce('install:api', 'Tree builder/getter API is unavailable; baked tree mode cannot replace procedural geometry.');
        return false;
      }
      originals = { pine: originalPineGetter, shade: originalShadeGetter };
      foliage.getCrownedPineVariant = function (index) {
        return resolveVariant('crowned_pine', index, originalPineGetter);
      };
      foliage.getShadewoodVariant = function (index) {
        return resolveVariant('shadewood', index, originalShadeGetter);
      };
      installMode = 'getters';
    }

    Object.defineProperty(foliage, '__bakedTreeAssetsInstalled', { value: true, configurable: true });
    installedFoliage = foliage;
    if (mode === 'baked') preload();
    debug(`Installed baked tree adapter on ${installMode}; full-detail GLBs switch to 90% LODs at ${LOD_SWITCH_DISTANCE} world units.`, 'info');
    return true;
  }

  function countStates(level, map, branched = false) {
    let count = 0;
    for (const entry of ASSETS) {
      if (branched && !entry.branchedFilename) continue;
      if (map.has(stateKey(entry, level, branched))) count++;
    }
    return count;
  }

  function status() {
    const failedNear = countStates('near', failures, false);
    const failedFar = countStates('far', failures, false);
    const failedBranchedNear = countStates('near', failures, true);
    const failedBranchedFar = countStates('far', failures, true);
    const pendingNear = countStates('near', pending, false);
    const pendingFar = countStates('far', pending, false);
    const pendingBranchedNear = countStates('near', pending, true);
    const pendingBranchedFar = countStates('far', pending, true);
    return {
      mode,
      installed: !!installedFoliage,
      installMode,
      expected: ASSETS.length,
      expectedBranched: ASSETS.filter(entry => entry.branchedFilename).length,
      lodSwitchDistance: LOD_SWITCH_DISTANCE,
      // Legacy aliases keep the existing Performance & diagnostics UI intact:
      // loaded/failed/pending still describe the six canonical near GLBs.
      loaded: loadedNear.size,
      failed: failedNear,
      pending: pendingNear,
      loadedNear: loadedNear.size,
      loadedFar: loadedFar.size,
      loadedBranchedNear: loadedBranchedNear.size,
      loadedBranchedFar: loadedBranchedFar.size,
      failedNear,
      failedFar,
      failedBranchedNear,
      failedBranchedFar,
      pendingNear,
      pendingFar,
      pendingBranchedNear,
      pendingBranchedFar,
      proceduralGettersCaptured: !!originals,
      proceduralApiCaptured: !!originals,
      assets: ASSETS.map(entry => {
        const key = keyFor(entry);
        const state = (level, branched, map) => map.has(key) ? 'loaded'
          : pending.has(stateKey(entry, level, branched)) ? 'loading'
          : failures.has(stateKey(entry, level, branched)) ? 'fallback'
          : 'not-requested';
        return {
          ...entry,
          url: urlFor(entry),
          lodUrl: lodUrlFor(entry),
          branchedUrl: branchedUrlFor(entry),
          branchedLodUrl: branchedLodUrlFor(entry),
          nearState: mode === 'procedural' ? 'procedural-selected' : state('near', false, loadedNear),
          farState: mode === 'procedural' ? 'procedural-selected' : state('far', false, loadedFar),
          branchedNearState: !entry.branchedFilename ? 'none' : mode === 'procedural' ? 'procedural-selected' : state('near', true, loadedBranchedNear),
          branchedFarState: !entry.branchedLodFilename ? 'none' : mode === 'procedural' ? 'procedural-selected' : state('far', true, loadedBranchedFar),
          nearError: failures.get(stateKey(entry, 'near', false)) || null,
          farError: failures.get(stateKey(entry, 'far', false)) || null,
          branchedNearError: failures.get(stateKey(entry, 'near', true)) || null,
          branchedFarError: failures.get(stateKey(entry, 'far', true)) || null,
        };
      }),
    };
  }

  return Object.freeze({
    SCHEMA,
    BASE_PATH,
    MODE_KEY,
    MODES,
    LOD_SWITCH_DISTANCE,
    ASSETS,
    normalizeSpecies,
    entriesFor,
    entryFor,
    entryForCoordinates,
    urlFor,
    lodUrlFor,
    branchedUrlFor,
    branchedLodUrlFor,
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
