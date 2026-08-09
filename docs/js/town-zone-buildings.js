(() => {
  'use strict';

  // Spawns authored building meshes (Highland-house-style piece JSON, via
  // HousePieceGen) and decorative furniture/props into the town scene and
  // wilderness zone scenes. Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern as its sibling systems.
  //
  // townScene/_townZone/worldTownTransitions/_townBuildingDefs/
  // _townBuildingGroups all stay in game.js on purpose — they're core town-
  // scene state read/written from many places well beyond building spawn
  // (camera, NPC placement, area-transition code) — and come in through
  // deps, several as getter/setter pairs since game.js reassigns them
  // wholesale elsewhere. HousePieceGen/WallBuilder/BuildingDoor are left as
  // direct globally-loaded references, same treatment THREE gets.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // Retints the shared wall-brick GLB (Roughbrick1.glb, via WallBuilder) and
  // the shared shingle GLB (HighlandLongshingle_boned.glb, via HousePieceGen)
  // from their baked textures to a repo PNG + shade-fill color, the same way
  // loadHousePieceFaceTexture already does for the boards/stone/canvas faces
  // above. Both GLB templates are shared singletons whose clones/instances
  // reference the same material object (see WallBuilder.build's InstancedMesh
  // and HousePieceGen's _tpl.scene.clone), so retinting each template's
  // material once here covers every building anywhere, town or wilderness —
  // no per-building or per-zone work needed. Gated on the same
  // window.__hobunjiGlbTintApplied flag game.js's own early tint kickoff
  // uses (it starts the identical retint as soon as its farm-scoped GLB
  // loads resolve, so a farm-only session that never visits town still gets
  // matching materials) — whichever path finishes its loads first does the
  // retint exactly once; this path is a safe no-op if the other already ran.
  function _applyBuildingGlbTints() {
    if (window.__hobunjiGlbTintApplied) return;
    window.__hobunjiGlbTintApplied = true;
    deps.houseWallBuilder.tintDefaultGlb('assets/textures/carved_smooth.png', '#4d4d4d');
    HousePieceGen.tintShingleMaterial('assets/textures/carved_smooth.png', '#7d7355');
  }

  // ── Town building detection ──────────────────────────────────────
  // Reads explicit building entries from the town layout (placed by map editor).
  function detectTownBuildings() {
    const buildings = deps.getTownZone()?.buildings || [];
    deps.debugLog('_detectTownBuildings: ' + buildings.length + ' placed buildings');
    return buildings;
  }

  // Loads a docs/assets/textures/*.png as a shared, tiling MeshLambertMaterial
  // for HousePieceGen.buildGroupFromPiece's tagged faces (BOARD_TAGS/STONE_TAGS/
  // 'canvas' — see HousePieceGen.js). Starts as a flat fallback color so meshes
  // render immediately; once the texture loads it replaces the color in place
  // on the same material object, so every mesh already built with it updates
  // automatically. tileSize is world units per texture repeat — HousePieceGen.js
  // reads it back off mat.userData.uvTileSize to scale each face's UVs so the
  // texture stretches proportionally to real face size instead of smearing a
  // whole image across every face regardless of size.
  //
  // fillColor, when given, recolors the PNG's visible pixels to that target
  // hex using the same adaptive luminance-preserving shade fill as portrait/
  // creature tinting (getShadeFillCanvas in portrait-utils.js, loaded before
  // this file) — the texture's own shading/grain is kept, just retinted,
  // instead of the raw PNG albedo showing through untouched.
  function loadHousePieceFaceTexture(path, fallbackColor, tileSize, fillColor) {
    const mat = new THREE.MeshLambertMaterial({ color: fallbackColor, side: THREE.DoubleSide });
    mat.userData.uvTileSize = tileSize;
    new THREE.TextureLoader().load(path, (tex) => {
      let finalTex = tex;
      const rgb = fillColor && parseHexColor(fillColor);
      if (rgb) {
        const canvas = getShadeFillCanvas(tex.image, path + '|' + fillColor, {
          mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: getPortraitTintingConfig(),
        });
        finalTex = new THREE.CanvasTexture(canvas);
      }
      finalTex.wrapS = finalTex.wrapT = THREE.RepeatWrapping;
      mat.map = finalTex; mat.color.set(0xffffff); mat.needsUpdate = true;
    }, undefined, () => {});
    return mat;
  }

  // Spawns Highland house pieces for all placed town buildings.
  // Fetches each building's piece JSON then calls HousePieceGen.buildGroupFromPiece(),
  // which reads piece.base.faces directly (same geometry as the house editor preview)
  // plus WallBuilder bricks on wall/gable faces.
  let _townBuildingsGlbUpgradePending = false;
  // Each entry: { group, bldg, piece, wbOpts, wbGableOpts }
  function spawnTownBuildings() {
    const townScene = deps.getTownScene();
    const townBuildingDefs = deps.getTownBuildingDefs();
    if (!townScene || !townBuildingDefs.length) return;
    if (typeof HousePieceGen === 'undefined') {
      deps.debugLog('HousePieceGen not loaded — skipping town buildings', 'warn');
      return;
    }

    // Dispose previous groups
    for (const entry of deps.getTownBuildingGroups()) {
      townScene.remove(entry.group);
      entry.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    deps.setTownBuildingGroups([]);

    const _wbDefaults = { unitMult: 0.4375, rockScale: 1.5,
                          preScale: [1, 1, 0.6],
                          brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };

    // Preload tagged-face textures (shared across all buildings) — boards.png
    // for porch/stair/railing faces, carved_smooth.png for stone-tagged
    // (chimney) faces, canvas.png for canvas-tagged (tent) faces.
    const _boardsMat = loadHousePieceFaceTexture('assets/textures/boards.png', 0x8b6914, 1.2);
    const _stoneMat  = loadHousePieceFaceTexture('assets/textures/carved_smooth.png', 0x888888, 1.5, '#4d4d4d');
    const _canvasMat = loadHousePieceFaceTexture('assets/textures/canvas.png', 0xcbb489, 2);

    // Async-load all piece files in parallel, then build scene
    Promise.all(townBuildingDefs.map(bldg => {
      if (!bldg.pieceFile) return Promise.resolve({ bldg, piece: null });
      return fetch(bldg.pieceFile)
        .then(r => r.json())
        .then(piece => ({ bldg, piece }))
        .catch(e => { deps.debugLog('Piece load error (' + bldg.id + '): ' + e, 'warn'); return { bldg, piece: null }; });
    })).then(results => {
      const townScene2 = deps.getTownScene();
      if (!townScene2) return;
      const TROWS_ENT = deps.getTownZone()?.rows || 50;
      const _entranceRingGeo = new THREE.RingGeometry(0.22, 0.36, 24);
      const _entranceMat = new THREE.MeshBasicMaterial({ color: 0x7c3008, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });

      const groups = deps.getTownBuildingGroups();
      for (const { bldg, piece } of results) {
        const wbOpts      = bldg.wbOpts      || _wbDefaults;
        const wbGableOpts = bldg.wbGableOpts || undefined;

        let g = new THREE.Group();
        if (piece) {
          g = HousePieceGen.buildGroupFromPiece(THREE, piece, bldg.gridX, bldg.gridZ, {
            wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true,
            wbOpts, wbGableOpts, matBoards: _boardsMat, matStone: _stoneMat, matCanvas: _canvasMat,
            rotationDeg: bldg.rotationDeg || 0,
          });
        }
        townScene2.add(g);
        groups.push({ group: g, bldg, piece, wbOpts, wbGableOpts });

        // Entrance ring: single-source door geometry from js/building-door.js
        // (shared with the Map Editor's Building inspector, and with House
        // Piece Author for the door preview) — resolves the piece's
        // authored footprint.door point, or the old porch/south-edge
        // heuristic for pieces nobody has placed a door on yet.
        const rotDeg = bldg.rotationDeg || bldg.rotation || 0;
        const doorEnt = BuildingDoor.resolveDoorEntrance(piece);
        const hasBldgCells = !!doorEnt;
        let wBMinC, wBMaxC, wBMinR, wBMaxR, eCol, eRow;
        if (hasBldgCells) {
          const door = BuildingDoor.doorWorldFromBuilding(doorEnt, bldg.gridX, bldg.gridZ, rotDeg, TROWS_ENT - 1);
          eCol = door.col; eRow = door.row;
          wBMinC = door.bbox.minC; wBMaxC = door.bbox.maxC; wBMinR = door.bbox.minR; wBMaxR = door.bbox.maxR;
        } else {
          // Piece never loaded (fetch failure etc.) — fall back to the
          // building instance's own footprintW/footprintD hints so the
          // town still gets *a* door instead of erroring out.
          wBMinC = bldg.gridX; wBMaxC = bldg.gridX + (bldg.footprintW ?? 1) - 1;
          wBMinR = bldg.gridZ; wBMaxR = bldg.gridZ + (bldg.footprintD ?? 1) - 1;
          eCol = Math.floor((bldg.gridX * 2 + (bldg.footprintW ?? 1) + 1) / 2);
          eRow = Math.min(TROWS_ENT - 1, bldg.gridZ + (bldg.footprintD ?? 1));
        }
        const eid = 'bldg_entrance_' + bldg.id;
        const worldTownTransitions = deps.getWorldTownTransitions();
        // A linked transition can carry coordinates derived from an older
        // piece shape. Snap it to the freshly loaded authored door and move
        // its already-rendered marker too, eliminating both the dead doorway
        // and the detached live teleport without duplicating either one.
        const linkedEntry = worldTownTransitions.find(t =>
          t.target === 'building' && t.buildingId === bldg.id);
        if (linkedEntry && (linkedEntry.col !== eCol || linkedEntry.row !== eRow)) {
          const oldCol = linkedEntry.col;
          const oldRow = linkedEntry.row;
          linkedEntry.col = eCol;
          linkedEntry.row = eRow;
          const linkedRing = townScene2.children.find(o => o.userData?.transitionId === linkedEntry.id);
          if (linkedRing) {
            const entranceTile = deps.getTownGrid()?.[eRow]?.[eCol];
            linkedRing.position.set(
              eCol + 0.5,
              deps.tileSurfaceY(entranceTile?.type || deps.TileType.GRASS) + 0.02,
              eRow + 0.5
            );
          }
          deps.debugLog(`Building entrance ${bldg.id}: corrected (${oldCol},${oldRow}) -> (${eCol},${eRow})`);
        }
        // Skip auto-entrance if workspace already defined a building transition within the rotated footprint
        const hasWorkspaceEntry = worldTownTransitions.some(t =>
          t.target === 'building' &&
          Number.isFinite(t.col) && Number.isFinite(t.row) &&
          t.col >= wBMinC && t.col <= wBMaxC &&
          t.row >= wBMinR && t.row <= wBMaxR);
        const hasAnyEntryAtDoor = worldTownTransitions.some(t => Number.isFinite(t.col) && Number.isFinite(t.row) && t.col === eCol && t.row === eRow);
        if (!hasWorkspaceEntry && !hasAnyEntryAtDoor && !worldTownTransitions.find(t => t.id === eid)) {
          worldTownTransitions.push({
            id: eid, area: 'town', col: eCol, row: eRow,
            target: 'interior',
            targetCol: Math.floor(deps.INTERIOR_COLS / 2), targetRow: deps.INTERIOR_ROWS - 2,
          });
          const ring = new THREE.Mesh(_entranceRingGeo, _entranceMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(eCol + 0.5, deps.tileSurfaceY(deps.TileType.GRASS) + 0.02, eRow + 0.5);
          townScene2.add(ring);
        }
      }

      deps.debugLog('_spawnTownBuildings: built ' + groups.length + ' buildings from piece JSON');

      // Upgrade to real bricks + shingle GLB once assets are ready
      if (!_townBuildingsGlbUpgradePending) {
        _townBuildingsGlbUpgradePending = true;
        Promise.all([
          deps.houseWallBuilder.loadDefaultGlb(),
          HousePieceGen.loadShingleGlb('assets/models/'),
        ]).then(() => {
          _townBuildingsGlbUpgradePending = false;
          _applyBuildingGlbTints();
          const townScene3 = deps.getTownScene();
          if (!townScene3) return;
          deps.debugLog('Town buildings: upgrading to real bricks + shingle GLB');
          const prev = deps.getTownBuildingGroups().slice();
          const upgraded = [];
          deps.setTownBuildingGroups(upgraded);
          for (const { group, bldg, piece, wbOpts, wbGableOpts } of prev) {
            townScene3.remove(group);
            group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            // A building whose piece never loaded still needs to stay in
            // the tracked group list (empty placeholder group) — dropping
            // it here previously meant isTownBuildingCollisionTile could
            // never bbox-fallback for it again for the rest of the session.
            if (!piece) { upgraded.push({ group: new THREE.Group(), bldg, piece: null, wbOpts, wbGableOpts }); continue; }
            const g = HousePieceGen.buildGroupFromPiece(THREE, piece, bldg.gridX, bldg.gridZ, {
              wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: false,
              wbOpts, wbGableOpts, matBoards: _boardsMat, matStone: _stoneMat, matCanvas: _canvasMat,
              rotationDeg: bldg.rotationDeg || 0,
            });
            townScene3.add(g);
            upgraded.push({ group: g, bldg, piece, wbOpts, wbGableOpts });
          }
        }).catch(e => deps.debugLog('Town building GLB error: ' + e, 'warn'));
      }
    });
  }

  // Mirrors spawnTownBuildings for an exterior zone map (Northern Cliffs,
  // its plateau-tier sub-maps, etc.) — buildings placed there get the same
  // piece-JSON geometry, but lifted to their anchor tile's plateau tier
  // (zoneData.buildings[].elevTier, resolved in game.js's mergeZoneTiles
  // loop) via HousePieceGen's elevationY option, instead of always sitting
  // at world Y 0 the way town buildings do today.
  function spawnZoneBuildings(mapId) {
    const zoneData = deps.zoneLayouts.get(mapId);
    const buildingDefs = zoneData?.buildings || [];
    if (!buildingDefs.length) return;
    if (typeof HousePieceGen === 'undefined') {
      deps.debugLog('HousePieceGen not loaded — skipping zone buildings', 'warn');
      return;
    }
    if (deps.zoneBuildingGroups.has(mapId)) return; // already spawned for this zone scene

    const groups = [];
    deps.zoneBuildingGroups.set(mapId, groups);

    const _wbDefaults = { unitMult: 0.4375, rockScale: 1.5,
                          preScale: [1, 1, 0.6],
                          brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };
    const _boardsMat = loadHousePieceFaceTexture('assets/textures/boards.png', 0x8b6914, 1.2);
    const _stoneMat  = loadHousePieceFaceTexture('assets/textures/carved_smooth.png', 0x888888, 1.5, '#4d4d4d');
    const _canvasMat = loadHousePieceFaceTexture('assets/textures/canvas.png', 0xcbb489, 2);

    Promise.all(buildingDefs.map(bldg => {
      if (!bldg.pieceFile) return Promise.resolve({ bldg, piece: null });
      return fetch(bldg.pieceFile)
        .then(r => r.json())
        .then(piece => ({ bldg, piece }))
        .catch(e => { deps.debugLog('Zone piece load error (' + bldg.id + '): ' + e, 'warn'); return { bldg, piece: null }; });
    })).then(results => {
      const scene = deps.zoneScenes.get(mapId)?.scene;
      if (!scene) return;

      for (const { bldg, piece } of results) {
        const wbOpts      = bldg.wbOpts      || _wbDefaults;
        const wbGableOpts = bldg.wbGableOpts || undefined;
        const elevationY  = deps.NORMAL_TOP + (bldg.elevTier || 0) * deps.PLATEAU_UNIT;

        let g = new THREE.Group();
        if (piece) {
          g = HousePieceGen.buildGroupFromPiece(THREE, piece, bldg.gridX, bldg.gridZ, {
            wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: true,
            wbOpts, wbGableOpts, matBoards: _boardsMat, matStone: _stoneMat, matCanvas: _canvasMat,
            rotationDeg: bldg.rotationDeg || 0, elevationY,
          });
        }
        scene.add(g);
        groups.push({ group: g, bldg, piece, wbOpts, wbGableOpts });
      }

      deps.debugLog(`_spawnZoneBuildings(${mapId}): built ${groups.length} buildings from piece JSON`);

      if (!deps.zoneBuildingsGlbUpgradePending.has(mapId)) {
        deps.zoneBuildingsGlbUpgradePending.add(mapId);
        Promise.all([
          deps.houseWallBuilder.loadDefaultGlb(),
          HousePieceGen.loadShingleGlb('assets/models/'),
        ]).then(() => {
          deps.zoneBuildingsGlbUpgradePending.delete(mapId);
          _applyBuildingGlbTints();
          const scene2 = deps.zoneScenes.get(mapId)?.scene;
          if (!scene2) return;
          deps.debugLog(`Zone buildings (${mapId}): upgrading to real bricks + shingle GLB`);
          const prev = groups.slice();
          groups.length = 0;
          for (const { group, bldg, piece, wbOpts, wbGableOpts } of prev) {
            scene2.remove(group);
            group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            // See spawnTownBuildings' matching upgrade loop: keep a
            // never-loaded building's entry (empty placeholder group)
            // instead of dropping it, so its collision bbox fallback
            // keeps working for the rest of the session.
            if (!piece) { groups.push({ group: new THREE.Group(), bldg, piece: null, wbOpts, wbGableOpts }); continue; }
            const elevationY = deps.NORMAL_TOP + (bldg.elevTier || 0) * deps.PLATEAU_UNIT;
            const g = HousePieceGen.buildGroupFromPiece(THREE, piece, bldg.gridX, bldg.gridZ, {
              wallBuilder: deps.houseWallBuilder, wbUsePlaceholder: false,
              wbOpts, wbGableOpts, matBoards: _boardsMat, matStone: _stoneMat, matCanvas: _canvasMat,
              rotationDeg: bldg.rotationDeg || 0, elevationY,
            });
            scene2.add(g);
            groups.push({ group: g, bldg, piece, wbOpts, wbGableOpts });
          }
        }).catch(e => deps.debugLog('Zone building GLB error: ' + e, 'warn'));
      }
    });
  }

  function spawnZoneDecorFurniture(mapId) {
    const zoneData = deps.zoneLayouts.get(mapId);
    const decorDefs = zoneData?.decor || [];
    const furnitureDefs = zoneData?.furniture || [];
    if (!decorDefs.length && !furnitureDefs.length) return;
    if (typeof window.ProceduralFurniture === 'undefined') {
      deps.debugLog('ProceduralFurniture not loaded — skipping zone decor/furniture', 'warn');
      return;
    }
    if (deps.zoneDecorFurnitureGroups.has(mapId)) return; // already spawned for this zone scene
    const scene = deps.zoneScenes.get(mapId)?.scene;
    if (!scene) return;

    const meshes = [];
    deps.zoneDecorFurnitureGroups.set(mapId, meshes);

    for (const d of decorDefs) {
      const result = deps.makeDecorativeFurnitureMesh(d.col, d.row, d.key, scene, mapId);
      if (!result) continue;
      const y = deps.NORMAL_TOP + (d.elevTier || 0) * deps.PLATEAU_UNIT;
      result.mesh.position.y += y;
      if (result.light) result.light.position.y += y;
      meshes.push(result.mesh);
    }
    for (const f of furnitureDefs) {
      const def = deps.PROCESSING_FURNITURE_DEFS[f.key];
      if (!def) continue;
      const group = deps.buildFurnitureVisual(f.key, def.color || 0x888888);
      const y = deps.NORMAL_TOP + (f.elevTier || 0) * deps.PLATEAU_UNIT;
      group.position.set(f.col + 0.5, y, f.row + 0.5);
      deps.markOutline(group);
      deps.markFurnitureEdgeId(group);
      scene.add(group);
      meshes.push(group);
      window.Music?.registerFurnitureSfxSource(mapId, f.col + 0.5, f.row + 0.5, window.Music?.resolveFurnitureSfx(def));
    }
    deps.debugLog(`_spawnZoneDecorFurniture(${mapId}): built ${decorDefs.length} decor + ${furnitureDefs.length} furniture props`);
  }

  window.TownZoneBuildings = {
    init,
    detectTownBuildings,
    loadHousePieceFaceTexture,
    spawnTownBuildings,
    spawnZoneBuildings,
    spawnZoneDecorFurniture,
  };
})();
