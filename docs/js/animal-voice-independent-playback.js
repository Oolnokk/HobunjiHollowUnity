(() => {
  'use strict';

  // Independent animal-voice playback. AudioSystem remains authoritative for
  // choosing species clips, range checks, and final element volume. This layer
  // captures that prepared clip, decodes the OGG once, then renders one
  // high-quality WSOLA/resampling buffer so pitch and tempo remain independent.
  const MAX_SHIFT_SEMITONES = 12;
  const MIN_TEMPO = 0.35;
  const MAX_TEMPO = 2;
  const DEFAULT_CONTOUR_SEGMENT_MS = 260;
  const WSOLA_FRAME_S = 0.048;
  const WSOLA_OVERLAP_RATIO = 0.5;
  const WSOLA_SEARCH_S = 0.014;
  const WSOLA_CORRELATION_STEP = 4;
  const SEGMENT_CROSSFADE_S = 0.012;
  const MAX_RENDER_CACHE = 32;

  const decodedByUrl = new Map();
  const renderedByKey = new Map();
  const previewHandles = new Set();
  let sharedContext = null;
  let installed = false;
  let lastPlaybackError = null;
  let lastBackend = 'idle';
  let lastUrl = null;
  let lastStartedAt = null;
  let lastRenderMs = null;

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

  function stageValue(values, fallback, index) {
    if (!Array.isArray(values) || !values.length) return fallback;
    return values[Math.min(values.length - 1, Math.max(0, index))] ?? fallback;
  }

  function resampleChannels(channels, ratio) {
    const safeRatio = Math.max(0.25, Math.min(4, finite(ratio, 1)));
    if (Math.abs(safeRatio - 1) < 0.0005) return channels.map(channel => channel.slice());
    const sourceLength = channels[0]?.length || 0;
    const targetLength = Math.max(1, Math.round(sourceLength / safeRatio));
    return channels.map(channel => {
      const output = new Float32Array(targetLength);
      for (let index = 0; index < targetLength; index++) {
        const sourcePos = index * safeRatio;
        const left = Math.min(channel.length - 1, Math.max(0, Math.floor(sourcePos)));
        const right = Math.min(channel.length - 1, left + 1);
        const mix = sourcePos - left;
        output[index] = channel[left] + (channel[right] - channel[left]) * mix;
      }
      return output;
    });
  }

  function correlation(reference, candidate, referenceStart, candidateStart, length) {
    let dot = 0;
    let refEnergy = 1e-9;
    let candidateEnergy = 1e-9;
    const step = WSOLA_CORRELATION_STEP;
    for (let index = 0; index < length; index += step) {
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
        if (targetLength === sourceLength) {
          output.set(channel);
          return output;
        }
        for (let index = 0; index < targetLength; index++) {
          const sourcePos = index / safeStretch;
          const left = Math.min(channel.length - 1, Math.max(0, Math.floor(sourcePos)));
          const right = Math.min(channel.length - 1, left + 1);
          const mix = sourcePos - left;
          output[index] = channel[left] + (channel[right] - channel[left]) * mix;
        }
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
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      outputs[channelIndex].set(channels[channelIndex].subarray(0, firstCount), 0);
    }

    let outputPos = synthesisHop;
    let expectedInputPos = analysisHop;
    while (outputPos < targetLength && expectedInputPos < sourceLength - 1) {
      const center = Math.max(0, Math.min(sourceLength - frame, Math.round(expectedInputPos)));
      const searchStart = Math.max(0, center - searchRadius);
      const searchEnd = Math.min(Math.max(0, sourceLength - frame), center + searchRadius);
      const overlapLength = Math.min(overlap, targetLength - outputPos, sourceLength);
      let bestInputPos = center;
      let bestScore = -Infinity;

      for (let candidatePos = searchStart; candidatePos <= searchEnd; candidatePos += WSOLA_CORRELATION_STEP) {
        const score = correlation(referenceOutput, referenceChannel, outputPos, candidatePos, overlapLength);
        if (score > bestScore) {
          bestScore = score;
          bestInputPos = candidatePos;
        }
      }

      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        const input = channels[channelIndex];
        const output = outputs[channelIndex];
        const usable = Math.min(frame, input.length - bestInputPos, output.length - outputPos);
        const crossfade = Math.min(overlap, usable);
        for (let index = 0; index < crossfade; index++) {
          const weight = index / Math.max(1, crossfade - 1);
          output[outputPos + index] = output[outputPos + index] * (1 - weight)
            + input[bestInputPos + index] * weight;
        }
        for (let index = crossfade; index < usable; index++) {
          output[outputPos + index] = input[bestInputPos + index];
        }
      }

      outputPos += synthesisHop;
      expectedInputPos = bestInputPos + analysisHop;
    }

    return outputs.map(output => output.slice(0, targetLength));
  }

  function processConstantAxes(channels, sampleRate, tempo, pitchSt) {
    const safeTempo = clampTempo(tempo);
    const safePitch = clampPitch(pitchSt);
    const pitchRatio = Math.pow(2, safePitch / 12);
    const pitched = resampleChannels(channels, pitchRatio);
    const stretch = pitchRatio / safeTempo;
    return wsolaStretch(pitched, stretch, sampleRate);
  }

  function sliceChannels(channels, startSample, endSample) {
    return channels.map(channel => channel.slice(startSample, endSample));
  }

  function concatenateWithCrossfade(segments, sampleRate) {
    if (!segments.length) return [new Float32Array(1)];
    if (segments.length === 1) return segments[0];
    const channelCount = segments[0].length;
    const crossfadeSamples = Math.max(1, Math.round(sampleRate * SEGMENT_CROSSFADE_S));
    const totalLength = segments.reduce((sum, segment) => sum + (segment[0]?.length || 0), 0)
      - crossfadeSamples * Math.max(0, segments.length - 1);
    const outputs = Array.from({ length: channelCount }, () => new Float32Array(Math.max(1, totalLength)));
    let writePos = 0;

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex];
      const segmentLength = segment[0]?.length || 0;
      if (!segmentLength) continue;
      if (segmentIndex === 0) {
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) outputs[channelIndex].set(segment[channelIndex], 0);
        writePos = segmentLength;
        continue;
      }
      const overlap = Math.min(crossfadeSamples, writePos, segmentLength);
      const overlapStart = writePos - overlap;
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
        const output = outputs[channelIndex];
        const input = segment[channelIndex];
        for (let index = 0; index < overlap; index++) {
          const weight = index / Math.max(1, overlap - 1);
          output[overlapStart + index] = output[overlapStart + index] * (1 - weight) + input[index] * weight;
        }
        output.set(input.subarray(overlap), writePos);
      }
      writePos += segmentLength - overlap;
    }
    return outputs.map(output => output.slice(0, writePos));
  }

  function renderProcessedChannels(buffer, opts) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
    const sampleRate = buffer.sampleRate;
    const baseTempo = clampTempo(opts.tempo ?? opts.rate ?? 1);
    const basePitch = clampPitch(opts.pitchSemitones ?? 0);
    const tempoContour = Array.isArray(opts.tempoContour) ? opts.tempoContour.map(clampTempo) : null;
    const pitchContour = Array.isArray(opts.pitchContourSemitones) ? opts.pitchContourSemitones.map(clampPitch) : null;
    const stageCount = Math.max(tempoContour?.length || 0, pitchContour?.length || 0, 1);
    if (stageCount === 1) return processConstantAxes(channels, sampleRate, baseTempo, basePitch);

    const segmentMs = Math.max(40, finite(opts.contourSegmentMs, DEFAULT_CONTOUR_SEGMENT_MS));
    const segments = [];
    let sourceStart = 0;
    for (let stage = 0; stage < stageCount && sourceStart < buffer.length; stage++) {
      const tempo = clampTempo(stageValue(tempoContour, baseTempo, stage));
      const pitch = clampPitch(stageValue(pitchContour, basePitch, stage));
      let sourceEnd = buffer.length;
      if (stage < stageCount - 1) {
        const sourceSamplesForStage = Math.max(1, Math.round(sampleRate * (segmentMs / 1000) * tempo));
        sourceEnd = Math.min(buffer.length, sourceStart + sourceSamplesForStage);
      }
      const sourceSegment = sliceChannels(channels, sourceStart, sourceEnd);
      segments.push(processConstantAxes(sourceSegment, sampleRate, tempo, pitch));
      sourceStart = sourceEnd;
    }
    return concatenateWithCrossfade(segments, sampleRate);
  }

  function renderCacheKey(url, opts) {
    const normalizeArray = value => Array.isArray(value)
      ? value.map(item => Number(finite(item, 0).toFixed(4))).join(',')
      : '';
    return [
      absoluteUrl(url),
      Number(clampTempo(opts.tempo ?? opts.rate ?? 1).toFixed(4)),
      Number(clampPitch(opts.pitchSemitones ?? 0).toFixed(3)),
      normalizeArray(opts.tempoContour),
      normalizeArray(opts.pitchContourSemitones),
      Math.round(finite(opts.contourSegmentMs, DEFAULT_CONTOUR_SEGMENT_MS)),
    ].join('|');
  }

  function pruneRenderCache() {
    while (renderedByKey.size > MAX_RENDER_CACHE) {
      const oldestKey = renderedByKey.keys().next().value;
      if (oldestKey == null) break;
      renderedByKey.delete(oldestKey);
    }
  }

  function renderBufferFor(url, decoded, context, opts) {
    const key = renderCacheKey(url, opts);
    if (renderedByKey.has(key)) return renderedByKey.get(key);
    const pending = Promise.resolve().then(() => {
      const clock = typeof performance !== 'undefined' && performance?.now ? performance : Date;
      const started = clock.now();
      const channels = renderProcessedChannels(decoded, opts);
      const length = Math.max(1, channels[0]?.length || 1);
      const rendered = context.createBuffer(channels.length, length, decoded.sampleRate);
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        rendered.copyToChannel(channels[channelIndex], channelIndex);
      }
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
    source.buffer = buffer;
    master.gain.value = clamp(finite(opts.volume, 0.7), 0, 1);
    source.connect(master);
    master.connect(context.destination);

    function cleanup() {
      if (stopped) return;
      stopped = true;
      clearTimeout(finishTimer);
      clearTimeout(startTimer);
      try { source.disconnect(); } catch (_) {}
      try { master.disconnect(); } catch (_) {}
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

    const startDelayMs = Math.max(0, Math.round((startAt - context.currentTime) * 1000));
    startTimer = setTimeout(() => {
      if (stopped) return;
      lastPlaybackError = null;
      lastBackend = 'WebAudio WSOLA independent pitch';
      lastStartedAt = Date.now();
      opts.onStarted?.();
    }, startDelayMs);
    finishTimer = setTimeout(cleanup, Math.max(1, Math.ceil((buffer.duration + 0.04) * 1000)));
    return { stop, durationS: buffer.duration, independentPitch: true };
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

    lastBackend = 'WSOLA decode/render pending';
    decodeUrl(resolved, context)
      .then(decoded => renderBufferFor(resolved, decoded, context, opts))
      .then(rendered => {
        if (stopped) return;
        lastPlaybackError = null;
        active = scheduleProcessedBuffer(context, rendered, opts, cleanup);
        handle.independentPitch = true;
      })
      .catch(error => {
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
      renderedVariantCount: renderedByKey.size,
      lastRenderMs,
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
        const render = snap.lastRenderMs == null ? '' : ` · render ${snap.lastRenderMs}ms`;
        text.textContent = `${snap.contextState} · ${snap.backend} · previews ${snap.previewCount} · decoded ${snap.decodedClipCount}${render}${error}`;
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
