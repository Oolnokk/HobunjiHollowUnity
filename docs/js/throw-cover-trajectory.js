// Shared ballistic cover and ground-ring outline for flasks and physical Burdens.
// Uses the same world-height tile/door and semantic-cover queries as ranged shots.
(() => {
  'use strict';

  const STEP_TILES = 0.16; // Sub-tile collision samples keep throws from tunnelling through narrow cover.
  const AIM_STEP_TILES = 0.22; // Preview arc segments bound work while matching the physical flight curve.
  const RADIUS_TILES = 0.12; // Swept flask/Burden clearance; passed to the ordinary ranged cover queries.
  const RETICLE_OUTLINE_INNER = 0.98; // Inner edge of the shared black AoE boundary.
  const RETICLE_OUTLINE_OUTER = 1.035; // Outer edge remains visible beyond the colored splash fill.

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function terrainY(x, z, opts) {
    const tile = opts?.tile || opts?.deps?.TILE || 64;
    const surface = opts?.deps?.worldSurfaceY?.(x * tile, z * tile);
    return Number.isFinite(surface) ? surface : finite(opts?.groundAt?.(x, z));
  }

  function contactAt(point, opts, progress = 0) {
    const deps = opts?.deps || {};
    const tile = opts?.tile || deps.TILE || 64;
    const radius = opts?.radius ?? RADIUS_TILES;
    const area = deps.getCurrentArea?.();
    if (window.InteriorDoorTiles?.blocksBox?.(area, point.x, point.z, radius, point.y)) return 'door';
    if (typeof deps.canOccupyAt === 'function') {
      if (!deps.canOccupyAt(point.x * tile, point.z * tile, radius * tile, point.y)) return 'tile-cover';
    } else {
      // Fallback for isolated Burden previews before Combat's adapters are connected.
      const grid = window.GridTileAccessors?.getActiveGrid?.();
      const col = Math.floor(point.x), row = Math.floor(point.z);
      const cover = window.ProjectileTileCover?.coverTop?.(grid?.[row]?.[col], col, row);
      if (cover != null && point.y - radius <= cover) return 'tile-cover';
    }
    // The intended endpoint rests on the ground. Never treat its last few
    // centimeters of descent as cover, but do stop at an intervening rise.
    if (progress < 0.975 && point.y + 0.025 < terrainY(point.x, point.z, opts)) return 'terrain';
    return null;
  }

  function sweep(start, end, opts = {}) {
    if (!start || !end) return null;
    const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / STEP_TILES));
    const radius = opts.radius ?? RADIUS_TILES;
    // Sight-mode uses identical authored semantic bounds even outside combat.
    // Aiming a flask must not depend on whether a battle is active.
    const semantic = window.NearbyVolumeCollision?.segmentSightHit?.(start, end, radius);
    let first = semantic && Number.isFinite(semantic.t)
      ? { t: Math.max(0, Math.min(1, semantic.t)), kind: 'semantic-cover' }
      : null;
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      if (first && t > first.t) break;
      const sample = { x: start.x + dx * t, y: start.y + dy * t, z: start.z + dz * t };
      const progress = finite(opts.progressStart) + (finite(opts.progressEnd, 1) - finite(opts.progressStart)) * t;
      const kind = contactAt(sample, opts, progress);
      if (!kind) continue;
      let lo = (i - 1) / count, hi = t;
      for (let j = 0; j < 5; j++) {
        const mid = (lo + hi) / 2;
        const p = { x: start.x + dx * mid, y: start.y + dy * mid, z: start.z + dz * mid };
        const at = finite(opts.progressStart) + (finite(opts.progressEnd, 1) - finite(opts.progressStart)) * mid;
        if (contactAt(p, opts, at)) hi = mid; else lo = mid;
      }
      first = { t: hi, kind };
      break;
    }
    return first ? {
      ...first, x: start.x + dx * first.t, y: start.y + dy * first.t,
      z: start.z + dz * first.t,
    } : null;
  }

  function fallbackFlight(origin, target, ratio, distance) {
    const t = Math.max(0, Math.min(1, ratio));
    const arc = Math.sin(Math.PI * t) * Math.min(1.65, 0.72 + distance * 0.065);
    return {
      x: origin.x + (target.x - origin.x) * t,
      y: origin.y + (target.y - origin.y) * t + arc,
      z: origin.z + (target.z - origin.z) * t,
    };
  }

  function resolve(origin, requested, opts = {}) {
    if (!origin || !requested || ![origin.x, origin.y, origin.z, requested.x, requested.z].every(Number.isFinite)) {
      return { target: requested, blocked: false, kind: null };
    }
    const groundAt = opts.groundAt || (() => 0);
    let target = { x: requested.x, y: finite(requested.y, groundAt(requested.x, requested.z)), z: requested.z };
    const directionX = target.x - origin.x, directionZ = target.z - origin.z;
    const originalDistance = Math.hypot(directionX, directionZ);
    if (originalDistance < 0.001) return { target, blocked: false, kind: null };
    const unitX = directionX / originalDistance, unitZ = directionZ / originalDistance;
    const flightPosition = opts.flightPosition || fallbackFlight;
    let blocked = false, kind = null;
    // A shortened throw has a different arc, so validate the shortened arc
    // again. Each pass only brings the target closer to the thrower.
    for (let attempt = 0; attempt < 4; attempt++) {
      const distance = Math.hypot(target.x - origin.x, target.z - origin.z);
      const count = Math.max(1, Math.ceil(distance / AIM_STEP_TILES));
      let previous = flightPosition(origin, target, 0, distance);
      let impact = null;
      for (let i = 1; i <= count; i++) {
        const progress = i / count;
        const next = flightPosition(origin, target, progress, distance);
        impact = sweep(previous, next, { ...opts, progressStart: (i - 1) / count, progressEnd: progress });
        if (impact) break;
        previous = next;
      }
      if (!impact) break;
      blocked = true;
      kind = impact.kind;
      const traveled = Math.max(0, Math.min(distance, Math.hypot(impact.x - origin.x, impact.z - origin.z) - 0.14));
      const shortened = { x: origin.x + unitX * traveled, z: origin.z + unitZ * traveled };
      shortened.y = finite(groundAt(shortened.x, shortened.z));
      if (Math.hypot(target.x - shortened.x, target.z - shortened.z) < 0.005) break;
      target = shortened;
    }
    return { target, blocked, kind };
  }

  function attachOutline(ring, THREE) {
    if (!ring || !THREE?.RingGeometry || !THREE?.MeshBasicMaterial) return null;
    if (ring.userData?.throwCoverOutline) return ring.userData.throwCoverOutline;
    const geometry = new THREE.RingGeometry(RETICLE_OUTLINE_INNER, RETICLE_OUTLINE_OUTER, 64, 3);
    const material = new THREE.MeshBasicMaterial({
      color: 0x050505, side: THREE.DoubleSide, transparent: true, opacity: 0.96, depthWrite: false,
    });
    const outline = new THREE.Mesh(geometry, material);
    outline.name = 'ground_throw_reticle_black_outline';
    outline.position.z = 0.008; // The parent's -90° ground rotation maps local Z to height.
    outline.renderOrder = 41;
    ring.add(outline);
    ring.userData.throwCoverOutline = outline;
    return outline;
  }

  function projectOutline(ring, radius, groundY, groundAt) {
    const outline = ring?.userData?.throwCoverOutline;
    const positions = outline?.geometry?.attributes?.position;
    if (!positions || !(radius > 0)) return;
    for (let i = 0; i < positions.count; i++) {
      const x = ring.position.x + positions.getX(i) * radius;
      const z = ring.position.z - positions.getY(i) * radius;
      positions.setZ(i, (finite(groundAt(x, z)) - groundY) / radius);
    }
    positions.needsUpdate = true;
    outline.geometry.computeBoundingSphere?.();
  }

  window.ThrowCoverTrajectory = { resolve, sweep, attachOutline, projectOutline };
})();
