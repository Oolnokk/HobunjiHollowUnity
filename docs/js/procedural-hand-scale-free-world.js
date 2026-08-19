// Scale-free world/local quaternion bridge for procedural hands.
//
// Three.js getWorldQuaternion() decomposes matrixWorld. That is unsafe for the
// player rig because portrait/facing transforms can contain a negative scale;
// the reflection can be folded into the decomposed quaternion as a false 180°
// rotation. Positions still deliberately use matrixWorld so mirrored offsets
// remain correct. Rotations use only the Object3D quaternion hierarchy.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  if (!hands?.attach || hands.attach.__hobunjiScaleFreeWorldWrapped) return;

  const originalAttach = hands.attach.bind(hands);

  function hierarchyWorldQuaternion(THREE, node, target = new THREE.Quaternion()) {
    const chain = []; // Used below to compose local quaternions parent-first.
    for (let cursor = node; cursor?.isObject3D; cursor = cursor.parent) chain.push(cursor);
    target.identity();
    for (let i = chain.length - 1; i >= 0; i -= 1) target.multiply(chain[i].quaternion);
    return target.normalize();
  }

  function installScaleFreePlacement(THREE, rig) {
    const parent = rig?.parent;
    const handRoot = rig?.group;
    if (!parent?.isObject3D || !handRoot?.isObject3D || rig.__hobunjiScaleFreeWorldPlacement) return rig;

    const handRootWorldQuaternion = new THREE.Quaternion(); // Reused by placeHandWorld; includes the hand root's dead-zone counter-rotation.
    const localQuaternion = new THREE.Quaternion(); // Reused by placeHandWorld to convert the desired world orientation into hand-root-local space.

    rig.placeHandWorld = function scaleFreePlaceHandWorld(side, worldPosition, worldQuaternion) {
      const socket = handRoot.getObjectByName?.(`${side}_hand_socket`);
      if (!socket || !worldPosition || !worldQuaternion) return false;

      // Convert through the HAND ROOT, not merely its parent. The player hand root
      // now deliberately counter-rotates against the PNG billboard's perpClamp
      // dead zone. Converting only through playerMesh would apply that correction
      // a second time to tool-driven sockets and pull the hand away from the tool.
      // Using the full root matrix here guarantees an authored WORLD position stays
      // exactly that world position regardless of the root's anatomical-facing fix.
      handRoot.updateWorldMatrix?.(true, false);
      const localPosition = worldPosition.clone();
      handRoot.worldToLocal(localPosition);

      // Orientation uses the same root boundary for the same reason, but remains
      // scale/reflection-free: mirrored portrait scale must never become a false
      // 180-degree hand rotation.
      hierarchyWorldQuaternion(THREE, handRoot, handRootWorldQuaternion);
      localQuaternion.copy(handRootWorldQuaternion).invert().multiply(worldQuaternion).normalize();

      socket.position.copy(localPosition);
      socket.quaternion.copy(localQuaternion);
      socket.visible = true;
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
      return true;
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function scaleFreeHandDebug() {
      return {
        ...(originalDebug?.() || {}),
        worldQuaternionBasis: 'scale-free-hand-root-hierarchy',
        worldPlacementBoundary: 'procedural-hand-root',
      };
    };

    Object.defineProperty(rig, '__hobunjiScaleFreeWorldPlacement', { value: true, configurable: true });
    return rig;
  }

  const wrappedAttach = function scaleFreeHandAttach(THREE, parent, options = {}) {
    return installScaleFreePlacement(THREE, originalAttach(THREE, parent, options));
  };
  wrappedAttach.__hobunjiScaleFreeWorldWrapped = true;
  hands.attach = wrappedAttach;

  global.ProceduralHandScaleFreeWorld = Object.freeze({
    mode: 'scale-free-hand-root-quaternion-hierarchy',
  });
})(window);