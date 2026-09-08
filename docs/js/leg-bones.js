// Shared two-bone geometry helpers used by procedural gait, ground poses, and
// manual limb authoring.
(function () {
  'use strict';

  const DOWN = Object.freeze({ x: 0, y: -1, z: 0 });

  function quatFromDown(THREE, dir) {
    const down = new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z);
    if (!Number.isFinite(dir?.x) || !Number.isFinite(dir?.y) || !Number.isFinite(dir?.z) || dir.lengthSq() < 1e-12) {
      return new THREE.Quaternion();
    }
    return new THREE.Quaternion().setFromUnitVectors(down, dir.clone().normalize());
  }

  // Legacy gait contract: dynamic equal-half thigh plus a lower segment that
  // re-aims to the live foot. Kept byte-for-behaviour compatible with the old
  // runtime so existing walking does not change.
  function solveTwoBoneLeg(THREE, { hip, foot, bendDegX = 0, bendDegZ = 0 } = {}) {
    const hipVec = new THREE.Vector3(hip?.x || 0, hip?.y || 0, hip?.z || 0);
    const footVec = new THREE.Vector3(foot?.x || 0, foot?.y || 0, foot?.z || 0);
    const hipToFoot = footVec.clone().sub(hipVec);
    const fullLength = hipToFoot.length();
    const thighLength = fullLength * 0.5;
    const straightDir = fullLength > 1e-6 ? hipToFoot.clone().normalize() : new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z);
    const defaultThighQuat = quatFromDown(THREE, straightDir);
    const bendQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(bendDegX || 0), 0, THREE.MathUtils.degToRad(bendDegZ || 0))
    );
    const thighQuaternion = defaultThighQuat.clone().multiply(bendQuat);
    const thighDirWorld = new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z).applyQuaternion(thighQuaternion);
    const knee = hipVec.clone().addScaledVector(thighDirWorld, thighLength);
    const kneeToFoot = footVec.clone().sub(knee);
    const calfLength = kneeToFoot.length();
    const calfDirWorld = calfLength > 1e-6 ? kneeToFoot.clone().normalize() : thighDirWorld.clone();
    const calfWorldQuaternion = quatFromDown(THREE, calfDirWorld);
    const calfLocalQuaternion = thighQuaternion.clone().invert().multiply(calfWorldQuaternion);
    return { knee, thighQuaternion, thighLength, calfLocalQuaternion, calfLength };
  }

  // Fixed-length anatomical IK. Used where the authored limb length is the
  // constraint (notably automatic ground/rest legs).
  function solveFixedTwoBoneChain(THREE, { root, target, upperLength, lowerLength, pole } = {}) {
    const EPSILON = 1e-6;
    const rootVec = new THREE.Vector3(root?.x || 0, root?.y || 0, root?.z || 0);
    const targetVec = new THREE.Vector3(target?.x || 0, target?.y || 0, target?.z || 0);
    const poleVec = new THREE.Vector3(pole?.x || 0, pole?.y || 0, pole?.z || 0);
    const upper = Math.max(EPSILON, Number(upperLength) || EPSILON);
    const lower = Math.max(EPSILON, Number(lowerLength) || EPSILON);
    const rootToTarget = targetVec.clone().sub(rootVec);
    const requestedDistance = rootToTarget.length();
    const direction = requestedDistance > EPSILON ? rootToTarget.clone().multiplyScalar(1 / requestedDistance) : new THREE.Vector3(0, -1, 0);
    const minimumReach = Math.max(EPSILON, Math.abs(upper - lower) + EPSILON);
    const maximumReach = Math.max(minimumReach, upper + lower - EPSILON);
    const solvedDistance = Math.max(minimumReach, Math.min(maximumReach, requestedDistance || minimumReach));
    const solvedTarget = rootVec.clone().addScaledVector(direction, solvedDistance);
    const poleDirection = poleVec.clone().sub(rootVec);
    if (poleDirection.lengthSq() < EPSILON * EPSILON) poleDirection.set(1, 0, 0);
    let planeNormal = new THREE.Vector3().crossVectors(direction, poleDirection);
    if (planeNormal.lengthSq() < EPSILON * EPSILON) {
      const fallbackAxis = Math.abs(direction.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      planeNormal = new THREE.Vector3().crossVectors(direction, fallbackAxis);
    }
    planeNormal.normalize();
    let bendDirection = new THREE.Vector3().crossVectors(planeNormal, direction).normalize();
    if (bendDirection.dot(poleDirection) < 0) bendDirection.multiplyScalar(-1);
    const along = (upper * upper - lower * lower + solvedDistance * solvedDistance) / (2 * solvedDistance);
    const bendHeight = Math.sqrt(Math.max(0, upper * upper - along * along));
    const joint = rootVec.clone().addScaledVector(direction, along).addScaledVector(bendDirection, bendHeight);
    const upperDirection = joint.clone().sub(rootVec).normalize();
    const lowerDirection = solvedTarget.clone().sub(joint).normalize();
    const upperQuaternion = quatFromDown(THREE, upperDirection);
    const lowerWorldQuaternion = quatFromDown(THREE, lowerDirection);
    const lowerLocalQuaternion = upperQuaternion.clone().invert().multiply(lowerWorldQuaternion);
    return {
      joint,
      solvedTarget,
      upperQuaternion,
      lowerLocalQuaternion,
      upperLength: upper,
      lowerLength: lower,
      requestedDistance,
      solvedDistance,
      reachable: requestedDistance >= minimumReach - EPSILON && requestedDistance <= maximumReach + EPSILON,
      mode: 'fixed-length-ik',
    };
  }

  // Target-span subdivision used by arms and manual authoring. This deliberately
  // starts with ONE straight bone from root to target, subdivides that bone at
  // jointFraction, then optionally displaces the subdivision toward a pole. An
  // explicit joint wins and is used exactly, which makes draggable elbows/knees
  // intuitive: endpoints stay where the author put them and both child bones
  // simply align to the authored joint.
  function solveSubdividedChain(THREE, {
    root,
    target,
    joint = null,
    jointFraction = 0.5,
    pole = null,
    bendRatio = 0,
  } = {}) {
    const EPSILON = 1e-6;
    const rootVec = new THREE.Vector3(root?.x || 0, root?.y || 0, root?.z || 0);
    const targetVec = new THREE.Vector3(target?.x || 0, target?.y || 0, target?.z || 0);
    const span = targetVec.clone().sub(rootVec);
    const spanLength = span.length();
    const fraction = Math.max(0.05, Math.min(0.95, Number(jointFraction) || 0.5));
    let jointVec;

    if (joint && [joint.x, joint.y, joint.z].every(value => Number.isFinite(Number(value)))) {
      jointVec = new THREE.Vector3(Number(joint.x), Number(joint.y), Number(joint.z));
    } else {
      jointVec = rootVec.clone().addScaledVector(span, fraction);
      const bend = Math.max(0, Number(bendRatio) || 0) * spanLength;
      if (bend > EPSILON && pole && spanLength > EPSILON) {
        const axis = span.clone().multiplyScalar(1 / spanLength);
        const poleVec = new THREE.Vector3(pole?.x || 0, pole?.y || 0, pole?.z || 0);
        const fromJoint = poleVec.sub(jointVec);
        const projected = axis.clone().multiplyScalar(fromJoint.dot(axis));
        const perpendicular = fromJoint.sub(projected);
        if (perpendicular.lengthSq() > EPSILON * EPSILON) jointVec.addScaledVector(perpendicular.normalize(), bend);
      }
    }

    const upperVector = jointVec.clone().sub(rootVec);
    const lowerVector = targetVec.clone().sub(jointVec);
    const upperLength = Math.max(EPSILON, upperVector.length());
    const lowerLength = Math.max(EPSILON, lowerVector.length());
    const upperQuaternion = quatFromDown(THREE, upperVector.clone().multiplyScalar(1 / upperLength));
    const lowerWorldQuaternion = quatFromDown(THREE, lowerVector.clone().multiplyScalar(1 / lowerLength));
    const lowerLocalQuaternion = upperQuaternion.clone().invert().multiply(lowerWorldQuaternion);

    return {
      joint: jointVec,
      solvedTarget: targetVec,
      upperQuaternion,
      lowerLocalQuaternion,
      upperLength,
      lowerLength,
      requestedDistance: spanLength,
      solvedDistance: spanLength,
      reachable: true,
      jointFraction: fraction,
      mode: joint ? 'explicit-joint-subdivision' : 'target-span-subdivision',
    };
  }

  window.LegBones = { solveTwoBoneLeg, solveFixedTwoBoneChain, solveSubdividedChain };

  function isProceduralEditorPath() {
    return /\/tools\/procedural-animation-editor\/(?:index\.html)?\/?$/.test(location.pathname);
  }

  // The procedural editor always fetches leg-bones.js as part of its portrait
  // runtime, including commit-pinned raw.githack previews. PanelUI's historical
  // location.pathname gate only matches the deployed /tools/... route, so use
  // this guaranteed runtime hook as a duplicate-safe fallback bootstrap when
  // the editor is hosted under /owner/repo/<sha>/docs/tools/... instead.
  function bootstrapProceduralGroundCarryAdapter() {
    if (!isProceduralEditorPath()) return;
    if (window.HobunjiProceduralGroundCarryDiagnostics || document.getElementById('proceduralGroundCarryAdapterScript')) return;
    const selfSrc = document.currentScript?.src || '';
    const script = document.createElement('script');
    script.id = 'proceduralGroundCarryAdapterScript';
    script.async = false;
    script.src = selfSrc
      ? new URL('procedural-impact-tabs.js?v=20260905groundcarry1', selfSrc).href
      : new URL('../../js/procedural-impact-tabs.js?v=20260905groundcarry1', window.location.href).href;
    script.addEventListener('load', () => console.info(`[Ground/Carry bootstrap] Adapter loaded from ${script.src}`), { once: true });
    script.addEventListener('error', () => console.error(`[Ground/Carry bootstrap] Failed to load ${script.src}`), { once: true });
    document.head.appendChild(script);
  }

  // Neutral arms are a correction layer, not another animator. Load it from the
  // same commit-pinned leg-bones URL so the authored shoulder/posterior rules and
  // the editor it corrects can never silently come from different revisions.
  function bootstrapProceduralNeutralArms() {
    if (!isProceduralEditorPath()) return;
    if (window.HobunjiProceduralNeutralArms?.installed || document.getElementById('proceduralNeutralArmFixScript')) return;
    const selfSrc = document.currentScript?.src || '';
    const script = document.createElement('script');
    script.id = 'proceduralNeutralArmFixScript';
    script.async = false;
    script.src = selfSrc
      ? new URL('procedural-neutral-arm-fix.js?v=20260905neutralarm1', selfSrc).href
      : new URL('../../js/procedural-neutral-arm-fix.js?v=20260905neutralarm1', window.location.href).href;
    script.addEventListener('load', () => console.info(`[Neutral arms bootstrap] Correction loaded from ${script.src}`), { once: true });
    script.addEventListener('error', () => console.error(`[Neutral arms bootstrap] Failed to load ${script.src}`), { once: true });
    document.head.appendChild(script);
  }

  bootstrapProceduralGroundCarryAdapter();
  bootstrapProceduralNeutralArms();
})();
