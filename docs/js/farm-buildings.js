(() => {
  'use strict';

  // Farm buildings: barns (movable, buildable via the Farm tab). Barn visuals
  // are authored house-piece JSONs, one per tier; the player's modular house
  // remains owned by HousePieces. This module intentionally owns barn-specific
  // asset readiness, placement footprints, world registration, and livestock
  // proximity so those concerns stay out of game.js.
  const BARN_PIECES = {
    small:  { file: 'config/pieces/barn-small.json',  w: 4, h: 3 },
    medium: { file: 'config/pieces/barn-medium.json', w: 4, h: 5 },
    large:  { file: 'config/pieces/barn-large.json',  w: 6, h: 5 },
  };

  let deps = null, blockedTileTypes;
  let _sharedFarmStructureAssetPromise = null; // Used to make the real brick/shingle upgrade one shared readiness boundary for barns and the player house.

  function _pieceDef(tier) { return BARN_PIECES[tier] || BARN_PIECES.small; }

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

  // Each barn tier has its own authored piece and cache. The three supplied
  // v37 pieces share the Highland visual language but intentionally differ
  // in footprint: Small 4x3, Medium 4x5, Large 6x5.
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
    _loadBarnPiece(entry.tier).then(piece => {
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
    const def = _pieceDef(entry.tier);
    entry.w = def.w; entry.h = def.h; // Migrates old saves from the retired universal 7x3 barn footprint.
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
