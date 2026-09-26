// Ordinary (non-authored) NPC dialogue camera framing.
//
// Extracted from game.js's beginNpcDialogueStaging, which used to set the
// dialogue camera azimuth ONCE to "whatever the camera azimuth was when Talk
// was pressed + 15°". That was only correct when the gameplay camera happened
// to sit behind the player looking at the NPC. Talking to an NPC from any
// other angle (camera beside or behind the NPC, player walking up from the
// far side, a mid-orbit shoulder camera...) left the camera staring at the
// NPC's back, or with the player's portrait parked directly over the NPC's
// face, because the player/NPC/camera geometry was never consulted.
//
// This module derives the azimuth from the live player/NPC positions every
// frame instead:
//   - the camera always sits on the PLAYER's side of the NPC, the side the
//     NPC turns to face during dialogue, so it sees the NPC's face;
//   - it is swung sideways around the NPC by at least cameraSideAngleDeg,
//     and by however much more is needed for the player's silhouette
//     (playerClearanceTiles half-width) to clear the camera→NPC sightline;
//   - which side (left/right) is picked once per conversation, whichever
//     is nearer the camera's view when Talk was pressed, and then held so
//     the shot never flips mid-conversation;
//   - the azimuth eases from that interaction-time view to the target so
//     entering dialogue reads as a camera move rather than a jump cut;
//   - both that ease and the camera's slide onto the NPC (followAlpha) run on
//     real elapsed time, not frame count. game.js caps its own dt at 40ms and
//     used a fixed per-frame follow lerp, so a hitch while the conversation
//     opened (portrait/expression textures load right then) could leave the
//     camera still aimed at the player's old spot, with the NPC off-screen.
// game.js still owns the camera itself (updateCameraPosition) and just writes
// the returned azimuth into cameraAzimuthOffsetDeg.
(() => {
  'use strict';

  let deps = null;
  let session = null; // { entryAzimuthRad, currentAzimuthRad, sideSign, lastTarget, lastUpdateMs, lastElapsed } for the open conversation only.
  const MAX_ELAPSED_SECONDS = 0.25; // Upper bound on one step so a tab-switch doesn't make the first frame back a hard cut.

  function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function init(injectedDeps) {
    deps = injectedDeps || {};
  }

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function angleDiff(a, b) {
    let d = (a - b + Math.PI) % (Math.PI * 2);
    if (d < 0) d += Math.PI * 2;
    return d - Math.PI;
  }

  function stagingConfig() {
    return deps?.getStagingConfig?.() || {};
  }

  // Minimum swing (radians) around the NPC that keeps a player standing
  // `distance` tiles from it at least `clearance` tiles off the camera→NPC
  // sightline. Top-down: the player's perpendicular offset from that line is
  // distance * sin(theta), so theta = asin(clearance / distance).
  function requiredSideAngleRad(distance, cfg = stagingConfig()) {
    const minRad = finite(cfg.cameraSideAngleDeg, 15) * Math.PI / 180;
    const maxRad = Math.max(minRad, finite(cfg.maxCameraSideAngleDeg, 60) * Math.PI / 180);
    const clearance = Math.max(0, finite(cfg.playerClearanceTiles, 0.55));
    if (!(distance > 1e-6)) return maxRad; // Player effectively on top of the NPC: swing as wide as allowed.
    const ratio = clearance / distance;
    const needed = ratio >= 1 ? maxRad : Math.asin(ratio);
    return Math.max(minRad, Math.min(maxRad, needed));
  }

  // World azimuth (radians, updateCameraPosition's convention: camera sits at
  // target + (sin az, cos az) * groundDistance) for the given layout.
  function targetAzimuthRad(npc, player, sideSign, cfg = stagingConfig()) {
    const dx = finite(player?.x, NaN) - finite(npc?.x, NaN);
    const dz = finite(player?.z, NaN) - finite(npc?.z, NaN);
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) return null; // No bearing to derive; caller keeps the current azimuth.
    const towardPlayer = Math.atan2(dx, dz);
    return towardPlayer + (sideSign >= 0 ? 1 : -1) * requiredSideAngleRad(distance, cfg);
  }

  function pickSide(npc, player, entryAzimuthRad, cfg) {
    const plus = targetAzimuthRad(npc, player, 1, cfg);
    const minus = targetAzimuthRad(npc, player, -1, cfg);
    if (plus === null || minus === null || !Number.isFinite(entryAzimuthRad)) return 1;
    return Math.abs(angleDiff(plus, entryAzimuthRad)) <= Math.abs(angleDiff(minus, entryAzimuthRad)) ? 1 : -1;
  }

  function begin(entryAzimuthRad) {
    const entry = finite(entryAzimuthRad, 0);
    session = { entryAzimuthRad: entry, currentAzimuthRad: entry, sideSign: null, lastTarget: null, lastUpdateMs: null, lastElapsed: 0 };
    return session;
  }

  function end() {
    session = null;
  }

  function isActive() {
    return !!session;
  }

  // Returns the eased world azimuth in radians for this frame, or null when
  // no conversation is being framed. `snap` skips easing (e.g. first frame
  // after a teleport or when dt is unavailable).
  function update(dt, npc, player, options = {}) {
    if (!session) return null;
    const cfg = stagingConfig();
    if (session.sideSign === null) session.sideSign = pickSide(npc, player, session.entryAzimuthRad, cfg);
    const target = targetAzimuthRad(npc, player, session.sideSign, cfg);
    if (target !== null) session.lastTarget = target;
    const goal = session.lastTarget ?? session.currentAzimuthRad;
    const now = nowMs();
    const realElapsed = session.lastUpdateMs === null ? 0 : (now - session.lastUpdateMs) / 1000;
    session.lastUpdateMs = now;
    const safeDt = Math.max(0, Math.min(MAX_ELAPSED_SECONDS, Math.max(finite(dt, 0), realElapsed)));
    session.lastElapsed = safeDt;
    const rate = Math.max(0, finite(cfg.cameraOrbitEaseRate, 7));
    const alpha = options.snap || rate <= 0 ? 1 : 1 - Math.exp(-rate * safeDt);
    session.currentAzimuthRad += angleDiff(goal, session.currentAzimuthRad) * alpha;
    session.currentAzimuthRad = angleDiff(session.currentAzimuthRad, 0); // Keep wrapped to (-π, π].
    return session.currentAzimuthRad;
  }

  // Frame-rate-independent lerp factor for game.js's camera follow toward the
  // NPC this frame. followRate 12/s matches the old 0.18-per-frame lerp at
  // 60fps. Returns null outside a framed conversation (caller keeps its
  // mode's followLerp).
  function followAlpha() {
    if (!session) return null;
    const rate = Math.max(0, finite(stagingConfig().cameraFollowRate, 12));
    return rate <= 0 ? 1 : 1 - Math.exp(-rate * session.lastElapsed);
  }

  function debugSnapshot() {
    if (!session) return { active: false };
    const deg = r => (Number.isFinite(r) ? r * 180 / Math.PI : null);
    return {
      active: true,
      entryAzimuthDeg: deg(session.entryAzimuthRad),
      currentAzimuthDeg: deg(session.currentAzimuthRad),
      targetAzimuthDeg: deg(session.lastTarget),
      sideSign: session.sideSign,
    };
  }

  window.DialogueCameraFraming = {
    init,
    begin,
    end,
    isActive,
    update,
    followAlpha,
    requiredSideAngleRad,
    targetAzimuthRad,
    debugSnapshot,
  };
})();
