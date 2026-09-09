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

  // Reused across calls instead of allocated fresh each time: solveTwoBoneLeg
  // runs twice per character (left/right) every animation frame for every
  // walking character on screen (player, NPCs, hostiles), and every caller
  // (procedural-leg-animation.js's applyLegChain, the authoring tool) copies
  // the result's fields into its own long-lived objects synchronously before
  // this is called again, so nothing here needs to survive past one call.
  let _scratch = null;
  function scratchFor(THREE) {
    if (_scratch) return _scratch;
    _scratch = {
      hipVec: new THREE.Vector3(),
      footVec: new THREE.Vector3(),
      hipToFoot: new THREE.Vector3(),
      straightDir: new THREE.Vector3(),
      quatFromDownDown: new THREE.Vector3(),
      quatFromDownDir: new THREE.Vector3(),
      bendEuler: new THREE.Euler(),
      bendQuat: new THREE.Quaternion(),
      defaultThighQuat: new THREE.Quaternion(),
      thighDirWorld: new THREE.Vector3(),
      kneeToFoot: new THREE.Vector3(),
      calfDirWorld: new THREE.Vector3(),
      calfWorldQuaternion: new THREE.Quaternion(),
      result: {
        knee: new THREE.Vector3(),
        thighQuaternion: new THREE.Quaternion(),
        thighLength: 0,
        calfLocalQuaternion: new THREE.Quaternion(),
        calfLength: 0,
      },
    };
    return _scratch;
  }

  // Writes into `out` the quaternion that rotates the fixed local "down"
  // axis (0,-1,0) to point along `dir`, using `downScratch`/`dirScratch` as
  // caller-owned scratch space instead of allocating. Falls back to the
  // identity rotation for a zero-length/non-finite `dir` (coincident
  // hip/foot or knee/foot points) rather than producing a NaN quaternion.
  function quatFromDown(dir, out, downScratch, dirScratch) {
    if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z) || dir.lengthSq() < 1e-12) {
      return out.identity();
    }
    downScratch.set(DOWN.x, DOWN.y, DOWN.z);
    dirScratch.copy(dir).normalize();
    return out.setFromUnitVectors(downScratch, dirScratch);
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
  // its end. The returned object is reused across calls — copy its fields
  // out immediately, as every current caller already does.
  function solveTwoBoneLeg(THREE, { hip, foot, bendDegX = 0, bendDegZ = 0 } = {}) {
    const s = scratchFor(THREE);
    const hipVec = s.hipVec.set(hip?.x || 0, hip?.y || 0, hip?.z || 0);
    const footVec = s.footVec.set(foot?.x || 0, foot?.y || 0, foot?.z || 0);

    const hipToFoot = s.hipToFoot.copy(footVec).sub(hipVec);
    const fullLength = hipToFoot.length();
    const thighLength = fullLength * 0.5;
    const straightDir = fullLength > 1e-6
      ? s.straightDir.copy(hipToFoot).normalize()
      : s.straightDir.set(DOWN.x, DOWN.y, DOWN.z);

    const result = s.result;
    const defaultThighQuat = quatFromDown(straightDir, s.defaultThighQuat, s.quatFromDownDown, s.quatFromDownDir);
    s.bendEuler.set(THREE.MathUtils.degToRad(bendDegX || 0), 0, THREE.MathUtils.degToRad(bendDegZ || 0));
    const bendQuat = s.bendQuat.setFromEuler(s.bendEuler);
    const thighQuaternion = result.thighQuaternion.copy(defaultThighQuat).multiply(bendQuat);

    const thighDirWorld = s.thighDirWorld.set(DOWN.x, DOWN.y, DOWN.z).applyQuaternion(thighQuaternion);
    const knee = result.knee.copy(hipVec).addScaledVector(thighDirWorld, thighLength);

    const kneeToFoot = s.kneeToFoot.copy(footVec).sub(knee);
    const calfLength = kneeToFoot.length();
    const calfDirWorld = calfLength > 1e-6
      ? s.calfDirWorld.copy(kneeToFoot).normalize()
      : s.calfDirWorld.copy(thighDirWorld);
    const calfWorldQuaternion = quatFromDown(calfDirWorld, s.calfWorldQuaternion, s.quatFromDownDown, s.quatFromDownDir);
    // calf is parented under thigh, so its own .quaternion is thigh-local —
    // undo the thigh's world rotation to get calf's rotation relative to it.
    // Copied into the separate calfLocalQuaternion scratch (not inverted in
    // place) so result.thighQuaternion keeps its own world-space value.
    const calfLocalQuaternion = result.calfLocalQuaternion.copy(thighQuaternion).invert().multiply(calfWorldQuaternion);

    result.thighLength = thighLength;
    result.calfLength = calfLength;
    return result;
  }

  window.LegBones = { solveTwoBoneLeg };
})();
