// Presentation-only crop transforms.
//
// game.js intentionally owns crop growth and simulation, but currently places
// crop roots at tileSurfaceY + waterDepth. That makes plants ride on top of
// floodwater. This wrapper removes only that water lift immediately before
// draw, then restores game-owned transforms afterward. Garlink/ongyums also
// need the old cube-center lift removed because crop-sprite-art turns their
// cube into an invisible anchor containing three smaller billboard plants.
// Every authored PNG crop additionally grounds its lowest visible alpha pixel
// into the soil, so transparent canvas padding cannot make planted art float.
(() => {
  'use strict';

  if (window.HobunjiCropBillboardPresentation) return;

  const SURFACE_EPSILON = 0.02; // Matches game.js's generic crop cube lift above the tile surface so converted billboard anchors can be returned to soil level.
  const WATER_UNIT = 0.5 / 3.0; // Mirrors game.js's SLAB_H / MAX_WATER conversion (0.5 / 3) so crop roots cancel exactly the Y lift added from tile.water.
  const BILLBOARD_CLUSTER_SCALE = 0.25; // Mirrors crop-sprite-art's per-plant scale: half the former 0.5-scale garlink/ongyums billboard size.
  const PNG_ALPHA_THRESHOLD = 10; // Used to find the same visibly opaque crop pixels that survive the PNG materials' ~0.04 alpha test.
  const PNG_SOIL_EMBED_LOCAL = 0.02; // Used to tuck a PNG crop's visible bottom slightly below soil in crop-root local units, so the embed naturally scales with crop growth.
  const pngOpaqueBottomCache = new WeakMap(); // Used to scan each decoded crop PNG only once for its lowest visible alpha pixel.
  const pngRootBottomCache = new WeakMap(); // Used to cache each live PNG crop hierarchy's lowest visible Y in root-local space after its sprite planes exist.
  let farmDeps = null; // Used to read the authoritative farm grid/water values without moving crop simulation ownership out of game.js.
  let lastAnchoredRoots = 0; // Used by diagnostics to confirm how many crop roots were corrected on the last farm render.
  let lastPngGroundedRoots = 0; // Used by diagnostics to confirm how many authored PNG crop roots needed additional visible-pixel grounding on the last farm render.
  let lastMaxPngGroundLift = 0; // Used by diagnostics to expose the largest world-space PNG grounding correction applied on the last farm render.
  let pngOpaqueScanCount = 0; // Used by diagnostics to prove expensive alpha scans are cached per decoded PNG instead of repeated per plant/frame.

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

  function finiteScaleY(object) {
    const value = Number(object?.scale?.y); // Used by PNG hierarchy grounding without treating a missing scale as zero height.
    return Number.isFinite(value) ? value : 1;
  }

  function finitePositionY(object) {
    const value = Number(object?.position?.y); // Used by PNG hierarchy grounding without allowing malformed transforms to propagate NaN into crop positions.
    return Number.isFinite(value) ? value : 0;
  }

  function opaqueBottomLocalY(plane) {
    const image = plane?.material?.map?.image; // Used as the decoded PNG whose transparent bottom padding must not count as planted crop height.
    const imageHeight = Math.max(0, Number(image?.naturalHeight || image?.height) || 0);
    if (!image || imageHeight <= 0 || (typeof image !== 'object' && typeof image !== 'function')) return null;
    const cached = pngOpaqueBottomCache.get(image);
    if (Number.isFinite(cached)) return cached;

    const scan = window.PNGPlaneAvatar?.scanOpaqueVerticalBoundsOfImage; // Reuses the existing alpha-bounds utility already used to ground other PNG-plane art by its visible pixels.
    if (typeof scan !== 'function') return null;
    const bounds = scan(image, PNG_ALPHA_THRESHOLD);
    const bottomRow = Number(bounds?.bottom);
    if (!Number.isFinite(bottomRow)) return null;

    const bottomEdgeV = Math.max(0, Math.min(1, (bottomRow + 1) / imageHeight)); // Converts the inclusive bottom pixel row to its lower image-edge fraction.
    const bottomLocalY = 0.5 - bottomEdgeV; // Converts top-origin PNG rows into PlaneGeometry's centered -0.5..+0.5 local Y convention.
    pngOpaqueBottomCache.set(image, bottomLocalY);
    pngOpaqueScanCount++;
    return bottomLocalY;
  }

  function planeBottomInRootLocalY(root, plane, planeBottomLocalY) {
    if (!root || !plane || !Number.isFinite(planeBottomLocalY)) return null;
    if (plane === root) return planeBottomLocalY;

    // Deliberately ignore billboard rotation here. Grounding must stay stable as
    // camera pitch/yaw changes; only the authored hierarchy's Y translations and
    // scales define how far the visible PNG bottom sits above/below its crop root.
    let y = finitePositionY(plane) + planeBottomLocalY * finiteScaleY(plane);
    let node = plane.parent;
    while (node && node !== root) {
      y = finitePositionY(node) + y * finiteScaleY(node);
      node = node.parent;
    }
    return node === root ? y : null;
  }

  function pngRootBottomLocalY(root) {
    if (!root?.traverse) return null;
    const cached = pngRootBottomCache.get(root);
    if (Number.isFinite(cached)) return cached;

    let lowest = Infinity; // Used to ground the lowest visible authored PNG member when a crop is a multi-plane cluster.
    root.traverse(object => {
      if (!object?.userData?.hobunjiCropSpriteKey || !object?.material?.map?.image) return;
      const planeBottom = opaqueBottomLocalY(object);
      if (!Number.isFinite(planeBottom)) return;
      const rootLocalBottom = planeBottomInRootLocalY(root, object, planeBottom);
      if (Number.isFinite(rootLocalBottom) && rootLocalBottom < lowest) lowest = rootLocalBottom;
    });
    if (!Number.isFinite(lowest)) return null; // Do not cache misses: async PNG conversion/loading may add visible planes to this same root later.
    pngRootBottomCache.set(root, lowest);
    return lowest;
  }

  function pngSoilLift(root) {
    const bottomLocalY = pngRootBottomLocalY(root);
    if (!Number.isFinite(bottomLocalY)) return 0;
    const rootScaleY = Math.abs(finiteScaleY(root));
    const localLift = Math.max(0, bottomLocalY + PNG_SOIL_EMBED_LOCAL); // Never raise art already embedded deeply enough; only lower floating/shallow PNG bottoms.
    return localLift * rootScaleY;
  }

  function prepare(scene) {
    const restore = []; // Used to restore game.js-owned crop positions after the synchronous render call completes.
    lastAnchoredRoots = 0;
    lastPngGroundedRoots = 0;
    lastMaxPngGroundLift = 0;
    if (!farmDeps?.scene || scene !== farmDeps.scene) return restore;

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
      const pngGroundLift = pngSoilLift(root); // Applies the same visible-alpha grounding to garlink, ongyums, heftroot, and any future tagged PNG crop planes.
      if (waterLift <= 0 && centerLift <= 0 && pngGroundLift <= 0) continue;

      restore.push({ root, positionY: root.position.y });
      root.position.y -= waterLift + centerLift + pngGroundLift;
      lastAnchoredRoots++;
      if (pngGroundLift > 0) {
        lastPngGroundedRoots++;
        lastMaxPngGroundLift = Math.max(lastMaxPngGroundLift, pngGroundLift);
      }
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
      pngAlphaThreshold: PNG_ALPHA_THRESHOLD,
      pngSoilEmbedLocal: PNG_SOIL_EMBED_LOCAL,
      pngOpaqueScanCount,
      farmReady: Boolean(farmDeps?.getGrid && farmDeps?.scene),
      lastAnchoredRoots,
      lastPngGroundedRoots,
      lastMaxPngGroundLift: Number(lastMaxPngGroundLift.toFixed(5)),
      lastChange: 'All tagged PNG crops ground by their lowest visible alpha pixel instead of transparent canvas padding.',
    }),
  };
})();
