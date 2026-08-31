(() => {
  'use strict';

  // Dead-zone rotation math shared by the player, NPC walker, and creature
  // PNG-plane avatars: keeps a model's rendered rotation from resting at
  // camera-relative angles ("perps") where a flat PNG plane would render
  // edge-on. Pure math, no game state of its own — the only game.js
  // dependency is angleDiff, threaded once via init(). Extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern as
  // its sibling systems.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const PERP_DEAD_DEG = window.SCRATCHBONES_CONFIG?.game?.movement?.perpRotDeadzoneDeg ?? 40;
  const PERP_DEAD_RAD = PERP_DEAD_DEG * Math.PI / 180;
  // Creatures get a narrower dead zone than player/NPC (see game.js's
  // cameraRelativeCreaturePerps).
  const CREATURE_PERP_DEAD_DEG = window.SCRATCHBONES_CONFIG?.game?.movement?.creaturePerpRotDeadzoneDeg ?? 27.5;
  const CREATURE_PERP_DEAD_RAD = CREATURE_PERP_DEAD_DEG * Math.PI / 180;
  // Extra margin required to *exit* a dead zone once locked into it, on top of
  // the radius required to *enter* it. Without this, a rawTarget hovering right
  // at the dead zone's edge (e.g. from per-frame tracking noise while chasing a
  // moving target) flips in and out every frame — visible as rotation flicker.
  const PERP_DEAD_HYSTERESIS_RAD = THREE.MathUtils.degToRad(6);
  // Once a plane has chosen one edge of a dead zone, raw aim must cross this
  // far past the zone center before the side changes. Used inside perpClamp
  // to absorb sub-degree mouse/raycast noise when aiming through the player;
  // without it, nearestDT can alternate signs and hard-snap the portrait
  // between both edges every frame.
  const PERP_CENTER_HYSTERESIS_RAD = THREE.MathUtils.degToRad(3);

  // Keeps model rotation outside dead zones around each perp angle (radius given
  // by deadRad, defaulting to PERP_DEAD_RAD).
  // state: persistent object per entity (must survive across frames).
  // Returns { effectiveTarget, snapTo } where snapTo is non-null when the model
  // should teleport (raw target crossed through a perp to the far side).
  //
  // Only the perp nearest rawTarget is ever evaluated. angleDiff wraps at
  // ±π, so a *far* perp's side classification flips discontinuously right
  // at that far perp's antipodal point — which is exactly where the
  // *near* perp sits. Evaluating every perp every frame let that far-side
  // flip fire a spurious snapTo while the model was stably locked near
  // the near perp, producing rapid alternation between two rotations.
  function perpClamp(state, rawTarget, perps, deadRad = PERP_DEAD_RAD) {
    if (!state.perpSides) state.perpSides = perps.map(() => null);
    if (!state.locked) state.locked = perps.map(() => false);
    let nearestI = 0, nearestAbs = Infinity, nearestDT = 0;
    for (let i = 0; i < perps.length; i++) {
      const dT = deps.angleDiff(rawTarget, perps[i]);
      const a = Math.abs(dT);
      if (a < nearestAbs) { nearestAbs = a; nearestI = i; nearestDT = dT; }
    }
    const P = perps[nearestI];
    // Hysteresis: once locked, require crossing the wider exit radius before
    // unlocking; once free, require crossing the (narrower) entry radius before
    // locking. Prevents boundary chatter when rawTarget hovers near the edge.
    const wasLocked = state.locked[nearestI];
    const isLocked = wasLocked ? nearestAbs < deadRad + PERP_DEAD_HYSTERESIS_RAD : nearestAbs < deadRad;
    // Which edge of the dead zone rawTarget is actually closest to right
    // now — tracked every frame regardless of lock state, not just while
    // unlocked. A locked model can still have rawTarget keep rotating
    // straight through the zone (e.g. a continuous camera spin, or the
    // seated look-rotate input) without ever exiting through the far
    // side first; checking the side only while unlocked left it stuck
    // holding the entry edge indefinitely in that case, even long after
    // rawTarget had clearly crossed past center to the opposite side.
    // Always snapping to whichever edge is nearest keeps the held
    // rotation the closest acceptable one to rawTarget at all times,
    // snapping again immediately if it keeps going past the far edge.
    const previousSide = state.perpSides[nearestI]; // Retained within the center band to prevent side chatter.
    const candidateSide = nearestDT > 0 ? 1 : -1; // Used once aim clearly crosses beyond the center band.
    const newSide = previousSide !== null && Math.abs(nearestDT) < PERP_CENTER_HYSTERESIS_RAD
      ? previousSide
      : candidateSide;
    let snapTo = null;
    if (previousSide !== null && previousSide !== newSide) {
      snapTo = P + newSide * deadRad;
    }
    state.perpSides[nearestI] = newSide;
    const effectiveTarget = isLocked ? P + state.perpSides[nearestI] * deadRad : rawTarget;
    state.locked[nearestI] = isLocked;
    state.pixelProbeDebug = {
      timestampMs: typeof performance !== 'undefined' ? performance.now() : Date.now(), // Lets the probe identify stale clamp state.
      rawTargetRotY: rawTarget,
      effectiveTargetRotY: effectiveTarget,
      snapToRotY: snapTo,
      cameraPerpsRad: perps.slice(),
      perpSides: state.perpSides.slice(),
      perpLocked: state.locked.slice(),
      nearestPerpIndex: nearestI,
      nearestDeltaRad: nearestDT,
      previousSide,
      selectedSide: newSide,
      wasLocked,
      isLocked,
    };
    return { effectiveTarget, snapTo };
  }

  // Applies perpClamp to a rendered rotation. Callers keep `rawTarget` as
  // their authored/logical facing so stationary models can be re-clamped
  // whenever the camera azimuth changes instead of baking in an old result.
  function clampedRotation(state, current, rawTarget, perps, lerp = 0.15, deadRad = PERP_DEAD_RAD) {
    const { effectiveTarget, snapTo } = perpClamp(state, rawTarget, perps, deadRad);
    if (snapTo !== null || lerp >= 1) return effectiveTarget;
    return current + deps.angleDiff(effectiveTarget, current) * Math.max(0, lerp);
  }

  // ── Animal/creature PNG-plane dead-zone behavior — THREE implementations ──
  // updateCreatureMesh's pngRot step (game.js) has been rewritten a few
  // times while this gets tuned by feel, and all three attempts are kept
  // side by side here on purpose rather than deleting the losers. ONLY the
  // branch selected by CREATURE_PLANE_ROT_MODE actually runs at runtime —
  // the other two are inert dead code, kept for quick A/B swaps back.
  //
  // NOTE FOR ANY LLM (or human) EDITING THIS FILE: do not assume any one
  // of 'sway' / 'halt' / 'snap' is "the" system just because it's the one
  // currently wired up, and do not assume the others are unused cruft
  // safe to delete — check CREATURE_PLANE_ROT_MODE's value below before
  // reasoning about which behavior is actually live, and ask before
  // removing any of the three.
  //   'sway' — legacy: continuously lerps/rocks through the dead zone via
  //            creatureDeadzoneTarget (sine oscillation, smooth).
  //   'halt' — current default going in: locks to the dead-zone edge and
  //            stays there via perpClamp (same halt behavior player/NPC
  //            avatars and farm-pen livestock already use), eased in.
  //   'snap' — newest: alternates between the dead zone's two edges with
  //            a hard cut (no interpolation) via creatureSnapSwayTarget,
  //            instead of sweeping/lerping between them.
  // Halt is the global default: when an animal's authored/AI facing would
  // point its side-view card straight into or away from the camera, hold the
  // rendered plane at the nearest safe edge instead of repeatedly flipping
  // between both edges. The animal's logical facing and prism still track the
  // true target, so combat, movement, and interaction rays remain unchanged.
  const CREATURE_PLANE_ROT_MODE = 'halt'; // 'sway' | 'halt' | 'snap'

  // Oscillation angular speed shared by the 'sway' and 'snap' modes below
  // — ~1.2s per full back-and-forth cycle, fast enough to read clearly
  // against the pngRot smoothing lerp in updateCreatureMesh (time
  // constant ~0.1s) without being frantic.
  const CREATURE_DEADZONE_OSC_RATE = 2 * Math.PI / 1.2;

  // 'sway' mode (legacy — see CREATURE_PLANE_ROT_MODE above; may not be
  // the active implementation, check that constant before assuming so).
  // For creature PNG planes: unlike perpClamp, a creature is never allowed
  // to settle with its rotation reading inside the dead zone. Standing
  // still, the target eases to the nearer dead-zone edge and stops there.
  // While moving with a raw target that falls inside the dead zone, the
  // target instead continuously rocks back and forth along an arc
  // centered on the movement direction (rawTarget), swinging between the
  // nearest dead-zone edge and that edge's mirror image reflected across
  // the movement direction — so the sprite is always mid-flip through the
  // zone rather than resting in it or sweeping through just once.
  //
  // This is continuous across the dead-zone boundary (amplitude/edge both
  // converge to rawTarget as nearestAbs approaches deadRad), so unlike
  // perpClamp it needs no entry/exit hysteresis to avoid flicker.
  function creatureDeadzoneTarget(state, rawTarget, perps, deadRad, dt, moving) {
    let nearestI = 0, nearestAbs = Infinity, nearestDT = 0;
    for (let i = 0; i < perps.length; i++) {
      const dT = deps.angleDiff(rawTarget, perps[i]);
      const a = Math.abs(dT);
      if (a < nearestAbs) { nearestAbs = a; nearestI = i; nearestDT = dT; }
    }
    if (nearestAbs >= deadRad) {
      state.oscPhase = 0;
      return rawTarget;
    }
    const sign = nearestDT >= 0 ? 1 : -1;
    const edge = perps[nearestI] + sign * deadRad;
    if (!moving) {
      state.oscPhase = 0;
      return edge;
    }
    const amplitude = deps.angleDiff(edge, rawTarget);
    state.oscPhase = (state.oscPhase || 0) + dt * CREATURE_DEADZONE_OSC_RATE;
    return rawTarget + amplitude * Math.sin(state.oscPhase);
  }

  // 'snap' mode (see CREATURE_PLANE_ROT_MODE above; may not be the active
  // implementation, check that constant before assuming so).
  // Like 'sway', a creature is never allowed to settle mid-dead-zone —
  // but instead of continuously lerping/rocking through the zone, this
  // alternates the target between the dead zone's two boundary angles
  // (perp ± deadRad — the two nearest rotations actually outside the
  // dead zone) on a timer, and reports back whether this call is a flip
  // so the caller can assign the new value directly (a hard cut) rather
  // than easing toward it. The first time a given lock is entered isn't
  // flagged as a flip, so the plane still eases in from wherever it was
  // instead of popping in from nowhere; only the alternations after that
  // are instant.
  // Alternation only runs while `moving` is true — mirrors creatureDeadzoneTarget's
  // own moving gate (see 'sway' above): a creature standing still just
  // holds at whichever edge it's nearest, instead of visibly flip-flopping
  // in place with no motion to sell the "swap side" as a stride change.
  function creatureSnapSwayTarget(state, rawTarget, perps, deadRad, dt, moving) {
    let nearestI = 0, nearestAbs = Infinity, nearestDT = 0;
    for (let i = 0; i < perps.length; i++) {
      const dT = deps.angleDiff(rawTarget, perps[i]);
      const a = Math.abs(dT);
      if (a < nearestAbs) { nearestAbs = a; nearestI = i; nearestDT = dT; }
    }
    if (nearestAbs >= deadRad) {
      state.oscPhase = 0;
      state.snapSide = null;
      return { target: rawTarget, snap: false };
    }
    const P = perps[nearestI];
    if (!moving) {
      state.oscPhase = 0;
      if (state.snapSide === null) state.snapSide = nearestDT >= 0 ? 1 : -1;
      return { target: P + state.snapSide * deadRad, snap: false };
    }
    state.oscPhase = (state.oscPhase || 0) + dt * CREATURE_DEADZONE_OSC_RATE;
    const side = Math.sin(state.oscPhase) >= 0 ? 1 : -1;
    const flip = state.snapSide !== null && state.snapSide !== side;
    state.snapSide = side;
    return { target: P + side * deadRad, snap: flip };
  }

  function nearestCardinalAngle(angle) {
    const cardinals = [0, Math.PI / 2, Math.PI, -Math.PI / 2]; // E S W N
    let best = cardinals[0], bestDiff = Infinity;
    for (const c of cardinals) {
      const d = Math.abs(deps.angleDiff(c, angle));
      if (d < bestDiff) { bestDiff = d; best = c; }
    }
    return best;
  }

  window.PerpRotation = {
    init,
    perpClamp,
    clampedRotation,
    creatureDeadzoneTarget,
    creatureSnapSwayTarget,
    nearestCardinalAngle,
    PERP_DEAD_RAD,
    PERP_CENTER_HYSTERESIS_RAD,
    CREATURE_PERP_DEAD_RAD,
    CREATURE_PLANE_ROT_MODE,
  };
})();
