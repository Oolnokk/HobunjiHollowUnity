// Initialization-only bridge that keeps the native Shoulder Cam ray authoritative
// for player facing while allowing ranged-camera-focus to retain its cached 3D
// surface diagnostics. No update/timer hook lives here.
(() => {
  'use strict';

  const VERSION = 2;
  let rangedInitWrapped = false; // Exposed in debugSnapshot() to verify the ranged initialization boundary was patched once.
  let combatInitWrapped = false; // Exposed in debugSnapshot() to verify native melee camera callbacks are restored once after Combat.init.
  let muzzleRayDepsProvided = false; // Exposed in debugSnapshot() to verify the explicit muzzle-parallel dependency was handed to the latest ranged init.
  let nativeMeleeDirectionRestored = false; // Records whether Combat's original camera-derived melee direction callback won after initialization.
  let nativeMeleePitchRestored = false; // Records whether Combat's original camera-derived melee pitch callback won after initialization.
  let lastMuzzleRay = null; // Mobile-readable snapshot of the camera-parallel ray supplied privately to ranged-camera-focus.
  let lastError = null; // Mobile-readable initialization error without putting failures into a frame loop.

  function recordError(stage, error) {
    lastError = {
      at: Date.now(),
      stage,
      detail: String(error?.stack || error?.message || error || 'unknown error'),
    };
    window.__farmLog?.(`[combat-camera-alignment] ${stage}: ${lastError.detail}`, 'warn', 'combat');
  }

  function normalizedDirection(raw) {
    const x = Number(raw?.x), y = Number(raw?.y), z = Number(raw?.z);
    if (![x, y, z].every(Number.isFinite)) return null;
    const length = Math.hypot(x, y, z);
    if (!(length > 1e-8)) return null;
    return { x: x / length, y: y / length, z: z / length };
  }

  function playerMuzzleOrigin(deps) {
    const player = deps?.player;
    const tile = Number(deps?.TILE) || 64;
    if (!player) return null;
    let baseY = Number.NaN;
    try { baseY = Number(deps?.getActorWorldY?.(player)); } catch (_) {}
    if (!Number.isFinite(baseY)) {
      try { baseY = Number(deps?.worldSurfaceY?.(Number(player.x) || 0, Number(player.y) || 0)); } catch (_) {}
    }
    if (!Number.isFinite(baseY)) baseY = 0;
    return {
      x: (Number(player.x) || 0) / tile,
      y: baseY + 0.55,
      z: (Number(player.y) || 0) / tile,
    };
  }

  // ranged-camera-focus privately resolves first surfaces from this ray. Giving
  // that private resolver the REAL camera direction but a muzzle origin removes
  // Shoulder Cam parallax from its convergence math: a close floor/wall can no
  // longer create a 90-degree muzzle-to-surface vector. This is handed to
  // ranged-camera-focus through its own explicitly-named dependency
  // (getMuzzleParallelInteractionRay); getPlayerInteractionRay itself is passed
  // through untouched so ordinary world-focus semantics remain untouched.
  function muzzleParallelCameraRay(deps, rawInteractionRay, rawAimRay) {
    let raw = null;
    try { raw = rawInteractionRay?.() || rawAimRay?.() || null; }
    catch (error) { recordError('camera-ray', error); }
    const direction = normalizedDirection(raw?.direction);
    const origin = playerMuzzleOrigin(deps);
    if (!direction || !origin) return raw || null;
    lastMuzzleRay = { origin: { ...origin }, direction: { ...direction } };
    return { origin, direction };
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
        getMuzzleParallelInteractionRay: () => muzzleParallelCameraRay(injectedDeps, rawInteractionRay, rawAimRay),
      };
      muzzleRayDepsProvided = true;
      return previousInit.call(this, bridgedDeps);
    }

    cameraAlignedRangedInit.__hobunjiCombatCameraAlignmentBridge = true;
    cameraAlignedRangedInit.__hobunjiPreviousInit = previousInit;
    ranged.init = cameraAlignedRangedInit;
    rangedInitWrapped = true;
    return true;
  }

  // ranged-camera-focus decorates melee direction/pitch after the underlying
  // Combat.init returns. The game already supplies the correct centered-camera
  // callbacks, and those callbacks also drive head/reticle facing, so restore
  // them after the focus bridge has installed its hit/range hooks. Actual
  // player meleeHit direction decoration remains installed separately.
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
      window.__farmLog?.('[combat-camera-alignment] native camera-facing authority bridge installed.', 'combat');
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
      muzzleRayDepsProvided,
      nativeMeleeDirectionRestored,
      nativeMeleePitchRestored,
      lastMuzzleRay: lastMuzzleRay ? {
        origin: { ...lastMuzzleRay.origin },
        direction: { ...lastMuzzleRay.direction },
      } : null,
      lastError: lastError ? { ...lastError } : null,
      updateMode: 'initialization-only-no-frame-hook',
    }),
  };
  window.__combatCameraAlignmentDebug = window.HobunjiCombatCameraAlignment;

  install();
})();