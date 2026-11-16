// Non-destructive inverse-carrier placement for the Animation Author's shoulder-grip preview.
// The real Small creature and its grip are the fixed world-space reference;
// only a disposable, unselectable NPC comparison root is moved.
(function (global) {
  'use strict';

  function placeNpcAtGrip({ THREE, root, visualOffset, shoulderPerch, creatureGrip }) {
    if (!THREE?.Matrix4 || !root || !visualOffset || !shoulderPerch || !creatureGrip) return false;
    // Read the *actual* authored grip world transform after creature Small/plane scaling.
    creatureGrip.updateWorldMatrix(true, false);
    visualOffset.updateMatrix(); // Uses species/gender body calibration without writing it onto the animal.
    shoulderPerch.updateMatrix(); // Includes authored perch position, yaw/pitch/roll and uniform pet multiplier.
    const localPerch = new THREE.Matrix4().multiplyMatrices(visualOffset.matrix, shoulderPerch.matrix);
    const targetWorld = creatureGrip.matrixWorld.clone().multiply(localPerch.invert());
    // Root is a sibling of the editable creature, never its child: compensate for the workspace parent.
    if (root.parent) {
      root.parent.updateWorldMatrix(true, false);
      targetWorld.premultiply(root.parent.matrixWorld.clone().invert());
    }
    root.matrixAutoUpdate = false;
    root.matrix.copy(targetWorld); // Keep the full inverse matrix; decomposing would discard scale/shear.
    root.matrixWorldNeedsUpdate = true;
    root.updateMatrixWorld(true);
    return true;
  }

  global.AnimationAuthorRigCarrierPreview = Object.freeze({ placeNpcAtGrip });
})(window);
