(() => {
  'use strict';

  // Held-object selective ground x-ray and translucent submersion contract.
  // Read docs/architecture/held-object-water-depth-compositing.md before
  // changing any pass, overlay, water cover, or renderer depth behavior.
  //
  // Normal world color renders without held planes/registered feet. In a
  // separate depth-reconstructed overlay, hands/weapons/feet ignore ONLY base
  // grass and authored paths, not props, snow or other solid occluders. The
  // subsequent water/slush tint uses the original translucent material and
  // only affects geometrically submerged pixels marked in stencil.
  //
  // REGRESSION INVARIANT (confirmed with two farm-flood Pixel Probes):
  // after overlay color is drawn, restore base grass/path DEPTH colorlessly
  // BEFORE water/slush tint. If tint runs first, the missing elevated grass
  // depth lets flood color leak through it in irregular teal patches, despite
  // BOTH materials individually having depthTest enabled. The user's
  // painterly on/off comparison ruled out the painterly postprocess.
  //
  // Do not re-render ground color; do not clear depth between restoring
  // ground depth and tinting. Material, viewport/scissor and camera state
  // are restored after each pass.
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

  // Registered meshes bucketed by the scene they were last found in. Ground
  // registries accumulate every floor mesh of every cached zone/interior
  // scene (15k+ after a tour of the wilds), and collectVisible runs for each
  // registry on every world render; walking only the rendering scene's bucket
  // keeps that per-frame cost proportional to the current map. Members are
  // re-queued whenever they are (re)added anywhere, which is how a held tool
  // that moves with the player into another scene gets re-bucketed.
  class SceneRegistry {
    constructor() {
      this.all = new Set();
      this.pending = new Set(); // Members whose scene is unknown or may have changed.
      this.byScene = new Map(); // Scene -> Set of members last found under it.
      this.sceneOf = new Map(); // Member -> scene key in byScene.
    }
    add(object) {
      this.all.add(object);
      this.unplace(object);
      this.pending.add(object);
      return this;
    }
    has(object) { return this.all.has(object); }
    delete(object) {
      if (!this.all.delete(object)) return false;
      this.pending.delete(object);
      this.unplace(object);
      return true;
    }
    place(object, scene) {
      this.unplace(object);
      let bucket = this.byScene.get(scene);
      if (!bucket) this.byScene.set(scene, bucket = new Set());
      bucket.add(object);
      this.sceneOf.set(object, scene);
    }
    unplace(object) {
      const scene = this.sceneOf.get(object);
      if (!scene) return;
      this.sceneOf.delete(object);
      this.byScene.get(scene)?.delete(object);
    }
    [Symbol.iterator]() { return this.all.values(); }
  }

  const heldMeshes = new WeakSet();
  const groundMeshes = new WeakSet();
  const waterMeshes = new WeakSet(); // Used by classifyObject to count each canonical water surface once across fallback rescans.
  const waterOccludedMeshes = new WeakSet(); // Used to count each explicitly water-occluded mesh once; procedural feet register here.
  const heldRegistry = new SceneRegistry();
  const groundRegistry = new SceneRegistry();
  const topFaceGroundRegistry = new SceneRegistry(); // Used for meshes whose upward faces are ground but whose walls/ceiling still occlude (carved cavern shells).
  const occluderGeometries = new WeakMap(); // Source geometry -> geometry of only its non-upward faces, built once per geometry.
  const waterRegistry = new SceneRegistry(); // All tagged water surfaces; also exposed in diagnostics.
  const tintCoverRegistry = new SceneRegistry(); // Translucent water/slush to blend over submerged feet, hands and held gear (never opaque snow).
  const protectedCoverRegistry = new SceneRegistry(); // Snow/slush, water and billboard grass must write temporary depth in the held overlay.
  const waterOccludedRegistry = new SceneRegistry(); // Procedural foot meshes, drawn in the selective x-ray overlay with real water/snow/grass depth.
  const pngDepthRegistry = new SceneRegistry(); // Used by the colorless replay to repair only cutout depth materials instead of traversing every visible object.
  const preparedLights = new WeakSet();
  const lastSceneScan = new WeakMap();

  let heldCount = 0;
  let groundCount = 0;
  let farmhouseFloorCount = 0; // Counts just player-farmhouse floor meshes in the shared interior floor replay.
  const countedFarmhouseFloors = new WeakSet(); // Ensures floor meshes counted before farmhouse registration are counted when they are later tagged.
  let interiorFloorCount = 0; // Counts all tagged walkable interior floors, including rebuilt and authored rooms.
  let grassCount = 0;
  let roadCount = 0;
  let terrainCount = 0;
  let topFaceGroundCount = 0; // Meshes registered via markTopFaceGroundMesh.
  let waterMeshCount = 0; // Exposed in debugState so mobile diagnostics can confirm water surfaces are eligible for translucent replay.
  let waterOccludedMeshCount = 0; // Used by mobile diagnostics to confirm procedural feet registered for water occlusion.
  let waterReplayCount = 0; // Counts depth-correct translucent water/slush tint passes over foot pixels.
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

  function materialMarksInteriorFloor(material) {
    const materials = Array.isArray(material) ? material : [material]; // Used by isWalkableGroundSurface so multi-material floors receive the same held-object x-ray policy.
    return materials.some(entry => entry?.userData?.hobunjiInteriorFloorMaterial === true);
  }

  function materialMarksBaseGrass(material) {
    const materials = Array.isArray(material) ? material : [material]; // Used to recognize only the terrain TileType.GRASS material, including map texture overrides.
    return materials.some(entry => entry?.userData?.hobunjiBaseGrassTerrainMaterial === true);
  }

  function isWalkableGroundSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    const data = object.userData || {}; // Existing semantic floor tags are preferred over geometry/name heuristics.
    if (data.hobunjiGroundSurface === true || data.cavernWalkableFloor === true) return true;
    if (materialMarksInteriorFloor(object.material)) return true;

    // Debrisifier V50 exposes its stepped/sunken ruin floor as one WallBuilder
    // surface carrying a plateau model. Treat that authored walkable surface as
    // ground too, including cells above/below the base floor elevation.
    if (data.wallBuilderRecipe === 'wallrecipe2.json' && data.plateauModel?.levelByCell) return true;
    return false;
  }

  function isTerrainSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    if (object.userData?.environmentSurfaceMicroPlateau === true) return false; // Snow and slush are raised occluders, never the base grass.

    // Interior floors, generated ruin floors, and explicitly tagged walkable
    // terrain are ground regardless of hierarchy or elevation.
    if (isWalkableGroundSurface(object)) return true;

    // Spatial terrain chunks are generated only from whole-zone floor meshes.
    if (object.userData?.terrainRenderChunk === true || object.userData?.terrainRenderChunkSource === true) return true;

    // Map-editor floor buckets (farm/town/wilderness). Wilderness streams
    // them inside WildernessChunk_* groups, so the scene-parent test below
    // never saw them and weapons were buried under wilderness ground.
    if (object.userData?.mapEditorTerrain) return true;

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

  // A carved cavern shell is floor, walls, and ceiling in one mesh, and its
  // upward floor faces sit a hair below the tagged walkable floor. Hiding the
  // whole shell would let weapons x-ray cave walls; keeping it would bury
  // weapons under the floor. Only its upward faces are treated as ground.
  function isTopFacesGroundSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh || object.isInstancedMesh) return false;
    return object.userData?.hobunjiGroundTopFacesOnly === true;
  }

  function isWaterSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    const data = object.userData || {}; // Existing runtime water tags are preferred over broad name matching so props with "water" in their names are never replayed.
    if (data.mergedWaterStatKey || data.waterSurfaceRole) return true;
    if (data.waterfallSurfaceHeightMode || data.waterfallTexture) return true;
    return false;
  }

  function groundKind(object) {
    if (isTopFacesGroundSurface(object)) return null; // A single cavern shell also contains walls; its floor faces need selective clipping below, never whole-mesh removal.
    if (isProtectedCover(object)) return null; // Snow/slush, water, and billboard grass always occlude held gear, even above a path.
    if (isRoadSurface(object)) return 'road'; // Authored path-brick groups retain the same x-ray as the underlying grass.
    if (object?.isMesh && !object.isSkinnedMesh) {
      const data = object.userData || {}; // Semantic-only floor classification also covers cavern and rooted-ruin floor geometry that does not use InteriorSceneBuilder's material.
      if (materialMarksInteriorFloor(object.material)
          || data.cavernWalkableFloor === true
          || (data.wallBuilderRecipe === 'wallrecipe2.json' && !!data.plateauModel?.levelByCell)
          || (data.liveRootFloor === true && data.ruinPreviewRole === 'floor')) return 'interior-floor';
    }
    if (materialMarksBaseGrass(object?.material) && isTerrainSurface(object)) return 'terrain';
    return null;
  }

  function isSlushSurface(object) {
    if (!object?.isMesh || object.userData?.environmentSurfaceMicroPlateau !== true) return false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    return materials.some(entry => entry?.userData?.environmentSurfaceMicroPlateauMaterial === 'slush');
  }

  function isTintCover(object) {
    // These two translucent covers must blend over foot pixels, not erase them.
    // Snow and grass billboards remain depth occluders without a tint replay.
    return isWaterSurface(object) || isSlushSurface(object);
  }

  function isProtectedCover(object) {
    return isGrassGroundCover(object) || isWaterSurface(object)
      || object?.userData?.environmentSurfaceMicroPlateau === true;
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
    if (mesh.renderOrder !== 0 && mesh.userData?.hobunjiWeaponAssemblyPart !== true) {
      mesh.renderOrder = 0;
      repaired = true;
    } // Ordered multi-sprite weapon children retain their deliberate back→fuel→fire→front draw order; the ordinary held haft still normalizes to 0.
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
    if (!hasLayer(mesh, FOOT_WATER_MASK_LAYER)) mesh.layers.enable(FOOT_WATER_MASK_LAYER); // Retain compatibility for diagnostic/older foot consumers.
    if (!hasLayer(mesh, HELD_OVERLAY_LAYER)) mesh.layers.enable(HELD_OVERLAY_LAYER); // Feet x-ray through grass/paths, but never through water/snow/props.
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
    if (kind === 'interior-floor' && hasAncestorFlag(mesh, 'hobunjiPlayerFarmhouseInterior') && !countedFarmhouseFloors.has(mesh)) {
      countedFarmhouseFloors.add(mesh);
      farmhouseFloorCount++; // Registration can happen after the generic interior floor was already scanned.
    }
    if (!already) {
      groundCount++;
      if (kind === 'grass') grassCount++;
      else if (kind === 'road') roadCount++;
      else if (kind === 'terrain') terrainCount++;
      else if (kind === 'interior-floor') interiorFloorCount++;
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
    if (isProtectedCover(object)) protectedCoverRegistry.add(object);
    if (isTintCover(object)) {
      tintCoverRegistry.add(object);
      if (!hasLayer(object, WATER_REPLAY_LAYER)) object.layers.enable(WATER_REPLAY_LAYER);
    }
    if (isWaterSurface(object)) {
      waterRegistry.add(object);
      if (!waterMeshes.has(object)) {
        waterMeshes.add(object);
        waterMeshCount++;
      }
    }
    const kind = groundKind(object);
    if (kind) markGroundMesh(object, kind);
    if (isTopFacesGroundSurface(object)) markTopFaceGroundMesh(object); // Clip only upward cave-shell floor triangles in the depth rebuild, preserving walls and ceiling as real occluders.
  }

  function markTopFaceGroundMesh(mesh) {
    const fresh = !topFaceGroundRegistry.has(mesh);
    topFaceGroundRegistry.add(mesh);
    if (!fresh) return false;
    // The ground-depth restore pass draws the whole shell colorless. Its
    // walls already wrote identical depth in the rebuild pass, so only the
    // floor faces actually change anything there.
    if (!hasLayer(mesh, GROUND_REPLAY_LAYER)) mesh.layers.enable(GROUND_REPLAY_LAYER);
    topFaceGroundCount++;
    return true;
  }

  // Geometry sharing the source's vertex attributes, indexing only faces that
  // point less than ~60 degrees from straight up in world space, so slopes
  // and walls keep occluding. Material groups are preserved per face.
  const TOP_FACE_MIN_NORMAL_Y = 0.5;
  const faceA = new THREE.Vector3();
  const faceB = new THREE.Vector3();
  const faceC = new THREE.Vector3();
  const faceNormalMatrix = new THREE.Matrix3();
  function occluderGeometryFor(mesh) {
    const source = mesh.geometry;
    if (!source) return null;
    if (occluderGeometries.has(source)) return occluderGeometries.get(source);
    let occluder = null;
    const position = source.attributes?.position;
    if (position && !position.isInterleavedBufferAttribute && !source.morphAttributes?.position?.length) {
      const index = source.index;
      const count = index ? index.count : position.count;
      const groups = source.groups?.length ? source.groups : [{ start: 0, count, materialIndex: 0 }];
      mesh.updateWorldMatrix(true, false);
      faceNormalMatrix.getNormalMatrix(mesh.matrixWorld);
      const kept = [];
      const keptGroups = [];
      let topFaces = 0;
      for (const group of groups) {
        const groupStart = kept.length;
        const end = Math.min(count, group.start + group.count);
        for (let i = Math.max(0, group.start); i + 2 < end; i += 3) {
          const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
          faceA.fromBufferAttribute(position, a);
          faceB.fromBufferAttribute(position, b).sub(faceA);
          faceC.fromBufferAttribute(position, c).sub(faceA);
          faceB.cross(faceC).applyMatrix3(faceNormalMatrix);
          const length = faceB.length();
          if (length > 1e-12 && faceB.y / length >= TOP_FACE_MIN_NORMAL_Y) { topFaces++; continue; }
          kept.push(a, b, c);
        }
        if (kept.length > groupStart) keptGroups.push({ start: groupStart, count: kept.length - groupStart, materialIndex: group.materialIndex ?? 0 });
      }
      if (topFaces > 0) {
        occluder = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(source.attributes)) occluder.setAttribute(name, attribute);
        occluder.setIndex(new THREE.BufferAttribute(position.count > 65535 ? new Uint32Array(kept) : new Uint16Array(kept), 1));
        for (const group of keptGroups) occluder.addGroup(group.start, group.count, group.materialIndex);
        if (!source.boundingSphere) source.computeBoundingSphere();
        if (!source.boundingBox) source.computeBoundingBox();
        occluder.boundingSphere = source.boundingSphere?.clone() || null;
        occluder.boundingBox = source.boundingBox?.clone() || null;
        occluder.name = `${source.name || 'geometry'}__held_xray_occluder`;
        // Shared attributes stay owned by the source; release only our own
        // index buffer when the source goes away.
        source.addEventListener('dispose', () => { occluder.attributes = {}; occluder.dispose(); });
      }
    }
    occluderGeometries.set(source, occluder);
    return occluder;
  }

  function swapToOccluderGeometry(meshes) {
    const swapped = [];
    for (const mesh of meshes) {
      const occluder = occluderGeometryFor(mesh);
      if (!occluder) continue;
      swapped.push(mesh, mesh.geometry);
      mesh.geometry = occluder;
    }
    return swapped;
  }

  function restoreSwappedGeometry(swapped) {
    for (let i = 0; i < swapped.length; i += 2) swapped[i].geometry = swapped[i + 1];
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

  // One upward walk finds both the owning root and whether any ancestor
  // (root included) is hidden.
  let walkVisible = true;
  function walkToRoot(object) {
    let node = object;
    walkVisible = true;
    for (;;) {
      if (node.visible === false) walkVisible = false;
      if (!node.parent) return node;
      node = node.parent;
    }
  }

  function collectVisible(registry, scene) {
    const result = [];
    for (const object of registry.pending) {
      registry.pending.delete(object);
      if (!object?.isMesh) { registry.delete(object); continue; }
      const root = walkToRoot(object);
      // Detached runtime meshes should not be kept alive by our registry.
      if (!root.isScene) registry.delete(object);
      else registry.place(object, root);
    }
    const bucket = registry.byScene.get(scene);
    if (!bucket) return result;
    for (const object of bucket) {
      const root = walkToRoot(object);
      if (root !== scene) {
        if (!root.isScene) registry.delete(object);
        else registry.place(object, root);
        continue;
      }
      if (walkVisible) result.push(object);
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
      depthTest: material.depthTest,
      alphaTest: material.alphaTest,
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
      material.depthTest = state.depthTest;
      if (state.alphaTest !== undefined) material.alphaTest = state.alphaTest;
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

  function useSpriteOcclusionCutout(object, material) {
    // Only tagged authored PNG planes use the stricter mask. Foliage, water,
    // and other protected covers keep their own alpha and depth rules.
    if (!hasLayer(object, PNG_OCCLUDER_LAYER) || !material.map || Number(material.alphaTest) <= 0) return;
    const maskCutoff = Number(window.HobunjiSpritePngSurface?.maskAlphaTest?.()) || 0.35; // The same minimum coverage used by the regular depth-writing sprite factory.
    material.alphaTest = Math.max(Number(material.alphaTest), maskCutoff);
  }

  function prepareNonGroundDepthMaterials(scene) {
    const states = new Map();
    scene.traverseVisible((object) => {
      const isMesh = !!object?.isMesh;
      const isCelestialSprite = !!object?.isSprite && object.userData?.hobunjiNoOutline === true; // Used here to suppress only the sky-dome sun/moon sprites during this colorless replay.
      if (!isMesh && !isCelestialSprite) return;
      const forceCutoutDepth = isMesh && hasLayer(object, PNG_OCCLUDER_LAYER);
      const forceCoverDepth = isMesh && isProtectedCover(object); // Transparent water/slush and alpha-cutout grass must occlude held gear.
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        material.colorWrite = false;
        // PNG avatar planes intentionally disable normal depth writing for
        // avatar-vs-avatar ordering. For this temporary occlusion buffer only,
        // use the game's existing layer-4 convention and preserve the real
        // alpha-tested silhouette while making it capable of blocking a tool.
        // Celestial sprites keep their authored depthWrite=false; only their
        // accidental second color draw is suppressed during this replay.
        if (isMesh && (forceCutoutDepth || forceCoverDepth || Number(material.alphaTest || 0) > 0)) material.depthWrite = true;
        if (forceCutoutDepth) useSpriteOcclusionCutout(object, material);
      });
    });
    return states;
  }

  function prepareCutoutDepthMaterials(cutouts, protectedCover) {
    const states = new Map();
    for (const object of protectedCover) {
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        material.depthWrite = true; // Depth-only replay: keep visible base-pass cover pixels untouched.
      });
    }
    for (const object of cutouts) {
      forEachMaterial(object.material, (material) => {
        if (Number(material.alphaTest || 0) <= 0 && !hasLayer(object, PNG_OCCLUDER_LAYER)) return;
        saveMaterialState(states, material);
        material.depthWrite = true;
        useSpriteOcclusionCutout(object, material);
      });
    }
    return states;
  }

  function prepareHeldStencilMaterials(held) {
    const states = new Map();
    for (const object of held) {
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        // Legacy bit-1 held-only stencil helper (not used by the current
        // unified hands/weapons/feet tint pass). Do not revive the older
        // feet-first/tint/held-last order: it paints weapons over their
        // underwater tint. See the rendering architecture contract.
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

  function prepareSubmergedOverlayStencilMaterials(overlayMeshes) {
    const states = new Map();
    for (const object of overlayMeshes) {
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        // Stamp only visible held/hand/foot fragments that pass solid
        // depth. Enforce depthWrite during the temporary draw so water
        // BEHIND a weapon/hand/foot fails the tint pass, even if that PNG's
        // normal alpha compositing material opts out of depth writes.
        // Keep the authored alphaTest to avoid opaque rectangle stamps.
        material.depthTest = true;
        material.depthWrite = true;
        material.stencilWrite = true;
        material.stencilWriteMask = 0x01;
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

  function prepareOverlayCoverTintMaterials(covers) {
    const states = new Map();
    for (const object of covers) {
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        // Blend authored water/slush color and alpha over visible foot,
        // hand and weapon pixels only when the surface is closer. Do NOT
        // force depthTest off: the user's flood probe measured raised opaque
        // grass in front of the flood (grass 0.341 > water 0.160) and an
        // unoccluded water overlay would create exactly those color splotches.
        // Preserve overlay depth until after the tint pass.
        material.depthTest = true;
        material.depthWrite = false;
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

  function prepareTintCoverDepthMaterials(covers) {
    const states = new Map();
    for (const object of covers) {
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        material.colorWrite = false;
        material.depthTest = true;
        material.depthWrite = true; // Real foreground cover depth for held weapons/hands.
        material.stencilWrite = false;
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
    if (object.isSprite && object.userData?.hobunjiHeldOverlayParticle === true) return false; // Moving enchantment motes inherit the held blade's expanded scissor but must not be hidden by the replay's extra object-frustum cull.
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
    function includeBounds(mesh) {
      const geometry = mesh?.geometry; // Used to project one held mesh or one visible child with a live enchantment emitter.
      if (!geometry || mesh.isSkinnedMesh || mesh.isInstancedMesh || geometry.morphAttributes?.position?.length) return false;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return true;
      scissorBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      const vfxPadding = Number(mesh.userData?.hobunjiHeldOverlayVfxPadding) || 0; // Live sprite growth/drift can reach outside this plane's geometric rectangle.
      if (vfxPadding > 0) scissorBox.expandByScalar(vfxPadding * mesh.matrixWorld.getMaxScaleOnAxis());
      const { min, max } = scissorBox;
      for (let corner = 0; corner < 8; corner++) {
        scissorCorner.set(corner & 1 ? max.x : min.x, corner & 2 ? max.y : min.y, corner & 4 ? max.z : min.z);
        scissorCorner.applyMatrix4(camera.matrixWorldInverse);
        if (camera.isPerspectiveCamera && scissorCorner.z > -near) return false; // Never clip uncertain near-plane projections.
        scissorCorner.applyMatrix4(camera.projectionMatrix);
        if (scissorCorner.x < minX) minX = scissorCorner.x;
        if (scissorCorner.x > maxX) maxX = scissorCorner.x;
        if (scissorCorner.y < minY) minY = scissorCorner.y;
        if (scissorCorner.y > maxY) maxY = scissorCorner.y;
      }
      return true;
    }
    for (const mesh of meshes) {
      if (!includeBounds(mesh)) return false;
      // Dual wield copies live under an invisible source blade. Its registry
      // entry defines the normal scissor, but its transformed child blades
      // (and their emitters) can be far outside that source rectangle. Only
      // project descendants with *live* aura padding; ordinary children add
      // no replay work and hidden offhand copies must not enlarge the pass.
      if (!mesh.children?.length || !mesh.traverseVisible) continue;
      let valid = true; // Used to conservatively disable scissoring if a child emitter has unreliable bounds.
      mesh.traverseVisible(child => {
        if (!valid || child === mesh || !(Number(child.userData?.hobunjiHeldOverlayVfxPadding) > 0)) return;
        if (!includeBounds(child)) valid = false;
      });
      if (!valid) return false;
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

  const footTintScreenRect = new THREE.Vector4(); // Reused scratch: no per-frame allocation.
  function hasOverlappingHeldCover(renderer, camera, overlayMeshes, tintCovers) {
    if (!overlayMeshes.length || !tintCovers.length) return false;
    // The ordinary scene contains water far from the character even on dry
    // tiles. Do not pay for extra rendering passes when none of that
    // water/slush can overlap hands, held gear or feet. Match the existing
    // replay scissor's conservative projection, including near-plane fallback.
    if (!replayScissorRect(renderer, camera, overlayMeshes, footTintScreenRect)) return true;
    if (footTintScreenRect.z <= 0 || footTintScreenRect.w <= 0) return false;
    if (!setReplayCullFrustum(camera, footTintScreenRect, scissorTargetWidth, scissorTargetHeight)) return true;
    for (const cover of tintCovers) {
      // This frustum uses Three's regular bounding sphere. For instanced,
      // skinned, morphed or custom-frustum meshes keep the safe tint fallback.
      if (!cover.geometry || cover.isInstancedMesh || cover.isSkinnedMesh
        || cover.frustumCulled === false || cover.geometry.morphAttributes?.position?.length) return true;
      if (replayCullFrustum.intersectsObject(cover)) return true;
    }
    return false;
  }

  function replaySelectiveHeldOverlay(renderer, scene, camera, held, feet, ground, topFaceGround, tintCovers, originalCameraMask) {
    // Weapons/hands and procedural feet share selective ground x-ray.
    // Translucent water and slush tint only the submerged pixels of ANY
    // held/foot surface; opaque snow, standing grass and solid geometry still
    // hide them, while base grass/paths remain x-ray exceptions.
    if (!held.length && !feet.length) return;

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
    const overlayMeshes = [...held, ...feet];
    // On targets without stencil, keep conservative full occlusion instead
    // of drawing untinted hands, tools or feet above submerged surfaces.
    const tintOverlay = lastBaseStencilBits >= 1 && hasOverlappingHeldCover(renderer, camera, overlayMeshes, tintCovers);
    const scissorMeshes = overlayMeshes;
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
      const hidden = hideObjects(tintOverlay ? [...ground, ...overlayMeshes, ...tintCovers] : [...ground, ...overlayMeshes]);
      const swappedGeometry = swapToOccluderGeometry(topFaceGround);
      const prepPerf = window.PerfProfiler?.begin('held-overlay: depth material prep');
      const colorBuffer = renderer.state?.buffers?.color; // Three's locked color mask keeps every original material shader/alpha cutout while suppressing all color writes globally.
      const canLockColorMask = !!colorBuffer?.setMask && !!colorBuffer?.setLocked;
      const depthMaterialStates = canLockColorMask
        ? prepareCutoutDepthMaterials(collectVisible(pngDepthRegistry, scene), collectVisible(protectedCoverRegistry, scene))
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
        restoreSwappedGeometry(swappedGeometry);
        restoreVisibility(hidden);
      }

      // 2) Draw feet, hands and held gear once, against solid scene depth.
      // When water/slush can overlap them, defer ONLY translucent cover
      // depth while preserving ordinary solid occlusion. Stencil records
      // the actual visible fragments of every held/foot mesh, and the
      // restored alpha shader tints only where that cover is in FRONT.
      if (scissored) glState.setScissorTest(false);
      renderer.clearStencil?.();
      if (scissored) glState.setScissorTest(true);
      if (overlayMeshes.length) {
        const overlayStates = tintOverlay ? prepareSubmergedOverlayStencilMaterials(overlayMeshes) : null;
        try {
          camera.layers.mask = HELD_OVERLAY_MASK;
          const overlayPerf = window.PerfProfiler?.begin('held-overlay: overlay render');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(overlayPerf);
          selectiveOverlayCount++;
        } finally {
          if (overlayStates) restoreMaterialStates(overlayStates);
        }
      }
      // 2b) CRITICAL PASS ORDER INVARIANT — see
      // docs/architecture/held-object-water-depth-compositing.md:
      // Restore real BASE GRASS / PATH depth before translucent cover
      // tinting. The previous ordering restored ground only AFTER
      // drawing water, letting flood fragments behind elevated grass pass
      // through the temporarily empty ground-depth buffer in irregular
      // areas where held/foot stencil was present. Pixel Probe measured
      // the opaque grass at ray distance 1.498 and flood at 1.908.
      // This colorless restore cannot hide the already-rendered overlay
      // sprites (their color remains on screen), but it ensures a flood
      // fragment fails depth when an opaque grass surface is closer.
      // In genuine flooding water is ABOVE the grass, so it still passes
      // depth and tints the visible portions of hands, gear and feet.
      const groundMaterialStates = prepareGroundDepthMaterials(topFaceGround.length ? [...ground, ...topFaceGround] : ground);
      try {
        camera.layers.mask = GROUND_REPLAY_MASK;
        const groundRestorePerf = window.PerfProfiler?.begin('held-overlay: ground restore render');
        rawRender.call(renderer, scene, camera);
        window.PerfProfiler?.end(groundRestorePerf);
        groundDepthRestoreCount++;
      } finally {
        restoreMaterialStates(groundMaterialStates);
      }

      if (tintOverlay) {
        // Tint is intentionally a SEPARATE transparent draw with the
        // ORIGINAL shader (animated texture) or slush opacity. Stencil
        // restricts blending to overlay fragments; world-space depth
        // rejects lower floodwater behind grass/feet and preserves dry
        // portions of tools/arms and footwear.
        const tintStates = prepareOverlayCoverTintMaterials(tintCovers);
        try {
          camera.layers.mask = WATER_REPLAY_MASK;
          const tintPerf = window.PerfProfiler?.begin('held-overlay: submerged gear tint');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(tintPerf);
          waterReplayCount++;
        } finally {
          restoreMaterialStates(tintStates);
        }

        // Color has already been composited. Restore the water/slush
        // surface to final framebuffer depth for later consumers, WITHOUT
        // blending it twice. Elevated grass depth already rejects any
        // water physically below it.
        const coverDepthStates = prepareTintCoverDepthMaterials(tintCovers);
        try {
          camera.layers.mask = WATER_REPLAY_MASK;
          const depthPerf = window.PerfProfiler?.begin('held-overlay: translucent cover depth');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(depthPerf);
        } finally {
          restoreMaterialStates(coverDepthStates);
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
    const topFaceGround = collectVisible(topFaceGroundRegistry, scene);
    const water = collectVisible(waterRegistry, scene); // Existing water diagnostics and all tagged water surfaces.
    const tintCovers = collectVisible(tintCoverRegistry, scene); // Water/slush foreground alpha applies to gear, hands and feet; not opaque snow.
    const feet = collectVisible(waterOccludedRegistry, scene); // Procedural foot meshes share selective ground x-ray.
    if (!held.length && !feet.length) return originalRender.call(this, scene, camera);
    if (!ground.length && !topFaceGround.length && !(tintCovers.length && (held.length || feet.length))) return originalRender.call(this, scene, camera);

    baseWorldRenderCount++;
    for (const mesh of held) enforceHeldMesh(mesh);
    for (const mesh of ground) enforceGroundMesh(mesh);

    // Draw held items and procedural feet exactly once, after reconstructed
    // cover depth. Normal water uses depthWrite=false, so feet left in this
    // base pass could otherwise render visibly over the water surface.
    const heldVisibility = hideObjects([...held, ...feet]);
    let result;
    const basePerf = window.PerfProfiler?.begin('held-overlay: base render');
    try {
      result = originalRender.call(this, scene, camera);
    } finally {
      window.PerfProfiler?.end(basePerf);
      restoreVisibility(heldVisibility);
    }

    const replayPerf = window.PerfProfiler?.begin('held-overlay: total replay'); // Sum of the three sub-passes above plus the depth-material-prep traversal; kept separate so it's directly comparable to held-overlay: base render.
    replaySelectiveHeldOverlay(this, scene, camera, held, feet, ground, topFaceGround, tintCovers, originalCameraMask);
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
      farmhouseFloorMeshes: farmhouseFloorCount,
      interiorFloorMeshes: interiorFloorCount,
      topFaceGroundMeshes: topFaceGroundCount,
      waterReplayMeshes: waterMeshCount,
      translucentCoverMeshes: tintCoverRegistry.all.size,
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
      const message = `[held-xray] enabled=${state.enabled} held=${state.heldMeshes} ground=${state.groundMeshes} (grass=${state.grassMeshes} road=${state.roadMeshes} terrain=${state.terrainMeshes} interior=${state.interiorFloorMeshes} farmhouse=${state.farmhouseFloorMeshes}) footWater=${state.waterOccludedMeshes}/${state.waterReplayMeshes}/${state.waterReplays} stencil=${state.stencilBits} stencilSkips=${state.missingStencilFootReplaySkips} base=${state.baseWorldRenders} overlay=${state.selectiveOverlays} depth=${state.nonGroundDepthReplays}/${state.groundDepthRestores} repairs=${state.invariantRepairs} scissor=${state.scissoredReplays}/${state.fullscreenReplays} coverage=${state.lastReplayScissorCoverage}`;
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
        topFacesGround: isTopFacesGroundSurface(object),
        waterSurface: isWaterSurface(object),
      tintedCover: isTintCover(object),
        waterOccluded: object?.userData?.hobunjiWaterOccludedBySurface === true,
      };
    },
  };
})();
