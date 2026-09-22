(() => {
  'use strict';

  // Wilderness-zone terrain features that sit alongside js/zone-plateau-mesa.js's
  // elevated mesa tops: ramp surfaces/curtains (buildZoneRampMeshes/
  // buildRampCurtainMeshes), the unioned non-walkable rock layer covering ramp
  // sides and bare tier steps (buildRockFormationMeshes — plain plateau-cliff
  // spans are excluded, since buildPlateauMesa's own mesh already renders
  // those), and waterway meshes (buildWaterfallCurtainMeshes/
  // buildZoneRiverWaterMeshes). Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern as its sibling systems. All four
  // are deterministic scene-graph generators driven entirely by the zone grid
  // passed in. Waterfall curtains are the one intentionally map-level render
  // object: keeping their very cheap merged sheet outside streamed chunk groups
  // prevents distant waterfall openings from turning into empty holes.
  let deps = null;
  let sharedWaterfallMaterial = null; // Reused by every persistent waterfall sheet so all zones share one shader/texture instance.
  const persistentWaterfallRecords = new WeakMap(); // Tracks one map-level waterfall record per zone scene without keeping discarded scenes alive.
  const waterfallRenderStats = Object.create(null); // Exposes persistent waterfall cost/state to in-game/mobile diagnostics.
  const WATERFALL_TEXTURE_URL = 'assets/textures/wibbly_surface.png'; // Uses the exact PNG asset used by the merged river renderer.
  const WATERFALL_SCROLL_UV_PER_SECOND = 0.55; // Drives the texture downward in surface-local vertical UV space like a conveyor belt.
  const WATER_SURFACE_RENDER_OFFSET = 0.015; // Used by both zone water meshes and waterfall curtain endpoints so the rendered surfaces, not just their pre-render base heights, meet exactly.

  function init(injectedDeps) { deps = injectedDeps; }

  function normalizedBounds(zcols, zrows, bounds) {
    return {
      colStart: Math.max(0, Math.floor(bounds?.colStart ?? 0)),
      rowStart: Math.max(0, Math.floor(bounds?.rowStart ?? 0)),
      colEnd: Math.min(zcols, Math.ceil(bounds?.colEnd ?? zcols)),
      rowEnd: Math.min(zrows, Math.ceil(bounds?.rowEnd ?? zrows)),
    };
  }

  function waterSurfaceY(tile) {
    const tierY = (tile?.elevTier || 0) * deps.PLATEAU_UNIT; // Used as the pre-render base Y shared by river, stream, and waterfall horizontal water tiles.
    const deep = tile?.type !== deps.TileType.STREAM; // Used below to preserve the merged water renderer's river/waterfall versus stream surface offset.
    return deps.NORMAL_TOP + tierY - (deep ? 0.10 : 0.05);
  }

  function renderedWaterSurfaceY(tile) {
    return waterSurfaceY(tile) + WATER_SURFACE_RENDER_OFFSET; // Used by vertical waterfall curtains to meet the final horizontal mesh after its anti-z-fighting Y offset is applied.
  }

  function buildZoneRampMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null) {
    const range = normalizedBounds(zcols, zrows, bounds);
    const rampCells = [];
    for (let r = range.rowStart; r < range.rowEnd; r++)
      for (let c = range.colStart; c < range.colEnd; c++)
        if (zGrid[r]?.[c]?.type === deps.TileType.RAMP) rampCells.push([c, r]);
    if (!rampCells.length) return [];

    const cornerY = (ci, cj) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
        const t = zGrid[cj + dr]?.[ci + dc];
        if (t && t.type === deps.TileType.RAMP) { sum += deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : null;
    };

    const pos = [], uv = [], idx = [];
    let vi = 0;
    for (const [c, r] of rampCells) {
      const fallback = deps.NORMAL_TOP + (zGrid[r][c].rampElevation || 0) * deps.PLATEAU_UNIT;
      const y00 = cornerY(c, r)     ?? fallback;
      const y10 = cornerY(c+1, r)   ?? fallback;
      const y01 = cornerY(c, r+1)   ?? fallback;
      const y11 = cornerY(c+1, r+1) ?? fallback;
      pos.push(c,y00,r,  c+1,y10,r,  c,y01,r+1,  c+1,y11,r+1);
      uv.push(c,r,  c+1,r,  c,r+1,  c+1,r+1); // world-space (X,Z), same convention as _mergeTileGeos
      idx.push(vi,vi+2,vi+3, vi,vi+3,vi+1); vi += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, deps.resolveTileMat(mapId, deps.TileType.PATH));
    mesh.receiveShadow = true;
    mesh.userData.wildernessChunkOwnsGeometry = true;
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(deps.TileType.PATH));

    console.log(`%c[zone:${mapId}] ramp mesh built: ${rampCells.length} tile(s)`, 'color:#22c55e;font-weight:bold');
    return [mesh];
  }

  // Ramp side curtains: a 1-tile sloped skirt on every cell flagged `rampCurtain`
  // (see buildZoneScene) — each corner takes the average height of whichever
  // adjacent RAMP cells touch it (same averaging buildZoneRampMeshes uses for
  // the ramp surface itself), falling back to the curtain cell's own natural
  // ground height at corners that don't touch a ramp. That tapers the skirt
  // from the ramp's edge down to ground over one tile — the same margin width
  // buildPlateauMesa uses for its cliff face — and picks up the same steep-face
  // stone skin so a ramp's sides read as a cut bank rather than floating grass.
  function buildRampCurtainMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null) {
    const range = normalizedBounds(zcols, zrows, bounds);
    const cells = [];
    for (let r = range.rowStart; r < range.rowEnd; r++)
      for (let c = range.colStart; c < range.colEnd; c++)
        if (zGrid[r]?.[c]?.rampCurtain) cells.push([c, r]);
    if (!cells.length) return [];

    const cornerY = (ci, cj, fallback) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
        const t = zGrid[cj + dr]?.[ci + dc];
        if (t && t.type === deps.TileType.RAMP) { sum += deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : fallback;
    };

    const pos = [], uv = [], idx = [];
    let vi = 0;
    for (const [c, r] of cells) {
      const ground = deps.NORMAL_TOP + (zGrid[r][c].elevTier || 0) * deps.PLATEAU_UNIT;
      const y00 = cornerY(c, r, ground);
      const y10 = cornerY(c + 1, r, ground);
      const y01 = cornerY(c, r + 1, ground);
      const y11 = cornerY(c + 1, r + 1, ground);
      pos.push(c, y00, r,  c + 1, y10, r,  c, y01, r + 1,  c + 1, y11, r + 1);
      uv.push(c,r,  c+1,r,  c,r+1,  c+1,r+1); // world-space (X,Z), same convention as _mergeTileGeos
      idx.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1); vi += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, deps.resolveTileMat(mapId, deps.TileType.GRASS));
    mesh.receiveShadow = true;
    mesh.userData.wildernessChunkOwnsGeometry = true;
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(deps.TileType.GRASS));

    // Steep ramp-curtain skin is now emitted by buildRockFormationMeshes,
    // after unioning ramp side spans with neighboring plateau cliff spans.

    console.log(`%c[zone:${mapId}] ramp curtain skirt built: ${cells.length} tile(s)`, 'color:#22c55e;font-weight:bold');
    return [mesh];
  }

  // Unified solved non-walkable rock layer. This mirrors
  // docs/js/terrain-preview.js buildRockFormationGeometry: semantic ramp
  // side spans and ramp/plateau seam spans (plus bare tier steps not
  // touching any plateau mesa) are unioned by tile edge before rendering,
  // so overlapping authored features become one continuous rocky
  // formation while walkable tops/ramp floors stay separate. Plain
  // plateau-cliff spans are excluded — buildPlateauMesa's own mesh
  // renders those directly with a stone material group now, so solving
  // them again here would just double them up.

  const BOULDER_SUBDIVISIONS = 4; // Shared surface resolution used to make one welded skin for each generated boulder.
  const boulderComponentCache = new WeakMap(); // One footprint index per live zone grid prevents a full-map scan for every streamed chunk.
  const boulderShellStats = { indexBuilds: 0, indexHits: 0, gridTilesScanned: 0, shellBuilds: 0 }; // Exposed for mobile-friendly performance verification.

  function isUndiggableBoulderTile(zGrid, c, r) {
    const tile = zGrid?.[r]?.[c]; // Tile inspected by component collection and perimeter tests.
    return tile?.type === deps.TileType.ROCK && (tile.rockKind === 'undiggableBoulder' || !!tile.boulderId);
  }

  function collectUndiggableBoulderComponents(zGrid, zcols, zrows) {
    const cached = boulderComponentCache.get(zGrid); // Grid identity remains stable across every chunk in one zone visit.
    if (cached && cached.zcols === zcols && cached.zrows === zrows) {
      boulderShellStats.indexHits++;
      return cached.components;
    }
    const groupedCells = new Map(); // Exact generator IDs keep separately-authored boulders distinct even when their tiles touch.
    const legacyCells = new Set(); // Old cached/generated maps without IDs retain a connected-component fallback.
    for (let r = 0; r < zrows; r++) for (let c = 0; c < zcols; c++) {
      boulderShellStats.gridTilesScanned++;
      if (!isUndiggableBoulderTile(zGrid, c, r)) continue;
      const tile = zGrid[r][c]; // Source tile carries the preserved generator object ID when available.
      if (tile.boulderId) {
        let cells = groupedCells.get(tile.boulderId); // Shared tile list becomes one authored boulder shell.
        if (!cells) { cells = []; groupedCells.set(tile.boulderId, cells); }
        cells.push([c, r]);
      } else {
        legacyCells.add(c + ',' + r);
      }
    }
    const components = [...groupedCells.values()]; // Exact-ID footprints need no spatial rediscovery.
    while (legacyCells.size) {
      const startKey = legacyCells.values().next().value; // Stable seed for one legacy connected component.
      const [startC, startR] = startKey.split(',').map(Number); // Seed coordinates consumed by the fallback flood fill.
      const cells = []; // Four-way-connected legacy tiles belonging to one boulder.
      const queue = [[startC, startR]]; // Flood-fill worklist used only for this legacy footprint.
      legacyCells.delete(startKey);
      for (let qi = 0; qi < queue.length; qi++) {
        const [cc, rr] = queue[qi]; // Current footprint tile whose four neighbors are inspected.
        cells.push([cc, rr]);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = cc + dc, nr = rr + dr; // Neighbor coordinates used to continue this connected component.
          const key = nc + ',' + nr; // Neighbor key prevents duplicate flood-fill work.
          if (!legacyCells.delete(key)) continue;
          queue.push([nc, nr]);
        }
      }
      components.push(cells);
    }
    boulderComponentCache.set(zGrid, { zcols, zrows, components });
    boulderShellStats.indexBuilds++;
    return components;
  }

  function buildUndiggableBoulderShellData(zGrid, zcols, zrows, bounds = null) {
    const range = normalizedBounds(zcols, zrows, bounds); // Current streaming chunk whose portion of each global shell is emitted.
    const components = collectUndiggableBoulderComponents(zGrid, zcols, zrows); // Cached full-zone footprints keep peaks and seams stable across chunk borders.
    const pos = [], uv = [], idx = []; // World-space shell buffers returned to the Three.js wrapper.
    const vertexBySample = new Map(); // Reuses top vertices shared by neighboring source tiles instead of duplicating each patch edge.
    let topTileCount = 0; // Diagnostic count of footprint tiles emitted in this chunk.
    let perimeterEdgeCount = 0; // Diagnostic count proving shared interior walls were omitted.
    let representedComponentCount = 0; // Diagnostic count of connected shells touching this chunk.
    const smooth01 = value => {
      const t = Math.max(0, Math.min(1, value)); // Clamped blend used to taper the shell exactly into its perimeter.
      return t * t * (3 - 2 * t);
    };
    const hashNoise = (x, z) => {
      const kx = Math.round(x * 16), kz = Math.round(z * 16); // Quantized world coordinates keep duplicate seam vertices identical.
      let h = (2166136261 ^ Math.imul(kx, 374761393) ^ Math.imul(kz, 668265263)) >>> 0; // Deterministic hash used only for subtle rock roughness.
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return h / 4294967296 - 0.5;
    };

    for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
      const cells = components[componentIndex]; // Exact generated-object footprint rendered by this iteration.
      const cellSet = new Set(cells.map(([c, r]) => c + ',' + r)); // Membership lookup used by boundary and base-height calculations.
      const renderCells = cells.filter(([c, r]) => c >= range.colStart && c < range.colEnd && r >= range.rowStart && r < range.rowEnd); // Chunk-local tiles emitted from this global shape.
      if (!renderCells.length) continue;
      representedComponentCount++;

      const centroid = cells.reduce((sum, [c, r]) => [sum[0] + c + 0.5, sum[1] + r + 0.5], [0, 0]); // Footprint center used to break equally-deep peak candidates.
      centroid[0] /= cells.length;
      centroid[1] /= cells.length;
      const boundaryDepth = new Map(); // Tile-space distance from the outer ring used to choose one interior peak.
      const depthQueue = []; // Multi-source BFS grows inward from every outer tile.
      for (const [c, r] of cells) {
        const key = c + ',' + r; // Component key whose boundary status seeds the depth field.
        const boundary = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => !cellSet.has((c + dc) + ',' + (r + dr)));
        if (boundary) { boundaryDepth.set(key, 0); depthQueue.push([c, r]); }
      }
      for (let qi = 0; qi < depthQueue.length; qi++) {
        const [c, r] = depthQueue[qi]; // Current depth-field cell used to advance one tile inward.
        const nextDepth = boundaryDepth.get(c + ',' + r) + 1; // Candidate depth assigned to unseen component neighbors.
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr, key = nc + ',' + nr; // Neighbor location tested for the next inward ring.
          if (!cellSet.has(key) || boundaryDepth.has(key)) continue;
          boundaryDepth.set(key, nextDepth);
          depthQueue.push([nc, nr]);
        }
      }
      let peakCell = cells[0], peakDepth = -1, peakCenterDistance = Infinity; // Single best interior tile anchors the whole combined summit.
      for (const [c, r] of cells) {
        const depth = boundaryDepth.get(c + ',' + r) || 0; // Interior clearance ranks candidates before centroid distance.
        const centerDistance = (c + 0.5 - centroid[0]) ** 2 + (r + 0.5 - centroid[1]) ** 2; // Tie-break keeps the peak visually centered.
        if (depth > peakDepth || (depth === peakDepth && centerDistance < peakCenterDistance)) {
          peakCell = [c, r];
          peakDepth = depth;
          peakCenterDistance = centerDistance;
        }
      }
      const peakX = peakCell[0] + 0.5, peakZ = peakCell[1] + 0.5; // Exact world-space summit shared by every chunk.
      const boundaryEdges = []; // Outer footprint segments used for both taper distance and perimeter-only side walls.
      for (const [c, r] of cells) for (const [dc, dr, x0, z0, x1, z1] of [
        [0, -1, c, r, c + 1, r],
        [1, 0, c + 1, r, c + 1, r + 1],
        [0, 1, c + 1, r + 1, c, r + 1],
        [-1, 0, c, r + 1, c, r],
      ]) {
        if (!cellSet.has((c + dc) + ',' + (r + dr))) boundaryEdges.push({ owner: c + ',' + r, x0, z0, x1, z1 });
      }
      const farthest = Math.max(0.75, ...boundaryEdges.flatMap(edge => [
        Math.hypot(edge.x0 - peakX, edge.z0 - peakZ),
        Math.hypot(edge.x1 - peakX, edge.z1 - peakZ),
      ])); // Radial normalization lets elongated clusters still flow toward the one summit.
      const peakHeight = Math.min(1.45, 0.58 + Math.sqrt(cells.length) * 0.14); // Combined footprint size controls summit height without becoming a cliff.
      const pointSegmentDistance = (x, z, edge) => {
        const dx = edge.x1 - edge.x0, dz = edge.z1 - edge.z0; // Segment direction used to project a surface sample onto the perimeter.
        const lengthSq = dx * dx + dz * dz; // Squared edge length avoids a square root during projection.
        const t = lengthSq ? Math.max(0, Math.min(1, ((x - edge.x0) * dx + (z - edge.z0) * dz) / lengthSq)) : 0; // Clamped closest point on this boundary edge.
        return Math.hypot(x - (edge.x0 + dx * t), z - (edge.z0 + dz * t));
      };
      const baseYAt = (x, z, fallbackTile) => {
        let total = 0, count = 0; // Adjacent component bases are averaged so duplicated seam vertices stay welded.
        const candidates = [
          [Math.floor(x - 1e-7), Math.floor(z - 1e-7)],
          [Math.floor(x + 1e-7), Math.floor(z - 1e-7)],
          [Math.floor(x - 1e-7), Math.floor(z + 1e-7)],
          [Math.floor(x + 1e-7), Math.floor(z + 1e-7)],
        ]; // Four tiles potentially touching this exact grid vertex.
        for (const [c, r] of candidates) {
          if (!cellSet.has(c + ',' + r)) continue;
          total += deps.NORMAL_TOP + (zGrid[r][c].elevTier || 0) * deps.PLATEAU_UNIT;
          count++;
        }
        return count ? total / count : deps.NORMAL_TOP + (fallbackTile.elevTier || 0) * deps.PLATEAU_UNIT;
      };
      const topYAt = (x, z, fallbackTile) => {
        const edgeDistance = Math.min(...boundaryEdges.map(edge => pointSegmentDistance(x, z, edge))); // Nearest outer edge makes every silhouette vertex meet the ground.
        const edgeBlend = smooth01(edgeDistance * 2); // Half a tile of inward travel reaches full shell height.
        const radial = Math.max(0, 1 - Math.hypot(x - peakX, z - peakZ) / farthest); // Monotonic rise toward the one selected peak.
        const crown = 0.18 + 0.82 * Math.pow(radial, 0.72); // Broad lower shoulders blend all source boulders into one mass.
        const roughness = hashNoise(x, z) * 0.04 * edgeBlend * radial * (1 - radial); // Roughness vanishes at the summit so no secondary point can overtake the one peak.
        return baseYAt(x, z, fallbackTile) + peakHeight * edgeBlend * crown + roughness;
      };
      const vertexAt = (x, z, tile) => {
        const key = componentIndex + ':' + Math.round(x * BOULDER_SUBDIVISIONS) + ',' + Math.round(z * BOULDER_SUBDIVISIONS); // Component-scoped sample key welds adjacent top patches.
        const existing = vertexBySample.get(key); // Previously emitted shared vertex, including index zero.
        if (existing !== undefined) return existing;
        const vertex = pos.length / 3; // New exterior vertex index referenced by the top quads.
        pos.push(x, topYAt(x, z, tile), z);
        uv.push(x, z);
        vertexBySample.set(key, vertex);
        return vertex;
      };

      for (const [c, r] of renderCells) {
        const tile = zGrid[r][c]; // Source tile supplies the base elevation for this shell patch.
        for (let j = 0; j < BOULDER_SUBDIVISIONS; j++) for (let i = 0; i < BOULDER_SUBDIVISIONS; i++) {
          const x0 = c + i / BOULDER_SUBDIVISIONS, x1 = c + (i + 1) / BOULDER_SUBDIVISIONS; // Horizontal limits of one exterior quad.
          const z0 = r + j / BOULDER_SUBDIVISIONS, z1 = r + (j + 1) / BOULDER_SUBDIVISIONS; // Vertical limits of one exterior quad.
          const a = vertexAt(x0, z0, tile), b = vertexAt(x1, z0, tile), d = vertexAt(x0, z1, tile), e = vertexAt(x1, z1, tile); // Welded quad corners.
          idx.push(a, d, e, a, e, b);
        }
        topTileCount++;

        for (const edge of boundaryEdges) if (edge.owner === c + ',' + r) perimeterEdgeCount++; // Count only true outer edges; the tapered top already meets the ground there.
      }
    }
    boulderShellStats.shellBuilds++;
    return { pos, uv, idx, componentCount: representedComponentCount, topTileCount, perimeterEdgeCount, peakCount: representedComponentCount };
  }

  function buildUndiggableBoulderMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null) {
    const shell = buildUndiggableBoulderShellData(zGrid, zcols, zrows, bounds); // Pure geometry and diagnostics for this streaming chunk.
    if (!shell.idx.length) return [];
    const geo = new THREE.BufferGeometry(); // Exterior-only contiguous shell geometry owned by this chunk.
    geo.setAttribute('position', new THREE.Float32BufferAttribute(shell.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(shell.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(shell.idx.length > 65535 ? new Uint32Array(shell.idx) : new Uint16Array(shell.idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, deps.resolveTileMat(mapId, deps.TileType.ROCK)); // Shared natural-rock material used by every terrain rock surface.
    mesh.name = 'undiggable_boulder_shell_' + rangeKey(bounds); // Pixel Probe label makes the new combined renderer visible on mobile.
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.wildernessChunkOwnsGeometry = true;
    mesh.userData.undiggableBoulderShell = {
      componentCount: shell.componentCount,
      peakCount: shell.peakCount,
      topTileCount: shell.topTileCount,
      perimeterEdgeCount: shell.perimeterEdgeCount,
      interiorWalls: 0,
      indexBuilds: boulderShellStats.indexBuilds,
      indexHits: boulderShellStats.indexHits,
    };
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(deps.TileType.ROCK));
    return [mesh];
  }

  function rangeKey(bounds) {
    const col = Math.floor(bounds?.colStart ?? 0), row = Math.floor(bounds?.rowStart ?? 0); // Chunk coordinates used only to give each shell mesh a stable debug name.
    return col + '_' + row;
  }

  function boulderShellSnapshot() {
    return { ...boulderShellStats }; // Debug panel/console callers can prove that full-grid indexing happens once per live zone grid.
  }

  function buildRockFormationMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null) {
    const range = normalizedBounds(zcols, zrows, bounds);
    const rampCornerYFor = (ci, cj, fallback = null) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
        const t = zGrid?.[cj + dr]?.[ci + dc];
        if (t && t.type === deps.TileType.RAMP) { sum += deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : fallback;
    };
    const cellCornerHeights = (c, r) => {
      const t = zGrid?.[r]?.[c];
      if (!t) return [deps.NORMAL_TOP, deps.NORMAL_TOP, deps.NORMAL_TOP, deps.NORMAL_TOP];
      if (t.type === deps.TileType.RAMP) {
        const fallback = deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT;
        return [rampCornerYFor(c, r, fallback), rampCornerYFor(c + 1, r, fallback), rampCornerYFor(c, r + 1, fallback), rampCornerYFor(c + 1, r + 1, fallback)];
      }
      const y = deps.NORMAL_TOP + (t.elevTier || 0) * deps.PLATEAU_UNIT;
      return [y, y, y, y];
    };
    const hash01 = (x, z, salt) => {
      let h = (2166136261 ^ Math.imul(Math.round(x * 8) + salt, 374761393) ^ Math.imul(Math.round(z * 8) - salt, 668265263)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return h / 4294967296;
    };
    const spans = new Map();
    const add = (key, axis, x0, z0, x1, z1, top0, top1, bottom0, bottom1, kind) => {
      if (Math.max(top0, top1) - Math.min(bottom0, bottom1) <= 0.04) return;
      const prev = spans.get(key);
      if (!prev) spans.set(key, { key, axis, x0, z0, x1, z1, top0, top1, bottom0, bottom1, kinds: new Set([kind]) });
      else { prev.top0 = Math.max(prev.top0, top0); prev.top1 = Math.max(prev.top1, top1); prev.bottom0 = Math.min(prev.bottom0, bottom0); prev.bottom1 = Math.min(prev.bottom1, bottom1); prev.kinds.add(kind); }
    };
    const kindOf = (a, b) => (a?.type === deps.TileType.RAMP || b?.type === deps.TileType.RAMP) ? ((a?.incline || b?.incline) ? 'ramp_plateau_seam' : 'ramp_side') : ((a?.incline || b?.incline) ? 'plateau_cliff' : 'tier_seam');
    for (let r = range.rowStart; r < range.rowEnd; r++) for (let c = range.colStart; c < range.colEnd; c++) {
      const t = zGrid?.[r]?.[c]; if (!t) continue;
      const [, y10, y01, y11] = cellCornerHeights(c, r);
      for (const [dc, dr, side] of [[1,0,'E'],[0,1,'S']]) {
        const nt = zGrid?.[r + dr]?.[c + dc];
        const [ny00, ny10, ny01] = cellCornerHeights(c + dc, r + dr);
        const a = side === 'E' ? [y10, y11] : [y01, y11];
        const b = side === 'E' ? [ny00, ny01] : [ny00, ny10];
        const top0 = Math.max(a[0], b[0]), top1 = Math.max(a[1], b[1]);
        const bottom0 = Math.min(a[0], b[0]), bottom1 = Math.min(a[1], b[1]);
        const step = Math.max(top0, top1) - Math.min(bottom0, bottom1);
        if (!(((t.type === deps.TileType.RAMP || nt?.type === deps.TileType.RAMP) && step > 0.04) || (step > 0.04 && (t.incline || nt?.incline || (t.elevTier || 0) !== (nt?.elevTier || 0))))) continue;
        const kind = kindOf(t, nt);
        // A plain plateau_cliff span is exactly the cliff-face margin band
        // buildPlateauMesa's own mesh already renders (now stone-textured
        // directly on that geometry — see its own comment) — solving it a
        // second time here just overlays a second, perfectly flat plane in
        // front of that real sloped surface. Ramp seams/sides and bare tier
        // steps aren't rendered by any other mesh, so those still need this
        // solver.
        if (kind === 'plateau_cliff') continue;
        if (side === 'E') add(`x:${c + 1}:${r}`, 'x', c + 1, r, c + 1, r + 1, top0, top1, bottom0, bottom1, kind);
        else add(`z:${r + 1}:${c}`, 'z', c, r + 1, c + 1, r + 1, top0, top1, bottom0, bottom1, kind);
      }
    }
    const pos = [], idx = []; let vi = 0;
    const pushV = (x, y, z, nx, nz, at, vt) => {
      const rib = (vt > 0.001 && vt < 0.999 && at > 0.001 && at < 0.999) ? (hash01(x, z, Math.round(y * 10)) - 0.5) * 0.16 : 0;
      const ledge = (vt > 0.15 && vt < 0.9 && Math.abs((vt * 5) % 1 - 0.5) < 0.14) ? 0.035 : 0;
      pos.push(x + nx * (rib + ledge), y, z + nz * (rib + ledge));
    };
    for (const s of spans.values()) {
      const nx = s.axis === 'x' ? (hash01(s.x0, s.z0, 7) > 0.5 ? 1 : -1) : 0;
      const nz = s.axis === 'z' ? (hash01(s.x0, s.z0, 11) > 0.5 ? 1 : -1) : 0;
      const segs = 2, base = vi;
      for (let j = 0; j <= segs; j++) for (let i = 0; i <= segs; i++) {
        const at = i / segs, vt = j / segs;
        const x = s.x0 + (s.x1 - s.x0) * at, z = s.z0 + (s.z1 - s.z0) * at;
        const top = s.top0 + (s.top1 - s.top0) * at, bot = s.bottom0 + (s.bottom1 - s.bottom0) * at;
        pushV(x, bot + (top - bot) * (1 - vt), z, nx, nz, at, vt);
      }
      for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
        const a = base + j * (segs + 1) + i, b = a + 1, c0 = a + (segs + 1), d = c0 + 1;
        idx.push(a, c0, d, a, d, b);
      }
      vi += (segs + 1) * (segs + 1);
    }
    if (!idx.length) return [];
    const mat = new THREE.MeshLambertMaterial({ color: 0x5f5a56, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.userData.wildernessChunkOwnsGeometry = true;
    mesh.userData.wildernessChunkOwnsMaterial = true;
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(deps.TileType.ROCK));
    mesh.userData.cameraObstacle = true; // vertical cliff-face skin — see buildPlateauMesa's own tag
    console.log(`%c[zone:${mapId}] solved rock formation built: ${spans.size} edge span(s)`, 'color:#22c55e;font-weight:bold');
    return [mesh];
  }

  function getWaterfallHostScene(zScene, bounds) {
    const chunkParent = bounds && zScene?.parent?.add ? zScene.parent : null; // Resolves the persistent zone scene when the caller is currently building a streamed chunk group.
    return chunkParent || zScene;
  }

  function getWaterfallMaterial() {
    if (sharedWaterfallMaterial) return sharedWaterfallMaterial;
    const fallbackPixel = new Uint8Array([172, 190, 184, 255]); // Supplies a valid sampler while the shared river PNG is still loading.
    const fallbackTexture = new THREE.DataTexture(fallbackPixel, 1, 1, THREE.RGBAFormat); // Prevents a black/unbound waterfall sheet during asynchronous texture loading.
    fallbackTexture.needsUpdate = true;
    const uniforms = { // Shared by every persistent waterfall mesh so animation/material state never scales with chunk count.
      uTime: { value: 0 },
      uWaterTexture: { value: fallbackTexture },
      uDeepColor: { value: new THREE.Color(0x14658e) },
      uShallowColor: { value: new THREE.Color(0x75d5df) },
      uOpacity: { value: 0.82 },
      uScrollSpeed: { value: WATERFALL_SCROLL_UV_PER_SECOND },
    };
    sharedWaterfallMaterial = new THREE.ShaderMaterial({
      name: 'persistent_textured_waterfall_material',
      uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uWaterTexture;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform float uOpacity;
        uniform float uScrollSpeed;
        varying vec2 vUv;
        void main() {
          vec2 textureUv = fract(vec2(vUv.x, vUv.y + uTime * uScrollSpeed));
          vec3 textureColor = texture2D(uWaterTexture, textureUv).rgb;
          float pattern = dot(textureColor, vec3(0.299, 0.587, 0.114));
          vec3 baseColor = mix(uShallowColor, uDeepColor, 0.72);
          vec3 surfaceColor = mix(baseColor * 0.72, baseColor * 1.22, pattern);
          gl_FragColor = vec4(surfaceColor, uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const textureLoader = new THREE.TextureLoader(); // Loads the same wibbly_surface.png asset used by merged river/stream water.
    textureLoader.load(WATERFALL_TEXTURE_URL, texture => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      uniforms.uWaterTexture.value = texture;
      sharedWaterfallMaterial.needsUpdate = true;
      fallbackTexture.dispose();
    }, undefined, error => {
      console.warn(`[waterfall-render] texture load failed (${WATERFALL_TEXTURE_URL})`, error);
    });
    return sharedWaterfallMaterial;
  }

  function disposePersistentWaterfallRecord(record) {
    if (!record) return;
    record.mesh?.parent?.remove?.(record.mesh);
    record.mesh?.geometry?.dispose?.();
  }

  // Waterfall curtain: one lightweight map-level sheet containing every
  // elevation drop touching a WATERFALL tile. Its vertical endpoints use the
  // exact same final rendered water-surface height as the merged river mesh,
  // creating a micro-plateau-style skirt at the lip instead of exposing the
  // sunken bed gap between a horizontal river surface and the falling sheet.
  // Unlike ordinary wilderness terrain, it deliberately lives on the zone
  // scene rather than a streamed chunk group, so a distant waterfall remains
  // in the cliff opening after the terrain chunk that formerly owned it unloads.
  function buildWaterfallCurtainMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null) {
    const hostScene = getWaterfallHostScene(zScene, bounds); // Owns the always-resident waterfall mesh for this zone rather than any one chunk.
    if (!hostScene?.add) return [];
    let hostRecords = persistentWaterfallRecords.get(hostScene); // Memoizes map-level waterfall construction across every streamed chunk build in this scene.
    if (!hostRecords) {
      hostRecords = new Map();
      persistentWaterfallRecords.set(hostScene, hostRecords);
    }
    const previous = hostRecords.get(mapId); // Detects repeated chunk calls and stale records after a zone grid is rebuilt.
    if (previous?.grid === zGrid && previous.cols === zcols && previous.rows === zrows && (!previous.mesh || previous.mesh.parent === hostScene)) {
      return bounds ? [] : (previous.mesh ? [previous.mesh] : []);
    }
    if (previous) disposePersistentWaterfallRecord(previous);

    const cells = []; // Collects every authored waterfall tile once so all distant curtains fit into one draw call.
    for (let r = 0; r < zrows; r++)
      for (let c = 0; c < zcols; c++)
        if (zGrid[r]?.[c]?.type === deps.TileType.WATERFALL) cells.push([c, r]);

    const emptyRecord = { grid: zGrid, cols: zcols, rows: zrows, mesh: null }; // Prevents every chunk from rescanning a map that contains no waterfalls.
    if (!cells.length) {
      hostRecords.set(mapId, emptyRecord);
      waterfallRenderStats[mapId] = { persistent: true, cells: 0, curtains: 0, duplicateEdgesSkipped: 0, vertices: 0, triangles: 0, drawCalls: 0, texture: WATERFALL_TEXTURE_URL, surfaceHeightMode: 'merged-water-surface', surfaceYOffset: WATER_SURFACE_RENDER_OFFSET };
      return [];
    }

    const textureTileSize = Math.max(0.001, Number(window.MergedWaterRenderer?.DEFAULT_TEXTURE_TILE_SIZE) || 4); // Matches the world-space repeat scale used by rivers.
    const pos = [], uv = [], idx = [];
    const emittedEdges = new Set(); // Deduplicates a shared cliff edge when waterfall tiles on both sides visit the same vertical curtain.
    let duplicateEdgesSkipped = 0; // Counted below for diagnostics so mobile/source audits can verify the duplicate-overdraw guard is active.
    let vi = 0;
    for (const [c, r] of cells) {
      const t = zGrid[r][c];
      const selfY = renderedWaterSurfaceY(t);
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nt = zGrid[r + dr]?.[c + dc];
        if (!nt || (nt.elevTier || 0) === (t.elevTier || 0)) continue;
        const neighborIsWater = nt.type === deps.TileType.RIVER || nt.type === deps.TileType.STREAM || nt.type === deps.TileType.WATERFALL;
        const neighborY = neighborIsWater ? renderedWaterSurfaceY(nt) : deps.NORMAL_TOP + (nt.elevTier || 0) * deps.PLATEAU_UNIT;
        const top = Math.max(selfY, neighborY), bottom = Math.min(selfY, neighborY);
        if (top - bottom < 0.01) continue;
        let x0, z0, x1, z1;
        if (dc === 1)       { x0 = c+1; z0 = r;   x1 = c+1; z1 = r+1; }
        else if (dc === -1) { x0 = c;   z0 = r+1; x1 = c;   z1 = r;   }
        else if (dr === 1)  { x0 = c;   z0 = r+1; x1 = c+1; z1 = r+1; }
        else /* dr === -1 */{ x0 = c+1; z0 = r;   x1 = c;   z1 = r;   }
        const firstBeforeSecond = x0 < x1 || (x0 === x1 && z0 <= z1); // Canonicalizes the two edge endpoints so opposite visits produce the same key.
        const edgeKey = firstBeforeSecond ? `${x0},${z0}:${x1},${z1}` : `${x1},${z1}:${x0},${z0}`; // Used only by emittedEdges for duplicate curtain rejection.
        if (emittedEdges.has(edgeKey)) {
          duplicateEdgesSkipped++;
          continue;
        }
        emittedEdges.add(edgeKey);
        const u0 = (x0 + z0) / textureTileSize; // Keeps the PNG continuous in world space along either X- or Z-facing waterfall edges.
        const u1 = (x1 + z1) / textureTileSize; // Continues the same world-space texture coordinate at the second edge vertex.
        const vTop = top / textureTileSize; // Uses world Y so every tier of the waterfall participates in one continuous vertical conveyor.
        const vBottom = bottom / textureTileSize; // Anchors the bottom UV to world Y rather than restarting the texture per tile/drop.
        pos.push(x0, top, z0,  x1, top, z1,  x0, bottom, z0,  x1, bottom, z1);
        uv.push(u0, vTop, u1, vTop, u0, vBottom, u1, vBottom);
        idx.push(vi, vi+2, vi+3, vi, vi+3, vi+1); vi += 4;
      }
    }
    if (!pos.length) {
      hostRecords.set(mapId, emptyRecord);
      waterfallRenderStats[mapId] = { persistent: true, cells: cells.length, curtains: 0, duplicateEdgesSkipped, vertices: 0, triangles: 0, drawCalls: 0, texture: WATERFALL_TEXTURE_URL, surfaceHeightMode: 'merged-water-surface', surfaceYOffset: WATER_SURFACE_RENDER_OFFSET };
      return [];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mat = getWaterfallMaterial(); // Reuses one texture-backed shader for every zone instead of allocating one waterfall material per streamed chunk.
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${mapId}_persistent_waterfall_curtains`;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true; // Persistence solves chunk streaming; normal view-frustum culling still skips the sheet when it is wholly offscreen.
    mesh.userData.wildernessPersistentZoneFeature = 'waterfall';
    mesh.userData.wildernessPersistentZoneFeatureMapId = mapId;
    mesh.userData.waterfallCellCount = cells.length;
    mesh.userData.waterfallCurtainCount = idx.length / 6;
    mesh.userData.waterfallDuplicateEdgesSkipped = duplicateEdgesSkipped;
    mesh.userData.waterfallTriangleCount = idx.length / 3;
    mesh.userData.waterfallTexture = WATERFALL_TEXTURE_URL;
    mesh.userData.waterfallSurfaceHeightMode = 'merged-water-surface';
    mesh.userData.waterfallSurfaceYOffset = WATER_SURFACE_RENDER_OFFSET;
    mesh.userData.noOutline = true;
    mesh.onBeforeRender = () => {
      mat.uniforms.uTime.value = performance.now() * 0.001;
    };
    hostScene.add(mesh);
    deps.markTerrainEdgeId(mesh, 'water');

    const record = { grid: zGrid, cols: zcols, rows: zrows, mesh }; // Lets later chunk builds reuse this one persistent map-level mesh.
    hostRecords.set(mapId, record);
    waterfallRenderStats[mapId] = {
      persistent: true,
      cells: cells.length,
      curtains: idx.length / 6,
      duplicateEdgesSkipped,
      vertices: pos.length / 3,
      triangles: idx.length / 3,
      drawCalls: 1,
      texture: WATERFALL_TEXTURE_URL,
      textureTileSize,
      scrollUvPerSecond: WATERFALL_SCROLL_UV_PER_SECOND,
      surfaceHeightMode: 'merged-water-surface',
      surfaceYOffset: WATER_SURFACE_RENDER_OFFSET,
    };
    console.log(`%c[zone:${mapId}] persistent textured waterfall sheet built: ${cells.length} cell(s), ${idx.length / 6} curtain(s), ${duplicateEdgesSkipped} duplicate edge(s) skipped, ${idx.length / 3} triangle(s), 1 draw call`, 'color:#22c55e;font-weight:bold');
    return bounds ? [] : [mesh];
  }

  // River/stream/waterfall water surface — one world-UV merged textured mesh
  // above the sunken beds. Each tile still contributes its own elevation,
  // depth, and flow attributes, so plateau waterways and waterfall pools keep
  // their authored heights without returning to one draw call per tile.
  function buildZoneRiverWaterMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null) {
    const range = normalizedBounds(zcols, zrows, bounds);
    const isWaterTile = (cc, rr) => {
      const t = zGrid[rr]?.[cc]?.type;
      return t === deps.TileType.RIVER || t === deps.TileType.STREAM || t === deps.TileType.WATERFALL;
    };
    const cells = [];
    for (let r = range.rowStart; r < range.rowEnd; r++) for (let c = range.colStart; c < range.colEnd; c++) {
      const tile = zGrid[r][c];
      if (!isWaterTile(c, r)) continue;
      let fx = (isWaterTile(c + 1, r) ? 1 : 0) - (isWaterTile(c - 1, r) ? 1 : 0);
      let fz = (isWaterTile(c, r + 1) ? 1 : 0) - (isWaterTile(c, r - 1) ? 1 : 0);
      const flen = Math.hypot(fx, fz);
      if (flen > 0.001) { fx /= flen; fz /= flen; } else { fx = 0; fz = 0; }
      const deep = tile.type !== deps.TileType.STREAM;
      cells.push({
        col: c, row: r,
        surfaceY: waterSurfaceY(tile),
        depth: deep ? 0.8 : 0.45,
        coverage: 1,
        flowX: fx, flowZ: fz,
      });
    }
    if (!cells.length) return [];
    const chunkSuffix = range.colStart + '_' + range.rowStart;
    const mesh = deps.buildMergedWaterMesh(zScene, cells, {
      name: `${mapId}_merged_water_${chunkSuffix}`,
      statKey: `${mapId} waterways ${chunkSuffix}`,
      yOffset: WATER_SURFACE_RENDER_OFFSET,
    });
    if (!mesh) return [];
    mesh.userData.wildernessChunkOwnsGeometry = true;
    // NOT wildernessChunkOwnsMaterial: deps.buildMergedWaterMesh's material is
    // water-system.js's module-level mergedWaterMaterial singleton (built once
    // via _material()'s own if(!mergedWaterMaterial) memoization and reused by
    // every water mesh in every zone), not something this one chunk owns.
    // Tagging it here made disposeTaggedChunkObjects (see wilderness-chunks.js)
    // dispose that SHARED material's map and every texture-valued uniform
    // (including uWaterTexture) on every single chunk unload -- i.e. on every
    // ordinary chunk-streaming unload as the player walks away from any water,
    // not just here. Because _material()'s guard only checks whether the
    // module-level reference is still non-null (it is -- dispose() doesn't
    // null it out), the next water mesh build silently reused the same
    // now-disposed material/texture objects, which three.js then transparently
    // re-uploads to the GPU -- one more native GPU texture (and recompiled
    // shader program) leaked per dispose-and-reuse cycle, invisible to every
    // cache registry since no cache ever grew: the same JS objects were reused
    // throughout, only their GPU-side resources kept churning. Confirmed via
    // the new Wilderness Chunk Lab: renderer.info.memory.textures climbed on
    // nearly every regenerate while every one of HobunjiCacheAudit's
    // registered caches stayed flat.
    deps.displaceZoneGeometry(mesh.geometry, mapId);
    mesh.geometry.computeVertexNormals();
    console.log(`%c[zone:${mapId}] merged river/stream/waterfall water surface built: ${cells.length} tile(s), 1 draw call`, 'color:#22c55e;font-weight:bold');
    return [mesh];
  }

  window.ZoneTerrainFeatures = {
    init,
    buildZoneRampMeshes,
    buildRampCurtainMeshes,
    buildUndiggableBoulderMeshes,
    buildUndiggableBoulderShellData,
    collectUndiggableBoulderComponents,
    boulderShellSnapshot,
    buildRockFormationMeshes,
    buildWaterfallCurtainMeshes,
    buildZoneRiverWaterMeshes,
  };
  window.__waterfallRenderStats = waterfallRenderStats;
})();
