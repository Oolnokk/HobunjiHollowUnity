// Hachutu vestibule: the stone-age pass of the V50 ruin (js/stone-age-ruin-scenery.js) replaces walls, pillars and
// floor, but leaves each hallway transit door as the original Harlyao mesh. Doors that the Root Growth Author binding
// did not take (it is budgeted to the doors nearest the arrival point) are re-skinned here with the same rockified
// geometry + quarry material. The swap is IN PLACE: the door's moving panel keeps its transform, parent and runtime
// state, so opening/closing and collision are untouched. Root-bound doors are skipped (their source is hidden).
(() => {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) return;

  function swapDoors(ruin, { builder = window.StoneAgeRuinScenery, material = ruin?.stoneAgeScenery?.room?.stoneMaterial, seed = '' } = {}) {
    const result = { doors: 0, meshes: 0, skippedBound: 0, errors: [] };
    if (!ruin?.transitDoorStates?.length || !builder?.ruinRockGeometry || !builder.mapRuinStoneSurfaces || !material) return result;
    let index = 0;
    for (const state of ruin.transitDoorStates) {
      const door = state.door;
      if (!door) continue;
      if (door.rootGrowthBinding) { result.skippedBound++; continue; }
      result.doors++;
      door.traverse(mesh => {
        if (!mesh.isMesh || !mesh.geometry?.getAttribute?.('position') || mesh.userData?.stoneAgeScenery || mesh.userData?.surfaceFoliage) return;
        if (mesh.visible === false || mesh.layers.mask === 0) return;
        const position = mesh.geometry.getAttribute('position');
        if (position.count < 8) return; // Single-quad seal decals stay as authored.
        try {
          mesh.geometry = builder.ruinRockGeometry(mesh, { enabled: true, seed: String(seed) + ':door-' + (index++), roughness: .25, contactArea: .35 });
          mesh.material = material;
          builder.mapRuinStoneSurfaces(mesh);
          result.meshes++;
        } catch (error) {
          result.errors.push(String(error?.message || error));
        }
      });
    }
    return result;
  }

  window.DevHachutuVestibuleStone = Object.freeze({ swapDoors });
})();
