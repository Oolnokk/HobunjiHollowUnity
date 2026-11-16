// Non-destructive inverse carrier for Animation Author → Rig Coordinates → shoulderGrip.
// Only the temporary NPC moves. Creature Small-size scaling stays on the creature;
// the authored species/gender perch multiplier instead inversely scales the NPC.
(function (global) {
  'use strict';

  function placeNpcAtGrip({ THREE, root, visualOffset, shoulderPerch, creatureGrip }) {
    if (!THREE?.Matrix4 || !THREE?.Quaternion || !THREE?.Vector3
        || !root || !visualOffset || !shoulderPerch || !creatureGrip) return false;
    const multiplier = Number(shoulderPerch.scale?.x); // The authored uniform shoulder-pet scale, shown in the Rig Coordinates inspector.
    if (!Number.isFinite(multiplier) || multiplier <= 0) return false;

    creatureGrip.updateWorldMatrix(true, false); // Its position/orientation reflect Small creature sizing and the authored rotated grip.
    visualOffset.updateMatrix(); // Live species/gender body correction from the repository's rig calibration.
    shoulderPerch.updateMatrix(); // Exact YXZ perch position/rotation, not a guessed offset from the sprite center.

    const localPerchMatrix = new THREE.Matrix4().multiplyMatrices(visualOffset.matrix, shoulderPerch.matrix);
    const localPosition = new THREE.Vector3(); // Offset of the carrier's perch relative to its unscaled temporary NPC root.
    const localRotation = new THREE.Quaternion(); // Carrier's body and perch rotation combined, excluding scale.
    localPerchMatrix.decompose(localPosition, localRotation, new THREE.Vector3());

    const worldPosition = new THREE.Vector3(); // Fixed grip's current world position, including the effect of the pet's Small scaling.
    const worldRotation = new THREE.Quaternion(); // Grip's world facing; inverse local perch rotation produces the required NPC orientation.
    creatureGrip.matrixWorld.decompose(worldPosition, worldRotation, new THREE.Vector3());
    worldRotation.multiply(localRotation.invert());

    const reciprocal = 1 / multiplier; // Compare the fixed Small pet with the *same* result as scaling the pet by this multiplier.
    worldPosition.sub(localPosition.multiplyScalar(reciprocal).applyQuaternion(worldRotation));
    const targetWorld = new THREE.Matrix4().compose(
      worldPosition, worldRotation, new THREE.Vector3(reciprocal, reciprocal, reciprocal),
    ); // NPC size follows its own species/gender visualOffset × inverse perch multiplier, NOT the animal's Small scale.

    if (root.parent) {
      root.parent.updateWorldMatrix(true, false);
      targetWorld.premultiply(root.parent.matrixWorld.clone().invert());
    }
    root.matrixAutoUpdate = false; // Store the full parent-compensated matrix; decomposition would lose any parent shear.
    root.matrix.copy(targetWorld);
    root.matrixWorldNeedsUpdate = true;
    root.updateMatrixWorld(true);
    return true;
  }

  global.AnimationAuthorRigCarrierPreview = Object.freeze({ placeNpcAtGrip });
})(window);
