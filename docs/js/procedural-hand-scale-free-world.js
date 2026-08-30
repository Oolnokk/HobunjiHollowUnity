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
    if (!parent?.isObject3D || rig.__hobunjiScaleFreeWorldPlacement) return rig;

    const parentWorldQuaternion = new THREE.Quaternion(); // Reused by placeHandWorld; avoids per-frame allocation for the parent basis.
    const localQuaternion = new THREE.Quaternion(); // Reused by placeHandWorld to convert the desired world orientation into parent-local space.

    rig.placeHandWorld = function scaleFreePlaceHandWorld(side, worldPosition, worldQuaternion) {
      const socket = rig.group?.getObjectByName?.(`${side}_hand_socket`);
      if (!socket || !worldPosition || !worldQuaternion) return false;

      // Position conversion intentionally keeps the real matrix hierarchy because
      // reflected scale must mirror attachment offsets just like the body artwork.
      parent.updateWorldMatrix?.(true, false);
      const localPosition = worldPosition.clone();
      parent.worldToLocal(localPosition);

      // Orientation conversion deliberately ignores scale/reflection. This is the
      // same convention used by PlayerBodyTransformComposer and WeaponToolStances.
      hierarchyWorldQuaternion(THREE, parent, parentWorldQuaternion);
      localQuaternion.copy(parentWorldQuaternion).invert().multiply(worldQuaternion).normalize();

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
        worldQuaternionBasis: 'scale-free-hierarchy',
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
    mode: 'scale-free-quaternion-hierarchy',
  });
})(window);
