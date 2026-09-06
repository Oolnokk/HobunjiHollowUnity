// Pure-data terrain merge/geometry math for the Map Editor's plateau system —
// shared between the live 3D preview in docs/tools/map-editor/index.html and
// the headless watertightness checker in scripts/check-terrain.js.
//
// This deliberately mirrors (not imports) the equivalent logic in
// docs/game.js's _loadTownFromWorkspace() (mergeZoneTiles), buildZoneScene()
// (zGrid construction, ramp-curtain flagging), buildPlateauMesa(),
// buildZoneRampMeshes() and buildRampCurtainMeshes() — game.js's copies stay
// the ones actually driving gameplay (the in-game closures pull in further
// game-specific concerns like outline IDs and floor texturing this preview
// doesn't need), so when the merge/heightfield MATH changes there, mirror the
// change here too. Everything below is plain data (no THREE.js dependency)
// so it runs unmodified in Node for the CLI checker and in the browser for
// the live preview, and so it's directly unit-testable.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    require('../config/config.js');
    module.exports = factory(globalThis.HOBUNJI_CONFIG);
  } else root.TerrainPreview = factory(root.HOBUNJI_CONFIG);
})(typeof self !== 'undefined' ? self : this, function (CONFIG) {
  'use strict';

  const TERRAIN_CONFIG = CONFIG?.terrain || {};
  const PLATEAU_UNIT = TERRAIN_CONFIG.plateauVerticalUnit || 2.5;
  const VISUAL_HEIGHT_MIN = TERRAIN_CONFIG.subtleHeightMin ?? -1;
  const VISUAL_HEIGHT_MAX = TERRAIN_CONFIG.subtleHeightMax ?? 1;
  const VISUAL_HEIGHT_DISPLACEMENT = TERRAIN_CONFIG.subtleHeightMaxDisplacement ?? PLATEAU_UNIT * 0.24;
  const NORMAL_TOP = 0.0;
  const RIVER_TOP = -0.55; // mirrors docs/game.js RIVER_TOP/STREAM_TOP — river/stream/waterfall bed depth
  const TRENCH_TOP = -0.5; // mirrors docs/game.js TRENCH_TOP
  const RAISED_TOP = 0.5;  // mirrors docs/game.js RAISED_TOP
  const TileType = Object.freeze({
    GRASS: 'grass', WEEDS: 'weeds', TILLED: 'tilled',
    TRENCH: 'trench', RAISED: 'raised', PADDY: 'paddy',
    ROCK: 'rock', SHRUB: 'shrub', PATH: 'path',
    RIVER: 'river', STREAM: 'stream', RAMP: 'ramp', WATERFALL: 'waterfall',
  });
  // Tile types whose own heightfield (buildTerrainTileGeo) carves a depression
  // or rise into the ground — a plateau mesa's flat lid/skin must never also
  // render a quad over one of these, or the carved bed renders buried under it.
  const CARVED_TILE_TYPES = new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL, TileType.TRENCH, TileType.RAISED]);
  // river/stream/waterfall are one continuous waterway — a cell of one type
  // bordering a cell of another in this family should blend as "open" (full
  // depth carries through) instead of tapering back to flat ground right at
  // that family-internal seam.
  const WATERWAY_TYPES = new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL]);
  const sameWaterway = (a, b) => a === b || (WATERWAY_TYPES.has(a) && WATERWAY_TYPES.has(b));

  // ── Merge: fold a plateau stack's tiers into one world-keyed tile map ──────
  // Mirrors docs/game.js mergeZoneTiles exactly (including the pinhole-fill
  // pass), generalized to take its two lookups as params instead of closing
  // over _loadTownFromWorkspace's locals.
  function mergeZoneTilesInto(m, offsetC, offsetR, baseTier, outTiles, mesas, childByParentGroup, plateauElevById, outBuildings, outVisualHeights) {
    for (const [key, raw] of Object.entries(m.visualHeights || {})) {
      const match = /^(\d+),(\d+)$/.exec(key);
      if (!match || !Number.isFinite(raw)) continue;
      const c = Number(match[1]), r = Number(match[2]);
      if (c >= m.cols || r >= m.rows) continue;
      const value = Math.max(VISUAL_HEIGHT_MIN, Math.min(VISUAL_HEIGHT_MAX, raw));
      const worldKey = `${c + offsetC},${r + offsetR}`;
      if (value === 0) outVisualHeights.delete(worldKey); else outVisualHeights.set(worldKey, value);
    }
    const groupMask = new Map();
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const plateauId = m.tiles?.[`${c},${r}`]?.plateau;
      if (!plateauId) continue;
      let mask = groupMask.get(plateauId);
      if (!mask) { mask = new Set(); groupMask.set(plateauId, mask); }
      mask.add(`${c},${r}`);
    }
    // Every plateau group painted on `m` is a sibling here (painting one
    // group's brush over another's cells reassigns them — see applyAt — so
    // groupMask's per-group masks are already disjoint). A ring cell's actual
    // support height is therefore whichever group (if any) owns its missing
    // neighbor, not always this map's own baseTier — that's what lets two
    // plateaus sharing this map blend straight into each other (a lower
    // tier's cells bordering a higher sibling's footprint stay flat at their
    // own tier instead of sloping down to baseTier, since the riser is
    // entirely the higher sibling's own mesa wall) while a true outer edge
    // (bordering ungraded ground, or a still-lower sibling) still ramps down.
    const tierAt = (c, r) => {
      const pid = m.tiles?.[`${c},${r}`]?.plateau;
      return pid ? (plateauElevById.get(pid) ?? baseTier) : baseTier;
    };

    const children = [];
    for (const [gid, mask] of groupMask) {
      const child = childByParentGroup.get(`${m.id}__${gid}`);
      if (!child) continue; // plateau group marked but no authored child submap yet
      // Elevation is absolute from the root map, not cumulative through nesting —
      // a group's stored elevation IS its final tier, regardless of how deep it's nested.
      const toTier = (plateauElevById.get(gid) || 0);
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (const k of mask) { const [c, r] = k.split(',').map(Number); if (c < minC) minC = c; if (c > maxC) maxC = c; if (r < minR) minR = r; if (r > maxR) maxR = r; }

      // Adopt any untouched bbox cell that's mostly surrounded (3+ of 4
      // cardinal neighbors) by this same mask — a brush-stamp pinhole, not a
      // deliberate notch. See docs/game.js mergeZoneTiles for the full
      // rationale; kept verbatim here.
      for (let pass = 0; pass < 8; pass++) {
        let filled = false;
        for (let r = minR; r <= maxR; r++) {
          for (let c = minC; c <= maxC; c++) {
            const k = `${c},${r}`;
            if (mask.has(k) || m.tiles?.[k]) continue;
            const neighborCount = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => mask.has(`${c + dc},${r + dr}`)).length;
            if (neighborCount >= 3) { mask.add(k); filled = true; }
          }
        }
        if (!filled) break;
      }

      const worldMinC = offsetC + minC, worldMaxC = offsetC + maxC, worldMinR = offsetR + minR, worldMaxR = offsetR + maxR;
      const maskWorldKeys = new Set();
      for (const k of mask) { const [c, r] = k.split(',').map(Number); maskWorldKeys.add(`${c + offsetC},${r + offsetR}`); }
      mesas.push({ minC: worldMinC, maxC: worldMaxC, minR: worldMinR, maxR: worldMaxR, fromTier: baseTier, toTier, maskWorldKeys, groupId: gid });
      for (const k of mask) {
        const [lc, lr] = k.split(',').map(Number);
        const c = lc + offsetC, r = lr + offsetR;
        // A generated wilderness zone's entry gate corridor (see
        // openBorderEntryGate in wilderness-map-generator.js) is a deliberately
        // flattened, walkable cut through the boundary cliff ring — it's
        // always at the outer edge of its plateau's mask (right at the map
        // border), which is exactly what the ring check below treats as a
        // sloped/impassable cliff face. Force it to the group's real
        // (interior, non-incline) tier instead of computing ring-ness for it,
        // or the entrance itself becomes solid to the game's movement
        // collision (see tileSpeedAt's `if (tile.incline) return null`).
        if (m.tiles?.[k]?.borderEntryGate) {
          outTiles.set(`${c},${r}`, { c, r, type: 'grass', elevTier: toTier, skipFloor: true, rampElevation: 0, incline: false });
          continue;
        }
        let ringTier = null; // null => fully interior, no slope needed here
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (mask.has(`${lc + dc},${lr + dr}`)) continue;
          const supportTier = tierAt(lc + dc, lr + dr);
          if (supportTier < toTier) ringTier = ringTier === null ? supportTier : Math.min(ringTier, supportTier);
        }
        const onRing = ringTier !== null;
        outTiles.set(`${c},${r}`, {
          c, r, type: 'grass', elevTier: onRing ? ringTier : toTier,
          skipFloor: true, rampElevation: 0, incline: onRing,
        });
      }
      children.push({ child, childOffsetC: worldMinC + 1, childOffsetR: worldMinR + 1, toTier });
    }

    const isCarvedPlateauOverride = t => !!(t?.plateau && CARVED_TILE_TYPES.has(t.type)); // Mirrors game.js's preservation of real cuts inside plateau masks.
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const t = m.tiles?.[`${c},${r}`];
      const key = `${c + offsetC},${r + offsetR}`;
      if (!t || (t.plateau && !isCarvedPlateauOverride(t))) {
        if (!outTiles.has(key)) outTiles.set(key, { c: c + offsetC, r: r + offsetR, type: 'grass', elevTier: baseTier, skipFloor: false, rampElevation: 0, incline: false });
        continue;
      }
      if (isCarvedPlateauOverride(t)) {
        // Keep the mask's previously-staked elevation and incline metadata,
        // but retain the carved type so preview geometry cuts the same hole in
        // the mesa lid that the live renderer does.
        const staked = outTiles.get(key) || { c: c + offsetC, r: r + offsetR, elevTier: baseTier, skipFloor: true, rampElevation: 0, incline: false };
        outTiles.set(key, { ...staked, type: t.type });
        continue;
      }
      let type = t.type || 'grass';
      // See game.js's mergeZoneTiles for the full rationale — mirrored here
      // verbatim. t.generatedObjectType exempts generator-placed rock objects
      // (diggableRockOre/undiggableBoulder/etc, deliberately solid) from the
      // "stray authored decorative rock" suppression this rule exists for.
      if (!t.plateau && type === 'rock' && !t.generatedObjectType) type = 'grass';
      outTiles.set(key, {
        c: c + offsetC, r: r + offsetR, type, elevTier: baseTier, skipFloor: false,
        rampElevation: type === 'ramp' ? (t.rampElevation || 0) : 0, incline: false,
        // Which generator object (copse/bush/fruitBush/mushroomPatch/beehive)
        // this 'shrub' tile came from — lets the live game pick a matching
        // mesh (tree/bush/stump) instead of treating every shrub tile in a
        // tree zone as a full tree. See game.js's _buildZoneFloorMeshes.
        floraKind: type === 'shrub' ? (t.generatedObjectType || null) : undefined,
        // Which generator object ('diggableRockOre'/'undiggableBoulder') this
        // 'rock' tile came from — lets the live game tell a mineable ore rock
        // apart from an undiggable boulder or a plain plateau cliff face
        // (which carries no generatedObjectType at all). Named rockKind (not
        // oreKind) to avoid colliding with the generator's own per-object
        // oreKind (stone/copper/tin/iron/silver/gold/crystal material pick,
        // see wilderness-map-generator.js line ~306) which isn't threaded
        // through to the tile record. See game.js's isMineableRockTile.
        rockKind: type === 'rock' ? (t.generatedObjectType || null) : undefined,
      });
    }

    for (const b of (m.buildings || [])) {
      outBuildings.push({ ...b, gridX: (b.gridX || 0) + offsetC, gridZ: (b.gridZ || 0) + offsetR, _baseTier: baseTier });
    }

    for (const { child, childOffsetC, childOffsetR, toTier } of children) {
      mergeZoneTilesInto(child, childOffsetC, childOffsetR, toTier, outTiles, mesas, childByParentGroup, plateauElevById, outBuildings, outVisualHeights);
    }
  }

  // Builds the lookups mergeZoneTilesInto needs from a Map Editor workspace
  // (`{ maps:[...], plateauGroups:[...] }`) and folds `rootMapId`'s whole
  // plateau stack into one world-keyed tile map + mesa list.
  function buildMergedZoneGrid(ws, rootMapId) {
    const maps = ws.maps || [];
    const mapsById = new Map(maps.map(m => [m.id, m]));
    const rootMap = mapsById.get(rootMapId);
    const outTiles = new Map(), visualHeights = new Map(), mesas = [], outBuildings = [];
    if (!rootMap) return { cols: 0, rows: 0, tiles: outTiles, visualHeights, mesas, rootMap: null, buildings: outBuildings };

    const childByParentGroup = new Map();
    for (const m of maps) {
      if (m.isSubmap && m.parentMapId && m.plateauGroupId) {
        childByParentGroup.set(`${m.parentMapId}__${m.plateauGroupId}`, m);
      }
    }
    const plateauElevById = new Map((ws.plateauGroups || []).map(g => [g.id, g.elevation || 0]));

    mergeZoneTilesInto(rootMap, 0, 0, 0, outTiles, mesas, childByParentGroup, plateauElevById, outBuildings, visualHeights);
    for (const b of outBuildings) {
      const t = outTiles.get(`${b.gridX},${b.gridZ}`);
      b.elevTier = (t && typeof t.elevTier === 'number') ? t.elevTier : (b._baseTier || 0);
      delete b._baseTier;
    }
    return { cols: rootMap.cols, rows: rootMap.rows, tiles: outTiles, visualHeights, mesas, rootMap, buildings: outBuildings };
  }

  // ── zGrid: dense [r][c] grid buildPlateauMesa/ramp geometry reads ──────────
  // Mirrors the relevant slice of docs/game.js buildZoneScene (lines ~2613-2654
  // at time of writing): seeds a flat grass grid, stamps the merged tiles onto
  // it, then folds non-ramp neighbors of a ramp into a 1-tile "curtain" skirt
  // exactly like the real zone scene does.
  function buildZGrid(cols, rows, tiles) {
    const zGrid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ type: TileType.GRASS, elevTier: 0, skipFloor: false, incline: false, rampElevation: 0, visualHeight: 0 })));
    for (const t of tiles.values()) {
      if (!zGrid[t.r]?.[t.c]) continue;
      zGrid[t.r][t.c].type = t.type || TileType.GRASS;
      zGrid[t.r][t.c].elevTier = t.elevTier || 0;
      zGrid[t.r][t.c].skipFloor = !!t.skipFloor;
      zGrid[t.r][t.c].incline = !!t.incline;
      if (t.type === TileType.RAMP) zGrid[t.r][t.c].rampElevation = t.rampElevation || 0;
    }
    return zGrid;
  }

  // Values are authored at tile centers. Missing cells and samples beyond the
  // root boundary are deterministically zero; this makes sparse edges taper to
  // the undisplaced surface instead of extending an implicit plateau.
  function sampleVisualHeight(visualHeights, worldX, worldZ, cols = Infinity, rows = Infinity) {
    const x = worldX - 0.5, z = worldZ - 0.5;
    const c0 = Math.floor(x), r0 = Math.floor(z), tx = x - c0, tz = z - r0;
    const valueAt = (c, r) => {
      if (c < 0 || r < 0 || c >= cols || r >= rows) return 0;
      const raw = visualHeights instanceof Map ? visualHeights.get(`${c},${r}`) : visualHeights?.[`${c},${r}`];
      return Number.isFinite(raw) ? Math.max(VISUAL_HEIGHT_MIN, Math.min(VISUAL_HEIGHT_MAX, raw)) : 0;
    };
    const a = valueAt(c0, r0) * (1 - tx) + valueAt(c0 + 1, r0) * tx;
    const b = valueAt(c0, r0 + 1) * (1 - tx) + valueAt(c0 + 1, r0 + 1) * tx;
    return Math.max(VISUAL_HEIGHT_MIN, Math.min(VISUAL_HEIGHT_MAX, a * (1 - tz) + b * tz)) * VISUAL_HEIGHT_DISPLACEMENT;
  }

  function displaceGeometryPositions(pos, visualHeights, cols, rows) {
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] += sampleVisualHeight(visualHeights, pos[i], pos[i + 2], cols, rows);
    return pos;
  }

  function applyRampCurtainFlags(zGrid, cols, rows) {
    const RAMP_FLUSH_EPS = 0.5;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (zGrid[r][c].type !== TileType.RAMP) continue;
      const rampY = NORMAL_TOP + (zGrid[r][c].rampElevation || 0) * PLATEAU_UNIT;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = zGrid[r + dr]?.[c + dc];
        if (!nt || nt.type === TileType.RAMP || nt.incline) continue;
        const groundY = NORMAL_TOP + (nt.elevTier || 0) * PLATEAU_UNIT;
        if (Math.abs(rampY - groundY) < RAMP_FLUSH_EPS) continue;
        nt.incline = true; nt.skipFloor = true; nt.rampCurtain = true;
      }
    }
  }

  // ── Terrain tile heightfield: carved channel/ditch beds (pure data) ─────────
  // Mirrors docs/game.js buildTerrainTileGeo exactly, up to (but not including)
  // the THREE.BufferGeometry construction — and with one deliberate deviation:
  // game.js's positions are tile-local (-0.5..0.5, translated via the mesh's
  // own position at the call site), whereas this returns absolute world x/z
  // (col..col+1, row..row+1) to match this module's other geometry builders
  // (buildRampMeshGeometry etc.), which bake world coords directly so the
  // caller never needs a separate per-tile mesh transform.
  const DEPRESSION_TOP = {
    [TileType.TRENCH]: TRENCH_TOP,
    [TileType.RIVER]: RIVER_TOP,
    [TileType.STREAM]: RIVER_TOP,
    [TileType.WATERFALL]: RIVER_TOP,
  };
  function buildTerrainTileGeo(col, row, type, zGrid) {
    const VERTS = 7, CELLS = 6, STEP = 1.0 / CELLS;
    const BLEND_V = 2;
    const PLATEAU = type === TileType.RAISED ? 3.0 : 1.5; // raised = wide flat top
    const depressionTop = DEPRESSION_TOP[type];
    const isDepression = depressionTop !== undefined;
    const targetDY = isDepression
      ? depressionTop - NORMAL_TOP
      : RAISED_TOP - NORMAL_TOP; // +0.5

    const openN = sameWaterway(zGrid[row - 1]?.[col]?.type, type);
    const openS = sameWaterway(zGrid[row + 1]?.[col]?.type, type);
    const openW = sameWaterway(zGrid[row]?.[col - 1]?.type, type);
    const openE = sameWaterway(zGrid[row]?.[col + 1]?.type, type);

    // Diagonal tiles — used to seal the inner corner of L-shaped turns
    const diagNW = sameWaterway(zGrid[row - 1]?.[col - 1]?.type, type);
    const diagNE = sameWaterway(zGrid[row - 1]?.[col + 1]?.type, type);
    const diagSW = sameWaterway(zGrid[row + 1]?.[col - 1]?.type, type);
    const diagSE = sameWaterway(zGrid[row + 1]?.[col + 1]?.type, type);

    const seamDisp = (vx, vz) => {
      const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };
    const roughDisp = (vx, vz) => {
      const kx = Math.round(vx * 6) | 0, kz = Math.round(vz * 6) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
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

        const bDiagNW = (openW && openN && !diagNW) ? smooth(Math.min(1, Math.max(vi, vj)               / BLEND_V)) : 1;
        const bDiagNE = (openE && openN && !diagNE) ? smooth(Math.min(1, Math.max(CELLS - vi, vj)       / BLEND_V)) : 1;
        const bDiagSW = (openW && openS && !diagSW) ? smooth(Math.min(1, Math.max(vi, CELLS - vj)       / BLEND_V)) : 1;
        const bDiagSE = (openE && openS && !diagSE) ? smooth(Math.min(1, Math.max(CELLS - vi, CELLS - vj) / BLEND_V)) : 1;

        const blend = Math.min(1, bW * bE * bN * bS * bDiagNW * bDiagNE * bDiagSW * bDiagSE * PLATEAU);
        const vx = col + vi * STEP, vz = row + vj * STEP;
        Y[vj * VERTS + vi] = seamDisp(vx, vz) + blend * targetDY + blend * roughDisp(vx, vz);
      }
    }

    const pos = [];
    for (let vj = 0; vj < VERTS; vj++)
      for (let vi = 0; vi < VERTS; vi++)
        pos.push(col + vi * STEP, Y[vj * VERTS + vi], row + vj * STEP);

    // Split cells: dirt where significantly depressed/elevated, grass on flat
    // edge cells that blend back to ground level.
    const DIRT_THRESH = 0.05;
    const dirtIdx = [], grassIdx = [];
    for (let cj = 0; cj < CELLS; cj++)
      for (let ci = 0; ci < CELLS; ci++) {
        const v00 = cj * VERTS + ci, v10 = cj * VERTS + ci + 1;
        const v01 = (cj + 1) * VERTS + ci, v11 = (cj + 1) * VERTS + ci + 1;
        const y00 = Y[v00], y10 = Y[v10], y01 = Y[v01], y11 = Y[v11];
        const isDirt = isDepression
          ? Math.min(y00, y10, y01, y11) < -DIRT_THRESH
          : Math.max(y00, y10, y01, y11) > DIRT_THRESH;
        (isDirt ? dirtIdx : grassIdx).push(v00, v01, v11, v00, v11, v10);
      }

    return { pos, dirtIdx, grassIdx };
  }

  // ── Plateau mesa heightfield geometry (pure data) ───────────────────────────
  // Mirrors docs/game.js buildPlateauMesa exactly, up to (but not including)
  // the THREE.BufferGeometry/Mesh construction — this returns the same
  // position/index arrays that function builds internally, so any change to
  // the actual rendered mesa shape shows up here too the next time the two
  // are eyeballed against each other.
  function buildPlateauMesaGeometry(bb, elevOffset, zoneBaseElev, zGrid) {
    const MARGIN_TILES = 1;
    const BASE = NORMAL_TOP + zoneBaseElev;
    const W = bb.maxC - bb.minC + 1, D = bb.maxR - bb.minR + 1;
    const GW = W * 2 + 1, GH = D * 2 + 1;

    const hashDisp = (kx, kz) => {
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };

    const mask = bb.maskWorldKeys || null;
    const inMask = (c, r) => {
      if (!mask) return true;
      if (mask.has(`${c},${r}`)) return true;
      const t = zGrid?.[r]?.[c];
      return !!(t && !t.incline && (t.elevTier || 0) >= bb.toTier);
    };
    const axisTiles = (gi, N) => {
      const lo = Math.floor((gi - 1) / 2), hi = Math.floor(gi / 2), out = [lo];
      if (hi !== lo) out.push(hi);
      return out;
    };
    const vIdx = (gi, gj) => gj * GW + gi;
    const CAP = MARGIN_TILES * 2;
    const vertHops = new Int32Array(GW * GH).fill(CAP);
    const TOP = BASE + elevOffset;
    const seedHeightAt = (c, r) => {
      const t = zGrid?.[r]?.[c];
      return (t && typeof t.elevTier === 'number') ? NORMAL_TOP + t.elevTier * PLATEAU_UNIT : BASE;
    };
    const vertSeedY = new Float32Array(GW * GH).fill(BASE);
    const queue = [];
    for (let gj = 0; gj < GH; gj++) {
      const trs = axisTiles(gj, D);
      for (let gi = 0; gi < GW; gi++) {
        const tcs = axisTiles(gi, W);
        let seedY = Infinity;
        for (const tc of tcs) for (const tr of trs) {
          const c = bb.minC + tc, r = bb.minR + tr;
          if (!inMask(c, r)) seedY = Math.min(seedY, seedHeightAt(c, r));
        }
        if (seedY !== Infinity) {
          const k = vIdx(gi, gj);
          vertHops[k] = 0; vertSeedY[k] = seedY; queue.push([gi, gj]);
        }
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const [gi, gj] = queue[qi], k0 = vIdx(gi, gj), d0 = vertHops[k0];
      if (d0 >= CAP) continue;
      for (const [dgi, dgj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ngi = gi + dgi, ngj = gj + dgj;
        if (ngi < 0 || ngi >= GW || ngj < 0 || ngj >= GH) continue;
        const nk = vIdx(ngi, ngj);
        if (d0 + 1 < vertHops[nk]) { vertHops[nk] = d0 + 1; vertSeedY[nk] = vertSeedY[k0]; queue.push([ngi, ngj]); }
      }
    }

    const Y = new Float32Array(GW * GH);
    for (let gj = 0; gj < GH; gj++) {
      for (let gi = 0; gi < GW; gi++) {
        const k = gj * GW + gi;
        const blend = Math.min(1, (vertHops[k] * 0.5) / MARGIN_TILES);
        const kx = bb.minC * 2 + gi, kz = bb.minR * 2 + gj;
        const seedY = vertSeedY[k];
        Y[k] = seedY + blend * (TOP - seedY) + hashDisp(kx, kz);
      }
    }

    const rampCornerY = (ci, cj) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const t = zGrid?.[cj + dr]?.[ci + dc];
        if (t && t.type === TileType.RAMP) { sum += NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : null;
    };
    const isRampTile = (tc, tr) => zGrid?.[bb.minR + tr]?.[bb.minC + tc]?.type === TileType.RAMP;
    for (let tr = 0; tr < D; tr++) {
      for (let tc = 0; tc < W; tc++) {
        if (!isRampTile(tc, tr)) continue;
        const wc = bb.minC + tc, wr = bb.minR + tr;
        const y00 = rampCornerY(wc, wr), y10 = rampCornerY(wc + 1, wr);
        const y01 = rampCornerY(wc, wr + 1), y11 = rampCornerY(wc + 1, wr + 1);
        for (let dj = 0; dj <= 2; dj++) {
          const fr = dj * 0.5;
          for (let di = 0; di <= 2; di++) {
            const fc = di * 0.5;
            const y = y00 * (1 - fc) * (1 - fr) + y10 * fc * (1 - fr) + y01 * (1 - fc) * fr + y11 * fc * fr;
            Y[(2 * tr + dj) * GW + (2 * tc + di)] = y;
          }
        }
      }
    }

    const pos = new Float32Array(GW * GH * 3);
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++) {
        const k = gj * GW + gi;
        pos[k * 3] = bb.minC + gi * 0.5;
        pos[k * 3 + 1] = Y[k];
        pos[k * 3 + 2] = bb.minR + gj * 0.5;
      }

    const quadIsRamp = (gi, gj) => isRampTile(Math.floor(gi / 2), Math.floor(gj / 2));
    const quadInOwnMask = (gi, gj) => !mask || mask.has(`${bb.minC + Math.floor(gi / 2)},${bb.minR + Math.floor(gj / 2)}`);
    // A river/stream/waterfall/trench/raised cell carved INTO this mesa's own
    // footprint still gets a mask-passing, BFS-blended Y above (so neighboring
    // carved-tile geometry keeps blending against a sane height), but the flat
    // mesa lid/skin must not also render a quad on top of it — buildTerrainTileGeo
    // builds that cell's own carved-bed mesh, and without this check the mesa's
    // solid lid simply painted over it, hiding the channel under flat ground.
    const quadIsCarved = (gi, gj) => CARVED_TILE_TYPES.has(zGrid?.[bb.minR + Math.floor(gj / 2)]?.[bb.minC + Math.floor(gi / 2)]?.type);
    // Mirrors docs/game.js buildPlateauMesa: quads steeper than ~41 degrees
    // from horizontal (the cliff-face margin band) go in their own index group
    // (materialIndex 1, stone) on this SAME position buffer instead of a
    // separate displaced "skin" mesh — one real heightfield surface, textured
    // per-face, rather than a second flat overlay plane in front of it.
    const grassIdx = [], stoneIdx = [];
    for (let gj = 0; gj < GH - 1; gj++) {
      for (let gi = 0; gi < GW - 1; gi++) {
        if (quadIsRamp(gi, gj) || quadIsCarved(gi, gj) || !quadInOwnMask(gi, gj)) continue;
        const v00 = gj * GW + gi, v10 = gj * GW + gi + 1, v01 = (gj + 1) * GW + gi, v11 = (gj + 1) * GW + gi + 1;
        const y00 = Y[v00], y10 = Y[v10], y01 = Y[v01], y11 = Y[v11];
        const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
        const cnz = 0.5 * ((y10 - y01) - (y11 - y00));
        const steep = cnx * cnx + cnz * cnz > 0.194;
        (steep ? stoneIdx : grassIdx).push(v00, v01, v11, v00, v11, v10);
      }
    }
    const idx = grassIdx.concat(stoneIdx);

    return { pos, idx, grassCount: grassIdx.length, stoneCount: stoneIdx.length, top: TOP, W, D, GW, GH };
  }

  // ── Ramp surface + curtain geometry (pure data) ─────────────────────────────
  // Mirrors docs/game.js buildZoneRampMeshes exactly.
  function buildRampMeshGeometry(zGrid, cols, rows) {
    const rampCells = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (zGrid[r]?.[c]?.type === TileType.RAMP) rampCells.push([c, r]);
    if (!rampCells.length) return { pos: [], idx: [] };

    const cornerY = (ci, cj) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const t = zGrid[cj + dr]?.[ci + dc];
        if (t && t.type === TileType.RAMP) { sum += NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : null;
    };

    const pos = [], idx = [];
    let vi = 0;
    for (const [c, r] of rampCells) {
      const fallback = NORMAL_TOP + (zGrid[r][c].rampElevation || 0) * PLATEAU_UNIT;
      const y00 = cornerY(c, r) ?? fallback;
      const y10 = cornerY(c + 1, r) ?? fallback;
      const y01 = cornerY(c, r + 1) ?? fallback;
      const y11 = cornerY(c + 1, r + 1) ?? fallback;
      pos.push(c, y00, r, c + 1, y10, r, c, y01, r + 1, c + 1, y11, r + 1);
      idx.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1); vi += 4;
    }
    return { pos, idx };
  }

  // Mirrors docs/game.js buildRampCurtainMeshes exactly.
  function buildRampCurtainGeometry(zGrid, cols, rows) {
    const cells = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (zGrid[r]?.[c]?.rampCurtain) cells.push([c, r]);
    if (!cells.length) return { pos: [], idx: [], skinPos: [], skinIdx: [] };

    const cornerY = (ci, cj, fallback) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const t = zGrid[cj + dr]?.[ci + dc];
        if (t && t.type === TileType.RAMP) { sum += NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : fallback;
    };

    const pos = [], idx = [];
    const skinPos = [], skinIdx = [];
    let vi = 0, svi = 0;
    for (const [c, r] of cells) {
      const ground = NORMAL_TOP + (zGrid[r][c].elevTier || 0) * PLATEAU_UNIT;
      const y00 = cornerY(c, r, ground);
      const y10 = cornerY(c + 1, r, ground);
      const y01 = cornerY(c, r + 1, ground);
      const y11 = cornerY(c + 1, r + 1, ground);
      pos.push(c, y00, r, c + 1, y10, r, c, y01, r + 1, c + 1, y11, r + 1);
      idx.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1); vi += 4;

      const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
      const cnz = 0.5 * ((y10 - y01) - (y11 - y00));
      if (cnx * cnx + cnz * cnz > 0.194) {
        skinPos.push(c, y00, r, c + 1, y10, r, c, y01, r + 1, c + 1, y11, r + 1);
        skinIdx.push(svi, svi + 2, svi + 3, svi, svi + 3, svi + 1); svi += 4;
      }
    }
    return { pos, idx, skinPos, skinIdx };
  }


  // ── Unified non-walkable rock formation solver ─────────────────────────────
  // Plateau tops, ramp floors, ordinary floors, and water beds remain authored
  // separately. This solver only gathers the vertical/supporting rock spans that
  // come from plateau cliff rings, ramp sides/seams, and tier steps, unions any
  // coincident spans by tile edge, and emits one deterministic faceted rock skin.
  function rampCornerYFor(zGrid, ci, cj, fallback = null) {
    let sum = 0, n = 0;
    for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const t = zGrid?.[cj + dr]?.[ci + dc];
      if (t && t.type === TileType.RAMP) { sum += NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT; n++; }
    }
    return n ? sum / n : fallback;
  }

  function rockCellCornerHeights(zGrid, c, r) {
    const t = zGrid?.[r]?.[c];
    if (!t) return [NORMAL_TOP, NORMAL_TOP, NORMAL_TOP, NORMAL_TOP];
    if (t.type === TileType.RAMP) {
      const fallback = NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT;
      return [
        rampCornerYFor(zGrid, c, r, fallback),
        rampCornerYFor(zGrid, c + 1, r, fallback),
        rampCornerYFor(zGrid, c, r + 1, fallback),
        rampCornerYFor(zGrid, c + 1, r + 1, fallback),
      ];
    }
    const y = NORMAL_TOP + (t.elevTier || 0) * PLATEAU_UNIT;
    return [y, y, y, y];
  }

  function buildRockSourceSpans(merged, zGrid, cols, rows) {
    const spans = [];
    const plateauMaskKeys = new Set();
    for (const mesa of (merged?.mesas || [])) {
      for (const key of (mesa.maskWorldKeys || [])) plateauMaskKeys.add(key);
    }
    const addSpan = (edgeKey, axis, x0, z0, x1, z1, top0, top1, bottom0, bottom1, kind, c, r) => {
      const top = Math.max(top0, top1), bottom = Math.min(bottom0, bottom1);
      if (!(top - bottom > 0.04)) return;
      spans.push({ edgeKey, axis, x0, z0, x1, z1, top0, top1, bottom0, bottom1, kind, c, r });
    };
    const edgeKeyFor = (axis, line, along) => `${axis}:${line}:${along}`;
    const sourceKind = (a, b) => {
      if (a?.type === TileType.RAMP || b?.type === TileType.RAMP) {
        if (a?.incline || b?.incline) return 'ramp_plateau_seam';
        return 'ramp_side';
      }
      if (a?.incline || b?.incline) return 'plateau_cliff';
      return 'tier_seam';
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = zGrid?.[r]?.[c];
      if (!t) continue;
      const [, y10, y01, y11] = rockCellCornerHeights(zGrid, c, r);
      for (const [dc, dr, side] of [[1, 0, 'E'], [0, 1, 'S']]) {
        const nt = zGrid?.[r + dr]?.[c + dc];
        const [ny00, ny10, ny01] = rockCellCornerHeights(zGrid, c + dc, r + dr);
        const thisEdge = side === 'E' ? [y10, y11] : [y01, y11];
        const otherEdge = side === 'E' ? [ny00, ny01] : [ny00, ny10];
        const top0 = Math.max(thisEdge[0], otherEdge[0]);
        const top1 = Math.max(thisEdge[1], otherEdge[1]);
        const bottom0 = Math.min(thisEdge[0], otherEdge[0]);
        const bottom1 = Math.min(thisEdge[1], otherEdge[1]);
        const tierStep = Math.max(top0, top1) - Math.min(bottom0, bottom1);
        const rampSeam = (t.type === TileType.RAMP || nt?.type === TileType.RAMP) && tierStep > 0.04;
        const touchesPlateauMask = plateauMaskKeys.has(`${c},${r}`) || plateauMaskKeys.has(`${c + dc},${r + dr}`);
        const cliffStep = tierStep > 0.04 && (t.incline || nt?.incline || touchesPlateauMask || (t.elevTier || 0) !== (nt?.elevTier || 0));
        if (!rampSeam && !cliffStep) continue;
        const kind = sourceKind(t, nt);
        // Plain plateau-cliff spans are exactly the cliff-face margin band
        // buildPlateauMesaGeometry's own quads already cover (stone-textured
        // directly on that geometry now — see its own comment); solving them
        // again here would double them up as a separate flat plane.
        if (kind === 'plateau_cliff') continue;
        if (side === 'E') addSpan(edgeKeyFor('x', c + 1, r), 'x', c + 1, r, c + 1, r + 1, top0, top1, bottom0, bottom1, kind, c, r);
        else addSpan(edgeKeyFor('z', r + 1, c), 'z', c, r + 1, c + 1, r + 1, top0, top1, bottom0, bottom1, kind, c, r);
      }
    }
    return spans;
  }

  function buildRockFormationGeometry(merged, zGrid, cols, rows) {
    const sources = buildRockSourceSpans(merged, zGrid, cols, rows);
    const byEdge = new Map();
    for (const s of sources) {
      const prev = byEdge.get(s.edgeKey);
      if (!prev) { byEdge.set(s.edgeKey, { ...s, kinds: new Set([s.kind]) }); continue; }
      prev.top0 = Math.max(prev.top0, s.top0); prev.top1 = Math.max(prev.top1, s.top1);
      prev.bottom0 = Math.min(prev.bottom0, s.bottom0); prev.bottom1 = Math.min(prev.bottom1, s.bottom1);
      prev.kinds.add(s.kind);
    }
    const spans = [...byEdge.values()].filter(s => Math.max(s.top0, s.top1) - Math.min(s.bottom0, s.bottom1) > 0.04);
    const pos = [], idx = [], meta = [];
    let vi = 0;
    const hash01 = (x, z, salt) => {
      let h = (2166136261 ^ Math.imul(Math.round(x * 8) + salt, 374761393) ^ Math.imul(Math.round(z * 8) - salt, 668265263)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return h / 4294967296;
    };
    const pushV = (x, y, z, nx, nz, alongT, verticalT) => {
      // Keep all perimeter vertices exactly on their solved tile edge. Only the
      // mid-column vertices get deterministic normal offsets, so adjacent spans
      // share endpoints without cracks while the faces still read as chunky ribs.
      const rib = (verticalT > 0.001 && verticalT < 0.999 && alongT > 0.001 && alongT < 0.999)
        ? (hash01(x, z, Math.round(y * 10)) - 0.5) * 0.16 : 0;
      const ledge = (verticalT > 0.15 && verticalT < 0.9 && Math.abs((verticalT * 5) % 1 - 0.5) < 0.14) ? 0.035 : 0;
      pos.push(x + nx * (rib + ledge), y, z + nz * (rib + ledge));
    };
    for (const s of spans) {
      const nx = s.axis === 'x' ? (hash01(s.x0, s.z0, 7) > 0.5 ? 1 : -1) : 0;
      const nz = s.axis === 'z' ? (hash01(s.x0, s.z0, 11) > 0.5 ? 1 : -1) : 0;
      const segs = 2;
      const base = vi;
      for (let j = 0; j <= segs; j++) {
        const vt = j / segs;
        for (let i = 0; i <= segs; i++) {
          const at = i / segs;
          const x = s.x0 + (s.x1 - s.x0) * at, z = s.z0 + (s.z1 - s.z0) * at;
          const top = s.top0 + (s.top1 - s.top0) * at, bot = s.bottom0 + (s.bottom1 - s.bottom0) * at;
          const y = bot + (top - bot) * (1 - vt);
          pushV(x, y, z, nx, nz, at, vt);
        }
      }
      for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
        const a = base + j * (segs + 1) + i, b = a + 1, c0 = a + (segs + 1), d = c0 + 1;
        idx.push(a, c0, d, a, d, b);
      }
      vi += (segs + 1) * (segs + 1);
      meta.push({ edgeKey: s.edgeKey, kind: [...s.kinds].join('+') });
    }
    return { pos, idx, sources, spans, meta };
  }

  function validateRockFormationGeometry(rockGeo) {
    const issues = [];
    const edgeCounts = new Map();
    for (const s of rockGeo.spans || []) edgeCounts.set(s.edgeKey, (edgeCounts.get(s.edgeKey) || 0) + 1);
    for (const [edgeKey, count] of edgeCounts) {
      if (count > 1) issues.push({ severity: 'error', code: 'DUPLICATE_ROCK_EDGE', message: `Rock solver emitted ${count} solved spans for tile edge ${edgeKey}.` });
    }
    for (const s of rockGeo.spans || []) {
      if (![s.top0, s.top1, s.bottom0, s.bottom1].every(Number.isFinite)) issues.push({ severity: 'error', code: 'NON_FINITE_ROCK_SPAN', message: `Rock span ${s.edgeKey} has a non-finite height.` });
      if (Math.max(s.top0, s.top1) - Math.min(s.bottom0, s.bottom1) <= 0.04) issues.push({ severity: 'warning', code: 'DEGENERATE_ROCK_SPAN', message: `Rock span ${s.edgeKey} has almost no vertical support.` });
    }
    return issues;
  }

  // Rounded boulder-mound bump field — mirrors game.js's
  // buildRockMoundBumpField exactly (same BFS-grown-plateau algorithm and
  // seam/roughness noise formulas as buildRockTileGeo's loose farm rocks),
  // generalized to an arbitrary col×row footprint. Boundary vertices are
  // forced to exactly 0 so adjacent faces/panels sharing an edge stay
  // crack-free even though each field is grown independently.
  const ROCK_MOUND_CELLS_PER_TILE = 6;
  function buildRockMoundBumpField(colsTiles, rowsTiles, worldU0, worldV0, salt, peakScale = 1) {
    const CX = Math.max(1, Math.round(colsTiles * ROCK_MOUND_CELLS_PER_TILE));
    const CZ = Math.max(1, Math.round(rowsTiles * ROCK_MOUND_CELLS_PER_TILE));
    const VX = CX + 1, VZ = CZ + 1, STEP = 1 / ROCK_MOUND_CELLS_PER_TILE;
    let _s = ((Math.round(worldU0 * 8) * 374761393) ^ (Math.round(worldV0 * 8) * 668265263) ^ Math.imul(salt, 2654435761)) >>> 0;
    const rng = () => { _s += 0x6D2B79F5; let t = Math.imul(_s ^ _s >>> 15, _s | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const seamDisp = (vx, vz) => {
      const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };
    const roughDisp = (vx, vz) => {
      const kx = Math.round(vx * 8) | 0, kz = Math.round(vz * 8) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.05;
    };
    const Y = new Float32Array(VX * VZ);
    for (let vj = 0; vj < VZ; vj++) for (let vi = 0; vi < VX; vi++) Y[vj * VX + vi] = seamDisp(worldU0 + vi * STEP, worldV0 + vj * STEP);
    if (CX >= 3 && CZ >= 3) {
      const lobeCount = Math.max(1, Math.round(colsTiles * rowsTiles * 0.7));
      for (let lobe = 0; lobe < lobeCount; lobe++) {
        const startCi = 1 + Math.floor(rng() * (CX - 2));
        const startCj = 1 + Math.floor(rng() * (CZ - 2));
        const maxSize = 2 + Math.floor(rng() * 12);
        const group = new Set([startCj * CX + startCi]);
        const front = [[startCi, startCj]];
        while (front.length && group.size < maxSize) {
          const fi = Math.floor(rng() * front.length);
          const [ci, cj] = front.splice(fi, 1)[0];
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = ci + dc, nj = cj + dr;
            if (ni < 1 || ni > CX - 2 || nj < 1 || nj > CZ - 2) continue;
            const nk = nj * CX + ni;
            if (group.has(nk)) continue;
            group.add(nk); front.push([ni, nj]);
          }
        }
        let maxY = -Infinity;
        const raised = new Set();
        for (const ck of group) {
          const ci = ck % CX, cj = (ck / CX) | 0;
          for (const vv of [cj * VX + ci, cj * VX + ci + 1, (cj + 1) * VX + ci, (cj + 1) * VX + ci + 1]) {
            raised.add(vv);
            if (Y[vv] > maxY) maxY = Y[vv];
          }
        }
        const PEAK = (0.22 + rng() * 0.3) * peakScale;
        const target = maxY + PEAK;
        for (const vv of raised) {
          const vix = vv % VX, viy = (vv / VX) | 0;
          const edgeDist = Math.min(vix, VX - 1 - vix, viy, VZ - 1 - viy);
          const blend = Math.min(1, edgeDist / 2);
          if (blend <= 0) continue;
          const vx = worldU0 + vix * STEP, vz = worldV0 + viy * STEP;
          const hgt = seamDisp(vx, vz) + blend * target + roughDisp(vx, vz) * blend;
          if (hgt > Y[vv]) Y[vv] = hgt;
        }
      }
    }
    for (let vi = 0; vi < VX; vi++) { Y[vi] = 0; Y[(VZ - 1) * VX + vi] = 0; }
    for (let vj = 0; vj < VZ; vj++) { Y[vj * VX] = 0; Y[vj * VX + VX - 1] = 0; }
    return { VX, VZ, Y };
  }
  function sampleRockMoundBump(field, u, v) {
    const fx = u * (field.VX - 1), fz = v * (field.VZ - 1);
    const ix = Math.max(0, Math.min(field.VX - 2, Math.floor(fx))), iz = Math.max(0, Math.min(field.VZ - 2, Math.floor(fz)));
    const tx = fx - ix, tz = fz - iz;
    const y00 = field.Y[iz * field.VX + ix], y10 = field.Y[iz * field.VX + ix + 1];
    const y01 = field.Y[(iz + 1) * field.VX + ix], y11 = field.Y[(iz + 1) * field.VX + ix + 1];
    return y00 * (1 - tx) * (1 - tz) + y10 * tx * (1 - tz) + y01 * (1 - tx) * tz + y11 * tx * tz;
  }

  // Animal den geometry — a synthetic carved-mouth rounded-boulder rock
  // volume matching the den footprint's actual collision shape (see
  // grid-tile-accessors.js's isAnimalDenCollisionTile: solid except a
  // south-wall doorway gap), used for the Map Editor preview and headless
  // watertightness checks. The live game no longer renders this shape
  // itself (see zone-den-totem-features.js's buildAnimalDenMeshes, which
  // places a cave_small.glb prop instead) — this generator stays purely to
  // exercise/preview the footprint's own collision geometry.
  function buildAnimalDenGeometry(dens, zGrid) {
    const pos = [], idx = [], meta = [];
    let vi = 0;
    if (!dens || !dens.length) return { pos, idx, meta };
    const DEN_HEIGHT = 1.6, DEN_SINK = 0.35;
    const MOUTH_U0 = 0.32, MOUTH_U1 = 0.68, MOUTH_V1 = 0.58, MOUTH_DEPTH = 0.5;
    const addPlanarQuad = (corners, segsU, segsV, bumpField) => {
      const ux = { x: corners.p10.x - corners.p00.x, y: corners.p10.y - corners.p00.y, z: corners.p10.z - corners.p00.z };
      const vx = { x: corners.p01.x - corners.p00.x, y: corners.p01.y - corners.p00.y, z: corners.p01.z - corners.p00.z };
      let nx = ux.y * vx.z - ux.z * vx.y, ny = ux.z * vx.x - ux.x * vx.z, nz = ux.x * vx.y - ux.y * vx.x;
      const nlen = Math.hypot(nx, ny, nz) || 1; nx /= nlen; ny /= nlen; nz /= nlen;
      const base = vi;
      for (let j = 0; j <= segsV; j++) for (let i = 0; i <= segsU; i++) {
        const u = i / segsU, v = j / segsV;
        const x = corners.p00.x + ux.x * u + vx.x * v;
        const y = corners.p00.y + ux.y * u + vx.y * v;
        const z = corners.p00.z + ux.z * u + vx.z * v;
        const d = bumpField ? sampleRockMoundBump(bumpField, u, v) : 0;
        pos.push(x + nx * d, y + ny * d, z + nz * d);
      }
      for (let j = 0; j < segsV; j++) for (let i = 0; i < segsU; i++) {
        const a = base + j * (segsU + 1) + i, b = a + 1, c0 = a + (segsU + 1), d2 = c0 + 1;
        idx.push(a, c0, d2, a, d2, b);
      }
      vi += (segsU + 1) * (segsV + 1);
    };
    for (const den of dens) {
      const w = den.w || 1, h = den.h || 1;
      const centerCol = den.x + Math.floor(w / 2), centerRow = den.y + Math.floor(h / 2);
      const elevTier = zGrid?.[centerRow]?.[centerCol]?.elevTier || 0;
      const groundY = NORMAL_TOP + elevTier * PLATEAU_UNIT;
      const x0 = den.x, x1 = den.x + w, z0 = den.y, z1 = den.y + h;
      const yBase = groundY - DEN_SINK, yTop = groundY + DEN_HEIGHT;
      const vTiles = yTop - yBase;
      const segsW = Math.max(4, Math.round(w * ROCK_MOUND_CELLS_PER_TILE));
      const segsH = Math.max(4, Math.round(h * ROCK_MOUND_CELLS_PER_TILE));
      const segsVert = Math.max(4, Math.round(vTiles * ROCK_MOUND_CELLS_PER_TILE));
      const northField = buildRockMoundBumpField(w, vTiles, x0, yBase, 1);
      const eastField  = buildRockMoundBumpField(h, vTiles, z0, yBase, 2);
      const westField  = buildRockMoundBumpField(h, vTiles, z0, yBase, 3);
      const topField   = buildRockMoundBumpField(w, h, x0, z0, 4, 1.4);
      addPlanarQuad({ p00: { x: x1, y: yBase, z: z0 }, p10: { x: x0, y: yBase, z: z0 }, p01: { x: x1, y: yTop, z: z0 }, p11: { x: x0, y: yTop, z: z0 } }, segsW, segsVert, northField);
      addPlanarQuad({ p00: { x: x1, y: yBase, z: z1 }, p10: { x: x1, y: yBase, z: z0 }, p01: { x: x1, y: yTop, z: z1 }, p11: { x: x1, y: yTop, z: z0 } }, segsH, segsVert, eastField);
      addPlanarQuad({ p00: { x: x0, y: yBase, z: z0 }, p10: { x: x0, y: yBase, z: z1 }, p01: { x: x0, y: yTop, z: z0 }, p11: { x: x0, y: yTop, z: z1 } }, segsH, segsVert, westField);
      addPlanarQuad({ p00: { x: x0, y: yTop, z: z0 }, p10: { x: x1, y: yTop, z: z0 }, p01: { x: x0, y: yTop, z: z1 }, p11: { x: x1, y: yTop, z: z1 } }, segsW, segsH, topField);
      const xm0 = x0 + (x1 - x0) * MOUTH_U0, xm1 = x0 + (x1 - x0) * MOUTH_U1;
      const ym1 = yBase + (yTop - yBase) * MOUTH_V1;
      const leftW = xm0 - x0, rightW = x1 - xm1, topStripH = yTop - ym1, mouthW = xm1 - xm0;
      const southLeftField  = buildRockMoundBumpField(leftW, vTiles, x0, yBase, 5);
      const southRightField = buildRockMoundBumpField(rightW, vTiles, xm1, yBase, 6);
      const southTopField   = buildRockMoundBumpField(mouthW, topStripH, xm0, ym1, 7);
      addPlanarQuad({ p00: { x: x0, y: yBase, z: z1 }, p10: { x: xm0, y: yBase, z: z1 }, p01: { x: x0, y: yTop, z: z1 }, p11: { x: xm0, y: yTop, z: z1 } }, Math.max(3, Math.round(leftW * ROCK_MOUND_CELLS_PER_TILE)), segsVert, southLeftField);
      addPlanarQuad({ p00: { x: xm1, y: yBase, z: z1 }, p10: { x: x1, y: yBase, z: z1 }, p01: { x: xm1, y: yTop, z: z1 }, p11: { x: x1, y: yTop, z: z1 } }, Math.max(3, Math.round(rightW * ROCK_MOUND_CELLS_PER_TILE)), segsVert, southRightField);
      addPlanarQuad({ p00: { x: xm0, y: ym1, z: z1 }, p10: { x: xm1, y: ym1, z: z1 }, p01: { x: xm0, y: yTop, z: z1 }, p11: { x: xm1, y: yTop, z: z1 } }, Math.max(3, Math.round(mouthW * ROCK_MOUND_CELLS_PER_TILE)), Math.max(3, Math.round(topStripH * ROCK_MOUND_CELLS_PER_TILE)), southTopField);
      const zIn = z1 - MOUTH_DEPTH;
      addPlanarQuad({ p00: { x: xm0, y: yBase, z: z1 }, p10: { x: xm0, y: yBase, z: zIn }, p01: { x: xm0, y: ym1, z: z1 }, p11: { x: xm0, y: ym1, z: zIn } }, 1, 2, null);
      addPlanarQuad({ p00: { x: xm1, y: yBase, z: zIn }, p10: { x: xm1, y: yBase, z: z1 }, p01: { x: xm1, y: ym1, z: zIn }, p11: { x: xm1, y: ym1, z: z1 } }, 1, 2, null);
      addPlanarQuad({ p00: { x: xm0, y: ym1, z: z1 }, p10: { x: xm1, y: ym1, z: z1 }, p01: { x: xm0, y: ym1, z: zIn }, p11: { x: xm1, y: ym1, z: zIn } }, 2, 1, null);
      meta.push({ denId: den.id, x0, x1, z0, z1, yBase, yTop });
    }
    return { pos, idx, meta };
  }

  function validateAnimalDenGeometry(denGeo) {
    const issues = [];
    if (!denGeo.pos.every(Number.isFinite)) issues.push({ severity: 'error', code: 'NON_FINITE_DEN_VERTEX', message: 'Animal den geometry has a non-finite vertex.' });
    if (denGeo.meta.length && !denGeo.pos.length) issues.push({ severity: 'error', code: 'EMPTY_DEN_GEOMETRY', message: 'Animal dens were provided but no geometry was built for them.' });
    return issues;
  }

  // ── Waterwalls: vertical water curtains where a river crosses a plateau edge ─
  // A WATERFALL cell sits on a plateau sub-map right at its own outer edge (see
  // game.js/index.html's mirrorRiverAcrossPlateau) — its merged-grid neighbor one
  // step further out is the footprint's 1-tile cliff-face ring, which mergeZoneTiles
  // always stakes flat at `type: 'grass'` (it's covered by the mesa wall mesh, not
  // a real floor tile) at the LOWER tier the cliff drops to. So unlike ramp
  // curtains, a waterfall's far side is never itself water-typed — the elevTier
  // step alone marks the boundary the water has to climb. Builds one vertical
  // quad per such edge, from this cell's own bed down to ground level at the
  // neighbor's (lower, usually) tier.
  function buildWaterfallWallGeometry(zGrid, cols, rows) {
    const cells = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (zGrid[r]?.[c]?.type === TileType.WATERFALL) cells.push([c, r]);
    if (!cells.length) return { pos: [], idx: [] };

    const pos = [], idx = [];
    let vi = 0;
    for (const [c, r] of cells) {
      const t = zGrid[r][c];
      const selfY = RIVER_TOP + (t.elevTier || 0) * PLATEAU_UNIT;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = zGrid[r + dr]?.[c + dc];
        if (!nt || (nt.elevTier || 0) === (t.elevTier || 0)) continue;
        const neighborIsWater = nt.type === TileType.RIVER || nt.type === TileType.STREAM || nt.type === TileType.WATERFALL;
        const neighborY = (neighborIsWater ? RIVER_TOP : NORMAL_TOP) + (nt.elevTier || 0) * PLATEAU_UNIT;
        const top = Math.max(selfY, neighborY), bottom = Math.min(selfY, neighborY);
        let x0, z0, x1, z1;
        if (dc === 1) { x0 = c + 1; z0 = r; x1 = c + 1; z1 = r + 1; }
        else if (dc === -1) { x0 = c; z0 = r + 1; x1 = c; z1 = r; }
        else if (dr === 1) { x0 = c; z0 = r + 1; x1 = c + 1; z1 = r + 1; }
        else /* dr === -1 */ { x0 = c + 1; z0 = r; x1 = c; z1 = r; }
        pos.push(x0, top, z0, x1, top, z1, x0, bottom, z0, x1, bottom, z1);
        idx.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1); vi += 4;
      }
    }
    return { pos, idx };
  }

  // ── Watertightness checks ───────────────────────────────────────────────────
  // None of this exists in docs/game.js — it's new tooling, not a mirror of
  // anything. Walks a workspace's plateau authoring data (independent of any
  // one map's merge) looking for the structural mistakes that have caused
  // visible terrain bugs in the past: orphaned references, brush strokes left
  // disconnected, groups that can never raise, and tier overlaps that need the
  // seam-blend (buildPlateauMesaGeometry handles the last one correctly now,
  // but it's still useful to surface so a new map's tight margins are visible
  // before they're seen as a rendering glitch).
  function floodFillComponents(mask, passable = mask) {
    const seen = new Set(), components = [];
    for (const start of mask) {
      if (seen.has(start)) continue;
      const stack = [start], comp = [];
      seen.add(start);
      while (stack.length) {
        const k = stack.pop();
        if (mask.has(k)) comp.push(k);
        const [c, r] = k.split(',').map(Number);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = `${c + dc},${r + dr}`;
          if (passable.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      components.push(comp);
    }
    return components;
  }

  function ringOf(mask) {
    const ring = new Set();
    for (const k of mask) {
      const [c, r] = k.split(',').map(Number);
      const onRing = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => !mask.has(`${c + dc},${r + dr}`));
      if (onRing) ring.add(k);
    }
    return ring;
  }

  function validateTerrain(ws, rootMapId) {
    const issues = [];
    const maxDelta = TERRAIN_CONFIG.subtleHeightMaxNeighborDelta ?? (VISUAL_HEIGHT_MAX - VISUAL_HEIGHT_MIN);
    for (const m of (ws.maps || [])) {
      for (const [key, value] of Object.entries(m.visualHeights || {})) {
        const match = /^(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(key);
        if (!match) { issues.push({ severity:'error', code:'VISUAL_HEIGHT_KEY', mapId:m.id, message:`Malformed visualHeights key "${key}".` }); continue; }
        const c=Number(match[1]), r=Number(match[2]);
        if (c>=m.cols || r>=m.rows) issues.push({ severity:'error', code:'VISUAL_HEIGHT_BOUNDS', mapId:m.id, message:`visualHeights cell ${key} is outside ${m.cols}x${m.rows}.` });
        if (!Number.isFinite(value)) issues.push({ severity:'error', code:'VISUAL_HEIGHT_FINITE', mapId:m.id, message:`visualHeights cell ${key} is not finite.` });
        else if (value<VISUAL_HEIGHT_MIN || value>VISUAL_HEIGHT_MAX) issues.push({ severity:'error', code:'VISUAL_HEIGHT_LIMIT', mapId:m.id, message:`visualHeights cell ${key} exceeds configured limits.` });
        for (const [dc,dr] of [[1,0],[0,1]]) {
          const neighbor=m.visualHeights?.[`${c+dc},${r+dr}`] || 0;
          if (Number.isFinite(value) && Math.abs(value-neighbor)>maxDelta) issues.push({ severity:'error', code:'VISUAL_HEIGHT_DISCONTINUITY', mapId:m.id, message:`visualHeights edge at ${key} violates the no-cliff delta.` });
        }
      }
    }
    const maps = ws.maps || [];
    const groupsById = new Map((ws.plateauGroups || []).map(g => [g.id, g]));
    const mapsById = new Map(maps.map(m => [m.id, m]));
    const childByParentGroup = new Map();
    for (const m of maps) {
      if (m.isSubmap && m.parentMapId && m.plateauGroupId) {
        childByParentGroup.set(`${m.parentMapId}__${m.plateauGroupId}`, m);
      }
    }

    for (const g of (ws.plateauGroups || [])) {
      if (!(g.elevation > 0)) {
        issues.push({ severity: 'error', code: 'ZERO_ELEVATION', groupId: g.id, message: `Plateau group "${g.label || g.id}" has elevation ${g.elevation ?? 0} — its mesa will never render raised.` });
      }
    }

    for (const m of maps) {
      const localMask = new Map();
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        const pid = m.tiles?.[`${c},${r}`]?.plateau;
        if (!pid) continue;
        let s = localMask.get(pid); if (!s) { s = new Set(); localMask.set(pid, s); }
        s.add(`${c},${r}`);
      }
      for (const [gid, mask] of localMask) {
        if (!groupsById.has(gid)) {
          issues.push({ severity: 'error', code: 'ORPHANED_PLATEAU_REF', mapId: m.id, groupId: gid, message: `Map "${m.name || m.id}" paints plateau group "${gid}" which no longer exists in plateauGroups.` });
          continue;
        }
        if (!childByParentGroup.has(`${m.id}__${gid}`)) {
          issues.push({ severity: 'warning', code: 'MISSING_CHILD_SUBMAP', mapId: m.id, groupId: gid, message: `Map "${m.name || m.id}" paints plateau group "${gid}" but has no authored child sub-map for it yet — that tier won't be staked or rendered.` });
          continue;
        }
        // A taller sibling plateau painted on the same map punches a hole in
        // this group's mask (it overwrote those cells), which would otherwise
        // look like a disconnected blob even though the footprint is one
        // contiguous ring around its taller neighbor. Let connectivity pass
        // through cells owned by any strictly-taller group so only genuine
        // stray strokes get flagged.
        const passable = new Set(mask);
        for (const [otherGid, otherMask] of localMask) {
          if (otherGid === gid) continue;
          const otherElev = groupsById.get(otherGid)?.elevation ?? 0;
          if (otherElev > (groupsById.get(gid)?.elevation ?? 0)) {
            for (const k of otherMask) passable.add(k);
          }
        }
        const components = floodFillComponents(mask, passable);
        if (components.length > 1) {
          issues.push({ severity: 'warning', code: 'DISCONNECTED_MASK', mapId: m.id, groupId: gid, message: `Plateau group "${gid}" on map "${m.name || m.id}" is painted as ${components.length} disconnected blobs (sizes: ${components.map(c => c.length).join(', ')}) — likely a stray brush stroke.`, cells: components });
        }
      }
    }

    const merged = buildMergedZoneGrid(ws, rootMapId);
    const mesas = merged.mesas;
    for (let i = 0; i < mesas.length; i++) {
      const ring = ringOf(mesas[i].maskWorldKeys);
      for (let j = 0; j < mesas.length; j++) {
        if (i === j) continue;
        // A child tier's footprint is always nested inside its ancestors'
        // footprints, so a lower/outer mesa's mask trivially "overlaps" every
        // inner mesa's ring too — that's normal nesting, not a seam mismatch.
        // The actual seam case (this mesh's BFS will misread the ring's real
        // height) only exists when the OVERLAPPING mesa sits at a tier
        // strictly higher than the ring's own base tier (ring cells are
        // staked at exactly mesas[i].fromTier — see mergeZoneTilesInto).
        if (!(mesas[j].fromTier > mesas[i].fromTier)) continue;
        const overlap = [...mesas[j].maskWorldKeys].filter(k => ring.has(k));
        if (overlap.length) {
          issues.push({
            severity: 'info', code: 'TIER_OVERLAP_RING', groupId: mesas[j].groupId, otherGroupId: mesas[i].groupId,
            message: `Plateau group "${mesas[j].groupId}" footprint overlaps ${overlap.length} ring cell(s) of group "${mesas[i].groupId}" (tier ${mesas[i].fromTier}→${mesas[i].toTier}) — those cells sit on a still-sloping wall, not a flat top. The seam-blend handles this, but a wider margin there would be cleaner.`,
            cells: overlap,
          });
        }
      }
    }

    try {
      const rockGrid = buildZGrid(merged.cols, merged.rows, merged.tiles);
      applyRampCurtainFlags(rockGrid, merged.cols, merged.rows);
      const rockGeo = buildRockFormationGeometry(merged, rockGrid, merged.cols, merged.rows);
      issues.push(...validateRockFormationGeometry(rockGeo));
      if ([...rockGeo.pos].some(v => !Number.isFinite(v))) issues.push({ severity: 'error', code: 'NON_FINITE_ROCK_GEOMETRY', message: 'Solved rock formation mesh contains a non-finite coordinate.' });
    } catch (e) {
      issues.push({ severity: 'error', code: 'ROCK_SOLVER_THROW', message: `Rock formation solver threw: ${e.message}` });
    }

    return issues;
  }

  return {
    PLATEAU_UNIT, NORMAL_TOP, VISUAL_HEIGHT_MIN, VISUAL_HEIGHT_MAX, VISUAL_HEIGHT_DISPLACEMENT, TileType,
    sampleVisualHeight, displaceGeometryPositions,
    buildMergedZoneGrid, buildZGrid, applyRampCurtainFlags,
    buildPlateauMesaGeometry, buildRampMeshGeometry, buildRampCurtainGeometry,
    buildRockSourceSpans, buildRockFormationGeometry, validateRockFormationGeometry,
    buildAnimalDenGeometry, validateAnimalDenGeometry,
    buildRockMoundBumpField, sampleRockMoundBump,
    buildWaterfallWallGeometry, buildTerrainTileGeo, validateTerrain,
  };
});
