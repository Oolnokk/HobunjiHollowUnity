// Pure fixed-length two-bone arm IK shared by the game and attack editor.
// The visible arm remains painted into the PNG portrait; these Object3D bones
// exist only to carry a 3D hand and keep its weapon target within reach.
(function () {
  'use strict';

  const EPSILON = 1e-6;

  function safeVector(THREE, value) {
    return new THREE.Vector3(Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0);
  }

  function quaternionFromDown(THREE, direction) {
    const dir = direction.clone(); // Used to preserve the caller's vector while normalizing.
    if (dir.lengthSq() <= EPSILON) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
  }

  function constrainTarget(THREE, shoulder, target, armLength) {
    const shoulderPoint = safeVector(THREE, shoulder);
    const requested = safeVector(THREE, target);
    const reach = Math.max(EPSILON, Number(armLength) || 0);
    const offset = requested.clone().sub(shoulderPoint); // Used to project overextended poses onto the reach sphere.
    const requestedDistance = offset.length();
    if (requestedDistance <= reach || requestedDistance <= EPSILON) {
      return { target: requested, requestedDistance, constrainedDistance: requestedDistance, clamped: false };
    }
    return {
      target: shoulderPoint.clone().add(offset.multiplyScalar(reach / requestedDistance)),
      requestedDistance,
      constrainedDistance: reach,
      clamped: true,
    };
  }

  function solveTwoBoneArm(THREE, { shoulder, target, armLength, pole } = {}) {
    const shoulderPoint = safeVector(THREE, shoulder);
    const reachResult = constrainTarget(THREE, shoulderPoint, target, armLength);
    const handPoint = reachResult.target;
    const totalLength = Math.max(EPSILON, Number(armLength) || 0);
    const upperLength = totalLength * 0.5;
    const forearmLength = totalLength - upperLength;
    const shoulderToHand = handPoint.clone().sub(shoulderPoint);
    const distance = Math.max(EPSILON, shoulderToHand.length());
    const direction = shoulderToHand.clone().multiplyScalar(1 / distance);
    const along = Math.max(0, Math.min(upperLength,
      (upperLength * upperLength - forearmLength * forearmLength + distance * distance) / (2 * distance)));
    const bendHeight = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    const poleDirection = safeVector(THREE, pole || { x: 0, y: 0, z: 1 }); // Used to choose a stable outward elbow bend.
    poleDirection.sub(direction.clone().multiplyScalar(poleDirection.dot(direction)));
    if (poleDirection.lengthSq() <= EPSILON) {
      poleDirection.set(1, 0, 0).sub(direction.clone().multiplyScalar(direction.x));
    }
    poleDirection.normalize();
    const elbow = shoulderPoint.clone()
      .add(direction.clone().multiplyScalar(along))
      .add(poleDirection.multiplyScalar(bendHeight));
    const upperQuaternion = quaternionFromDown(THREE, elbow.clone().sub(shoulderPoint));
    const forearmWorldQuaternion = quaternionFromDown(THREE, handPoint.clone().sub(elbow));
    const forearmLocalQuaternion = upperQuaternion.clone().invert().multiply(forearmWorldQuaternion);
    return {
      ...reachResult,
      elbow,
      upperLength,
      forearmLength,
      upperQuaternion,
      forearmLocalQuaternion,
    };
  }

  window.ArmBones = { constrainTarget, solveTwoBoneArm };
})();
