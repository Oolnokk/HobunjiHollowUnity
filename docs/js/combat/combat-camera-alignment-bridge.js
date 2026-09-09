// Initialization-only bridge that makes the actual camera/reticle ray the
// authority for the one finite perspective point beneath the reticle. Walking
// stays in game.js's native point-relative path; this module keeps attack lunges
// converged on that same endpoint and preserves the unmodified camera ray.
(() => {
  'use strict';

  const VERSION = 4;
  let rangedInitWrapped = false; // Exposed in debugSnapshot() to verify the ranged initialization boundary was patched once.
  let combatInitWrapped = false; // Exposed in debugSnapshot() to verify the combat initialization boundary was patched once.
  let cameraRayDepsProvided = false; // Exposed to verify ranged-camera-focus receives the true camera-origin ray through its compatibility dependency.
  let perspectiveTargetDepsProvided = false; // Exposed to verify combat/ranged wrappers receive the shared finite reticle point.
  let nativeMeleeDirectionRestored = false; // Records whether Combat's original camera-derived melee direction callback won after initialization.
  let nativeMeleePitchRestored = false; // Records whether Combat's original camera-derived melee pitch callback won after initialization.
  let lungeAuthorityInstalled = false; // Records whether beginCombatLunge was wrapped so player displacement converges on the perspective point.
  let lungeAuthorityCount = 0; // Mobile-readable count of lunges corrected toward the shared perspective point.
  let lastCameraRay = null; // Mobile-readable snapshot of the true centered camera ray handed to ranged-camera-focus.
  let lastLunge = null; // Mobile-readable snapshot of the latest camera-authored lunge direction/profile.
  let lastError = null; // Mobile-readable initialization/runtime error without putting failures into a frame loop.

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
    if (!(length > 1e-8)) return null;
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
        if (!(vectorLength > 1e-8)) return result;
        const nx = dx / vectorLength; // Normalized X used for ground travel and debug.
        const ny = dy / vectorLength; // Normalized Y used by vertical lunge profile logic.
        const nz = dz / vectorLength; // Normalized Z used for ground travel and debug.
        const horizontal = Math.hypot(nx, nz);
        if (!(horizontal > 1e-8)) return result;

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
        ) || { distancePx, hopUnits, pitch };

        player.lungeDirX = dirX;
        player.lungeDirY = dirY;
        player.lungeDistancePx = Math.max(0, Number(profile.distancePx) || 0);
        player.lungeHopUnits = Math.max(0, Number(profile.hopUnits) || 0);
        player.lungeAimPitch = Number.isFinite(Number(profile.pitch)) ? Number(profile.pitch) : pitch;
        lungeAuthorityCount++;
        lastLunge = {
          direction: { x: nx, y: ny, z: nz },
          targetPoint: point ? { ...point } : null,
          targetSource: point ? 'shared-perspective-point' : 'camera-ray-fallback',
          pointErrorDeg: 0,
          pitchRad: player.lungeAimPitch,
          distancePx: player.lungeDistancePx,
          attackRangePx: Number(hitTest?.rangePx) || null,
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
      window.__farmLog?.('[combat-camera-alignment] shared perspective-point authority installed for ranged aim and attack lunges.', 'combat');
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
      lungeAuthorityCount,
      lastCameraRay: lastCameraRay ? {
        origin: { ...lastCameraRay.origin },
        direction: { ...lastCameraRay.direction },
      } : null,
      lastLunge: lastLunge ? {
        ...lastLunge,
        direction: { ...lastLunge.direction },
        targetPoint: lastLunge.targetPoint ? { ...lastLunge.targetPoint } : null,
      } : null,
      lastError: lastError ? { ...lastError } : null,
      movementAuthority: 'native-player-to-perspective-point-walk-and-lunge',
      rangedAuthority: 'muzzle-to-shared-perspective-point',
      updateMode: 'initialization-only-no-frame-hook',
    }),
  };
  window.__combatCameraAlignmentDebug = window.HobunjiCombatCameraAlignment;

  install();
})();
