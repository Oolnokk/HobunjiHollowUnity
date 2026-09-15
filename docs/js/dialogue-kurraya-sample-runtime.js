(() => {
  'use strict';

  // Experimental dialogue-sample runtime. The bundled Kurraya pluck is decoded
  // once into Web Audio so each dialogue letter can start immediately at an
  // exact transposed sample rate instead of relying on HTMLMediaElement pitch
  // behavior/startup latency.
  const DEFAULT_SAMPLE_URL = 'assets/audio/music/instruments/sfx_kurraya_pluck.m4a'; // Used when audio.dialogueLetter.url is not explicitly authored.
  const DEFAULT_PLAYBACK_RATE = 4; // Used for a literal +2-octave transposition (2^2) by AudioBufferSourceNode.playbackRate.
  const LETTER_PATTERN = /[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]/; // Used to give letters one sound pulse while spaces/punctuation stay silent.

  const NativeAudio = window.Audio; // Preserved for every non-dialogue Audio() call and as a no-interference fallback constructor.
  const AudioCtx = window.AudioContext || window.webkitAudioContext; // Shared browser Web Audio constructor used to decode/play the dialogue sample.
  if (typeof NativeAudio !== 'function' || !AudioCtx || window.DialogueKurrayaSampleRuntime?.installed) return;

  function dialogueConfig() {
    const root = window.SCRATCHBONES_CONFIG?.game?.audio;
    if (!root) return null;
    const cfg = root.dialogueLetter || (root.dialogueLetter = {});
    if (!Object.hasOwn(cfg, 'url')) cfg.url = DEFAULT_SAMPLE_URL;
    if (!Object.hasOwn(cfg, 'playbackRate')) cfg.playbackRate = DEFAULT_PLAYBACK_RATE;
    return cfg;
  }

  function absoluteUrl(value) {
    try { return new URL(String(value || ''), document.baseURI).href; }
    catch { return String(value || ''); }
  }

  const ctx = window._npcDialogueAudioCtx || (window._npcDialogueAudioCtx = new AudioCtx()); // Shared dialogue AudioContext reused by the legacy oscillator fallback too.
  const decodedBuffers = new Map(); // Absolute sample URL -> decoded AudioBuffer used for zero-allocation-startup letter pulses.
  const decodePromises = new Map(); // Absolute sample URL -> in-flight decode promise so boot/prewarm never decodes the same asset twice.

  function decodeSample(url) {
    const key = absoluteUrl(url);
    if (!key) return Promise.resolve(null);
    if (decodedBuffers.has(key)) return Promise.resolve(decodedBuffers.get(key));
    if (decodePromises.has(key)) return decodePromises.get(key);
    const promise = fetch(key)
      .then(response => {
        if (!response.ok) throw new Error(`dialogue sample HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(bytes => ctx.decodeAudioData(bytes.slice(0)))
      .then(buffer => {
        decodedBuffers.set(key, buffer);
        decodePromises.delete(key);
        return buffer;
      })
      .catch(error => {
        decodePromises.delete(key);
        window.__farmLog?.(`[dialogue-pluck] decode failed: ${error?.message || error}`, 'warn');
        return null;
      });
    decodePromises.set(key, promise);
    return promise;
  }

  function resumeContext() {
    if (ctx.state !== 'suspended') return Promise.resolve();
    return ctx.resume().catch(() => {});
  }

  // Unlock on the same user gesture that opens/advances dialogue so later
  // timer-driven letter pulses do not pay an AudioContext-resume delay.
  for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
    document.addEventListener(eventName, resumeContext, { capture: true, passive: true });
  }

  function playDecodedNow(url, volume, playbackRate) {
    const key = absoluteUrl(url);
    const buffer = decodedBuffers.get(key);
    if (!buffer) {
      decodeSample(key); // Keep warming, but never play a stale pulse late after its letter has already appeared.
      return false;
    }
    if (ctx.state === 'suspended') resumeContext();
    const source = ctx.createBufferSource(); // One-shot source is intentionally cheap; the heavy decode is shared above.
    const gain = ctx.createGain(); // Per-letter gain preserves the existing dialogue volume × global SFX-volume contract.
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.25, Number(playbackRate) || DEFAULT_PLAYBACK_RATE);
    gain.gain.value = Math.max(0, Math.min(1, Number(volume) || 0));
    source.connect(gain).connect(ctx.destination);
    source.start(0);
    return true;
  }

  // DialogueContent already creates `new Audio(cfg.url)` and then assigns
  // volume/playbackRate. Return this tiny compatible proxy only for the
  // dialogue sample so that existing call path and all authored overrides stay
  // intact while the actual sound is produced by Web Audio.
  function DialogueSampleProxy(src) {
    this.src = src;
    this.volume = 1;
    this.playbackRate = DEFAULT_PLAYBACK_RATE;
    this.preload = 'auto';
    this.currentTime = 0;
  }
  DialogueSampleProxy.prototype.play = function playDialogueSample() {
    playDecodedNow(this.src, this.volume, this.playbackRate);
    return Promise.resolve();
  };
  DialogueSampleProxy.prototype.pause = function pauseDialogueSample() {};
  DialogueSampleProxy.prototype.load = function loadDialogueSample() { decodeSample(this.src); };

  function DialogueAwareAudio(src) {
    const cfg = dialogueConfig();
    const targetUrl = cfg?.url;
    if (src && targetUrl && absoluteUrl(src) === absoluteUrl(targetUrl)) {
      return new DialogueSampleProxy(targetUrl);
    }
    return new NativeAudio(src);
  }
  DialogueAwareAudio.prototype = NativeAudio.prototype;
  Object.setPrototypeOf(DialogueAwareAudio, NativeAudio);
  window.Audio = DialogueAwareAudio;

  function expandSpeechScheduleToLetters(schedule) {
    if (!Array.isArray(schedule) || !schedule.length) return schedule || [];
    const expanded = []; // Letter-level reveal/audio units that retain every original syllable endpoint and pause.
    let previousRevealAtMs = 0; // Start of the current original syllable window used to distribute its letters without changing total pacing.
    for (const unit of schedule) {
      const text = String(unit?.text || '');
      const chars = [...text];
      const revealAtMs = Math.max(previousRevealAtMs, Number(unit?.revealAtMs) || previousRevealAtMs);
      const spanMs = Math.max(0, revealAtMs - previousRevealAtMs);
      if (!chars.length) {
        previousRevealAtMs = revealAtMs;
        continue;
      }
      chars.forEach((char, index) => {
        const charRevealAtMs = previousRevealAtMs + spanMs * ((index + 1) / chars.length); // Last character lands exactly on the old syllable reveal time.
        const sounds = LETTER_PATTERN.test(char) ? [char] : []; // Existing DialogueContent audio/yap loop now executes once per actual letter.
        expanded.push({
          ...unit,
          text: char,
          vowel: sounds[0] || null,
          vowels: sounds,
          revealAtMs: charRevealAtMs,
          pulseOffsetsMs: sounds.length ? [0] : [],
        });
      });
      previousRevealAtMs = revealAtMs;
    }
    return expanded;
  }

  const cadence = window.DialogueSpeechCadence; // Existing shared syllable scheduler whose total timing/punctuation pauses remain authoritative.
  if (cadence?.buildSchedule && !cadence.__dialogueLetterExpanded) {
    const originalBuildSchedule = cadence.buildSchedule.bind(cadence); // Preserved so only reveal/audio granularity changes, never authored cadence math.
    window.DialogueSpeechCadence = Object.freeze({
      ...cadence,
      __dialogueLetterExpanded: true,
      buildSchedule(text, opts) {
        return expandSpeechScheduleToLetters(originalBuildSchedule(text, opts));
      },
    });
  }

  const initialCfg = dialogueConfig();
  if (initialCfg?.url) decodeSample(initialCfg.url); // Starts fetch+decode during boot so the first spoken letter is normally already resident.

  window.DialogueKurrayaSampleRuntime = Object.freeze({
    installed: true,
    prewarm() {
      const cfg = dialogueConfig();
      return cfg?.url ? decodeSample(cfg.url) : Promise.resolve(null);
    },
    playNow(url, volume = 1, playbackRate = DEFAULT_PLAYBACK_RATE) {
      return playDecodedNow(url, volume, playbackRate);
    },
    bufferSnapshot() {
      return [...decodedBuffers.entries()].map(([url, buffer]) => ({ url, duration: buffer.duration, sampleRate: buffer.sampleRate }));
    },
  });
})();
