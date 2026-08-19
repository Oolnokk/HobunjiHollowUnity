// Scheduler-level spooky-night music ownership. During 01:00-05:00 this makes
// only Music.updateAmbientCues() observe audio as disabled, so its own slot
// retirement prevents normal exploration/night BGM and cues from respawning.
// It also supplies a tiny fallback bed for interior/other maps where the main
// spooky spatial mixer intentionally has factor=0, so inn/chair testing is not silent.
(() => {
  'use strict';
  if (window.SpookyMusicGate) return;

  const TRACK_URL = 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg';
  const INTERIOR_FACTOR = 0.02;
  const FALLBACK_FADE_SECONDS = 0.8;

  let installed = false;
  let lastActive = false;
  let fallbackTrack = null;
  let fallbackTarget = 0;
  let fallbackPlayPending = false;
  let fallbackLastAt = performance.now();
  let fallbackLastError = '';

  function log(message, level = 'info') {
    const logger = window.__farmLog;
    if (typeof logger === 'function') logger(`[spooky-music-gate] ${message}`, level, 'audio');
    else if (level === 'warn' || level === 'error') console.warn(`[spooky-music-gate] ${message}`);
  }

  function spookyActive() {
    return window.SpookyNight?.isActive?.() === true;
  }

  function realAudioConfig() {
    return window.AudioSystem?.gameAudioConfig?.() || window.SCRATCHBONES_CONFIG?.game?.audio || {};
  }

  function ensureFallbackTrack() {
    if (fallbackTrack) return fallbackTrack;
    const NativeAudio = window.Audio?.__nativeAudio || window.Audio;
    if (typeof NativeAudio !== 'function') return null;
    let url = TRACK_URL;
    try { url = new URL(TRACK_URL, document.baseURI).href; } catch (_) {}
    const audio = new NativeAudio(url);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio._spookyNightTrack = true;
    audio.addEventListener('canplaythrough', () => log(`fallback track ready ${audio.src}`, 'bgm'), { once: true });
    audio.addEventListener('playing', () => {
      fallbackLastError = '';
      log(`fallback track playing ${audio.src} volume=${audio.volume.toFixed(3)}`, 'bgm');
    });
    audio.addEventListener('error', () => {
      fallbackLastError = `media code=${audio.error?.code || 'none'} ${audio.error?.message || ''}`.trim();
      log(`fallback track error ${audio.src}: ${fallbackLastError}`, 'warn');
    });
    try { audio.load(); } catch (_) {}
    fallbackTrack = audio;
    return audio;
  }

  function requestFallbackPlay() {
    const audio = ensureFallbackTrack();
    if (!audio || fallbackPlayPending || !audio.paused) return;
    fallbackPlayPending = true;
    let result;
    try { result = audio.play(); }
    catch (error) {
      fallbackPlayPending = false;
      fallbackLastError = error?.name || String(error || 'play failed');
      log(`fallback play threw: ${fallbackLastError}`, 'warn');
      return;
    }
    Promise.resolve(result).catch(error => {
      fallbackLastError = error?.name || String(error || 'play failed');
      if (fallbackLastError !== 'NotAllowedError' && fallbackLastError !== 'AbortError') {
        log(`fallback play failed: ${fallbackLastError}`, 'warn');
      }
    }).finally(() => { fallbackPlayPending = false; });
  }

  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(eventName, () => {
      if (fallbackTarget > 0.001) requestFallbackPlay();
    }, { capture: true, passive: eventName === 'touchstart' });
  }

  function updateFallback(now) {
    const dt = Math.max(0, Math.min(0.25, (now - fallbackLastAt) / 1000));
    fallbackLastAt = now;
    const snap = window.SpookyNight?.snapshot?.() || null;
    const cfg = realAudioConfig();
    const bgmMaster = Math.max(0, Math.min(1, Number(cfg.bgmVolume ?? 0.48)));
    const enabled = cfg.enabled !== false && cfg.bgmEnabled !== false;

    // Main SpookyNight intentionally reports mode=other/factor=0 for interiors.
    // Give those maps the same almost-silent bed as the town center/farm.
    const needsInteriorBed = !!snap?.active && enabled && snap.mode === 'other' && Number(snap.spatialFactor || 0) <= 0.001;
    fallbackTarget = needsInteriorBed ? bgmMaster * INTERIOR_FACTOR : 0;

    const audio = ensureFallbackTrack();
    if (audio) {
      const blend = FALLBACK_FADE_SECONDS <= 0 ? 1 : 1 - Math.exp(-dt * 4.6 / FALLBACK_FADE_SECONDS);
      audio.volume = Math.max(0, Math.min(1, audio.volume + (fallbackTarget - audio.volume) * blend));
      if (fallbackTarget > 0.001) requestFallbackPlay();
      else if (audio.volume <= 0.002 && !audio.paused) audio.pause();
    }
    requestAnimationFrame(updateFallback);
  }

  function install() {
    const music = window.Music;
    if (!music || typeof music.updateAmbientCues !== 'function') return false;
    if (music.updateAmbientCues.__spookyMusicGate) {
      installed = true;
      return true;
    }

    const rawUpdateAmbientCues = music.updateAmbientCues;
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
        log('AudioSystem.gameAudioConfig unavailable; scheduler gate fell back to existing spooky muting.', 'warn');
        return rawUpdateAmbientCues.apply(this, args);
      }

      audioSystem.gameAudioConfig = function spookyMusicOnlyDisabledConfig(...configArgs) {
        const config = rawGameAudioConfig.apply(this, configArgs) || {};
        return { ...config, enabled: false };
      };
      try {
        return rawUpdateAmbientCues.apply(this, args);
      } finally {
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
    snapshot: () => ({
      installed,
      active: spookyActive(),
      musicReady: !!window.Music?.updateAmbientCues,
      fallbackTarget,
      fallbackVolume: fallbackTrack?.volume || 0,
      fallbackPaused: fallbackTrack?.paused ?? true,
      fallbackReadyState: fallbackTrack?.readyState ?? null,
      fallbackCurrentTime: fallbackTrack?.currentTime || 0,
      fallbackError: fallbackLastError || null,
      trackUrl: TRACK_URL,
    }),
  });

  armWhenReady();
  requestAnimationFrame(updateFallback);
})();
