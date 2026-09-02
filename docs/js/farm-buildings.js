(() => {
  'use strict';

  // Farm buildings: barns (movable, buildable via the Farm tab). Barn visuals
  // are authored house-piece JSONs, one per tier; the player's modular house
  // remains owned by HousePieces. This module intentionally owns barn-specific
  // asset readiness, placement footprints, world registration, and livestock
  // proximity so those concerns stay out of game.js.
  const BARN_PIECES = {
    nursery:{ file: 'config/pieces/barn-nursery.json', w: 3, h: 2 },
    small:  { file: 'config/pieces/barn-small.json',   w: 4, h: 3 },
    medium: { file: 'config/pieces/barn-medium.json',  w: 4, h: 5 },
    large:  { file: 'config/pieces/barn-large.json',   w: 6, h: 5 },
  };

  let deps = null, blockedTileTypes;
  let _sharedFarmStructureAssetPromise = null; // Used to make the real brick/shingle upgrade one shared readiness boundary for barns and the player house.
  let _nurseryInteriorLoopRaf = 0; // Owns the temporary Nursery-only visual loop because the normal farm-animal loop may stop while inside buildings.
  let _nurseryInteriorLoopMapId = null; // Tracks the generated Nursery map whose swarm is currently being serviced.
  let _nurseryInteriorLoopEntered = false; // Distinguishes a short building-load handoff from a real exit so the loop can wait for area activation once.
  let _nurseryInteriorLastFrameAt = 0; // Timestamp used to feed stable seconds-based dt into the existing livestock visual updater.

  function _pieceDef(tier) { return BARN_PIECES[tier] || BARN_PIECES.small; }

  function _currentAreaForNurseryLoop() {
    return window.Combat?.deps?.getCurrentArea?.()
      || window.__hobunjiFurnitureDebug?.getCurrentArea?.()
      || null;
  }

  function _stopNurseryInteriorLoop({ flush = false } = {}) {
    if (_nurseryInteriorLoopRaf) cancelAnimationFrame(_nurseryInteriorLoopRaf);
    _nurseryInteriorLoopRaf = 0;
    _nurseryInteriorLoopMapId = null;
    _nurseryInteriorLoopEntered = false;
    _nurseryInteriorLastFrameAt = 0;
    if (flush) window.FarmAnimals?.updateAnimalMeshes?.(0); // Lets the Nursery wrapper dispose its visual-only baby meshes after an exit.
  }

  function _startNurseryInteriorLoop(mapId) {
    if (mapId !== 'map_i_barn_farm_nursery') return;
    _stopNurseryInteriorLoop();
    _nurseryInteriorLoopMapId = mapId;
    let activationFrames = 0; // Small load-handoff grace period; avoids assuming enterBuilding switches currentArea synchronously.
    const frame = now => {
      _nurseryInteriorLoopRaf = 0;
      const currentArea = _currentAreaForNurseryLoop();
      const inside = currentArea === _nurseryInteriorLoopMapId;
      if (!inside) {
        if (_nurseryInteriorLoopEntered) {
          _stopNurseryInteriorLoop({ flush: true });
          return;
        }
        activationFrames++;
        if (activationFrames > 120) { _stopNurseryInteriorLoop(); return; }
        _nurseryInteriorLoopRaf = requestAnimationFrame(frame);
        return;
      }

      _nurseryInteriorLoopEntered = true;
      const dt = _nurseryInteriorLastFrameAt > 0
        ? Math.max(0, Math.min(0.05, (now - _nurseryInteriorLastFrameAt) / 1000))
        : 1 / 60;
      _nurseryInteriorLastFrameAt = now;
      // FarmAnimals.updateAnimalMeshes is already wrapped by LivestockNursery;
      // driving that public seam here keeps the swarm renderer authoritative
      // without adding another animal renderer or touching game.js's private loop.
      window.FarmAnimals?.updateAnimalMeshes?.(dt);
      if (_currentAreaForNurseryLoop() === _nurseryInteriorLoopMapId) {
        _nurseryInteriorLoopRaf = requestAnimationFrame(frame);
      } else {
        _stopNurseryInteriorLoop({ flush: true });
      }
    };
    _nurseryInteriorLoopRaf = requestAnimationFrame(frame);
  }

  function _applySharedFarmStructureTints() {
    if (!deps?.houseWallBuilder || typeof HousePieceGen === 'undefined') return;
    deps.houseWallBuilder.tintDefaultGlb?.('assets/textures/carved_smooth.png', '#4d4d4d');
    HousePieceGen.tintShingleMaterial?.('assets/textures/carved_smooth.png', '#7d7355');
  }

  // WallBuilder intentionally lets structures render immediately with a brown
  // placeholder when Roughbrick1.glb is still loading. The old farm path only
  // rebuilt the player house when the *shingle* GLB became ready, so if shingles
  // won that race the rebuilt house permanently retained placeholder bricks.
  // Treat both shared structure assets as one boundary, queue the texture tint
  // before loading, then rebuild every already-built farm structure once both
  // real templates are available. Town/zone buildings already do the same thing.
  function _ensureSharedFarmStructureAssets() {
    if (_sharedFarmStructureAssetPromise || !deps?.houseWallBuilder || typeof HousePieceGen === 'undefined') return _sharedFarmStructureAssetPromise;
    _applySharedFarmStructureTints();
    _sharedFarmStructureAssetPromise = Promise.all([
      deps.houseWallBuilder.loadDefaultGlb(),
      HousePieceGen.loadShingleGlb('assets/models/'),
    ]).then(() => {
      _applySharedFarmStructureTints();
      for (const entry of deps.getFarmBuildings()) {
        if (entry.stage === 'built') _buildStructureMesh(entry);
      }
      window.HousePieces?.rebuildStructureMeshes?.();
      deps.debugLog?.('Farm structures: upgraded to textured brick + shingle assets.');
    }).catch(error => {
      _sharedFarmStructureAssetPromise = null;
      deps.debugLog?.(`Farm structure asset upgrade failed: ${error?.message || error}`, 'warn');
    });
    return _sharedFarmStructureAssetPromise;
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    blockedTileTypes = new Set([
      deps.TileType.TRENCH, deps.TileType.TILLED, deps.TileType.RAISED, deps.TileType.PADDY,
      deps.TileType.RIVER, deps.TileType.STREAM, deps.TileType.WATERFALL, deps.TileType.RAMP,
    ]);
    if (typeof deps.enterBuilding === 'function' && !deps.enterBuilding.__nurseryInteriorLoopWrapped) {
      const originalEnterBuilding = deps.enterBuilding;
      const wrappedEnterBuilding = function nurseryInteriorLoopEnterBuilding(mapId, ...args) {
        const result = originalEnterBuilding.call(this, mapId, ...args);
        _startNurseryInteriorLoop(mapId);
        return result;
      };
      wrappedEnterBuilding.__nurseryInteriorLoopWrapped = true;
      deps.enterBuilding = wrappedEnterBuilding;
    }
    _ensureSharedFarmStructureAssets();
  }

  function rectsOverlap(aCol, aRow, aW, aH, bCol, bRow, bW, bH) {
    return aCol < bCol + bW && aCol + aW > bCol && aRow < bRow + bH && aRow + aH > bRow;
  }

  function canPlaceAt(col, row, w, h, excludeId) {
    if (!Number.isFinite(col) || !Number.isFinite(row)) return false;
    if (col < 0 || row < 0 || col + w > deps.COLS || row + h > deps.ROWS) return false;
    const grid = deps.getGrid();
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        const tile = grid[r]?.[c];
        if (!tile || blockedTileTypes.has(tile.type) || tile.crop) return false;
        const obj = deps.worldObjects.get(c + ',' + r);
        if (obj && obj.id !== excludeId) return false;
      }
    }
    for (const h2 of deps.getHousePieceRects()) {
      if (rectsOverlap(col, row, w, h, h2.col, h2.row, h2.w, h2.h)) return false;
    }
    for (const b of deps.getFarmBuildings()) {
      if (b.id === excludeId) continue;
      if (rectsOverlap(col, row, w, h, b.col, b.row, b.w, b.h)) return false;
    }
    return true;
  }

  function clearFootprint(col, row, w, h) {
    const grid = deps.getGrid();
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        const tile = grid[r]?.[c];
        if (tile && (tile.type === deps.TileType.ROCK || tile.type === deps.TileType.SHRUB || tile.type === deps.TileType.WEEDS)) {
          tile.type = deps.TileType.GRASS;
          deps.markTileDirty(c, r);
        }
      }
    }
    deps.recomputeWater(false);
  }

  // Each barn tier has its own authored piece and cache. The Nursery adds a
  // dedicated tiny 3x2 shell; regular barns keep their existing footprints:
  // Small 4x3, Medium 4x5, Large 6x5.
  const _barnPiecePromises = new Map();
  function _loadBarnPiece(tier) {
    const key = BARN_PIECES[tier] ? tier : 'small';
    if (!_barnPiecePromises.has(key)) {
      _barnPiecePromises.set(key, fetch(_pieceDef(key).file).then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      }).catch(e => {
        _barnPiecePromises.delete(key);
        deps.debugLog(`Barn piece load error (${key}): ${e}`, 'warn');
        return null;
      }));
    }
    return _barnPiecePromises.get(key);
  }

  // The editor stores green entry-tunnel tiles in footprint metadata. Barn
  // source pieces deliberately keep those markers but omit previously baked
  // tunnel faces so this runtime pass can generate one continuous mouth from
  // an adjacent run. This avoids preserving the old "first tile is a doorway,
  // second tile is a solid wall" export bug in existing v37 files.
  function _clonePiece(piece) {
    return JSON.parse(JSON.stringify(piece?.currentPiece || piece));
  }

  function _lerp3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function _entryRun(piece) {
    const fp = piece?.footprint;
    const cells = fp?.cells || [];
    const ext = fp?.extensions || {};
    const regular = Array.isArray(ext.entryTunnels) ? ext.entryTunnels : [];
    const tall = Array.isArray(ext.tallEntryTunnels) ? ext.tallEntryTunnels : [];
    const source = tall.length ? tall : regular;
    if (!cells.length || !source.length) return null;

    const minX = Math.min(...cells.map(c => c.x)), maxX = Math.max(...cells.map(c => c.x));
    const minY = Math.min(...cells.map(c => c.y)), maxY = Math.max(...cells.map(c => c.y));
    const sides = [
      { side: 'south', cells: source.filter(c => c.y === maxY), axis: 'x' },
      { side: 'north', cells: source.filter(c => c.y === minY), axis: 'x' },
      { side: 'east',  cells: source.filter(c => c.x === maxX), axis: 'y' },
      { side: 'west',  cells: source.filter(c => c.x === minX), axis: 'y' },
    ].filter(s => s.cells.length);
    if (!sides.length) return null;

    const picked = sides.sort((a, b) => b.cells.length - a.cells.length)[0];
    const sorted = picked.cells.slice().sort((a, b) => a[picked.axis] - b[picked.axis]);
    let best = [], run = [];
    for (const cell of sorted) {
      if (!run.length || cell[picked.axis] === run[run.length - 1][picked.axis] + 1) run.push(cell);
      else { if (run.length > best.length) best = run; run = [cell]; }
    }
    if (run.length > best.length) best = run;
    return { side: picked.side, cells: best, heightScale: tall.length ? 1.5 : 1 };
  }

  function _wallSideMap(faces) {
    const walls = faces.filter(f => f.tag === 'wall' && f.highlandFrustumWall && !f.gableEnd);
    if (!walls.length) return new Map();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of walls) {
      for (const p of [f.v[0], f.v[3]]) {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
      }
    }
    const map = new Map();
    for (const f of walls) {
      const cx = (f.v[0][0] + f.v[3][0]) / 2, cz = (f.v[0][2] + f.v[3][2]) / 2;
      const d = { north: Math.abs(cz - minZ), south: Math.abs(cz - maxZ), west: Math.abs(cx - minX), east: Math.abs(cx - maxX) };
      map.set(f, Object.entries(d).sort((a, b) => a[1] - b[1])[0][0]);
    }
    return map;
  }

  function _cutWallForEntryRun(faces, run, piece) {
    const sideMap = _wallSideMap(faces);
    const target = faces.find(f => sideMap.get(f) === run.side);
    if (!target || !run.cells.length) return faces;

    const tile = Math.max(0.0001, Number(piece.tileSize) || 1);
    const half = (Number(piece.gridSize) || 18) * tile / 2;
    const minCell = Math.min(...run.cells.map(c => run.side === 'north' || run.side === 'south' ? c.x : c.y));
    const maxCell = Math.max(...run.cells.map(c => run.side === 'north' || run.side === 'south' ? c.x : c.y));
    const coord0 = minCell * tile - half;
    const coord1 = (maxCell + 1) * tile - half;
    const axis = run.side === 'north' || run.side === 'south' ? 0 : 2;
    const a = target.v[0][axis], b = target.v[3][axis];
    const toU = coord => Math.max(0, Math.min(1, (coord - a) / (b - a || 1)));
    const ua = toU(coord0), ub = toU(coord1);
    const u0 = Math.min(ua, ub), u1 = Math.max(ua, ub);
    const b0 = target.v[0], t0 = target.v[1], t1 = target.v[2], b1 = target.v[3];
    const bottom = u => _lerp3(b0, b1, u);
    const top = u => _lerp3(t0, t1, u);
    const point = (u, v) => _lerp3(bottom(u), top(u), v);
    const openTop = Math.min(0.98, 0.92 * run.heightScale);

    const replacements = [];
    if (u0 > 1e-5) replacements.push({ ...target, v: [bottom(0), top(0), top(u0), bottom(u0)], entryPortalCut: true, entryPortalPart: 'solidBesideEntryPortal' });
    if (openTop < 0.999) replacements.push({ ...target, v: [point(u0, openTop), top(u0), top(u1), point(u1, openTop)], entryPortalCut: true, entryPortalPart: run.heightScale > 1 ? 'tallEntryLintel' : 'nearFullHeightEntryLintel' });
    if (u1 < 1 - 1e-5) replacements.push({ ...target, v: [bottom(u1), top(u1), top(1), bottom(1)], entryPortalCut: true, entryPortalPart: 'solidBesideEntryPortal' });

    const out = [];
    for (const f of faces) {
      if (f === target) out.push(...replacements);
      else out.push(f);
    }
    return out;
  }

  function _pushFace(faces, v, tag, extra = {}) {
    faces.push({ id: 0, v, tag, color: null, ...extra });
  }

  function _addBoxFaces(faces, rect, y0, y1, tag, extra = {}) {
    const P = (x, y, z) => [x, y, z];
    _pushFace(faces, [P(rect.minX,y0,rect.minZ),P(rect.maxX,y0,rect.minZ),P(rect.maxX,y0,rect.maxZ),P(rect.minX,y0,rect.maxZ)], tag, { extensionFace:'floor', ...extra });
    _pushFace(faces, [P(rect.minX,y1,rect.maxZ),P(rect.maxX,y1,rect.maxZ),P(rect.maxX,y1,rect.minZ),P(rect.minX,y1,rect.minZ)], tag, { extensionFace:'top', ...extra });
    _pushFace(faces, [P(rect.minX,y0,rect.minZ),P(rect.minX,y1,rect.minZ),P(rect.maxX,y1,rect.minZ),P(rect.maxX,y0,rect.minZ)], tag, { extensionFace:'north', ...extra });
    _pushFace(faces, [P(rect.maxX,y0,rect.minZ),P(rect.maxX,y1,rect.minZ),P(rect.maxX,y1,rect.maxZ),P(rect.maxX,y0,rect.maxZ)], tag, { extensionFace:'east', ...extra });
    _pushFace(faces, [P(rect.maxX,y0,rect.maxZ),P(rect.maxX,y1,rect.maxZ),P(rect.minX,y1,rect.maxZ),P(rect.minX,y0,rect.maxZ)], tag, { extensionFace:'south', ...extra });
    _pushFace(faces, [P(rect.minX,y0,rect.maxZ),P(rect.minX,y1,rect.maxZ),P(rect.minX,y1,rect.minZ),P(rect.minX,y0,rect.minZ)], tag, { extensionFace:'west', ...extra });
  }

  function _addWallBox(faces, rect, side, y0, y1, t, extra = {}) {
    let r;
    if (side === 'north') r = { minX:rect.minX,maxX:rect.maxX,minZ:rect.minZ,maxZ:rect.minZ+t };
    else if (side === 'south') r = { minX:rect.minX,maxX:rect.maxX,minZ:rect.maxZ-t,maxZ:rect.maxZ };
    else if (side === 'east') r = { minX:rect.maxX-t,maxX:rect.maxX,minZ:rect.minZ,maxZ:rect.maxZ };
    else r = { minX:rect.minX,maxX:rect.minX+t,minZ:rect.minZ,maxZ:rect.maxZ };
    _addBoxFaces(faces, r, y0, y1, 'entryTunnel', { extensionFace:side, solidifiedWall:true, wallThickness:t, ...extra });
  }

  function _addOpeningFrame(faces, rect, side, y0, y1, t, extra = {}) {
    const openH = (y1 - y0) * 0.92;
    const openW = (side === 'north' || side === 'south') ? (rect.maxX-rect.minX)*0.82 : (rect.maxZ-rect.minZ)*0.82;
    const cx=(rect.minX+rect.maxX)/2, cz=(rect.minZ+rect.maxZ)/2;
    const add=(r,a,b,part)=>_addBoxFaces(faces,r,a,b,'entryTunnel',{extensionFace:side,solidifiedWall:true,doorwayFrame:true,doorwayFramePart:part,wallThickness:t,...extra});
    if (side === 'north' || side === 'south') {
      const z0=side==='north'?rect.minZ:rect.maxZ-t, z1=side==='north'?rect.minZ+t:rect.maxZ;
      const o0=cx-openW/2, o1=cx+openW/2;
      if(o0>rect.minX) add({minX:rect.minX,maxX:o0,minZ:z0,maxZ:z1},y0,y1,'leftJamb');
      if(o1<rect.maxX) add({minX:o1,maxX:rect.maxX,minZ:z0,maxZ:z1},y0,y1,'rightJamb');
      add({minX:o0,maxX:o1,minZ:z0,maxZ:z1},y0+openH,y1,'lowLintel');
    } else {
      const x0=side==='west'?rect.minX:rect.maxX-t, x1=side==='west'?rect.minX+t:rect.maxX;
      const o0=cz-openW/2, o1=cz+openW/2;
      if(o0>rect.minZ) add({minX:x0,maxX:x1,minZ:rect.minZ,maxZ:o0},y0,y1,'leftJamb');
      if(o1<rect.maxZ) add({minX:x0,maxX:x1,minZ:o1,maxZ:rect.maxZ},y0,y1,'rightJamb');
      add({minX:x0,maxX:x1,minZ:o0,maxZ:o1},y0+openH,y1,'lowLintel');
    }
  }

  function _addRim(faces, rect, side, y, t, extra = {}) {
    let r;
    if (side === 'north') r={minX:rect.minX,maxX:rect.maxX,minZ:rect.minZ,maxZ:rect.minZ+t};
    else if(side === 'south') r={minX:rect.minX,maxX:rect.maxX,minZ:rect.maxZ-t,maxZ:rect.maxZ};
    else if(side === 'east') r={minX:rect.maxX-t,maxX:rect.maxX,minZ:rect.minZ,maxZ:rect.maxZ};
    else r={minX:rect.minX,maxX:rect.minX+t,minZ:rect.minZ,maxZ:rect.maxZ};
    _pushFace(faces, [[r.minX,y,r.maxZ],[r.maxX,y,r.maxZ],[r.maxX,y,r.minZ],[r.minX,y,r.minZ]], 'entryTunnel', { extensionFace:'topRimCap', rimSide:side, explicitSkywardCap:true, wallThickness:t, ...extra });
  }

  function _addEntryTunnelFaces(faces, piece, run) {
    const tile = Math.max(0.0001, Number(piece.tileSize) || 1);
    const half = (Number(piece.gridSize) || 18) * tile / 2;
    const xs = run.cells.map(c => c.x), ys = run.cells.map(c => c.y);
    const rect = {
      minX: Math.min(...xs) * tile - half,
      maxX: (Math.max(...xs) + 1) * tile - half,
      minZ: Math.min(...ys) * tile - half,
      maxZ: (Math.max(...ys) + 1) * tile - half,
    };
    const y0 = Number(piece.base?.groundY) || 0;
    const regularH = Math.max(tile * 1.05, (Number(piece.base?.height) || 1.4) * 0.82);
    const y1 = y0 + regularH * run.heightScale;
    const t = Math.max(0.06, tile * 0.13);
    const P = (x,y,z)=>[x,y,z];

    _pushFace(faces,[P(rect.minX,y0+0.006,rect.minZ),P(rect.maxX,y0+0.006,rect.minZ),P(rect.maxX,y0+0.006,rect.maxZ),P(rect.minX,y0+0.006,rect.maxZ)],'entryTunnel',{extensionFace:'floor',extensionType:'entryTunnel',openingRunTiles:run.cells.length,tallEntryTunnel:run.heightScale>1});
    _pushFace(faces,[P(rect.minX,y1+0.008,rect.maxZ),P(rect.maxX,y1+0.008,rect.maxZ),P(rect.maxX,y1+0.008,rect.minZ),P(rect.minX,y1+0.008,rect.minZ)],'entryTunnel',{extensionFace:'ceiling',extensionType:'entryTunnel',openingRunTiles:run.cells.length,tallEntryTunnel:run.heightScale>1});

    _addOpeningFrame(faces, rect, run.side, y0, y1, t, { exteriorEntryOpening:true, continuousMultiTileOpening:run.cells.length>1, openingRunTiles:run.cells.length, tallEntryTunnel:run.heightScale>1 });
    _addRim(faces, rect, run.side, y1+0.006, t, { exteriorEntryOpening:true, continuousMultiTileOpening:run.cells.length>1, openingRunTiles:run.cells.length, tallEntryTunnel:run.heightScale>1 });

    const sides = ['north','east','south','west'].filter(side => side !== run.side);
    for (const side of sides) {
      _addWallBox(faces, rect, side, y0, y1, t, { extensionType:'entryTunnel', wallRunTiles:run.cells.length, continuousWhenAdjacent:run.cells.length>1, tallEntryTunnel:run.heightScale>1 });
      _addRim(faces, rect, side, y1+0.002, t, { extensionType:'entryTunnel', wallRunTiles:run.cells.length, continuousWhenAdjacent:run.cells.length>1, tallEntryTunnel:run.heightScale>1 });
    }
  }

  function _prepareBarnPiece(piece) {
    const next = _clonePiece(piece);
    if (!next?.base?.faces) return next;
    const run = _entryRun(next);
    if (!run) return next;

    // Drop baked tunnel geometry from older exports, then regenerate from the
    // marker run so adjacent tiles automatically become one wide opening.
    let faces = next.base.faces.filter(f => f.tag !== 'entryTunnel');
    faces = _cutWallForEntryRun(faces, run, next);
    _addEntryTunnelFaces(faces, next, run);
    next.base.faces = faces.map((f, index) => ({ ...f, id:index + 1 }));
    return next;
  }

  const _barnWbDefaults = { unitMult: 0.4375, rockScale: 1.5, preScale: [1, 1, 0.6],
                             brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };
  let _barnBoardsMat = null, _barnStoneMat = null, _barnCanvasMat = null;
  function _barnFaceMats() {
    if (!_barnBoardsMat) {
      _barnBoardsMat = deps.loadHousePieceFaceTexture('assets/textures/boards.png', 0x8b6914, 1.2);
      _barnStoneMat  = deps.loadHousePieceFaceTexture('assets/textures/carved_smooth.png', 0x888888, 1.5, '#4d4d4d');
      _barnCanvasMat = deps.loadHousePieceFaceTexture('assets/textures/canvas.png', 0xcbb489, 2);
    }
    return { matBoards: _barnBoardsMat, matStone: _barnStoneMat, matCanvas: _barnCanvasMat };
  }

  function _buildFoundationMesh(col, row, w, h) {
    const mat  = new THREE.MeshLambertMaterial({ color: 0x8a7a63 });
    const geo  = new THREE.BoxGeometry(w * 0.94, 0.14, h * 0.94);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(col + w / 2, 0.07, row + h / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    deps.scene.add(mesh);
    return mesh;
  }

  function _disposeMesh(mesh) {
    if (!mesh) return;
    deps.scene.remove(mesh);
    mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  function _buildStructureMesh(entry) {
    if (typeof HousePieceGen === 'undefined') { deps.debugLog('HousePieceGen not loaded — barn shown as foundation slab', 'warn'); return; }
    _loadBarnPiece(entry.nursery ? 'nursery' : entry.tier).then(piece => {
      if (!piece || entry.stage !== 'built' || !deps.getFarmBuildings().includes(entry)) return;
      _disposeMesh(entry._mesh);
      entry._mesh = HousePieceGen.buildGroupFromPiece(THREE, _prepareBarnPiece(piece), entry.col, entry.row, {
        wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _barnWbDefaults,
        ..._barnFaceMats(),
      });
      deps.scene.add(entry._mesh);
    });
  }

  function label(entry) { return deps.getBarnTiers()[entry.tier]?.label || 'Barn'; }

  function _registerFootprint(entry) {
    for (let r = entry.row; r < entry.row + entry.h; r++) {
      for (let c = entry.col; c < entry.col + entry.w; c++) deps.worldObjects.set(c + ',' + r, entry._worldObj);
    }
  }
  function _unregisterFootprint(entry) {
    for (let r = entry.row; r < entry.row + entry.h; r++) {
      for (let c = entry.col; c < entry.col + entry.w; c++) {
        if (deps.worldObjects.get(c + ',' + r) === entry._worldObj) deps.worldObjects.delete(c + ',' + r);
      }
    }
  }

  function _makeWorldObject(entry) {
    return {
      id: entry.id, type: 'barn', kind: 'barn',
      get col() { return entry.col; }, get row() { return entry.row; },
      get label() { return '🏚 ' + label(entry); },
      getButtons() {
        if (entry.stage === 'foundation') {
          return [
            { icon: '🔨', label: 'Build ' + label(entry), action: 'obj_barn_build_' + entry.id, style: 'primary', allowed: deps.hasFarmPermission('alterFarm') },
            { icon: '💥', label: 'Demolish', action: 'obj_barn_demolish_' + entry.id, style: 'secondary', allowed: deps.hasFarmPermission('alterFarm') },
          ];
        }
        const tier = deps.getBarnTiers()[entry.tier];
        const occupants = deps.loadWorldLivestock().filter(l => l.barnId === entry.id).length;
        return [
          { icon: '🚪', label: 'Enter Barn', action: 'obj_barn_enter_' + entry.id, style: 'primary', allowed: true },
          { icon: '🐐', label: `Manage Livestock (${occupants}/${tier.slots})`, action: 'obj_barn_manage_' + entry.id, style: 'secondary', allowed: deps.hasFarmPermission('livestock') },
          { icon: '💥', label: 'Demolish', action: 'obj_barn_demolish_' + entry.id, style: 'secondary', allowed: deps.hasFarmPermission('alterFarm') },
        ];
      },
      onAction(action) {
        if (action === 'obj_barn_build_' + entry.id) {
          if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can do that." };
          if (entry.stage !== 'foundation') return { ok: false, message: 'Already built.' };
          entry.stage = 'built';
          _disposeMesh(entry._mesh); entry._mesh = null;
          _buildStructureMesh(entry);
          deps.saveFarmLayout();
          return { ok: true, message: `🔨 ${label(entry)} construction complete!` };
        }
        if (action === 'obj_barn_demolish_' + entry.id) {
          if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can do that." };
          return demolish(entry.id);
        }
        if (action === 'obj_barn_manage_' + entry.id) {
          if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
          deps.setFarmLivestockFocusBarnId(entry.id);
          deps.openMenu('farm');
          return { ok: true, message: 'Opened the Farm tab’s Livestock panel.' };
        }
        if (action === 'obj_barn_enter_' + entry.id) {
          if (entry.stage !== 'built') return { ok: false, message: 'Build the barn first.' };
          deps.enterBuilding('map_i_barn_' + entry.id);
          return { ok: true, message: `Entered the ${label(entry)}.` };
        }
        return { ok: false, message: 'Unknown barn action.' };
      },
      reset() { _disposeMesh(entry._mesh); entry._mesh = null; },
    };
  }

  function spawnEntry(entry) {
    const def = _pieceDef(entry.nursery ? 'nursery' : entry.tier);
    entry.w = def.w; entry.h = def.h; // Migrates old saves and gives the permanent Nursery its dedicated 3x2 footprint.
    entry._worldObj = _makeWorldObject(entry);
    entry._mesh = entry.stage === 'built' ? null : _buildFoundationMesh(entry.col, entry.row, entry.w, entry.h);
    if (entry.stage === 'built') _buildStructureMesh(entry);
    _registerFootprint(entry);
  }

  function placePlan(tier, col, row) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can build here." };
    const tierDef = deps.getBarnTiers()[tier];
    if (!tierDef) return { ok: false, message: 'Unknown barn plan.' };
    const pieceDef = _pieceDef(tier);
    if ((deps.inventory[tierDef.planItem] || 0) < 1) return { ok: false, message: `No ${tierDef.label} plan in your bag.` };
    if (!canPlaceAt(col, row, pieceDef.w, pieceDef.h)) {
      return { ok: false, message: 'Cannot build here — needs clear, untilled, un-trenched ground.' };
    }
    deps.inventory[tierDef.planItem]--;
    deps.clampInventoryStack(tierDef.planItem);
    const entry = {
      id: 'barn_' + Math.random().toString(36).slice(2, 10),
      kind: 'barn', tier, col, row, w: pieceDef.w, h: pieceDef.h, stage: 'foundation',
    };
    deps.getFarmBuildings().push(entry);
    spawnEntry(entry);
    clearFootprint(col, row, entry.w, entry.h);
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: `Placed a ${tierDef.label} foundation. Interact with it to build.` };
  }

  function demolish(id) {
    const farmBuildings = deps.getFarmBuildings();
    const entry = farmBuildings.find(b => b.id === id);
    if (!entry) return { ok: false, message: 'Barn not found.' };
    const livestock = deps.loadWorldLivestock();
    livestock.forEach(l => {
      if (l.barnId !== id) return;
      l.barnId = null;
      l.troughIndex = null;
      if (l.kind === 'uumkaoii') {
        // Re-arm the dew cooldown so stasis genuinely pauses dew progress
        // instead of letting an already-armed drop fire the instant this
        // animal is re-housed in a new barn — see farm-animals.js's
        // unassignFromBarn for the same fix on manual unassignment.
        l.dewReady = false;
        l.dewDaysUntil = deps.UUMKAOII_DEW_COOLDOWN_DAYS;
        l.dewReadyStaleDays = 0;
      }
      const animal = [...deps.animalObjects].find(a => a.livestockId === l.id);
      if (animal) { deps.worldObjects.delete(animal.col + ',' + animal.row); deps.animalObjects.delete(animal); animal.reset && animal.reset(); }
    });
    deps.saveWorldLivestock(livestock);
    _unregisterFootprint(entry);
    _disposeMesh(entry._mesh);
    deps.setFarmBuildings(farmBuildings.filter(b => b.id !== id));
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: 'Barn demolished — its livestock are back in stasis.' };
  }

  function move(id, newCol, newRow) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can move buildings." };
    const entry = deps.getFarmBuildings().find(b => b.id === id);
    if (!entry) return { ok: false, message: 'Building not found.' };
    if (!canPlaceAt(newCol, newRow, entry.w, entry.h, entry.id)) {
      return { ok: false, message: 'Cannot move there — needs clear, untilled, un-trenched ground.' };
    }
    _unregisterFootprint(entry);
    entry.col = newCol; entry.row = newRow;
    _registerFootprint(entry);
    if (entry.stage === 'foundation' && entry._mesh) {
      entry._mesh.position.set(newCol + entry.w / 2, 0.07, newRow + entry.h / 2);
    } else if (entry.stage === 'built') {
      _disposeMesh(entry._mesh); entry._mesh = null;
      _buildStructureMesh(entry);
    }
    clearFootprint(newCol, newRow, entry.w, entry.h);
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: `Moved the ${label(entry)}.` };
  }

  function clearAll() {
    const farmBuildings = deps.getFarmBuildings();
    farmBuildings.forEach(entry => { _unregisterFootprint(entry); _disposeMesh(entry._mesh); });
    deps.setFarmBuildings([]);
  }

  function findOpenTileNear(barn) {
    for (let ring = 1; ring <= 8; ring++) {
      const rMin = barn.row - ring, rMax = barn.row + barn.h + ring - 1;
      const cMin = barn.col - ring, cMax = barn.col + barn.w + ring - 1;
      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          const onRing = r === rMin || r === rMax || c === cMin || c === cMax;
          if (!onRing || c < 0 || r < 0 || c >= deps.COLS || r >= deps.ROWS) continue;
          if (window.FarmAnimals.canSpawnAt(c, r)) return { col: c, row: r };
        }
      }
    }
    return null;
  }

  window.FarmBuildings = {
    init,
    canPlaceAt,
    clearFootprint,
    label,
    spawnEntry,
    placePlan,
    demolish,
    move,
    clearAll,
    findOpenTileNear,
    pieceDefForTier: tier => ({ ..._pieceDef(tier) }),
    BARN_PIECES,
  };
})();

