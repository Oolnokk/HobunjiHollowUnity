// Combat core — shared windup→strike action pipeline for the weapon tool.
//
// game.js is one big closure-private IIFE, so this module can't reach into
// its internals directly. Instead game.js calls Combat.init(deps) once,
// near the end of its own setup, handing over live references (objects) and
// getter functions (for things that change, like the current area) that the
// rest of this file is built on. Everything below is namespaced on
// window.Combat so later combat-* modules (combo, quick attacks, holds,
// telegraph, loadout) can register into the same pipeline without any of
// them needing to know about game.js's internals either.
(() => {
  "use strict";

  let deps = null;

  const weaponHitResolvers = new Map();

  function registerWeaponAction(actionId, resolverFn) {
    weaponHitResolvers.set(actionId, resolverFn);
  }

  function unregisterWeaponAction(actionId) {
    weaponHitResolvers.delete(actionId);
  }

  function resolveWeaponHit(actionId, fallbackFn) {
    const resolver = weaponHitResolvers.get(actionId);
    if (resolver) return resolver({ actionId, deps });
    return fallbackFn(actionId);
  }

  const activeStaged = new Set();
  const MAX_MELEE_AIM_PITCH_RAD = THREE.MathUtils.degToRad(70);
  const MELEE_LEAP_START_PITCH_RAD = THREE.MathUtils.degToRad(12);
  const activeMeleeTrails = []; // Transient pitched ribbons aged by updateMeleeTrails().
  const activeMeleeColliderDebug = new Map(); // Recent real pie-prism volumes drawn by Show Hitboxes.
  let lastMelee3DResult = null; // Mobile-readable record of the latest 3D collider decision.

  function combatActorHitbox(actor) {
    return window.RangedWeapons?.actorHitbox?.(actor) || null;
  }

  function finiteDirection(raw) {
    if (![raw?.x, raw?.y, raw?.z].every(Number.isFinite)) return null;
    const direction = new THREE.Vector3(raw.x, raw.y, raw.z);
    return direction.lengthSq() > 1e-8 ? direction.normalize() : null;
  }

  function directionFromAngles(yaw = 0, pitch = 0) {
    const clampedPitch = THREE.MathUtils.clamp(Number(pitch) || 0, -MAX_MELEE_AIM_PITCH_RAD, MAX_MELEE_AIM_PITCH_RAD);
    const horizontal = Math.cos(clampedPitch);
    return new THREE.Vector3(Math.cos(yaw) * horizontal, Math.sin(clampedPitch), Math.sin(yaw) * horizontal).normalize();
  }

  function meleeAimSolution(attacker, target = null, fallbackYaw = 0, fallbackPitch = 0) {
    const attackerHitbox = combatActorHitbox(attacker);
    const origin = attackerHitbox?.center?.clone?.() || new THREE.Vector3(
      (Number(attacker?.x) || 0) / (deps?.TILE || 64),
      0.5,
      (Number(attacker?.y) || 0) / (deps?.TILE || 64),
    );
    const targetHitbox = combatActorHitbox(target);
    const targetPoint = targetHitbox?.center?.clone?.() || null;
    const targetDelta = targetPoint ? targetPoint.clone().sub(origin) : null;
    let direction = targetDelta && targetDelta.lengthSq() > 1e-8 ? targetDelta.normalize() : null;
    if (!direction && attacker === deps?.player) direction = finiteDirection(deps.getPlayerMeleeAimDirection?.());
    if (!direction) direction = directionFromAngles(fallbackYaw, fallbackPitch);
    const pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
    return {
      attacker, target, attackerHitbox, targetHitbox, origin, targetPoint, direction,
      yaw: Math.atan2(direction.z, direction.x),
      pitch,
    };
  }

  function boxSamplePoints(box, origin) {
    const center = box.getCenter(new THREE.Vector3());
    const closest = box.clampPoint(origin, new THREE.Vector3());
    const points = [closest];
    // A 3×3×3 volume grid catches cone/face intersections that corners alone
    // miss, while the exact center ray test in meleeHit keeps reticle alignment exact.
    for (const x of [box.min.x, center.x, box.max.x]) {
      for (const y of [box.min.y, center.y, box.max.y]) {
        for (const z of [box.min.z, center.z, box.max.z]) points.push(new THREE.Vector3(x, y, z));
      }
    }
    return points;
  }

  function meleeSolutionForOptions(attacker, opts = {}) {
    const hasExplicitAngles = opts.yaw != null || opts.pitch != null;
    const explicitDirection = finiteDirection(opts.direction)
      || (hasExplicitAngles ? directionFromAngles(opts.yaw ?? attacker?.facing ?? attacker?.angle ?? 0, opts.pitch ?? 0) : null);
    if (!explicitDirection) return meleeAimSolution(attacker, null, attacker?.facing ?? attacker?.angle ?? 0, 0);
    return {
      ...meleeAimSolution(attacker, null, opts.yaw, opts.pitch),
      direction: explicitDirection,
      yaw: Math.atan2(explicitDirection.z, explicitDirection.x),
      pitch: Math.asin(THREE.MathUtils.clamp(explicitDirection.y, -1, 1)),
    };
  }

  // The melee collider is a vertically extruded pie piece. Its pointed
  // vertical edge is centered on the attacker's portrait volume, while its
  // whole sector rises/falls with pitch instead of narrowing to a 3D cone tip.
  function meleeColliderVolume(attacker, opts = {}, solutionOverride = null) {
    const solution = solutionOverride || meleeSolutionForOptions(attacker, opts);
    const rangeWorld = Math.max(0, Number(opts.rangePx) || 0) / (deps?.TILE || 64);
    const pitch = THREE.MathUtils.clamp(solution.pitch, -MAX_MELEE_AIM_PITCH_RAD, MAX_MELEE_AIM_PITCH_RAD);
    const attackerSize = solution.attackerHitbox?.box?.getSize?.(new THREE.Vector3());
    const authoredHeight = Math.max(0.35, Number(attackerSize?.y) || 0.7);
    const heightWorld = Math.max(0.2, Number(opts.heightWorld) || authoredHeight);
    return {
      actor: attacker,
      origin: solution.origin.clone(),
      direction: solution.direction.clone(),
      yaw: solution.yaw,
      pitch,
      rangeWorld,
      horizontalRangeWorld: rangeWorld * Math.cos(pitch),
      verticalRiseWorld: rangeWorld * Math.sin(pitch),
      halfConeRad: Math.max(0, Number(opts.halfConeRad) || 0),
      halfHeightWorld: heightWorld / 2,
    };
  }

  function rememberMeleeColliderDebug(collider) {
    if (!collider?.actor) return;
    activeMeleeColliderDebug.set(collider.actor, {
      ...collider,
      recordedAt: Date.now(),
      expiresAt: Date.now() + 850,
    });
  }

  function debugMeleeColliders() {
    const now = Date.now();
    for (const [actor, collider] of activeMeleeColliderDebug) {
      if (collider.expiresAt < now) activeMeleeColliderDebug.delete(actor);
    }
    return Array.from(activeMeleeColliderDebug.values());
  }

  function meleeColliderPoint(collider, radialFraction, angleOffset, verticalSign) {
    const radial = THREE.MathUtils.clamp(Number(radialFraction) || 0, 0, 1);
    const angle = collider.yaw + angleOffset;
    return new THREE.Vector3(
      collider.origin.x + Math.cos(angle) * collider.horizontalRangeWorld * radial,
      collider.origin.y + collider.verticalRiseWorld * radial + collider.halfHeightWorld * verticalSign,
      collider.origin.z + Math.sin(angle) * collider.horizontalRangeWorld * radial,
    );
  }

  // Shared wireframe boundary generated from the same dimensions meleeHit
  // tests, preventing the debug drawing from drifting away from gameplay.
  function meleeColliderWireframe(collider, samples = 18) {
    const count = Math.max(4, Math.floor(Number(samples) || 18));
    const segments = [];
    const nearBottom = meleeColliderPoint(collider, 0, 0, -1);
    const nearTop = meleeColliderPoint(collider, 0, 0, 1);
    segments.push([nearBottom, nearTop]);
    for (const radial of [0.5, 1]) {
      let previousBottom = null, previousTop = null;
      for (let i = 0; i <= count; i++) {
        const angleOffset = -collider.halfConeRad + collider.halfConeRad * 2 * (i / count);
        const bottom = meleeColliderPoint(collider, radial, angleOffset, -1);
        const top = meleeColliderPoint(collider, radial, angleOffset, 1);
        if (previousBottom) {
          segments.push([previousBottom, bottom]);
          segments.push([previousTop, top]);
        }
        if (radial === 1 && (i === 0 || i === count || i % 3 === 0)) segments.push([bottom, top]);
        previousBottom = bottom;
        previousTop = top;
      }
    }
    for (const side of [-1, 1]) {
      const angleOffset = collider.halfConeRad * side;
      segments.push([nearBottom, meleeColliderPoint(collider, 1, angleOffset, -1)]);
      segments.push([nearTop, meleeColliderPoint(collider, 1, angleOffset, 1)]);
    }
    return segments;
  }

  // A target is hit when its portrait Box3 intersects the pitched, vertically
  // extruded pie piece described above.
  function meleeHit(attacker, target, opts = {}) {
    const solution = meleeSolutionForOptions(attacker, opts);
    const collider = meleeColliderVolume(attacker, opts, solution);
    if (opts.debug !== false) rememberMeleeColliderDebug(collider);
    const targetHitbox = combatActorHitbox(target);
    const rangePx = Math.max(0, Number(opts.rangePx) || 0);
    const halfConeRad = collider.halfConeRad;
    if (!targetHitbox?.box) {
      // Preserve the old 2D sector behavior for an actor whose portrait has
      // not mounted yet; never turn a missing render object into an automatic hit.
      const dx = (Number(target?.x) || 0) - (Number(attacker?.x) || 0);
      const dz = (Number(target?.y) || 0) - (Number(attacker?.y) || 0);
      const distancePx = Math.hypot(dx, dz);
      const pointYaw = Math.atan2(dz, dx);
      const yawDelta = Math.abs(Math.atan2(Math.sin(pointYaw - solution.yaw), Math.cos(pointYaw - solution.yaw)));
      const hit = distancePx <= rangePx && yawDelta <= halfConeRad;
      lastMelee3DResult = {
        at: Date.now(), hit, fallback2D: true, shape: 'pie-prism',
        attacker: attacker?.id || attacker?.name || (attacker === deps?.player ? 'player' : 'actor'),
        target: target?.id || target?.name || target?.def?.id || 'target',
        yawDeg: THREE.MathUtils.radToDeg(solution.yaw),
        pitchDeg: THREE.MathUtils.radToDeg(solution.pitch),
        halfConeDeg: THREE.MathUtils.radToDeg(halfConeRad),
        rangeWorld: collider.rangeWorld,
        horizontalRangeWorld: collider.horizontalRangeWorld,
        halfHeightWorld: collider.halfHeightWorld,
        bestDistanceWorld: distancePx / (deps?.TILE || 64),
        bestAngleDeg: THREE.MathUtils.radToDeg(yawDelta),
      };
      return hit;
    }

    let hit = false;
    let bestDistanceWorld = Infinity;
    let bestAngleRad = Infinity;
    let bestVerticalOffsetWorld = Infinity;
    // The centered reticle ray remains an exact contract: a direct Box3
    // intersection inside weapon length also lies on the pie piece centerline.
    const directPoint = new THREE.Ray(collider.origin, collider.direction)
      .intersectBox(targetHitbox.box, new THREE.Vector3());
    if (directPoint) {
      bestDistanceWorld = directPoint.distanceTo(collider.origin);
      bestAngleRad = 0;
      bestVerticalOffsetWorld = 0;
      hit = bestDistanceWorld <= collider.rangeWorld;
    }
    for (const point of boxSamplePoints(targetHitbox.box, collider.origin)) {
      const dx = point.x - collider.origin.x;
      const dz = point.z - collider.origin.z;
      const horizontalDistance = Math.hypot(dx, dz);
      const pointYaw = horizontalDistance > 1e-6 ? Math.atan2(dz, dx) : collider.yaw;
      const yawDelta = Math.abs(Math.atan2(Math.sin(pointYaw - collider.yaw), Math.cos(pointYaw - collider.yaw)));
      const radialFraction = collider.horizontalRangeWorld > 1e-6
        ? horizontalDistance / collider.horizontalRangeWorld
        : (horizontalDistance <= 1e-6 ? 0 : Infinity);
      const centerY = collider.origin.y + collider.verticalRiseWorld * radialFraction;
      const verticalOffset = Math.abs(point.y - centerY);
      const distanceWorld = point.distanceTo(collider.origin);
      if (distanceWorld < bestDistanceWorld || (distanceWorld === bestDistanceWorld && yawDelta < bestAngleRad)) {
        bestDistanceWorld = distanceWorld;
        bestAngleRad = yawDelta;
        bestVerticalOffsetWorld = verticalOffset;
      }
      if (radialFraction <= 1 && yawDelta <= halfConeRad && verticalOffset <= collider.halfHeightWorld) {
        hit = true;
        break;
      }
    }
    lastMelee3DResult = {
      at: Date.now(), hit, shape: 'pie-prism',
      attacker: attacker?.id || attacker?.name || (attacker === deps?.player ? 'player' : 'actor'),
      target: target?.id || target?.name || target?.def?.id || 'target',
      yawDeg: THREE.MathUtils.radToDeg(solution.yaw),
      pitchDeg: THREE.MathUtils.radToDeg(solution.pitch),
      halfConeDeg: THREE.MathUtils.radToDeg(halfConeRad),
      rangeWorld: collider.rangeWorld,
      horizontalRangeWorld: collider.horizontalRangeWorld,
      halfHeightWorld: collider.halfHeightWorld,
      bestDistanceWorld,
      bestAngleDeg: THREE.MathUtils.radToDeg(bestAngleRad),
      bestVerticalOffsetWorld,
    };
    return hit;
  }

  // Horizontal travel falls with aim angle, but the falloff is authored per
  // attacker. A creature's lungeHeightUnits is the vertical leap budget:
  // tiny values (Uumkao'ii) nearly stop a vertical lunge, while a tall
  // Drenkirra leap can retain more than its horizontal attack distance.
  function meleeLungeProfile(baseDistancePx, aimPitch = 0, baseHopUnits = 0, lungeHeightUnits = 1) {
    const pitch = THREE.MathUtils.clamp(Number(aimPitch) || 0, -MAX_MELEE_AIM_PITCH_RAD, MAX_MELEE_AIM_PITCH_RAD);
    const absPitch = Math.abs(pitch);
    const distanceScaleAtAngle = THREE.MathUtils.clamp(1 - absPitch / (Math.PI / 2), 0, 1);
    const leapT = THREE.MathUtils.clamp(
      (pitch - MELEE_LEAP_START_PITCH_RAD) / Math.max(1e-6, MAX_MELEE_AIM_PITCH_RAD - MELEE_LEAP_START_PITCH_RAD),
      0, 1,
    );
    const baseDistanceWorld = Math.max(0, Number(baseDistancePx) || 0) / (deps?.TILE || 64);
    const heightUnits = Math.max(0, Number(lungeHeightUnits) || 0);
    const heightToDistance = baseDistanceWorld > 1e-4 ? heightUnits / baseDistanceWorld : 0;
    // The same linear angle decrease remains at the core; the leap height
    // adds a linear, authored recovery term as the aim turns upward.
    const distanceScale = THREE.MathUtils.clamp(
      distanceScaleAtAngle + leapT * heightToDistance,
      0, 3.5,
    );
    return {
      pitch,
      distanceScale,
      lungeHeightUnits: heightUnits,
      distancePx: Math.max(0, Number(baseDistancePx) || 0) * distanceScale,
      leapT,
      hopUnits: Math.max(0, Number(baseHopUnits) || 0) + leapT * heightUnits,
    };
  }

  // Writes a tapered ribbon in a plane tilted to the attack's pitch. At zero
  // pitch this is the familiar horizontal sweep; aiming up rotates the whole
  // sweep plane upward instead of merely raising a flat ground arc.
  function writeMeleeTrailRibbon(positionAttr, opts = {}) {
    const samples = Math.max(2, Math.floor(Number(opts.samples) || 16));
    const origin = opts.origin?.isVector3 ? opts.origin : new THREE.Vector3();
    const direction = finiteDirection(opts.direction) || directionFromAngles(opts.yaw, opts.pitch);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(direction, worldUp);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    else side.normalize();
    const planeUp = new THREE.Vector3().crossVectors(side, direction).normalize();
    const rangeTiles = Math.max(0, Number(opts.rangeTiles) || 0);
    const halfConeRad = Math.max(0, Number(opts.halfConeRad) || 0);
    const halfThickness = Math.max(0.001, Number(opts.halfThickness) || 0.06);
    const archUnits = Math.max(0, Number(opts.archUnits) || 0.22);
    for (let sample = 0; sample <= samples; sample++) {
      const u = sample / samples;
      const sweepAngle = -halfConeRad + 2 * halfConeRad * u;
      const radial = direction.clone().applyAxisAngle(planeUp, sweepAngle);
      const taper = Math.sin(u * Math.PI);
      const half = halfThickness * (0.25 + 0.75 * taper);
      const arch = planeUp.clone().multiplyScalar(archUnits * taper);
      const inner = origin.clone().addScaledVector(radial, Math.max(0, rangeTiles - half)).add(arch);
      const outer = origin.clone().addScaledVector(radial, rangeTiles + half).add(arch);
      const vi = sample * 2;
      positionAttr.setXYZ(vi, inner.x, inner.y, inner.z);
      positionAttr.setXYZ(vi + 1, outer.x, outer.y, outer.z);
    }
    positionAttr.needsUpdate = true;
  }

  function spawnMeleeTrail(opts = {}) {
    const actor = opts.actor