// Authored animal-den cave + Grehlr den placement integration.
//
// Keeps the large wilderness generator and wildlife spawn modules decoupled:
// - all den interiors render the authored cave_small.glb instead of the carved shell;
// - Grehlr dens in Northern Cliffs prefer a plateau-side placement after generation;
// - Grehlr den interiors are one room with only the Den Mother;
// - exterior Grehlr den groups are capped at three without changing other species.
(() => {
  'use strict';

  const AUTHORED_CAVE_MODEL_URL = 'assets/models/cave_small.glb';
  const AUTHORED_CAVE_SCALE = 3.05;
  const AUTHORED_ROOM_COLS = 8;
  const AUTHORED_ROOM_ROWS = 8;
  const AUTHORED_EXIT_TILES = [[3, 6], [4, 6], [5, 6]];
  const AUTHORED_NEST = [4, 2];
  const GREHLR_SPECIES = 'grehlr';
  const GREHLR_ZONE_ID = 'map_northern_cliffs';
  const GREHLR_DEN_MAX_PACK = 3;
  const GREHLR_PLATEAU_BACK_ROWS = 2;
  const GREHLR_PLATEAU_SEARCH_RADIUS = 22;
  const GREHLR_PLATEAU_PREFERENCE = 0.82;

  function farmLog(message, channel = 'wildlife') {
    window.__farmLog?.(`[den-cave] ${message}`, channel);
  }

  function fixedRoomFloor() {
    const floor = [];
    for (let r = 1; r <= 6; r++) {
      for (let c = 1; c <= 6; c++) floor.push([c, r]);
    }
    return floor;
  }

  function authoredMeshDescriptor() {
    return {
      kind: 'authored-glb',
      authoredModelUrl: AUTHORED_CAVE_MODEL_URL,
      scale: AUTHORED_CAVE_SCALE,
      position: [AUTHORED_ROOM_COLS / 2, 0, AUTHORED_ROOM_ROWS / 2],
      rotationY: 0,
    };
  }

  function fixedCavernFloor() {
    return {
      floor: fixedRoomFloor(),
      cols: AUTHORED_ROOM_COLS,
      rows: AUTHORED_ROOM_ROWS,
      exitCol: 4,
      exitRow: 6,
      exitTiles: AUTHORED_EXIT_TILES.map(tile => tile.slice()),
      nestCol: AUTHORED_NEST[0],
      nestRow: AUTHORED_NEST[1],
      mesh: authoredMeshDescriptor(),
    };
  }

  function remapInteriorItems(items, safeTiles) {
    if (!Array.isArray(items) || !items.length) return [];
    return items.slice(0, safeTiles.length).map((item, index) => ({
      ...item,
      col: safeTiles[index][0],
      row: safeTiles[index][1],
    }));
  }

  function patchCavernGenerator(api) {
    if (!api || api.__hobunjiAuthoredDenCavePatched) return api;
    const originalSynthesize = api.synthesizeCavernMapData?.bind(api);
    const originalPickDenMother = api.pickDenMotherKind?.bind(api);

    api.generateCavernFloor = function authoredDenFloor() {
      return fixedCavernFloor();
    };

    api.synthesizeCavernMapData = function authoredDenMapData(mapId) {
      const fixed = fixedCavernFloor();
      const denMotherKind = originalPickDenMother?.(mapId) || null;
      const isGrehlrDen = denMotherKind === 'grehlr-den-mother' || String(denMotherKind || '').startsWith('grehlr');

      // Preserve existing non-Grehlr den rewards/occupants, but remap them
      // into the compact authored room. Grehlr deliberately skips the old
      // procedural crawl entirely: one room, Den Mother only.
      const base = !isGrehlrDen && originalSynthesize ? originalSynthesize(mapId) : null;
      const creatureTiles = [[2, 3], [5, 3], [2, 4], [5, 4]];
      const oreTiles = [[2, 2], [5, 2], [2, 5], [5, 5]];

      return {
        ...(base || {}),
        schema: 'hobunji_building_interior.v1',
        id: mapId,
        name: 'A Dark Burrow',
        cols: fixed.cols,
        rows: fixed.rows,
        exits: [{
          id: 'den_exit',
          label: 'Back outside',
          tiles: fixed.exitTiles,
          targetMap: '',
          spawnCol: 0,
          spawnRow: 0,
        }],
        colliders: [],
        floor: fixed.floor,
        furniture: [],
        wallStyle: 'cavern',
        exitCol: fixed.exitCol,
        exitRow: fixed.exitRow,
        mesh: fixed.mesh,
        oreRocks: isGrehlrDen ? [] : remapInteriorItems(base?.oreRocks, oreTiles),
        creatureSpawns: isGrehlrDen ? [] : remapInteriorItems(base?.creatureSpawns, creatureTiles),
        nestCol: fixed.nestCol,
        nestRow: fixed.nestRow,
        denMotherKind,
        authoredCaveModel: AUTHORED_CAVE_MODEL_URL,
        grehlrSingleRoom: isGrehlrDen,
      };
    };

    api.__hobunjiAuthoredDenCavePatched = true;
    farmLog(`CavernGenerator patched to ${AUTHORED_CAVE_MODEL_URL}.`);
    return api;
  }

  function patchInteriorSceneBuilder(api) {
    if (!api || api.__hobunjiAuthoredDenCavePatched) return api;
    const originalBuild = api.buildCarvedCavernMesh?.bind(api);

    api.buildCarvedCavernMesh = function buildAuthoredDenCave(THREE, meshData) {
      if (!meshData?.authoredModelUrl) return originalBuild ? originalBuild(THREE, meshData) : new THREE.Group();

      const group = new THREE.Group();
      const Loader = THREE?.GLTFLoader || window.THREE?.GLTFLoader;
      if (!Loader) {
        console.error('[den-cave] THREE.GLTFLoader unavailable; authored den cave cannot load.');
        return group;
      }

      const loader = new Loader();
      loader.load(meshData.authoredModelUrl, gltf => {
        const model = gltf?.scene || gltf?.scenes?.[0];
        if (!model) {
          console.error('[den-cave] Authored cave GLB loaded without a scene:', meshData.authoredModelUrl);
          return;
        }

        const scale = Number(meshData.scale) || 1;
        model.scale.setScalar(scale);
        model.rotation.y = Number(meshData.rotationY) || 0;
        model.updateMatrixWorld(true);

        // The authored file is not required to be origin-centered. Anchor its
        // actual scaled bounding-box center to the logical room center and put
        // its lowest point exactly on y=0.
        const box = new THREE.Box3().setFromObject(model);
        const desired = Array.isArray(meshData.position) ? meshData.position : [0, 0, 0];
        const centerX = (box.min.x + box.max.x) * 0.5;
        const centerZ = (box.min.z + box.max.z) * 0.5;
        model.position.x += (Number(desired[0]) || 0) - centerX;
        model.position.y += (Number(desired[1]) || 0) - box.min.y;
        model.position.z += (Number(desired[2]) || 0) - centerZ;

        model.traverse(object => {
          if (!object?.isMesh) return;
          object.castShadow = true;
          object.receiveShadow = true;
          object.userData.cameraObstacle = true;
        });
        group.add(model);
        farmLog(`loaded authored cave ${meshData.authoredModelUrl}`, 'world');
      }, undefined, error => {
        console.error('[den-cave] Failed to load authored cave GLB:', meshData.authoredModelUrl, error);
      });
      return group;
    };

    api.__hobunjiAuthoredDenCavePatched = true;
    return api;
  }

  function tileKey(c, r) { return `${c},${r}`; }

  function exportedTileElevation(tile) {
    if (!tile) return NaN;
    const value = tile.elevTier ?? tile.elevation ?? tile.heightTier ?? tile.surfaceTier ?? tile.tier ?? tile.height;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function isWaterTile(tile) {
    if (!tile) return true;
    const type = String(tile.type ?? tile.kind ?? '').toLowerCase();
    return type.includes('river') || type.includes('stream') || type.includes('water');
  }

  function grehlrOwnsDen(generatorApi, zoneMapId, den) {
    if (zoneMapId !== GREHLR_ZONE_ID || !den?.id || !generatorApi?.makeRng) return false;
    // Northern Cliffs currently has one predator pack pool (Grehlr) and one
    // herbivore pool. WildlifeSpawn/CavernGenerator use this exact first
    // _denpop roll: < .5 is herd, otherwise the predator pack.
    const cavernMapId = `map_i_den_${zoneMapId}_${den.id}`;
    const rng = generatorApi.makeRng(cavernMapId + '_denpop');
    return rng() >= 0.5;
  }

  function rowsAverageHeight(tileAt, x, y, w, rowStart, rowCount) {
    let sum = 0, count = 0, elevatedCount = 0;
    for (let ry = 0; ry < rowCount; ry++) {
      for (let dx = 0; dx < w; dx++) {
        const tile = tileAt(x + dx, y + rowStart + ry);
        if (!tile || isWaterTile(tile)) return null;
        const h = exportedTileElevation(tile);
        sum += h;
        count++;
      }
    }
    return count ? { average: sum / count, count, elevatedCount } : null;
  }

  function boxesOverlap(a, b, padding = 1) {
    return a.x < b.x + b.w + padding && a.x + a.w + padding > b.x
      && a.y < b.y + b.h + padding && a.y + a.h + padding > b.y;
  }

  function findPlateauBackedPlacement(workspace, den, otherDens) {
    const tiles = workspace?.tiles;
    if (!Array.isArray(tiles) || !tiles.length) return null;
    const byTile = new Map(tiles.map(tile => [tileKey(tile.c ?? tile.col ?? tile.x, tile.r ?? tile.row ?? tile.y), tile]));
    const tileAt = (c, r) => byTile.get(tileKey(c, r));
    const width = Number(workspace.cols ?? workspace.width) || Math.max(...tiles.map(t => Number(t.c ?? t.col ?? t.x) || 0)) + 1;
    const height = Number(workspace.rows ?? workspace.height) || Math.max(...tiles.map(t => Number(t.r ?? t.row ?? t.y) || 0)) + 1;
    const w = Math.max(1, Number(den.w) || 1);
    const h = Math.max(GREHLR_PLATEAU_BACK_ROWS + 1, Number(den.h) || 1);
    const backRows = Math.min(GREHLR_PLATEAU_BACK_ROWS, h - 1);
    let best = null;

    for (let dy = -GREHLR_PLATEAU_SEARCH_RADIUS; dy <= GREHLR_PLATEAU_SEARCH_RADIUS; dy++) {
      for (let dx = -GREHLR_PLATEAU_SEARCH_RADIUS; dx <= GREHLR_PLATEAU_SEARCH_RADIUS; dx++) {
        const x = Math.round(den.x + dx), y = Math.round(den.y + dy);
        if (x < 1 || y < 1 || x + w >= width - 1 || y + h + 1 >= height - 1) continue;
        const candidate = { x, y, w, h };
        if (otherDens.some(other => other.id !== den.id && boxesOverlap(candidate, other, 2))) continue;

        const back = rowsAverageHeight(tileAt, x, y, w, 0, backRows);
        const front = rowsAverageHeight(tileAt, x, y, w, h - 1, 1);
        const mouth = tileAt(x + Math.floor(w / 2), y + h);
        if (!back || !front || !mouth || isWaterTile(mouth)) continue;
        const mouthHeight = exportedTileElevation(mouth);

        let raisedBackTiles = 0;
        for (let ry = 0; ry < backRows; ry++) {
          for (let tx = 0; tx < w; tx++) {
            if (exportedTileElevation(tileAt(x + tx, y + ry)) >= mouthHeight + 1) raisedBackTiles++;
          }
        }
        const backTileCount = w * backRows;
        if (raisedBackTiles < Math.ceil(backTileCount * 0.55)) continue;
        if (back.average < mouthHeight + 0.75) continue;
        if (front.average > back.average - 0.35) continue;

        const distance = Math.hypot(dx, dy);
        const idealRisePenalty = Math.abs((back.average - mouthHeight) - 1.5) * 2.5;
        const contactBonus = raisedBackTiles / backTileCount * 6;
        const score = distance + idealRisePenalty - contactBonus;
        if (!best || score < best.score) best = { x, y, w, h, score, raisedBackTiles, mouthHeight, backHeight: back.average };
      }
    }
    return best;
  }

  function biasGrehlrDensIntoPlateaus(generatorApi, zoneMapId, workspace) {
    if (zoneMapId !== GREHLR_ZONE_ID || !Array.isArray(workspace?.animalDens)) return workspace;
    for (const den of workspace.animalDens) {
      if (!grehlrOwnsDen(generatorApi, zoneMapId, den)) continue;
      const preferenceRng = generatorApi.makeRng(`${zoneMapId}_${den.id}_plateau_backing`);
      if (preferenceRng() > GREHLR_PLATEAU_PREFERENCE) continue;
      const placement = findPlateauBackedPlacement(workspace, den, workspace.animalDens);
      if (!placement) {
        farmLog(`${den.id}: no suitable plateau-backed placement found; kept normal placement.`, 'world');
        continue;
      }
      den.x = placement.x;
      den.y = placement.y;
      den.w = placement.w;
      den.h = placement.h;
      den.mouthAnchor = { x: placement.x + Math.floor(placement.w / 2), y: placement.y + placement.h };
      den.grehlrPlateauBacked = true;
      den.grehlrPlateauBackRows = GREHLR_PLATEAU_BACK_ROWS;
      farmLog(`${den.id}: rear ${GREHLR_PLATEAU_BACK_ROWS} rows biased into plateau side (${placement.raisedBackTiles} raised tiles).`, 'world');
    }
    return workspace;
  }

  function patchWildernessMapGenerator(api) {
    if (!api || api.__hobunjiGrehlrDenPlacementPatched) return api;
    const originalGenerateZoneWorkspace = api.generateZoneWorkspace?.bind(api);
    if (originalGenerateZoneWorkspace) {
      api.generateZoneWorkspace = function grehlrPlateauAwareGenerateZoneWorkspace(zoneMapId, seedText, locales) {
        const workspace = originalGenerateZoneWorkspace(zoneMapId, seedText, locales);
        return biasGrehlrDensIntoPlateaus(api, zoneMapId, workspace);
      };
    }
    api.__hobunjiGrehlrDenPlacementPatched = true;
    return api;
  }

  function patchWildlifeSpawn(api) {
    if (!api || api.__hobunjiGrehlrDenPackCapPatched) return api;
    const originalInit = api.init?.bind(api);
    if (originalInit) {
      api.init = function grehlrDenCapInit(injectedDeps) {
        if (injectedDeps?.makeCreatureEntity && !injectedDeps.makeCreatureEntity.__hobunjiGrehlrDenCapPatched) {
          const originalMakeCreatureEntity = injectedDeps.makeCreatureEntity;
          const cappedMakeCreatureEntity = function grehlrDenCappedMakeCreatureEntity(kind, x, y, opts = {}) {
            if (kind === GREHLR_SPECIES && opts.denKey && injectedDeps.hostileObjects) {
              const existing = [...injectedDeps.hostileObjects].filter(c => c?.health > 0 && c.creatureKey === GREHLR_SPECIES && c.denKey === opts.denKey);
              // spawnPackAtDen rolls 2-4. Returning an existing member on the
              // fourth attempt makes its Set.add a no-op, so the real pack is
              // always 2-3 without creating/discarding a fourth visual entity.
              if (existing.length >= GREHLR_DEN_MAX_PACK) return existing[0] || null;
            }
            return originalMakeCreatureEntity(kind, x, y, opts);
          };
          cappedMakeCreatureEntity.__hobunjiGrehlrDenCapPatched = true;
          injectedDeps.makeCreatureEntity = cappedMakeCreatureEntity;
        }
        return originalInit(injectedDeps);
      };
    }
    api.__hobunjiGrehlrDenPackCapPatched = true;
    return api;
  }

  function patchGlobal(name, patcher) {
    const current = window[name];
    if (current) {
      patcher(current);
      return;
    }
    const existing = Object.getOwnPropertyDescriptor(window, name);
    if (existing && typeof existing.set === 'function') {
      const chainedSet = existing.set;
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: existing.enumerable,
        get: existing.get,
        set(value) {
          chainedSet.call(window, value);
          patcher(window[name]);
        },
      });
      return;
    }
    let value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) {
        value = patcher(next) || next;
        Object.defineProperty(window, name, {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
      },
    });
  }

  patchGlobal('WildernessMapGenerator', patchWildernessMapGenerator);
  patchGlobal('CavernGenerator', patchCavernGenerator);
  patchGlobal('InteriorSceneBuilder', patchInteriorSceneBuilder);
  patchGlobal('WildlifeSpawn', patchWildlifeSpawn);

  window.HobunjiAuthoredDenCave = {
    modelUrl: AUTHORED_CAVE_MODEL_URL,
    fixedCavernFloor,
    biasGrehlrDensIntoPlateaus,
  };
})();
