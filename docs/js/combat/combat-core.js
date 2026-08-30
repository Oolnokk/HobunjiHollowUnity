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
    const actor = opts.actor;
    const target = opts.target || null;
    const solution = meleeAimSolution(actor, target, opts.yaw ?? actor?.facing ?? actor?.angle ?? 0, opts.pitch ?? 0);
    const collider = meleeColliderVolume(actor, opts, solution); // Reused by Show Hitboxes so trail and damage volume share an origin.
    rememberMeleeColliderDebug(collider);
    const samples = 16;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((samples + 1) * 2 * 3), 3));
    const indices = [];
    for (let sample = 0; sample < samples; sample++) {
      const a = sample * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    geometry.setIndex(indices);
    writeMeleeTrailRibbon(geometry.attributes.position, {
      samples, origin: solution.origin, direction: solution.direction,
      rangeTiles: Math.max(0, Number(opts.rangePx) || 0) / (deps?.TILE || 64),
      halfConeRad: opts.halfConeRad,
      halfThickness: opts.halfThickness,
      archUnits: opts.archUnits,
    });
    const material = new THREE.MeshBasicMaterial({
      color: opts.color ?? (actor === deps?.player ? 0xffffff : 0xff6a6a),
      transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    const scene = opts.scene || actor?.scene || deps?.getActiveScene?.();
    if (!scene) { geometry.dispose(); material.dispose(); return null; }
    scene.add(mesh);
    const trail = {
      mesh, scene, age: 0,
      holdS: Math.max(0, Number(opts.holdS) || 0.16),
      fadeS: Math.max(0.05, Number(opts.fadeS) || 0.18),
      actor: actor?.id || actor?.name || (actor === deps?.player ? 'player' : 'enemy'),
      pitchDeg: THREE.MathUtils.radToDeg(solution.pitch),
    };
    activeMeleeTrails.push(trail);
    return trail;
  }

  function updateMeleeTrails(dt) {
    for (let i = activeMeleeTrails.length - 1; i >= 0; i--) {
      const trail = activeMeleeTrails[i];
      trail.age += dt;
      if (trail.age <= trail.holdS) continue;
      const fade = 1 - (trail.age - trail.holdS) / trail.fadeS;
      if (fade > 0.01) { trail.mesh.material.opacity = fade * 0.85; continue; }
      trail.scene.remove(trail.mesh);
      trail.mesh.geometry.dispose();
      trail.mesh.material.dispose();
      activeMeleeTrails.splice(i, 1);
    }
  }

  function beginStagedAction(opts) {
    const action = {
      windupS: Math.max(0, opts.windupS || 0),
      strikeS: Math.max(0, opts.strikeS || 0),
      recoverS: Math.max(0, opts.recoverS || 0),
      onStrike: opts.onStrike || null,
      onComplete: opts.onComplete || null,
      onCancel: opts.onCancel || null,
      data: opts.data || null,
      t: 0,
      phase: 'windup',
      strikeFired: false,
      cancelled: false,
    };
    action.totalS = action.windupS + action.strikeS + action.recoverS;
    action.cancel = () => {
      if (action.cancelled || action.phase === 'done') return;
      action.cancelled = true;
      action.phase = 'done';
      activeStaged.delete(action);
      if (action.onCancel) action.onCancel(action);
    };
    activeStaged.add(action);
    if (action.totalS <= 0) {
      fireStagedStrike(action);
      finishStagedAction(action);
    }
    return action;
  }

  function fireStagedStrike(action) {
    if (action.strikeFired) return;
    action.strikeFired = true;
    if (!action.data?.silentSfx) deps?.playWeaponSlashSfx?.(action.data?.sfxPitch, action.data?.comboStep);
    if (action.onStrike) action.onStrike(action);
  }

  function finishStagedAction(action) {
    if (action.phase === 'done') return;
    action.phase = 'done';
    activeStaged.delete(action);
    if (action.onComplete) action.onComplete(action);
  }

  function updateStagedAction(action, dt) {
    if (action.cancelled || action.phase === 'done') return;
    action.t += dt;
    const strikeAt = action.windupS;
    if (!action.strikeFired && action.t >= strikeAt) fireStagedStrike(action);
    if (action.t >= action.totalS) finishStagedAction(action);
  }

  function update(dt) {
    updateMeleeTrails(dt);
    for (const action of Array.from(activeStaged)) updateStagedAction(action, dt);
  }

  function cancelAllStaged() {
    for (const action of Array.from(activeStaged)) {
      if (action.data?.isBandit) continue;
      action.cancel();
    }
  }

  function init(injectedDeps) {
    deps = injectedDeps;
  }

  function isStaggered(entity) {
    if (entity?.prone) return true;
    return !!(entity?.staggered?.active && performance.now() < entity.staggered.endsAt);
  }

  function beginStagger(entity, direction, durationS) {
    if (!entity || !(durationS > 0)) return;
    entity.staggered = { active: true, direction, endsAt: performance.now() + durationS * 1000 };
  }

  let playerDamageInterceptor = null;
  let movementSpeedMul = null;

  function setPlayerDamageInterceptor(fn) { playerDamageInterceptor = fn; }
  function tryInterceptPlayerDamage(amount, fromX, fromY) {
    return !!(playerDamageInterceptor && playerDamageInterceptor(amount, fromX, fromY));
  }
  function setMovementSpeedMul(fn) { movementSpeedMul = fn; }
  function getMovementSpeedMul() { return movementSpeedMul ? movementSpeedMul() : 1; }

  window.Combat = {
    init,
    registerWeaponAction,
    unregisterWeaponAction,
    resolveWeaponHit,
    beginStagedAction,
    cancelAllStaged,
    meleeAimSolution,
    meleeColliderVolume,
    meleeColliderWireframe,
    debugMeleeColliders,
    meleeHit,
    meleeLungeProfile,
    writeMeleeTrailRibbon,
    spawnMeleeTrail,
    isStaggered,
    beginStagger,
    update,
    setPlayerDamageInterceptor,
    tryInterceptPlayerDamage,
    setMovementSpeedMul,
    getMovementSpeedMul,
    get deps() { return deps; },
    MAX_MELEE_AIM_PITCH_RAD,
  };
  window.__melee3DDebug = {
    get lastResult() { return lastMelee3DResult; },
    get activeTrails() { return activeMeleeTrails.map(trail => ({ actor: trail.actor, age: trail.age, pitchDeg: trail.pitchDeg })); },
    snapshot: () => ({
      latestChange: 'Melee cones and trails use portrait Box3 volumes; angled lunges use attacker-specific height budgets for distance and leap arcs.',
      lastResult: lastMelee3DResult,
      activeTrailCount: activeMeleeTrails.length,
      activeColliders: debugMeleeColliders().map(collider => ({
        actor: collider.actor?.id || collider.actor?.name || (collider.actor === deps?.player ? 'player' : 'actor'),
        shape: 'pie-prism',
        pitchDeg: THREE.MathUtils.radToDeg(collider.pitch),
        rangeWorld: collider.rangeWorld,
        heightWorld: collider.halfHeightWorld * 2,
      })),
    }),
  };
})();

