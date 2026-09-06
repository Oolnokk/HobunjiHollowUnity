(() => {
  'use strict';

  // Farm editor (brush-paint tiles/crops/objects/furniture) and farm
  // layout persistence (the save/load format for the whole farm — tiles,
  // furniture, house pieces, barns, routes). Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // siblings. This is the highest-stakes extraction so far: it IS the
  // farm save format, so every dependency was individually verified for
  // reassignment before writing a line of this file.
  //
  // farmEditMode/farmEditBrushType/farmEditBrush are read from ~15 other
  // places throughout game.js (NPC dialogue routing, menu gating, pointer
  // handling, computeActionButtons...) that this extraction does not
  // touch, so — unlike _lootPools/_shopStock in loot-rolling.js — these
  // stay real game.js `let`s rather than being relocated here; threaded
  // through as getter+setter pairs instead. Same reasoning for grid/
  // currentArea/_playerData/housePieces/farmBuildings/worldRoutes/
  // worldNpcPaths/worldTransitions/shippingBoxObject/supplyBoxObject/
  // BARN_TIERS/HOUSE_PIECE_CATALOG — all game.js `let`s reassigned
  // elsewhere (BARN_TIERS/HOUSE_PIECE_CATALOG by _applyLoadedShopStock
  // once shop config loads; housePieces/farmBuildings/worldRoutes/etc. by
  // map-editor-import and world-load code) — reusing the exact
  // getHousePieces/getFarmBuildings/getBarnTiers/getHousePieceCatalog/
  // getWorldNpcPaths names other modules' init() calls already
  // established for these same variables, adding matching new ones
  // (getWorldRoutes/getWorldTransitions/getFarmEditBrushType/
  // getFarmEditBrush/setFarmEditMode/setFarmEditBrushType/
  // setFarmEditBrush/setShippingBoxObject/setSupplyBoxObject) where none
  // existed yet. worldObjects/processingFurnitureObjects/
  // interiorFurnitureObjects/PROCESSING_FURNITURE_DEFS/
  // DECORATIVE_FURNITURE_DEFS are `const`s only ever mutated in place, so
  // they're passed by direct reference. scene/interiorScene are also
  // `const`s never reassigned, but this module's init() runs very early
  // (right after createInitialGrid(), before either is declared further
  // down in game.js — same forward-reference position as
  // window.WaterSystem.init() just above it), so they're threaded as
  // getScene()/getInteriorScene() getters instead of plain properties: a
  // plain property would eagerly evaluate the still-undeclared `const`
  // the moment this init() object literal is built and throw.
  let deps = null;
  function init(injectedDeps) {
    deps = injectedDeps;
    _bindListeners();
  }

  // ── Farm editor ───────────────────────────────────────────────
  function toggleFarmEditMode() {
    // The farm editor freely repaints tiles/crops and drops/removes
    // furniture with no per-brush permission checks, so it's gated at
    // this single entry point instead — only the farm's owner can open it.
    const farmEditMode = deps.getFarmEditMode();
    if (!farmEditMode && !deps.isFarmOwner()) {
      deps.showToast("Only the farm's owner can use the farm editor.", false);
      return;
    }
    const next = !farmEditMode;
    deps.setFarmEditMode(next);
    const panel = document.getElementById('farmEditorPanel');
    const btn   = document.getElementById('farmEditBtn');
    if (panel) panel.style.display = next ? 'flex' : 'none';
    if (btn)   btn.classList.toggle('fed-open', next);
    if (next) deps.showToast('Farm editor active — click tiles to paint.', true);
  }

  function farmEditorSetBrush(type, value) {
    deps.setFarmEditBrushType(type);
    deps.setFarmEditBrush(value);
    document.querySelectorAll('.fed-btn').forEach(b => b.classList.remove('fed-active'));
    const sel = document.querySelector(`.fed-btn[data-btype="${type}"][data-bval="${value}"]`);
    if (sel) sel.classList.add('fed-active');
  }

  function applyFarmEditBrush(col, row) {
    if (!deps.getFarmEditMode()) return;
    if (col < 0 || col >= deps.COLS || row < 0 || row >= deps.ROWS) return;
    if (deps.getCurrentArea() === 'farm' && deps.isHouseFootprint(col, row)) return;
    const grid = deps.getGrid();
    const tile = grid[row]?.[col];
    if (!tile) return;

    const farmEditBrushType = deps.getFarmEditBrushType();
    const farmEditBrush = deps.getFarmEditBrush();

    if (farmEditBrushType === 'terrain') {
      const typeMap = {
        grass: deps.TileType.GRASS, weeds: deps.TileType.WEEDS, rock: deps.TileType.ROCK,
        shrub: deps.TileType.SHRUB, tilled: deps.TileType.TILLED, raised: deps.TileType.RAISED, trench: deps.TileType.TRENCH
      };
      tile.type = typeMap[farmEditBrush] ?? deps.TileType.GRASS;
      if (tile.type === deps.TileType.TRENCH) tile.depth = 1;
      tile.crop = deps.CropType.NONE; tile.cropAge = 0; tile.cropReady = false;
      if (tile.dewPile) { tile.dewPile = null; window.DewVats.removeMesh(col, row); }
      deps.markTileDirty(col, row); window.WaterSystem.recomputeWater(false); saveFarmLayout();
    } else if (farmEditBrushType === 'crop') {
      if (tile.type === deps.TileType.ROCK || tile.type === deps.TileType.SHRUB) tile.type = deps.TileType.TILLED;
      if (tile.type !== deps.TileType.TILLED && tile.type !== deps.TileType.GRASS && tile.type !== deps.TileType.RAISED) tile.type = deps.TileType.TILLED;
      tile.crop = farmEditBrush; tile.cropAge = 50; tile.cropReady = false;
      deps.markTileDirty(col, row); saveFarmLayout();
    } else if (farmEditBrushType === 'object') {
      _editorMoveObject(col, row, farmEditBrush);
    } else if (farmEditBrushType === 'furniture') {
      // Place processing furniture without consuming inventory (editor mode)
      if (!deps.canPlaceFurnitureAt(col, row)) { deps.showToast('Cannot place furniture here.', false); return; }
      const def = deps.PROCESSING_FURNITURE_DEFS[farmEditBrush];
      if (!def) return;
      const obj = deps.makeProcessingFurniture(col, row, farmEditBrush);
      if (obj) { deps.worldObjects.set(col + ',' + row, obj); deps.processingFurnitureObjects.add(obj); saveFarmLayout(); }
    } else if (farmEditBrushType === 'erase') {
      const obj = deps.getWorldObjectAt(col, row);
      if (obj && obj.type === 'processing_furniture') {
        deps.worldObjects.delete(col + ',' + row); obj.reset && obj.reset(); deps.processingFurnitureObjects.delete(obj);
      }
      // Also remove decorative furniture at this tile
      const decIdx = deps.interiorFurnitureObjects.findIndex(o => o.col === col && o.row === row && o.area === 'farm');
      if (decIdx >= 0) {
        const d = deps.interiorFurnitureObjects.splice(decIdx, 1)[0];
        deps.getScene().remove(d.mesh);
        d.mesh.traverse && d.mesh.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
        if (d.light) deps.getScene().remove(d.light);
        window.Music?.unregisterFurnitureSfxSource(d.sfxSource);
        if (deps.DECORATIVE_FURNITURE_DEFS[d.key]?.sit) deps.worldObjects.delete(col + ',' + row);
        deps.unregisterChairNpcStation(d.key, col, row, 'farm');
      }
      tile.type = deps.TileType.GRASS; tile.crop = deps.CropType.NONE; tile.cropAge = 0; tile.cropReady = false;
      if (tile.dewPile) { tile.dewPile = null; window.DewVats.removeMesh(col, row); }
      deps.markTileDirty(col, row); window.WaterSystem.recomputeWater(false); saveFarmLayout();
    }
  }

  function _editorMoveObject(col, row, objectType) {
    if (deps.isHouseFootprint(col, row)) { deps.showToast('Cannot place objects on house footprint.', false); return; }
    if (deps.getWorldObjectAt(col, row)) { deps.showToast('Tile already occupied.', false); return; }
    if (objectType === 'sellCrate' && deps.getShippingBoxObject()) {
      const old = deps.getShippingBoxObject();
      deps.worldObjects.delete(old.col + ',' + old.row);
      if (old.mesh) deps.getScene().remove(old.mesh);
      if (old.lid)  deps.getScene().remove(old.lid);
      const nc = window.FarmCrates.makeSellCrate(col, row);
      deps.setShippingBoxObject(nc); deps.worldObjects.set(col + ',' + row, nc);
      saveFarmLayout(); deps.showToast('Shipping box moved.', true);
    } else if (objectType === 'supplyBox' && deps.getSupplyBoxObject()) {
      const old = deps.getSupplyBoxObject();
      deps.worldObjects.delete(old.col + ',' + old.row);
      if (old.mesh) deps.getScene().remove(old.mesh);
      if (old.lid)  deps.getScene().remove(old.lid);
      const nb = window.FarmCrates.makeSupplyBox(col, row);
      deps.setSupplyBoxObject(nb); deps.worldObjects.set(col + ',' + row, nb);
      saveFarmLayout(); deps.showToast('Supply box moved.', true);
    }
  }

  // ── Farm layout persistence ───────────────────────────────────
  // Namespaced per world so separate worlds never bleed into each other's
  // farm. worldId isn't known until onboarding's hobunjiPlayerReady event
  // fires (after this module's synchronous init already ran once), so
  // early calls fall back to the legacy unnamespaced key — spawnPlayerAvatar
  // re-reads and re-applies the correctly-namespaced layout once the real
  // worldId is known (see the resync block there).
  const FARM_LAYOUT_KEY = 'hobunji_farm_layout_v3';

  function farmLayoutKey() {
    const worldId = (window.__hobunjiPlayerProfile || deps.getPlayerData())?.worldId;
    return worldId ? (FARM_LAYOUT_KEY + ':' + worldId) : FARM_LAYOUT_KEY;
  }

  function saveFarmLayout() {
    try {
      const grid = deps.getGrid();
      const shippingBoxObject = deps.getShippingBoxObject();
      const supplyBoxObject = deps.getSupplyBoxObject();
      const layout = { version: 3, tiles: [], objects: {}, furniture: [], decor: [] };
      if (shippingBoxObject) layout.objects.sellCrate = [shippingBoxObject.col, shippingBoxObject.row];
      if (supplyBoxObject)   layout.objects.supplyBox = [supplyBoxObject.col, supplyBoxObject.row];
      for (let r = 0; r < deps.ROWS; r++) {
        for (let c = 0; c < deps.COLS; c++) {
          const t = grid[r][c];
          const def = deps.createDayOneTile(c, r);
          if (t.type !== def.type || (t.crop && t.crop !== deps.CropType.NONE) || t.dewPile) {
            layout.tiles.push({ c, r, type: t.type, depth: t.type === deps.TileType.TRENCH && Number.isFinite(t.depth) ? window.FormatUtils.clamp(t.depth, 0, 1) : 0, crop: t.crop || '', dewPile: t.dewPile || '',
              cropAge: t.crop && t.crop !== deps.CropType.NONE ? t.cropAge : undefined,
              cropReady: t.crop && t.crop !== deps.CropType.NONE ? !!t.cropReady : undefined });
          }
        }
      }
      deps.processingFurnitureObjects.forEach(obj => {
        const job = obj.getJob && obj.getJob();
        layout.furniture.push({ key: obj.furnitureKey, col: obj.col, row: obj.row, rotYDeg: obj.rotYDeg || 0, ...(job ? { job } : {}) });
      });
      deps.interiorFurnitureObjects.forEach(obj => {
        layout.decor.push({ id: obj.id, key: obj.key, col: obj.col, row: obj.row, area: obj.area,
          rotYDeg: obj.rotYDeg || 0, ownerPieceId: obj.ownerPieceId || null,
          localCol: Number.isFinite(obj.localCol) ? obj.localCol : null,
          localRow: Number.isFinite(obj.localRow) ? obj.localRow : null });
      });
      // Movable buildings — every house piece (starter + built/foundation
      // deeds) and every barn (foundation or built). Added as extra fields
      // on the same version-3 shape rather than bumping the version, so
      // older saves without these fields still load fine.
      const housePieces = deps.getHousePieces();
      if (housePieces.length) {
        layout.housePieces = housePieces.map(p => ({
          id: p.id, pieceKey: p.pieceKey, col: p.col, row: p.row, w: p.w, h: p.h, stage: p.stage, roofAxis: p.roofAxis || null,
          features: (p.features || []).map(f => ({ id: f.id, type: f.type, lx: f.lx, ly: f.ly, side: f.side, edgeSlot: f.edgeSlot, autoGenerated: !!f.autoGenerated })),
        }));
      }
      // Manual entrances/chimneys removed or displaced by a piece's own
      // wall, recovered rather than deleted (see house-pieces.js's
      // architectural features) — independent of any one piece's
      // position, so saved at the top level, not per piece.
      const fixtureInventory = window.HousePieces.getFixtureInventory();
      if (fixtureInventory.length) layout.architecturalInventory = fixtureInventory;
      const farmBuildings = deps.getFarmBuildings();
      if (farmBuildings.length) {
        layout.buildings = farmBuildings.map(b => ({ id: b.id, kind: b.kind, tier: b.tier, col: b.col, row: b.row, w: b.w, h: b.h, stage: b.stage, ...(b.troughs ? { troughs: b.troughs } : {}) }));
      }
      // Preserve map-editor-authored travel data through in-game saves
      const worldRoutes = deps.getWorldRoutes(), worldNpcPaths = deps.getWorldNpcPaths(), worldTransitions = deps.getWorldTransitions();
      if (worldRoutes.length)      layout.routes      = worldRoutes;
      if (worldNpcPaths.length)    layout.npcPaths    = worldNpcPaths; // legacy compatibility
      if (worldTransitions.length) layout.transitions = worldTransitions;
      localStorage.setItem(farmLayoutKey(), JSON.stringify(layout));
      return true;
    } catch (error) {
      console.error('saveFarmLayout:', error);
      deps.debugLog('Farm layout save failed: ' + (error?.message || error), 'error');
      return false;
    }
  }

  function loadFarmLayout() {
    try {
      const raw = localStorage.getItem(farmLayoutKey());
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function applyFarmLayoutToGrid(layout, { refreshVisuals = false } = {}) {
    if (!layout || layout.version !== 3) return;
    const grid = deps.getGrid();
    (layout.tiles || []).forEach(({ c, r, type, depth, crop, dewPile, cropAge, cropReady }) => {
      if (grid[r]?.[c]) {
        const previousType = grid[r][c].type; // Used below to skip visual refreshes for non-terrain save data.
        const previousDepth = grid[r][c].depth; // Used below to detect restored trench-depth changes.
        grid[r][c].type = type;
        // Older layouts omit depth; treat those trenches as fully dug.
        grid[r][c].depth = type === deps.TileType.TRENCH
          ? (Number.isFinite(depth) ? window.FormatUtils.clamp(depth, 0, 1) : 1)
          : 0;
        grid[r][c].crop = crop || deps.CropType.NONE;
        if (crop) {
          // Older layouts (and any other caller that omits cropAge) predate
          // persisting real growth progress — fall back to the previous
          // "fully grown but not yet flagged ready" placeholder, which
          // self-corrects at the next morning's tickCropDay(). A layout
          // that does carry real progress must restore it as-is: forcing
          // cropReady=false here regardless of actual state used to demote
          // an already-ripe, uncollected crop back to "growing" on every
          // reload/re-entry, silently blocking harvest until the next day.
          grid[r][c].cropAge = Number.isFinite(cropAge) ? cropAge : 50;
          grid[r][c].cropReady = Number.isFinite(cropAge) ? !!cropReady : false;
        }
        grid[r][c].dewPile = dewPile || null;
        if (refreshVisuals && (previousType !== grid[r][c].type || previousDepth !== grid[r][c].depth)) {
          deps.markTileDirty(c, r);
        }
      }
    });
  }

  // Cleans up a legacy bug: createInitialGrid() used to stamp a hardcoded
  // 3x5 raw-tile "north exit to town" road onto every brand-new farm,
  // duplicating the real farm<->town connector (which is authored as a
  // proper route with its own paved brick surface — see worldRoutes).
  // That raw stub got persisted into every save the first time it ran
  // (its tile.type differs from createDayOneTile's own default, so
  // saveFarmLayout always wrote it out explicitly), so simply removing
  // the stamp from createInitialGrid doesn't clear it from saves that
  // already have it — applyFarmLayoutToGrid would just restore it from
  // layout.tiles again. Revert each of those exact tiles back to a fresh
  // default, but only if it still looks untouched (still a bare path
  // tile, never tilled/planted/dug), so a player who deliberately built
  // or farmed over that spot keeps whatever they made there.
  const LEGACY_FARM_ENTRANCE_PATH_TILES = [
    [16,0],[17,0],[18,0],
    [16,1],[17,1],[18,1],
    [16,2],[17,2],[18,2],
    [16,3],[17,3],[18,3],
    [16,4],[17,4],[18,4],
  ];
  function cleanupLegacyFarmEntranceRoad() {
    const grid = deps.getGrid();
    for (const [c, r] of LEGACY_FARM_ENTRANCE_PATH_TILES) {
      const t = grid[r]?.[c];
      if (!t || t.type !== deps.TileType.PATH) continue;
      if (t.crop && t.crop !== deps.CropType.NONE) continue;
      if (t.dewPile || t.depth) continue;
      const def = deps.createDayOneTile(c, r);
      t.type = def.type;
      t.variation = def.variation;
    }
  }

  function applyFarmLayoutObjects(layout) {
    if (!layout || layout.version !== 3) return;
    if (layout.objects?.sellCrate) {
      const [c, r] = layout.objects.sellCrate;
      const shippingBoxObject = deps.getShippingBoxObject();
      if (shippingBoxObject && (shippingBoxObject.col !== c || shippingBoxObject.row !== r)) {
        deps.worldObjects.delete(shippingBoxObject.col + ',' + shippingBoxObject.row);
        shippingBoxObject.reset && shippingBoxObject.reset();
        const nc = window.FarmCrates.makeSellCrate(c, r); deps.setShippingBoxObject(nc); deps.worldObjects.set(c + ',' + r, nc);
      }
    }
    if (layout.objects?.supplyBox) {
      const [c, r] = layout.objects.supplyBox;
      const supplyBoxObject = deps.getSupplyBoxObject();
      if (supplyBoxObject && (supplyBoxObject.col !== c || supplyBoxObject.row !== r)) {
        deps.worldObjects.delete(supplyBoxObject.col + ',' + supplyBoxObject.row);
        supplyBoxObject.reset && supplyBoxObject.reset();
        const nb = window.FarmCrates.makeSupplyBox(c, r); deps.setSupplyBoxObject(nb); deps.worldObjects.set(c + ',' + r, nb);
      }
    }
    (layout.furniture || []).forEach(({ key, col, row, job, rotYDeg }) => {
      // Guarded per-entry: one malformed saved processing station must not
      // throw and abort the rest of this restore (decor, house pieces,
      // barns, dew-pile meshes all run after this loop in the same call).
      try {
        if (deps.PROCESSING_FURNITURE_DEFS[key] && deps.canPlaceFurnitureAt(col, row)) {
          const obj = deps.makeProcessingFurniture(col, row, key, job, rotYDeg || 0);
          if (obj) { deps.worldObjects.set(col + ',' + row, obj); deps.processingFurnitureObjects.add(obj); }
        }
      } catch (err) {
        console.error('[farm-editor] failed to restore processing furniture', { key, col, row }, err);
      }
    });
    (layout.decor || []).forEach(({ id, key, col, row, area, rotYDeg, ownerPieceId, localCol, localRow }) => {
      try {
        const def = deps.DECORATIVE_FURNITURE_DEFS[key];
        if (!def) return;
        const decorArea = area || 'farm';
        const targetScene = decorArea === 'interior' ? deps.getInteriorScene() : deps.getScene();
        const result = deps.makeDecorativeFurnitureMesh(col, row, key, targetScene, decorArea, rotYDeg || 0);
        const owner = decorArea === 'interior' && !ownerPieceId ? deps.furnitureOwnerFields(col, row) : {};
        if (result) deps.interiorFurnitureObjects.push({ id: id || 'decor_' + Math.random().toString(36).slice(2, 10), key, col, row,
          mesh: result.mesh, light: result.light, sfxSource: result.sfxSource, area: decorArea, rotYDeg: rotYDeg || 0,
          ownerPieceId: ownerPieceId || owner.ownerPieceId, localCol: Number.isFinite(localCol) ? localCol : owner.localCol,
          localRow: Number.isFinite(localRow) ? localRow : owner.localRow });
        if (result && decorArea === 'farm' && def.sit) {
          const size = deps.decorativeFurnitureSize(key, rotYDeg || 0);
          deps.registerSitWorldObject(key, col, row, size.fw, size.fd, rotYDeg || 0);
        }
        if (result) deps.registerChairNpcStation(key, col, row, rotYDeg || 0, deps.normalizeNpcArea(decorArea));
      } catch (err) {
        console.error('[farm-editor] failed to restore decorative furniture', { key, col, row, area }, err);
      }
    });
    // House pieces — initWorldObjects() already seeded the starter piece at
    // its hard default position before this runs. A modern save's own
    // housePieces array may have moved the starter (a legacy "Move
    // Building" save carried forward) and/or built additional deed
    // pieces; an old pre-modular-house save only ever has the legacy
    // houseCol/houseRow fields, which just repositions the starter with
    // nothing else to restore.
    const housePieces = deps.getHousePieces();
    let starterEntry = housePieces.find(p => p.id === 'house_starter');
    if (Array.isArray(layout.housePieces) && layout.housePieces.length) {
      const savedStarter = layout.housePieces.find(p => p.id === 'house_starter');
      const housePieceCatalog = deps.getHousePieceCatalog();
      if (savedStarter) {
        // Restore the saved records themselves instead of reseeding a
        // default starter pair and skipping pieceKey:'starter'. The old
        // path restored the main room but silently reset a rearranged
        // starter annex to its default position on every reload.
        window.HousePieces.clearAll();
        layout.housePieces.forEach(saved => {
          const def = saved.pieceKey === 'starter' ? housePieceCatalog.starter : housePieceCatalog[saved.pieceKey];
          if (!def || !saved.id) return;
          const entry = {
            id: saved.id, pieceKey: saved.pieceKey, col: saved.col, row: saved.row,
            w: saved.w || def.w, h: saved.h || def.h, stage: saved.stage || 'foundation',
            roofAxis: saved.roofAxis || null,
            features: Array.isArray(saved.features) ? saved.features.map(f => ({ ...f })) : [],
          };
          housePieces.push(entry);
          window.HousePieces.spawnEntry(entry);
        });
        starterEntry = housePieces.find(p => p.id === 'house_starter');
      } else {
        // Transitional saves with deeds but no explicit main-room record.
        layout.housePieces.forEach(saved => {
          if (saved.pieceKey === 'starter' || !housePieceCatalog[saved.pieceKey] || housePieces.some(p => p.id === saved.id)) return;
          const def = housePieceCatalog[saved.pieceKey];
          const entry = { id: saved.id, pieceKey: saved.pieceKey, col: saved.col, row: saved.row,
            w: saved.w || def.w, h: saved.h || def.h, stage: saved.stage || 'foundation',
            roofAxis: saved.roofAxis || null, features: saved.features || [] };
          housePieces.push(entry);
          window.HousePieces.spawnEntry(entry);
        });
      }
    } else if (Number.isFinite(layout.houseCol) && Number.isFinite(layout.houseRow) && starterEntry
               && (layout.houseCol !== starterEntry.col || layout.houseRow !== starterEntry.row)) {
      window.HousePieces.clearAll();
      window.HousePieces.seedStarter(layout.houseCol, layout.houseRow);
    }
    // Manual entrances/chimneys recovered by removal or a wall junction —
    // independent of any one piece's position, so restored unconditionally
    // here rather than inside either branch above.
    window.HousePieces.loadFixtureInventory(layout.architecturalInventory);
    // Re-derive global furniture coordinates from the room-local values
    // only after every room has been restored. This is deliberately a
    // no-op transform: it repairs old/global coordinates while keeping
    // the saved local placement unchanged.
    housePieces.filter(p => p.stage === 'built').forEach(piece => {
      const rect = { col: piece.col, row: piece.row, w: piece.w, h: piece.h };
      deps.transformFurnitureWithHousePiece(piece.id, rect, rect, false);
    });
    deps.rebuildInteriorGeometry();
    const farmBuildings = deps.getFarmBuildings();
    const barnTiers = deps.getBarnTiers();
    (layout.buildings || []).forEach(saved => {
      try {
        if (saved.kind !== 'barn' || !barnTiers[saved.tier]) return;
        if (farmBuildings.some(b => b.id === saved.id)) return;
        const entry = { id: saved.id, kind: 'barn', tier: saved.tier, col: saved.col, row: saved.row, w: saved.w || window.FarmBuildings.FOOTPRINT_W, h: saved.h || window.FarmBuildings.FOOTPRINT_D, stage: saved.stage || 'foundation', ...(Array.isArray(saved.troughs) ? { troughs: saved.troughs } : {}) };
        farmBuildings.push(entry);
        window.FarmBuildings.spawnEntry(entry);
      } catch (err) {
        console.error('[farm-editor] failed to restore barn', saved, err);
      }
    });
    // Tile data (grid[r][c].dewPile) is restored by applyFarmLayoutToGrid,
    // which always runs first (see the two call sites) — this just builds
    // the meshes for whatever dew piles are already sitting in the grid,
    // same two-phase split as furniture (data now, objects/meshes here).
    window.DewVats.rebuildMeshesFromGrid();
  }

  // ── Farm editor pointer handlers ──────────────────────────────
  let _editorPainting = false;
  function _bindListeners() {
    deps.threeContainer.addEventListener('pointerdown', (e) => {
      if (deps.getArmedFurniturePlacementKey() || deps.getArmedFurnitureMoveId() || !deps.getFarmEditMode() || deps.getCurrentArea() !== 'farm') return;
      e.stopPropagation();
      _editorPainting = true;
      const t = deps._screenToFarmTile(e.clientX, e.clientY);
      if (t) applyFarmEditBrush(t.col, t.row);
    });
    deps.threeContainer.addEventListener('pointermove', (e) => {
      if (deps.getArmedFurniturePlacementKey() || deps.getArmedFurnitureMoveId() || !deps.getFarmEditMode() || deps.getCurrentArea() !== 'farm' || !_editorPainting) return;
      e.stopPropagation();
      const t = deps._screenToFarmTile(e.clientX, e.clientY);
      if (t) applyFarmEditBrush(t.col, t.row);
    });
    window.addEventListener('pointerup', () => { _editorPainting = false; });

    // Expose farm editor to the HTML panel buttons
    window._farmEditor = {
      toggle: toggleFarmEditMode,
      setBrush: farmEditorSetBrush,
      save: saveFarmLayout,
      clearLayout: () => {
        try { localStorage.removeItem(farmLayoutKey()); } catch {}
        deps.showToast('Saved layout cleared. Reset the farm to apply.', true);
      },
    };
  }

  window.FarmEditor = {
    init,
    toggleFarmEditMode, farmEditorSetBrush, applyFarmEditBrush,
    farmLayoutKey, saveFarmLayout, loadFarmLayout, applyFarmLayoutToGrid,
    cleanupLegacyFarmEntranceRoad, applyFarmLayoutObjects,
  };
})();
