// Pure fixed-length two-bone arm IK shared by gameplay and animation tools.
(function () {
  'use strict';
  const EPSILON = 1e-6;
  const DEFAULT_MIN_ELBOW_DEG = 18;  // Allows a deep fold without letting the elbow collapse through itself.
  const DEFAULT_MAX_ELBOW_DEG = 175; // Keeps a slight natural bend instead of hyperextending perfectly straight/backwards.

  function safeVector(THREE, value) {
    return new THREE.Vector3(Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0);
  }

  function quaternionFromDown(THREE, direction) {
    const dir = direction.clone();
    if (dir.lengthSq() <= EPSILON) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
  }

  function clampTargetDistance(THREE, shoulderPoint, requested, minReach, maxReach) {
    const offset = requested.clone().sub(shoulderPoint);
    const requestedDistance = offset.length();
    if (requestedDistance <= EPSILON) {
      const fallback = new THREE.Vector3(0, -1, 0).multiplyScalar(minReach);
      return {
        target: shoulderPoint.clone().add(fallback),
        requestedDistance,
        constrainedDistance: minReach,
        clamped: minReach > EPSILON,
        constraint: minReach > EPSILON ? 'elbow-fold-limit' : null,
      };
    }
    const constrainedDistance = Math.max(minReach, Math.min(maxReach, requestedDistance));
    if (Math.abs(constrainedDistance - requestedDistance) <= EPSILON) {
      return { target: requested, requestedDistance, constrainedDistance: requestedDistance, clamped: false, constraint: null };
    }
    return {
      target: shoulderPoint.clone().add(offset.multiplyScalar(constrainedDistance / requestedDistance)),
      requestedDistance,
      constrainedDistance,
      clamped: true,
      constraint: requestedDistance > maxReach ? 'reach-limit' : 'elbow-fold-limit',
    };
  }

  function constrainTarget(THREE, shoulder, target, armLength, options = {}) {
    const shoulderPoint = safeVector(THREE, shoulder);
    const requested = safeVector(THREE, target);
    const reach = Math.max(EPSILON, Number(armLength) || 0);
    const minReach = Math.max(0, Number(options.minReach) || 0);
    const maxReach = Math.max(minReach + EPSILON, Math.min(reach, Number(options.maxReach) || reach));
    return clampTargetDistance(THREE, shoulderPoint, requested, minReach, maxReach);
  }

  function distanceForElbowAngle(upperLength, forearmLength, angleDeg) {
    const angle = Math.max(0, Math.min(180, Number(angleDeg) || 0)) * Math.PI / 180;
    return Math.sqrt(Math.max(0,
      upperLength * upperLength + forearmLength * forearmLength
      - 2 * upperLength * forearmLength * Math.cos(angle)
    ));
  }

  function solveTwoBoneArm(THREE, { shoulder, target, armLength, pole, minElbowDeg, maxElbowDeg } = {}) {
    const shoulderPoint = safeVector(THREE, shoulder);
    const totalLength = Math.max(EPSILON, Number(armLength) || 0);
    const upperLength = totalLength * 0.5;
    const forearmLength = totalLength - upperLength;
    const minAngle = Number.isFinite(Number(minElbowDeg)) ? Number(minElbowDeg) : DEFAULT_MIN_ELBOW_DEG;
    const maxAngle = Number.isFinite(Number(maxElbowDeg)) ? Number(maxElbowDeg) : DEFAULT_MAX_ELBOW_DEG;
    const minReach = distanceForElbowAngle(upperLength, forearmLength, Math.min(minAngle, maxAngle));
    const maxReach = Math.min(totalLength, distanceForElbowAngle(upperLength, forearmLength, Math.max(minAngle, maxAngle)));
    const reachResult = constrainTarget(THREE, shoulderPoint, target, totalLength, { minReach, maxReach });
    const handPoint = reachResult.target;
    const shoulderToHand = handPoint.clone().sub(shoulderPoint);
    const distance = Math.max(EPSILON, shoulderToHand.length());
    const direction = shoulderToHand.clone().multiplyScalar(1 / distance);
    const along = Math.max(0, Math.min(upperLength,
      (upperLength * upperLength - forearmLength * forearmLength + distance * distance) / (2 * distance)
    ));
    const bendHeight = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));

    // The pole establishes the anatomically preferred side of the arm. Projecting
    // it onto the plane perpendicular to shoulder→hand prevents the elbow from
    // flipping through the arm as the target crosses quadrants.
    const poleDirection = safeVector(THREE, pole || { x: 0, y: 0, z: 1 });
    poleDirection.sub(direction.clone().multiplyScalar(poleDirection.dot(direction)));
    if (poleDirection.lengthSq() <= EPSILON) {
      const fallbackAxis = Math.abs(direction.z) < 0.9
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(1, 0, 0);
      poleDirection.copy(fallbackAxis).sub(direction.clone().multiplyScalar(fallbackAxis.dot(direction)));
    }
    poleDirection.normalize();

    const elbow = shoulderPoint.clone()
      .add(direction.clone().multiplyScalar(along))
      .add(poleDirection.multiplyScalar(bendHeight));
    const upperQuaternion = quaternionFromDown(THREE, elbow.clone().sub(shoulderPoint));
    const forearmWorldQuaternion = quaternionFromDown(THREE, handPoint.clone().sub(elbow));
    const forearmLocalQuaternion = upperQuaternion.clone().invert().multiply(forearmWorldQuaternion);
    const cosElbow = Math.max(-1, Math.min(1,
      (upperLength * upperLength + forearmLength * forearmLength - distance * distance)
      / Math.max(EPSILON, 2 * upperLength * forearmLength)
    ));
    const elbowAngleDeg = Math.acos(cosElbow) * 180 / Math.PI;

    return {
      ...reachResult,
      elbow,
      upperLength,
      forearmLength,
      upperQuaternion,
      forearmLocalQuaternion,
      elbowAngleDeg,
      elbowLimitsDeg: { min: Math.min(minAngle, maxAngle), max: Math.max(minAngle, maxAngle) },
    };
  }

  window.ArmBones = {
    constrainTarget,
    solveTwoBoneArm,
    defaultElbowLimitsDeg: Object.freeze({ min: DEFAULT_MIN_ELBOW_DEG, max: DEFAULT_MAX_ELBOW_DEG }),
  };
})();
