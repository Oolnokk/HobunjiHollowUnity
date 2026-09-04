(() => {
  'use strict';

  // Experimental dialogue-sample runtime. DialogueContent still owns when a
  // syllable should sound; this module only makes the bundled Kurraya sample
  // ready before that moment and applies its authored dialogue pitch.
  const DEFAULT_SAMPLE_URL = 'assets/audio/music/instruments/sfx_kurraya_pluck.m4a'; // Used as the experiment's sample when audio.dialogueLetter.url is not explicitly authored.
  const DEFAULT_PLAYBACK_RATE = 4; // Used for +2 octaves (2^2) while pitch preservation is disabled below.
  const DEFAULT_POOL_SIZE = 8; // Used to allow rapid/overlapping syllables without constructing/decoding a fresh media element per pulse.

  const NativeAudio = window.Audio; // Preserved for every non-dialogue Audio() call and as the constructor for pooled voices.
  if (typeof NativeAudio !== 'function' || window.DialogueKurrayaSampleRuntime?.installed) return;

  function dialogueConfig() {
    const root = window.SCRATCHBONES_CONFIG?.game?.audio;
    if (!root) return null;
    const cfg = root.dialogueLetter || (root.dialogueLetter = {});
    if (!Object.hasOwn(cfg, 'url')) cfg.url = DEFAULT_SAMPLE_URL;
    if (!Object.hasOwn(cfg, 'playbackRate')) cfg.playbackRate = DEFAULT_PLAYBACK_RATE;
    if (!Object.hasOwn(cfg, 'samplePoolSize')) cfg.samplePoolSize = DEFAULT_POOL_SIZE;
    return cfg;
  }

  function absoluteUrl(value) {
    try { return new URL(String(value || ''), document.baseURI).href; }
    catch { return String(value || ''); }
  }

  function configureVoice(audio, cfg) {
    audio.preload = 'auto';
    // Chrome/Safari may preserve pitch when playbackRate changes. Dialogue
    // wants a literal sample transposition, so disable every supported alias.
    if ('preservesPitch' in audio) audio.preservesPitch = false;
    if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = false;
    if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = false;
    audio.playbackRate = Math.max(0.25, Number(cfg?.playbackRate) || DEFAULT_PLAYBACK_RATE);
    return audio;
  }

  const pools = new Map(); // Absolute sample URL -> { voices, cursor }; reused by new Audio(dialogueSampleUrl) calls.
  function ensurePool(url, cfg = dialogueConfig()) {
    if (!url || !cfg) return null;
    const key = absoluteUrl(url);
    const size = Math.max(1, Math.min(24, Math.round(Number(cfg.samplePoolSize) || DEFAULT_POOL_SIZE)));
    let pool = pools.get(key);
    if (pool?.voices?.length === size) {
      for (const voice of pool.voices) configureVoice(voice, cfg);
      return pool;
    }
    if (pool?.voices) {
      for (const voice of pool.voices) {
        try { voice.pause(); } catch {}
      }
    }
    const voices = Array.from({ length: size }, () => {
      const voice = configureVoice(new NativeAudio(key), cfg);
      try { voice.load(); } catch {}
      return voice;
    });
    pool = { voices, cursor: 0 };
    pools.set(key, pool);
    return pool;
  }

  function nextDialogueVoice(url, cfg) {
    const pool = ensurePool(url, cfg);
    if (!pool?.voices?.length) return new NativeAudio(url);
    const voice = pool.voices[pool.cursor % pool.voices.length];
    pool.cursor = (pool.cursor + 1) % pool.voices.length;
    configureVoice(voice, cfg);
    try { voice.pause(); } catch {}
    try { voice.currentTime = 0; } catch {}
    return voice;
  }

  function DialogueAwareAudio(src) {
    const cfg = dialogueConfig();
    const targetUrl = cfg?.url;
    if (src && targetUrl && absoluteUrl(src) === absoluteUrl(targetUrl)) {
      return nextDialogueVoice(targetUrl, cfg);
    }
    return new NativeAudio(src);
  }
  DialogueAwareAudio.prototype = NativeAudio.prototype;
  Object.setPrototypeOf(DialogueAwareAudio, NativeAudio);
  window.Audio = DialogueAwareAudio;

  const initialCfg = dialogueConfig();
  if (initialCfg?.url) ensurePool(initialCfg.url, initialCfg); // Starts fetching/decoding during boot instead of at the first spoken vowel.

  window.DialogueKurrayaSampleRuntime = Object.freeze({
    installed: true,
    prewarm() {
      const cfg = dialogueConfig();
      return cfg?.url ? ensurePool(cfg.url, cfg) : null;
    },
    poolSnapshot() {
      return [...pools.entries()].map(([url, pool]) => ({ url, voices: pool.voices.length, cursor: pool.cursor }));
    },
  });
})();
