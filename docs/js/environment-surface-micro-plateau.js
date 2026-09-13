(() => {
  'use strict';

  if (typeof window === 'undefined' || window.EnvironmentSurfaceMicroPlateau?.installed) return;

  const WESTERN_SLOPE_ID = 'map_western_slope';
  const PLATEAU_UNIT = 2.5;
  const SNOW_THICKNESS = 0.12;
  const TOP_CLEARANCE = 0.018;
  const EDGE_WIDTH = 0.075;
  const EDGE_SEGMENTS = 4;
  const BOOT_DELAY_MS = 900;
  const SCAN_BUDGET_MS = 0.65;
  const SCAN_TRIANGLES_PER_SLICE = 480;
  const CHUNK_TILES = 16;
  const BUILD_CHUNKS_PER_FRAME = 1;
  const LAND_TYPES = new Set(['grass', 'path', 'tilled', 'trench', 'raised', 'paddy', 'rock', 'shrub', 'cliff', 'ramp', 'weeds']);
  const WATER_TYPES = new Set(['water', 'river', 'stream', 'waterfall']);
  const LOGICAL_OFFSETS = Object.freeze({ trench: -0.5, raised: 0.5 });

  let activeScene = null;
  let activeArea = null;
  let root = null;
  let scan = null;
  let build = null;
  let bootStartedAt = performance.now();
  let sourceSnapshotTaken = false;
  let lastFrameAt = 0;
  let textureState = 'not-requested';
  let snowTexture = null;
  let snowMaterial = null;
  let builtTiles = 0;
  let sampledTiles = 0;
  let sampledTriangles = 0;
  let processedTriangles = 0;
  let exposedEdges = 0;
  let builtChunks = 0;
  let totalChunks = 0;
  let buildCount = 0;
  let lastSliceMs = 0;
  let maxSliceMs = 0;
  let lastReason = 'waiting for active Western Slope scene';

  const now = () => globalThis.performance?.now?.() ?? Date.now();

  function currentArea() {
    try { return String(window.GridTileAccessors?.getCurrentArea?.() || ''); }
    catch (_) { return ''; }
  }

  function currentScene() {
    try { return window.GridTileAccessors?.getActiveScene?.() || null; }
    catch (_) { return null; }
  }

  function currentGrid() {
    try { return window.GridTileAccessors?.getActiveGrid?.() || null; }
    catch (_) { return null; }
  }

  function currentCols() {
    try { return Number(window.GridTileAccessors?.getActiveCols?.() || 0); }
    catch (_) { return 0; }
  }

  function currentRows() {
    try { return Number(window.GridTileAccessors?.getActiveRows?.() || 0); }
    catch (_) { return 0; }
  }

  function isWesternSlope(area = currentArea()) {
    return area === WESTERN_SLOPE_ID || area.includes('western_slope');
  }

  function tileCovered(tile) {
    const type = String(tile?.type || 'grass').toLowerCase();
    return LAND_TYPES.has(type) && !WATER_TYPES.has(type);
  }

  function logicalSurfaceY(tile) {
    const type = String(tile?.type || 'grass').toLowerCase();
    if (type === 'ramp') return (Number(tile?.rampElevation) || 0) * PLATEAU_UNIT;
    return (Number(tile?.elevTier) || 0) * PLATEAU_UNIT + Number(LOGICAL_OFFSETS[type] || 0);
  }

  function whiteShadeCanvas(image) {
    try {
      const width = image?.naturalWidth || image?.width;
      const height = image?.naturalHeight || image?.height;
      if (!width || !height) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        const value = Math.round(255 * Math.max(0.7, Math.min(1, 0.78 + luminance * 0.25)));
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
      }
      context.putImageData(imageData, 0, 0);
      return canvas;
    } catch (_) { return null; }
  }

  function ensureTexture() {
    const THREE = window.THREE;
    if (!THREE || textureState !== 'not-requested') return;
    textureState = 'loading';
    new THREE.TextureLoader().load('assets/textures/canvas.png', texture => {
      let finalTexture = texture;
      try {
        if (typeof window.getShadeFillCanvas === 'function' && texture.image) {
          const tinted = window.getShadeFillCanvas(texture.image, 'environment-snow-micro-plateau-v2|canvas.png|white', {
            mode: 'shadeFill', rgb: [255, 255, 255], options: window.getPortraitTintingConfig?.() || {},
          });
          if (tinted) finalTexture = new THREE.CanvasTexture(tinted);
        } else if (texture.image) {
          const tinted = whiteShadeCanvas(texture.image);
          if (tinted) finalTexture = new THREE.CanvasTexture(tinted);
        }
      } catch (_) {}
      finalTexture.wrapS = finalTexture.wrapT = THREE.RepeatWrapping;
      finalTexture.minFilter = THREE.LinearFilter;
      finalTexture.magFilter = THREE.LinearFilter;
      finalTexture.generateMipmaps = false;
      finalTexture.needsUpdate = true;
      snowTexture = finalTexture;
      textureState = finalTexture === texture ? 'raw-canvas-png' : 'shade-filled-white-canvas-png';
      if (snowMaterial) {
        snowMaterial.map = snowTexture;
        snowMaterial.needsUpdate = true;
      }
    }, undefined, error => {
      textureState = `load-failed:${String(error?.message || 'unknown')}`;
    });
  }

  function material() {
    const THREE = window.THREE;
    if (snowMaterial || !THREE) return snowMaterial;
    ensureTexture();
    snowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: snowTexture,
      side: THREE.DoubleSide,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      fog: true,
    });
    snowMaterial.userData.environmentSurfaceMicroPlateauMaterial = true;
    return snowMaterial;
  }

  function disposeRoot() {
    if (!root) return;
    root.parent?.remove(root);
    root.traverse?.(node => node.geometry?.dispose?.());
    root = null;
  }

  function sourceCandidates(scene) {
    const out = [];
    const seen = new Set();
    const add = mesh => {
      if (!mesh?.isMesh || seen.has(mesh) || mesh.visible === false) return;
      if (mesh.userData?.environmentSurfaceRuntime || mesh.userData?.terrainRenderChunkSource || mesh.userData?.isBillboard || mesh.isSkinnedMesh) return;
      const geometry = mesh.geometry;
      if (!geometry?.attributes?.position) return;
      const name = String(mesh.name || '').toLowerCase();
      const key = String(mesh.userData?.terrainEdgeId || mesh.userData?.terrainKey || mesh.material?.userData?.terrainKey || '').toLowerCase();
      if (WATER_TYPES.has(key) || /(^|[_-])(water|river|stream|waterfall)([_-]|$)/.test(name)) return;
      const layerMask = Number(mesh.layers?.mask || 0) >>> 0;
      const terrainLayer = Boolean(layerMask & (1 << 3));
      if (mesh.userData?.terrainRenderChunk === true || terrainLayer || /terrain|ground|floor|mesa|plateau|ramp|trench|raised|path|rock/i.test(name)) {
        seen.add(mesh);
        out.push(mesh);
      }
    };
    scene?.traverse?.(node => { if (node?.isMesh) add(node); });
    return out;
  }

  function elementRange(geometry) {
    const total = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
    const rawStart = Math.max(0, Math.floor(Number(geometry?.drawRange?.start) || 0));
    const start = Math.min(total, rawStart - rawStart % 3);
    const rawCount = Number(geometry?.drawRange?.count);
    const available = Math.max(0, total - start);
    const count = Number.isFinite(rawCount) ? Math.max(0, Math.min(available, Math.floor(rawCount))) : available;
    return { start, end: start + count - count % 3 };
  }

  function prepareSource(mesh) {
    const THREE = window.THREE;
    const geometry = mesh.geometry;
    const range = elementRange(geometry);
    return {
      geometry,
      position: geometry.attributes.position,
      index: geometry.index || null,
      end: range.end,
      element: range.start,
      matrixWorld: mesh.matrixWorld.clone(),
      a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
      ab: new THREE.Vector3(), ac: new THREE.Vector3(), normal: new THREE.Vector3(),
    };
  }

  function readVertex(source, element, out) {
    const index = source.index ? source.index.getX(element) : element;
    out.fromBufferAttribute(source.position, index).applyMatrix4(source.matrixWorld);
  }

  function startScan(scene, grid, cols, rows) {
    sourceSnapshotTaken = true;
    scene.updateMatrixWorld?.(true);
    const meshes = sourceCandidates(scene);
    if (!meshes.length) {
      lastReason = 'no terrain render sources found; will retry';
      sourceSnapshotTaken = false;
      bootStartedAt = now() - BOOT_DELAY_MS + 250;
      return false;
    }
    processedTriangles = 0;
    sampledTriangles = 0;
    sampledTiles = 0;
    scan = {
      scene, grid, cols, rows,
      sources: meshes.map(prepareSource),
      sourceIndex: 0,
      tileMaxY: new Float32Array(cols * rows).fill(-Infinity),
      acceptedTriangles: 0,
      processedTriangles: 0,
    };
    lastReason = `incrementally sampling ${meshes.length} terrain sources`;
    return true;
  }

  function sampleTriangle(source, state) {
    const e = source.element;
    source.element += 3;
    state.processedTriangles++;
    readVertex(source, e, source.a);
    readVertex(source, e + 1, source.b);
    readVertex(source, e + 2, source.c);
    source.ab.subVectors(source.b, source.a);
    source.ac.subVectors(source.c, source.a);
    source.normal.crossVectors(source.ab, source.ac);
    const length = source.normal.length();
    if (length < 1e-8) return;
    source.normal.multiplyScalar(1 / length);
    if (source.normal.y < 0) source.normal.multiplyScalar(-1);
    if (source.normal.y < 0.28) return;
    const cx = (source.a.x + source.b.x + source.c.x) / 3;
    const cz = (source.a.z + source.b.z + source.c.z) / 3;
    const col = Math.floor(cx), row = Math.floor(cz);
    if (col < 0 || row < 0 || col >= state.cols || row >= state.rows) return;
    if (!tileCovered(state.grid?.[row]?.[col])) return;
    const maxY = Math.max(source.a.y, source.b.y, source.c.y);
    const key = row * state.cols + col;
    if (maxY > state.tileMaxY[key]) state.tileMaxY[key] = maxY;
    state.acceptedTriangles++;
  }

  function beginBuild(state) {
    scan = null;
    processedTriangles = state.processedTriangles;
    sampledTriangles = state.acceptedTriangles;
    sampledTiles = 0;
    builtTiles = 0;
    exposedEdges = 0;
    builtChunks = 0;
    const chunks = [];
    for (let row = 0; row < state.rows; row += CHUNK_TILES) {
      for (let col = 0; col < state.cols; col += CHUNK_TILES) chunks.push({ col, row });
    }
    totalChunks = chunks.length;
    build = { ...state, chunks, chunkIndex: 0, topCache: new Array(state.cols * state.rows) };
    root = new window.THREE.Group();
    root.name = 'hobunji_environment_surface_snow_micro_plateau';
    root.userData.environmentSurfaceRuntime = true;
    root.userData.environmentSurfaceMicroPlateau = true;
    root.userData.environmentSurfaceTopGeometry = 'tile-driven-shallow-plateau-v2';
    state.scene.add(root);
    lastReason = `terrain scan complete; incrementally building ${totalChunks} snow chunks`;
  }

  function processScanSlice() {
    if (!scan) return false;
    const started = now();
    let processedThisSlice = 0;
    while (scan.sourceIndex < scan.sources.length && processedThisSlice < SCAN_TRIANGLES_PER_SLICE && now() - started < SCAN_BUDGET_MS) {
      const source = scan.sources[scan.sourceIndex];
      if (source.element + 2 >= source.end) {
        scan.sourceIndex++;
        continue;
      }
      sampleTriangle(source, scan);
      processedThisSlice++;
    }
    processedTriangles = scan.processedTriangles;
    sampledTriangles = scan.acceptedTriangles;
    const elapsed = now() - started;
    lastSliceMs = elapsed;
    maxSliceMs = Math.max(maxSliceMs, elapsed);
    if (scan.sourceIndex >= scan.sources.length) beginBuild(scan);
    return true;
  }

  function rampCornerY(grid, ci, cj, fallback) {
    let sum = 0, count = 0;
    for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
      const tile = grid?.[cj + dr]?.[ci + dc];
      if (String(tile?.type || '').toLowerCase() !== 'ramp') continue;
      sum += (Number(tile.rampElevation) || 0) * PLATEAU_UNIT;
      count++;
    }
    return count ? sum / count : fallback;
  }

  function tileTopCorners(state, col, row) {
    if (col < 0 || row < 0 || col >= state.cols || row >= state.rows) return null;
    const cacheKey = row * state.cols + col;
    if (state.topCache[cacheKey] !== undefined) return state.topCache[cacheKey];
    const tile = state.grid?.[row]?.[col];
    if (!tileCovered(tile)) {
      state.topCache[cacheKey] = null;
      return null;
    }
    const sampled = state.tileMaxY[cacheKey];
    const type = String(tile?.type || 'grass').toLowerCase();
    let corners;
    if (type !== 'ramp') {
      const fallback = logicalSurfaceY(tile);
      const top = (Number.isFinite(sampled) ? sampled : fallback) + TOP_CLEARANCE;
      corners = [top, top, top, top];
    } else {
      const fallback = logicalSurfaceY(tile);
      corners = [
        rampCornerY(state.grid, col, row, fallback),
        rampCornerY(state.grid, col + 1, row, fallback),
        rampCornerY(state.grid, col, row + 1, fallback),
        rampCornerY(state.grid, col + 1, row + 1, fallback),
      ];
      const authoredMax = Math.max(...corners);
      const lift = (Number.isFinite(sampled) ? sampled - authoredMax : 0) + TOP_CLEARANCE;
      corners = corners.map(y => y + lift);
    }
    state.topCache[cacheKey] = corners;
    return corners;
  }

  function addTopTile(pos, uv, idx, col, row, corners) {
    const base = pos.length / 3;
    const [y00, y10, y01, y11] = corners;
    pos.push(col,y00,row, col+1,y10,row, col,y01,row+1, col+1,y11,row+1);
    uv.push(0,0, 1,0, 0,1, 1,1);
    idx.push(base,base+2,base+3, base,base+3,base+1);
  }

  function edgeCorners(corners, side) {
    if (side === 'N') return [corners[0], corners[1]];
    if (side === 'E') return [corners[1], corners[3]];
    if (side === 'S') return [corners[3], corners[2]];
    return [corners[2], corners[0]];
  }

  function neighborEdgeCorners(corners, side) {
    if (side === 'N') return [corners[2], corners[3]];
    if (side === 'E') return [corners[0], corners[2]];
    if (side === 'S') return [corners[1], corners[0]];
    return [corners[3], corners[1]];
  }

  function addRoundedLip(pos, uv, idx, col, row, side, edgeY) {
    const dirs = { N:[0,-1], E:[1,0], S:[0,1], W:[-1,0] };
    const d = dirs[side];
    let ax, az, bx, bz;
    if (side === 'N') { ax=col; az=row; bx=col+1; bz=row; }
    else if (side === 'E') { ax=col+1; az=row; bx=col+1; bz=row+1; }
    else if (side === 'S') { ax=col+1; az=row+1; bx=col; bz=row+1; }
    else { ax=col; az=row+1; bx=col; bz=row; }
    const [topA, topB] = edgeY;
    let prevA = [ax, topA, az], prevB = [bx, topB, bz];
    for (let segment = 1; segment <= EDGE_SEGMENTS; segment++) {
      const t = segment / EDGE_SEGMENTS;
      const outward = EDGE_WIDTH * Math.sin(t * Math.PI);
      const drop = SNOW_THICKNESS * (t * t * (3 - 2 * t));
      const nextA = [ax + d[0] * outward, topA - drop, az + d[1] * outward];
      const nextB = [bx + d[0] * outward, topB - drop, bz + d[1] * outward];
      const base = pos.length / 3;
      pos.push(...prevA, ...prevB, ...nextB, ...nextA);
      uv.push(0,1-t+1/EDGE_SEGMENTS, 1,1-t+1/EDGE_SEGMENTS, 1,1-t, 0,1-t);
      idx.push(base,base+1,base+2, base,base+2,base+3);
      prevA = nextA;
      prevB = nextB;
    }
  }

  function makeMesh(positions, uvs, indices, name, order) {
    if (!indices.length) return null;
    const THREE = window.THREE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material());
    mesh.name = name;
    mesh.userData.environmentSurfaceRuntime = true;
    mesh.userData.environmentSurfaceMicroPlateau = true;
    mesh.renderOrder = order;
    mesh.receiveShadow = false;
    root.add(mesh);
    return mesh;
  }

  function buildOneChunk(state, chunk) {
    const capPos = [], capUv = [], capIdx = [];
    const lipPos = [], lipUv = [], lipIdx = [];
    const rowEnd = Math.min(state.rows, chunk.row + CHUNK_TILES);
    const colEnd = Math.min(state.cols, chunk.col + CHUNK_TILES);
    const sides = [['N',0,-1], ['E',1,0], ['S',0,1], ['W',-1,0]];

    for (let row = chunk.row; row < rowEnd; row++) {
      for (let col = chunk.col; col < colEnd; col++) {
        const corners = tileTopCorners(state, col, row);
        if (!corners) continue;
        addTopTile(capPos, capUv, capIdx, col, row, corners);
        builtTiles++;
        if (Number.isFinite(state.tileMaxY[row * state.cols + col])) sampledTiles++;
        for (const [side, dc, dr] of sides) {
          const edge = edgeCorners(corners, side);
          const neighbor = tileTopCorners(state, col + dc, row + dr);
          if (neighbor) {
            const other = neighborEdgeCorners(neighbor, side);
            const oursMid = (edge[0] + edge[1]) * 0.5;
            const theirsMid = (other[0] + other[1]) * 0.5;
            if (oursMid <= theirsMid + 0.025) continue;
          }
          addRoundedLip(lipPos, lipUv, lipIdx, col, row, side, edge);
          exposedEdges++;
        }
      }
    }

    const label = `${chunk.col}_${chunk.row}`;
    makeMesh(capPos, capUv, capIdx, `snow_micro_plateau_caps_${label}`, 2.2);
    makeMesh(lipPos, lipUv, lipIdx, `snow_micro_plateau_edges_${label}`, 2.21);
  }

  function processBuildSlice() {
    if (!build) return false;
    const started = now();
    let chunksThisFrame = 0;
    while (build.chunkIndex < build.chunks.length && chunksThisFrame < BUILD_CHUNKS_PER_FRAME) {
      buildOneChunk(build, build.chunks[build.chunkIndex++]);
      builtChunks++;
      chunksThisFrame++;
    }
    const elapsed = now() - started;
    lastSliceMs = elapsed;
    maxSliceMs = Math.max(maxSliceMs, elapsed);
    if (build.chunkIndex >= build.chunks.length) {
      build = null;
      buildCount++;
      lastReason = `built ${builtTiles} shallow snow tiles in ${builtChunks} chunks; ${sampledTiles} sampled tiles; ${exposedEdges} short edges`;
    } else {
      lastReason = `building snow chunks ${builtChunks}/${totalChunks}`;
    }
    return true;
  }

  function resetForScene(scene, area) {
    disposeRoot();
    scan = null;
    build = null;
    activeScene = scene;
    activeArea = area;
    bootStartedAt = now();
    sourceSnapshotTaken = false;
    builtTiles = 0;
    sampledTiles = 0;
    sampledTriangles = 0;
    processedTriangles = 0;
    exposedEdges = 0;
    builtChunks = 0;
    totalChunks = 0;
    lastReason = 'waiting briefly for terrain render chunks';
  }

  function tick(timestamp) {
    requestAnimationFrame(tick);
    if (timestamp - lastFrameAt < 16) return;
    lastFrameAt = timestamp;
    const scene = currentScene();
    const area = currentArea();
    if (!scene || !window.THREE || !window.GridTileAccessors) return;
    if (!isWesternSlope(area)) {
      if (root || scan || build) resetForScene(scene, area);
      lastReason = 'inactive outside Western Slope';
      return;
    }
    if (scene !== activeScene || area !== activeArea) resetForScene(scene, area);
    if (build) {
      processBuildSlice();
      return;
    }
    if (scan) {
      processScanSlice();
      return;
    }
    if (root && buildCount > 0) return;
    if (now() - bootStartedAt < BOOT_DELAY_MS) return;
    if (sourceSnapshotTaken) return;
    const grid = currentGrid(), cols = currentCols(), rows = currentRows();
    if (!grid || !cols || !rows) return;
    startScan(scene, grid, cols, rows);
  }

  function forceRebuild() {
    const scene = currentScene();
    if (!scene || !isWesternSlope()) return debugSnapshot();
    resetForScene(scene, currentArea());
    bootStartedAt = now() - BOOT_DELAY_MS;
    return debugSnapshot();
  }

  function debugSnapshot() {
    return {
      installed: true,
      version: 2,
      active: Boolean(root && !build),
      area: currentArea() || null,
      mode: isWesternSlope() ? 'snow-micro-plateau' : 'inactive',
      thickness: SNOW_THICKNESS,
      edgeWidth: EDGE_WIDTH,
      scanning: Boolean(scan),
      building: Boolean(build),
      scanSource: scan ? `${Math.min(scan.sourceIndex + 1, scan.sources.length)}/${scan.sources.length}` : null,
      processedTriangles,
      sampledTriangles,
      sampledTiles,
      builtTiles,
      exposedEdges,
      builtChunks,
      totalChunks,
      buildCount,
      textureState,
      lastSliceMs: Number(lastSliceMs.toFixed(2)),
      maxSliceMs: Number(maxSliceMs.toFixed(2)),
      lastReason,
    };
  }

  window.EnvironmentSurfaceMicroPlateau = Object.freeze({ installed: true, debugSnapshot, forceRebuild });
  ensureTexture();
  requestAnimationFrame(tick);
})();
