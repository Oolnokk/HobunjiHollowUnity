// Southern Cloud Forest authored-boundary controls.
// Loaded before the wilderness generator so it can suppress the older
// unconditional no-cliff patch, then installs conditional generator/runtime
// adapters once their dependencies become available.
(function (root) {
  'use strict';
  if (!root || root.CloudForestSceneryOptions) return;

  const CLOUD_ID = 'map_southern_cloud_forest';
  const TREE_WALL_KEY = 'hobunji_cloud_forest_tree_wall_v1';
  const NORTH_DEPTH = 18;
  const DENSITY_KEEP = 0.25;
  const OUTLINE_LAYER = 1;
  const PATH_RECIPE_ID = 'cloud_forest_town_path_surface';
  const PATH_CHUNK_SIZE = 10;
  const PATH_STYLE = Object.freeze({
    unitMult: 0.55,
    densityMult: 1,
    rockScale: 1.15,
    preScale: [1, 1, 0.32],
    brickJitter: Object.freeze({ rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 }),
    texture: 'assets/textures/carved_smooth.png',
    tint: '#545039',
    edgeTolerance: 0.05,
  });

  const readStorage = (key, fallback = null) => {
    try { const v = root.localStorage?.getItem(key); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  };
  const writeStorage = (key, value) => {
    try { root.localStorage?.setItem(key, String(value)); } catch (_) {}
  };
  const log = (message, level = 'info', category = 'world') => {
    if (typeof root.__farmLog === 'function') root.__farmLog(message, level, category);
    else if (level === 'warn' || level === 'error') console.warn(message);
  };
  const treeWallEnabled = () => readStorage(TREE_WALL_KEY, '1') !== '0';

  // border-terrain.js v2 used to install an unconditional generator wrapper
  // that erased the original north escarpment. Mark the generator as already
  // handled before border-terrain loads; our conditional wrapper below owns
  // that decision instead.
  function armGeneratorGuard() {
    if (root.WildernessMapGenerator) {
      root.WildernessMapGenerator.__cloudForestNorthNoCliffPatch = true;
      return;
    }
    const desc = Object.getOwnPropertyDescriptor(root, 'WildernessMapGenerator');
    if (desc && !desc.configurable) return;
    let pending;
    try {
      Object.defineProperty(root, 'WildernessMapGenerator', {
        configurable: true,
        enumerable: true,
        get() { return pending; },
        set(value) {
          pending = value;
          if (value) value.__cloudForestNorthNoCliffPatch = true;
          Object.defineProperty(root, 'WildernessMapGenerator', {
            value, writable: true, configurable: true, enumerable: true,
          });
        },
      });
    } catch (_) {}
  }

  function removeCloudForestNorthBoundaryCliffs(workspace) {
    const map = workspace?.maps?.find(m => !m?.isSubmap) || workspace?.maps?.[0];
    if (!map?.tiles) return workspace;
    let removed = 0;
    for (const [key, tile] of Object.entries(map.tiles)) {
      if (!tile?.borderEscarpment || tile.borderEscarpmentSide !== 'north') continue;
      const [c, r] = key.split(',').map(Number);
      let inward = null;
      for (let d = 1; d <= 24 && r + d < map.rows; d++) {
        const candidate = map.tiles[`${c},${r + d}`];
        if (!candidate || candidate.borderEscarpment || candidate.distantBoundaryLandscape) continue;
        inward = candidate;
        break;
      }
      if (inward?.plateau) tile.plateau = inward.plateau;
      else delete tile.plateau;
      if (tile.type === 'rock') tile.type = 'grass';
      if (tile.plateau) tile.borderEntryGate = true;
      else delete tile.borderEntryGate;
      delete tile.borderEscarpment;
      delete tile.generatedBorderEscarpment;
      delete tile.borderEscarpmentDepth;
      delete tile.borderEscarpmentSide;
      delete tile.borderEscarpmentHeightBonus;
      removed++;
    }
    if (removed) {
      map.generatedFrom = { ...(map.generatedFrom || {}), northBoundaryCliffsRemoved: removed };
      workspace.generatorPreset = { ...(workspace.generatorPreset || {}), northBoundaryCliffsRemoved: true };
    }
    return workspace;
  }

  function installGeneratorPatch() {
    const gen = root.WildernessMapGenerator;
    if (!gen?.generateZoneWorkspace || gen.__cloudForestBoundaryOptionsPatch) return false;
    // Keep the guard flag so border-terrain's older wrapper continues to skip.
    gen.__cloudForestNorthNoCliffPatch = true;
    const original = gen.generateZoneWorkspace;
    gen.generateZoneWorkspace = function (zoneMapId, ...args) {
      const value = original.call(this, zoneMapId, ...args);
      const apply = workspace => {
        if (zoneMapId !== CLOUD_ID) return workspace;
        // Tree mode retains the authored grassy opening and removes the old
        // cliff wall. Cliff mode leaves the generator's original escarpment
        // untouched, including its generated entry gate/opening.
        return treeWallEnabled() ? removeCloudForestNorthBoundaryCliffs(workspace) : workspace;
      };
      return value && typeof value.then === 'function' ? value.then(apply) : apply(value);
    };
    gen.__cloudForestBoundaryOptionsPatch = true;
    return true;
  }

  function removeSceneObject(scene, object) {
    if (!scene || !object) return;
    scene.remove?.(object);
    if (Array.isArray(scene.items)) {
      const i = scene.items.indexOf(object);
      if (i >= 0) scene.items.splice(i, 1);
    }
  }

  function quarterAndOutlineForest(scene) {
    const collection = scene?.children || scene?.items || [];
    let groups = 0, before = 0, after = 0, outlinedBuckets = 0;
    for (const group of collection) {
      if (!group?.userData?.denseForestWall) continue;
      groups++;
      group.traverse?.(mesh => {
        if (!mesh?.isInstancedMesh) return;
        const n = Math.max(0, Number(mesh.count) || 0);
        before += n;
        if (!mesh.userData.cloudForestQuarterDensity) {
          const matrix = new THREE.Matrix4();
          let kept = 0;
          for (let i = 0; i < n; i += 4) {
            mesh.getMatrixAt(i, matrix);
            if (kept !== i) mesh.setMatrixAt(kept, matrix);
            kept++;
          }
          mesh.count = kept;
          mesh.instanceMatrix.needsUpdate = true;
          mesh.userData.cloudForestQuarterDensity = true;
          mesh.userData.cloudForestOriginalCount = n;
        }
        after += Math.max(0, Number(mesh.count) || 0);

        // The existing inverted-shell renderer draws layer 1. Keep transparent
        // / alpha-cutout leaf-card materials out of that pass, matching the
        // foliage generator's existing noOutline rule for flat cards.
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const alphaCard = mats.some(m => m && (m.transparent || Number(m.alphaTest) > 0 || m.depthWrite === false));
        if (!alphaCard) {
          mesh.layers?.enable?.(OUTLINE_LAYER);
          mesh.userData.cloudForestShellOutline = true;
          outlinedBuckets++;
        }
      });
      group.userData.cloudForestDensityScale = DENSITY_KEEP;
      group.userData.cloudForestShellOutlines = true;
    }
    return { groups, before, after, outlinedBuckets };
  }

  function clearForestWall(scene) {
    const collection = [...(scene?.children || scene?.items || [])];
    let removed = 0;
    for (const obj of collection) {
      if (!obj?.userData?.denseForestWall && !obj?.userData?.bakedForestWall) continue;
      removeSceneObject(scene, obj);
      removed++;
    }
    return removed;
  }

  function makeInclineSampler(slope, zcols, depth = NORTH_DEPTH) {
    const pos = slope?.geometry?.getAttribute?.('position');
    if (!pos?.array?.length) return null;
    const step = 0.5;
    const xCount = Math.round(zcols / step) + 1;
    const zCount = Math.round(depth / step) + 1;
    const yAt = (ix, iz) => pos.array[(Math.max(0, Math.min(zCount - 1, iz)) * xCount + Math.max(0, Math.min(xCount - 1, ix))) * 3 + 1] || 0;
    return (x, z) => {
      const gx = Math.max(0, Math.min(xCount - 1, x / step));
      const gz = Math.max(0, Math.min(zCount - 1, -z / step));
      const x0 = Math.floor(gx), z0 = Math.floor(gz), x1 = Math.min(xCount - 1, x0 + 1), z1 = Math.min(zCount - 1, z0 + 1);
      const tx = gx - x0, tz = gz - z0;
      const a = yAt(x0, z0) * (1 - tx) + yAt(x1, z0) * tx;
      const b = yAt(x0, z1) * (1 - tx) + yAt(x1, z1) * tx;
      return a * (1 - tz) + b * tz;
    };
  }

  let pathBuilder = null;
  let pathReady = null;
  function ensurePathBuilder() {
    if (pathReady) return pathReady;
    const WB = root.WallBuilder || (typeof WallBuilder !== 'undefined' ? WallBuilder : null);
    if (!WB) return Promise.reject(new Error('WallBuilder unavailable'));
    pathBuilder = new WB({ glbBasePath: 'assets/models/' });
    pathReady = Promise.all([
      pathBuilder.loadDefaultGlb(),
      fetch('assets/models/recipes/walls/wallrecipe2.json').then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching wallrecipe2.json`);
        return r.json();
      }),
    ]).then(([, recipe]) => {
      pathBuilder.addRecipe(PATH_RECIPE_ID, recipe);
      pathBuilder.tintDefaultGlb(PATH_STYLE.texture, PATH_STYLE.tint);
      return true;
    });
    return pathReady;
  }

  function buildTownPathBricks(scene, zcols) {
    if (!scene || scene.userData?.cloudForestTownBricksRequested) return;
    scene.userData = scene.userData || {};
    scene.userData.cloudForestTownBricksRequested = true;
    const collection = scene.children || scene.items || [];
    const slope = collection.find(o => o?.name === 'AuthoredCloudForestNorthIncline');
    const ribbon = collection.find(o => o?.name === 'AuthoredCloudForestTownPath');
    const meta = scene.userData.authoredCloudForestScenery || {};
    const pathCenter = Number.isFinite(meta.pathCenter) ? meta.pathCenter : zcols * 0.5;
    const pathWidth = Math.max(3.25, Number(meta.pathWidth) || 0);
    const heightAt = makeInclineSampler(slope, zcols, NORTH_DEPTH);
    if (!heightAt) {
      log('[CloudForestScenery] Could not sample the north incline; keeping the flat-material town-path fallback.', 'warn', 'world');
      return;
    }

    ensurePathBuilder().then(() => {
      const half = pathWidth * 0.5;
      const minX = pathCenter - half - 0.8, maxX = pathCenter + half + 0.8;
      const minZ = -NORTH_DEPTH - 0.8, maxZ = 0.8;
      const size = PATH_CHUNK_SIZE;
      const builtGroups = [];
      for (let cz = Math.floor(minZ / size) * size; cz < maxZ; cz += size) {
        for (let cx = Math.floor(minX / size) * size; cx < maxX; cx += size) {
          const panel = {
            id: 'cloud_forest_town_path_surface_chunk', width: size, height: size,
            wallRecipeId: PATH_RECIPE_ID,
            position: [cx + size / 2, 0.01, cz + size / 2], rotationDeg: [0, 0, 0],
            corners: [[cx,0.01,cz+size],[cx+size,0.01,cz+size],[cx+size,0.01,cz],[cx,0.01,cz]],
          };
          const opts = {
            usePlaceholder: true,
            unitMult: PATH_STYLE.unitMult,
            densityMult: PATH_STYLE.densityMult,
            rockScale: PATH_STYLE.rockScale,
            preScale: PATH_STYLE.preScale.slice(),
            brickJitter: { ...PATH_STYLE.brickJitter },
          };
          const group = pathBuilder.build([panel], opts);
          group.name = 'AuthoredCloudForestTownPathBricks';
          const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
          let anyKept = false;
          group.traverse(o => {
            if (!o?.isInstancedMesh) return;
            const n = o.count;
            let kept = 0;
            for (let i = 0; i < n; i++) {
              o.getMatrixAt(i, m); m.decompose(p, q, s);
              if (Math.abs(p.x - pathCenter) > half + PATH_STYLE.edgeTolerance || p.z > 0.05 || p.z < -NORTH_DEPTH - 0.05) continue;
              // Same projection strategy as town background paths: retain the
              // WallBuilder brick's local height/jitter, then add the sampled
              // terrain height so every brick rides subtle elevation changes.
              p.y += heightAt(p.x, p.z);
              m.compose(p, q, s);
              if (kept !== i) o.setMatrixAt(kept, m);
              kept++;
            }
            o.count = kept;
            o.instanceMatrix.needsUpdate = true;
            o.castShadow = true;
            o.receiveShadow = true;
            if (kept) anyKept = true;
          });
          if (!anyKept) {
            try { (root.WallBuilder || WallBuilder).disposeGroup(group); } catch (_) {}
            continue;
          }
          group.userData.backgroundScenery = true;
          group.userData.cloudForestTownPathBricks = true;
          scene.add?.(group);
          if (Array.isArray(scene.items) && !scene.items.includes(group)) scene.items.push(group);
          builtGroups.push(group);
        }
      }
      if (builtGroups.length) {
        if (ribbon) removeSceneObject(scene, ribbon);
        scene.userData.cloudForestTownPathBrickGroups = builtGroups.length;
        log(`[CloudForestScenery] Town path paved with ${builtGroups.length} WallBuilder brick chunk(s) projected onto the incline.`, 'info', 'world');
      } else {
        log('[CloudForestScenery] WallBuilder produced no retained town-path bricks; keeping the material ribbon fallback.', 'warn', 'world');
      }
    }).catch(error => {
      log(`[CloudForestScenery] Town-path brick build failed: ${error?.message || error}; keeping the material ribbon fallback.`, 'warn', 'world');
    });
  }

  function installBorderPatch() {
    const BT = root.BorderTerrain;
    if (!BT?.buildZoneBorderTerrain || BT.__cloudForestBoundaryOptionsPatch || !BT.__cloudForestDenseNorthPatch) return false;
    const original = BT.buildZoneBorderTerrain;
    BT.buildZoneBorderTerrain = function (scene, zcols, zrows, mapId, zoneBaseElev = 0, zGrid = null) {
      const result = original.call(this, scene, zcols, zrows, mapId, zoneBaseElev, zGrid);
      if (mapId !== CLOUD_ID || !scene) return result;

      const enabled = treeWallEnabled();
      let stats = { groups: 0, before: 0, after: 0, outlinedBuckets: 0 };
      if (enabled) stats = quarterAndOutlineForest(scene);
      else clearForestWall(scene);

      scene.userData = scene.userData || {};
      const meta = scene.userData.authoredCloudForestScenery || {};
      scene.userData.authoredCloudForestScenery = {
        ...meta,
        boundaryMode: enabled ? 'outlined-tree-wall' : 'original-cliffs',
        densityScale: enabled ? DENSITY_KEEP : 0,
        shellOutlines: enabled,
        treeWallInstanceBucketsBefore: stats.before,
        treeWallInstanceBucketsAfter: stats.after,
        northBoundaryCliffsRemoved: enabled,
      };
      if (enabled && stats.groups) {
        log(`[CloudForestScenery] North tree wall reduced to 25% density (${stats.before} → ${stats.after} component instances); shell outlines enabled on ${stats.outlinedBuckets} volumetric bucket(s).`, 'info', 'foliage');
      } else if (!enabled) {
        log('[CloudForestScenery] Tree wall disabled; original generated north cliff boundary retained with the entrance opening.', 'info', 'world');
      }
      buildTownPathBricks(scene, zcols);
      return result;
    };
    BT.__cloudForestBoundaryOptionsPatch = true;
    return true;
  }

  function installSetting() {
    if (document.getElementById('settingCloudForestTreeWall')) return true;
    const box = document.getElementById('hobunjiPerfDebugSettings');
    if (!box) return false;
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;cursor:pointer;font-size:12px;border-top:1px solid rgba(255,255,255,.09);margin-top:4px;padding-top:9px';
    row.title = 'On: sparse outlined Shadewood wall. Off: remove the wall and retain the original north cliff boundary; the inclined road opening remains.';
    const text = document.createElement('span');
    text.textContent = 'Cloud Forest Tree Wall';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = 'settingCloudForestTreeWall'; input.checked = treeWallEnabled();
    row.append(text, input);
    const status = document.createElement('span');
    status.id = 'settingCloudForestTreeWallStatus';
    status.style.cssText = 'display:block;font-size:10px;opacity:.65;margin:-2px 0 5px';
    status.textContent = input.checked ? 'Boundary: 25% density outlined Shadewoods' : 'Boundary: original cliffs + road opening';
    input.addEventListener('change', () => {
      writeStorage(TREE_WALL_KEY, input.checked ? '1' : '0');
      const mode = input.checked ? 'outlined tree wall' : 'original cliff boundary';
      status.textContent = `Boundary: ${mode}; reloading…`;
      log(`[CloudForestScenery] Boundary mode changed to ${mode}; reloading for a clean zone rebuild.`, 'info', 'world');
      setTimeout(() => root.location.reload(), 120);
    });
    const details = box.querySelector('details');
    if (details) box.insertBefore(row, details), box.insertBefore(status, details);
    else box.append(row, status);
    return true;
  }

  armGeneratorGuard();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    installGeneratorPatch();
    installBorderPatch();
    installSetting();
    if ((root.WildernessMapGenerator?.__cloudForestBoundaryOptionsPatch && root.BorderTerrain?.__cloudForestBoundaryOptionsPatch && document.getElementById('settingCloudForestTreeWall')) || attempts > 400) {
      clearInterval(timer);
    }
  }, 25);

  root.CloudForestSceneryOptions = Object.freeze({
    TREE_WALL_KEY,
    DENSITY_KEEP,
    treeWallEnabled,
    setTreeWallEnabled(enabled) { writeStorage(TREE_WALL_KEY, enabled ? '1' : '0'); },
    installGeneratorPatch,
    installBorderPatch,
  });
})(typeof window !== 'undefined' ? window : null);
