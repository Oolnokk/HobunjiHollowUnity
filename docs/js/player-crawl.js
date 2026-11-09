// Procedural left-side lean crawl for the downed player (js/player-downed.js).
//
// The body lies propped on its LEFT side with its head toward the direction of
// travel. The left arm reaches ahead along the ground and pulls the rig toward
// it while the legs trail behind and kick away. Everything is a render-time
// delta on the existing rig, so the camera keeps full control of the neck and
// the weapon:
//   * PlayerBodyTransformComposer 'crawl' channel: absolute body yaw (so the
//     reach axis points along the crawl heading) + a roll about the body's own
//     forward axis (a roll never changes where a weapon points) + lowering.
//     The channel is player-only; the equipped tool gets a translation-only
//     'crawl-weapon' channel so the weapon follows the lowered shoulder while its
//     aim stays on the camera ray.
//   * Left hand: a free-hand pose provider (HobunjiFreeHandPose) read by the
//     procedural hand frame driver. The right hand keeps holding the weapon.
//   * Legs: procedural thigh/calf poses written with applyRecordedLegPose from
//     the game's leg update site (the normal gait solve is skipped while active).
//
// The arm cycle borrows the Overhead Punch ("sky punch") dance arm
// (social-action-dance-runtime.js applyHandLayer): the hand sits at most two
// resting arm lengths above its hang (anatomical reach), snaps up with a
// sin^0.45 rise, tilts ~20° at full extension and sits slightly back there.
// Here that becomes reach -> grab (planted, fist tilt) -> pull (body slides).
//
// Movement is pull-driven: speed follows the arm-pull part of a cycle, so the
// body only advances along the reach axis. Input pointing outside the reach
// cone cannot be crawled directly; the body pivots toward it first (a 180° input
// is a u-turn) and then moves.
(() => {
  'use strict';

  const CFG = Object.freeze({
    rollDeg: 68,            // Lean onto the left side; the head ends up propped slightly above the ground.
    lowerY: -0.2,           // Body lowering at full blend (model units); keeps the propped flank on the ground.
    cycleSeconds: 0.8,      // One reach + grab + pull.
    strideTiles: 0.45,      // Ground covered per pull; ~ the hand's travel in arm lengths ((reach - pull) * arm length ~0.26 tiles) so the planted hand does not slip.
    grabEnd: 0.08,          // Cycle share [0, grabEnd): hand planted at full reach, fingers clench, the body has not started moving.
    pullEnd: 0.62,          // [grabEnd, pullEnd): the pull; the remainder is the reach swing.
    coneDeg: 55,            // Input within this of the reach axis is crawlable; wider inputs pivot first.
    steerDegPerS: 150,      // Heading follow rate inside the cone.
    pivotDegPerS: 130,      // Pivot rate outside the cone (a 180° u-turn takes ~1.4 s).
    blendInS: 0.35,
    blendOutS: 0.3,
    weaponShift: 0.2,       // Tool holder shift toward the heading while leaning (the top shoulder moves toward the head).
    weaponDropY: -0.16,     // ...and down with the lowered shoulder.
    // Left arm pose, relative to the idle hang, in resting ARM LENGTHS (the dance's unit): 2.0 is the dance punch's full overhead extension.
    armReach: 2.0, armPull: 0.3,
    armGroundX: 0.1, armLiftX: -0.07, // Sideways offsets in model heights: toward the ground while planted, away from it during the reach swing.
    armTiltDeg: -20,        // Hand tilt at full reach (the dance's rotateX(-0.35)).
    armBackZ: 0.045, armForwardZ: -0.01, // Dance z shift in model heights: slightly forward while cocked, slightly back at full reach.
    // Leg angles (degrees about the leg-local X axis; negative thigh = knee toward the belly side).
    // The kick runs over the pull window (tucked at grab, straight at the end of the pull).
    topLeg: { tuckThigh: -62, tuckCalf: 100, kickThigh: -12, kickCalf: 8, restThigh: -22, restCalf: 25 },
    bottomLeg: { tuckThigh: -38, tuckCalf: 40, kickThigh: -14, kickCalf: 8, restThigh: -16, restCalf: 15 },
    bottomLegPhaseOffset: 0.45,
  });

  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => (1 - Math.cos(Math.PI * clamp01(t))) / 2;

  let deps = null; // { TILE, getBaseYaw, getPlayerMesh }
  let active = false; // True while the player is downed and crawling.
  let blend = 0; // 0 = standing, 1 = full crawl pose.
  let heading = 0; // Map angle (x east, y south) of the reach axis = direction the head points.
  let phase = 0; // 0..1 through the pull/recover cycle.
  let activity = 0; // Smoothed 0..1 share of full crawl animation (drive or pivot).
  let driving = false; // Moving this frame.
  let pivoting = false; // Turning in place toward an input outside the cone.
  let inputDelta = 0; // Signed angle from the heading to the last input.
  let channelsLive = false; // Whether the composer currently holds our channels.
  let legLength = 0.188408; // Recorded thigh/calf length; refreshed from the impact clip when loaded.
  let held = null; // Diagnostic freeze { phase, activity } set by debugHoldPhase.

  const handPose = { position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 }, overridden: true }; // Reused every frame.
  const legRecord = { thighQuaternion: { x: 0, y: 0, z: 0, w: 1 }, calfLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 }, upperLength: 0, lowerLength: 0, roll: 0 };

  function init(injected) {
    deps = injected;
    const registry = (window.HobunjiFreeHandPose ||= { providers: new Map() });
    registry.providers.set('crawl', leftHandPose);
  }

  function setActive(on) {
    if (!deps) return;
    if (on && !active) {
      heading = -(Number(deps.getBaseYaw?.()) || 0); // rotation.y = -heading, so the body does not snap when the lean begins.
      phase = 0;
      activity = 0;
    }
    active = !!on;
  }

  function isActive() { return active || blend > 0.001; }
  function isCrawling() { return active; }

  // Pull profile: normalized so a full cycle advances exactly one stride.
  function pullSpeedUnit(p) {
    const span = CFG.pullEnd - CFG.grabEnd;
    return p >= CFG.grabEnd && p < CFG.pullEnd ? (Math.PI / (2 * span)) * Math.sin(Math.PI * (p - CFG.grabEnd) / span) : 0;
  }

  // Called from updateMovement with this frame's world-space input vector
  // (map axes, unit length). Returns world velocity in px/s.
  const velocity = { vx: 0, vy: 0 };
  function step(dt, ix, iy, inputStrength, terrainMul = 1) {
    velocity.vx = 0; velocity.vy = 0;
    driving = false; pivoting = false;
    if (!active || !deps) return velocity;
    if (held) { phase = held.phase; activity = held.activity; return velocity; }
    const hasInput = inputStrength > 0.05 && (ix !== 0 || iy !== 0);
    let align = 0;
    if (hasInput) {
      inputDelta = wrap(Math.atan2(iy, ix) - heading);
      const cone = CFG.coneDeg * DEG;
      const inCone = Math.abs(inputDelta) <= cone;
      const rate = (inCone ? CFG.steerDegPerS : CFG.pivotDegPerS) * DEG * dt;
      const turn = Math.max(-rate, Math.min(rate, inputDelta));
      heading = wrap(heading + turn);
      const remaining = wrap(Math.atan2(iy, ix) - heading);
      align = clamp01((Math.cos(remaining) - Math.cos(cone)) / (1 - Math.cos(cone)));
      driving = align > 0.02;
      pivoting = !driving;
    }
    const target = driving ? 0.35 + 0.65 * align * clamp01(inputStrength) : (pivoting ? 0.55 : 0);
    activity += (target - activity) * Math.min(1, dt * 8);
    if (activity > 0.01) phase = (phase + (dt / CFG.cycleSeconds) * activity) % 1;
    if (driving) {
      const speed = (CFG.strideTiles * deps.TILE / CFG.cycleSeconds) * pullSpeedUnit(phase) * align * clamp01(inputStrength) * terrainMul;
      velocity.vx = Math.cos(heading) * speed;
      velocity.vy = Math.sin(heading) * speed;
    }
    return velocity;
  }

  // ── Left arm ──────────────────────────────────────────────────────
  function leftHandPose(parent, side, modelHeight, record) {
    if (side !== 'left' || blend <= 0.001 || !deps || parent !== deps.getPlayerMesh?.()) return null;
    const h = modelHeight || 0.9;
    const L = record?.rig?.armLengthForSide?.('left') || h * 0.29; // Same cached reach the dance uses.
    const { grabEnd, pullEnd } = CFG;
    let reachT, ground, tiltT; // reachT: 1 = full extension. ground: 1 = on the ground, 0 = lifted.
    if (phase < grabEnd) { // Grab: fully reached and planted, fist tightening.
      reachT = 1; ground = 1; tiltT = 1;
    } else if (phase < pullEnd) { // Pull: the hand stays put while the body slides toward it.
      const t = smooth((phase - grabEnd) / (pullEnd - grabEnd));
      reachT = 1 - t; ground = 1; tiltT = 1 - t;
    } else { // Reach: lift off and snap forward with the dance punch's sin^0.45 rise.
      const u = (phase - pullEnd) / (1 - pullEnd);
      reachT = Math.pow(Math.max(0, Math.sin(Math.PI / 2 * u)), 0.45);
      ground = 1 - Math.sin(Math.PI * u);
      tiltT = reachT;
    }
    const restT = 0.78; // A resting crawler keeps the arm out ahead.
    const k = clamp01(activity * 1.6);
    reachT = lerp(restT, reachT, k); ground = lerp(1, ground, k); tiltT = lerp(0.5, tiltT, k);
    const y = L * lerp(CFG.armPull, CFG.armReach, reachT);
    const x = lerp(CFG.armLiftX, CFG.armGroundX, ground) * h;
    const z = (CFG.armBackZ + (CFG.armForwardZ - CFG.armBackZ) * reachT) * h;
    const b = blend;
    handPose.position.x = x * b;
    handPose.position.y = y * b;
    handPose.position.z = z * b;
    handPose.rotationDeg.pitch = CFG.armTiltDeg * tiltT * b;
    handPose.rotationDeg.yaw = 0;
    handPose.rotationDeg.roll = 0;
    return handPose;
  }

  // ── Legs ──────────────────────────────────────────────────────────
  function quaternionAboutX(target, angleRad) {
    target.x = Math.sin(angleRad / 2); target.y = 0; target.z = 0; target.w = Math.cos(angleRad / 2);
  }

  function legAngles(profile, p, amp) {
    let t; // 0 = fully tucked, 1 = fully kicked out.
    if (p < CFG.grabEnd) t = 0;
    else if (p < CFG.pullEnd) t = smooth((p - CFG.grabEnd) / (CFG.pullEnd - CFG.grabEnd));
    else t = 1 - smooth((p - CFG.pullEnd) / (1 - CFG.pullEnd));
    return {
      thigh: lerp(profile.restThigh, lerp(profile.tuckThigh, profile.kickThigh, t), amp),
      calf: lerp(profile.restCalf, lerp(profile.tuckCalf, profile.kickCalf, t), amp),
    };
  }

  function applyLegs(legs) {
    if (!legs?.applyRecordedLegPose || !isActive()) return false;
    const clip = window.ImpactBlendLibrary?.getClip?.('breakThrow', 'front');
    const recorded = clip?.frames?.[0]?.ragdoll?.ik?.left?.upperLength;
    if (recorded > 0) legLength = recorded;
    const amp = clamp01(activity * 1.4) * blend;
    const top = legAngles(CFG.topLeg, phase, amp);
    const bottom = legAngles(CFG.bottomLeg, (phase + CFG.bottomLegPhaseOffset) % 1, amp);
    const sides = { right: top, left: bottom }; // Right leg is on top and does the kicking; the left trails underneath.
    for (const side of ['left', 'right']) {
      const angles = sides[side];
      quaternionAboutX(legRecord.thighQuaternion, angles.thigh * DEG * blend);
      quaternionAboutX(legRecord.calfLocalQuaternion, angles.calf * DEG * blend);
      legRecord.upperLength = legLength; legRecord.lowerLength = legLength;
      legs.applyRecordedLegPose(side, legRecord);
    }
    legs.pants?.update?.();
    return true;
  }

  // ── Body + weapon channels ────────────────────────────────────────
  function publishChannels(dt) {
    const composer = window.PlayerBodyTransformComposer;
    if (!composer) return;
    const b = blend;
    const baseYaw = Number(deps.getBaseYaw?.()) || 0;
    const bodyYaw = baseYaw + wrap(-heading - baseYaw) * b; // Blends from the ordinary facing into the reach-axis yaw.
    const bob = Math.sin(phase * TAU * 2) * 0.012 * activity;
    const sway = Math.sin(phase * TAU) * 3 * DEG * activity;
    composer.setChannel('crawl', {
      priority: 95,
      mode: 'override',
      absoluteYaw: bodyYaw,
      rotation: { pitch: sway * b, yaw: 0, roll: -CFG.rollDeg * DEG * b }, // Roll about the forward axis: negative = onto the character's left.
      translation: { x: 0, y: (CFG.lowerY + bob) * b, z: 0 },
      includeExternal: false, // The tool holder follows the separate translation-only channel below.
    });
    composer.setChannel('crawl-weapon', {
      priority: 95,
      space: 'world',
      includePlayer: false,
      excludeExternalProviders: ['shoulderPets'],
      translation: {
        x: Math.cos(heading) * CFG.weaponShift * b,
        y: (CFG.weaponDropY + bob) * b,
        z: Math.sin(heading) * CFG.weaponShift * b,
      },
    });
    channelsLive = true;
  }

  function clearChannels() {
    if (!channelsLive) return;
    window.PlayerBodyTransformComposer?.clearChannel('crawl');
    window.PlayerBodyTransformComposer?.clearChannel('crawl-weapon');
    channelsLive = false;
  }

  // Once per un-paused frame.
  function update(dt) {
    if (!deps) return;
    const rate = active ? 1 / CFG.blendInS : -1 / CFG.blendOutS;
    blend = clamp01(blend + rate * dt);
    if (!active) {
      activity += (0 - activity) * Math.min(1, dt * 8);
      driving = false; pivoting = false;
    }
    if (held) { phase = held.phase; activity = held.activity; }
    if (blend <= 0.001 && !active) { blend = 0; clearChannels(); return; }
    publishChannels(dt);
  }

  window.PlayerCrawl = Object.freeze({
    CONFIG: CFG,
    init,
    setActive,
    isActive,
    isCrawling,
    step,
    update,
    applyLegs,
    heading: () => heading,
    // Test/diagnostic hook: freezes the animation at a cycle phase (0..1) so poses can be inspected as stills.
    debugHoldPhase: (p, act = 1) => {
      held = p == null ? null : { phase: ((Number(p) || 0) % 1 + 1) % 1, activity: clamp01(act) };
      if (held) { phase = held.phase; activity = held.activity; }
    },
    debugSnapshot: () => ({ active, blend, headingDeg: heading / DEG, phase, activity, driving, pivoting, inputDeltaDeg: inputDelta / DEG, channelsLive }),
  });
})();
