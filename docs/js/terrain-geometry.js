(() => {
  'use strict';

  // Terrain/path tile geometry builders (floor slabs, dug/raised tile
  // heightfields, per-tile and network-wide path meshes, the paved brick
  // path surface pipeline, rock tile heightfields), extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern as
  // its siblings.
  //
  // tileYCenter/tileSurfaceY deliberately stay in game.js — they're called
  // synchronously during window.WaterSystem.init() (game.js's very first
  // module init, before this module's own init() could plausibly run) and
  // are read from 15+ other places besides. Everything else here is pure
  // geometry math with almost no outer-state coupling: `grid` is only
  // ever read (via a `srcGrid = grid` default parameter, translated to
  // `srcGrid = deps.getGrid()`), and camTargetX/camTargetZ (read by
  // updatePathBrickCulling) are `let`s reassigned every frame by the
  // camera-follow code, so those two get getters. Every other captured
  // identifier (TileType/CARVED_TILE_TYPES/WATERWAY_TYPES/sameWaterway/
  // SLAB_H/NORMAL_TOP/RAISED_TOP/ROCK_H/DEPRESSION_TOP/PLATEAU_UNIT/
  // PATH_SURFACE_RECIPE_ID/pathWallBuilder/VEG_CULL_*/camera/debugLog) is
  // a `const` or stable `function` never reassigned, so it's passed by
  // direct reference.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // Geometry — full 1.0×1.0 footprint, no gaps
  // Per-tile floor: 2×2 top subdivisions with seam-free vertex displacement.
  // Displacement key is (round(worldX*2), round(worldZ*2)) so shared edge
  // vertices between adjacent tiles always hash to the same value.
  function makeFloorGeo(col, row) {
    const geo = new THREE.BoxGeometry(1.0, deps.SLAB_H, 1.0, 2, 1, 2);
    const pa  = geo.attributes.position;
    const ua  = geo.attributes.uv;
    const topY = deps.SLAB_H / 2;
    for (let vi = 0; vi < pa.count; vi++) {
      if (Math.abs(pa.getY(vi) - topY) < 1e-4) {
        const kx = Math.round((col + 0.5 + pa.getX(vi)) * 2) | 0;
        const kz = Math.round((row + 0.5 + pa.getZ(vi)) * 2) | 0;
        let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        const disp = (h / 4294967296 - 0.5) * 0.03;
        pa.setY(vi, topY + disp);
      }
      ua.setXY(vi, col + 0.5 + pa.getX(vi), row + 0.5 + pa.getZ(vi));
    }
    pa.needsUpdate = true;
    ua.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  function _mergeTileGeos(entries) {
    let vertCount = 0, idxCount = 0;
    for (const e of entries) {
      vertCount += e.geo.attributes.position.count;
      idxCount  += e.geo.index ? e.geo.index.count : e.geo.attributes.position.count;
    }
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);
    let vOff = 0, uOff = 0, iOff = 0, vBase = 0;
    for (const e of entries) {
      const pa = e.geo.attributes.position;
      const na = e.geo.attributes.normal;
      for (let i = 0; i < pa.count; i++) {
        const wx = pa.getX(i) + e.x, wz = pa.getZ(i) + e.z;
        positions[vOff]   = wx;
        positions[vOff+1] = pa.getY(i) + e.y;
        positions[vOff+2] = wz;
        normals[vOff]   = na.getX(i);
        normals[vOff+1] = na.getY(i);
        normals[vOff+2] = na.getZ(i);
        uvs[uOff] = wx; uvs[uOff+1] = wz; uOff += 2;
        vOff += 3;
      }
      const idx = e.geo.index;
      if (idx) {
        for (let i = 0; i < idx.count; i++) indices[iOff++] = idx.getX(i) + vBase;
      } else {
        for (let i = 0; i < pa.count; i++) indices[iOff++] = i + vBase;
      }
      vBase += pa.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    return g;
  }

  function buildPathTileGeo(col, row, srcGrid = deps.getGrid()) {
    const VERTS = 7, CELLS = 6, STEP = 1.0 / CELLS;
    const BLEND_V  = 2;
    const PATH_DY  = -0.045;  // depression depth — shallow, rock-tile-style dip

    // World-space smooth value noise — used to wobble the closed-edge
    // margin width *continuously along the edge's world coordinate*, so
    // the dirt/grass line meanders in long, smooth curves (serpentine,
    // like a worn footpath) instead of either a dead-straight band or
    // independent per-tile random teeth (which would just look like
    // sawtooth noise, not a winding path). Because it's keyed off world
    // position rather than per-tile randomness, the wave lines up
    // seamlessly across adjacent path tiles.
    const hash1 = n => {
      let h = (Math.imul(n | 0, 2654435761) ^ ((n | 0) << 13)) >>> 0;
      h = Math.imul(h ^ h>>>15, 1274126177) >>> 0;
      return (h >>> 0) / 4294967296;
    };
    const smooth = t => t * t * (3 - 2 * t);
    const wobble = (coord, seedOff) => {
      const WAVELEN = 3.4;  // ~3-4 tiles per S-curve — reads as serpentine, not jittery
      const xs = coord / WAVELEN + seedOff;
      const xi = Math.floor(xs), t = xs - xi;
      const a = hash1(xi), b = hash1(xi + 1);
      const v = a + (b - a) * smooth(t);       // 0..1 smooth value noise
      return 0.35 + v * 1.3;                    // multiplier range ~0.35..1.65
    };

    const openN = srcGrid[row - 1]?.[col]?.type === deps.TileType.PATH;
    const openS = srcGrid[row + 1]?.[col]?.type === deps.TileType.PATH;
    const openW = srcGrid[row]?.[col - 1]?.type === deps.TileType.PATH;
    const openE = srcGrid[row]?.[col + 1]?.type === deps.TileType.PATH;

    // Diagonal tiles — used to bevel the inner corner of L-shaped turns
    // instead of leaving a blocky right-angle notch (same technique as
    // buildTerrainTileGeo's TRENCH/RAISED corners).
    const diagNW = srcGrid[row-1]?.[col-1]?.type === deps.TileType.PATH;
    const diagNE = srcGrid[row-1]?.[col+1]?.type === deps.TileType.PATH;
    const diagSW = srcGrid[row+1]?.[col-1]?.type === deps.TileType.PATH;
    const diagSE = srcGrid[row+1]?.[col+1]?.type === deps.TileType.PATH;

    const seamDisp = (vx, vz) => {
      const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };

    // Extra roughness along the path edge — stronger than trench to get ragged border
    const roughDisp = (vx, vz) => {
      const kx = Math.round(vx * 7) | 0, kz = Math.round(vz * 7) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.045;
    };

    // Isolated 1-tile corner "nubs" — both perpendicular neighbors are
    // path, the far diagonal isn't, AND the other two sides are closed —
    // are almost always a one-tile width-step along a wider road's edge,
    // not an intentional junction. Those get a true 45° diagonal cut
    // across the whole tile (literally half path / half grass) instead
    // of just a small rounded nub, so a multi-tile-wide road's outer
    // edge reads as a chamfered line rather than a sawtooth staircase.
    // Real junctions (where another side is also open) keep the subtle
    // small-radius diagonal trim so they don't get chopped in half.
    const isCornerNW = openW && openN && !diagNW && !openS && !openE;
    const isCornerNE = openE && openN && !diagNE && !openS && !openW;
    const isCornerSW = openW && openS && !diagSW && !openN && !openE;
    const isCornerSE = openE && openS && !diagSE && !openN && !openW;
    const spanNW = isCornerNW ? CELLS : BLEND_V;
    const spanNE = isCornerNE ? CELLS : BLEND_V;
    const spanSW = isCornerSW ? CELLS : BLEND_V;
    const spanSE = isCornerSE ? CELLS : BLEND_V;

    const Y = new Float32Array(VERTS * VERTS);
    for (let vj = 0; vj < VERTS; vj++) {
      for (let vi = 0; vi < VERTS; vi++) {
        const vx = col + vi * STEP, vz = row + vj * STEP;

        // Closed-edge margin wobbles smoothly along the edge's world
        // coordinate (vz for W/E, vx for N/S) — a long serpentine curve
        // rather than a per-tile-random tooth.
        const bW = openW ? 1 : smooth(Math.min(1, (vi / BLEND_V) * wobble(vz, 0.0)));
        const bE = openE ? 1 : smooth(Math.min(1, ((CELLS - vi) / BLEND_V) * wobble(vz, 17.3)));
        const bN = openN ? 1 : smooth(Math.min(1, (vj / BLEND_V) * wobble(vx, 41.7)));
        const bS = openS ? 1 : smooth(Math.min(1, ((CELLS - vj) / BLEND_V) * wobble(vx, 89.1)));

        // Diagonal bevel — Manhattan (vi+vj) distance from the corner,
        // whose iso-lines are true 45° diagonals (unlike max(vi,vj),
        // whose iso-lines are right-angle brackets).
        const bDiagNW = (openW && openN && !diagNW) ? smooth(Math.min(1, (vi + vj)                 / spanNW)) : 1;
        const bDiagNE = (openE && openN && !diagNE) ? smooth(Math.min(1, ((CELLS-vi) + vj)         / spanNE)) : 1;
        const bDiagSW = (openW && openS && !diagSW) ? smooth(Math.min(1, (vi + (CELLS-vj))         / spanSW)) : 1;
        const bDiagSE = (openE && openS && !diagSE) ? smooth(Math.min(1, ((CELLS-vi) + (CELLS-vj)) / spanSE)) : 1;

        const blend = Math.min(1, bW * bE * bN * bS * bDiagNW * bDiagNE * bDiagSW * bDiagSE);
        Y[vj * VERTS + vi] = seamDisp(vx, vz) + blend * PATH_DY + blend * roughDisp(vx, vz);
      }
    }

    // Split: path material where the depression is visible, grass at shallow edges
    const PATH_THRESH = -0.009;  // scaled with the shallower PATH_DY
    const pathIdx = [], grassIdx = [];
    for (let cj = 0; cj < CELLS; cj++)
      for (let ci = 0; ci < CELLS; ci++) {
        const v00=cj*VERTS+ci, v10=cj*VERTS+ci+1;
        const v01=(cj+1)*VERTS+ci, v11=(cj+1)*VERTS+ci+1;
        const isPath = Math.min(Y[v00], Y[v10], Y[v01], Y[v11]) < PATH_THRESH;
        (isPath ? pathIdx : grassIdx).push(v00, v01, v11, v00, v11, v10);
      }

    const positions = [], uvs = [];
    for (let vj = 0; vj < VERTS; vj++)
      for (let vi = 0; vi < VERTS; vi++) {
        positions.push(vi * STEP - 0.5, Y[vj * VERTS + vi], vj * STEP - 0.5);
        // World-space (X,Z) UV, same convention as _mergeTileGeos — used
        // directly (unmerged) for the farm's per-tile path mesh.
        uvs.push(col + vi * STEP, row + vj * STEP);
      }

    const posAttr = new THREE.Float32BufferAttribute(positions, 3);
    const uvAttr  = new THREE.Float32BufferAttribute(uvs, 2);

    // pathGeo and grassGeo share the position buffer along the wobbling
    // path/grass boundary — compute one normal set over both face lists
    // so the boundary shades continuously instead of each geometry only
    // seeing its own half of the faces.
    const normAttr = new THREE.Float32BufferAttribute(
      _sharedSplitNormals(positions, VERTS * VERTS, pathIdx, grassIdx), 3);

    const makeGeo = idx => {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr);
      g.setAttribute('uv', uvAttr);
      g.setAttribute('normal', normAttr);
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
      return g;
    };
    return { pathGeo: makeGeo(pathIdx), grassGeo: makeGeo(grassIdx) };
  }

  // Shared helper: compute one normal per vertex from a combined face list
  // (used so two split geometries that share a position buffer along a
  // boundary — e.g. path/grass — shade continuously instead of each
  // computing normals only from its own half of the faces).
  function _sharedSplitNormals(positions, vertCount, idxA, idxB) {
    const allIdx = idxA.concat(idxB);
    const normals = new Float32Array(vertCount * 3);
    for (let f = 0; f < allIdx.length; f += 3) {
      const ia = allIdx[f], ib = allIdx[f+1], ic = allIdx[f+2];
      const ax = positions[ia*3], ay = positions[ia*3+1], az = positions[ia*3+2];
      const bx = positions[ib*3], by = positions[ib*3+1], bz = positions[ib*3+2];
      const cx = positions[ic*3], cy = positions[ic*3+1], cz = positions[ic*3+2];
      const e1x = bx-ax, e1y = by-ay, e1z = bz-az;
      const e2x = cx-ax, e2y = cy-ay, e2z = cz-az;
      const nx = e1y*e2z - e1z*e2y, ny = e1z*e2x - e1x*e2z, nz = e1x*e2y - e1y*e2x;
      normals[ia*3] += nx; normals[ia*3+1] += ny; normals[ia*3+2] += nz;
      normals[ib*3] += nx; normals[ib*3+1] += ny; normals[ib*3+2] += nz;
      normals[ic*3] += nx; normals[ic*3+1] += ny; normals[ic*3+2] += nz;
    }
    for (let v = 0; v < vertCount; v++) {
      const nx = normals[v*3], ny = normals[v*3+1], nz = normals[v*3+2];
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[v*3]=nx/len; normals[v*3+1]=ny/len; normals[v*3+2]=nz/len;
    }
    return normals;
  }

  // A whole zone's path network baked as one shared vertex grid (bounding
  // box of all PATH tiles + a margin) instead of per-tile meshes — the
  // shared grid lets the dip follow a smooth, organic, irregular line that
  // ignores the tile grid, and the dip itself reads as one continuous worn
  // groove across the whole route rather than a chain of separately-lit
  // tile depressions.
  function buildPathNetworkGeo(srcGrid, gcols, grows) {
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (let r = 0; r < grows; r++)
      for (let c = 0; c < gcols; c++)
        if (srcGrid[r]?.[c]?.type === deps.TileType.PATH) {
          if (c < minC) minC = c; if (c > maxC) maxC = c;
          if (r < minR) minR = r; if (r > maxR) maxR = r;
        }
    if (minC === Infinity) return null; // no path tiles at all

    const MARGIN = 2; // tiles of grass apron around the network for the dip to settle into
    minC = Math.max(0, minC - MARGIN); maxC = Math.min(gcols - 1, maxC + MARGIN);
    minR = Math.max(0, minR - MARGIN); maxR = Math.min(grows - 1, maxR + MARGIN);
    const bw = maxC - minC + 1, bh = maxR - minR + 1;

    const CELLS = 6, STEP = 1 / CELLS;
    const GW = bw * CELLS + 1, GH = bh * CELLS + 1;

    // The path mesh owns a broad grass apron around the route, so every
    // surface with its own relief/water geometry must punch through that
    // apron too. Reuse the mesa-lid carve set to keep waterfalls (formerly
    // omitted here) in parity with rivers/streams/trenches/raised beds;
    // ramps and paddies likewise own their complete surface.
    const EXCLUDED = new Set([...deps.CARVED_TILE_TYPES, deps.TileType.SHRUB, deps.TileType.ROCK, deps.TileType.TILLED, deps.TileType.RAMP, deps.TileType.PADDY]);
    const cellAt      = (ci, cj) => srcGrid[minR + cj]?.[minC + ci]; // Used by the apron mask and runtime hole refresh to inspect the complete terrain cell.
    const cellType    = (ci, cj) => cellAt(ci, cj)?.type;
    // Every skipFloor cell is already rendered by the mesa's continuous
    // lid/skin. The route's shared heightfield must also stop in the
    // one-cell seam around it: boundary vertices are shared, so a triangle
    // owned by the low neighboring tile can otherwise inherit one raised
    // mesa vertex and form a grass flap up the cliff. Ordinary per-tile
    // floor fills that seam; paved path bricks remain independent.
    const ownsMesaSurface = tile => !!tile?.skipFloor || !!tile?.incline || !!tile?.mesaCliffFace; // Used by the route exclusion halo to identify mesa/cliff geometry owners.
    const isExcludedCell = (ci, cj) => {
      const tile = cellAt(ci, cj);
      if (ownsMesaSurface(tile) || EXCLUDED.has(tile?.type)) return true;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if ((dc || dr) && ownsMesaSurface(cellAt(ci + dc, cj + dr))) return true;
      }
      return false;
    };
    const isPathCell  = (ci, cj) => cellType(ci, cj) === deps.TileType.PATH;

    // Vertices on a tile boundary touch 2 (edge) or 4 (corner) cells —
    // average their path-membership so the mask starts as a clean 0 /
    // 0.25 / 0.5 / 0.75 / 1 step instead of guessing a single owner cell.
    const touching = (g, n) => {
      if (g % CELLS === 0) {
        const a = g / CELLS - 1, b = g / CELLS, arr = [];
        if (a >= 0 && a < n) arr.push(a);
        if (b >= 0 && b < n) arr.push(b);
        return arr;
      }
      return [Math.floor(g / CELLS)];
    };

    let mask = new Float32Array(GW * GH);
    for (let gj = 0; gj < GH; gj++) {
      const rows = touching(gj, bh);
      for (let gi = 0; gi < GW; gi++) {
        const cols = touching(gi, bw);
        let sum = 0, n = 0;
        for (const cj of rows) for (const ci of cols) { n++; if (isPathCell(ci, cj)) sum++; }
        mask[gj * GW + gi] = n ? sum / n : 0;
      }
    }

    // Box-blur the mask a few times to round it into an organic, non-grid
    // boundary — this is what gives the rim its "more complex/defineable"
    // character instead of a tile-square hole.
    for (let pass = 0; pass < 3; pass++) {
      const next = new Float32Array(GW * GH);
      for (let gj = 0; gj < GH; gj++)
        for (let gi = 0; gi < GW; gi++) {
          let sum = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ni = gi+di, nj = gj+dj;
              if (ni<0||ni>=GW||nj<0||nj>=GH) continue;
              sum += mask[nj*GW+ni]; n++;
            }
          next[gj*GW+gi] = sum / n;
        }
      mask = next;
    }

    const seamDisp = (vx, vz) => {
      const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };
    const roughDisp = (vx, vz) => {
      const kx = Math.round(vx * 7) | 0, kz = Math.round(vz * 7) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.045;
    };
    const smooth = t => t * t * (3 - 2 * t);
    const PATH_DY = -0.05; // shallow — a worn groove, not a trench

    // Y[] stays tier-independent (local worn-groove height only) since
    // PATH_THRESH below is tuned against it — positions[] is what
    // actually renders, and separately bakes in each vertex's owning
    // tile's own elevTier so a path network that sits on a plateau
    // doesn't render pinned to ground level while the plateau ground
    // around it sits PLATEAU_UNIT higher (previously: a path crossing a
    // plateau rendered as a hole cut through the mesa, the flat patch
    // sunk far below the actual elevated surface).
    const Y = new Float32Array(GW * GH);
    const positions = new Float32Array(GW * GH * 3);
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++) {
        const vx = minC + gi * STEP, vz = minR + gj * STEP;
        const blend = smooth(Math.min(1, Math.max(0, mask[gj*GW+gi])));
        const localY = seamDisp(vx, vz) + blend * PATH_DY + blend * roughDisp(vx, vz);
        const tci = Math.min(bw - 1, Math.floor(gi / CELLS));
        const tcj = Math.min(bh - 1, Math.floor(gj / CELLS));
        const ownerTile = srcGrid[minR + tcj]?.[minC + tci]; // Supplies the absolute terrain tier for this route vertex.
        const tierY = (ownerTile?.elevTier || 0) * deps.PLATEAU_UNIT;
        const k = gj*GW+gi;
        Y[k] = localY;
        positions[k*3] = vx; positions[k*3+1] = tierY + localY; positions[k*3+2] = vz;
      }

    const PATH_THRESH = -0.013; // tuned for PATH_DY=-0.05 after the blur softens the mask
    const pathIdx = [], grassIdx = [];
    for (let cj = 0; cj < GH-1; cj++)
      for (let ci = 0; ci < GW-1; ci++) {
        const tci = Math.min(bw-1, Math.floor(ci / CELLS));
        const tcj = Math.min(bh-1, Math.floor(cj / CELLS));
        const v00=cj*GW+ci, v10=cj*GW+ci+1, v01=(cj+1)*GW+ci, v11=(cj+1)*GW+ci+1;
        const isPath = Math.min(Y[v00],Y[v10],Y[v01],Y[v11]) < PATH_THRESH;
        const target = isPath ? pathIdx : grassIdx;
        target.push(v00, v01, v11, v00, v11, v10);
      }

    const vertCount = GW * GH;
    const posAttr  = new THREE.Float32BufferAttribute(positions, 3);
    const normAttr = new THREE.Float32BufferAttribute(
      _sharedSplitNormals(positions, vertCount, pathIdx, grassIdx), 3);

    const makeGeo = idx => {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr);
      g.setAttribute('normal', normAttr);
      g.setIndex(new THREE.BufferAttribute(
        vertCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      return g;
    };

    const network = {
      pathGeo: makeGeo(pathIdx),
      grassGeo: makeGeo(grassIdx),
      inBounds: (c, r) => c >= minC && c <= maxC && r >= minR && r <= maxR,
      isExcludedTile: (c, r) => isExcludedCell(c - minC, r - minR),
      globalGroundMesh: null,
      globalGroundGeometry: null,
      originalGroundIndex: null,
      renderedTileIndexRanges: new Map(),
      bindGlobalGroundMesh(mesh) {
        this.globalGroundMesh = mesh;
        // TerrainRenderChunks replaces and spatially reorders large
        // terrain index buffers immediately before their first render.
        // Bind only after that handoff, so runtime digs edit the index
        // buffer the GPU-facing child meshes actually share.
        mesh.userData.onTerrainGeometryReady = geometry => this.bindRenderedGroundGeometry(geometry);
        if (!window.TerrainRenderChunks?.installed) this.bindRenderedGroundGeometry(mesh.geometry);
      },
      bindRenderedGroundGeometry(geometry) {
        const position = geometry?.getAttribute?.('position');
        const indexAttr = geometry?.index;
        if (!position || !indexAttr) return false;
        const ranges = new Map(); // Maps a world tile to triangle starts in the final rendered index order.
        for (let offset = 0; offset + 2 < indexAttr.count; offset += 3) {
          const a = indexAttr.getX(offset), b = indexAttr.getX(offset + 1), c = indexAttr.getX(offset + 2);
          const tileC = Math.floor((position.getX(a) + position.getX(b) + position.getX(c)) / 3);
          const tileR = Math.floor((position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3);
          if (tileC < minC || tileC > maxC || tileR < minR || tileR > maxR) continue;
          const key = `${tileC},${tileR}`;
          let starts = ranges.get(key);
          if (!starts) ranges.set(key, starts = []);
          starts.push(offset);
        }
        this.globalGroundGeometry = geometry;
        this.originalGroundIndex = indexAttr.array.slice();
        this.renderedTileIndexRanges = ranges;
        // Collapse authored/generated basins before the first real draw.
        // Their original triangles remain available for fill/redig.
        for (const key of ranges.keys()) {
          const [c, r] = key.split(',').map(Number);
          if (this.isExcludedTile(c, r)) this.refreshTile(c, r);
        }
        return true;
      },
      refreshTile(c, r) {
        const indexAttr = this.globalGroundGeometry?.index;
        const original = this.originalGroundIndex;
        const starts = this.renderedTileIndexRanges.get(`${c},${r}`);
        if (!indexAttr || !original || !starts) return false;
        const excluded = this.isExcludedTile(c, r);
        for (const offset of starts) {
          if (excluded) {
            const collapsedVertex = original[offset];
            for (let i = 0; i < 3; i++) indexAttr.array[offset + i] = collapsedVertex;
          } else {
            for (let i = 0; i < 3; i++) indexAttr.array[offset + i] = original[offset + i];
          }
        }
        indexAttr.needsUpdate = true;
        return true;
      },
      refreshTileAndSeam(c, r) {
        let updated = false; // Returned to the mobile terrain-refresh log after all nine affected route cells are toggled.
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          updated = this.refreshTile(c + dc, r + dr) || updated;
        }
        return updated;
      },
    };
    return network;
  }

  // ── Path: paved brick surface (WallBuilder "horizontal wall") ──────────────
  // Ports the town-path-preview tool's "wall-generated surface" technique:
  // WallBuilder normally stands its recipe's brick lattice up along a
  // vertical quad (see panelCorners() in WallBuilder.js — width along local
  // +X, height along local +Y). Passing an explicit `corners` array bypasses
  // that vertical-quad derivation entirely, so 4 corners that all share one
  // Y instead describe a FLAT quad lying in the XZ plane — build()'s own
  // quadBasis() then derives a +Y-ish normal and u/v axes from those corners
  // with no other change needed, so the exact same brick-placement math
  // (generateWallMatricesFromRecipe, which only ever reasons in the panel's
  // own local width×height grid) ends up laying bricks down flat instead of
  // upright.
  //
  // Paving the whole spline corridor in one WallBuilder panel is fine for a
  // town-sized route but doesn't scale to a long wilderness road — so
  // instead of one huge panel (or a streamed window rebuilt as the player
  // moves, which still pays a geometry-generation cost on every rebuild),
  // the corridor is chunked into fixed PATH_BRICK_CHUNK_SIZE cells and
  // every chunk that actually overlaps the corridor is built ONCE, up
  // front (buildAllPathBrickChunks) — empty cells (most of a route's own
  // bounding box, since the corridor is a thin strip through it) are
  // skipped entirely rather than paying to generate-then-discard. From
  // then on nothing is ever rebuilt: gameLoop's throttled tick just
  // toggles each chunk's .visible using the exact same camera-aligned-
  // corridor test already used for wilderness tree culling
  // (updateZoneVegetationCulling/VEG_CULL_* below) — see
  // updatePathBrickCulling. The one-time spline math (route selection,
  // Catmull-Rom sampling, corridor containment test) is prepared once per
  // zone by preparePathSplineData and reused by every chunk.
  const PATH_BRICK_CHUNK_SIZE = 10; // world units (≈ tiles) per pre-built chunk

  function _routeCurvePoints(route) {
    const pts = (route.nodes || [])
      .map(n => new THREE.Vector3(Number(n[0]) + 0.5, 0, Number(n[1]) + 0.5))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
    if (pts.length < 2) return [];
    if (pts.length === 2) {
      const out = [];
      for (let i = 0; i <= 24; i++) out.push(pts[0].clone().lerp(pts[1], i / 24));
      return out;
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.45);
    return curve.getPoints(Math.max(32, (pts.length - 1) * 28));
  }
  function _segDistSq(px, pz, a, b) {
    const vx = b.x - a.x, vz = b.z - a.z, wx = px - a.x, wz = pz - a.z, c1 = vx * wx + vz * wz;
    if (c1 <= 0) return wx * wx + wz * wz;
    const c2 = vx * vx + vz * vz;
    if (c2 <= c1) { const dx = px - b.x, dz = pz - b.z; return dx * dx + dz * dz; }
    const t = c1 / c2, dx = px - (a.x + t * vx), dz = pz - (a.z + t * vz);
    return dx * dx + dz * dz;
  }
  // One-time (per zone) spline prep: picks which route(s) to pave and bakes
  // their sampled centerlines + a corridor containment test + the overall
  // bounding box, all reused by every streamed rebuild below.
  function preparePathSplineData(srcGrid, gcols, grows, routes, mapId) {
    const width = 3.25, tol = 0.05; // matches the preview tool's exported path.pathWidth/edgeTolerance
    const pathTiles = new Set();
    let tileMinC = Infinity, tileMaxC = -Infinity, tileMinR = Infinity, tileMaxR = -Infinity;
    for (let r = 0; r < grows; r++) for (let c = 0; c < gcols; c++)
      if (srcGrid[r]?.[c]?.type === deps.TileType.PATH) {
        pathTiles.add(c + ',' + r);
        if (c < tileMinC) tileMinC = c; if (c > tileMaxC) tileMaxC = c;
        if (r < tileMinR) tileMinR = r; if (r > tileMaxR) tileMaxR = r;
      }
    // Plateau zones (Northern Cliffs, Southern Cloud Forest, ...) carve a
    // road across multiple elevation tiers — buildPathNetworkGeo's own
    // flat mesh already bakes each vertex's owning tile's elevTier into
    // its Y (see its "positions[] is what actually renders" comment), so
    // a WallBuilder brick corridor built at one single flat Y would land
    // underground/off in the air the moment the route crosses onto a
    // raised tier. Snapped per-instance in buildPathBrickChunkAt below.
    const elevTierAt = (x, z) => srcGrid[Math.floor(z)]?.[Math.floor(x)]?.elevTier || 0;
    if (!pathTiles.size) {
      // Not necessarily a bug — plenty of zones legitimately have no
      // TileType.PATH tiles at all — but worth a trace-level note since
      // "why are there no bricks here" always starts by ruling this out.
      deps.debugLog(`Path brick surface (${mapId}): no PATH tiles in this grid, skipping.`);
      return null;
    }

    // Auto-pick whichever route(s) actually overlap the painted path tiles
    // (same scoring as the preview's selectedRoutes/routeOverlapScore) —
    // a route authored for something else (an NPC patrol, say) that
    // happens to share the map shouldn't also get paved.
    function pointNearPaintedPath(c, r, rad) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++)
        if (pathTiles.has((Math.floor(c) + dc) + ',' + (Math.floor(r) + dr))) return true;
      return false;
    }
    const candidates = (routes || []).filter(r => Array.isArray(r.nodes) && r.nodes.length >= 2);
    const scored = candidates.map(r => {
      const nodes = r.nodes || [];
      let hit = 0;
      for (const n of nodes) if (Array.isArray(n) && pointNearPaintedPath(Number(n[0]) + 0.5, Number(n[1]) + 0.5, 2)) hit++;
      return [r, nodes.length ? hit / nodes.length : 0];
    }).sort((a, b) => b[1] - a[1]);
    const good = scored.filter(x => x[1] >= 0.45).map(x => x[0]);
    const selected = good.length ? good : (scored.length ? [scored[0][0]] : []);

    const samples = selected.length ? selected.map(_routeCurvePoints).filter(s => s.length >= 2) : [];
    if (samples.length) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const arr of samples) for (const p of arr) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const margin = width / 2 + 0.8;
      minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;

      const rr = (width / 2 + tol) * (width / 2 + tol);
      function containsPoint(x, z) {
        for (const arr of samples) for (let i = 0; i < arr.length - 1; i++)
          if (_segDistSq(x, z, arr[i], arr[i + 1]) <= rr) return true;
        return false;
      }
      deps.debugLog(`Path brick surface (${mapId}): spline mode, ${selected.length} route(s), ${pathTiles.size} PATH tile(s).`);
      return { samples, containsPoint, elevTierAt, bounds: { minX, maxX, minZ, maxZ } };
    }

    // No authored route data overlaps this map's painted path tiles at
    // all (e.g. the farm's hardcoded day-one path, or a hand-painted
    // zone path with no route) — fall back to the preview tool's other
    // mode, "tile-locked": the corridor is exactly the painted PATH
    // cells themselves instead of a spline distance test. Blockier than
    // the spline corridor on a curved route, but the farm's own path is
    // a straight rectangular strip anyway, so it costs nothing there.
    deps.debugLog(`Path brick surface (${mapId}): no route matched ${pathTiles.size} painted PATH tile(s) (${candidates.length} candidate route(s) checked) — falling back to tile-locked mode.`, candidates.length ? 'warn' : 'info');
    return {
      samples: null,
      containsPoint: (x, z) => pathTiles.has(Math.floor(x) + ',' + Math.floor(z)),
      elevTierAt,
      bounds: { minX: tileMinC, maxX: tileMaxC + 1, minZ: tileMinR, maxZ: tileMaxR + 1 },
    };
  }
  // Builds one WallBuilder panel covering exactly one fixed grid cell
  // (chunkMinX..chunkMinX+size, chunkMinZ..chunkMinZ+size), then prunes
  // instances outside the actual corridor exactly like the original
  // single-panel version did (see preparePathSplineData.containsPoint).
  // Returns null if that cell has no corridor overlap at all — the
  // caller uses that to skip empty cells rather than keep an empty group.
  function buildPathBrickChunkAt(splineData, chunkMinX, chunkMinZ, size) {
    const minX = chunkMinX, maxX = chunkMinX + size, minZ = chunkMinZ, maxZ = chunkMinZ + size;
    const y = deps.NORMAL_TOP + 0.01; // small lift above the flat path/grass mesh beneath, avoids z-fighting
    const panel = {
      id: 'path_surface_chunk', width: size, height: size, wallRecipeId: deps.PATH_SURFACE_RECIPE_ID,
      position: [(minX + maxX) / 2, y, (minZ + maxZ) / 2], rotationDeg: [0, 0, 0],
      corners: [[minX, y, maxZ], [maxX, y, maxZ], [maxX, y, minZ], [minX, y, minZ]],
    };
    const opts = {
      usePlaceholder: true, unitMult: 0.55, densityMult: 1, rockScale: 1.15,
      preScale: [1, 1, 0.32], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 },
    };
    const group = deps.pathWallBuilder.build([panel], opts);
    group.name = 'PathBrickSurfaceChunk';

    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let anyKept = false;
    group.traverse(o => {
      if (!o.isInstancedMesh) return;
      const n = o.count;
      let kept = 0;
      for (let i = 0; i < n; i++) {
        o.getMatrixAt(i, m);
        m.decompose(p, q, s);
        if (!splineData.containsPoint(p.x, p.z)) continue;
        // Re-lift this one instance onto its own tile's elevation tier —
        // see elevTierAt's comment in preparePathSplineData. The panel
        // itself was built flat at the zone's base Y, so every brick
        // needs its own per-instance correction rather than one offset
        // for the whole chunk.
        const tier = splineData.elevTierAt ? splineData.elevTierAt(p.x, p.z) : 0;
        if (tier) { p.y += tier * deps.PLATEAU_UNIT; m.compose(p, q, s); }
        if (kept !== i) o.setMatrixAt(kept, m);
        kept++;
      }
      o.count = kept;
      o.instanceMatrix.needsUpdate = true;
      o.castShadow = true;
      o.receiveShadow = true;
      if (kept) anyKept = true;
    });
    if (!anyKept) { WallBuilder.disposeGroup(group); return null; }
    return group;
  }
  // Builds every non-empty chunk over the corridor's bounding box, once.
  // Each surviving chunk is tagged with userData.cullSphere in the exact
  // shape updateZoneVegetationCulling already expects ({x,z,radius}), so
  // updatePathBrickCulling below can reuse that same corridor-visibility
  // formula unmodified.
  function buildAllPathBrickChunks(splineData, scene) {
    const b = splineData.bounds, size = PATH_BRICK_CHUNK_SIZE;
    const chunkRadius = Math.SQRT2 * size / 2; // half-diagonal of a size×size cell
    const chunks = [];
    for (let cz = Math.floor(b.minZ / size) * size; cz < b.maxZ; cz += size) {
      for (let cx = Math.floor(b.minX / size) * size; cx < b.maxX; cx += size) {
        const group = buildPathBrickChunkAt(splineData, cx, cz, size);
        if (!group) continue;
        group.visible = false; // first updatePathBrickCulling pass decides what's actually shown
        group.userData.cullSphere = { x: cx + size / 2, z: cz + size / 2, radius: chunkRadius };
        scene.add(group);
        chunks.push(group);
      }
    }
    return chunks;
  }
  // Per-zone chunk list: mapId -> THREE.Group[]. Keyed so town, farm, and
  // every wilderness zone each keep their own chunk set without fighting
  // over one slot.
  const _pathBrickChunkLists = new Map();
  function registerPathBrickChunks(mapId, scene, splineData) {
    // Disposes any previous chunk set for this mapId first — a zone can
    // rebuild its scene (Tothal Shift, cache invalidation) and call this
    // again, and a stale chunk set left in the scene would otherwise leak
    // both the GPU buffers and a dangling reference this map's cull pass
    // still walks every tick.
    const prev = _pathBrickChunkLists.get(mapId);
    if (prev) for (const g of prev) { scene.remove(g); WallBuilder.disposeGroup(g); }
    const chunks = buildAllPathBrickChunks(splineData, scene);
    _pathBrickChunkLists.set(mapId, chunks);
    if (chunks.length) {
      const total = chunks.reduce((sum, g) => sum + g.children.reduce((s2, o) => s2 + (o.isInstancedMesh ? o.count : 0), 0), 0);
      deps.debugLog(`Path brick surface (${mapId}): ${chunks.length} chunk(s), ${total} brick instance(s).`);
    } else {
      // splineData always has a real corridor by this point (see
      // preparePathSplineData — it only ever returns null, which callers
      // check before reaching here) — zero chunks means every single
      // per-chunk WallBuilder generate-then-filter pass came up empty,
      // which points at the corridor math or recipe/unitMult, not at
      // "this map just has no path."
      deps.debugLog(`Path brick surface (${mapId}): corridor bounds ${JSON.stringify(splineData.bounds)} produced 0 chunks — recipe/corridor mismatch?`, 'warn');
    }
  }
  // Called from the throttled tick below for whichever zone is currently
  // active. Identical corridor test to updateZoneVegetationCulling
  // (camera-aligned forward/rear/width box around VEG_CULL_* tiles, with
  // hysteresis so a chunk right at the boundary doesn't flicker every
  // tick) — same technique, just toggling pre-built path chunks instead
  // of pre-built tree groups, so it costs nothing beyond that dot-product
  // test per chunk regardless of how long the corridor is.
  function updatePathBrickCulling(mapId, force) {
    const chunks = _pathBrickChunkLists.get(mapId);
    if (!chunks || !chunks.length) return;
    const camX = deps.camera.position.x, camZ = deps.camera.position.z;
    let viewX = deps.getCamTargetX() - camX, viewZ = deps.getCamTargetZ() - camZ;
    let viewLen = Math.hypot(viewX, viewZ);
    if (viewLen < 1e-5) { viewX = 0; viewZ = 1; viewLen = 1; }
    viewX /= viewLen; viewZ /= viewLen;
    const rightX = viewZ, rightZ = -viewX;
    const forwardRange = deps.VEG_CULL_FORWARD_TILES, rearRange = deps.VEG_CULL_REAR_TILES;
    const halfWidth = deps.VEG_CULL_WIDTH_TILES * 0.5, hysteresis = deps.VEG_CULL_HYSTERESIS_TILES;
    for (const chunk of chunks) {
      const s = chunk.userData.cullSphere;
      const dx = s.x - camX, dz = s.z - camZ;
      const along = dx * viewX + dz * viewZ;
      const side = Math.abs(dx * rightX + dz * rightZ);
      const sticky = chunk.visible ? hysteresis : 0;
      const expandedRadius = s.radius + sticky;
      const show = along >= -(rearRange + expandedRadius) && along <= forwardRange + expandedRadius
        && side <= halfWidth + expandedRadius;
      if (force || show !== chunk.visible) chunk.visible = show;
    }
  }

  // ── Rock tile: irregular mini plateau heightfield ───────────────────────────
  // Restores the pre-extraction contract: callers receive separate stone and
  // grass geometries sharing one deterministic mound surface. The extraction
  // accidentally replaced this with one flat BufferGeometry even though every
  // live caller continued destructuring { stoneGeo, grassGeo }.
  function buildRockTileGeo(col, row) {
    const VERTS = 7, CELLS = 6;
    const STEP = 1.0 / CELLS;

    let seed = ((col * 374761393) ^ (row * 668265263)) >>> 0; // Used to make each tile's irregular mound deterministic.
    const rng = () => {
      seed += 0x6D2B79F5;
      let value = Math.imul(seed ^ seed >>> 15, seed | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };

    const seamDisp = (vx, vz) => {
      const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };

    // Finer roughness detail for the mound surface.
    const roughDisp = (vx, vz) => {
      const kx = Math.round(vx * 8) | 0;
      const kz = Math.round(vz * 8) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.05;
    };

    const Y = new Float32Array(VERTS * VERTS);
    for (let vj = 0; vj < VERTS; vj++)
      for (let vi = 0; vi < VERTS; vi++)
        Y[vj*VERTS+vi] = seamDisp(col + vi*STEP, row + vj*STEP);

    // BFS plateau from a random interior starting cell (never touches edge cells).
    const startCi = 1 + Math.floor(rng() * (CELLS - 2));
    const startCj = 1 + Math.floor(rng() * (CELLS - 2));
    const maxSize = 2 + Math.floor(rng() * 12);
    const group = new Set([startCj * CELLS + startCi]);
    const front = [[startCi, startCj]];

    while (front.length && group.size < maxSize) {
      const fi = Math.floor(rng() * front.length);
      const [ci, cj] = front.splice(fi, 1)[0];
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ni = ci+dc, nj = cj+dr;
        if (ni < 1 || ni > CELLS-2 || nj < 1 || nj > CELLS-2) continue;
        const nk = nj*CELLS+ni;
        if (group.has(nk)) continue;
        group.add(nk); front.push([ni, nj]);
      }
    }

    // Collect plateau vertex indices and find peak.
    let maxY = -Infinity;
    const raised = new Set();
    for (const ck of group) {
      const ci = ck % CELLS, cj = (ck / CELLS) | 0;
      for (const vi of [cj*VERTS+ci, cj*VERTS+ci+1, (cj+1)*VERTS+ci, (cj+1)*VERTS+ci+1]) {
        raised.add(vi);
        if (Y[vi] > maxY) maxY = Y[vi];
      }
    }

    const PEAK = 0.32 + rng() * 0.38;
    const target = maxY + PEAK;

    // Raise plateau verts, blending to zero at tile edges.
    for (const vi of raised) {
      const vix = vi % VERTS, viy = (vi / VERTS) | 0;
      const edgeDist = Math.min(vix, VERTS-1-vix, viy, VERTS-1-viy);
      const blend = Math.min(1, edgeDist / 2);
      if (blend <= 0) continue;
      const vx = col + vix*STEP, vz = row + viy*STEP;
      const h = seamDisp(vx, vz) + blend * target + roughDisp(vx, vz) * blend;
      if (h > Y[vi]) Y[vi] = h;
    }

    const positions = [], uvs = [];
    for (let vj = 0; vj < VERTS; vj++)
      for (let vi = 0; vi < VERTS; vi++) {
        positions.push(vi*STEP - 0.5, Y[vj*VERTS+vi], vj*STEP - 0.5);
        // World-space (X,Z) UV, same convention as _mergeTileGeos — this
        // geometry is also used directly for farm/cavern loose rocks.
        uvs.push(col + vi*STEP, row + vj*STEP);
      }

    // Split cells: stone if any corner is elevated (plateau or cliff face),
    // grass if all corners are at ground level. Threshold 0.05u sits above
    // the ±0.013u seam noise so ground cells always go green.
    const stoneIdx = [], grassIdx = [];
    for (let cj = 0; cj < CELLS; cj++)
      for (let ci = 0; ci < CELLS; ci++) {
        const v00=cj*VERTS+ci, v10=cj*VERTS+ci+1;
        const v01=(cj+1)*VERTS+ci, v11=(cj+1)*VERTS+ci+1;
        const tgt = Math.max(Y[v00], Y[v10], Y[v01], Y[v11]) > 0.05
          ? stoneIdx : grassIdx;
        tgt.push(v00, v01, v11, v00, v11, v10);
      }

    const posAttr = new THREE.Float32BufferAttribute(positions, 3);
    const uvAttr  = new THREE.Float32BufferAttribute(uvs, 2);
    const makeGeo = idx => {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr);
      g.setAttribute('uv', uvAttr);
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
      g.computeVertexNormals();
      return g;
    };
    return { stoneGeo: makeGeo(stoneIdx), grassGeo: makeGeo(grassIdx) };
  }

  function buildTerrainTileGeo(col, row, type, srcGrid = deps.getGrid(), options = {}) {
    const VERTS = 7, CELLS = 6, STEP = 1.0 / CELLS;
    const BLEND_V  = 2;
    // Trench is a dug pit meant to mirror the raised bed's wide flat top
    // (just inverted) — same wide-plateau factor as RAISED. The natural
    // waterway types (river/stream/waterfall) keep the narrower, more
    // tapered 1.5 blend since those should still read as carved channels.
    const PLATEAU  = (type === deps.TileType.RAISED || type === deps.TileType.TRENCH) ? 3.0 : 1.5;
    const depressionTop = deps.DEPRESSION_TOP[type];
    const isDepression = depressionTop !== undefined;
    const targetDY = isDepression
      ? depressionTop - deps.NORMAL_TOP
      : deps.RAISED_TOP - deps.NORMAL_TOP;  // +0.5

    // A dug TRENCH is a deliberate, hand-cut square pit — full depth to
    // every edge. Wilderness waterways opt into the same basin profile
    // through includeCutWalls, while town waterways retain their softer
    // bank blend. Adjacent basin cells omit their internal walls below,
    // leaving one continuous bottom with walls only along the outer bank.
    const isTrench = type === deps.TileType.TRENCH;
    const isCutWaterBasin = options.includeCutWalls && deps.WATERWAY_TYPES.has(type); // Gives wilderness water the same full-depth basin treatment as its trenches.
    const isCutBasin = isTrench || isCutWaterBasin;
    const openN = isCutBasin || deps.sameWaterway(srcGrid[row - 1]?.[col]?.type, type);
    const openS = isCutBasin || deps.sameWaterway(srcGrid[row + 1]?.[col]?.type, type);
    const openW = isCutBasin || deps.sameWaterway(srcGrid[row]?.[col - 1]?.type, type);
    const openE = isCutBasin || deps.sameWaterway(srcGrid[row]?.[col + 1]?.type, type);

    // Diagonal tiles — used to seal the inner corner of L-shaped turns
    const diagNW = isCutBasin || deps.sameWaterway(srcGrid[row-1]?.[col-1]?.type, type);
    const diagNE = isCutBasin || deps.sameWaterway(srcGrid[row-1]?.[col+1]?.type, type);
    const diagSW = isCutBasin || deps.sameWaterway(srcGrid[row+1]?.[col-1]?.type, type);
    const diagSE = isCutBasin || deps.sameWaterway(srcGrid[row+1]?.[col+1]?.type, type);

    const seamDisp = (vx, vz) => {
      const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };

    const roughDisp = (vx, vz) => {
      const kx = Math.round(vx * 6) | 0, kz = Math.round(vz * 6) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.035;
    };

    const smooth = t => t * t * (3 - 2 * t);

    const Y = new Float32Array(VERTS * VERTS);
    for (let vj = 0; vj < VERTS; vj++) {
      for (let vi = 0; vi < VERTS; vi++) {
        const bW = openW ? 1 : smooth(Math.min(1, vi / BLEND_V));
        const bE = openE ? 1 : smooth(Math.min(1, (CELLS - vi) / BLEND_V));
        const bN = openN ? 1 : smooth(Math.min(1, vj / BLEND_V));
        const bS = openS ? 1 : smooth(Math.min(1, (CELLS - vj) / BLEND_V));

        // Diagonal correction: if both open sides share an outer (non-matching) diagonal,
        // fade the inner corner vertex back to NORMAL_TOP. Uses max() so only the exact
        // corner region (within BLEND_V steps of BOTH adjacent open edges) is affected.
        const bDiagNW = (openW && openN && !diagNW) ? smooth(Math.min(1, Math.max(vi, vj)           / BLEND_V)) : 1;
        const bDiagNE = (openE && openN && !diagNE) ? smooth(Math.min(1, Math.max(CELLS-vi, vj)     / BLEND_V)) : 1;
        const bDiagSW = (openW && openS && !diagSW) ? smooth(Math.min(1, Math.max(vi, CELLS-vj)     / BLEND_V)) : 1;
        const bDiagSE = (openE && openS && !diagSE) ? smooth(Math.min(1, Math.max(CELLS-vi, CELLS-vj) / BLEND_V)) : 1;

        const blend = Math.min(1, bW * bE * bN * bS * bDiagNW * bDiagNE * bDiagSW * bDiagSE * PLATEAU);
        const vx = col + vi * STEP, vz = row + vj * STEP;
        Y[vj * VERTS + vi] = seamDisp(vx, vz) + blend * targetDY + blend * roughDisp(vx, vz);
      }
    }

    const positions = [], uvs = [];
    for (let vj = 0; vj < VERTS; vj++)
      for (let vi = 0; vi < VERTS; vi++) {
        positions.push(vi * STEP - 0.5, Y[vj * VERTS + vi], vj * STEP - 0.5);
        // World-space (X,Z) UV, same convention as _mergeTileGeos — used
        // directly (unmerged) for the farm's per-tile trench/raised mesh.
        uvs.push(col + vi * STEP, row + vj * STEP);
      }

    // Farm ground uses individual box slabs, whose exposed side faces
    // naturally wall an adjacent trench. Wilderness route/mesa surfaces
    // are top-only heightfields, so removing their grass quad would expose
    // an empty vertical gap around the trench. Add segmented dirt cut walls
    // to the trench geometry itself for that renderer. Ordered samples keep
    // each quad front-facing toward the surrounding ground and share edge
    // vertices so normals remain smooth along the wall.
    const wallIdx = [];
    if (isDepression && options.includeCutWalls) {
      const sharesBasin = neighborType => isTrench
        ? neighborType === deps.TileType.TRENCH
        : deps.WATERWAY_TYPES.has(neighborType);
      const appendWall = (samples, horizontal) => {
        const first = positions.length / 3;
        for (let i = 0; i < samples.length; i++) {
          const { vi, vj } = samples[i];
          const x = vi * STEP - 0.5, z = vj * STEP - 0.5;
          const worldX = col + vi * STEP, worldZ = row + vj * STEP;
          const bottomY = Y[vj * VERTS + vi];
          const topY = seamDisp(worldX, worldZ);
          const along = horizontal ? worldX : worldZ;
          positions.push(x, topY, z, x, bottomY, z);
          uvs.push(along, topY, along, bottomY);
        }
        for (let i = 0; i < samples.length - 1; i++) {
          const top0 = first + i * 2, bottom0 = top0 + 1;
          const top1 = top0 + 2, bottom1 = top0 + 3;
          // Faces point into the basin, where the camera sees them from
          // above. The opposite winding points out into the surrounding
          // solid ground and gets removed by normal backface culling.
          wallIdx.push(top0, bottom1, bottom0, top0, top1, bottom1);
        }
      };
      if (!sharesBasin(srcGrid[row - 1]?.[col]?.type)) appendWall(Array.from({ length: VERTS }, (_, i) => ({ vi: CELLS - i, vj: 0 })), true);
      if (!sharesBasin(srcGrid[row + 1]?.[col]?.type)) appendWall(Array.from({ length: VERTS }, (_, i) => ({ vi: i, vj: CELLS })), true);
      if (!sharesBasin(srcGrid[row]?.[col - 1]?.type)) appendWall(Array.from({ length: VERTS }, (_, i) => ({ vi: 0, vj: i })), false);
      if (!sharesBasin(srcGrid[row]?.[col + 1]?.type)) appendWall(Array.from({ length: VERTS }, (_, i) => ({ vi: CELLS, vj: CELLS - i })), false);
    }

    // Split cells: dirt where significantly depressed (trench) or elevated (raised);
    // grass on flat edge cells that blend back to ground level.
    const DIRT_THRESH = 0.05;
    const dirtIdx = [], grassIdx = [];
    for (let cj = 0; cj < CELLS; cj++)
      for (let ci = 0; ci < CELLS; ci++) {
        const v00=cj*VERTS+ci, v10=cj*VERTS+ci+1;
        const v01=(cj+1)*VERTS+ci, v11=(cj+1)*VERTS+ci+1;
        const y00=Y[v00], y10=Y[v10], y01=Y[v01], y11=Y[v11];
        const isDirt = isDepression
          ? Math.min(y00, y10, y01, y11) < -DIRT_THRESH
          : Math.max(y00, y10, y01, y11) >  DIRT_THRESH;
        (isDirt ? dirtIdx : grassIdx).push(v00, v01, v11, v00, v11, v10);
      }

    const posAttr = new THREE.Float32BufferAttribute(positions, 3);
    const uvAttr  = new THREE.Float32BufferAttribute(uvs, 2);
    dirtIdx.push(...wallIdx);
    const makeGeo = idx => {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr);
      g.setAttribute('uv', uvAttr);
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
      g.computeVertexNormals();
      return g;
    };
    return { dirtGeo: makeGeo(dirtIdx), grassGeo: makeGeo(grassIdx) };
  }

  window.TerrainGeometry = {
    init,
    makeFloorGeo, _mergeTileGeos, buildPathTileGeo, buildPathNetworkGeo,
    preparePathSplineData, buildAllPathBrickChunks, registerPathBrickChunks,
    updatePathBrickCulling, buildRockTileGeo, buildTerrainTileGeo,
  };
})();
