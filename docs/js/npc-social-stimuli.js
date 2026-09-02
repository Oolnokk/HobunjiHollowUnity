(() => {
  'use strict';

  // NPC Social Stimuli: a tiny world-event bulletin board (design doc §23).
  // Player/world actions emit() a short-lived stimulus; NPCs (via
  // npc-activity-planner.js's throttled interruption check) look for one
  // nearby with getActive()/strongestNear() and may react using ordinary
  // activities like watchPerformance — never bespoke movement hacks (§25).
  //
  // Kurraya performance (§24) is the one emitter this phase wires up, and
  // it's wired by *polling* window.MusicMinigame.state rather than adding a
  // push call site inside the player's performance input path — reading
  // this module is the only way this module can affect anything upstream
  // of it, so a bug here can't touch the player's actual playing experience.
  // Future emitters (emotes, danger, celebration — §26) just need their own
  // small emit() call somewhere reasonable; nothing about the NPC-facing
  // side of this module is Kurraya-specific.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps || {}; }

  function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  const stimuli = new Map(); // id → stimulus record

  function emit(stim) {
    if (!stim || !stim.id) return null;
    const durationMs = Number.isFinite(stim.durationMs) ? stim.durationMs
      : Number.isFinite(stim.duration) ? stim.duration * 1000 : 5000;
    const record = {
      id: stim.id,
      type: stim.type || 'generic',
      area: stim.area || null,
      x: stim.x, z: stim.z,
      radius: Number.isFinite(stim.radius) ? stim.radius : 8,
      strength: Number.isFinite(stim.strength) ? Math.max(0, Math.min(1, stim.strength)) : 0.6,
      sourceNpcId: stim.sourceNpcId || null,
      sourceIsPlayer: !!stim.sourceIsPlayer,
      expiresAt: nowMs() + Math.max(0, durationMs),
    };
    stimuli.set(record.id, record);
    return record;
  }

  function clear(id) { stimuli.delete(id); }

  function pruneExpired() {
    const t = nowMs();
    for (const [id, s] of stimuli) if (s.expiresAt <= t) stimuli.delete(id);
  }

  function getActive(area) {
    pruneExpired();
    const out = [];
    for (const s of stimuli.values()) if (!area || s.area === area) out.push(s);
    return out;
  }

  // The single best (strength × proximity) stimulus within its own radius
  // of (x,z), or null. This — not raw distance — is what an NPC's interest
  // score should be built from.
  function strongestNear(area, x, z) {
    let best = null, bestScore = -Infinity, bestProximity = 0;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    for (const s of getActive(area)) {
      if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || s.radius <= 0) continue;
      const dist = Math.hypot(x - s.x, z - s.z);
      if (dist > s.radius) continue;
      const proximity = 1 - dist / s.radius;
      const score = s.strength * proximity;
      if (score > bestScore) { bestScore = score; best = s; bestProximity = proximity; }
    }
    return best ? { stimulus: best, proximity: bestProximity } : null;
  }

  const PLAYER_KURRAYA_STIM_ID = 'player-kurraya';
  // Safe to call as often as any caller likes (planner ticks call it
  // opportunistically) — it's an idempotent Map.set keyed by a fixed id, so
  // re-polling every throttle tick just refreshes the expiry while the
  // player keeps playing rather than accumulating duplicate stimuli.
  function pollPlayerMusic() {
    const state = window.MusicMinigame?.state;
    if (!state?.active) { clear(PLAYER_KURRAYA_STIM_ID); return; }
    const pos = deps.getPlayerPosition?.();
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return;
    emit({
      id: PLAYER_KURRAYA_STIM_ID, type: 'music',
      area: state.area || deps.getCurrentArea?.() || null,
      x: pos.x, z: pos.z, radius: 12, strength: 0.85, durationMs: 3000,
      sourceIsPlayer: true, sourceNpcId: state.npcId || null,
    });
  }

  window.NpcSocialStimuli = { init, emit, clear, getActive, strongestNear, pollPlayerMusic };
})();
