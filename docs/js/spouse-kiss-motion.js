// Spouse kiss — shared height solver and in-world two-actor motion.
// The Multi-Avatar Animation Author consumes solveHeights/samplePose too, so its
// default kiss timeline has the same timing and body-sink percentages as gameplay.
(() => {
  'use strict';
  if (window.SpouseKissMotion) return;

  const DURATION_S = 2.4; // Used by the editor timeline and the live contact/exit sequence.
  const MOUTH_HEIGHT_FRACTION = .82; // Floor-relative portrait mouth proxy; scaled by actual rig height.
  const MAX_SINK_PCT = 82; // Upper safety cap; the actual knee limit is based on the leg rig, not this percent alone.
  const KNEEL_LEG_FRACTION = .95; // Spouse-only deep-kneel limit; regular stances retain their original 55%.
  const MAX_BOW_DEG = 89.5; // At extreme height ratios the larger spouse must nearly lie forward, without sinking below the floor.
  const MAX_DISTANCE = .95; // A deliberate close-range action; avoids sliding partners through distant obstacles.
  const SOURCE = 'spouse-kiss'; // Composer/input-claim ownership; never replaces other effect owners.
  const FACE_GAP_FRACTION = .023; // A visible sliver (roughly one tenth of a small face width), scaled to the shorter portrait, not literal inches.
  const COMFORTABLE_BOW_DEG = 35; // Couples prefer a supported, posterior-straddling hop over an extreme neck-to-waist bow.
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const ease = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
  let active = null; // Contains the locked pair until the 2.4-second interaction ends.
  let lastError = null; // Exposed through diagnostics for touch-only debugging.
  let lastResult = null; // Exposed through diagnostics after a completed or interrupted kiss.
  let schedulerInstalled = false; // Avoids duplicate pre-render callbacks on repeated init.

  function solveHeights(firstHeight, secondHeight, options = {}) {
    const first = Math.max(.001, finite(firstHeight, 1)); // Real rendered height of the first character.
    const second = Math.max(.001, finite(secondHeight, 1)); // Real rendered height of the second character.
    const taller = first >= second ? 'first' : 'second'; // Only the physically taller partner kneels and bows.
    const tall = Math.max(first, second);
    const short = Math.min(first, second);
    const firstMouth = clamp(finite(options.firstMouthHeightWorld, first * MOUTH_HEIGHT_FRACTION), .001, first * 1.4); // True lip height supplied by B'shuakauitl where available.
    const secondMouth = clamp(finite(options.secondMouthHeightWorld, second * MOUTH_HEIGHT_FRACTION), .001, second * 1.4); // Different species place their mouths differently.
    const tallMouth = taller === 'first' ? firstMouth : secondMouth;
    const shortMouth = taller === 'first' ? secondMouth : firstMouth;
    const hipHeight = clamp(finite(options.tallerHipHeightWorld, tall * .28), .001, tallMouth); // Ground-to-posterior height from the real leg handle.
    const legLength = Math.max(.001, finite(options.tallerLegLengthWorld, hipHeight)); // Anatomical leg length controls actual stance limits.
    const kneeLimit = Math.min(legLength * KNEEL_LEG_FRACTION, tall * MAX_SINK_PCT / 100);
    const mouthDrop = Math.max(0, tallMouth - shortMouth); // Full difference between the two skinned B'shuakauitl lip landmarks.
    const authoredMouthHeights = Number.isFinite(Number(options.firstMouthHeightWorld)) &&
      Number.isFinite(Number(options.secondMouthHeightWorld)); // Only real lip landmarks authorize the head-reach allowance.
    const headReachWorld = authoredMouthHeights ? Math.min(short * .18, mouthDrop * .4) : 0; // Let the real neck bones close a modest remainder so the tall spouse needn't bow excessively.
    const requestedDrop = Math.max(0, mouthDrop - headReachWorld);
    let kneeDrop = Math.min(requestedDrop, kneeLimit); // Ordinary couples keep the existing grounded kneel.
    const torsoLength = Math.max(.001, tallMouth - hipHeight);
    const maxBow = MAX_BOW_DEG * Math.PI / 180;
    let bowRad = Math.acos(clamp(1 - Math.max(0, requestedDrop - kneeDrop) / torsoLength, Math.cos(maxBow), 1));
    let shorterJumpWorld = 0; // A positive value lifts the shorter pelvis/mouth onto the taller partner's posterior.
    let shorterPosteriorGrip = false; // Used by the author and gameplay to own the same two independent foot targets.
    const shorterHip = clamp(finite(options.shorterHipHeightWorld, short * .28), .001, shortMouth); // Real short-partner pelvis where available.
    const shorterLeg = Math.max(.001, finite(options.shorterLegLengthWorld, shorterHip)); // Bounds physically possible hip-to-foot IK.
    const posteriorDifference = Math.max(0, hipHeight - shorterHip); // Target lift to put both pelvises at the same height.
    const straddleBowDrop = requestedDrop - posteriorDifference; // Bending closes the remaining difference between torso lengths.
    const straddleBow = Math.acos(clamp(1 - Math.max(0, straddleBowDrop) / torsoLength, Math.cos(maxBow), 1));
    const ratio = short / tall; // Avoid impossible giant-to-speck foot contact; the original deep bow remains the fallback.
    if (ratio >= .27 && ratio < .72 && bowRad > COMFORTABLE_BOW_DEG * Math.PI / 180 &&
        posteriorDifference > .02 * tall && straddleBowDrop >= 0 &&
        straddleBowDrop <= torsoLength * (1 - Math.cos(maxBow))) {
      // Raising the smaller character's pelvis to the larger posterior makes
      // both feet capable of straddling that landmark while the tall torso
      // bends down just enough to align the mouths. Kneeling reduces jump height.
      const supportingKnee = Math.min(kneeLimit,
        Math.max(posteriorDifference * .40, posteriorDifference - short * .75)); // Keeps a hop below 75% of the shorter avatar's height.
      const proposedJump = posteriorDifference - supportingKnee;
      if (proposedJump > Math.max(.015, short * .035) &&
          proposedJump <= short * .75 + .00001 && shorterLeg > .03 * tall) {
        kneeDrop = supportingKnee;
        bowRad = straddleBow;
        shorterJumpWorld = proposedJump;
        shorterPosteriorGrip = true;
      }
    }
    // A species may be only modestly shorter overall yet have a much LOWER authored mouth.
    // When the true B'shuakauitl lip heights demand an excessive bow, try a
    // physically bounded posterior hop even if the ordinary height ratio is > .72.
    const authoredMouths = Number.isFinite(Number(options.firstMouthHeightWorld)) &&
      Number.isFinite(Number(options.secondMouthHeightWorld)); // Only the accurately measured face landmarks enable this extra choreography.
    if (!shorterPosteriorGrip && authoredMouths && short / tall >= .27 &&
        shortMouth / tallMouth < .72 && posteriorDifference >= 0 &&
        bowRad > COMFORTABLE_BOW_DEG * Math.PI / 180) {
      const supportedKnee = Math.min(kneeLimit, requestedDrop * .62); // Use the actual stance range before lifting the small partner.
      const comfortableDrop = torsoLength * (1 - Math.cos(25 * Math.PI / 180)); // Prefer a kneel plus mild bow to a near-horizontal torso.
      const neededHop = Math.max(0, requestedDrop - supportedKnee - comfortableDrop);
      const supportedHop = Math.min(short * .75, Math.max(0,
        posteriorDifference - supportedKnee + shorterLeg * .94)); // Smaller hips may rise above the big posterior only while both legs can still reach back to it.
      const lift = Math.min(neededHop, supportedHop);
      const residual = Math.max(0, requestedDrop - supportedKnee - lift);
      if (lift > Math.max(.015, short * .035) &&
          residual <= torsoLength * (1 - Math.cos(maxBow))) {
        kneeDrop = supportedKnee;
        shorterJumpWorld = lift;
        shorterPosteriorGrip = true;
        bowRad = Math.acos(clamp(1 - residual / torsoLength, Math.cos(maxBow), 1));
      }
    }
    const bowDrop = torsoLength * (1 - Math.cos(bowRad));
    const remainingGap = Math.max(0, requestedDrop - kneeDrop - bowDrop - shorterJumpWorld);
    return {
      taller, firstHeight: first, secondHeight: second,
      firstMouthHeightWorld: firstMouth, secondMouthHeightWorld: secondMouth,
      headReachWorld, mouthDropWorld: mouthDrop, // Height solver leaves this bounded remainder to the shared skinned-head contact solver.
      mouthHeightRatio: MOUTH_HEIGHT_FRACTION,
      tallerSinkWorld: kneeDrop, tallerSinkPct: kneeDrop / tall * 100,
      shorterSinkPct: 0, tallerBowDeg: bowRad * 180 / Math.PI,
      tallerBowForwardWorld: torsoLength * Math.sin(bowRad),
      shorterJumpWorld, shorterPosteriorGrip, shorterLegLengthWorld: shorterLeg,
      shorterHipHeightWorld: shorterHip, tallerHipHeightWorld: hipHeight,
      jumpFootSpreadWorld: Math.min(shorterLeg * .36, short * .10, tall * .075), // Feet bracket the actual tall-posterior X coordinate.
      jumpFootForwardWorld: Math.min(shorterLeg * .15, short * .035), // Surface depth toward the partner's facing side.
      torsoLengthWorld: torsoLength, legLengthWorld: legLength,
      kneeLimitWorld: kneeLimit, remainingGap,
      pose: shorterPosteriorGrip ? 'posterior-hop' :
        bowRad > .72 ? 'deep-bow' : kneeDrop / tall > .18 ? 'deep-kneel' : kneeDrop > .001 ? 'crouch' : 'lean',
      contactPossible: remainingGap < Math.max(.025, short * .01),
    };
  }

  function samplePose(seconds) {
    const time = clamp(finite(seconds), 0, DURATION_S); // Shared editor/runtime timeline position.
    const blend = time <= .82 ? ease(time / .82) : time <= 1.52 ? 1 : ease((DURATION_S - time) / .88);
    return { time, durationS: DURATION_S, blend, touch: time >= 1.02 && time <= 1.52 };
  }

  function sampleJumpBlend(seconds) {
    const time = clamp(finite(seconds), 0, DURATION_S); // Normal-sized partners never use this pose, even though its timeline exists.
    if (time <= .52 || time >= 2.25) return 0;
    if (time < 1.02) return ease((time - .52) / .50); // Take off after the earlier shoulder grip and while the partner kneels.
    if (time <= 1.52) return 1; // Both feet straddle the posterior during mouth contact.
    return ease((2.25 - time) / .73); // Descend and recover the ordinary grounded stance.
  }

  function posteriorStraddleFootTargets(THREE, tallerLegs, shorterLegs, solution, jumpBlend, scratch = null) {
    if (!THREE?.Vector3 || !tallerLegs?.group?.localToWorld || !shorterLegs?.group?.localToWorld ||
        !solution?.shorterPosteriorGrip || jumpBlend <= 0) return null;
    const temp = scratch || {}; // Reusable world-space vectors prevent GC during gameplay's pre-render callback.
    const tallStance = tallerLegs.getRestStance?.();
    const shortStance = shorterLegs.getRestStance?.();
    if (!tallStance?.left?.hip || !tallStance?.right?.hip ||
        !shortStance?.left?.ankle || !shortStance?.right?.ankle) return null;
    const pelvisX = (tallStance.left.hip.x + tallStance.right.hip.x) / 2; // Authored posterior center between the tall rig's hip pivots.
    const posteriorHalfWidth = Math.max(.001, Math.abs(tallStance.left.hip.x - pelvisX),
      Math.abs(tallStance.right.hip.x - pelvisX)); // Bounded lateral placement on the taller character's genuine posterior, not an imaginary infinite platform.
    const kneeDrop = tallerLegs.getStanceDrop?.() || 0;
    const hipY = (Number(tallStance.left.hip.y) + Number(tallStance.right.hip.y)) / 2; // Actual authored posterior bone coordinate in the existing leg group.
    const pelvisLocalY = (Number.isFinite(hipY) ? hipY : tallerLegs.standingPosteriorY - kneeDrop)
      + (Number.isFinite(Number(temp.posteriorLocalOffsetY)) ? Number(temp.posteriorLocalOffsetY) : 0);
    // Gameplay NPCs lower their entire rig root while knees fold, so bone
    // coordinates already track the posterior. The author lowers only its
    // portrait; it supplies an extra -kneeDrop preview offset explicitly.
    tallerLegs.group.updateWorldMatrix?.(true, false);
    shorterLegs.group.updateWorldMatrix?.(true, false);
    const composerLift = !!temp.composerLift; // Gameplay player composer applies the leap only during render; editor/NPC roots move immediately.
    const out = temp.targets || (temp.targets = { left: new THREE.Vector3(), right: new THREE.Vector3() });
    for (const side of ['left', 'right']) {
      const grip = temp[side + 'Grip'] || (temp[side + 'Grip'] = new THREE.Vector3()); // Posterior-straddle target in the larger rig's anatomical frame.
      const ground = temp[side + 'Ground'] || (temp[side + 'Ground'] = new THREE.Vector3()); // Ground foot at this actor's current horizontal approach position.
      const otherSide = side === 'left' ? 1 : -1; // Fallback for minimal legacy or test-only leg handles without world-coordinate support.
      const shortHip = shortStance[side].hip;
      const projectedHip = temp[side + 'HipProjected'] || (temp[side + 'HipProjected'] = new THREE.Vector3()); // Real short-partner hip in the tall posterior's own frame.
      let localFootX = pelvisX + otherSide * solution.jumpFootSpreadWorld;
      if (shortHip && typeof tallerLegs.group.worldToLocal === 'function') {
        projectedHip.set(shortHip.x, shortHip.y, shortHip.z);
        shorterLegs.group.localToWorld(projectedHip);
        tallerLegs.group.worldToLocal(projectedHip);
        const lateral = projectedHip.x - pelvisX; // Same-side contact prevents crossing legs and exceeding the short character's lateral reach.
        const tallScale = tallerLegs.group.getWorldScale?.(temp.tallWorldScale || (temp.tallWorldScale = new THREE.Vector3(1,1,1)));
        const scaleX = Math.max(.001, Math.abs(tallScale?.x || 1));
        const minimumSpread = solution.jumpFootSpreadWorld / scaleX;
        const spread = Math.min(posteriorHalfWidth, Math.max(minimumSpread, Math.abs(lateral)));
        localFootX = pelvisX + Math.sign(lateral || otherSide) * spread; // Feet bracket the posterior, matching short hip sockets whenever feasible.
      }
      grip.set(localFootX, pelvisLocalY, solution.jumpFootForwardWorld);
      tallerLegs.group.localToWorld(grip);
      const ankle = shortStance[side].ankle;
      ground.set(ankle.x, ankle.y, ankle.z);
      shorterLegs.group.localToWorld(ground);
      // NPC/editor roots already follow their jumping pelvis: the idle ankle
      // must start at its CURRENT airborne position, not be pulled down to the
      // old ground. Otherwise both calves overstretch during release.
      out[side].copy(ground).lerp(grip, jumpBlend); // Interpolate from a body-relative dangling foot into genuine posterior contact.
      if (composerLift) out[side].y -= solution.shorterJumpWorld * jumpBlend; // Player composer applies its own lift only inside render; countertranslate the temporary IK target.
      if (jumpBlend < .999 && shortStance[side]?.hip) {
        // During takeoff/landing the ankle is still IN FLIGHT, so it must not
        // be forced to follow a straight line through an unreachable point.
        // Retract that interim target towards the real hip; at complete
        // contact the posterior target is retained exactly (and validated).
        const hip = shortStance[side].hip;
        const hipWorld = temp[side + 'HipWorld'] || (temp[side + 'HipWorld'] = new THREE.Vector3());
        hipWorld.set(hip.x, hip.y, hip.z);
        shorterLegs.group.localToWorld(hipWorld);
        const shortScale = shorterLegs.group.getWorldScale?.(
          temp.shortScale || (temp.shortScale = new THREE.Vector3(1,1,1))
        );
        const span = Math.abs((Number(hip.y) || 0) - (Number(ankle.y) || 0));
        const maxReach = Math.max(.001, span * Math.max(.001, Math.abs(shortScale?.y || 1)) * .995);
        const distance = out[side].distanceTo(hipWorld);
        if (distance > maxReach) out[side].sub(hipWorld).multiplyScalar(maxReach / distance).add(hipWorld); // Actual two-bone knees remain shorter than their authored length.
      }
    }
    return out;
  }

  // Used by both the author and live kiss to separate the early hand gesture
  // from the taller partner's knee bend when the initiator is shorter.
  function sampleKneelBlend(seconds, initiatorShorter = false) {
    const pose = samplePose(seconds); // Same contact and release windows as the existing lip animation.
    if (!initiatorShorter) return pose.blend;
    const lowering = ease((pose.time - .52) / .30); // Hands reach at .14–.36 s; the taller partner begins kneeling only after .52 s.
    return Math.min(lowering, pose.time <= 1.52 ? 1 : pose.blend);
  }

  function sampleInitiatorHandReach(seconds, initiatorShorter, shoulderDistance, armReach) {
    const pose = samplePose(seconds); // Time drives the gesture deterministically while scrubbing either direction.
    const distance = Math.max(0, finite(shoulderDistance, Infinity));
    const reach = Math.max(.001, finite(armReach, .001));
    const released = pose.time > 1.52 ? ease((DURATION_S - pose.time) / .48) : 1;
    const early = ease((pose.time - .13) / .24); // Short initiator extends hands before the taller one bends.
    const reachable = distance <= reach; // Tall initiator waits until torso lowering brings the other shoulders within actual reach.
    const tallBlend = reachable ? ease((reach - distance) / Math.max(.008, reach * .07)) : 0;
    const grip = (initiatorShorter ? early : tallBlend) * released; // Tall initiators move hands on the first reachable frame as their torso lowers.
    return { blend: clamp(grip, 0, 1), reachable, closestDistance: Math.max(0, distance - reach) };
  }

  function resolveShoulderGripWorld(sourceShoulderWorld, targetShoulderWorld, reachWorld, output, torsoVector = null) {
    if (!sourceShoulderWorld?.isVector3 || !targetShoulderWorld?.isVector3 || !output?.isVector3) return false;
    const distance = sourceShoulderWorld.distanceTo(targetShoulderWorld);
    const limit = Math.max(.001, finite(reachWorld, .001)) * .98; // Reserve elbow bend and forbid overextension beyond the species/gender arm length.
    output.copy(targetShoulderWorld);
    if (distance <= limit) return { targetDistance: distance, armReach: limit, exactShoulder: true, onTorso: false };
    if (torsoVector?.isVector3 && torsoVector.lengthSq() > 1e-8) {
      // An initiator too short for the shoulder may rest the hands on the
      // highest reachable point DOWN THE PARTNER'S ACTUAL UPPER TORSO.
      // Intersect the arm-reach sphere with the shoulder-to-chest segment,
      // never float a wrist at the edge of an imaginary spherical guide.
      const dx = targetShoulderWorld.x - sourceShoulderWorld.x;
      const dy = targetShoulderWorld.y - sourceShoulderWorld.y;
      const dz = targetShoulderWorld.z - sourceShoulderWorld.z;
      const a = torsoVector.lengthSq();
      const b = 2 * (dx * torsoVector.x + dy * torsoVector.y + dz * torsoVector.z);
      const c = distance * distance - limit * limit;
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const t = (-b - Math.sqrt(discriminant)) / (2 * a);
        if (t >= 0 && t <= 1) {
          output.addScaledVector(torsoVector, t);
          return { targetDistance: distance, armReach: limit, exactShoulder: false, onTorso: true,
            shoulderOffsetWorld: Math.sqrt(a) * t };
        }
      }
    }
    output.sub(sourceShoulderWorld).multiplyScalar(limit / distance).add(sourceShoulderWorld);
    return { targetDistance: distance, armReach: limit, exactShoulder: false, onTorso: false };
  }

  function shoulderGripWorld(rig, side, output, attachment = null, rebase = false) {
    if (!rig?.shoulderPositionLocal || !rig.parent?.localToWorld || !output) return false;
    rig.parent.updateWorldMatrix?.(true, false);
    const local = rig.shoulderPositionLocal(side, output);
    if (!local) return false;
    rig.parent.localToWorld(output);
    const torso = rig.avatarRoot; // Actual portrait/torso transform, not the separate floor-relative procedural hand parent.
    if (attachment?.local?.isVector3 && torso?.worldToLocal && torso?.localToWorld && torso !== rig.parent) {
      torso.updateWorldMatrix?.(true, false);
      if (!attachment.valid || rebase) {
        attachment.local.copy(output);
        torso.worldToLocal(attachment.local); // Capture authored shoulder once in the torso's neutral frame.
        attachment.valid = true;
      }
      torso.localToWorld(output.copy(attachment.local)); // Follow knee lowering and bow without sliding whole roots sideways.
    }
    return true;
  }

  function applyInitiatorShoulderHands(initiatorRig, targetRig, time, initiatorShorter, scratch = null) {
    const THREE = scratch?.THREE || window.THREE; // Animation Author loads Three as a module; gameplay exposes window.THREE.
    if (!THREE?.Vector3 || !THREE?.Quaternion || !initiatorRig?.placeHandWorld ||
        !initiatorRig?.armLengthForSide || !targetRig?.shoulderPositionLocal) return { applied: false, reason: 'hand-rigs-not-ready' };
    const geometry = scratch || {}; // Caller can reuse a fixed two-hand scratch structure across render frames.
    const scale = initiatorRig.parent.getWorldScale(geometry.scale || (geometry.scale = new THREE.Vector3()));
    const worldScale = Math.max(.001, Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)));
    let applied = 0; // Number of hands successfully solved this frame; reported by mobile diagnostics.
    let closestGap = 0; // Largest unavailable exact-shoulder distance after anatomical reach clamping.
    let surfaceContacts = 0; // Counts nearest reachable upper-torso surfaces rather than floating arm reach boundaries.
    let minGrip = 1; // Paired hand engagement for the author/readout.
    let exactContacts = 0; // Counts true shoulder coordinates rather than closest reachable upper-torso placements.
    let maxWristReach = 0; // Farthest final wrist distance from its own shoulder, used to detect overextension.
    let unreachableSurfaces = 0; // Counts hand targets that cannot be reached even along the partner's torso.
    let targetShoulderY = 0; // Dynamic shoulder Y; browser tests detect a static grip during kneeling.
    let gripY = 0; // Dynamic wrist target Y from the moving shoulder and anatomy clamp.
    let sampledShoulders = 0; // Denominator for partial/late-loading hand rigs.
    initiatorRig.useIdlePose?.(); // Reset both hands ONCE, or the right-hand solve would undo the left-hand shoulder grip.
    const torsoVector = geometry.torsoVector || (geometry.torsoVector = new THREE.Vector3());
    const torsoQuaternion = geometry.torsoQuaternion || (geometry.torsoQuaternion = new THREE.Quaternion());
    const torsoScale = targetRig.parent.getWorldScale(geometry.torsoScale || (geometry.torsoScale = new THREE.Vector3()));
    const torsoLength = Math.max(.01, finite(targetRig.avatarRoot?.userData?.portraitModelHeight, 1) *
      Math.abs(torsoScale.y) * .38); // Upper-shoulder-to-chest fallback, never the pelvis or legs.
    (targetRig.avatarRoot || targetRig.parent).getWorldQuaternion(torsoQuaternion);
    torsoVector.set(0, -torsoLength, 0).applyQuaternion(torsoQuaternion); // Follow the bent recipient portrait, not the upright floor-relative hand parent.
    for (const side of ['left', 'right']) {
      const other = side === 'left' ? 'right' : 'left'; // Face-to-face actors put opposite anatomical hands at the visible shoulders.
      const data = geometry[side] || (geometry[side] = {
        source: new THREE.Vector3(), target: new THREE.Vector3(), grip: new THREE.Vector3(),
        idle: new THREE.Vector3(), orientation: new THREE.Quaternion(),
        sourceAttachment: { local: new THREE.Vector3(), valid: false }, // Initiator shoulders move with their torso.
        targetAttachment: { local: new THREE.Vector3(), valid: false }, // Grip points move with the kneeling recipient's torso.
      }); // Reused world-space shoulder and hand vectors for each side.
      if (!shoulderGripWorld(initiatorRig, side, data.source, data.sourceAttachment, time <= .001) ||
          !shoulderGripWorld(targetRig, other, data.target, data.targetAttachment, time <= .001)) continue;
      targetShoulderY += data.target.y;
      sampledShoulders++;
      const reach = Math.max(.001, finite(initiatorRig.armLengthForSide(side), .001)) * worldScale;
      const result = resolveShoulderGripWorld(data.source, data.target, reach, data.grip,
        initiatorShorter ? torsoVector : null); // Short initiators reach nearest upper-body surface; tall initiators wait for true shoulders.
      if (!result) continue;
      // A short initiator can touch a reachable chest/upper-torso point before
      // the taller spouse kneels. If no real surface intersects the arm's reach,
      // wait rather than planting a hand in midair at the reach sphere's edge.
      const surfaceReachable = result.exactShoulder || result.onTorso; // Only anatomical contact points count as a planted hand.
      const gesture = sampleInitiatorHandReach(time, initiatorShorter, result.targetDistance, result.armReach);
      if (!surfaceReachable) {
        gesture.blend = 0;
        unreachableSurfaces++;
      }
      const socket = initiatorRig.group?.getObjectByName?.(side + '_hand_socket');
      if (!socket) continue;
      socket.getWorldPosition(data.idle);
      socket.getWorldQuaternion(data.orientation);
      data.grip.lerpVectors(data.idle, data.grip, gesture.blend);
      gripY += data.grip.y; // Measured position that the existing hand socket will receive.
      if (gesture.blend > 0) {
        initiatorRig.placeHandWorld(side, data.grip, data.orientation);
        applied++;
        if (result.exactShoulder) exactContacts++;
        if (result.onTorso) surfaceContacts++;
        maxWristReach = Math.max(maxWristReach, data.source.distanceTo(data.grip));
      }
      closestGap = Math.max(closestGap, result.targetDistance - result.armReach);
      minGrip = Math.min(minGrip, gesture.blend);
    }
    return { applied: applied === 2, hands: applied, blend: applied ? minGrip : 0, closestGap,
      torsoContacts: surfaceContacts, exactShoulderContacts: exactContacts,
      maxWristReach, unreachableSurfaces,
      targetShoulderY: sampledShoulders ? targetShoulderY / sampledShoulders : null,
      gripY: sampledShoulders ? gripY / sampledShoulders : null }; // Hand targets must descend with the taller torso.
  }

  function mouthHeightWorld(model, floorPoint, THREE = window.THREE) {
    const pose = window.SharedAttackPose; // Reuse the game's B'shuakauitl per-species mouth coordinate resolver.
    if (!THREE?.Vector3 || !pose?.createHeadFrame || !pose?.headFrame || !model || !floorPoint) return null;
    const frame = pose.createHeadFrame(THREE); // Measured once at preflight rather than allocating in the frame loop.
    model.updateWorldMatrix?.(true, true);
    if (!pose.headFrame(frame, model)) return null;
    const height = frame.position.y - floorPoint.y;
    return Number.isFinite(height) && height > .001 ? height : null;
  }

  function syncMouthContact(first, second, seconds, scratch = null) {
    const data = scratch || {}; // Reuse original joint positions and live mouth frames across animation ticks and timeline scrubs.
    if (data.firstJoint?.position && data.firstRest) data.firstJoint.position.copy(data.firstRest);
    if (data.secondJoint?.position && data.secondRest) data.secondJoint.position.copy(data.secondRest);
    const THREE = data.THREE || window.THREE;
    const pose = window.SharedAttackPose; // Same skinned-pixel landmarks used to align B'shuakauitl to the mouth.
    const firstJoint = first?.userData?.neckRig?.neckJoint;
    const secondJoint = second?.userData?.neckRig?.neckJoint;
    if (!first || !second || !THREE?.Vector3 || !pose?.createHeadFrame || !pose?.headFrame ||
        !firstJoint?.parent || !secondJoint?.parent) {
      return { contact: false, distance: null, reason: 'authored-mouth-rigs-not-ready' };
    }
    if (data.firstJoint !== firstJoint || data.secondJoint !== secondJoint) {
      data.firstJoint = firstJoint;
      data.secondJoint = secondJoint;
      data.firstRest = firstJoint.position.clone(); // Captured neutral head attachment, never a cumulative neck translation.
      data.secondRest = secondJoint.position.clone();
      data.firstFrame = pose.createHeadFrame(THREE);
      data.secondFrame = pose.createHeadFrame(THREE);
      data.firstWorld = new THREE.Vector3();
      data.secondWorld = new THREE.Vector3();
      data.localPoint = new THREE.Vector3();
      data.delta = new THREE.Vector3();
      data.firstScale = new THREE.Vector3();
      data.secondScale = new THREE.Vector3();
    }
    const time = clamp(finite(seconds), 0, DURATION_S);
    const blend = ease((time - .82) / .20) * ease((2.04 - time) / .52); // Only heads make the final approach after the knees have settled.
    first.updateWorldMatrix?.(true, true);
    second.updateWorldMatrix?.(true, true);
    if (!pose.headFrame(data.firstFrame, first) || !pose.headFrame(data.secondFrame, second)) {
      return { contact: false, distance: null, reason: 'authored-mouth-pixels-unavailable' };
    }
    data.delta.subVectors(data.secondFrame.position, data.firstFrame.position);
    const baselineGap = data.delta.length();
    const firstHeight = Math.max(.01, finite(first.userData?.portraitModelHeight, 1) *
      Math.abs(first.getWorldScale(data.firstScale).y));
    const secondHeight = Math.max(.01, finite(second.userData?.portraitModelHeight, 1) *
      Math.abs(second.getWorldScale(data.secondScale).y));
    const targetGap = clamp(Math.min(firstHeight, secondHeight) * FACE_GAP_FRACTION, .005, .035); // Small but visible opening between the actual mouth pixels.
    const gapTolerance = Math.max(.003, targetGap * .22); // Real bone-skin blend is approximate under extreme species scale.
    if (baselineGap <= 1e-7) {
      first.getWorldPosition(data.firstWorld);
      second.getWorldPosition(data.secondWorld);
      data.delta.subVectors(data.secondWorld, data.firstWorld);
      if (data.delta.lengthSq() <= 1e-10) data.delta.set(0, 0, 1); // Do not leave the faces touching even for coincident mouth pixels.
    }
    const signedTravel = baselineGap - targetGap; // Positive closes the kiss; negative separates already-overlapping faces.
    const requestedTravel = Math.abs(signedTravel);
    if (blend <= 0 || requestedTravel <= 1e-8) return {
      contact: blend >= .99 && Math.abs(baselineGap - targetGap) <= gapTolerance,
      distance: baselineGap, baselineGap, blend, targetGap, gapTolerance,
    };
    const firstLimit = firstHeight * .32; // Anatomical reach budget; actor root, feet, and posterior remain unmoved.
    const secondLimit = secondHeight * .32; // Larger partner can contribute a proportionally larger head reach.
    let firstTravel = Math.min(requestedTravel * .5, firstLimit);
    const secondTravel = Math.min(requestedTravel - firstTravel, secondLimit);
    firstTravel += Math.min(Math.max(0, requestedTravel - firstTravel - secondTravel),
      Math.max(0, firstLimit - firstTravel)); // Spend available neck travel before declaring the small gap unreachable.
    const directionSign = signedTravel >= 0 ? 1 : -1; // For overlapping faces, retract rather than aiming at zero distance.
    const moveJoint = (joint, travel, direction, worldPoint) => {
      if (!(travel > 0)) return;
      joint.getWorldPosition(worldPoint);
      joint.parent.updateWorldMatrix?.(true, false);
      worldPoint.addScaledVector(data.delta, direction * directionSign * travel / Math.max(1e-8, data.delta.length()) * blend);
      data.localPoint.copy(worldPoint);
      joint.parent.worldToLocal(data.localPoint); // Convert the world lip gap through its true bowed/scaled neck parent.
      joint.position.copy(data.localPoint); // The body, shoulders, posterior, feet, and exported actor root remain unmoved.
      joint.updateWorldMatrix?.(true, true);
    };
    moveJoint(firstJoint, firstTravel, 1, data.firstWorld);
    moveJoint(secondJoint, secondTravel, -1, data.secondWorld);
    first.updateWorldMatrix?.(true, true);
    second.updateWorldMatrix?.(true, true);
    if (!pose.headFrame(data.firstFrame, first) || !pose.headFrame(data.secondFrame, second)) {
      return { contact: false, distance: null, reason: 'lip-reprojection-failed' };
    }
    const distance = data.firstFrame.position.distanceTo(data.secondFrame.position);
    return { contact: blend > .99 && Math.abs(distance - targetGap) <= gapTolerance,
      distance, baselineGap, blend, targetGap, gapTolerance,
      reachLimited: firstTravel + secondTravel < requestedTravel - gapTolerance,
      firstHeadMove: firstTravel * blend, secondHeadMove: secondTravel * blend };
  }

  function isWithinRig(node, root) {
    for (let child = node; child; child = child.parent) if (child === root) return true;
    return false;
  }

  function livePlayerPortrait(player) {
    // Festival dance receives the player portrait separately from the body/legs
    // root. The compositor returns only that OUTER root, whose userData is not
    // the character's skinned head/hand rig.
    const direct = window.WorldPortraitLife?.getPlayerAvatar?.()?.group;
    if (direct?.userData?.neckRig?.available && direct.userData?.proceduralHandRig &&
        isWithinRig(direct, player)) return direct; // Require both live festival-style pose owners, not a half-loaded portrait.
    let result = null; // Active player portrait used for all paired grips, lips and torso motion.
    player?.traverse?.(model => {
      if (!model?.userData?.neckRig?.available || !model.userData?.proceduralHandRig) return;
      if (!result || (model.visible !== false && result.visible === false)) result = model;
    });
    return result || (player?.userData?.neckRig?.available ? player : null);
  }

  function poseLivePlayer(session, drop, bow, lift, retreat) {
    const body = session.player; // Festival-style live pose ownership replaces the render-only composer delta.
    const rest = session.originalPlayerPosition;
    body.position.x = rest.x - Math.sin(session.headingPlayer) * retreat;
    body.position.y = rest.y + lift;
    body.position.z = rest.z - Math.cos(session.headingPlayer) * retreat;
    const progress = samplePose(session.elapsed).blend;
    const yaw = session.originalPlayerYaw +
      Math.atan2(Math.sin(session.headingPlayer - session.originalPlayerYaw),
        Math.cos(session.headingPlayer - session.originalPlayerYaw)) * progress;
    if (body.quaternion?.setFromAxisAngle && session.yawAxis) {
      body.quaternion.setFromAxisAngle(session.yawAxis, yaw); // Festival-style absolute root orientation excludes equipped-tool torso yaw/roll.
    } else body.rotation.y = yaw; // Non-Three test rigs preserve the original Euler fallback.
    const torso = session.playerModel;
    if (torso !== body) {
      torso.position.y = session.originalPlayerModelY - drop;
      torso.rotation.x = session.originalPlayerModelPitch + bow;
    }
    const hands = session.playerHands;
    if (hands?.group && session.originalPlayerHands && !isWithinRig(hands.group, torso)) {
      hands.group.position.y = session.originalPlayerHands.y - drop;
      hands.group.rotation.x = session.originalPlayerHands.pitch + bow;
    }
    body.updateWorldMatrix?.(true, true); // Rebuild actual shoulder positions after kneeling, not a static hand-parent frame.
  }

  function aimPairedHead(neck, targetNeck, blend, scratch) {
    const THREE = window.THREE; // Canonical festival-dance head tracking: solve partner direction in the moving neck parent's frame.
    if (!THREE?.Vector3 || !neck?.parent?.worldToLocal || !neck?.getWorldPosition ||
        !targetNeck?.getWorldPosition) return false;
    const data = scratch || {}; // Session-local reusable vectors avoid allocating during each render pass.
    data.eye ||= new THREE.Vector3(); // Actual skinned head pivot instead of the camera-facing look vector.
    data.partner ||= new THREE.Vector3(); // Partner's current pivot already follows their kneeling torso.
    neck.getWorldPosition(data.eye);
    targetNeck.getWorldPosition(data.partner);
    neck.parent.updateWorldMatrix?.(true, false);
    neck.parent.worldToLocal(data.partner).sub(neck.parent.worldToLocal(data.eye));
    const yaw = Math.atan2(data.partner.x, data.partner.z);
    const pitch = -Math.atan2(data.partner.y, Math.max(.0001, Math.hypot(data.partner.x, data.partner.z)));
    neck.rotation.set(clamp(pitch, -.55, .55) * blend,
      clamp(yaw, -.66, .66) * blend, 0, 'XYZ'); // Head yaw and pitch are authored by the pair, never the tool/camera.
    return true;
  }

  function actorHeight(model, legs, root) {
    const local = Math.max(.05, finite(model?.userData?.portraitModelHeight, finite(legs?.modelHeight, 1))); // Render metadata includes species and gender proportions.
    const THREE = window.THREE;
    const visualRoot = model?.getWorldScale ? model : legs?.group?.getWorldScale ? legs.group : root; // NPC size scale lives below walker.root.
    const scale = THREE?.Vector3 && visualRoot?.getWorldScale ? visualRoot.getWorldScale(new THREE.Vector3()) : null;
    return local * Math.max(.01, Math.abs(finite(scale?.y, 1)));
  }

  function anatomyWorld(legs, fallbackHeight) {
    const T = window.THREE;
    const scale = T?.Vector3 && legs?.group?.getWorldScale ? legs.group.getWorldScale(new T.Vector3()) : null;
    const worldScale = Math.max(.01, Math.abs(finite(scale?.y, 1))); // Converts local procedural-leg lengths to world units.
    const records = legs?.motionAnatomy?.();
    const localLegLength = Array.isArray(records) && records.length
      ? Math.min(...records.map(record => Math.max(.001, finite(record.length, .001))))
      : Math.max(.001, finite(legs?.standingPosteriorY, fallbackHeight * .28)); // Only used while old rig handles finish attaching.
    const hip = Math.max(.001, finite(legs?.standingPosteriorY, localLegLength));
    return { legLengthWorld: localLegLength * worldScale, hipHeightWorld: hip * worldScale, worldScale };
  }

  function scenePoint(root) {
    const THREE = window.THREE;
    return root.getWorldPosition(new THREE.Vector3());
  }

  function clearMotion(reason) {
    const old = active;
    if (!old) return false;
    active = null;
    try {
      window.PlayerBodyTransformComposer?.clearChannel?.(SOURCE);
      window.PlayerBodyTransformComposer?.clearChannel?.(SOURCE + '-retreat');
      old.playerHands?.setPoseProvider?.(SOURCE, null);
      if (old.player?.parent === old.playerParent && old.originalPlayerPosition) {
        Object.assign(old.player.position, old.originalPlayerPosition); // Restore from festival-style temporary root hop/retreat.
        if (old.originalPlayerQuaternion && old.player.quaternion?.copy) {
          old.player.quaternion.copy(old.originalPlayerQuaternion); // Restore initial tool-independent root transform, including terrain pitch/roll.
        } else old.player.rotation.y = old.originalPlayerYaw;
      }
      if (old.playerModel && old.playerModel !== old.player) {
        old.playerModel.position.y = old.originalPlayerModelY;
        old.playerModel.rotation.x = old.originalPlayerModelPitch;
      }
      if (old.originalPlayerHands && old.playerHands?.group) {
        old.playerHands.group.position.y = old.originalPlayerHands.y;
        old.playerHands.group.rotation.x = old.originalPlayerHands.pitch;
      }
      old.playerHands?.useIdlePose?.(); // Restores held-tool/idle ownership instead of leaving wrists glued to the spouse's shoulders.
      old.playerLegs?.setExternalFootTargets?.(null); // Release externally planted posterior feet on cancel, spouse switch, or completion.
      old.npcLegs?.setExternalFootTargets?.(null);
      old.playerLegs?.setStanceDrop?.(0, true);
      if (old.npcSink && window.ActorBodySink?.apply) window.ActorBodySink.apply(old.npcSink, 0, 0, true);
      old.playerLegs?.setStanceDropLimitFraction?.(old.originalPlayerKneeLimit);
      old.npcLegs?.setStanceDropLimitFraction?.(old.originalNpcKneeLimit);
      if (old.npcTiltPivot?.rotation && Number.isFinite(old.originalNpcTiltX)) old.npcTiltPivot.rotation.x = old.originalNpcTiltX;
      if (old.walker?.root?.parent === old.npcParent) {
        old.walker.root.position.y = old.originalNpcPosition.y; // Restore world-floor elevation after the small partner's hop.
        old.walker.root.rotation.y = old.originalNpcYaw;
        old.walker.root.position.x = old.originalNpcPosition.x; // Restores the approach displacement, including early dodge.
        old.walker.root.position.z = old.originalNpcPosition.z;
      }
      if (old.npcNeck && old.originalNpcNeck) old.npcNeck.quaternion.copy(old.originalNpcNeck);
      if (old.playerNeck && old.originalPlayerNeck) old.playerNeck.quaternion.copy(old.originalPlayerNeck);
      if (old.playerNeck?.position && old.originalPlayerNeckPosition) old.playerNeck.position.copy(old.originalPlayerNeckPosition); // Remove residual lips-to-lips reach on exit.
      if (old.npcNeck?.position && old.originalNpcNeckPosition) old.npcNeck.position.copy(old.originalNpcNeckPosition);
    } finally {
      old.lock?.release?.();
      window.WorldActionInputClaims?.clearClaims?.(SOURCE);
    }
    lastResult = { reason, npcId: old.walker?.rec?.id || null, touched: old.touched, height: old.height, elapsedS: old.elapsed };
    return true;
  }

  function start(walker, onContact) {
    if (active) { lastError = 'already-kissing'; return false; }
    if (!walker?.rec?.id || !walker?.root?.parent || walker.root.visible === false) {
      lastError = 'spouse-unavailable'; return false;
    }
    if (window.CinematicCameraRuntime?.isActive?.() || window.FestivalWheelDanceRuntime?.isActive?.()) {
      lastError = 'another-paired-animation-active'; return false;
    }
    if (window.CharacterActionLocks?.isLocked?.('player', 'movement')) {
      lastError = 'player-busy'; return false;
    }
    const composer = window.PlayerBodyTransformComposer;
    const player = composer?.getPlayerMesh?.();
    const playerLegs = composer?.getPlayerLegHandle?.();
    const npcLegs = walker.legs;
    if (!window.THREE?.Vector3 || !window.ActorBodySink?.apply || !player?.parent ||
        !playerLegs?.setStanceDrop || !npcLegs?.setStanceDrop) {
      lastError = 'paired-rigs-not-ready'; return false;
    }
    player.updateWorldMatrix(true, false);
    walker.root.updateWorldMatrix(true, false);
    const playerPoint = scenePoint(player); // Actual player world position, not a tile rounded to the NPC grid.
    const npcPoint = scenePoint(walker.root);
    const dist = Math.hypot(playerPoint.x - npcPoint.x, playerPoint.z - npcPoint.z);
    if (dist > MAX_DISTANCE || Math.abs(playerPoint.y - npcPoint.y) > .5) {
      lastError = 'spouse-too-far-or-on-different-floor'; return false;
    }
    const npcRigRoot = walker.root.getObjectByName?.('npc_character_rig_root');
    if (!npcRigRoot) { lastError = 'spouse-body-rig-not-ready'; return false; }
    const playerModel = livePlayerPortrait(player); // Same character that FestivalWheelDanceRuntime captures through getPlayerModel().
    const playerHands = playerModel?.userData?.proceduralHandRig || null;
    const npcHands = walker.avatarGroup?.userData?.proceduralHandRig || null;
    const playerNeck = playerModel?.userData?.neckRig?.neckJoint || null;
    const npcNeck = walker.avatarGroup?.userData?.neckRig?.neckJoint || null;
    if (!playerModel || !playerHands?.setPoseProvider || !playerHands?.placeHandWorld ||
        !npcHands?.shoulderPositionLocal || !playerNeck || !npcNeck) {
      lastError = 'paired-player-portrait-hands-or-neck-not-ready';
      return false; // Never start a kiss where the actual player stands frozen.
    }
    const firstHeight = actorHeight(playerModel, playerLegs, player);
    const secondHeight = actorHeight(walker.avatarGroup, npcLegs, walker.root);
    const playerAnatomy = anatomyWorld(playerLegs, firstHeight);
    const npcAnatomy = anatomyWorld(npcLegs, secondHeight);
    const isPlayerTaller = firstHeight >= secondHeight;
    const tallAnatomy = isPlayerTaller ? playerAnatomy : npcAnatomy;
    const shortAnatomy = isPlayerTaller ? npcAnatomy : playerAnatomy; // Small partner's real hip height and leg length decide whether a supported jump is feasible.
    const height = solveHeights(firstHeight, secondHeight, {
      firstMouthHeightWorld: mouthHeightWorld(playerModel, playerPoint) || undefined, // Use the actual player mouth height, not a generic sprite ratio.
      secondMouthHeightWorld: mouthHeightWorld(walker.avatarGroup, npcPoint) || undefined, // Spouse species-specific lip height.
      tallerLegLengthWorld: tallAnatomy.legLengthWorld,
      tallerHipHeightWorld: tallAnatomy.hipHeightWorld,
      shorterLegLengthWorld: shortAnatomy.legLengthWorld,
      shorterHipHeightWorld: shortAnatomy.hipHeightWorld,
    });
    if (!height.contactPossible) { lastError = 'mouth-height-not-reachable'; return false; }
    const normalGap = .12 + Math.min(firstHeight, secondHeight) * .10; // Keep the established game spacing for couples standing on their own feet.
    const jumpGap = height.jumpFootForwardWorld + height.shorterLegLengthWorld * .18; // Supported posterior hops need the smaller pelvis close enough to reach both foot targets.
    const contactGap = Math.min(dist, height.shorterPosteriorGrip
      ? Math.min(normalGap, Math.max(.006, jumpGap)) : normalGap); // Only a mounted posterior contact approaches closer than the normal collision-safe kiss.
    const approach = Math.max(0, dist - contactGap); // Move only the spouse, so player collider and camera stay stable.
    const boundedBowRetreat = Math.min(height.tallerBowForwardWorld, Math.max(.04, shortAnatomy.legLengthWorld * .25)); // Preserve close enough shoulders for a real two-arm hold while bowing.
    const approachX = dist > .0001 ? (playerPoint.x - npcPoint.x) * approach / dist : 0;
    const approachZ = dist > .0001 ? (playerPoint.z - npcPoint.z) * approach / dist : 0;
    // A bow swings the mouth forward. The taller body needs room to retreat
    // instead of sweeping its head through walls or a second character.
    const tallerPoint = isPlayerTaller ? playerPoint : npcPoint;
    const retreatHeading = isPlayerTaller
      ? Math.atan2(npcPoint.x - playerPoint.x, npcPoint.z - playerPoint.z)
      : Math.atan2(playerPoint.x - npcPoint.x, playerPoint.z - npcPoint.z);
    const walkable = window.NpcPathfinding?.isNpcPositionWalkable;
    if (!height.shorterPosteriorGrip && height.tallerBowForwardWorld > .05 && typeof walkable === 'function' && walker.area) {
      const distance = height.tallerBowForwardWorld;
      const steps = Math.max(1, Math.ceil(distance / .3)); // One-time corridor clearance check, not a frame-loop path search.
      for (let i = 1; i <= steps; i++) {
        const length = distance * i / steps;
        if (walkable(walker.area, tallerPoint.x - Math.sin(retreatHeading) * length,
          tallerPoint.z - Math.cos(retreatHeading) * length) === false) {
          lastError = 'not-enough-clear-floor-for-deep-bow';
          return false;
        }
      }
    }

    const npcSink = { legs: npcLegs, lower: [{ obj: npcRigRoot, factor: () => npcRigRoot.scale?.y || 1 }] };
    const npcTiltPivot = walker._npcRunLeanPivot || (walker.avatarGroup?.parent?.name === 'npc_run_lean_visual'
      ? walker.avatarGroup.parent : walker.avatarGroup); // The existing portrait lean pivot keeps the legs out of the torso bow.
    if (height.taller === 'second' && height.tallerBowDeg > 1 && !npcTiltPivot?.rotation) {
      lastError = 'spouse-bow-rig-not-ready'; return false;
    }
    const lock = window.CharacterActionLocks?.acquire?.({
      owner: SOURCE, reason: 'Kissing spouse', timeoutMs: 20000, // The world lock outlives low-FPS playback; normal cleanup releases it in 2.4 simulation seconds.
      participants: [
        { id: 'player', channels: ['movement', 'tools', 'pose', 'facing', 'head'] }, // Festival dance pose ownership suppresses idle/combat overrides of the paired body pose.
        { id: window.NpcCharacterState?.participantId?.(walker.rec.id) || 'npc:' + walker.rec.id,
          channels: ['movement', 'tools', 'actions', 'pose', 'facing', 'head'] },
      ],
    });
    const originalPlayerKneeLimit = playerLegs.setStanceDropLimitFraction?.(KNEEL_LEG_FRACTION) ?? .55;
    const originalNpcKneeLimit = npcLegs.setStanceDropLimitFraction?.(KNEEL_LEG_FRACTION) ?? .55;
    active = {
      walker, player, playerModel, playerLegs, npcLegs, npcRigRoot, npcSink, composer,
      playerParent: player.parent, // A rebuild or scene switch invalidates this exact paired character.
      originalPlayerPosition: { x: player.position.x, y: player.position.y, z: player.position.z }, // Festival-style root staging restores this on exit.
      originalPlayerYaw: player.rotation.y, // Turn the live player to face the partner during the action.
      originalPlayerQuaternion: player.quaternion?.clone?.() || null, // Restore exact rooted facing after authored yaw, not an Euler approximation.
      originalPlayerModelY: playerModel.position.y, originalPlayerModelPitch: playerModel.rotation.x, // Preserve the skinned torso's neutral transform.
      originalPlayerHands: playerHands.group ? { y: playerHands.group.position.y, pitch: playerHands.group.rotation.x } : null, // GLB hands may live outside the portrait pivot.
      npcTiltPivot, originalNpcTiltX: npcTiltPivot?.rotation?.x,
      originalPlayerKneeLimit, originalNpcKneeLimit,
      playerAnatomy, npcAnatomy,
      playerHands, npcHands, shoulderScratch: {}, footScratch: {}, mouthScratch: {},
      playerGazeScratch: {}, npcGazeScratch: {}, // Reused head-frame vectors for camera-independent mutual gaze.
      lastLipContact: null, // Verified only after the final composed bodies and neck pivots reach the same frame.
      requireLipContact: !!window.SharedAttackPose?.headFrame, // Real rigs are required at start, even when isolated tests omit the pixel helper.
      lastHandContact: null, // Mobile diagnostics expose reach and timing without requiring DevTools.
      playerNeck, npcNeck,
      originalPlayerNeck: playerNeck?.quaternion?.clone?.() || null,
      originalNpcNeck: npcNeck?.quaternion?.clone?.() || null,
      originalPlayerNeckPosition: playerNeck?.position?.clone?.() || null, // Restore original head offsets on cancellation.
      originalNpcNeckPosition: npcNeck?.position?.clone?.() || null,
      originalNpcYaw: walker.root.rotation.y,
      npcParent: walker.root.parent, // Prevents scene transfers from restoring an obsolete local world position.
      characterId: window.__hobunjiPlayerProfile?.characterId || null, // Prevents a delayed contact from buffing the next selected character.
      originalNpcPosition: { x: walker.root.position.x, y: walker.root.position.y, z: walker.root.position.z },
      approachX, approachZ, height, lock, onContact, touched: false, elapsed: 0,
      // Tall torso bows forward around the posterior. The partner's feet retreat by
      // the head's horizontal reach so the two mouths remain in the same contact spot.
      bowRetreatWorld: boundedBowRetreat, // Do not withdraw the recipient's whole torso beyond the initiating arms' reach.
      yawAxis: new window.THREE.Vector3(0, 1, 0), // Cached world-up axis for a full-root, camera-independent festival-style facing.
      headingPlayer: Math.atan2(npcPoint.x - playerPoint.x, npcPoint.z - playerPoint.z),
      headingNpc: Math.atan2(playerPoint.x - npcPoint.x, playerPoint.z - npcPoint.z),
    };
    if (playerHands?.setPoseProvider && npcHands?.shoulderPositionLocal) {
      const session = active; // The live pose provider runs after the body compositor has placed the shoulders.
      playerHands.setPoseProvider(SOURCE, () => {
        if (active !== session) return;
        session.lastHandContact = applyInitiatorShoulderHands(
          session.playerHands, session.npcHands, session.elapsed,
          session.height.taller === 'second', session.shoulderScratch,
        );
        session.lastLipContact = syncMouthContact(session.playerModel, session.walker.avatarGroup,
          session.elapsed, session.mouthScratch); // Skinned lips follow the already-lowered/bowed bodies each rendered frame.
      }); // Render-time ownership keeps real GLB hand contact attached through final-frame sync.
    }
    lastError = null;
    window.WorldActionInputClaims?.setClaims?.(SOURCE, [
      { actionId: 'dodge', label: 'Stop kissing', priority: 600, onPress: () => clearMotion('canceled') },
    ]);
    return true;
  }

  function update(context = {}) {
    const session = active;
    if (!session) return;
    if (!session.player?.parent || session.player.parent !== session.playerParent ||
        livePlayerPortrait(session.player) !== session.playerModel ||
        session.playerModel?.userData?.proceduralHandRig !== session.playerHands ||
        session.walker?.root?.parent !== session.npcParent ||
        session.composer?.getPlayerMesh?.() !== session.player ||
        session.walker.legs !== session.npcLegs ||
        (window.__hobunjiPlayerProfile?.characterId || null) !== session.characterId ||
        (Number.isFinite(Number(window.Combat?.deps?.player?.health)) && Number(window.Combat.deps.player.health) <= 0) ||
        window.RomanceSystem?.getSpouse?.()?.npcId !== session.walker.rec.id) {
      clearMotion('partner-or-rig-changed');
      return;
    }
    session.elapsed += clamp(finite(context.deltaMs) / 1000, 0, .08);
    const pose = samplePose(session.elapsed);
    const playerIsTaller = session.height.taller === 'first';
    const kneeBlend = sampleKneelBlend(session.elapsed, session.height.taller === 'second'); // Shorter initiators reach for shoulders before the taller spouse kneels.
    const kneeWorld = session.height.tallerSinkWorld * kneeBlend; // Single world-space target shared by both possible taller actors.
    const jumpBlend = session.height.shorterPosteriorGrip ? sampleJumpBlend(session.elapsed) : 0; // Non-jumping couples remain exactly on their original ground.
    const shorterJump = session.height.shorterJumpWorld * jumpBlend; // Vertical lift takes the short partner up to the taller posterior.
    const playerLocalKnee = playerIsTaller ? kneeWorld / session.playerAnatomy.worldScale : 0;
    const npcLocalKnee = playerIsTaller ? 0 : kneeWorld / session.npcAnatomy.worldScale;
    const npcPct = npcLocalKnee / Math.max(.001, Number(session.npcLegs.modelHeight) || 0) * 100;

    // The ordinary player loop may mark leg gait "suppressed" under our pose lock,
    // which disallows setStanceDrop even with immediate=true. Festival dance
    // solves its own real leg handles after taking pose ownership. Refresh this
    // same live player leg handle in paired mode before applying our knee bend.
    session.playerLegs.update?.(0, 0, false, null);
    session.playerLegs.setStanceDrop(playerLocalKnee, true);
    const playerDrop = session.playerLegs.getStanceDrop?.() || 0;
    const playerBow = playerIsTaller ? session.height.tallerBowDeg * Math.PI / 180 * kneeBlend : .025 * pose.blend;
    const playerRetreat = playerIsTaller && !session.height.shorterPosteriorGrip
      ? session.bowRetreatWorld * kneeBlend : 0; // The actual actor moves rather than a temporary renderer-only copy.
    poseLivePlayer(session, playerDrop, playerBow, playerIsTaller ? 0 : shorterJump, playerRetreat);
    session.playerLegs.pants?.update?.(); // Real knees and pants inherit the matching torso pose.
    const npcDrop = window.ActorBodySink.apply(session.npcSink, npcPct, 0, true);
    if (session.npcTiltPivot?.rotation && Number.isFinite(session.originalNpcTiltX)) {
      session.npcTiltPivot.rotation.x = session.originalNpcTiltX +
        (playerIsTaller ? .025 * pose.blend : session.height.tallerBowDeg * Math.PI / 180 * kneeBlend);
    }
    const npcForward = playerIsTaller || session.height.shorterPosteriorGrip ? 0 : session.bowRetreatWorld; // Do not move a straddled posterior out from under the shorter spouse's feet.
    session.walker.root.position.y = session.originalNpcPosition.y + (playerIsTaller ? shorterJump : 0); // NPC jumps only if they are the shorter partner.
    session.walker.root.position.x = session.originalNpcPosition.x + session.approachX * pose.blend - Math.sin(session.headingNpc) * npcForward * kneeBlend;
    session.walker.root.position.z = session.originalNpcPosition.z + session.approachZ * pose.blend - Math.cos(session.headingNpc) * npcForward * kneeBlend;
    // No compositor retreat channel: the player pose lock intentionally excludes render-only contributions.
    const actualKneeWorld = playerIsTaller ? playerDrop * session.playerAnatomy.worldScale
      : npcDrop * session.npcAnatomy.worldScale;
    const expectedKneeWorld = kneeWorld;
    if (pose.blend > .8 && Math.abs(actualKneeWorld - expectedKneeWorld) > Math.max(.03, expectedKneeWorld * .09)) {
      lastError = 'actual-knee-limit-prevents-mouth-contact';
      clearMotion('knee-limit-mismatch');
      return;
    }
    session.walker.root.rotation.y = session.originalNpcYaw + 
      Math.atan2(Math.sin(session.headingNpc - session.originalNpcYaw), Math.cos(session.headingNpc - session.originalNpcYaw)) * pose.blend;
    aimPairedHead(session.playerNeck, session.npcNeck, pose.blend, session.playerGazeScratch);
    aimPairedHead(session.npcNeck, session.playerNeck, pose.blend, session.npcGazeScratch); // Mutual gaze follows each real torso; neither neck samples the camera.
    if (session.height.shorterPosteriorGrip) {
      const shortLegs = playerIsTaller ? session.npcLegs : session.playerLegs; // Feet that must straddle the taller posterior rather than step on the ground.
      const tallLegs = playerIsTaller ? session.playerLegs : session.npcLegs;
      session.footScratch.composerLift = false; // Festival-style live hop translates the real shorter-root and its leg group.
      const footTargets = posteriorStraddleFootTargets(window.THREE, tallLegs, shortLegs, session.height, jumpBlend, session.footScratch);
      shortLegs.setExternalFootTargets?.(footTargets, { allowDeepFold: true }); // Two real legs bend onto the taller partner's individual left/right pelvis landmarks.
      if (footTargets) shortLegs.applyWorldFootTargets?.(footTargets, null, false, true);
    }
    session.playerHands?.applyOwnedPose?.(); // Immediately drive the real GLB sockets, as festival dance drives both hand pairs.
    session.lastLipContact = syncMouthContact(session.playerModel, session.walker.avatarGroup,
      session.elapsed, session.mouthScratch); // Contact callback must not depend on a later hand-frame render hook.
    if (!session.touched && pose.touch &&
        (!session.requireLipContact || session.lastLipContact?.contact)) {
      session.touched = true;
      try { session.onContact?.(); }
      catch (error) { lastError = 'contact-callback: ' + (error?.message || error); }
    }
    if (session.elapsed >= DURATION_S) clearMotion('completed');
  }

  function init() {
    if (schedulerInstalled || !window.RuntimeFrameScheduler?.register) return false;
    window.RuntimeFrameScheduler.register(SOURCE, update, {
      phase: 'pre-render', owner: 'SpouseKissMotion',
      description: 'Locks a spouse pair, adapts kneeling, and allows shorter partners to hop onto real posterior foot anchors.',
    });
    schedulerInstalled = true;
    return true;
  }

  function diagnostics() {
    return { version: 3, active: !!active, lastError, lastResult,
      session: active ? { npcId: active.walker?.rec?.id, elapsedS: active.elapsed, touched: active.touched,
        height: { ...active.height }, jumpBlend: sampleJumpBlend(active.elapsed),
        feetAnchored: !!(active.playerLegs?.hasExternalFootTargets?.() || active.npcLegs?.hasExternalFootTargets?.()),
        hands: active.lastHandContact || null, lips: active.lastLipContact || null,
        playerPortrait: active.playerModel?.name || null, // Mobile proof the actual player portrait (not the outer group) received the action.
        playerPoseLocked: !!window.CharacterActionLocks?.isLocked?.('player', 'pose'),
        playerTorsoBowDeg: (active.playerModel.rotation.x - active.originalPlayerModelPitch) * 180 / Math.PI,
        playerKneeDrop: active.playerLegs?.getStanceDrop?.() || 0,
        playerHandRigReady: !!active.playerHands?.group } : null };
  }

  window.SpouseKissMotion = Object.freeze({
    DURATION_S, MAX_SINK_PCT, MOUTH_HEIGHT_FRACTION, KNEEL_LEG_FRACTION, MAX_BOW_DEG,
    solveHeights, samplePose, sampleJumpBlend, posteriorStraddleFootTargets,
    sampleKneelBlend, sampleInitiatorHandReach,
    resolveShoulderGripWorld, shoulderGripWorld, applyInitiatorShoulderHands,
    FACE_GAP_FRACTION, mouthHeightWorld, syncMouthContact, aimPairedHead, actorHeight, anatomyWorld, init, start, stop: clearMotion,
    isPartner: walker => !!active && active.walker === walker,
    diagnostics,
  });
})();
