// Initialization-only bridge that makes the actual camera/reticle ray the
// authority for player combat movement and ranged convergence. Walking stays in
// game.js's native camera-relative path; this module keeps attack lunges on that
// same camera direction and hands ranged-camera-focus the unmodified camera ray.
(() => {
  'use strict';

  const VERSION = 3;
  let rangedInitWrapped = false; // Exposed in debugSnapshot() to verify the ranged initialization boundary was patched once.
  let combatInitWrapped = false; // Exposed in debugSnapshot() to verify the combat initialization boundary was patched once.
  let cameraRayDepsProvided = false; // Exposed to verify ranged-camera-focus receives the true camera-origin ray through its compatibility dependency.
  let nativeMeleeDirectionRestored = false; // Records whether Combat's original camera-derived melee direction callback won after initialization.
  let nativeMeleePitchRestored = false; // Records whether Combat's original camera-derived melee pitch callback won after initialization.
  let lungeAuthorityInstalled = false; // Records whether beginCombatLunge was wrapped so player displacement follows the camera ray.
  let lungeAuthorityCount = 0; // Mobile-readable count of lunges whose direction was corrected to the camera ray.
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
        // the TRUE centered camera ray, including its camera origin. Focus then
        // chooses the weapon's maximum-range point along that ray and resolves
        // the muzzle/attack-origin direction toward it. Re-rooting here would
        // erase shoulder-camera parallax and put movement back in charge.
        getMuzzleParallelInteractionRay: () => centeredCameraRay(rawInteractionRay, rawAimRay),
      };
      cameraRayDepsProvided = true;
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
        const ray = centeredCameraRay(rawInteractionRay, rawAimRay);
        const dx = Number(ray?.direction?.x);
        const dy = Number(ray?.direction?.y);
        const dz = Number(ray?.direction?.z);
        if (![dx, dy, dz].every(Number.isFinite)) return result;
        const horizontal = Math.hypot(dx, dz);
        if (!(horizontal > 1e-8)) return result;

        // Lunges are movement, so their ground-plane travel uses the exact same
        // camera-forward bearing as ordinary shoulder movement. Pitch still
        // comes from the centered ray so upward/downward attacks keep their
        // authored leap-distance and hop behavior.
        const dirX = dx / horizontal;
        const dirY = dz / horizontal;
        const pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
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
          direction: { x: dirX, y: dy, z: dirY },
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
  // Combat.init returns. The game already supplies the centered-camera
  // callbacks used by head/body/reticle facing, so restore those callbacks.
  // Separately wrap beginCombatLunge: a lunge is displacement, therefore its
  // horizontal direction must be the camera ray rather than a focused target.
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
      window.__farmLog?.('[combat-camera-alignment] camera/reticle ray authority installed for ranged aim and attack lunges.', 'combat');
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
      } : null,
      lastError: lastError ? { ...lastError } : null,
      movementAuthority: 'native-camera-relative-walk-plus-camera-ray-lunge',
      rangedAuthority: 'camera-ray-to-weapon-range',
      updateMode: 'initialization-only-no-frame-hook',
    }),
  };
  window.__combatCameraAlignmentDebug = window.HobunjiCombatCameraAlignment;

  install();
})();