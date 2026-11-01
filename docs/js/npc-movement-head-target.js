// Invisible movement-only head target for humanoid NPCs and enemy actors.
// Camera/weapon targets still win during dialogue, authored poses and combat.
(() => {
  'use strict';

  const LOOK_AHEAD_TILES = 3; // Keeps the default eye line almost level even during a full running lean.
  const MOVE_EPSILON_TILES = 0.0005; // Rejects idle positional jitter without delaying real movement.
  const MAX_YAW_DEG = 70; // Used only by the NPC-walker gaze solver; authored dialogue/stations retain their own limits.
  const MAX_PITCH_DEG = 55; // Gives the running neck enough travel to counter the body's full forward lean.

  function targetAhead(root, dx, dz, eyeHeight) {
    const travel = Math.hypot(dx, dz); // Movement heading, not camera-relative billboard facing, points the invisible target forward.
    if (!root || !(travel > MOVE_EPSILON_TILES) || !Number.isFinite(eyeHeight)) return null;
    return {
      x: root.x + LOOK_AHEAD_TILES * dx / travel,
      y: root.y + eyeHeight,
      z: root.z + LOOK_AHEAD_TILES * dz / travel,
    };
  }

  function updateWalker(walker, oldX, oldZ, options = {}) {
    if (!walker?.neckJoint || walker.animalDef || !walker.root?.position) return false;
    if (walker._bedLieActive) { // Sleeping wins over walking gaze and any leftover look-at state.
      walker.neckJoint.rotation.set(0, 0, 0);
      walker._npcMotionLookActive = false;
      walker._ambientLookActive = false;
      walker._lookAtDebug = null;
      window.PerpRotation?.clearHeadtrackHint?.(walker.perpState);
      return true;
    }
    // Higher-priority actors own neck pose completely; never reset their transforms.
    if (options.hasScriptedGaze) { walker._npcMotionLookActive = false; return false; }
    if (walker.area !== options.currentArea || walker._npcLodFar) {
      // LOD/area changes must not strand the last movement gaze on a now-idle NPC.
      if (walker._npcMotionLookActive) {
        walker.neckJoint.rotation.set(0, 0, 0);
        walker._lookAtDebug = null;
        window.PerpRotation?.clearHeadtrackHint?.(walker.perpState);
      }
      walker._npcMotionLookActive = false;
      return false;
    }
    const position = walker.root.position;
    const dx = position.x - oldX, dz = position.z - oldZ;
    const moving = Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > MOVE_EPSILON_TILES;
    if (moving && typeof options.aimAtWorldPoint === 'function' && typeof options.makeWorldPoint === 'function') {
      const target = targetAhead(position, dx, dz, walker.avatarHeight * options.eyeHeightRatio);
      if (target) {
        const eye = options.getFaceWorld?.(walker); // Samples the already-leaning skinned head, not the upright root estimate.
        const succeeded = options.aimAtWorldPoint(walker, options.makeWorldPoint(target), eye);
        if (succeeded) {
          walker._ambientLookActive = false; // A station's old lookAt must stop owning the head as soon as travel resumes.
          walker._npcMotionLookActive = true;
          return true;
        }
      }
    }
    if (walker._npcMotionLookActive) {
      walker._npcMotionLookActive = false;
      if (!walker._ambientLookActive) { // An authored idle/station gaze applied this same tick takes precedence.
        walker.neckJoint.rotation.set(0, 0, 0);
        walker._lookAtDebug = null;
        window.PerpRotation?.clearHeadtrackHint?.(walker.perpState);
      }
    }
    return false;
  }

  function applyHostileRunPitch(avatar, lean, localHeading, undo) {
    // The hostile's run lean rotates its whole portrait parent in 3D. Each
    // front/back skin then has its own ±90° plane yaw: correcting only the
    // neck's X pitch misses the in-plane Z roll at many headings.
    const front = avatar?.neckJoint?.front;
    const back = avatar?.neckJoint?.back;
    const pitch = Number(lean);
    if (!front?.quaternion || !back?.quaternion || !Array.isArray(undo)
      || !Number.isFinite(pitch) || Math.abs(pitch) < 0.0001
      || !Number.isFinite(localHeading)) return false;
    const frontYaw = Number(avatar.frontPlane?.rotation?.y);
    const backYaw = Number(avatar.backPlane?.rotation?.y);
    if (!Number.isFinite(frontYaw) || !Number.isFinite(backYaw)) return false;
    const oldFront = front.quaternion.clone(); // Restore pre-render combat yaw and authored head pose exactly.
    const oldBack = back.quaternion.clone(); // Distinct back-skin quaternion; never mirror by reusing the front transform.
    const sinHalf = -Math.sin(pitch * 0.5); // Inverse of the run-lean quaternion, expressed per portrait card.
    const cosHalf = Math.cos(pitch * 0.5); // Both front/back use the same lean magnitude.
    const frontRelative = localHeading - frontYaw; // Transforms the world-forward tilt axis into the front neck's local frame.
    const backRelative = localHeading - backYaw; // Back plane points the other way, so its Z correction reverses sign.
    front.quaternion.set(Math.cos(frontRelative) * sinHalf, 0, -Math.sin(frontRelative) * sinHalf, cosHalf).multiply(oldFront);
    back.quaternion.set(Math.cos(backRelative) * sinHalf, 0, -Math.sin(backRelative) * sinHalf, cosHalf).multiply(oldBack);
    undo.push(() => {
      front.quaternion.copy(oldFront);
      back.quaternion.copy(oldBack);
    });
    return true;
  }

  window.NpcMovementHeadTarget = Object.freeze({
    targetAhead,
    updateWalker,
    applyHostileRunPitch,
    getDebug: () => ({ lookAheadTiles: LOOK_AHEAD_TILES, movementThresholdTiles: MOVE_EPSILON_TILES, maxYawDeg: MAX_YAW_DEG, maxPitchDeg: MAX_PITCH_DEG }),
    MAX_YAW_DEG,
    MAX_PITCH_DEG,
  });
})();
