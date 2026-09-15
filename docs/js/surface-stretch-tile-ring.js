(() => {
  'use strict';

  const DEFAULT_TILE_RING_WORLD_WIDTH = 1;
  const DEFAULT_SOURCE_EDGE_FRACTION = 0.16;
  const DEFAULT_SPLIT_ANGLE_DEG = 24;
  const DEBUG_HISTORY_LIMIT = 16;
  const state = {
    rendererInstallAttempts: 0,
    rendererInstalled: false,
    lateHookInstalled: false,
    remappedMeshes: 0,
    remappedVertices: 0,
    genericFits: 0,
    genericFallbacks: 0,
    invertedSkips: 0,
    missingUvSkips: 0,
    recent: [],
  };

  function debugLog(message, level = 'info') {
    const text = `[surface-tile-ring] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function configuredSourceEdge() {
    const value = Number(window.NaturalSurfaceMaterialConfig?.perimeterFrame?.sourceEdgeFraction);
    return Number.isFinite(value) ? Math.max(0.001, Math.min(0.49, value)) : DEFAULT_SOURCE_EDGE_FRACTION;
  }

  function configuredRingWidth() {
    const value = Number(window.NaturalSurfaceMaterialConfig?.perimeterFrame?.tileRingWorldWidth);
    return Number.isFinite(value) ? Math.max(0.001, value) : DEFAULT_TILE_RING_WORLD_WIDTH;
  }

  function tileKey(col, row) { return `${col},${row}`; }

  function cellsConnect(a, b, dc, dr, options) {
    if (!a || !b) return false;
    if (typeof options?.connectCells === 'function') {
      try { return options.connectCells(a, b, dc, dr) !== false; }
      catch (_) { return false; }
    }
    const field = options?.groupKeyField || 'groupKey';
    if (a[field] != null || b[field] != null) return String(a[field] ?? '') === String(b[field] ?? '');
    return true;
  }

  function buildTileComponents(cells, options = {}) {
    const byKey = new Map();
    for (const source of cells || []) {
      if (!source || source.visible === false || !Number.isFinite(source.col) || !Number.isFinite(source.row)) continue;
      const col = Math.floor(source.col);
      const row = Math.floor(source.row);
      byKey.set(tileKey(col, row), Object.assign({}, source, { col, row, componentId: -1 }));
    }

    const components = [];
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const cell of byKey.values()) {
      if (cell.componentId >= 0) continue;
      const component = { id: components.length, cells: [], boundarySegments: [], maxVertexDistance: 0 };
      const stack = [cell];
      cell.componentId = component.id;
      while (stack.length) {
        const current = stack.pop();
        component.cells.push(current);
        for (const [dc, dr] of directions) {
          const neighbor = byKey.get(tileKey(current.col + dc, current.row + dr));
          if (!neighbor || neighbor.componentId >= 0 || !cellsConnect(current, neighbor, dc, dr, options)) continue;
          neighbor.componentId = component.id;
          stack.push(neighbor);
        }
      }
      components.push(component);
    }

    for (const component of components) {
      for (const cell of component.cells) {
        const sides = [
          [-1, 0, [cell.col, cell.row, cell.col, cell.row + 1]],
          [1, 0, [cell.col + 1, cell.row, cell.col + 1, cell.row + 1]],
          [0, -1, [cell.col, cell.row, cell.col + 1, cell.row]],
          [0, 1, [cell.col, cell.row + 1, cell.col + 1, cell.row + 1]],
        ];
        for (const [dc, dr, segment] of sides) {
          const neighbor = byKey.get(tileKey(cell.col + dc, cell.row + dr));
          if (!neighbor || neighbor.componentId !== component.id || !cellsConnect(cell, neighbor, dc, dr, options)) {
            component.boundarySegments.push(segment);
          }
        }
      }
    }
    return { byKey, components };
  }

  function pointSegmentDistance2D(x, z, segment) {
    const [x0, z0, x1, z1] = segment;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 1e-12 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / lengthSq)) : 0;
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    return Math.hypot(x - px, z - pz);
  }

  function componentBoundaryDistance(component, x, z) {
    let best = Infinity;
    for (const segment of component?.boundarySegments || []) best = Math.min(best, pointSegmentDistance2D(x, z, segment));
    return Number.isFinite(best) ? best : 0;
  }

  function componentForPoint(topology, x, z) {
    const direct = topology.byKey.get(tileKey(Math.floor(x + 1e-7), Math.floor(z + 1e-7)));
    if (direct) return topology.components[direct.componentId] || null;
    let best = null;
    let distance = Infinity;
    for (const component of topology.components) {
      const next = componentBoundaryDistance(component, x, z);
      if (next < distance) { distance = next; best = component; }
    }
    return best;
  }

  function selectedRanges(geometry, materialIndex, count) {
    if (materialIndex == null) return [[0, count]];
    const groups = Array.isArray(geometry?.groups) ? geometry.groups : [];
    if (!groups.length) return Number(materialIndex) === 0 ? [[0, count]] : [];
    const ranges = [];
    for (const group of groups) {
      if (Number(group.materialIndex || 0) !== Number(materialIndex)) continue;
      const start = Math.max(0, Math.min(count, Number(group.start) || 0));
      const end = Math.max(start, Math.min(count, start + Math.max(0, Number(group.count) || 0)));
      if (end > start) ranges.push([start, end]);
    }
    return ranges;
  }

  function indexInRanges(index, ranges) {
    for (const [start, end] of ranges) if (index >= start && index < end) return true;
    return false;
  }

  function setSquareDepth(uv, index, targetDepth) {
    const u = uv.getX(index);
    const v = uv.getY(index);
    const dx = u - 0.5;
    const dy = v - 0.5;
    const maxAbs = Math.max(Math.abs(dx), Math.abs(dy));
    if (maxAbs <= 1e-8) { uv.setXY(index, 0.5, 0.5); return; }
    const depth = Math.max(0, Math.min(0.5, targetDepth));
    const scale = (0.5 - depth) / maxAbs;
    uv.setXY(index, 0.5 + dx * scale, 0.5 + dy * scale);
  }

  function applyTileMeasuredRingUv(geometry, cells, options = {}) {
    const position = geometry?.getAttribute?.('position');
    const attributeName = options.attributeName || 'aStretchUv';
    const sourceUv = geometry?.getAttribute?.(attributeName);
    if (!position || !sourceUv || sourceUv.count !== position.count || !Array.isArray(cells) || !cells.length) return null;

    const topology = buildTileComponents(cells, options);
    if (!topology.components.length) return null;
    const ringWidth = Math.max(0.001, Number(options.tileRingWorldWidth) || configuredRingWidth());
    const requestedEdge = Number(options.sourceEdgeFraction);
    const sourceEdge = Math.max(0.001, Math.min(0.49, Number.isFinite(requestedEdge) ? requestedEdge : DEFAULT_SOURCE_EDGE_FRACTION));
    const distances = new Float32Array(position.count);
    const componentIds = new Int32Array(position.count);
    componentIds.fill(-1);
    const ranges = selectedRanges(geometry, options.materialIndex, position.count);

    const triangleCount = Math.floor(position.count / 3);
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const base = triangle * 3;
      if (!indexInRanges(base, ranges)) continue;
      const centroidX = (position.getX(base) + position.getX(base + 1) + position.getX(base + 2)) / 3;
      const centroidZ = (position.getZ(base) + position.getZ(base + 1) + position.getZ(base + 2)) / 3;
      const component = componentForPoint(topology, centroidX, centroidZ);
      if (!component) continue;
      for (let corner = 0; corner < 3; corner++) {
        const index = base + corner;
        const distance = componentBoundaryDistance(component, position.getX(index), position.getZ(index));
        distances[index] = distance;
        componentIds[index] = component.id;
        component.maxVertexDistance = Math.max(component.maxVertexDistance, distance);
      }
    }

    const measuredUv = sourceUv.clone();
    let remappedVertices = 0;
    for (let index = 0; index < position.count; index++) {
      const componentId = componentIds[index];
      if (componentId < 0) continue;
      const component = topology.components[componentId];
      const distance = distances[index];
      let targetDepth;
      if (distance <= ringWidth + 1e-7) {
        targetDepth = sourceEdge * Math.max(0, Math.min(1, distance / ringWidth));
      } else {
        const interiorSpan = Math.max(1e-6, component.maxVertexDistance - ringWidth);
        const interiorT = Math.max(0, Math.min(1, (distance - ringWidth) / interiorSpan));
        targetDepth = sourceEdge + (0.5 - sourceEdge) * interiorT;
      }
      setSquareDepth(measuredUv, index, targetDepth);
      remappedVertices++;
    }

    measuredUv.needsUpdate = true;
    geometry.setAttribute(attributeName, measuredUv);
    const report = {
      mode: 'tile-measured-outer-ring',
      tileRingWorldWidth: ringWidth,
      sourceEdgeFraction: sourceEdge,
      componentCount: topology.components.length,
      boundarySegmentCount: topology.components.reduce((sum, component) => sum + component.boundarySegments.length, 0),
      remappedVertices,
      materialIndex: options.materialIndex == null ? null : Number(options.materialIndex),
    };
    geometry.userData = Object.assign({}, geometry.userData || {}, { hobunjiSurfaceTileRing: report });
    if (geometry.userData.waterBankOutline) {
      geometry.userData.waterBankOutline.edgeFrameMode = report.mode;
      geometry.userData.waterBankOutline.tileRingWorldWidth = ringWidth;
      geometry.userData.waterBankOutline.sourceEdgeFraction = sourceEdge;
    }
    return report;
  }

  function fitTileClusterGeometry(sourceGeometry, cells, options = {}) {
    const THREE = window.THREE;
    const mapper = window.HobunjiSurfaceStretchUV;
    if (!THREE?.Float32BufferAttribute || typeof mapper?.mapGeometry !== 'function' || !sourceGeometry?.getAttribute?.('position')) return sourceGeometry;
    const expanded = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
    const position = expanded.getAttribute('position');
    const baseUv = expanded.getAttribute('uv')?.clone() || null;
    const label = options.label || 'tile-cluster-surface';
    const mapperOptions = {
      label,
      angleToleranceDeg: Number(options.angleToleranceDeg) || Number(mapper.settings?.angleToleranceDeg) || DEFAULT_SPLIT_ANGLE_DEG,
    };
    if (options.materialIndex != null) mapperOptions.materialIndex = Number(options.materialIndex);

    let mapped;
    try { mapped = mapper.mapGeometry(expanded, mapperOptions); }
    catch (error) {
      state.genericFallbacks++;
      debugLog(`${label}: shared Jigsaw map failed (${error?.message || error}); keeping existing geometry.`, 'warn');
      expanded.dispose?.();
      return sourceGeometry;
    }
    const mappedPosition = mapped?.getAttribute?.('position');
    const fittedUv = mapped?.getAttribute?.('uv');
    if (!mappedPosition || !fittedUv || fittedUv.count !== mappedPosition.count || mappedPosition.count !== position.count) {
      state.genericFallbacks++;
      if (mapped && mapped !== expanded && mapped !== sourceGeometry) mapped.dispose?.();
      expanded.dispose?.();
      return sourceGeometry;
    }

    const report = applyTileMeasuredRingUv(mapped, cells, Object.assign({}, options, { attributeName: 'uv' }));
    if (!report) {
      state.genericFallbacks++;
      if (mapped && mapped !== expanded && mapped !== sourceGeometry) mapped.dispose?.();
      expanded.dispose?.();
      return sourceGeometry;
    }

    mapped.setAttribute(options.targetAttributeName || 'aStretchUv', mapped.getAttribute('uv').clone());
    const ranges = selectedRanges(mapped, options.materialIndex, mappedPosition.count);
    const flags = new Float32Array(mappedPosition.count);
    for (const [start, end] of ranges) for (let i = start; i < end; i++) flags[i] = 1;
    mapped.setAttribute(options.flagAttributeName || 'aStretchFlag', new THREE.Float32BufferAttribute(flags, 1));
    if (baseUv?.count === mappedPosition.count) mapped.setAttribute('uv', baseUv);
    mapped.userData = Object.assign({}, mapped.userData || {}, {
      hobunjiTileClusterFit: Object.assign({ label, targetAttribute: options.targetAttributeName || 'aStretchUv' }, report),
    });
    mapped.computeBoundingBox?.();
    mapped.computeBoundingSphere?.();
    if (mapped !== expanded) expanded.dispose?.();
    state.genericFits++;
    return mapped;
  }

  function installOnRenderer(candidate) {
    state.rendererInstallAttempts++;
    if (!candidate?.createMesh) return false;
    if (candidate.__hobunjiSurfaceTileRingInstalled) { state.rendererInstalled = true; return true; }
    const originalCreateMesh = candidate.createMesh;
    candidate.createMesh = function (ThreeArg, material, cells, options = {}) {
      const mesh = originalCreateMesh.call(this, ThreeArg, material, cells, options);
      if (!mesh?.geometry?.getAttribute?.('aStretchUv')) { state.missingUvSkips++; return mesh; }
      const statKey = mesh.userData?.mergedWaterStatKey || options.statKey || mesh.name;
      const stat = candidate.stats?.[statKey];
      const representation = String(stat?.representation || '');
      if (!representation.startsWith('tile-merged')) { state.invertedSkips++; return mesh; }
      const report = applyTileMeasuredRingUv(mesh.geometry, cells, {
        attributeName: 'aStretchUv',
        tileRingWorldWidth: configuredRingWidth(),
        sourceEdgeFraction: configuredSourceEdge(),
      });
      if (!report) return mesh;
      state.remappedMeshes++;
      state.remappedVertices += report.remappedVertices;
      const entry = { key: statKey, mode: report.mode, components: report.componentCount, edges: report.boundarySegmentCount, width: report.tileRingWorldWidth, sourceEdgeFraction: report.sourceEdgeFraction };
      state.recent.push(entry);
      while (state.recent.length > DEBUG_HISTORY_LIMIT) state.recent.shift();
      if (stat) {
        stat.waterBankEdgeFrameMode = report.mode;
        stat.waterBankTileRingWorldWidth = report.tileRingWorldWidth;
        stat.waterBankSourceEdgeFraction = report.sourceEdgeFraction;
      }
      return mesh;
    };
    candidate.createMesh.__hobunjiSurfaceTileRingOriginal = originalCreateMesh;
    candidate.__hobunjiSurfaceTileRingInstalled = true;
    state.rendererInstalled = true;
    return true;
  }

  function installLateRendererHook() {
    if (installOnRenderer(window.MergedWaterRenderer)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'MergedWaterRenderer');
    if (descriptor && descriptor.configurable === false) {
      window.addEventListener?.('load', () => installOnRenderer(window.MergedWaterRenderer), { once: true });
      return;
    }
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    let value = oldGet ? oldGet.call(window) : descriptor?.value;
    Object.defineProperty(window, 'MergedWaterRenderer', {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return oldGet ? oldGet.call(window) : value; },
      set(next) {
        if (oldSet) { oldSet.call(window, next); value = oldGet ? oldGet.call(window) : next; }
        else value = next;
        installOnRenderer(value);
      },
    });
    state.lateHookInstalled = true;
  }

  window.HobunjiSurfaceTileRing = {
    installed: true,
    defaultTileRingWorldWidth: DEFAULT_TILE_RING_WORLD_WIDTH,
    configuredSourceEdge,
    buildTileComponents,
    applyTileMeasuredRingUv,
    fitTileClusterGeometry,
    installOnRenderer,
    snapshot() { return Object.assign({}, state, { recent: state.recent.slice() }); },
  };

  installLateRendererHook();
})();