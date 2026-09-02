// Pure 2-bone solver shared by the runtime procedural feet (see
// docs/js/procedural-leg-animation.js) and its reference authoring tools.
//
// solveTwoBoneLeg preserves the original gait contract: the thigh is half the
// current hip-to-foot distance and the calf is re-aimed/re-sized each frame.
// solveFixedTwoBoneChain adds anatomical IK for ground poses and generated
// elbows: upper/lower lengths stay fixed and a pole point chooses the bend side.
(function () {
  'use strict';

  const DOWN = Object.freeze({ x: 0, y: -1, z: 0 }); // Local bone axis used by both the legacy and fixed-length solvers.

  // Builds the quaternion that rotates the fixed local "down" axis (0,-1,0)
  // to point along `dir` (must already be normalized). Falls back to the
  // identity rotation for a zero-length direction rather than producing NaNs.
  function quatFromDown(THREE, dir) {
    const down = new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z); // Source direction used for every generated thigh/arm segment.
    if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z) || dir.lengthSq() < 1e-12) {
      return new THREE.Quaternion();
    }
    return new THREE.Quaternion().setFromUnitVectors(down, dir.clone().normalize());
  }

  // Legacy gait solver. The upper segment is always half the live root-to-end
  // distance; an authored X/Z bend moves the middle joint and the lower segment
  // then stretches/re-aims so the foot remains exactly on its gait target.
  function solveTwoBoneLeg(THREE, { hip, foot, bendDegX = 0, bendDegZ = 0 } = {}) {
    const hipVec = new THREE.Vector3(hip?.x || 0, hip?.y || 0, hip?.z || 0); // Fixed hip point used by the procedural-foot rig.
    const footVec = new THREE.Vector3(foot?.x || 0, foot?.y || 0, foot?.z || 0); // Live gait target the foot must reach exactly.

    const hipToFoot = footVec.clone().sub(hipVec); // Supplies current chain direction and dynamic total length.
    const fullLength = hipToFoot.length(); // Drives the legacy equal-half upper segment.
    const thighLength = fullLength * 0.5; // Preserves the original gait solver's authored contract.
    const straightDir = fullLength > 1e-6 ? hipToFoot.clone().normalize() : new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z); // Avoids a zero-vector orientation.

    const defaultThighQuat = quatFromDown(THREE, straightDir); // Points the upper segment at the live foot before bend is applied.
    const bendQuat = new THREE.Quaternion().setFromEuler( // Adds the existing authored sagittal/lateral bend.
      new THREE.Euler(THREE.MathUtils.degToRad(bendDegX || 0), 0, THREE.MathUtils.degToRad(bendDegZ || 0))
    );
    const thighQuaternion = defaultThighQuat.clone().multiply(bendQuat); // Final world orientation consumed by the thigh mesh/guide.

    const thighDirWorld = new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z).applyQuaternion(thighQuaternion); // Converts the authored upper orientation back into a direction.
    const knee = hipVec.clone().addScaledVector(thighDirWorld, thighLength); // Middle joint generated from the fixed upper length.

    const kneeToFoot = footVec.clone().sub(knee); // Re-aims the lower segment at the exact foot target.
    const calfLength = kneeToFoot.length(); // Dynamic lower length retained for backwards compatibility.
    const calfDirWorld = calfLength > 1e-6 ? kneeToFoot.clone().normalize() : thighDirWorld.clone(); // Stable lower direction even when knee and foot coincide.
    const calfWorldQuaternion = quatFromDown(THREE, calfDirWorld); // World orientation before converting to upper-segment local space.
    const calfLocalQuaternion = thighQuaternion.clone().invert().multiply(calfWorldQuaternion); // Local lower rotation used by the existing hierarchy.

    return { knee, thighQuaternion, thighLength, calfLocalQuaternion, calfLength };
  }

  // Fixed-length anatomical IK used by resting poses and generated elbows.
  // `root`, `target`, and `pole` share one coordinate space. `pole` is a point
  // toward which the knee/elbow should bend. Unreachable targets are clamped to
  // the nearest valid reach without changing either authored segment length.
  function solveFixedTwoBoneChain(THREE, { root, target, upperLength, lowerLength, pole } = {}) {
    const EPSILON = 1e-6; // Prevents divide-by-zero at fully folded/extended limits.
    const rootVec = new THREE.Vector3(root?.x || 0, root?.y || 0, root?.z || 0); // Shoulder/hip origin of the fixed chain.
    const targetVec = new THREE.Vector3(target?.x || 0, target?.y || 0, target?.z || 0); // Requested hand/foot endpoint.
    const poleVec = new THREE.Vector3(pole?.x || 0, pole?.y || 0, pole?.z || 0); // World/local-space point selecting elbow/knee bend direction.
    const upper = Math.max(EPSILON, Number(upperLength) || EPSILON); // Fixed species-derived upper-arm/thigh length.
    const lower = Math.max(EPSILON, Number(lowerLength) || EPSILON); // Fixed species-derived forearm/calf length.

    const rootToTarget = targetVec.clone().sub(rootVec); // Supplies requested reach direction before clamping.
    const requestedDistance = rootToTarget.length(); // Reported to diagnostics and used to detect unreachable requests.
    const direction = requestedDistance > EPSILON ? rootToTarget.clone().multiplyScalar(1 / requestedDistance) : new THREE.Vector3(0, -1, 0); // Stable chain axis when target overlaps root.
    const minimumReach = Math.max(EPSILON, Math.abs(upper - lower) + EPSILON); // Inner annulus limit of a two-segment chain.
    const maximumReach = Math.max(minimumReach, upper + lower - EPSILON); // Outer annulus limit while avoiding a perfectly singular straight line.
    const solvedDistance = Math.max(minimumReach, Math.min(maximumReach, requestedDistance || minimumReach)); // Keeps law-of-cosines values finite.
    const solvedTarget = rootVec.clone().addScaledVector(direction, solvedDistance); // Endpoint actually used by the fixed-length solution.

    const poleDirection = poleVec.clone().sub(rootVec); // Chooses the plane in which the middle joint bends.
    if (poleDirection.lengthSq() < EPSILON * EPSILON) poleDirection.set(1, 0, 0); // Gives unauthored chains a deterministic lateral bend plane.
    let planeNormal = new THREE.Vector3().crossVectors(direction, poleDirection); // Normal of the desired bend plane.
    if (planeNormal.lengthSq() < EPSILON * EPSILON) {
      const fallbackAxis = Math.abs(direction.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); // Picks an axis that is not parallel to the chain.
      planeNormal = new THREE.Vector3().crossVectors(direction, fallbackAxis); // Rebuilds a valid bend plane for collinear poles.
    }
    planeNormal.normalize();
    let bendDirection = new THREE.Vector3().crossVectors(planeNormal, direction).normalize(); // Unit direction from the chain axis toward the pole side.
    if (bendDirection.dot(poleDirection) < 0) bendDirection.multiplyScalar(-1); // Ensures the joint consistently bends toward, not away from, the pole.

    const along = (upper * upper - lower * lower + solvedDistance * solvedDistance) / (2 * solvedDistance); // Law-of-cosines distance from root along the chain axis.
    const bendHeight = Math.sqrt(Math.max(0, upper * upper - along * along)); // Perpendicular displacement of the generated elbow/knee.
    const joint = rootVec.clone().addScaledVector(direction, along).addScaledVector(bendDirection, bendHeight); // Fixed-length middle joint.

    const upperDirection = joint.clone().sub(rootVec).normalize(); // Drives the upper segment orientation.
    const lowerDirection = solvedTarget.clone().sub(joint).normalize(); // Drives the lower segment orientation.
    const upperQuaternion = quatFromDown(THREE, upperDirection); // World rotation of upper arm/thigh.
    const lowerWorldQuaternion = quatFromDown(THREE, lowerDirection); // World rotation of forearm/calf before parent-local conversion.
    const lowerLocalQuaternion = upperQuaternion.clone().invert().multiply(lowerWorldQuaternion); // Lower rotation ready for a parented two-bone hierarchy.

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
    };
  }

  window.LegBones = { solveTwoBoneLeg, solveFixedTwoBoneChain };
})();
