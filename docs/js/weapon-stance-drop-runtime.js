// Sinks the player's whole rendered body while a weapon stance or attack is engaged, so stances read less rigid.
//
// The depth is the pose channel `bodySink` (percent of the avatar's total height, SharedAttackPose): the Light/Heavy idle stance rests at
// SharedAttackPose.idleBodySinkPct() (proceduralFeet.stanceDrop.heightFraction), and an attack animation authors its own Windup/Strike
// values in the attack animation editor, lerped across the swing by SharedAttackPose.samplePose. game.js reports each frame's sampled value
// through noteSwingSink().
//
// The portrait, hands, held weapon and every other composer-owned visual sink via a translation channel. The leg handle
// (ProceduralLegAnimation setStanceDrop) keeps the feet planted: its group is raised by the same amount, so the hips stay put in
// body space while the soles rise toward them, and the fixed-length two-bone fold bends the knees. The leg handle owns easing and gating
// (seated, mounted, airborne...) and reports the sink it really applied; this channel lowers by exactly that.
(function (global) {
  'use strict';

  const CHANNEL = 'weapon-stance-drop';
  const SWING_SAMPLE_FRESH_MS = 120; // A swing sample older than this means no swing is playing any more.
  let lastDrop = 0;
  let lastReason = 'waiting';
  let lastComposer = null;
  let lastPlayerMesh = null;
  let swingSinkPct = NaN;
  let swingSinkAtMs = -Infinity;
  let swingBodyYawDeg = 0;
  let instrumentNoteKey = null; // Latest sounded musical note, sampled below only while its authored animation is active.
  let instrumentNoteAtMs = -Infinity; // Timestamp for the flute or Kurraya note; no weapon stance is required while playing.
  const idleYaw = { active: false, yawDeg: 0, reason: '' }; // Reused; refilled by WeaponToolStances.idleBodyYawSnapshot.

  function enabled() {
    return global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.stanceDrop?.enabled !== false;
  }

  // Called by game.js every frame the player's authored swing pose is sampled (percent of height; NaN = the pose authors none).
  function noteSwingSink(pct, bodyYawDeg = 0) {
    swingSinkPct = Number(pct);
    swingBodyYawDeg = Number(bodyYawDeg) || 0;
    swingSinkAtMs = performance.now();
  }

  function beginInstrumentNote(key) {
    if (key !== 'flute' && key !== 'kurraya') return false; // Only authored instrument notes may own this separate leg/body channel.
    instrumentNoteKey = key;
    instrumentNoteAtMs = performance.now();
    return true;
  }

  function endInstrumentNote() {
    instrumentNoteKey = null;
    instrumentNoteAtMs = -Infinity; // Exiting a music session must never leave a stale crouch behind.
  }

  function instrumentNotePose(now) {
    const action = instrumentNoteKey === 'flute' ? global.HeldActionAnimations?.flutePlayNote
      : instrumentNoteKey === 'kurraya' ? global.HeldActionAnimations?.kurrayaPlayNote : null; // Both instruments sample their own actual exported action.
    const durationMs = Math.max(50, (Number(action?.durationS) || 0) * 1000);
    const elapsedMs = now - instrumentNoteAtMs;
    if (!action || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= durationMs) return null;
    return global.KurrayaInstrument?.notePoseAt?.(action, elapsedMs / durationMs) || null;
  }

  function sync() {
    const composer = global.PlayerBodyTransformComposer;
    const legs = composer?.getPlayerLegHandle?.();
    const stances = global.WeaponToolStances;
    if (!composer?.setChannel || !legs?.setStanceDrop || !stances?.stanceEngaged) { lastReason = 'waiting-for-runtime'; return; }

    const playerMesh = composer.getPlayerMesh?.() || null;
    const composerChanged = composer !== lastComposer || playerMesh !== lastPlayerMesh;
    lastComposer = composer;
    lastPlayerMesh = playerMesh;
    if (global.CharacterActionLocks?.isLocked?.('player', 'pose')) {
      // Paired animations (festival dance, spouse kiss) own the real knees, pants and yaw.
      // A weapon/tool's idle stance must not replace their knee depth or leg twist AFTER the pose frame.
      composer.clearChannel(CHANNEL);
      lastDrop = 0; // Forces the normal weapon sink to be recalculated on the first unlocked frame.
      lastReason = 'paired-pose-owned'; // Exposed in mobile diagnostics for a pose/weapon conflict.
      return;
    }

    const ownsBody = global.ImpactRagdollPlayback?.isActive?.() || global.PlayerCrawl?.isActive?.(); // Ragdoll / crawl write their own leg and body pose.
    if (ownsBody || !enabled()) {
      legs.setStanceDrop(0, true);
      lastReason = ownsBody ? 'body-pose-owned' : 'disabled';
    } else {
      const engaged = stances.stanceEngaged();
      const now = performance.now();
      const swinging = engaged && now - swingSinkAtMs < SWING_SAMPLE_FRESH_MS && Number.isFinite(swingSinkPct);
      const notePose = swinging ? null : instrumentNotePose(now); // Actual combat attacks win; either sounded instrument note takes priority over idle stance.
      const playingNote = notePose !== null;
      const instrumentKey = global.KurrayaInstrument?.activePlayerInstrument?.() || null; // Allocation-free session owner; never ask diagnostic snapshot getters on the per-frame path.
      const neutralAction = instrumentKey === 'flute' ? global.HeldActionAnimations?.flutePlayNote
        : instrumentKey === 'kurraya' ? global.HeldActionAnimations?.kurrayaPlayNote : null;
      const instrumentPose = notePose || neutralAction?.poses?.neutral || null; // Editor Neutral takes priority over an equipped weapon's stance during silence.
      const pct = swinging ? swingSinkPct
        : instrumentPose ? Math.max(0, Number(instrumentPose.bodySink) || 0)
        : engaged ? (global.SharedAttackPose?.idleBodySinkPct?.() ?? 0) : 0;
      legs.setStanceYawDeg?.(swinging ? swingBodyYawDeg : instrumentPose ? (Number(instrumentPose.bodyYaw) || 0) : (stances.idleBodyYawSnapshot?.(idleYaw).yawDeg || 0)); // Instrument Neutral must never inherit the sheathed weapon's turn.
      legs.setStanceDrop(pct / 100 * (legs.modelHeight || 0), swinging || playingNote); // Normal note animation uses the authored sink; silence returns to the authored Neutral.
      lastReason = swinging ? 'swing-pose' : playingNote ? 'instrument-note' : instrumentPose ? 'instrument-neutral' : engaged ? 'idle-stance' : 'no-stance';
    }

    const applied = ownsBody || !enabled() ? 0 : legs.getStanceDrop();
    if (applied > 1e-5) {
      if (composerChanged || applied !== lastDrop) composer.setChannel(CHANNEL, {
        priority: 4,
        mode: 'additive',
        translation: { x: 0, y: -applied, z: 0 },
      });
    } else if (lastDrop > 0 || composerChanged) {
      composer.clearChannel(CHANNEL);
    }
    lastDrop = applied > 1e-5 ? applied : 0;
  }

  global.WeaponStanceDropRuntime = {
    channel: CHANNEL,
    noteSwingSink,
    beginInstrumentNote,
    endInstrumentNote,
    getDebug: () => ({ drop: lastDrop, reason: lastReason, swingSinkPct, instrumentNoteKey, instrumentNoteActive: instrumentNotePose(performance.now()) !== null }),
  };

  global.RuntimeFrameScheduler.register('weapon-stance-drop-sync', sync, {
    phase: 'pre-render',
    owner: 'WeaponStanceDropRuntime',
    description: 'Sinks the player body for weapon stances and swing poses and asks the legs to fold the knees to match.',
  });
})(window);
