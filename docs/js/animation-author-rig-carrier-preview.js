// Non-destructive shoulder carrier for Animation Author → Rig Coordinates → shoulderGrip.
// NPC portraits face local +Z (animal side-view planes face local +X).
// Unlike a normal tool NPC, this unselectable carrier does not go through the
// viewport-facing loop. Explicitly aim its FRONT portrait at the viewport camera,
// preserving the pet's fixed grip and species/gender shoulder offset.
(function (global) {
  'use strict';

  function placeNpcAtGrip({ THREE, root, visualOffset, shoulderPerch, creatureGrip, camera }) {
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
    const cameraDX = Number(camera?.position?.x) - worldPosition.x; // Relative X from the fixed grip to the viewport camera.
    const cameraDZ = Number(camera?.position?.z) - worldPosition.z; // Relative Z from the fixed grip to the viewport camera.
    const faceYaw = Number.isFinite(cameraDX) && Number.isFinite(cameraDZ) && Math.hypot(cameraDX, cameraDZ) > 0.00001
      ? Math.atan2(cameraDX, cameraDZ) : 0; // NPC front normals face +Z, unlike the animal's +X portrait convention.
    const frontFacing = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), faceYaw,
    ); // Shows the same front canvas as an ordinary tool NPC even after camera orbit; never mirrors the image.
    const reciprocal = 1 / multiplier; // Only the temporary NPC gets the inverse authored pet multiplier.
    worldPosition.sub(localPosition.multiplyScalar(reciprocal).applyQuaternion(frontFacing));
    const targetWorld = new THREE.Matrix4().compose(
      worldPosition, frontFacing, new THREE.Vector3(reciprocal, reciprocal, reciprocal),
    ); // Re-pin shoulder position after portrait yaw; the pet's authored grip remains untouched.

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
