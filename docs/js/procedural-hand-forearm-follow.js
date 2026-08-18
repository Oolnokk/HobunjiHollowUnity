// Makes the tool-driven hand orientation authoritative for the forearm.
// The hand pose decides forearm direction; that places the elbow. The bicep
// then simply connects the live shoulder to that elbow. This keeps wrist/hand
// rotation from twisting independently at the end of a differently-oriented
// forearm.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  if (!hands?.attach || hands.attach.__hobunjiForearmFollowWrapped) return;

  function quaternionFromDown(THREE, direction) {
    const dir = direction.clone();
    if (dir.lengthSq() < 1e-10) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
  }

  function orientRightChain(THREE, rig, targetLocal, handLocalQuaternion) {
    if (!rig?.group?.getObjectByName || !targetLocal || !handLocalQuaternion) return;
    const shoulder = rig.group.getObjectByName('right_shoulder');
    const upper = rig.group.getObjectByName('right_upper_arm');
    const forearm = rig.group.getObjectByName('right_forearm');
    const hand = rig.group.getObjectByName('right_hand_socket');
    if (!shoulder || !upper || !forearm || !hand) return;

    const forearmLength = Math.max(1e-6, Math.abs(Number(hand.position.y)) || 0);
    const forearmDown = new THREE.Vector3(0, -1, 0).applyQuaternion(handLocalQuaternion).normalize();
    const elbow = targetLocal.clone().addScaledVector(forearmDown, -forearmLength);
    const shoulderToElbow = elbow.clone().sub(shoulder.position);
    const bicepLength = Math.max(1e-6, shoulderToElbow.length());
    const upperWorldInRoot = quaternionFromDown(THREE, shoulderToElbow);

    upper.quaternion.copy(upperWorldInRoot);
    forearm.position.set(0, -bicepLength, 0);
    forearm.quaternion.copy(upperWorldInRoot.clone().invert().multiply(handLocalQuaternion));
    hand.position.set(0, -forearmLength, 0);
    // Forearm now owns the requested hand orientation, so the wrist itself
    // carries no extra compensating rotation.
    hand.quaternion.identity();

    upper.updateMatrix?.();
    forearm.updateMatrix?.();
    hand.updateMatrix?.();
    rig.group.updateMatrixWorld?.(true);
  }

  const originalAttach = hands.attach.bind(hands);
  hands.attach = function forearmFollowAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    if (!rig) return rig;

    const originalLocal = rig.followLocalTarget?.bind(rig);
    if (originalLocal) {
      rig.followLocalTarget = function forearmFollowLocalTarget(localTarget, localQuaternion) {
        const result = originalLocal(localTarget, localQuaternion);
        if (localQuaternion && result?.target) orientRightChain(THREE, rig, result.target, localQuaternion);
        return result;
      };
    }

    const originalWorld = rig.followWorldTarget?.bind(rig);
    if (originalWorld) {
      rig.followWorldTarget = function forearmFollowWorldTarget(worldTarget, worldQuaternion) {
        const result = originalWorld(worldTarget, worldQuaternion);
        if (!worldQuaternion || !result?.target || !rig.parent) return result;
        rig.parent.updateWorldMatrix?.(true, false);
        const targetLocal = result.target.clone();
        rig.parent.worldToLocal(targetLocal);
        const parentWorldQ = new THREE.Quaternion();
        rig.parent.getWorldQuaternion(parentWorldQ);
        const localQ = parentWorldQ.invert().multiply(worldQuaternion.clone());
        orientRightChain(THREE, rig, targetLocal, localQ);
        return result;
      };
    }

    const originalDebug = rig.getDebug?.bind(rig);
    if (originalDebug) {
      rig.getDebug = function forearmFollowDebug() {
        return { ...(originalDebug() || {}), forearmOrientationOwner: 'hand-pose' };
      };
    }
    return rig;
  };
  hands.attach.__hobunjiForearmFollowWrapped = true;
})(window);
