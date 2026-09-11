// SM64-style elevated-surface fall presentation.
// This is a small character controller, not rigid-body simulation: fixed-step gravity,
// terminal fall speed, four quarter-steps per tick, authored carry, and limited air control.
// The airborne pose reuses the authored zero-Footing breakThrow ragdoll clip.
(() => {
  'use strict';

  if (window.HobunjiGravityRagdollFalls) return;

  const SIM_HZ = 30; // Used by the fall controller to mirror SM64's frame-stepped airborne motion.
  const FIXED_STEP_S = 1 / SIM_HZ;
  const QUARTER_STEPS = 4; // Used by each fixed tick, matching SM64's four air qsteps.
  const GRAVITY_PER_STEP_WORLD = 0.01; // Scaled SM64-style gravity: velocity loses a fixed amount per 30 Hz tick.
  const TERMINAL_FALL_PER_STEP_WORLD = 0.1875; // Preserves SM64's 75:4 terminal/gravity ratio at Hobunji vertical scale.
  const AIR_CONTROL_ACCEL_TILE_PER_STEP2 = 0.0025; // Used by fresh stick/keyboard input to steer the airborne path without rigid-body forces.
  const AIR_CONTROL_MAX_TILE_PER_STEP = 0.05; // Caps steering velocity separately from the authored forward carry.
  const AIR_CONTROL_DRAG = 0.94; // Damps only the steering component each fixed tick; authored carry is not friction-simulated.
  const AIR_CONTROL_MAX_OFFSET_TILES = 0.45; // Keeps steering close enough to the prevalidated safe landing corridor.
  const MAX_CATCHUP_STEPS = 8; // Prevents a long browser hitch from simulating an unbounded number of fall ticks at once.
  const RAGDOLL_BANK = 'breakThrow'; // Used to reuse the authored zero-Footing full-knockdown animation while airborne.
  const RAGDOLL_DIRECTION = 'front'; // Used as the canonical breakThrow blend pole for a non-hit fall.

  let updateHookInstalled = false; // Used to ensure ClimbSystem.updateClimb is wrapped only once.
  let initCaptureInstalled = false; // Used to capture the exact ClimbSystem runtime deps once without replacing its behavior.
  let climbDeps = null; // Used by airborne steering for the same fresh getMovementInput authority as branch/climb movement.
  let installRetryRaf = 0; // Used to retry installation if parser ordering leaves ClimbSystem unavailable for one frame.
  let lastDebug = {
    active: false,
    motionModel: 'SM64-style fixed-step character fall',
    simHz: SIM_HZ,
    gravityPerStepWorld: GRAVITY_PER_STEP_WORLD,
    terminalFallPerStepWorld: TERMINAL_FALL_PER_STEP_WORLD,
    quarterSteps: QUARTER_STEPS,
    ragdollBank: RAGDOLL_BANK,
    ragdollTriggered: false,
    predictedDurationS: null,
    elapsedS: 0,
    verticalVelocityPerStep: 0,
    airInput: null,
    airControlVelocity: null,
  }; // Used by Pixel Probe/mobile diagnostics without exposing hidden fall internals.

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function playerEntity() {
    return climbDeps?.player || window.Combat?.deps?.player || null;
  }

  function tileSize() {
    return Math.max(1, Number(climbDeps?.TILE || window.Combat?.deps?.TILE) || 64);
  }

  function captureClimbDeps(system) {
    if (!system?.init || system.init.__hobunjiSm64FallDepsCapture) return false;
    const previousInit = system.init;
    function sm64FallDepsCapture(injectedDeps) {
      climbDeps = injectedDeps || climbDeps;
      return previousInit.apply(this, arguments);
    }
    sm64FallDepsCapture.__hobunjiSm64FallDepsCapture = true;
    system.init = sm64FallDepsCapture;
    initCaptureInstalled = true;
    return true;
  }

  function freshMovementInput(player) {
    const fresh = climbDeps?.getMovementInput?.(); // Same current-frame keyboard/stick vector used by ClimbSystem branch movement.
    if (fresh && Number.isFinite(Number(fresh.x)) && Number.isFinite(Number(fresh.y))) {
      return { x: Number(fresh.x) || 0, y: Number(fresh.y) || 0, source: 'getMovementInput' };
    }
    return {
      x: Number(player?.inputX) || 0,
      y: Number(player?.inputY) || 0,
      source: 'player.input',
    };
  }

  // SM64 moves using the current Y velocity, then applies gravity at the end of
  // the frame. Simulate that exact ordering to predict how many 30 Hz ticks a
  // drop needs, including the terminal-velocity cap.
  function fallStepCount(dropWorld) {
    const drop = Math.max(0, Number(dropWorld) || 0);
    if (!(drop > 0)) return 0;
    let fallen = 0;
    let velY = 0;
    let steps = 0;
    while (fallen < drop && steps < 10000) {
      fallen += Math.max(0, -velY);
      velY = Math.max(-TERMINAL_FALL_PER_STEP_WORLD, velY - GRAVITY_PER_STEP_WORLD);
      steps++;
    }
    return Math.max(1, steps);
  }

  function gravityDuration(dropWorld) {
    return fallStepCount(dropWorld) * FIXED_STEP_S;
  }

  function triggerFallRagdoll(state) {
    const playback = window.ImpactRagdollPlayback;
    const clip = window.ImpactBlendLibrary?.getClip?.(RAGDOLL_BANK, RAGDOLL_DIRECTION);
    if (!playback?.trigger || !clip?.durationSeconds) return false;
    const durationMultiplier = Math.max(0.01, state._sm64PredictedDurationS / clip.durationSeconds); // Used to span the authored throw across the predicted fall time.
    playback.trigger(RAGDOLL_BANK, RAGDOLL_DIRECTION, { durationMultiplier });
    return true;
  }

  function initializeFall(state) {
    if (!state || state._sm64FallInitialized) return;
    state._sm64FallInitialized = true;
    state._sm64AccumulatorS = 0;
    state._sm64ElapsedS = 0;
    state._sm64VelYStep = 0;
    state._sm64StepsTotal = fallStepCount(state.dropWorld);
    state._sm64StepsDone = 0;
    state._sm64PredictedDurationS = Math.max(FIXED_STEP_S, state._sm64StepsTotal * FIXED_STEP_S);

    // Horizontal carry remains kinematic. The fall detector already selected a
    // safe lower destination, so divide that authored displacement across the
    // predicted airborne ticks and layer a small steering velocity on top.
    state._sm64BaseVelXStep = (Number(state.endX) - Number(state.startX)) / state._sm64StepsTotal;
    state._sm64BaseVelZStep = (Number(state.endY) - Number(state.startY)) / state._sm64StepsTotal;
    state._sm64ControlVelXStep = 0;
    state._sm64ControlVelZStep = 0;
    state._sm64RagdollTriggered = triggerFallRagdoll(state);

    // The underlying owner is still responsible for the exact landing snap and
    // Footing/roll result. Setting its duration lets one zero-dt handoff finish it.
    state.duration = state._sm64PredictedDurationS;
    state.elapsed = 0;

    lastDebug = {
      active: true,
      motionModel: 'SM64-style fixed-step character fall',
      simHz: SIM_HZ,
      gravityPerStepWorld: GRAVITY_PER_STEP_WORLD,
      terminalFallPerStepWorld: TERMINAL_FALL_PER_STEP_WORLD,
      quarterSteps: QUARTER_STEPS,
      ragdollBank: RAGDOLL_BANK,
      ragdollTriggered: state._sm64RagdollTriggered,
      predictedDurationS: state._sm64PredictedDurationS,
      elapsedS: 0,
      verticalVelocityPerStep: 0,
      airInput: null,
      airControlVelocity: { x: 0, y: 0 },
    };
  }

  function maybeTriggerLateRagdoll(state) {
    if (state._sm64RagdollTriggered) return;
    state._sm64RagdollTriggered = triggerFallRagdoll(state);
    if (state._sm64RagdollTriggered) lastDebug.ragdollTriggered = true;
  }

  function updateAirControl(player, state) {
    const input = freshMovementInput(player);
    const len = Math.hypot(input.x, input.y);
    const strength = clamp(len, 0, 1);
    const nx = len > 1e-6 ? input.x / len : 0;
    const ny = len > 1e-6 ? input.y / len : 0;
    const tile = tileSize();

    state._sm64ControlVelXStep *= AIR_CONTROL_DRAG;
    state._sm64ControlVelZStep *= AIR_CONTROL_DRAG;
    if (strength > 0) {
      const accel = AIR_CONTROL_ACCEL_TILE_PER_STEP2 * tile * strength;
      state._sm64ControlVelXStep += nx * accel;
      state._sm64ControlVelZStep += ny * accel;
    }

    const controlSpeed = Math.hypot(state._sm64ControlVelXStep, state._sm64ControlVelZStep);
    const controlCap = AIR_CONTROL_MAX_TILE_PER_STEP * tile;
    if (controlSpeed > controlCap && controlSpeed > 1e-6) {
      const scale = controlCap / controlSpeed;
      state._sm64ControlVelXStep *= scale;
      state._sm64ControlVelZStep *= scale;
    }

    lastDebug.airInput = { x: input.x, y: input.y, source: input.source };
    lastDebug.airControlVelocity = { x: state._sm64ControlVelXStep, y: state._sm64ControlVelZStep };
  }

  function constrainToSafeCorridor(player, state) {
    const progress = clamp(state._sm64StepsDone / state._sm64StepsTotal, 0, 1);
    const anchorX = Number(state.startX) + (Number(state.endX) - Number(state.startX)) * progress;
    const anchorY = Number(state.startY) + (Number(state.endY) - Number(state.startY)) * progress;
    const dx = player.x - anchorX;
    const dy = player.y - anchorY;
    const offset = Math.hypot(dx, dy);
    const maxOffset = AIR_CONTROL_MAX_OFFSET_TILES * tileSize();
    if (offset > maxOffset && offset > 1e-6) {
      const scale = maxOffset / offset;
      player.x = anchorX + dx * scale;
      player.y = anchorY + dy * scale;
    }
  }

  function finishFall(player, state, previousUpdateClimb) {
    // breakThrow normally holds a settled prone pose after a zero-Footing hit.
    // Falling borrows only its authored animation, not its combat state.
    window.ImpactRagdollPlayback?.stop?.();
    player.x = state.endX;
    player.y = state.endY;
    player.climbSurfaceY = state.endSurfaceY;
    state.elapsed = state.duration;
    const result = previousUpdateClimb(0); // Existing landing snap + Footing/roll rules remain authoritative.
    lastDebug.active = false;
    lastDebug.elapsedS = state._sm64ElapsedS;
    lastDebug.verticalVelocityPerStep = state._sm64VelYStep;
    return result;
  }

  function simulateFixedStep(player, state) {
    updateAirControl(player, state);
    const vx = state._sm64BaseVelXStep + state._sm64ControlVelXStep;
    const vz = state._sm64BaseVelZStep + state._sm64ControlVelZStep;
    const qx = vx / QUARTER_STEPS;
    const qz = vz / QUARTER_STEPS;
    const qy = state._sm64VelYStep / QUARTER_STEPS;

    // SM64-style qsteps: split one airborne movement tick into four smaller
    // positional moves. The plateau's incline wall is intentionally traversed;
    // the lower target was already validated by the fall detector.
    for (let q = 0; q < QUARTER_STEPS; q++) {
      player.x += qx;
      player.y += qz;
      player.climbSurfaceY = Math.max(state.endSurfaceY, player.climbSurfaceY + qy);
    }

    state._sm64StepsDone++;
    state._sm64ElapsedS += FIXED_STEP_S;
    constrainToSafeCorridor(player, state);

    // Like ordinary SM64 airborne movement, gravity is applied after positional
    // movement and falling speed is capped at terminal velocity.
    state._sm64VelYStep = Math.max(
      -TERMINAL_FALL_PER_STEP_WORLD,
      state._sm64VelYStep - GRAVITY_PER_STEP_WORLD,
    );

    player.climbHopBounce = 0;
    player.vx = vx * SIM_HZ; // Kinematic ground-plane velocity only; ground movement remains suspended while climbing=true.
    player.vy = vz * SIM_HZ;

    lastDebug.active = true;
    lastDebug.elapsedS = state._sm64ElapsedS;
    lastDebug.verticalVelocityPerStep = state._sm64VelYStep;
    lastDebug.ragdollTriggered = !!state._sm64RagdollTriggered;

    return state._sm64StepsDone >= state._sm64StepsTotal || player.climbSurfaceY <= state.endSurfaceY + 1e-6;
  }

  function updateFall(player, state, dt, previousUpdateClimb) {
    initializeFall(state);
    maybeTriggerLateRagdoll(state);

    state._sm64AccumulatorS += clamp(Number(dt) || 0, 0, 0.25);
    let catchup = 0;
    while (state._sm64AccumulatorS >= FIXED_STEP_S && catchup < MAX_CATCHUP_STEPS) {
      state._sm64AccumulatorS -= FIXED_STEP_S;
      catchup++;
      if (simulateFixedStep(player, state)) return finishFall(player, state, previousUpdateClimb);
    }
    return true;
  }

  function installUpdateHook() {
    // Force the existing plateau module to install its own ClimbSystem hook first;
    // with no initialized player during parser boot this cannot start a fall.
    window.HobunjiPlateauFalls?.probe?.();
    const system = window.ClimbSystem;
    if (!system?.updateClimb) return false;
    captureClimbDeps(system);
    if (system.updateClimb.__hobunjiGravityRagdollFall) {
      updateHookInstalled = true;
      return true;
    }
    const previousUpdateClimb = system.updateClimb.bind(system); // Used for normal climbs and the one authoritative landing tick.
    function sm64StyleFallUpdate(dt) {
      const player = playerEntity();
      const state = player?._hobunjiFallState;
      if (!state) return previousUpdateClimb(dt);
      return updateFall(player, state, dt, previousUpdateClimb);
    }
    sm64StyleFallUpdate.__hobunjiGravityRagdollFall = true;
    system.updateClimb = sm64StyleFallUpdate;
    updateHookInstalled = true;
    return true;
  }

  function ensureUpdateHook() {
    if (installUpdateHook()) return true;
    if (installRetryRaf || typeof window.requestAnimationFrame !== 'function') return false;
    const retry = () => {
      installRetryRaf = 0;
      if (installUpdateHook()) return;
      installRetryRaf = window.requestAnimationFrame(retry);
    };
    installRetryRaf = window.requestAnimationFrame(retry);
    return false;
  }

  function installProbeReportHook() {
    const install = () => {
      const report = document.getElementById('debugProbeResult');
      if (!report || typeof MutationObserver !== 'function' || report.__hobunjiGravityFallObserved) return;
      report.__hobunjiGravityFallObserved = true;
      let appending = false;
      const observer = new MutationObserver(() => {
        if (appending) return;
        const text = report.textContent || '';
        if (!text.startsWith('Pixel Probe report') || text.includes('Fall motion model:')) return;
        const d = { ...lastDebug };
        const inputText = d.airInput ? `${d.airInput.source}(${Number(d.airInput.x).toFixed(2)},${Number(d.airInput.y).toFixed(2)})` : '-';
        const line = `Fall motion model: SM64-style ${SIM_HZ}Hz / gravity=${GRAVITY_PER_STEP_WORLD.toFixed(4)}u-step / terminal=-${TERMINAL_FALL_PER_STEP_WORLD.toFixed(4)}u-step / qsteps=${QUARTER_STEPS} / air=${inputText} / ragdoll=${RAGDOLL_BANK}${d.ragdollTriggered ? '/active' : ''}`;
        appending = true;
        report.textContent = `${text}${text.endsWith('\n') ? '' : '\n'}${line}`;
        appending = false;
      });
      observer.observe(report, { childList: true, characterData: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }

  ensureUpdateHook();
  installProbeReportHook();

  window.HobunjiGravityRagdollFalls = Object.freeze({
    simHz: SIM_HZ,
    fixedStepSeconds: FIXED_STEP_S,
    gravityPerStepWorld: GRAVITY_PER_STEP_WORLD,
    terminalFallPerStepWorld: TERMINAL_FALL_PER_STEP_WORLD,
    quarterSteps: QUARTER_STEPS,
    airControlAccelTilePerStep2: AIR_CONTROL_ACCEL_TILE_PER_STEP2,
    airControlMaxTilePerStep: AIR_CONTROL_MAX_TILE_PER_STEP,
    gravityWorldPerSec2: GRAVITY_PER_STEP_WORLD * SIM_HZ * SIM_HZ, // Equivalent acceleration for older diagnostics only.
    ragdollBank: RAGDOLL_BANK,
    fallStepCount,
    gravityDuration,
    installUpdateHook: ensureUpdateHook,
    getDebug() {
      return {
        ...lastDebug,
        updateHookInstalled,
        initCaptureInstalled,
        climbDepsCaptured: !!climbDeps,
        installRetryPending: !!installRetryRaf,
      };
    },
  });
})();
