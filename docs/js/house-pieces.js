(() => {
  'use strict';

  // Modular player house: a growing cluster of live-generated Highland
  // rectangles (HousePieceGen.buildGroup — the exact same generator/renderer
  // already used for barns, js/farm-buildings.js) — replacing the old
  // singular Highland House GLB.
  //
  // The farm always starts with a free 4x3 main room plus a 3x3 annex
  // touching it (see seedStarter), both built immediately, no foundation
  // step. Additional pieces are bought as deeds from the Carpenter (see
  // HOUSE_PIECE_CATALOG in game.js), placed touching the existing cluster,
  // then built via an in-world interact-to-build step — the same
  // foundation->built staging farm-buildings.js uses for barns, which this
  // module closely mirrors.
  //
  // Unlike barns, every house piece is rendered together as one pass
  // (_rebuildAllStructureMeshes) rather than independently: touching pieces
  // vote on a shared roof ridge axis and same-axis full-edge neighbors
  // visually penetrate one tile into each other, exactly like the reference
  // hobunji_modular_farmhouse_join_demo's roofAxisDecision/
  // sameDirectionExtensions — so a cluster's gables actually point at each
  // other and read as one continuous roof instead of independent boxes.
  // Each piece's automatic door (still south-biased with a same-side-blocked
  // fallback) gets a real wall-portal cut plus a small jamb/lintel/roof-cap
  // entry tunnel, also ported from that demo — see HousePieceGen.js's
  // cutDoorPortal/buildEntryTunnelGroup and buildGroup's doorSide option.
  //
  // All built pieces share ONE continuous interior (see game.js's
  // rebuildInteriorGeometry()): every piece contributes a 2x2-interior-cell
  // block per exterior farm tile, anchored directly at (farmCol*2, farmRow*2)
  // — the interior grid is just the farm grid at 2x resolution, so no
  // separate per-house coordinate origin bookkeeping is needed. Each door
  // punches a 3-interior-cell-wide exit threshold through the boundary wall
  // on whichever farm-tile side it faces — the same convention proven by the
  // reference demo's entranceNubCells().
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
    // The shingle GLB is a shared singleton (see game.js's own early
    // kickoff) that may still be loading the first time any piece builds —
    // HousePieceGen falls back to tube-mesh roofs until then. Rebuild once
    // it's actually ready so roofs don't stay stuck on the fallback.
    if (typeof HousePieceGen !== 'undefined' && !HousePieceGen.shingleReady()) {
      HousePieceGen.loadShingleGlb('assets/models/').then(() => {
        if (deps.getHousePieces().some(p => p.stage === 'built')) _rebuildAllStructureMeshes();
      }).catch(() => {});
    }
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
  // Automatic entrance placement is biased toward the south face, but tries
  // east/west/north in turn if south is blocked (typically by a neighboring
  // piece placed against that edge), so a piece still gets a usable door
  // instead of silently losing its entrance (see _registerDoor, which
  // no-ops when the resolved door tile falls inside another piece's
  // footprint). Falls back to south (registering nothing, same as before)
  // only if every side is blocked.
  function _deriveSouthBiasedDoor(entry) {
    for (const side of DOOR_SIDE_ORDER) {
      const tile = _doorTileForSide(entry, side);
      if (tile && !_doorSideBlocked(entry, tile.col, tile.row)) return { col: tile.col, row: tile.row, side };
    }
    const fallback = _doorTileForSide(entry, 'south');
    return fallback ? { col: fallback.col, row: fallback.row, side: 'south' } : null;
  }

  // ── Roof-axis voting + same-direction extension ────────────────────────
  // Ported from the reference hobunji_modular_farmhouse_join_demo. A
  // disconnected piece defaults to HousePieceGen's own long-axis roof rule
  // (w>=h -> x-ridge, else z-ridge). Once two pieces' footprints touch,
  // though, their shared edge votes for whichever ridge axis actually points
  // INTO the neighbor — so a cluster's gables actively point at each other
  // instead of resolving independently and (often) reading as visually
  // disconnected boxes. When two adjacent pieces settle on the SAME axis,
  // the smaller one's RENDERED footprint (never its actual gameplay
  // footprint/save data) also penetrates 1 tile into the larger one so
  // there's no seam down the middle of one continuous roof; equal-area
  // pieces penetrate into each other by 1 tile each. A partial (not
  // full-length) shared edge can't be represented that way without
  // spilling outside the neighbor, so it gets its own small 1-tile-deep
  // bridging piece instead (see _rebuildExtensionProxies).
  function _rectAdjacency(a, b) {
    if (a.col + a.w === b.col || b.col + b.w === a.col) {
      const start = Math.max(a.row, b.row), end = Math.min(a.row + a.h, b.row + b.h);
      if (end > start) return { orientation: 'vertical', start, end };
    }
    if (a.row + a.h === b.row || b.row + b.h === a.row) {
      const start = Math.max(a.col, b.col), end = Math.min(a.col + a.w, b.col + b.w);
      if (end > start) return { orientation: 'horizontal', start, end };
    }
    return null;
  }
  function _naturalRoofAxis(m) { return m.w >= m.h ? 'x' : 'z'; }
  function _roofAxisDecision(m, all) {
    let xScore = 0, zScore = 0;
    for (const other of all) {
      if (other === m) continue;
      const ad = _rectAdjacency(m, other);
      if (!ad) continue;
      const shared = ad.end - ad.start;
      const desired = ad.orientation === 'vertical' ? 'x' : 'z';
      const ridgeCenterAlongEdge = ad.orientation === 'vertical' ? m.row + m.h / 2 : m.col + m.w / 2;
      const centerHitsShared = ridgeCenterAlongEdge >= ad.start && ridgeCenterAlongEdge <= ad.end;
      const weight = shared * (centerHitsShared ? 2 : 1);
      if (desired === 'x') xScore += weight; else zScore += weight;
    }
    const natural = _naturalRoofAxis(m);
    return xScore === zScore ? natural : (xScore > zScore ? 'x' : 'z');
  }
  function _sameDirectionExtensions(all) {
    const out = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const ad = _rectAdjacency(a, b);
        if (!ad) continue;
        const axisA = _roofAxisDecision(a, all), axisB = _roofAxisDecision(b, all);
        if (axisA !== axisB) continue;
        const aa = a.w * a.h, ba = b.w * b.h;
        const sources = aa === ba ? [[a, b], [b, a]] : (aa < ba ? [[a, b]] : [[b, a]]);
        for (const [source, host] of sources) {
          let side, fullSourceSide;
          if (ad.orientation === 'vertical') {
            side = (source.col + source.w === host.col) ? 'east' : 'west';
            fullSourceSide = ad.start === source.row && ad.end === source.row + source.h;
          } else {
            side = (source.row + source.h === host.row) ? 'south' : 'north';
            fullSourceSide = ad.start === source.col && ad.end === source.col + source.w;
          }
          out.push({ sourceId: source.id, hostId: host.id, axis: axisA, orientation: ad.orientation, side, start: ad.start, end: ad.end, fullSourceSide });
        }
      }
    }
    return out;
  }
  // Render-only rectangle for a piece — expanded 1 tile into a same-axis
  // full-shared-edge neighbor per _sameDirectionExtensions. Never mutates
  // the piece's own col/row/w/h (footprint, door resolution, save data).
  function _renderRectFor(entry, exts) {
    let col = entry.col, row = entry.row, w = entry.w, h = entry.h;
    for (const e of exts) {
      if (e.sourceId !== entry.id || !e.fullSourceSide) continue;
      if (e.side === 'east') w += 1;
      else if (e.side === 'west') { col -= 1; w += 1; }
      else if (e.side === 'south') h += 1;
      else if (e.side === 'north') { row -= 1; h += 1; }
    }
    return { col, row, w, h };
  }
  // A partial (not full-length) same-axis shared edge can't expand the whole
  // source rectangle without spilling past the neighbor — just the 1-tile-
  // deep shared run gets its own small bridging piece instead.
  function _partialExtensionRect(e, all) {
    const host = all.find(p => p.id === e.hostId);
    if (!host) return null;
    if (e.orientation === 'vertical') {
      const col = e.side === 'east' ? host.col : host.col + host.w - 1;
      return { col, row: e.start, w: 1, h: e.end - e.start };
    }
    const row = e.side === 'south' ? host.row : host.row + host.h - 1;
    return { col: e.start, row, w: e.end - e.start, h: 1 };
  }

  // Rebuilds every BUILT piece's mesh together in one pass — roof-axis
  // decisions and same-direction extensions are inherently global (a single
  // piece's roof can depend on every neighbor it touches), so an individual
  // build/move/demolish always recomputes the whole cluster rather than
  // patching just the one piece that changed.
  let _extensionProxyMeshes = [];
  function _rebuildAllStructureMeshes() {
    if (typeof HousePieceGen === 'undefined') { deps.debugLog('HousePieceGen not loaded — house pieces shown as foundation slabs', 'warn'); return; }
    const built = deps.getHousePieces().filter(p => p.stage === 'built');
    // Clear every stale door registration up front — otherwise the first
    // few pieces processed below would still see their OWN previous door
    // sitting in deps.worldObjects (not yet reached in this loop to be
    // re-registered) and _doorSideBlocked would read that leftover
    // registration as "someone else is standing here," pushing the door
    // off its actual preferred side for no real reason.
    built.forEach(entry => _unregisterDoor(entry));
    const exts = _sameDirectionExtensions(built);
    for (const entry of built) {
      _disposeMesh(entry._mesh);
      entry._doorWorld = _deriveSouthBiasedDoor(entry);
      const axis = _roofAxisDecision(entry, built);
      const render = _renderRectFor(entry, exts);
      const buildOpts = {
        axisOverride: axis, wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _wbDefaults,
        ..._faceMats(),
      };
      if (entry._doorWorld) {
        const { side, col, row } = entry._doorWorld;
        buildOpts.doorSide = side;
        buildOpts.doorIdx  = (side === 'south' || side === 'north') ? col - render.col : row - render.row;
        buildOpts.doorLen  = (side === 'south' || side === 'north') ? render.w : render.h;
      }
      entry._mesh = HousePieceGen.buildGroup(THREE, render.col, render.col + render.w - 1, render.row, render.row + render.h - 1, buildOpts);
      if (entry._doorWorld) {
        const wallTile = _doorWallTile(entry._doorWorld);
        const tunnel = HousePieceGen.buildEntryTunnelGroup(THREE, wallTile.col, wallTile.row, entry._doorWorld.side, {
          wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _wbDefaults, ..._faceMats(),
        });
        entry._mesh.add(tunnel);
      }
      deps.scene.add(entry._mesh);
      _registerDoor(entry);
    }
    _extensionProxyMeshes.forEach(m => _disposeMesh(m));
    _extensionProxyMeshes = [];
    exts.filter(e => !e.fullSourceSide).forEach(e => {
      const rect = _partialExtensionRect(e, built);
      if (!rect || rect.w <= 0 || rect.h <= 0) return;
      const mesh = HousePieceGen.buildGroup(THREE, rect.col, rect.col + rect.w - 1, rect.row, rect.row + rect.h - 1, {
        axisOverride: e.axis, wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _wbDefaults, ..._faceMats(),
      });
      deps.scene.add(mesh);
      _extensionProxyMeshes.push(mesh);
    });
    deps.onPieceGeometryChanged();
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
  // (the same convention the old hardcoded DOOR_COL/DOOR_ROW used). It's
  // registered on its own so it's approachable/interactable like any other
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
        if (action === 'obj_house_build_' + entry.id) return build(entry.id);
        if (action === 'obj_house_demolish_' + entry.id) return demolish(entry.id);
        return { ok: false, message: 'Unknown house action.' };
      },
      reset() { _disposeMesh(entry._mesh); entry._mesh = null; },
    };
  }

  // Completes a foundation's construction — shared by the in-world "Build"
  // interaction and the House Layout editor's own Build button, so building
  // doesn't require walking up to the foundation slab first.
  function build(id) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can do that." };
    const entry = deps.getHousePieces().find(p => p.id === id);
    if (!entry) return { ok: false, message: 'House piece not found.' };
    if (entry.stage !== 'foundation') return { ok: false, message: 'Already built.' };
    entry.stage = 'built';
    _rebuildAllStructureMeshes();
    deps.saveFarmLayout();
    return { ok: true, message: `🔨 ${label(entry)} construction complete!` };
  }

  function spawnEntry(entry) {
    entry._worldObj = _makeWorldObject(entry);
    entry._mesh = entry.stage === 'built' ? null : _buildFoundationMesh(entry.col, entry.row, entry.w, entry.h);
    _registerFootprint(entry);
    if (entry.stage === 'built') _rebuildAllStructureMeshes();
  }

  // Seeds the always-present starter house — free, built immediately, no
  // foundation step (it's given, not bought). Called once per fresh farm.
  // Two pieces rather than one: a 4x3 main room plus a 3x3 annex touching
  // its full-height east edge, so a fresh farm already has two pieces for
  // the roof-axis vote / same-direction extension system above to resolve,
  // instead of needing a purchased deed before any of that is ever visible.
  function seedStarter(col, row) {
    const pieces = deps.getHousePieces();
    const main  = { id: 'house_starter', pieceKey: 'starter', col, row, w: 4, h: 3, stage: 'built' };
    const annex = { id: 'house_starter_annex', pieceKey: 'starter', col: col + main.w, row, w: 3, h: 3, stage: 'built' };
    pieces.push(main, annex);
    [main, annex].forEach(entry => { entry._worldObj = _makeWorldObject(entry); _registerFootprint(entry); });
    _rebuildAllStructureMeshes();
    return main;
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
    // Removing this piece can change its former neighbors' roof-axis vote
    // and/or same-direction extensions, not just its own geometry.
    _rebuildAllStructureMeshes();
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
  // is the new position for the (main) starter piece; every other piece
  // keeps its offset from it.
  function moveHouse(newStarterCol, newStarterRow) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can move the house." };
    const pieces = deps.getHousePieces();
    const starter = pieces.find(p => p.id === 'house_starter');
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
      }
    });
    _rebuildAllStructureMeshes(); // rebuilds every built piece at its new position; also re-resolves/re-registers doors
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: 'Moved the house.' };
  }

  // Moves one non-starter piece on its own (mirrors FarmBuildings' per-barn
  // move()) — the starter (main room + annex) isn't movable this way since
  // every other piece is placed relative to it; use moveHouse to reposition
  // the whole cluster instead. Still must end up touching some other piece,
  // same rule canPlaceAt enforces for a brand-new placement.
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
      // Rebuilds every built piece, not just this one — moving it can change
      // the roof-axis vote/same-direction extensions for whichever pieces it
      // used to (or now does) touch.
      _rebuildAllStructureMeshes();
    }
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: `Moved ${label(entry)}.` };
  }

  // Rotates one non-starter piece 90° in place. Since every piece is a
  // simple axis-aligned rectangle rendered live by HousePieceGen.buildGroup
  // (roof direction is independently resolved per-cluster by the roof-axis
  // vote, never baked into oriented content), a 90° turn is exactly a w/h
  // swap around the piece's own footprint origin — no mesh/quaternion
  // rotation needed. Still re-validates against hazards/other pieces exactly
  // like movePiece, since swapping w/h can newly overlap a neighbor or push
  // the piece off clear ground even though its (col,row) origin is unchanged.
  function rotatePiece(id) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can rotate house pieces." };
    const pieces = deps.getHousePieces();
    const entry = pieces.find(p => p.id === id);
    if (!entry) return { ok: false, message: 'House piece not found.' };
    if (entry.pieceKey === 'starter') return { ok: false, message: "The original house can't be rotated." };
    const newW = entry.h, newH = entry.w;

    const others = pieces.filter(p => p.id !== id);
    _unregisterFootprint(entry);
    _unregisterDoor(entry);
    const clear = _footprintClearOfHazardsAndBarns(entry.col, entry.row, newW, newH)
      && !others.some(b => rectsOverlap(entry.col, entry.row, newW, newH, b.col, b.row, b.w, b.h))
      && others.some(b => rectsAdjacent(entry.col, entry.row, newW, newH, b.col, b.row, b.w, b.h));
    if (!clear) {
      _registerFootprint(entry);
      _registerDoor(entry);
      return { ok: false, message: 'Cannot rotate here — the turned footprint needs clear ground touching the rest of your house.' };
    }

    entry.w = newW; entry.h = newH;
    _registerFootprint(entry);
    clearFootprint(entry.col, entry.row, entry.w, entry.h);
    if (entry.stage === 'foundation' && entry._mesh) {
      _disposeMesh(entry._mesh);
      entry._mesh = _buildFoundationMesh(entry.col, entry.row, entry.w, entry.h);
    } else if (entry.stage === 'built') {
      // Rebuilds every built piece, not just this one — a rotated footprint
      // can change the roof-axis vote/same-direction extensions for whichever
      // pieces it used to (or now does) touch.
      _rebuildAllStructureMeshes();
    }
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: `Rotated ${label(entry)}.` };
  }

  function clearAll() {
    const pieces = deps.getHousePieces();
    pieces.forEach(entry => { _unregisterFootprint(entry); _unregisterDoor(entry); _disposeMesh(entry._mesh); });
    _extensionProxyMeshes.forEach(m => _disposeMesh(m));
    _extensionProxyMeshes = [];
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
    build,
    demolish,
    moveHouse,
    movePiece,
    rotatePiece,
    clearAll,
    getPieceRects,
    computeInteriorLayout,
    debugPieceDoors,
  };
})();
