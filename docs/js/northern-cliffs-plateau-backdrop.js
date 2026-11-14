(() => {
  'use strict';

  if (window.NorthernCliffsPlateauBackdrop) return;

  const NORTH_ID = 'map_northern_cliffs'; // Limits the new distant mesa to the Northern Cliffs wilderness zone.
  const GROUP_NAME = 'NorthernCliffsDistantPlateau'; // Stable scene identity for duplicate checks and mobile diagnostics.
  const BORDER_WIDTH = 18; // Matches the wilderness scenery skirt built by border-terrain.js.
  const BORDER_CLEARANCE = 6; // Places the entire plateau footprint beyond that skirt, not just beyond playable tiles.
  const HEIGHT_RATIO = 0.7; // The mesa top is seventy percent of the highest Western Slope mountain world-space Y.
  const PLATEAU_ROCK_SEED_OFFSET = 509; // Selects one stable loose-rock mound distinct from the eight Western Slope mountain rocks.
  const TOP_FLATTEN_START = 0.70; // The rounded upper thirty percent of the scattered-rock source becomes a level plateau crown.
  const ROCK_SHOULDER_RATIO = 0.84; // Keeps the lower faceted boulder shoulders visible below the deliberately level cap.
  const ROCKS_PER_LAYER = 8; // Matches the Western Slope's eight independently varied rocks per mountain layer.
  const ROCK_SEED_BASE = 1731; // Reproduces the exact procedural source rocks used by the Western Slope backdrop.
  const ignoreRaycast = () => {}; // Background scenery cannot intercept pointer, reticle, or furniture interactions.
  const patchedBorders = new WeakSet(); // Avoids wrapping a BorderTerrain API more than once.
  const patchedChunks = new WeakSet(); // Avoids wrapping a WildernessChunks API more than once.
  const active = new Map(); // Tracks the one owned mesh/material set per Northern Cliffs zone lifecycle.
  const diagnostics = { builds: 0, disposals: 0, failures: 0, lastError: null, lastLayout: null }; // Mobile-visible checks for height, footprint, and resource ownership.

  function finiteSize(n) { const value = Number(n); return Number.isFinite(value) && value > 0 ? value : 200; }

  function mountainMetrics(cols, rows) {
    const backdrops = window.WesternSlopeMountainBackdrops;
    const rockBuilder = window.TerrainGeometry?.buildRockTileGeo;
    if (!backdrops?.resolveLayoutFromSizes || typeof rockBuilder !== 'function') {
      throw new Error('Western Slope mountain geometry is not ready');
    }
    const constants = backdrops.constants || {}; // Uses the mountain runtime's geometry dimensions rather than a guessed height.
    const rocksPerLayer = constants.ROCKS_PER_LAYER || ROCKS_PER_LAYER;
    const rockSeedBase = constants.ROCK_SEED_BASE || ROCK_SEED_BASE;
    const rockHeightFraction = constants.ROCK_HEIGHT_FRACTION || 0.72;
    const layers = backdrops.resolveLayoutFromSizes(null, cols, rows).filter(layer => layer.visible);
    if (!layers.length) throw new Error('No visible Western Slope mountains to measure');

    let highestY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const layer of layers) {
      const cellWidth = layer.width / rocksPerLayer;
      const heightScale = layer.height / rockHeightFraction;
      const vertices = []; // One-off local rock positions used to measure the full authored ridge transform exactly.
      let localMinZ = Infinity, localMaxZ = -Infinity;
      for (let i = 0; i < rocksPerLayer; i++) {
        const col = rockSeedBase + layer.index * 101 + i * 17;
        const row = rockSeedBase * 3 + layer.index * 67 + i * 29;
        const built = rockBuilder.call(window.TerrainGeometry, col, row);
        const geometry = built?.stoneGeo;
        const positions = geometry?.getAttribute?.('position');
        if (!positions) throw new Error('Western Slope mountain source geometry is missing');
        const index = geometry.index, count = index ? index.count : positions.count;
        const variation = (Math.sin((i + 1) * (layer.layer + 2) * 1.73) + 1) * 0.5;
        const stagger = ((i * 7 + layer.layer * 3) % 5 - 2) * cellWidth * 0.035;
        const heightJitter = ((i * 5 + layer.layer) % 3 - 1) * layer.height * 0.008;
        const angle = ((i * 11 + layer.layer * 7) % 7 - 3) * 0.055;
        const ca = Math.cos(angle), sa = Math.sin(angle);
        const sx = cellWidth * (0.74 + variation * 0.12);
        const sy = heightScale * (0.84 + variation * 0.24);
        const sz = cellWidth * (1.08 + variation * 0.04);
        const offsetY = -layer.height * 0.5 + heightJitter;
        const offsetZ = -layer.width * 0.5 + cellWidth * (i + 0.5);
        for (let j = 0; j < count; j++) {
          const at = index ? (index.getX ? index.getX(j) : index.array[j]) : j;
          const x = positions.getX(at) * sx, y = positions.getY(at) * sy;
          const z = positions.getZ(at) * sz;
          const localX = stagger + ca * x + sa * z;
          const localY = offsetY + y;
          const localZ = offsetZ - sa * x + ca * z;
          vertices.push(localX, localY, localZ);
          localMinZ = Math.min(localMinZ, localZ);
          localMaxZ = Math.max(localMaxZ, localZ);
        }
        geometry.dispose?.(); // The measured mountain source is temporary; no GPU geometry may survive this bounds pass.
        built?.grassGeo?.dispose?.(); // The loose-rock builder also allocates an unused grass geometry sharing the source attributes.
      }
      const depth = Math.max(1e-5, localMaxZ - localMinZ);
      const stretchZ = layer.targetLength / depth * layer.scale[2];
      const [rx, ry, rz] = layer.rotationDeg.map(deg => deg * Math.PI / 180);
      const cx = Math.cos(rx), sinX = Math.sin(rx);
      const cy = Math.cos(ry), sinY = Math.sin(ry);
      const cz = Math.cos(rz), sinZ = Math.sin(rz);
      const positionY = layer.position[1] + (layer.scale[1] - 1) * layer.height * 0.5;
      for (let j = 0; j < vertices.length; j += 3) {
        const x = vertices[j] * layer.scale[0], y = vertices[j + 1] * layer.scale[1];
        const z = vertices[j + 2] * stretchZ;
        const zx = cz * x - sinZ * y, zy = sinZ * x + cz * y;
        const yz = -sinY * zx + cy * z;
        const worldY = positionY + cx * zy - sinX * yz;
        const worldZ = layer.position[2] + sinX * zy + cx * yz;
        highestY = Math.max(highestY, worldY);
        minZ = Math.min(minZ, worldZ);
        maxZ = Math.max(maxZ, worldZ);
      }
    }
    if (!Number.isFinite(highestY) || !(maxZ > minZ)) throw new Error('Western Slope mountain world bounds are invalid');
    return { highestY, width: maxZ - minZ, westernZMin: minZ, westernZMax: maxZ };
  }

  function resolveLayout(cols, rows) {
    const mapCols = finiteSize(cols), mapRows = finiteSize(rows);
    const mountain = mountainMetrics(mapCols, mapRows);
    const width = mountain.width; // The single mesa spans the complete visible mountain chain, not just one of its rows.
    const depth = Math.max(300, mountain.width * 0.62, mapRows * 2.6); // Makes this one background rock a gigantic landmass with a deep footprint, not a thin billboard.
    const frontZ = -BORDER_WIDTH - BORDER_CLEARANCE; // All plateau vertices remain north of the entire scenic border.
    const topY = mountain.highestY * HEIGHT_RATIO;
    if (!(topY > 0)) throw new Error('Western Slope reference peak must be above world-space zero');
    return { mapCols, mapRows, mountain, width, depth, frontZ, topY, baseY: 0, centerX: mapCols * 0.5 };
  }

  function makeMeshGeometry(layout) {
    const rockBuilder = window.TerrainGeometry?.buildRockTileGeo; // The same deterministic low-poly rock/mini-plateau geometry used for loose rocks in the playable world.
    if (typeof rockBuilder !== 'function') throw new Error('Loose-rock terrain geometry is not ready');
    const built = rockBuilder.call(window.TerrainGeometry, ROCK_SEED_BASE + PLATEAU_ROCK_SEED_OFFSET, ROCK_SEED_BASE * 3 + 71); // One independent source mound, reused as a single enormous backdrop rock.
    const geometry = built?.stoneGeo?.toNonIndexed?.() || built?.stoneGeo; // Discard unused full-tile vertices; only drawn stone triangles set the giant rock's footprint and cliff silhouette.
    if (geometry !== built?.stoneGeo) built?.stoneGeo?.dispose?.(); // The original indexed geometry still contains unused grass-grid corners.
    built?.grassGeo?.dispose?.(); // Loose-rock grass is not part of this pure-stone distant landmark.
    const pos = geometry?.getAttribute?.('position'); // Used to stretch the source rock in world space before the farm's surface detector measures its actual face sizes.
    if (!pos?.count) throw new Error('Loose-rock stone geometry has no positions');
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox; // Used to normalize the source stone footprint so the complete boulder matches the requested enormous width/depth.
    const spanX = bounds.max.x - bounds.min.x, spanZ = bounds.max.z - bounds.min.z; // These normalize the selected low-poly rock rather than assuming the whole original tile is stone.
    const maxRockY = bounds.max.y; // Used to identify and level the source rock's rounded/uneven upper crown.
    if (!(spanX > 0 && spanZ > 0 && maxRockY > 0)) {
      geometry.dispose();
      throw new Error('Loose-rock source bounds are invalid');
    }
    const capStartY = maxRockY * TOP_FLATTEN_START; // Raised vertices above this cut join one uninterrupted horizontal tabletop.
    let capVertices = 0; // Exposed in mobile diagnostics so the flattened crown can be checked without a desktop console.
    for (let i = 0; i < pos.count; i++) {
      const sourceY = Math.max(0, pos.getY(i)); // Removes centimeter-scale seam noise along the original rock base.
      const onCap = sourceY >= capStartY;
      if (onCap) capVertices++;
      const slopeFraction = Math.min(1, sourceY / capStartY); // Keeps low-poly cliff shoulders below the level cap.
      const worldY = onCap
        ? layout.topY
        : layout.topY * ROCK_SHOULDER_RATIO * Math.pow(slopeFraction, 1.35);
      const worldX = layout.centerX + ((pos.getX(i) - bounds.min.x) / spanX - 0.5) * layout.width;
      const worldZ = layout.frontZ - ((pos.getZ(i) - bounds.min.z) / spanZ) * layout.depth;
      pos.setXYZ(i, worldX, worldY, worldZ);
    }
    const capTolerance = Math.max(1e-4, layout.topY * 1e-6); // Float32 world-height tolerance for identifying genuinely flat top triangles.
    let capTriangles = 0; // Detects real horizontal plateau area, not just several duplicated peak vertices.
    for (let i = 0; i + 2 < pos.count; i += 3) {
      if ([i, i + 1, i + 2].every(vertex => Math.abs(pos.getY(vertex) - layout.topY) <= capTolerance)) capTriangles++;
    }
    if (capVertices < 3 || capTriangles < 1) {
      geometry.dispose();
      throw new Error('Loose-rock source did not produce an actual flat plateau surface');
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, capVertices, capTriangles, maxRockY }; // One rock owns every flat-top triangle and faceted cliff shoulder.
  }

  function disposeBackdropMaterials(materials) {
    const slots = Array.isArray(materials) ? materials : [materials]; // Tracks both ridge top and cliff-side slots while allowing a shared material clone.
    for (const material of new Set(slots)) {
      if (material?.userData?.northernCliffsDistantPlateau) material.dispose?.(); // Only backdrop-owned clones may be freed; the farm's shared rock material is never ours.
    }
  }

  function makeBackdropMaterials(materials, T) {
    const slots = Array.isArray(materials) ? materials : [materials]; // Keeps the ridge isolator's top/side grouping intact.
    const clones = new Map(); // Reuses one backdrop-owned clone where the top and cliff slots reference the same canonical farm material.
    try {
      for (const source of slots) {
        if (!source?.clone) throw new Error('Farm rock material could not be cloned');
        if (clones.has(source)) continue;
        const clone = source.clone(); // A unique depth-shader material is required without mutating the shared farm cliff shader.
        clones.set(source, clone);
        clone.userData = Object.assign({}, clone.userData, { northernCliffsDistantPlateau: true, visualOnly: true });
        clone.side = T.DoubleSide;
        clone.depthTest = true;
        clone.depthWrite = true;
        clone.fog = false;
        window.WesternSlopeMountainBackdrops?.keepInFrontOfSky?.(clone); // The same background depth treatment applies to both material slots.
      }
    } catch (error) {
      disposeBackdropMaterials([...clones.values()]); // A partial failed clone must never leak resources or dispose the source surface.
      throw error;
    }
    const owned = slots.map(source => clones.get(source)); // Preserves the original material slot count and order.
    return Array.isArray(materials) ? owned : owned[0];
  }

  function createStoneMesh(T, layout) {
    const shaped = makeMeshGeometry(layout); // Creates one giant version of the normal scattered boulder with a flat top.
    const sourceMaterial = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }); // A temporary carrier for the exact farm-rock material factory.
    const mesh = new T.Mesh(shaped.geometry, sourceMaterial); // Carries natural material and surface-island UV metadata into the existing renderer.
    try {
      const natural = window.NaturalSurfaceMaterials; // FarmCliffRockOutline uses this same API to apply the authored rock PNG and sprite-style tint.
      const mapper = window.HobunjiSurfaceStretchUV; // Detects connected face islands and stretches one full PNG per surface with protected edge bands.
      if (typeof natural?.naturalizeMesh !== 'function' || typeof mapper?.remapNaturalTerrainMesh !== 'function') {
        throw new Error('Farm cliff rock material or connected-surface mapper is not ready');
      }
      natural.naturalizeMesh(mesh, 'rocks');
      if (mesh.geometry !== shaped.geometry) shaped.geometry.dispose(); // Natural-surface wrappers can replace geometry to make independent UV seams.
      const beforeFinalUv = mesh.geometry; // Tracks the geometry returned by the farm material wrapper before the explicit giant-rock surface solve.
      const surfaceReport = mapper.remapNaturalTerrainMesh(mesh, 'northern-cliffs-giant-rock'); // Preserves the ridge isolator's cliff-only UV slot and its separate flat-top texture coordinates.
      if (mesh.geometry !== beforeFinalUv) beforeFinalUv.dispose(); // The old UV buffer is never needed again once the final mapper adopts its clone.
      if (!surfaceReport?.patchCount) throw new Error('Giant plateau rock has no detected texture surfaces');
      mesh.material = makeBackdropMaterials(mesh.material, T); // Preserves top/cliff material slots while applying the distant shader to owned clones only.
      mesh.userData = Object.assign({}, mesh.userData, {
        naturalSurface: 'rocks', backgroundScenery: true, skipOcclusionFade: true,
        visualOnly: true, nonTraversable: true, terrainJigsawIgnore: true,
        naturalSurfaceUvOwner: 'HobunjiSurfaceStretchUV',
      });
      window.FacetedNaturalSurfaceShellReduction?.suppressMesh?.(mesh, 'rocks'); // Farm's faceted cliffs use the PNG edge, not an inverted 3D outline shell.
      sourceMaterial.dispose(); // The temporary carrier was replaced with the farm's shared material; only the backdrop clone belongs to this root.
      return { mesh, surfaceReport, capVertices: shaped.capVertices, capTriangles: shaped.capTriangles, sourceRockHeight: shaped.maxRockY };
    } catch (error) {
      if (mesh.geometry !== shaped.geometry) mesh.geometry?.dispose?.();
      shaped.geometry.dispose();
      if (mesh.material !== sourceMaterial) disposeBackdropMaterials(mesh.material); // Shared natural-surface source materials remain owned by the global material cache.
      sourceMaterial.dispose();
      throw error;
    }
  }

  function detach(mapId = NORTH_ID) {
    const record = active.get(mapId);
    if (!record) return false;
    if (record.root?.parent) record.root.parent.remove(record.root);
    if (Array.isArray(record.scene?.items)) {
      const i = record.scene.items.indexOf(record.root);
      if (i !== -1) record.scene.items.splice(i, 1);
    }
    record.mesh.geometry?.dispose?.();
    disposeBackdropMaterials(record.mesh.material); // Array slots can share one owned material; dispose it only once.
    active.delete(mapId);
    diagnostics.disposals++;
    return true;
  }

  function attach(scene, cols, rows, mapId = NORTH_ID) {
    if (!scene || mapId !== NORTH_ID) return null;
    const existing = scene.getObjectByName?.(GROUP_NAME) || scene.children?.find?.(child => child?.name === GROUP_NAME);
    if (existing) return existing;
    const old = active.get(mapId);
    if (old) detach(mapId);
    try {
      const T = window.THREE, layout = resolveLayout(cols, rows);
      const rock = createStoneMesh(T, layout); // One giant flattened loose-rock mesh, already finished through the farm's material and surface-mapping path.
      const mesh = rock.mesh, root = new T.Group();
      root.name = GROUP_NAME;
      root.userData = {
        backgroundScenery: true, skipOcclusionFade: true, northernCliffsDistantPlateau: true,
        visualOnly: true, nonTraversable: true, mapId,
      };
      mesh.name = GROUP_NAME + '_Stone';
      mesh.frustumCulled = false; // The shared DistantSceneryViewCull performs screen-plane and depth-query culling without clipping the beyond-far-plane backdrop.
      mesh.renderOrder = -102;
      mesh.raycast = ignoreRaycast;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData = Object.assign({}, mesh.userData, { backgroundScenery: true, skipOcclusionFade: true, visualOnly: true, nonTraversable: true });
      root.add(mesh);
      scene.add(root);
      if (Array.isArray(scene.items) && !scene.items.includes(root)) scene.items.push(root);
      active.set(mapId, { scene, root, mesh });
      diagnostics.builds++;
      diagnostics.lastError = null;
      diagnostics.lastLayout = {
        width: layout.width, depth: layout.depth, baseFrontZ: layout.frontZ, baseBackZ: layout.frontZ - layout.depth,
        northernMapZMin: 0, outsideSceneryClearance: BORDER_CLEARANCE,
        topWorldY: layout.topY, referencePeakWorldY: layout.mountain.highestY,
        heightRatio: HEIGHT_RATIO, referenceMountainChainWidth: layout.mountain.width,
        triangleCount: (mesh.geometry.index?.count || mesh.geometry.getAttribute('position').count) / 3,
        sourceShape: 'TerrainGeometry.buildRockTileGeo:stoneGeo', flatCapVertices: rock.capVertices,
        flatCapTriangles: rock.capTriangles, // Mobile diagnostics verify a real continuous tabletop rather than a single high peak.
        flatCapStartFraction: TOP_FLATTEN_START, sourceRockHeight: rock.sourceRockHeight,
        materialPath: 'NaturalSurfaceMaterials:rocks', uvPath: 'HobunjiSurfaceStretchUV',
        detectedSurfaceIslands: rock.surfaceReport.patchCount, uvFallbackIslands: rock.surfaceReport.fallbackCount,
        cliffMaterialSlot: mesh.userData.naturalSurfaceCliffSlot ?? null, materialSlotCount: Array.isArray(mesh.material) ? mesh.material.length : 1,
      };
      return root;
    } catch (error) {
      diagnostics.failures++;
      diagnostics.lastError = String(error?.message || error);
      window.__farmLog?.('[northern-cliffs-plateau] ' + diagnostics.lastError, 'warn', 'world');
      return null;
    }
  }

  function patchBorder(api) {
    if (!api || patchedBorders.has(api) || typeof api.buildZoneBorderTerrain !== 'function') return api;
    const original = api.buildZoneBorderTerrain;
    api.buildZoneBorderTerrain = function (scene, cols, rows, mapId, ...rest) {
      const result = original.call(this, scene, cols, rows, mapId, ...rest);
      if (mapId === NORTH_ID) attach(scene, cols, rows, mapId);
      return result;
    };
    patchedBorders.add(api);
    return api;
  }

  function patchChunks(api) {
    if (!api || patchedChunks.has(api) || typeof api.destroyZone !== 'function') return api;
    const original = api.destroyZone;
    api.destroyZone = function (mapId, ...rest) {
      if (mapId === NORTH_ID) detach(mapId);
      return original.call(this, mapId, ...rest);
    };
    patchedChunks.add(api);
    return api;
  }

  function deferred(name, patcher) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor?.get && descriptor?.set) {
      const get = descriptor.get, set = descriptor.set;
      Object.defineProperty(window, name, {
        configurable: true, enumerable: descriptor.enumerable !== false,
        get() { return get.call(window); },
        set(value) { set.call(window, value); patcher(get.call(window)); },
      });
      patcher(get.call(window));
      return;
    }
    const existing = window[name];
    if (existing) { patcher(existing); return; }
    let pending = null;
    Object.defineProperty(window, name, {
      configurable: true, enumerable: true,
      get() { return pending; },
      set(value) { pending = patcher(value); },
    });
  }

  function debug() {
    const record = active.get(NORTH_ID);
    return {
      installed: true, mapId: NORTH_ID, groupName: GROUP_NAME, attached: !!record?.root?.parent,
      visualOnly: true, clearOfPlayableMap: (diagnostics.lastLayout?.baseFrontZ ?? 0) < -BORDER_WIDTH,
      ...diagnostics,
      lastLayout: diagnostics.lastLayout ? { ...diagnostics.lastLayout } : null,
    };
  }

  window.NorthernCliffsPlateauBackdrop = Object.freeze({
    installed: true, attach, detach, resolveLayout, getDebugState: debug,
    getActiveRoot: () => active.get(NORTH_ID)?.root || null,
    constants: Object.freeze({ NORTH_ID, GROUP_NAME, BORDER_WIDTH, BORDER_CLEARANCE, HEIGHT_RATIO, TOP_FLATTEN_START, ROCK_SHOULDER_RATIO }),
  });
  window.__northernCliffsPlateauBackdropDebug = debug; // Allows a mobile player to inspect height, draw count and map clearance via existing debug tooling.
  deferred('BorderTerrain', patchBorder);
  deferred('WildernessChunks', patchChunks);
})();
