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
  function init(injectedDeps) {
    deps = injectedDeps;
    installFarmAnimalsInitCapture();
  }

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

  const subjectByPerpState = new WeakMap(); // Caches persistent clamp state -> live subject so screen-view lookup is O(1) after the first frame.
  let farmAnimalObjects = null; // Captured from FarmAnimals.init; used to resolve farm livestock that do not live in Combat's creature registries.
  let farmWorldObjects = null; // Fallback farm/world object registry; used when an animal is temporarily absent from animalObjects during a transition.
  let cameraSample = null; // Reused across clamps in the same frame-sized window so camera debug access does not allocate per subject.
  let cameraSampleAtMs = -Infinity; // Timestamp used by liveCameraPosition to keep the shared camera sample very short-lived.
  let subjectWorldPosition = null; // Lazily-created THREE.Vector3 reused when a subject root has a transformed parent.

  function captureFarmAnimalDeps(injectedDeps) {
    farmAnimalObjects = injectedDeps?.animalObjects || farmAnimalObjects;
    farmWorldObjects = injectedDeps?.worldObjects || farmWorldObjects;
  }

  function installFarmAnimalsInitCapture() {
    const api = window.FarmAnimals;
    if (!api?.init || api.init.__perpScreenViewCapture) return;
    const originalInit = api.init;
    function capturedFarmAnimalsInit(injectedDeps) {
      captureFarmAnimalDeps(injectedDeps);
      return originalInit.call(this, injectedDeps);
    }
    Object.defineProperty(capturedFarmAnimalsInit, '__perpScreenViewCapture', { value: true });
    api.init = capturedFarmAnimalsInit;
  }

  function cameraRelativePerpsAtWorldPosition(worldPosition, cameraPosition) {
    const worldX = Number(worldPosition?.x), worldZ = Number(worldPosition?.z);
    const cameraX = Number(cameraPosition?.x), cameraZ = Number(cameraPosition?.z);
    if (![worldX, worldZ, cameraX, cameraZ].every(Number.isFinite)) return null;
    const dx = cameraX - worldX;
    const dz = cameraZ - worldZ;
    if (Math.hypot(dx, dz) < 1e-8) return null;
    const viewYawWorld = Math.atan2(dx, dz);
    return [viewYawWorld + Math.PI / 2, viewYawWorld - Math.PI / 2];
  }

  function liveCameraPosition() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (cameraSample && now - cameraSampleAtMs < 4) return cameraSample;
    const climbDebugPosition = window.__climbDebug?.getCameraDebug?.()?.camPos;
    const furnitureDebugPosition = window.__hobunjiFurnitureDebug?.camState?.position;
    const source = climbDebugPosition || furnitureDebugPosition;
    const x = Number(source?.x), y = Number(source?.y), z = Number(source?.z);
    if (![x, y, z].every(Number.isFinite)) return null;
    cameraSample = { x, y, z };
    cameraSampleAtMs = now;
    return cameraSample;
  }

  function findSubjectInCollection(collection, state, kind) {
    if (!collection || !state) return null;
    let values = collection;
    if (typeof collection.values === 'function') values = collection.values();
    if (!values || typeof values[Symbol.iterator] !== 'function') return null;
    for (const candidate of values) {
      if (candidate?.perpState === state) return { subject: candidate, kind };
    }
    return null;
  }

  function subjectForPerpState(state) {
    if (!state || typeof state !== 'object') return null;
    const cached = subjectByPerpState.get(state);
    if (cached?.subject?.perpState === state) return cached;

    const combatDeps = window.Combat?.deps;
    const sources = [
      [window._npcWalkers, 'npc'],
      [combatDeps?.hostileObjects, 'creature'],
      [combatDeps?.companionObjects, 'companion'],
      [combatDeps?.animalObjects, 'farm-animal'],
      [farmAnimalObjects, 'farm-animal'],
      [combatDeps?.worldObjects, 'world-animal'],
      [farmWorldObjects, 'world-animal'],
    ];
    for (const [collection, kind] of sources) {
      const found = findSubjectInCollection(collection, state, kind);
      if (!found) continue;
      subjectByPerpState.set(state, found);
      return found;
    }
    return null;
  }

  function subjectRoot(subject) {
    return subject?.root || subject?.avatarRef?.group || subject?.group || subject?.mesh || null;
  }

  function worldPositionForSubject(subject) {
    const root = subjectRoot(subject);
    if (root) {
      let worldPosition = root.position;
      if (typeof root.getWorldPosition === 'function' && typeof THREE.Vector3 === 'function') {
        subjectWorldPosition ||= new THREE.Vector3();
        worldPosition = root.getWorldPosition(subjectWorldPosition);
      }
      if ([Number(worldPosition?.x), Number(worldPosition?.z)].every(Number.isFinite)) return worldPosition;
    }
    const wx = Number(subject?.wx), wy = Number(subject?.wy), wz = Number(subject?.wz);
    if ([wx, wz].every(Number.isFinite)) return { x: wx, y: Number.isFinite(wy) ? wy : 0, z: wz };
    return null;
  }

  function perspectivePerpsForState(state, fallbackPerps) {
    const entry = subjectForPerpState(state);
    const cameraPosition = entry ? liveCameraPosition() : null;
    const worldPosition = entry ? worldPositionForSubject(entry.subject) : null;
    if (!entry || !cameraPosition || !worldPosition) return fallbackPerps;
    const resolved = cameraRelativePerpsAtWorldPosition(worldPosition, cameraPosition);
    if (!resolved) return fallbackPerps;

    const mode = entry.kind === 'npc' ? 'npc-world-camera-bearing' : `${entry.kind}-world-camera-bearing`;
    state.screenViewPerspectiveDebug = {
      mode,
      subjectKind: entry.kind,
      cameraPosition: { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z },
      subjectWorldPosition: { x: Number(worldPosition.x), y: Number(worldPosition.y) || 0, z: Number(worldPosition.z) },
      cameraPerpsRad: resolved.slice(),
    };
    // Preserve the older NPC-specific debug record for existing pixel-probe
    // consumers while every subject now uses the same shared resolver.
    if (entry.kind === 'npc') {
      state.npcPerspectiveDebug = {
        mode,
        cameraPosition: { ...state.screenViewPerspectiveDebug.cameraPosition },
        npcWorldPosition: { ...state.screenViewPerspectiveDebug.subjectWorldPosition },
        cameraPerpsRad: resolved.slice(),
      };
    }
    return resolved;
  }

  function applyPerspectiveDebugToProbe(state) {
    const perspective = state?.screenViewPerspectiveDebug;
    const probe = state?.pixelProbeDebug;
    if (!perspective || !probe) return;
    probe.cameraPerpsMode = perspective.mode;
    probe.subjectKind = perspective.subjectKind;
    probe.cameraPosition = { ...perspective.cameraPosition };
    probe.subjectWorldPosition = { ...perspective.subjectWorldPosition };
  }

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
    perps = perspectivePerpsForState(state, perps);
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
    applyPerspectiveDebugToProbe(state);
    return { effectiveTarget, snapTo };
  }

  // Applies perpClamp to a rendered rotation. Callers keep `rawTarget` as
  // their authored/logical facing so stationary models can be re-clamped
  // whenever the camera azimuth changes instead of baking in an old result.
  // perpClamp itself resolves a subject-specific world-to-camera bearing,
  // so NPCs, livestock, companions and combat creatures all share the same
  // perspective-aware screen-view deadzone behavior.
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
  const CREATURE_PLANE_ROT_MODE = 'snap'; // 'sway' | 'halt' | 'snap'

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
    perps = perspectivePerpsForState(state, perps);
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
    perps = perspectivePerpsForState(state, perps);
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

  // FarmAnimals is loaded before game.js but its deps arrive later via init().
  // Wrapping here lets the shared rotation module see livestock positions
  // without adding another dependency seam to game.js.
  installFarmAnimalsInitCapture();

  window.PerpRotation = {
    init,
    perpClamp,
    clampedRotation,
    cameraRelativePerpsAtWorldPosition,
    perspectivePerpsForState,
    creatureDeadzoneTarget,
    creatureSnapSwayTarget,
    nearestCardinalAngle,
    PERP_DEAD_RAD,
    PERP_CENTER_HYSTERESIS_RAD,
    CREATURE_PERP_DEAD_RAD,
    CREATURE_PLANE_ROT_MODE,
  };
})();
