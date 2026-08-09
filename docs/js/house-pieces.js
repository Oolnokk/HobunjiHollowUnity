(() => {
  'use strict';

  // Modular player house: a growing cluster of authored "house piece" JSON
  // structures — the exact same config/pieces/*.json format + HousePieceGen.js
  // renderer already used for barns (js/farm-buildings.js) and NPC/town
  // buildings — replacing the old singular Highland House GLB.
  //
  // The farm always starts with one 'starter' piece (seeded for free at farm
  // init, stage 'built' immediately, matching the old Highland House's
  // footprint via config/pieces/house-section-5x4.json). Additional pieces
  // are bought as deeds from the Carpenter (see HOUSE_PIECE_CATALOG in
  // game.js), placed
  // touching the existing cluster, then built via an in-world interact-to-
  // build step — the same foundation->built staging farm-buildings.js uses
  // for barns, which this module closely mirrors.
  //
  // All built pieces share ONE continuous interior (see game.js's
  // rebuildInteriorGeometry()): every piece contributes a 2x2-interior-cell
  // block per exterior farm tile, anchored directly at (farmCol*2, farmRow*2)
  // — the interior grid is just the farm grid at 2x resolution, so no
  // separate per-house coordinate origin bookkeeping is needed. Each piece's
  // authored door (resolved via BuildingDoor, docs/js/building-door.js)
  // punches a 3-interior-cell-wide exit threshold through the boundary wall
  // on whichever farm-tile side it faces — the same convention proven by the
  // reference modular-farmhouse join demo's entranceNubCells().
  //
  // Furniture is not piece-owned data — demolish() locates furniture inside
  // a piece's own doubled interior cell block purely by position and hands
  // it to deps.recoverFurnitureInInteriorRect(), which refunds it to the
  // farm's storage box (the same _loadWorldStorage/_saveWorldStorage system
  // the Farm tab's Storage pane already uses) rather than any new UI.
  //
  // Pieces are always placed unrotated (rotationDeg 0) in this pass — no
  // in-world rotate-before-place control — keeping canPlaceAt/footprint math
  // simple. Nothing here stops a future pass from adding it.
  let deps = null;
  let blockedTileTypes;
  function init(injectedDeps) {
    deps = injectedDeps;
    blockedTileTypes = new Set([
      deps.TileType.TRENCH, deps.TileType.TILLED, deps.TileType.RAISED, deps.TileType.PADDY,
      deps.TileType.RIVER, deps.TileType.STREAM, deps.TileType.WATERFALL, deps.TileType.RAMP,
    ]);
  }

  function rectsOverlap(aCol, aRow, aW, aH, bCol, bRow, bW, bH) {
    return aCol < bCol + bW && aCol + aW > bCol && aRow < bRow + bH && aRow + aH > bRow;
  }
  // Shares a horizontal or vertical edge with a nonzero overlap run — a bare
  // corner touch doesn't count (the two rooms would still be sealed off from
  // each other in the merged interior, since floor-cell adjacency is what
  // actually determines whether InteriorSceneBuilder omits a wall).
  function rectsAdjacent(aCol, aRow, aW, aH, bCol, bRow, bW, bH) {
    const vertical   = (aCol + aW === bCol || bCol + bW === aCol) && aRow < bRow + bH && aRow + aH > bRow;
    const horizontal = (aRow + aH === bRow || bRow + bH === aRow) && aCol < bCol + bW && aCol + aW > bCol;
    return vertical || horizontal;
  }

  // In bounds, no trench/tilled/raised/paddy/water tile or crop, no other
  // world object in the footprint, no overlap with a barn — shared by both
  // a brand-new piece placement and a whole-house move (moveHouse below),
  // which additionally needs to skip the piece-vs-piece/adjacency checks
  // since every piece moves together and their relative arrangement (already
  // valid) doesn't change.
  function _footprintClearOfHazardsAndBarns(col, row, w, h) {
    if (!Number.isFinite(col) || !Number.isFinite(row)) return false;
    if (col < 0 || row < 0 || col + w > deps.COLS || row + h > deps.ROWS) return false;
    const grid = deps.getGrid();
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        const tile = grid[r]?.[c];
        if (!tile || blockedTileTypes.has(tile.type) || tile.crop) return false;
        if (deps.worldObjects.get(c + ',' + r)) return false;
      }
    }
    for (const b of deps.getFarmBuildings()) {
      if (rectsOverlap(col, row, w, h, b.col, b.row, b.w, b.h)) return false;
    }
    return true;
  }

  // In bounds, no trench/tilled/raised/paddy/water tile or crop, no other
  // world object in the footprint, no overlap with another house piece or a
  // barn, and — unless this is the very first piece ever placed — must touch
  // an already-placed piece along a real edge.
  function canPlaceAt(col, row, w, h) {
    if (!_footprintClearOfHazardsAndBarns(col, row, w, h)) return false;
    const pieces = deps.getHousePieces();
    for (const b of pieces) {
      if (rectsOverlap(col, row, w, h, b.col, b.row, b.w, b.h)) return false;
    }
    if (pieces.length && !pieces.some(b => rectsAdjacent(col, row, w, h, b.col, b.row, b.w, b.h))) return false;
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

  // ── Piece JSON + face-texture caches ────────────────────────────────
  const _piecePromises = new Map();
  function _loadPiece(file) {
    if (!_piecePromises.has(file)) {
      _piecePromises.set(file, fetch(file).then(r => r.json())
        .catch(e => { deps.debugLog('House piece load error: ' + e, 'warn'); return null; }));
    }
    return _piecePromises.get(file);
  }
  let _boardsMat = null, _stoneMat = null, _canvasMat = null;
  function _faceMats() {
    if (!_boardsMat) {
      _boardsMat = deps.loadHousePieceFaceTexture('assets/textures/boards.png', 0x8b6914, 1.2);
      _stoneMat  = deps.loadHousePieceFaceTexture('assets/textures/carved_smooth.png', 0x888888, 1.5, '#4d4d4d');
      _canvasMat = deps.loadHousePieceFaceTexture('assets/textures/canvas.png', 0xcbb489, 2);
    }
    return { matBoards: _boardsMat, matStone: _stoneMat, matCanvas: _canvasMat };
  }
  const _wbDefaults = { unitMult: 0.4375, rockScale: 1.5, preScale: [1, 1, 0.6],
                         brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };

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

  // Whether world (col,row) falls inside some OTHER piece's own footprint —
  // used to detect a door that's been walled off by a piece attached
  // directly against it (see _registerDoor/computeInteriorLayout below).
  function tileInsideAnyOtherPiece(selfId, col, row) {
    return deps.getHousePieces().some(e => e.id !== selfId && col >= e.col && col < e.col + e.w && row >= e.row && row < e.row + e.h);
  }

  // Where a piece's door would sit if it opened through a given side of its
  // own footprint, one tile outside the wall, centered on that side (no
  // rotation — house pieces are always placed unrotated in this pass).
  const DOOR_SIDE_ORDER = ['south', 'east', 'west', 'north'];
  function _doorTileForSide(entry, side) {
    switch (side) {
      case 'south': return { col: entry.col + Math.floor(entry.w / 2), row: entry.row + entry.h };
      case 'north': return { col: entry.col + Math.floor(entry.w / 2), row: entry.row - 1 };
      case 'east':  return { col: entry.col + entry.w, row: entry.row + Math.floor(entry.h / 2) };
      case 'west':  return { col: entry.col - 1, row: entry.row + Math.floor(entry.h / 2) };
      default: return null;
    }
  }
  function _doorSideBlocked(entry, col, row) {
    if (col < 0 || row < 0 || col >= deps.COLS || row >= deps.ROWS) return true;
    if (tileInsideAnyOtherPiece(entry.id, col, row)) return true;
    const occupant = deps.worldObjects.get(col + ',' + row);
    if (occupant && occupant !== entry._worldObj) return true;
    return false;
  }
  // Automatic (no authored footprint.door) entrance placement is biased
  // toward the south face — matching the old single-answer south-only
  // fallback every piece used to get from BuildingDoor.doorWorldFromBuilding
  // — but tries east/west/north in turn if south is blocked (typically by a
  // neighboring piece placed against that edge), so an automatic piece still
  // gets a usable door instead of silently losing its entrance (see
  // _registerDoor, which no-ops when the resolved door tile falls inside
  // another piece's footprint). Falls back to south (registering nothing,
  // same as before) only if every side is blocked.
  function _deriveSouthBiasedDoor(entry) {
    for (const side of DOOR_SIDE_ORDER) {
      const tile = _doorTileForSide(entry, side);
      if (tile && !_doorSideBlocked(entry, tile.col, tile.row)) return { col: tile.col, row: tile.row, side };
    }
    const fallback = _doorTileForSide(entry, 'south');
    return fallback ? { col: fallback.col, row: fallback.row, side: 'south' } : null;
  }

  // Resolves a piece's single authored door (footprint.door, or the
  // porch/south-edge geometric fallback) through this entry's placement into
  // a world farm tile + which side of the footprint it opens through. Pieces
  // with no authored door (footprint.door === null) use the south-biased
  // multi-side trial above instead, since BuildingDoor's own south-only
  // fallback has no concept of an attached neighbor blocking that edge.
  function resolvePieceDoor(piece, entry) {
    if (!window.BuildingDoor) return null;
    const normalized = window.BuildingDoor.normalizePieceData(piece);
    if (!normalized?.footprint?.door) return _deriveSouthBiasedDoor(entry);
    let doorEnt = window.BuildingDoor.resolveDoorEntrance(piece);
    // Some catalog pieces can carry a stale footprint.door authored before
    // this piece existed in its current footprint — resolveDoorEntrance
    // trusts it blindly, producing
    // a cell outside the piece's own normalized bbox. Fall back to the pure
    // geometric porch/south-edge heuristic (deriveDoorLocal, ignoring the
    // bogus authored point) whenever that happens.
    if (doorEnt && doorEnt.cells?.[0]) {
      const c = doorEnt.cells[0];
      if (c.x < 0 || c.x >= doorEnt.bboxW || c.y < 0 || c.y >= doorEnt.bboxD) {
        doorEnt = window.BuildingDoor.deriveDoorLocal(piece);
      }
    }
    if (!doorEnt) return null;
    const world = window.BuildingDoor.doorWorldFromBuilding(doorEnt, entry.col, entry.row, 0, deps.ROWS - 1);
    if (!world) return null;
    const { col, row } = world;
    let side;
    if (row < entry.row) side = 'north';
    else if (row >= entry.row + entry.h) side = 'south';
    else if (col < entry.col) side = 'west';
    else if (col >= entry.col + entry.w) side = 'east';
    else {
      // Authored door resolved inside the piece's own bbox (e.g. a porch
      // cell tucked against the wall rather than projecting past it) —
      // fall back to whichever edge it's nearest.
      const distN = row - entry.row, distS = (entry.row + entry.h - 1) - row;
      const distW = col - entry.col, distE = (entry.col + entry.w - 1) - col;
      const min = Math.min(distN, distS, distW, distE);
      side = min === distN ? 'north' : min === distS ? 'south' : min === distW ? 'west' : 'east';
    }
    return { col, row, side };
  }

  function _buildStructureMesh(entry) {
    const def = deps.getPieceCatalog()[entry.pieceKey];
    if (!def || typeof HousePieceGen === 'undefined') { deps.debugLog('HousePieceGen not loaded — house piece shown as foundation slab', 'warn'); return; }
    _loadPiece(def.pieceFile).then(piece => {
      if (!piece || entry.stage !== 'built' || !deps.getHousePieces().includes(entry)) return;
      _disposeMesh(entry._mesh);
      entry._doorWorld = resolvePieceDoor(piece, entry);
      // A piece with no authored footprint.door (the south-biased automatic
      // case — see resolvePieceDoor) has one uncut, full-length wall face
      // per side and nothing visually open where the door tile lets you
      // walk through. Cut a real portal into that side's wall — matching
      // the reference modular-farmhouse demo's addWallWithEntrances() — and
      // build the same demo's little entry-tunnel jamb/lintel/roof-cap
      // structure over the opening. Authored pieces (town/NPC buildings)
      // already have this baked into their own JSON at authoring time, so
      // this is skipped whenever footprint.door is set.
      const normalized = window.BuildingDoor?.normalizePieceData(piece);
      const hasAuthoredDoor = !!normalized?.footprint?.door;
      let buildPiece = piece;
      if (!hasAuthoredDoor && entry._doorWorld) {
        const { side, col, row } = entry._doorWorld;
        const idx = (side === 'south' || side === 'north') ? col - entry.col : row - entry.row;
        const len = (side === 'south' || side === 'north') ? entry.w : entry.h;
        buildPiece = HousePieceGen.cutDoorPortal(piece, side, idx, len);
      }
      entry._mesh = HousePieceGen.buildGroupFromPiece(THREE, buildPiece, entry.col, entry.row, {
        wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _wbDefaults,
        ..._faceMats(),
      });
      if (!hasAuthoredDoor && entry._doorWorld) {
        const wallTile = _doorWallTile(entry._doorWorld);
        const tunnel = HousePieceGen.buildEntryTunnelGroup(THREE, wallTile.col, wallTile.row, entry._doorWorld.side, {
          wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _wbDefaults,
          ..._faceMats(),
        });
        entry._mesh.add(tunnel);
      }
      deps.scene.add(entry._mesh);
      _registerDoor(entry);
      deps.onPieceGeometryChanged();
      // The real shingle GLB may still be loading (a cached singleton
      // kicked off once at startup — see game.js) — the roof above just
      // rendered with the tube-mesh fallback in that case. Rebuild once
      // real shingles are ready so the roof doesn't stay stuck on it.
      if (!HousePieceGen.shingleReady()) {
        HousePieceGen.loadShingleGlb('assets/models/').then(() => {
          if (entry.stage === 'built' && deps.getHousePieces().includes(entry)) _buildStructureMesh(entry);
        }).catch(() => {});
      }
    }).catch(err => deps.debugLog(`House piece build error (${entry.id}): ${err?.message || err}`, 'warn'));
  }

  function label(entry) {
    return entry.pieceKey === 'starter' ? 'House' : (deps.getPieceCatalog()[entry.pieceKey]?.label || 'House Wing');
  }

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

  // A door's world tile is usually just outside its own piece's footprint
  // (the same convention the old hardcoded DOOR_COL/DOOR_ROW used), but a
  // porch-authored piece (e.g. generic-house-medium.json) can resolve its
  // door to a tile that's already INSIDE its own footprint — that tile's
  // generic footprint marker is deliberately overwritten with the door
  // object below, since triggering Enter there is strictly more useful than
  // the inert "you're standing on part of the house" marker it replaces.
  // Registered on its own so it's approachable/interactable like any other
  // world object (crates, barns) via the reticle, not by literally standing
  // on it. If a later-built neighboring piece ends up sitting directly on
  // this door's outward tile, the door is silently left unregistered rather
  // than blocking that placement — the merged interior still reaches this
  // piece fine through whichever shared edge it was attached on, it just
  // loses its own separate farm-side entrance.
  function _registerDoor(entry) {
    _unregisterDoor(entry);
    if (!entry._doorWorld) return;
    const { col, row } = entry._doorWorld;
    if (tileInsideAnyOtherPiece(entry.id, col, row)) return;
    const occupant = deps.worldObjects.get(col + ',' + row);
    if (occupant && occupant !== entry._worldObj) return;
    const doorObj = {
      id: 'house_entrance_' + entry.id, type: 'house_entrance', col, row,
      getButtons() { return [{ icon: '🚪', label: 'Enter', action: 'obj_enter_house', style: 'primary', allowed: true }]; },
      onAction(action) {
        if (action === 'obj_enter_house') {
          deps.startSceneTransition(() => deps.enterInterior(entry.id));
          return { ok: true, message: 'Entering the house…' };
        }
        return { ok: false, message: 'Unknown house action.' };
      },
    };
    entry._doorObj = doorObj;
    entry._doorKey = col + ',' + row;
    deps.worldObjects.set(entry._doorKey, doorObj);
  }
  function _unregisterDoor(entry) {
    if (entry._doorObj && deps.worldObjects.get(entry._doorKey) === entry._doorObj) deps.worldObjects.delete(entry._doorKey);
    entry._doorObj = null; entry._doorKey = null;
  }

  function _makeWorldObject(entry) {
    return {
      id: entry.id, type: 'house_piece', kind: 'house_piece',
      get col() { return entry.col; }, get row() { return entry.row; },
      get label() { return '🏠 ' + label(entry); },
      getButtons() {
        if (entry.stage === 'foundation') {
          return [
            { icon: '🔨', label: 'Build ' + label(entry), action: 'obj_house_build_' + entry.id, style: 'primary', allowed: deps.hasFarmPermission('alterFarm') },
            { icon: '💥', label: 'Demolish', action: 'obj_house_demolish_' + entry.id, style: 'secondary', allowed: deps.hasFarmPermission('alterFarm') },
          ];
        }
        if (entry.pieceKey === 'starter') return [];
        return [{ icon: '💥', label: 'Demolish', action: 'obj_house_demolish_' + entry.id, style: 'secondary', allowed: deps.hasFarmPermission('alterFarm') }];
      },
      onAction(action) {
        if (action === 'obj_house_build_' + entry.id) {
          if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can do that." };
          if (entry.stage !== 'foundation') return { ok: false, message: 'Already built.' };
          entry.stage = 'built';
          _disposeMesh(entry._mesh); entry._mesh = null;
          _buildStructureMesh(entry);
          deps.saveFarmLayout();
          return { ok: true, message: `🔨 ${label(entry)} construction complete!` };
        }
        if (action === 'obj_house_demolish_' + entry.id) {
          if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can do that." };
          return demolish(entry.id);
        }
        return { ok: false, message: 'Unknown house action.' };
      },
      reset() { _disposeMesh(entry._mesh); entry._mesh = null; },
    };
  }

  function spawnEntry(entry) {
    entry._worldObj = _makeWorldObject(entry);
    entry._mesh = entry.stage === 'built' ? null : _buildFoundationMesh(entry.col, entry.row, entry.w, entry.h);
    if (entry.stage === 'built') _buildStructureMesh(entry);
    _registerFootprint(entry);
  }

  // Seeds the always-present starter piece — free, built immediately, no
  // foundation step (it's given, not bought). Called once per fresh farm.
  function seedStarter(col, row) {
    const entry = { id: 'house_starter', pieceKey: 'starter', col, row,
                     w: deps.getPieceCatalog().starter.w, h: deps.getPieceCatalog().starter.h, stage: 'built' };
    deps.getHousePieces().push(entry);
    spawnEntry(entry);
    return entry;
  }

  function placeDeed(pieceKey, col, row) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can build here." };
    const def = deps.getPieceCatalog()[pieceKey];
    if (!def || !def.deedItem) return { ok: false, message: 'Unknown house deed.' };
    if ((deps.inventory[def.deedItem] || 0) < 1) return { ok: false, message: `No ${def.label} in your bag.` };
    if (!canPlaceAt(col, row, def.w, def.h)) {
      return { ok: false, message: 'Cannot build here — needs clear, untilled ground touching your house.' };
    }
    deps.inventory[def.deedItem]--;
    deps.clampInventoryStack(def.deedItem);
    const entry = { id: 'housepiece_' + Math.random().toString(36).slice(2, 10), pieceKey, col, row, w: def.w, h: def.h, stage: 'foundation' };
    deps.getHousePieces().push(entry);
    spawnEntry(entry);
    clearFootprint(col, row, entry.w, entry.h);
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: `Placed a ${def.label} foundation. Interact with it to build.` };
  }

  function demolish(id) {
    const pieces = deps.getHousePieces();
    const entry = pieces.find(p => p.id === id);
    if (!entry) return { ok: false, message: 'House piece not found.' };
    if (entry.pieceKey === 'starter') return { ok: false, message: "The original house can't be demolished." };
    const recovered = entry.stage === 'built'
      ? deps.recoverFurnitureInInteriorRect(entry.col * 2, entry.row * 2, entry.w * 2, entry.h * 2)
      : 0;
    _unregisterFootprint(entry);
    _unregisterDoor(entry);
    _disposeMesh(entry._mesh);
    deps.setHousePieces(pieces.filter(p => p.id !== id));
    deps.onPieceGeometryChanged();
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    const msg = recovered > 0
      ? `${label(entry)} demolished — ${recovered} furniture item${recovered === 1 ? '' : 's'} returned to farm storage.`
      : `${label(entry)} demolished.`;
    return { ok: true, message: msg };
  }

  // Moves the whole house cluster (every piece, starter plus any built/
  // foundation deeds) together by one rigid delta — mirrors FarmBuildings'
  // per-barn move(), just applied to every piece at once so their existing
  // relative arrangement (already valid — each piece was placed touching
  // another) never needs re-validating against itself. `newStarterCol/Row`
  // is the new position for the starter piece; every other piece keeps its
  // offset from it.
  function moveHouse(newStarterCol, newStarterRow) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can move the house." };
    const pieces = deps.getHousePieces();
    const starter = pieces.find(p => p.pieceKey === 'starter');
    if (!starter) return { ok: false, message: 'House not found.' };
    const dCol = newStarterCol - starter.col, dRow = newStarterRow - starter.row;
    if (!dCol && !dRow) return { ok: false, message: 'Already there.' };

    // Unregister every piece's footprint/door first so the hazard/barn check
    // below doesn't trip over the house's own current tiles, then validate
    // every piece's new position before touching anything else.
    pieces.forEach(p => { _unregisterFootprint(p); _unregisterDoor(p); });
    const allClear = pieces.every(p => _footprintClearOfHazardsAndBarns(p.col + dCol, p.row + dRow, p.w, p.h));
    if (!allClear) {
      pieces.forEach(p => { _registerFootprint(p); _registerDoor(p); });
      return { ok: false, message: 'Cannot move the house there — needs clear, untilled ground for every room.' };
    }

    pieces.forEach(p => { p.col += dCol; p.row += dRow; });
    pieces.forEach(p => {
      _registerFootprint(p);
      clearFootprint(p.col, p.row, p.w, p.h);
      if (p.stage === 'foundation' && p._mesh) {
        p._mesh.position.set(p.col + p.w / 2, 0.07, p.row + p.h / 2);
      } else if (p.stage === 'built') {
        _disposeMesh(p._mesh); p._mesh = null;
        _buildStructureMesh(p); // also re-resolves and re-registers this piece's door
      }
    });
    deps.onPieceGeometryChanged();
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: 'Moved the house.' };
  }

  // Moves one non-starter piece on its own (mirrors FarmBuildings' per-barn
  // move()) — the starter/main room isn't movable this way since every other
  // piece is placed relative to it; use moveHouse to reposition the whole
  // cluster instead. Still must end up touching some other piece, same rule
  // canPlaceAt enforces for a brand-new placement.
  function movePiece(id, newCol, newRow) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can move house pieces." };
    const pieces = deps.getHousePieces();
    const entry = pieces.find(p => p.id === id);
    if (!entry) return { ok: false, message: 'House piece not found.' };
    if (entry.pieceKey === 'starter') return { ok: false, message: 'Move the whole house instead of the main room on its own.' };
    if (newCol === entry.col && newRow === entry.row) return { ok: false, message: 'Already there.' };

    const others = pieces.filter(p => p.id !== id);
    if (!_footprintClearOfHazardsAndBarns(newCol, newRow, entry.w, entry.h)
      || others.some(b => rectsOverlap(newCol, newRow, entry.w, entry.h, b.col, b.row, b.w, b.h))
      || !others.some(b => rectsAdjacent(newCol, newRow, entry.w, entry.h, b.col, b.row, b.w, b.h))) {
      return { ok: false, message: 'Cannot move there — needs clear, untilled ground touching the rest of your house.' };
    }

    _unregisterFootprint(entry);
    _unregisterDoor(entry);
    entry.col = newCol; entry.row = newRow;
    _registerFootprint(entry);
    clearFootprint(entry.col, entry.row, entry.w, entry.h);
    if (entry.stage === 'foundation' && entry._mesh) {
      entry._mesh.position.set(entry.col + entry.w / 2, 0.07, entry.row + entry.h / 2);
    } else if (entry.stage === 'built') {
      _disposeMesh(entry._mesh); entry._mesh = null;
      _buildStructureMesh(entry); // also re-resolves and re-registers this piece's door
    }
    deps.onPieceGeometryChanged();
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: `Moved ${label(entry)}.` };
  }

  function clearAll() {
    const pieces = deps.getHousePieces();
    pieces.forEach(entry => { _unregisterFootprint(entry); _unregisterDoor(entry); _disposeMesh(entry._mesh); });
    deps.setHousePieces([]);
  }

  function getPieceRects() {
    return deps.getHousePieces().map(e => ({ col: e.col, row: e.row, w: e.w, h: e.h }));
  }

  // ── Merged-interior geometry ─────────────────────────────────────────
  // 3-interior-cell-wide × 1-deep threshold strip immediately outside the
  // wall tile's doubled interior block, centered on the door — the exact
  // convention proven by the reference modular-farmhouse join demo's
  // entranceNubCells(). `slot` (which of the wall tile's 2 interior
  // sub-cells the strip centers on) is fixed rather than user-chosen, since
  // every door here is auto-placed rather than manually tapped.
  function _doorWallTile(door) {
    if (door.side === 'north') return { col: door.col, row: door.row + 1 };
    if (door.side === 'south') return { col: door.col, row: door.row - 1 };
    if (door.side === 'west')  return { col: door.col + 1, row: door.row };
    return { col: door.col - 1, row: door.row };
  }
  function _doorNubCells(door) {
    const wall = _doorWallTile(door), gx = wall.col, gy = wall.row, slot = 1;
    if (door.side === 'north') { const c = gx * 2 + slot, r = gy * 2 - 1; return [-1, 0, 1].map(d => ({ c: c + d, r })); }
    if (door.side === 'south') { const c = gx * 2 + slot, r = (gy + 1) * 2; return [-1, 0, 1].map(d => ({ c: c + d, r })); }
    if (door.side === 'west')  { const r = gy * 2 + slot, c = gx * 2 - 1; return [-1, 0, 1].map(d => ({ c, r: r + d })); }
    const r = gy * 2 + slot, c = (gx + 1) * 2; return [-1, 0, 1].map(d => ({ c, r: r + d }));
  }
  // One interior cell inward from the nub's center — where the player
  // spawns when entering through this door.
  function _doorEnterCell(door) {
    const wall = _doorWallTile(door), gx = wall.col, gy = wall.row, slot = 1;
    if (door.side === 'north') return { c: gx * 2 + slot, r: gy * 2 };
    if (door.side === 'south') return { c: gx * 2 + slot, r: gy * 2 + 1 };
    if (door.side === 'west')  return { c: gx * 2, r: gy * 2 + slot };
    return { c: gx * 2 + 1, r: gy * 2 + slot };
  }

  // Returns { floorSet, exitSet, doors } for every BUILT piece — the union
  // of every piece's doubled footprint block, plus each reachable door's
  // exit-nub strip (also folded into floorSet so the threshold is walkable,
  // and into exitSet so InteriorSceneBuilder.buildWallPanels knows not to
  // wall off that opening). `doors` maps pieceId -> its interior spawn point,
  // for enterInterior(pieceId).
  function computeInteriorLayout() {
    const floorSet = new Set(), exitSet = new Set(), doors = [];
    for (const entry of deps.getHousePieces()) {
      if (entry.stage !== 'built') continue;
      const bx = entry.col * 2, by = entry.row * 2, w = entry.w * 2, h = entry.h * 2;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) floorSet.add((bx + c) + ',' + (by + r));
      if (!entry._doorWorld || !entry._doorObj) continue; // no farm-side entrance registered for this piece
      const nub = _doorNubCells(entry._doorWorld);
      const enter = _doorEnterCell(entry._doorWorld);
      nub.forEach(q => { floorSet.add(q.c + ',' + q.r); exitSet.add(q.c + ',' + q.r); });
      doors.push({ pieceId: entry.id, enter, exitCells: nub.map(q => q.c + ',' + q.r) });
    }
    return { floorSet, exitSet, doors };
  }

  // QA/console hook — inspects each piece's resolved door state without
  // needing to poke module-private fields directly.
  function debugPieceDoors() {
    return deps.getHousePieces().map(e => ({
      id: e.id, pieceKey: e.pieceKey, stage: e.stage,
      doorWorld: e._doorWorld || null, hasDoorObj: !!e._doorObj, doorKey: e._doorKey || null,
    }));
  }

  window.HousePieces = {
    init,
    canPlaceAt,
    clearFootprint,
    label,
    spawnEntry,
    seedStarter,
    placeDeed,
    demolish,
    moveHouse,
    movePiece,
    clearAll,
    getPieceRects,
    computeInteriorLayout,
    debugPieceDoors,
  };
})();
