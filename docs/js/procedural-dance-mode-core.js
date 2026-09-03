// Procedural Animation Editor: rhythmic PNG-plane dance + grounded leg IK.
//
// The body motion below deliberately mirrors the gameplay-preview dance
// language in docs/references/(HA)MusicMinigameV3.html. Groove chooses how
// much of that authored rhythm is visible; the existing procedural leg rig is
// then solved back to planted/swinging world-space foot targets. Drunkenness
// borrows the same weave, correction, cross-step, hesitation and toe-twist
// vocabulary as docs/js/drunk-locomotion.js without making the preview walk
// away from its authoring origin.
(function () {
  'use strict';

  if (window.ProceduralDanceMode?.installed) return;

  const STYLE_ID = 'proceduralDanceModeStyles'; // Used to avoid duplicating the dance workspace CSS on script re-evaluation.
  const PANEL_ID = 'proceduralDancePanel'; // Used to find/reuse the mobile-safe dance controls.
  const BUTTON_ID = 'proceduralDanceQuickBtn'; // Used to find/reuse the animation HUD entry button.
  const DEFAULT_BPM = 104; // Used as the reference preview tactus when no music transport is driving the editor.
  const REFERENCE_MODEL_WIDTH = 0.9; // Used to scale gameplay-preview world offsets to the currently previewed avatar width.
  const DEG = Math.PI / 180; // Used to share the drunken-walk degree constants with Three.js radians.
  const DRUNK_MAX_PITCH_DEG = 26; // Used by the drunken dance blend; matches docs/js/drunk-locomotion.js.
  const DRUNK_MAX_ROLL_DEG = 60; // Used by the drunken dance blend; matches docs/js/drunk-locomotion.js.
  const DRUNK_LEG_SWAY_SCALE = 0.5; // Used to translate the existing drunken leg offsets into dance landing targets.
  const DRUNK_CROSS_STEP_WIDTH = 0.32; // Used for drunken inward/crossed dance catches.
  const DRUNK_WIDE_STEP_WIDTH = 0.30; // Used for drunken outward recovery steps.
  const DRUNK_STEP_DEPTH = 0.18; // Used for drunken forward/backward foot drift during a dance.
  const DRUNK_HESITATION_LIFT = 0.08; // Used for the held-up-foot hesitation borrowed from drunken locomotion.

  const STYLE_INTENSITY = Object.freeze({ // Used to preserve the reference preview's authored maximum intensity per dance style.
    'side-step': 1.00,
    'bouncy': 1.08,
    'loose-sway': 0.96,
    'gentle-twirl': 1.18,
    'skipping-twirl': 1.28,
    'foot-tap': 1.00,
    'head-bob': 0.38,
    'small-sway': 0.34,
  });
  const STYLE_STEP_FACTOR = Object.freeze({ // Used to decide how strongly each authored body style asks the IK feet to relocate support.
    'side-step': 1.00,
    'bouncy': 0.62,
    'loose-sway': 0.48,
    'gentle-twirl': 0.88,
    'skipping-twirl': 1.10,
    'foot-tap': 0.00,
    'head-bob': 0.12,
    'small-sway': 0.22,
  });

  const state = { // Holds the live editor-only dance session so all transforms can be restored without accumulation.
    enabled: false,
    style: 'side-step',
    groove: 60,
    drunkenness: 0,
    bpm: DEFAULT_BPM,
    startedAt: performance.now(),
    lastNow: performance.now(),
    model: null,
    bodyBase: null,
    rig: null,
    previousBeatIndex: null,
    previousSwingSide: null,
    lastLandingWorld: { left: null, right: null },
    pitch: 0,
    roll: 0,
    lastStatusAt: 0,
    renderHookInstalled: false,
    renderer: null,
    originalRender: null,
    debug: {},
  };

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function smootherstep01(value) {
    const t = clamp01(value); // Used to ease swing-foot travel and authored twirl starts/stops.
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function smoothstep01(value) {
    const t = clamp01(value); // Used to shape the drunkenness blend exactly like the runtime drunken locomotion layer.
    return t * t * (3 - 2 * t);
  }

  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
  }

  function exponentialDanceGrooveScale(groove) {
    const safeGroove = Math.max(0, Number(groove) || 0); // Used by the same restrained-low/escalating-high Groove curve as the gameplay preview.
    const curveRate = 52; // Used by the gameplay-preview Groove mapping; 100 maps back to exactly 1.
    return Math.expm1(safeGroove / curveRate) / Math.expm1(100 / curveRate);
  }

  function tactusBpm(rawBpm) {
    let tactus = Number(rawBpm) || DEFAULT_BPM; // Used to keep whole-body steps on a danceable perceived beat instead of rapid subdivisions.
    while (tactus > 122) tactus /= 2;
    while (tactus < 58) tactus *= 2;
    return tactus;
  }

  function previewDimensions(model) {
    let plane = null; // Used as a fallback source when the backdrop has not published portrait model dimensions yet.
    model?.traverse?.((node) => {
      if (!plane && node.isMesh && (node.userData?.hobunjiPlaneFace || /_front_plane$/.test(node.name || ''))) plane = node;
    });
    const parameters = plane?.geometry?.parameters || {}; // Used to retain the authored PNG-plane dimensions rather than a rotated world AABB.
    const width = Number(model?.userData?.portraitModelWidth) || Number(parameters.width) || REFERENCE_MODEL_WIDTH; // Used to normalize dance translation and foot offsets across species sizes.
    const height = Number(model?.userData?.portraitModelHeight) || Number(parameters.height) || width; // Used to normalize vertical bounce and drunken step depth.
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function findFeetRoot(model) {
    let root = null; // Used to locate the existing ProceduralLegAnimation hierarchy without creating a second leg rig.
    model?.traverse?.((node) => {
      if (!root && /_procedural_feet$/.test(String(node.name || ''))) root = node;
    });
    return root;
  }

  function deriveLegBend(THREE, root, chain, targetWorld) {
    if (!window.LegBones?.solveTwoBoneLeg || !root || !chain?.hip || !chain?.thigh || !targetWorld) return { x: 0, z: 0 };
    const targetLocal = root.worldToLocal(targetWorld.clone()); // Used to compare the authored thigh quaternion against a straight-leg solve in the solver's own local space.
    const straight = window.LegBones.solveTwoBoneLeg(THREE, { hip: chain.hip.position, foot: targetLocal }); // Used only to isolate the existing authored bend from the current stance.
    const bendQuaternion = straight.thighQuaternion.clone().invert().multiply(chain.thigh.quaternion.clone()); // Used to preserve species/gender leg bend while dance IK moves the target.
    const bendEuler = new THREE.Euler().setFromQuaternion(bendQuaternion, 'XYZ'); // Used to recover the solver's authored bend degrees from the existing rig.
    return { x: bendEuler.x / DEG, z: bendEuler.z / DEG };
  }

  function captureLeg(THREE, root, side) {
    const hip = root?.getObjectByName?.(`${side}_hip`) || null; // Used as the IK chain's fixed upper joint.
    const thigh = root?.getObjectByName?.(`${side}_thigh`) || null; // Used to receive the solved upper-leg quaternion.
    const calf = root?.getObjectByName?.(`${side}_calf`) || null; // Used to receive the solved lower-leg quaternion and length.
    const foot = root?.getObjectByName?.(`${side}_foot`) || null; // Used as the visible foot/end effector and toe-twist target.
    if (!hip || !thigh || !calf || !foot) return null;
    root.updateMatrixWorld(true);
    const anchorWorld = foot.getWorldPosition(new THREE.Vector3()); // Used as the initial planted world-space endpoint so body sway cannot slide the foot.
    const bend = deriveLegBend(THREE, root, { hip, thigh }, anchorWorld); // Used by every later dance solve to retain the editor's authored knee direction.
    return {
      hip, thigh, calf, foot, bend,
      anchorWorld: anchorWorld.clone(),
      contactWorldY: anchorWorld.y,
      baseFootQuaternion: foot.quaternion.clone(),
    };
  }

  function captureRig(THREE, model) {
    const root = findFeetRoot(model); // Used to reuse the exact ProceduralLegAnimation hierarchy already attached by the preview.
    if (!root) return null;
    const left = captureLeg(THREE, root, 'left'); // Used for alternating left-foot support and swing solves.
    const right = captureLeg(THREE, root, 'right'); // Used for alternating right-foot support and swing solves.
    if (!left || !right) return null;
    return { root, left, right };
  }

  function restoreBodyBase() {
    if (!state.model || !state.bodyBase) return;
    state.model.position.copy(state.bodyBase.position);
    state.model.quaternion.copy(state.bodyBase.quaternion);
    state.model.scale.copy(state.bodyBase.scale);
    state.model.updateMatrixWorld(true);
  }

  function releaseModel() {
    restoreBodyBase();
    state.model = null;
    state.bodyBase = null;
    state.rig = null;
    state.previousBeatIndex = null;
    state.previousSwingSide = null;
    state.lastLandingWorld.left = null;
    state.lastLandingWorld.right = null;
  }

  function bindModel(THREE, model) {
    if (state.model === model && state.bodyBase) return;
    releaseModel();
    if (!model) return;
    state.model = model;
    state.bodyBase = { // Captured once per preview avatar and used as the non-accumulating stable upright pose.
      position: model.position.clone(),
      quaternion: model.quaternion.clone(),
      scale: model.scale.clone(),
    };
    state.rig = captureRig(THREE, model);
    state.startedAt = performance.now();
    state.previousBeatIndex = null;
    state.previousSwingSide = null;
    state.pitch = 0;
    state.roll = 0;
  }

  function authoredDanceMotion(localBeat, mappedIntensity) {
    const phase = localBeat * Math.PI * 2; // Used as the shared beat phase for all reference-authored dance channels.
    const alternatingWeight = Math.sin(phase * 0.5); // Used by side-to-side styles exactly as in the gameplay preview.
    const fourBeatSway = Math.sin(phase * 0.25); // Used by slower body sways exactly as in the gameplay preview.
    const beatPulse = Math.pow(Math.max(0, Math.cos(phase)), 4); // Used by reference-authored bounce/head-bob accents.
    let tangentShift = 0; // Used as the authored local-X body translation.
    let bounce = 0; // Used as the authored local-Y body translation.
    let bodySway = 0; // Used as the authored local-Z body roll.
    let forwardLean = 0; // Used as the authored local-X body pitch.
    let twirlRotation = 0; // Used as the authored local-Y whole-body twirl.
    let footTapYaw = 0; // Used by the IK foot-tap style instead of rotating the whole body like the reference placeholder did.
    let footTapRoll = 0; // Used by the IK foot-tap style for the 0° -> 15° -> 0° tap arc.

    if (state.style === 'side-step') {
      tangentShift = alternatingWeight * 0.30 * mappedIntensity;
      bounce = beatPulse * 0.12 * mappedIntensity;
      bodySway = fourBeatSway * 0.22 * mappedIntensity;
    } else if (state.style === 'bouncy') {
      tangentShift = alternatingWeight * 0.13 * mappedIntensity;
      bounce = beatPulse * 0.30 * mappedIntensity;
      bodySway = alternatingWeight * 0.16 * mappedIntensity;
    } else if (state.style === 'gentle-twirl') {
      tangentShift = alternatingWeight * 0.14 * mappedIntensity;
      bounce = beatPulse * 0.12 * mappedIntensity;
      bodySway = fourBeatSway * 0.20 * mappedIntensity;
      const cycle = ((localBeat % 8) + 8) % 8; // Used to preserve the reference eight-beat gentle-twirl phrase.
      const turnProgress = clamp01((cycle - 4.5) / 2); // Used to preserve the reference twirl's authored onset/duration.
      twirlRotation = mappedIntensity >= 0.56
        ? Math.PI * 2 * smootherstep01(turnProgress)
        : Math.sin(turnProgress * Math.PI) * 0.8 * mappedIntensity;
    } else if (state.style === 'skipping-twirl') {
      tangentShift = alternatingWeight * 0.25 * mappedIntensity;
      bounce = beatPulse * 0.24 * mappedIntensity;
      bodySway = alternatingWeight * 0.18 * mappedIntensity;
      const cycle = ((localBeat % 6) + 6) % 6; // Used to preserve the reference six-beat skipping-twirl phrase.
      const turnProgress = clamp01((cycle - 2.7) / 1.8); // Used to preserve the reference skipping turn window.
      twirlRotation = mappedIntensity >= 0.62
        ? Math.PI * 2 * smootherstep01(turnProgress)
        : Math.sin(turnProgress * Math.PI) * mappedIntensity;
    } else if (state.style === 'loose-sway') {
      tangentShift = alternatingWeight * 0.18 * mappedIntensity;
      bounce = beatPulse * 0.09 * mappedIntensity;
      bodySway = fourBeatSway * 0.36 * mappedIntensity;
    } else if (state.style === 'foot-tap') {
      const footTapMaxAngle = Math.PI / 12; // Used as the same fifteen-degree full-intensity ceiling from the gameplay preview.
      const footTapBeatProgress = ((localBeat % 1) + 1) % 1; // Used to normalize the active tap inside one beat.
      const footTapArc = Math.sin(Math.PI * footTapBeatProgress); // Used to form the smooth authored 0 -> 15 -> 0 tap arc.
      footTapYaw = footTapMaxAngle * mappedIntensity;
      footTapRoll = footTapMaxAngle * footTapArc * mappedIntensity;
    } else if (state.style === 'head-bob') {
      bounce = beatPulse * 0.07 * mappedIntensity;
      forwardLean = beatPulse * 0.13 * mappedIntensity;
      tangentShift = alternatingWeight * 0.055 * mappedIntensity;
    } else {
      bodySway = fourBeatSway * 0.18 * mappedIntensity;
      tangentShift = alternatingWeight * 0.055 * mappedIntensity;
    }

    const scalePulse = 1 + Math.sin(phase * 0.5) * mappedIntensity * 0.018; // Used to retain the subtle rhythmic PNG-plane pulse from the simpler preview dance pass.
    return { phase, tangentShift, bounce, bodySway, forwardLean, twirlRotation, footTapYaw, footTapRoll, scalePulse };
  }

  function drunkenDanceMotion(THREE, phase, groove01, dt) {
    const raw = clamp01(state.drunkenness / 100); // Used as the user-authored 0-100 drunken dance blend.
    const blend = smoothstep01(raw); // Used to preserve the runtime drunk-walk's gentle onset.
    const extreme = blend * blend; // Used to reserve cross-steps/corrections for stronger drunkenness.
    const movement = clamp01(groove01); // Used in place of walk speed so a barely-moving dance does not receive full locomotion sway.
    const locomotionStrength = blend * (0.16 + 0.84 * Math.sqrt(movement)); // Used directly from the drunk-walk strength structure.
    const p = phase; // Used to drive the same multi-frequency drunken weave family as runtime locomotion.
    const irregular = Math.sin(p * 0.47 + 1.1) * 0.55 + Math.sin(p * 1.31 - 0.4) * 0.45; // Used for uneven balance correction.
    const correctionPulse = Math.pow(Math.max(0, Math.sin(p * 0.53 - 0.8)), 5); // Used for abrupt catch-yourself moments.
    const stepWave = Math.sin(p); // Used to choose alternating crossed versus wide catches.
    const crossCatch = Math.sign(stepWave || 1) * Math.pow(Math.abs(stepWave), 1.8); // Used by both body roll and support offsets.
    const hesitationL = Math.pow(Math.max(0, Math.sin(p - 0.55)), 7); // Used to hold the left foot up too long.
    const hesitationR = Math.pow(Math.max(0, Math.sin(p + Math.PI - 0.55)), 7); // Used to hold the right foot up too long.
    const hesitationBias = hesitationL - hesitationR; // Used to bias body roll toward the foot that hesitates.
    const hesitationTotal = hesitationL + hesitationR; // Used to add a small whole-body pitch hesitation.

    const pitchTarget = locomotionStrength * DRUNK_MAX_PITCH_DEG * DEG *
      (0.50 * Math.sin(p * 0.73 + 0.9) + 0.30 * irregular
        - 0.38 * correctionPulse * extreme - 0.24 * crossCatch * crossCatch * extreme
        + 0.16 * hesitationTotal * extreme); // Used as the dance translation of runtime drunken pitch.
    const rollTarget = locomotionStrength * DRUNK_MAX_ROLL_DEG * DEG *
      (0.64 * Math.sin(p * 0.61 - 0.25) + 0.27 * Math.sin(p * 1.17 + 1.7)
        + 0.34 * correctionPulse * extreme + 0.42 * crossCatch * extreme
        + 0.16 * hesitationBias * extreme); // Used as the dance translation of runtime drunken roll.
    state.pitch = damp(state.pitch, pitchTarget, 6.5, dt);
    state.roll = damp(state.roll, rollTarget, 6.0, dt);

    const sideOffset = (side) => { // Used to turn runtime thigh sway into world-space dance landing-target distortion.
      const sideSign = side === 'left' ? -1 : 1; // Used to mirror wide/cross catches between legs.
      const legPhase = side === 'left' ? p : p + Math.PI; // Used to alternate drunken support between feet.
      const wave = Math.sin(legPhase); // Used to split crossed and wide portions of each leg cycle.
      const cross = Math.pow(Math.max(0, wave), 2.1); // Used for the inward catch amount.
      const wide = Math.pow(Math.max(0, -wave), 1.8); // Used for the outward recovery amount.
      const hesitation = Math.pow(Math.max(0, Math.sin(legPhase - 0.55)), 7); // Used to lift this side during a drunken hesitation.
      const dimensions = previewDimensions(state.model); // Used to scale existing drunk-walk fractions to this avatar.
      const lateralNoise = Math.sin(legPhase * 0.41 + sideSign * 1.9) * 0.04 * dimensions.width * blend; // Used for low-frequency lateral wander.
      const x = DRUNK_LEG_SWAY_SCALE * (lateralNoise + extreme * dimensions.width *
        (sideSign * DRUNK_WIDE_STEP_WIDTH * wide - sideSign * DRUNK_CROSS_STEP_WIDTH * cross)); // Used for wide/cross support placement.
      const z = DRUNK_LEG_SWAY_SCALE * blend * dimensions.height * DRUNK_STEP_DEPTH *
        (0.56 * Math.sin(legPhase * 0.57 + 0.7) + 0.44 * Math.sin(legPhase * 1.37 - 0.9)); // Used for uneven fore/aft placement.
      const y = DRUNK_LEG_SWAY_SCALE * extreme * dimensions.height * DRUNK_HESITATION_LIFT * hesitation; // Used for the characteristic delayed-foot lift.
      return { x, y, z };
    };

    const toeStrength = DRUNK_LEG_SWAY_SCALE * extreme * (0.35 + 0.65 * Math.sqrt(movement)); // Used to match runtime drunken toe twist strength.
    const leftToe = { // Used to compose the existing left-foot drunk yaw/roll onto the dance pose.
      yaw: toeStrength * DEG * (25 * Math.sin(p * 0.83 + 0.4) + 14 * Math.sin(p * 0.29 - 0.5)),
      roll: toeStrength * DEG * (12 * Math.sin(p * 0.67 - 0.2)),
    };
    const rightToe = { // Used to compose the existing right-foot drunk yaw/roll onto the dance pose.
      yaw: toeStrength * DEG * (-27 * Math.sin(p * 0.79 + 1.1) + 13 * Math.sin(p * 0.33 + 0.8)),
      roll: toeStrength * DEG * (-13 * Math.sin(p * 0.71 + 0.6)),
    };
    return { blend, extreme, pitch: state.pitch, roll: state.roll, left: sideOffset('left'), right: sideOffset('right'), leftToe, rightToe };
  }

  function applyBodyMotion(THREE, motion, drunk, sizeScale) {
    if (!state.model || !state.bodyBase) return;
    const localOffset = new THREE.Vector3(motion.tangentShift * sizeScale, motion.bounce * sizeScale, 0); // Used to preserve reference body translation in avatar-local space.
    localOffset.applyQuaternion(state.bodyBase.quaternion);
    state.model.position.copy(state.bodyBase.position).add(localOffset);
    const danceQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      motion.forwardLean * 0.45 + drunk.pitch,
      motion.twirlRotation,
      motion.bodySway + drunk.roll,
      'YXZ'
    )); // Used to compose authored sway/twirl with the additive drunken pitch/roll.
    state.model.quaternion.copy(state.bodyBase.quaternion).multiply(danceQuaternion);
    state.model.scale.copy(state.bodyBase.scale).multiplyScalar(Math.max(0.94, Math.min(1.06, motion.scalePulse)));
    state.model.updateMatrixWorld(true);
  }

  function solveLeg(THREE, side, targetWorld, toeYaw, toeRoll) {
    const leg = state.rig?.[side]; // Used to address one captured side of the existing procedural-leg hierarchy.
    const root = state.rig?.root; // Used to convert the planted world endpoint back into LegBones' local solver space.
    if (!leg || !root || !window.LegBones?.solveTwoBoneLeg) return;
    root.updateMatrixWorld(true);
    const targetLocal = root.worldToLocal(targetWorld.clone()); // Used so a moving/rotating body can still solve toward a fixed world-space foot.
    const solved = window.LegBones.solveTwoBoneLeg(THREE, {
      hip: leg.hip.position,
      foot: targetLocal,
      bendDegX: leg.bend.x,
      bendDegZ: leg.bend.z,
    }); // Used by the same shared two-bone IK solver as normal procedural walking.
    leg.thigh.quaternion.copy(solved.thighQuaternion);
    leg.calf.position.set(0, -solved.thighLength, 0);
    leg.calf.quaternion.copy(solved.calfLocalQuaternion);
    leg.foot.position.set(0, -solved.calfLength, 0);
    const toeDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, toeYaw || 0, toeRoll || 0, 'YXZ')); // Used to add tap/drunk toe articulation without accumulating it frame-to-frame.
    leg.foot.quaternion.copy(leg.baseFootQuaternion).multiply(toeDelta);
  }

  function applyDanceLegs(THREE, localBeat, mappedIntensity, motion, drunk) {
    if (!state.rig) return;
    const beatIndex = Math.floor(localBeat); // Used to alternate one swing foot per beat while the opposite foot stays planted.
    const swingSide = beatIndex % 2 === 0 ? 'left' : 'right'; // Used as the current procedural swing leg.
    const swingProgress = ((localBeat % 1) + 1) % 1; // Used to ease this beat's foot from its planted anchor to the next support point.
    if (state.previousBeatIndex !== beatIndex) {
      if (state.previousSwingSide && state.lastLandingWorld[state.previousSwingSide]) {
        state.rig[state.previousSwingSide].anchorWorld.copy(state.lastLandingWorld[state.previousSwingSide]);
      }
      state.previousBeatIndex = beatIndex;
      state.previousSwingSide = swingSide;
    }

    const styleStep = STYLE_STEP_FACTOR[state.style] ?? 0.5; // Used to preserve tiny-foot versus traveling-foot distinctions between reference styles.
    const supportStrength = Math.max(styleStep * clamp01(mappedIntensity), drunk.blend * 0.58); // Used to let drunken catches move a foot even during otherwise stationary dances.
    const dimensions = previewDimensions(state.model); // Used to size the swing arc consistently across avatar scales.
    const baseLift = dimensions.height * (0.018 + 0.045 * clamp01(mappedIntensity)) * Math.max(0.25, supportStrength); // Used as the procedural leg lift generated from dance intensity.
    const parentQuaternion = state.bodyBase?.quaternion || state.model.quaternion; // Used to convert dance-local drunken support offsets into world directions.

    for (const side of ['left', 'right']) {
      const leg = state.rig[side]; // Used to read this foot's planted anchor and current hip world position.
      const hipWorld = leg.hip.getWorldPosition(new THREE.Vector3()); // Used as the anatomically correct next support point underneath the moved body.
      const underHipWorld = hipWorld.clone(); // Used as the landing candidate before style/drunken offsets are blended in.
      underHipWorld.y = leg.contactWorldY;
      const drunkOffset = drunk[side]; // Used to add the existing drunken wide/cross/fore-aft support pattern.
      const localDrunkOffset = new THREE.Vector3(drunkOffset.x, 0, drunkOffset.z).applyQuaternion(parentQuaternion); // Used to orient drunken foot placement with the avatar instead of world axes.
      underHipWorld.add(localDrunkOffset);
      const landingWorld = leg.anchorWorld.clone().lerp(underHipWorld, clamp01(supportStrength)); // Used to keep low-Groove motion close to the current planted stance.
      landingWorld.y = leg.contactWorldY;
      state.lastLandingWorld[side] = landingWorld.clone();

      let targetWorld = leg.anchorWorld.clone(); // Used as the planted endpoint for the non-swing foot.
      if (side === swingSide && supportStrength > 0.01) {
        const eased = smootherstep01(swingProgress); // Used to avoid mechanical linear foot travel.
        targetWorld.lerp(landingWorld, eased);
        targetWorld.y = leg.contactWorldY + Math.sin(Math.PI * swingProgress) * baseLift + drunkOffset.y;
      }

      let tapYaw = 0; // Used to add the authored fifteen-degree foot-tap yaw only to the current active foot.
      let tapRoll = 0; // Used to add the authored foot-tap roll arc only to the current active foot.
      if (state.style === 'foot-tap' && side === swingSide) {
        const direction = side === 'left' ? -1 : 1; // Used to mirror foot-tap articulation between sides.
        tapYaw = motion.footTapYaw * direction;
        tapRoll = motion.footTapRoll * direction;
      }
      const drunkToe = side === 'left' ? drunk.leftToe : drunk.rightToe; // Used to compose runtime-derived drunken toe articulation after authored tap articulation.
      solveLeg(THREE, side, targetWorld, tapYaw + drunkToe.yaw, tapRoll + drunkToe.roll);
    }

    state.debug.supportSide = swingSide === 'left' ? 'right' : 'left';
    state.debug.swingSide = swingSide;
    state.debug.swingProgress = swingProgress;
  }

  function currentThree(model) {
    if (window.THREE?.Vector3 && window.THREE?.Quaternion && window.THREE?.Euler) return window.THREE;
    if (!model?.position?.constructor || !model?.quaternion?.constructor || !model?.rotation?.constructor) return null;
    return { // Used only as a compatibility bridge if the editor's Three.js module is not mirrored onto window.THREE.
      Vector3: model.position.constructor,
      Quaternion: model.quaternion.constructor,
      Euler: model.rotation.constructor,
      MathUtils: { degToRad: (value) => Number(value) * DEG },
    };
  }

  function renderDanceFrame(now) {
    const backdrop = window.HobunjiGameplayBackdrop; // Used to reach the editor's currently previewed avatar without coupling to editor-private variables.
    const model = backdrop?.getAvatarModel?.() || null; // Used as the exact PNG-plane avatar root currently visible in the editor.
    const THREE = currentThree(model); // Used by the shared leg solver and additive transform math.
    if (!state.enabled || !model || !THREE) {
      if (!state.enabled && state.model) releaseModel();
      updateStatus(now, model ? 'Dance preview off.' : 'Waiting for preview avatar.');
      return;
    }
    bindModel(THREE, model);
    restoreBodyBase();

    const dt = Math.max(0, Math.min(0.05, (now - state.lastNow) / 1000)); // Used to prevent a tab-resume hitch from producing a huge drunken damping step.
    state.lastNow = now;
    const bpm = tactusBpm(state.bpm); // Used as the procedural dance tactus.
    const beatMs = 60000 / bpm; // Used to convert elapsed authoring time into the reference beat phase.
    const baseBeat = (now - state.startedAt) / beatMs; // Used as the deterministic editor dance transport.
    const grooveScale = exponentialDanceGrooveScale(state.groove); // Used as the exact reference exponential Groove ramp.
    const styleIntensity = STYLE_INTENSITY[state.style] ?? 1; // Used as the selected reference style's maximum movement amount.
    const mappedIntensity = grooveScale * styleIntensity; // Used as the editor's Groove-only replacement for gameplay Groove × expressiveness × note-frequency.
    const drunkTimingWarp = smoothstep01(state.drunkenness / 100) *
      (Math.sin(baseBeat * Math.PI * 0.47 + 1.1) * 0.045 + Math.sin(baseBeat * Math.PI * 1.31 - 0.4) * 0.025); // Used to make authored beats slightly early/late as drunkenness rises without breaking their rhythm.
    const localBeat = baseBeat + drunkTimingWarp; // Used by both authored body motion and alternating IK so they remain synchronized.
    const motion = authoredDanceMotion(localBeat, mappedIntensity); // Used as the preserved gameplay-preview PNG-plane animation layer.
    const drunk = drunkenDanceMotion(THREE, motion.phase, grooveScale, dt); // Used as the additive existing-drunk-walk-derived distortion layer.
    const dimensions = previewDimensions(model); // Used to scale reference translations for the current species/gender preview.
    const sizeScale = dimensions.width / REFERENCE_MODEL_WIDTH; // Used to retain approximately the same dance/body-width ratio across avatar sizes.

    applyBodyMotion(THREE, motion, drunk, sizeScale);
    applyDanceLegs(THREE, localBeat, mappedIntensity, motion, drunk);
    model.updateMatrixWorld(true);

    state.debug = {
      ...state.debug,
      enabled: true,
      style: state.style,
      groove: state.groove,
      grooveScale,
      mappedIntensity,
      drunkenness: state.drunkenness,
      drunkBlend: drunk.blend,
      bpm,
      beat: localBeat,
      body: {
        side: motion.tangentShift * sizeScale,
        lift: motion.bounce * sizeScale,
        pitchDeg: (motion.forwardLean * 0.45 + drunk.pitch) / DEG,
        rollDeg: (motion.bodySway + drunk.roll) / DEG,
        yawDeg: motion.twirlRotation / DEG,
      },
      rigReady: !!state.rig,
      legBend: state.rig ? {
        left: { ...state.rig.left.bend },
        right: { ...state.rig.right.bend },
      } : null,
    };
    updateStatus(now, state.rig ? null : 'Dance body active; waiting for procedural leg rig.');
  }

  function updateStatus(now, overrideMessage) {
    if (now - state.lastStatusAt < 180) return;
    state.lastStatusAt = now;
    const output = document.getElementById('proceduralDanceStatus'); // Used as an in-page diagnostic because authoring often happens on mobile without DevTools.
    if (!output) return;
    if (overrideMessage) {
      output.textContent = overrideMessage;
      return;
    }
    const support = state.debug.rigReady ? ` · planted ${state.debug.supportSide || '—'}` : ' · legs unavailable'; // Used to expose whether IK is actually participating in the preview.
    output.textContent = `${state.style} · Groove ${state.groove} · Drunk ${state.drunkenness}${support}`;
  }

  function installRendererHook() {
    if (state.renderHookInstalled) return true;
    const renderer = window.HobunjiGameplayBackdrop?.getRenderer?.(); // Used to apply dance after the editor's normal animation writers but immediately before the frame is rendered.
    if (!renderer?.render) return false;
    const originalRender = renderer.render.bind(renderer); // Used to preserve the editor renderer's original behavior after the dance pose is applied.
    renderer.render = function proceduralDanceRender(scene, camera) {
      renderDanceFrame(performance.now());
      return originalRender(scene, camera);
    };
    state.renderer = renderer;
    state.originalRender = originalRender;
    state.renderHookInstalled = true;
    return true;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Holds only the dance workspace's compact desktop/mobile presentation.
    style.id = STYLE_ID;
    style.textContent = `
#${PANEL_ID}{position:fixed;z-index:10040;right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:min(360px,calc(100vw - 16px));max-height:min(70dvh,620px);overflow:auto;padding:12px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(7,16,26,.97);box-shadow:0 18px 55px rgba(0,0,0,.55);color:#eef5ff;font:12px/1.35 system-ui,sans-serif}
#${PANEL_ID}[hidden]{display:none!important}#${PANEL_ID} h3{margin:0 0 8px;font-size:15px}#${PANEL_ID} .danceRow{display:grid;grid-template-columns:105px minmax(0,1fr) 42px;gap:8px;align-items:center;margin:8px 0}#${PANEL_ID} select,#${PANEL_ID} input[type=range]{width:100%}#${PANEL_ID} .danceActions{display:flex;gap:7px;flex-wrap:wrap;margin:9px 0}#${PANEL_ID} .danceStatus{display:block;margin-top:8px;padding:7px 8px;border-radius:8px;background:rgba(107,169,255,.12);white-space:normal}#${PANEL_ID} .danceLatest{opacity:.72;margin:8px 0 0;font-size:11px}#${BUTTON_ID}.active{outline:2px solid rgba(107,169,255,.55);outline-offset:-2px}
@media(max-width:700px){#${PANEL_ID}{right:max(4px,env(safe-area-inset-right));bottom:max(4px,env(safe-area-inset-bottom));left:max(4px,env(safe-area-inset-left));width:auto;max-height:48dvh;padding:9px;border-radius:11px}#${PANEL_ID} .danceRow{grid-template-columns:92px minmax(0,1fr) 38px;margin:6px 0}}
`;
    document.head.appendChild(style);
  }

  function makeRangeRow(labelText, inputId, value, min, max, onInput) {
    const row = document.createElement('label'); // Used as one accessible slider row in the dance workspace.
    row.className = 'danceRow';
    const label = document.createElement('span'); // Used to identify the slider on narrow/mobile layouts.
    label.textContent = labelText;
    const input = document.createElement('input'); // Used to author Groove or Drunkenness directly in the live preview.
    input.id = inputId;
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    const output = document.createElement('output'); // Used to keep the exact numeric 0-100 value visible beside touch sliders.
    output.value = output.textContent = String(value);
    input.addEventListener('input', () => {
      output.value = output.textContent = input.value;
      onInput(Number(input.value));
    });
    row.append(label, input, output);
    return row;
  }

  function buildUi() {
    if (document.getElementById(PANEL_ID)) return;
    const actionRow = document.querySelector('#animationHud .animationHudActions'); // Used to place Dance beside the editor's existing playback/Impact actions.
    if (!actionRow) return;
    injectStyles();

    const button = document.createElement('button'); // Used as the always-visible entry point to procedural dance authoring.
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Dance';

    const panel = document.createElement('section'); // Used as the self-contained dance workspace without modifying the giant editor HTML.
    panel.id = PANEL_ID;
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Procedural dance authoring');
    const title = document.createElement('h3'); // Used to identify the workspace when opened from the HUD.
    title.textContent = 'Procedural dancing';
    panel.appendChild(title);

    const styleRow = document.createElement('label'); // Used to select the same authored style vocabulary as the music-minigame gameplay preview.
    styleRow.className = 'danceRow';
    const styleLabel = document.createElement('span'); // Used as the visible accessible label for the style selector.
    styleLabel.textContent = 'Style';
    const styleSelect = document.createElement('select'); // Used to choose which reference-authored rhythmic body animation feeds dance IK.
    styleSelect.id = 'proceduralDanceStyle';
    for (const key of Object.keys(STYLE_INTENSITY)) {
      const option = document.createElement('option'); // Used as one preserved gameplay-preview dance style choice.
      option.value = key;
      option.textContent = key.replace(/(^|-)([a-z])/g, (_match, sep, letter) => `${sep ? ' ' : ''}${letter.toUpperCase()}`);
      styleSelect.appendChild(option);
    }
    styleSelect.value = state.style;
    styleSelect.addEventListener('change', () => { state.style = styleSelect.value; state.startedAt = performance.now(); state.previousBeatIndex = null; });
    const spacer = document.createElement('span'); // Used only to keep the selector aligned with the numeric slider rows.
    styleRow.append(styleLabel, styleSelect, spacer);
    panel.appendChild(styleRow);
    panel.appendChild(makeRangeRow('Groove', 'proceduralDanceGroove', state.groove, 0, 100, (value) => { state.groove = value; }));
    panel.appendChild(makeRangeRow('Drunkenness', 'proceduralDanceDrunk', state.drunkenness, 0, 100, (value) => { state.drunkenness = value; }));

    const actions = document.createElement('div'); // Used to hold touch-friendly preview/debug actions.
    actions.className = 'danceActions';
    const toggle = document.createElement('button'); // Used to start/stop dance ownership of the preview body and IK legs.
    toggle.type = 'button';
    toggle.className = 'secondary';
    toggle.textContent = 'Preview dance';
    toggle.addEventListener('click', () => {
      state.enabled = !state.enabled;
      if (state.enabled) {
        state.startedAt = performance.now();
        state.lastNow = state.startedAt;
        state.previousBeatIndex = null;
      } else releaseModel();
      toggle.classList.toggle('active', state.enabled);
      toggle.textContent = state.enabled ? 'Stop dance' : 'Preview dance';
    });
    const bones = document.createElement('button'); // Used to expose the existing procedural leg-bone guides for mobile IK inspection.
    bones.type = 'button';
    bones.className = 'secondary';
    bones.textContent = 'Leg bones';
    bones.addEventListener('click', () => {
      const next = !window.ProceduralLegAnimation?.showBones; // Used to toggle the shared leg guides without creating a dance-specific debug rig.
      window.ProceduralLegAnimation?.setShowBones?.(next);
      bones.classList.toggle('active', next);
    });
    actions.append(toggle, bones);
    panel.appendChild(actions);

    const status = document.createElement('output'); // Used to surface live rig/support state without requiring a console.
    status.id = 'proceduralDanceStatus';
    status.className = 'danceStatus';
    status.textContent = 'Dance preview off.';
    panel.appendChild(status);
    const latest = document.createElement('p'); // Used to give the mobile author a short summary of the most recent dance-system change.
    latest.className = 'danceLatest';
    latest.textContent = 'Latest change: gameplay-preview rhythm now drives grounded leg IK, with a separate drunkenness blend.';
    panel.appendChild(latest);

    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.classList.toggle('active', !panel.hidden);
    });
    actionRow.appendChild(button);
    document.body.appendChild(panel);
  }

  function boot() {
    buildUi();
    if (!installRendererHook()) {
      const retry = window.setInterval(() => { // Used only until the asynchronously-created editor renderer becomes available.
        buildUi();
        if (installRendererHook()) window.clearInterval(retry);
      }, 250);
      window.setTimeout(() => window.clearInterval(retry), 15000);
    }
  }

  window.ProceduralDanceMode = {
    installed: true,
    setEnabled(value) {
      state.enabled = !!value;
      if (!state.enabled) releaseModel();
      else { state.startedAt = performance.now(); state.lastNow = state.startedAt; state.previousBeatIndex = null; }
    },
    setGroove(value) { state.groove = Math.max(0, Math.min(100, Number(value) || 0)); },
    setDrunkenness(value) { state.drunkenness = Math.max(0, Math.min(100, Number(value) || 0)); },
    setStyle(value) { if (STYLE_INTENSITY[value] != null) { state.style = value; state.startedAt = performance.now(); state.previousBeatIndex = null; } },
    getDebug() { return { ...state.debug, enabled: state.enabled, style: state.style, groove: state.groove, drunkenness: state.drunkenness }; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();