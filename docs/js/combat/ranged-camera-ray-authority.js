// Ranged fire authority installed BEFORE ranged-camera-focus wraps RangedWeapons.init.
// The focus module may choose nearer surfaces for UI/focus purposes, but the actual
// projectile launch direction always converges from the muzzle to the point where
// the centered camera ray crosses the equipped weapon's maximum horizontal range.
(() => {
  'use strict';

  const VERSION = 1;
  const EPSILON = 1e-8;
  let installed = false; // Exposed in snapshot() so device diagnostics can verify the pre-focus init boundary was wrapped.
  let initialized = false; // Exposed in snapshot() after the real RangedWeapons.init receives the camera-authoritative aim callback.
  let lastSolution = null; // Mobile-readable record of the latest camera-ray/max-range solution used by actual ranged fire.
  let lastError = null; // Mobile-readable error record without adding a polling/update loop.

  function recordError(stage, error) {
    lastError = {
      at: Date.now(),
      stage,
      detail: String(error?.stack || error?.message || error || 'unknown error'),
    };
    window.__farmLog?.(`[ranged-camera-ray-authority] ${stage}: ${lastError.detail}`, 'warn', 'combat');
  }

  function finiteVector(raw) {
    const x = Number(raw?.x), y = Number(raw?.y), z = Number(raw?.z);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  }

  function normalizedVector(raw) {
    const vector = finiteVector(raw);
    if (!vector) return null;
    const length = Math.hypot(vector.x, vector.y, vector.z);
    if (!(length > EPSILON)) return null;
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  }

  function normalizedRay(raw) {
    const origin = finiteVector(raw?.origin);
    const direction = normalizedVector(raw?.direction);
    return origin && direction ? { origin, direction } : null;
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

  // Finds the FAR forward intersection between the camera ray and a horizontal
  // circle centered on the muzzle whose radius is the weapon's authored
  // rangeTiles. RangedWeapons.shotSegment also defines projectile reach in
  // horizontal tiles, so this point is exactly reachable at maximum range even
  // with a large shoulder offset or camera pitch.
  function maxRangePointOnCameraRay(cameraRay, muzzle, rangeTiles) {
    const range = Math.max(0, Number(rangeTiles) || 0);
    if (!(range > EPSILON)) return null;
    const dx = cameraRay.direction.x;
    const dz = cameraRay.direction.z;
    const qx = cameraRay.origin.x - muzzle.x;
    const qz = cameraRay.origin.z - muzzle.z;
    const a = dx * dx + dz * dz;
    if (!(a > EPSILON)) return null;
    const b = 2 * (qx * dx + qz * dz);
    const c = qx * qx + qz * qz - range * range;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(Math.max(0, discriminant));
    const tNear = (-b - root) / (2 * a);
    const tFar = (-b + root) / (2 * a);
    const t = tFar > EPSILON ? tFar : tNear > EPSILON ? tNear : null;
    if (t == null) return null;
    return {
      x: cameraRay.origin.x + cameraRay.direction.x * t,
      y: cameraRay.origin.y + cameraRay.direction.y * t,
      z: cameraRay.origin.z + cameraRay.direction.z * t,
      rayDistance: t,
    };
  }

  function solveAttackRay(deps, rawInteractionRay, rawAimRay) {
    let raw = null;
    try { raw = rawInteractionRay?.() || rawAimRay?.() || null; }
    catch (error) { recordError('camera-ray', error); }
    const cameraRay = normalizedRay(raw);
    const muzzle = playerMuzzleOrigin(deps);
    const itemKey = deps?.getEquippedRangedKey?.() || window.RangedWeapons?.equippedRangedKey?.() || null;
    const rangeTiles = Number(window.RangedWeapons?.config?.[itemKey]?.rangeTiles);
    if (!cameraRay || !muzzle || !itemKey || !(rangeTiles > 0)) return raw || null;

    let point = maxRangePointOnCameraRay(cameraRay, muzzle, rangeTiles);
    if (!point) {
      // Extreme near-vertical/away-facing fallback: still use a point on the
      // camera ray rather than changing the camera or reverting to body facing.
      const fallbackDistance = Math.max(rangeTiles, 0.5);
      point = {
        x: cameraRay.origin.x + cameraRay.direction.x * fallbackDistance,
        y: cameraRay.origin.y + cameraRay.direction.y * fallbackDistance,
        z: cameraRay.origin.z + cameraRay.direction.z * fallbackDistance,
        rayDistance: fallbackDistance,
      };
    }

    const direction = normalizedVector({
      x: point.x - muzzle.x,
      y: point.y - muzzle.y,
      z: point.z - muzzle.z,
    }) || cameraRay.direction;
    const attackRay = { origin: muzzle, direction };
    lastSolution = {
      itemKey,
      rangeTiles,
      cameraRay: {
        origin: { ...cameraRay.origin },
        direction: { ...cameraRay.direction },
      },
      muzzle: { ...muzzle },
      targetPoint: { x: point.x, y: point.y, z: point.z },
      cameraRayDistance: point.rayDistance,
      attackDirection: { ...direction },
      horizontalTargetDistance: Math.hypot(point.x - muzzle.x, point.z - muzzle.z),
    };
    return attackRay;
  }

  function install() {
    const ranged = window.RangedWeapons;
    const previousInit = ranged?.init;
    if (!ranged || typeof previousInit !== 'function') return false;
    if (previousInit.__hobunjiCameraRayAuthority) {
      installed = true;
      return true;
    }

    function cameraRayAuthorityInit(injectedDeps = {}) {
      const rawInteractionRay = injectedDeps?.getPlayerInteractionRay;
      const rawAimRay = injectedDeps?.getPlayerAimRay;
      const authoritativeDeps = {
        ...injectedDeps,
        getPlayerAimRay: () => solveAttackRay(injectedDeps, rawInteractionRay, rawAimRay),
      };
      initialized = true;
      return previousInit.call(this, authoritativeDeps);
    }

    cameraRayAuthorityInit.__hobunjiCameraRayAuthority = true;
    cameraRayAuthorityInit.__hobunjiPreviousInit = previousInit;
    ranged.init = cameraRayAuthorityInit;
    installed = true;
    window.__farmLog?.('[ranged-camera-ray-authority] actual ranged fire now converges on the weapon max-range point along the camera ray.', 'combat');
    return true;
  }

  window.HobunjiRangedCameraRayAuthority = {
    version: VERSION,
    install,
    maxRangePointOnCameraRay,
    snapshot: () => ({
      version: VERSION,
      installed,
      initialized,
      lastSolution: lastSolution ? {
        ...lastSolution,
        cameraRay: {
          origin: { ...lastSolution.cameraRay.origin },
          direction: { ...lastSolution.cameraRay.direction },
        },
        muzzle: { ...lastSolution.muzzle },
        targetPoint: { ...lastSolution.targetPoint },
        attackDirection: { ...lastSolution.attackDirection },
      } : null,
      lastError: lastError ? { ...lastError } : null,
      authority: 'muzzle-to-max-range-point-on-camera-ray',
      updateMode: 'initialization-only-no-frame-hook',
    }),
  };
  window.__rangedCameraRayAuthorityDebug = window.HobunjiRangedCameraRayAuthority;

  install();
})();