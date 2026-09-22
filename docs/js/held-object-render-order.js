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
  const WATER_REPLAY_LAYER = 27;
  const GROUND_REPLAY_LAYER = 28;
  const HELD_OVERLAY_LAYER = 29;
  const WATER_REPLAY_MASK = (1 << WATER_REPLAY_LAYER) >>> 0;
  const GROUND_REPLAY_MASK = (1 << GROUND_REPLAY_LAYER) >>> 0;
  const HELD_OVERLAY_MASK = (1 << HELD_OVERLAY_LAYER) >>> 0;
  const DEFAULT_LAYER_MASK = (1 << DEFAULT_LAYER) >>> 0;
  const MASK_ALL = 0xFFFFFFFF >>> 0;
  const FALLBACK_SCAN_INTERVAL_MS = 750;

  const heldMeshes = new WeakSet();
  const groundMeshes = new WeakSet();
  const waterMeshes = new WeakSet(); // Used by classifyObject to count each canonical water surface once across fallback rescans.
  const heldRegistryByScene = new WeakMap(); // Scene -> held meshes; keeps per-frame collection bounded to the currently rendered scene instead of every cached interior.
  const groundRegistryByScene = new WeakMap(); // Scene -> ground meshes used by the selective depth restore for only that scene.
  const waterRegistryByScene = new WeakMap(); // Scene -> water meshes used by the stencil-masked translucent replay for only that scene.
  const pngDepthRegistryByScene = new WeakMap(); // Scene -> cutout depth meshes, avoiding a global scan across cached/off-area avatars and props.
  const preparedLights = new WeakSet();
  const lastSceneScan = new WeakMap();

  let heldCount = 0;
  let groundCount = 0;
  let grassCount = 0;
  let roadCount = 0;
  let terrainCount = 0;
  let waterMeshCount = 0; // Exposed in debugState so mobile diagnostics can confirm water surfaces are eligible for translucent replay.
  let waterReplayCount = 0; // Counts successful stencil-masked water compositing passes after held overlays.
  let baseWorldRenderCount = 0;
  let selectiveOverlayCount = 0;
  let nonGroundDepthReplayCount = 0;
  let groundDepthRestoreCount = 0;
  let invariantRepairCount = 0;
  let internalReplay = false;
  let lastDebugSignature = '';
  let lastBaseScene = null; // Most recently rendered gameplay scene; used by the compatibility invariant repair API without retaining every scene's meshes globally.
  let lastActiveHeldCount = 0; // Reported by snapshot()/Pixel Probe to distinguish current-scene work from lifetime classifications.
  let lastActiveGroundCount = 0; // Reported by snapshot()/Pixel Probe for the current scene's replay ground set.
  let lastActiveWaterCount = 0; // Reported by snapshot()/Pixel Probe for the current scene's replay water set.
  // Gameplay keeps this enabled in every camera mode so a low shoulder-surf
  // angle cannot bury weapon PNGs beneath terrain or grass planes.
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

    // Farm/town/wilderness floor meshes opt into the terrain material-ID layer
    // and are attached directly to the scene. Runtime-rebuilt farm tiles cast
    // shadows as well as receive them, so castShadow cannot distinguish them
    // from ordinary props. The scene-parent + material-ID signature mirrors
    // TerrainRenderChunks' own bounded terrain candidate test and excludes
    // nested hands/furniture that may share wavy_surface.png or layer 3.
    if (object.parent?.isScene && object.receiveShadow && hasLayer(object, MATERIAL_ID_LAYER)) return true;

    // Conservative legacy fallback for untagged floor meshes only.
    if (object.parent?.isScene && object.receiveShadow && !object.castShadow) {
      const name = String(object.name || '').toLowerCase();
      if (/(^|[_-])(ground|terrain|zone_floor|floor|path_network)([_-]|$)/.test(name)) return true;
    }
    return false;
  }

  function isWaterSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    const data = object.userData || {}; // Existing runtime water tags are preferred over broad name matching so props with "water" in their names are never replayed.
    if (data.mergedWaterStatKey || data.waterSurfaceRole) return true;
    if (data.waterfallSurfaceHeightMode || data.waterfallTexture) return true;
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
    // Held and replayed-water passes use private camera layers. Keep lights on
    // both so any future lit material behaves exactly like the normal base pass.
    light.layers.enable(HELD_OVERLAY_LAYER);
    light.layers.enable(WATER_REPLAY_LAYER);
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

  function registerSceneObject(registryByScene, object) {
    const scene = sceneForObject(object); // Resolves the object's actual owner so cached interiors never share one hot iterable registry.
    if (!scene) return false;
    let registry = registryByScene.get(scene); // Reuses the scene-local set on every later classification pass.
    if (!registry) {
      registry = new Set();
      registryByScene.set(scene, registry);
    }
    registry.add(object);
    return true;
  }

  function markHeldPlane(mesh) {
    if (!mesh?.isMesh) return false;
    const already = heldMeshes.has(mesh) || mesh.userData?.hobunjiHeldObjectPlane === true;
    heldMeshes.add(mesh);
    registerSceneObject(heldRegistryByScene, mesh);
    enforceHeldMesh(mesh);
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

  function markGroundMesh(mesh, kind = groundKind(mesh)) {
    if (!mesh?.isMesh || !kind) return false;
    const already = groundMeshes.has(mesh) || mesh.userData?.hobunjiHeldGroundReplay === true;
    groundMeshes.add(mesh);
    registerSceneObject(groundRegistryByScene, mesh);
    enforceGroundMesh(mesh);
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
    if (hasLayer(object, PNG_OCCLUDER_LAYER) || materialHasAlphaCutout(object.material)) registerSceneObject(pngDepthRegistryByScene, object);
    if (isWaterSurface(object)) {
      registerSceneObject(waterRegistryByScene, object);
      if (!hasLayer(object, WATER_REPLAY_LAYER)) object.layers.enable(WATER_REPLAY_LAYER);
      if (!waterMeshes.has(object)) {
        waterMeshes.add(object);
        waterMeshCount++;
      }
    }
    const kind = groundKind(object);
    if (kind) markGroundMesh(object, kind);
  }

  function materialHasAlphaCutout(material) {
    if (Array.isArray(material)) return material.some(entry => Number(entry?.alphaTest || 0) > 0);
    return Number(material?.alphaTest || 0) > 0;
  }

  function classifyTree(root) {
    if (!root) return;
    classifyObject(root);
    root.traverse?.((object) => {
      if (object !== root) classifyObject(object);
    });
  }

  // Coalesced into a single flush per microtask turn rather than one
  // microtask per add() call: combat VFX (lunge trail stamps, swing-cone
  // ribbons) can call add() dozens of times within one frame, and each call
  // previously queued its own redundant full-tree classification pass.
  let pendingClassification = new Set();
  let classificationScheduled = false;

  function flushClassification() {
    classificationScheduled = false;
    const batch = pendingClassification;
    pendingClassification = new Set();
    for (const object of batch) classifyTree(object);
  }

  function queueClassification(objects) {
    for (const object of objects) pendingClassification.add(object);
    if (classificationScheduled) return;
    classificationScheduled = true;
    if (typeof queueMicrotask === 'function') queueMicrotask(flushClassification);
    else Promise.resolve().then(flushClassification);
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

  function collectVisible(registryByScene, scene) {
    const registry = registryByScene.get(scene); // Only the currently rendered scene is iterable; cached interiors no longer add O(all-history) work to each frame.
    if (!registry?.size) return [];
    const result = [];
    for (const object of registry) {
      if (!object?.isMesh) {
        registry.delete(object);
        continue;
      }
      const ownerScene = sceneForObject(object);
      if (!ownerScene) {
        registry.delete(object); // Detached runtime meshes stop being strongly retained by this scene bucket.
        continue;
      }
      if (ownerScene !== scene) {
        registry.delete(object); // A moved mesh no longer belongs to this scene bucket.
        registerSceneObject(registryByScene, object); // Re-home it immediately so the destination scene sees it without a global scan.
        continue;
      }
      if (!ancestorsVisible(object, scene)) continue;
      result.push(object);
    }
    return result;
  }

  function isBaseWorldPass(scene, camera) {
    if (!scene?.isScene || !camera?.isCamera || scene.overrideMaterial) return false;
    const mask = Number(camera.layers.mask) >>> 0; // Used to distinguish the ordinary world draw from dedicated replay/outline layers.
    // Outlines-on frames normally arrive with every layer enabled, while a
    // valid outlines-off world draw can use only Three's default layer. The
    // former MASK_ALL-only check silently bypassed the x-ray on those layer-0
    // frames. Requiring the default world bit accepts both forms but rejects
    // shell, material-ID, PNG-depth, held-overlay, and ground-replay passes.
    return mask === MASK_ALL || !!(mask & DEFAULT_LAYER_MASK);
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
      stencilWrite: material.stencilWrite,
      stencilWriteMask: material.stencilWriteMask,
      stencilFunc: material.stencilFunc,
      stencilRef: material.stencilRef,
      stencilFuncMask: material.stencilFuncMask,
      stencilFail: material.stencilFail,
      stencilZFail: material.stencilZFail,
      stencilZPass: material.stencilZPass,
    });
  }

  function restoreMaterialStates(states) {
    for (const [material, state] of states) {
      material.colorWrite = state.colorWrite;
      material.depthWrite = state.depthWrite;
      material.stencilWrite = state.stencilWrite;
      material.stencilWriteMask = state.stencilWriteMask;
      material.stencilFunc = state.stencilFunc;
      material.stencilRef = state.stencilRef;
      material.stencilFuncMask = state.stencilFuncMask;
      material.stencilFail = state.stencilFail;
      material.stencilZFail = state.stencilZFail;
      material.stencilZPass = state.stencilZPass;
    }
  }

  function prepareNonGroundDepthMaterials(scene) {
    const states = new Map();
    scene.traverseVisible((object) => {
      const isMesh = !!object?.isMesh;
      const isCelestialSprite = !!object?.isSprite && object.userData?.hobunjiNoOutline === true; // Used here to suppress only the sky-dome sun/moon sprites during this colorless replay.
      if (!isMesh && !isCelestialSprite) return;
      const forceCutoutDepth = isMesh && hasLayer(object, PNG_OCCLUDER_LAYER);
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        material.colorWrite = false;
        // PNG avatar planes intentionally disable normal depth writing for
        // avatar-vs-avatar ordering. For this temporary occlusion buffer only,
        // use the game's existing layer-4 convention and preserve the real
        // alpha-tested silhouette while making it capable of blocking a tool.
        // Celestial sprites keep their authored depthWrite=false; only their
        // accidental second color draw is suppressed during this replay.
        if (isMesh && (forceCutoutDepth || Number(material.alphaTest || 0) > 0)) material.depthWrite = true;
      });
    });
    return states;
  }

  function prepareCutoutDepthMaterials(cutouts) {
    const states = new Map();
    for (const object of cutouts) {
      forEachMaterial(object.material, (material) => {
        if (Number(material.alphaTest || 0) <= 0 && !hasLayer(object, PNG_OCCLUDER_LAYER)) return;
        saveMaterialState(states, material);
        material.depthWrite = true;
      });
    }
    return states;
  }

  function prepareHeldStencilMaterials(held) {
    const states = new Map();
    for (const object of held) {
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        material.stencilWrite = true;
        material.stencilWriteMask = 0xFF;
        material.stencilFunc = THREE.AlwaysStencilFunc;
        material.stencilRef = 1;
        material.stencilFuncMask = 0xFF;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.ReplaceStencilOp;
      });
    }
    return states;
  }

  function prepareWaterStencilMaterials(water) {
    const states = new Map();
    for (const object of water) {
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        // Three enables stencil testing through stencilWrite. A zero write mask
        // keeps the held-pixel marker untouched while Equal limits this second
        // translucent draw to pixels actually written by the held overlay.
        material.stencilWrite = true;
        material.stencilWriteMask = 0x00;
        material.stencilFunc = THREE.EqualStencilFunc;
        material.stencilRef = 1;
        material.stencilFuncMask = 0xFF;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.KeepStencilOp;
      });
    }
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

  function replaySelectiveHeldOverlay(renderer, scene, camera, held, ground, water, originalCameraMask) {
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
      const prepPerf = window.PerfProfiler?.begin('held-overlay: depth material prep');
      const colorBuffer = renderer.state?.buffers?.color; // Three's locked color mask keeps every original material shader/alpha cutout while suppressing all color writes globally.
      const canLockColorMask = !!colorBuffer?.setMask && !!colorBuffer?.setLocked;
      const depthMaterialStates = canLockColorMask
        ? prepareCutoutDepthMaterials(collectVisible(pngDepthRegistryByScene, scene))
        : prepareNonGroundDepthMaterials(scene);
      if (canLockColorMask) {
        colorBuffer.setMask(false);
        colorBuffer.setLocked(true);
      }
      window.PerfProfiler?.end(prepPerf);
      try {
        camera.layers.mask = originalCameraMask;
        const depthRebuildPerf = window.PerfProfiler?.begin('held-overlay: depth rebuild render');
        rawRender.call(renderer, scene, camera);
        window.PerfProfiler?.end(depthRebuildPerf);
        nonGroundDepthReplayCount++;
      } finally {
        if (canLockColorMask) {
          colorBuffer.setLocked(false);
          colorBuffer.setMask(true);
        }
        restoreMaterialStates(depthMaterialStates);
        restoreVisibility(hidden);
      }

      // 2) Draw the held sprite ONCE against non-ground depth while stamping
      // those exact visible fragments into stencil. Water deliberately keeps
      // its authored depthWrite=false here, so submerged feet/tools are not
      // hard-clipped at the surface.
      renderer.clearStencil?.();
      const heldStencilStates = prepareHeldStencilMaterials(held);
      try {
        camera.layers.mask = HELD_OVERLAY_MASK;
        const overlayDrawPerf = window.PerfProfiler?.begin('held-overlay: overlay render');
        rawRender.call(renderer, scene, camera);
        window.PerfProfiler?.end(overlayDrawPerf);
        selectiveOverlayCount++;
      } finally {
        restoreMaterialStates(heldStencilStates);
      }

      // 3) Replay the ordinary translucent water shader only where the held
      // overlay stamped stencil. Depth testing then naturally rejects water
      // over portions physically above the surface while blending it across
      // submerged portions. Because the base pass already drew water once,
      // stencil prevents a second blend anywhere else in the scene.
      if (water.length) {
        const waterStencilStates = prepareWaterStencilMaterials(water);
        try {
          camera.layers.mask = WATER_REPLAY_MASK;
          const waterReplayPerf = window.PerfProfiler?.begin('held-overlay: water composite render');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(waterReplayPerf);
          waterReplayCount++;
        } finally {
          restoreMaterialStates(waterStencilStates);
        }
      }
      renderer.clearStencil?.();

      // 4) Put authored ground depth back without touching color. The outline
      // and material-seam pipeline therefore receives a complete depth buffer
      // just as if the normal base pass had remained untouched.
      const groundMaterialStates = prepareGroundDepthMaterials(ground);
      try {
        camera.layers.mask = GROUND_REPLAY_MASK;
        const groundRestorePerf = window.PerfProfiler?.begin('held-overlay: ground restore render');
        rawRender.call(renderer, scene, camera);
        window.PerfProfiler?.end(groundRestorePerf);
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
    const held = collectVisible(heldRegistryByScene, scene);
    const ground = collectVisible(groundRegistryByScene, scene);
    const water = collectVisible(waterRegistryByScene, scene); // Used by the stencil-masked translucent replay after the held overlay.
    lastBaseScene = scene;
    lastActiveHeldCount = held.length;
    lastActiveGroundCount = ground.length;
    lastActiveWaterCount = water.length;
    if (!held.length || !ground.length) return originalRender.call(this, scene, camera);

    baseWorldRenderCount++;
    for (const mesh of held) enforceHeldMesh(mesh);
    for (const mesh of ground) enforceGroundMesh(mesh);

    // Do not draw the tool in the ordinary base pass and then blend it a second
    // time in the selective overlay. Hiding it here means the final base color
    // contains exactly one tool draw, with no doubled alpha/edge darkening.
    const heldVisibility = hideObjects(held);
    let result;
    const basePerf = window.PerfProfiler?.begin('held-overlay: base render');
    try {
      result = originalRender.call(this, scene, camera);
    } finally {
      window.PerfProfiler?.end(basePerf);
      restoreVisibility(heldVisibility);
    }

    const replayPerf = window.PerfProfiler?.begin('held-overlay: total replay'); // Sum of the three sub-passes above plus the depth-material-prep traversal; kept separate so it's directly comparable to held-overlay: base render.
    replaySelectiveHeldOverlay(this, scene, camera, held, ground, water, originalCameraMask);
    window.PerfProfiler?.end(replayPerf);
    return result;
  }

  wrappedRender.__hobunjiHeldRenderOrderWrapped = true;
  wrappedRender.__hobunjiHeldRenderOrderOriginal = originalRender;
  rendererProto.render = wrappedRender;

  function snapshot() {
    return {
      installed: true,
      enabled,
      mode: 'selective-depth-replay',
      legacyHeldRenderOrder: LEGACY_HELD_RENDER_ORDER,
      heldOverlayLayer: HELD_OVERLAY_LAYER,
      groundReplayLayer: GROUND_REPLAY_LAYER,
      heldMeshes: heldCount,
      activeHeldMeshes: lastActiveHeldCount,
      groundMeshes: groundCount,
      activeGroundMeshes: lastActiveGroundCount,
      grassMeshes: grassCount,
      roadMeshes: roadCount,
      terrainMeshes: terrainCount,
      waterReplayMeshes: waterMeshCount,
      activeWaterReplayMeshes: lastActiveWaterCount,
      waterReplays: waterReplayCount,
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
      const message = `[held-xray] enabled=${state.enabled} held=${state.heldMeshes} ground=${state.groundMeshes} (grass=${state.grassMeshes} road=${state.roadMeshes} terrain=${state.terrainMeshes}) waterBlend=${state.waterReplayMeshes}/${state.waterReplays} base=${state.baseWorldRenders} overlay=${state.selectiveOverlays} depth=${state.nonGroundDepthReplays}/${state.groundDepthRestores} repairs=${state.invariantRepairs}`;
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
    // Retained as a compatibility no-op for the former camera-mode toggle.
    // Ground/grass x-ray is now an invariant of held weapon presentation.
    setEnabled() { enabled = true; },
    enforceHeldInvariant(scene = lastBaseScene) {
      if (!scene?.isScene) return;
      for (const mesh of collectVisible(heldRegistryByScene, scene)) enforceHeldMesh(mesh);
    },
    classify(object) {
      return {
        held: isLegacyHeldPlane(object),
        ground: !!groundKind(object),
        grass: isGrassGroundCover(object),
        road: isRoadSurface(object),
        terrain: isTerrainSurface(object),
        waterSurface: isWaterSurface(object),
      };
    },
  };
})();
