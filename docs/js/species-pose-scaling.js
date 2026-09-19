// Shared species/gender weapon-pose scaling.
// Existing x/y/z remain Mao'ao-authored. Consumers compute their exact legacy
// final point first, then uniformly orbit only that point around the avatar's
// visual/body centroid. Rotations, timing, mirroring and projectile logic stay outside.
(() => {
  'use strict';

  const MAO_AO_ARM_LENGTH = 0.558; // Canonical reach all existing weapon poses calibrate against.

  function scaleForArmLength(armLength) {
    const reach = Number(armLength); // Canonical species+gender reach supplied by PNGPlaneAvatar.
    return Number.isFinite(reach) && reach > 0 ? reach / MAO_AO_ARM_LENGTH : 1;
  }

  function scalePointAroundCentroid(point, cx, cy, cz, armLength) {
    if (!point) return point;
    const scale = scaleForArmLength(armLength); // Uniform orbit factor; deliberately not a clamp or per-axis remap.
    if (scale === 1) return point; // Mao'ao preserves the exact pre-arm-length position path.
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    if (![x, y, z, cx, cy, cz].every(Number.isFinite)) return point;
    const nextX = cx + (x - cx) * scale; // Used by every finished pose consumer.
    const nextY = cy + (y - cy) * scale;
    const nextZ = cz + (z - cz) * scale;
    if (typeof point.set === 'function') point.set(nextX, nextY, nextZ);
    else { point.x = nextX; point.y = nextY; point.z = nextZ; }
    return point;
  }

  function unscalePointAroundCentroid(point, cx, cy, cz, armLength) {
    if (!point) return point;
    const scale = scaleForArmLength(armLength); // Exact inverse used by the Attack Editor gizmo.
    if (scale === 1) return point;
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    if (![x, y, z, cx, cy, cz].every(Number.isFinite)) return point;
    const nextX = cx + (x - cx) / scale;
    const nextY = cy + (y - cy) / scale;
    const nextZ = cz + (z - cz) / scale;
    if (typeof point.set === 'function') point.set(nextX, nextY, nextZ);
    else { point.x = nextX; point.y = nextY; point.z = nextZ; }
    return point;
  }

  window.HobunjiSpeciesPoseScale = Object.freeze({
    MAO_AO_ARM_LENGTH,
    scaleForArmLength,
    scalePointAroundCentroid,
    unscalePointAroundCentroid,
  });
})();
