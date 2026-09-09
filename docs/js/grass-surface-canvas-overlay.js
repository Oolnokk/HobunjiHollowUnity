(() => {
  'use strict';

  const THREE = window.THREE; // Used for source-triangle extraction, combined overlay geometry, texture processing, and the overlay material.
  const mapper = window.HobunjiSurfaceStretchUV; // Used to reuse the farm-cliff irregular perimeter-to-square UV solver on connected grass faces.
  if (!THREE?.BufferGeometry || !THREE?.Mesh || !mapper?.mapGeometry || window.GrassSurfaceCanvasOverlay?.installed) return;

  const TERRAIN_ID_LAYER = 3; // Used to restrict MeshBasicMaterial detection to actual terrain meshes instead of unrelated unlit scene objects.
  const GRASS_FACE_MIN_UP_DOT = 0.15; // Used to include sloped grass while excluding vertical slab/skirt faces that should not receive the top-surface overlay.
  const OVERLAY_TEXTURE_URL = 'assets/textures/canvas.png'; // Used by the processed second grass-surface texture layer.
  const OVERLAY_OPACITY = 0.20; // Used for every non-black source pixel in canvas.png.
  const PURE_BLACK_MAX_CHANNEL = 0; // Used to preserve source alpha only for literally pure-black PNG pixels.
  const OVERLAY_Y_OFFSET = 0.004; // Used to keep the fitted overlay just above the real grass without changing terrain collision or introducing visible hovering.
  const REBUILD_DEBOUNCE_MS = 32; // Used to batch synchronous terrain construction/edit bursts into one connected-surface rebuild.
  const DEBUG_HISTORY_LIMIT = 12; // Used to bound the mobile-visible rebuild history.

  const sceneStates = new WeakMap(); // Used to track each scene's current overlay mesh, pending timer, and dirty reason without keeping dead scenes alive.
  const debugState = {
    rebuilds: 0,
    sourceMeshes: 0,
    sourceTriangles: 0,
    fittedSurfaces: 0,
    mapperFallbacks: 0,
    skippedVerticalTriangles: 0,
    last: null,
    history: [],
  }; // Used by snapshot() and the in-game render debug log.

  const overlayMaterial = createOverlayMaterial(); // Used by every scene's one combined grass canvas overlay draw call.

  function debugLog(message, level = 'info') {
    const text = `[grass-canvas-overlay] ${message}`; // Used as the common mobile/console diagnostic prefix.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function currentGrassTint() {
    try {
      const tint = window.CalendarSystem?.currentSeason?.()?.grassColor; // Used so the second texture follows the same seasonal grass shade as the base grass material.
      if (tint?.isColor) return tint;
    } catch (_) {}
    return null;
  }

  function textureSourceUrl(texture) {
    const image = texture?.image || texture?.source?.data; // Used to distinguish the authored grass surface texture from unrelated MeshBasicMaterial textures when available.
    return String(
      texture?.userData?.hobunjiSourceUrl ||
      image?.__hobunjiSourceUrl ||
      image?.currentSrc ||
      image?.src ||
      ''
    ).replace(/\\/g, '/').toLowerCase();
  }

  function looksLikeGrassMaterial(material) {
    if (!material?.isMeshBasicMaterial || material.transparent) return false;
    const src = textureSourceUrl(material.map); // Used as the strongest positive grass-surface signal after terrain-materials.json has loaded.
    if (src && /(^|\/)assets\/textures\/wavy_surface\.png(?:[?#].*)?$/.test(src)) return true;
    // Grass is deliberately the terrain system's only unlit MeshBasicMaterial
    // class. Layer-3 filtering at the mesh level keeps this fallback from
    // classifying ordinary unlit props/UI as grass while the texture is still
    // loading or when a map intentionally uses the untextured grass fallback.
    return true;
  }

  function hasTerrainIdLayer(mesh) {
    const mask = Number(mesh?.layers?.mask ?? 0) >>> 0; // Used to recognize meshes passed through game.js's _markTerrainEdgeId().
    return !!(mask & ((1 << TERRAIN_ID_LAYER) >>> 0));
  }

  function materialAt(mesh, materialIndex) {
    return Array.isArray(mesh?.material) ? mesh.material[materialIndex] : mesh?.material; // Used when mixed grass/rock plateau geometry stores grass in only one material slot.
  }

  function materialIndexForElement(geometry, elementOffset) {
    const groups = geometry?.groups || []; // Used to select the correct material slot for each indexed/non-indexed triangle.
    if (!groups.length) return 0;
    for (const group of groups) {
      if (elementOffset >= group.start && elementOffset < group.start + group.count) return Number(group.materialIndex || 0);
    }
    return 0;
  }

  function worldVisible(object) {
    for (let node = object; node; node = node.parent) if (node.visible === false) return false; // Used to ignore hidden fallback terrain such as TownPathFallback.
    return true;
  }

  function eligibleGrassMesh(mesh) {
    if (!mesh?.isMesh || mesh.userData?.grassCanvasOverlay || !hasTerrainIdLayer(mesh) || !worldVisible(mesh)) return false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; // Used to support both ordinary one-material grass meshes and mixed plateau material arrays.
    return materials.some(looksLikeGrassMaterial);
  }

  function containsEligibleGrass(root) {
    let found = false; // Used by Object3D.add/remove hooks to avoid rebuilding after unrelated NPC/FX scene changes.
    if (!root) return found;
    if (eligibleGrassMesh(root)) return true;
    root.traverse?.(child => {
      if (!found && child !== root && eligibleGrassMesh(child)) found = true;
    });
    return found;
  }

  function owningScene(object) {
    for (let node = object; node; node = node.parent) if (node.isScene) return node; // Used to associate nested wilderness chunk/group mutations with the correct scene overlay.
    return null;
  }

  function sourceIndexAt(indexAttribute, element) {
    return indexAttribute ? Number(indexAttribute.getX(element)) : element; // Used to read indexed and non-indexed source geometry through one triangle loop.
  }

  function collectGrassTriangles(scene) {
    const positions = []; // Used as the non-indexed world-space triangle buffer fed to HobunjiSurfaceStretchUV.
    const sourceMaterials = []; // Used to recover the current grass tint if the calendar bridge is unavailable.
    let sourceMeshCount = 0; // Used by diagnostics to show how many actual rendered grass meshes contributed.
    let sourceTriangleCount = 0; // Used by diagnostics and the overlay draw-call summary.
    let skippedVerticalTriangles = 0; // Used to verify that grass slab skirts/vertical faces are excluded.

    scene.updateMatrixWorld?.(true);
    const a = new THREE.Vector3(); // Used as triangle corner A in world space.
    const b = new THREE.Vector3(); // Used as triangle corner B in world space.
    const c = new THREE.Vector3(); // Used as triangle corner C in world space.
    const ab = new THREE.Vector3(); // Used to calculate the world-space face normal.
    const ac = new THREE.Vector3(); // Used alongside ab for the same face-normal calculation.
    const normal = new THREE.Vector3(); // Used to classify upward grass surface faces versus vertical skirts.

    scene.traverse?.(mesh => {
      if (!eligibleGrassMesh(mesh)) return;
      const geometry = mesh.geometry; // Used as this source mesh's final rendered terrain topology.
      const position = geometry?.getAttribute?.('position') || geometry?.attributes?.position; // Used to read local triangle corners.
      if (!position) return;
      const index = geometry.index || null; // Used to preserve authored/generated triangle topology.
      const elementCount = Math.floor(Number(index?.count ?? position.count) / 3) * 3; // Used as the complete triangle-element span.
      if (!elementCount) return;

      let contributed = false; // Used so sourceMeshCount only includes meshes that actually yielded upward grass triangles.
      for (let element = 0; element < elementCount; element += 3) {
        const materialIndex = materialIndexForElement(geometry, element); // Used to reject rock/cliff slots on mixed-material terrain.
        const material = materialAt(mesh, materialIndex); // Used to confirm this triangle's actual rendered material is grass.
        if (!looksLikeGrassMaterial(material)) continue;

        const ia = sourceIndexAt(index, element); // Used as triangle corner A's source vertex index.
        const ib = sourceIndexAt(index, element + 1); // Used as triangle corner B's source vertex index.
        const ic = sourceIndexAt(index, element + 2); // Used as triangle corner C's source vertex index.
        a.set(position.getX(ia), position.getY(ia), position.getZ(ia)).applyMatrix4(mesh.matrixWorld);
        b.set(position.getX(ib), position.getY(ib), position.getZ(ib)).applyMatrix4(mesh.matrixWorld);
        c.set(position.getX(ic), position.getY(ic), position.getZ(ic)).applyMatrix4(mesh.matrixWorld);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        normal.crossVectors(ab, ac);
        const lengthSq = normal.lengthSq(); // Used to discard degenerate triangles before normalizing.
        if (lengthSq <= 1e-12) continue;
        normal.multiplyScalar(1 / Math.sqrt(lengthSq));
        if (normal.y < GRASS_FACE_MIN_UP_DOT) {
          skippedVerticalTriangles++;
          continue;
        }

        positions.push(
          a.x, a.y, a.z,
          b.x, b.y, b.z,
          c.x, c.y, c.z,
        );
        sourceTriangleCount++;
        contributed = true;
        if (material?.color?.isColor && !sourceMaterials.includes(material)) sourceMaterials.push(material);
      }
      if (contributed) sourceMeshCount++;
    });

    return { positions, sourceMaterials, sourceMeshCount, sourceTriangleCount, skippedVerticalTriangles };
  }

  function buildConnectedOverlayGeometry(scene) {
    const source = collectGrassTriangles(scene); // Used as the literal rendered grass-face union for this scene.
    if (!source.sourceTriangleCount) return { geometry: null, ...source, report: null };

    const combined = new THREE.BufferGeometry(); // Used to let separate farm tiles/wilderness chunks share one topology solve.
    combined.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
    combined.computeVertexNormals();

    let mapped = mapper.mapGeometry(combined, { angleToleranceDeg: Number(mapper.settings?.angleToleranceDeg) || 24 }); // Used to run the exact same irregular-boundary fit as farm cliffs.
    if (!mapped?.getAttribute?.('position') || !mapped?.getAttribute?.('uv')) {
      debugLog(`${scene.name || '(scene)'}: shared surface mapper returned no usable UVs; grass canvas overlay skipped.`, 'warn');
      if (mapped && mapped !== combined) mapped.dispose?.();
      combined.dispose?.();
      return { geometry: null, ...source, report: null };
    }
    if (mapped !== combined) combined.dispose?.();

    const position = mapped.getAttribute('position'); // Used to lift only the visual overlay a few millimeters above the source grass.
    for (let i = 0; i < position.count; i++) position.setY(i, position.getY(i) + OVERLAY_Y_OFFSET);
    position.needsUpdate = true;
    mapped.computeVertexNormals();
    mapped.computeBoundingBox?.();
    mapped.computeBoundingSphere?.();
    mapped.userData = Object.assign({}, mapped.userData || {}, {
      grassCanvasOverlay: true,
      sourceMeshCount: source.sourceMeshCount,
      sourceTriangleCount: source.sourceTriangleCount,
    });

    return { geometry: mapped, ...source, report: mapped.userData?.hobunjiSurfaceStretch || null };
  }

  function processedOverlayCanvas(image) {
    const width = Math.max(1, Number(image?.naturalWidth || image?.width || 1)); // Used to preserve canvas.png's authored horizontal resolution.
    const height = Math.max(1, Number(image?.naturalHeight || image?.height || 1)); // Used to preserve canvas.png's authored vertical resolution.
    const canvas = document.createElement('canvas'); // Used to bake per-pixel alpha once instead of running a custom fragment shader every frame.
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Used to read/modify the source alpha channel exactly once at load.
    if (!ctx) return null;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height); // Used to reduce non-black alpha to 0.20 while leaving pure-black source alpha untouched.
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const pureBlack = Math.max(data[i], data[i + 1], data[i + 2]) <= PURE_BLACK_MAX_CHANNEL; // Used as the exact authored-black preservation test.
      if (!pureBlack) data[i + 3] = Math.round(data[i + 3] * OVERLAY_OPACITY);
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  function createOverlayMaterial() {
    const transparentPixel = new Uint8Array([255, 255, 255, 0]); // Used so the overlay is invisible until canvas.png finishes decoding.
    const fallbackTexture = new THREE.DataTexture(transparentPixel, 1, 1, THREE.RGBAFormat); // Used as the synchronous safe map for the overlay material.
    fallbackTexture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: fallbackTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.FrontSide,
      fog: true,
    }); // Used by every fitted grass canvas overlay mesh.
    material.name = 'grass_surface_canvas_overlay_material';
    material.userData = Object.assign({}, material.userData || {}, {
      grassCanvasOverlay: true,
      textureUrl: OVERLAY_TEXTURE_URL,
      nonBlackOpacity: OVERLAY_OPACITY,
      pureBlackOpacity: 'source-alpha',
    });

    new THREE.TextureLoader().load(OVERLAY_TEXTURE_URL, texture => {
      const canvas = processedOverlayCanvas(texture.image); // Used to encode the black-vs-nonblack opacity rule directly into the texture alpha.
      if (!canvas) {
        debugLog(`could not process ${OVERLAY_TEXTURE_URL}; overlay remains transparent.`, 'warn');
        return;
      }
      const processedTexture = new THREE.CanvasTexture(canvas); // Used as the final once-stretched overlay sampler.
      processedTexture.wrapS = processedTexture.wrapT = THREE.ClampToEdgeWrapping;
      processedTexture.colorSpace = THREE.SRGBColorSpace;
      processedTexture.needsUpdate = true;
      material.map = processedTexture;
      material.needsUpdate = true;
      fallbackTexture.dispose();
      texture.dispose?.();
      debugLog(`${OVERLAY_TEXTURE_URL} ready: non-black alpha=${OVERLAY_OPACITY.toFixed(2)}, pure-black source alpha preserved.`);
    }, undefined, error => {
      debugLog(`texture load failed (${OVERLAY_TEXTURE_URL}): ${error?.message || error}`, 'warn');
    });
    return material;
  }

  function stateFor(scene) {
    let state = sceneStates.get(scene); // Used to reuse one overlay mesh/timer slot for each scene across terrain rebuilds.
    if (!state) {
      state = { overlay: null, timer: null, dirtyReason: 'initial', lastSourceColor: new THREE.Color(0x2f7021) };
      sceneStates.set(scene, state);
    }
    return state;
  }

  function removeExistingOverlay(scene, state) {
    if (!state?.overlay) return;
    scene.remove(state.overlay);
    state.overlay.geometry?.dispose?.();
    state.overlay = null;
  }

  function rebuildScene(scene, reason = 'terrain changed') {
    if (!scene?.isScene) return null;
    const state = stateFor(scene); // Used to replace the previous combined overlay atomically after the new geometry is ready.
    state.timer = null;
    const built = buildConnectedOverlayGeometry(scene); // Used to regenerate exact connected grass islands from the scene's current rendered terrain.
    removeExistingOverlay(scene, state);

    if (!built.geometry) {
      debugState.last = {
        scene: scene.name || '(scene)', reason,
        sourceMeshes: built.sourceMeshCount,
        sourceTriangles: built.sourceTriangleCount,
        fittedSurfaces: 0,
        fallbacks: 0,
      };
      return null;
    }

    const firstColor = built.sourceMaterials.find(material => material?.color?.isColor)?.color; // Used as a fallback tint before/without CalendarSystem season data.
    if (firstColor?.isColor) state.lastSourceColor.copy(firstColor);
    const overlay = new THREE.Mesh(built.geometry, overlayMaterial); // Used as one additional draw call for every connected grass surface in this scene.
    overlay.name = 'GrassSurfaceCanvasOverlay';
    overlay.renderOrder = 2;
    overlay.frustumCulled = true;
    overlay.castShadow = false;
    overlay.receiveShadow = false;
    overlay.userData.grassCanvasOverlay = true;
    overlay.raycast = () => {}; // Used so the purely visual layer never steals ground/item/NPC interaction ray hits.
    overlay.onBeforeRender = () => {
      const tint = currentGrassTint(); // Used to follow seasonal grass color changes without rebuilding geometry.
      if (tint?.isColor) overlayMaterial.color.copy(tint);
      else overlayMaterial.color.copy(state.lastSourceColor);
    };
    state.overlay = overlay;
    scene.add(overlay);

    const fittedSurfaces = Number(built.report?.patchCount || 0); // Used by diagnostics as the number of connected surface islands that each consume one complete canvas.png square.
    const fallbacks = Number(built.report?.fallbackCount || 0); // Used to surface malformed perimeter fallbacks in the mobile debug log.
    debugState.rebuilds++;
    debugState.sourceMeshes = built.sourceMeshCount;
    debugState.sourceTriangles = built.sourceTriangleCount;
    debugState.fittedSurfaces = fittedSurfaces;
    debugState.mapperFallbacks = fallbacks;
    debugState.skippedVerticalTriangles = built.skippedVerticalTriangles;
    debugState.last = {
      scene: scene.name || '(scene)', reason,
      sourceMeshes: built.sourceMeshCount,
      sourceTriangles: built.sourceTriangleCount,
      fittedSurfaces,
      fallbacks,
      skippedVerticalTriangles: built.skippedVerticalTriangles,
    };
    debugState.history.push(debugState.last);
    while (debugState.history.length > DEBUG_HISTORY_LIMIT) debugState.history.shift();
    debugLog(`${scene.name || '(scene)'}: ${built.sourceMeshCount} grass mesh(es), ${built.sourceTriangleCount} upward triangle(s) -> ${fittedSurfaces || '?'} fitted connected surface(s), ${fallbacks} fallback(s).`);
    return overlay;
  }

  function scheduleRebuild(scene, reason) {
    if (!scene?.isScene) return;
    const state = stateFor(scene); // Used to collapse many per-tile adds/removes into one rebuild after construction settles.
    state.dirtyReason = reason || state.dirtyReason || 'terrain changed';
    if (state.timer != null) clearTimeout(state.timer);
    state.timer = setTimeout(() => rebuildScene(scene, state.dirtyReason), REBUILD_DEBOUNCE_MS);
  }

  const objectProto = THREE.Object3D?.prototype; // Used to observe terrain additions/removals without changing every farm/town/wilderness builder individually.
  if (objectProto && !objectProto.__hobunjiGrassCanvasOverlayWrapped) {
    const previousAdd = objectProto.add; // Used to preserve every previously installed Object3D.add wrapper, including natural-surface runtime repairs.
    const previousRemove = objectProto.remove; // Used to preserve normal scene graph removal semantics while detecting disappearing grass terrain.

    objectProto.add = function (...objects) {
      const result = previousAdd.apply(this, objects);
      for (const object of objects) {
        queueMicrotask(() => {
          if (!containsEligibleGrass(object)) return; // _markTerrainEdgeId runs immediately after many add() calls, so inspect after the current call stack finishes.
          const scene = owningScene(object) || owningScene(this); // Used to find the destination scene for nested chunk/group additions.
          if (scene) scheduleRebuild(scene, 'grass terrain added');
        });
      }
      return result;
    };

    objectProto.remove = function (...objects) {
      const affectedScenes = []; // Used to remember owning scenes before parent links are severed by the real remove().
      for (const object of objects) {
        if (!containsEligibleGrass(object)) continue;
        const scene = owningScene(object) || owningScene(this);
        if (scene && !affectedScenes.includes(scene)) affectedScenes.push(scene);
      }
      const result = previousRemove.apply(this, objects);
      for (const scene of affectedScenes) scheduleRebuild(scene, 'grass terrain removed');
      return result;
    };

    objectProto.__hobunjiGrassCanvasOverlayWrapped = true;
  }

  window.GrassSurfaceCanvasOverlay = {
    installed: true,
    settings: {
      texture: OVERLAY_TEXTURE_URL,
      opacity: OVERLAY_OPACITY,
      pureBlackOpacity: 'source-alpha',
      minUpDot: GRASS_FACE_MIN_UP_DOT,
      yOffset: OVERLAY_Y_OFFSET,
      rebuildDebounceMs: REBUILD_DEBOUNCE_MS,
    },
    rebuildScene,
    scheduleRebuild,
    snapshot() {
      return {
        ...debugState,
        history: debugState.history.slice(),
      };
    },
  };

  debugLog(`installed: ${OVERLAY_TEXTURE_URL} fits once across each connected rendered grass surface using HobunjiSurfaceStretchUV; non-black opacity=${OVERLAY_OPACITY.toFixed(2)}.`);
})();
