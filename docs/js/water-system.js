(() => {
  'use strict';

  // The per-tile grid water simulation (rain/absorption/evaporation/cross-tile
  // flow, trench siltation, far-terrain edge tracking) plus the merged-mesh
  // renderer that turns that simulation into batched draw calls for the farm,
  // town, and wilderness zones. Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern as its sibling systems (see
  // js/weather-fx.js).
  //
  // Ordering note: unlike WeatherFX (whose init() runs late, since
  // createInitialGrid() deliberately never rolls weather), game.js's very
  // first grid build calls recomputeWater() synchronously to settle day-one
  // water levels — so window.WaterSystem.init(deps) must run before that
  // call, earlier than this module's sibling inits. Every game.js binding
  // this module reads is therefore threaded through as a getter (or, for
  // values already assigned by that point — ROWS/COLS/TileType/calendar/
  // MAX_WATER/RAIN_RATE/clamp/debugLog/isSolid/tileSurfaceY/markTileDirty/
  // _markTerrainEdgeId, all consts or hoisted function declarations from
  // earlier in the file — passed directly) rather than read once at init
  // time, so it doesn't matter that some of them (scene, SLAB_H, WATER_UNIT,
  // townScene, grid, townGrid, _townZone, _zoneWaterMeshes) aren't actually
  // assigned yet when init() runs.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // ── Water simulation constants ──
  // Water is a float depth (0..MAX_WATER) sitting above the tile floor.
  // Floor Z: RAISED=+1, GRASS/TILLED/PADDY/WEEDS=0, TRENCH=-1, ROCK/SHRUB=solid(no water)
  // Water surface = floorZ + water depth.
  // MAX_WATER/RAIN_RATE stay in game.js (deps.MAX_WATER/deps.RAIN_RATE) —
  // both are also read by unrelated game.js code (HUD precip readout, day-one
  // pond init, crop water-fitness, AudioSystem's splash threshold).
  const ABSORB_RATE  = {     // depth drained per tick by soil absorption
    grass:  0.012,  // doubled — grass roots drink efficiently
    weeds:  0.008,
    tilled: 0.018,  // broken soil drains fastest (no root binding)
    raised: 0.025,  // elevated — gravity-drains quickly
    paddy:  0.003,  // sealed low bowl, retains water
    trench: 0.000,  // sealed clay — no absorption, only flow
    rock:   0,
    shrub:  0,
    path:   0.006, // hard-packed surface drains slowly
  };
  const EVAP_RATE    = 0.002;  // evapotranspiration — drains all tiles slowly even when dry
  const FLOW_RATE         = 0.45;  // fraction of head difference transferred per tick
  const TRENCH_FLOW_BONUS = 3.0;   // trenches pull water from neighbours faster (scaled by tile.depth)
  // West/east edges seep water in from the surrounding far terrain (instead of
  // only the south edge draining out) so a player can't starve the whole
  // irrigation system just by damming the north-south channel — the far
  // terrain still gets in from the sides. Fraction of the gap to the far
  // terrain's level closed per tick.
  const SIDE_INFLOW_RATE  = 0.06;
  // How fast the far terrain immediately south of the map (the decorative
  // border terrain) tracks the south-edge tile's water level, per column.
  // Low = the gap a player digs at the south edge visibly continues into
  // the far terrain rather than snapping dry/wet instantly.
  const FAR_SOUTH_TRACK_RATE = 0.2;
  // Rain gradually silts trenches back in — depth drains while raining and the
  // trench reverts to grass once fully filled. Redigging (single tap) restores depth to 1.
  const TRENCH_SILT_RATE  = 0.0006;  // depth lost per sim tick, per unit rain strength

  // ── Merged water mesh apron constants ──
  const FAR_APRON_ROWS = 2;      // how many tile-rows of apron beyond the seam
  const FAR_APRON_FALLOFF = 0.55; // depth multiplier per extra apron row out

  // Helper: floor Z for a tile type. Trenches shallow out toward 0 as they silt up.
  function floorZ(type, depth = 1) {
    const TileType = deps.TileType;
    if (type === TileType.RAISED) return  1;
    if (type === TileType.TRENCH) return -deps.clamp(depth, 0, 1);
    return 0;  // ROCK, SHRUB, and all normal tiles sit at Z=0
  }
  // Max water a tile can hold — trenches scale down with depth as they silt in.
  function tileWaterCapacity(tile) {
    return tile.type === deps.TileType.TRENCH ? deps.MAX_WATER * deps.clamp(tile.depth ?? 1, 0, 1) : deps.MAX_WATER;
  }

  // Per-column water level (0..1) of the far terrain immediately south of
  // the farm's playable grid — tracks each column's south-edge tile so a
  // player-made gap in the water reaching the bottom row continues into
  // the far terrain beyond the map instead of stopping dead at the seam.
  let farSouthLevel = null; // sized to COLS on first use (deps.COLS is stable)
  // The town's average water level (0..1), refreshed every time the town's
  // water sim ticks. The farm's far terrain (and its west/east edge inflow)
  // tracks this, so the town's own water state shows up out past the farm's
  // playable edges. Town itself has no "upstream" grid to draw from, so its
  // own far terrain/edge inflow tracks its own average instead (see
  // recomputeWater's farLevel computation).
  let _townWaterLevel = 0.5;

  function _farSouthLevel() {
    if (!farSouthLevel) farSouthLevel = new Float32Array(deps.COLS).fill(0.5);
    return farSouthLevel;
  }

  // Average water fraction (0..1) across a grid's non-solid tiles — used
  // as the "how wet is this place overall" reading the far terrain and
  // edge inflow track. Rivers/streams are included at their pinned
  // MAX_WATER, same as any other tile, since they're real wet ground.
  function avgGridWaterLevel(targetGrid, rows, cols) {
    let sum = 0, n = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const t = targetGrid[row][col];
        if (deps.isSolid(t.type)) continue;
        sum += t.water / deps.MAX_WATER;
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  // ═══════════════════════════════════════════════════════════════
  //  WATER SIMULATION
  //  Model: each tile has a float `water` = depth above its floor.
  //  Floor Z: RAISED=+1, normal=0, TRENCH=-1, ROCK/SHRUB=solid (no flow).
  //  Water surface = floorZ(type) + water.
  //  Each sim tick (called from gameLoop ~every 0.7s):
  //    1. Rain adds depth to every non-solid tile.
  //    2. Soil absorption drains a small amount.
  //    3. Cross-tile flow: water moves from high-surface to low-surface
  //       neighbours, south-biased, half-difference per tick.
  //       Trenches pull with TRENCH_FLOW_BONUS multiplier.
  //    4. Overflow: any water above MAX_WATER is shed to neighbours.
  //  Edges: south is a runoff outlet (always was); west/east instead seep
  //  water IN from the surrounding far terrain, so damming the north-south
  //  channel alone can't cut off the whole map (see SIDE_INFLOW_RATE).
  //  The farm's far terrain tracks the town's overall water level; the
  //  town (having no upstream grid of its own) tracks its own average.
  //  Whatever water actually reaches each south-edge column also drives
  //  that column's far-terrain level just past the map's south edge, so a
  //  player-made dry gap at the bottom row continues out into the far
  //  terrain instead of stopping dead at the seam (farSouthLevel/townSouthLevel).
  // ═══════════════════════════════════════════════════════════════
  let _waterSimDirty = true;
  let _townWaterSimDirty = true;

  function recomputeWater(decayOnly, targetGrid = deps.getGrid(), rows = deps.ROWS, cols = deps.COLS) {
    const TileType = deps.TileType, clamp = deps.clamp;
    const calendar = deps.calendar;
    const str = calendar.rainStrength || 1;
    const isRaining = calendar.isRaining && !decayOnly;
    const isTown = targetGrid === deps.getTownGrid();

    // The far terrain's level for this grid's edges: the town tracks its
    // own average (it has nothing upstream of it); the farm tracks the
    // town's last-known average, so the town's water shows up beyond the
    // farm's edges too. Read before Pass 1 mutates anything, one tick of
    // lag is imperceptible at this sim's ~0.7s cadence.
    const farLevel = isTown ? avgGridWaterLevel(targetGrid, rows, cols) : _townWaterLevel;
    if (isTown) _townWaterLevel = farLevel;

    // Pass 1: rain + absorption + evaporation + edge exchange
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const t = targetGrid[row][col];
        if (deps.isSolid(t.type)) continue;
        t.flow = false;

        // Rivers/streams are a permanent water body, not part of the
        // irrigation sim — always full, never absorbed/evaporated/drained.
        if (t.type === TileType.RIVER || t.type === TileType.STREAM) {
          t.water = deps.MAX_WATER;
          continue;
        }

        if (isRaining) {
          const rainMul = t.type === TileType.TRENCH ? 2.0
                        : t.type === TileType.PADDY  ? 1.4 : 1.0;
          t.water += deps.RAIN_RATE * str * rainMul;

          // Rain gradually silts trenches back in; once fully silted the
          // trench reverts to plain grass (single-tap dig restores depth to 1).
          if (t.type === TileType.TRENCH) {
            t.depth = Math.max(0, (t.depth ?? 1) - TRENCH_SILT_RATE * str);
            if (t.depth <= 0) {
              t.type = TileType.GRASS; t.depth = 0;
              // This mutates tile.type outside any of the normal
              // dig/fill/action paths, which are the only places that
              // otherwise call markTileDirty — without it, the trench's
              // dirt-pit mesh and grass billboards for this tile never
              // get rebuilt to match the new type, leaving a stale pit
              // mesh sitting under (or grass tufts sprouting through) a
              // tile the data now says is plain grass.
              if (!isTown) deps.markTileDirty(col, row);
            }
          }
        }

        // Soil absorption
        const absorb = ABSORB_RATE[t.type] ?? 0.012;
        t.water = Math.max(0, t.water - absorb);

        // Evapotranspiration — slow background loss on all tiles
        t.water = Math.max(0, t.water - EVAP_RATE);

        // South-edge runoff — bottom 2 rows drain aggressively (gravity outlet)
        if (row >= rows - 2) {
          const runoffRate = row === rows - 1 ? 0.08 : 0.03;
          t.water = Math.max(0, t.water - runoffRate);
        }

        // West/east edge inflow — the far terrain seeps water into the
        // side columns toward its own level, entering the map from the
        // sides instead of only ever draining out the south.
        if (col === 0 || col === cols - 1) {
          const target = farLevel * deps.MAX_WATER;
          if (t.water < target) t.water += (target - t.water) * SIDE_INFLOW_RATE;
        }

        t.water = Math.min(tileWaterCapacity(t), t.water);
      }
    }

    // Pass 2: cross-tile flow — process south→north for southward bias
    const dirs = [
      { dc:  0, dr:  1 },  // south
      { dc:  1, dr:  0 },  // east
      { dc: -1, dr:  0 },  // west
      { dc:  0, dr: -1 },  // north
    ];

    for (let row = rows - 1; row >= 0; row--) {
      for (let col = 0; col < cols; col++) {
        const t = targetGrid[row][col];
        // Rivers/streams donate no water to neighbours — contained body, no spillover.
        if (deps.isSolid(t.type) || t.water <= 0 || t.type === TileType.RIVER || t.type === TileType.STREAM) continue;

        let surfA = floorZ(t.type, t.depth) + t.water;

        for (const { dc, dr } of dirs) {
          const nc = col + dc, nr = row + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const n = targetGrid[nr][nc];
          if (deps.isSolid(n.type)) continue;

          const surfB = floorZ(n.type, n.depth) + n.water;
          const head  = surfA - surfB;
          if (head <= 0.001) continue;

          // A silted-in (shallow) trench pulls water less eagerly than a fresh one.
          const bonus = (n.type === TileType.TRENCH) ? TRENCH_FLOW_BONUS * Math.max(0.15, n.depth ?? 1) : 1.0;
          let transfer = Math.min(head * FLOW_RATE * bonus * 0.5, t.water);
          transfer = Math.min(transfer, tileWaterCapacity(n) - n.water);
          if (transfer <= 0) continue;

          t.water -= transfer;
          n.water += transfer;
          surfA = floorZ(t.type, t.depth) + t.water; // update after transfer
          if (n.type === TileType.TRENCH) n.flow = true;
          if (t.type === TileType.TRENCH) t.flow = true;
          // Don't break — allow multiple transfers per tick for faster spread
        }
      }
    }

    // Pass 3: clamp
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const t = targetGrid[row][col];
        t.water = clamp(t.water, 0, tileWaterCapacity(t));
      }
    }

    // Pass 4: far-terrain gap continuation — each column's south-edge
    // tile (post-flow, so it reflects any upstream damming) eases the
    // matching far-terrain column level toward it. A player who blocks
    // water from reaching that column's bottom row drives its far-terrain
    // level toward 0 too, so the dry gap keeps going past the map edge.
    {
      const southLevel = isTown ? deps.getTownSouthLevel() : _farSouthLevel();
      const southRow = targetGrid[rows - 1];
      for (let col = 0; col < cols; col++) {
        const edgeFrac = clamp(southRow[col].water / deps.MAX_WATER, 0, 1);
        southLevel[col] += (edgeFrac - southLevel[col]) * FAR_SOUTH_TRACK_RATE;
      }
    }

    // Signal the matching mesh updater to do a full refresh this frame.
    if (isTown) _townWaterSimDirty = true;
    else _waterSimDirty = true;
  }

  // ── Merged water mesh rendering ─────────────────────────────────
  // The PNG tiles across world X/Z and scrolls as one continuous surface,
  // like the shared rain-plane texture. Per-vertex depth and flow retain
  // simulation tint/detail without returning to one material per tile.
  let mergedWaterMaterial = null;
  function _material() {
    if (!mergedWaterMaterial) {
      mergedWaterMaterial = window.MergedWaterRenderer.createMaterial(THREE, {
        textureUrl: 'assets/textures/wibbly_surface.png',
        opacity: 0.8,
        log: deps.debugLog,
      });
    }
    return mergedWaterMaterial;
  }

  function _disposeMergedWaterMesh(sceneObj, mesh, statKey) {
    if (!mesh) return null;
    if (sceneObj?.remove) sceneObj.remove(mesh);
    mesh.geometry.dispose();
    window.MergedWaterRenderer.clearStats(statKey);
    return null;
  }

  function buildMergedWaterMesh(sceneObj, cells, options) {
    if (!sceneObj?.add) {
      deps.debugLog(`[water-render] deferred ${options?.name || options?.statKey || 'merged water'} until its scene exists`, 'warn');
      return null;
    }
    const mesh = window.MergedWaterRenderer.createMesh(THREE, _material(), cells, {
      joinThreshold: deps.getSlabH() * 0.55,
      yOffset: 0.015,
      log: deps.debugLog,
      ...options,
    });
    if (!mesh) return null;
    sceneObj.add(mesh);
    deps._markTerrainEdgeId(mesh, 'water');
    return mesh;
  }

  // Global water time — updated in gameLoop
  let waterTime = 0;
  let farmWaterMesh = null;        // Rebuilt by updateWaterMeshes() after each farm simulation tick.
  let townWaterMesh = null;        // Rebuilt by updateTownWaterMeshes() after each town simulation tick.
  let farmFarAquiferMesh = null;   // Used by the farm's south-edge continuation renderer.
  let townFarAquiferMesh = null;   // Used by the town's south-edge continuation renderer.
  let _flowingTrenchTiles = [];        // Used by WeatherFX's trench particle emitter.
  let _townFlowingTrenchTiles = [];    // Same, town-side.

  // Update merged water surfaces each frame. The simulation remains a
  // per-tile grid. This collector translates its current state into one
  // batch of height/depth/flow vertices only when a sim tick marks the
  // area dirty; the render fast path merely advances the shared texture
  // uniform.
  function _collectDynamicWaterCells(targetGrid, rows, cols, skipPermanentWater) {
    const TileType = deps.TileType;
    const WATER_UNIT = deps.getWaterUnit();
    const cells = []; // Used by buildMergedWaterMesh for one simulation snapshot.
    const flowingTrenches = []; // Used by WeatherFX's trench particle emitter.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = targetGrid[row][col];
        if (deps.isSolid(tile.type) || tile.water < 0.003
            || (skipPermanentWater && (tile.type === TileType.RIVER || tile.type === TileType.STREAM))) {
          tile._wCached = false;
          continue;
        }

        if (tile.type === TileType.TRENCH && tile.flow) flowingTrenches.push({ col, row });
        const depthFrac = tile.water / deps.MAX_WATER;
        const surfaceA = deps.tileSurfaceY(tile.type) + tile.water * WATER_UNIT;
        let fx = 0, fz = 0;
        for (const { dc, dr, ax, az } of [
          { dc: 0, dr: 1, ax: 0, az: 1 },
          { dc: 0, dr: -1, ax: 0, az: -1 },
          { dc: 1, dr: 0, ax: 1, az: 0 },
          { dc: -1, dr: 0, ax: -1, az: 0 },
        ]) {
          const nc = col + dc, nr = row + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const neighbor = targetGrid[nr][nc];
          if (deps.isSolid(neighbor.type)) continue;
          const surfaceB = deps.tileSurfaceY(neighbor.type) + neighbor.water * WATER_UNIT;
          const head = surfaceA - surfaceB;
          if (head > 0.01) { fx += ax * head; fz += az * head; }
        }
        const flowLength = Math.hypot(fx, fz);
        const flowX = flowLength > 0.001 ? fx / flowLength : 0;
        const flowZ = flowLength > 0.001 ? fz / flowLength : 0;
        tile._wCached = true;
        tile._wSurfA = surfaceA;
        tile._wDepth = depthFrac;
        tile._wFlowNX = flowX;
        tile._wFlowNZ = flowZ;
        cells.push({ col, row, surfaceY: surfaceA, depth: depthFrac, flowX, flowZ });
      }
    }
    return { cells, flowingTrenches };
  }

  // The shallow decorative puddle apron is also one merged draw call. Its
  // World-space UVs keep the tiled PNG continuous across the playable-grid
  // seam without making a separate texture instance for the apron.
  function _buildFarAquiferApron(cols, seamRow, southLevel, sceneObj, statKey) {
    const WATER_UNIT = deps.getWaterUnit(), NORMAL_TOP = deps.getNormalTop();
    const cells = []; // Used by the shared merged-water geometry builder below.
    for (let col = 0; col < cols; col++) {
      const level = southLevel[col];
      for (let d = 0; d < FAR_APRON_ROWS; d++) {
        const depthFrac = level * Math.pow(FAR_APRON_FALLOFF, d);
        if (depthFrac < 0.02) continue;
        const surfaceA = NORMAL_TOP + depthFrac * WATER_UNIT;
        cells.push({ col, row: seamRow + d, surfaceY: surfaceA, depth: depthFrac, flowX: 0, flowZ: 1 });
      }
    }
    return buildMergedWaterMesh(sceneObj, cells, {
      name: statKey.replace(/\s+/g, '_') + '_mesh', statKey,
    });
  }

  // Disposes the farm's dynamic water mesh and marks the sim dirty so it
  // rebuilds from scratch — called whenever the underlying tile meshes are
  // torn down and rebuilt wholesale (buildTileMeshes).
  function resetFarmWaterMesh() {
    farmWaterMesh = _disposeMergedWaterMesh(deps.getScene(), farmWaterMesh, 'farm dynamic');
    _waterSimDirty = true;
  }

  function updateWaterMeshes() {
    waterTime += 0.016; // ~60fps accumulation; matches visual speed regardless of frame rate
    const scene = deps.getScene();

    if (_waterSimDirty) {
      _waterSimDirty = false;
      const snapshot = _collectDynamicWaterCells(deps.getGrid(), deps.ROWS, deps.COLS, false);
      _flowingTrenchTiles = snapshot.flowingTrenches;
      farmWaterMesh = _disposeMergedWaterMesh(scene, farmWaterMesh, 'farm dynamic');
      farmWaterMesh = buildMergedWaterMesh(scene, snapshot.cells, {
        name: 'farm_merged_dynamic_water', statKey: 'farm dynamic',
      });
      farmFarAquiferMesh = _disposeMergedWaterMesh(scene, farmFarAquiferMesh, 'farm south apron');
      farmFarAquiferMesh = _buildFarAquiferApron(deps.COLS, deps.ROWS, _farSouthLevel(), scene, 'farm south apron');
    }
    _material().uniforms.uTime.value = waterTime;
  }

  // Same as updateWaterMeshes() but for the town's ditch (TRENCH) tiles,
  // so town weather can fill them with water exactly like farm trenches.
  function updateTownWaterMeshes() {
    waterTime += 0.016;
    const townScene = deps.getTownScene();
    if (!townScene) return;
    const townZone = deps.getTownZone();
    const TCOLS = townZone?.cols || 60, TROWS = townZone?.rows || 50;

    if (_townWaterSimDirty) {
      _townWaterSimDirty = false;
      const snapshot = _collectDynamicWaterCells(deps.getTownGrid(), TROWS, TCOLS, true);
      _townFlowingTrenchTiles = snapshot.flowingTrenches;
      townWaterMesh = _disposeMergedWaterMesh(townScene, townWaterMesh, 'town dynamic');
      townWaterMesh = buildMergedWaterMesh(townScene, snapshot.cells, {
        name: 'town_merged_dynamic_water', statKey: 'town dynamic',
      });
      townFarAquiferMesh = _disposeMergedWaterMesh(townScene, townFarAquiferMesh, 'town south apron');
      townFarAquiferMesh = _buildFarAquiferApron(TCOLS, TROWS, deps.getTownSouthLevel(), townScene, 'town south apron');
    }
    _material().uniforms.uTime.value = waterTime;
  }

  // Animates a zone's waterfall curtain mesh(es) (see
  // buildWaterfallCurtainMeshes) — there's no per-tile dynamic water sim
  // here like updateTownWaterMeshes/updateWaterMeshes, just the uTime
  // uniform driving the shader's scroll/ripple, so this is a thin loop.
  function updateZoneWaterMeshes(mapId) {
    waterTime += 0.016;
    const meshes = deps.getZoneWaterMeshes().get(mapId);
    const material = _material();
    if (!meshes) return;
    for (const wm of meshes) {
      if (wm.material === material) continue;
      if (wm.material.uniforms?.uTime) wm.material.uniforms.uTime.value = waterTime;
    }
    material.uniforms.uTime.value = waterTime;
  }

  window.WaterSystem = {
    init,
    recomputeWater,
    updateWaterMeshes,
    updateTownWaterMeshes,
    updateZoneWaterMeshes,
    buildMergedWaterMesh,
    resetFarmWaterMesh,
    getFlowingTrenchTiles: () => _flowingTrenchTiles,
    getTownFlowingTrenchTiles: () => _townFlowingTrenchTiles,
  };
})();
