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
