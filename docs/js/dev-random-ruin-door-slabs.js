// Random Test Ruin: V50 doors that stand on the floor when closed, on every story.
//
// V50 hangs each vertical stone door and each hallway transit door from the top of its 2.35-tall arch
// frame, but makes the slab only 1.9 tall, so a closed door stops 0.45 above the floor: it reads as
// already open. The ground floor is already corrected by js/dev-random-ruin-wall-render-proxy.js
// (normalizeDoorAssemblies lowers each door root to the arch base plus its slab height), but the
// native upper stories never go through that pass, so their doors still hover. This applies the same
// placement, with the same arithmetic, to whatever root it is given; running both is harmless.
//
// V50's source is pinned byte-for-byte by tests, so this runs after generation. The open motion is
// unchanged: the stone door shrinks toward its root (now just under the lintel) and the transit door
// lifts its panel by its own height.
//
// Called from applyUnlitRuinMaterials (js/dev-random-ruin-interior-map.js), which runs on the ground
// floor and, as prepareMaterials, on every native floor, before collision and controls read the slab.
(() => {
  'use strict';

  const SAME_SPOT = .08 ** 2; // A door stands where its arch does (squared distance, as the render proxy measures it).

  function isV50Door(data) {
    return data?.transitDoor === true || (data?.previewMotion?.type === 'stoneDoor' && !!data.mechanismId);
  }

  function slabHeight(door) {
    const panel = (door.children || []).find(child => child?.isMesh && child.geometry);
    if (!panel) return null;
    panel.geometry.computeBoundingBox?.();
    const box = panel.geometry.boundingBox;
    return box ? box.max.y - box.min.y : 1.9; // 1.9 is V50's own slab height.
  }

  function normalize(root) {
    const arches = [], doors = [];
    root?.traverse?.(object => {
      if (object.userData?.archFootprint) arches.push(object);
      if (isV50Door(object.userData)) doors.push(object);
    });
    let lowered = 0;
    for (const door of doors) {
      if (door.userData.devRuinDoorSlabGrounded) continue;
      let arch = null, nearest = SAME_SPOT;
      for (const candidate of arches) {
        const distance = (candidate.position.x - door.position.x) ** 2 + (candidate.position.z - door.position.z) ** 2;
        if (distance < nearest) { nearest = distance; arch = candidate; }
      }
      const height = slabHeight(door);
      if (!arch || !(height > 0)) continue;
      door.userData.devRuinDoorSlabGrounded = true;
      const y = Number(arch.position.y) + height; // Slab bottom exactly on the arch base, which is the floor.
      if (Math.abs(door.position.y - y) > 1e-6) { door.position.y = y; lowered++; }
    }
    return lowered;
  }

  window.DevRandomRuinDoorSlabs = Object.freeze({ normalize });
})();
