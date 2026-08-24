// Baked wilderness-tree asset contract + runtime LOD adapter.
//
// Procedural foliage remains the authoritative gameplay fallback and the source
// of per-tile transforms / climb-branch chance. When matching GLBs exist under
// docs/assets/models/trees/, this module swaps only the visual tree body to the
// baked near + far assets. Shadewood's climbable branch stays outside the LOD
// object so it never disappears when the renderer switches levels.
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
  const LOD_SWITCH_DISTANCE = 7.5; // World/tile units; far enough to hide 90% solid-geometry reduction before the tree fade band.
  const ASSETS = Object.freeze([
    Object.freeze({ species: 'crowned_pine', variant: 1, filename: 'crowned_pine_01.glb', lodFilename: 'crowned_pine_01_lod-decimate-90.glb', builder: 'buildCrownedPineMesh', seed: 1 }),
    Object.freeze({ species: 'crowned_pine', variant: 2, filename: 'crowned_pine_02.glb', lodFilename: 'crowned_pine_02_lod-decimate-90.glb', builder: 'buildCrownedPineMesh', seed: 2 }),
    Object.freeze({ species: 'crowned_pine', variant: 3, filename: 'crowned_pine_03.glb', lodFilename: 'crowned_pine_03_lod-decimate-90.glb', builder: 'buildCrownedPineMesh', seed: 3 }),
    Object.freeze({ species: 'shadewood', variant: 1, filename: 'shadewood_01.glb', lodFilename: 'shadewood_01_lod-decimate-90.glb', builder: 'buildShadewoodMesh', seed: 1 }),
    Object.freeze({ species: 'shadewood', variant: 2, filename: 'shadewood_02.glb', lodFilename: 'shadewood_02_lod-decimate-90.glb', builder: 'buildShadewoodMesh', seed: 2 }),
    Object.freeze({ species: 'shadewood', variant: 3, filename: 'shadewood_03.glb', lodFilename: 'shadewood_03_lod-decimate-90.glb', builder: 'buildShadewoodMesh', seed: 3 }),
  ]);

  const loadedNear = new Map();
  const loadedFar = new Map();
  const failures = new Map();
  const pending = new Map();
  const warned = new Set();
  const branchTemplates = new Map();
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

  function makeIndex() {
    return {
      schema: SCHEMA,
      basePath: BASE_PATH,
      generatedBy: 'docs/tools/tree-asset-exporter/index.html',
      note: 'Near GLBs are preferred when baked mode is selected. lodFilename is the far-distance copy; missing files fall back safely to the near GLB or procedural tree. Shadewood climb branches remain separate from LOD switching.',
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

  function normalizeLoadedRoot(entry, gltf, level) {
    const treeRoot = findTreeRoot(entry, gltf);
    if (!treeRoot) return null;
    treeRoot.name = treeRoot.name || `BakedTree_${entry.species}_${String(entry.variant).padStart(2, '0')}`;
    treeRoot.userData = {
      ...(treeRoot.userData || {}),
      bakedTreeAsset: true,
      treeSpecies: entry.species,
      treeVariant: entry.variant,
      treeAssetLevel: level,
    };
    treeRoot.updateMatrixWorld?.(true);
    treeRoot.traverse?.(child => {
      if (!child?.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = true;
      child.userData = { ...(child.userData || {}), bakedTreeAsset: true, treeAssetLevel: level };
    });
    return treeRoot;
  }

  function stateKey(entry, level) {
    return `${level}:${keyFor(entry)}`;
  }

  function loadedMapFor(level) {
    return level === 'far' ? loadedFar : loadedNear;
  }

  function fileForLevel(entry, level) {
    return level === 'far' ? entry?.lodFilename : entry?.filename;
  }

  function loadEntry(entry, level = 'near') {
    if (!entry) return Promise.resolve(null);
    const filename = fileForLevel(entry, level);
    if (!filename) return Promise.resolve(null);
    const cache = loadedMapFor(level);
    const key = keyFor(entry);
    const state = stateKey(entry, level);
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
          const treeRoot = normalizeLoadedRoot(entry, gltf, level);
          if (treeRoot) {
            cache.set(key, treeRoot);
            failures.delete(state);
            branchTemplates.delete(key); // A newly loaded near asset may contain a better authored climb branch than the procedural fallback.
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
      branchTemplates.clear();
    }
    if (!preloadPromise) {
      const jobs = [];
      for (const entry of ASSETS) {
        jobs.push(loadEntry(entry, 'near'));
        if (entry.lodFilename) jobs.push(loadEntry(entry, 'far'));
      }
      preloadPromise = Promise.all(jobs);
    }
    return preloadPromise;
  }

  function getLoadedVariant(species, index = 0, level = 'near') {
    const entry = entryFor(species, index);
    return entry ? loadedMapFor(level).get(keyFor(entry)) || null : null;
  }

  function findClimbBranch(rootObject) {
    let found = null;
    rootObject?.traverse?.(child => {
      if (found || child === rootObject) return;
      if (child?.name === 'climbBranch' || child?.userData?.isClimbBranch) found = child;
    });
    return found;
  }

  function cloneJson(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  function branchTemplateFor(entry, originalShade) {
    if (!entry || typeof originalShade !== 'function') return null;
    const key = keyFor(entry);
    if (branchTemplates.has(key)) return branchTemplates.get(key);

    // Prefer an authored branch from the baked near asset once the exporter has
    // produced one. Current uploaded pre-branch GLBs fall through to the exact
    // procedural exporter source below, keeping them usable immediately.
    const loaded = loadedNear.get(key) || loadedFar.get(key);
    const bakedBranch = findClimbBranch(loaded);
    const bakedLocal = loaded?.userData?.climbBranchLocal || bakedBranch?.userData?.climbBranchLocal;
    if (bakedBranch && bakedLocal) {
      const template = { mesh: bakedBranch.clone(true), local: cloneJson(bakedLocal), source: 'baked' };
      template.mesh.visible = true;
      branchTemplates.set(key, template);
      return template;
    }

    let procedural = null;
    try { procedural = originalShade(entry.seed, undefined, { forceClimbBranch: true }); }
    catch (error) {
      warnOnce(`branch-template:${key}`, `Could not build fallback climb branch for ${entry.filename}: ${error?.message || error}`);
      return null;
    }
    const branch = findClimbBranch(procedural);
    const local = procedural?.userData?.climbBranchLocal || branch?.userData?.climbBranchLocal;
    if (!branch || !local) return null;
    const template = { mesh: branch.clone(true), local: cloneJson(local), source: 'procedural-fallback' };
    template.mesh.visible = true;
    template.mesh.userData = { ...(template.mesh.userData || {}), isClimbBranch: true, climbBranchLocal: cloneJson(local) };
    branchTemplates.set(key, template);
    return template;
  }

  function stripClimbBranches(rootObject) {
    const remove = [];
    rootObject?.traverse?.(child => {
      if (child !== rootObject && (child?.name === 'climbBranch' || child?.userData?.isClimbBranch)) remove.push(child);
    });
    for (const child of remove) child.parent?.remove?.(child);
  }

  function cloneLevelRoot(template) {
    if (!template) return null;
    const clone = template.clone(true);
    // Exported GLBs contain the source instance's own yaw/scale on the tree
    // root. Runtime per-tile transforms come from the procedural oracle below,
    // so normalize the baked level back to canonical local geometry first.
    clone.position?.set?.(0, 0, 0);
    clone.quaternion?.identity?.();
    clone.scale?.set?.(1, 1, 1);
    clone.matrixAutoUpdate = true;
    stripClimbBranches(clone); // The gameplay branch is a persistent sibling, never an LOD child.
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
    const nearTemplate = loadedNear.get(key);
    const farTemplate = loadedFar.get(key);
    if (!nearTemplate && !farTemplate) {
      loadEntry(entry, 'near');
      loadEntry(entry, 'far');
      return procedural;
    }

    const T = root?.THREE;
    if (!T?.Group) return procedural;

    const wantsClimbBranch = species === 'shadewood' && !!procedural?.userData?.climbBranchLocal;
    const branchTemplate = wantsClimbBranch ? branchTemplateFor(entry, originals?.shade) : null;
    if (wantsClimbBranch && !branchTemplate) {
      // Never trade a gameplay surface for a visual optimization.
      warnOnce(`branch-missing:${key}`, `${entry.filename} has no usable climb-branch template; keeping this shadewood procedural.`);
      return procedural;
    }

    const outer = new T.Group();
    outer.name = `BakedTreeLOD_${entry.species}_${String(entry.variant).padStart(2, '0')}`;
    outer.position.copy?.(procedural.position);
    outer.quaternion.copy?.(procedural.quaternion);
    outer.scale.copy?.(procedural.scale);
    outer.userData = {
      ...(procedural.userData || {}),
      bakedTreeAsset: true,
      treeLodEnabled: !!farTemplate,
      treeSpecies: entry.species,
      treeVariant: entry.variant,
      nearFilename: entry.filename,
      farFilename: farTemplate ? entry.lodFilename : null,
      lodSwitchDistance: LOD_SWITCH_DISTANCE,
    };
    const canopyLocal = nearTemplate?.userData?.canopyLocal || farTemplate?.userData?.canopyLocal || procedural?.userData?.canopyLocal;
    if (canopyLocal) outer.userData.canopyLocal = cloneJson(canopyLocal);
    delete outer.userData.climbBranchLocal;

    const near = cloneLevelRoot(nearTemplate || farTemplate);
    const far = farTemplate ? cloneLevelRoot(farTemplate) : null;
    if (T.LOD && near) {
      const lod = new T.LOD();
      lod.name = 'treeVisualLOD';
      lod.userData.treeLodController = true;
      lod.addLevel(near, 0);
      if (far) lod.addLevel(far, LOD_SWITCH_DISTANCE);
      outer.add(lod);
    } else if (near) {
      outer.add(near);
    }

    if (wantsClimbBranch && branchTemplate) {
      const branch = branchTemplate.mesh.clone(true);
      branch.visible = true;
      branch.name = 'climbBranch';
      branch.userData = {
        ...(branch.userData || {}),
        isClimbBranch: true,
        climbBranchLocal: cloneJson(branchTemplate.local),
        persistentAcrossTreeLod: true,
      };
      outer.userData.climbBranchLocal = cloneJson(branchTemplate.local);
      outer.userData.climbBranchVisualSource = branchTemplate.source;
      outer.add(branch);
    }

    outer.updateMatrixWorld?.(true);
    return outer;
  }

  function fallbackReason(entry, level = 'near') {
    const state = stateKey(entry, level);
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
      loadEntry(entry, 'near');
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
    debug(`Installed baked tree adapter on ${installMode}; near GLBs switch to 90% LODs at ${LOD_SWITCH_DISTANCE} world units.`, 'info');
    return true;
  }

  function countStates(level, map) {
    let count = 0;
    for (const entry of ASSETS) if (map.has(stateKey(entry, level))) count++;
    return count;
  }

  function status() {
    const failedNear = countStates('near', failures);
    const failedFar = countStates('far', failures);
    const pendingNear = countStates('near', pending);
    const pendingFar = countStates('far', pending);
    return {
      mode,
      installed: !!installedFoliage,
      installMode,
      expected: ASSETS.length,
      lodSwitchDistance: LOD_SWITCH_DISTANCE,
      // Legacy aliases keep the existing Performance & diagnostics UI intact:
      // "loaded/failed/pending" continue to describe the canonical near GLBs.
      loaded: loadedNear.size,
      failed: failedNear,
      pending: pendingNear,
      loadedNear: loadedNear.size,
      loadedFar: loadedFar.size,
      failedNear,
      failedFar,
      pendingNear,
      pendingFar,
      proceduralGettersCaptured: !!originals,
      proceduralApiCaptured: !!originals,
      assets: ASSETS.map(entry => {
        const key = keyFor(entry);
        return {
          ...entry,
          url: urlFor(entry),
          lodUrl: lodUrlFor(entry),
          nearState: mode === 'procedural'
            ? 'procedural-selected'
            : loadedNear.has(key) ? 'loaded'
            : pending.has(stateKey(entry, 'near')) ? 'loading'
            : failures.has(stateKey(entry, 'near')) ? 'procedural-fallback'
            : 'not-requested',
          farState: !entry.lodFilename ? 'none'
            : mode === 'procedural' ? 'procedural-selected'
            : loadedFar.has(key) ? 'loaded'
            : pending.has(stateKey(entry, 'far')) ? 'loading'
            : failures.has(stateKey(entry, 'far')) ? 'near-or-procedural-fallback'
            : 'not-requested',
          nearError: failures.get(stateKey(entry, 'near')) || null,
          farError: failures.get(stateKey(entry, 'far')) || null,
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
