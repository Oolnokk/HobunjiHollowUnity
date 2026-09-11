// Deterministic elevated-surface fall presentation.
// Horizontal travel follows the authored landing path; only vertical descent uses physics (gravity).
// The airborne pose reuses the authored zero-Footing breakThrow ragdoll clip without invoking combat knockdown rules.
(() => {
  'use strict';

  if (window.HobunjiGravityRagdollFalls) return;

  const GRAVITY_WORLD_S2 = 9.8; // Used as the only physics integration during elevated-surface falls.
  const RAGDOLL_BANK = 'breakThrow'; // Used to reuse the authored zero-Footing full-knockdown animation while airborne.
  const RAGDOLL_DIRECTION = 'front'; // Used as the canonical breakThrow blend pole for non-hit fall presentation.

  let updateHookInstalled = false; // Used to ensure ClimbSystem.updateClimb is wrapped only once.
  let installRetryRaf = 0; // Used to retry installation if parser ordering leaves ClimbSystem unavailable for one frame.
  let lastDebug = {
    active: false,
    motionModel: 'scripted-horizontal + gravity-vertical',
    gravityWorldPerSec2: GRAVITY_WORLD_S2,
    ragdollBank: RAGDOLL_BANK,
    ragdollTriggered: false,
    durationS: null,
    elapsedS: 0,
  }; // Used by Pixel Probe/mobile diagnostics without exposing hidden fall internals.

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;

  function playerEntity() {
    return window.Combat?.deps?.player || null;
  }

  function gravityDuration(dropWorld) {
    const drop = Math.max(0, Number(dropWorld) || 0); // Used to derive time-to-impact from rest under constant gravity.
    return drop > 0 ? Math.sqrt((2 * drop) / GRAVITY_WORLD_S2) : 0;
  }

  function triggerFallRagdoll(state) {
    const playback = window.ImpactRagdollPlayback;
    const clip = window.ImpactBlendLibrary?.getClip?.(RAGDOLL_BANK, RAGDOLL_DIRECTION);
    if (!playback?.trigger || !clip?.durationSeconds) return false;
    const durationMultiplier = Math.max(0.01, state._gravityDurationS / clip.durationSeconds); // Used to make the authored throw span the gravity fall exactly.
    playback.trigger(RAGDOLL_BANK, RAGDOLL_DIRECTION, { durationMultiplier });
    return true;
  }

  function initializeGravityFall(state) {
    if (!state || state._gravityFallInitialized) return;
    state._gravityFallInitialized = true;
    state._gravityElapsedS = 0;
    state._gravityDurationS = Math.max(0.001, gravityDuration(state.dropWorld));
    state._gravityRagdollTriggered = triggerFallRagdoll(state);
    // The underlying landing owner only runs once at impact. Matching its duration
    // lets that final call finish/snap/charge Footing without replaying its old eased descent.
    state.duration = state._gravityDurationS;
    state.elapsed = 0;
    lastDebug = {
      active: true,
      motionModel: 'scripted-horizontal + gravity-vertical',
      gravityWorldPerSec2: GRAVITY_WORLD_S2,
      ragdollBank: RAGDOLL_BANK,
      ragdollTriggered: state._gravityRagdollTriggered,
      durationS: state._gravityDurationS,
      elapsedS: 0,
    };
  }

  function maybeTriggerLateRagdoll(state) {
    if (state._gravityRagdollTriggered) return;
    // Animation JSON loads asynchronously at boot. If a very early fall starts
    // before it is ready, begin playback on the first frame where the clip exists.
    state._gravityRagdollTriggered = triggerFallRagdoll(state);
    if (state._gravityRagdollTriggered) lastDebug.ragdollTriggered = true;
  }

  function updateGravityFall(player, state, dt, previousUpdateClimb) {
    initializeGravityFall(state);
    maybeTriggerLateRagdoll(state);

    const step = clamp(Number(dt) || 0, 0, 0.1);
    state._gravityElapsedS = Math.min(state._gravityDurationS, state._gravityElapsedS + step);
    const t = clamp(state._gravityElapsedS / state._gravityDurationS, 0, 1); // Used only to traverse the pre-authored horizontal start/end path.

    // No horizontal physics: the player follows the known safe landing path at
    // constant scripted progress. No momentum, friction, bounce, or collision response.
    player.x = lerp(state.startX, state.endX, t);
    player.y = lerp(state.startY, state.endY, t);

    // Gravity is the sole physical simulation: start from vertical rest and
    // accelerate downward at constant g until the authored landing surface.
    const fallenWorld = 0.5 * GRAVITY_WORLD_S2 * state._gravityElapsedS * state._gravityElapsedS;
    player.climbSurfaceY = Math.max(state.endSurfaceY, state.startSurfaceY - fallenWorld);
    player.climbHopBounce = 0;
    player.vx = 0;
    player.vy = 0;

    lastDebug.active = true;
    lastDebug.elapsedS = state._gravityElapsedS;
    lastDebug.durationS = state._gravityDurationS;
    lastDebug.ragdollTriggered = !!state._gravityRagdollTriggered;

    if (t < 1) return true;

    // breakThrow normally holds its final prone pose after a zero-Footing hit.
    // A fall is not itself that combat event, so release only the visual channel
    // at impact and let the existing fall landing owner decide roll/prone state.
    window.ImpactRagdollPlayback?.stop?.();
    state.elapsed = state.duration;
    const result = previousUpdateClimb(0); // Executes the existing exact landing snap + Footing/roll rules once.
    lastDebug.active = false;
    lastDebug.elapsedS = state._gravityDurationS;
    return result;
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
    const previousUpdateClimb = system.updateClimb.bind(system); // Used for normal climbs and for the one authoritative landing tick.
    function gravityRagdollFallUpdate(dt) {
      const player = playerEntity();
      const state = player?._hobunjiFallState;
      if (!state) return previousUpdateClimb(dt);
      return updateGravityFall(player, state, dt, previousUpdateClimb);
    }
    gravityRagdollFallUpdate.__hobunjiGravityRagdollFall = true;
    system.updateClimb = gravityRagdollFallUpdate;
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
        const line = `Fall motion model: scripted horizontal / gravity-only vertical (g=${GRAVITY_WORLD_S2.toFixed(1)}u/s²) ragdoll=${RAGDOLL_BANK}${d.ragdollTriggered ? '/active' : ''}`;
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
    gravityWorldPerSec2: GRAVITY_WORLD_S2,
    ragdollBank: RAGDOLL_BANK,
    gravityDuration,
    installUpdateHook: ensureUpdateHook,
    getDebug() {
      return { ...lastDebug, updateHookInstalled, installRetryPending: !!installRetryRaf };
    },
  });
})();
