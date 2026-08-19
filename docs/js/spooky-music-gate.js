// Scheduler-level spooky-night music ownership. During 01:00-05:00 this makes
// only Music.updateAmbientCues() observe audio as disabled, so its own slot
// retirement prevents normal exploration/night BGM and cues from respawning.
(() => {
  'use strict';
  if (window.SpookyMusicGate) return;

  let installed = false; // Exposed in diagnostics so mobile tests can verify the scheduler wrapper actually armed.
  let lastActive = false; // Used to emit one transition log instead of one message per animation frame.

  function log(message, level = 'info') {
    const logger = window.__farmLog;
    if (typeof logger === 'function') logger(`[spooky-music-gate] ${message}`, level, 'audio');
    else if (level === 'warn' || level === 'error') console.warn(`[spooky-music-gate] ${message}`);
  }

  function spookyActive() {
    return window.SpookyNight?.isActive?.() === true;
  }

  function install() {
    const music = window.Music;
    if (!music || typeof music.updateAmbientCues !== 'function') return false;
    if (music.updateAmbientCues.__spookyMusicGate) {
      installed = true;
      return true;
    }

    const rawUpdateAmbientCues = music.updateAmbientCues; // Existing scheduler entry point retained for normal hours and called inside the temporary config gate below.
    function spookyGatedAmbientCues(...args) {
      const active = spookyActive();
      if (active !== lastActive) {
        lastActive = active;
        log(active
          ? 'spooky hours own exploration music; retiring regular BGM/cues through Music scheduler.'
          : 'spooky hours ended; normal Music scheduler resumed.', 'bgm');
      }
      if (!active) return rawUpdateAmbientCues.apply(this, args);

      const audioSystem = window.AudioSystem;
      const rawGameAudioConfig = audioSystem?.gameAudioConfig;
      if (typeof rawGameAudioConfig !== 'function') {
        // Keep running rather than breaking the game if AudioSystem is not ready;
        // spooky-night's older per-track muting remains a last-resort fallback.
        log('AudioSystem.gameAudioConfig unavailable; scheduler gate fell back to existing spooky muting.', 'warn');
        return rawUpdateAmbientCues.apply(this, args);
      }

      audioSystem.gameAudioConfig = function spookyMusicOnlyDisabledConfig(...configArgs) {
        const config = rawGameAudioConfig.apply(this, configArgs) || {};
        return { ...config, enabled: false };
      };
      try {
        // Music.updateAmbientCues() treats enabled=false as an instruction to
        // stop ambient cue/BGM/combat slots and return before scheduling more.
        return rawUpdateAmbientCues.apply(this, args);
      } finally {
        // Restore immediately so rain audio, exterior BGS, SFX and other audio
        // systems never observe the temporary spooky-only music gate.
        audioSystem.gameAudioConfig = rawGameAudioConfig;
      }
    }
    spookyGatedAmbientCues.__spookyMusicGate = true;
    spookyGatedAmbientCues.__spookyMusicGateRaw = rawUpdateAmbientCues;
    music.updateAmbientCues = spookyGatedAmbientCues;
    installed = true;
    log('installed on Music.updateAmbientCues().', 'info');
    return true;
  }

  function armWhenReady() {
    if (install()) return;
    requestAnimationFrame(armWhenReady);
  }

  window.SpookyMusicGate = Object.freeze({
    install,
    isInstalled: () => installed,
    snapshot: () => ({ installed, active: spookyActive(), musicReady: !!window.Music?.updateAmbientCues }),
  });

  armWhenReady();
})();
