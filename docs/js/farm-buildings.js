(() => {
  'use strict';

  // Farm buildings: barns (movable, buildable via the Farm tab). A barn
  // instance: { id, kind:'barn', tier, col, row, w, h, stage }. stage is
  // 'foundation' (just placed, needs an interact-to-build) or 'built'
  // (rendered as the highland-style stable.json piece). The house is
  // tracked separately (game.js's houseCol/houseRow) since its GLB
  // rendering pipeline predates this system — farmBuildings only ever
  // holds barns. Both share the same move/placement validation
  // (canPlaceFarmBuilding).
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/farm-animals.js and
  // js/dew-vats.js. BARN_TIERS/farmBuildings/houseCol/houseRow are all
  // reassigned wholesale at various points in game.js (config load, farm
  // reset, moving the house), so they're threaded through as getters
  // (farmBuildings gets a setter too, for demolish/clear); _applyLoadedShopStock
  // (general shop-config loading, not barn-specific) stays in game.js and
  // keeps owning BARN_TIERS directly. findOpenTileNearBarn calls
  // window.FarmAnimals.canSpawnAt at call time rather than through deps,
  // matching how other already-extracted modules reach each other (e.g.
  // js/wild-treasure.js reading window.AlchemySystem/window.DyeSystem).
  // Every tier builds the same highland structure (config/pieces/stable.json)
  // once complete — there's no wood/stone system yet to justify authoring
  // three differently-sized piece files, so tiers differ only in slot
  // capacity and price, not in footprint or visual size.
  const BARN_PIECE_FILE = 'config/pieces/stable.json';
  const FOOTPRINT_W = 7;
  const FOOTPRINT_D = 3;

  // Tile types a farm building can never be placed/moved onto — trenches
  // and any worked/flooded soil. Rock/shrub/weeds are deliberately absent
  // here: those get bulldozed by clearFootprint() instead of blocking
  // placement. Built in init() (not at module-load time) since it needs
  // deps.TileType.
  let deps = null, blockedTileTypes;
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

  // Shared validity check for moving/placing any farm building (house or
  // barn): in bounds, no trench/tilled/raised/paddy/water tile or crop,
  // no other world object (furniture, crates, animals — anything already
  // occupying worldObjects) in the footprint, and no overlap with the
  // house or any other farm building. `excludeId` lets the building
  // being moved ignore its own current footprint/occupancy.
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
    if (excludeId !== 'highland_house' && rectsOverlap(col, row, w, h, deps.getHouseCol(), deps.getHouseRow(), deps.HOUSE_FOOTPRINT_W, deps.HOUSE_FOOTPRINT_D)) return false;
    for (const b of deps.getFarmBuildings()) {
      if (b.id === excludeId) continue;
      if (rectsOverlap(col, row, w, h, b.col, b.row, b.w, b.h)) return false;
    }
    return true;
  }

  // Bulldozes rock/shrub/weeds under a just-placed-or-moved building's
  // footprint back to plain grass — the "clears rocks and trees" half of
  // the Farm tab's move/place flow.
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

  // Fetches & caches stable.json once — every barn (any tier) reuses it.
  let _barnPiecePromise = null;
  function _loadBarnPiece() {
    if (!_barnPiecePromise) {
      _barnPiecePromise = fetch(BARN_PIECE_FILE).then(r => r.json())
        .catch(e => { deps.debugLog('Barn piece load error: ' + e, 'warn'); return null; });
    }
    return _barnPiecePromise;
  }

  const _barnWbDefaults = { unitMult: 0.4375, rockScale: 1.5, preScale: [1, 1, 0.6],
                             brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };
  let _barnBoardsMat = null, _barnStoneMat = null, _barnCanvasMat = null;
  function _barnFaceMats() {
    if (!_barnBoardsMat) {
      _barnBoardsMat = deps.loadHousePieceFaceTexture('assets/textures/boards.png', 0x8b6914, 1.2);
      _barnStoneMat  = deps.loadHousePieceFaceTexture('assets/textures/carved_smooth.png', 0x888888, 1.5);
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

  // Swaps a foundation's placeholder slab for the real highland
  // structure once construction completes — async since the piece JSON
  // is fetched lazily. Bails out quietly if the barn was demolished (or
  // reverted) while the fetch was in flight.
  function _buildStructureMesh(entry) {
    if (typeof HousePieceGen === 'undefined') { deps.debugLog('HousePieceGen not loaded — barn shown as foundation slab', 'warn'); return; }
    _loadBarnPiece().then(piece => {
      if (!piece || entry.stage !== 'built' || !deps.getFarmBuildings().includes(entry)) return;
      _disposeMesh(entry._mesh);
      entry._mesh = HousePieceGen.buildGroupFromPiece(THREE, piece, entry.col, entry.row, {
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
          { icon: '🐐', label: `Manage Livestock (${occupants}/${tier.slots})`, action: 'obj_barn_manage_' + entry.id, style: 'primary', allowed: deps.hasFarmPermission('livestock') },
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
        return { ok: false, message: 'Unknown barn action.' };
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

  function placePlan(tier, col, row) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can build here." };
    const tierDef = deps.getBarnTiers()[tier];
    if (!tierDef) return { ok: false, message: 'Unknown barn plan.' };
    if ((deps.inventory[tierDef.planItem] || 0) < 1) return { ok: false, message: `No ${tierDef.label} plan in your bag.` };
    if (!canPlaceAt(col, row, FOOTPRINT_W, FOOTPRINT_D)) {
      return { ok: false, message: 'Cannot build here — needs clear, untilled, un-trenched ground.' };
    }
    deps.inventory[tierDef.planItem]--;
    deps.clampInventoryStack(tierDef.planItem);
    const entry = {
      id: 'barn_' + Math.random().toString(36).slice(2, 10),
      kind: 'barn', tier, col, row, w: FOOTPRINT_W, h: FOOTPRINT_D, stage: 'foundation',
    };
    deps.getFarmBuildings().push(entry);
    spawnEntry(entry);
    clearFootprint(col, row, entry.w, entry.h);
    deps.saveFarmLayout();
    deps.saveMemberWorldData();
    return { ok: true, message: `Placed a ${tierDef.label} foundation. Interact with it to build.` };
  }

  // Removes a barn, refunding whatever materials it cost — currently
  // none, since there's no wood/stone system yet to have spent any; this
  // is where a future materials-cost system would credit the refund.
  // Any livestock housed here return to stasis rather than vanishing.
  function demolish(id) {
    const farmBuildings = deps.getFarmBuildings();
    const entry = farmBuildings.find(b => b.id === id);
    if (!entry) return { ok: false, message: 'Barn not found.' };
    const livestock = deps.loadWorldLivestock();
    livestock.forEach(l => {
      if (l.barnId !== id) return;
      l.barnId = null;
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

  // Moves the house or a barn to a new farm-grid top-left. `id` is
  // either 'highland_house' or a barn's own id.
  function move(id, newCol, newRow) {
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can move buildings." };
    if (id === 'highland_house') {
      if (!canPlaceAt(newCol, newRow, deps.HOUSE_FOOTPRINT_W, deps.HOUSE_FOOTPRINT_D, 'highland_house')) {
        return { ok: false, message: 'Cannot move the house there — needs clear, untilled, un-trenched ground.' };
      }
      deps.repositionHouse(newCol, newRow);
      clearFootprint(newCol, newRow, deps.HOUSE_FOOTPRINT_W, deps.HOUSE_FOOTPRINT_D);
      deps.saveFarmLayout();
      deps.saveMemberWorldData();
      return { ok: true, message: 'Moved the house.' };
    }
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

  // Ring-search outward from a barn's footprint for the nearest free
  // tile — livestock spawn/emerge just outside their own barn rather
  // than anywhere on the farm.
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
    FOOTPRINT_W: 7,
    FOOTPRINT_D: 3,
  };
})();
