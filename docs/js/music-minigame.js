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
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const MUSIC_MINIGAME_SRC = 'assets/minigames/lyre-performance.html';
  const SONG_ID = 'when-the-kininjis-bloom';

  const overlayEl = document.getElementById('musicMinigameOverlay');
  const frameEl = document.getElementById('musicMinigameFrame');
  const closeBtnEl = document.getElementById('musicMinigameCloseBtn');

  let musicMinigame = null; // { npcId } while open, else null — mirrors fishingMinigame's null-when-closed convention.
  let _prevCameraMode = null;
  let _prevCameraTarget = null;

  function bridge() {
    try { return frameEl.contentWindow?.HobunjiMusicControlBridge || null; }
    catch { return null; }
  }

  // Fires once the iframe document (including its inline scripts, which
  // assign window.HobunjiMusicControlBridge synchronously before the load
  // event) has finished loading — reliable timing without needing the
  // iframe's own postMessage('ready') handshake.
  function onFrameLoaded() {
    if (!musicMinigame) return;
    const b = bridge();
    if (!b) { window.__farmLog?.('music minigame: control bridge missing after load', 'warn'); return; }
    b.selectGameplaySong?.(SONG_ID);
    // "Playing along with him" is the demo's backup-preview mode: Foroji's
    // part auto-plays the lead melody while the player free-plays chords/
    // notes alongside it (see startBackupPreviewSong in the ported app).
    b.startBackupPreviewSong?.();
  }
  frameEl?.addEventListener('load', onFrameLoaded);

  function begin({ npcId = null } = {}) {
    if (musicMinigame || !overlayEl || !frameEl) return;
    musicMinigame = { npcId };
    overlayEl.classList.add('open');
    frameEl.src = MUSIC_MINIGAME_SRC;
    _prevCameraMode = deps?.getCameraMode?.() ?? null;
    _prevCameraTarget = deps?.getCameraTarget?.() ?? null;
    deps?.refreshActionBar?.();
  }

  function close() {
    if (!musicMinigame) return;
    musicMinigame = null;
    overlayEl?.classList.remove('open');
    if (frameEl) frameEl.src = 'about:blank'; // Tears the iframe down immediately, stopping its AudioContext with it.
    if (_prevCameraMode !== null) { deps?.setCameraMode?.(_prevCameraMode); _prevCameraMode = null; }
    deps?.setCameraTarget?.(_prevCameraTarget);
    _prevCameraTarget = null;
    deps?.refreshActionBar?.();
  }

  closeBtnEl?.addEventListener('pointerup', (event) => { event.stopPropagation(); close(); });
  closeBtnEl?.addEventListener('pointerdown', (event) => { event.stopPropagation(); });

  window.MusicMinigame = {
    init,
    begin,
    close,
    get state() { return musicMinigame; },
  };
})();
