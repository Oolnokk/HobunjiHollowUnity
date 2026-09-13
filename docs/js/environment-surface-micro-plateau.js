(() => {
  'use strict';

  if (typeof window === 'undefined' || window.EnvironmentSurfaceMicroPlateau?.installed) return;

  // Resolved from this script's own URL (not the hosting page's) so the
  // texture still loads correctly when this module runs somewhere other
  // than the real game's docs/index.html — e.g. the Wilderness Generation
  // Lab, three directories deeper, which would otherwise 404 on a path
  // relative to its own page.
  const SNOW_TEXTURE_URL = (() => {
    try { return new URL('../assets/textures/canvas.png', document.currentScript.src).href; }
    catch (_) { return 'assets/textures/canvas.png'; }
  })();

  // v4 generalizes v3's direct-grid-height snow renderer to also cover
  // seasonal Coldmuck slush on every other outdoor zone — the same
  // mechanism (tile height read straight from grid data, one synchronous
  // whole-zone build, connected-surface stretch mapping, grass hidden
  // underneath), just a different material. This replaces
  // environment-surface-runtime.js's old triangle-scanning job-queue slush
  // system entirely, the same way v3 already replaced its snow job.
  const WESTERN_SLOPE_ID = 'map_western_slope';
  const PLATEAU_UNIT = 2.5;
  const SURFACE_THICKNESS = 2.00;
  const TOP_CLEARANCE = 0.018;
  const EDGE_WIDTH = 0.075;
  const EDGE_SEGMENTS = 4;
  const CHUNK_TILES = 16; // Output mesh partitioning only (frustum culling), applied after the whole zone is stretch-mapped as one connected surface below — never affects texture continuity.
  const LAND_TYPES = new Set(['grass', 'path', 'tilled', 'trench', 'raised', 'paddy', 'rock', 'shrub', 'cliff', 'ramp', 'weeds']);
  const WATER_TYPES = new Set(['water', 'river', 'stream', 'waterfall']);
  const LOGICAL_OFFSETS = Object.freeze({ trench: -0.5, raised: 0.5 });

  const MODE_PRESETS = Object.freeze({
    snow: Object.freeze({ color: 0xffffff, opacity: 1, transparent: false, textured: true, depthWrite: true }),
    slush: Object.freeze({ color: 0x000000, opacity: 0.22, transparent: true, textured: false, depthWrite: false }),
  });

  let activeScene = null;
  let activeArea = null;
  let activeMode = 'none';
  let root = null;
  let lastFrameAt = 0;
  let textureState = 'not-requested';
  let snowTexture = null;
  const materials = {}; // mode -> THREE.Material, built lazily and reused.
  let builtTiles = 0;
  let exposedEdges = 0;
  let chunkCount = 0;
  let buildCount = 0;
  let lastBuildMs = 0;
  let grassHiddenScene = null;
  let lastGrassHideCheckAt = 0;
  let lastReason = 'waiting for an active outdoor scene';

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

  function currentSeasonName() {
    try { return String(window.CalendarSystem?.currentSeason?.()?.name || ''); }
    catch (_) { return ''; }
  }

  function isWesternSlope(area) {
    return area === WESTERN_SLOPE_ID || area.includes('western_slope');
  }

  // Approximates the real game's own isOutdoorArea() (farm/town/any zone),
  // which isn't reachable from here — this module isn't part of the
  // RainPlanes dependency-injection chain that carries the real check.
  function isOutdoorArea(area) {
    return area === 'farm' || area === 'town' || area.startsWith('map_');
  }

  function resolveMode() {
    const area = currentArea();
    if (isWesternSlope(area)) return 'snow';
    if (!isOutdoorArea(area)) return 'none';
    return currentSeasonName() === 'Coldmuck' ? 'slush' : 'none';
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
    new THREE.TextureLoader().load(SNOW_TEXTURE_URL, texture => {
      let finalTexture = texture;
      try {
        if (typeof window.getShadeFillCanvas === 'function' && texture.image) {
          const tinted = window.getShadeFillCanvas(texture.image, 'environment-snow-micro-plateau-v4|canvas.png|white', {
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
      if (materials.snow) {
        materials.snow.map = snowTexture;
        materials.snow.needsUpdate = true;
      }
    }, undefined, error => {
      textureState = `load-failed:${String(error?.message || 'unknown')}`;
    });
  }

  function material(mode) {
    const THREE = window.THREE;
    if (materials[mode] || !THREE) return materials[mode];
    const preset = MODE_PRESETS[mode];
    if (!preset) return null;
    if (preset.textured) ensureTexture();
    materials[mode] = new THREE.MeshBasicMaterial({
      color: preset.color,
      map: preset.textured ? snowTexture : null,
      side: THREE.DoubleSide,
      transparent: preset.transparent,
      opacity: preset.opacity,
      depthTest: true,
      depthWrite: preset.depthWrite,
      fog: true,
    });
    materials[mode].userData.environmentSurfaceMicroPlateauMaterial = mode;
    return materials[mode];
  }

  function disposeRoot() {
    if (!root) return;
    root.parent?.remove(root);
    root.traverse?.(node => node.geometry?.dispose?.());
    root = null;
  }

  // Snow/slush caps every walkable land tile, so the decorative grass-blade
  // billboards underneath (js/zone-grass-billboards.js's per-chunk groups)
  // would otherwise poke straight up through it. Hides/restores those
  // groups whole rather than per-tile — cheap, and neither environment
  // mixes with farmland in a way that would make a partial cover look wrong.
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

  // Every tile's surface height comes straight from its own authored grid
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

  function addTopTile(pos, idx, col, row, corners) {
    const base = pos.length / 3;
    const [y00, y10, y01, y11] = corners;
    pos.push(col,y00,row, col+1,y10,row, col,y01,row+1, col+1,y11,row+1);
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

  function addRoundedLip(pos, idx, col, row, side, edgeY) {
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
      const drop = SURFACE_THICKNESS * (t * t * (3 - 2 * t));
      const nextA = [ax + d[0] * outward, topA - drop, az + d[1] * outward];
      const nextB = [bx + d[0] * outward, topB - drop, bz + d[1] * outward];
      const base = pos.length / 3;
      pos.push(...prevA, ...prevB, ...nextB, ...nextA);
      idx.push(base,base+1,base+2, base,base+2,base+3);
      prevA = nextA;
      prevB = nextB;
    }
  }

  // Naive per-vertex planar UV — the only UV slush needs (its material has
  // no texture map), and the fallback for snow if the stretch mapper below
  // hasn't loaded yet, so the mesh still renders sanely rather than
  // untextured.
  function planarFallbackUv(geometry) {
    const THREE = window.THREE;
    const position = geometry.getAttribute('position');
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const dx = Math.max(1e-5, box.max.x - box.min.x);
    const dz = Math.max(1e-5, box.max.z - box.min.z);
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      uv[i * 2] = (position.getX(i) - box.min.x) / dx;
      uv[i * 2 + 1] = (position.getZ(i) - box.min.z) / dz;
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return geometry;
  }

  // Wraps every generated chunk through the same connected-surface UV
  // unwrapper the real plateau mesa's cliff faces use (window.
  // HobunjiSurfaceStretchUV, patched onto buildPlateauMesa in
  // surface-stretch-uv-furniture.js) instead of tiling one texture square
  // per tile — the whole cap-and-lip island stretches across one texture
  // domain, with the interior relaxed and the outer boundary mapped along
  // the texture's perimeter, exactly like the farm's cliff texturing. Only
  // snow needs this — slush's material has no texture map to warp.
  function stretchMapSnowUv(geometry, label) {
    const mapper = window.HobunjiSurfaceStretchUV;
    if (typeof mapper?.mapGeometry === 'function') {
      try {
        const mapped = mapper.mapGeometry(geometry, { label: `environment-snow-micro-plateau:${label}` });
        if (mapped?.getAttribute?.('uv')) return mapped;
      } catch (_) {}
    }
    return planarFallbackUv(geometry);
  }

  // Appends one chunk's cap+lip triangles into the shared whole-zone pos/idx
  // buffers (not its own geometry) so the stretch mapper below sees every
  // chunk as part of one connected surface — a real, contiguous plateau
  // must get one continuous texture domain, not one per render-chunk.
  function appendChunkGeometry(state, chunk, pos, idx) {
    const rowEnd = Math.min(state.rows, chunk.row + CHUNK_TILES);
    const colEnd = Math.min(state.cols, chunk.col + CHUNK_TILES);
    const sides = [['N',0,-1], ['E',1,0], ['S',0,1], ['W',-1,0]];

    for (let row = chunk.row; row < rowEnd; row++) {
      for (let col = chunk.col; col < colEnd; col++) {
        const corners = tileTopCorners(state, col, row);
        if (!corners) continue;
        addTopTile(pos, idx, col, row, corners);
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
          addRoundedLip(pos, idx, col, row, side, edge);
          exposedEdges++;
        }
      }
    }
  }

  // Slices one chunk's already-mapped triangles (by triangle range,
  // matching the order they were appended in) out of the combined,
  // non-indexed whole-zone geometry into its own small render mesh — pure
  // culling/draw-call partitioning, applied AFTER UV mapping so it never
  // affects texture continuity (the same order real terrain uses: split
  // into GPU-friendly spatial chunks only once the source UVs are final).
  function makeChunkMeshFromRange(combinedPosition, combinedUv, triStart, triCount, name, order, mode) {
    const THREE = window.THREE;
    const vStart = triStart * 3, vCount = triCount * 3;
    const positions = new Float32Array(vCount * 3);
    const uvs = new Float32Array(vCount * 2);
    for (let i = 0; i < vCount; i++) {
      const src = vStart + i;
      positions[i * 3] = combinedPosition.getX(src);
      positions[i * 3 + 1] = combinedPosition.getY(src);
      positions[i * 3 + 2] = combinedPosition.getZ(src);
      uvs[i * 2] = combinedUv.getX(src);
      uvs[i * 2 + 1] = combinedUv.getY(src);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material(mode));
    mesh.name = name;
    mesh.userData.environmentSurfaceRuntime = true;
    mesh.userData.environmentSurfaceMicroPlateau = true;
    mesh.renderOrder = order;
    mesh.receiveShadow = false;
    root.add(mesh);
    return mesh;
  }

  // One synchronous pass over the whole zone — the same way
  // buildZoneMesaMeshes/the ordinary floor mesh already build on entry
  // without a performance problem, because this only happens once, on
  // zone entry (or a season flip), not every frame. Height comes straight
  // from grid data (fast); the whole zone's cap+lip geometry is mapped in
  // one connected pass so snow's texture reads as one continuous surface
  // instead of tiling once per render chunk (slush has no texture, so it
  // skips straight to the cheap planar UV).
  function buildZoneSurface(scene, grid, cols, rows, mode) {
    const started = now();
    const state = { grid, cols, rows, topCache: new Array(cols * rows) };
    root = new window.THREE.Group();
    root.name = `hobunji_environment_surface_micro_plateau_${mode}`;
    root.userData.environmentSurfaceRuntime = true;
    root.userData.environmentSurfaceMicroPlateau = true;
    root.userData.environmentSurfaceMode = mode;
    scene.add(root);

    builtTiles = 0;
    exposedEdges = 0;
    chunkCount = 0;
    const THREE = window.THREE;
    const pos = [], idx = [];
    const chunkRanges = [];
    for (let row = 0; row < rows; row += CHUNK_TILES) {
      for (let col = 0; col < cols; col += CHUNK_TILES) {
        const triStart = idx.length / 3;
        appendChunkGeometry(state, { col, row }, pos, idx);
        const triCount = idx.length / 3 - triStart;
        if (triCount > 0) chunkRanges.push({ col, row, triStart, triCount });
        chunkCount++;
      }
    }

    if (idx.length) {
      let combined = new THREE.BufferGeometry();
      combined.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      combined.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      combined = mode === 'snow' ? stretchMapSnowUv(combined, 'zone') : planarFallbackUv(combined);
      if (combined.index) combined = combined.toNonIndexed();
      const combinedPosition = combined.getAttribute('position');
      const combinedUv = combined.getAttribute('uv');
      for (const chunk of chunkRanges) {
        makeChunkMeshFromRange(combinedPosition, combinedUv, chunk.triStart, chunk.triCount, `environment_surface_micro_plateau_${mode}_${chunk.col}_${chunk.row}`, mode === 'snow' ? 2.2 : 22.1, mode);
      }
    }

    buildCount++;
    lastBuildMs = now() - started;
    setGrassHidden(scene, true);
    grassHiddenScene = scene;
    lastReason = `built ${builtTiles} ${mode} tile(s) in ${chunkCount} chunk mesh(es); ${exposedEdges} short edges (${lastBuildMs.toFixed(1)}ms)`;
  }

  function resetForScene(scene, area, mode) {
    if (grassHiddenScene) {
      setGrassHidden(grassHiddenScene, false);
      grassHiddenScene = null;
    }
    disposeRoot();
    activeScene = scene;
    activeArea = area;
    activeMode = mode;
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
    const mode = resolveMode();
    if (mode === 'none') {
      if (root) resetForScene(scene, area, mode);
      lastReason = 'inactive (indoors, or outdoor but not snow/slush season)';
      return;
    }
    if (scene !== activeScene || area !== activeArea || mode !== activeMode) resetForScene(scene, area, mode);
    if (root) {
      // Wilderness grass billboards can stream/build in after the surface's
      // own build already ran (zone decoration finishing later than
      // terrain), so a single hide-on-build call can miss them — cheaply
      // re-check every second or so rather than never, without traversing
      // the scene every single frame.
      if (timestamp - lastGrassHideCheckAt > 1000) {
        lastGrassHideCheckAt = timestamp;
        setGrassHidden(scene, true);
      }
      return;
    }
    const grid = currentGrid(), cols = currentCols(), rows = currentRows();
    if (!grid || !cols || !rows) return;
    buildZoneSurface(scene, grid, cols, rows, mode);
  }

  function forceRebuild() {
    const scene = currentScene();
    const mode = resolveMode();
    if (!scene || mode === 'none') return debugSnapshot();
    resetForScene(scene, currentArea(), mode);
    return debugSnapshot();
  }

  function debugSnapshot() {
    const mode = resolveMode();
    return {
      installed: true,
      version: 4,
      active: Boolean(root),
      area: currentArea() || null,
      mode,
      thickness: SURFACE_THICKNESS,
      edgeWidth: EDGE_WIDTH,
      opacity: MODE_PRESETS[mode]?.opacity ?? null,
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
