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
  // The ONE songbook entry the ported app currently knows (see
  // lyre-performance.html's SONGBOOK) — surfaced here as a simple two-way
  // toggle rather than porting the original mockup's own multi-song
  // authoring-oriented Songs modal, since the mockup was built for
  // browsing/curating a whole catalog and we only need "improvise or play
  // the one known song" today. Update this (and swap the toggle for a real
  // picker) once a second song exists in the songbook.
  const KNOWN_SONG_TITLE = 'When the Kininjis Bloom';
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
    buildEdgeControls(frameEl);
    // The iframe's own keydown listeners (ASDF notes, arrow-key banks, ...)
    // only fire while it actually has focus — without this, whichever
    // element the page happened to have focused keeps eating keystrokes.
    try { frameEl.contentWindow?.focus(); } catch {}
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
    deps.beginMusicCamera?.(playerSession.npcId || null);
    deps.refreshActionBar?.();
  }

  function close() {
    if (!playerSession) return;
    const { area, mode } = playerSession;
    playerSession = null;
    overlayEl?.classList.remove('open');
    if (frameEl) frameEl.src = 'about:blank'; // Tears the iframe down immediately, stopping its AudioContext with it.
    teardownEdgeControls();
    if (mode === 'lead') {
      const leader = leaderByArea.get(area);
      if (leader?.type === 'player') leaderByArea.delete(area); // Frees the area up — an on-duty instrument NPC picks leadership back up on tick()'s next pass.
    }
    // Backup mode leaves the NPC's leaderByArea entry untouched — it's
    // still "their" song; tick() below notices their ambient audio isn't
    // running (the player's overlay was standing in for it) and restarts
    // it plainly.
    deps?.endMusicCamera?.();
    deps?.refreshActionBar?.();
  }

  closeBtnEl?.addEventListener('pointerup', (event) => { event.stopPropagation(); close(); });
  closeBtnEl?.addEventListener('pointerdown', (event) => { event.stopPropagation(); });

  // ── Edge controls (the actual touch/mouse play surface) ─────────────
  // Ported from the original mockup's buildHostedMusicEdgeControls: the
  // iframe's own native buttons are hidden by its "hosted-minigame" body
  // styling (see lyre-performance.html) so the 3D scene stays clear, so
  // this drives the exact same HobunjiMusicControlBridge methods that ARE
  // still there. Rebuilt fresh each time the overlay opens (the iframe is
  // a brand-new document every time, per close()'s src='about:blank').
  const HOST_GAMEPAD_GLYPHS = {y:'Y',x:'X',b:'B',a:'A',lb:'▲',lt:'◀',rb:'▼',rt:'▶',start:'START'};
  const HOST_KEYBOARD_GLYPHS = {y:'F',x:'A',b:'D',a:'S',lb:'▲',lt:'◀',rb:'▼',rt:'▶',start:'ESC'};
  let hostInputMethod = 'gamepad';

  function refreshHostGlyphs() {
    const glyphs = hostInputMethod === 'keyboard' ? HOST_KEYBOARD_GLYPHS : HOST_GAMEPAD_GLYPHS;
    document.querySelectorAll('#musicMinigameOverlay [data-label-key]').forEach(el => {
      const glyph = glyphs[el.dataset.labelKey];
      if (glyph) el.textContent = glyph;
    });
  }
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'hobunji-music-minigame') return;
    if (data.type === 'inputMethod') {
      if (event.source !== frameEl?.contentWindow) return;
      if (hostInputMethod === data.method) return;
      hostInputMethod = data.method;
      refreshHostGlyphs();
    } else if (data.type === 'sounded-note') {
      onSoundedNote(data, event.source);
    }
  });

  // Drives each performer's Kurraya twitch (see js/kurraya-instrument.js via
  // game.js's triggerPlayerKurrayaTwitch/triggerNpcKurrayaTwitch) off the
  // actual notes sounding, not a canned animation loop. Every iframe here
  // reports 'lead' or 'backup' purely as roles WITHIN that one performance
  // (see registerVoice in lyre-performance.html) — which real-world
  // performer that maps to depends on whose iframe it came from and, for
  // the player's overlay in backup mode, which role the note itself was.
  function onSoundedNote(data, source) {
    if (source === frameEl?.contentWindow) {
      if (playerSession?.mode === 'backup') {
        // backupAccompaniment is on for this session, so 'lead' notes here
        // are the joined NPC's own autoplaying line (their ambient frame
        // was torn down for the duration — see beginPlayerSession — so this
        // is the only place those notes are still observable) and 'backup'
        // notes are the player's own input.
        if (data.performer === 'backup') deps?.triggerPlayerKurrayaTwitch?.();
        else if (playerSession.npcId) deps?.triggerNpcKurrayaTwitch?.(playerSession.npcId);
      } else {
        deps?.triggerPlayerKurrayaTwitch?.();
      }
      return;
    }
    for (const [npcId, frame] of ambientFrames) {
      if (source === frame.contentWindow) { deps?.triggerNpcKurrayaTwitch?.(npcId); return; }
    }
  }

  function teardownEdgeControls() {
    const leftMount = document.getElementById('leftMusicControls');
    const rightMount = document.getElementById('rightMusicControls');
    if (leftMount) leftMount.innerHTML = '';
    if (rightMount) rightMount.innerHTML = '';
  }

  function buildEdgeControls(frame) {
    const leftMount = document.getElementById('leftMusicControls');
    const rightMount = document.getElementById('rightMusicControls');
    const bridge = bridgeOf(frame);
    if (!leftMount || !rightMount || !bridge) return false;

    // Only meaningful in lead/solo mode — joining an NPC as backup already
    // fixes the song to whatever they're leading (see beginPlayerSession),
    // so there's nothing to pick.
    const showSongToggle = playerSession?.mode === 'lead';
    leftMount.innerHTML = `
      <aside class="edgeMusicPanel" aria-label="Left controller panel">
        ${showSongToggle ? `<button class="edgeControllerBtn system edgeSongModeBtn" data-song-mode-toggle><span class="glyph">🎵</span><span class="action-label" data-song-mode-label>Play ${KNOWN_SONG_TITLE}</span></button>` : ''}
        <div class="edgeShoulderGrid" aria-label="Shoulder controls">
          <div class="edgeShoulderStack">
            <button class="edgeControllerBtn edgeBumperBtn" data-bridge-bank="lb"><span class="glyph" data-label-key="lb">▲</span><span class="action-label">Notes +12</span></button>
            <button class="edgeControllerBtn edgeTriggerBtn" data-bridge-bank="lt"><span class="glyph" data-label-key="lt">◀</span><span class="action-label">Notes +4</span></button>
          </div>
          <div class="edgeShoulderStack">
            <button class="edgeControllerBtn edgeBumperBtn" data-bridge-bank="rb"><span class="glyph" data-label-key="rb">▼</span><span class="action-label">Notes +16</span></button>
            <button class="edgeControllerBtn edgeTriggerBtn" data-bridge-bank="rt"><span class="glyph" data-label-key="rt">▶</span><span class="action-label">Notes +8</span></button>
          </div>
        </div>
        <div class="edgeLeftStickRow" aria-label="Left stick controls">
          <div class="edgeStickPad arp" data-bridge-stick="left" aria-label="Rotate through hidden chord notes"><div class="edgeStickNub">ARP</div></div>
          <div class="edgeStickSide">
            <button class="edgeControllerBtn system" data-bridge-action="pause"><span class="glyph" data-label-key="start">START</span><span class="action-label">Pause</span></button>
            <button class="edgeControllerBtn" data-bridge-reset-harmony><span class="glyph">↻</span><span class="action-label">Restart Harmony</span></button>
          </div>
        </div>
      </aside>`;
    rightMount.innerHTML = `
      <aside class="edgeMusicPanel" aria-label="Right controller panel">
        <div class="edgeRightTop">
          <section class="edgeControlCluster" aria-label="D-pad controls">
            <div class="edgeClusterTitle">Scale</div>
            <div class="edgeDpadWrap"><div class="edgeDpad">
              <button class="edgeControllerBtn unused up" disabled><span class="glyph">▲</span></button>
              <button class="edgeControllerBtn system left" data-bridge-action="scale-prev"><span class="glyph">◀</span></button>
              <div class="edgeDpadCenter">SET</div>
              <button class="edgeControllerBtn system right" data-bridge-action="scale-next"><span class="glyph">▶</span></button>
              <button class="edgeControllerBtn unused down" disabled><span class="glyph">▼</span></button>
            </div></div>
          </section>
          <section class="edgeControlCluster" aria-label="Face button controls">
            <div class="edgeClusterTitle">Notes</div>
            <div class="edgeFaceWrap"><div class="edgeFacePad">
              <button class="edgeControllerBtn violet y" data-bridge-note="3"><span class="glyph" data-label-key="y">Y</span></button>
              <button class="edgeControllerBtn cyan x" data-bridge-note="0"><span class="glyph" data-label-key="x">X</span></button>
              <button class="edgeControllerBtn violet b" data-bridge-note="2"><span class="glyph" data-label-key="b">B</span></button>
              <button class="edgeControllerBtn amber a" data-bridge-note="1"><span class="glyph" data-label-key="a">A</span></button>
            </div></div>
          </section>
        </div>
        <div class="edgeRightBottom" aria-label="Right stick controls">
          <div class="edgeStickPad strum" data-bridge-stick="right" aria-label="Flick vertically to strum"><div class="edgeStickNub">STRUM</div></div>
        </div>
      </aside>`;

    const sourceFor = (kind, value, pointerId) => `host-${kind}-${value}:${pointerId}`;
    const bindHeldButton = (button, down, up) => {
      let activePointer = null;
      button.addEventListener('pointerdown', (event) => {
        if (activePointer != null) return;
        event.preventDefault();
        activePointer = event.pointerId;
        button.classList.add('held');
        try { button.setPointerCapture?.(event.pointerId); } catch {}
        down(event);
      });
      const release = (event) => {
        if (activePointer !== event.pointerId) return;
        event.preventDefault();
        up(event);
        activePointer = null;
        button.classList.remove('held');
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', (event) => {
        if (activePointer == null) return;
        up({ pointerId: activePointer, preventDefault(){} });
        activePointer = null;
        button.classList.remove('held');
      });
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    };

    leftMount.querySelectorAll('[data-bridge-bank]').forEach((button) => {
      const bank = button.dataset.bridgeBank;
      bindHeldButton(button,
        (event) => bridge.bankDown(bank, sourceFor('bank', bank, event.pointerId)),
        (event) => bridge.bankUp(bank, sourceFor('bank', bank, event.pointerId)));
    });
    rightMount.querySelectorAll('[data-bridge-note]').forEach((button) => {
      const note = Number(button.dataset.bridgeNote);
      bindHeldButton(button,
        (event) => bridge.noteDown(note, sourceFor('note', note, event.pointerId)),
        (event) => bridge.noteUp(note, sourceFor('note', note, event.pointerId)));
    });
    [...leftMount.querySelectorAll('[data-bridge-action]'), ...rightMount.querySelectorAll('[data-bridge-action]')].forEach((button) => {
      bindHeldButton(button, () => bridge.wakeAudio().catch(() => {}), () => bridge.tap(button.dataset.bridgeAction));
    });
    leftMount.querySelector('[data-bridge-reset-harmony]')?.addEventListener('click', (event) => {
      event.preventDefault();
      bridge.resetHarmony();
    });

    // Toggles between free improvisation (the default on opening — see
    // onPlayerFrameLoaded) and actually playing the one known songbook
    // song. The label always names what tapping does NEXT, so it reads
    // correctly in both states without a separate "current mode" readout.
    const songModeBtn = leftMount.querySelector('[data-song-mode-toggle]');
    const songModeLabel = songModeBtn?.querySelector('[data-song-mode-label]');
    if (songModeBtn && songModeLabel) {
      let playingSong = false;
      songModeBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        await bridge.wakeAudio?.().catch(() => {});
        playingSong = !playingSong;
        if (playingSong) await bridge.startGameplaySong?.();
        else bridge.enterJamMode?.();
        songModeLabel.textContent = playingSong ? 'Improvise' : `Play ${KNOWN_SONG_TITLE}`;
      });
    }

    const bindStick = (pad, hand, maxTranslate) => {
      const nub = pad?.querySelector('.edgeStickNub');
      if (!pad || !nub) return;
      let pointerId = null;
      const normalized = (event) => {
        const rect = pad.getBoundingClientRect();
        let x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        let y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        const length = Math.hypot(x, y);
        if (length > 1) { x /= length; y /= length; }
        return [x, y];
      };
      const route = (event) => {
        const [x, y] = normalized(event);
        nub.style.transform = `translate(${Math.max(-1, Math.min(1, x)) * maxTranslate}px, ${Math.max(-1, Math.min(1, y)) * maxTranslate}px)`;
        if (hand === 'left') bridge.leftStick(x, y, 'host-left-stick');
        else bridge.rightStick(x, y, 'host-right-stick');
      };
      pad.addEventListener('pointerdown', (event) => {
        if (pointerId != null) return;
        event.preventDefault();
        pointerId = event.pointerId;
        pad.classList.add('held');
        try { pad.setPointerCapture?.(event.pointerId); } catch {}
        bridge.wakeAudio().catch(() => {});
        bridge.announceInput(hand === 'left' ? 'arpPad' : 'strumPad');
        route(event);
      });
      pad.addEventListener('pointermove', (event) => { if (pointerId === event.pointerId) { event.preventDefault(); route(event); } });
      const release = (event) => {
        if (pointerId !== event.pointerId) return;
        event.preventDefault();
        if (hand === 'left') bridge.releaseLeftStick(); else bridge.releaseRightStick();
        pointerId = null;
        pad.classList.remove('held');
        nub.style.transform = 'translate(0,0)';
      };
      pad.addEventListener('pointerup', release);
      pad.addEventListener('pointercancel', release);
      pad.addEventListener('lostpointercapture', () => {
        if (pointerId == null) return;
        if (hand === 'left') bridge.releaseLeftStick(); else bridge.releaseRightStick();
        pointerId = null;
        pad.classList.remove('held');
        nub.style.transform = 'translate(0,0)';
      });
      pad.addEventListener('contextmenu', (event) => event.preventDefault());
    };
    bindStick(leftMount.querySelector('[data-bridge-stick="left"]'), 'left', 26);
    bindStick(rightMount.querySelector('[data-bridge-stick="right"]'), 'right', 22);

    hostInputMethod = 'gamepad';
    refreshHostGlyphs();
    return true;
  }

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
