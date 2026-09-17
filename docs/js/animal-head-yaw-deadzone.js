// Shared visual-yaw authority for every painted-weight animal head rig.
//
// The camera deadzone is solved as part of updateHeadYaw's target math BEFORE
// authored neck smoothing. There is no render-time/per-frame correction pass:
// callers still request ordinary local head yaw, and this module replaces that
// rig method once, at avatar construction, with the camera-safe target solver.
(() => {
  'use strict';

  const api = window.PNGPlaneAvatar;
  if (!api?.buildAnimalPlaneAvatarModel || Number(window.AnimalHeadYawDeadzone?.version) >= 2) return;

  const RAD = Math.PI / 180; // Converts the shared head-rig degree API to the rotation module's radians.
  const DEG = 180 / Math.PI; // Converts the camera-safe world yaw back into the head rig's local degrees.
  const TWO_PI = Math.PI * 2; // Used by wrappedAngleDelta so world yaw comparisons always use the shortest arc.

  function finite(value, fallback = 0) {
    const number = Number(value); // Normalizes authored/runtime numeric fields before they enter yaw math.
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value)); // Keeps both requested and camera-safe targets inside the authored neck range.
  }

  function wrappedAngleDelta(target, current) {
    let delta = target - current;
    while (delta > Math.PI) delta -= TWO_PI;
    while (delta < -Math.PI) delta += TWO_PI;
    return delta;
  }

  function valuesOf(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (typeof collection.values === 'function') return collection.values();
    return typeof collection[Symbol.iterator] === 'function' ? collection : [];
  }

  function ownerForAvatar(avatarRef) {
    const cached = avatarRef.__hobunjiHeadDeadzoneOwner; // Avoids rescanning creature registries after the avatar/entity relationship is known.
    if (cached?.avatarRef === avatarRef) return cached;
    const combatDeps = window.Combat?.deps;
    const collections = [
      combatDeps?.hostileObjects,
      combatDeps?.companionObjects,
      combatDeps?.animalObjects,
      combatDeps?.worldObjects,
    ]; // Covers wild hostiles, followers/shoulder pets, farm animals exposed through Combat, and world animals.
    for (const collection of collections) {
      for (const candidate of valuesOf(collection)) {
        if (candidate?.avatarRef !== avatarRef) continue;
        avatarRef.__hobunjiHeadDeadzoneOwner = candidate;
        return candidate;
      }
    }
    return null;
  }

  function frontPlaneForAvatar(avatarRef) {
    return Array.from(avatarRef?.group?.children || []).find(child =>
      child?.userData?.hobunjiPlaneFace === 'front'
      || String(child?.name || '').endsWith('_front_plane')) || null; // Uses the actual rendered card so ordinary creature planeDelta is included in body yaw.
  }

  function worldYawForObject(object) {
    if (!object) return NaN;
    const THREE = window.THREE;
    if (typeof object.getWorldQuaternion === 'function' && THREE?.Quaternion && THREE?.Vector3) {
      object.updateWorldMatrix?.(true, false);
      const quaternion = object.getWorldQuaternion(new THREE.Quaternion()); // Samples the visible hierarchy after parent/plane deadzone transforms.
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion); // Local +Z gives the object's signed world yaw even when parented.
      if (Number.isFinite(forward.x) && Number.isFinite(forward.z)) return Math.atan2(forward.x, forward.z);
    }
    const localYaw = Number(object.rotation?.y);
    return Number.isFinite(localYaw) ? localYaw : NaN;
  }

  function visibleBodyYaw(avatarRef, owner) {
    const group = avatarRef?.group;
    const shoulderAttachment = group?.userData?.hobunjiShoulderPetAttachment;
    if (owner?.stableRole === 'shoulderPet'
      && shoulderAttachment?.authoritativeRootTransform !== true
      && Number.isFinite(Number(owner.pngRot))) {
      return Number(owner.pngRot); // Non-authoritative shoulder cards explicitly render from pngRot in their onBeforeRender path.
    }

    const frontPlane = frontPlaneForAvatar(avatarRef);
    const frontWorldYaw = worldYawForObject(frontPlane);
    if (Number.isFinite(frontWorldYaw)) {
      return wrappedAngleDelta(frontWorldYaw - Math.PI / 2, 0); // Removes the front card's authored +90° side-view twist, leaving visible body yaw.
    }
    if (Number.isFinite(Number(owner?.pngRot))) return Number(owner.pngRot); // Combat fallback when the visible plane cannot expose a world quaternion yet.
    return worldYawForObject(group); // Farm/nursery/named animals normally rotate the avatar group directly.
  }

  function liveCameraPosition() {
    const climb = window.__climbDebug?.getCameraDebug?.()?.camPos;
    const furniture = window.__hobunjiFurnitureDebug?.camState?.position;
    const source = climb || furniture; // Mirrors PerpRotation's current live-camera authority instead of inventing a second camera convention.
    const x = Number(source?.x), y = Number(source?.y), z = Number(source?.z);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  }

  function groupWorldPosition(group) {
    if (!group) return null;
    const THREE = window.THREE;
    if (typeof group.getWorldPosition === 'function' && THREE?.Vector3) {
      group.updateWorldMatrix?.(true, false);
      const position = group.getWorldPosition(new THREE.Vector3()); // Keeps attached and nested animals camera-relative in world space.
      if ([Number(position?.x), Number(position?.z)].every(Number.isFinite)) return position;
    }
    const x = Number(group.position?.x), y = Number(group.position?.y), z = Number(group.position?.z);
    return [x, z].every(Number.isFinite) ? { x, y: Number.isFinite(y) ? y : 0, z } : null;
  }

  function validPerps(value) {
    return Array.isArray(value) && value.length > 0 && value.every(Number.isFinite);
  }

  function cameraPerpsForAvatar(avatarRef, owner) {
    const rotationApi = window.PerpRotation;
    const bodyState = owner?.perpState;
    const fallbackPerps = bodyState?.screenViewPerspectiveDebug?.cameraPerpsRad
      || bodyState?.pixelProbeDebug?.cameraPerpsRad
      || [];
    if (bodyState && typeof rotationApi?.perspectivePerpsForState === 'function') {
      const resolved = rotationApi.perspectivePerpsForState(bodyState, fallbackPerps); // Reuses live subject/camera lookup for registered creatures and livestock.
      if (validPerps(resolved)) return resolved;
    }

    const cameraPosition = liveCameraPosition();
    const worldPosition = groupWorldPosition(avatarRef?.group);
    if (cameraPosition && worldPosition && typeof rotationApi?.cameraRelativePerpsAtWorldPosition === 'function') {
      const resolved = rotationApi.cameraRelativePerpsAtWorldPosition(worldPosition, cameraPosition); // Covers nursery/named/other animal avatars outside Combat registries.
      if (validPerps(resolved)) return resolved;
    }
    return validPerps(fallbackPerps) ? fallbackPerps : null;
  }

  function installAvatar(avatarRef) {
    if (!avatarRef?.headRig || typeof avatarRef.updateHeadYaw !== 'function') return false;
    if (avatarRef.__hobunjiGlobalHeadDeadzoneMath) return true;

    const state = avatarRef.headRig;
    const rig = state.rig;
    const frontHeadBone = state.frontHeadBone;
    const backHeadBone = state.backHeadBone;
    if (!rig || !frontHeadBone?.rotation || !backHeadBone?.rotation) return false;

    const yawLimitDeg = Math.max(Math.abs(finite(rig.minDeg)), Math.abs(finite(rig.maxDeg))); // Matches the authored head rig's existing yaw-range convention.
    const visualClampState = {}; // Persists deadzone side/hysteresis inside the head-yaw solver, independently of body-facing state.

    avatarRef.updateHeadYaw = function updateAnimalHeadYawWithDeadzone(degrees, deltaSeconds) {
      const requestedTarget = clamp(finite(degrees), -yawLimitDeg, yawLimitDeg); // Logical/AI request remains inspectable even when the visible head must stop earlier.
      const owner = ownerForAvatar(avatarRef);
      const bodyYaw = visibleBodyYaw(avatarRef, owner);
      const cameraPerps = cameraPerpsForAvatar(avatarRef, owner);
      const rotationApi = window.PerpRotation;
      let target = requestedTarget;
      let effectiveWorldYaw = Number.isFinite(bodyYaw) ? bodyYaw + requestedTarget * RAD : NaN;
      let deadzoneActive = false;
      let deadzoneReason = null;

      if (Number.isFinite(bodyYaw)
        && validPerps(cameraPerps)
        && typeof rotationApi?.perpClamp === 'function'
        && Number.isFinite(Number(rotationApi.CREATURE_PERP_DEAD_RAD))) {
        if (!Array.isArray(visualClampState.perpSides) || visualClampState.perpSides.length !== cameraPerps.length) {
          const currentVisualYaw = bodyYaw + finite(state.currentYawDeg) * RAD; // Seeds the edge from what is visibly rendered now, preventing first-frame side flips.
          visualClampState.perpSides = cameraPerps.map(center => wrappedAngleDelta(currentVisualYaw, center) >= 0 ? 1 : -1);
          visualClampState.locked = cameraPerps.map(() => false);
        }
        const requestedWorldYaw = bodyYaw + requestedTarget * RAD;
        const clamped = rotationApi.perpClamp(
          visualClampState,
          requestedWorldYaw,
          cameraPerps,
          Number(rotationApi.CREATURE_PERP_DEAD_RAD),
        ); // This is the head target calculation itself; no later render correction is applied.
        effectiveWorldYaw = Number(clamped?.effectiveTarget);
        if (Number.isFinite(effectiveWorldYaw)) {
          const cameraSafeLocalDeg = wrappedAngleDelta(effectiveWorldYaw, bodyYaw) * DEG;
          target = clamp(cameraSafeLocalDeg, -yawLimitDeg, yawLimitDeg); // Anatomy remains the final physical limit after camera safety chooses its target.
          deadzoneActive = Math.abs(target - requestedTarget) > 1e-7;
        } else {
          effectiveWorldYaw = requestedWorldYaw;
          deadzoneReason = 'invalid-clamp-result';
        }
      } else {
        visualClampState.perpSides = null;
        visualClampState.locked = null;
        deadzoneReason = !Number.isFinite(bodyYaw)
          ? 'missing-body-yaw'
          : !validPerps(cameraPerps)
            ? 'missing-camera-perps'
            : 'missing-rotation-api';
      }

      const delta = Math.max(0, finite(deltaSeconds));
      const step = Math.max(0, finite(rig.turnSpeedDeg)) * delta; // Existing authored smoothing budget is applied only after the safe target is known.
      const currentYawDeg = finite(state.currentYawDeg);
      const diff = target - currentYawDeg;
      state.currentYawDeg = currentYawDeg + clamp(diff, -step, step);
      state.requestedYawDeg = requestedTarget;
      state.targetYawDeg = target;
      frontHeadBone.rotation.y = state.currentYawDeg * RAD;
      backHeadBone.rotation.y = state.currentYawDeg * RAD;

      const debug = {
        active: deadzoneActive,
        reason: deadzoneReason,
        requestedYawDeg: requestedTarget,
        targetYawDeg: target,
        renderedYawDeg: state.currentYawDeg,
        bodyYaw,
        effectiveWorldYaw,
        deadzoneRad: Number(rotationApi?.CREATURE_PERP_DEAD_RAD),
        cameraPerpsRad: validPerps(cameraPerps) ? cameraPerps.slice() : null,
        source: owner ? 'registered-animal' : 'avatar-world-transform',
      }; // Mobile/debug consumers can compare logical, safe-target, and smoothed rendered yaw without affecting gameplay.
      state.deadzoneDebug = debug;
      if (owner) owner._headDeadzoneDebug = debug;
      return state.currentYawDeg;
    };

    avatarRef.__hobunjiGlobalHeadDeadzoneMath = true; // Marks the avatar so no later builder/manual rig pass can stack another yaw authority.
    return true;
  }

  const originalBuildAnimal = api.buildAnimalPlaneAvatarModel.bind(api); // Existing builder remains responsible for textures, weights, and authored rig creation.
  api.buildAnimalPlaneAvatarModel = function globalDeadzoneAnimalBuilder(...args) {
    const avatarRef = originalBuildAnimal(...args);
    installAvatar(avatarRef); // Every future rigged animal receives the same direct head-yaw target math, regardless of gameplay role.
    return avatarRef;
  };
  api.__globalAnimalHeadYawDeadzoneInstalled = true;

  const rigRuntime = window.AnimalHeadRigRuntime;
  if (rigRuntime?.applyRigToAvatar && !rigRuntime.__globalHeadYawDeadzoneInstalled) {
    const originalApplyRig = rigRuntime.applyRigToAvatar.bind(rigRuntime); // Manual/editor rig application also enters the same shared yaw authority.
    rigRuntime.applyRigToAvatar = function globalDeadzoneApplyRig(...args) {
      const avatarRef = originalApplyRig(...args);
      installAvatar(avatarRef);
      return avatarRef;
    };
    rigRuntime.__globalHeadYawDeadzoneInstalled = true;
  }

  window.AnimalHeadYawDeadzone = {
    version: 2,
    installAvatar,
    getDebug(avatarRef) { return avatarRef?.headRig?.deadzoneDebug || null; },
  };
})();
