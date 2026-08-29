(() => {
  'use strict';

  // Constant-axis animal voice renderer. The only authored audio transforms are
  // one fixed tempo/pitch per recording, one fixed tempo/pitch per utterance,
  // and the global size-class pitch offset. No random ranges, normalization,
  // contours, splice-tempo or behavior-specific modulation remain.
  const MIN_TEMPO = 0.35;
  const MAX_TEMPO = 2;
  const MAX_SHIFT_SEMITONES = 12;
  const WSOLA_FRAME_S = 0.056;
  const WSOLA_OVERLAP_RATIO = 0.62;
  const WSOLA_SEARCH_S = 0.018;
  const WSOLA_CORRELATION_STEP = 2;
  const OUTPUT_EDGE_FADE_S = 0.006;
  const OUTPUT_TAIL_PAD_S = 0.018;
  const MAX_RENDER_CACHE = 32;
  const ANIMAL_EXTRA_WET = 0.026;
  const UTTERANCE_BASE = 'assets/audio/sfx/utterances/';

  // Preserve the old species defaults even though the same recordings now
  // live in the descriptive utterance library under content-based names.
  const LEGACY_ALIASES = Object.freeze({
    'sfx_dabinggi-hound1.ogg': 'sfx_rattling_monkey-chirp.ogg',
    'sfx_dabinggi-hound2.ogg': 'sfx_whine-cacaw.ogg',
    'sfx_drenkirra1.ogg': 'sfx_rattle-caw.ogg',
    'sfx_drenkirra2.ogg': 'sfx_rattle-caw-rattle.ogg',
    'sfx_gar-wolf1.ogg': 'sfx_rattle-bark-rattle.ogg',
    'sfx_gar-wolf2.ogg': 'sfx_clicky_howl-bark.ogg',
    'sfx_grehlr1.ogg': 'sfx_rattle-ghostgrowl-rattle.ogg',
    'sfx_grehlr2.ogg': 'sfx_bark-cricket.ogg',
    'sfx_nelk1.ogg': 'sfx_spookyghost-ribbit.ogg',
    "sfx_uumkao'ii1.ogg": 'sfx_grunt-rattle.ogg',
    "sfx_uumkao'ii2.ogg": 'sfx_chirp-rattle.ogg',
  });
  const LEGACY_SPECIES_DEFAULTS = Object.freeze({
    'dabinggi-hound': Object.freeze(['sfx_rattling_monkey-chirp.ogg', 'sfx_whine-cacaw.ogg']),
    drenkirra: Object.freeze(['sfx_rattle-caw.ogg', 'sfx_rattle-caw-rattle.ogg']),
    'gar-wolf': Object.freeze(['sfx_rattle-bark-rattle.ogg', 'sfx_clicky_howl-bark.ogg']),
    grehlr: Object.freeze(['sfx_rattle-ghostgrowl-rattle.ogg', 'sfx_bark-cricket.ogg']),
    nelk: Object.freeze(['sfx_spookyghost-ribbit.ogg']),
    uumkaoii: Object.freeze(['sfx_grunt-rattle.ogg', 'sfx_chirp-rattle.ogg']),
  });

  const MODULE_SRC = typeof document !== 'undefined' && document.currentScript?.src
    ? document.currentScript.src
    : null;
  const SIMPLE_EDITOR_SRC = MODULE_SRC
    ? new URL('animal-voice-simple-editor.js?v=20260828library1', MODULE_SRC).href
    : null;

  const decodedByUrl = new Map();
  const renderedByKey = new Map();
  const previewHandles = new Set();
  let sharedContext = null;
  let adapterInstalled = false;
  let lastPlaybackError = null;
  let lastBackend = 'idle';
  let lastUrl = null;
  let lastTempo = 1;
  let lastPitchSemitones = 0;
  let lastClipTempo = 1;
  let lastClipPitchSemitones = 0;
  let lastUtteranceTempo = 1;
  let lastUtterancePitchSemitones = 0;
  let lastSizePitchSemitones = 0;
  let lastRenderMs = null;
  let lastStartedAt = null;
  let lastAllowedClips = null;
  let lastChosenClip = null;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clampTempo(value) { return clamp(finite(value, 1), MIN_TEMPO, MAX_TEMPO); }
  function clampPitch(value) { return clamp(finite(value, 0), -MAX_SHIFT_SEMITONES, MAX_SHIFT_SEMITONES); }
  function absoluteUrl(url) {
    try { return new URL(url, document.baseURI).href; }
    catch (_) { return String(url || ''); }
  }
  function clipKey(url) {
    const resolved = absoluteUrl(url);
    try { return decodeURIComponent(new URL(resolved).pathname.split('/').pop() || '').toLowerCase(); }
    catch (_) { return String(url || '').split('/').pop().toLowerCase(); }
  }
  function normalizeLibraryName(value) {
    const key = clipKey(value);
    return LEGACY_ALIASES[key] || key;
  }
  function utteranceUrl(value) {
    const name = normalizeLibraryName(value);
    return absoluteUrl(`${UTTERANCE_BASE}${encodeURIComponent(name).replace(/%27/g, "'")}`);
  }
  function speciesKey(c) {
    const raw = String(c?.creatureKey || c?.speciesKey || c?.species || c?.def?.key || '').toLowerCase();
    if (raw.includes('dabinggi')) return 'dabinggi-hound';
    if (raw.includes('gar-wolf')) return 'gar-wolf';
    if (raw.includes('grehlr')) return 'grehlr';
    if (raw.includes('drenkirra')) return 'drenkirra';
    if (raw.includes('uumkao')) return 'uumkaoii';
    if (raw.includes('nelk')) return 'nelk';
    return raw;
  }
  function smoothBlendWeight(index, count) {
    if (count <= 1) return 1;
    const t = clamp(index / (count - 1), 0, 1);
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }
  function cubicSample(channel, position) {
    if (!channel?.length) return 0;
    const floor = Math.floor(position);
    const i1 = clamp(floor, 0, channel.length - 1);
    const i0 = Math.max(0, i1 - 1);
    const i2 = Math.min(channel.length - 1, i1 + 1);
    const i3 = Math.min(channel.length - 1, i1 + 2);
    const t = position - floor;
    const p0 = channel[i0], p1 = channel[i1], p2 = channel[i2], p3 = channel[i3];
    const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const a1 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
    const a2 = -0.5 * p0 + 0.5 * p2;
    return clamp(((a0 * t + a1) * t + a2) * t + p1, -1, 1);
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
    if (!context) return false;
    if (context.state === 'suspended') {
      try { context.resume()?.catch?.(error => { lastPlaybackError = error; }); }
      catch (error) { lastPlaybackError = error; }
    }
    return context.state === 'running';
  }
  function installGestureUnlock() {
    if (typeof window.addEventListener !== 'function') return;
    const unlock = () => primeAudioContext();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true });
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

  function resampleChannels(channels, ratio) {
    const safeRatio = clamp(finite(ratio, 1), 0.25, 4);
    if (Math.abs(safeRatio - 1) < 0.0005) return channels.map(channel => channel.slice());
    const sourceLength = channels[0]?.length || 0;
    const targetLength = Math.max(1, Math.round(sourceLength / safeRatio));
    return channels.map(channel => {
      const output = new Float32Array(targetLength);
      for (let index = 0; index < targetLength; index++) output[index] = cubicSample(channel, index * safeRatio);
      return output;
    });
  }

  function correlation(reference, candidate, referenceStart, candidateStart, length) {
    let dot = 0, refEnergy = 1e-9, candidateEnergy = 1e-9;
    for (let index = 0; index < length; index += WSOLA_CORRELATION_STEP) {
      const a = reference[referenceStart + index] || 0;
      const b = candidate[candidateStart + index] || 0;
      dot += a * b;
      refEnergy += a * a;
      candidateEnergy += b * b;
    }
    return dot / Math.sqrt(refEnergy * candidateEnergy);
  }

  function wsolaStretch(channels, stretch, sampleRate) {
    const sourceLength = channels[0]?.length || 0;
    if (!sourceLength) return channels.map(() => new Float32Array(1));
    const safeStretch = clamp(finite(stretch, 1), 0.25, 4);
    const targetLength = Math.max(1, Math.round(sourceLength * safeStretch));
    if (Math.abs(safeStretch - 1) < 0.012 || sourceLength < sampleRate * 0.06) {
      return channels.map(channel => {
        const output = new Float32Array(targetLength);
        if (targetLength === sourceLength) { output.set(channel); return output; }
        for (let index = 0; index < targetLength; index++) output[index] = cubicSample(channel, index / safeStretch);
        return output;
      });
    }
    const frame = Math.max(256, Math.min(sourceLength, Math.round(sampleRate * WSOLA_FRAME_S)));
    const overlap = Math.max(64, Math.min(frame - 1, Math.round(frame * WSOLA_OVERLAP_RATIO)));
    const synthesisHop = Math.max(32, frame - overlap);
    const analysisHop = synthesisHop / safeStretch;
    const searchRadius = Math.max(16, Math.round(sampleRate * WSOLA_SEARCH_S));
    const outputs = channels.map(() => new Float32Array(targetLength + frame + synthesisHop));
    const referenceChannel = channels[0];
    const referenceOutput = outputs[0];
    const firstCount = Math.min(frame, sourceLength, targetLength);
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) outputs[channelIndex].set(channels[channelIndex].subarray(0, firstCount), 0);
    let outputPos = synthesisHop;
    let expectedInputPos = analysisHop;
    while (outputPos < targetLength && expectedInputPos < sourceLength - 1) {
      const center = clamp(Math.round(expectedInputPos), 0, Math.max(0, sourceLength - frame));
      const searchStart = Math.max(0, center - searchRadius);
      const searchEnd = Math.min(Math.max(0, sourceLength - frame), center + searchRadius);
      const overlapLength = Math.min(overlap, targetLength - outputPos, sourceLength);
      let bestInputPos = center;
      let bestScore = -Infinity;
      for (let candidatePos = searchStart; candidatePos <= searchEnd; candidatePos += WSOLA_CORRELATION_STEP) {
        const score = correlation(referenceOutput, referenceChannel, outputPos, candidatePos, overlapLength);
        if (score > bestScore) { bestScore = score; bestInputPos = candidatePos; }
      }
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        const input = channels[channelIndex];
        const output = outputs[channelIndex];
        const usable = Math.min(frame, input.length - bestInputPos, output.length - outputPos);
        const crossfade = Math.min(overlap, usable);
        for (let index = 0; index < crossfade; index++) {
          const weight = smoothBlendWeight(index, crossfade);
          output[outputPos + index] = output[outputPos + index] * (1 - weight) + input[bestInputPos + index] * weight;
        }
        for (let index = crossfade; index < usable; index++) output[outputPos + index] = input[bestInputPos + index];
      }
      outputPos += synthesisHop;
      expectedInputPos = bestInputPos + analysisHop;
    }
    return outputs.map(output => output.slice(0, targetLength));
  }

  function applyOutputEdgeEnvelope(channels, sampleRate) {
    const length = channels[0]?.length || 0;
    if (!length) return channels;
    const fadeSamples = Math.min(Math.max(1, Math.round(sampleRate * OUTPUT_EDGE_FADE_S)), Math.max(1, Math.floor(length / 4)));
    const padSamples = Math.max(1, Math.round(sampleRate * OUTPUT_TAIL_PAD_S));
    return channels.map(channel => {
      const output = new Float32Array(length + padSamples);
      output.set(channel);
      for (let index = 0; index < fadeSamples; index++) {
        const inGain = smoothBlendWeight(index, fadeSamples);
        output[index] *= inGain;
        output[length - fadeSamples + index] *= 1 - inGain;
      }
      return output;
    });
  }

  function processConstantAxes(buffer, tempo, pitchSemitones) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
    const pitchRatio = Math.pow(2, clampPitch(pitchSemitones) / 12);
    const pitched = resampleChannels(channels, pitchRatio);
    const stretched = wsolaStretch(pitched, pitchRatio / clampTempo(tempo), buffer.sampleRate);
    return applyOutputEdgeEnvelope(stretched, buffer.sampleRate);
  }

  function renderCacheKey(url, tempo, pitchSemitones) {
    return `${absoluteUrl(url)}|${clampTempo(tempo).toFixed(4)}|${clampPitch(pitchSemitones).toFixed(3)}`;
  }
  function pruneRenderCache() {
    while (renderedByKey.size > MAX_RENDER_CACHE) renderedByKey.delete(renderedByKey.keys().next().value);
  }
  function renderBufferFor(url, decoded, context, tempo, pitchSemitones) {
    const key = renderCacheKey(url, tempo, pitchSemitones);
    if (renderedByKey.has(key)) return renderedByKey.get(key);
    const pending = Promise.resolve().then(() => {
      const clock = typeof performance !== 'undefined' && performance?.now ? performance : Date;
      const started = clock.now();
      const channels = processConstantAxes(decoded, tempo, pitchSemitones);
      const length = Math.max(1, channels[0]?.length || 1);
      const rendered = context.createBuffer(channels.length, length, decoded.sampleRate);
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) rendered.copyToChannel(channels[channelIndex], channelIndex);
      lastRenderMs = Math.round(clock.now() - started);
      return rendered;
    }).catch(error => {
      renderedByKey.delete(key);
      throw error;
    });
    renderedByKey.set(key, pending);
    pruneRenderCache();
    return pending;
  }

  function scheduleProcessedBuffer(context, buffer, opts, onFinished) {
    const source = context.createBufferSource();
    const master = context.createGain();
    const startAt = context.currentTime + 0.012;
    let stopped = false;
    let finishTimer = null;
    let startTimer = null;
    let wet = null;
    source.buffer = buffer;
    master.gain.value = clamp(finite(opts.volume, 0.7), 0, 1);
    source.connect(master);
    master.connect(context.destination);
    wet = window.EnvironmentalReverb?.connectWetNode?.(context, master, {
      volume: 1,
      extraWet: ANIMAL_EXTRA_WET,
      area: opts.area || null,
    }) || null;
    function cleanup() {
      if (stopped) return;
      stopped = true;
      clearTimeout(finishTimer);
      clearTimeout(startTimer);
      try { source.disconnect(); } catch (_) {}
      try { master.disconnect(); } catch (_) {}
      try { wet?.send?.disconnect?.(); } catch (_) {}
      onFinished?.();
    }
    function stop() {
      if (stopped) return;
      try { source.stop(); } catch (_) {}
      cleanup();
    }
    source.onended = cleanup;
    try { source.start(startAt); }
    catch (error) {
      lastPlaybackError = error;
      opts.onError?.(error);
      cleanup();
      return { stop, durationS: 0, independentPitch: true };
    }
    startTimer = setTimeout(() => {
      if (stopped) return;
      lastPlaybackError = null;
      lastBackend = 'fixed tempo+pitch';
      lastStartedAt = Date.now();
      opts.onStarted?.();
    }, Math.max(0, Math.round((startAt - context.currentTime) * 1000)));
    finishTimer = setTimeout(cleanup, Math.max(1, Math.ceil((buffer.duration + 0.04) * 1000)));
    return { stop, durationS: buffer.duration, independentPitch: true };
  }

  function setPitchPreservation(audio, enabled) {
    try { audio.preservesPitch = enabled; } catch (_) {}
    try { audio.mozPreservesPitch = enabled; } catch (_) {}
    try { audio.webkitPreservesPitch = enabled; } catch (_) {}
  }

  function playNativeFallback(url, opts, fallbackAudio) {
    const audio = fallbackAudio || (typeof Audio === 'function' ? new Audio(url) : null);
    if (!audio) return null;
    if (audio.src !== url && audio.currentSrc !== url) audio.src = url;
    const tempo = clampTempo(opts.tempo);
    const pitch = clampPitch(opts.pitchSemitones);
    const pitchRatio = Math.pow(2, pitch / 12);
    audio.volume = clamp(finite(opts.volume, 0.7), 0, 1);
    if (Math.abs(pitch) < 0.05) {
      setPitchPreservation(audio, true);
      audio.playbackRate = tempo;
    } else {
      // Emergency fallback only. The normal Web Audio path keeps speed/pitch
      // independent; browsers without it necessarily couple them here.
      setPitchPreservation(audio, false);
      audio.playbackRate = clamp(tempo * pitchRatio, 0.25, 4);
    }
    let finished = false;
    let started = false;
    const notifyStarted = () => {
      if (started) return;
      started = true;
      lastBackend = 'native fallback';
      lastStartedAt = Date.now();
      opts.onStarted?.();
    };
    const cleanup = () => {
      if (finished) return;
      finished = true;
      opts.onFinished?.();
    };
    audio.addEventListener?.('playing', notifyStarted, { once: true });
    audio.addEventListener?.('ended', cleanup, { once: true });
    const result = audio.play();
    result?.then?.(notifyStarted).catch?.(error => {
      lastPlaybackError = error;
      opts.onError?.(error);
      cleanup();
    });
    return {
      audio,
      independentPitch: Math.abs(pitch) < 0.05,
      stop() {
        try { audio.pause(); audio.currentTime = 0; } catch (_) {}
        cleanup();
      },
    };
  }

  function play(url, opts = {}) {
    if (!url) return null;
    const resolved = absoluteUrl(url);
    const tempo = clampTempo(opts.tempo ?? 1);
    const pitchSemitones = clampPitch(opts.pitchSemitones ?? 0);
    const context = ensureContext();
    lastUrl = resolved;
    lastTempo = tempo;
    lastPitchSemitones = pitchSemitones;
    if (!context || context.state !== 'running') {
      primeAudioContext();
      return playNativeFallback(resolved, { ...opts, tempo, pitchSemitones }, opts.fallbackAudio || null);
    }
    let stopped = false;
    let active = null;
    const handle = {
      independentPitch: true,
      stop() {
        if (stopped) return;
        stopped = true;
        active?.stop?.();
      },
    };
    lastBackend = 'fixed render pending';
    decodeUrl(resolved, context)
      .then(decoded => renderBufferFor(resolved, decoded, context, tempo, pitchSemitones))
      .then(rendered => {
        if (stopped) return;
        active = scheduleProcessedBuffer(context, rendered, { ...opts, tempo, pitchSemitones }, opts.onFinished);
      })
      .catch(error => {
        if (stopped) return;
        lastPlaybackError = error;
        active = playNativeFallback(resolved, { ...opts, tempo, pitchSemitones }, opts.fallbackAudio || null);
      });
    return handle;
  }

  function normalizedAllowed(c, opts) {
    if (Array.isArray(opts?.allowedClips)) return opts.allowedClips.map(normalizeLibraryName).filter(Boolean);
    return [...(LEGACY_SPECIES_DEFAULTS[speciesKey(c)] || [])];
  }

  function capturePreparedAnimalElement(originalRenderer, c, opts) {
    const mediaProto = window.HTMLMediaElement?.prototype;
    if (!mediaProto?.play) return { accepted: false, audio: null };
    const allowed = normalizedAllowed(c, opts);
    lastAllowedClips = [...allowed];
    if (!allowed.length) return { accepted: false, audio: null, silent: true };
    const chosen = allowed[Math.floor(Math.random() * allowed.length)];
    const nativePlay = mediaProto.play;
    const blockedResult = Promise.resolve();
    let captured = null;
    mediaProto.play = function captureAnimalVoicePlay() {
      if (!captured) captured = this;
      return blockedResult;
    };
    let accepted = false;
    try {
      accepted = !!originalRenderer(c, {
        ...opts,
        rate: 1,
        rateContour: undefined,
        onStarted: undefined,
      });
    } finally {
      mediaProto.play = nativePlay;
    }
    const selectedUrl = chosen ? utteranceUrl(chosen) : null;
    if (captured && selectedUrl) {
      try { captured.pause?.(); } catch (_) {}
      captured.src = selectedUrl;
      try { captured.currentTime = 0; } catch (_) {}
    }
    lastChosenClip = chosen || null;
    return { accepted, audio: captured, chosen: chosen || null, selectedUrl };
  }

  function clipTuningFor(url, opts) {
    const map = opts?.clipTuning;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return { tempo: 1, pitchSemitones: 0 };
    const key = normalizeLibraryName(url);
    let value = map[key] ?? map[url] ?? map[absoluteUrl(url)];
    if (!value) {
      const legacyKey = Object.keys(LEGACY_ALIASES).find(oldKey => LEGACY_ALIASES[oldKey] === key);
      if (legacyKey) value = map[legacyKey];
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { tempo: 1, pitchSemitones: 0 };
    return {
      tempo: clampTempo(value.tempo ?? value.speed ?? 1),
      pitchSemitones: clampPitch(value.pitchSemitones ?? value.pitch ?? 0),
    };
  }

  function installAudioSystemAdapter() {
    const audioSystem = window.AudioSystem;
    if (!audioSystem?.playAnimalVoiceUtterance) return false;
    if (audioSystem.__simpleAnimalVoiceWrapped) { adapterInstalled = true; return true; }
    const originalRenderer = audioSystem.playAnimalVoiceUtterance.bind(audioSystem);
    audioSystem.playAnimalVoiceUtterance = function simpleAnimalVoiceUtterance(c, opts = {}) {
      const capture = capturePreparedAnimalElement(originalRenderer, c, opts);
      if (capture.silent) return false;
      if (!capture.accepted) return false;
      if (!capture.audio || !capture.selectedUrl) return originalRenderer(c, { ...opts, rate: 1, rateContour: undefined });
      // Use the explicit library URL carried out of capture. currentSrc can
      // still report the pre-swap legacy asset for a short browser task.
      const url = capture.selectedUrl;
      const clipTuning = clipTuningFor(url, opts);
      const utteranceTempo = clampTempo(opts.tempo ?? 1);
      const utterancePitch = clampPitch(opts.pitchSemitones ?? 0);
      const sizePitch = clampPitch(opts.sizePitchSemitones ?? 0);
      const tempo = clampTempo(clipTuning.tempo * utteranceTempo);
      const pitchSemitones = clampPitch(clipTuning.pitchSemitones + utterancePitch + sizePitch);
      lastClipTempo = clipTuning.tempo;
      lastClipPitchSemitones = clipTuning.pitchSemitones;
      lastUtteranceTempo = utteranceTempo;
      lastUtterancePitchSemitones = utterancePitch;
      lastSizePitchSemitones = sizePitch;
      play(url, {
        tempo,
        pitchSemitones,
        volume: clamp(finite(capture.audio.volume, opts.volume ?? 0.7), 0, 1),
        area: c?.areaId || null,
        onStarted: opts.onStarted,
        onError: opts.onError,
        fallbackAudio: capture.audio,
      });
      return true;
    };
    audioSystem.__simpleAnimalVoiceWrapped = true;
    adapterInstalled = true;
    return true;
  }

  function preview(url, opts = {}) {
    primeAudioContext();
    const fallbackAudio = typeof Audio === 'function' ? new Audio(url) : null;
    let handle = null;
    handle = play(url, { ...opts, fallbackAudio, onFinished: () => previewHandles.delete(handle) });
    if (handle) previewHandles.add(handle);
    return handle;
  }
  function stopAllPreviews() {
    for (const handle of [...previewHandles]) handle.stop?.();
    previewHandles.clear();
  }

  function debugSnapshot() {
    return {
      installed: adapterInstalled,
      contextState: sharedContext?.state || 'unavailable',
      backend: lastBackend,
      previewCount: previewHandles.size,
      decodedClipCount: decodedByUrl.size,
      renderedVariantCount: renderedByKey.size,
      lastTempo,
      lastPitchSemitones,
      lastClipTempo,
      lastClipPitchSemitones,
      lastUtteranceTempo,
      lastUtterancePitchSemitones,
      lastSizePitchSemitones,
      lastAllowedClips,
      lastChosenClip,
      lastRenderMs,
      lastUrl,
      lastStartedAt,
      lastPlaybackError: lastPlaybackError ? String(lastPlaybackError?.message || lastPlaybackError) : null,
    };
  }

  function requestSimpleEditor() {
    if (!SIMPLE_EDITOR_SRC || typeof document === 'undefined' || !/\/tools\/ambient-dialogue-editor\//.test(location.pathname)) return;
    if (document.querySelector('script[data-animal-voice-simple-editor]')) return;
    const script = document.createElement('script');
    script.src = SIMPLE_EDITOR_SRC;
    script.async = true;
    script.dataset.animalVoiceSimpleEditor = '1';
    document.head?.appendChild(script);
  }

  window.AnimalVoiceIndependentPlayback = {
    play,
    preview,
    stopAllPreviews,
    primeAudioContext,
    clampPitch,
    clampTempo,
    clipKey,
    normalizeLibraryName,
    utteranceUrl,
    installAudioSystemAdapter,
    debugSnapshot,
    isInstalled: () => adapterInstalled,
  };

  installGestureUnlock();
  requestSimpleEditor();
  installAudioSystemAdapter();
  if (typeof window.setInterval === 'function') window.setInterval(installAudioSystemAdapter, 250);
})();