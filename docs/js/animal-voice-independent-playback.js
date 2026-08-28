(() => {
  'use strict';

  // Independent animal-voice playback. AudioSystem remains authoritative for
  // choosing species clips, range checks, and final element volume. This layer
  // captures that prepared clip at play time, decodes the selected OGG once,
  // and performs short-grain synthesis so pitch and tempo can vary separately.
  const MAX_SHIFT_SEMITONES = 12;
  const MIN_TEMPO = 0.35;
  const MAX_TEMPO = 2;
  const GRAIN_SOURCE_S = 0.09;
  const ANALYSIS_HOP_S = 0.012;
  const GRAIN_PEAK_GAIN = 0.34;
  const DEFAULT_CONTOUR_SEGMENT_MS = 260;
  const decodedByUrl = new Map();
  const previewHandles = new Set();
  let sharedContext = null;
  let installed = false;
  let lastPlaybackError = null;
  let lastBackend = 'idle';
  let lastUrl = null;
  let lastStartedAt = null;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clampPitch(semitones) { return clamp(finite(semitones, 0), -MAX_SHIFT_SEMITONES, MAX_SHIFT_SEMITONES); }
  function clampTempo(tempo) { return clamp(finite(tempo, 1), MIN_TEMPO, MAX_TEMPO); }
  function setPitchPreservation(audio, enabled) {
    try { audio.preservesPitch = enabled; } catch (_) {}
    try { audio.mozPreservesPitch = enabled; } catch (_) {}
    try { audio.webkitPreservesPitch = enabled; } catch (_) {}
  }
  function ensureContext() {
    if (sharedContext && sharedContext.state !== 'closed') return sharedContext;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try { sharedContext = new AudioCtx(); return sharedContext; }
    catch (error) { lastPlaybackError = error; return null; }
  }
  function primeAudioContext() {
    const context = ensureContext();
    if (!context || context.state === 'running') return context?.state === 'running';
    if (context.state === 'suspended') {
      try { context.resume()?.catch?.(error => { lastPlaybackError = error; }); }
      catch (error) { lastPlaybackError = error; }
    }
    return context.state === 'running';
  }
  function installGestureUnlock() {
    if (typeof window.addEventListener !== 'function') return;
    const unlock = () => { primeAudioContext(); };
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }
  function absoluteUrl(url) {
    try { return new URL(url, document.baseURI).href; } catch (_) { return String(url || ''); }
  }
  function decodeUrl(url, context) {
    const resolved = absoluteUrl(url);
    if (!resolved) return Promise.reject(new Error('Animal voice URL is empty'));
    if (decodedByUrl.has(resolved)) return decodedByUrl.get(resolved);
    const pending = fetch(resolved)
      .then(response => {
        if (!response.ok) throw new Error(`Animal voice fetch ${response.status}: ${resolved}`);
        return response.arrayBuffer();
      })
      .then(bytes => context.decodeAudioData(bytes.slice(0)))
      .catch(error => { decodedByUrl.delete(resolved); throw error; });
    decodedByUrl.set(resolved, pending);
    return pending;
  }
  function contourValue(values, fallback, outputElapsedS, segmentMs) {
    if (!Array.isArray(values) || !values.length) return fallback;
    const index = Math.min(values.length - 1, Math.max(0, Math.floor((outputElapsedS * 1000) / segmentMs)));
    return values[index] ?? fallback;
  }
  function makeHannCurve(points = 24) {
    const curve = new Float32Array(Math.max(4, points));
    for (let index = 0; index < curve.length; index++) {
      const phase = index / Math.max(1, curve.length - 1);
      curve[index] = (0.5 - 0.5 * Math.cos(Math.PI * 2 * phase)) * GRAIN_PEAK_GAIN;
    }
    return curve;
  }
  const HANN_CURVE = makeHannCurve();

  function scheduleGranularBuffer(context, buffer, opts, onFinished) {
    const baseTempo = clampTempo(opts.tempo ?? opts.rate ?? 1);
    const basePitch = clampPitch(opts.pitchSemitones ?? 0);
    const tempoContour = Array.isArray(opts.tempoContour) ? opts.tempoContour.map(clampTempo) : null;
    const pitchContour = Array.isArray(opts.pitchContourSemitones) ? opts.pitchContourSemitones.map(clampPitch) : null;
    const segmentMs = Math.max(40, finite(opts.contourSegmentMs, DEFAULT_CONTOUR_SEGMENT_MS));
    const master = context.createGain();
    master.gain.value = clamp(finite(opts.volume, 0.7), 0, 1);
    master.connect(context.destination);
    const grains = new Set();
    let stopped = false;
    let sourceOffsetS = 0;
    let outputElapsedS = 0;
    let maxTailS = 0;
    const startAt = context.currentTime + 0.018;

    while (sourceOffsetS < buffer.duration) {
      const tempo = clampTempo(contourValue(tempoContour, baseTempo, outputElapsedS, segmentMs));
      const pitchSt = clampPitch(contourValue(pitchContour, basePitch, outputElapsedS, segmentMs));
      const pitchRatio = Math.pow(2, pitchSt / 12);
      const availableSourceS = Math.min(GRAIN_SOURCE_S, Math.max(0.001, buffer.duration - sourceOffsetS));
      const outputGrainS = Math.max(0.004, availableSourceS / pitchRatio);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = pitchRatio;
      gain.gain.setValueAtTime(0, startAt + outputElapsedS);
      gain.gain.setValueCurveAtTime(HANN_CURVE, startAt + outputElapsedS, outputGrainS);
      source.connect(gain);
      gain.connect(master);
      try { source.start(startAt + outputElapsedS, sourceOffsetS, availableSourceS); } catch (_) {}
      grains.add(source);
      source.onended = () => {
        grains.delete(source);
        try { source.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
      };
      maxTailS = Math.max(maxTailS, outputElapsedS + outputGrainS);
      sourceOffsetS += ANALYSIS_HOP_S;
      outputElapsedS += ANALYSIS_HOP_S / tempo;
    }

    const finishTimer = setTimeout(() => {
      if (stopped) return;
      stopped = true;
      try { master.disconnect(); } catch (_) {}
      onFinished?.();
    }, Math.max(1, Math.ceil((maxTailS + 0.04) * 1000)));

    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(finishTimer);
      for (const source of grains) {
        try { source.stop(); } catch (_) {}
        try { source.disconnect(); } catch (_) {}
      }
      grains.clear();
      try { master.disconnect(); } catch (_) {}
      onFinished?.();
    }
    return { stop, durationS: maxTailS, independentPitch: true };
  }

  function playNativeFallback(audio, opts = {}, nativePlay = null) {
    const tempo = clampTempo(opts.tempo ?? opts.rate ?? 1);
    const pitchSt = clampPitch(opts.pitchSemitones ?? 0);
    const ratio = Math.pow(2, pitchSt / 12);
    const tempoContour = Array.isArray(opts.tempoContour) ? opts.tempoContour.map(clampTempo) : null;
    const pitchContour = Array.isArray(opts.pitchContourSemitones) ? opts.pitchContourSemitones.map(clampPitch) : null;
    const segmentMs = Math.max(40, finite(opts.contourSegmentMs, DEFAULT_CONTOUR_SEGMENT_MS));
    const timers = [];
    let stopped = false;
    let started = false;
    setPitchPreservation(audio, Math.abs(pitchSt) < 0.08);
    audio.playbackRate = Math.abs(pitchSt) < 0.08 ? tempo : clampTempo(tempo * ratio);

    function applyStage(index) {
      if (stopped) return;
      const stageTempo = tempoContour?.[index] ?? tempo;
      const stagePitch = pitchContour?.[index] ?? pitchSt;
      const stageRatio = Math.pow(2, clampPitch(stagePitch) / 12);
      setPitchPreservation(audio, Math.abs(stagePitch) < 0.08);
      audio.playbackRate = Math.abs(stagePitch) < 0.08 ? clampTempo(stageTempo) : clampTempo(stageTempo * stageRatio);
    }
    function notifyStarted() {
      if (started || stopped) return;
      started = true;
      lastPlaybackError = null;
      lastBackend = 'native coupled fallback';
      lastStartedAt = Date.now();
      opts.onStarted?.();
      const stages = Math.max(tempoContour?.length || 0, pitchContour?.length || 0);
      for (let index = 1; index < stages; index++) timers.push(setTimeout(() => applyStage(index), segmentMs * index));
    }
    function cleanup() {
      if (stopped) return;
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      opts.onFinished?.();
    }
    function stop() {
      if (stopped) return;
      try { audio.pause(); } catch (_) {}
      try { audio.currentTime = 0; } catch (_) {}
      cleanup();
    }
    audio.addEventListener?.('playing', notifyStarted, { once: true });
    audio.addEventListener?.('ended', cleanup, { once: true });
    let playResult = null;
    try { playResult = nativePlay ? nativePlay.call(audio) : audio.play(); }
    catch (error) {
      lastPlaybackError = error;
      opts.onError?.(error);
      cleanup();
      return { audio, stop, independentPitch: false };
    }
    playResult?.then?.(notifyStarted).catch?.(error => {
      lastPlaybackError = error;
      opts.onError?.(error);
      cleanup();
    });
    return { audio, stop, independentPitch: false };
  }

  function playDecodedUrl(url, opts = {}, fallbackAudio = null, nativePlay = null, trackPreview = false) {
    const context = ensureContext();
    const resolved = absoluteUrl(url);
    lastUrl = resolved || String(url || '');
    let stopped = false;
    let active = null;
    let cleaned = false;
    const handle = {
      audio: fallbackAudio,
      independentPitch: false,
      stop() {
        if (stopped) return;
        stopped = true;
        active?.stop?.();
        cleanup();
      },
      setPitchSemitones() {},
      setTempo() {},
    };
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (trackPreview) previewHandles.delete(handle);
    }
    if (trackPreview) previewHandles.add(handle);

    if (!context || context.state !== 'running') {
      if (!fallbackAudio && typeof Audio === 'function' && resolved) fallbackAudio = new Audio(resolved);
      if (!fallbackAudio) {
        lastPlaybackError = new Error('No usable audio backend');
        opts.onError?.(lastPlaybackError);
        cleanup();
        return handle;
      }
      fallbackAudio.volume = clamp(finite(opts.volume ?? fallbackAudio.volume, 0.7), 0, 1);
      active = playNativeFallback(fallbackAudio, { ...opts, onFinished: cleanup }, nativePlay);
      handle.audio = fallbackAudio;
      return handle;
    }

    lastBackend = 'granular decode pending';
    decodeUrl(resolved, context).then(buffer => {
      if (stopped) return;
      lastBackend = 'WebAudio granular independent pitch';
      lastPlaybackError = null;
      lastStartedAt = Date.now();
      opts.onStarted?.();
      active = scheduleGranularBuffer(context, buffer, opts, cleanup);
      handle.independentPitch = true;
    }).catch(error => {
      if (stopped) return;
      lastPlaybackError = error;
      if (!fallbackAudio && typeof Audio === 'function' && resolved) fallbackAudio = new Audio(resolved);
      if (!fallbackAudio) {
        opts.onError?.(error);
        cleanup();
        return;
      }
      fallbackAudio.volume = clamp(finite(opts.volume ?? fallbackAudio.volume, 0.7), 0, 1);
      active = playNativeFallback(fallbackAudio, { ...opts, onFinished: cleanup }, nativePlay);
      handle.audio = fallbackAudio;
    });
    return handle;
  }

  function capturePreparedAnimalElement(originalRenderer, creature, opts) {
    const mediaProto = window.HTMLMediaElement?.prototype;
    if (!mediaProto?.play) return { accepted: false, audio: null, nativePlay: null };
    const nativePlay = mediaProto.play;
    const blockedResult = { then() { return { catch() {} }; } };
    let captured = null;
    mediaProto.play = function captureAnimalVoicePlay() {
      if (!captured) captured = this;
      if (this === captured) return blockedResult;
      return nativePlay.call(this);
    };
    let accepted = false;
    try {
      accepted = !!originalRenderer(creature, { ...opts, rate: 1, rateContour: undefined, onStarted: undefined });
    } finally {
      mediaProto.play = nativePlay;
    }
    return { accepted, audio: captured, nativePlay };
  }

  function installAudioSystemAdapter() {
    const audioSystem = window.AudioSystem;
    if (!audioSystem?.playAnimalVoiceUtterance || audioSystem.__independentAnimalVoiceWrapped) return false;
    const originalRenderer = audioSystem.playAnimalVoiceUtterance.bind(audioSystem);
    audioSystem.playAnimalVoiceUtterance = function independentAnimalVoiceUtterance(creature, opts = {}) {
      const capture = capturePreparedAnimalElement(originalRenderer, creature, opts);
      if (!capture.accepted) return false;
      if (!capture.audio) return originalRenderer(creature, opts);
      const url = capture.audio.currentSrc || capture.audio.src;
      const volume = clamp(finite(capture.audio.volume, opts.volume ?? 0.7), 0, 1);
      playDecodedUrl(url, { ...opts, volume }, capture.audio, capture.nativePlay, false);
      return true;
    };
    audioSystem.__independentAnimalVoiceWrapped = true;
    installed = true;
    return true;
  }

  function preview(url, opts = {}) {
    if (!url) return null;
    primeAudioContext();
    const audio = typeof Audio === 'function' ? new Audio(url) : null;
    if (audio) {
      audio.preload = 'auto';
      audio.volume = clamp(finite(opts.volume, 0.7), 0, 1);
    }
    return playDecodedUrl(url, opts, audio, null, true);
  }
  function stopAllPreviews() {
    for (const handle of [...previewHandles]) handle.stop();
    previewHandles.clear();
  }
  function debugSnapshot() {
    return {
      installed,
      contextState: sharedContext?.state || 'unavailable',
      backend: lastBackend,
      previewCount: previewHandles.size,
      decodedClipCount: decodedByUrl.size,
      lastUrl,
      lastStartedAt,
      lastPlaybackError: lastPlaybackError ? String(lastPlaybackError?.message || lastPlaybackError) : null,
    };
  }

  function installEditorDiagnostics() {
    if (typeof document === 'undefined' || !/\/tools\/ambient-dialogue-editor\//.test(location.pathname)) return;
    const mount = () => {
      if (!document.body || document.getElementById('animalVoiceDiagDock')) return;
      const dock = document.createElement('div');
      dock.id = 'animalVoiceDiagDock';
      dock.style.cssText = 'position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483647;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 8px;background:rgba(3,9,16,.94);border:1px solid rgba(255,255,255,.22);border-radius:9px;box-shadow:0 4px 18px rgba(0,0,0,.45);font:11px system-ui,sans-serif;color:#dbeafe;max-width:720px;margin:auto';
      dock.innerHTML = '<b>Animal audio</b><span id="animalVoiceDiagText" style="flex:1;min-width:180px;overflow-wrap:anywhere">initializing…</span><button id="animalVoiceDiagCopy" type="button" style="padding:5px 7px">Copy audio probe</button>';
      document.body.appendChild(dock);
      const text = dock.querySelector('#animalVoiceDiagText');
      const copy = dock.querySelector('#animalVoiceDiagCopy');
      const update = () => {
        const snap = debugSnapshot();
        const error = snap.lastPlaybackError ? ` · error: ${snap.lastPlaybackError}` : '';
        text.textContent = `${snap.contextState} · ${snap.backend} · previews ${snap.previewCount} · decoded ${snap.decodedClipCount}${error}`;
      };
      copy.onclick = async () => {
        const payload = JSON.stringify(debugSnapshot(), null, 2);
        try {
          await navigator.clipboard.writeText(payload);
          copy.textContent = 'Copied';
        } catch (_) {
          const area = document.createElement('textarea');
          area.value = payload;
          area.style.cssText = 'position:fixed;left:8px;right:8px;bottom:70px;height:180px;z-index:2147483647';
          document.body.appendChild(area);
          area.select();
          copy.textContent = 'Probe shown';
        }
        setTimeout(() => { copy.textContent = 'Copy audio probe'; }, 1200);
      };
      update();
      setInterval(update, 250);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }

  window.AnimalVoiceIndependentPlayback = {
    installAudioSystemAdapter,
    preview,
    stopAllPreviews,
    primeAudioContext,
    clampPitch,
    clampTempo,
    debugSnapshot,
    isInstalled: () => installed,
  };

  installGestureUnlock();
  installEditorDiagnostics();
  installAudioSystemAdapter();
})();
