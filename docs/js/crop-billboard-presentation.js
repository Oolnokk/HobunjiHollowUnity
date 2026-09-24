// Presentation-only crop transforms.
//
// vegetation-crop-rendering.js owns the farm crop meshes and their authoritative
// farm render dependencies. Generic crop cubes are centered above the tile, so
// Garlink/Ongyums billboard conversions need that old cube-center lift removed;
// every crop also needs the water-surface lift removed so plants stay rooted in
// soil while floodwater rises around them.
(() => {
  'use strict';

  if (window.HobunjiCropBillboardPresentation) return;

  const SURFACE_EPSILON = 0.02; // Matches vegetation-crop-rendering's generic crop cube lift above the tile surface.
  const WATER_UNIT = 0.5 / 3.0; // Mirrors game.js's SLAB_H / MAX_WATER conversion so crop roots cancel exactly the Y lift added from tile.water.
  const BILLBOARD_CLUSTER_SCALE = 0.25; // Mirrors crop-sprite-art's per-plant scale.
  let cropRenderDeps = null; // Captured from VegetationCropRendering.init; authoritative source for farm scene/grid render state below.
  let farmDeps = null; // Retained only as a compatibility fallback and to link the older ripe-sparkle module to the farm scene.
  let lastAnchoredRoots = 0; // Reported by diagnostics after the last farm render.
  let lastDependencySource = 'none'; // Shows whether the real crop-render dependency seam has initialized.

  function patchCropRendering(api) {
    if (!api?.init || api.__hobunjiCropPresentationDepsPatched) return;
    const originalInit = api.init.bind(api); // Preserves the crop renderer's normal initialization while retaining its injected render dependencies.
    api.init = function cropPresentationVegetationInit(injectedDeps = {}, ...rest) {
      cropRenderDeps = injectedDeps;
      lastDependencySource = 'vegetation-crop-rendering';
      return originalInit(injectedDeps, ...rest);
    };
    api.__hobunjiCropPresentationDepsPatched = true;
  }

  function installCropRenderingHook() {
    if (window.VegetationCropRendering) patchCropRendering(window.VegetationCropRendering);
  }

  function linkFarmPanelScene(injectedDeps) {
    if (!injectedDeps || typeof injectedDeps !== 'object') return;
    const existing = Object.getOwnPropertyDescriptor(injectedDeps, 'scene');
    if (existing) return;
    Object.defineProperty(injectedDeps, 'scene', {
      configurable: true,
      enumerable: false,
      get() { return cropRenderDeps?.scene || null; },
    }); // Lets crop-ready-presentation reuse FarmPanel's deps object without pretending FarmPanel itself owns the render scene.
  }

  function patchFarmPanel(api) {
    if (!api?.init || api.__hobunjiCropSoilAnchorPatched) return;
    const originalInit = api.init.bind(api); // Preserves the farm panel while supplying its shared deps object with a live farm-scene getter.
    api.init = function cropSoilAnchorFarmPanelInit(injectedDeps = {}, ...rest) {
      linkFarmPanelScene(injectedDeps);
      const result = originalInit(injectedDeps, ...rest);
      farmDeps = injectedDeps;
      if (!cropRenderDeps) lastDependencySource = 'farm-panel-fallback';
      return result;
    };
    api.__hobunjiCropSoilAnchorPatched = true;
  }

  function installFarmPanelHook() {
    if (window.FarmPanel) {
      patchFarmPanel(window.FarmPanel);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'FarmPanel'); // Chains with any earlier lazy/global owner instead of replacing it.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    let value = descriptor?.value;
    Object.defineProperty(window, 'FarmPanel', {
      configurable: true,
      get() {
        return previousGet ? previousGet.call(window) : value;
      },
      set(next) {
        if (previousSet) previousSet.call(window, next);
        else value = next;
        const current = previousGet ? previousGet.call(window) : value;
        patchFarmPanel(current);
      },
    });
  }

  function activeDeps() {
    return cropRenderDeps || farmDeps;
  }

  function farmScene() {
    return cropRenderDeps?.scene || farmDeps?.scene || null;
  }

  function taggedCropKey(object) {
    return object?.userData?.hobunjiCropRootKey || object?.userData?.hobunjiCropSpriteKey || null;
  }

  function directSceneRoot(object, scene) {
    let root = object; // Turns a tagged sub-plant/plane into the one outer crop wrapper whose position the crop renderer updates.
    while (root?.parent && root.parent !== scene) root = root.parent;
    return root?.parent === scene ? root : null;
  }

  function collectCropRoots(scene) {
    const roots = new Map(); // De-duplicates several tagged children belonging to the same planted crop root.
    scene?.traverse?.(object => {
      const cropKey = taggedCropKey(object);
      if (!cropKey) return;
      const root = directSceneRoot(object, scene);
      if (root && !roots.has(root)) roots.set(root, cropKey);
    });
    return roots;
  }

  // collectCropRoots is a full traversal of the farm scene, and prepare() runs
  // on every farm render -- it was the largest per-frame cost in this render
  // hook chain. Crop roots are direct scene children, so planting, harvesting
  // and growth-stage rebuilds all change scene.children; a cheap signature of
  // that list invalidates the cache immediately. Tags applied later to an
  // existing child (crop-sprite-art's throttled placeholder discovery) are
  // picked up by a full rescan at that same 250ms discovery cadence.
  const CROP_ROOT_FULL_RESCAN_MS = 250;
  const cropRootCache = { scene: null, roots: null, childCount: -1, idSum: 0, idMix: 0, scannedAt: -Infinity };

  function cachedCropRoots(scene) {
    const children = scene.children || [];
    let idSum = 0;
    let idMix = 0;
    for (let i = 0; i < children.length; i++) {
      const id = children[i].id | 0;
      idSum += id;
      idMix = (idMix ^ Math.imul(id + i, 2654435761)) | 0;
    }
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const cache = cropRootCache;
    if (cache.scene === scene && cache.roots && cache.childCount === children.length && cache.idSum === idSum
      && cache.idMix === idMix && now - cache.scannedAt < CROP_ROOT_FULL_RESCAN_MS) {
      return cache.roots;
    }
    cache.scene = scene;
    cache.roots = collectCropRoots(scene);
    cache.childCount = children.length;
    cache.idSum = idSum;
    cache.idMix = idMix;
    cache.scannedAt = now;
    return cache.roots;
  }

  function tileForRoot(root) {
    const grid = activeDeps()?.getGrid?.();
    if (!grid || !root?.position) return null;
    const col = Math.floor(Number(root.position.x));
    const row = Math.floor(Number(root.position.z));
    if (col < 0 || row < 0 || row >= grid.length || col >= (grid[row]?.length || 0)) return null;
    return { tile: grid[row][col], col, row };
  }

  function prepare(scene) {
    const restore = []; // Restores crop-renderer-owned positions immediately after the synchronous render call.
    lastAnchoredRoots = 0;
    const expectedScene = farmScene();
    if (!expectedScene || scene !== expectedScene) return restore;

    for (const [root, cropKey] of cachedCropRoots(scene)) {
      const located = tileForRoot(root);
      if (!located?.tile?.crop) continue;
      const waterDepth = Math.max(0, Number(located.tile.water) || 0);
      const waterLift = waterDepth * WATER_UNIT;
      const isConvertedCluster = (cropKey === 'garlink' || cropKey === 'ongyums')
        && root.userData?.hobunjiCropClusterCount === 3;
      const gameScale = Number(root.scale?.y);
      const centerLift = isConvertedCluster && Number.isFinite(gameScale)
        ? gameScale * 0.5 + SURFACE_EPSILON
        : 0;
      if (waterLift <= 0 && centerLift <= 0) continue;

      restore.push({ root, positionY: root.position.y });
      root.position.y -= waterLift + centerLift;
      lastAnchoredRoots++;
    }
    return restore;
  }

  function restoreTransforms(states) {
    for (const state of states) {
      if (state.root?.position) state.root.position.y = state.positionY;
    }
  }

  function installRenderHook() {
    const prototype = window.THREE?.WebGLRenderer?.prototype;
    if (!prototype || prototype.__hobunjiCropBillboardPresentationHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render;
    prototype.render = function cropBillboardPresentationRender(scene, camera, ...rest) {
      const states = prepare(scene);
      try {
        return previousRender.call(this, scene, camera, ...rest);
      } finally {
        restoreTransforms(states);
      }
    };
    prototype.render.__hobunjiCropBillboardPresentationOriginal = previousRender;
    prototype.__hobunjiCropBillboardPresentationHooked = true;
  }

  installCropRenderingHook();
  installFarmPanelHook();
  installRenderHook();

  window.HobunjiCropBillboardPresentation = {
    getScale: () => BILLBOARD_CLUSTER_SCALE,
    getDebug: () => ({
      scale: BILLBOARD_CLUSTER_SCALE,
      surfaceEpsilon: SURFACE_EPSILON,
      waterUnit: WATER_UNIT,
      dependencySource: lastDependencySource,
      cropRendererReady: Boolean(cropRenderDeps?.getGrid && cropRenderDeps?.scene),
      farmPanelLinked: Boolean(farmDeps),
      farmReady: Boolean(activeDeps()?.getGrid && farmScene()),
      lastAnchoredRoots,
      lastChange: 'Crop soil anchoring now uses VegetationCropRendering render deps; FarmPanel no longer has to own a scene it never uses.',
    }),
  };
})();
