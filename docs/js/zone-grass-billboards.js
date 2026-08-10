(() => {
  'use strict';

  // Grass billboard tufts for a wilderness zone (mirrors the farm/town
  // grass billboard builders, sized to each zone's own grid) and rich
  // foliage patches' own tightly-packed, tall billboard clusters (always
  // visible regardless of the Settings > Grass toggle, since they're meant
  // to read as a landmark rather than decorative ground cover). Extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as its sibling systems, alongside js/zone-plateau-mesa.js,
  // js/zone-terrain-features.js, and js/zone-den-totem-features.js.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function buildZoneGrassBillboards(zScene, zGrid, zcols, zrows, zoneBaseElev = 0) {
    const grassBillboardMat = deps.getGrassBillboardMat();
    if (!grassBillboardMat) return null;
    let count = 0;
    for (let row = 0; row < zrows; row++)
      for (let col = 0; col < zcols; col++)
        if (zGrid[row]?.[col]?.type === deps.TileType.GRASS) count++;
    if (count === 0) return null;

    const mesh = new THREE.InstancedMesh(deps.grassBladeGeo, grassBillboardMat, count * 28);
    mesh.frustumCulled = false;
    mesh.visible = deps.getGrassEnabled();
    mesh.userData.isBillboard = true;
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let row = 0; row < zrows; row++) {
      for (let col = 0; col < zcols; col++) {
        const tile = zGrid[row]?.[col];
        if (tile?.type !== deps.TileType.GRASS) continue;
        const tierY = (tile.elevTier || 0) * deps.PLATEAU_UNIT;
        idx = deps.fillBillboardInstances(mesh, dummy, idx, col, row, 1.0, zoneBaseElev + tierY);
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    zScene.add(mesh);
    return mesh;
  }

  // Rich foliage patches (see workspace.foliagePatches' `rich` flag —
  // the dense copse clusters the wildlife schedule AI's herbivores graze
  // in and predators patrol near) get their own tightly-packed, tall
  // billboard cluster instead of blending into the zone's ordinary grass
  // tufts — always visible regardless of the Settings > Grass toggle
  // (s_grass, see buildZoneGrassBillboards/settingGrass's handler,
  // neither of which this mesh is wired to), since it's meant to read as
  // a landmark, not decorative ground cover. Reuses the same blade
  // geometry/shader as ordinary grass — the visual distinction is
  // entirely density (more blades, tighter spread) and height (roughly
  // 2x), not a texture/color swap.
  function fillDenseTallBillboardInstances(mesh, dummy, startIdx, col, row, yOffset = 0) {
    const rand = deps.mbRng(((col * 31337 + row * 1009) >>> 0) ^ 0x9e3779b9);
    const baseY = deps.tileSurfaceY(deps.TileType.GRASS) + yOffset;
    let idx = startIdx;
    const BLADES = 24; // vs. fillBillboardInstances' 14 — reads as packed rather than scattered
    for (let b = 0; b < BLADES; b++) {
      const ox = (rand() - 0.5) * 0.55; // tighter spread than the normal ±0.45 tile so blades overlap into a clump
      const oz = (rand() - 0.5) * 0.55;
      const w  = 0.16 + rand() * 0.10; // width matches ordinary grass
      const h  = 0.48 + rand() * 0.26; // roughly 2x a normal blade's height
      const rot = rand() * Math.PI;
      const px = col + 0.5 + ox, pz = row + 0.5 + oz;
      dummy.position.set(px, baseY, pz);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(w, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
      dummy.rotation.set(0, rot + Math.PI * 0.5, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    }
    return idx;
  }

  function buildRichFoliageBillboards(zScene, zoneData, zGrid, zoneBaseElev = 0) {
    const grassBillboardMat = deps.getGrassBillboardMat();
    if (!grassBillboardMat) return;
    const richPatches = (zoneData?.foliagePatches || []).filter(p => p.rich);
    if (!richPatches.length) return;
    let tileCount = 0;
    for (const patch of richPatches) tileCount += patch.tiles.length;
    if (!tileCount) return;
    const BLADES = 24;
    const mesh = new THREE.InstancedMesh(deps.grassBladeGeo, grassBillboardMat, tileCount * BLADES * 2);
    mesh.frustumCulled = false;
    mesh.visible = true;
    mesh.userData.isBillboard = true;
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const patch of richPatches) {
      for (const t of patch.tiles) {
        const tierY = (zGrid?.[t.y]?.[t.x]?.elevTier || 0) * deps.PLATEAU_UNIT;
        idx = fillDenseTallBillboardInstances(mesh, dummy, idx, t.x, t.y, zoneBaseElev + tierY);
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    zScene.add(mesh);
  }

  window.ZoneGrassBillboards = {
    init,
    buildZoneGrassBillboards,
    buildRichFoliageBillboards,
  };
})();

// Town subtle-height followers for instanced ground cover and paved roads.
// Town grass is one InstancedMesh; paved roads are WallBuilder instance groups
// compacted by the path-corridor filter. Work at those real matrix boundaries.
(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof THREE === 'undefined') return;

  let townDeps = null;
  let roadRefreshQueued = false;
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const surfaceNormal = new THREE.Vector3(0, 1, 0);
  const slopeQuat = new THREE.Quaternion();
  const SLOPE_SAMPLE_OFFSET = 0.20;
  const ROAD_NEIGHBOR_MULTIPLIER = 1.58;
  const ROAD_SOLVER_ITERATIONS = 8;
  const ROAD_SOLVER_STRENGTH = 0.72;
  const ROAD_MIN_PROJECTED_SPACING = 0.08;

  function sampleTownHeight(x, z) {
    const fn = window.HobunjiTownSubtleElevation?.sampleHeightAt;
    return typeof fn === 'function' ? (Number(fn(x, z)) || 0) : 0;
  }

  // Approximate the normal of the same bilinearly-sampled visual-height field
  // around this world point. This drives brick tilt only; brick scale is never
  // changed by the subtle-height follower.
  function sampleTownSurfaceNormal(x, z) {
    const d = SLOPE_SAMPLE_OFFSET;
    const hLeft = sampleTownHeight(x - d, z);
    const hRight = sampleTownHeight(x + d, z);
    const hBack = sampleTownHeight(x, z - d);
    const hFront = sampleTownHeight(x, z + d);
    const dx = (hRight - hLeft) / (2 * d);
    const dz = (hFront - hBack) / (2 * d);
    surfaceNormal.set(-dx, 1, -dz);
    if (surfaceNormal.lengthSq() < 1e-10) surfaceNormal.copy(worldUp);
    else surfaceNormal.normalize();
    return surfaceNormal;
  }

  // Path panels have an exact authored id. Tag the returned WallBuilder group
  // before game.js performs its corridor compaction; the tag survives it.
  function patchWallBuilderPathTag() {
    const proto = window.WallBuilder?.prototype;
    if (!proto || proto.__hobunjiPathSurfaceTagPatched || typeof proto.build !== 'function') return;
    const originalBuild = proto.build;
    proto.build = function (panels, opts) {
      const group = originalBuild.call(this, panels, opts);
      if (group && Array.isArray(panels) && panels.some(panel => panel?.id === 'path_surface_chunk')) {
        group.userData = group.userData || {};
        group.userData.hobunjiPathSurface = true;
      }
      return group;
    };
    proto.__hobunjiPathSurfaceTagPatched = true;
  }

  function isTownBillboardMesh(obj) {
    return !!(obj?.isInstancedMesh && obj.userData?.isBillboard === true && obj.count > 0);
  }

  function elevateBillboardMesh(mesh) {
    if (!isTownBillboardMesh(mesh)) return 0;
    const requiredLength = mesh.instanceMatrix?.array?.length || 0;
    if (!requiredLength) return 0;
    if (!mesh.userData.hobunjiTownSubtleBaseMatrices || mesh.userData.hobunjiTownSubtleBaseMatrices.length !== requiredLength) {
      mesh.userData.hobunjiTownSubtleBaseMatrices = new Float32Array(mesh.instanceMatrix.array);
    }
    const base = mesh.userData.hobunjiTownSubtleBaseMatrices;
    let moved = 0;
    for (let i = 0; i < mesh.count; i++) {
      matrix.fromArray(base, i * 16);
      matrix.decompose(pos, quat, scale);
      const lift = sampleTownHeight(pos.x, pos.z);
      pos.y += lift;
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
      if (Math.abs(lift) > 1e-7) moved++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox?.();
    mesh.computeBoundingSphere?.();
    mesh.userData.hobunjiTownSubtleElevated = true;
    return moved;
  }

  function isPathSurfaceGroup(obj) {
    return !!(obj?.isGroup && obj.userData?.hobunjiPathSurface === true);
  }

  function _roadNodeKey(x, y, z) {
    // WallBuilder may create several InstancedMesh children for one GLB. Merge
    // matching transforms into one logical brick-center node so every child of
    // that brick receives the same position solve rather than being mistaken
    // for zero-distance neighbors.
    return `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`;
  }

  function collectRoadNodes(scene) {
    const nodeMap = new Map();
    const touchedMeshes = new Set();
    for (const group of (scene?.children || [])) {
      if (!isPathSurfaceGroup(group)) continue;
      group.traverse(inst => {
        if (!inst?.isInstancedMesh || !inst.count) return;
        const requiredLength = inst.instanceMatrix?.array?.length || 0;
        if (!requiredLength) return;
        if (!inst.userData.hobunjiTownSubtleBaseMatrices || inst.userData.hobunjiTownSubtleBaseMatrices.length !== requiredLength) {
          // Capture after game.js's corridor compaction/elevTier work. All later
          // road solves start from this immutable flat-layout matrix array.
          inst.userData.hobunjiTownSubtleBaseMatrices = new Float32Array(inst.instanceMatrix.array);
        }
        const base = inst.userData.hobunjiTownSubtleBaseMatrices;
        touchedMeshes.add(inst);
        for (let i = 0; i < inst.count; i++) {
          matrix.fromArray(base, i * 16);
          matrix.decompose(pos, quat, scale);
          const key = _roadNodeKey(pos.x, pos.y, pos.z);
          let node = nodeMap.get(key);
          if (!node) {
            node = {
              baseX: pos.x, baseY: pos.y, baseZ: pos.z,
              x: pos.x, z: pos.z,
              y: pos.y + sampleTownHeight(pos.x, pos.z),
              records: [],
            };
            nodeMap.set(key, node);
          }
          node.records.push({ inst, index: i });
        }
      });
    }
    return { nodes: [...nodeMap.values()], touchedMeshes };
  }

  function buildRoadNeighborEdges(nodes) {
    if (nodes.length < 2) return [];

    // The path recipe already gives us the desired flat brick lattice. Infer
    // its nearest-neighbor spacing from those original X/Z centers, then keep
    // all local lattice links out through the first diagonal band. Using one
    // graph for every visible/culled chunk prevents a new gap at chunk seams.
    const bucketSize = 1.0;
    const buckets = new Map();
    const bucketKey = (x, z) => `${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`;
    for (let i = 0; i < nodes.length; i++) {
      const key = bucketKey(nodes[i].baseX, nodes[i].baseZ);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    }

    const nearest = [];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const bx = Math.floor(a.baseX / bucketSize), bz = Math.floor(a.baseZ / bucketSize);
      let bestSq = Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const j of (buckets.get(`${bx + dx},${bz + dz}`) || [])) {
            if (j === i) continue;
            const b = nodes[j];
            const ddx = b.baseX - a.baseX, ddz = b.baseZ - a.baseZ;
            const dsq = ddx * ddx + ddz * ddz;
            if (dsq > 1e-8 && dsq < bestSq) bestSq = dsq;
          }
        }
      }
      if (bestSq < Infinity) nearest.push(Math.sqrt(bestSq));
    }
    if (!nearest.length) return [];
    nearest.sort((a, b) => a - b);
    const nearestSpacing = nearest[Math.floor(nearest.length * 0.5)];
    const cutoff = nearestSpacing * ROAD_NEIGHBOR_MULTIPLIER;
    const cutoffSq = cutoff * cutoff;
    const minSq = nearestSpacing * nearestSpacing * 0.20;
    const edges = [];

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const bx = Math.floor(a.baseX / bucketSize), bz = Math.floor(a.baseZ / bucketSize);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const j of (buckets.get(`${bx + dx},${bz + dz}`) || [])) {
            if (j <= i) continue;
            const b = nodes[j];
            const ddx = b.baseX - a.baseX, ddz = b.baseZ - a.baseZ;
            const horizSq = ddx * ddx + ddz * ddz;
            if (horizSq < minSq || horizSq > cutoffSq) continue;
            const ddy = b.baseY - a.baseY;
            edges.push({
              a: i,
              b: j,
              baseHoriz: Math.sqrt(horizSq),
              target3d: Math.sqrt(horizSq + ddy * ddy),
            });
          }
        }
      }
    }
    return edges;
  }

  function solveRoadProjectedSpacing(nodes, edges) {
    if (!edges.length) return;
    for (const node of nodes) {
      node.x = node.baseX;
      node.z = node.baseZ;
      node.y = node.baseY + sampleTownHeight(node.x, node.z);
    }

    for (let iteration = 0; iteration < ROAD_SOLVER_ITERATIONS; iteration++) {
      // Heights change when the projected centers move, so refresh the surface
      // samples once per relaxation pass before satisfying the neighbor links.
      for (const node of nodes) node.y = node.baseY + sampleTownHeight(node.x, node.z);

      for (const edge of edges) {
        const a = nodes[edge.a], b = nodes[edge.b];
        const dx = b.x - a.x, dz = b.z - a.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz < 1e-7) continue;
        const dy = b.y - a.y;

        // Keep the original flat-layout 3D center distance. Once a height
        // difference appears, the horizontal component must shrink so
        // sqrt(dx^2 + dz^2 + dy^2) remains the same. This changes positions,
        // not brick dimensions.
        const remainingSq = edge.target3d * edge.target3d - dy * dy;
        const minProjected = edge.baseHoriz * ROAD_MIN_PROJECTED_SPACING;
        const desiredHoriz = Math.max(minProjected, Math.sqrt(Math.max(0, remainingSq)));
        const error = horiz - desiredHoriz;
        if (Math.abs(error) < 1e-5) continue;
        const correction = error * ROAD_SOLVER_STRENGTH * 0.5;
        const ux = dx / horiz, uz = dz / horiz;
        a.x += ux * correction;
        a.z += uz * correction;
        b.x -= ux * correction;
        b.z -= uz * correction;
      }
    }
  }

  function relayoutTownRoads() {
    const scene = townDeps?.getTownScene?.();
    if (!scene) return 0;
    const { nodes, touchedMeshes } = collectRoadNodes(scene);
    if (!nodes.length) return 0;
    const edges = buildRoadNeighborEdges(nodes);
    solveRoadProjectedSpacing(nodes, edges);

    let moved = 0;
    for (const node of nodes) {
      const lift = sampleTownHeight(node.x, node.z);
      const normal = sampleTownSurfaceNormal(node.x, node.z);
      const projectedShift = Math.hypot(node.x - node.baseX, node.z - node.baseZ);
      for (const record of node.records) {
        const inst = record.inst;
        const base = inst.userData.hobunjiTownSubtleBaseMatrices;
        matrix.fromArray(base, record.index * 16);
        matrix.decompose(pos, quat, scale);
        pos.x = node.x;
        pos.z = node.z;
        pos.y += lift;

        // Preserve WallBuilder's road/yaw/random rotation, then tip the whole
        // unchanged brick so its up axis follows the local surface normal.
        slopeQuat.setFromUnitVectors(worldUp, normal);
        quat.premultiply(slopeQuat);
        matrix.compose(pos, quat, scale);
        inst.setMatrixAt(record.index, matrix);
        if (projectedShift > 1e-6 || Math.abs(lift) > 1e-7 || normal.y < 0.999999) moved++;
      }
    }

    for (const inst of touchedMeshes) {
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingBox?.();
      inst.computeBoundingSphere?.();
    }
    return moved;
  }

  function queueTownRoadLayout() {
    if (roadRefreshQueued) return;
    roadRefreshQueued = true;
    const schedule = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (fn => setTimeout(fn, 0));
    schedule(() => {
      roadRefreshQueued = false;
      const moved = relayoutTownRoads();
      if (moved) townDeps?.debugLog?.(`Town subtle elevation: surface-spacing solve moved ${moved} road-brick instance(s)`);
    });
  }

  function elevateObject(obj) {
    if (!obj) return { grass: 0, road: 0 };
    const grass = elevateBillboardMesh(obj);
    if (isPathSurfaceGroup(obj)) queueTownRoadLayout();
    return { grass, road: 0 };
  }

  function patchTownSceneAdd() {
    const scene = townDeps?.getTownScene?.();
    if (!scene || scene.userData.hobunjiExactSubtleFollowersAddPatched) return;
    const originalAdd = scene.add;
    scene.add = function (...objects) {
      const result = originalAdd.apply(this, objects);
      for (const obj of objects) elevateObject(obj);
      return result;
    };
    scene.userData.hobunjiExactSubtleFollowersAddPatched = true;
  }

  function refreshTownFollowers() {
    const scene = townDeps?.getTownScene?.();
    if (!scene) return { grass: 0, road: 0 };
    patchTownSceneAdd();
    let grass = 0;
    for (const obj of scene.children || []) grass += elevateBillboardMesh(obj);
    const road = relayoutTownRoads();
    if (grass || road) {
      townDeps?.debugLog?.(`Town subtle elevation exact followers: moved ${grass} billboard instance(s), ${road} road-brick instance(s)`);
    }
    return { grass, road };
  }

  function patchTownZoneBuildings() {
    const api = window.TownZoneBuildings;
    if (!api || api.__hobunjiExactSubtleFollowersPatched) return;
    const originalInit = api.init;
    const originalSpawn = api.spawnTownBuildings;
    if (typeof originalInit !== 'function' || typeof originalSpawn !== 'function') return;

    api.init = function (injectedDeps) {
      townDeps = injectedDeps;
      return originalInit.call(this, injectedDeps);
    };
    api.spawnTownBuildings = function (...args) {
      const result = originalSpawn.apply(this, args);
      refreshTownFollowers();
      return result;
    };
    api.refreshTownSubtleHeightFollowersExact = refreshTownFollowers;
    api.__hobunjiExactSubtleFollowersPatched = true;
  }

  patchWallBuilderPathTag();
  patchTownZoneBuildings();
})();
