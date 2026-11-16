// Non-destructive shoulder carrier for Animation Author → Rig Coordinates → shoulderGrip.
// The NPC uses the same neutral world-facing portrait orientation as the existing
// Rig Coordinates reference NPC. The pet's grip rotation belongs to the PET,
// not the owner; only the NPC's position and inverse perch size are solved.
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

    const worldPosition = new THREE.Vector3(); // Grip contact in world space; orientation is intentionally NOT inherited.
    creatureGrip.matrixWorld.decompose(worldPosition, new THREE.Quaternion(), new THREE.Vector3());
    const neutralFacing = new THREE.Quaternion(); // Identity world orientation exposes the NPC's front (+X) art, matching the normal reference NPC.
    const reciprocal = 1 / multiplier; // Only the temporary NPC gets the inverse authored pet multiplier.
    worldPosition.sub(localPosition.multiplyScalar(reciprocal).applyQuaternion(neutralFacing));
    const targetWorld = new THREE.Matrix4().compose(
      worldPosition, neutralFacing, new THREE.Vector3(reciprocal, reciprocal, reciprocal),
    ); // Move the NPC's real shoulder to the fixed grip, without forcing the NPC to inherit the animal's yaw.

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
