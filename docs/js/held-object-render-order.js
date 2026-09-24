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
  const FOOT_WATER_MASK_LAYER = 26; // Used only to stamp procedural feet that should remain subject to translucent water.
  const WATER_REPLAY_LAYER = 27;
  const GROUND_REPLAY_LAYER = 28;
  const HELD_OVERLAY_LAYER = 29;
  const FOOT_WATER_MASK = (1 << FOOT_WATER_MASK_LAYER) >>> 0;
  const WATER_REPLAY_MASK = (1 << WATER_REPLAY_LAYER) >>> 0;
  const GROUND_REPLAY_MASK = (1 << GROUND_REPLAY_LAYER) >>> 0;
  const HELD_OVERLAY_MASK = (1 << HELD_OVERLAY_LAYER) >>> 0;
  const DEFAULT_LAYER_MASK = (1 << DEFAULT_LAYER) >>> 0;
  const MASK_ALL = 0xFFFFFFFF >>> 0;
  const FALLBACK_SCAN_INTERVAL_MS = 750;

  const heldMeshes = new WeakSet();
  const groundMeshes = new WeakSet();
  const waterMeshes = new WeakSet(); // Used by classifyObject to count each canonical water surface once across fallback rescans.
  const waterOccludedMeshes = new WeakSet(); // Used to count each explicitly water-occluded mesh once; procedural feet register here.
  const heldRegistry = new Set();
  const groundRegistry = new Set();
  const waterRegistry = new Set(); // Used by the foot-only translucent-water replay.
  const waterOccludedRegistry = new Set(); // Used to stencil only feet (never weapons/hands) before replaying water.
  const pngDepthRegistry = new Set(); // Used by the colorless replay to repair only cutout depth materials instead of traversing every visible object.
  const preparedLights = new WeakSet();
  const lastSceneScan = new WeakMap();

  let heldCount = 0;
  let groundCount = 0;
  let grassCount = 0;
  let roadCount = 0;
  let terrainCount = 0;
  let waterMeshCount = 0; // Exposed in debugState so mobile diagnostics can confirm water surfaces are eligible for translucent replay.
  let waterOccludedMeshCount = 0; // Used by mobile diagnostics to confirm procedural feet registered for water occlusion.
  let waterReplayCount = 0; // Counts successful foot-only water compositing passes.
  let scissoredReplayCount = 0; // Replays whose passes were clipped to the held/foot screen rectangle.
  let fullscreenReplayCount = 0; // Replays that fell back to full-framebuffer passes (see replayScissorRect).
  let lastReplayScissorCoverage = 1; // Fraction of the framebuffer the last replay's passes touched.
  let missingStencilFootReplaySkipCount = 0; // Safety fallback for auxiliary/offscreen targets that cannot carry the two-bit mask.
  let lastBaseStencilBits = 0; // STENCIL_BITS of the framebuffer bound for the most recent real world pass.
  let baseWorldRenderCount = 0;
  let selectiveOverlayCount = 0;
  let nonGroundDepthReplayCount = 0;
  let groundDepthRestoreCount = 0;
  let invariantRepairCount = 0;
  let internalReplay = false;
  let lastDebugSignature = '';
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

  function materialLooksLikeGrassBillboard(material) {
    const materials = Array.isArray(material) ? material : [material];
    return materials.some(entry => !!(
      entry?.isShaderMaterial
      && entry.uniforms?.uGrassTex
      && entry.uniforms?.uDensity
      && entry.uniforms?.uStrength
    ));
  }

  function isGrassGroundCover(object) {
    if (!object?.isMesh) return false;
    const data = object.userData || {};
    // Preserve the authored grass tags, but do not require InstancedMesh.
    // Farm/town/wilderness grass currently uses InstancedMesh; other runtime
    // consumers can reuse the exact same grass ShaderMaterial on a plain Mesh.
    // Those meshes must also be absent from the held-object depth replay:
    // submerged grass is painted over by water in the base pass, so allowing
    // its hidden depth to survive would punch grass-shaped water holes through
    // an otherwise x-rayed weapon.
    if (data.isWildernessGrassChunk === true || data.isRichFoliageBillboard === true) return true;
    if (object.isInstancedMesh && data.isBillboard === true) return true;
    return materialLooksLikeGrassBillboard(object.material);
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

  function markHeldPlane(mesh) {
    if (!mesh?.isMesh) return false;
    const already = heldMeshes.has(mesh) || mesh.userData?.hobunjiHeldObjectPlane === true;
    heldMeshes.add(mesh);
    heldRegistry.add(mesh);
    enforceHeldMesh(mesh);
    if (!already) heldCount++;
    return !already;
  }

  function markWaterOccludedMesh(mesh) {
    if (!mesh?.isMesh) return false;
    mesh.userData = mesh.userData || {};
    const already = waterOccludedMeshes.has(mesh) || mesh.userData.hobunjiWaterOccludedBySurface === true;
    mesh.userData.hobunjiWaterOccludedBySurface = true;
    waterOccludedMeshes.add(mesh);
    waterOccludedRegistry.add(mesh);
    if (!hasLayer(mesh, FOOT_WATER_MASK_LAYER)) mesh.layers.enable(FOOT_WATER_MASK_LAYER);
    if (!already) waterOccludedMeshCount++;
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
    groundRegistry.add(mesh);
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
    if (object.userData?.hobunjiWaterOccludedBySurface === true) markWaterOccludedMesh(object);
    if (hasLayer(object, PNG_OCCLUDER_LAYER) || materialHasAlphaCutout(object.material)) pngDepthRegistry.add(object);
    if (isWaterSurface(object)) {
      waterRegistry.add(object);
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

  // gl.getParameter() is a synchronous GPU round-trip in Chrome: calling it
  // twice per world render stalled the CPU until every previously queued draw
  // had finished, defeating CPU/GPU pipelining (it was the single largest
  // self-time entry in a headless frame profile). A framebuffer's stencil
  // depth is fixed at allocation, so it is measured once per render target
  // (and once for the default canvas framebuffer) and reused afterwards.
  const stencilBitsByTarget = new WeakMap(); // Render target -> measured STENCIL_BITS.
  let defaultFramebufferStencilBits = null; // Measured STENCIL_BITS of the canvas framebuffer.
  let stencilBitsContext = null; // Invalidates the cache if the renderer's GL context is replaced.

  function currentFramebufferStencilBits(renderer) {
    try {
      const gl = renderer?.getContext?.();
      if (!gl) return 0;
      if (gl !== stencilBitsContext) {
        stencilBitsContext = gl;
        defaultFramebufferStencilBits = null;
      }
      const target = renderer.getRenderTarget?.() || null;
      if (!target) {
        if (defaultFramebufferStencilBits === null) defaultFramebufferStencilBits = Number(gl.getParameter(gl.STENCIL_BITS)) || 0;
        return defaultFramebufferStencilBits;
      }
      let bits = stencilBitsByTarget.get(target);
      if (bits === undefined) {
        bits = Number(gl.getParameter(gl.STENCIL_BITS)) || 0;
        stencilBitsByTarget.set(target, bits);
      }
      return bits;
    } catch (_) {
      return 0;
    }
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
        // Bit 1 marks weapon/hand pixels. The later foot mask refuses to stamp
        // across this bit, so water can never be composited back over held gear.
        material.stencilWrite = true;
        material.stencilWriteMask = 0x02;
        material.stencilFunc = THREE.AlwaysStencilFunc;
        material.stencilRef = 2;
        material.stencilFuncMask = 0xFF;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.ReplaceStencilOp;
      });
    }
    return states;
  }

  function prepareWaterOcclusionStencilMaterials(objects) {
    const states = new Map();
    for (const object of objects) {
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        material.colorWrite = false;
        material.depthWrite = false;
        // Compare only held bit 1: stencilRef=1 has that bit clear, so Equal
        // passes everywhere except weapon/hand pixels. Replace writes only bit
        // 0 from the same ref, producing the foot-only water mask value 1.
        material.stencilWrite = true;
        material.stencilWriteMask = 0x01;
        material.stencilFunc = THREE.EqualStencilFunc;
        material.stencilRef = 1;
        material.stencilFuncMask = 0x02;
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
        // Test only foot bit 0. Held pixels carry bit 1 and are deliberately
        // excluded when the foot mask is stamped, so weapons/hands x-ray water.
        material.stencilWrite = true;
        material.stencilWriteMask = 0x00;
        material.stencilFunc = THREE.EqualStencilFunc;
        material.stencilRef = 1;
        material.stencilFuncMask = 0x01;
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

  // The replay passes below only change pixels where held planes (and, for
  // the foot-water composite, the registered feet) actually land on screen:
  // everywhere else they rebuild exactly the depth the base pass already
  // wrote. Clipping the depth clear and every replay draw to a scissor
  // rectangle around those meshes leaves the rest of the framebuffer's base
  // depth untouched and stops the GPU re-rasterizing the whole world 3-5
  // extra times per frame while a tool is held. Anything that can't be
  // bounded conservatively (skinned/instanced/morphed geometry, a corner
  // behind the camera, a partial viewport) falls back to the old full-screen
  // passes.
  const scissorBox = new THREE.Box3();
  const scissorCorner = new THREE.Vector3();
  const scissorRect = new THREE.Vector4();
  const scissorViewport = new THREE.Vector4();
  const scissorDrawingSize = new THREE.Vector2();
  const SCISSOR_MARGIN_PX = 4;
  let replayScissorEnabled = true; // Debug A/B switch: HeldObjectRenderOrder.setReplayScissorEnabled(false) restores full-screen replay passes.
  let scissorTargetWidth = 0; // Framebuffer size the last scissorRect was measured against; used to build the replay cull frustum.
  let scissorTargetHeight = 0;

  // Scissoring alone only saves fragment work: every replay pass still
  // submitted every on-screen draw call and transformed every on-screen
  // vertex, roughly doubling the world's vertex/draw load whenever a tool
  // was held (which, with NPCs carrying gear, is nearly every frame on every
  // map). Objects whose bounds project entirely outside the scissor
  // rectangle cannot touch a single pixel those passes are allowed to write,
  // so they are hidden for the duration of the replay. The test is the same
  // bounding-sphere frustum test three.js already applies, just against the
  // sub-frustum the scissor rectangle carves out of the camera frustum.
  const CULL_EXTRA_MARGIN_PX = 16; // Slack for vertex-shader sway beyond a mesh's static bounds (three's own culling has none).
  const replayCullFrustum = new THREE.Frustum();
  const replayCullMatrix = new THREE.Matrix4();
  let replayCullEnabled = true; // Debug A/B switch: HeldObjectRenderOrder.setReplayCullEnabled(false).
  let lastReplayCulledCount = 0; // Renderables hidden from the last scissored replay.
  let lastReplayKeptCount = 0; // Cullable renderables still drawn by the last scissored replay.

  function setReplayCullFrustum(camera, rect, width, height) {
    const x0 = Math.max(0, rect.x - CULL_EXTRA_MARGIN_PX), y0 = Math.max(0, rect.y - CULL_EXTRA_MARGIN_PX);
    const x1 = Math.min(width, rect.x + rect.z + CULL_EXTRA_MARGIN_PX), y1 = Math.min(height, rect.y + rect.w + CULL_EXTRA_MARGIN_PX);
    if (!(x1 > x0 && y1 > y0)) return false;
    // NDC-space rectangle of the scissor, then a clip-space remap that sends
    // it to [-1, 1] (x' = (x - c*w) / h), leaving z/w untouched.
    const cx = ((x0 + x1) / width) - 1, hx = (x1 - x0) / width;
    const cy = ((y0 + y1) / height) - 1, hy = (y1 - y0) / height;
    replayCullMatrix.set(
      1 / hx, 0, 0, -cx / hx,
      0, 1 / hy, 0, -cy / hy,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    replayCullMatrix.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    replayCullFrustum.setFromProjectionMatrix(replayCullMatrix);
    return true;
  }

  function isReplayCullable(object) {
    if (object.frustumCulled === false || object.children.length) return false; // Hiding a parent would hide children that may be in view.
    if (object.isSprite) return true;
    if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return false; // r128 bounds these by the base geometry only.
    const geometry = object.geometry;
    return !!geometry && !geometry.morphAttributes?.position?.length;
  }

  function collectReplayCulled(scene, keep) {
    const culled = [];
    let kept = 0;
    scene.traverseVisible((object) => {
      if (keep.has(object) || !isReplayCullable(object)) return;
      const inside = object.isSprite ? replayCullFrustum.intersectsSprite(object) : replayCullFrustum.intersectsObject(object);
      if (inside) kept++;
      else culled.push(object);
    });
    lastReplayCulledCount = culled.length;
    lastReplayKeptCount = kept;
    return culled;
  }

  function replayScissorRect(renderer, camera, meshes, out) {
    if (!camera?.isPerspectiveCamera && !camera?.isOrthographicCamera) return false;
    const target = renderer.getRenderTarget?.() || null;
    let width, height;
    if (target) { width = target.width; height = target.height; }
    else { renderer.getDrawingBufferSize(scissorDrawingSize); width = scissorDrawingSize.x; height = scissorDrawingSize.y; }
    if (!(width > 0 && height > 0)) return false;
    renderer.getCurrentViewport?.(scissorViewport);
    if (scissorViewport.x !== 0 || scissorViewport.y !== 0 || scissorViewport.z !== width || scissorViewport.w !== height) return false;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const near = Number(camera.near) || 0;
    for (const mesh of meshes) {
      const geometry = mesh?.geometry;
      if (!geometry || mesh.isSkinnedMesh || mesh.isInstancedMesh || geometry.morphAttributes?.position?.length) return false;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) continue;
      scissorBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      const { min, max } = scissorBox;
      for (let corner = 0; corner < 8; corner++) {
        scissorCorner.set(corner & 1 ? max.x : min.x, corner & 2 ? max.y : min.y, corner & 4 ? max.z : min.z);
        scissorCorner.applyMatrix4(camera.matrixWorldInverse);
        if (camera.isPerspectiveCamera && scissorCorner.z > -near) return false; // At/behind the near plane: projection is unbounded.
        scissorCorner.applyMatrix4(camera.projectionMatrix);
        if (scissorCorner.x < minX) minX = scissorCorner.x;
        if (scissorCorner.x > maxX) maxX = scissorCorner.x;
        if (scissorCorner.y < minY) minY = scissorCorner.y;
        if (scissorCorner.y > maxY) maxY = scissorCorner.y;
      }
    }
    scissorTargetWidth = width;
    scissorTargetHeight = height;
    if (minX === Infinity) { out.set(0, 0, 0, 0); return true; } // Nothing drawable: no replay pixel can change.
    const x0 = Math.max(0, Math.floor((minX * 0.5 + 0.5) * width) - SCISSOR_MARGIN_PX);
    const y0 = Math.max(0, Math.floor((minY * 0.5 + 0.5) * height) - SCISSOR_MARGIN_PX);
    const x1 = Math.min(width, Math.ceil((maxX * 0.5 + 0.5) * width) + SCISSOR_MARGIN_PX);
    const y1 = Math.min(height, Math.ceil((maxY * 0.5 + 0.5) * height) + SCISSOR_MARGIN_PX);
    out.set(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    lastReplayScissorCoverage = (out.z * out.w) / (width * height);
    return true;
  }

  function restoreRendererScissor(renderer) {
    // setRenderTarget re-derives viewport/scissor/scissor-test for the current
    // target exactly as three.js itself would, undoing the clip above.
    renderer.setRenderTarget(renderer.getRenderTarget(), renderer.getActiveCubeFace?.() || 0, renderer.getActiveMipmapLevel?.() || 0);
  }

  function replaySelectiveHeldOverlay(renderer, scene, camera, held, ground, water, waterOccluded, originalCameraMask) {
    const needsHeldOverlay = held.length > 0; // Used to keep weapon/hand x-ray active even when no water is visible.
    const requestedFootWaterComposite = water.length > 0 && waterOccluded.length > 0; // Used to skip all foot-water stencil work on dry scenes.
    const stencilBits = currentFramebufferStencilBits(renderer); // Must describe the CURRENT render target (_mainRT while outlines are on), not the default canvas.
    const needsFootWaterComposite = requestedFootWaterComposite && stencilBits >= 2;
    if (requestedFootWaterComposite && !needsFootWaterComposite) missingStencilFootReplaySkipCount++;
    if (!ground.length || (!needsHeldOverlay && !needsFootWaterComposite)) return;

    const oldAutoClear = renderer.autoClear;
    const oldAutoClearColor = renderer.autoClearColor;
    const oldAutoClearDepth = renderer.autoClearDepth;
    const oldAutoClearStencil = renderer.autoClearStencil;
    const oldBackground = scene.background;
    const oldSceneAutoUpdate = scene.autoUpdate;
    const shadowMap = renderer.shadowMap;
    const oldShadowAutoUpdate = shadowMap?.autoUpdate;

    internalReplay = true;
    const glState = renderer.state;
    const scissorMeshes = needsFootWaterComposite ? [...held, ...waterOccluded] : held;
    let scissored = replayScissorEnabled && !!(glState?.scissor && glState?.setScissorTest) && replayScissorRect(renderer, camera, scissorMeshes, scissorRect);
    let replayCulled = null; // Visibility states of renderables hidden for this replay (see collectReplayCulled).
    try {
      if (scissored) {
        glState.scissor(scissorRect);
        glState.setScissorTest(true);
        scissoredReplayCount++;
        if (replayCullEnabled && setReplayCullFrustum(camera, scissorRect, scissorTargetWidth, scissorTargetHeight)) {
          const cullPerf = window.PerfProfiler?.begin('held-overlay: scissor cull');
          replayCulled = hideObjects(collectReplayCulled(scene, new Set(scissorMeshes)));
          window.PerfProfiler?.end(cullPerf);
        }
      } else {
        fullscreenReplayCount++;
        lastReplayScissorCoverage = 1;
      }
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
        ? prepareCutoutDepthMaterials(collectVisible(pngDepthRegistry, scene))
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

      // 2) Draw weapons/hands once against non-ground depth and mark their
      // exact visible fragments in stencil bit 1. This is the actual x-ray:
      // terrain and water can never be composited over these held pixels.
      if (scissored) glState.setScissorTest(false); // Stencil clears stay full-framebuffer, as before.
      renderer.clearStencil?.();
      if (scissored) glState.setScissorTest(true);
      if (held.length) {
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
      }

      // 3) Restore authored terrain depth before any water composite. The held
      // color is already on-screen, so this cannot cover it; it only restores
      // the real depth boundary. Raised soil therefore blocks a lower flood.
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

      // 4) Feet intentionally do NOT x-ray water. Stamp only explicitly
      // registered water-occluded meshes into stencil bit 0, excluding any
      // overlapping held bit-1 pixels, then replay water through that mask.
      if (needsFootWaterComposite) {
        const footStencilStates = prepareWaterOcclusionStencilMaterials(waterOccluded);
        try {
          camera.layers.mask = FOOT_WATER_MASK;
          const footMaskPerf = window.PerfProfiler?.begin('held-overlay: foot water mask render');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(footMaskPerf);
        } finally {
          restoreMaterialStates(footStencilStates);
        }

        const waterStencilStates = prepareWaterStencilMaterials(water);
        try {
          camera.layers.mask = WATER_REPLAY_MASK;
          const waterReplayPerf = window.PerfProfiler?.begin('held-overlay: foot water composite render');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(waterReplayPerf);
          waterReplayCount++;
        } finally {
          restoreMaterialStates(waterStencilStates);
        }
      }
      if (scissored) { restoreRendererScissor(renderer); scissored = false; }
      renderer.clearStencil?.();
    } finally {
      if (replayCulled) restoreVisibility(replayCulled);
      if (scissored) restoreRendererScissor(renderer);
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
    lastBaseStencilBits = currentFramebufferStencilBits(this);
    const held = collectVisible(heldRegistry, scene);
    const ground = collectVisible(groundRegistry, scene);
    const water = collectVisible(waterRegistry, scene); // Used only when explicitly water-occluded meshes (feet) need a translucent replay.
    const waterOccluded = collectVisible(waterOccludedRegistry, scene); // Used to keep feet under water while weapons/hands remain above it.
    if (!ground.length || (!held.length && !(water.length && waterOccluded.length))) return originalRender.call(this, scene, camera);

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
    replaySelectiveHeldOverlay(this, scene, camera, held, ground, water, waterOccluded, originalCameraMask);
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
      groundMeshes: groundCount,
      grassMeshes: grassCount,
      roadMeshes: roadCount,
      terrainMeshes: terrainCount,
      waterReplayMeshes: waterMeshCount,
      waterOccludedMeshes: waterOccludedMeshCount,
      waterReplays: waterReplayCount,
      stencilBits: lastBaseStencilBits,
      missingStencilFootReplaySkips: missingStencilFootReplaySkipCount,
      scissoredReplays: scissoredReplayCount,
      fullscreenReplays: fullscreenReplayCount,
      lastReplayScissorCoverage: Number(lastReplayScissorCoverage.toFixed(4)),
      replayCullEnabled,
      lastReplayCulled: lastReplayCulledCount,
      lastReplayKept: lastReplayKeptCount,
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
      const message = `[held-xray] enabled=${state.enabled} held=${state.heldMeshes} ground=${state.groundMeshes} (grass=${state.grassMeshes} road=${state.roadMeshes} terrain=${state.terrainMeshes}) footWater=${state.waterOccludedMeshes}/${state.waterReplayMeshes}/${state.waterReplays} stencil=${state.stencilBits} stencilSkips=${state.missingStencilFootReplaySkips} base=${state.baseWorldRenders} overlay=${state.selectiveOverlays} depth=${state.nonGroundDepthReplays}/${state.groundDepthRestores} repairs=${state.invariantRepairs} scissor=${state.scissoredReplays}/${state.fullscreenReplays} coverage=${state.lastReplayScissorCoverage}`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }
    return state;
  }

  window.HeldObjectRenderOrder = {
    installed: true,
    mode: 'selective-depth-replay',
    LEGACY_HELD_RENDER_ORDER,
    FOOT_WATER_MASK_LAYER,
    HELD_OVERLAY_LAYER,
    GROUND_REPLAY_LAYER,
    markHeldPlane,
    markWaterOccludedMesh,
    markGroundMesh,
    scanScene,
    snapshot,
    debugLogSnapshot,
    setReplayScissorEnabled: value => { replayScissorEnabled = value !== false; return replayScissorEnabled; },
    setReplayCullEnabled: value => { replayCullEnabled = value !== false; return replayCullEnabled; },
    get enabled() { return enabled; },
    // Retained as a compatibility no-op for the former camera-mode toggle.
    // Ground/grass x-ray is now an invariant of held weapon presentation.
    setEnabled() { enabled = true; },
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
        waterSurface: isWaterSurface(object),
        waterOccluded: object?.userData?.hobunjiWaterOccludedBySurface === true,
      };
    },
  };
})();
