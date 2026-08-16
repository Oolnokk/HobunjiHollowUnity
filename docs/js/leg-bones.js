// Pure 2-bone leg solver shared by the runtime procedural feet (see
// docs/js/procedural-leg-animation.js) and its reference authoring tool
// (docs/tools/procedural-animation-editor/index.html), so both build the
// exact same thigh/calf chain from the exact same math instead of keeping
// two hand-ported copies in sync.
//
// Given a fixed hip point and a live foot target (wherever the existing
// gait/idle-stance math says the foot should be right now), solves:
//   - knee = hip + thighLength * thighDirection, where thighLength is
//     always exactly half the hip-to-foot distance and thighDirection
//     defaults to straight-at-the-foot (so an unauthored leg is one
//     straight line from hip to foot — the knee just marks its midpoint).
//   - an optional authored bend (bendDegX/bendDegZ, degrees) rotates the
//     thigh away from that straight-line direction while keeping
//     thighLength fixed, so the knee swings off the line at a constant
//     radius from the hip — the one authorable degree of freedom.
//   - the calf is never authored directly: every frame it's re-aimed from
//     the (possibly bent) knee straight at the live foot target, with its
//     own length recomputed fresh each frame, so the foot mesh rigged to
//     its end always lands exactly on the foot target no matter how the
//     thigh is posed or how far the target has moved since last frame.
(function () {
  'use strict';

  const DOWN = Object.freeze({ x: 0, y: -1, z: 0 });

  // Builds the quaternion that rotates the fixed local "down" axis (0,-1,0)
  // to point along `dir` (must already be normalized). Falls back to the
  // identity rotation for a zero-length direction (coincident hip/foot or
  // knee/foot points) rather than producing a NaN quaternion.
  function quatFromDown(THREE, dir) {
    const down = new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z);
    if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z) || dir.lengthSq() < 1e-12) {
      return new THREE.Quaternion();
    }
    return new THREE.Quaternion().setFromUnitVectors(down, dir.clone().normalize());
  }

  // hip, foot: THREE.Vector3-like ({x,y,z}), in whatever shared local space
  // the caller builds its hip/thigh/calf hierarchy in (procedural-leg-
  // animation.js and the authoring tool both use the avatar's floor-
  // anchored root space). bendDegX/bendDegZ: authored thigh bend in
  // degrees, applied as a local rotation on top of the default
  // straight-at-the-foot orientation (sagittal/x = forward-back tilt,
  // lateral/z = side-to-side tilt) — both default to 0 (straight leg).
  //
  // Returns world-space `knee`, a `thighQuaternion` (world-space, since the
  // hip pivot itself never rotates) and `thighLength` for positioning/
  // orienting the thigh bone, plus a `calfLocalQuaternion` (relative to the
  // thigh, ready to assign directly to a calf Object3D parented under the
  // thigh) and `calfLength` for the calf bone and the foot mesh rigged to
  // its end.
  function solveTwoBoneLeg(THREE, { hip, foot, bendDegX = 0, bendDegZ = 0 } = {}) {
    const hipVec = new THREE.Vector3(hip?.x || 0, hip?.y || 0, hip?.z || 0);
    const footVec = new THREE.Vector3(foot?.x || 0, foot?.y || 0, foot?.z || 0);

    const hipToFoot = footVec.clone().sub(hipVec);
    const fullLength = hipToFoot.length();
    const thighLength = fullLength * 0.5;
    const straightDir = fullLength > 1e-6 ? hipToFoot.clone().normalize() : new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z);

    const defaultThighQuat = quatFromDown(THREE, straightDir);
    const bendQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(bendDegX || 0), 0, THREE.MathUtils.degToRad(bendDegZ || 0))
    );
    const thighQuaternion = defaultThighQuat.clone().multiply(bendQuat);

    const thighDirWorld = new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z).applyQuaternion(thighQuaternion);
    const knee = hipVec.clone().addScaledVector(thighDirWorld, thighLength);

    const kneeToFoot = footVec.clone().sub(knee);
    const calfLength = kneeToFoot.length();
    const calfDirWorld = calfLength > 1e-6 ? kneeToFoot.clone().normalize() : thighDirWorld.clone();
    const calfWorldQuaternion = quatFromDown(THREE, calfDirWorld);
    // calf is parented under thigh, so its own .quaternion is thigh-local —
    // undo the thigh's world rotation to get calf's rotation relative to it.
    const calfLocalQuaternion = thighQuaternion.clone().invert().multiply(calfWorldQuaternion);

    return { knee, thighQuaternion, thighLength, calfLocalQuaternion, calfLength };
  }

  window.LegBones = { solveTwoBoneLeg };
})();
