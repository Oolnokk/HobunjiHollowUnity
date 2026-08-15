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
  // lyre-performance.html's SONGBOOK) — surfaced to the compact song
  // picker below alongside Free Play and the built-in practice patterns.
  // Update this once a second song exists in the songbook.
  const KNOWN_SONG_TITLE = 'When the Kininjis Bloom';
  const KNOWN_SONG_ID = 'when-the-kininjis-bloom'; // Matches SONGBOOK's key in lyre-performance.html.
  const AMBIENT_RECHECK_S = 1; // How often tick() re-evaluates who should be ambiently performing — this doesn't need per-frame precision.

  // ── Rebindable note keys ──────────────────────────────────────────────
  // The falling glyphs always show plain ordinal numbers (1-4 — see
  // NOTE_INPUT_GLYPHS_BY_LAYOUT in lyre-performance.html) rather than a
  // literal key name, specifically so this mapping can be rebound to any
  // key without the on-screen prompts going stale. Settings UI lives in
  // #lyreNoteKeyBindings (see renderNoteKeySettings, called once at boot
  // by game.js the same way it calls window.InputSettingsPanel.render()).
  const NOTE_KEY_STORAGE_KEY = 'hobunji.lyreNoteKeys.v1';
  const DEFAULT_NOTE_KEY_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF'];
  function loadNoteKeyBindings() {
    try {
      const saved = JSON.parse(localStorage.getItem(NOTE_KEY_STORAGE_KEY) || 'null');
      if (Array.isArray(saved) && saved.length === 4) return saved.slice();
    } catch {}
    return DEFAULT_NOTE_KEY_CODES.slice();
  }
  const noteKeyCodes = loadNoteKeyBindings(); // index -> KeyboardEvent.code, e.g. noteKeyCodes[0] === 'KeyA'.
  function saveNoteKeyBindings() { localStorage.setItem(NOTE_KEY_STORAGE_KEY, JSON.stringify(noteKeyCodes)); }
  function noteIndexForKeyCode(code) {
    const index = noteKeyCodes.indexOf(code);
    return index === -1 ? null : index;
  }
  function keyLabel(code) {
    return String(code || 'Unbound').replace(/^Key/, '').replace(/^Digit/, '');
  }
  const RESERVED_LYRE_KEY_LABELS = { ArrowLeft:'the LT bank shift', ArrowUp:'the RT bank shift', ArrowRight:'the LB bank shift', ArrowDown:'the RB bank shift' }; // Fixed bank-shift keys — see keyboardBankByCode below.
  function renderNoteKeySettings() {
    const container = document.getElementById('lyreNoteKeyBindings');
    if (!container) return;
    container.innerHTML = '';
    for (let noteIndex = 0; noteIndex < 4; noteIndex++) {
      const row = document.createElement('div');
      row.className = 'input-binding-row';
      row.innerHTML = `<span class="settings-name">Note ${noteIndex + 1}</span><button type="button" class="input-bind-btn">${keyLabel(noteKeyCodes[noteIndex])}</button><div class="input-binding-warning"></div>`;
      const button = row.children[1];
      const warn = row.querySelector('.input-binding-warning');
      button.addEventListener('click', () => {
        button.classList.add('is-listening');
        button.textContent = 'Press key…';
        const once = event => {
          event.preventDefault();
          const code = event.code;
          const conflictIndex = noteKeyCodes.indexOf(code);
          if (RESERVED_LYRE_KEY_LABELS[code]) {
            warn.textContent = `Reserved for ${RESERVED_LYRE_KEY_LABELS[code]}.`;
            button.textContent = keyLabel(noteKeyCodes[noteIndex]);
            button.classList.remove('is-listening');
          } else if (conflictIndex !== -1 && conflictIndex !== noteIndex) {
            warn.textContent = `Already bound to Note ${conflictIndex + 1}.`;
            button.textContent = keyLabel(noteKeyCodes[noteIndex]);
            button.classList.remove('is-listening');
          } else {
            noteKeyCodes[noteIndex] = code;
            warn.textContent = '';
            saveNoteKeyBindings();
            renderNoteKeySettings();
          }
          window.removeEventListener('keydown', once, true);
        };
        window.addEventListener('keydown', once, true);
      });
      container.appendChild(row);
    }
  }

  // ── Pattern loadout + freeplay key ──────────────────────────────────────
  // Both settle into the app's own combined settings blob
  // (musicSystemDemoSettingsV13, written by lyre-performance.html's own
  // saveSettings/loadSettings) rather than a dedicated key like the note
  // bindings above, since autoPickSlots/scaleName/tonicMidi already live
  // there and the app reloads that blob fresh every session (the iframe is
  // torn down and rebuilt each time — see close()) — so a change made here
  // from the overworld Settings menu is picked up the next time a
  // performance starts, the same way a note-key rebind is. The pattern
  // library/scale list below mirror AUTO_PICK_PATTERN_LIBRARY/SCALES in
  // lyre-performance.html — that vocabulary is part of the app's fixed
  // design, not something read live from a (possibly not currently loaded)
  // iframe instance.
  const LYRE_APP_SETTINGS_KEY = 'musicSystemDemoSettingsV13';
  function loadLyreAppSettings() {
    try { return JSON.parse(localStorage.getItem(LYRE_APP_SETTINGS_KEY) || 'null') || {}; }
    catch { return {}; }
  }
  function saveLyreAppSettings(patch) {
    try { localStorage.setItem(LYRE_APP_SETTINGS_KEY, JSON.stringify({ ...loadLyreAppSettings(), ...patch })); }
    catch {}
  }
  const AUTO_PICK_PATTERNS = [
    ['direct', 'Single Note'],
    ['arp-forward-8', 'Forward Roll · eighths'],
    ['arp-reverse-8', 'Reverse Roll · eighths'],
    ['arp-forward-reverse-16', 'Forward–Reverse Roll · sixteenths'],
    ['arp-alternating-8', 'Alternating Roll · eighths'],
    ['arp-alberti-16', 'Melody-Led Alberti Figure'],
    ['arp-baroque-16', 'Baroque Broken-Chord Cycle'],
    ['arp-romantic-triplet', 'Romantic Harp Sweep · triplets'],
    ['tremolo-8', 'Measured Tremolo · eighths'],
    ['tremolo-16', 'Rapid Tremolo · sixteenths'],
    ['tremolo-triplet', 'Triplet Tremolo'],
    ['tremolo-burst-16', 'Three-Stroke Tremolo Burst'],
    ['strum-reggae-8', 'Reggae Offbeat Skank'],
    ['strum-bossa-16', 'Bossa Nova Syncopation'],
    ['strum-rasgueado-16', 'Rasgueado Burst'],
    ['strum-waltz', 'Waltz Down–Up–Up'],
    ['strum-bluegrass-8', 'Bluegrass Boom–Chuck'],
  ];
  const DEFAULT_AUTO_PICK_SLOTS = ['direct', 'arp-forward-reverse-16', 'tremolo-16', 'strum-reggae-8']; // Up, Right, Down, Left — matches lyre-performance.html's own default.
  const AUTO_PICK_SLOT_LABELS = ['Up', 'Right', 'Down', 'Left'];
  function renderPatternLoadoutSettings() {
    const container = document.getElementById('lyrePatternLoadoutSettings');
    if (!container) return;
    container.innerHTML = '';
    const saved = loadLyreAppSettings();
    const validIds = new Set(AUTO_PICK_PATTERNS.map(([id]) => id));
    const slots = Array.from({ length: 4 }, (_, index) => {
      const candidate = Array.isArray(saved.autoPickSlots) ? saved.autoPickSlots[index] : null;
      return candidate && validIds.has(candidate) ? candidate : DEFAULT_AUTO_PICK_SLOTS[index];
    });
    slots.forEach((currentId, slotIndex) => {
      const row = document.createElement('div');
      row.className = 'input-binding-row';
      row.innerHTML = `<span class="settings-name">${AUTO_PICK_SLOT_LABELS[slotIndex]}</span><select class="settings-select">${AUTO_PICK_PATTERNS.map(([id, label]) => `<option value="${id}"${id === currentId ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
      row.querySelector('select').addEventListener('change', event => {
        slots[slotIndex] = event.target.value;
        saveLyreAppSettings({ autoPickSlots: slots.slice() });
      });
      container.appendChild(row);
    });
  }

  const FREEPLAY_TONIC_NOTES = [['C',0],['C#',1],['D',2],['D#',3],['E',4],['F',5],['F#',6],['G',7],['G#',8],['A',9],['A#',10],['B',11]];
  const FREEPLAY_TONIC_BASE_MIDI = 48; // C3 — matches lyre-performance.html's own default tonicMidi.
  const FREEPLAY_SCALE_NAMES = ['Pentatonic Minor', 'Pentatonic Major', 'Chromatic', 'Hexatonic', 'Major', 'Minor', 'Hirajoshi', 'Phrygian', 'Yo'];
  function renderFreeplayKeySettings() {
    const container = document.getElementById('lyreFreeplayKeySettings');
    if (!container) return;
    container.innerHTML = '';
    const saved = loadLyreAppSettings();
    const savedTonicMidi = Number.isFinite(saved.tonicMidi) ? saved.tonicMidi : FREEPLAY_TONIC_BASE_MIDI;
    const currentOffset = ((savedTonicMidi - FREEPLAY_TONIC_BASE_MIDI) % 12 + 12) % 12;
    const currentScale = FREEPLAY_SCALE_NAMES.includes(saved.scaleName) ? saved.scaleName : 'Major';

    const keyRow = document.createElement('div');
    keyRow.className = 'input-binding-row';
    keyRow.innerHTML = `<span class="settings-name">Root note</span><select class="settings-select">${FREEPLAY_TONIC_NOTES.map(([name, offset]) => `<option value="${offset}"${offset === currentOffset ? ' selected' : ''}>${name}</option>`).join('')}</select>`;
    keyRow.querySelector('select').addEventListener('change', event => {
      saveLyreAppSettings({ tonicMidi: FREEPLAY_TONIC_BASE_MIDI + Number(event.target.value) });
    });
    container.appendChild(keyRow);

    const scaleRow = document.createElement('div');
    scaleRow.className = 'input-binding-row';
    scaleRow.innerHTML = `<span class="settings-name">Scale</span><select class="settings-select">${FREEPLAY_SCALE_NAMES.map(name => `<option value="${name}"${name === currentScale ? ' selected' : ''}>${name}</option>`).join('')}</select>`;
    scaleRow.querySelector('select').addEventListener('change', event => {
      saveLyreAppSettings({ scaleName: event.target.value });
    });
    container.appendChild(scaleRow);
  }

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
  function onPlayerFrameLoaded() {
    if (!playerSession) return;
    const bridge = bridgeOf(frameEl);
    if (!bridge) { window.__farmLog?.('music minigame: control bridge missing after load', 'warn'); return; }
    if (playerSession.mode === 'backup') bridge.startBackupPreviewSong?.(playerSession.songId);
    else bridge.enterJamMode?.(); // Regular/improvise mode — the compact song picker (see buildEdgeControls) handles picking a real song from here.
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

  // Drives each performer's Kurraya twitch (see js/kurraya-instrument.js via
  // game.js's triggerPlayerKurrayaTwitch/triggerNpcKurrayaTwitch) off the
  // actual notes sounding, not a canned animation loop. Every iframe here
  // reports 'lead' or 'backup' purely as roles WITHIN that one performance
  // (see registerVoice in lyre-performance.html) — which real-world
  // performer that maps to depends on whose iframe it came from and, for
  // the player's overlay in backup mode, which role the note itself was.
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'hobunji-music-minigame' || data.type !== 'sounded-note') return;
    onSoundedNote(data, event.source);
  });
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
    document.getElementById('compactSongPicker')?.remove();
    document.getElementById('musicLayoutHud')?.remove();
    document.getElementById('musicModeShiftHud')?.remove();
    const performanceHud = document.getElementById('musicPerformanceHud');
    if (performanceHud) {
      if (performanceHud.__hobunjiStatusListener) window.removeEventListener('message', performanceHud.__hobunjiStatusListener);
      performanceHud.remove();
    }
    // installHostedKeyboardBridge (see buildEdgeControls) attaches its
    // keydown/keyup to the HOST window in the capture phase, which runs
    // before ANY bubble-phase listener on window regardless of
    // registration order — including game.js's own movement/action keydown
    // handler. Without removing it here, it stays attached forever after
    // the overlay closes and keeps swallowing whatever keys are currently
    // bound to Lyre notes/banks (A/S/D/F and the arrows by default) before
    // movement ever sees them.
    const staleKeyboard = window.__hobunjiHostedKeyboardBridgeHandlers;
    if (staleKeyboard) {
      window.removeEventListener('keydown', staleKeyboard.keydown, true);
      window.removeEventListener('keyup', staleKeyboard.keyup, true);
      window.removeEventListener('blur', staleKeyboard.blur);
      window.__hobunjiHostedKeyboardBridgeHandlers = null;
    }
    // Retires the rAF gamepad poller (see pollHostedController) rather than
    // leaving it running forever against a bridge whose iframe document is
    // about to be torn down.
    window.__hobunjiHostedControllerPollGeneration = (window.__hobunjiHostedControllerPollGeneration || 0) + 1;
  }

  // ── Edge controls (the actual touch/mouse/keyboard/gamepad play surface) ──
  // Ported directly from the reference mockup's own buildHostedMusicEdgeControls
  // (docs/references/(HA)MusicMinigameV3.html) rather than an original design:
  // a 4-way Auto Pick tap cross + Pause/Restart Harmony on the left
  // (compactUtilityPanel), five bank columns of four direct-address note
  // buttons on the right (fiveGroupBoardPanel — deliberately no X/A/B/Y
  // face-button diamond, matching the reference's own default layout), a
  // manual mobile/keyboard/controller cycle button (#musicLayoutHud), an
  // active-bank reminder shown only for keyboard/controller
  // (#musicModeShiftHud), and a collapsible song picker above the left
  // panel (#compactSongPicker). The iframe's own native buttons stay
  // hidden by its "hosted-minigame" body styling (see
  // lyre-performance.html) so the 3D scene stays clear; this drives the
  // same HobunjiMusicControlBridge methods that ARE still exposed.
  // Rebuilt fresh each time the overlay opens (the iframe is a brand-new
  // document every time, per close()'s src='about:blank'), and each call
  // owns its own closures for layout/bank/keyboard/gamepad state — no
  // module-level state to reset between sessions.
  function buildEdgeControls(frame) {
    const leftMount = document.getElementById('leftMusicControls');
    const rightMount = document.getElementById('rightMusicControls');
    const bridge = bridgeOf(frame);
    if (!leftMount || !rightMount || !bridge) return false;

    const groupDefinitions = [
      { slot:'open', control:null, color:'#67e3d3', keyboardHint:'Open', controllerHint:'Open' },
      { slot:'lt', control:'lt', color:'#ffb86c', keyboardHint:'◀', controllerHint:'LT' },
      { slot:'rt', control:'rt', color:'#ff92a9', keyboardHint:'▶', controllerHint:'RT' },
      { slot:'lb', control:'lb', color:'#b39cff', keyboardHint:'▲', controllerHint:'LB' },
      { slot:'rb', control:'rb', color:'#92efbb', keyboardHint:'▼', controllerHint:'RB' },
    ];
    const noteDefinitions = [{ noteIndex:0 }, { noteIndex:1 }, { noteIndex:2 }, { noteIndex:3 }];
    const noteGlyphsByLayout = { mobile:['1','2','3','4'], keyboard:['1','2','3','4'], controller:['X','A','B','Y'] }; // Keyboard shows ordinal numbers, not the literal bound key — see noteKeyCodes, which is player-rebindable.
    const bankSlotByControl = Object.fromEntries(groupDefinitions.filter(g => g.control).map(g => [g.control, g.slot]));
    const controlForBankSlot = Object.fromEntries(groupDefinitions.filter(g => g.control).map(g => [g.slot, g.control]));
    const hostedBankOffsetBySlot = { open:0, lt:4, rt:8, lb:12, rb:16 }; // Used only by the Lyre highlight, so hosted keyboard/controller visuals have one authoritative active string.
    const keyboardBankByCode = { ArrowLeft:'lt', ArrowUp:'rt', ArrowRight:'lb', ArrowDown:'rb' }; // Keyboard shift order follows the visible bank sequence: Left, Up, Right, Down.
    const autoPickSectorByArrow = { ArrowUp:0, ArrowRight:1, ArrowDown:2, ArrowLeft:3 }; // Shift+Arrow selects one of the four slottable Auto Pick modes.
    let activeInputLayout = ['mobile','keyboard','controller'].includes(window.__hobunjiHostedControlLayout) ? window.__hobunjiHostedControlLayout : 'mobile'; // Persists the player's last manual choice across overlay opens.
    let activeBankSlot = 'open'; // Which color group glows in keyboard/controller layouts.
    let activeBankResetTimer = 0; // Transient-tap fallback only; real held keyboard/controller banks suppress this.
    const hostedKeyboardSources = new Map(); // Lets keyup release the exact held bridge inputs a keydown created.
    const heldBankControls = new Set(); // Real keyboard/controller bank holds own the Lyre highlight until physical release.
    const hostedControllerSources = new Map(); // Records held gamepad notes/banks so Controller layout routes every down/up pair through the bridge.

    // Only meaningful in lead/solo mode — joining an NPC as backup already
    // fixes the song to whatever they're leading (see beginPlayerSession).
    const showSongPicker = playerSession?.mode === 'lead';

    leftMount.innerHTML = `
      <aside class="edgeMusicPanel compactUtilityPanel" aria-label="Left-side utility controls">
        <div class="concertinaGroupHead"><strong>Auto Pick</strong><small>4 slottable modes</small></div>
        <div class="edgeLeftStickRow fourWayAutoPickRow" aria-label="Four-way Auto Pick controls">
          <div class="autoPickCrossWrap">
            <div class="autoPickCross" aria-label="Four-way Auto Pick mode cross">
              <button class="edgeControllerBtn autoPickCrossBtn" type="button" data-auto-pick-sector="0" aria-label="Select Up Auto Pick mode"><span class="directionGlyph">▲</span><span class="modeText">UP</span></button>
              <button class="edgeControllerBtn autoPickCrossBtn" type="button" data-auto-pick-sector="1" aria-label="Select Right Auto Pick mode"><span class="directionGlyph">▶</span><span class="modeText">RIGHT</span></button>
              <button class="edgeControllerBtn autoPickCrossBtn" type="button" data-auto-pick-sector="2" aria-label="Select Down Auto Pick mode"><span class="directionGlyph">▼</span><span class="modeText">DOWN</span></button>
              <button class="edgeControllerBtn autoPickCrossBtn" type="button" data-auto-pick-sector="3" aria-label="Select Left Auto Pick mode"><span class="directionGlyph">◀</span><span class="modeText">LEFT</span></button>
              <div class="autoPickCrossCenter">MODE</div>
            </div>
            <div class="autoPickCrossHint" data-auto-pick-hint>Tap direction</div>
          </div>
          <div class="edgeStickSide">
            <button class="edgeControllerBtn system" type="button" data-bridge-action="pause"><span class="glyph">START</span><span class="action-label">Exit</span></button>
            <button class="edgeControllerBtn system" type="button" data-bridge-reset-harmony><span class="glyph">↻</span><span class="action-label">Restart Harmony</span></button>
          </div>
        </div>
      </aside>`;

    rightMount.innerHTML = `
      <aside class="edgeMusicPanel fiveGroupBoardPanel" aria-label="Five-group note board">
        <div class="concertinaGroupHead"><strong>Five groups</strong><small>hold notes to continue Auto Pick</small></div>
        <div class="fiveGroupBoard">${groupDefinitions.map(group => `
          <section class="fiveGroupColumn" data-bank-slot="${group.slot}" style="--group-color:${group.color}" aria-label="${group.slot}">
            <div class="fiveGroupColorCap" aria-hidden="true"></div>
            <div class="fiveGroupButtons">${noteDefinitions.map(note => `<button class="edgeControllerBtn fiveGroupNoteBtn" type="button" data-direct-bank="${group.slot}" data-direct-note="${note.noteIndex}" style="--group-color:${group.color}"><span class="noteOrdinal"></span></button>`).join('')}</div>
          </section>`).join('')}</div>
        <div class="fiveGroupBottomBar">
          <div class="fiveGroupScaleRow" aria-label="Scale controls">
            <button class="edgeControllerBtn system" type="button" data-bridge-action="scale-prev"><span class="glyph">◀</span><span class="action-label">Prev scale</span></button>
            <button class="edgeControllerBtn system" type="button" data-bridge-action="scale-next"><span class="glyph">▶</span><span class="action-label">Next scale</span></button>
          </div>
          <div class="concertinaStrumWrap" aria-label="Right stick strum input">
            <div class="edgeStickPad strum" data-bridge-stick="right"><div class="edgeStickNub">STRUM</div></div>
            <small>Strum</small>
          </div>
        </div>
      </aside>`;

    // ── Compact song picker (lead mode only) ───────────────────────────
    let compactSongPicker = null;
    if (showSongPicker) {
      compactSongPicker = document.createElement('section');
      compactSongPicker.id = 'compactSongPicker';
      compactSongPicker.setAttribute('aria-label', 'Song selector');
      compactSongPicker.innerHTML = `<button id="compactSongPickerToggle" type="button" aria-expanded="false"><span class="songPickerTitle">Song</span><span class="songPickerChevron">▼</span></button><div id="compactSongPickerList" role="listbox" aria-label="Songs"></div>`;
      leftMount.parentElement?.appendChild(compactSongPicker);

      const positionCompactSongPicker = () => {
        const panel = leftMount.querySelector('.compactUtilityPanel');
        if (!panel) return;
        const bottomInset = Math.max(6, parseFloat(getComputedStyle(leftMount).bottom) || 6);
        const panelHeight = panel.getBoundingClientRect().height;
        compactSongPicker.style.bottom = `${Math.ceil(bottomInset + panelHeight + 7)}px`;
      };

      const renderCompactSongPicker = (menuState = null) => {
        let menu = menuState;
        try { menu ||= bridge.gameplayMenuState?.(); } catch (_) { menu = null; }
        if (!menu) return;
        const title = compactSongPicker.querySelector('.songPickerTitle');
        const list = compactSongPicker.querySelector('#compactSongPickerList');
        if (title) title.textContent = menu.selectedSongTitle || 'Choose song';
        if (!list) return;
        list.replaceChildren();
        let lastGroup = '';
        for (const song of menu.songs || []) {
          const group = String(song.group || 'Songs');
          if (group !== lastGroup) {
            const heading = document.createElement('div');
            heading.className = 'compactSongPickerGroup';
            heading.textContent = group;
            list.appendChild(heading);
            lastGroup = group;
          }
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'compactSongPickerItem';
          button.classList.toggle('selected', song.id === menu.selectedSong);
          button.dataset.compactSong = song.id;
          button.setAttribute('role', 'option');
          button.setAttribute('aria-selected', song.id === menu.selectedSong ? 'true' : 'false');
          const label = document.createElement('span');
          label.textContent = song.title;
          const meta = document.createElement('small');
          meta.textContent = song.id === menu.selectedSong ? 'Selected' : (song.bpm ? `${song.bpm} BPM` : 'Choose');
          button.append(label, meta);
          list.appendChild(button);
        }
      };
      compactSongPicker.querySelector('#compactSongPickerToggle')?.addEventListener('click', event => {
        event.preventDefault();
        const open = !compactSongPicker.classList.contains('open');
        compactSongPicker.classList.toggle('open', open);
        event.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) renderCompactSongPicker();
      });
      compactSongPicker.querySelector('#compactSongPickerList')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-compact-song]');
        if (!button) return;
        event.preventDefault();
        const songId = button.dataset.compactSong;
        let menu = bridge.selectGameplaySong?.(songId);
        compactSongPicker.classList.remove('open');
        compactSongPicker.querySelector('#compactSongPickerToggle')?.setAttribute('aria-expanded', 'false');
        if (songId !== 'freeplay') {
          try { menu = await bridge.startGameplaySong?.() || menu; }
          catch (error) { window.__farmLog?.(`music minigame: song start failed — ${error.message}`, 'warn'); }
        }
        renderCompactSongPicker(menu);
      });
      requestAnimationFrame(positionCompactSongPicker);
      setTimeout(positionCompactSongPicker, 120);
      window.addEventListener('resize', positionCompactSongPicker, { passive: true });
      renderCompactSongPicker();
    }

    // ── Manual mobile/keyboard/controller layout cycle ──────────────────
    let layoutHud = document.getElementById('musicLayoutHud');
    if (!layoutHud) {
      layoutHud = document.createElement('section');
      layoutHud.id = 'musicLayoutHud';
      document.body.appendChild(layoutHud);
    }
    let modeHud = document.getElementById('musicModeShiftHud');
    if (!modeHud) {
      modeHud = document.createElement('section');
      modeHud.id = 'musicModeShiftHud';
      document.body.appendChild(modeHud);
    }

    // ── Score/combo/accuracy/chord readout ───────────────────────────────
    // The iframe's own Score/Combo/Accuracy row and chord/mode labels are
    // hidden in hosted mode (see lyre-performance.html) because they're
    // laid out for a full-width screen and clip inside this narrow note-
    // lane strip. lyre-performance.html's own hobunjiHostedMusicBridge
    // script already tracks them via MutationObserver and posts
    // {type:'status', score, combo, accuracy, feedback, chord} on every
    // change — this just renders that into a host-side readout with real
    // screen space — a bar along the bottom, ending just left of the
    // right-hand note buttons (see #musicPerformanceHud in style.css).
    let performanceHud = document.getElementById('musicPerformanceHud');
    if (!performanceHud) {
      performanceHud = document.createElement('section');
      performanceHud.id = 'musicPerformanceHud';
      performanceHud.innerHTML = `
        <div class="perfHudMainRow">
          <div class="perfHudRow perfHudScore"><span>Score</span><strong data-perf="score">0</strong></div>
          <div class="perfHudRow perfHudCombo"><span>Combo</span><strong data-perf="combo">0</strong><span data-perf="accuracy" class="perfHudAccuracy"></span></div>
        </div>
        <div class="perfHudChord" data-perf="chord"></div>
        <div class="perfHudFeedback" data-perf="feedback"></div>`;
      document.body.appendChild(performanceHud);
    }
    const perfHudNodes = {
      score: performanceHud.querySelector('[data-perf="score"]'),
      combo: performanceHud.querySelector('[data-perf="combo"]'),
      accuracy: performanceHud.querySelector('[data-perf="accuracy"]'),
      chord: performanceHud.querySelector('[data-perf="chord"]'),
      feedback: performanceHud.querySelector('[data-perf="feedback"]'),
    };
    const onStatusMessage = event => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== 'hobunji-music-minigame' || data.type !== 'status') return;
      if (perfHudNodes.score) perfHudNodes.score.textContent = data.score;
      if (perfHudNodes.combo) perfHudNodes.combo.textContent = data.combo;
      if (perfHudNodes.accuracy) perfHudNodes.accuracy.textContent = data.accuracy && data.accuracy !== '—' ? `· ${data.accuracy}` : '';
      if (perfHudNodes.chord) perfHudNodes.chord.textContent = data.chord || '';
      if (perfHudNodes.feedback) perfHudNodes.feedback.classList.toggle('show', !!data.feedbackVisible);
      if (perfHudNodes.feedback && data.feedback) perfHudNodes.feedback.textContent = data.feedback;
    };
    window.addEventListener('message', onStatusMessage);
    performanceHud.__hobunjiStatusListener = onStatusMessage;

    const applyHostedLayoutToFrame = () => {
      try { if (frame.contentWindow) frame.contentWindow.__hobunjiHostedInputLayout = activeInputLayout; } catch {}
    };
    const glyphsForLayout = layout => noteGlyphsByLayout[layout] || noteGlyphsByLayout.mobile;
    const pulseNoteButton = (bankSlot, noteIndex) => {
      const button = rightMount.querySelector(`.fiveGroupNoteBtn[data-direct-bank="${bankSlot}"][data-direct-note="${noteIndex}"]`);
      if (!button) return;
      button.classList.add('played');
      clearTimeout(button.__fiveGroupPlayedTimer);
      button.__fiveGroupPlayedTimer = setTimeout(() => button.classList.remove('played'), 170);
    };

    const renderLayoutHud = () => {
      const layoutOrder = ['mobile', 'keyboard', 'controller'];
      const prettyLayout = activeInputLayout[0].toUpperCase() + activeInputLayout.slice(1);
      layoutHud.innerHTML = `<button class="layoutCycleBtn" type="button" aria-label="Change music control layout. Current layout: ${prettyLayout}"><span>Layout</span><strong>${prettyLayout}</strong><b aria-hidden="true">↻</b></button>`;
      layoutHud.querySelector('.layoutCycleBtn')?.addEventListener('click', () => {
        const currentIndex = Math.max(0, layoutOrder.indexOf(activeInputLayout));
        setInputLayout(layoutOrder[(currentIndex + 1) % layoutOrder.length]);
      });
    };

    const modeHudGlyphFor = group => activeInputLayout === 'controller' ? group.controllerHint : group.keyboardHint;
    const renderModeHud = () => {
      modeHud.classList.toggle('hidden', activeInputLayout === 'mobile');
      modeHud.innerHTML = `<div class="modeHudTitle">Mode shifts</div><div class="modeHudRow">${groupDefinitions.map(group => `<div class="modeHudChip${group.slot === activeBankSlot ? ' active' : ''}" style="--group-color:${group.color}"><strong>${modeHudGlyphFor(group)}</strong></div>`).join('')}</div>`;
    };

    const updateBoardLabels = () => {
      const activeGlyphs = glyphsForLayout(activeInputLayout);
      rightMount.querySelectorAll('.fiveGroupColumn').forEach(column => {
        const bankSlot = column.dataset.bankSlot || 'open';
        const showColumnGlyphs = activeInputLayout === 'mobile' || bankSlot === activeBankSlot;
        column.classList.toggle('active', activeInputLayout === 'mobile' ? true : bankSlot === activeBankSlot);
        column.querySelectorAll('.fiveGroupNoteBtn').forEach(button => {
          const noteIndex = Number(button.dataset.directNote) || 0;
          const glyph = activeGlyphs[noteIndex];
          const ordinal = button.querySelector('.noteOrdinal');
          if (ordinal) ordinal.textContent = showColumnGlyphs ? glyph : '';
          button.classList.toggle('dim', !showColumnGlyphs);
          button.setAttribute('aria-label', `${bankSlot} note ${glyph}`);
        });
      });
    };

    const applyActiveBankVisuals = () => {
      if (activeInputLayout === 'mobile') activeBankSlot = 'open';
      renderModeHud();
      updateBoardLabels();
    };

    const setActiveBankSlot = slot => {
      activeBankSlot = groupDefinitions.some(g => g.slot === slot) ? slot : 'open';
      applyActiveBankVisuals();
    };

    const scheduleReturnToOpenBank = (delayMs = 340) => {
      clearTimeout(activeBankResetTimer);
      if (heldBankControls.size) return; // A real bank hold owns the highlight; transient input pulses cannot steal it.
      activeBankResetTimer = setTimeout(() => {
        if (!heldBankControls.size) setActiveBankSlot('open');
      }, delayMs);
    };

    const releaseHostedKeyboardInputs = () => {
      for (const [code, binding] of hostedKeyboardSources.entries()) {
        if (binding.kind === 'note') bridge.noteUp(binding.value, binding.sourceId);
        if (binding.kind === 'bank') {
          bridge.bankUp(binding.value, binding.sourceId);
          heldBankControls.delete(binding.value);
        }
        hostedKeyboardSources.delete(code);
      }
      if (activeInputLayout === 'keyboard' && !heldBankControls.size) setActiveBankSlot('open');
    };

    const setInputLayout = layout => {
      activeInputLayout = ['mobile', 'keyboard', 'controller'].includes(layout) ? layout : 'mobile';
      window.__hobunjiHostedControlLayout = activeInputLayout;
      applyHostedLayoutToFrame();
      releaseHostedKeyboardInputs();
      if (activeInputLayout !== 'controller') releaseHostedControllerInputs();
      renderLayoutHud();
      applyActiveBankVisuals();
      setTimeout(() => readMode(), 0);
    };

    const bindHeldButton = (button, down, up) => {
      let activePointer = null;
      button.addEventListener('pointerdown', event => {
        if (activePointer != null) return;
        event.preventDefault();
        activePointer = event.pointerId;
        button.classList.add('held');
        try { button.setPointerCapture?.(event.pointerId); } catch {}
        down(event);
      });
      const release = event => {
        if (activePointer !== event.pointerId) return;
        event.preventDefault();
        up(event);
        activePointer = null;
        button.classList.remove('held');
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', event => {
        if (activePointer == null) return;
        up({ pointerId: activePointer, preventDefault(){} });
        activePointer = null;
        button.classList.remove('held');
      });
      button.addEventListener('contextmenu', event => event.preventDefault());
    };

    const beginVisibleNoteHold = (button, pointerId) => {
      const bankSlot = button.dataset.directBank || 'open'; // Held touch notes keep their color-group bank active for the full press.
      const noteIndex = Math.max(0, Math.min(3, Number(button.dataset.directNote) || 0));
      const bankControl = controlForBankSlot[bankSlot] || null; // Shifted color groups synthesize their bank modifier for as long as the note is held.
      const holdId = `${bankSlot}-${noteIndex}-${pointerId}-${Math.round(performance.now())}`; // Unique bridge sources allow simultaneous held touches without cross-releasing.
      const hold = { bankSlot, noteIndex, bankControl, bankSource:`hold-bank-${holdId}`, noteSource:`hold-note-${holdId}` };
      button.__activeMusicNoteHold = hold;
      setActiveBankSlot(activeInputLayout === 'mobile' ? 'open' : bankSlot);
      bridge.wakeAudio().catch(() => {});
      if (bankControl) bridge.bankDown(bankControl, hold.bankSource);
      bridge.noteDown(noteIndex, hold.noteSource);
      pulseNoteButton(bankSlot, noteIndex);
    };

    const endVisibleNoteHold = button => {
      const hold = button.__activeMusicNoteHold;
      if (!hold) return;
      button.__activeMusicNoteHold = null;
      bridge.noteUp(hold.noteIndex, hold.noteSource);
      if (hold.bankControl) bridge.bankUp(hold.bankControl, hold.bankSource);
      if (activeInputLayout !== 'mobile') scheduleReturnToOpenBank(120);
    };

    rightMount.querySelectorAll('.fiveGroupNoteBtn').forEach(button => {
      bindHeldButton(button,
        event => beginVisibleNoteHold(button, event.pointerId),
        () => endVisibleNoteHold(button));
    });

    leftMount.querySelectorAll('[data-auto-pick-sector]').forEach(button => {
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        const sector = Math.max(0, Math.min(3, Number(button.dataset.autoPickSector) || 0));
        bridge.wakeAudio().catch(() => {});
        if (typeof bridge.setAutoPickMode === 'function') bridge.setAutoPickMode(sector, 'host-auto-pick-cross');
        else {
          const vectors = [[0,-1],[1,0],[0,1],[-1,0]];
          const [x, y] = vectors[sector];
          bridge.leftStick(x, y, 'host-auto-pick-cross');
          bridge.releaseLeftStick();
        }
        readMode();
      });
      button.addEventListener('contextmenu', event => event.preventDefault());
    });

    [...leftMount.querySelectorAll('[data-bridge-action]'), ...rightMount.querySelectorAll('[data-bridge-action]')].forEach(button => {
      bindHeldButton(button, () => bridge.wakeAudio().catch(() => {}), () => bridge.tap(button.dataset.bridgeAction));
    });
    leftMount.querySelector('[data-bridge-reset-harmony]')?.addEventListener('click', event => {
      event.preventDefault();
      bridge.resetHarmony();
    });

    const updateModeLabels = snapshot => {
      const stateSnapshot = snapshot || bridge.getState?.() || {};
      const labels = Array.isArray(stateSnapshot.leftStickModeLabels) ? stateSnapshot.leftStickModeLabels : ['SINGLE','F↔R','TREM 16','SKANK'];
      const selectedSector = Math.max(0, Math.min(3, Number.isFinite(Number(stateSnapshot.leftStickSector)) ? Number(stateSnapshot.leftStickSector) : 0));
      leftMount.querySelectorAll('[data-auto-pick-sector]').forEach(button => {
        const sector = Number(button.dataset.autoPickSector);
        const modeText = button.querySelector('.modeText');
        if (modeText) modeText.textContent = String(labels[sector] || `MODE ${sector + 1}`).replace(/\s+/g, ' ').slice(0, 8);
        button.classList.toggle('selected', sector === selectedSector);
      });
      const hint = leftMount.querySelector('[data-auto-pick-hint]');
      if (hint) hint.textContent = activeInputLayout === 'keyboard' ? 'Hold Shift' : (activeInputLayout === 'controller' ? 'Left stick' : 'Tap direction');
    };
    const readMode = () => updateModeLabels(bridge.getState?.());

    // ── Keyboard: installed on BOTH the host window and the iframe's own
    // window, since frameEl.contentWindow.focus() (see onPlayerFrameLoaded)
    // moves keyboard focus into the iframe, and that focus hand-off fires a
    // `blur` the parent page's own gamepad-focus tracking would otherwise
    // treat as "not focused". Listening on both windows means it doesn't
    // matter which one actually holds focus. ──────────────────────────────
    const installHostedKeyboardBridge = targetWindow => {
      if (!targetWindow) return;
      const previous = targetWindow.__hobunjiHostedKeyboardBridgeHandlers; // Rebuilds replace stale closures left behind by an earlier hosted-control instance.
      if (previous) {
        targetWindow.removeEventListener('keydown', previous.keydown, true);
        targetWindow.removeEventListener('keyup', previous.keyup, true);
        targetWindow.removeEventListener('blur', previous.blur);
      }
      const keydown = event => {
        if (activeInputLayout !== 'keyboard' || event.target?.matches?.('input,select,textarea')) return;
        if (event.repeat) {
          // A physically held key fires a continuous stream of OS auto-repeat
          // keydowns (dozens/sec) for as long as it stays down — unlike a
          // mouse/touch hold, which fires nothing further after the initial
          // press. Only the very first (non-repeat) keydown should ever
          // re-trigger noteDown/bankDown below, but a repeat for a key we're
          // already holding as a Lyre note/bank still needs to be fully
          // consumed here (preventDefault + stopImmediatePropagation) rather
          // than silently falling through to every other keydown listener on
          // the page — otherwise the game's own input handling reprocesses
          // that same repeat stream for the entire hold, adding continuous
          // background work exactly correlated with holding a note that a
          // mouse/touch hold never causes. Keys we're not tracking (e.g. an
          // unrelated key repeating while typing) pass through untouched.
          if (hostedKeyboardSources.has(event.code)) { event.preventDefault(); event.stopImmediatePropagation?.(); }
          return;
        }
        const autoPickSector = autoPickSectorByArrow[event.code];
        if (event.shiftKey && Number.isInteger(autoPickSector)) {
          event.preventDefault();
          event.stopImmediatePropagation?.();
          bridge.wakeAudio().catch(() => {});
          if (typeof bridge.setAutoPickMode === 'function') bridge.setAutoPickMode(autoPickSector, 'host-shift-arrow');
          else {
            const vectors = [[0,-1],[1,0],[0,1],[-1,0]];
            const [x, y] = vectors[autoPickSector];
            bridge.leftStick(x, y, 'host-shift-arrow');
            bridge.releaseLeftStick();
          }
          readMode();
          return;
        }
        const noteIndex = noteIndexForKeyCode(event.code);
        if (Number.isInteger(noteIndex)) {
          event.preventDefault();
          event.stopImmediatePropagation?.();
          const sourceId = `host-key-${event.code}`;
          hostedKeyboardSources.set(event.code, { kind:'note', value:noteIndex, sourceId });
          bridge.wakeAudio().catch(() => {});
          bridge.noteDown(noteIndex, sourceId);
          pulseNoteButton(activeBankSlot, noteIndex);
          return;
        }
        const bankControl = keyboardBankByCode[event.code];
        if (bankControl) {
          event.preventDefault();
          event.stopImmediatePropagation?.();
          const sourceId = `host-key-${event.code}`;
          hostedKeyboardSources.set(event.code, { kind:'bank', value:bankControl, sourceId });
          heldBankControls.add(bankControl);
          clearTimeout(activeBankResetTimer);
          bridge.wakeAudio().catch(() => {});
          bridge.bankDown(bankControl, sourceId);
          setActiveBankSlot(bankSlotByControl[bankControl] || 'open');
        }
      };
      const keyup = event => {
        const binding = hostedKeyboardSources.get(event.code);
        if (!binding) return;
        event.preventDefault();
        event.stopImmediatePropagation?.();
        if (binding.kind === 'note') bridge.noteUp(binding.value, binding.sourceId);
        if (binding.kind === 'bank') {
          bridge.bankUp(binding.value, binding.sourceId);
          heldBankControls.delete(binding.value);
        }
        hostedKeyboardSources.delete(event.code);
        if (binding.kind === 'bank') {
          const remainingBank = [...heldBankControls].at(-1);
          setActiveBankSlot(remainingBank ? (bankSlotByControl[remainingBank] || 'open') : 'open');
        }
      };
      // A blur on the host window or the iframe's own window can mean focus
      // merely moved to the OTHER half of this hosted pair (e.g. the player
      // mouse-looked/clicked the 3D scene while still physically holding a
      // note key) rather than the player actually alt-tabbing away — both
      // windows fire real note keydown/keyup independently of which one has
      // focus, so releasing every held note on that harmless internal
      // handoff would silently cut an arpeggio off mid-hold even though the
      // key is still down, with no further keydown ever arriving to revive
      // it (repeat events are filtered, and the real keyup lands on an
      // already-cleared source). document.hasFocus() stays true for the
      // whole tab through that handoff — only release when it's actually
      // false, meaning the tab/window itself lost focus.
      const blur = () => { if (!document.hasFocus()) releaseHostedKeyboardInputs(); };
      targetWindow.addEventListener('keydown', keydown, true);
      targetWindow.addEventListener('keyup', keyup, true);
      targetWindow.addEventListener('blur', blur);
      targetWindow.__hobunjiHostedKeyboardBridgeHandlers = { keydown, keyup, blur };
    };
    installHostedKeyboardBridge(window);
    installHostedKeyboardBridge(frame.contentWindow);

    // ── Gamepad: the host owns the entire pad in Controller layout (see
    // __hobunjiHostedInputLayout in lyre-performance.html — the ported
    // app's own pollGamepad stops self-polling once that's set) so bank
    // holds and the Lyre's active-bank glow share one input source. This
    // loop runs continuously via its own generation counter so a rebuilt
    // edge-controls instance invalidates any older poller instead of
    // stacking two. ──────────────────────────────────────────────────────
    const releaseHostedControllerInputs = () => {
      for (const [key, binding] of hostedControllerSources.entries()) {
        if (binding.kind === 'note') bridge.noteUp(binding.value, binding.sourceId);
        if (binding.kind === 'bank') {
          bridge.bankUp(binding.value, binding.sourceId);
          heldBankControls.delete(binding.value);
        }
        hostedControllerSources.delete(key);
      }
      bridge.releaseRightStick?.();
      if (activeInputLayout === 'controller' && !heldBankControls.size) setActiveBankSlot('open');
    };

    const controllerPollGeneration = (window.__hobunjiHostedControllerPollGeneration || 0) + 1;
    window.__hobunjiHostedControllerPollGeneration = controllerPollGeneration;
    let controllerPrevButtons = [];
    let controllerAutoPickSector = -1;
    let controllerRightStickActive = false;
    const controllerButton = (gamepad, index, key, kind, value) => {
      const pressed = (gamepad.buttons[index]?.value || 0) > (kind === 'bank' ? 0.28 : 0.55);
      const wasPressed = Boolean(controllerPrevButtons[index]);
      if (pressed === wasPressed) return;
      controllerPrevButtons[index] = pressed;
      const sourceId = `host-gp-${key}`;
      if (kind === 'note') {
        if (pressed) {
          hostedControllerSources.set(key, { kind, value, sourceId });
          bridge.wakeAudio().catch(() => {});
          bridge.noteDown(value, sourceId);
          pulseNoteButton(activeBankSlot, value);
        } else {
          bridge.noteUp(value, sourceId);
          hostedControllerSources.delete(key);
        }
        return;
      }
      if (kind === 'bank') {
        if (pressed) {
          hostedControllerSources.set(key, { kind, value, sourceId });
          heldBankControls.add(value);
          clearTimeout(activeBankResetTimer);
          bridge.wakeAudio().catch(() => {});
          bridge.bankDown(value, sourceId);
          setActiveBankSlot(bankSlotByControl[value] || 'open');
        } else {
          bridge.bankUp(value, sourceId);
          hostedControllerSources.delete(key);
          heldBankControls.delete(value);
          const remainingBank = [...heldBankControls].at(-1);
          setActiveBankSlot(remainingBank ? (bankSlotByControl[remainingBank] || 'open') : 'open');
        }
        return;
      }
      if (kind === 'tap' && pressed) {
        bridge.wakeAudio().catch(() => {});
        bridge.tap(value);
      }
    };

    const pollHostedController = () => {
      if (window.__hobunjiHostedControllerPollGeneration !== controllerPollGeneration) return;
      if (activeInputLayout !== 'controller') {
        if (hostedControllerSources.size || controllerRightStickActive) releaseHostedControllerInputs();
        controllerPrevButtons = [];
        controllerAutoPickSector = -1;
        requestAnimationFrame(pollHostedController);
        return;
      }
      const gamepad = [...(navigator.getGamepads?.() || [])].find(Boolean);
      if (!gamepad) {
        if (hostedControllerSources.size || controllerRightStickActive) releaseHostedControllerInputs();
        controllerPrevButtons = [];
        controllerAutoPickSector = -1;
        requestAnimationFrame(pollHostedController);
        return;
      }

      controllerButton(gamepad, 2, 'x', 'note', 0);
      controllerButton(gamepad, 0, 'a', 'note', 1);
      controllerButton(gamepad, 1, 'b', 'note', 2);
      controllerButton(gamepad, 3, 'y', 'note', 3);
      controllerButton(gamepad, 6, 'lt', 'bank', 'lt');
      controllerButton(gamepad, 7, 'rt', 'bank', 'rt');
      controllerButton(gamepad, 4, 'lb', 'bank', 'lb');
      controllerButton(gamepad, 5, 'rb', 'bank', 'rb');
      controllerButton(gamepad, 9, 'start', 'tap', 'pause');
      controllerButton(gamepad, 14, 'dpad-left', 'tap', 'scale-prev');
      controllerButton(gamepad, 15, 'dpad-right', 'tap', 'scale-next');

      const lxRaw = Number(gamepad.axes[0]) || 0;
      const lyRaw = Number(gamepad.axes[1]) || 0;
      const lx = Math.abs(lxRaw) < 0.22 ? 0 : lxRaw;
      const ly = Math.abs(lyRaw) < 0.22 ? 0 : lyRaw;
      if (Math.hypot(lx, ly) >= 0.58) {
        const sector = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 1 : 3) : (ly > 0 ? 2 : 0); // Up, Right, Down, Left.
        if (sector !== controllerAutoPickSector) {
          controllerAutoPickSector = sector;
          bridge.setAutoPickMode?.(sector, 'host-gamepad-auto-pick');
          readMode();
        }
      } else controllerAutoPickSector = -1;

      const rxRaw = Number(gamepad.axes[2]) || 0;
      const ryRaw = Number(gamepad.axes[3]) || 0;
      const rx = Math.abs(rxRaw) < 0.14 ? 0 : rxRaw;
      const ry = Math.abs(ryRaw) < 0.14 ? 0 : ryRaw;
      if (Math.hypot(rx, ry) >= 0.12) {
        controllerRightStickActive = true;
        bridge.rightStick(rx, ry, 'host-gamepad-right-stick');
      } else if (controllerRightStickActive) {
        controllerRightStickActive = false;
        bridge.releaseRightStick();
      }
      requestAnimationFrame(pollHostedController);
    };
    requestAnimationFrame(pollHostedController);

    // Right stick (strum) still uses a drag gesture — a single up/down
    // flick, not a 4-way pick, so it stays discoverable without a gamepad.
    const bindStick = (pad, hand, maxTranslate) => {
      const nub = pad?.querySelector('.edgeStickNub');
      if (!pad || !nub) return;
      let pointerId = null;
      const normalized = event => {
        const rect = pad.getBoundingClientRect();
        let x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        let y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        const length = Math.hypot(x, y);
        if (length > 1) { x /= length; y /= length; }
        return [x, y];
      };
      const route = event => {
        const [x, y] = normalized(event);
        nub.style.transform = `translate(${Math.max(-1, Math.min(1, x)) * maxTranslate}px, ${Math.max(-1, Math.min(1, y)) * maxTranslate}px)`;
        if (hand === 'left') bridge.leftStick(x, y, 'host-left-stick');
        else bridge.rightStick(x, y, 'host-right-stick');
      };
      pad.addEventListener('pointerdown', event => {
        if (pointerId != null) return;
        event.preventDefault();
        pointerId = event.pointerId;
        pad.classList.add('held');
        try { pad.setPointerCapture?.(event.pointerId); } catch {}
        bridge.wakeAudio().catch(() => {});
        bridge.announceInput(hand === 'left' ? 'arpPad' : 'strumPad');
        route(event);
      });
      pad.addEventListener('pointermove', event => { if (pointerId === event.pointerId) { event.preventDefault(); route(event); } });
      const release = event => {
        if (pointerId !== event.pointerId) return;
        event.preventDefault();
        if (hand === 'left') bridge.releaseLeftStick(); else bridge.releaseRightStick();
        pointerId = null;
        pad.classList.remove('held');
        nub.style.transform = 'translate(0,0)';
        readMode();
      };
      pad.addEventListener('pointerup', release);
      pad.addEventListener('pointercancel', release);
      pad.addEventListener('lostpointercapture', () => {
        if (pointerId == null) return;
        if (hand === 'left') bridge.releaseLeftStick(); else bridge.releaseRightStick();
        pointerId = null;
        pad.classList.remove('held');
        nub.style.transform = 'translate(0,0)';
        readMode();
      });
      pad.addEventListener('contextmenu', event => event.preventDefault());
    };
    bindStick(rightMount.querySelector('[data-bridge-stick="right"]'), 'right', 20);

    applyHostedLayoutToFrame();
    renderLayoutHud();
    readMode();
    applyActiveBankVisuals();
    clearInterval(window.__hobunjiModeLabelTimer);
    window.__hobunjiModeLabelTimer = setInterval(readMode, 180); // Keeps host labels synchronized after slot edits inside Music setup.

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
    // Gives the ambient metronome a beat matching the ground this NPC is
    // actually standing on (see game.js's npcFootstepSampleUrl) instead of
    // a generic click — null falls back to the iframe's own default.
    const footstepSampleUrl = deps.getNpcFootstepSampleUrl?.(npcId) || null;
    frame.addEventListener('load', () => { bridgeOf(frame)?.startAmbientLead?.(songId, footstepSampleUrl); }, { once: true });
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
    // The hidden ambient <iframe> plays through the browser's normal (non-
    // positional) audio output, so it's audible everywhere regardless of
    // which map it's attached to — only ever start/keep one sounding for
    // whichever area the player is actually standing in right now.
    const currentArea = deps.getCurrentArea();

    // Stop ambient audio (and release leadership) for anyone no longer on
    // duty, or on duty in a map the player has since left.
    for (const npcId of [...ambientFrames.keys()]) {
      const performer = performers.find(p => p.npcId === npcId);
      if (performer && performer.area === currentArea) continue;
      stopAmbientForNpc(npcId);
      for (const [area, leader] of leaderByArea) {
        if (leader.type === 'npc' && leader.id === npcId) leaderByArea.delete(area);
      }
    }

    for (const performer of performers) {
      if (performer.area !== currentArea) continue; // Not audible from here — don't even start it.
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
    renderNoteKeySettings, // Called once at boot by game.js, the same way it calls window.InputSettingsPanel.render().
    renderPatternLoadoutSettings,
    renderFreeplayKeySettings,
    get state() { return playerSession; },
    // True while any instrument NPC's ambient audio is sounding, even when
    // the player's own overlay is closed — see updateLyreDucking in
    // js/music-system.js, which ducks the game's ambient bgm/cues for as
    // long as either this or the player session is active.
    get ambientActive() { return ambientFrames.size > 0; },
  };
})();
