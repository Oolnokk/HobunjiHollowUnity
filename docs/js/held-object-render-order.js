(() => {
  'use strict';

  // Held-object selective ground x-ray policy.
  //
  // The normal world render is left intact. On a real full-world base render,
  // held planes are omitted from that first color pass and then drawn exactly
  // once against a reconstructed depth buffer that contains every NON-ground
  // occluder. Ground/terrain, paved path bricks, and grass billboards therefore
  // cannot cover a held sprite, while characters, furniture, vegetation,
  // buildings, etc. still occlude it according to position.
  //
  // After the held overlay is drawn, ground depth is replayed colorless so the
  // outline/postprocess pipeline receives the same complete scene depth it
  // expects. No ground layer is removed, no ground material is permanently
  // changed, and the finished terrain/grass color image is never re-rendered or
  // downsampled by this module.
  const THREE = window.THREE;
  const rendererProto = THREE?.WebGLRenderer?.prototype;
  const objectProto = THREE?.Object3D?.prototype;
  const sceneProto = THREE?.Scene?.prototype;
  if (!THREE || !rendererProto || !objectProto || !sceneProto || typeof rendererProto.render !== 'function') return;

  const existing = window.HeldObjectRenderOrder;
  if (existing?.installed) return;

  const LEGACY_HELD_RENDER_ORDER = 1.5;
  const DEFAULT_LAYER = 0;
  const MATERIAL_ID_LAYER = 3;
  const PNG_OCCLUDER_LAYER = 4;
  const GROUND_REPLAY_LAYER = 28;
  const HELD_OVERLAY_LAYER = 29;
  const GROUND_REPLAY_MASK = (1 << GROUND_REPLAY_LAYER) >>> 0;
  const HELD_OVERLAY_MASK = (1 << HELD_OVERLAY_LAYER) >>> 0;
  const MASK_ALL = 0xFFFFFFFF >>> 0;
  const FALLBACK_SCAN_INTERVAL_MS = 750;

  const heldMeshes = new WeakSet();
  const groundMeshes = new WeakSet();
  const heldRegistry = new Set();
  const groundRegistry = new Set();
  const guardedHeldMeshes = new WeakSet();
  const guardedGroundMeshes = new WeakSet();
  const preparedLights = new WeakSet();
  const lastSceneScan = new WeakMap();

  let heldCount = 0;
  let groundCount = 0;
  let grassCount = 0;
  let roadCount = 0;
  let terrainCount = 0;
  let baseWorldRenderCount = 0;
  let selectiveOverlayCount = 0;
  let nonGroundDepthReplayCount = 0;
  let groundDepthRestoreCount = 0;
  let invariantRepairCount = 0;
  let internalReplay = false;
  let lastDebugSignature = '';
  // Off in shoulder-surf camera mode (see game.js's settingShoulderSurf
  // handling) — the ground x-ray reads as clarity from the normal top-down
  // view but just looks wrong at close third-person range, so that mode
  // disables it and lets held sprites depth-test against the ground like
  // everything else.
  let enabled = true;

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
    return !!object?.isMesh && hasAncestorFlag(object, 'hobunjiPathSurface');
  }

  function isTerrainSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;

    // Spatial terrain chunks are generated only from whole-zone floor meshes.
    if (object.userData?.terrainRenderChunk === true || object.userData?.terrainRenderChunkSource === true) return true;

    // Farm/town/wilderness floor meshes opt into the terrain material-ID layer,
    // receive shadows, and do not cast them. This is the same bounded signature
    // TerrainRenderChunks uses to identify world-floor geometry.
    if (object.receiveShadow && !object.castShadow && hasLayer(object, MATERIAL_ID_LAYER)) return true;

    // Conservative legacy fallback for untagged floor meshes only.
    if (object.receiveShadow && !object.castShadow) {
      const name = String(object.name || '').toLowerCase();
      if (/(^|[_-])(ground|terrain|zone_floor|floor|path_network)([_-]|$)/.test(name)) return true;
    }
    return false;
  }

  function groundKind(object) {
    if (isGrassGroundCover(object)) return 'grass';
    if (isRoadSurface(object)) return 'road';
    if (isTerrainSurface(object)) return 'terrain';
    return null;
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

  function prepareLight(light) {
    if (!light?.isLight || preparedLights.has(light)) return;
    // The held overlay uses its own camera layer. Add that layer to lights so a
    // future lit held material behaves the same as it does in the base pass.
    light.layers.enable(HELD_OVERLAY_LAYER);
    preparedLights.add(light);
  }

  function enforceHeldMesh(mesh) {
    if (!mesh?.isMesh) return false;
    let repaired = false;
    mesh.userData = mesh.userData || {};

    if (mesh.userData.hobunjiHeldObjectPlane !== true) {
      mesh.userData.hobunjiHeldObjectPlane = true;
      repaired = true;
    }
    mesh.userData.hobunjiLegacyRenderOrder = LEGACY_HELD_RENDER_ORDER;

    // Neutral renderOrder restores Three's ordinary positioning semantics in
    // any non-overlay/debug view. The selective depth replay supplies the one
    // exceptional ground-x-ray rule.
    if (mesh.renderOrder !== 0) {
      mesh.renderOrder = 0;
      repaired = true;
    }
    if (!hasLayer(mesh, DEFAULT_LAYER)) {
      mesh.layers.enable(DEFAULT_LAYER);
      repaired = true;
    }
    if (!hasLayer(mesh, HELD_OVERLAY_LAYER)) {
      mesh.layers.enable(HELD_OVERLAY_LAYER);
      repaired = true;
    }

    // Recolor/mastery refreshes can replace a material object. Repair the
    // CURRENT material instead of assuming the creation-time material survives.
    forEachMaterial(mesh.material, (material) => {
      if ('depthTest' in material && material.depthTest !== true) {
        material.depthTest = true;
        repaired = true;
      }
    });

    if (repaired) invariantRepairCount++;
    return repaired;
  }

  function installHeldGuard(mesh) {
    if (!mesh?.isMesh || guardedHeldMeshes.has(mesh)) return;
    const originalUpdateMatrixWorld = mesh.updateMatrixWorld;
    if (typeof originalUpdateMatrixWorld !== 'function') return;
    mesh.updateMatrixWorld = function heldGroundXrayInvariant(force) {
      enforceHeldMesh(this);
      return originalUpdateMatrixWorld.call(this, force);
    };
    guardedHeldMeshes.add(mesh);
  }

  function markHeldPlane(mesh) {
    if (!mesh?.isMesh) return false;
    const already = heldMeshes.has(mesh) || mesh.userData?.hobunjiHeldObjectPlane === true;
    heldMeshes.add(mesh);
    heldRegistry.add(mesh);
    enforceHeldMesh(mesh);
    installHeldGuard(mesh);
    if (!already) heldCount++;
    return !already;
  }

  function enforceGroundMesh(mesh) {
    if (!mesh?.isMesh) return false;
    let repaired = false;
    mesh.userData = mesh.userData || {};
    if (mesh.userData.hobunjiHeldGroundReplay !== true) {
      mesh.userData.hobunjiHeldGroundReplay = true;
      repaired = true;
    }
    // Additive only: never remove the normal world/material-ID layers.
    if (!hasLayer(mesh, GROUND_REPLAY_LAYER)) {
      mesh.layers.enable(GROUND_REPLAY_LAYER);
      repaired = true;
    }
    return repaired;
  }

  function installGroundGuard(mesh) {
    if (!mesh?.isMesh || guardedGroundMeshes.has(mesh)) return;
    const originalUpdateMatrixWorld = mesh.updateMatrixWorld;
    if (typeof originalUpdateMatrixWorld !== 'function') return;
    mesh.updateMatrixWorld = function heldGroundReplayInvariant(force) {
      enforceGroundMesh(this);
      return originalUpdateMatrixWorld.call(this, force);
    };
    guardedGroundMeshes.add(mesh);
  }

  function markGroundMesh(mesh, kind = groundKind(mesh)) {
    if (!mesh?.isMesh || !kind) return false;
    const already = groundMeshes.has(mesh) || mesh.userData?.hobunjiHeldGroundReplay === true;
    groundMeshes.add(mesh);
    groundRegistry.add(mesh);
    enforceGroundMesh(mesh);
    installGroundGuard(mesh);
    if (!already) {
      groundCount++;
      if (kind === 'grass') grassCount++;
      else if (kind === 'road') roadCount++;
      else if (kind === 'terrain') terrainCount++;
    }
    return !already;
  }

  function classifyObject(object) {
    if (!object) return;
    if (object.isLight) prepareLight(object);
    if (!object.isMesh) return;
    if (isLegacyHeldPlane(object)) markHeldPlane(object);
    const kind = groundKind(object);
    if (kind) markGroundMesh(object, kind);
  }

  function classifyTree(root) {
    if (!root) return;
    classifyObject(root);
    root.traverse?.((object) => {
      if (object !== root) classifyObject(object);
    });
  }

  function queueClassification(objects) {
    const deferred = () => {
      for (const object of objects) classifyTree(object);
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(deferred);
    else Promise.resolve().then(deferred);
  }

  // Scene.add has already been wrapped by natural-surface modules before this
  // file loads, so wrap BOTH the current Scene.add and Object3D.add. This catches
  // direct scene attachment as well as children created inside runtime groups.
  function wrapAdd(proto, marker) {
    const previousAdd = proto?.add;
    if (!proto || typeof previousAdd !== 'function' || previousAdd[marker]) return;
    function wrappedAdd(...objects) {
      const result = previousAdd.apply(this, objects);
      for (const object of objects) classifyTree(object);
      queueClassification(objects); // catches tags stamped just after add()
      return result;
    }
    wrappedAdd[marker] = true;
    wrappedAdd.__hobunjiHeldGroundXrayOriginal = previousAdd;
    proto.add = wrappedAdd;
  }

  wrapAdd(objectProto, '__hobunjiHeldGroundXrayObjectAdd');
  wrapAdd(sceneProto, '__hobunjiHeldGroundXraySceneAdd');

  function scanScene(scene, force = false) {
    if (!scene?.isScene) return;
    const now = performance.now();
    const previous = lastSceneScan.get(scene) || -Infinity;
    if (!force && now - previous < FALLBACK_SCAN_INTERVAL_MS) return;
    lastSceneScan.set(scene, now);
    classifyTree(scene);
  }

  function sceneForObject(object) {
    let node = object;
    while (node?.parent) node = node.parent;
    return node?.isScene ? node : null;
  }

  function ancestorsVisible(object, stopScene) {
    for (let node = object; node; node = node.parent) {
      if (node.visible === false) return false;
      if (node === stopScene) return true;
    }
    return false;
  }

  function collectVisible(registry, scene) {
    const result = [];
    for (const object of registry) {
      if (!object?.isMesh) {
        registry.delete(object);
        continue;
      }
      const ownerScene = sceneForObject(object);
      if (!ownerScene) {
        // Detached runtime meshes should not be kept alive by our iterable set.
        registry.delete(object);
        continue;
      }
      if (ownerScene !== scene) continue;
      if (!ancestorsVisible(object, scene)) continue;
      result.push(object);
    }
    return result;
  }

  function isBaseWorldPass(scene, camera) {
    if (!scene?.isScene || !camera?.isCamera || scene.overrideMaterial) return false;
    return (Number(camera.layers.mask) >>> 0) === MASK_ALL;
  }

  function hideObjects(objects) {
    const states = new Map();
    for (const object of objects) {
      if (!object || states.has(object)) continue;
      states.set(object, object.visible);
      object.visible = false;
    }
    return states;
  }

  function restoreVisibility(states) {
    for (const [object, visible] of states) object.visible = visible;
  }

  function saveMaterialState(states, material) {
    if (!material || states.has(material)) return;
    states.set(material, {
      colorWrite: material.colorWrite,
      depthWrite: material.depthWrite,
    });
  }

  function restoreMaterialStates(states) {
    for (const [material, state] of states) {
      material.colorWrite = state.colorWrite;
      material.depthWrite = state.depthWrite;
    }
  }

  function prepareNonGroundDepthMaterials(scene) {
    const states = new Map();
    scene.traverseVisible((object) => {
      if (!object?.isMesh) return;
      const forceCutoutDepth = hasLayer(object, PNG_OCCLUDER_LAYER);
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        material.colorWrite = false;
        // PNG avatar planes intentionally disable normal depth writing for
        // avatar-vs-avatar ordering. For this temporary occlusion buffer only,
        // use the game's existing layer-4 convention and preserve the real
        // alpha-tested silhouette while making it capable of blocking a tool.
        if (forceCutoutDepth || Number(material.alphaTest || 0) > 0) material.depthWrite = true;
      });
    });
    return states;
  }

  function prepareGroundDepthMaterials(ground) {
    const states = new Map();
    for (const object of ground) {
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        material.colorWrite = false;
        // Preserve depthWrite exactly. Farm/town grass currently writes depth;
        // wilderness grass intentionally does not. Replaying each as authored
        // reconstructs the postprocess depth buffer without changing its color.
      });
    }
    return states;
  }

  function unwrapRendererRender(fn) {
    const seen = new Set();
    let current = fn;
    while (typeof current === 'function' && !seen.has(current)) {
      seen.add(current);
      const next = current.__hobunjiTerrainChunkOriginal
        || current.__hobunjiOutlineRenderPerfOriginal
        || current.__hobunjiHeldRenderOrderOriginal
        || current.__hobunjiPlayerBodyComposerOriginal
        || current.__hobunjiDrunkProneCompositionOriginal
        || current.__hobunjiHeftrootBillboardOriginal
        || current.__hobunjiCropReadyPresentationOriginal
        || current.__hobunjiCropBillboardPresentationOriginal
        || current.__hobunjiCropSpriteArtOriginal
        || current.__hobunjiHeldSeedActionOriginal
        || current.__hobunjiPerfDebugOriginal
        || null;
      if (typeof next !== 'function' || next === current) break;
      current = next;
    }
    return current;
  }

  const originalRender = rendererProto.render;
  const rawRender = unwrapRendererRender(originalRender);

  function replaySelectiveHeldOverlay(renderer, scene, camera, held, ground, originalCameraMask) {
    if (!held.length || !ground.length) return;

    const oldAutoClear = renderer.autoClear;
    const oldAutoClearColor = renderer.autoClearColor;
    const oldAutoClearDepth = renderer.autoClearDepth;
    const oldAutoClearStencil = renderer.autoClearStencil;
    const oldBackground = scene.background;
    const oldSceneAutoUpdate = scene.autoUpdate;
    const shadowMap = renderer.shadowMap;
    const oldShadowAutoUpdate = shadowMap?.autoUpdate;

    internalReplay = true;
    try {
      renderer.autoClear = false;
      renderer.autoClearColor = false;
      renderer.autoClearDepth = false;
      renderer.autoClearStencil = false;
      scene.background = null;
      scene.autoUpdate = false; // base pass already produced current matrices
      if (shadowMap) shadowMap.autoUpdate = false;

      // 1) Rebuild depth from every ordinary world object, excluding exactly
      // the held planes and classified ground cover. Color is untouched.
      renderer.clearDepth();
      const hidden = hideObjects([...ground, ...held]);
      const depthMaterialStates = prepareNonGroundDepthMaterials(scene);
      try {
        camera.layers.mask = originalCameraMask;
        rawRender.call(renderer, scene, camera);
        nonGroundDepthReplayCount++;
      } finally {
        restoreMaterialStates(depthMaterialStates);
        restoreVisibility(hidden);
      }

      // 2) Draw the held sprite ONCE against only that non-ground depth. This
      // is the actual selective x-ray: ground is absent from the depth buffer,
      // but all position-based ordinary occluders remain.
      camera.layers.mask = HELD_OVERLAY_MASK;
      rawRender.call(renderer, scene, camera);
      selectiveOverlayCount++;

      // 3) Put authored ground depth back without touching color. The outline
      // and material-seam pipeline therefore receives a complete depth buffer
      // just as if the normal base pass had remained untouched.
      const groundMaterialStates = prepareGroundDepthMaterials(ground);
      try {
        camera.layers.mask = GROUND_REPLAY_MASK;
        rawRender.call(renderer, scene, camera);
        groundDepthRestoreCount++;
      } finally {
        restoreMaterialStates(groundMaterialStates);
      }
    } finally {
      camera.layers.mask = originalCameraMask;
      if (shadowMap) shadowMap.autoUpdate = oldShadowAutoUpdate;
      scene.autoUpdate = oldSceneAutoUpdate;
      scene.background = oldBackground;
      renderer.autoClear = oldAutoClear;
      renderer.autoClearColor = oldAutoClearColor;
      renderer.autoClearDepth = oldAutoClearDepth;
      renderer.autoClearStencil = oldAutoClearStencil;
      internalReplay = false;
    }
  }

  function wrappedRender(scene, camera) {
    if (internalReplay || !scene?.isScene || !camera?.isCamera) {
      return originalRender.call(this, scene, camera);
    }

    scanScene(scene);
    if (!enabled || !isBaseWorldPass(scene, camera)) return originalRender.call(this, scene, camera);

    const originalCameraMask = Number(camera.layers.mask) >>> 0;
    const held = collectVisible(heldRegistry, scene);
    const ground = collectVisible(groundRegistry, scene);
    if (!held.length || !ground.length) return originalRender.call(this, scene, camera);

    baseWorldRenderCount++;
    for (const mesh of held) enforceHeldMesh(mesh);
    for (const mesh of ground) enforceGroundMesh(mesh);

    // Do not draw the tool in the ordinary base pass and then blend it a second
    // time in the selective overlay. Hiding it here means the final base color
    // contains exactly one tool draw, with no doubled alpha/edge darkening.
    const heldVisibility = hideObjects(held);
    let result;
    try {
      result = originalRender.call(this, scene, camera);
    } finally {
      restoreVisibility(heldVisibility);
    }

    replaySelectiveHeldOverlay(this, scene, camera, held, ground, originalCameraMask);
    return result;
  }

  wrappedRender.__hobunjiHeldRenderOrderWrapped = true;
  wrappedRender.__hobunjiHeldRenderOrderOriginal = originalRender;
  rendererProto.render = wrappedRender;

  function snapshot() {
    return {
      installed: true,
      mode: 'selective-depth-replay',
      legacyHeldRenderOrder: LEGACY_HELD_RENDER_ORDER,
      heldOverlayLayer: HELD_OVERLAY_LAYER,
      groundReplayLayer: GROUND_REPLAY_LAYER,
      heldMeshes: heldCount,
      groundMeshes: groundCount,
      grassMeshes: grassCount,
      roadMeshes: roadCount,
      terrainMeshes: terrainCount,
      baseWorldRenders: baseWorldRenderCount,
      selectiveOverlays: selectiveOverlayCount,
      nonGroundDepthReplays: nonGroundDepthReplayCount,
      groundDepthRestores: groundDepthRestoreCount,
      invariantRepairs: invariantRepairCount,
    };
  }

  function debugLogSnapshot() {
    const state = snapshot();
    const signature = JSON.stringify(state);
    if (signature !== lastDebugSignature) {
      lastDebugSignature = signature;
      const message = `[held-xray] held=${state.heldMeshes} ground=${state.groundMeshes} (grass=${state.grassMeshes} road=${state.roadMeshes} terrain=${state.terrainMeshes}) base=${state.baseWorldRenders} overlay=${state.selectiveOverlays} depth=${state.nonGroundDepthReplays}/${state.groundDepthRestores} repairs=${state.invariantRepairs}`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }
    return state;
  }

  window.HeldObjectRenderOrder = {
    installed: true,
    mode: 'selective-depth-replay',
    LEGACY_HELD_RENDER_ORDER,
    HELD_OVERLAY_LAYER,
    GROUND_REPLAY_LAYER,
    markHeldPlane,
    markGroundMesh,
    scanScene,
    snapshot,
    debugLogSnapshot,
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; },
    enforceHeldInvariant() {
      for (const mesh of heldRegistry) enforceHeldMesh(mesh);
    },
    classify(object) {
      return {
        held: isLegacyHeldPlane(object),
        ground: !!groundKind(object),
        grass: isGrassGroundCover(object),
        road: isRoadSurface(object),
        terrain: isTerrainSurface(object),
      };
    },
  };
})();
