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
  let instrumentNoteAtMs = -Infinity; // Timestamp for that independent note; no weapon stance is required for flute playing.
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
    if (key !== 'flute') return false; // Kurraya has no body-sink request and keeps its existing held-assembly animation.
    instrumentNoteKey = key;
    instrumentNoteAtMs = performance.now();
    return true;
  }

  function endInstrumentNote() {
    instrumentNoteKey = null;
    instrumentNoteAtMs = -Infinity; // Exiting a music session must never leave a stale crouch behind.
  }

  function instrumentNotePose(now) {
    if (instrumentNoteKey !== 'flute') return null;
    const action = global.HeldActionAnimations?.flutePlayNote; // This is the same editable action the flute mouth mount samples.
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

    const ownsBody = global.ImpactRagdollPlayback?.isActive?.() || global.PlayerCrawl?.isActive?.(); // Ragdoll / crawl write their own leg and body pose.
    if (ownsBody || !enabled()) {
      legs.setStanceDrop(0, true);
      lastReason = ownsBody ? 'body-pose-owned' : 'disabled';
    } else {
      const engaged = stances.stanceEngaged();
      const now = performance.now();
      const swinging = engaged && now - swingSinkAtMs < SWING_SAMPLE_FRESH_MS && Number.isFinite(swingSinkPct);
      const notePose = swinging ? null : instrumentNotePose(now); // Actual combat attacks win; otherwise a sounded flute note takes priority over a carried weapon's idle stance.
      const playingNote = notePose !== null;
      const pct = swinging ? swingSinkPct
        : playingNote ? Math.max(0, Number(notePose.bodySink) || 0)
        : engaged ? (global.SharedAttackPose?.idleBodySinkPct?.() ?? 0) : 0;
      legs.setStanceYawDeg?.(swinging ? swingBodyYawDeg : playingNote ? (Number(notePose.bodyYaw) || 0) : (stances.idleBodyYawSnapshot?.(idleYaw).yawDeg || 0)); // The leg away from the authored turn leads.
      legs.setStanceDrop(pct / 100 * (legs.modelHeight || 0), swinging || playingNote); // Both attack and flute notes follow their pose; release remains eased.
      lastReason = swinging ? 'swing-pose' : playingNote ? 'instrument-note' : engaged ? 'idle-stance' : 'no-stance';
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
