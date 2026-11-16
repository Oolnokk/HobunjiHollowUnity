// Non-destructive shoulder carrier for Animation Author → Rig Coordinates → shoulderGrip.
// NPC portraits face local +Z (animal side-view planes face local +X).
// Preserve their ordinary fixed world orientation. Camera orbit must not
// billboard this unselectable carrier or change where its shoulder is pinned.
(function (global) {
  'use strict';

  function placeNpcAtGrip({ THREE, root, visualOffset, shoulderPerch, creatureGrip }) {
    if (!THREE?.Matrix4 || !THREE?.Quaternion || !THREE?.Vector3
        || !root || !visualOffset || !shoulderPerch || !creatureGrip) return false;
    const multiplier = Number(shoulderPerch.scale?.x); // Authored species/gender shoulder-pet multiplier; used to scale the temporary NPC inversely.
    if (!Number.isFinite(multiplier) || multiplier <= 0) return false;

    creatureGrip.updateWorldMatrix(true, false); // The pet's fixed world contact position includes its authored Small-size scaling.
    visualOffset.updateMatrix(); // Live NPC species/gender portrait scale; it must remain independent of the pet's Small size.
    shoulderPerch.updateMatrix(); // The existing gameplay shoulder socket, including its YXZ rotation and offset.

    const localPerchMatrix = new THREE.Matrix4().multiplyMatrices(visualOffset.matrix, shoulderPerch.matrix);
    const localPosition = new THREE.Vector3(); // NPC-local shoulder position after applying visual-offset scale.
    localPerchMatrix.decompose(localPosition, new THREE.Quaternion(), new THREE.Vector3());

    const worldPosition = new THREE.Vector3(); // Authored Small pet's shoulder contact, independent of its grip-facing yaw.
    creatureGrip.matrixWorld.decompose(worldPosition, new THREE.Quaternion(), new THREE.Vector3());
    const frontFacing = new THREE.Quaternion(); // World +Z is the normal unrotated NPC portrait front; no camera-dependent facing.
    const reciprocal = 1 / multiplier; // Only the temporary NPC gets the inverse authored pet multiplier.
    worldPosition.sub(localPosition.multiplyScalar(reciprocal).applyQuaternion(frontFacing));
    const targetWorld = new THREE.Matrix4().compose(
      worldPosition, frontFacing, new THREE.Vector3(reciprocal, reciprocal, reciprocal),
    ); // Keep the shoulder pinned with a stable NPC facing, independent of camera and animal grip rotations.

    if (root.parent) {
      root.parent.updateWorldMatrix(true, false);
      targetWorld.premultiply(root.parent.matrixWorld.clone().invert());
    }
    root.matrixAutoUpdate = false; // Preserve the full parent-compensated matrix, including nonuniform parent transforms.
    root.matrix.copy(targetWorld);
    root.matrixWorldNeedsUpdate = true;
    root.updateMatrixWorld(true);
    return true;
  }

  global.AnimationAuthorRigCarrierPreview = Object.freeze({ placeNpcAtGrip });
})(window);
