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
//
// Town grass is not a hierarchy of per-tile groups: it is one InstancedMesh
// whose matrices are written by _fillBillboardInstances (28 instances per
// grass tile). Likewise, paved roads are WallBuilder instance groups which are
// generated, then compacted by the path-corridor filter before being added to
// the scene. Work at those real matrix boundaries rather than guessing from
// scene hierarchy. The shared visualHeights field remains the only elevation
// authority; this code only makes these two renderers follow it.
(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof THREE === 'undefined') return;

  let townDeps = null;
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  function sampleTownHeight(x, z) {
    const fn = window.HobunjiTownSubtleElevation?.sampleHeightAt;
    return typeof fn === 'function' ? (Number(fn(x, z)) || 0) : 0;
  }

  // Path panels have an exact authored id. Tag the returned WallBuilder group
  // immediately, before game.js performs its corridor compaction. The tag then
  // survives that compaction and gives the town-scene hook a precise identity;
  // no group-name/cull-sphere inference is required.
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
    // The farm/town/zone grass builders all identify their actual InstancedMesh
    // this way. Restricting the adjustment to the town scene below keeps farm
    // and wilderness matrices untouched.
    return !!(obj?.isInstancedMesh && obj.userData?.isBillboard === true && obj.count > 0);
  }

  function elevateBillboardMesh(mesh) {
    if (!isTownBillboardMesh(mesh)) return 0;
    const requiredLength = mesh.instanceMatrix?.array?.length || 0;
    if (!requiredLength) return 0;
    if (!mesh.userData.hobunjiTownSubtleBaseMatrices || mesh.userData.hobunjiTownSubtleBaseMatrices.length !== requiredLength) {
      // Capture the plateau-aware matrices already authored by
      // _fillBillboardInstances. Re-running this follower is idempotent because
      // every subsequent solve starts from these immutable originals.
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

  function elevatePathSurfaceGroup(group) {
    if (!isPathSurfaceGroup(group)) return 0;
    let moved = 0;
    group.traverse(inst => {
      if (!inst?.isInstancedMesh || !inst.count) return;
      const requiredLength = inst.instanceMatrix?.array?.length || 0;
      if (!requiredLength) return;
      if (!inst.userData.hobunjiTownSubtleBaseMatrices || inst.userData.hobunjiTownSubtleBaseMatrices.length !== requiredLength) {
        // This capture happens only after game.js has compacted the path chunk,
        // so it includes the existing elevTier correction and final kept-brick
        // order. Subtle Y is layered on top of that real runtime baseline.
        inst.userData.hobunjiTownSubtleBaseMatrices = new Float32Array(inst.instanceMatrix.array);
      }
      const base = inst.userData.hobunjiTownSubtleBaseMatrices;
      for (let i = 0; i < inst.count; i++) {
        matrix.fromArray(base, i * 16);
        matrix.decompose(pos, quat, scale);
        const lift = sampleTownHeight(pos.x, pos.z);
        pos.y += lift;
        matrix.compose(pos, quat, scale);
        inst.setMatrixAt(i, matrix);
        if (Math.abs(lift) > 1e-7) moved++;
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingBox?.();
      inst.computeBoundingSphere?.();
    });
    group.userData.hobunjiTownSubtleElevated = true;
    return moved;
  }

  function elevateObject(obj) {
    if (!obj) return { grass: 0, road: 0 };
    return {
      grass: elevateBillboardMesh(obj),
      road: elevatePathSurfaceGroup(obj),
    };
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
    let grass = 0, road = 0;
    for (const obj of scene.children || []) {
      const result = elevateObject(obj);
      grass += result.grass;
      road += result.road;
    }
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
      const result = originalInit.call(this, injectedDeps);
      // Town scene may not exist yet at init; the spawn wrapper below performs
      // the first guaranteed scan and installs its async-add hook.
      return result;
    };
    api.spawnTownBuildings = function (...args) {
      // The compatibility wrapper installed from config.js runs first through
      // originalSpawn and deforms the town ground. Follow that finished surface
      // immediately afterward so grass/roads read the same height field.
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