// Alcohol / drunken-affliction integration. Combat core is already loaded
// after ResourceSystem and before the extracted inventory/dialogue/calendar/
// world modules are initialized by game.js, so this can wrap their public
// init(deps) seams without duplicating any of game.js's state ownership.
(() => {
  "use strict";

  const RS = window.ResourceSystem;
  if (!RS || RS.__drunkenAfflictionsInstalled) return;

  const DRUNK_FOOTING_ID = "drunkenFooting";
  const DRUNK_HEALTH_ID = "drunkenHealth";
  const DRUNK_RECOVERY_PER_SEC = 0.02;
  const BLACKOUT_LOCAL_LIMIT_PERCENT = 25;
  const BLACKOUT_MIN_SKIP_MINUTES = 30;
  const BLACKOUT_MINUTES_PER_PERCENT = 10;
  const ALCOHOL_TAGS = new Set(["alcohol", "wine", "sake", "vodka", "nectar", "airag", "liquor", "spirit", "spirits", "beer", "ale", "mead", "cider"]);
  const INN_DRINKS = [
    { key: "needlegrainSake", buyPrice: 32 },
    { key: "heftrootVodka", buyPrice: 36 },
  ];

  let alchemyDeps = null;
  let storeDeps = null;
  let calendarDeps = null;
  let devDeps = null;
  let climbDeps = null;
  let dialogueDeps = null;
  let lastExteriorAnchor = null;
  let exteriorTrackerStarted = false;
  let lastBlackout = null;
  let lastDrink = null;
  let currentInnSeller = null;
  let originalBeginConversation = null;

  const original = {
    addAffliction: RS.addAffliction.bind(RS),
    removeAffliction: RS.removeAffliction.bind(RS),
    getEffectiveMax: RS.getEffectiveMax.bind(RS),
    getRingFillFraction: RS.getRingFillFraction.bind(RS),
    getSegmentBox: RS.getSegmentBox.bind(RS),
    enforceCaps: RS.enforceCaps.bind(RS),
    applyDamage: RS.applyDamage.bind(RS),
    spendStamina: RS.spendStamina.bind(RS),
    tick: RS.tick.bind(RS),
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const round1 = value => Math.round((Number(value) || 0) * 10) / 10;
  const gameRandom = () => window.GameRandom?.random?.() ?? Math.random();
  const maxFor = (entity, id) => id === DRUNK_FOOTING_ID
    ? Math.max(0, Number(entity?.maxFooting) || 0)
    : Math.max(0, Number(entity?.maxHealth) || 0);
  const getDrunk = (entity, id) => Math.max(0, Number(entity?.afflictions?.[id]) || 0);

  function setDrunk(entity, id, amount) {
    if (!entity) return 0;
    entity.afflictions ||= {};
    entity.afflictions[id] = Math.round(clamp(amount, 0, maxFor(entity, id)) * 1000) / 1000;
    return entity.afflictions[id];
  }

  function addDrunk(entity, id, amount) {
    if (!(amount > 0)) return 0;
    const before = getDrunk(entity, id);
    setDrunk(entity, id, before + amount);
    return round1(getDrunk(entity, id) - before);
  }

  function removeDrunk(entity, id, amount) {
    if (!(amount > 0)) return 0;
    const before = getDrunk(entity, id);
    setDrunk(entity, id, before - amount);
    return round1(before - getDrunk(entity, id));
  }

  RS.AFFLICTIONS[DRUNK_FOOTING_ID] = {
    name: "Drunken Footing", resource: "footing", extend: "maxBack", priority: 100, recovers: false,
    family: "control", tags: ["alcohol"],
    desc: "Black reserved Footing that always counts as spent until sobriety very slowly returns."
  };
  RS.AFFLICTIONS[DRUNK_HEALTH_ID] = {
    name: "Drunken Health", resource: "health", extend: "drunkBand", priority: 40, recovers: false,
    family: "defensiveDebuff", tags: ["alcohol"],
    desc: "Pink Health buffer: direct damage converts this band into Bleeding Health before real Health is lost."
  };

  RS.addAffliction = function drunkenAwareAddAffliction(entity, id, amount) {
    if (id === DRUNK_FOOTING_ID || id === DRUNK_HEALTH_ID) return addDrunk(entity, id, amount);
    return original.addAffliction(entity, id, amount);
  };

  RS.removeAffliction = function drunkenAwareRemoveAffliction(entity, id, amount) {
    if (id === DRUNK_FOOTING_ID || id === DRUNK_HEALTH_ID) return removeDrunk(entity, id, amount);
    return original.removeAffliction(entity, id, amount);
  };

  RS.getEffectiveMax = function drunkenAwareEffectiveMax(entity, key) {
    if (key === "footing") {
      return clamp((Number(entity?.maxFooting) || 0) - getDrunk(entity, DRUNK_FOOTING_ID), 0, Number(entity?.maxFooting) || 0);
    }
    return original.getEffectiveMax(entity, key);
  };

  function enforceDrunkenCaps(entity) {
    original.enforceCaps(entity);
    if (Number.isFinite(entity?.footing)) {
      entity.footing = round1(clamp(entity.footing, 0, RS.getEffectiveMax(entity, "footing")));
    }
  }
  RS.enforceCaps = enforceDrunkenCaps;

  RS.getRingFillFraction = function drunkenAwareRingFillFraction(entity, key) {
    if (key === "footing") {
      const max = Number(entity?.maxFooting) || 0;
      return max ? clamp(Number(entity?.footing) / max, 0, 1) : 0;
    }
    return original.getRingFillFraction(entity, key);
  };

  function currentBackHealthUnionWidth(entity) {
    let width = 0;
    for (const [id, def] of Object.entries(RS.AFFLICTIONS)) {
      if (id === DRUNK_HEALTH_ID || def.resource !== "health" || def.extend !== "currentBack") continue;
      width = Math.max(width, RS.getAffliction(entity, id));
    }
    return width;
  }

  RS.getSegmentBox = function drunkenAwareSegmentBox(entity, key, id) {
    if (id === DRUNK_FOOTING_ID) {
      const max = Number(entity?.maxFooting) || 0;
      const amount = clamp(getDrunk(entity, id), 0, max);
      return { leftPoints: max - amount, widthPoints: amount, max };
    }
    if (id === DRUNK_HEALTH_ID) {
      const max = Number(entity?.maxHealth) || 0;
      const current = clamp(Number(entity?.health) || 0, 0, max);
      const otherTail = clamp(currentBackHealthUnionWidth(entity), 0, current);
      const right = Math.max(0, current - otherTail);
      const width = Math.min(getDrunk(entity, id), right);
      return { leftPoints: Math.max(0, right - width), widthPoints: width, max };
    }
    return original.getSegmentBox(entity, key, id);
  };

  const availableBleedingCapacity = entity => Math.max(0,
    (Number(entity?.maxHealth) || 0) - RS.getAffliction(entity, "bleedingHealth"));

  RS.applyDamage = function drunkenAwareApplyDamage(entity, amount, opts = {}) {
    if (!(amount > 0)) return 0;
    entity.lastAttackReceivedAt = performance.now();
    let finalDamage = Number(amount) || 0;
    if (opts.heavy) {
      const bonus = Math.min(RS.getAffliction(entity, "bruisedHealth"), finalDamage);
      if (bonus > 0) {
        RS.removeAffliction(entity, "bruisedHealth", bonus);
        finalDamage += bonus;
      }
    }

    const convertible = Math.min(getDrunk(entity, DRUNK_HEALTH_ID), finalDamage, availableBleedingCapacity(entity));
    if (convertible > 0) {
      removeDrunk(entity, DRUNK_HEALTH_ID, convertible);
      original.addAffliction(entity, "bleedingHealth", convertible);
    }

    const remaining = Math.max(0, finalDamage - convertible);
    const before = Number(entity.health) || 0;
    if (remaining > 0) entity.health = round1(clamp(before - remaining, 0, original.getEffectiveMax(entity, "health")));
    const lost = round1(before - (Number(entity.health) || 0));

    if (opts.afflictionBonuses) {
      for (const [id, mul] of Object.entries(opts.afflictionBonuses)) {
        if (RS.AFFLICTIONS[id] && mul > 0) RS.addAffliction(entity, id, finalDamage * mul);
      }
    }
    enforceDrunkenCaps(entity);
    if (lost > 0) {
      window.dispatchEvent(new CustomEvent("hobunji-resource-change", {
        detail: { entity, delta: -lost, reason: opts.reason || "damage", immediate: true }
      }));
    }
    return lost;
  };

  RS.spendStamina = function drunkenAwareSpendStamina(entity, amount, reason) {
    const beforeHealth = Number(entity?.health) || 0;
    const beforeDrunk = getDrunk(entity, DRUNK_HEALTH_ID);
    const result = original.spendStamina(entity, amount, reason);
    const directLost = Math.max(0, beforeHealth - (Number(entity?.health) || 0));
    if (directLost > 0 && beforeDrunk > 0) {
      const convertible = Math.min(directLost, beforeDrunk, availableBleedingCapacity(entity));
      if (convertible > 0) {
        entity.health = round1(clamp((Number(entity.health) || 0) + convertible, 0, original.getEffectiveMax(entity, "health")));
        removeDrunk(entity, DRUNK_HEALTH_ID, convertible);
        original.addAffliction(entity, "bleedingHealth", convertible);
      }
    }
    enforceDrunkenCaps(entity);
    return result;
  };

  RS.tick = function drunkenAwareTick(entity, dt, opts = {}) {
    const result = original.tick(entity, dt, opts);
    const recovery = Math.max(0, Number(dt) || 0) * DRUNK_RECOVERY_PER_SEC;
    if (recovery > 0) {
      removeDrunk(entity, DRUNK_FOOTING_ID, recovery);
      removeDrunk(entity, DRUNK_HEALTH_ID, recovery);
    }
    enforceDrunkenCaps(entity);
    return result;
  };

  function ensureCanonicalInnDrinkDefs(itemDefs) {
    if (!itemDefs) return;
    itemDefs.needlegrainSake ||= {
      icon: "🍶", label: "Needlegrain Sake", cat: "processed", sellPrice: 24,
      tags: ["Processed", "Sake", "Aged", "Needlegrain"],
      desc: "Barrel-aged needlegrain liquor, colored like dark pine needles.",
      ingredientKeys: ["needlegrain"],
      swigsPerBottle: 4,
      spriteIcon: "bottle_wine.png", spriteColor: 0x2F4A2E, spriteMode: "keyed"
    };
    itemDefs.heftrootVodka ||= {
      icon: "🥃", label: "Heftroot Vodka", cat: "processed", sellPrice: 26,
      tags: ["Processed", "Vodka", "Aged", "Heftroot"],
      desc: "Barrel-aged heftroot spirit, golden-yellow like ripe heftroot.",
      ingredientKeys: ["heftroot"],
      swigsPerBottle: 4,
      spriteIcon: "bottle_wine.png", spriteColor: 0xF0D15A, spriteMode: "keyed"
    };
  }

  function alcoholProfileForDef(def) {
    if (!def) return null;
    const tags = (def.tags || []).map(tag => String(tag).toLowerCase());
    const haystack = `${tags.join(" ")} ${String(def.label || "").toLowerCase()}`;
    const alcoholic = tags.some(tag => ALCOHOL_TAGS.has(tag)) || /\b(wine|sake|vodka|nectar|airag|liquor|spirit|alcohol|beer|ale|mead|cider)\b/.test(haystack);
    if (!alcoholic) return null;
    if (haystack.includes("vodka") || haystack.includes("spirit") || haystack.includes("liquor")) return { footing: 32, health: 14, strength: "strong" };
    if (haystack.includes("sake")) return { footing: 24, health: 11, strength: "medium" };
    if (haystack.includes("wine")) return { footing: 20, health: 9, strength: "medium" };
    if (haystack.includes("nectar")) return { footing: 18, health: 8, strength: "mild" };
    if (haystack.includes("airag")) return { footing: 16, health: 7, strength: "mild" };
    return { footing: 20, health: 9, strength: "medium" };
  }

  const itemDefs = () => alchemyDeps?.ITEM_DEFS || storeDeps?.ITEM_DEFS || null;
  const isAlcoholItem = key => !!alcoholProfileForDef(itemDefs()?.[key]);

  function hookInit(api, onInit) {
    if (!api?.init || api.__hobunjiAlcoholInitHooked) return;
    const originalInit = api.init.bind(api);
    api.init = function alcoholAwareInit(injectedDeps) {
      const result = originalInit(injectedDeps);
      onInit(injectedDeps);
      return result;
    };
    api.__hobunjiAlcoholInitHooked = true;
  }

  function hookFutureGlobal(name, patch) {
    if (window[name]) { patch(window[name]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) return;
    Object.defineProperty(window, name, {
      configurable: true,
      get() { return undefined; },
      set(value) {
        delete window[name];
        window[name] = value;
        patch(value);
      }
    });
  }

  function installAlchemyHook(api) {
    hookInit(api, injectedDeps => {
      alchemyDeps = injectedDeps;
      ensureCanonicalInnDrinkDefs(injectedDeps?.ITEM_DEFS);
    });
    if (api.__hobunjiAlcoholDrinkHooked) return;
    const potionRegistry = api.ALCHEMY_POTION_ITEMS || {};
    api.ALCHEMY_POTION_ITEMS = new Proxy(potionRegistry, {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        if (typeof prop === "string" && isAlcoholItem(prop)) return ["__alcohol__"];
        return undefined;
      }
    });
    const originalDrinkPotion = api.drinkPotion?.bind(api);
    api.drinkPotion = function alcoholAwareDrinkPotion(key) {
      if (!isAlcoholItem(key)) return originalDrinkPotion ? originalDrinkPotion(key) : { ok: false, message: "No drink available." };
      const inventory = alchemyDeps?.inventory;
      const def = itemDefs()?.[key];
      const profile = alcoholProfileForDef(def);
      const player = window.Combat?.deps?.player;
      if (!inventory || !player || !profile || (inventory[key] || 0) < 1) return { ok: false, message: "No alcoholic drink to consume." };
      // Alcohol bottles are multi-serving. The bridge persists the currently
      // open bottle's remaining swigs and removes the inventory item only when
      // its last swig is consumed; the full legacy effect below still applies
      // on every swig. Fall back to whole-item consumption during early boot.
      const serving = window.HobunjiDrunkGameplayBridge?.consumeBottleSwig?.(key, def, inventory);
      if (serving && serving.ok === false) return serving;
      if (!serving) {
        inventory[key]--;
        alchemyDeps?.clampInventoryStack?.(key);
      }
      const result = RS.addDrunkenness(player, profile.footing, profile.health, { source: key, label: def?.label || key });
      lastDrink = {
        key, label: def?.label || key,
        footingAdded: result.footingAdded,
        healthAdded: result.healthAdded,
        deficitPercent: result.deficitPercent,
        at: performance.now()
      };
      const blackoutText = result.blackout ? ` Blackout: ${Math.round(result.deficitPercent)}% deficit.` : "";
      const servingText = serving
        ? ` ${serving.remaining}/${serving.total} swigs remain${serving.bottleFinished && serving.bottleCount <= 0 ? ' — bottle emptied' : ''}.`
        : '';
      return {
        ok: true,
        message: `${def?.icon || "🍷"} Drank a swig of ${def?.label || key}.${servingText}${blackoutText}`,
        serving,
      };
    };
    api.__hobunjiAlcoholDrinkHooked = true;
  }

  function installGeneralStoreHook(api) {
    hookInit(api, injectedDeps => {
      storeDeps = injectedDeps;
      ensureCanonicalInnDrinkDefs(injectedDeps?.ITEM_DEFS);
    });
  }
  function installCalendarHook(api) { hookInit(api, injectedDeps => { calendarDeps = injectedDeps; }); }
  function installClimbHook(api) { hookInit(api, injectedDeps => { climbDeps = injectedDeps; }); }

  function isExteriorArea(area) {
    return area === "farm" || area === "town" || !!devDeps?._isZoneArea?.(area);
  }

  function inferredExteriorForArea(area) {
    if (isExteriorArea(area)) return area;
    if (area === "interior") return "farm";
    if (area === "map_i_researchers_tent") return "map_northern_cliffs";
    if (/swamp/i.test(String(area))) return "map_eastern_mire";
    if (devDeps?._isBuildingArea?.(area)) return "town";
    return lastExteriorAnchor?.area || "town";
  }

  function startExteriorTracker() {
    if (exteriorTrackerStarted || !devDeps) return;
    exteriorTrackerStarted = true;
    const track = () => {
      const area = devDeps?.getCurrentArea?.();
      if (devDeps && isExteriorArea(area)) {
        lastExteriorAnchor = {
          area,
          col: Math.floor((Number(devDeps.player?.x) || 0) / (Number(devDeps.TILE) || 1)),
          row: Math.floor((Number(devDeps.player?.y) || 0) / (Number(devDeps.TILE) || 1))
        };
      }
      requestAnimationFrame(track);
    };
    requestAnimationFrame(track);
  }

  function installDevSpawnerHook(api) {
    hookInit(api, injectedDeps => {
      devDeps = injectedDeps;
      startExteriorTracker();
    });
  }

  function exteriorAdjacency(area) {
    const zoneIds = Object.keys(devDeps?.EXTERIOR_ZONES || {}).filter(id => id !== "map_dev_arena");
    if (area === "farm") return ["town"];
    if (area === "town") return ["farm", ...zoneIds];
    if (zoneIds.includes(area)) return ["town"];
    return ["town"];
  }

  function fallbackAnchorForArea(area, cols, rows) {
    if (lastExteriorAnchor?.area === area) return { col: lastExteriorAnchor.col, row: lastExteriorAnchor.row };
    const zdef = devDeps?.EXTERIOR_ZONES?.[area];
    if (zdef) {
      return {
        col: clamp(zdef.entryCol ?? Math.floor(cols / 2), 0, Math.max(0, cols - 1)),
        row: clamp(zdef.entryRow ?? Math.floor(rows / 2), 0, Math.max(0, rows - 1))
      };
    }
    if (area === "farm") return { col: clamp(17, 0, Math.max(0, cols - 1)), row: clamp(1, 0, Math.max(0, rows - 1)) };
    return { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  }

  function isBlackoutWalkable(grid, col, row) {
    const tile = grid?.[row]?.[col];
    if (!tile || tile.incline) return false;
    if (climbDeps?.isSolid?.(tile.type)) return false;
    return true;
  }

  function chooseWalkableTile(grid, cols, rows, anchor, radius) {
    const candidates = [];
    const r = Math.max(1, Math.round(radius));
    const minCol = Math.max(0, Math.floor(anchor.col - r));
    const maxCol = Math.min(cols - 1, Math.ceil(anchor.col + r));
    const minRow = Math.max(0, Math.floor(anchor.row - r));
    const maxRow = Math.min(rows - 1, Math.ceil(anchor.row + r));
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const dx = col - anchor.col, dy = row - anchor.row;
        if (dx * dx + dy * dy <= r * r && isBlackoutWalkable(grid, col, row)) candidates.push({ col, row });
      }
    }
    if (candidates.length) return candidates[Math.floor(gameRandom() * candidates.length)];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (isBlackoutWalkable(grid, col, row)) candidates.push({ col, row });
      }
    }
    return candidates.length ? candidates[Math.floor(gameRandom() * candidates.length)] : null;
  }

  function addPlayerToScene(scene) {
    if (!scene || !devDeps) return;
    scene.add(devDeps.playerMesh); scene.add(devDeps.playerGroundShadow);
    scene.add(devDeps.toolHolder); scene.add(devDeps.reticleMesh);
    scene.add(devDeps.reticleCircleMesh); scene.add(devDeps.reticleRingMesh);
    scene.add(devDeps.reticleWavyGroup);
  }

  function skipBlackoutTime(deficitPercent) {
    if (!calendarDeps?.calendar) return 0;
    const skippedMinutes = Math.max(BLACKOUT_MIN_SKIP_MINUTES, Math.round(deficitPercent * BLACKOUT_MINUTES_PER_PERCENT));
    const morning = Number(calendarDeps.MORNING_HOUR) || 6;
    const night = Number(calendarDeps.NIGHT_HOUR) || 22;
    const playableMinutesPerDay = Math.max(60, (night - morning) * 60);
    const calendar = calendarDeps.calendar;
    let total = (Number(calendar.time01) || 0) + skippedMinutes / playableMinutesPerDay;
    while (total >= 1) {
      total -= 1;
      calendar.day = (Number(calendar.day) || 1) + 1;
    }
    calendar.time01 = Math.max(0, total);
    return skippedMinutes;
  }

  function performBlackoutTravel(deficitPercent) {
    if (!devDeps) return null;
    const currentArea = devDeps.getCurrentArea();
    const baseExterior = inferredExteriorForArea(currentArea);
    const crossesMap = deficitPercent > BLACKOUT_LOCAL_LIMIT_PERCENT;
    const adjacent = exteriorAdjacency(baseExterior);
    const targetArea = crossesMap && adjacent.length
      ? adjacent[Math.floor(gameRandom() * adjacent.length)]
      : baseExterior;
    const radius = crossesMap
      ? Math.max(1, Math.ceil(deficitPercent - BLACKOUT_LOCAL_LIMIT_PERCENT))
      : Math.max(1, Math.ceil(deficitPercent));

    const doTravel = () => {
      const fromScene = devDeps.getActiveScene?.();
      if (fromScene) {
        fromScene.remove(devDeps.playerMesh); fromScene.remove(devDeps.playerGroundShadow);
        fromScene.remove(devDeps.toolHolder); fromScene.remove(devDeps.reticleMesh);
        fromScene.remove(devDeps.reticleCircleMesh); fromScene.remove(devDeps.reticleRingMesh);
        fromScene.remove(devDeps.reticleWavyGroup);
      }
      if (devDeps._isBuildingArea?.(currentArea)) devDeps.setCurrentBuildingMapId?.(null);
      devDeps.setCurrentArea(targetArea);
      // Construct the destination before asking for its grid/scene. In town this
      // also activates the latest render-only subtle-elevation scene lifecycle.
      if (targetArea === "town") devDeps.buildTownScene?.();
      else if (devDeps._isZoneArea?.(targetArea)) devDeps.buildZoneScene?.(targetArea);
      const grid = devDeps.getActiveGrid?.();
      const cols = Number(devDeps.getActiveCols?.()) || grid?.[0]?.length || 1;
      const rows = Number(devDeps.getActiveRows?.()) || grid?.length || 1;
      const anchor = !crossesMap && lastExteriorAnchor?.area === targetArea
        ? { col: lastExteriorAnchor.col, row: lastExteriorAnchor.row }
        : fallbackAnchorForArea(targetArea, cols, rows);
      const tile = chooseWalkableTile(grid, cols, rows, anchor, radius) || anchor;
      const tileSize = Number(devDeps.TILE) || 1;
      devDeps.player.x = (tile.col + 0.5) * tileSize;
      devDeps.player.y = (tile.row + 0.5) * tileSize;
      devDeps.player.vx = 0; devDeps.player.vy = 0;
      devDeps._snapCameraTarget?.();
      addPlayerToScene(devDeps.getActiveScene?.());
      devDeps.refreshActionBar?.();
      return { fromArea: currentArea, baseExterior, targetArea, radius, tile };
    };

    let immediateResult = null;
    if (typeof devDeps.startSceneTransition === "function") {
      devDeps.startSceneTransition(() => { immediateResult = doTravel(); });
    } else immediateResult = doTravel();
    return { requestedFromArea: currentArea, baseExterior, targetArea, radius, immediateResult };
  }

  function triggerBlackout(deficitPercent, source = "alcohol") {
    const effectivePercent = Math.max(1, Number(deficitPercent) || 0);
    const skippedMinutes = skipBlackoutTime(effectivePercent);
    const travel = performBlackoutTravel(effectivePercent);
    lastBlackout = { source, deficitPercent: effectivePercent, skippedMinutes, travel, at: performance.now() };
    devDeps?.showToast?.(`🍺 Blackout — ${skippedMinutes} minutes passed.`, true);
    return lastBlackout;
  }

  RS.addDrunkenness = function addDrunkenness(entity, footingAmount, healthAmount, opts = {}) {
    if (!entity) return { footingAdded: 0, healthAdded: 0, deficitPercent: 0, blackout: false };
    entity.afflictions ||= {};
    const maxFooting = Math.max(0, Number(entity.maxFooting) || 0);
    const before = getDrunk(entity, DRUNK_FOOTING_ID);
    const attempted = before + Math.max(0, Number(footingAmount) || 0);
    const footingAdded = addDrunk(entity, DRUNK_FOOTING_ID, footingAmount);
    const healthAdded = addDrunk(entity, DRUNK_HEALTH_ID, healthAmount);
    enforceDrunkenCaps(entity);
    const overflowPoints = Math.max(0, attempted - maxFooting);
    const reachedFull = maxFooting > 0 && before < maxFooting && getDrunk(entity, DRUNK_FOOTING_ID) >= maxFooting;
    const rawDeficitPercent = maxFooting > 0 ? overflowPoints / maxFooting * 100 : 0;
    const blackout = reachedFull || overflowPoints > 0;
    const deficitPercent = blackout ? Math.max(1, rawDeficitPercent) : 0;
    if (blackout && entity === window.Combat?.deps?.player) triggerBlackout(deficitPercent, opts.source || "alcohol");
    return { footingAdded, healthAdded, overflowPoints, deficitPercent, blackout };
  };

  function buyInnDrink(itemKey) {
    const stock = INN_DRINKS.find(item => item.key === itemKey);
    const def = itemDefs()?.[itemKey];
    if (!stock || !def || !storeDeps?.inventory) return;
    const gold = Number(storeDeps.inventory.gold) || 0;
    if (gold < stock.buyPrice) { storeDeps.showToast?.("Not enough gold.", false); return; }
    if ((storeDeps.inventory[itemKey] || 0) >= 99) { storeDeps.showToast?.("That stack is full.", false); return; }
    storeDeps.inventory.gold = gold - stock.buyPrice;
    storeDeps.inventory[itemKey] = Math.min(99, (storeDeps.inventory[itemKey] || 0) + 1);
    storeDeps.showToast?.(`Bought ${def.label}!`, true);
    storeDeps.buildInventoryGrid?.();
    storeDeps.saveMemberWorldData?.();
    renderInnDrinkChoices(currentInnSeller);
  }

  const sellerName = rec => `${rec?.id || ""} ${rec?.name || ""} ${rec?.displayName || ""} ${rec?.label || ""}`.toLowerCase();
  function isInnSeller(rec) {
    const name = sellerName(rec);
    return name.includes("hreesh") || name.includes("tooth");
  }
  function atInn() {
    const area = window.Combat?.deps?.getCurrentArea?.() || devDeps?.getCurrentArea?.();
    return area === "map_i_inn" || area === "map_i_inn_F2";
  }

  function setDialogueOption(index, label, onClick) {
    const button = document.getElementById(`dlgOpt${index}`);
    if (!button) return;
    const text = button.querySelector(".dlg-opt-label");
    if (text) text.textContent = label;
    button.classList.add("dlg-opt-visible");
    button.onclick = onClick;
  }

  function renderInnDrinkChoices(rec) {
    const dialogue = window.DialogueContent;
    if (!dialogue || !rec) return;
    currentInnSeller = rec;
    dialogue.beginSyntheticChoice(rec);
    dialogue.renderDlgNode({
      type: "choice",
      text: `${rec?.name || rec?.displayName || "The bartender"} gestures toward the bottles behind the bar.`,
      choices: []
    });
    dialogue.hideChoiceButtons?.();
    INN_DRINKS.forEach((stock, index) => {
      const def = itemDefs()?.[stock.key];
      setDialogueOption(index + 1, `${def?.icon || "🍷"} ${def?.label || stock.key} — ${stock.buyPrice}g`, () => buyInnDrink(stock.key));
    });
    setDialogueOption(3, "Chat", () => {
      currentInnSeller = null;
      originalBeginConversation?.(rec);
    });
    setDialogueOption(4, "Goodbye", () => {
      currentInnSeller = null;
      dialogue.resetDialogueState?.();
      dialogueDeps?.closeNpcDialogue?.();
    });
    const continueBtn = document.getElementById("npcDialogueContinue");
    if (continueBtn) continueBtn.style.display = "none";
  }

  function installDialogueHook(api) {
    hookInit(api, injectedDeps => { dialogueDeps = injectedDeps; });
    if (api.__hobunjiAlcoholDialogueHooked) return;
    originalBeginConversation = api.beginNpcConversation?.bind(api);
    if (!originalBeginConversation) return;
    api.beginNpcConversation = function alcoholAwareBeginConversation(rec) {
      if (isInnSeller(rec) && atInn()) { renderInnDrinkChoices(rec); return; }
      return originalBeginConversation(rec);
    };
    api.__hobunjiAlcoholDialogueHooked = true;
  }

  hookFutureGlobal("AlchemySystem", installAlchemyHook);
  hookFutureGlobal("GeneralStore", installGeneralStoreHook);
  hookFutureGlobal("CalendarSystem", installCalendarHook);
  hookFutureGlobal("ClimbSystem", installClimbHook);
  hookFutureGlobal("DevSpawner", installDevSpawnerHook);
  hookFutureGlobal("DialogueContent", installDialogueHook);

  RS.__drunkenAfflictionsInstalled = true;

  window.HobunjiAlcohol = {
    profileForItem(key) { return alcoholProfileForDef(itemDefs()?.[key]); },
    blackoutMinutesForDeficit(deficitPercent) {
      return Math.max(BLACKOUT_MIN_SKIP_MINUTES,
        Math.round(Math.max(1, Number(deficitPercent) || 0) * BLACKOUT_MINUTES_PER_PERCENT));
    },
    getDebug() {
      const player = window.Combat?.deps?.player;
      return {
        drunkenFooting: getDrunk(player, DRUNK_FOOTING_ID),
        drunkenHealth: getDrunk(player, DRUNK_HEALTH_ID),
        effectiveFootingMax: player ? RS.getEffectiveMax(player, "footing") : 0,
        recoveryPerSecond: DRUNK_RECOVERY_PER_SEC,
        sameMapDeficitLimitPercent: BLACKOUT_LOCAL_LIMIT_PERCENT,
        lastDrink, lastBlackout, lastExteriorAnchor
      };
    },
    forceDrink(profile = "vodka") {
      const player = window.Combat?.deps?.player;
      if (!player) return null;
      const fake = profile === "sake" ? { footing: 24, health: 11 }
        : profile === "wine" ? { footing: 20, health: 9 }
        : { footing: 32, health: 14 };
      return RS.addDrunkenness(player, fake.footing, fake.health, { source: `debug:${profile}` });
    },
    triggerBlackout(percent) { return triggerBlackout(percent, "debug"); },
    clear() {
      const player = window.Combat?.deps?.player;
      if (!player) return;
      setDrunk(player, DRUNK_FOOTING_ID, 0);
      setDrunk(player, DRUNK_HEALTH_ID, 0);
      enforceDrunkenCaps(player);
    }
  };
})();
