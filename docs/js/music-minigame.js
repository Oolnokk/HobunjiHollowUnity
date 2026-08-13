(() => {
  'use strict';

  // Lyre performance minigame — a full-screen iframe overlay hosting the
  // self-contained app at assets/minigames/lyre-performance.html (its own
  // audio engine, note charts, controls, and songbook). Wiring pattern
  // mirrors js/fishing-minigame.js (window.<Namespace> + init(deps), a
  // `state` getter callers poll for `.active`, player movement/action-bar
  // guarded at their own call sites in game.js) — the iframe boundary is
  // the one deliberate difference, needed because this is a large
  // pre-built app rather than something authored directly against this
  // page's DOM/CSS (see the srcdoc comment in the original mockup this was
  // ported from: it avoids ID/CSS collisions with the host page).
  //
  // ── Leader/backup model ──────────────────────────────────────────────
  // Whoever starts playing first in a given area leads (picks the song, or
  // in the player's case, free chords/tempo); everyone who joins after
  // falls in as backup on the leader's song. This applies symmetrically:
  // an instrument NPC (see deps.listInstrumentPerformers, keyed off
  // game.js's INSTRUMENT_NPC_DEFS) ambiently loops its song for as long as
  // it's on duty and nothing else is leading in its area; the player
  // (holding a Kurraya, pressing "Play") either joins an already-leading
  // NPC as backup, or becomes the leader themselves if no one's playing
  // there yet — at which point any instrument NPC whose schedule kicks in
  // afterward defers instead of interrupting them. leaderByArea is the
  // single source of truth for this per area.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const MUSIC_MINIGAME_SRC = 'assets/minigames/lyre-performance.html';
  const AMBIENT_RECHECK_S = 1; // How often tick() re-evaluates who should be ambiently performing — this doesn't need per-frame precision.

  const overlayEl = document.getElementById('musicMinigameOverlay');
  const frameEl = document.getElementById('musicMinigameFrame');
  const closeBtnEl = document.getElementById('musicMinigameCloseBtn');

  let playerSession = null; // { mode:'lead'|'backup', area, npcId, songId } while the overlay is open, else null.
  const leaderByArea = new Map(); // area -> { type:'player'|'npc', id, songId, startedAt }
  const ambientFrames = new Map(); // npcId -> hidden <iframe>, for each NPC currently the ambient audio source in their area.

  function bridgeOf(frame) {
    try { return frame?.contentWindow?.HobunjiMusicControlBridge || null; }
    catch { return null; }
  }

  // ── Player session (the visible overlay) ────────────────────────────
  function onPlayerFrameLoaded() {
    if (!playerSession) return;
    const bridge = bridgeOf(frameEl);
    if (!bridge) { window.__farmLog?.('music minigame: control bridge missing after load', 'warn'); return; }
    if (playerSession.mode === 'backup') bridge.startBackupPreviewSong?.(playerSession.songId);
    else bridge.enterJamMode?.(); // Regular/improvise mode — the ported app's own Songbook/Chords UI handles picking a song or a chord progression + tempo from here.
  }
  frameEl?.addEventListener('load', onPlayerFrameLoaded);

  function beginPlayerSession() {
    if (playerSession || !overlayEl || !frameEl || !deps) return;
    const area = deps.getCurrentArea();
    const nearbyPerformer = deps.listInstrumentPerformers().find(p => p.area === area);
    if (nearbyPerformer) {
      // Someone's already leading here — stop their standalone ambient
      // audio (the player's own overlay becomes the sole audio source for
      // this performance) and join in on their song as backup.
      stopAmbientForNpc(nearbyPerformer.npcId);
      playerSession = { active: true, mode: 'backup', area, npcId: nearbyPerformer.npcId, songId: nearbyPerformer.songId };
      deps.showToast?.(`Playing along with ${nearbyPerformer.name}.`, true);
    } else {
      leaderByArea.set(area, { type: 'player', id: 'player', startedAt: Date.now() });
      playerSession = { active: true, mode: 'lead', area };
    }
    overlayEl.classList.add('open');
    frameEl.src = MUSIC_MINIGAME_SRC;
    deps.refreshActionBar?.();
  }

  function close() {
    if (!playerSession) return;
    const { area, mode } = playerSession;
    playerSession = null;
    overlayEl?.classList.remove('open');
    if (frameEl) frameEl.src = 'about:blank'; // Tears the iframe down immediately, stopping its AudioContext with it.
    if (mode === 'lead') {
      const leader = leaderByArea.get(area);
      if (leader?.type === 'player') leaderByArea.delete(area); // Frees the area up — an on-duty instrument NPC picks leadership back up on tick()'s next pass.
    }
    // Backup mode leaves the NPC's leaderByArea entry untouched — it's
    // still "their" song; tick() below notices their ambient audio isn't
    // running (the player's overlay was standing in for it) and restarts
    // it plainly.
    deps?.refreshActionBar?.();
  }

  closeBtnEl?.addEventListener('pointerup', (event) => { event.stopPropagation(); close(); });
  closeBtnEl?.addEventListener('pointerdown', (event) => { event.stopPropagation(); });

  // ── Ambient NPC performance (no visible UI, no human input) ─────────
  function stopAmbientForNpc(npcId) {
    const frame = ambientFrames.get(npcId);
    if (!frame) return;
    ambientFrames.delete(npcId);
    frame.remove();
  }

  function startAmbientForNpc(npcId, songId) {
    const frame = document.createElement('iframe');
    frame.className = 'musicAmbientFrame';
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'Ambient instrument performance';
    frame.allow = 'autoplay';
    document.body.appendChild(frame);
    ambientFrames.set(npcId, frame);
    frame.addEventListener('load', () => { bridgeOf(frame)?.startAmbientLead?.(songId); }, { once: true });
    frame.src = MUSIC_MINIGAME_SRC;
  }

  let _tickAccum = 0;
  function tick(dt) {
    _tickAccum += dt;
    if (_tickAccum < AMBIENT_RECHECK_S) return;
    _tickAccum = 0;
    if (!deps) return;
    const performers = deps.listInstrumentPerformers();
    const performingIds = new Set(performers.map(p => p.npcId));

    // Stop ambient audio (and release leadership) for anyone no longer on duty.
    for (const npcId of [...ambientFrames.keys()]) {
      if (performingIds.has(npcId)) continue;
      stopAmbientForNpc(npcId);
      for (const [area, leader] of leaderByArea) {
        if (leader.type === 'npc' && leader.id === npcId) leaderByArea.delete(area);
      }
    }

    for (const performer of performers) {
      if (ambientFrames.has(performer.npcId)) continue; // Already sounding.
      if (playerSession?.mode === 'backup' && playerSession.area === performer.area && playerSession.npcId === performer.npcId) continue; // The player's own overlay is standing in as this NPC's audio right now.
      const leader = leaderByArea.get(performer.area);
      if (leader && leader.type === 'player') continue; // The player already claimed this area as lead — the NPC defers rather than interrupting them.
      leaderByArea.set(performer.area, { type: 'npc', id: performer.npcId, songId: performer.songId, startedAt: Date.now() });
      startAmbientForNpc(performer.npcId, performer.songId);
    }
  }

  window.MusicMinigame = {
    init,
    beginPlayerSession,
    close,
    tick,
    get state() { return playerSession; },
  };
})();
