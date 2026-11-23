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

  // v7 treats snow/slush as shallow micro-plateaus rooted on each
  // authored walkable surface. Where that surface ends, the raised cap
  // inclines back down INSIDE its own tile and meets the tile boundary at
  // the tile's own walkable elevation. A lower neighboring mesa tier is
  // never used as the bottom of this side, so environment surfaces cannot
  // leak down or bridge across real cliff faces. This still replaces
  // environment-surface-runtime.js's old triangle-scanning job-queue slush
  // system entirely, the same way v3 already replaced its snow job.
  const WESTERN_SLOPE_ID = 'map_western_slope';
  const PLATEAU_UNIT = 2.5;
  // How far the cap's top surface sits above the true tile height. Doubles
  // as the visual "sink" depth: the player and every creature are still
  // positioned at the real, unmodified ground height everywhere else in the
  // game (this module never touches collision/movement/pathing), so raising
  // this simply buries their feet/lower legs under the raised snow surface
  // by this same amount — a real person, and every animal, standing in deep
  // snow, rather than a thin coat of white paint on flat pavement.
  const SURFACE_DEPTH = 0.22;
  const SNOW_STEPS = 10; // Quantizes snow accumulation so height updates happen infrequently.
  const IDLE_POLL_INTERVAL_MS = 250; // Checks dormant surfaces at most four times per second.
  const EDGE_WIDTH = 0.22; // Horizontal run of a micro-plateau side; with 0.22 depth this is a clear ~45° incline.
  const EDGE_HEIGHT_EPS = 0.025; // Shared-edge height tolerance used to decide whether two covered tiles are one walkable surface.
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
  let activeDepth = 0; // Actual snow/slush cap thickness in the latest built mesh; used by projections, camera and rebuild decisions.
  let root = null;
  let cameraSurfaceState = null; // Built tile vertex heights used only by the camera's terrain solver.
  let lastFrameAt = 0;
  let lastInactiveCheckAt = -Infinity; // Last dormant surface poll, allowing cheap in-between frames.
  let skippedInactiveTicks = 0; // Mobile diagnostics count scheduler frames that skip inactive work.
  let skippedDormantProjections = 0; // Counts render hooks avoiding unnecessary season and calendar checks with no surface.
  let snowUvMapRuns = 0; // Mobile profiling: costly whole-zone harmonic UV solver executions.
  let snowDepthUpdates = 0; // Counts depth changes applied to the existing snow buffers.
  let lastSnowDepthUpdateMs = 0; // Mobile diagnostic for the last depth update.
  let textureState = 'not-requested';
  let snowTexture = null;
  const materials = {}; // mode -> THREE.Material, built lazily and reused.
  const snowMaterialConsumers = new Set(); // Background-only snow material clones waiting for the shared snow texture to finish loading.
  let builtTiles = 0;
  let compactTiles = 0; // Planar interior tiles using one quad rather than nine.
  let detailedTiles = 0; // Cliff/complex tiles retaining the rooted 4x4 surface.
  let triangleCount = 0; // Built GPU triangles reported in the mobile debug snapshot.
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

  // Every generated building/cavern map uses the map_i_ prefix; environment
  // snow/slush is an exterior surface and must never follow a parent zone's
  // name into one of those interiors (for example map_i_den_map_western_slope_*).
  function isInteriorArea(area) {
    return area.startsWith('map_i_');
  }

  function isWesternSlope(area) {
    return area === WESTERN_SLOPE_ID;
  }

  // Approximates the real game's own isOutdoorArea() (farm/town/any zone),
  // which isn't reachable from here — this module isn't part of the
  // RainPlanes dependency-injection chain that carries the real check.
  function isOutdoorArea(area) {
    return area === 'farm' || area === 'town' || (area.startsWith('map_') && !isInteriorArea(area));
  }

  function resolveMode() {
    const area = currentArea();
    if (isInteriorArea(area)) return 'none';
    if (isWesternSlope(area)) return 'snow';
    if (!isOutdoorArea(area)) return 'none';
    if (window.TothalBlizzard?.snowCoverageFor?.(area) > 0) return 'snow'; // The other three wilderness zones gain temporary snow, not Coldmuck slush.
    return currentSeasonName() === 'Coldmuck' ? 'slush' : 'none';
  }

  function depthForMode(mode, area = currentArea()) {
    if (mode !== 'snow') return mode === 'slush' ? SURFACE_DEPTH : 0;
    const snow = window.TothalBlizzard?.snowCoverageFor?.(area) || 0; // Shared clock-driven accumulation and morning melt.
    const step = Math.round(snow * SNOW_STEPS) / SNOW_STEPS; // Reuse the same low-frequency whole-zone mesh builder.
    return isWesternSlope(area) ? SURFACE_DEPTH * (1 + 0.5 * step) : SURFACE_DEPTH * Math.max(0.1, step);
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
          const tinted = window.getShadeFillCanvas(texture.image, 'environment-snow-micro-plateau-v7|canvas.png|white', {
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
      for (const consumer of snowMaterialConsumers) {
        consumer.map = snowTexture;
        consumer.needsUpdate = true;
      }
      snowMaterialConsumers.clear();
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
    cameraSurfaceState = null;
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

  // Every tile's base corners come straight from its authored walkable
  // height. The micro-plateau is then raised SURFACE_DEPTH above those
  // corners; cliff-side shaping never changes or borrows the base height.
  function tileSurfaceCorners(state, col, row) {
    if (col < 0 || row < 0 || col >= state.cols || row >= state.rows) return null;
    const cacheKey = row * state.cols + col;
    if (state.surfaceCache[cacheKey] !== undefined) return state.surfaceCache[cacheKey];
    const tile = state.grid?.[row]?.[col];
    if (!tileCovered(tile)) {
      state.surfaceCache[cacheKey] = null;
      return null;
    }
    const type = String(tile?.type || 'grass').toLowerCase();
    let corners;
    if (type !== 'ramp') {
      const surface = logicalSurfaceY(tile);
      corners = [surface, surface, surface, surface];
    } else {
      const fallback = logicalSurfaceY(tile);
      corners = [
        rampCornerY(state.grid, col, row, fallback),
        rampCornerY(state.grid, col + 1, row, fallback),
        rampCornerY(state.grid, col, row + 1, fallback),
        rampCornerY(state.grid, col + 1, row + 1, fallback),
      ];
    }
    state.surfaceCache[cacheKey] = corners;
    return corners;
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

  function walkableEdgeContinuous(state, col, row, side, dc, dr, baseCorners) {
    const neighbor = tileSurfaceCorners(state, col + dc, row + dr);
    if (!neighbor) return false;
    const ours = edgeCorners(baseCorners, side);
    const theirs = neighborEdgeCorners(neighbor, side);
    return Math.abs(ours[0] - theirs[0]) <= EDGE_HEIGHT_EPS && Math.abs(ours[1] - theirs[1]) <= EDGE_HEIGHT_EPS;
  }

  function addMicroPlateauTile(pos, idx, col, row, baseCorners, exposed, depthScale, lifted, cameraMasks, tileIndex) {
    const inset = Math.min(0.49, Math.max(0.001, EDGE_WIDTH));
    const axis = [0, inset, 1 - inset, 1];
    const baseAt = (u, v) => {
      const [y00, y10, y01, y11] = baseCorners;
      const north = y00 * (1 - u) + y10 * u;
      const south = y01 * (1 - u) + y11 * u;
      return north * (1 - v) + south * v;
    };
    const heights = new Float32Array(16); // Camera samples always retain the original 4x4 resolution.
    const flatInterior = !exposed.N && !exposed.E && !exposed.S && !exposed.W
      && Math.abs(baseCorners[0] + baseCorners[3] - baseCorners[1] - baseCorners[2]) < 0.00001; // A planar tile with no exposed incline.
    const base = pos.length / 3;
    if (flatInterior) {
      const depth = SURFACE_DEPTH * depthScale; // Same raised height with no redundant interior triangles.
      pos.push(col, baseCorners[0] + depth, row,
        col + 1, baseCorners[1] + depth, row,
        col, baseCorners[2] + depth, row + 1,
        col + 1, baseCorners[3] + depth, row + 1);
      idx.push(base, base + 2, base + 3, base, base + 3, base + 1);
      if (lifted) {
        lifted.push(1, 1, 1, 1);
        cameraMasks[tileIndex] = 0xffff;
      }
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        heights[j * 4 + i] = baseAt(axis[i], axis[j]) + depth; // Camera collision remains identical across detail levels.
      }
      compactTiles++;
      triangleCount += 2;
      return heights;
    }

    // Retain the exact rooted 4x4 mesh for cliff edges, holes and non-planar ramps.
    const depth = SURFACE_DEPTH * depthScale; // Only the outer vertices on exposed edges stay at ground height.
    let mask = 0; // One bit per raised vertex in the camera's 4×4 tile.
    for (let j = 0; j < axis.length; j++) {
      const v = axis[j];
      for (let i = 0; i < axis.length; i++) {
        const u = axis[i];
        const rooted = (j === 0 && exposed.N) || (i === 3 && exposed.E)
          || (j === 3 && exposed.S) || (i === 0 && exposed.W);
        const y = baseAt(u, v) + (rooted ? 0 : depth); // Mesh and camera use the same vertex elevation.
        pos.push(col + u, y, row + v);
        heights[j * 4 + i] = y;
        if (lifted) {
          lifted.push(rooted ? 0 : 1);
          if (!rooted) mask |= 1 << (j * 4 + i);
        }
      }
    }
    if (cameraMasks) cameraMasks[tileIndex] = mask;
    const width = axis.length;
    for (let j = 0; j < width - 1; j++) for (let i = 0; i < width - 1; i++) {
      const v00 = base + j * width + i;
      const v10 = v00 + 1;
      const v01 = v00 + width;
      const v11 = v01 + 1;
      idx.push(v00, v01, v11, v00, v11, v10);
    }
    detailedTiles++;
    triangleCount += 18;
    return heights;
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
        const mapped = mapper.mapGeometry(geometry, {
          label: `environment-snow-micro-plateau:${label}`,
          angleToleranceDeg: 89, // Snow only: keep the flat cap and ~45° rooted micro-inclines in one connected stretch-to-fit UV mass.
        });
        if (mapped?.getAttribute?.('uv')) return mapped;
      } catch (_) {}
    }
    return planarFallbackUv(geometry);
  }

  // Appends one chunk's cap+lip triangles into the shared whole-zone pos/idx
  // buffers (not its own geometry) so the stretch mapper below sees every
  // chunk as part of one connected surface — a real, contiguous plateau
  // must get one continuous texture domain, not one per render-chunk.
  function appendChunkGeometry(state, chunk, pos, idx, lifted) {
    const rowEnd = Math.min(state.rows, chunk.row + CHUNK_TILES);
    const colEnd = Math.min(state.cols, chunk.col + CHUNK_TILES);
    const sides = [['N',0,-1], ['E',1,0], ['S',0,1], ['W',-1,0]];

    for (let row = chunk.row; row < rowEnd; row++) {
      for (let col = chunk.col; col < colEnd; col++) {
        const baseCorners = tileSurfaceCorners(state, col, row);
        if (!baseCorners) continue;
        const exposed = { N:false, E:false, S:false, W:false }; // Marks only breaks in the authored walkable surface, never render-height gaps.
        for (const [side, dc, dr] of sides) {
          if (walkableEdgeContinuous(state, col, row, side, dc, dr, baseCorners)) continue;
          exposed[side] = true;
          exposedEdges++;
        }
        const tileIndex = row * state.cols + col; // Shared by camera heights and their depth mask.
        state.cameraHeights[tileIndex] = addMicroPlateauTile(pos, idx, col, row, baseCorners, exposed,
          state.depthScale, lifted, state.cameraMasks, tileIndex);
        builtTiles++;
      }
    }
  }

  // Slices one chunk's already-mapped triangles (by triangle range,
  // matching the order they were appended in) out of the combined,
  // non-indexed whole-zone geometry into its own small render mesh — pure
  // culling/draw-call partitioning, applied AFTER UV mapping so it never
  // affects texture continuity (the same order real terrain uses: split
  // into GPU-friendly spatial chunks only once the source UVs are final).
  function makeChunkMeshFromRange(combinedPosition, combinedUv, chunk, mode, state, indices, lifted) {
    const THREE = window.THREE;
    const vStart = chunk.triStart * 3, vCount = chunk.triCount * 3;
    const positions = new Float32Array(vCount * 3);
    const uvs = new Float32Array(vCount * 2);
    const raisedPositions = lifted ? [] : null; // Offsets of raised vertices in the chunk's XYZ buffer.
    const raisedHeights = lifted ? [] : null; // Reference heights avoid rounding drift over repeated steps.
    for (let i = 0; i < vCount; i++) {
      const src = vStart + i;
      positions[i * 3] = combinedPosition.getX(src);
      positions[i * 3 + 1] = combinedPosition.getY(src);
      positions[i * 3 + 2] = combinedPosition.getZ(src);
      if (lifted?.[indices[src]]) {
        raisedPositions.push(i * 3 + 1);
        raisedHeights.push(positions[i * 3 + 1]);
      }
      uvs[i * 2] = combinedUv.getX(src);
      uvs[i * 2 + 1] = combinedUv.getY(src);
    }
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.Float32BufferAttribute(positions, 3); // Retained and uploaded again on depth changes.
    geometry.setAttribute('position', position);
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (raisedPositions) {
      position.setUsage?.(THREE.DynamicDrawUsage);
      const maxDepth = isWesternSlope(activeArea) ? SURFACE_DEPTH * 1.5 : SURFACE_DEPTH; // Conservative culling bounds across all depth steps.
      geometry.boundingBox.min.y -= state.depth;
      geometry.boundingBox.max.y += maxDepth - state.depth;
      if (geometry.boundingSphere) geometry.boundingSphere.radius += Math.max(state.depth, maxDepth - state.depth);
      state.depthBuffers.push({
        position,
        offsets: new Uint16Array(raisedPositions), // A 16×16 chunk has at most 41,472 position components.
        heights: new Float32Array(raisedHeights),
      });
    }
    const mesh = new THREE.Mesh(geometry, material(mode));
    mesh.name = `environment_surface_micro_plateau_${mode}_${chunk.col}_${chunk.row}`;
    mesh.userData.environmentSurfaceRuntime = true;
    mesh.userData.environmentSurfaceMicroPlateau = true;
    mesh.renderOrder = mode === 'snow' ? 2.2 : 22.1;
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
    const depth = depthForMode(mode); // Shared accumulation-step height for every tile in this zone build.
    const state = {
      grid, cols, rows, depth, depthScale: depth / SURFACE_DEPTH,
      surfaceCache: new Array(cols * rows),
      cameraHeights: new Array(cols * rows),
      cameraMasks: mode === 'snow' ? new Uint16Array(cols * rows) : null,
      depthBuffers: [],
    }; // Retains the snow buffers and original camera samples across depth changes.
    root = new window.THREE.Group();
    root.name = `hobunji_environment_surface_micro_plateau_${mode}`;
    root.userData.environmentSurfaceRuntime = true;
    root.userData.environmentSurfaceMicroPlateau = true;
    root.userData.environmentSurfaceMode = mode;
    scene.add(root);

    builtTiles = 0;
    compactTiles = 0;
    detailedTiles = 0;
    triangleCount = 0;
    exposedEdges = 0;
    chunkCount = 0;
    const THREE = window.THREE;
    const pos = [], idx = [];
    const lifted = mode === 'snow' ? [] : null; // Raised vertices in source index order, before UV mapping expands triangles.
    const chunkRanges = [];
    for (let row = 0; row < rows; row += CHUNK_TILES) {
      for (let col = 0; col < cols; col += CHUNK_TILES) {
        const triStart = idx.length / 3;
        appendChunkGeometry(state, { col, row }, pos, idx, lifted);
        const triCount = idx.length / 3 - triStart;
        if (triCount > 0) chunkRanges.push({ col, row, triStart, triCount });
        chunkCount++;
      }
    }

    if (idx.length) {
      let combined = new THREE.BufferGeometry();
      combined.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      combined.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      if (mode === 'snow') snowUvMapRuns++;
      combined = mode === 'snow' ? stretchMapSnowUv(combined, 'zone') : planarFallbackUv(combined);
      if (combined.index) combined = combined.toNonIndexed();
      const combinedPosition = combined.getAttribute('position');
      const combinedUv = combined.getAttribute('uv');
      for (const chunk of chunkRanges) {
        makeChunkMeshFromRange(combinedPosition, combinedUv, chunk, mode, state, idx, lifted);
      }
    }

    activeDepth = state.depth;
    cameraSurfaceState = state;
    buildCount++;
    lastBuildMs = now() - started;
    if (grassHiddenScene !== scene) {
      setGrassHidden(scene, true); // Existing covered tiles stay hidden across depth-only rebuilds.
      grassHiddenScene = scene;
    }
    lastReason = `built ${builtTiles} ${mode} tiles (${compactTiles} compact, ${detailedTiles} detailed, ${triangleCount} triangles) in ${chunkCount} chunk meshes; ${exposedEdges} rooted edges (${lastBuildMs.toFixed(1)}ms)`;
  }

  function updateSnowDepth(depth) {
    const started = now(); // Measures CPU cost for the mobile performance snapshot.
    const delta = depth - cameraSurfaceState.depth; // Relative to the original build, independent of earlier steps.
    for (const { position, offsets, heights } of cameraSurfaceState.depthBuffers) {
      const positions = position.array; // Existing position buffer. UVs stay intact.
      for (let i = 0; i < offsets.length; i++) positions[offsets[i]] = heights[i] + delta;
      position.needsUpdate = true;
    }
    activeDepth = depth;
    snowDepthUpdates++;
    lastSnowDepthUpdateMs = now() - started;
  }

  function resetForScene(scene, area, mode) {
    const sameSurface = scene === activeScene && area === activeArea && mode === activeMode
      && (!root || cameraSurfaceState?.grid === currentGrid()); // A replaced terrain grid may bring new grass groups that need immediate snow hiding.
    if (!sameSurface && grassHiddenScene) {
      setGrassHidden(grassHiddenScene, false);
      grassHiddenScene = null;
    }
    disposeRoot();
    activeScene = scene;
    activeArea = area;
    activeMode = mode;
    activeDepth = 0;
    builtTiles = 0;
    compactTiles = 0;
    detailedTiles = 0;
    triangleCount = 0;
    exposedEdges = 0;
    chunkCount = 0;
    lastReason = 'waiting for grid data';
  }

  function tick(timestamp) {
    if (timestamp - lastFrameAt < 16) return;
    lastFrameAt = timestamp;
    const scene = currentScene();
    const area = currentArea();
    if (!scene || !window.THREE || !window.GridTileAccessors) return;
    if (!root && activeScene === scene && activeArea === area && activeMode === 'none'
        && timestamp - lastInactiveCheckAt < IDLE_POLL_INTERVAL_MS) {
      skippedInactiveTicks++;
      return; // Ordinary zones avoid all mesh, tile, season and snow computations between polls.
    }
    const mode = resolveMode();
    if (mode === 'none') {
      if (root) resetForScene(scene, area, mode);
      else { activeScene = scene; activeArea = area; activeMode = mode; }
      lastInactiveCheckAt = timestamp;
      lastReason = 'inactive (indoors, or outdoor but not snow/slush season)';
      return;
    }
    const gridChanged = !!root && cameraSurfaceState?.grid !== currentGrid(); // A Tothal terrain regeneration may replace the grid without changing the scene identity.
    if (scene !== activeScene || area !== activeArea || mode !== activeMode || gridChanged) resetForScene(scene, area, mode);
    if (root) {
      if (mode === 'snow') {
        const depth = depthForMode(mode, area); // Snow depth changes independently of the terrain and UV topology.
        if (depth !== activeDepth) updateSnowDepth(depth);
      }
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

  // Flat overlays retain their authored ground clearance above the cap. Use
  // its full depth even at an exposed lip so a ring's wider footprint cannot
  // cut back through adjacent snow. This is visual only, never collision.
  function projectionLiftAt(x, z, scene = currentScene()) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || scene !== currentScene()) return 0;
    // A dormant surface installs no GPU overlay, but world-space shadows and
    // markers still call this during rendering. Reuse the scheduler's recent
    // no-snow result rather than looking up the season for every mesh draw.
    if (!root && activeScene === scene && activeMode === 'none' && activeArea === currentArea()) {
      const idleAge = now() - lastInactiveCheckAt; // Same monotonic clock as the shared frame scheduler.
      if (idleAge >= 0 && idleAge < IDLE_POLL_INTERVAL_MS) {
        skippedDormantProjections++;
        return 0;
      }
    }
    const mode = resolveMode(); // Still resolve immediately before the first surface tick or after an area change.
    if (mode === 'none') return 0;
    const tile = currentGrid()?.[Math.floor(z)]?.[Math.floor(x)]; // Coverage under the overlay's world-space anchor.
    return tile && tileCovered(tile) ? (activeDepth || depthForMode(mode)) : 0; // Correct even before the initial mesh tick.
  }

  function hasCameraSurface() {
    return Boolean(root && root.visible && root.parent === currentScene() && activeArea === currentArea() && activeMode === resolveMode() && cameraSurfaceState);
  }

  // Interpolate the same two triangles as addMicroPlateauTile. This covers
  // caps, rooted lips and ramps exactly, without per-frame mesh raycasts or
  // changing the walkable surface used by players, creatures and pathing.
  function cameraSurfaceYAt(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !hasCameraSurface()) return null;
    const col = Math.floor(x), row = Math.floor(z); // Finds the built tile under the camera sample.
    const state = cameraSurfaceState; // Latest completed surface build, cleared on scene/season changes.
    if (col < 0 || row < 0 || col >= state.cols || row >= state.rows) return null;
    const tileIndex = row * state.cols + col; // Shared by the tile's height samples and depth mask.
    const heights = state.cameraHeights[tileIndex]; // Water and uncovered tiles have no camera surface.
    if (!heights) return null;
    const u = x - col, v = z - row; // Local coordinates in the tile's four-by-four vertex grid.
    const inset = Math.min(0.49, Math.max(0.001, EDGE_WIDTH)); // Matches the geometry builder's axis spacing.
    const i = u < inset ? 0 : u < 1 - inset ? 1 : 2; // Column of the rendered quad containing this sample.
    const j = v < inset ? 0 : v < 1 - inset ? 1 : 2; // Row of the rendered quad containing this sample.
    const cellX = i === 0 ? 0 : i === 1 ? inset : 1 - inset; // Quad's left edge.
    const cellZ = j === 0 ? 0 : j === 1 ? inset : 1 - inset; // Quad's north edge.
    const a = (u - cellX) / (i === 1 ? 1 - 2 * inset : inset); // Fraction across the rendered quad.
    const b = (v - cellZ) / (j === 1 ? 1 - 2 * inset : inset); // Fraction down the rendered quad.
    const base = j * 4 + i; // Top-left vertex of the quad, split along its top-left/bottom-right diagonal.
    const lower = b >= a; // Selects the triangle containing the camera sample.
    const side = base + (lower ? 4 : 1); // Third corner of the selected triangle.
    const weightBase = 1 - Math.max(a, b);
    const weightFar = Math.min(a, b);
    const weightSide = Math.abs(a - b);
    const height = heights[base] * weightBase + heights[base + 5] * weightFar + heights[side] * weightSide;
    const delta = activeDepth - state.depth;
    if (delta === 0) return height;
    const mask = state.cameraMasks[tileIndex]; // Grounded lip vertices do not rise with the snow cap.
    if (mask === 0xffff) return height + delta;
    const extraHeight = delta * (((mask >> base) & 1) * weightBase
      + ((mask >> (base + 5)) & 1) * weightFar + ((mask >> side) & 1) * weightSide);
    return height + extraHeight;
  }

  function bindGroundProjection(object) {
    if (!object) return object;
    // Install once at creation, including each drawable child of HUD groups.
    // Render hooks run after parent transforms, covering NPC-local shadows
    // and scene-level indicators without changing their gameplay positions.
    object.traverse(node => {
      if ((!node.isMesh && !node.isLine && !node.isPoints) || node.userData.environmentGroundProjection) return;
      node.userData.environmentGroundProjection = true;
      node.renderOrder = Math.max(Number(node.renderOrder) || 0, 23); // Draw after the transparent slush cap (22.1).
      const before = node.onBeforeRender; // Preserves the drawable's existing render callback.
      const after = node.onAfterRender; // Preserves cleanup after restoring the gameplay matrix.
      let lift = 0; // Temporary world-space translation, removed after each draw.
      node.onBeforeRender = function(renderer, scene, ...args) {
        before?.call(this, renderer, scene, ...args);
        const elements = this.matrixWorld.elements; // Final parent-composed transform used for this draw.
        lift = projectionLiftAt(elements[12], elements[14], scene);
        elements[13] += lift;
      };
      node.onAfterRender = function(...args) {
        this.matrixWorld.elements[13] -= lift;
        lift = 0;
        after?.apply(this, args);
      };
    });
    return object;
  }

  function debugSnapshot() {
    const mode = resolveMode();
    return {
      installed: true,
      version: 7,
      active: Boolean(root),
      area: currentArea() || null,
      mode,
      thickness: activeDepth || depthForMode(mode),
      groundProjectionLift: activeDepth || depthForMode(mode),
      shiftSnowFraction: window.TothalBlizzard?.snowCoverageFor?.(currentArea()) || 0,
      cameraCollision: hasCameraSurface(),
      latestChange: 'Camera terrain collision includes rendered snow/slush caps and inclined edges; player collision stays at the authored ground.',
      edgeWidth: EDGE_WIDTH,
      opacity: MODE_PRESETS[mode]?.opacity ?? null,
      builtTiles,
      compactTiles,
      detailedTiles,
      triangleCount,
      exposedEdges,
      chunkCount,
      snowMeshCount: activeMode === 'snow' ? (root?.children?.length || 0) : 0, // Mobile QA: zero outside snowy areas.
      skippedInactiveTicks, // Mobile QA: inactive scheduler frames that skipped the work.
      skippedDormantProjections, // Mobile QA: render hooks that didn't look up snow/season while dormant.
      snowUvMapRuns, // Mobile QA: expensive whole-zone UV relaxations performed.
      snowDepthUpdates,
      lastSnowDepthUpdateMs: Number(lastSnowDepthUpdateMs.toFixed(2)),
      buildCount,
      lastBuildMs: Number(lastBuildMs.toFixed(2)),
      textureState,
      lastReason,
    };
  }

  window.EnvironmentSurfaceMicroPlateau = Object.freeze({ installed: true, debugSnapshot, getSnowMaterial: () => material('snow'), bindSnowTexture(target) { if (!target) return false; target.map = snowTexture; if (snowTexture) target.needsUpdate = true; else { snowMaterialConsumers.add(target); ensureTexture(); } return true; }, unbindSnowTexture(target) { return snowMaterialConsumers.delete(target); }, forceRebuild, projectionLiftAt, bindGroundProjection, hasCameraSurface, cameraSurfaceYAt }); // Decorative snow consumers opt into the lazy shared texture.
  // Zero snow texture requests until a snowy scene or an actual material consumer exists.

  // The shipped game always provides RuntimeFrameScheduler; the standalone
  // Wilderness Generation Lab and snow-runtime-test.html tool pages load
  // this module directly without it, so they keep the original self-scheduled
  // RAF loop.
  if (window.RuntimeFrameScheduler?.register) {
    window.RuntimeFrameScheduler.register('environment-surface-micro-plateau-tick', frameContext => {
      tick(Number(frameContext?.timestamp) || now());
    }, {
      owner: 'EnvironmentSurfaceMicroPlateau',
      description: 'Rebuilds/maintains the snow/slush micro-plateau surface mesh for the active outdoor zone.',
    });
  } else {
    const fallbackTick = timestamp => {
      requestAnimationFrame(fallbackTick);
      tick(timestamp);
    };
    requestAnimationFrame(fallbackTick);
  }
})();
