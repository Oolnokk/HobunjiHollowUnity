(() => {
  'use strict';

  // Held-object layering policy.
  //
  // game.js historically stamps tool/held-item planes with renderOrder=1.5.
  // That value is now only a discovery marker. Once discovered, held planes are
  // owned by this module and re-normalized before every real base-world render.
  //
  // The one exceptional rule is ground cover: terrain/floor textures, road
  // surfaces, and grass billboard planes are rendered first, then ONLY their
  // depth is cleared before the rest of the world renders. That makes those
  // ground-like surfaces incapable of covering a held sprite, while characters,
  // furniture, vegetation, buildings, etc. still depth-test normally against it.
  //
  // This deliberately runs on the offscreen base render used by Hobunji's
  // outline/postprocess pipeline. Secondary shell/material-ID/PNG-depth passes
  // are left alone.
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
  const MASK_ALL = 0xFFFFFFFF >>> 0;
  const MASK_SHELL = (1 << 1) >>> 0;
  const MASK_MATERIAL_ID = (1 << 3) >>> 0;
  const MASK_PNG_OCCLUDER = (1 << 4) >>> 0;
  const FALLBACK_SCAN_INTERVAL_MS = 750;

  // WeakSets prevent classification bookkeeping from owning scene nodes.
  // heldMeshRegistry is intentionally iterable so the invariant can be repaired
  // immediately before every base-world render. There are only a handful of
  // held planes in normal play.
  const groundMeshes = new WeakSet();
  const heldMeshes = new WeakSet();
  const heldMeshRegistry = new Set();
  const knownLights = new WeakSet();
  const lastSceneScan = new WeakMap();

  let groundCount = 0;
  let heldCount = 0;
  let renderSplitCount = 0;
  let passthroughCount = 0;
  let invariantRepairCount = 0;
  let baseWorldRenderCount = 0;
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

  function forEachMaterial(material, fn) {
    if (Array.isArray(material)) {
      for (const entry of material) if (entry) fn(entry);
      return;
    }
    if (material) fn(material);
  }

  // Reassert properties that no stance, animation, sprite recolor, material
  // replacement, mastery/verdigris refresh, or equipment rebuild is allowed to
  // permanently override. We intentionally do NOT disable depth testing or
  // force depthWrite: held tools must still obey ordinary positional occlusion
  // against non-ground world objects.
  function enforceHeldMesh(mesh) {
    if (!mesh?.isMesh) return false;
    let repaired = false;

    mesh.userData = mesh.userData || {};
    if (mesh.userData.hobunjiHeldObjectPlane !== true) {
      mesh.userData.hobunjiHeldObjectPlane = true;
      repaired = true;
    }
    mesh.userData.hobunjiLegacyRenderOrder = LEGACY_HELD_RENDER_ORDER;

    if (mesh.renderOrder !== 0) {
      mesh.renderOrder = 0;
      repaired = true;
    }

    // The ordinary world/base pass always includes layer 0. Preserve any other
    // special layers a held plane may use, but guarantee it cannot be moved out
    // of the visible world by a later subsystem.
    if (!hasLayer(mesh, DEFAULT_LAYER)) {
      mesh.layers.enable(DEFAULT_LAYER);
      repaired = true;
    }

    // Recolor systems may replace material/map objects. Always inspect the
    // CURRENT material immediately before the real base render.
    forEachMaterial(mesh.material, (material) => {
      if ('depthTest' in material && material.depthTest !== true) {
        material.depthTest = true;
        material.needsUpdate = true;
        repaired = true;
      }
    });

    if (repaired) invariantRepairCount++;
    return repaired;
  }

  function markHeldPlane(mesh) {
    if (!mesh?.isMesh) return false;
    const already = heldMeshes.has(mesh) || mesh.userData?.hobunjiHeldObjectPlane === true;
    heldMeshes.add(mesh);
    heldMeshRegistry.add(mesh);
    enforceHeldMesh(mesh);
    if (!already) heldCount++;
    return !already;
  }

  function enforceHeldInvariant() {
    for (const mesh of heldMeshRegistry) {
      if (!mesh?.isMesh) {
        heldMeshRegistry.delete(mesh);
        continue;
      }
      enforceHeldMesh(mesh);
    }
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

  // Classify new runtime objects as they are attached. The microtask retry also
  // catches builders that attach a mesh and then synchronously stamp renderOrder
  // or userData later in the same JavaScript turn.
  const originalAdd = objectProto.add;
  function wrappedAdd(...objects) {
    const result = originalAdd.apply(this, objects);
    for (const object of objects) classifyTree(object);
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => {
        for (const object of objects) classifyTree(object);
      });
    }
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

  function isSecondaryOutlinePass(scene, camera) {
    const mask = Number(camera?.layers?.mask ?? 0) >>> 0;
    if (scene?.overrideMaterial) return true;
    return mask === MASK_SHELL || mask === MASK_MATERIAL_ID || mask === MASK_PNG_OCCLUDER;
  }

  // OutlineRenderPerformance uses the same definition for its logical "base"
  // pass: all camera layers, no override material. It may target an offscreen
  // framebuffer; that is the IMPORTANT path because the final screen is
  // composited from it. Direct rendering with the same full-world mask uses the
  // exact same policy.
  function isBaseWorldPass(scene, camera) {
    if (!scene?.isScene || !camera?.isCamera || scene.overrideMaterial) return false;
    return (Number(camera.layers.mask) >>> 0) === MASK_ALL;
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
    const baseWorldPass = isBaseWorldPass(scene, camera);
    const secondaryOutlinePass = isSecondaryOutlinePass(scene, camera);

    // This is the authoritative point of enforcement. It happens immediately
    // before every real base-world render, after gameplay/animation/recolor
    // updates for the frame and before Three.js builds its render lists.
    if (baseWorldPass) {
      baseWorldRenderCount++;
      enforceHeldInvariant();
    }

    const hasVisibleHeld = heldCount > 0 && sceneHasVisibleHeld(scene);

    // Never split secondary outline/depth/material-ID passes. Other non-base
    // passes stay single-pass as well, but if they expect layer 0 they also get
    // the relocated ground layer so debug/minimap/auxiliary views do not lose it.
    if (!baseWorldPass || groundCount === 0 || !hasVisibleHeld) {
      if (
        !baseWorldPass
        && !secondaryOutlinePass
        && seesDefaultWorld
        && groundCount > 0
        && !(oldCameraMask & GROUND_MASK)
      ) {
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
      // Pass 1: background + terrain/path/grass only. This works on whichever
      // render target is currently bound, including the outline pipeline's
      // offscreen base framebuffer.
      camera.layers.mask = GROUND_MASK;
      this.autoClear = oldAutoClear;
      originalRender.call(this, scene, camera);

      // Preserve ground COLOR in that target, discard only its depth.
      this.clearDepth();

      // Pass 2: every ordinary world object except the dedicated ground layer.
      // Held sprites therefore remain depth-tested against characters, props,
      // vegetation, buildings, etc., but ground/road/grass can never cover them.
      camera.layers.mask = ordinaryMask;
      this.autoClear = false;
      scene.background = null;
      if (shadowMap) shadowMap.autoUpdate = false; // pass 1 already refreshed shadows
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
      baseWorldRenders: baseWorldRenderCount,
      renderSplits: renderSplitCount,
      passthroughRenders: passthroughCount,
      invariantRepairs: invariantRepairCount,
    };
  }

  function debugLogSnapshot() {
    const state = snapshot();
    const signature = JSON.stringify(state);
    if (signature !== lastDebugSignature) {
      lastDebugSignature = signature;
      const message = `[held-layer] held=${state.heldMeshes} ground=${state.groundMeshes} base=${state.baseWorldRenders} split=${state.renderSplits} repairs=${state.invariantRepairs} passthrough=${state.passthroughRenders}`;
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
    enforceHeldInvariant,
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
