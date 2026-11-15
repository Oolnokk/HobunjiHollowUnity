(() => {
  'use strict';

  // Correct the artwork's authored business-end axis, not its grip coordinates.
  // Most sprites have a +Y tip; torch.png has its flaming end at -Y.
  // Traverse the full hierarchy because signed scales can reverse either tip.
  let scratch = null; // Reused direction, quaternion and ancestor storage for every rendered idle frame.
  let scratchThree = null; // Rebuild scratch only if an editor supplies a different THREE instance.
  function workspace(THREE) {
    if (!scratch || scratchThree !== THREE) {
      scratchThree = THREE;
      scratch = {
        imageUp: new THREE.Vector3(), parentUp: new THREE.Vector3(),
        inverseRotation: new THREE.Quaternion(), correction: new THREE.Quaternion(),
        ancestors: [],
      };
    }
    return scratch;
  }

  function validNode(node) {
    const scale = node?.scale;
    return !!node?.quaternion && !!scale
      && Number.isFinite(scale.x) && Number.isFinite(scale.y) && Number.isFinite(scale.z)
      && scale.x !== 0 && scale.y !== 0 && scale.z !== 0;
  }

  function apply(holder, plane, THREE, localTipYSign = 1) {
    if (!holder?.quaternion || !plane || !THREE) return false;
    const work = workspace(THREE);
    const imageUp = work.imageUp.set(0, localTipYSign === -1 ? -1 : 1, 0); // Torch supplies -Y; keep the generic +Y default for other sprites.
    let node = plane;
    let reachedHolder = false; // Reject stale visuals that are no longer parented beneath the active tool holder.
    while (node && node !== holder.parent) {
      if (node === holder) reachedHolder = true;
      if (!validNode(node)) return false;
      imageUp.multiply(node.scale).applyQuaternion(node.quaternion);
      node = node.parent;
    }
    if (!reachedHolder || node !== holder.parent || imageUp.lengthSq() < 1e-12) return false; // Only correct the plane actually held by this holder.

    // Express world up in the holder parent's coordinates. Invert both
    // rotations and signed scales so mirrored character rigs stay correct.
    const parentUp = work.parentUp.set(0, 1, 0);
    const ancestors = work.ancestors;
    ancestors.length = 0;
    for (node = holder.parent; node; node = node.parent) {
      if (!validNode(node)) return false;
      ancestors.push(node);
    }
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const ancestor = ancestors[i];
      parentUp.applyQuaternion(work.inverseRotation.copy(ancestor.quaternion).invert());
      parentUp.x /= ancestor.scale.x;
      parentUp.y /= ancestor.scale.y;
      parentUp.z /= ancestor.scale.z;
    }
    if (parentUp.lengthSq() < 1e-12) return false;
    holder.quaternion.premultiply(work.correction.setFromUnitVectors(imageUp.normalize(), parentUp.normalize()));
    return true;
  }

  window.ToolWorldUpright = Object.freeze({ apply });
})();
