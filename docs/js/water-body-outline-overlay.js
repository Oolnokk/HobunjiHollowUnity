(() => {
  'use strict';

  const THREE = window.THREE;
  const mapper = window.HobunjiSurfaceStretchUV;
  if (!THREE?.BufferGeometry || !mapper?.mapGeometry || window.WaterBodyOutlineOverlay?.installed) return;

  const OVERLAY_TEXTURE_URL = 'assets/textures/canvas.png';
  const SOURCE_EDGE_FRACTION = 0.45;
  const TILE_RING_WORLD_WIDTH = 1;
  const BLACK_EPSILON = 1;
  const DEBUG_HISTORY_LIMIT = 16;

  let terrainDeps = null;
  let mergedRenderer = window.MergedWaterRenderer || null;
  let sharedOutlineTexture = null;
  let outlineTextureLoading = false;
  const outlineTextureConsumers = [];
  const domainCache = new WeakMap();
  const state = {
    installed: true,
    materialPatches: 0,
    mergedMeshDefaults: 0,
    mappedWaterMeshes: 0,
    mappedVertices: 0,
    mappedDomains: 0,
    mappedComponents: 0,
    connectorEdges: 0,
    waterfallSheetsTagged: 0,
    maskPixels: 0,
    failures: 0,
    recent: [],
  };

  function debugLog(message, level = 'info') {
    const text = '[water-body-overlay] ' + message;
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function remember(entry) {
    state.recent.push(entry);
    while (state.recent.length > DEBUG_HISTORY_LIMIT) state.recent.shift();
  }

  function tileKey(col, row) { return col + ',' + row; }
  function cornerKey(x, z) { return Math.round(x) + ',' + Math.round(z); }

  function isWaterType(type) {
    const TileType = terrainDeps?.TileType;
    return !!TileType && (type === TileType.RIVER || type === TileType.STREAM || type === TileType.WATERFALL);
  }

  function isWaterfallType(type) {
    return !!terrainDeps?.TileType && type === terrainDeps.TileType.WATERFALL;
  }

  function conceptualTierY(tile) {
    return Number(tile?.elevTier || 0) * Math.max(0.001, Number(terrainDeps?.PLATEAU_UNIT) || 1);
  }

  function point3Key(point) {
    const q = value => Math.round(Number(value) * 10000) / 10000;
    return q(point[0]) + ',' + q(point[1]) + ',' + q(point[2]);
  }

  function edge3Key(aKey, bKey) {
    return aKey < bKey ? aKey + '|' + bKey : bKey + '|' + aKey;
  }

  function gridEdgeKey(x0, z0, x1, z1) {
    const a = Math.round(x0) + ',' + Math.round(z0);
    const b = Math.round(x1) + ',' + Math.round(z1);
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function makeFace(id, kind, vertices, meta = {}) {
    return {
      id,
      kind,
      vertices,
      vertexKeys: vertices.map(point3Key),
      meta,
      componentId: -1,
    };
  }

  function buildFoldedSurfaceTopology(zGrid, zcols, zrows) {
    const waterCellsByKey = new Map();
    const faces = [];
    const faceById = new Map();
    const waterFaceByCell = new Map();
    const curtainFaceByGridEdge = new Map();
    const emittedCurtains = new Set();

    const addFace = face => {
      faces.push(face);
      faceById.set(face.id, face);
      return face;
    };

    for (let row = 0; row < zrows; row++) {
      for (let col = 0; col < zcols; col++) {
        const tile = zGrid?.[row]?.[col];
        if (!tile || !isWaterType(tile.type)) continue;
        const key = tileKey(col, row);
        waterCellsByKey.set(key, { col, row, tile });
        const y = conceptualTierY(tile);
        const face = addFace(makeFace('water:' + key, 'water', [
          [col, y, row],
          [col, y, row + 1],
          [col + 1, y, row + 1],
          [col + 1, y, row],
        ], { col, row, tileKey: key }));
        waterFaceByCell.set(key, face.id);
      }
    }

    const directions = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const water of waterCellsByKey.values()) {
      if (!isWaterfallType(water.tile?.type)) continue;
      const c = water.col, r = water.row;
      const selfTier = Number(water.tile?.elevTier || 0);
      for (const [dc, dr] of directions) {
        const neighbor = zGrid?.[r + dr]?.[c + dc];
        if (!neighbor || Number(neighbor.elevTier || 0) === selfTier) continue;

        let x0, z0, x1, z1;
        if (dc === 1)       { x0 = c + 1; z0 = r;     x1 = c + 1; z1 = r + 1; }
        else if (dc === -1) { x0 = c;     z0 = r + 1; x1 = c;     z1 = r; }
        else if (dr === 1)  { x0 = c;     z0 = r + 1; x1 = c + 1; z1 = r + 1; }
        else                { x0 = c + 1; z0 = r;     x1 = c;     z1 = r; }

        const gKey = gridEdgeKey(x0, z0, x1, z1);
        if (emittedCurtains.has(gKey)) continue;
        emittedCurtains.add(gKey);

        const selfY = conceptualTierY(water.tile);
        const neighborY = Number(neighbor.elevTier || 0) * Math.max(0.001, Number(terrainDeps?.PLATEAU_UNIT) || 1);
        const top = Math.max(selfY, neighborY);
        const bottom = Math.min(selfY, neighborY);
        if (top - bottom < 1e-6) continue;

        const neighborKey = tileKey(c + dc, r + dr);
        const neighborIsWater = isWaterType(neighbor.type);
        const face = addFace(makeFace('curtain:' + gKey, 'curtain', [
          [x0, top, z0],
          [x1, top, z1],
          [x1, bottom, z1],
          [x0, bottom, z0],
        ], {
          gridEdgeKey: gKey,
          directedEdge: [x0, z0, x1, z1],
          sourceCellKey: tileKey(c, r),
          neighborCellKey: neighborIsWater ? neighborKey : null,
          neighborIsWater,
          height: top - bottom,
        }));
        curtainFaceByGridEdge.set(gKey, face.id);
      }
    }

    const edgeRecords = new Map();
    for (const face of faces) {
      for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
        const nextIndex = (edgeIndex + 1) % 4;
        const aKey = face.vertexKeys[edgeIndex];
        const bKey = face.vertexKeys[nextIndex];
        const key = edge3Key(aKey, bKey);
        let records = edgeRecords.get(key);
        if (!records) { records = []; edgeRecords.set(key, records); }
        records.push({ faceId: face.id, edgeIndex, aKey, bKey });
      }
    }

    const neighbors = new Map();
    for (const face of faces) neighbors.set(face.id, []);
    for (const records of edgeRecords.values()) {
      if (records.length < 2) continue;
      for (let i = 0; i < records.length; i++) {
        for (let j = i + 1; j < records.length; j++) {
          neighbors.get(records[i].faceId)?.push({ faceId: records[j].faceId, shared: [records[i].aKey, records[i].bKey] });
          neighbors.get(records[j].faceId)?.push({ faceId: records[i].faceId, shared: [records[j].aKey, records[j].bKey] });
        }
      }
    }

    const components = [];
    for (const face of faces) {
      if (face.componentId >= 0) continue;
      const component = { id: components.length, faceIds: [], boundaryEdgeKeys: [], unfoldedBoundarySegments: [], unfoldConflicts: 0 };
      const stack = [face.id];
      face.componentId = component.id;
      while (stack.length) {
        const faceId = stack.pop();
        const current = faceById.get(faceId);
        if (!current) continue;
        component.faceIds.push(faceId);
        for (const link of neighbors.get(faceId) || []) {
          const neighbor = faceById.get(link.faceId);
          if (!neighbor || neighbor.componentId >= 0) continue;
          neighbor.componentId = component.id;
          stack.push(neighbor.id);
        }
      }
      components.push(component);
    }

    for (const [key, records] of edgeRecords) {
      if (records.length !== 1) continue;
      const face = faceById.get(records[0].faceId);
      if (face?.componentId >= 0) components[face.componentId].boundaryEdgeKeys.push(key);
    }

    const componentByCell = new Map();
    for (const [key, faceId] of waterFaceByCell) {
      componentByCell.set(key, faceById.get(faceId)?.componentId ?? -1);
    }

    return {
      faces,
      faceById,
      neighbors,
      edgeRecords,
      components,
      componentByCell,
      waterCellsByKey,
      waterFaceByCell,
      curtainFaceByGridEdge,
      waterCellCount: waterCellsByKey.size,
      curtainCount: curtainFaceByGridEdge.size,
    };
  }

  function faceVertexIndexByKey(face, key) {
    return face?.vertexKeys?.indexOf(key) ?? -1;
  }

  function rootFacePlacement(face) {
    if (face?.kind === 'water') return face.vertices.map(point => [point[0], point[2]]);
    const a = face?.vertices?.[0] || [0,0,0];
    const b = face?.vertices?.[1] || [1,0,0];
    const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    const depth = Math.hypot(
      (face?.vertices?.[3]?.[0] || 0) - a[0],
      (face?.vertices?.[3]?.[1] || 0) - a[1],
      (face?.vertices?.[3]?.[2] || 0) - a[2],
    ) || 1;
    return [[0,0], [edgeLength,0], [edgeLength,depth], [0,depth]];
  }

  function centroid2(points) {
    let x = 0, y = 0;
    for (const point of points || []) { x += point[0]; y += point[1]; }
    const count = Math.max(1, points?.length || 0);
    return [x / count, y / count];
  }

  function cross2(ax, ay, bx, by) { return ax * by - ay * bx; }

  function unfoldAcrossEdge(currentFace, currentPlacement, nextFace, sharedKeys) {
    const aKey = sharedKeys?.[0], bKey = sharedKeys?.[1];
    const currentA = faceVertexIndexByKey(currentFace, aKey);
    const currentB = faceVertexIndexByKey(currentFace, bKey);
    const nextA = faceVertexIndexByKey(nextFace, aKey);
    const nextB = faceVertexIndexByKey(nextFace, bKey);
    if (currentA < 0 || currentB < 0 || nextA < 0 || nextB < 0) return null;

    const a2 = currentPlacement[currentA], b2 = currentPlacement[currentB];
    const a3 = nextFace.vertices[nextA], b3 = nextFace.vertices[nextB];
    const dx2 = b2[0] - a2[0], dy2 = b2[1] - a2[1];
    const edgeLength2 = Math.hypot(dx2, dy2);
    const dx3 = b3[0] - a3[0], dy3 = b3[1] - a3[1], dz3 = b3[2] - a3[2];
    const edgeLength3 = Math.hypot(dx3, dy3, dz3);
    if (edgeLength2 < 1e-8 || edgeLength3 < 1e-8) return null;

    const ex2 = dx2 / edgeLength2, ey2 = dy2 / edgeLength2;
    const leftX = -ey2, leftY = ex2;
    const currentCenter = centroid2(currentPlacement);
    const currentSide = Math.sign(cross2(dx2, dy2, currentCenter[0] - a2[0], currentCenter[1] - a2[1])) || 1;
    const nextSide = -currentSide;
    const ex3 = dx3 / edgeLength3, ey3 = dy3 / edgeLength3, ez3 = dz3 / edgeLength3;

    const placement = [];
    for (const point of nextFace.vertices) {
      const rx = point[0] - a3[0], ry = point[1] - a3[1], rz = point[2] - a3[2];
      const along = rx * ex3 + ry * ey3 + rz * ez3;
      const px = rx - ex3 * along, py = ry - ey3 * along, pz = rz - ez3 * along;
      const away = Math.hypot(px, py, pz);
      placement.push([
        a2[0] + ex2 * along + leftX * nextSide * away,
        a2[1] + ey2 * along + leftY * nextSide * away,
      ]);
    }
    return placement;
  }

  function placementsConflict(existing, candidate) {
    if (!existing || !candidate || existing.length !== candidate.length) return false;
    for (let i = 0; i < existing.length; i++) {
      if (Math.hypot(existing[i][0] - candidate[i][0], existing[i][1] - candidate[i][1]) > 1e-3) return true;
    }
    return false;
  }

  function unfoldComponent(topology, component) {
    const placements = new Map();
    const faceIds = component?.faceIds || [];
    if (!faceIds.length) return placements;
    const rootId = faceIds.find(id => topology.faceById.get(id)?.kind === 'water') || faceIds[0];
    placements.set(rootId, rootFacePlacement(topology.faceById.get(rootId)));
    const queue = [rootId];

    while (queue.length) {
      const currentId = queue.shift();
      const currentFace = topology.faceById.get(currentId);
      const currentPlacement = placements.get(currentId);
      for (const link of topology.neighbors.get(currentId) || []) {
        const nextFace = topology.faceById.get(link.faceId);
        if (!nextFace) continue;
        const candidate = unfoldAcrossEdge(currentFace, currentPlacement, nextFace, link.shared);
        if (!candidate) continue;
        const existing = placements.get(nextFace.id);
        if (existing) {
          if (placementsConflict(existing, candidate)) component.unfoldConflicts++;
          continue;
        }
        placements.set(nextFace.id, candidate);
        queue.push(nextFace.id);
      }
    }

    for (const faceId of faceIds) {
      if (!placements.has(faceId)) placements.set(faceId, rootFacePlacement(topology.faceById.get(faceId)));
    }
    return placements;
  }

  function pointSegmentDistance(x, z, segment) {
    const ax = segment[0][0], az = segment[0][1];
    const bx = segment[1][0], bz = segment[1][1];
    const dx = bx - ax, dz = bz - az;
    const denom = dx * dx + dz * dz;
    if (denom <= 1e-12) return Math.hypot(x - ax, z - az);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / denom));
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
  }

  function distanceToBoundary(x, z, segments) {
    let best = Infinity;
    for (const segment of segments || []) best = Math.min(best, pointSegmentDistance(x, z, segment));
    return Number.isFinite(best) ? best : 0;
  }

  function setSquareDepth(u, v, targetDepth) {
    const du = Number(u) - 0.5;
    const dv = Number(v) - 0.5;
    const currentRadius = Math.max(Math.abs(du), Math.abs(dv));
    const targetRadius = Math.max(0, 0.5 - Math.max(0, Math.min(0.5, targetDepth)));
    if (currentRadius <= 1e-9) return [0.5, 0.5];
    const scale = targetRadius / currentRadius;
    return [0.5 + du * scale, 0.5 + dv * scale];
  }

  function buildVirtualGeometry(topology, component, placements) {
    const positions = [];
    const refs = [];
    const triangles = [[0,1,2],[0,2,3]];
    for (const faceId of component.faceIds) {
      const placement = placements.get(faceId);
      if (!placement) continue;
      for (const triangle of triangles) {
        for (const corner of triangle) {
          const point = placement[corner];
          positions.push(point[0], 0, point[1]);
          refs.push({ faceId, corner });
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const boundarySegments = [];
    for (const key of component.boundaryEdgeKeys) {
      const record = topology.edgeRecords.get(key)?.[0];
      const placement = placements.get(record?.faceId);
      const face = topology.faceById.get(record?.faceId);
      if (!record || !placement || !face) continue;
      const aIndex = faceVertexIndexByKey(face, record.aKey);
      const bIndex = faceVertexIndexByKey(face, record.bKey);
      if (aIndex < 0 || bIndex < 0) continue;
      boundarySegments.push([placement[aIndex], placement[bIndex]]);
    }
    component.unfoldedBoundarySegments = boundarySegments;
    return { geometry, refs, boundarySegments };
  }

  function seedFallbackUv(geometry) {
    const position = geometry?.getAttribute?.('position');
    if (!position) return null;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < position.count; i++) {
      minX = Math.min(minX, position.getX(i)); maxX = Math.max(maxX, position.getX(i));
      minZ = Math.min(minZ, position.getZ(i)); maxZ = Math.max(maxZ, position.getZ(i));
    }
    const width = Math.max(1e-6, maxX - minX), height = Math.max(1e-6, maxZ - minZ);
    const uv = new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2);
    for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) - minX) / width, (position.getZ(i) - minZ) / height);
    geometry.setAttribute('uv', uv);
    return uv;
  }

  function applyProtectedBand(geometry, boundarySegments) {
    const position = geometry?.getAttribute?.('position');
    const uv = geometry?.getAttribute?.('uv');
    if (!position || !uv || !boundarySegments?.length) return geometry;

    const distances = new Float32Array(position.count);
    let maxDistance = TILE_RING_WORLD_WIDTH;
    for (let index = 0; index < position.count; index++) {
      const distance = distanceToBoundary(position.getX(index), position.getZ(index), boundarySegments);
      distances[index] = distance;
      maxDistance = Math.max(maxDistance, distance);
    }

    const interiorSpan = Math.max(1e-6, maxDistance - TILE_RING_WORLD_WIDTH);
    for (let index = 0; index < position.count; index++) {
      const distance = distances[index];
      const targetDepth = distance <= TILE_RING_WORLD_WIDTH
        ? SOURCE_EDGE_FRACTION * Math.max(0, Math.min(1, distance / TILE_RING_WORLD_WIDTH))
        : SOURCE_EDGE_FRACTION + (0.5 - SOURCE_EDGE_FRACTION)
          * Math.max(0, Math.min(1, (distance - TILE_RING_WORLD_WIDTH) / interiorSpan));
      const adjusted = setSquareDepth(uv.getX(index), uv.getY(index), targetDepth);
      uv.setXY(index, adjusted[0], adjusted[1]);
    }
    uv.needsUpdate = true;
    return geometry;
  }

  function collectFaceUvs(mapped, refs) {
    const uv = mapped?.getAttribute?.('uv');
    const accum = new Map();
    if (!uv || uv.count !== refs.length) return new Map();
    for (let index = 0; index < refs.length; index++) {
      const ref = refs[index];
      let corners = accum.get(ref.faceId);
      if (!corners) {
        corners = Array.from({ length: 4 }, () => ({ u: 0, v: 0, n: 0 }));
        accum.set(ref.faceId, corners);
      }
      const entry = corners[ref.corner];
      entry.u += uv.getX(index); entry.v += uv.getY(index); entry.n++;
    }

    const result = new Map();
    for (const [faceId, corners] of accum) {
      result.set(faceId, corners.map(entry => entry.n ? [entry.u / entry.n, entry.v / entry.n] : [0.5, 0.5]));
    }
    return result;
  }

  function buildConnectivity(zGrid, zcols, zrows) {
    const topology = buildFoldedSurfaceTopology(zGrid, zcols, zrows);
    const connectorEdgeKeys = new Set();
    for (const [edgeKey, faceId] of topology.curtainFaceByGridEdge) {
      const face = topology.faceById.get(faceId);
      if (face?.meta?.neighborIsWater) connectorEdgeKeys.add(edgeKey);
    }
    return {
      components: topology.components,
      componentByCell: topology.componentByCell,
      connectorEdgeKeys,
      curtainEdgeKeys: new Set(topology.curtainFaceByGridEdge.keys()),
      waterCellsByKey: topology.waterCellsByKey,
      waterCellCount: topology.waterCellCount,
      curtainCount: topology.curtainCount,
    };
  }

  function buildDomain(zGrid, zcols, zrows, mapId = 'zone') {
    if (!zGrid) return null;
    const cached = domainCache.get(zGrid);
    if (cached && cached.cols === zcols && cached.rows === zrows && cached.mapId === mapId) return cached;

    const topology = buildFoldedSurfaceTopology(zGrid, zcols, zrows);
    const faceUvById = new Map();
    let fallbackCount = 0;
    let unfoldConflicts = 0;

    for (const component of topology.components) {
      const placements = unfoldComponent(topology, component);
      unfoldConflicts += component.unfoldConflicts || 0;
      const virtual = buildVirtualGeometry(topology, component, placements);
      let mapped = virtual.geometry;
      try {
        mapped = mapper.mapGeometry(virtual.geometry, { label: mapId + ':water-folded-body-' + component.id });
        if (!mapped?.getAttribute?.('uv')) throw new Error('surface mapper returned no UVs');
      } catch (error) {
        fallbackCount++;
        mapped = virtual.geometry;
        seedFallbackUv(mapped);
        debugLog(mapId + ': folded component ' + component.id + ' fallback mapping (' + (error?.message || error) + ')', 'warn');
      }

      applyProtectedBand(mapped, virtual.boundarySegments);
      const nextUvs = collectFaceUvs(mapped, virtual.refs);
      for (const [faceId, uvs] of nextUvs) faceUvById.set(faceId, uvs);
      if (mapped && mapped !== virtual.geometry) mapped.dispose?.();
      virtual.geometry.dispose?.();
    }

    const connectorEdgeKeys = new Set();
    for (const [edgeKey, faceId] of topology.curtainFaceByGridEdge) {
      if (topology.faceById.get(faceId)?.meta?.neighborIsWater) connectorEdgeKeys.add(edgeKey);
    }

    const domain = {
      mapId,
      cols: zcols,
      rows: zrows,
      components: topology.components,
      componentByCell: topology.componentByCell,
      connectorEdgeKeys,
      curtainEdgeKeys: new Set(topology.curtainFaceByGridEdge.keys()),
      waterCellsByKey: topology.waterCellsByKey,
      waterFaceByCell: topology.waterFaceByCell,
      curtainFaceByGridEdge: topology.curtainFaceByGridEdge,
      faceById: topology.faceById,
      faceUvById,
      waterCellCount: topology.waterCellCount,
      curtainCount: topology.curtainCount,
      fallbackCount,
      unfoldConflicts,
    };
    domainCache.set(zGrid, domain);
    state.mappedDomains++;
    state.mappedComponents += domain.components.length;
    state.connectorEdges += domain.curtainCount;
    remember({
      mapId,
      cells: domain.waterCellCount,
      curtains: domain.curtainCount,
      components: domain.components.length,
      fallbacks: fallbackCount,
      unfoldConflicts,
    });
    return domain;
  }

  function isTownPermanentRiverOptions(options) {
    const name = String(options?.name || '').toLowerCase();
    const statKey = String(options?.statKey || '').toLowerCase();
    if (!name.includes('town') && !statKey.includes('town')) return false;
    if (name.includes('dynamic') || statKey.includes('dynamic') || name.includes('apron') || statKey.includes('apron')) return false;
    return /river|stream|waterway/.test(name + ' ' + statKey);
  }

  function buildFlatCellDomain(cells, mapId = 'town-river') {
    const byKey = new Map();
    for (const cell of cells || []) {
      const col = Number(cell?.col), row = Number(cell?.row);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      byKey.set(tileKey(col, row), { col, row, cell });
    }

    const components = [];
    const componentByCell = new Map();
    const visited = new Set();
    const directions = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const seed of byKey.values()) {
      const seedKey = tileKey(seed.col, seed.row);
      if (visited.has(seedKey)) continue;
      const id = components.length;
      const queue = [seed];
      const members = [];
      visited.add(seedKey);
      while (queue.length) {
        const current = queue.pop();
        const key = tileKey(current.col, current.row);
        members.push(current);
        componentByCell.set(key, id);
        for (const [dc, dr] of directions) {
          const nextKey = tileKey(current.col + dc, current.row + dr);
          const next = byKey.get(nextKey);
          if (!next || visited.has(nextKey)) continue;
          visited.add(nextKey);
          queue.push(next);
        }
      }
      components.push({ id, members });
    }

    const faceUvById = new Map();
    const waterFaceByCell = new Map();
    let fallbackCount = 0;

    for (const component of components) {
      const positions = [];
      const refs = [];
      const boundarySegments = [];
      const memberKeys = new Set(component.members.map(entry => tileKey(entry.col, entry.row)));
      for (const member of component.members) {
        const c0 = member.col, r0 = member.row;
        const faceId = 'town-water:' + tileKey(c0, r0);
        waterFaceByCell.set(tileKey(c0, r0), faceId);
        const quad = [[c0,r0],[c0,r0+1],[c0+1,r0+1],[c0+1,r0]];
        for (const tri of [[0,1,2],[0,2,3]]) {
          for (const corner of tri) {
            const point = quad[corner];
            positions.push(point[0], 0, point[1]);
            refs.push({ faceId, corner });
          }
        }
        if (!memberKeys.has(tileKey(c0 - 1, r0))) boundarySegments.push([[c0,r0],[c0,r0+1]]);
        if (!memberKeys.has(tileKey(c0 + 1, r0))) boundarySegments.push([[c0+1,r0+1],[c0+1,r0]]);
        if (!memberKeys.has(tileKey(c0, r0 - 1))) boundarySegments.push([[c0+1,r0],[c0,r0]]);
        if (!memberKeys.has(tileKey(c0, r0 + 1))) boundarySegments.push([[c0,r0+1],[c0+1,r0+1]]);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      let mapped = geometry;
      try {
        mapped = mapper.mapGeometry(geometry, { label: mapId + ':component-' + component.id });
        if (!mapped?.getAttribute?.('uv')) throw new Error('surface mapper returned no UVs');
      } catch (error) {
        fallbackCount++;
        mapped = geometry;
        seedFallbackUv(mapped);
        debugLog(mapId + ': component ' + component.id + ' fallback mapping (' + (error?.message || error) + ')', 'warn');
      }
      applyProtectedBand(mapped, boundarySegments);
      const nextUvs = collectFaceUvs(mapped, refs);
      for (const [faceId, uvs] of nextUvs) faceUvById.set(faceId, uvs);
      if (mapped && mapped !== geometry) mapped.dispose?.();
      geometry.dispose?.();
    }

    const domain = {
      mapId,
      components,
      componentByCell,
      connectorEdgeKeys: new Set(),
      curtainEdgeKeys: new Set(),
      waterCellsByKey: byKey,
      waterFaceByCell,
      curtainFaceByGridEdge: new Map(),
      faceById: new Map(),
      faceUvById,
      waterCellCount: byKey.size,
      curtainCount: 0,
      fallbackCount,
      unfoldConflicts: 0,
      scope: 'town-river',
    };
    state.mappedDomains++;
    state.mappedComponents += components.length;
    remember({
      mapId,
      cells: domain.waterCellCount,
      curtains: 0,
      components: components.length,
      fallbacks: fallbackCount,
      unfoldConflicts: 0,
      scope: 'town-river',
    });
    return domain;
  }

  function ensureOverlayAttributes(geometry) {
    const position = geometry?.getAttribute?.('position');
    if (!position) return false;
    if (!geometry.getAttribute('aWaterBodyOverlayUv')) {
      geometry.setAttribute('aWaterBodyOverlayUv', new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2));
    }
    if (!geometry.getAttribute('aWaterBodyOverlayFlag')) {
      geometry.setAttribute('aWaterBodyOverlayFlag', new THREE.Float32BufferAttribute(new Float32Array(position.count), 1));
    }
    return true;
  }

  function waterCornerIndex(col, row, x, z) {
    const west = Math.abs(x - col) <= Math.abs(x - (col + 1));
    const north = Math.abs(z - row) <= Math.abs(z - (row + 1));
    if (west && north) return 0;
    if (west && !north) return 1;
    if (!west && !north) return 2;
    return 3;
  }

  function applyDomainToMesh(mesh, domain) {
    const geometry = mesh?.geometry;
    if (!geometry || !domain || !ensureOverlayAttributes(geometry)) return false;
    const position = geometry.getAttribute('position');
    const baseUv = geometry.getAttribute('uv');
    const overlayUv = geometry.getAttribute('aWaterBodyOverlayUv');
    const overlayFlag = geometry.getAttribute('aWaterBodyOverlayFlag');
    const index = geometry.index;
    const statKey = mesh.userData?.mergedWaterStatKey;
    const textureTileSize = Math.max(0.001,
      Number(mergedRenderer?.stats?.[statKey]?.textureTileSize)
      || Number(mergedRenderer?.DEFAULT_TEXTURE_TILE_SIZE)
      || 4);
    const logicalX = vertexIndex => baseUv?.count === position.count
      ? baseUv.getX(vertexIndex) * textureTileSize
      : position.getX(vertexIndex);
    const logicalZ = vertexIndex => baseUv?.count === position.count
      ? baseUv.getY(vertexIndex) * textureTileSize
      : position.getZ(vertexIndex);
    const triangleIndexCount = index ? index.count : position.count;
    let assigned = 0;

    for (let tri = 0; tri + 2 < triangleIndexCount; tri += 3) {
      const ia = index ? index.getX(tri) : tri;
      const ib = index ? index.getX(tri + 1) : tri + 1;
      const ic = index ? index.getX(tri + 2) : tri + 2;
      const cx = (logicalX(ia) + logicalX(ib) + logicalX(ic)) / 3;
      const cz = (logicalZ(ia) + logicalZ(ib) + logicalZ(ic)) / 3;
      const col = Math.floor(cx + 1e-6), row = Math.floor(cz + 1e-6);
      const faceId = domain.waterFaceByCell.get(tileKey(col, row));
      const corners = domain.faceUvById.get(faceId);
      if (!corners) continue;

      for (const vertexIndex of [ia, ib, ic]) {
        const x = logicalX(vertexIndex), z = logicalZ(vertexIndex);
        const uv = corners[waterCornerIndex(col, row, x, z)];
        if (!uv) continue;
        overlayUv.setXY(vertexIndex, uv[0], uv[1]);
        overlayFlag.setX(vertexIndex, 1);
        assigned++;
      }
    }

    overlayUv.needsUpdate = true;
    overlayFlag.needsUpdate = true;
    geometry.userData = Object.assign({}, geometry.userData || {}, {
      waterBodyOverlay: {
        mode: 'folded-water-surface-domain',
        sourceEdgeFraction: SOURCE_EDGE_FRACTION,
        tileRingWorldWidth: TILE_RING_WORLD_WIDTH,
        componentCount: domain.components.length,
        curtainCount: domain.curtainCount,
        allWaterfallCurtainsCountAsSurface: true,
        logicalCoordinateSource: baseUv?.count === position.count ? 'base-world-uv' : 'displaced-position-fallback',
        unfoldConflicts: domain.unfoldConflicts,
      },
    });
    mesh.userData = Object.assign({}, mesh.userData || {}, {
      waterBodyOverlayMapped: assigned > 0,
      waterBodyOverlayMapId: domain.mapId,
    });
    if (assigned) {
      state.mappedWaterMeshes++;
      state.mappedVertices += assigned;
    }
    return assigned > 0;
  }

  function transparentTexture() {
    const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  function makeOutlineOnlyTexture(sourceTexture) {
    const image = sourceTexture?.image;
    const width = image?.naturalWidth || image?.width;
    const height = image?.naturalHeight || image?.height;
    if (!width || !height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    let kept = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const alpha = pixels.data[i + 3];
      const black = alpha > 0
        && pixels.data[i] <= BLACK_EPSILON
        && pixels.data[i + 1] <= BLACK_EPSILON
        && pixels.data[i + 2] <= BLACK_EPSILON;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 0;
      if (black) kept++;
      else pixels.data[i + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    state.maskPixels += kept;
    return texture;
  }

  function bindSharedOutlineTexture(material, uniformName) {
    const fallback = transparentTexture();
    material.uniforms[uniformName] = { value: fallback };
    const consumer = { material, uniformName, fallback };
    outlineTextureConsumers.push(consumer);

    if (sharedOutlineTexture) {
      material.uniforms[uniformName].value = sharedOutlineTexture;
      fallback.dispose?.();
      return;
    }
    if (outlineTextureLoading) return;
    outlineTextureLoading = true;
    new THREE.TextureLoader().load(OVERLAY_TEXTURE_URL, source => {
      try {
        const outline = makeOutlineOnlyTexture(source);
        source.dispose?.();
        if (!outline) throw new Error('overlay source image unavailable');
        sharedOutlineTexture = outline;
        for (const entry of outlineTextureConsumers) {
          const uniform = entry.material?.uniforms?.[entry.uniformName];
          if (!uniform) continue;
          uniform.value = outline;
          entry.material.needsUpdate = true;
          entry.fallback?.dispose?.();
          entry.fallback = null;
        }
      } catch (error) {
        state.failures++;
        debugLog('outline-only texture conversion failed: ' + (error?.message || error), 'warn');
      } finally {
        outlineTextureLoading = false;
      }
    }, undefined, error => {
      outlineTextureLoading = false;
      state.failures++;
      debugLog('overlay texture load failed: ' + (error?.message || error), 'warn');
    });
  }

  function replaceRequired(source, needle, replacement, label) {
    const text = String(source || '');
    if (!text.includes(needle)) throw new Error('missing ' + label + ' shader marker');
    return text.replace(needle, replacement);
  }

  function patchWaterMaterial(material) {
    if (!material?.isShaderMaterial || material.userData?.waterBodyOverlayPatched) return material;
    try {
      material.vertexShader = replaceRequired(
        material.vertexShader,
        '        attribute vec2 aFlow;\n',
        '        attribute vec2 aFlow;\n        attribute vec2 aWaterBodyOverlayUv;\n        attribute float aWaterBodyOverlayFlag;\n',
        'water vertex attributes',
      );
      material.vertexShader = replaceRequired(
        material.vertexShader,
        '        varying vec2 vFlow;\n',
        '        varying vec2 vFlow;\n        varying vec2 vWaterBodyOverlayUv;\n        varying float vWaterBodyOverlayFlag;\n',
        'water vertex varyings',
      );
      material.vertexShader = replaceRequired(
        material.vertexShader,
        '          vFlow = aFlow;\n',
        '          vFlow = aFlow;\n          vWaterBodyOverlayUv = aWaterBodyOverlayUv;\n          vWaterBodyOverlayFlag = aWaterBodyOverlayFlag;\n',
        'water vertex assignments',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '        uniform sampler2D uWaterTexture;\n',
        '        uniform sampler2D uWaterTexture;\n        uniform sampler2D uWaterBodyOverlayTexture;\n',
        'water overlay sampler',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '        varying vec2 vFlow;\n',
        '        varying vec2 vFlow;\n        varying vec2 vWaterBodyOverlayUv;\n        varying float vWaterBodyOverlayFlag;\n',
        'water fragment varyings',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '          surfaceColor += flowSheen;\n',
        '          surfaceColor += flowSheen;\n          vec4 waterBodyOverlay = texture2D(uWaterBodyOverlayTexture, clamp(vWaterBodyOverlayUv, vec2(0.0), vec2(1.0)));\n          float waterBodyOverlayAlpha = clamp(waterBodyOverlay.a * vWaterBodyOverlayFlag, 0.0, 1.0);\n          surfaceColor = mix(surfaceColor, vec3(0.0), waterBodyOverlayAlpha);\n',
        'water overlay blend',
      );
    } catch (error) {
      state.failures++;
      debugLog('material patch failed: ' + (error?.message || error), 'warn');
      return material;
    }

    bindSharedOutlineTexture(material, 'uWaterBodyOverlayTexture');
    material.userData = Object.assign({}, material.userData || {}, {
      waterBodyOverlayPatched: true,
      waterBodyOverlayTextureUrl: OVERLAY_TEXTURE_URL,
      waterBodyOverlayDoesNotReplaceBaseTexture: true,
    });
    material.needsUpdate = true;
    state.materialPatches++;
    return material;
  }

  function patchWaterfallMaterial(material) {
    if (!material?.isShaderMaterial || material.userData?.waterBodyOverlayWaterfallPatched) return material;
    try {
      material.vertexShader = replaceRequired(
        material.vertexShader,
        '        varying vec2 vUv;\n',
        '        attribute vec2 aWaterBodyOverlayUv;\n        attribute float aWaterBodyOverlayFlag;\n        varying vec2 vUv;\n        varying vec2 vWaterBodyOverlayUv;\n        varying float vWaterBodyOverlayFlag;\n',
        'waterfall vertex attributes',
      );
      material.vertexShader = replaceRequired(
        material.vertexShader,
        '          vUv = uv;\n',
        '          vUv = uv;\n          vWaterBodyOverlayUv = aWaterBodyOverlayUv;\n          vWaterBodyOverlayFlag = aWaterBodyOverlayFlag;\n',
        'waterfall vertex assignments',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '        uniform sampler2D uWaterTexture;\n',
        '        uniform sampler2D uWaterTexture;\n        uniform sampler2D uWaterBodyOverlayTexture;\n',
        'waterfall overlay sampler',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '        varying vec2 vUv;\n',
        '        varying vec2 vUv;\n        varying vec2 vWaterBodyOverlayUv;\n        varying float vWaterBodyOverlayFlag;\n',
        'waterfall fragment varyings',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '          gl_FragColor = vec4(surfaceColor, uOpacity);\n',
        '          vec4 waterBodyOverlay = texture2D(uWaterBodyOverlayTexture, clamp(vWaterBodyOverlayUv, vec2(0.0), vec2(1.0)));\n          float waterBodyOverlayAlpha = clamp(waterBodyOverlay.a * vWaterBodyOverlayFlag, 0.0, 1.0);\n          surfaceColor = mix(surfaceColor, vec3(0.0), waterBodyOverlayAlpha);\n          gl_FragColor = vec4(surfaceColor, uOpacity);\n',
        'waterfall overlay blend',
      );
    } catch (error) {
      state.failures++;
      debugLog('waterfall material patch failed: ' + (error?.message || error), 'warn');
      return material;
    }
    bindSharedOutlineTexture(material, 'uWaterBodyOverlayTexture');
    material.userData = Object.assign({}, material.userData || {}, {
      waterBodyOverlayWaterfallPatched: true,
      waterBodyOverlayTextureUrl: OVERLAY_TEXTURE_URL,
    });
    material.needsUpdate = true;
    state.materialPatches++;
    return material;
  }

  function patchMergedWaterRenderer(api) {
    if (!api?.createMaterial || !api?.createMesh || api.__waterBodyOverlayWrapped) return api;
    mergedRenderer = api;
    const originalCreateMaterial = api.createMaterial;
    api.createMaterial = function (...args) {
      return patchWaterMaterial(originalCreateMaterial.apply(this, args));
    };
    api.createMaterial.__waterBodyOverlayOriginal = originalCreateMaterial;

    const originalCreateMesh = api.createMesh;
    api.createMesh = function (...args) {
      const mesh = originalCreateMesh.apply(this, args);
      if (mesh?.geometry && ensureOverlayAttributes(mesh.geometry)) state.mergedMeshDefaults++;
      const cells = args[2];
      const options = args[3] || {};
      if (mesh?.geometry && isTownPermanentRiverOptions(options)) {
        try {
          const domain = buildFlatCellDomain(cells, options.name || options.statKey || 'town-river');
          applyDomainToMesh(mesh, domain);
          mesh.userData = Object.assign({}, mesh.userData || {}, {
            waterBodyOverlayScope: 'town-river',
            waterBodyOverlayTownRiver: true,
          });
        } catch (error) {
          state.failures++;
          debugLog('town river overlay mapping failed (' + (error?.message || error) + ')', 'warn');
        }
      }
      return mesh;
    };
    api.createMesh.__waterBodyOverlayOriginal = originalCreateMesh;
    api.__waterBodyOverlayWrapped = true;
    return api;
  }

  function applyDomainToWaterfallMesh(mesh, domain) {
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!geometry || !position || !domain || !ensureOverlayAttributes(geometry)) return 0;
    const overlayUv = geometry.getAttribute('aWaterBodyOverlayUv');
    const overlayFlag = geometry.getAttribute('aWaterBodyOverlayFlag');
    let mappedCurtains = 0;

    // buildWaterfallCurtainMeshes emits one unique 4-vertex quad per curtain.
    // Every one of those quads is treated as another surface tile in the same
    // unfolded water body, including curtains whose opposite edge meets land.
    for (let base = 0; base + 3 < position.count; base += 4) {
      const x0 = Math.round(position.getX(base));
      const z0 = Math.round(position.getZ(base));
      const x1 = Math.round(position.getX(base + 1));
      const z1 = Math.round(position.getZ(base + 1));
      const gKey = gridEdgeKey(x0, z0, x1, z1);
      const faceId = domain.curtainFaceByGridEdge.get(gKey);
      const face = domain.faceById.get(faceId);
      const corners = domain.faceUvById.get(faceId);
      if (!face || !corners) continue;

      const directed = face.meta?.directedEdge || [];
      const sameDirection = Math.round(directed[0]) === x0
        && Math.round(directed[1]) === z0
        && Math.round(directed[2]) === x1
        && Math.round(directed[3]) === z1;
      const mapping = sameDirection
        ? [0, 1, 3, 2]
        : [1, 0, 2, 3];

      for (let offset = 0; offset < 4; offset++) {
        const uv = corners[mapping[offset]];
        if (!uv) continue;
        overlayUv.setXY(base + offset, uv[0], uv[1]);
        overlayFlag.setX(base + offset, 1);
      }
      mappedCurtains++;
    }

    overlayUv.needsUpdate = true;
    overlayFlag.needsUpdate = true;
    geometry.userData = Object.assign({}, geometry.userData || {}, {
      waterBodyOverlayWaterfall: {
        mappedCurtains,
        mapping: 'folded-surface-extension',
        allCurtainsIncluded: true,
        gridLockedSharedEdges: true,
      },
    });
    mesh.userData.waterBodyOverlayCurtainsMapped = mappedCurtains;
    return mappedCurtains;
  }

  function tagWaterfallSheets(scene, bounds, mapId, domain) {
    const host = bounds && scene?.parent?.children ? scene.parent : scene;
    const children = host?.children || [];
    let tagged = 0;
    for (const child of children) {
      if (child?.userData?.wildernessPersistentZoneFeature !== 'waterfall') continue;
      if (child.userData.wildernessPersistentZoneFeatureMapId !== mapId) continue;
      patchWaterfallMaterial(child.material);
      const mappedCurtains = applyDomainToWaterfallMesh(child, domain);
      child.userData.waterBodyOverlayConnectivity = {
        role: 'folded-water-surface-extension',
        componentCount: domain?.components?.length || 0,
        curtainCount: domain?.curtainCount || 0,
        mappedCurtains,
        countedInContiguousDomain: true,
        allCurtainsIncluded: true,
        landFacingCurtainsIncluded: true,
        arbitraryCurtainAngleReady: true,
      };
      tagged++;
    }
    state.waterfallSheetsTagged += tagged;
    return tagged;
  }

  function patchZoneTerrainFeatures(api) {
    if (!api || api.__waterBodyOverlayWrapped) return api;
    const originalInit = api.init;
    if (typeof originalInit === 'function') {
      api.init = function (deps) {
        terrainDeps = deps;
        return originalInit.apply(this, arguments);
      };
    }

    const originalRivers = api.buildZoneRiverWaterMeshes;
    if (typeof originalRivers === 'function') {
      api.buildZoneRiverWaterMeshes = function (scene, zGrid, zcols, zrows, mapId, bounds) {
        const result = originalRivers.apply(this, arguments);
        try {
          const domain = buildDomain(zGrid, zcols, zrows, mapId);
          for (const mesh of result || []) applyDomainToMesh(mesh, domain);
        } catch (error) {
          state.failures++;
          debugLog(mapId + ': waterway overlay mapping failed (' + (error?.message || error) + ')', 'warn');
        }
        return result;
      };
      api.buildZoneRiverWaterMeshes.__waterBodyOverlayOriginal = originalRivers;
    }

    const originalWaterfalls = api.buildWaterfallCurtainMeshes;
    if (typeof originalWaterfalls === 'function') {
      api.buildWaterfallCurtainMeshes = function (scene, zGrid, zcols, zrows, mapId, bounds) {
        const result = originalWaterfalls.apply(this, arguments);
        try {
          const domain = buildDomain(zGrid, zcols, zrows, mapId);
          tagWaterfallSheets(scene, bounds, mapId, domain);
        } catch (error) {
          state.failures++;
          debugLog(mapId + ': waterfall connector registration failed (' + (error?.message || error) + ')', 'warn');
        }
        return result;
      };
      api.buildWaterfallCurtainMeshes.__waterBodyOverlayOriginal = originalWaterfalls;
    }

    api.__waterBodyOverlayWrapped = true;
    return api;
  }

  function chainGlobal(name, patcher) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      const oldGet = descriptor.get, oldSet = descriptor.set;
      const current = oldGet.call(window);
      if (current) oldSet.call(window, patcher(current));
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return oldGet.call(window); },
        set(value) {
          oldSet.call(window, value);
          const prepared = oldGet.call(window);
          if (prepared) oldSet.call(window, patcher(prepared));
        },
      });
      return;
    }
    let current = window[name];
    if (current) current = patcher(current);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = patcher(value); },
      });
    } catch (_) {
      if (window[name]) window[name] = patcher(window[name]);
    }
  }

  const PIXEL_PROBE_RESULT_KEY = '__waterBodyOverlayProbeObserverV1';
  const PIXEL_PROBE_LINE_PREFIX = 'Water body overlay:';

  function formatPixelProbeLine(reportText = '') {
    const snapshot = Object.assign({}, state);
    const text = String(reportText || '');
    const waterHit = text.match(/^\d+\. "([^"]*(?:water|river|waterfall)[^"]*)"/mi)?.[1] || 'none';
    let hitScope = 'unknown';
    if (/^town_.*(?:river|stream|waterway).*water/i.test(waterHit) && !/dynamic|apron/i.test(waterHit)) hitScope = 'town-river-overlay';
    else if (/^(?:town_|farm_|dynamic_)/i.test(waterHit)) hitScope = 'shared-material/default-off';
    else if (/waterfall/i.test(waterHit)) hitScope = 'wilderness-waterfall';
    else if (/river|water/i.test(waterHit) && waterHit !== 'none') hitScope = 'water-mesh';
    const recent = snapshot.recent?.[snapshot.recent.length - 1] || null;
    return `${PIXEL_PROBE_LINE_PREFIX} installed=1 sourceEdge=${Math.round(SOURCE_EDGE_FRACTION * 100)}% domains=${snapshot.mappedDomains} components=${snapshot.mappedComponents} curtains=${recent?.curtains ?? '-'} mappedMeshes=${snapshot.mappedWaterMeshes} mappedVertices=${snapshot.mappedVertices} waterfallSheets=${snapshot.waterfallSheetsTagged} materialPatches=${snapshot.materialPatches} failures=${snapshot.failures} hit=${waterHit} hitScope=${hitScope} recentMap=${recent?.mapId || '-'} unfoldConflicts=${recent?.unfoldConflicts ?? '-'}`;
  }

  function appendOrReplacePixelProbeLine(reportText) {
    const text = String(reportText || '');
    const lines = text.split('\n');
    const line = formatPixelProbeLine(text);
    const index = lines.findIndex(entry => entry.startsWith(PIXEL_PROBE_LINE_PREFIX));
    if (index >= 0) lines[index] = line;
    else lines.push(line);
    return lines.join('\n');
  }

  function installPixelProbeObserver() {
    const result = document.getElementById('debugProbeResult');
    if (!result || result[PIXEL_PROBE_RESULT_KEY] || typeof MutationObserver !== 'function') return false;
    let writing = false;
    const observer = new MutationObserver(() => {
      if (writing) return;
      const current = result.textContent || '';
      if (!current || !/Pixel Probe report/i.test(current)) return;
      const next = appendOrReplacePixelProbeLine(current);
      if (next === current) return;
      writing = true;
      result.textContent = next;
      writing = false;
    });
    observer.observe(result, { childList: true, characterData: true, subtree: true });
    result[PIXEL_PROBE_RESULT_KEY] = observer;
    return true;
  }

  function patchPixelProbeForDiagnostics(api) {
    if (!api || api.__waterBodyOverlayProbePatched || typeof api.init !== 'function') return false;
    const originalInit = api.init;
    api.init = function waterBodyOverlayPixelProbeInit(...args) {
      const value = originalInit.apply(this, args);
      installPixelProbeObserver();
      return value;
    };
    api.__waterBodyOverlayProbePatched = true;
    return true;
  }

  function installPixelProbeHook() {
    if (patchPixelProbeForDiagnostics(window.PixelProbe)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'PixelProbe');
    if (descriptor && descriptor.configurable === false) return;
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    let value = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    Object.defineProperty(window, 'PixelProbe', {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return oldGet ? oldGet.call(window) : value; },
      set(next) {
        if (oldSet) oldSet.call(window, next);
        else value = next;
        const prepared = oldGet ? oldGet.call(window) : next;
        patchPixelProbeForDiagnostics(prepared);
      },
    });
  }

  window.WaterBodyOutlineOverlay = {
    installed: true,
    textureUrl: OVERLAY_TEXTURE_URL,
    sourceEdgeFraction: SOURCE_EDGE_FRACTION,
    tileRingWorldWidth: TILE_RING_WORLD_WIDTH,
    buildConnectivity,
    buildFoldedSurfaceTopology,
    unfoldComponent,
    buildDomain,
    buildFlatCellDomain,
    isTownPermanentRiverOptions,
    applyDomainToMesh,
    patchWaterMaterial,
    patchWaterfallMaterial,
    applyDomainToWaterfallMesh,
    formatPixelProbeLine,
    appendOrReplacePixelProbeLine,
    installPixelProbeObserver,
    snapshot() { return Object.assign({}, state, { recent: state.recent.slice() }); },
  };

  chainGlobal('MergedWaterRenderer', patchMergedWaterRenderer);
  chainGlobal('ZoneTerrainFeatures', patchZoneTerrainFeatures);
  installPixelProbeHook();
  debugLog('installed: wilderness water and every grid-locked waterfall curtain are unfolded as one contiguous protected-band surface.');
})();
