// Southern Cloud Forest background-scenery refinement and generated-wilderness
// entry repair. Loaded after wilderness-map-generator.js but before
// border-terrain.js so it can normalize generated workspaces and wrap the
// wilderness border renderer without changing either large source module.
(function (root) {
  'use strict';

  const CLOUD_ID = 'map_southern_cloud_forest';
  const NORTH_DEPTH = 18;
  const SHOULDER_DEPTH = 3.0;
  const SHOULDER_RISE = 0.35;
  const STEEP_RISE = 15.0;
  const TREE_LATTICE_WORLD = 2;
  const TREE_KEEP_PROBABILITY = 0.5625; // 2-world source lattice × 75% thinning survivor × 75% non-variety survivor.
  const TREE_SCALE_MIN = 0.92;
  const TREE_SCALE_MAX = 1.08;
  const PATH_CLEARANCE = 1.15;
  const FOREST_CHUNK_WIDTH = 10;
  const FOREST_CHUNK_DEPTH = 6;
  const PATH_CHUNK_SIZE = 10;
  const PATH_RECIPE_ID = 'cloud_forest_town_path';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  function hash01(a, b, salt = 0) {
    let h = (2166136261 ^ (Math.round(a * 8) * 374761393) ^ (Math.round(b * 8) * 668265263) ^ (salt * 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h >>> 0) / 4294967296;
  }

  function workspaceRoot(workspace) {
    return workspace?.maps?.find(m => !m?.isSubmap) || workspace?.maps?.[0] || null;
  }

  function transitionSide(transition, map) {
    const label = String(transition?.label || '').toLowerCase();
    for (const side of ['north', 'south', 'west', 'east']) if (label.includes(side)) return side;
    const c = Number(transition?.col), r = Number(transition?.row);
    if (!Number.isFinite(c) || !Number.isFinite(r) || !map) return null;
    const distances = [
      ['north', r], ['south', Math.max(0, map.rows - 1 - r)],
      ['west', c], ['east', Math.max(0, map.cols - 1 - c)],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  }

  function edgeAxisLimit(map, side) {
    return side === 'north' || side === 'south' ? map.cols : map.rows;
  }

  function edgeCoords(side, axis, inward, map) {
    if (side === 'north') return [axis, inward];
    if (side === 'south') return [axis, map.rows - 1 - inward];
    if (side === 'west') return [inward, axis];
    return [map.cols - 1 - inward, axis];
  }

  function mapTile(map, c, r) {
    return map?.tiles?.[`${c},${r}`] || null;
  }

  function isPathTile(map, c, r) {
    return String(mapTile(map, c, r)?.type || '').toLowerCase() === 'path';
  }

  function edgePathRuns(map, side) {
    if (!map || !side) return [];
    const limit = edgeAxisLimit(map, side);
    const out = [];
    let start = -1;
    for (let axis = 0; axis <= limit; axis++) {
      let hit = false;
      if (axis < limit) {
        const [c, r] = edgeCoords(side, axis, 0, map);
        hit = isPathTile(map, c, r);
      }
      if (hit && start < 0) start = axis;
      if (!hit && start >= 0) {
        out.push({ start, end: axis - 1, width: axis - start, center: (start + axis - 1) * 0.5 });
        start = -1;
      }
    }
    return out;
  }

  function findEntryRun(map, side, transition) {
    const runs = edgePathRuns(map, side);
    if (!runs.length) return null;
    const axis = side === 'north' || side === 'south' ? Number(transition?.col) : Number(transition?.row);
    if (Number.isFinite(axis)) {
      const containing = runs.find(run => axis >= run.start && axis <= run.end);
      if (containing) return containing;
      runs.sort((a, b) => Math.abs(a.center - axis) - Math.abs(b.center - axis) || b.width - a.width);
      return runs[0];
    }
    runs.sort((a, b) => b.width - a.width);
    return runs[0];
  }

  function setTransitionOnEdge(transition, side, axis, map) {
    if (!transition || !map) return;
    if (side === 'north') { transition.col = axis; transition.row = 0; }
    else if (side === 'south') { transition.col = axis; transition.row = map.rows - 1; }
    else if (side === 'west') { transition.col = 0; transition.row = axis; }
    else { transition.col = map.cols - 1; transition.row = axis; }
  }

  // The old entry gate used the same wide rectangle both to flatten a safe
  // opening through boundary cliffs and to paint the visible road. Keep the
  // wide, walkable clearance but turn only a narrow center strip back into
  // visible path. This is a post-export repair so all generated wilderness
  // maps benefit without duplicating the 400 KB generator.
  function repairGeneratedEntryWorkspace(workspace) {
    const map = workspaceRoot(workspace);
    if (!map?.tiles || !map.cols || !map.rows) return { repaired: false, reason: 'no-root-map' };
    const transition = (map.transitions || []).find(t => t?.id === 'sp_generated_entry')
      || (map.transitions || []).find(t => /^Entry\s/i.test(String(t?.label || '')));
    if (!transition) return { repaired: false, reason: 'no-entry-transition' };
    const side = transitionSide(transition, map);
    if (!side) return { repaired: false, reason: 'no-entry-side' };
    const run = findEntryRun(map, side, transition);
    if (!run) return { repaired: false, reason: 'no-edge-path', side };

    const centerAxis = clamp(Math.round(run.center), 0, edgeAxisLimit(map, side) - 1);
    const corridorHalf = 1; // three final tiles wide after the generator's 2x density scale.
    const narrowStart = centerAxis - corridorHalf;
    const narrowEnd = centerAxis + corridorHalf;
    let trimmed = 0;
    let repairedSlices = 0;

    // Only trim a genuinely over-wide gate. Once the broad rectangle stops and
    // the ordinary generated route takes over, two consecutive low-fill slices
    // end the repair so downstream path bends/branches are untouched.
    if (run.width > 4) {
      const inwardLimit = Math.min(side === 'north' || side === 'south' ? map.rows : map.cols, 48);
      const minimumBroadCount = Math.max(4, Math.ceil(run.width * 0.55));
      let misses = 0;
      for (let inward = 0; inward < inwardLimit; inward++) {
        let pathCount = 0;
        for (let axis = run.start; axis <= run.end; axis++) {
          const [c, r] = edgeCoords(side, axis, inward, map);
          if (isPathTile(map, c, r)) pathCount++;
        }
        if (pathCount < minimumBroadCount) {
          misses++;
          if (misses >= 2) break;
          continue;
        }
        misses = 0;
        repairedSlices++;
        for (let axis = run.start; axis <= run.end; axis++) {
          if (axis >= narrowStart && axis <= narrowEnd) continue;
          const [c, r] = edgeCoords(side, axis, inward, map);
          const tile = mapTile(map, c, r);
          if (!tile || String(tile.type || '').toLowerCase() !== 'path') continue;
          tile.type = 'grass';
          trimmed++;
        }
      }
    }

    setTransitionOnEdge(transition, side, centerAxis, map);
    const marker = (map.routes || []).find(route => route?.id === 'route_map_entry_marker');
    if (marker) {
      const [c, r] = edgeCoords(side, centerAxis, 0, map);
      marker.nodes = [[c, r]];
    }
    map.generatedFrom = {
      ...(map.generatedFrom || {}),
      entryPathSwatheTrimmed: trimmed,
      entryPathRepairSlices: repairedSlices,
      entryTransferAligned: true,
      entryTransferSide: side,
      entryTransferAxis: centerAxis,
    };
    return { repaired: true, side, centerAxis, trimmed, repairedSlices, originalWidth: run.width };
  }

  function plateauElevationMap(workspace) {
    return new Map((workspace?.plateauGroups || []).map(group => [group.id, Number(group.elevation) || 0]));
  }

  function modeNumber(values) {
    if (!values.length) return 0;
    const counts = new Map();
    for (const value of values) {
      const key = Number(value) || 0;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  }

  // Cloud Forest is supposed to continue uphill beyond the north edge, not
  // terminate in the generic wilderness escarpment. Preserve each generated
  // boundary plateau's own footprint/submap identity, but normalize its tier to
  // the first real inland terrain at that column and remove cliff semantics.
  function removeCloudForestNorthCliffs(workspace) {
    const map = workspaceRoot(workspace);
    if (!map?.tiles) return { removed: 0, groups: 0 };
    const elevations = plateauElevationMap(workspace);
    const targetTiersByGroup = new Map();
    let removed = 0;

    for (const [key, tile] of Object.entries(map.tiles)) {
      if (!tile?.borderEscarpment || tile.borderEscarpmentSide !== 'north') continue;
      const [c, r] = key.split(',').map(Number);
      let inlandTier = 0;
      for (let d = 1; d <= 24 && r + d < map.rows; d++) {
        const candidate = map.tiles[`${c},${r + d}`];
        if (!candidate || candidate.borderEscarpment || candidate.distantBoundaryLandscape) continue;
        inlandTier = candidate.plateau ? (elevations.get(candidate.plateau) || 0) : 0;
        break;
      }
      if (tile.plateau) {
        let values = targetTiersByGroup.get(tile.plateau);
        if (!values) targetTiersByGroup.set(tile.plateau, values = []);
        values.push(inlandTier);
        // Prevent runtime's plateau-ring classifier from turning the retained
        // boundary footprint back into an impassable cliff face.
        tile.borderEntryGate = true;
      }
      if (String(tile.type || '').toLowerCase() === 'rock') tile.type = 'grass';
      delete tile.borderEscarpment;
      delete tile.generatedBorderEscarpment;
      delete tile.borderEscarpmentDepth;
      delete tile.borderEscarpmentSide;
      delete tile.borderEscarpmentHeightBonus;
      removed++;
    }

    for (const [groupId, values] of targetTiersByGroup) {
      const tier = modeNumber(values);
      const group = (workspace.plateauGroups || []).find(item => item.id === groupId);
      if (group) group.elevation = tier;
      for (const mapOut of (workspace.maps || [])) {
        if (mapOut?.plateauGroupId === groupId) mapOut.elevation = tier;
      }
    }
    if (removed) {
      map.generatedFrom = { ...(map.generatedFrom || {}), northBoundaryCliffsRemoved: removed };
      workspace.generatorPreset = { ...(workspace.generatorPreset || {}), northBoundaryCliffsRemoved: true };
    }
    return { removed, groups: targetTiersByGroup.size };
  }

  function readSlopeSeam(slope, zcols) {
    const pos = slope?.geometry?.getAttribute?.('position');
    if (!pos?.array?.length) return null;
    const step = 0.5;
    const xCount = Math.round(zcols / step) + 1;
    if (pos.count < xCount) return null;
    const seam = new Float32Array(xCount);
    for (let i = 0; i < xCount; i++) seam[i] = pos.getY ? pos.getY(i) : pos.array[i * 3 + 1];
    return { seam, step, xCount };
  }

  function makeSteepNorthProfile(slope, zcols, depth = NORTH_DEPTH) {
    const data = readSlopeSeam(slope, zcols);
    if (!data) return () => 0;
    const { seam, step, xCount } = data;
    const raw = x => {
      const gx = clamp(x / step, 0, xCount - 1);
      const x0 = Math.floor(gx), x1 = Math.min(xCount - 1, x0 + 1), t = gx - x0;
      return seam[x0] * (1 - t) + seam[x1] * t;
    };
    const smoothed = x => {
      const gx = clamp(Math.round(x / step), 0, xCount - 1);
      let sum = 0, weights = 0;
      for (let d = -6; d <= 6; d++) {
        const ix = clamp(gx + d, 0, xCount - 1);
        const w = 7 - Math.abs(d);
        sum += seam[ix] * w;
        weights += w;
      }
      return sum / Math.max(1, weights);
    };
    return (x, z) => {
      const out = clamp(-z, 0, depth);
      const shoulderT = smooth01(out / SHOULDER_DEPTH);
      const seamBase = raw(x) * (1 - shoulderT) + smoothed(x) * shoulderT;
      if (out <= SHOULDER_DEPTH) return seamBase + SHOULDER_RISE * shoulderT;
      const t = clamp((out - SHOULDER_DEPTH) / Math.max(0.001, depth - SHOULDER_DEPTH), 0, 1);
      // A gentle authored-height-style shoulder leads into an accelerating
      // hillside; the derivative is deliberately mild at the join and very
      // steep farther out so the edge reads as terrain, not a vertical wall.
      const steep = STEEP_RISE * (0.12 * t + 0.88 * t * t);
      const noise = (hash01(x, out, 919) * 2 - 1) * 0.045 * smooth01(t);
      return smoothed(x) + SHOULDER_RISE + steep + noise;
    };
  }

  function reshapeSlopeGeometry(slope, zcols, depth, heightAt) {
    const pos = slope?.geometry?.getAttribute?.('position');
    if (!pos) return false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX ? pos.getX(i) : pos.array[i * 3];
      const z = pos.getZ ? pos.getZ(i) : pos.array[i * 3 + 2];
      if (z > 0.001 || z < -depth - 0.001 || x < -0.001 || x > zcols + 0.001) continue;
      const y = heightAt(x, z) + 0.015;
      if (pos.setY) pos.setY(i, y); else pos.array[i * 3 + 1] = y;
    }
    pos.needsUpdate = true;
    slope.geometry.computeVertexNormals?.();
    slope.geometry.computeBoundingBox?.();
    slope.geometry.computeBoundingSphere?.();
    return true;
  }

  function removeSceneObject(scene, object) {
    if (!scene || !object) return;
    scene.remove?.(object);
    if (Array.isArray(scene.items)) {
      const index = scene.items.indexOf(object);
      if (index >= 0) scene.items.splice(index, 1);
    }
    if (object.userData?.ownedBackgroundGeometry || object.userData?.bakedForestWall || object.userData?.denseForestWall) object.geometry?.dispose?.();
  }

  function replaceNorthGenericBorder(scene, added, slope, zcols, heightAt) {
    const generic = added.find(o => o?.geometry?.getAttribute?.('position') && !o?.userData?.backgroundScenery);
    if (generic) {
      const pos = generic.geometry.getAttribute('position');
      let changed = false;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX ? pos.getX(i) : pos.array[i * 3];
        const z = pos.getZ ? pos.getZ(i) : pos.array[i * 3 + 2];
        if (x < 0 || x > zcols || z > 0 || z < -NORTH_DEPTH) continue;
        const y = heightAt(x, z) - 0.02;
        if (pos.setY) pos.setY(i, y); else pos.array[i * 3 + 1] = y;
        changed = true;
      }
      if (changed) {
        pos.needsUpdate = true;
        generic.geometry.computeVertexNormals?.();
        generic.geometry.computeBoundingBox?.();
        generic.geometry.computeBoundingSphere?.();
      }
    }

    for (const obj of added) {
      if (obj === generic || obj === slope || obj?.userData?.backgroundScenery || !obj?.geometry) continue;
      obj.geometry.computeBoundingBox?.();
      const box = obj.geometry.boundingBox;
      if (box && box.max.z <= 0.001 && box.min.z < -0.05) removeSceneObject(scene, obj);
    }
  }

  function runtimeNorthPathRun(zGrid, zcols) {
    if (!zGrid || !zcols) return null;
    const runs = [];
    let start = -1;
    for (let c = 0; c <= zcols; c++) {
      const hit = c < zcols && String(zGrid?.[0]?.[c]?.type || '').toLowerCase() === 'path';
      if (hit && start < 0) start = c;
      if (!hit && start >= 0) {
        runs.push({ start, end: c - 1, width: c - start, center: (start + c) * 0.5 });
        start = -1;
      }
    }
    if (!runs.length) return null;
    runs.sort((a, b) => b.width - a.width || Math.abs(a.center - zcols * 0.5) - Math.abs(b.center - zcols * 0.5));
    return runs[0];
  }

  // Generator flora is placed before the 2x tile-density expansion. Its
  // TREE_SPACING_MIN_DIST=1 therefore becomes a two-world-unit lattice in the
  // final rendered zone. Cloud Forest then thins 25% and converts 25% of the
  // survivors to variety, leaving about 56.25% of those positions as actual
  // Shadewoods. Match that visual density instead of making scenery a wall.
  function buildForestLayout(zcols, depth, pathCenter, clearHalf, heightAt = () => 0) {
    const entries = [];
    for (let out = 1; out < depth; out += TREE_LATTICE_WORLD) {
      for (let x = 1; x < zcols; x += TREE_LATTICE_WORLD) {
        if (Math.abs(x - pathCenter) < clearHalf) continue;
        if (hash01(x, out, 4801) >= TREE_KEEP_PROBABILITY) continue;
        const z = -out + (hash01(x, out, 4802) - 0.5) * 0.34;
        const px = x + (hash01(x, out, 4803) - 0.5) * 0.34;
        const scale = TREE_SCALE_MIN + (TREE_SCALE_MAX - TREE_SCALE_MIN) * hash01(x, out, 4804);
        entries.push({
          x: px, z, y: heightAt(px, z) + 0.02, scale,
          yaw: (hash01(x, out, 4805) - 0.5) * 0.7,
          seedA: Math.round(px * 97 + out * 31),
          seedB: Math.round(out * 89 + px * 17),
        });
      }
    }
    return entries;
  }

  function instanceForest(scene, entries) {
    const THREE = root.THREE;
    const FG = root.FoliageGenerator;
    if (!THREE?.InstancedMesh || !FG?.buildShadewoodMesh || !entries.length) return { chunks: 0, instances: 0 };
    const chunks = new Map();
    for (const entry of entries) {
      const key = `${Math.floor(entry.x / FOREST_CHUNK_WIDTH)},${Math.floor((-entry.z) / FOREST_CHUNK_DEPTH)}`;
      let list = chunks.get(key);
      if (!list) chunks.set(key, list = []);
      list.push(entry);
    }

    let chunkCount = 0, instanceCount = 0;
    for (const list of chunks.values()) {
      const buckets = new Map();
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const entry of list) {
        minX = Math.min(minX, entry.x); maxX = Math.max(maxX, entry.x);
        minZ = Math.min(minZ, entry.z); maxZ = Math.max(maxZ, entry.z);
        const tree = FG.buildShadewoodMesh(entry.seedA, entry.seedB);
        if (!tree) continue;
        tree.position.set(entry.x, entry.y, entry.z);
        tree.rotation.y += entry.yaw;
        tree.scale.multiplyScalar(entry.scale);
        tree.updateMatrixWorld(true);
        tree.traverse(obj => {
          if (!obj?.isMesh || !obj.geometry || !obj.material) return;
          const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
          if (!material) return;
          let byMaterial = buckets.get(obj.geometry);
          if (!byMaterial) buckets.set(obj.geometry, byMaterial = new Map());
          let matrices = byMaterial.get(material);
          if (!matrices) byMaterial.set(material, matrices = []);
          matrices.push(obj.matrixWorld.clone());
        });
        instanceCount++;
      }
      if (!buckets.size) continue;
      const group = new THREE.Group();
      group.name = `AuthoredCloudForestSceneryChunk_${chunkCount}`;
      for (const [geometry, byMaterial] of buckets) {
        for (const [material, matrices] of byMaterial) {
          const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
          for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          mesh.userData.backgroundScenery = true;
          group.add(mesh);
        }
      }
      const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
      const pad = 3.2;
      const radius = Math.hypot((maxX - minX) * 0.5 + pad, (maxZ - minZ) * 0.5 + pad);
      group.userData.backgroundScenery = true;
      group.userData.cloudForestScenery = true;
      group.userData.skipOcclusionFade = true;
      group.userData.cullSphere = { x: cx, z: cz, radius, xzRadius: radius };
      scene.add(group);
      chunkCount++;
    }
    return { chunks: chunkCount, instances: instanceCount };
  }

  let pathBuilder = null;
  let pathReady = null;
  function ensurePathBricksReady() {
    if (pathReady) return pathReady;
    if (typeof root.WallBuilder === 'undefined' && typeof WallBuilder === 'undefined') return Promise.reject(new Error('WallBuilder unavailable'));
    const Builder = root.WallBuilder || WallBuilder;
    pathBuilder = new Builder({ glbBasePath: 'assets/models/' });
    pathReady = Promise.all([
      pathBuilder.loadDefaultGlb(),
      fetch('assets/models/recipes/walls/wallrecipe2.json').then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching wallrecipe2.json`);
        return r.json();
      }),
    ]).then(([, recipe]) => {
      pathBuilder.addRecipe(PATH_RECIPE_ID, recipe);
      pathBuilder.tintDefaultGlb('assets/textures/carved_smooth.png', '#545039');
    });
    return pathReady;
  }

  function buildCloudPathBricks(scene, pathCenter, pathWidth, depth, heightAt, ribbon) {
    const THREE = root.THREE;
    if (!THREE) return Promise.resolve(false);
    return ensurePathBricksReady().then(() => {
      const groups = [];
      const half = pathWidth * 0.5;
      const xMin = pathCenter - half - 0.8, xMax = pathCenter + half + 0.8;
      const zMin = -depth - 0.8, zMax = 0.8;
      const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      for (let cz = Math.floor(zMin / PATH_CHUNK_SIZE) * PATH_CHUNK_SIZE; cz < zMax; cz += PATH_CHUNK_SIZE) {
        for (let cx = Math.floor(xMin / PATH_CHUNK_SIZE) * PATH_CHUNK_SIZE; cx < xMax; cx += PATH_CHUNK_SIZE) {
          const size = PATH_CHUNK_SIZE, y = 0.01;
          const panel = {
            id: 'cloud_forest_path_chunk', width: size, height: size,
            wallRecipeId: PATH_RECIPE_ID,
            position: [cx + size * 0.5, y, cz + size * 0.5],
            rotationDeg: [0, 0, 0],
            corners: [[cx, y, cz + size], [cx + size, y, cz + size], [cx + size, y, cz], [cx, y, cz]],
          };
          const group = pathBuilder.build([panel], {
            usePlaceholder: true, unitMult: 0.55, densityMult: 1, rockScale: 1.15,
            preScale: [1, 1, 0.32],
            brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 },
          });
          let keptAny = false;
          group.traverse(obj => {
            if (!obj.isInstancedMesh) return;
            let kept = 0;
            for (let i = 0; i < obj.count; i++) {
              obj.getMatrixAt(i, matrix);
              matrix.decompose(pos, quat, scale);
              if (Math.abs(pos.x - pathCenter) > half || pos.z > 0.08 || pos.z < -depth - 0.08) continue;
              pos.y += heightAt(pos.x, pos.z);
              matrix.compose(pos, quat, scale);
              if (kept !== i) obj.setMatrixAt(kept, matrix);
              kept++;
            }
            obj.count = kept;
            obj.instanceMatrix.needsUpdate = true;
            obj.castShadow = true;
            obj.receiveShadow = true;
            if (kept) keptAny = true;
          });
          if (!keptAny) {
            try { (root.WallBuilder || WallBuilder).disposeGroup(group); } catch (_) {}
            continue;
          }
          group.name = 'AuthoredCloudForestTownPathBricks';
          group.userData.backgroundScenery = true;
          scene.add(group);
          groups.push(group);
        }
      }
      if (groups.length && ribbon) removeSceneObject(scene, ribbon);
      return groups.length > 0;
    }).catch(() => false);
  }

  function patchGenerator() {
    const generator = root.WildernessMapGenerator;
    if (!generator?.generateZoneWorkspace || generator.__cloudForestRuntimeV2Generator) return;
    const original = generator.generateZoneWorkspace;
    generator.generateZoneWorkspace = function (zoneMapId, ...args) {
      const value = original.call(this, zoneMapId, ...args);
      const apply = workspace => {
        repairGeneratedEntryWorkspace(workspace);
        if (zoneMapId === CLOUD_ID) removeCloudForestNorthCliffs(workspace);
        return workspace;
      };
      return value && typeof value.then === 'function' ? value.then(apply) : apply(value);
    };
    generator.__cloudForestRuntimeV2Generator = true;
    // The older appended border-terrain experiment checks this exact flag.
    generator.__cloudForestNorthNoCliffPatch = true;
  }

  function patchBorderTerrain(BT) {
    if (!BT?.buildZoneBorderTerrain || BT.__cloudForestRuntimeV2Border) return BT;
    const original = BT.buildZoneBorderTerrain;
    BT.buildZoneBorderTerrain = function (scene, zcols, zrows, mapId, zoneBaseElev = 0, zGrid = null) {
      const before = new Set(scene?.children || scene?.items || []);
      const result = original.call(this, scene, zcols, zrows, mapId, zoneBaseElev, zGrid);
      if (mapId !== CLOUD_ID || !scene) return result;
      const collection = scene.children || scene.items || [];
      const added = collection.filter(obj => !before.has(obj));
      const slope = added.find(obj => obj?.name === 'AuthoredCloudForestNorthIncline')
        || collection.find(obj => obj?.name === 'AuthoredCloudForestNorthIncline');
      if (!slope) return result;

      const heightAt = makeSteepNorthProfile(slope, zcols, NORTH_DEPTH);
      reshapeSlopeGeometry(slope, zcols, NORTH_DEPTH, heightAt);
      replaceNorthGenericBorder(scene, added, slope, zcols, heightAt);

      for (const obj of [...collection]) {
        if (obj?.userData?.bakedForestWall || obj?.userData?.denseForestWall || obj?.userData?.cloudForestScenery) removeSceneObject(scene, obj);
      }

      const run = runtimeNorthPathRun(zGrid, zcols);
      const existingMeta = scene.userData?.authoredCloudForestScenery || {};
      const pathCenter = run?.center ?? existingMeta.pathCenter ?? zcols * 0.5;
      const pathWidth = Math.max(3.25, Math.min(4, run?.width || existingMeta.pathWidth || 3.25));
      const clearHalf = pathWidth * 0.5 + PATH_CLEARANCE;
      const layout = buildForestLayout(zcols, NORTH_DEPTH, pathCenter, clearHalf, heightAt);
      const stats = instanceForest(scene, layout);

      const ribbon = collection.find(obj => obj?.name === 'AuthoredCloudForestTownPath');
      buildCloudPathBricks(scene, pathCenter, pathWidth, NORTH_DEPTH, heightAt, ribbon);

      scene.userData = scene.userData || {};
      scene.userData.authoredCloudForestScenery = {
        ...existingMeta,
        pathCenter, pathWidth,
        treeCount: layout.length,
        generatedForestEquivalentDensity: true,
        treeLatticeWorld: TREE_LATTICE_WORLD,
        treeKeepProbability: TREE_KEEP_PROBABILITY,
        instanced: true,
        cullChunks: stats.chunks,
        northBoundaryCliffsRemoved: true,
        subtleShoulderDepth: SHOULDER_DEPTH,
        subtleShoulderRise: SHOULDER_RISE,
        steepRise: STEEP_RISE,
        pathBricksRequested: true,
      };
      return result;
    };
    BT.__cloudForestRuntimeV2Border = true;
    // Suppress the prior dense 1-world-unit + 75%/50% wrapper later in
    // border-terrain.js. The original authored-scenery builder still runs;
    // this wrapper removes/replaces only its Cloud Forest output.
    BT.__cloudForestDenseNorthPatch = true;
    return BT;
  }

  function installBorderSetter() {
    if (root.BorderTerrain) {
      patchBorderTerrain(root.BorderTerrain);
      return;
    }
    let value;
    try {
      Object.defineProperty(root, 'BorderTerrain', {
        configurable: true,
        enumerable: true,
        get() { return value; },
        set(next) {
          value = patchBorderTerrain(next);
          Object.defineProperty(root, 'BorderTerrain', { configurable: true, enumerable: true, writable: true, value });
        },
      });
    } catch (_) {}
  }

  const api = {
    CLOUD_ID, NORTH_DEPTH, SHOULDER_DEPTH, SHOULDER_RISE, STEEP_RISE,
    TREE_LATTICE_WORLD, TREE_KEEP_PROBABILITY,
    edgePathRuns, findEntryRun, repairGeneratedEntryWorkspace,
    removeCloudForestNorthCliffs, makeSteepNorthProfile, buildForestLayout,
    patchGenerator, patchBorderTerrain,
  };
  root.CloudForestRuntimeV2 = api;

  if (typeof document !== 'undefined') {
    patchGenerator();
    installBorderSetter();
  }
})(typeof window !== 'undefined' ? window : globalThis);