(() => {
  'use strict';

  // Nursery baby presentation override. The original Nursery lifecycle keeps
  // authoritative save/sample behavior in farm-troughs.js; this layer replaces
  // only its flat visual stand-ins with the same rigged animal avatar path used
  // by adult livestock, so movement frames and authored head rigs remain shared.
  const NURSERY_MAP_ID = 'map_i_barn_farm_nursery';
  const BABY_SCALE = 0.25;
  const VISIBLE_LIMIT = 12;
  const BABY_SPEED_MULTIPLIER = 1.5; // Requested: babies move fifty percent faster than the first Nursery swarm tuning.
  const TURN_MIN_SEC = 0.12;
  const TURN_MAX_SEC = 0.42;
  const HOP_MIN_HZ = 3.2;
  const HOP_MAX_HZ = 5.4;
  const HOP_MIN_HEIGHT = 0.10;
  const HOP_MAX_HEIGHT = 0.24;
  const FRAME_MIN_SEC = 0.075;
  const FRAME_MAX_SEC = 0.115;

  let animalDeps = null; // Captures the existing FarmAnimals dependency seam so genotype/player-face data stay authoritative.
  let installed = false;
  let insideLastFrame = false;
  let generation = 0;
  let building = false;
  let agents = [];
  let selectedIds = [];
  let lastMotionFrameAt = -Infinity;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const angleDiff = (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const randomBetween = (min, max) => min + Math.random() * (max - min);

  function currentArea() {
    return window.Combat?.deps?.getCurrentArea?.()
      || animalDeps?.getCurrentArea?.()
      || window.__hobunjiFurnitureDebug?.getCurrentArea?.()
      || null;
  }

  function activeScene() {
    return window.Combat?.deps?.getActiveScene?.() || null;
  }

  function isBaby(entry) {
    if (!entry) return false;
    if (entry.lifeStage === 'baby') return true;
    if (entry.lifeStage === 'adult') return false;
    return Object.prototype.hasOwnProperty.call(entry, 'barnId') && entry.barnId == null;
  }

  function babies() {
    return (animalDeps?.loadWorldLivestock?.() || []).filter(isBaby);
  }

  function nurseryBounds() {
    const nursery = window.LivestockNursery?.debugSnapshot?.().nursery;
    return {
      cols: Math.max(6, (Number(nursery?.w) || 3) * 2),
      rows: Math.max(5, (Number(nursery?.h) || 2) * 2),
    };
  }

  function playerFaceTarget() {
    const authored = animalDeps?.getPlayerFaceTarget?.();
    if (authored) {
      const z = Number.isFinite(Number(authored.z)) ? Number(authored.z) : Number(authored.y);
      return { x: Number(authored.x), z, worldY: Number(authored.worldY) };
    }
    const combatDeps = window.Combat?.deps;
    const player = combatDeps?.player || animalDeps?.player;
    const tile = Number(combatDeps?.TILE || animalDeps?.TILE) || 1;
    if (!player) return null;
    return {
      x: (Number(player.x) || 0) / tile,
      z: (Number(player.y) || 0) / tile,
      worldY: Number(player.worldY ?? player.headWorldY ?? 0.9),
    };
  }

  function playerGroundPoint() {
    const face = playerFaceTarget();
    if (face && Number.isFinite(face.x) && Number.isFinite(face.z)) return face;
    return { x: 3, z: 2.5, worldY: 0.9 };
  }

  function hideLegacyFlatBabies(scene) {
    if (!scene?.traverse) return;
    scene.traverse(object => {
      const name = String(object?.name || '');
      if (name.startsWith('nursery_baby_') && !name.startsWith('nursery_baby_rig_')) object.visible = false;
    });
  }

  function shuffledSample(entries, count) {
    const copy = entries.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const swap = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[swap]] = [copy[swap], copy[i]];
    }
    return copy.slice(0, count);
  }

  function texturePairFromCanvas(THREE_NS, canvas, name) {
    if (!canvas) return null;
    const front = new THREE_NS.CanvasTexture(canvas);
    const back = new THREE_NS.CanvasTexture(canvas);
    if ('colorSpace' in front && THREE_NS.SRGBColorSpace) {
      front.colorSpace = THREE_NS.SRGBColorSpace;
      back.colorSpace = THREE_NS.SRGBColorSpace;
    }
    back.wrapS = THREE_NS.RepeatWrapping;
    back.repeat.set(-1, 1);
    back.offset.set(1, 0);
    front.name = `${name}_front`;
    back.name = `${name}_back`;
    front.needsUpdate = true;
    back.needsUpdate = true;
    return { front, back };
  }

  function applyTexturePair(agent, pair) {
    if (!agent?.avatarRef?.group || !pair) return;
    agent.avatarRef.group.traverse(child => {
      if (!child?.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        if (String(child.name || '').endsWith('_front_plane')) {
          material.map = pair.front;
          material.needsUpdate = true;
        } else if (String(child.name || '').endsWith('_back_plane')) {
          material.map = pair.back;
          material.needsUpdate = true;
        }
      }
    });
  }

  async function prepareAnimationFrames(agent, entry, token) {
    const renderer = window.CreatureGeneticsRender;
    const THREE_NS = window.THREE || (typeof THREE !== 'undefined' ? THREE : null);
    if (!renderer?.composeFrame || !THREE_NS || !entry?.genotype) return;
    const frameNames = ['idle', 'run1', 'run2'];
    try {
      const canvases = await Promise.all(frameNames.map(frame => renderer.composeFrame(entry.kind, frame, entry.genotype, false)));
      if (token !== generation || !agents.includes(agent)) return;
      const frames = {};
      frameNames.forEach((frame, index) => { frames[frame] = texturePairFromCanvas(THREE_NS, canvases[index], `nursery_${entry.id}_${frame}`); });
      agent.frames = frames;
      agent.frameName = 'run1';
      applyTexturePair(agent, frames.run1 || frames.idle);
    } catch (error) {
      console.warn('[Nursery] baby animation compose failed:', entry.kind, error);
    }
  }

  function disposeAgent(agent) {
    if (!agent) return;
    agent.avatarRef?.group?.parent?.remove?.(agent.avatarRef.group);
    try { agent.avatarRef?.dispose?.(); } catch (_) {}
    const textures = new Set();
    for (const pair of Object.values(agent.frames || {})) {
      if (pair?.front) textures.add(pair.front);
      if (pair?.back) textures.add(pair.back);
    }
    for (const texture of textures) texture.dispose?.();
  }

  function clearAgents() {
    generation++;
    building = false;
    for (const agent of agents) disposeAgent(agent);
    agents = [];
    selectedIds = [];
  }

  function retarget(agent, immediate = false) {
    const { cols, rows } = nurseryBounds();
    const player = playerGroundPoint();
    // Hyper babies repeatedly choose a new point close to the player rather
    // than orbiting one smooth target for seconds at a time.
    const angle = Math.random() * Math.PI * 2;
    const radius = randomBetween(0.18, 1.05);
    agent.targetX = clamp(player.x + Math.cos(angle) * radius, 0.45, cols - 0.45);
    agent.targetZ = clamp(player.z + Math.sin(angle) * radius, 0.45, rows - 0.45);
    agent.turnTimer = immediate ? 0 : randomBetween(TURN_MIN_SEC, TURN_MAX_SEC);
  }

  function createRiggedAgent(entry, scene, token) {
    const THREE_NS = window.THREE || (typeof THREE !== 'undefined' ? THREE : null);
    const renderer = window.CreatureGeneticsRender;
    const avatarApi = window.PNGPlaneAvatar;
    if (!THREE_NS || !renderer || !avatarApi?.buildAnimalPlaneAvatarModel || token !== generation) return null;
    const spec = renderer.SPECIES?.[entry.kind];
    const idleUrl = spec?.base?.idle;
    if (!idleUrl) return null;

    const speciesDef = animalDeps?.CREATURE_DB?.[entry.kind] || {};
    const configuredWidths = window.SCRATCHBONES_CONFIG?.game?.livestock?.animalWidths || {};
    const adultWidth = entry.kind === 'uumkaoii' ? 1.275 : (Number(configuredWidths[entry.kind]) || 1.7);
    const spriteAspect = Number(speciesDef.spriteAspect) || (600 / 1375);
    const sizeScale = window.CreatureGenetics?.creatureSizeScale?.(entry.kind, entry.genotype) || { x: 1, y: 1 };
    const modelWidth = adultWidth * BABY_SCALE;
    const modelHeight = adultWidth * spriteAspect * BABY_SCALE;
    const avatarRef = avatarApi.buildAnimalPlaneAvatarModel(THREE_NS, idleUrl, {
      modelWidth,
      modelHeight,
      name: `nursery_baby_rig_${entry.id}`,
      creatureId: entry.kind,
      headRig: renderer.headRigForKind?.(entry.kind) || undefined,
    });
    if (!avatarRef?.group) return null;
    avatarRef.group.name = `nursery_baby_rig_${entry.id}`;
    window.CreatureGenetics?.applyCreatureBillboardScale?.(avatarRef.group, sizeScale);

    const { cols, rows } = nurseryBounds();
    const authoredGroundOffset = window.CreatureGenetics?.creatureGroundOffset?.(entry.kind, entry.genotype);
    const automaticGround = modelHeight * (Number(sizeScale.y) || 1) / 2;
    const baseY = Number.isFinite(authoredGroundOffset)
      ? Math.max(0.03, authoredGroundOffset * BABY_SCALE * (Number(sizeScale.y) || 1))
      : Math.max(0.03, automaticGround);
    const agent = {
      id: entry.id,
      kind: entry.kind,
      genotype: entry.genotype,
      avatarRef,
      wx: 0.65 + Math.random() * Math.max(0.2, cols - 1.3),
      wz: 0.65 + Math.random() * Math.max(0.2, rows - 1.3),
      wy: baseY,
      baseY,
      speed: randomBetween(1.15, 2.0) * BABY_SPEED_MULTIPLIER,
      targetX: 0,
      targetZ: 0,
      turnTimer: 0,
      hopPhase: Math.random() * Math.PI,
      hopHz: randomBetween(HOP_MIN_HZ, HOP_MAX_HZ),
      hopHeight: randomBetween(HOP_MIN_HEIGHT, HOP_MAX_HEIGHT),
      animTimer: randomBetween(FRAME_MIN_SEC, FRAME_MAX_SEC),
      framePeriod: randomBetween(FRAME_MIN_SEC, FRAME_MAX_SEC),
      frameName: 'idle',
      frames: {},
      groupRot: Math.random() * Math.PI * 2,
    };
    avatarRef.group.position.set(agent.wx, agent.wy, agent.wz);
    avatarRef.group.rotation.y = agent.groupRot;
    scene.add(avatarRef.group);
    retarget(agent);
    prepareAnimationFrames(agent, entry, token);
    return agent;
  }

  function buildAgents() {
    if (building || agents.length || currentArea() !== NURSERY_MAP_ID) return;
    const scene = activeScene();
    if (!scene) return;
    const list = babies();
    if (!list.length) return;
    building = true;
    const token = ++generation;
    const sample = shuffledSample(list, Math.min(VISIBLE_LIMIT, list.length));
    selectedIds = sample.map(entry => entry.id);
    const made = sample.map(entry => createRiggedAgent(entry, scene, token)).filter(Boolean);
    if (token !== generation || currentArea() !== NURSERY_MAP_ID) {
      made.forEach(disposeAgent);
      building = false;
      return;
    }
    agents = made;
    building = false;
  }

  function trackPlayerHead(agent, dt) {
    const target = playerFaceTarget();
    if (!target || !Number.isFinite(target.worldY) || typeof agent.avatarRef?.updateHeadRotation !== 'function') return;
    const headWorldY = window.CreatureHeadCache?.getHeadWorld?.(agent, 'animal')?.worldY
      ?? (agent.avatarRef.group.position.y + 0.18);
    const horizontal = Math.max(0.15, Math.hypot(target.x - agent.wx, target.z - agent.wz));
    // Shared animal head-rig convention: negative degrees look up, positive look down.
    const pitchDeg = -Math.atan2(target.worldY - headWorldY, horizontal) * 180 / Math.PI;
    agent.avatarRef.updateHeadRotation(pitchDeg, dt);
  }

  function updateAnimation(agent, moving, dt) {
    if (!agent.frames || (!agent.frames.run1 && !agent.frames.run2)) return;
    agent.animTimer -= dt;
    if (agent.animTimer > 0) return;
    agent.animTimer = agent.framePeriod;
    let next = 'idle';
    if (moving) next = agent.frameName === 'run1' ? 'run2' : 'run1';
    if (next === agent.frameName) return;
    agent.frameName = next;
    applyTexturePair(agent, agent.frames[next] || agent.frames.idle);
  }

  function updateAgent(agent, dt) {
    const { cols, rows } = nurseryBounds();
    agent.turnTimer -= dt;
    let dx = agent.targetX - agent.wx;
    let dz = agent.targetZ - agent.wz;
    let distance = Math.hypot(dx, dz);
    if (agent.turnTimer <= 0 || distance < 0.09) {
      retarget(agent);
      dx = agent.targetX - agent.wx;
      dz = agent.targetZ - agent.wz;
      distance = Math.hypot(dx, dz);
    }

    const moving = distance > 0.004;
    if (moving) {
      const step = Math.min(distance, agent.speed * dt);
      const vx = dx / distance;
      const vz = dz / distance;
      agent.wx = clamp(agent.wx + vx * step, 0.42, cols - 0.42);
      agent.wz = clamp(agent.wz + vz * step, 0.42, rows - 0.42);
      // Same movement-facing convention as adult livestock. The old Nursery
      // prototype used a different atan2 ordering, which made several species
      // visibly travel backwards relative to their painted sprite.
      const targetRot = -Math.atan2(vz, vx) + Math.PI / 2;
      agent.groupRot += angleDiff(targetRot, agent.groupRot) * Math.min(1, dt * 22);
    }

    agent.hopPhase += dt * Math.PI * 2 * agent.hopHz;
    const hop = Math.abs(Math.sin(agent.hopPhase)) * agent.hopHeight;
    agent.wy = agent.baseY + hop;
    agent.avatarRef.group.position.set(agent.wx, agent.wy, agent.wz);
    agent.avatarRef.group.rotation.y = agent.groupRot;
    trackPlayerHead(agent, dt);
    updateAnimation(agent, moving, dt);
  }

  function updateRiggedNurseryBabies(dt) {
    const scene = activeScene();
    if (scene) hideLegacyFlatBabies(scene);
    const inside = currentArea() === NURSERY_MAP_ID;
    if (!inside) {
      if (insideLastFrame || agents.length || building) clearAgents();
      insideLastFrame = false;
      return;
    }

    insideLastFrame = true;
    if (!agents.length && !building) buildAgents();
    const liveBabyIds = new Set(babies().map(entry => entry.id));
    const survivors = [];
    for (const agent of agents) {
      if (!liveBabyIds.has(agent.id)) { disposeAgent(agent); continue; }
      updateAgent(agent, dt);
      survivors.push(agent);
    }
    agents = survivors;
  }

  function installMotionHook() {
    if (installed || !animalDeps || !window.FarmAnimals?.updateAnimalMeshes) return;
    installed = true;
    const api = window.FarmAnimals;
    const originalUpdate = api.updateAnimalMeshes.bind(api);
    api.updateAnimalMeshes = function nurseryHyperBabyVisualUpdate(dt) {
      const result = originalUpdate(dt);
      const now = performance.now();
      // Avoid double-stepping if both the legacy game loop and Nursery-only
      // loop happen to call the same public updater during one render frame.
      if (now - lastMotionFrameAt >= 4) {
        lastMotionFrameAt = now;
        updateRiggedNurseryBabies(Math.max(0, Math.min(0.05, Number(dt) || 0)));
      } else {
        const scene = activeScene();
        if (scene) hideLegacyFlatBabies(scene);
      }
      return result;
    };
    api.__nurseryHyperBabyVisuals = true;
    window.__nurseryBabyMotionDebug = {
      speedMultiplier: BABY_SPEED_MULTIPLIER,
      visibleIds: () => agents.map(agent => agent.id),
      reroll() { clearAgents(); if (currentArea() === NURSERY_MAP_ID) buildAgents(); },
    };
  }

  const farmAnimals = window.FarmAnimals;
  if (farmAnimals?.init && !farmAnimals.init.__nurseryHyperBabyInitHook) {
    const originalInit = farmAnimals.init;
    const wrappedInit = function nurseryHyperBabyInit(injectedDeps) {
      animalDeps = injectedDeps;
      const result = originalInit.call(this, injectedDeps);
      // farm-troughs.js wraps FarmAnimals.init after this file loads. Delaying
      // one microtask means we wrap its final Nursery updater rather than being
      // overwritten by the lifecycle install that occurs on this same stack.
      queueMicrotask(installMotionHook);
      return result;
    };
    wrappedInit.__nurseryHyperBabyInitHook = true;
    farmAnimals.init = wrappedInit;
  }
})();