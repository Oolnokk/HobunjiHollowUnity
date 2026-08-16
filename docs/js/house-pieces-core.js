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
  // Entrances and chimneys are "architectural features" (ported from that
  // same reference demo's manual entrance/chimney system) — each built
  // piece carries its own entry.features list, and the player places/
  // removes them directly in the House Layout editor by tapping an exposed
  // exterior tile. A removed or wall-swallowed manual feature is recovered
  // into a small architectural-fixture inventory rather than deleted
  // outright, and consumed first the next time that type is placed. If a
  // house has zero VALID manual entrances, exactly one gets auto-derived
  // (south-biased with a same-side-blocked fallback) so the house is never
  // unenterable — placing any manual entrance makes that auto one disappear.
  // See _refreshArchitecturalFeatures/placeFeature/removeFeatureAt below.
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
  // Interior furniture records the room piece and piece-local cell offset,
  // so moving or rotating a room carries its contents with it. demolish()
  // still locates furniture in that piece's doubled interior block and hands
  // it to deps.recoverFurnitureInInteriorRect(), which refunds it to farm
  // storage rather than deleting it.
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

  // ── Architectural features (entrances + chimneys) ──────────────────────
  // Ported from the reference demo's manual entrance/chimney placement
  // system. Each built piece owns an entry.features array of
  // { id, type:'entrance'|'chimney', lx, ly, side, edgeSlot (entrance
  // only), autoGenerated, invalid } — lx/ly are LOCAL to the piece's own
  // footprint (the wall tile the feature stands on), side is which of the
  // piece's four faces it opens/backs onto. A separate, small
  // architectural-fixture inventory (_fixtureInventory) holds manually
  // placed features that got removed or displaced by a new piece's wall,
  // consumed first the next time that type is placed — so relocating a
  // feature is just "remove, then place elsewhere" rather than a special
  // drag operation, matching how the demo itself works.
  let _fixtureInventory = [];

  function _tileOccupiedByAnyPiece(col, row) {
    return deps.getHousePieces().some(p => p.stage === 'built' && col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h);
  }
  const FEATURE_DIRS = [
    { name: 'north', dc: 0, dr: -1 }, { name: 'east', dc: 1, dr: 0 },
    { name: 'south', dc: 0, dr: 1 },  { name: 'west', dc: -1, dr: 0 },
  ];
  // Which of a tile's four sides face open ground (not another built piece)
  // — a tile with no exposed sides at all (fully interior to the combined
  // footprint) can't hold a feature; empty array if the tile isn't part of
  // any piece at all.
  function _exposedSidesAt(col, row) {
    if (!_tileOccupiedByAnyPiece(col, row)) return [];
    return FEATURE_DIRS.filter(d => !_tileOccupiedByAnyPiece(col + d.dc, row + d.dr)).map(d => d.name);
  }
  function _featureGlobalTile(entry, f) { return { col: entry.col + f.lx, row: entry.row + f.ly }; }
  function _featureExteriorTile(entry, f) {
    const dir = FEATURE_DIRS.find(d => d.name === f.side) || FEATURE_DIRS[2];
    return { col: entry.col + f.lx + dir.dc, row: entry.row + f.ly + dir.dr };
  }
  function _featureOnLocalTile(entry, lx, ly) { return (entry.features || []).find(f => f.lx === lx && f.ly === ly) || null; }
  // Whether an entrance's exterior approach tile (one step past the wall, in
  // whichever direction it faces) is clear enough for its door to register.
  // The interaction itself lives on the wall/entry-tunnel tile so the player
  // can stand on this approach tile and aim into the doorway, matching town
  // buildings. The approach remains reserved for house-layout validation so
  // a decoration or another manually placed room cannot silently seal it.
  function _entranceExteriorClear(entry, f) {
    const { col, row } = _featureExteriorTile(entry, f);
    if (col < 0 || row < 0 || col >= deps.COLS || row >= deps.ROWS) return false;
    if (_tileOccupiedByAnyPiece(col, row)) return false;
    return !deps.worldObjects.get(col + ',' + row);
  }

  function _recoverFixture(f, pieceId) {
    if (!f || f.autoGenerated) return;
    if (_fixtureInventory.some(x => x.id === f.id)) return;
    _fixtureInventory.push({ id: f.id, type: f.type, recoveredFrom: { pieceId, lx: f.lx, ly: f.ly, side: f.side, edgeSlot: f.edgeSlot } });
  }
  function _takeFixtureFromInventory(type) {
    const i = _fixtureInventory.findIndex(x => x.type === type);
    if (i < 0) return null;
    return _fixtureInventory.splice(i, 1)[0];
  }

  // Where a piece's own local (lx,ly) tile sits for an auto-entrance
  // candidate on a given side — the center of that edge, one tile in from
  // the piece's own boundary (no rotation — house pieces are always placed
  // unrotated in this pass).
  const DOOR_SIDE_ORDER = ['south', 'east', 'west', 'north'];
  function _autoEntranceLocalTile(entry, side) {
    switch (side) {
      case 'south': return { lx: Math.floor(entry.w / 2), ly: entry.h - 1 };
      case 'north': return { lx: Math.floor(entry.w / 2), ly: 0 };
      case 'east':  return { lx: entry.w - 1, ly: Math.floor(entry.h / 2) };
      case 'west':  return { lx: 0, ly: Math.floor(entry.h / 2) };
      default: return null;
    }
  }
  // Every built piece shares ONE continuous merged interior (see
  // computeInteriorLayout/game.js's rebuildInteriorGeometry), so an
  // auto-derived entrance only ever needs to exist once for the WHOLE
  // house, not once per piece — this is purely the fallback used when there
  // isn't (yet) a single valid manual entrance anywhere (see
  // _refreshArchitecturalFeatures).
  //
  // The main starter room is tried first (it's the house's original front
  // door and the one piece every other piece is ultimately placed relative
  // to, so keeping the fallback door there is the most stable choice);
  // every other built piece is tried next, in whatever order they appear in
  // `built`. Each candidate tries south/east/west/north in turn (typically
  // blocked by a neighboring piece placed against that edge). If literally
  // no piece has any clear side (every one is boxed in on all four sides by
  // neighbors), fall back to forcing a south door on the first candidate
  // anyway — a wrong-looking door is still better than a house nobody can enter.
  function _deriveAutoEntranceCandidate(built) {
    const ordered = [...built].sort((a, b) => (a.id === 'house_starter' ? -1 : b.id === 'house_starter' ? 1 : 0));
    for (const entry of ordered) {
      for (const side of DOOR_SIDE_ORDER) {
        const tile = _autoEntranceLocalTile(entry, side);
        if (tile && _exposedSidesAt(entry.col + tile.lx, entry.row + tile.ly).includes(side)) {
          return { entryId: entry.id, lx: tile.lx, ly: tile.ly, side };
        }
      }
    }
    const first = ordered[0];
    if (!first) return null;
    const tile = _autoEntranceLocalTile(first, 'south');
    return tile ? { entryId: first.id, lx: tile.lx, ly: tile.ly, side: 'south' } : null;
  }
  // Reconciliation pass, run at the top of every _rebuildAllStructureMeshes:
  // 1. Auto entrances are derived fresh every pass, so discard the old one(s).
  // 2. Any MANUAL feature whose authored wall got swallowed by a piece newly
  //    built/moved directly against it is recovered into the fixture
  //    inventory instead of silently vanishing.
  // 3. If the house ends up with zero valid manual entrances, derive exactly
  //    one auto one so it's never unenterable.
  function _refreshArchitecturalFeatures(built) {
    built.forEach(entry => {
      if (!Array.isArray(entry.features)) entry.features = [];
      entry.features = entry.features.filter(f => !f.autoGenerated);
    });
    built.forEach(entry => {
      entry.features = entry.features.filter(f => {
        const ext = _featureExteriorTile(entry, f);
        if (ext.col < 0 || ext.row < 0 || ext.col >= deps.COLS || ext.row >= deps.ROWS || _tileOccupiedByAnyPiece(ext.col, ext.row)) {
          _recoverFixture(f, entry.id);
          return false;
        }
        const { col, row } = _featureGlobalTile(entry, f);
        f.invalid = !_exposedSidesAt(col, row).includes(f.side) || (f.type === 'entrance' && !_entranceExteriorClear(entry, f));
        return true;
      });
    });
    const hasValidManualEntrance = built.some(entry => entry.features.some(f => f.type === 'entrance' && !f.invalid));
    if (!hasValidManualEntrance) {
      const candidate = _deriveAutoEntranceCandidate(built);
      if (candidate) {
        const owner = built.find(p => p.id === candidate.entryId);
        owner.features.push({ id: 'auto_entry', type: 'entrance', lx: candidate.lx, ly: candidate.ly, side: candidate.side, edgeSlot: 1, autoGenerated: true, invalid: false });
      }
    }
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
  // A piece with an explicit roofAxis (set via rotateRoofAxis, e.g. the
  // player's own "Rotate Roof" button) is PINNED — its axis is authoritative
  // and never gets overridden by neighbor voting, so moving/rotating some
  // OTHER piece around it can never silently flip its roof. Pieces without
  // a pin keep resolving via the vote below, which naturally leans toward
  // matching whichever pinned (or also-auto) neighbor it touches — so a
  // pinned piece still influences its neighbors' own auto choices, just
  // never the reverse. The main starter room is pinned to its natural axis
  // by default the moment it's created (see seedStarter), so it's stable
  // from the very first frame, not just after the player explicitly rotates it.
  function _roofAxisDecision(m, all) {
    if (m.roofAxis === 'x' || m.roofAxis === 'z') return m.roofAxis;
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

  // Perpendicular ridges need a different join from the one-tile rectangle
  // penetration above. When a smaller roof's gable points into the eave of a
  // crossing host roof, continue that gable all the way to the host ridge.
  // The returned records are render-only and never alter room footprints.
  function _crossGableConnections(all) {
    const out = [];
    const roofSpan = (piece, axis) => axis === 'x' ? piece.h : piece.w;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const ad = _rectAdjacency(a, b);
        if (!ad) continue;
        const axisA = _roofAxisDecision(a, all), axisB = _roofAxisDecision(b, all);
        if (axisA === axisB) continue;
        const spanA = roofSpan(a, axisA), spanB = roofSpan(b, axisB);
        let source = a, host = b, sourceAxis = axisA, hostAxis = axisB;
        if (spanA > spanB || (spanA === spanB && a.w * a.h > b.w * b.h)) {
          source = b; host = a; sourceAxis = axisB; hostAxis = axisA;
        }
        const desiredAxis = ad.orientation === 'vertical' ? 'x' : 'z';
        const hostCrosses = ad.orientation === 'vertical' ? hostAxis === 'z' : hostAxis === 'x';
        const sourceCenter = ad.orientation === 'vertical'
          ? source.row + source.h / 2
          : source.col + source.w / 2;
        const hostStart = ad.orientation === 'vertical' ? host.row : host.col;
        const hostEnd = ad.orientation === 'vertical' ? host.row + host.h : host.col + host.w;
        if (sourceAxis !== desiredAxis || !hostCrosses) continue;
        if (sourceCenter < ad.start || sourceCenter > ad.end || sourceCenter < hostStart || sourceCenter > hostEnd) continue;
        const boundary = ad.orientation === 'vertical'
          ? (source.col + source.w === host.col ? host.col : source.col)
          : (source.row + source.h === host.row ? host.row : source.row);
        const target = ad.orientation === 'vertical'
          ? host.col + host.w / 2
          : host.row + host.h / 2;
        if (Math.abs(target - boundary) < 1e-6) continue;
        out.push({ sourceId: source.id, hostId: host.id, orientation: ad.orientation,
          start: ad.start, end: ad.end, boundary, target });
      }
    }
    return out;
  }

  // Builds the roof-only authored-piece payload used by HousePieceGen's real
  // shingle renderer. Its two slopes begin at the shared eave and terminate
  // at the crossing roof's spine, matching the reference demo geometry.
  function _crossGablePiece(join, all) {
    const source = all.find(p => p.id === join.sourceId);
    if (!source) return null;
    const BODY_TOP_SCALE = 0.85;
    const Y_EAVE = 1.4;
    const Y_RIDGE = Y_EAVE + 1.19;
    const EPSILON = 0.04;
    const cx = source.col + source.w / 2, cz = source.row + source.h / 2;
    const e = {
      minX: cx - source.w * BODY_TOP_SCALE / 2, maxX: cx + source.w * BODY_TOP_SCALE / 2,
      minZ: cz - source.h * BODY_TOP_SCALE / 2, maxZ: cz + source.h * BODY_TOP_SCALE / 2,
    };
    const faces = [];
    const face = (v, tag, extra = {}) => faces.push({
      id: faces.length + 1, tag, v, ...extra,
    });
    if (join.orientation === 'vertical') {
      const dir = cx < join.target ? 1 : -1;
      const longShrink = (e.maxX - e.minX) * (1 - BODY_TOP_SCALE) / 2;
      const ridgeStart = dir > 0 ? e.maxX - longShrink : e.minX + longShrink;
      const lowMin = dir > 0 ? join.boundary : join.target;
      const lowMax = dir > 0 ? join.target : join.boundary;
      const ridgeMin = dir > 0 ? ridgeStart : join.target;
      const ridgeMax = dir > 0 ? join.target : ridgeStart;
      const z0 = Math.max(join.start, e.minZ), z1 = Math.min(join.end, e.maxZ);
      face([[lowMin,Y_EAVE,z0],[ridgeMin,Y_RIDGE,cz-EPSILON],[ridgeMax,Y_RIDGE,cz-EPSILON],[lowMax,Y_EAVE,z0]], 'roof', { roofAcrossOffset: -0.25, roofOffsetRole: 'cross_gable_edgeward' });
      face([[lowMax,Y_EAVE,z1],[ridgeMax,Y_RIDGE,cz+EPSILON],[ridgeMin,Y_RIDGE,cz+EPSILON],[lowMin,Y_EAVE,z1]], 'roof', { roofAcrossOffset: 0, roofOffsetRole: 'cross_gable_reference' });
      face([[ridgeMin,Y_RIDGE,cz+EPSILON],[ridgeMax,Y_RIDGE,cz+EPSILON],[ridgeMax,Y_RIDGE,cz-EPSILON],[ridgeMin,Y_RIDGE,cz-EPSILON]], 'ceiling', { roofRidgeCap: true });
    } else {
      const dir = cz < join.target ? 1 : -1;
      const longShrink = (e.maxZ - e.minZ) * (1 - BODY_TOP_SCALE) / 2;
      const ridgeStart = dir > 0 ? e.maxZ - longShrink : e.minZ + longShrink;
      const lowMin = dir > 0 ? join.boundary : join.target;
      const lowMax = dir > 0 ? join.target : join.boundary;
      const ridgeMin = dir > 0 ? ridgeStart : join.target;
      const ridgeMax = dir > 0 ? join.target : ridgeStart;
      const x0 = Math.max(join.start, e.minX), x1 = Math.min(join.end, e.maxX);
      face([[x1,Y_EAVE,lowMin],[cx+EPSILON,Y_RIDGE,ridgeMin],[cx+EPSILON,Y_RIDGE,ridgeMax],[x1,Y_EAVE,lowMax]], 'roof', { roofAcrossOffset: -0.25, roofOffsetRole: 'cross_gable_edgeward' });
      face([[x0,Y_EAVE,lowMax],[cx-EPSILON,Y_RIDGE,ridgeMax],[cx-EPSILON,Y_RIDGE,ridgeMin],[x0,Y_EAVE,lowMin]], 'roof', { roofAcrossOffset: 0, roofOffsetRole: 'cross_gable_reference' });
      face([[cx-EPSILON,Y_RIDGE,ridgeMax],[cx+EPSILON,Y_RIDGE,ridgeMax],[cx+EPSILON,Y_RIDGE,ridgeMin],[cx-EPSILON,Y_RIDGE,ridgeMin]], 'ceiling', { roofRidgeCap: true });
    }
    return { schema: 'modular-house-piece-author/cross-gable-runtime', id: 'cross_gable_' + join.sourceId,
      gridSize: 1, tileSize: 1, footprint: { cells: [{ x: 0, y: 0 }], connectors: [], extensions: {} },
      base: { height: Y_EAVE, wallThickness: 0, groundY: 0, faces }, assets: [] };
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
    // few pieces processed below would still see their OWN previous doors
    // sitting in deps.worldObjects (not yet reached in this loop to be
    // re-registered) and _exposedSidesAt would read that leftover
    // registration as "something else is standing here."
    built.forEach(entry => _unregisterFeatureDoors(entry));
    _refreshArchitecturalFeatures(built);
    const exts = _sameDirectionExtensions(built);
    const crossGables = _crossGableConnections(built);
    for (const entry of built) {
      _disposeMesh(entry._mesh);
      const axis = _roofAxisDecision(entry, built);
      const render = _renderRectFor(entry, exts);
      const entrances = (entry.features || []).filter(f => f.type === 'entrance' && !f.invalid);
      const buildOpts = {
        axisOverride: axis, wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _wbDefaults,
        doorCuts: entrances.map(f => {
          const { col, row } = _featureGlobalTile(entry, f);
          return {
            side: f.side,
            idx: (f.side === 'south' || f.side === 'north') ? col - render.col : row - render.row,
            len: (f.side === 'south' || f.side === 'north') ? render.w : render.h,
          };
        }),
        ..._faceMats(),
      };
      entry._mesh = HousePieceGen.buildGroup(THREE, render.col, render.col + render.w - 1, render.row, render.row + render.h - 1, buildOpts);
      (entry.features || []).forEach(f => {
        if (f.invalid) return;
        const { col, row } = _featureGlobalTile(entry, f);
        if (f.type === 'entrance') {
          const tunnel = HousePieceGen.buildEntryTunnelGroup(THREE, col, row, f.side, {
            wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _wbDefaults, ..._faceMats(),
          });
          entry._mesh.add(tunnel);
        } else if (f.type === 'chimney') {
          const chimney = HousePieceGen.buildChimneyGroup(THREE, col, row, {
            wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true, wbOpts: _wbDefaults, ..._faceMats(),
          });
          entry._mesh.add(chimney);
        }
      });
      deps.scene.add(entry._mesh);
      _registerFeatureDoors(entry);
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
    crossGables.forEach(join => {
      const piece = _crossGablePiece(join, built);
      if (!piece) return;
      const mesh = HousePieceGen.buildGroupFromPiece(THREE, piece, 0, 0, {
        wallBuilder: null, ..._faceMats(),
      });
      mesh.userData.generatedCrossGable = true;
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

  // Each entrance gets an "Enter" interaction on its wall/entry-tunnel tile,
  // matching town buildings: the player stands on the exterior approach and
  // aims inward. A separate non-interactable reservation stays on the exterior
  // tile so house-layout validation still protects manual entrances and can
  // intentionally swallow auto entrances via house-pieces-elevation-bootstrap.
  // A piece with two manual entrances gets two independent doors, both leading
  // into the same merged interior via enterInterior(entry.id).
  function _registerFeatureDoors(entry) {
    (entry.features || []).forEach(f => {
      if (f.type !== 'entrance' || f.invalid) return;
      const approach = _featureExteriorTile(entry, f); // Reserved stand/approach tile immediately outside this doorway.
      if (approach.col < 0 || approach.row < 0 || approach.col >= deps.COLS || approach.row >= deps.ROWS) return;
      if (_tileOccupiedByAnyPiece(approach.col, approach.row)) return;
      const approachKey = approach.col + ',' + approach.row; // worldObjects key used by house-layout occupancy checks.
      if (deps.worldObjects.get(approachKey)) return;
      const door = _featureGlobalTile(entry, f); // Wall/entry-tunnel tile the reticle must target to enter.
      const doorKey = door.col + ',' + door.row; // worldObjects key replacing the ordinary footprint object while registered.
      const doorOccupant = deps.worldObjects.get(doorKey); // Only this piece's own footprint object may be replaced by the door.
      if (doorOccupant && doorOccupant !== entry._worldObj) return;
      const doorObj = {
        id: 'house_entrance_' + f.id, type: 'house_entrance', col: door.col, row: door.row,
        getButtons() { return [{ icon: '🚪', label: 'Enter', action: 'obj_enter_house', style: 'primary', allowed: true }]; },
        onAction(action) {
          if (action === 'obj_enter_house') {
            deps.startSceneTransition(() => deps.enterInterior(entry.id));
            return { ok: true, message: 'Entering the house…' };
          }
          return { ok: false, message: 'Unknown house action.' };
        },
      };
      const approachObj = {
        id: 'house_entrance_approach_' + f.id,
        type: 'house_entrance_approach',
        col: approach.col,
        row: approach.row,
        getButtons() { return []; },
        onAction() { return { ok: false, message: 'Aim into the doorway to enter.' }; },
      };
      f._doorObj = doorObj;
      f._doorKey = doorKey;
      f._approachObj = approachObj;
      f._approachKey = approachKey;
      deps.worldObjects.set(f._doorKey, doorObj);
      deps.worldObjects.set(f._approachKey, approachObj);
    });
  }
  function _unregisterFeatureDoors(entry) {
    (entry.features || []).forEach(f => {
      if (f._doorObj && deps.worldObjects.get(f._doorKey) === f._doorObj) {
        deps.worldObjects.delete(f._doorKey);
        // The interaction temporarily replaced this piece's ordinary footprint
        // object. Restore it so a mesh-only door rebuild leaves the structural
        // tile registered; callers removing/moving the piece unregister doors
        // before unregistering the footprint and therefore remove it normally.
        if (entry._worldObj) deps.worldObjects.set(f._doorKey, entry._worldObj);
      }
      if (f._approachObj && deps.worldObjects.get(f._approachKey) === f._approachObj) deps.worldObjects.delete(f._approachKey);
      f._doorObj = null; f._doorKey = null;
      f._approachObj = null; f._approachKey = null;
    });
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
    const mainW = 4, mainH = 3;
    // The main room is pinned to its own natural roof axis from creation —
    // see _roofAxisDecision's comment — so it's never at the mercy of the
    // annex's (or any later piece's) position, only the reverse. It also
    // starts with a chimney on its north (back) wall, opposite the
    // south-biased auto-entrance, which derives a hearth against that same
    // wall once the interior rebuilds — see computeInteriorLayout's hearths.
    const main = {
      id: 'house_starter', pieceKey: 'starter', col, row, w: mainW, h: mainH, stage: 'built',
      roofAxis: _naturalRoofAxis({ w: mainW, h: mainH }),
      features: [{ id: 'starter_chimney', type: 'chimney', lx: Math.floor(mainW / 2), ly: 0, side: 'north', autoGenerated: false, invalid: false }],
    };
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
    _unregisterFeatureDoors(entry);
    _unregisterFootprint(entry);
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
    pieces.forEach(p => { _unregisterFeatureDoors(p); _unregisterFootprint(p); });
    const allClear = pieces.every(p => _footprintClearOfHazardsAndBarns(p.col + dCol, p.row + dRow, p.w, p.h));
    if (!allClear) {
      pieces.forEach(p => { _registerFootprint(p); _registerFeatureDoors(p); });
      return { ok: false, message: 'Cannot move the house there — needs clear, untilled ground for every room.' };
    }

    pieces.forEach(p => {
      const oldRect = { col: p.col, row: p.row, w: p.w, h: p.h };
      p.col += dCol; p.row += dRow;
      deps.transformFurnitureWithHousePiece?.(p.id, oldRect, { col: p.col, row: p.row, w: p.w, h: p.h }, false);
    });
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

  // Read-only "would movePiece to (col,row) succeed" check — the piece's
  // OWN footprint/door are unregistered before testing and always
  // re-registered before returning, so a candidate spot that overlaps the
  // piece's OWN current position (extremely common with a drag interface —
  // most drags only nudge a piece a tile or two, so the new footprint
  // almost always overlaps the old one) doesn't spuriously read as
  // "occupied by something" and get rejected. Shared by movePiece's own
  // commit path and the live drag-preview validity check in farm-panel.js,
  // so the two can never disagree about what's actually a legal target.
  function canMovePieceTo(id, col, row) {
    const pieces = deps.getHousePieces();
    const entry = pieces.find(p => p.id === id);
    if (!entry || entry.id === 'house_starter') return false;
    const others = pieces.filter(p => p.id !== id);
    _unregisterFeatureDoors(entry);
    _unregisterFootprint(entry);
    const ok = _footprintClearOfHazardsAndBarns(col, row, entry.w, entry.h)
      && !others.some(b => rectsOverlap(col, row, entry.w, entry.h, b.col, b.row, b.w, b.h))
      && others.some(b => rectsAdjacent(col, row, entry.w, entry.h, b.col, b.row, b.w, b.h));
    _registerFootprint(entry);
    _registerFeatureDoors(entry);
    return ok;
  }

  // Moves one piece on its own (mirrors FarmBuildings' per-barn move()) —
  // only the main starter room ('house_starter') is excluded, since every
  // other piece (including the starter annex) is placed relative to it; use
  // moveHouse to reposition that anchor and drag the whole cluster together
  // instead. Every other piece, starter annex included, can be repositioned
  // independently as long as it ends up touching some other piece — same
  // rule canPlaceAt enforces for a brand-new placement — so the player can
  // freely rearrange rooms around the fixed anchor.
  function movePiece(id, newCol, newRow) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can move house pieces." };
    const pieces = deps.getHousePieces();
    const entry = pieces.find(p => p.id === id);
    if (!entry) return { ok: false, message: 'House piece not found.' };
    if (entry.id === 'house_starter') return { ok: false, message: 'Move the whole house instead of the main room on its own.' };
    if (newCol === entry.col && newRow === entry.row) return { ok: false, message: 'Already there.' };
    if (!canMovePieceTo(id, newCol, newRow)) {
      return { ok: false, message: 'Cannot move there — needs clear, untilled ground touching the rest of your house.' };
    }

    _unregisterFeatureDoors(entry);
    _unregisterFootprint(entry);
    const oldRect = { col: entry.col, row: entry.row, w: entry.w, h: entry.h };
    entry.col = newCol; entry.row = newRow;
    deps.transformFurnitureWithHousePiece?.(entry.id, oldRect, { col: entry.col, row: entry.row, w: entry.w, h: entry.h }, false);
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

  // Rotates one piece 90° in place — everything except the main starter room
  // ('house_starter'), same exclusion as movePiece. Since every piece is a
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
    if (entry.id === 'house_starter') return { ok: false, message: "The main room can't be rotated on its own." };
    const newW = entry.h, newH = entry.w;

    const others = pieces.filter(p => p.id !== id);
    _unregisterFeatureDoors(entry);
    _unregisterFootprint(entry);
    const clear = _footprintClearOfHazardsAndBarns(entry.col, entry.row, newW, newH)
      && !others.some(b => rectsOverlap(entry.col, entry.row, newW, newH, b.col, b.row, b.w, b.h))
      && others.some(b => rectsAdjacent(entry.col, entry.row, newW, newH, b.col, b.row, b.w, b.h));
    if (!clear) {
      _registerFootprint(entry);
      _registerFeatureDoors(entry);
      return { ok: false, message: 'Cannot rotate here — the turned footprint needs clear ground touching the rest of your house.' };
    }

    const oldRect = { col: entry.col, row: entry.row, w: entry.w, h: entry.h };
    entry.w = newW; entry.h = newH;
    deps.transformFurnitureWithHousePiece?.(entry.id, oldRect, { col: entry.col, row: entry.row, w: entry.w, h: entry.h }, true);
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

  // Rotates a piece's ROOF ridge 90° — separate from rotatePiece (footprint
  // w/h swap): this never touches col/row/w/h, so it can't fail a clear-
  // ground/touching check and works on every built piece, including the
  // main starter room (footprint rotatePiece explicitly refuses). Pinning
  // (see _roofAxisDecision) means once a piece's roof has been rotated it
  // stays exactly there — including through drags/rotates of OTHER pieces —
  // until rotated again.
  function rotateRoofAxis(id) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can rotate a roof." };
    const pieces = deps.getHousePieces();
    const entry = pieces.find(p => p.id === id);
    if (!entry) return { ok: false, message: 'House piece not found.' };
    if (entry.stage !== 'built') return { ok: false, message: 'Build it first.' };
    const built = pieces.filter(p => p.stage === 'built');
    const current = _roofAxisDecision(entry, built);
    entry.roofAxis = current === 'x' ? 'z' : 'x';
    _rebuildAllStructureMeshes();
    deps.saveFarmLayout();
    return { ok: true, message: `Rotated ${label(entry)}'s roof.` };
  }

  // Sets a piece's pinned roof axis without rebuilding or saving — for
  // restoring saved roofAxis values onto already-spawned pieces (the main
  // room/annex, which loadFarmLayout repositions in place rather than
  // recreating) during load, where the caller does one bulk
  // rebuildStructureMeshes() afterward instead of one per piece.
  function setRoofAxis(id, axis) {
    const entry = deps.getHousePieces().find(p => p.id === id);
    if (entry) entry.roofAxis = axis;
  }

  // Whether (col,row) — a farm-grid tile, not a local piece offset — could
  // accept a NEW feature of `type`: must belong to some built piece, have
  // at least one exposed side, and not already hold a feature.
  function canPlaceFeatureAt(col, row) {
    const entry = deps.getHousePieces().find(p => p.stage === 'built' && col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h);
    if (!entry) return false;
    if (!_exposedSidesAt(col, row).length) return false;
    return !_featureOnLocalTile(entry, col - entry.col, row - entry.row);
  }

  // Places a manual entrance or chimney on whichever built piece owns
  // (col,row) — worldX/worldZ (fractional world coords, e.g. from the House
  // Layout editor's own screen-to-world conversion) pick which of that
  // tile's exposed sides the feature faces (nearest edge to the actual tap)
  // and, for an entrance, which of the wall tile's two interior sub-cells
  // its exit nub centers on. Consumes a matching recovered fixture from
  // the architectural inventory first if one exists, reusing its identity,
  // exactly like the reference demo.
  function placeFeature(col, row, worldX, worldZ, type) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can do that." };
    const entry = deps.getHousePieces().find(p => p.stage === 'built' && col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h);
    if (!entry) return { ok: false, message: 'That tile is not part of a built room.' };
    const sides = _exposedSidesAt(col, row);
    if (!sides.length) return { ok: false, message: 'That tile is not on the outer edge of the house — entrances and chimneys need an exposed wall.' };
    const lx = col - entry.col, ly = row - entry.row;
    if (_featureOnLocalTile(entry, lx, ly)) return { ok: false, message: 'That tile already has an entrance or chimney — remove it first.' };
    const fx = Math.min(0.9999, Math.max(0, worldX - col)), fz = Math.min(0.9999, Math.max(0, worldZ - row));
    const distance = { north: fz, south: 1 - fz, west: fx, east: 1 - fx };
    const orderedSides = [...sides].sort((a, b) => distance[a] - distance[b]);
    // An exposed side (no OTHER PIECE in the way) can still have its
    // exterior tile blocked by a plain farm decoration (tree, rock, ...) —
    // that would leave the door silently unregistered (see
    // _entranceExteriorClear) even though the feature itself looks valid,
    // so an entrance tries every exposed side nearest-tap-first and only
    // fails if none of them are actually clear. Chimneys don't register
    // anything on their exterior tile, so they just take the nearest side.
    const side = type === 'entrance'
      ? orderedSides.find(s => _entranceExteriorClear(entry, { lx, ly, side: s })) || null
      : (orderedSides[0] || null);
    if (!side) return { ok: false, message: 'The ground just outside every exposed side of that tile is blocked — try a different spot.' };
    const edgeSlot = (side === 'north' || side === 'south') ? (fx < 0.5 ? 0 : 1) : (fz < 0.5 ? 0 : 1);
    const recovered = _takeFixtureFromInventory(type);
    if (!Array.isArray(entry.features)) entry.features = [];
    entry.features.push({
      id: recovered?.id || (type + '_' + Math.random().toString(36).slice(2, 9)),
      type, lx, ly, side, edgeSlot: type === 'entrance' ? edgeSlot : undefined,
      autoGenerated: false, invalid: false,
    });
    _rebuildAllStructureMeshes();
    deps.saveFarmLayout();
    return { ok: true, message: `${type === 'chimney' ? 'Chimney' : 'Entrance'} placed${recovered ? ' (restored from storage)' : ''}, facing ${side}.` };
  }

  // Removes whichever manual feature sits at farm tile (col,row) and
  // recovers it into the architectural inventory. Auto-derived entrances
  // can't be removed this way (there's nothing to recover — place a manual
  // entrance instead and the auto one disappears on its own).
  function removeFeatureAt(col, row) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can do that." };
    const entry = deps.getHousePieces().find(p => p.stage === 'built' && col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h);
    if (!entry) return { ok: false, message: 'No entrance or chimney there.' };
    const f = _featureOnLocalTile(entry, col - entry.col, row - entry.row);
    if (!f) return { ok: false, message: 'No entrance or chimney there.' };
    if (f.autoGenerated) return { ok: false, message: 'That entrance is automatic — place a manual one elsewhere and it will disappear on its own.' };
    entry.features = entry.features.filter(x => x.id !== f.id);
    _recoverFixture(f, entry.id);
    _rebuildAllStructureMeshes();
    deps.saveFarmLayout();
    return { ok: true, message: `${f.type === 'chimney' ? 'Chimney' : 'Entrance'} removed and stored — place it elsewhere any time.` };
  }

  function getFixtureInventory() { return _fixtureInventory.map(x => ({ ...x })); }
  // Restores the fixture inventory from a save — replaces whatever's
  // currently held (called once at load, before any placement happens).
  function loadFixtureInventory(saved) {
    _fixtureInventory = Array.isArray(saved) ? saved.map(x => ({ ...x })) : [];
  }
  // Restores a piece's saved features onto an already-spawned entry (the
  // main room/annex, which loadFarmLayout repositions in place rather than
  // recreating) without rebuilding — the caller does one bulk
  // rebuildStructureMeshes() afterward instead of one per piece, same
  // pattern as setRoofAxis.
  function setFeatures(id, features) {
    const entry = deps.getHousePieces().find(p => p.id === id);
    if (entry) entry.features = Array.isArray(features) ? features.map(f => ({ ...f })) : [];
  }

  function clearAll() {
    const pieces = deps.getHousePieces();
    pieces.forEach(entry => { _unregisterFeatureDoors(entry); _unregisterFootprint(entry); _disposeMesh(entry._mesh); });
    _extensionProxyMeshes.forEach(m => _disposeMesh(m));
    _extensionProxyMeshes = [];
    deps.setHousePieces([]);
  }

  function getPieceRects() {
    return deps.getHousePieces().map(e => ({ col: e.col, row: e.row, w: e.w, h: e.h }));
  }

  // ── Merged-interior geometry ─────────────────────────────────────────
  // 3-interior-cell-wide × 1-deep threshold strip immediately outside the
  // feature's own wall tile's doubled interior block, centered on the
  // feature — the exact convention proven by the reference modular-
  // farmhouse join demo's entranceNubCells(). `edgeSlot` (which of the wall
  // tile's 2 interior sub-cells the strip centers on) is fixed at 1 for
  // auto-derived entrances, but reflects where the player actually tapped
  // for a manually placed one (see placeFeature).
  function _entranceNubCells(entry, f) {
    const gx = entry.col + f.lx, gy = entry.row + f.ly, slot = (f.edgeSlot === 0 ? 0 : 1);
    if (f.side === 'north') { const c = gx * 2 + slot, r = gy * 2 - 1; return [-1, 0, 1].map(d => ({ c: c + d, r })); }
    if (f.side === 'south') { const c = gx * 2 + slot, r = (gy + 1) * 2; return [-1, 0, 1].map(d => ({ c: c + d, r })); }
    if (f.side === 'west')  { const r = gy * 2 + slot, c = gx * 2 - 1; return [-1, 0, 1].map(d => ({ c, r: r + d })); }
    const r = gy * 2 + slot, c = (gx + 1) * 2; return [-1, 0, 1].map(d => ({ c, r: r + d }));
  }
  // One interior cell inward from the nub's center — where the player
  // spawns when entering through this feature's door.
  function _entranceEnterCell(entry, f) {
    const gx = entry.col + f.lx, gy = entry.row + f.ly, slot = (f.edgeSlot === 0 ? 0 : 1);
    if (f.side === 'north') return { c: gx * 2 + slot, r: gy * 2 };
    if (f.side === 'south') return { c: gx * 2 + slot, r: gy * 2 + 1 };
    if (f.side === 'west')  return { c: gx * 2, r: gy * 2 + slot };
    return { c: gx * 2 + 1, r: gy * 2 + slot };
  }
  const HEARTH_YAW = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 };
  // World-space (interior-grid-unit) center + facing for a chimney's
  // derived hearth, glued to the same wall the chimney backs onto — exact
  // port of the reference demo's derivedHearthGroup positioning.
  function _chimneyHearthPlacement(entry, f) {
    const gx = (entry.col + f.lx) * 2, gy = (entry.row + f.ly) * 2;
    let cx = gx + 1, cz = gy + 0.5;
    if (f.side === 'south') { cx = gx + 1; cz = gy + 1.5; }
    else if (f.side === 'west') { cx = gx + 0.5; cz = gy + 1; }
    else if (f.side === 'east') { cx = gx + 1.5; cz = gy + 1; }
    return { pieceId: entry.id, featureId: f.id, cx, cz, yaw: HEARTH_YAW[f.side] ?? 0 };
  }

  // Returns { floorSet, exitSet, doors, hearths } for every BUILT piece —
  // the union of every piece's doubled footprint block, plus each valid
  // entrance feature's exit-nub strip (also folded into floorSet so the
  // threshold is walkable, and into exitSet so InteriorSceneBuilder.
  // buildWallPanels knows not to wall off that opening), plus each valid
  // chimney feature's derived hearth placement. `doors` is one entry per
  // entrance feature (a piece can have more than one), for enterInterior(pieceId).
  function computeInteriorLayout() {
    const floorSet = new Set(), exitSet = new Set(), doors = [], hearths = [];
    for (const entry of deps.getHousePieces()) {
      if (entry.stage !== 'built') continue;
      const bx = entry.col * 2, by = entry.row * 2, w = entry.w * 2, h = entry.h * 2;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) floorSet.add((bx + c) + ',' + (by + r));
      (entry.features || []).forEach(f => {
        if (f.invalid) return;
        if (f.type === 'entrance') {
          if (!f._doorObj) return; // no farm-side entrance registered for this feature
          const nub = _entranceNubCells(entry, f);
          const enter = _entranceEnterCell(entry, f);
          nub.forEach(q => { floorSet.add(q.c + ',' + q.r); exitSet.add(q.c + ',' + q.r); });
          doors.push({ pieceId: entry.id, featureId: f.id, enter, exitCells: nub.map(q => q.c + ',' + q.r) });
        } else if (f.type === 'chimney') {
          hearths.push(_chimneyHearthPlacement(entry, f));
        }
      });
    }
    return { floorSet, exitSet, doors, hearths };
  }

  // QA/console hook — inspects each piece's resolved architectural features
  // without needing to poke module-private fields directly.
  function debugPieceFeatures() {
    return deps.getHousePieces().map(e => ({
      id: e.id, pieceKey: e.pieceKey, stage: e.stage,
      features: (e.features || []).map(f => ({
        id: f.id, type: f.type, lx: f.lx, ly: f.ly, side: f.side, edgeSlot: f.edgeSlot,
        autoGenerated: !!f.autoGenerated, invalid: !!f.invalid, hasDoorObj: !!f._doorObj,
        doorTile: f._doorKey || null, approachTile: f._approachKey || null,
      })),
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
    canMovePieceTo,
    rotatePiece,
    rotateRoofAxis,
    setRoofAxis,
    canPlaceFeatureAt,
    placeFeature,
    removeFeatureAt,
    getFixtureInventory,
    loadFixtureInventory,
    setFeatures,
    rebuildStructureMeshes: _rebuildAllStructureMeshes,
    clearAll,
    getPieceRects,
    computeInteriorLayout,
    debugPieceFeatures,
  };
})();
