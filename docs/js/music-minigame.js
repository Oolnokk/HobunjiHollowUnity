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
  const KNOWN_SONG_ID = 'when-the-kininjis-bloom'; // Matches SONGBOOK's key in lyre-performance.html.
  const AMBIENT_RECHECK_S = 1; // How often tick() re-evaluates who should be ambiently performing — this doesn't need per-frame precision.

  const overlayEl = document.getElementById('musicMinigameOverlay');
  const frameEl = document.getElementById('musicMinigameFrame');
  const closeBtnEl = document.getElementById('musicMinigameCloseBtn');
  const menuBtnEl = document.getElementById('menuBtn');

  // While the overlay is open, the menu button becomes the minigame's own
  // exit button (its usual job — pause/menu — is meaningless mid-
  // performance, and the player has no other obvious way back out besides
  // the small ✕ in the overlay's corner), and the farm-edit/furniture-
  // placer buttons — which don't apply while playing an instrument and
  // would otherwise float uselessly over the overlay — are hidden. The
  // hiding is a body class + CSS !important (see style.css), not direct
  // style.display here: those two buttons' own visibility is re-asserted
  // by refreshActionBar() (FurniturePlacer.refreshVisibility() /
  // DevSpawner.refreshEditorButtonVisibility(), both called on basically
  // every action-bar update) on its own schedule regardless of the
  // overlay, which silently clobbered a one-time style.display write here.
  let _menuBtnOriginal = null;
  function setHostChromeSuppressed(suppressed) {
    document.body.classList.toggle('music-minigame-open', suppressed);
    if (!menuBtnEl) return;
    if (suppressed) {
      if (_menuBtnOriginal == null) _menuBtnOriginal = { html: menuBtnEl.innerHTML, label: menuBtnEl.getAttribute('aria-label') };
      menuBtnEl.innerHTML = '✕';
      menuBtnEl.setAttribute('aria-label', 'Exit minigame');
    } else if (_menuBtnOriginal) {
      menuBtnEl.innerHTML = _menuBtnOriginal.html;
      menuBtnEl.setAttribute('aria-label', _menuBtnOriginal.label || 'Open menu');
      _menuBtnOriginal = null;
    }
  }
  // Captured in the bubble phase, ahead of game.js's own menuBtn handler,
  // so the normal open/closeMenu logic never runs while the overlay is up.
  menuBtnEl?.addEventListener('click', (event) => {
    if (!playerSession) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }, true);

  let playerSession = null; // { mode:'lead'|'backup', area, npcId, songId } while the overlay is open, else null.
  const leaderByArea = new Map(); // area -> { type:'player'|'npc', id, songId, startedAt }
  const ambientFrames = new Map(); // npcId -> hidden <iframe>, for each NPC currently the ambient audio source in their area.

  function bridgeOf(frame) {
    try { return frame?.contentWindow?.HobunjiMusicControlBridge || null; }
    catch { return null; }
  }

  // ── Player session (the visible overlay) ────────────────────────────
  // The ported app gates its ENTIRE keyboard handler and its entire native
  // gamepad-polling loop behind window.__hobunjiHostedInputLayout — without
  // setting it, neither keyboard nor a real gamepad does anything at all
  // inside the iframe (only the host's own edge-control taps would work).
  //
  // This can't just read game.js's own lastInputDevice: onPlayerFrameLoaded
  // below calls frameEl.contentWindow.focus() so the iframe's own keydown
  // listener actually receives keystrokes, and that focus hand-off fires a
  // `blur` on the parent window — which game.js's own gamepad poller treats
  // as "not focused" and stops updating lastInputDevice from. So this
  // tracks the active device independently for the life of the overlay:
  // keydown observed directly on the (same-origin) iframe's own window,
  // gamepad activity polled unconditionally below, and touch inferred from
  // pointerType on the host's own edge-control buttons.
  let _localInputDevice = 'desktop';
  function hostedLayoutFor(device) {
    if (device === 'controller') return 'controller';
    if (device === 'touch') return 'mobile';
    return 'keyboard';
  }
  function anyGamepadActive() {
    const pads = navigator.getGamepads?.() || [];
    for (const pad of pads) {
      if (!pad) continue;
      if (pad.buttons.some(b => (b?.value || 0) > 0.5)) return true;
      if (pad.axes.some(a => Math.abs(a || 0) > 0.35)) return true;
    }
    return false;
  }
  let _syncedLayout = null;
  function syncInputLayout() {
    if (!playerSession || !deps) return;
    if (anyGamepadActive()) _localInputDevice = 'controller';
    const layout = hostedLayoutFor(_localInputDevice);
    if (layout === _syncedLayout) return;
    _syncedLayout = layout;
    try { frameEl.contentWindow.__hobunjiHostedInputLayout = layout; } catch {}
    if (hostInputMethod !== device2GlyphSet(layout)) {
      hostInputMethod = device2GlyphSet(layout);
      refreshHostGlyphs();
    }
  }
  function device2GlyphSet(layout) { return layout === 'keyboard' ? 'keyboard' : 'gamepad'; }

  function onPlayerFrameLoaded() {
    if (!playerSession) return;
    const bridge = bridgeOf(frameEl);
    if (!bridge) { window.__farmLog?.('music minigame: control bridge missing after load', 'warn'); return; }
    _syncedLayout = null;
    _localInputDevice = deps?.getLastInputDevice?.() || 'desktop'; // Best guess before the player has touched anything inside the overlay yet.
    try {
      frameEl.contentWindow.addEventListener('keydown', () => { _localInputDevice = 'desktop'; }, { capture: true });
    } catch {}
    syncInputLayout();
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
    setHostChromeSuppressed(true);
  }

  function close() {
    if (!playerSession) return;
    const { area, mode } = playerSession;
    playerSession = null;
    overlayEl?.classList.remove('open');
    if (frameEl) frameEl.src = 'about:blank'; // Tears the iframe down immediately, stopping its AudioContext with it.
    teardownEdgeControls();
    _syncedLayout = null;
    _localInputDevice = 'desktop';
    resetHostGamepadState();
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
    setHostChromeSuppressed(false);
  }

  closeBtnEl?.addEventListener('pointerup', (event) => { event.stopPropagation(); close(); });
  closeBtnEl?.addEventListener('pointerdown', (event) => { event.stopPropagation(); });
  // The iframe's own Start/Escape (see requestExitOrPause in
  // lyre-performance.html) asks to be closed the same way — its usual job,
  // pausing, doesn't make sense hosted inside the live game where the same
  // physical button is "open the menu" everywhere else.
  window.addEventListener('message', (event) => {
    if (event.source !== frameEl?.contentWindow) return;
    const data = event.data;
    if (data?.source === 'hobunji-music-minigame' && data.type === 'exit-requested') close();
  });

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
    // Input-method glyphs are host-driven now (see syncInputLayout) rather
    // than iframe-detected — the ported app itself no longer knows which
    // physical device the player is using; it only knows the layout the
    // host told it to run.
    if (data.type === 'sounded-note') onSoundedNote(data, event.source);
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
    // Floating circular buttons around a joystick, matching the game's own
    // regular mobile arch + joystick placement (see #joystickZone and
    // #arcContainer in style.css) — individually floating glass circles
    // anchored near a screen edge, not a bordered card wrapping everything.
    // The pattern grid is the one exception: it's inherently textual (6
    // named patterns), so it keeps its own small card for legibility.
    leftMount.innerHTML = `
      <div class="lyreJoystickPad" data-bridge-stick="left" aria-label="Rotate through hidden chord notes; each new sector plays immediately">
        <div class="lyreJoystickBase"></div>
        <div class="lyreJoystickKnob edgeStickNub">ARP</div>
      </div>
      <div class="lyreBankRow" aria-label="Melody bank shift">
        <button class="lyreCircBtn bumper" data-bridge-bank="lb"><span class="glyph" data-label-key="lb">▲</span></button>
        <button class="lyreCircBtn trigger" data-bridge-bank="lt"><span class="glyph" data-label-key="lt">◀</span></button>
        <button class="lyreCircBtn trigger" data-bridge-bank="rt"><span class="glyph" data-label-key="rt">▶</span></button>
        <button class="lyreCircBtn bumper" data-bridge-bank="rb"><span class="glyph" data-label-key="rb">▼</span></button>
      </div>
      <div class="lyrePatternCard" aria-label="Auto-arpeggio pattern — pick one, then hold a note to repeat it">
        <div class="lyrePatternHint">Pick a pattern, then hold a note</div>
        <div class="edgePatternGrid" data-pattern-grid></div>
      </div>
      <div class="lyreUtilRow">
        ${showSongToggle ? `<button class="lyrePillBtn" data-song-mode-toggle><span class="glyph">🎵</span><span data-song-mode-label>Play ${KNOWN_SONG_TITLE}</span></button>` : ''}
        <button class="lyreCircBtn system small" data-bridge-reset-harmony title="Restart Harmony"><span class="glyph">↻</span></button>
      </div>`;
    rightMount.innerHTML = `
      <div class="lyreFaceDiamond" aria-label="Note buttons">
        <button class="lyreCircBtn face violet y" data-bridge-note="3"><span class="glyph" data-label-key="y">Y</span></button>
        <button class="lyreCircBtn face cyan x" data-bridge-note="0"><span class="glyph" data-label-key="x">X</span></button>
        <button class="lyreCircBtn face violet b" data-bridge-note="2"><span class="glyph" data-label-key="b">B</span></button>
        <button class="lyreCircBtn face amber a" data-bridge-note="1"><span class="glyph" data-label-key="a">A</span></button>
      </div>
      <div class="lyreJoystickPad strum" data-bridge-stick="right" aria-label="Flick vertically to strum">
        <div class="lyreJoystickBase"></div>
        <div class="lyreJoystickKnob edgeStickNub">STRUM</div>
      </div>
      <div class="lyreBankRow">
        <button class="lyreCircBtn system small" data-bridge-action="scale-prev"><span class="glyph">◀</span></button>
        <span class="lyreClusterTitle">Scale</span>
        <button class="lyreCircBtn system small" data-bridge-action="scale-next"><span class="glyph">▶</span></button>
      </div>
      <button class="lyreCircBtn system exit" data-bridge-action="pause"><span class="glyph" data-label-key="start">START</span><span class="lyreCircBtn-label">Exit</span></button>`;

    const sourceFor = (kind, value, pointerId) => `host-${kind}-${value}:${pointerId}`;
    const bindHeldButton = (button, down, up) => {
      let activePointer = null;
      button.addEventListener('pointerdown', (event) => {
        if (activePointer != null) return;
        event.preventDefault();
        if (event.pointerType === 'touch') _localInputDevice = 'touch';
        else if (event.pointerType === 'mouse' || event.pointerType === 'pen') _localInputDevice = 'desktop';
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
        // startGameplaySong is a no-op while the selector is still on Free
        // Play (its own default) — selectGameplaySong has to move it onto
        // the known song first.
        if (playingSong) { bridge.selectGameplaySong?.(KNOWN_SONG_ID); await bridge.startGameplaySong?.(); }
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
        if (event.pointerType === 'touch') _localInputDevice = 'touch';
        else if (event.pointerType === 'mouse' || event.pointerType === 'pen') _localInputDevice = 'desktop';
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
    // The right stick (strum) still uses the drag gesture — it's a single
    // up/down flick, not a 6-way pick, so it stays discoverable without a
    // button grid. The left stick's old job (drag into one of 6 wedges to
    // pick an auto-arpeggio pattern) is handled by the pattern grid below
    // instead — direct tap targets so it works without a gamepad and
    // without needing a note held at the same time to "feel" the gesture.
    bindStick(rightMount.querySelector('[data-bridge-stick="right"]'), 'right', 22);

    const patternGrid = leftMount.querySelector('[data-pattern-grid]');
    if (patternGrid) {
      const menuState = bridge.getState?.() || {};
      const ids = menuState.leftStickModeIds || ['direct'];
      const labels = menuState.leftStickModeLabels || ['SINGLE'];
      const selectedSector = menuState.leftStickSector ?? 0;
      patternGrid.innerHTML = ids.map((id, index) => `<button type="button" class="edgePatternBtn${index === selectedSector ? ' selected' : ''}" data-pattern-index="${index}">${labels[index] || id}</button>`).join('');
      patternGrid.querySelectorAll('[data-pattern-index]').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          await bridge.wakeAudio?.().catch(() => {});
          bridge.setAutoPickMode?.(Number(button.dataset.patternIndex));
          patternGrid.querySelectorAll('.edgePatternBtn').forEach((other) => other.classList.toggle('selected', other === button));
        });
      });
    }

    refreshHostGlyphs(); // Reflects whatever syncInputLayout already determined (called just before this, in onPlayerFrameLoaded) rather than resetting to a fixed default.
    return true;
  }

  // ── Controller layout: host polls the real gamepad directly ─────────
  // When syncInputLayout has set the iframe to 'controller', the ported
  // app's own pollGamepad deliberately stops self-polling (see the V89
  // comment in lyre-performance.html) so bank holds and the Lyre's active-
  // bank glow share one input source instead of two independent pollers
  // fighting over the same buttons. That leaves the host as the only thing
  // driving the gamepad — this mirrors the ported app's own pre-V89
  // pollGamepad button/axis mapping exactly, just calling the bridge's
  // held-button methods instead of the app's internal state directly.
  let _gpIndex = null;
  let _gpPrevButtons = [];
  let _gpLeftStickActive = false;
  function pollHostGamepad(bridge) {
    const pads = navigator.getGamepads?.() || [];
    let pad = _gpIndex != null ? pads[_gpIndex] : null;
    if (!pad) { pad = [...pads].find(Boolean); if (pad) _gpIndex = pad.index; }
    if (!pad) return;
    const press = (index, down, up) => {
      const pressed = (pad.buttons[index]?.value || 0) > 0.55;
      if (pressed === !!_gpPrevButtons[index]) return;
      _gpPrevButtons[index] = pressed;
      if (pressed) down(); else up?.();
    };
    press(2, () => bridge.noteDown(0, 'gp-x'), () => bridge.noteUp(0, 'gp-x'));
    press(0, () => bridge.noteDown(1, 'gp-a'), () => bridge.noteUp(1, 'gp-a'));
    press(1, () => bridge.noteDown(2, 'gp-b'), () => bridge.noteUp(2, 'gp-b'));
    press(3, () => bridge.noteDown(3, 'gp-y'), () => bridge.noteUp(3, 'gp-y'));
    press(6, () => bridge.bankDown('lt', 'gp-lt'), () => bridge.bankUp('lt', 'gp-lt'));
    press(4, () => bridge.bankDown('lb', 'gp-lb'), () => bridge.bankUp('lb', 'gp-lb'));
    press(7, () => bridge.bankDown('rt', 'gp-rt'), () => bridge.bankUp('rt', 'gp-rt'));
    press(5, () => bridge.bankDown('rb', 'gp-rb'), () => bridge.bankUp('rb', 'gp-rb'));
    press(9, () => bridge.tap('pause'));
    press(14, () => bridge.tap('scale-prev'));
    press(15, () => bridge.tap('scale-next'));
    const lx = Math.abs(pad.axes[0] || 0) < 0.16 ? 0 : pad.axes[0];
    const ly = Math.abs(pad.axes[1] || 0) < 0.16 ? 0 : pad.axes[1];
    const rx = Math.abs(pad.axes[2] || 0) < 0.12 ? 0 : pad.axes[2];
    const ry = Math.abs(pad.axes[3] || 0) < 0.12 ? 0 : pad.axes[3];
    if (Math.hypot(lx, ly) >= 0.28) { _gpLeftStickActive = true; bridge.leftStick(lx, ly, 'gp-left-stick'); }
    else if (_gpLeftStickActive) { _gpLeftStickActive = false; bridge.releaseLeftStick(); }
    bridge.rightStick(rx, ry, 'gp-right-stick');
  }
  function resetHostGamepadState() { _gpIndex = null; _gpPrevButtons = []; _gpLeftStickActive = false; }

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
    syncInputLayout(); // Cheap no-op unless the player's device actually changed; runs every frame so switching to/from a controller mid-performance takes effect immediately.
    if (playerSession && _syncedLayout === 'controller') {
      const bridge = bridgeOf(frameEl);
      if (bridge) pollHostGamepad(bridge);
    }
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
