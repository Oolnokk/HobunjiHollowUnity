(() => {
  'use strict';

  const THREE = window.THREE;
  const tileRing = window.HobunjiSurfaceTileRing;
  if (!THREE || !tileRing?.installed || window.HobunjiSurfaceTileMaterialParity?.installed) return;

  const ENV_EDGE_HEIGHT_EPS = 0.025;
  const PLATEAU_UNIT = 2.5;
  const ENV_LOGICAL_OFFSETS = Object.freeze({ trench: -0.5, raised: 0.5 });
  const ENV_LAND_TYPES = new Set(['grass', 'path', 'tilled', 'trench', 'raised', 'paddy', 'rock', 'shrub', 'cliff', 'ramp', 'weeds']);
  const ENV_WATER_TYPES = new Set(['water', 'river', 'stream', 'waterfall']);
  const pendingRoots = new WeakSet();
  const state = {
    installed: true,
    snowFits: 0,
    snowFitFallbacks: 0,
    snowVertices: 0,
    restoredInkCanvases: 0,
    restoredInkPixels: 0,
    ignoredSlushRoots: 0,
    recent: [],
  };

  function debugLog(message, level = 'info') {
    const text = `[snow-tile-ring] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function remember(entry) {
    state.recent.push(entry);
    while (state.recent.length > 16) state.recent.shift();
  }

  function configuredSourceEdge() {
    const value = Number(window.NaturalSurfaceMaterialConfig?.perimeterFrame?.sourceEdgeFraction);
    return Number.isFinite(value) ? Math.max(0.001, Math.min(0.49, value)) : 0.45;
  }

  function configuredRingWidth() {
    const value = Number(window.NaturalSurfaceMaterialConfig?.perimeterFrame?.tileRingWorldWidth);
    return Number.isFinite(value) ? Math.max(0.001, value) : 1;
  }

  function restorePureBlackPixels(sourceImage, tintedCanvas) {
    try {
      if (!sourceImage || !tintedCanvas?.getContext) return tintedCanvas;
      const width = sourceImage.naturalWidth || sourceImage.width;
      const height = sourceImage.naturalHeight || sourceImage.height;
      if (!width || !height || tintedCanvas.width !== width || tintedCanvas.height !== height) return tintedCanvas;
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = width;
      sourceCanvas.height = height;
      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      const targetContext = tintedCanvas.getContext('2d', { willReadFrequently: true });
      sourceContext.drawImage(sourceImage, 0, 0, width, height);
      const source = sourceContext.getImageData(0, 0, width, height);
      const target = targetContext.getImageData(0, 0, width, height);
      let restored = 0;
      for (let i = 0; i < source.data.length; i += 4) {
        if (!source.data[i + 3]) continue;
        if (source.data[i] > 1 || source.data[i + 1] > 1 || source.data[i + 2] > 1) continue;
        target.data[i] = 0;
        target.data[i + 1] = 0;
        target.data[i + 2] = 0;
        restored++;
      }
      if (restored) {
        targetContext.putImageData(target, 0, 0);
        state.restoredInkCanvases++;
        state.restoredInkPixels += restored;
      }
      return tintedCanvas;
    } catch (_) {
      return tintedCanvas;
    }
  }

  function installSnowShadeFillPreservation() {
    const previous = window.getShadeFillCanvas;
    if (typeof previous !== 'function' || previous.__hobunjiSnowInkPreservation) return false;
    const wrapped = function (sourceImage, cacheKey, ...rest) {
      const result = previous.call(this, sourceImage, cacheKey, ...rest);
      const key = String(cacheKey || '');
      return /environment-snow-micro-plateau/i.test(key) && /canvas\.png/i.test(key)
        ? restorePureBlackPixels(sourceImage, result)
        : result;
    };
    wrapped.__hobunjiSnowInkPreservation = true;
    wrapped.__hobunjiSnowInkOriginal = previous;
    window.getShadeFillCanvas = wrapped;
    return true;
  }

  function currentGrid() {
    try { return window.GridTileAccessors?.getActiveGrid?.() || null; }
    catch (_) { return null; }
  }

  function logicalSurfaceY(tile) {
    const type = String(tile?.type || 'grass').toLowerCase();
    if (type === 'ramp') return (Number(tile?.rampElevation) || 0) * PLATEAU_UNIT;
    return (Number(tile?.elevTier) || 0) * PLATEAU_UNIT + Number(ENV_LOGICAL_OFFSETS[type] || 0);
  }

  function rampCornerY(grid, ci, cj, fallback) {
    let sum = 0;
    let count = 0;
    for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const tile = grid?.[cj + dr]?.[ci + dc];
      if (String(tile?.type || '').toLowerCase() !== 'ramp') continue;
      sum += (Number(tile.rampElevation) || 0) * PLATEAU_UNIT;
      count++;
    }
    return count ? sum / count : fallback;
  }

  function tileCorners(grid, col, row) {
    const tile = grid?.[row]?.[col];
    const type = String(tile?.type || 'grass').toLowerCase();
    if (!ENV_LAND_TYPES.has(type) || ENV_WATER_TYPES.has(type)) return null;
    if (type !== 'ramp') {
      const y = logicalSurfaceY(tile);
      return [y, y, y, y];
    }
    const fallback = logicalSurfaceY(tile);
    return [
      rampCornerY(grid, col, row, fallback),
      rampCornerY(grid, col + 1, row, fallback),
      rampCornerY(grid, col, row + 1, fallback),
      rampCornerY(grid, col + 1, row + 1, fallback),
    ];
  }

  function snowCells(grid) {
    const rows = grid?.length || 0;
    const cols = grid?.[0]?.length || 0;
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const corners = tileCorners(grid, col, row);
        if (corners) cells.push({ col, row, visible: true, corners });
      }
    }
    return cells;
  }

  function cellsConnect(a, b, dc, dr) {
    const ac = a?.corners;
    const bc = b?.corners;
    if (!ac || !bc) return false;
    let ours;
    let theirs;
    if (dc === 1) { ours = [ac[1], ac[3]]; theirs = [bc[0], bc[2]]; }
    else if (dc === -1) { ours = [ac[0], ac[2]]; theirs = [bc[1], bc[3]]; }
    else if (dr === 1) { ours = [ac[2], ac[3]]; theirs = [bc[0], bc[1]]; }
    else { ours = [ac[0], ac[1]]; theirs = [bc[2], bc[3]]; }
    return Math.abs(ours[0] - theirs[0]) <= ENV_EDGE_HEIGHT_EPS
      && Math.abs(ours[1] - theirs[1]) <= ENV_EDGE_HEIGHT_EPS;
  }

  function remapEnvironmentRoot(root) {
    if (!root?.parent || !root.userData?.environmentSurfaceMicroPlateau) return false;
    const mode = String(root.userData.environmentSurfaceMode || 'none');
    if (mode === 'slush') {
      state.ignoredSlushRoots++;
      return false;
    }
    if (mode !== 'snow') return false;

    const cells = snowCells(currentGrid());
    if (!cells.length) return false;
    const meshes = (root.children || []).filter(child => child?.isMesh && child.geometry?.getAttribute?.('position'));
    if (!meshes.length) return false;

    const positions = [];
    const targets = [];
    for (const mesh of meshes) {
      let geometry = mesh.geometry;
      if (geometry.index) {
        const expanded = geometry.toNonIndexed();
        mesh.geometry = expanded;
        geometry.dispose?.();
        geometry = expanded;
      }
      const position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        positions.push(position.getX(i), position.getY(i), position.getZ(i));
        targets.push({ mesh, geometry, index: i });
      }
    }
    if (!positions.length || (positions.length / 3) % 3 !== 0) return false;

    const combined = new THREE.BufferGeometry();
    combined.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const fitted = tileRing.fitTileClusterGeometry(combined, cells, {
      label: 'environment-snow:whole-zone',
      angleToleranceDeg: 89,
      targetAttributeName: 'aStretchUv',
      flagAttributeName: 'aStretchFlag',
      connectCells,
      tileRingWorldWidth: configuredRingWidth(),
      sourceEdgeFraction: configuredSourceEdge(),
    });
    const stretch = fitted?.getAttribute?.('aStretchUv');
    if (!stretch || stretch.count !== targets.length) {
      state.snowFitFallbacks++;
      if (fitted && fitted !== combined) fitted.dispose?.();
      combined.dispose?.();
      return false;
    }

    let offset = 0;
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      const count = geometry.getAttribute('position').count;
      const uvArray = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        uvArray[i * 2] = stretch.getX(offset + i);
        uvArray[i * 2 + 1] = stretch.getY(offset + i);
      }
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));
      geometry.userData = Object.assign({}, geometry.userData || {}, {
        hobunjiSnowTileRing: true,
        hobunjiSnowTileRingWidth: configuredRingWidth(),
        hobunjiSnowSourceEdgeFraction: configuredSourceEdge(),
      });
      offset += count;
    }

    root.userData.hobunjiEnvironmentTileRing = {
      mode: 'tile-measured-outer-ring',
      surface: 'snow',
      tileCount: cells.length,
      vertexCount: targets.length,
      sourceEdgeFraction: configuredSourceEdge(),
      componentCount: Number(fitted.userData?.hobunjiSurfaceTileRing?.componentCount || 0),
    };
    state.snowFits++;
    state.snowVertices += targets.length;
    remember({ kind: 'snow', tiles: cells.length, vertices: targets.length, components: root.userData.hobunjiEnvironmentTileRing.componentCount });
    if (fitted !== combined) fitted.dispose?.();
    combined.dispose?.();
    return true;
  }

  function scheduleRoot(root) {
    if (!root || pendingRoots.has(root)) return;
    pendingRoots.add(root);
    const run = () => {
      pendingRoots.delete(root);
      remapEnvironmentRoot(root);
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  function installEnvironmentRootHook() {
    const proto = THREE.Object3D?.prototype;
    if (!proto || proto.__hobunjiSnowTileRingAddHook || typeof proto.add !== 'function') return;
    const originalAdd = proto.add;
    proto.add = function (...objects) {
      const result = originalAdd.apply(this, objects);
      if (this?.userData?.environmentSurfaceMicroPlateau) scheduleRoot(this);
      for (const object of objects) if (object?.userData?.environmentSurfaceMicroPlateau) scheduleRoot(object);
      return result;
    };
    proto.add.__hobunjiSnowTileRingOriginal = originalAdd;
    proto.__hobunjiSnowTileRingAddHook = true;
  }

  installSnowShadeFillPreservation();
  installEnvironmentRootHook();

  window.HobunjiSurfaceTileMaterialParity = {
    installed: true,
    scope: 'snow-only',
    remapEnvironmentRoot,
    restorePureBlackPixels,
    snapshot() { return Object.assign({}, state, { recent: state.recent.slice() }); },
  };

  debugLog('protected tile ring installed for snow only; slush, grass, cliffs and rocks keep their established rendering.');
})();