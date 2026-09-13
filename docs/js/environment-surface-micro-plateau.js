(() => {
  'use strict';

  if (typeof window === 'undefined' || window.EnvironmentSurfaceMicroPlateau?.installed) return;

  // v3 drops the v2 prototype's whole approach: instead of scanning every
  // candidate terrain mesh's triangles frame-by-frame to reverse-engineer
  // each tile's real height (slow on a real zone's hundreds of sources, and
  // blind to any terrain mesh it failed to pattern-match, like the actual
  // plateau mesa tops), this reads tile height directly from the same grid
  // data — tile.elevTier/rampElevation — the zone's own terrain builders
  // (js/zone-plateau-mesa.js's buildPlateauMesa, the regular floor mesh)
  // already use. That makes the snow height correct by construction for
  // every tile, and the whole zone can be built in one synchronous pass on
  // entry, exactly like those builders already do without a performance
  // problem — no incremental scan/build state machine needed.
  const WESTERN_SLOPE_ID = 'map_western_slope';
  const PLATEAU_UNIT = 2.5;
  const SNOW_THICKNESS = 0.12;
  const TOP_CLEARANCE = 0.018;
  const EDGE_WIDTH = 0.075;
  const EDGE_SEGMENTS = 4;
  const CHUNK_TILES = 16; // Output mesh partitioning only (frustum culling) — every chunk still builds in the same synchronous pass.
  const LAND_TYPES = new Set(['grass', 'path', 'tilled', 'trench', 'raised', 'paddy', 'rock', 'shrub', 'cliff', 'ramp', 'weeds']);
  const WATER_TYPES = new Set(['water', 'river', 'stream', 'waterfall']);
  const LOGICAL_OFFSETS = Object.freeze({ trench: -0.5, raised: 0.5 });

  let activeScene = null;
  let activeArea = null;
  let root = null;
  let lastFrameAt = 0;
  let textureState = 'not-requested';
  let snowTexture = null;
  let snowMaterial = null;
  let builtTiles = 0;
  let exposedEdges = 0;
  let chunkCount = 0;
  let buildCount = 0;
  let lastBuildMs = 0;
  let grassHiddenScene = null;
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
          const tinted = window.getShadeFillCanvas(texture.image, 'environment-snow-micro-plateau-v3|canvas.png|white', {
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

  // Snow caps every walkable land tile, so the decorative grass-blade
  // billboards underneath (js/zone-grass-billboards.js's per-chunk groups)
  // would otherwise poke straight up through it. Hides/restores those
  // groups whole rather than per-tile — cheap, and Western Slope has no
  // farmland mixed in to make a partial cover look wrong.
  function setGrassHidden(scene, hidden) {
    if (!scene?.traverse) return;
    scene.traverse(node => {
      const data = node?.userData;
      if (!data?.isWildernessGrassChunkGroup && !data?.isRichFoliageBillboard) return;
      if (hidden) {
        if (data.environmentSurfaceMicroPlateauPrevVisible === undefined) data.environmentSurfaceMicroPlateauPrevVisible = node.visible;
        node.visible = false;
      } else if (data.environmentSurfaceMicroPlateauPrevVisible !== undefined) {
        node.visible = data.environmentSurfaceMicroPlateauPrevVisible;
        delete data.environmentSurfaceMicroPlateauPrevVisible;
      }
    });
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

  // Every tile's snow height comes straight from its own authored grid
  // data — no reverse-engineering from rendered mesh geometry — so it's
  // always exactly right, including on the real elevated plateau tiers.
  function tileTopCorners(state, col, row) {
    if (col < 0 || row < 0 || col >= state.cols || row >= state.rows) return null;
    const cacheKey = row * state.cols + col;
    if (state.topCache[cacheKey] !== undefined) return state.topCache[cacheKey];
    const tile = state.grid?.[row]?.[col];
    if (!tileCovered(tile)) {
      state.topCache[cacheKey] = null;
      return null;
    }
    const type = String(tile?.type || 'grass').toLowerCase();
    let corners;
    if (type !== 'ramp') {
      const top = logicalSurfaceY(tile) + TOP_CLEARANCE;
      corners = [top, top, top, top];
    } else {
      const fallback = logicalSurfaceY(tile);
      corners = [
        rampCornerY(state.grid, col, row, fallback) + TOP_CLEARANCE,
        rampCornerY(state.grid, col + 1, row, fallback) + TOP_CLEARANCE,
        rampCornerY(state.grid, col, row + 1, fallback) + TOP_CLEARANCE,
        rampCornerY(state.grid, col + 1, row + 1, fallback) + TOP_CLEARANCE,
      ];
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

  // One synchronous pass over the whole zone — the same way
  // buildZoneMesaMeshes/the ordinary floor mesh already build on entry
  // without a performance problem, because this is pure per-tile
  // arithmetic against already-loaded grid data, not a scan of however
  // much terrain geometry the zone happens to render.
  function buildZoneSnow(scene, grid, cols, rows) {
    const started = now();
    const state = { grid, cols, rows, topCache: new Array(cols * rows) };
    root = new window.THREE.Group();
    root.name = 'hobunji_environment_surface_snow_micro_plateau';
    root.userData.environmentSurfaceRuntime = true;
    root.userData.environmentSurfaceMicroPlateau = true;
    root.userData.environmentSurfaceTopGeometry = 'tile-driven-shallow-plateau-v3';
    scene.add(root);

    builtTiles = 0;
    exposedEdges = 0;
    chunkCount = 0;
    for (let row = 0; row < rows; row += CHUNK_TILES) {
      for (let col = 0; col < cols; col += CHUNK_TILES) {
        buildOneChunk(state, { col, row });
        chunkCount++;
      }
    }
    buildCount++;
    lastBuildMs = now() - started;
    setGrassHidden(scene, true);
    grassHiddenScene = scene;
    lastReason = `built ${builtTiles} shallow snow tiles in ${chunkCount} chunk mesh(es); ${exposedEdges} short edges (${lastBuildMs.toFixed(1)}ms)`;
  }

  function resetForScene(scene, area) {
    if (grassHiddenScene) {
      setGrassHidden(grassHiddenScene, false);
      grassHiddenScene = null;
    }
    disposeRoot();
    activeScene = scene;
    activeArea = area;
    builtTiles = 0;
    exposedEdges = 0;
    chunkCount = 0;
    lastReason = 'waiting for grid data';
  }

  function tick(timestamp) {
    requestAnimationFrame(tick);
    if (timestamp - lastFrameAt < 16) return;
    lastFrameAt = timestamp;
    const scene = currentScene();
    const area = currentArea();
    if (!scene || !window.THREE || !window.GridTileAccessors) return;
    if (!isWesternSlope(area)) {
      if (root) resetForScene(scene, area);
      lastReason = 'inactive outside Western Slope';
      return;
    }
    if (scene !== activeScene || area !== activeArea) resetForScene(scene, area);
    if (root) return;
    const grid = currentGrid(), cols = currentCols(), rows = currentRows();
    if (!grid || !cols || !rows) return;
    buildZoneSnow(scene, grid, cols, rows);
  }

  function forceRebuild() {
    const scene = currentScene();
    if (!scene || !isWesternSlope()) return debugSnapshot();
    resetForScene(scene, currentArea());
    return debugSnapshot();
  }

  function debugSnapshot() {
    return {
      installed: true,
      version: 3,
      active: Boolean(root),
      area: currentArea() || null,
      mode: isWesternSlope() ? 'snow-micro-plateau' : 'inactive',
      thickness: SNOW_THICKNESS,
      edgeWidth: EDGE_WIDTH,
      builtTiles,
      exposedEdges,
      chunkCount,
      buildCount,
      lastBuildMs: Number(lastBuildMs.toFixed(2)),
      textureState,
      lastReason,
    };
  }

  window.EnvironmentSurfaceMicroPlateau = Object.freeze({ installed: true, debugSnapshot, forceRebuild });
  ensureTexture();
  requestAnimationFrame(tick);
})();
