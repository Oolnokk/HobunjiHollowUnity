// SM64-style elevated-surface fall presentation.
// This is a small character controller, not rigid-body simulation: fixed-step gravity,
// terminal fall speed, four quarter-steps per tick, and authored horizontal carry.
// The airborne pose reuses the authored zero-Footing breakThrow ragdoll clip.
(() => {
  'use strict';

  if (window.HobunjiGravityRagdollFalls) return;

  const SIM_HZ = 30; // Used by the fall controller to mirror SM64's frame-stepped airborne motion.
  const FIXED_STEP_S = 1 / SIM_HZ;
  const QUARTER_STEPS = 4; // Used by each fixed tick, matching SM64's four air qsteps.
  const GRAVITY_PER_STEP_WORLD = 0.01; // Scaled SM64-style gravity: velocity loses a fixed amount per 30 Hz tick.
  const TERMINAL_FALL_PER_STEP_WORLD = 0.1875; // Preserves SM64's 75:4 terminal/gravity ratio at Hobunji vertical scale.
  const MAX_CATCHUP_STEPS = 8; // Prevents a long browser hitch from simulating an unbounded number of fall ticks at once.
  const RAGDOLL_BANK = 'breakThrow'; // Used to reuse the authored zero-Footing full-knockdown animation while airborne.
  const RAGDOLL_DIRECTION = 'front'; // Used as the canonical breakThrow blend pole for a non-hit fall.

  let updateHookInstalled = false; // Used to ensure ClimbSystem.updateClimb is wrapped only once.
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
  }; // Used by Pixel Probe/mobile diagnostics without exposing hidden fall internals.

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function playerEntity() {
    return window.Combat?.deps?.player || null;
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

    // Horizontal motion is deliberately not simulated as a rigid body. The safe
    // landing target was authored/detected before the fall; carry it as constant
    // per-tick displacement so the character has Mario-like airborne velocity
    // without momentum/bounce/friction physics.
    state._sm64VelXStep = (Number(state.endX) - Number(state.startX)) / state._sm64StepsTotal;
    state._sm64VelZStep = (Number(state.endY) - Number(state.startY)) / state._sm64StepsTotal;
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
    };
  }

  function maybeTriggerLateRagdoll(state) {
    if (state._sm64RagdollTriggered) return;
    state._sm64RagdollTriggered = triggerFallRagdoll(state);
    if (state._sm64RagdollTriggered) lastDebug.ragdollTriggered = true;
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
    const qx = state._sm64VelXStep / QUARTER_STEPS;
    const qz = state._sm64VelZStep / QUARTER_STEPS;
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

    // Like ordinary SM64 airborne movement, gravity is applied after positional
    // movement and falling speed is capped at terminal velocity.
    state._sm64VelYStep = Math.max(
      -TERMINAL_FALL_PER_STEP_WORLD,
      state._sm64VelYStep - GRAVITY_PER_STEP_WORLD,
    );

    player.climbHopBounce = 0;
    player.vx = state._sm64VelXStep * SIM_HZ; // Presentation/debug velocity only; normal ground movement remains suspended while climbing=true.
    player.vy = state._sm64VelZStep * SIM_HZ;

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
    // with no initialized Combat player during parser boot this cannot start a fall.
    window.HobunjiPlateauFalls?.probe?.();
    const system = window.ClimbSystem;
    if (!system?.updateClimb) return false;
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
        const line = `Fall motion model: SM64-style ${SIM_HZ}Hz / gravity=${GRAVITY_PER_STEP_WORLD.toFixed(4)}u-step / terminal=-${TERMINAL_FALL_PER_STEP_WORLD.toFixed(4)}u-step / qsteps=${QUARTER_STEPS} / ragdoll=${RAGDOLL_BANK}${d.ragdollTriggered ? '/active' : ''}`;
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
    gravityWorldPerSec2: GRAVITY_PER_STEP_WORLD * SIM_HZ * SIM_HZ, // Equivalent acceleration for older diagnostics only.
    ragdollBank: RAGDOLL_BANK,
    fallStepCount,
    gravityDuration,
    installUpdateHook: ensureUpdateHook,
    getDebug() {
      return { ...lastDebug, updateHookInstalled, installRetryPending: !!installRetryRaf };
    },
  });
})();
