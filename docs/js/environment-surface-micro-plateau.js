(() => {
  'use strict';

  if (typeof window === 'undefined' || window.EnvironmentSurfaceMicroPlateau?.installed) return;

  const WESTERN_SLOPE_ID = 'map_western_slope'; // Permanent-snow map currently used to validate the replacement renderer.
  const PLATEAU_UNIT = 2.5; // Mirrors terrain.plateauVerticalUnit; used only as a fallback when no rendered terrain sample exists for a tile.
  const SNOW_THICKNESS = 0.12; // Intentionally very shallow: this is a snow skin, not another terrain plateau.
  const TOP_CLEARANCE = 0.018; // Keeps the clean cap just above the highest sampled terrain point so crinkly ground cannot poke through.
  const EDGE_WIDTH = 0.075; // Narrow rounded lip, visually matching the plateau language without eating a meaningful fraction of the tile.
  const EDGE_SEGMENTS = 4; // Enough curvature for the tiny lip without turning the snow edge into another high-poly surface.
  const SCAN_BUDGET_MS = 1.5; // Terrain sampling stays incremental so replacing the old snow never creates a long synchronous hitch.
  const SCAN_TRIANGLES_PER_SLICE = 2200; // Hard cap paired with SCAN_BUDGET_MS.
  const SOURCE_STABLE_MS = 450; // Wait until TerrainRenderChunks stops adding spatial children before snapshotting source draw ranges.
  const SOURCE_MAX_WAIT_MS = 2400; // Still start on slow boots even if some unrelated terrain source keeps changing.
  const LAND_TYPES = new Set(['grass', 'path', 'tilled', 'trench', 'raised', 'paddy', 'rock', 'shrub', 'cliff', 'ramp', 'weeds']);
  const WATER_TYPES = new Set(['water', 'river', 'stream', 'waterfall']);
  const LOGICAL_OFFSETS = Object.freeze({ trench: -0.5, raised: 0.5 });

  let activeScene = null; // Scene currently owning the replacement snow skin.
  let activeArea = null; // Area paired with activeScene so reused scenes cannot keep stale snow.
  let root = null; // One generated group containing the clean cap and its short textured lip.
  let scan = null; // Incremental terrain-sampling state.
  let bootStartedAt = performance.now();
  let lastSourceCount = -1;
  let sourceCountStableAt = performance.now();
  let lastFrameAt = 0;
  let textureState = 'not-requested';
  let snowTexture = null;
  let snowMaterial = null;
  let builtTiles = 0;
  let sampledTriangles = 0;
  let sampledTiles = 0;
  let exposedEdges = 0;
  let buildCount = 0;
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
    return LAND_TYPES.has(type) && !WATER_TYPES.has(type); // skipFloor means another terrain generator owns the visible surface (plateau/ramp), not that snow should be absent.
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
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        const value = Math.round(255 * Math.max(0.7, Math.min(1, 0.78 + luminance * 0.25)));
        data[i] = value; data[i + 1] = value; data[i + 2] = value;
      }
      ctx.putImageData(imageData, 0, 0);
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
          const tinted = window.getShadeFillCanvas(texture.image, 'environment-snow-micro-plateau|canvas.png|white', {
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
      if (snowMaterial) { snowMaterial.map = snowTexture; snowMaterial.needsUpdate = true; }
    }, undefined, error => {
      textureState = `load-failed:${String(error?.message || 'unknown')}`;
    });
  }

  function material() {
    const THREE = window.THREE;
    if (snowMaterial || !THREE) return snowMaterial;
    ensureTexture();
    snowMaterial = new THREE.MeshLambertMaterial({
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

  function setLegacyVisibility(scene, visible) {
    scene?.traverse?.(node => {
      if (!node?.userData?.environmentSurfaceRuntime || node.userData.environmentSurfaceMicroPlateau) return;
      node.visible = visible;
    });
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
        seen.add(mesh); out.push(mesh);
      }
    };
    scene?.traverse?.(node => { if (node?.isMesh) add(node); }); // Includes plateau/ramp meshes owned by nested terrain groups, not only direct renderer chunks.
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
    mesh.updateWorldMatrix?.(true, false);
    const geometry = mesh.geometry;
    const range = elementRange(geometry);
    return {
      mesh,
      geometry,
      position: geometry.attributes.position,
      index: geometry.index || null,
      start: range.start,
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
    const meshes = sourceCandidates(scene);
    if (!meshes.length) return false;
    scan = {
      scene, grid, cols, rows,
      sources: meshes.map(prepareSource),
      sourceIndex: 0,
      tileMaxY: new Float32Array(cols * rows).fill(-Infinity),
      triangles: 0,
      startedAt: now(),
    };
    lastReason = `sampling ${meshes.length} plateau/terrain render sources for clean tile caps`;
    return true;
  }

  function sampleTriangle(source, state) {
    const e = source.element;
    source.element += 3;
    readVertex(source, e, source.a);
    readVertex(source, e + 1, source.b);
    readVertex(source, e + 2, source.c);
    source.ab.subVectors(source.b, source.a);
    source.ac.subVectors(source.c, source.a);
    source.normal.crossVectors(source.ab, source.ac);
    const len = source.normal.length();
    if (len < 1e-8) return;
    source.normal.multiplyScalar(1 / len);
    if (source.normal.y < 0) source.normal.multiplyScalar(-1);
    if (source.normal.y < 0.28) return; // Walls/cliff faces must never raise a neighboring tile's clean cap.
    const cx = (source.a.x + source.b.x + source.c.x) / 3;
    const cz = (source.a.z + source.b.z + source.c.z) / 3;
    const col = Math.floor(cx), row = Math.floor(cz);
    if (col < 0 || row < 0 || col >= state.cols || row >= state.rows) return;
    if (!tileCovered(state.grid?.[row]?.[col])) return;
    const maxY = Math.max(source.a.y, source.b.y, source.c.y);
    const k = row * state.cols + col;
    if (maxY > state.tileMaxY[k]) state.tileMaxY[k] = maxY;
    state.triangles++;
  }

  function processScanSlice() {
    if (!scan) return false;
    const started = now();
    let processed = 0;
    while (scan.sourceIndex < scan.sources.length && processed < SCAN_TRIANGLES_PER_SLICE && now() - started < SCAN_BUDGET_MS) {
      const source = scan.sources[scan.sourceIndex];
      if (source.element + 2 >= source.end) { scan.sourceIndex++; continue; }
      sampleTriangle(source, scan);
      processed++;
    }
    if (scan.sourceIndex < scan.sources.length) return true;
    const finished = scan;
    scan = null;
    sampledTriangles = finished.triangles;
    buildSnowSkin(finished);
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
    const tile = state.grid[row]?.[col];
    const sampled = state.tileMaxY[row * state.cols + col];
    const type = String(tile?.type || 'grass').toLowerCase();
    if (type !== 'ramp') {
      const fallback = logicalSurfaceY(tile);
      const top = (Number.isFinite(sampled) ? sampled : fallback) + TOP_CLEARANCE;
      return [top, top, top, top]; // Flat per-tile plateau cap: no source vertex survives into the visible top.
    }
    const fallback = logicalSurfaceY(tile);
    const corners = [
      rampCornerY(state.grid, col, row, fallback),
      rampCornerY(state.grid, col + 1, row, fallback),
      rampCornerY(state.grid, col, row + 1, fallback),
      rampCornerY(state.grid, col + 1, row + 1, fallback),
    ];
    const authoredMax = Math.max(...corners);
    const lift = (Number.isFinite(sampled) ? sampled - authoredMax : 0) + TOP_CLEARANCE;
    return corners.map(y => y + lift); // Ramps keep one clean authored slope instead of the crinkly rendered heightfield.
  }

  function addTopTile(pos, uv, idx, col, row, corners) {
    const base = pos.length / 3;
    const [y00, y10, y01, y11] = corners;
    pos.push(col,y00,row,  col+1,y10,row,  col,y01,row+1,  col+1,y11,row+1);
    uv.push(0,0, 1,0, 0,1, 1,1); // One complete snow PNG across each tile.
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
    let ax,az,bx,bz;
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
      prevA = nextA; prevB = nextB;
    }
  }

  function buildSnowSkin(state) {
    const THREE = window.THREE;
    const scene = state.scene;
    if (!THREE || !scene || scene !== currentScene() || !isWesternSlope()) return;
    disposeRoot();
    const capPos = [], capUv = [], capIdx = [];
    const lipPos = [], lipUv = [], lipIdx = [];
    const topByTile = new Array(state.cols * state.rows);
    builtTiles = 0; sampledTiles = 0; exposedEdges = 0;

    for (let row = 0; row < state.rows; row++) for (let col = 0; col < state.cols; col++) {
      const tile = state.grid?.[row]?.[col];
      if (!tileCovered(tile)) continue;
      const corners = tileTopCorners(state, col, row);
      topByTile[row * state.cols + col] = corners;
      addTopTile(capPos, capUv, capIdx, col, row, corners);
      builtTiles++;
      if (Number.isFinite(state.tileMaxY[row * state.cols + col])) sampledTiles++;
    }

    const sides = [['N',0,-1], ['E',1,0], ['S',0,1], ['W',-1,0]];
    for (let row = 0; row < state.rows; row++) for (let col = 0; col < state.cols; col++) {
      const corners = topByTile[row * state.cols + col];
      if (!corners) continue;
      for (const [side,dc,dr] of sides) {
        const edge = edgeCorners(corners, side);
        const nc = col + dc, nr = row + dr;
        const neighbor = nc >= 0 && nr >= 0 && nc < state.cols && nr < state.rows ? topByTile[nr * state.cols + nc] : null;
        if (neighbor) {
          const other = neighborEdgeCorners(neighbor, side);
          const oursMid = (edge[0] + edge[1]) * 0.5;
          const theirsMid = (other[0] + other[1]) * 0.5;
          if (oursMid <= theirsMid + 0.025) continue; // Same-height snow merges seamlessly; only the upper micro-plateau owns a tier seam.
        }
        addRoundedLip(lipPos, lipUv, lipIdx, col, row, side, edge);
        exposedEdges++;
      }
    }

    root = new THREE.Group();
    root.name = 'hobunji_environment_surface_snow_micro_plateau';
    root.userData.environmentSurfaceRuntime = true;
    root.userData.environmentSurfaceMicroPlateau = true;
    root.userData.environmentSurfaceTopGeometry = 'tile-driven-shallow-plateau';

    const makeMesh = (positions, uvs, indices, name, order) => {
      if (!indices.length) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material());
      mesh.name = name;
      mesh.userData.environmentSurfaceRuntime = true;
      mesh.userData.environmentSurfaceMicroPlateau = true;
      mesh.renderOrder = order;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    makeMesh(capPos, capUv, capIdx, `${root.name}_flat_tile_caps`, 2.2);
    makeMesh(lipPos, lipUv, lipIdx, `${root.name}_short_rounded_edges`, 2.21);
    scene.add(root);
    setLegacyVisibility(scene, false);
    activeScene = scene;
    activeArea = currentArea();
    buildCount++;
    lastReason = `built ${builtTiles} shallow snow plateau tiles (${sampledTiles} terrain-sampled), ${exposedEdges} short textured edges`;
  }

  function resetForScene(scene, area) {
    if (activeScene && activeScene !== scene) setLegacyVisibility(activeScene, true);
    disposeRoot();
    scan = null;
    activeScene = scene;
    activeArea = area;
    bootStartedAt = now();
    lastSourceCount = -1;
    sourceCountStableAt = now();
    lastReason = 'waiting for terrain render chunks to settle';
  }

  function tick(timestamp) {
    requestAnimationFrame(tick);
    if (timestamp - lastFrameAt < 16) return;
    lastFrameAt = timestamp;
    const scene = currentScene();
    const area = currentArea();
    if (!scene || !window.THREE || !window.GridTileAccessors) return;
    if (!isWesternSlope(area)) {
      if (activeScene) setLegacyVisibility(activeScene, true);
      if (root || scan) { disposeRoot(); scan = null; }
      activeScene = scene; activeArea = area;
      lastReason = 'inactive outside Western Slope';
      return;
    }
    if (scene !== activeScene || area !== activeArea) resetForScene(scene, area);
    setLegacyVisibility(scene, false); // Old triangle-copy snow may finish jobs later; keep it hidden after every publish.
    if (root) return;
    if (scan) { processScanSlice(); return; }
    const grid = currentGrid(), cols = currentCols(), rows = currentRows();
    if (!grid || !cols || !rows) return;
    const count = sourceCandidates(scene).length;
    if (count !== lastSourceCount) {
      lastSourceCount = count;
      sourceCountStableAt = now();
      lastReason = `waiting for terrain sources (${count} currently)`;
      return;
    }
    const stableFor = now() - sourceCountStableAt;
    const waited = now() - bootStartedAt;
    if (stableFor < SOURCE_STABLE_MS && waited < SOURCE_MAX_WAIT_MS) return;
    startScan(scene, grid, cols, rows);
  }

  function forceRebuild() {
    const scene = currentScene();
    if (!scene || !isWesternSlope()) return debugSnapshot();
    resetForScene(scene, currentArea());
    sourceCountStableAt = now() - SOURCE_STABLE_MS;
    return debugSnapshot();
  }

  function debugSnapshot() {
    return {
      installed: true,
      active: Boolean(root),
      area: currentArea() || null,
      mode: isWesternSlope() ? 'snow-micro-plateau' : 'inactive',
      thickness: SNOW_THICKNESS,
      edgeWidth: EDGE_WIDTH,
      scanning: Boolean(scan),
      scanSource: scan ? `${scan.sourceIndex + 1}/${scan.sources.length}` : null,
      sampledTriangles,
      sampledTiles,
      builtTiles,
      exposedEdges,
      buildCount,
      textureState,
      lastReason,
    };
  }

  window.EnvironmentSurfaceMicroPlateau = Object.freeze({ installed: true, debugSnapshot, forceRebuild });
  ensureTexture();
  requestAnimationFrame(tick);
})();
