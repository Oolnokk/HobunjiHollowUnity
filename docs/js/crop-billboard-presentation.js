// Presentation-only crop transforms.
//
// game.js intentionally owns crop growth and simulation, but currently places
// crop roots at tileSurfaceY + waterDepth. That makes plants ride on top of
// floodwater. This wrapper removes only that water lift immediately before
// draw, then restores game-owned transforms afterward. Garlink/ongyums also
// need the old cube-center lift removed because crop-sprite-art turns their
// cube into an invisible anchor containing three smaller billboard plants.
(() => {
  'use strict';

  if (window.HobunjiCropBillboardPresentation) return;

  const SURFACE_EPSILON = 0.02; // Matches game.js's generic crop cube lift above the tile surface so converted billboard anchors can be returned to soil level.
  const WATER_UNIT = 0.5 / 3.0; // Mirrors game.js's SLAB_H / MAX_WATER conversion (0.5 / 3) so crop roots cancel exactly the Y lift added from tile.water.
  const BILLBOARD_CLUSTER_SCALE = 0.25; // Mirrors crop-sprite-art's per-plant scale: half the former 0.5-scale garlink/ongyums billboard size.
  let farmDeps = null; // Used to read the authoritative farm grid/water values without moving crop simulation ownership out of game.js.
  let lastAnchoredRoots = 0; // Used by diagnostics to confirm how many crop roots were corrected on the last farm render.

  function patchFarmPanel(api) {
    if (!api?.init || api.__hobunjiCropSoilAnchorPatched) return;
    const originalInit = api.init.bind(api); // Used to preserve the farm panel's initialization while retaining its live getGrid/scene dependencies.
    api.init = function cropSoilAnchorFarmPanelInit(injectedDeps = {}, ...rest) {
      const result = originalInit(injectedDeps, ...rest);
      farmDeps = injectedDeps;
      return result;
    };
    api.__hobunjiCropSoilAnchorPatched = true;
  }

  function installFarmPanelHook() {
    if (window.FarmPanel) {
      patchFarmPanel(window.FarmPanel);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'FarmPanel'); // Used to chain with any earlier lazy/global owner instead of replacing it.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get; // Used to preserve a previously installed FarmPanel getter.
    const previousSet = descriptor?.set; // Used to preserve a previously installed FarmPanel setter.
    let value = descriptor?.value; // Used as local storage only when no earlier accessor owns the global.
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

  function taggedCropKey(object) {
    return object?.userData?.hobunjiCropRootKey || object?.userData?.hobunjiCropSpriteKey || null;
  }

  function directSceneRoot(object, scene) {
    let root = object; // Used to turn a tagged heftroot sub-plant/plane into the one outer crop wrapper whose position game.js actually updates.
    while (root?.parent && root.parent !== scene) root = root.parent;
    return root?.parent === scene ? root : null;
  }

  function collectCropRoots(scene) {
    const roots = new Map(); // Used to de-duplicate several tagged children that belong to the same three-plant crop wrapper.
    scene?.traverse?.(object => {
      const cropKey = taggedCropKey(object);
      if (!cropKey) return;
      const root = directSceneRoot(object, scene);
      if (root && !roots.has(root)) roots.set(root, cropKey);
    });
    return roots;
  }

  function tileForRoot(root) {
    const grid = farmDeps?.getGrid?.(); // Used to read live water depth from the same tile object the simulation updates.
    if (!grid || !root?.position) return null;
    const col = Math.floor(Number(root.position.x)); // Used because crop roots are authored at col + 0.5.
    const row = Math.floor(Number(root.position.z)); // Used because crop roots are authored at row + 0.5.
    if (col < 0 || row < 0 || row >= grid.length || col >= (grid[row]?.length || 0)) return null;
    return { tile: grid[row][col], col, row };
  }

  function computeCropLifts(scene) {
    const lifts = []; // { root, lift } — one entry per crop root that needs a Y correction this frame.
    lastAnchoredRoots = 0;
    if (!farmDeps?.scene || scene !== farmDeps.scene) return lifts;

    for (const [root, cropKey] of collectCropRoots(scene)) {
      const located = tileForRoot(root);
      if (!located?.tile?.crop) continue;
      const waterDepth = Math.max(0, Number(located.tile.water) || 0); // Used to lower the crop by exactly the amount game.js raised it with floodwater.
      const waterLift = waterDepth * WATER_UNIT;
      const isConvertedCluster = (cropKey === 'garlink' || cropKey === 'ongyums')
        && root.userData?.hobunjiCropClusterCount === 3; // Used to remove the generic cube's center-height offset only after it has actually become a three-billboard cluster.
      const gameScale = Number(root.scale?.y); // Used to undo game.js's size/2 cube-center placement for converted garlink/ongyums anchors.
      const centerLift = isConvertedCluster && Number.isFinite(gameScale)
        ? gameScale * 0.5 + SURFACE_EPSILON
        : 0;
      const lift = waterLift + centerLift;
      if (lift <= 0) continue;

      lifts.push({ root, lift });
      lastAnchoredRoots++;
    }
    return lifts;
  }

  // renderer.render() fires several internal passes per visual frame (color,
  // shell/target/material-ID/depth outlines, composite — see game.js's outline
  // block), all synchronously back to back. Crop water depth and cluster
  // conversion can't change mid-frame, so collectCropRoots' full scene.traverse
  // plus every matched root's tile lookup only need to run once per distinct
  // scene seen in a frame — cached here and cleared via a microtask so the
  // next frame recomputes fresh. Keyed by scene (not a single slot) so an
  // unrelated pass's scene (e.g. a fixed post-composite scene) interleaved
  // between farm-scene passes can't evict the farm scene's cached lifts.
  let frameLiftsByScene = null;

  function liftsFor(scene) {
    if (!frameLiftsByScene) {
      frameLiftsByScene = new Map();
      Promise.resolve().then(() => { frameLiftsByScene = null; });
    }
    let lifts = frameLiftsByScene.get(scene);
    if (!lifts) {
      lifts = computeCropLifts(scene);
      frameLiftsByScene.set(scene, lifts);
    }
    return lifts;
  }

  function prepare(scene) {
    const restore = []; // Used to restore game.js-owned crop positions after this synchronous render call completes.
    for (const { root, lift } of liftsFor(scene)) {
      if (!root?.position) continue;
      restore.push({ root, positionY: root.position.y });
      root.position.y -= lift;
    }
    return restore;
  }

  function restoreTransforms(states) {
    for (const state of states) {
      if (state.root?.position) state.root.position.y = state.positionY;
    }
  }

  function installRenderHook() {
    const prototype = window.THREE?.WebGLRenderer?.prototype; // Used as the shared synchronous render boundary already made hookable by combat-config-loader.
    if (!prototype || prototype.__hobunjiCropBillboardPresentationHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render; // Used to preserve crop-sprite-art, heftroot billboarding, and every earlier renderer wrapper.
    prototype.render = function cropBillboardPresentationRender(scene, camera, ...rest) {
      const states = prepare(scene);
      try {
        return previousRender.call(this, scene, camera, ...rest);
      } finally {
        restoreTransforms(states);
      }
    };
    // held-object-render-order.js's internal depth-replay passes look for the
    // TRUE, undecorated render() by walking a chain of __hobunji*Original
    // markers (see its unwrapRendererRender) — without this marker those
    // replay passes stop unwrapping here instead of reaching the real render.
    prototype.render.__hobunjiCropBillboardPresentationOriginal = previousRender;
    prototype.__hobunjiCropBillboardPresentationHooked = true;
  }

  installFarmPanelHook();
  installRenderHook();

  window.HobunjiCropBillboardPresentation = {
    getScale: () => BILLBOARD_CLUSTER_SCALE,
    getDebug: () => ({
      scale: BILLBOARD_CLUSTER_SCALE,
      surfaceEpsilon: SURFACE_EPSILON,
      waterUnit: WATER_UNIT,
      farmReady: Boolean(farmDeps?.getGrid && farmDeps?.scene),
      lastAnchoredRoots,
    }),
  };
})();
