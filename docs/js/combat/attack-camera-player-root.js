// Player-rooted combat camera placement for attack-authoritative Shoulder Cam.
(() => {
  'use strict';

  const VERSION = 1;
  const SHOULDER_MODE = 'shoulderSurf';
  const MIN_DISTANCE = 0.35; // Used to prevent a malformed camera config from collapsing the combat camera into the player.
  const MAX_DISTANCE = 8; // Used as a hard safety ceiling so a bad runtime value can never fling the combat camera across the map.
  const MAIN_CAMERA_POSITION_EPSILON = 0.0001; // Used to distinguish the live gameplay camera from other PerspectiveCamera instances.

  let installed = false; // Used to ensure the PerspectiveCamera hook is installed only once.
  let lastFrame = null; // Used by the mobile-friendly debug surface to inspect the current rooted camera transform.
  let lastCombatActive = false; // Used to emit transition-only debug logging rather than one message every frame.

  function three() {
    return window.THREE || null;
  }

  function combatFocus() {
    return window.HobunjiRangedCameraFocus || null;
  }

  function shoulderConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null;
  }

  function sliderNumber(id, fallback = 0) {
    const value = Number(document.getElementById(id)?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mainShoulderCamera(camera) {
    if (!camera?.isPerspectiveCamera) return false;
    const state = window.__hobunjiFurnitureDebug?.camState;
    if (state?.mode !== SHOULDER_MODE || !state?.position) return false;
    return Math.abs((Number(camera.position?.x) || 0) - Number(state.position.x)) <= MAIN_CAMERA_POSITION_EPSILON
      && Math.abs((Number(camera.position?.y) || 0) - Number(state.position.y)) <= MAIN_CAMERA_POSITION_EPSILON
      && Math.abs((Number(camera.position?.z) || 0) - Number(state.position.z)) <= MAIN_CAMERA_POSITION_EPSILON;
  }

  function activeAttackTarget() {
    const focus = combatFocus();
    const state = focus?.snapshot?.();
    if (!state?.combatStance) return null;
    const target = focus?.attackCameraTarget?.();
    if (!target?.origin || !target?.direction || !target?.point) return null;
    return target;
  }

  function rootedTransform(target) {
    const cfg = shoulderConfig();
    if (!cfg) return null;

    const fx0 = Number(target.direction.x) || 0;
    const fz0 = Number(target.direction.z) || 0;
    const horizontalLength = Math.hypot(fx0, fz0);
    if (horizontalLength < 1e-6) return null;
    const fx = fx0 / horizontalLength;
    const fz = fz0 / horizontalLength;
    const rightX = -fz;
    const rightZ = fx;

    const distance = clamp(Number(cfg.distanceTiles) || 2.6, MIN_DISTANCE, MAX_DISTANCE);
    const elevationRad = (Number(cfg.angleFromGroundDeg) || 0) * Math.PI / 180;
    const groundDistance = Math.cos(elevationRad) * distance;
    const heightDistance = Math.sin(elevationRad) * distance;
    const shoulderH = sliderNumber('settingShoulderSurfOffsetH', 0);
    const shoulderV = sliderNumber('settingShoulderSurfOffsetV', 0);
    const origin = target.origin;

    return {
      x: Number(origin.x) + rightX * shoulderH - fx * groundDistance,
      y: Number(origin.y) + shoulderV + heightDistance,
      z: Number(origin.z) + rightZ * shoulderH - fz * groundDistance,
      distance,
      shoulderH,
      shoulderV,
      elevationDeg: Number(cfg.angleFromGroundDeg) || 0,
      forward: { x: fx, z: fz },
      root: { x: Number(origin.x), y: Number(origin.y), z: Number(origin.z) },
    };
  }

  function install() {
    if (installed) return true;
    const THREE = three();
    const proto = THREE?.PerspectiveCamera?.prototype;
    const baseObjectLookAt = THREE?.Object3D?.prototype?.lookAt;
    if (!proto || typeof proto.lookAt !== 'function' || typeof baseObjectLookAt !== 'function') return false;

    const previousLookAt = proto.lookAt; // Existing attack-camera wrapper remains the normal-camera fallback outside combat.
    proto.lookAt = function playerRootedAttackCameraLookAt(...args) {
      const target = mainShoulderCamera(this) ? activeAttackTarget() : null;
      const rooted = target ? rootedTransform(target) : null;
      if (!target || !rooted) {
        if (lastCombatActive) {
          lastCombatActive = false;
          window.__farmLog?.('[attack-camera-root] player-rooted combat camera OFF.', 'combat');
        }
        return previousLookAt.apply(this, args);
      }

      // Ignore the camera position produced by the normal shoulder orbit for
      // this frame. Rebuild it from the player's attack origin every time, so
      // mouse-look can request a new turn but can never feed an altered camera
      // ray back into its own position and launch the rig away from the player.
      this.position.set(rooted.x, rooted.y, rooted.z);
      baseObjectLookAt.call(this, target.point);

      lastFrame = {
        mode: target.mode,
        source: target.source,
        itemKey: target.itemKey || null,
        root: rooted.root,
        position: { x: rooted.x, y: rooted.y, z: rooted.z },
        target: { x: Number(target.point.x), y: Number(target.point.y), z: Number(target.point.z) },
        forward: rooted.forward,
        distance: rooted.distance,
        shoulderH: rooted.shoulderH,
        shoulderV: rooted.shoulderV,
        elevationDeg: rooted.elevationDeg,
      };
      if (!lastCombatActive) {
        lastCombatActive = true;
        window.__farmLog?.(`[attack-camera-root] player-rooted combat camera ON; ${target.mode}; distance=${rooted.distance.toFixed(2)}.`, 'combat');
      }
      return undefined;
    };

    installed = true;
    return true;
  }

  window.HobunjiAttackCameraPlayerRoot = {
    version: VERSION,
    install,
    activeAttackTarget,
    rootedTransform,
    snapshot: () => lastFrame ? { ...lastFrame } : null,
    tuning: { minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE },
  };
  window.__attackCameraRootDebug = window.HobunjiAttackCameraPlayerRoot;

  install();
})();
