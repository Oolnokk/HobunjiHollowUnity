(() => {
  'use strict';

  // Held-object layering policy.
  //
  // game.js historically stamped tool/held-item planes with renderOrder=1.5.
  // Treat that value only as a legacy discovery marker, then return the plane
  // to renderOrder=0 so Three.js can position/depth-sort it normally against
  // characters, furniture, trees, buildings, etc.
  //
  // Ground-like surfaces are moved to a dedicated render layer. The main
  // screen pass renders that layer first, clears ONLY depth, then renders the
  // ordinary world. Ground/road/grass colors remain visible, but their depth
  // can no longer incorrectly cover a held sprite that should visually sit in
  // front of them. Other world objects still participate in the second pass's
  // normal depth buffer, so they can cover the tool according to position.
  const THREE = window.THREE;
  const rendererProto = THREE?.WebGLRenderer?.prototype;
  const objectProto = THREE?.Object3D?.prototype;
  if (!THREE || !rendererProto || !objectProto || typeof rendererProto.render !== 'function') return;

  const existing = window.HeldObjectRenderOrder;
  if (existing?.installed) return;

  const LEGACY_HELD_RENDER_ORDER = 1.5;
  const DEFAULT_LAYER = 0;
  const MATERIAL_ID_LAYER = 3;
  const GROUND_LAYER = 30;
  const GROUND_MASK = (1 << GROUND_LAYER) >>> 0;
  const DEFAULT_MASK = (1 << DEFAULT_LAYER) >>> 0;
  const FALLBACK_SCAN_INTERVAL_MS = 750;

  // Tracks objects classified by this module; WeakSets avoid owning scene nodes.
  const groundMeshes = new WeakSet();
  const heldMeshes = new WeakSet();
  const knownLights = new WeakSet();
  const lastSceneScan = new WeakMap();

  let groundCount = 0;
  let heldCount = 0;
  let renderSplitCount = 0;
  let passthroughCount = 0;
  let internalRender = false;
  let lastDebugSignature = '';

  function hasLayer(object, layer) {
    const mask = Number(object?.layers?.mask ?? 0) >>> 0;
    return !!(mask & ((1 << layer) >>> 0));
  }

  function hasAncestorFlag(object, key) {
    for (let node = object; node; node = node.parent) {
      if (node.userData?.[key] === true) return true;
    }
    return false;
  }

  function isGrassGroundCover(object) {
    if (!object?.isInstancedMesh) return false;
    return object.userData?.isWildernessGrassChunk === true
      || object.userData?.isRichFoliageBillboard === true
      || object.userData?.isBillboard === true;
  }

  function isRoadSurface(object) {
    return hasAncestorFlag(object, 'hobunjiPathSurface');
  }

  function isTerrainSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    if (object.userData?.terrainRenderChunk === true || object.userData?.terrainRenderChunkSource === true) return true;

    // Farm/town/wilderness merged floor meshes are marked for the terrain
    // material-ID pass on layer 3, receive shadows, and do not cast them.
    if (object.receiveShadow && !object.castShadow && hasLayer(object, MATERIAL_ID_LAYER)) return true;

    // Conservative fallback for untagged floor meshes. Requiring receiveShadow
    // and !castShadow keeps furniture/building meshes out of this path.
    if (object.receiveShadow && !object.castShadow) {
      const name = String(object.name || '').toLowerCase();
      if (/(^|[_-])(ground|terrain|zone_floor|floor|path_network)([_-]|$)/.test(name)) return true;
    }
    return false;
  }

  function isGroundSurface(object) {
    return !!object?.isMesh && (isGrassGroundCover(object) || isRoadSurface(object) || isTerrainSurface(object));
  }

  function isLegacyHeldPlane(object) {
    if (!object?.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return false;
    if (object.userData?.hobunjiHeldObjectPlane === true) return true;
    return Math.abs(Number(object.renderOrder) - LEGACY_HELD_RENDER_ORDER) < 1e-6;
  }

  function markHeldPlane(mesh) {
    if (!mesh?.isMesh) return false;
    const already = heldMeshes.has(mesh) || mesh.userData?.hobunjiHeldObjectPlane === true;
    mesh.userData = mesh.userData || {};
    mesh.userData.hobunjiHeldObjectPlane = true;
    mesh.userData.hobunjiLegacyRenderOrder = LEGACY_HELD_RENDER_ORDER;

    // renderOrder=0 restores Three's ordinary transparent-object z sorting.
    // The ground split below is what gives the tool its one special rule.
    mesh.renderOrder = 0;
    heldMeshes.add(mesh);
    if (!already) heldCount++;
    return !already;
  }

  function markGroundMesh(mesh) {
    if (!mesh?.isMesh) return false;
    const already = groundMeshes.has(mesh) || mesh.userData?.hobunjiHeldGroundLayer === true;
    mesh.userData = mesh.userData || {};
    mesh.userData.hobunjiHeldGroundLayer = true;
    if (mesh.userData.hobunjiHeldGroundOriginalLayerMask == null) {
      mesh.userData.hobunjiHeldGroundOriginalLayerMask = Number(mesh.layers.mask) >>> 0;
    }

    // Keep special-purpose layers (notably material-ID layer 3) but remove the
    // normal world layer. Main rendering is supplied by GROUND_LAYER instead.
    mesh.layers.disable(DEFAULT_LAYER);
    mesh.layers.enable(GROUND_LAYER);
    groundMeshes.add(mesh);
    if (!already) groundCount++;
    return !already;
  }

  function prepareLight(light) {
    if (!light?.isLight || knownLights.has(light)) return false;
    // Ground's first pass still needs the same lighting as the ordinary world.
    light.layers.enable(GROUND_LAYER);
    knownLights.add(light);
    return true;
  }

  function classifyObject(object) {
    if (!object) return;
    if (object.isLight) prepareLight(object);
    if (!object.isMesh) return;
    if (isLegacyHeldPlane(object)) markHeldPlane(object);
    if (isGroundSurface(object)) markGroundMesh(object);
  }

  function classifyTree(root) {
    if (!root) return;
    classifyObject(root);
    root.traverse?.((object) => {
      if (object !== root) classifyObject(object);
    });
  }

  // Classify new runtime objects as they are attached so the normal render path
  // does not need a full scene traversal every frame. A slow fallback scan in
  // wrappedRender catches unusual code that mutates tags after attachment.
  const originalAdd = objectProto.add;
  function wrappedAdd(...objects) {
    const result = originalAdd.apply(this, objects);
    for (const object of objects) classifyTree(object);
    return result;
  }
  wrappedAdd.__hobunjiHeldRenderOrderWrapped = true;
  wrappedAdd.__hobunjiHeldRenderOrderOriginal = originalAdd;
  objectProto.add = wrappedAdd;

  function scanScene(scene, force = false) {
    if (!scene?.isScene) return;
    const now = performance.now();
    const previous = lastSceneScan.get(scene) || -Infinity;
    if (!force && now - previous < FALLBACK_SCAN_INTERVAL_MS) return;
    lastSceneScan.set(scene, now);
    classifyTree(scene);
  }

  function sceneHasVisibleHeld(root, ancestorsVisible = true) {
    if (!root || !ancestorsVisible || root.visible === false) return false;
    if (root.isMesh && root.userData?.hobunjiHeldObjectPlane === true) return true;
    for (const child of root.children || []) {
      if (sceneHasVisibleHeld(child, true)) return true;
    }
    return false;
  }

  function withGroundLayerIncluded(renderer, scene, camera, originalRender) {
    const oldMask = Number(camera.layers.mask) >>> 0;
    camera.layers.mask = (oldMask | GROUND_MASK) >>> 0;
    try {
      passthroughCount++;
      return originalRender.call(renderer, scene, camera);
    } finally {
      camera.layers.mask = oldMask;
    }
  }

  const originalRender = rendererProto.render;
  function wrappedRender(scene, camera) {
    if (internalRender || !scene?.isScene || !camera?.isCamera) {
      return originalRender.call(this, scene, camera);
    }

    scanScene(scene);

    const oldCameraMask = Number(camera.layers.mask) >>> 0;
    const seesDefaultWorld = !!(oldCameraMask & DEFAULT_MASK);
    const isOffscreen = typeof this.getRenderTarget === 'function' && this.getRenderTarget() !== null;
    const isOverridePass = !!scene.overrideMaterial;
    const hasVisibleHeld = heldCount > 0 && sceneHasVisibleHeld(scene);

    // Offscreen/material-ID/debug passes should retain their original single
    // render, but a pass that expects layer 0 also needs the relocated ground.
    if (!seesDefaultWorld || isOffscreen || isOverridePass || groundCount === 0 || !hasVisibleHeld) {
      if (seesDefaultWorld && groundCount > 0) {
        return withGroundLayerIncluded(this, scene, camera, originalRender);
      }
      passthroughCount++;
      return originalRender.call(this, scene, camera);
    }

    const oldAutoClear = this.autoClear;
    const oldBackground = scene.background;
    const shadowMap = this.shadowMap;
    const oldShadowAutoUpdate = shadowMap?.autoUpdate;
    const ordinaryMask = (oldCameraMask & ~GROUND_MASK) >>> 0;

    internalRender = true;
    try {
      // Pass 1: background + terrain/path/grass only.
      camera.layers.mask = GROUND_MASK;
      this.autoClear = oldAutoClear;
      originalRender.call(this, scene, camera);

      // Ground's color remains, but its depth is intentionally discarded.
      this.clearDepth();

      // Pass 2: ordinary world. With ground absent from this depth buffer,
      // held sprites use normal positional/depth sorting against every other
      // object instead of being arbitrarily covered by ground decorations.
      camera.layers.mask = ordinaryMask;
      this.autoClear = false;
      scene.background = null;
      if (shadowMap) shadowMap.autoUpdate = false; // first pass already refreshed shadows
      const result = originalRender.call(this, scene, camera);
      renderSplitCount++;
      return result;
    } finally {
      if (shadowMap) shadowMap.autoUpdate = oldShadowAutoUpdate;
      scene.background = oldBackground;
      this.autoClear = oldAutoClear;
      camera.layers.mask = oldCameraMask;
      internalRender = false;
    }
  }

  wrappedRender.__hobunjiHeldRenderOrderWrapped = true;
  wrappedRender.__hobunjiHeldRenderOrderOriginal = originalRender;
  rendererProto.render = wrappedRender;

  function snapshot() {
    return {
      installed: true,
      legacyHeldRenderOrder: LEGACY_HELD_RENDER_ORDER,
      groundLayer: GROUND_LAYER,
      groundMeshes: groundCount,
      heldMeshes: heldCount,
      renderSplits: renderSplitCount,
      passthroughRenders: passthroughCount,
    };
  }

  function debugLogSnapshot() {
    const state = snapshot();
    const signature = JSON.stringify(state);
    if (signature !== lastDebugSignature) {
      lastDebugSignature = signature;
      const message = `[held-layer] held=${state.heldMeshes} ground=${state.groundMeshes} splitRenders=${state.renderSplits} passthrough=${state.passthroughRenders}`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }
    return state;
  }

  const api = {
    installed: true,
    GROUND_LAYER,
    LEGACY_HELD_RENDER_ORDER,
    markHeldPlane,
    markGroundMesh,
    scanScene,
    snapshot,
    debugLogSnapshot,
    // Debug-only classifier readout for the in-game/mobile console.
    classify(object) {
      return {
        held: isLegacyHeldPlane(object),
        ground: isGroundSurface(object),
        grass: isGrassGroundCover(object),
        road: isRoadSurface(object),
        terrain: isTerrainSurface(object),
      };
    },
  };

  window.HeldObjectRenderOrder = api;
})();
