// Initialization-only bridge that makes the actual camera/reticle ray the
// authority for the one finite perspective point beneath the reticle. Walking
// stays in game.js's native point-relative path; this module keeps attack lunges
// converged on that same endpoint, preserves the unmodified camera ray, and
// piggybacks Combat.update for lunge-entry correction without adding a second
// animation loop.
(() => {
  'use strict';

  const VERSION = 4;
  const EPSILON = 1e-8;
  const LUNGE_CANCEL_RANGE_MULTIPLIER = 0.5; // Used only by lunge stop tests; authored strike/hit reach remains full length.
  let rangedInitWrapped = false; // Exposed in debugSnapshot() to verify the ranged initialization boundary was patched once.
  let combatInitWrapped = false; // Exposed in debugSnapshot() to verify the combat initialization boundary was patched once.
  let cameraRayDepsProvided = false; // Exposed to verify ranged-camera-focus receives the true camera-origin ray through its compatibility dependency.
  let perspectiveTargetDepsProvided = false; // Exposed to verify combat/ranged wrappers receive the shared finite reticle point.
  let nativeMeleeDirectionRestored = false; // Records whether Combat's original camera-derived melee direction callback won after initialization.
  let nativeMeleePitchRestored = false; // Records whether Combat's original camera-derived melee pitch callback won after initialization.
  let lungeAuthorityInstalled = false; // Records whether beginCombatLunge was wrapped so player displacement converges on the perspective point.
  let exactReticleAlignmentInstalled = false; // Records whether player attack alignment now releases only on a real center-ray Box3 intersection.
  let combatUpdateSweepInstalled = false; // Records whether the existing Combat.update tick carries the lunge-entry sweep.
  let lungeAuthorityCount = 0; // Mobile-readable count of lunges corrected toward the shared perspective point.
  let reticleBoxHitCount = 0; // Mobile-readable count of exact target Box3 intersections accepted by transient melee alignment.
  let lungeEarlyStopCount = 0; // Mobile-readable count of lunges clamped to the first attack-volume entry point.
  let lastCameraRay = null; // Mobile-readable snapshot of the true centered camera ray handed to ranged-camera-focus.
  let lastLunge = null; // Mobile-readable snapshot of the latest camera-authored lunge direction/profile.
  let lastLungeSweep = null; // Mobile-readable snapshot of the latest swept lunge range-entry correction.
  let lungeSweepAnchor = null; // Previous post-movement player position used only while a combat lunge is active.
  let lastError = null; // Mobile-readable initialization/runtime error without putting failures into an independent frame loop.

  function recordError(stage, error) {
    lastError = {
      at: Date.now(),
      stage,
      detail: String(error?.stack || error?.message || error || 'unknown error'),
    };
    window.__farmLog?.(`[combat-camera-alignment] ${stage}: ${lastError.detail}`, 'warn', 'combat');
  }

  function normalizedRay(raw) {
    const ox = Number(raw?.origin?.x), oy = Number(raw?.origin?.y), oz = Number(raw?.origin?.z);
    const x = Number(raw?.direction?.x), y = Number(raw?.direction?.y), z = Number(raw?.direction?.z);
    if (![ox, oy, oz, x, y, z].every(Number.isFinite)) return null;
    const length = Math.hypot(x, y, z);
    if (!(length > EPSILON)) return null;
    return {
      origin: { x: ox, y: oy, z: oz },
      direction: { x: x / length, y: y / length, z: z / length },
    };
  }

  function centeredCameraRay(rawInteractionRay, rawAimRay) {
    let raw = null;
    try { raw = rawInteractionRay?.() || rawAimRay?.() || null; }
    catch (error) { recordError('camera-ray', error); }
    const ray = normalizedRay(raw);
    if (!ray) return raw || null;
    lastCameraRay = {
      origin: { ...ray.origin },
      direction: { ...ray.direction },
    };
    return ray;
  }

  function perspectivePoint(liveDeps) {
    try {
      const target = liveDeps?.getPlayerPerspectiveTarget?.(); // Game-owned shared endpoint used by every player aim consumer.
      const x = Number(target?.point?.x ?? target?.x); // Perspective point X validated for lunge convergence.
      const y = Number(target?.point?.y ?? target?.y); // Perspective point Y carrying lunge verticality.
      const z = Number(target?.point?.z ?? target?.z); // Perspective point Z validated for lunge convergence.
      if ([x, y, z].every(Number.isFinite)) return { x, y, z };
    } catch (error) {
      recordError('perspective-point', error);
    }
    return null;
  }

  function finiteBox(box) {
    return ['x', 'y', 'z'].every(axis => Number.isFinite(box?.min?.[axis]) && Number.isFinite(box?.max?.[axis]));
  }

  function rayBoxInterval(ray, box) {
    if (!ray || !finiteBox(box)) return null;
    let enter = 0;
    let exit = Infinity;
    for (const axis of ['x', 'y', 'z']) {
      const origin = Number(ray.origin[axis]);
      const direction = Number(ray.direction[axis]);
      const min = Number(box.min[axis]);
      const max = Number(box.max[axis]);
      if (Math.abs(direction) <= EPSILON) {
        if (origin < min || origin > max) return null;
        continue;
      }
      let a = (min - origin) / direction;
      let b = (max - origin) / direction;
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, b);
      if (exit < enter) return null;
    }
    return exit >= 0 ? { enter: Math.max(0, enter), exit } : null;
  }

  function exactReticleRay(liveDeps, rawInteractionRay, rawAimRay) {
    try {
      const shared = normalizedRay(liveDeps?.getPlayerPerspectiveTarget?.()?.cameraRay);
      if (shared) return shared;
    } catch (error) {
      recordError('reticle-ray', error);
    }
    return normalizedRay(centeredCameraRay(rawInteractionRay, rawAimRay));
  }

  function installExactReticleAlignment(liveDeps, rawInteractionRay, rawAimRay) {
    const combat = window.Combat;
    const previousStep = combat?.attackAlignmentStep;
    if (!combat || typeof previousStep !== 'function') return false;
    if (previousStep.__hobunjiExactReticleBoxAlignment) {
      exactReticleAlignmentInstalled = true;
      return true;
    }

    function exactReticleAttackAlignmentStep(attacker, target, dt, options = {}) {
      const base = previousStep.apply(this, arguments);
      if (attacker !== liveDeps?.player || !target) return base;
      const box = window.RangedWeapons?.actorHitbox?.(target)?.box;
      const ray = exactReticleRay(liveDeps, rawInteractionRay, rawAimRay);
      if (!ray || !finiteBox(box)) return base;

      const exactHit = !!rayBoxInterval(ray, box);
      if (!base?.eligible) {
        return { ...base, exactReticleHitboxIntersection: exactHit };
      }
      const facing = Number(options?.facing ?? attacker?.facing) || 0;
      if (exactHit) {
        reticleBoxHitCount++;
        return {
          ...base,
          aligned: true,
          desiredFacing: facing,
          nextFacing: facing,
          deltaRad: 0,
          reticleOverTarget: true,
          exactReticleHitboxIntersection: true,
          alignmentSource: 'screen-reticle-box3',
        };
      }

      // combat-core's legacy overlap check is deliberately generous: it uses
      // a horizontal angular extent. If that approximation says "on target"
      // while the real 3D center ray misses the Box3, keep rotating by the
      // already-computed screen-side correction instead of releasing assist.
      const correction = Number(base?.screenCorrectionRad);
      if (base?.reticleOverTarget && Number.isFinite(correction) && Math.abs(correction) > EPSILON) {
        return {
          ...base,
          aligned: false,
          desiredFacing: facing + correction,
          nextFacing: facing,
          deltaRad: correction,
          reticleOverTarget: false,
          exactReticleHitboxIntersection: false,
          alignmentSource: 'screen-reticle-box3',
        };
      }

      // A purely vertical miss cannot be corrected by the existing transient
      // yaw assist. Do not falsely rank it as a zero-error target; ordinary
      // manual reticle aim remains authoritative instead.
      if (base?.reticleOverTarget) {
        return {
          ...base,
          eligible: false,
          aligned: false,
          reticleOverTarget: false,
          exactReticleHitboxIntersection: false,
          alignmentSource: 'screen-reticle-box3',
        };
      }
      return { ...base, exactReticleHitboxIntersection: false };
    }

    exactReticleAttackAlignmentStep.__hobunjiExactReticleBoxAlignment = true;
    exactReticleAttackAlignmentStep.__hobunjiPreviousStep = previousStep;
    combat.attackAlignmentStep = exactReticleAttackAlignmentStep;
    exactReticleAlignmentInstalled = true;
    return true;
  }

  function installRangedInitBridge() {
    const ranged = window.RangedWeapons;
    const previousInit = ranged?.init;
    if (!ranged || typeof previousInit !== 'function') return false;
    if (previousInit.__hobunjiCombatCameraAlignmentBridge) {
      rangedInitWrapped = true;
      return true;
    }

    function cameraAlignedRangedInit(injectedDeps = {}) {
      const rawInteractionRay = injectedDeps?.getPlayerInteractionRay;
      const rawAimRay = injectedDeps?.getPlayerAimRay;
      const bridgedDeps = {
        ...injectedDeps,
        // ranged-camera-focus historically calls this compatibility slot
        // "muzzle parallel". For camera-authoritative aiming it must now carry
        // the TRUE centered camera ray, including its camera origin. Focus uses
        // that for compatibility/surface fallbacks, while the explicit shared
        // perspective dependency remains the primary finite aim endpoint.
        getMuzzleParallelInteractionRay: () => centeredCameraRay(rawInteractionRay, rawAimRay),
      };
      cameraRayDepsProvided = true;
      perspectiveTargetDepsProvided = typeof injectedDeps?.getPlayerPerspectiveTarget === 'function';
      return previousInit.call(this, bridgedDeps);
    }

    cameraAlignedRangedInit.__hobunjiCombatCameraAlignmentBridge = true;
    cameraAlignedRangedInit.__hobunjiPreviousInit = previousInit;
    ranged.init = cameraAlignedRangedInit;
    rangedInitWrapped = true;
    return true;
  }

  function installCameraAuthoredLunge(liveDeps, rawInteractionRay, rawAimRay) {
    const rawLunge = liveDeps?.beginCombatLunge;
    if (typeof rawLunge !== 'function') return false;
    if (rawLunge.__hobunjiCameraAuthoredLunge) {
      lungeAuthorityInstalled = true;
      return true;
    }

    function cameraAuthoredLunge(distancePx, durationS, hopUnits = 0, hitTest = null) {
      const player = liveDeps?.player;
      const wasLunging = !!player?.lunging;
      const result = rawLunge.apply(this, arguments);
      if (!player || wasLunging || !player.lunging) return result;

      try {
        const point = perspectivePoint(liveDeps); // Preferred endpoint shared with the head, body, melee, and ranged muzzle.
        const tile = Number(liveDeps?.TILE) || 64; // Converts the player's logical pixel coordinates into the point's world units.
        const baseY = Number(liveDeps?.getActorWorldY?.(player)); // Uses the same live player elevation supplied to ranged projectile origins.
        const origin = {
          x: (Number(player.x) || 0) / tile,
          y: (Number.isFinite(baseY) ? baseY : 0) + 0.55,
          z: (Number(player.y) || 0) / tile,
        }; // Real lunge/body origin from which the shared point is viewed.
        const ray = point ? null : centeredCameraRay(rawInteractionRay, rawAimRay); // Compatibility fallback for older callers without the point dependency.
        const dx = point ? point.x - origin.x : Number(ray?.direction?.x);
        const dy = point ? point.y - origin.y : Number(ray?.direction?.y);
        const dz = point ? point.z - origin.z : Number(ray?.direction?.z);
        if (![dx, dy, dz].every(Number.isFinite)) return result;
        const vectorLength = Math.hypot(dx, dy, dz); // Normalizes the complete 3D origin-to-point ray before splitting travel/pitch.
        if (!(vectorLength > EPSILON)) return result;
        const nx = dx / vectorLength; // Normalized X used for ground travel and debug.
        const ny = dy / vectorLength; // Normalized Y used by vertical lunge profile logic.
        const nz = dz / vectorLength; // Normalized Z used for ground travel and debug.
        const horizontal = Math.hypot(nx, nz);
        if (!(horizontal > EPSILON)) return result;

        // Lunges are movement, so their ground-plane travel uses the point's
        // player-relative bearing. Pitch comes from that same origin-to-point
        // vector so upward/downward attacks keep their verticality.
        const dirX = nx / horizontal;
        const dirY = nz / horizontal;
        const pitch = Math.asin(Math.max(-1, Math.min(1, ny)));
        const profile = window.Combat?.meleeLungeProfile?.(
          distancePx,
          pitch,
          hopUnits,
          player.lungeHeightUnits,
          hitTest?.pitchDistanceResistance || 0,
        ) || { distancePx, hopUnits, pitch };

        player.lungeDirX = dirX;
        player.lungeDirY = dirY;
        player.lungeDistancePx = Math.max(0, Number(profile.distancePx) || 0);
        player.lungeHopUnits = Math.max(0, Number(profile.hopUnits) || 0);
        player.lungeAimPitch = Number.isFinite(Number(profile.pitch)) ? Number(profile.pitch) : pitch;
        if (player.lungeHitTest && Number.isFinite(Number(hitTest?.rangePx))) {
          player.lungeHitTest = {
            ...player.lungeHitTest,
            rangePx: Math.max(0, Number(hitTest.rangePx) || 0) * LUNGE_CANCEL_RANGE_MULTIPLIER,
          };
        }
        lungeSweepAnchor = { x: Number(player.x) || 0, y: Number(player.y) || 0 };
        lungeAuthorityCount++;
        lastLunge = {
          direction: { x: nx, y: ny, z: nz },
          targetPoint: point ? { ...point } : null,
          targetSource: point ? 'shared-perspective-point' : 'camera-ray-fallback',
          pointErrorDeg: 0,
          pitchRad: player.lungeAimPitch,
          distancePx: player.lungeDistancePx,
          attackRangePx: Number(hitTest?.rangePx) || null,
          cancelRangePx: Number(player.lungeHitTest?.rangePx) || null,
        };
      } catch (error) {
        recordError('lunge-ray', error);
      }
      return result;
    }

    cameraAuthoredLunge.__hobunjiCameraAuthoredLunge = true;
    cameraAuthoredLunge.__hobunjiPreviousLunge = rawLunge;
    liveDeps.beginCombatLunge = cameraAuthoredLunge;
    lungeAuthorityInstalled = true;
    return true;
  }

  function boxSamplePoints(box, origin) {
    const center = {
      x: (box.min.x + box.max.x) * 0.5,
      y: (box.min.y + box.max.y) * 0.5,
      z: (box.min.z + box.max.z) * 0.5,
    };
    const closest = {
      x: Math.max(box.min.x, Math.min(box.max.x, origin.x)),
      y: Math.max(box.min.y, Math.min(box.max.y, origin.y)),
      z: Math.max(box.min.z, Math.min(box.max.z, origin.z)),
    };
    const points = [closest];
    for (const x of [box.min.x, center.x, box.max.x]) {
      for (const y of [box.min.y, center.y, box.max.y]) {
        for (const z of [box.min.z, center.z, box.max.z]) points.push({ x, y, z });
      }
    }
    return points;
  }

  function colliderIntersectsBox(collider, box) {
    if (!collider || !finiteBox(box)) return false;
    const direct = rayBoxInterval({ origin: collider.origin, direction: collider.direction }, box);
    if (direct && direct.enter <= collider.rangeWorld) return true;

    for (const point of boxSamplePoints(box, collider.origin)) {
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
      if (radialFraction <= 1 && yawDelta <= collider.halfConeRad && verticalOffset <= collider.halfHeightWorld) return true;
    }
    return false;
  }

  function lungeColliderAt(liveDeps, player, hitTest, sampleX, sampleY) {
    const combat = window.Combat;
    if (typeof combat?.meleeColliderVolume !== 'function') return null;
    const yaw = Math.atan2(Number(player.lungeDirY) || 0, Number(player.lungeDirX) || 0);
    const pitch = Number(player.lungeAimPitch) || 0;
    const base = combat.meleeColliderVolume(player, {
      rangePx: hitTest?.rangePx,
      halfConeRad: hitTest?.halfConeRad,
      yaw,
      pitch,
    });
    if (!base?.origin || !base?.direction) return null;
    const tile = Number(liveDeps?.TILE) || 64;
    return {
      ...base,
      // Player X/Z are deliberately rebuilt from logical lunge coordinates.
      // RangedWeapons caches portrait Box3s for a rendered frame, so reusing
      // the cached player's horizontal center here would reintroduce the exact
      // pre-move/post-move disagreement this sweep exists to remove.
      origin: {
        x: (Number(sampleX) || 0) / tile,
        y: Number(base.origin.y) || 0,
        z: (Number(sampleY) || 0) / tile,
      },
      direction: {
        x: Number(base.direction.x) || 0,
        y: Number(base.direction.y) || 0,
        z: Number(base.direction.z) || 0,
      },
    };
  }

  function hostileInsideLungeAt(liveDeps, player, hitTest, sampleX, sampleY) {
    const collider = lungeColliderAt(liveDeps, player, hitTest, sampleX, sampleY);
    if (!collider) return false;
    const currentArea = liveDeps?.getCurrentArea?.();
    for (const target of liveDeps?.hostileObjects || []) {
      if (!target || target.health <= 0 || target.areaId !== currentArea || target._denHidden) continue;
      const box = window.RangedWeapons?.actorHitbox?.(target)?.box;
      if (finiteBox(box)) {
        if (colliderIntersectsBox(collider, box)) return true;
        continue;
      }
      // Same compatibility fallback as combat-core.meleeHit when an actor's
      // portrait has not mounted yet.
      const dx = (Number(target.x) || 0) - (Number(sampleX) || 0);
      const dz = (Number(target.y) || 0) - (Number(sampleY) || 0);
      const distancePx = Math.hypot(dx, dz);
      const pointYaw = Math.atan2(dz, dx);
      const yawDelta = Math.abs(Math.atan2(Math.sin(pointYaw - collider.yaw), Math.cos(pointYaw - collider.yaw)));
      if (distancePx <= Math.max(0, Number(hitTest?.rangePx) || 0) && yawDelta <= collider.halfConeRad) return true;
    }
    return false;
  }

  function stopLungeAtCurrentPosition(liveDeps, player) {
    if ((Number(player.lungeHopUnits) || 0) > 0.01) {
      // Match game.js's existing elevated-target behavior: horizontal travel
      // freezes here, while the authored vertical arc is allowed to finish.
      player.lungeHitTest = null;
      player.lungeStartX = player.x;
      player.lungeStartY = player.y;
      player.lungeDistancePx = 0;
      return;
    }
    player.lunging = false;
    player.lungeHopCurrent = 0;
    const area = liveDeps?.getCurrentArea?.();
    window.AudioSystem?.playHeavyLandingSfx?.(
      area,
      window.AudioSystem?.footstepTileAt?.(area, player.x, player.y, window.GridTileAccessors?.getActiveGrid?.()),
    );
  }

  function resolveSweptLungeEntry(liveDeps) {
    const player = liveDeps?.player;
    if (!player?.lunging) {
      lungeSweepAnchor = null;
      return false;
    }
    const current = { x: Number(player.x) || 0, y: Number(player.y) || 0 };
    const hitTest = player.lungeHitTest;
    if (!hitTest) {
      lungeSweepAnchor = current;
      return false;
    }
    const start = lungeSweepAnchor || current;
    const segmentX = current.x - start.x;
    const segmentY = current.y - start.y;
    const segmentLength = Math.hypot(segmentX, segmentY);
    if (!(segmentLength > EPSILON)) {
      lungeSweepAnchor = current;
      return false;
    }

    // Reuse the movement sweep's quarter-tile spatial resolution, then bisect
    // the first entering interval. This runs only while a combat lunge is
    // active and uses Combat's already-existing once-per-frame tick.
    const maxStepPx = Math.max(1, (Number(liveDeps?.TILE) || 64) * 0.25);
    const steps = Math.max(1, Math.ceil(segmentLength / maxStepPx));
    let previousAlpha = 0;
    for (let step = 0; step <= steps; step++) {
      const alpha = step / steps;
      const sampleX = start.x + segmentX * alpha;
      const sampleY = start.y + segmentY * alpha;
      if (!hostileInsideLungeAt(liveDeps, player, hitTest, sampleX, sampleY)) {
        previousAlpha = alpha;
        continue;
      }

      let low = step === 0 ? 0 : previousAlpha;
      let high = alpha;
      for (let i = 0; i < 8 && high - low > 1e-4; i++) {
        const mid = (low + high) * 0.5;
        const midX = start.x + segmentX * mid;
        const midY = start.y + segmentY * mid;
        if (hostileInsideLungeAt(liveDeps, player, hitTest, midX, midY)) high = mid;
        else low = mid;
      }
      player.x = start.x + segmentX * high;
      player.y = start.y + segmentY * high;
      stopLungeAtCurrentPosition(liveDeps, player);
      lungeSweepAnchor = { x: player.x, y: player.y };
      lungeEarlyStopCount++;
      lastLungeSweep = {
        at: Date.now(),
        from: { ...start },
        attempted: { ...current },
        stopped: { x: player.x, y: player.y },
        segmentLengthPx: segmentLength,
        cancelRangePx: Number(hitTest?.rangePx) || 0,
        halfConeRad: Number(hitTest?.halfConeRad) || 0,
      };
      return true;
    }

    lungeSweepAnchor = current;
    return false;
  }

  function installCombatUpdateSweep(liveDeps) {
    const combat = window.Combat;
    const previousUpdate = combat?.update;
    if (!combat || typeof previousUpdate !== 'function') return false;
    if (previousUpdate.__hobunjiSweptLungeEntry) {
      combatUpdateSweepInstalled = true;
      return true;
    }

    function cameraAlignedCombatUpdate() {
      try {
        // Main-loop ordering is updateMovement -> world/hostiles -> Combat.update.
        // Clamp a lunge that crossed into its real attack volume before staged
        // strike callbacks run, so the impact resolves from the stop point.
        resolveSweptLungeEntry(liveDeps);
      } catch (error) {
        recordError('lunge-sweep', error);
      }
      return previousUpdate.apply(this, arguments);
    }

    cameraAlignedCombatUpdate.__hobunjiSweptLungeEntry = true;
    cameraAlignedCombatUpdate.__hobunjiPreviousUpdate = previousUpdate;
    combat.update = cameraAlignedCombatUpdate;
    combatUpdateSweepInstalled = true;
    return true;
  }

  // ranged-camera-focus decorates melee direction/pitch after the underlying
  // Combat.init returns. The game already supplies the perspective-point
  // callbacks used by head/body/reticle facing, so restore those callbacks.
  // Separately wrap beginCombatLunge so its horizontal and vertical components
  // converge on the same point instead of a focused actor or parallel ray.
  function installCombatInitBridge() {
    const combat = window.Combat;
    const previousInit = combat?.init;
    if (!combat || typeof previousInit !== 'function') return false;
    if (previousInit.__hobunjiCombatCameraAlignmentBridge) {
      combatInitWrapped = true;
      return true;
    }

    function cameraAlignedCombatInit(injectedDeps, ...rest) {
      const nativeDirection = injectedDeps?.getPlayerMeleeAimDirection;
      const nativePitch = injectedDeps?.getPlayerMeleeAimPitch;
      const rawInteractionRay = injectedDeps?.getPlayerInteractionRay;
      const rawAimRay = injectedDeps?.getPlayerAimRay;
      const result = previousInit.call(this, injectedDeps, ...rest);
      const liveDeps = window.Combat?.deps || injectedDeps;
      if (liveDeps && typeof nativeDirection === 'function') {
        liveDeps.getPlayerMeleeAimDirection = nativeDirection;
        nativeMeleeDirectionRestored = true;
      }
      if (liveDeps && typeof nativePitch === 'function') {
        liveDeps.getPlayerMeleeAimPitch = nativePitch;
        nativeMeleePitchRestored = true;
      }
      installCameraAuthoredLunge(liveDeps, rawInteractionRay, rawAimRay);
      installExactReticleAlignment(liveDeps, rawInteractionRay, rawAimRay);
      installCombatUpdateSweep(liveDeps);
      return result;
    }

    cameraAlignedCombatInit.__hobunjiCombatCameraAlignmentBridge = true;
    cameraAlignedCombatInit.__hobunjiPreviousInit = previousInit;
    combat.init = cameraAlignedCombatInit;
    combatInitWrapped = true;
    return true;
  }

  function install() {
    const rangedOk = installRangedInitBridge();
    const combatOk = installCombatInitBridge();
    if (rangedOk && combatOk) {
      window.__farmLog?.('[combat-camera-alignment] shared perspective-point authority installed for ranged aim, exact melee reticle alignment, and attack lunges.', 'combat');
    }
    return rangedOk && combatOk;
  }

  window.HobunjiCombatCameraAlignment = {
    version: VERSION,
    install,
    debugSnapshot: () => ({
      version: VERSION,
      rangedInitWrapped,
      combatInitWrapped,
      cameraRayDepsProvided,
      perspectiveTargetDepsProvided,
      nativeMeleeDirectionRestored,
      nativeMeleePitchRestored,
      lungeAuthorityInstalled,
      exactReticleAlignmentInstalled,
      combatUpdateSweepInstalled,
      lungeAuthorityCount,
      reticleBoxHitCount,
      lungeEarlyStopCount,
      lastCameraRay: lastCameraRay ? {
        origin: { ...lastCameraRay.origin },
        direction: { ...lastCameraRay.direction },
      } : null,
      lastLunge: lastLunge ? {
        ...lastLunge,
        direction: { ...lastLunge.direction },
        targetPoint: lastLunge.targetPoint ? { ...lastLunge.targetPoint } : null,
      } : null,
      lastLungeSweep: lastLungeSweep ? {
        ...lastLungeSweep,
        from: { ...lastLungeSweep.from },
        attempted: { ...lastLungeSweep.attempted },
        stopped: { ...lastLungeSweep.stopped },
      } : null,
      lastError: lastError ? { ...lastError } : null,
      movementAuthority: 'native-player-to-perspective-point-walk-and-lunge',
      rangedAuthority: 'muzzle-to-shared-perspective-point',
      updateMode: 'initialization-only-no-frame-hook',
      lungeSweepMode: 'piggyback-existing-combat-update-no-independent-loop',
    }),
  };
  window.__combatCameraAlignmentDebug = window.HobunjiCombatCameraAlignment;

  install();
})();