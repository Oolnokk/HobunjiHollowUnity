(() => {
  'use strict';

  if (window.NorthernCliffsPlateauBackdrop) return;

  const NORTH_ID = 'map_northern_cliffs'; // Limits the new distant mesa to the Northern Cliffs wilderness zone.
  const GROUP_NAME = 'NorthernCliffsDistantPlateau'; // Stable scene identity for duplicate checks and mobile diagnostics.
  const BORDER_WIDTH = 18; // Matches the wilderness scenery skirt built by border-terrain.js.
  const BORDER_CLEARANCE = 6; // Places the entire plateau footprint beyond that skirt, not just beyond playable tiles.
  const HEIGHT_RATIO = 0.7; // The mesa top is seventy percent of the highest Western Slope mountain world-space Y.
  const LONG_EDGE_SEGMENTS = 20; // Keeps a kilometer-wide silhouette intentionally faceted instead of tessellating it densely.
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
        geometry.dispose?.(); // Only the temporary stone geometry is owned here; grass may share source attributes.
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
    const depth = Math.max(100, mapRows * 0.85); // A huge but finite backdrop footprint; never affects playable world geometry.
    const frontZ = -BORDER_WIDTH - BORDER_CLEARANCE; // All plateau vertices remain north of the entire scenic border.
    const topY = mountain.highestY * HEIGHT_RATIO;
    if (!(topY > 0)) throw new Error('Western Slope reference peak must be above world-space zero');
    return { mapCols, mapRows, mountain, width, depth, frontZ, topY, baseY: 0, centerX: mapCols * 0.5 };
  }

  function perimeter(layout, heightFraction, inset) {
    const points = []; // Paired long north/south rim edges form one uninterrupted mesa, including its two short ends.
    const edgeCount = LONG_EDGE_SEGMENTS;
    for (let side = 0; side < 2; side++) for (let i = 0; i <= edgeCount; i++) {
      const u = side ? 1 - i / edgeCount : i / edgeCount;
      const x = layout.centerX + (u - 0.5) * layout.width * (1 - inset);
      const wave = (0.5 + 0.5 * Math.sin(u * Math.PI * 17 + side * 1.8)) * 0.014;
      const shallow = side === 0 ? (0.015 + wave) : (0.985 - wave);
      const z = layout.frontZ - layout.depth * (shallow * (1 - inset) + inset * 0.5);
      points.push([x, layout.baseY + layout.topY * heightFraction, z]);
    }
    return points;
  }

  function makeMeshGeometry(T, layout) {
    const base = perimeter(layout, 0, 0), middle = perimeter(layout, 0.43, 0.045), top = perimeter(layout, 1, 0.13);
    const positions = [], uvs = []; // Flat-shaded, unindexed triangles: no smoothed mountain-wall normals or subdivided terrain.
    const addTriangle = (a, b, c, roof = false) => {
      for (const p of [a, b, c]) {
        positions.push(p[0], p[1], p[2]);
        uvs.push(p[0] / 6, (roof ? p[2] : p[1]) / 6);
      }
    };
    const bridge = (lower, upper) => {
      for (let i = 0; i < lower.length; i++) {
        const next = (i + 1) % lower.length;
        addTriangle(lower[i], lower[next], upper[next]);
        addTriangle(lower[i], upper[next], upper[i]);
      }
    };
    bridge(base, middle);
    bridge(middle, top);
    const center = [layout.centerX, layout.topY, layout.frontZ - layout.depth * 0.5];
    for (let i = 0; i < top.length; i++) addTriangle(center, top[i], top[(i + 1) % top.length], true);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals?.();
    return geometry;
  }

  function createMaterial(T) {
    const source = window.OreRockTextures?.materialFor?.(T, 'stone', {});
    const material = source?.clone?.() || new T.MeshStandardMaterial({
      map: source?.map || null, color: source?.color || 0x635544, roughness: source?.roughness ?? 0.94,
    });
    material.userData = Object.assign({}, material.userData, { northernCliffsDistantPlateau: true, visualOnly: true });
    delete material.userData.sharedOreRockMaterial;
    material.side = T.DoubleSide;
    material.depthTest = true;
    material.depthWrite = true;
    material.fog = false;
    window.WesternSlopeMountainBackdrops?.keepInFrontOfSky?.(material); // Shares the proven mountain depth shader instead of copying it.
    return material;
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
    record.mesh.material?.dispose?.();
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
      const geometry = makeMeshGeometry(T, layout), material = createMaterial(T);
      const mesh = new T.Mesh(geometry, material), root = new T.Group();
      root.name = GROUP_NAME;
      root.userData = {
        backgroundScenery: true, skipOcclusionFade: true, northernCliffsDistantPlateau: true,
        visualOnly: true, nonTraversable: true, mapId,
      };
      mesh.name = GROUP_NAME + '_Stone';
      mesh.frustumCulled = false; // Distant scenery uses the same beyond-camera depth treatment as Western Slope.
      mesh.renderOrder = -102;
      mesh.raycast = ignoreRaycast;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData = { backgroundScenery: true, skipOcclusionFade: true, visualOnly: true, nonTraversable: true };
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
        triangleCount: geometry.getAttribute('position').count / 3,
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
    constants: Object.freeze({ NORTH_ID, GROUP_NAME, BORDER_WIDTH, BORDER_CLEARANCE, HEIGHT_RATIO, LONG_EDGE_SEGMENTS }),
  });
  window.__northernCliffsPlateauBackdropDebug = debug; // Allows a mobile player to inspect height, draw count and map clearance via existing debug tooling.
  deferred('BorderTerrain', patchBorder);
  deferred('WildernessChunks', patchChunks);
})();
