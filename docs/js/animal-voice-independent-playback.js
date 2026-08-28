(() => {
  'use strict';

  // AudioSystem still chooses/range-mixes the animal clip. This layer owns
  // pitch/tempo rendering, per-recording baseline normalization, and reusable
  // frequency analysis for the authoring tool.
  const MAX_SHIFT_SEMITONES = 12;
  const MIN_TEMPO = 0.35;
  const MAX_TEMPO = 2;
  const DEFAULT_CONTOUR_SEGMENT_MS = 260;
  const WSOLA_FRAME_S = 0.056;
  const WSOLA_OVERLAP_RATIO = 0.62;
  const WSOLA_SEARCH_S = 0.018;
  const WSOLA_CORRELATION_STEP = 2;
  const SEGMENT_CROSSFADE_S = 0.026;
  const OUTPUT_EDGE_FADE_S = 0.006;
  const OUTPUT_TAIL_PAD_S = 0.018;
  const MAX_RENDER_CACHE = 32;
  const ANALYSIS_RATE = 12000;
  const ANALYSIS_FRAME = 1024;
  const ANALYSIS_HOP = 240;
  const ANALYSIS_MIN_F0 = 55;
  const ANALYSIS_MAX_F0 = 1200;
  const YIN_THRESHOLD = 0.18;

  const MODULE_SRC = typeof document !== 'undefined' && document.currentScript?.src
    ? document.currentScript.src : null;
  const CONFIG_URL = MODULE_SRC ? new URL('../config/dialogue/ambient-dialogue.json', MODULE_SRC).href : 'config/dialogue/ambient-dialogue.json';
  const EDITOR_ANALYZER_SRC = MODULE_SRC ? new URL('animal-voice-analysis-editor.js?v=20260828freq1', MODULE_SRC).href : null;
  const decodedByUrl = new Map();
  const renderedByKey = new Map();
  const analysisByUrl = new Map();
  const previewHandles = new Set();
  const clipPitchByKey = new Map();
  let sharedContext = null;
  let installed = false;
  let lastPlaybackError = null;
  let lastBackend = 'idle';
  let lastUrl = null;
  let lastStartedAt = null;
  let lastRenderMs = null;
  let lastClipNormalizationSemitones = 0;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clampPitch(semitones) { return clamp(finite(semitones, 0), -MAX_SHIFT_SEMITONES, MAX_SHIFT_SEMITONES); }
  function clampTempo(tempo) { return clamp(finite(tempo, 1), MIN_TEMPO, MAX_TEMPO); }
  function percentile(sorted, fraction) {
    if (!sorted?.length) return null;
    const position = clamp(fraction, 0, 1) * (sorted.length - 1);
    const left = Math.floor(position), right = Math.min(sorted.length - 1, left + 1), mix = position - left;
    return sorted[left] + (sorted[right] - sorted[left]) * mix;
  }
  function smoothBlendWeight(index, count) {
    if (count <= 1) return 1;
    const t = clamp(index / (count - 1), 0, 1);
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }
  function cubicSample(channel, position) {
    if (!channel?.length) return 0;
    const i1 = clamp(Math.floor(position), 0, channel.length - 1);
    const i0 = Math.max(0, i1 - 1), i2 = Math.min(channel.length - 1, i1 + 1), i3 = Math.min(channel.length - 1, i1 + 2);
    const t = position - Math.floor(position), p0 = channel[i0], p1 = channel[i1], p2 = channel[i2], p3 = channel[i3];
    const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const a1 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
    const a2 = -0.5 * p0 + 0.5 * p2;
    return clamp(((a0 * t + a1) * t + a2) * t + p1, -1, 1);
  }
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
  function clipKey(url) {
    const resolved = absoluteUrl(url);
    try { return decodeURIComponent(new URL(resolved).pathname.split('/').pop() || '').toLowerCase(); }
    catch (_) { return String(url || '').split('/').pop().toLowerCase(); }
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

  function setNormalizationProfiles(profiles) {
    clipPitchByKey.clear();
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return 0;
    for (const profile of Object.values(profiles)) {
      const offsets = profile?.clipPitchSemitones;
      if (!offsets || typeof offsets !== 'object' || Array.isArray(offsets)) continue;
      for (const [key, value] of Object.entries(offsets)) {
        const semitones = finite(value, NaN);
        if (Number.isFinite(semitones)) clipPitchByKey.set(clipKey(key), clampPitch(semitones));
      }
    }
    renderedByKey.clear();
    return clipPitchByKey.size;
  }
  async function loadNormalizationProfiles() {
    if (typeof fetch !== 'function') return;
    try {
      const response = await fetch(CONFIG_URL);
      if (!response.ok) return;
      const config = await response.json();
      setNormalizationProfiles(config?.animalVocalizations || {});
    } catch (_) {}
  }
  function clipNormalization(url, opts) {
    const authored = opts?.clipPitchSemitones;
    const key = clipKey(url);
    if (authored && typeof authored === 'object' && !Array.isArray(authored)) {
      const direct = authored[key] ?? authored[url] ?? authored[absoluteUrl(url)];
      if (Number.isFinite(Number(direct))) return clampPitch(direct);
    }
    return clipPitchByKey.get(key) || 0;
  }
  function normalizedOpts(url, opts = {}) {
    const correction = clipNormalization(url, opts);
    lastClipNormalizationSemitones = correction;
    if (!correction) return opts;
    const adjusted = { ...opts, pitchSemitones: clampPitch(finite(opts.pitchSemitones, 0) + correction) };
    if (Array.isArray(opts.pitchContourSemitones)) adjusted.pitchContourSemitones = opts.pitchContourSemitones.map(value => clampPitch(finite(value, 0) + correction));
    return adjusted;
  }

  function stageValue(values, fallback, index) {
    if (!Array.isArray(values) || !values.length) return fallback;
    return values[Math.min(values.length - 1, Math.max(0, index))] ?? fallback;
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
      const a = reference[referenceStart + index] || 0, b = candidate[candidateStart + index] || 0;
      dot += a * b; refEnergy += a * a; candidateEnergy += b * b;
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
    const referenceChannel = channels[0], referenceOutput = outputs[0];
    const firstCount = Math.min(frame, sourceLength, targetLength);
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) outputs[channelIndex].set(channels[channelIndex].subarray(0, firstCount), 0);
    let outputPos = synthesisHop, expectedInputPos = analysisHop;
    while (outputPos < targetLength && expectedInputPos < sourceLength - 1) {
      const center = clamp(Math.round(expectedInputPos), 0, Math.max(0, sourceLength - frame));
      const searchStart = Math.max(0, center - searchRadius), searchEnd = Math.min(Math.max(0, sourceLength - frame), center + searchRadius);
      const overlapLength = Math.min(overlap, targetLength - outputPos, sourceLength);
      let bestInputPos = center, bestScore = -Infinity;
      for (let candidatePos = searchStart; candidatePos <= searchEnd; candidatePos += WSOLA_CORRELATION_STEP) {
        const score = correlation(referenceOutput, referenceChannel, outputPos, candidatePos, overlapLength);
        if (score > bestScore) { bestScore = score; bestInputPos = candidatePos; }
      }
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        const input = channels[channelIndex], output = outputs[channelIndex];
        const usable = Math.min(frame, input.length - bestInputPos, output.length - outputPos), crossfade = Math.min(overlap, usable);
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
  function processConstantAxes(channels, sampleRate, tempo, pitchSt) {
    const pitchRatio = Math.pow(2, clampPitch(pitchSt) / 12);
    return wsolaStretch(resampleChannels(channels, pitchRatio), pitchRatio / clampTempo(tempo), sampleRate);
  }
  function concatenateWithCrossfade(segments, sampleRate) {
    if (!segments.length) return [new Float32Array(1)];
    if (segments.length === 1) return segments[0];
    const channelCount = segments[0].length, crossfadeSamples = Math.max(1, Math.round(sampleRate * SEGMENT_CROSSFADE_S));
    const totalLength = segments.reduce((sum, segment) => sum + (segment[0]?.length || 0), 0) - crossfadeSamples * (segments.length - 1);
    const outputs = Array.from({ length: channelCount }, () => new Float32Array(Math.max(1, totalLength)));
    let writePos = 0;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex], segmentLength = segment[0]?.length || 0;
      if (!segmentLength) continue;
      if (!segmentIndex) {
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) outputs[channelIndex].set(segment[channelIndex]);
        writePos = segmentLength; continue;
      }
      const overlap = Math.min(crossfadeSamples, writePos, segmentLength), overlapStart = writePos - overlap;
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
        const output = outputs[channelIndex], input = segment[channelIndex];
        for (let index = 0; index < overlap; index++) {
          const weight = smoothBlendWeight(index, overlap);
          output[overlapStart + index] = output[overlapStart + index] * (1 - weight) + input[index] * weight;
        }
        output.set(input.subarray(overlap), writePos);
      }
      writePos += segmentLength - overlap;
    }
    return outputs.map(output => output.slice(0, writePos));
  }
  function applyOutputEdgeEnvelope(channels, sampleRate) {
    const length = channels[0]?.length || 0;
    if (!length) return channels;
    const fadeSamples = Math.min(Math.max(1, Math.round(sampleRate * OUTPUT_EDGE_FADE_S)), Math.max(1, Math.floor(length / 4)));
    const padSamples = Math.max(1, Math.round(sampleRate * OUTPUT_TAIL_PAD_S));
    return channels.map(channel => {
      const output = new Float32Array(length + padSamples);
      output.set(channel.subarray(0, length));
      for (let index = 0; index < fadeSamples; index++) {
        const inGain = smoothBlendWeight(index, fadeSamples);
        const outGain = 1 - inGain;
        output[index] *= inGain;
        output[length - fadeSamples + index] *= outGain;
      }
      return output;
    });
  }
  function renderProcessedChannels(buffer, opts) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
    const sampleRate = buffer.sampleRate, baseTempo = clampTempo(opts.tempo ?? opts.rate ?? 1), basePitch = clampPitch(opts.pitchSemitones ?? 0);
    const tempoContour = Array.isArray(opts.tempoContour) ? opts.tempoContour.map(clampTempo) : null;
    const pitchContour = Array.isArray(opts.pitchContourSemitones) ? opts.pitchContourSemitones.map(clampPitch) : null;
    const stageCount = Math.max(tempoContour?.length || 0, pitchContour?.length || 0, 1);
    let rendered;
    if (stageCount === 1) rendered = processConstantAxes(channels, sampleRate, baseTempo, basePitch);
    else {
      const segmentMs = Math.max(40, finite(opts.contourSegmentMs, DEFAULT_CONTOUR_SEGMENT_MS)), segments = [];
      let sourceStart = 0;
      for (let stage = 0; stage < stageCount && sourceStart < buffer.length; stage++) {
        const tempo = clampTempo(stageValue(tempoContour, baseTempo, stage)), pitch = clampPitch(stageValue(pitchContour, basePitch, stage));
        let sourceEnd = buffer.length;
        if (stage < stageCount - 1) sourceEnd = Math.min(buffer.length, sourceStart + Math.max(1, Math.round(sampleRate * segmentMs / 1000 * tempo)));
        const sourceSegment = channels.map(channel => channel.slice(sourceStart, sourceEnd));
        segments.push(processConstantAxes(sourceSegment, sampleRate, tempo, pitch));
        sourceStart = sourceEnd;
      }
      rendered = concatenateWithCrossfade(segments, sampleRate);
    }
    return applyOutputEdgeEnvelope(rendered, sampleRate);
  }
  function renderCacheKey(url, opts) {
    const arrayKey = value => Array.isArray(value) ? value.map(item => Number(finite(item, 0).toFixed(4))).join(',') : '';
    return [absoluteUrl(url), Number(clampTempo(opts.tempo ?? opts.rate ?? 1).toFixed(4)), Number(clampPitch(opts.pitchSemitones ?? 0).toFixed(3)), arrayKey(opts.tempoContour), arrayKey(opts.pitchContourSemitones), Math.round(finite(opts.contourSegmentMs, DEFAULT_CONTOUR_SEGMENT_MS))].join('|');
  }
  function pruneRenderCache() {
    while (renderedByKey.size > MAX_RENDER_CACHE) renderedByKey.delete(renderedByKey.keys().next().value);
  }
  function renderBufferFor(url, decoded, context, opts) {
    const key = renderCacheKey(url, opts);
    if (renderedByKey.has(key)) return renderedByKey.get(key);
    const pending = Promise.resolve().then(() => {
      const clock = typeof performance !== 'undefined' && performance?.now ? performance : Date, started = clock.now();
      const channels = renderProcessedChannels(decoded, opts), length = Math.max(1, channels[0]?.length || 1);
      const rendered = context.createBuffer(channels.length, length, decoded.sampleRate);
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) rendered.copyToChannel(channels[channelIndex], channelIndex);
      lastRenderMs = Math.round(clock.now() - started);
      return rendered;
    }).catch(error => { renderedByKey.delete(key); throw error; });
    renderedByKey.set(key, pending); pruneRenderCache(); return pending;
  }
  function scheduleProcessedBuffer(context, buffer, opts, onFinished) {
    const source = context.createBufferSource(), master = context.createGain(), startAt = context.currentTime + 0.012;
    let stopped = false, finishTimer = null, startTimer = null;
    source.buffer = buffer; master.gain.value = clamp(finite(opts.volume, 0.7), 0, 1); source.connect(master); master.connect(context.destination);
    function cleanup() {
      if (stopped) return; stopped = true; clearTimeout(finishTimer); clearTimeout(startTimer);
      try { source.disconnect(); } catch (_) {} try { master.disconnect(); } catch (_) {} onFinished?.();
    }
    function stop() { if (stopped) return; try { source.stop(); } catch (_) {} cleanup(); }
    source.onended = cleanup;
    try { source.start(startAt); }
    catch (error) { lastPlaybackError = error; opts.onError?.(error); cleanup(); return { stop, durationS: 0, independentPitch: true }; }
    startTimer = setTimeout(() => {
      if (stopped) return; lastPlaybackError = null; lastBackend = 'WebAudio smooth WSOLA independent pitch'; lastStartedAt = Date.now(); opts.onStarted?.();
    }, Math.max(0, Math.round((startAt - context.currentTime) * 1000)));
    finishTimer = setTimeout(cleanup, Math.max(1, Math.ceil((buffer.duration + 0.04) * 1000)));
    return { stop, durationS: buffer.duration, independentPitch: true };
  }
  function playNativeFallback(audio, opts = {}, nativePlay = null) {
    const tempo = clampTempo(opts.tempo ?? opts.rate ?? 1), pitchSt = clampPitch(opts.pitchSemitones ?? 0), ratio = Math.pow(2, pitchSt / 12);
    const tempoContour = Array.isArray(opts.tempoContour) ? opts.tempoContour.map(clampTempo) : null, pitchContour = Array.isArray(opts.pitchContourSemitones) ? opts.pitchContourSemitones.map(clampPitch) : null;
    const segmentMs = Math.max(40, finite(opts.contourSegmentMs, DEFAULT_CONTOUR_SEGMENT_MS)), timers = [];
    let stopped = false, started = false;
    setPitchPreservation(audio, Math.abs(pitchSt) < 0.08); audio.playbackRate = Math.abs(pitchSt) < 0.08 ? tempo : clampTempo(tempo * ratio);
    function applyStage(index) {
      if (stopped) return;
      const stageTempo = tempoContour?.[index] ?? tempo, stagePitch = pitchContour?.[index] ?? pitchSt, stageRatio = Math.pow(2, clampPitch(stagePitch) / 12);
      setPitchPreservation(audio, Math.abs(stagePitch) < 0.08); audio.playbackRate = Math.abs(stagePitch) < 0.08 ? clampTempo(stageTempo) : clampTempo(stageTempo * stageRatio);
    }
    function notifyStarted() {
      if (started || stopped) return; started = true; lastPlaybackError = null; lastBackend = 'native coupled fallback'; lastStartedAt = Date.now(); opts.onStarted?.();
      const stages = Math.max(tempoContour?.length || 0, pitchContour?.length || 0);
      for (let index = 1; index < stages; index++) timers.push(setTimeout(() => applyStage(index), segmentMs * index));
    }
    function cleanup() { if (stopped) return; stopped = true; for (const timer of timers) clearTimeout(timer); opts.onFinished?.(); }
    function stop() { if (stopped) return; try { audio.pause(); audio.currentTime = 0; } catch (_) {} cleanup(); }
    audio.addEventListener?.('playing', notifyStarted, { once: true }); audio.addEventListener?.('ended', cleanup, { once: true });
    let playResult = null;
    try { playResult = nativePlay ? nativePlay.call(audio) : audio.play(); }
    catch (error) { lastPlaybackError = error; opts.onError?.(error); cleanup(); return { audio, stop, independentPitch: false }; }
    playResult?.then?.(notifyStarted).catch?.(error => { lastPlaybackError = error; opts.onError?.(error); cleanup(); });
    return { audio, stop, independentPitch: false };
  }
  function playDecodedUrl(url, opts = {}, fallbackAudio = null, nativePlay = null, trackPreview = false) {
    const context = ensureContext(), resolved = absoluteUrl(url), effectiveOpts = normalizedOpts(resolved, opts);
    lastUrl = resolved || String(url || '');
    let stopped = false, active = null, cleaned = false;
    const handle = { audio: fallbackAudio, independentPitch: false, stop() { if (stopped) return; stopped = true; active?.stop?.(); cleanup(); }, setPitchSemitones() {}, setTempo() {} };
    function cleanup() { if (cleaned) return; cleaned = true; if (trackPreview) previewHandles.delete(handle); }
    if (trackPreview) previewHandles.add(handle);
    if (!context || context.state !== 'running') {
      if (!fallbackAudio && typeof Audio === 'function' && resolved) fallbackAudio = new Audio(resolved);
      if (!fallbackAudio) { lastPlaybackError = new Error('No usable audio backend'); effectiveOpts.onError?.(lastPlaybackError); cleanup(); return handle; }
      fallbackAudio.volume = clamp(finite(effectiveOpts.volume ?? fallbackAudio.volume, 0.7), 0, 1);
      active = playNativeFallback(fallbackAudio, { ...effectiveOpts, onFinished: cleanup }, nativePlay); handle.audio = fallbackAudio; return handle;
    }
    lastBackend = 'WSOLA decode/render pending';
    decodeUrl(resolved, context).then(decoded => renderBufferFor(resolved, decoded, context, effectiveOpts)).then(rendered => {
      if (stopped) return; lastPlaybackError = null; active = scheduleProcessedBuffer(context, rendered, effectiveOpts, cleanup); handle.independentPitch = true;
    }).catch(error => {
      if (stopped) return; lastPlaybackError = error;
      if (!fallbackAudio && typeof Audio === 'function' && resolved) fallbackAudio = new Audio(resolved);
      if (!fallbackAudio) { effectiveOpts.onError?.(error); cleanup(); return; }
      fallbackAudio.volume = clamp(finite(effectiveOpts.volume ?? fallbackAudio.volume, 0.7), 0, 1);
      active = playNativeFallback(fallbackAudio, { ...effectiveOpts, onFinished: cleanup }, nativePlay); handle.audio = fallbackAudio;
    });
    return handle;
  }

  // YIN fundamental-frequency estimate over one analysis frame. Returns null
  // for noise/unpitched material rather than forcing it into a musical pitch.
  function yinFrame(samples, start, frameSize, sampleRate) {
    const end = Math.min(samples.length, start + frameSize), length = end - start;
    if (length < 384) return null;
    let mean = 0, energy = 0;
    for (let i = start; i < end; i++) mean += samples[i];
    mean /= length;
    for (let i = start; i < end; i++) { const value = samples[i] - mean; energy += value * value; }
    const rms = Math.sqrt(energy / length);
    if (rms < 0.002) return { rms, f0: null, confidence: 0 };
    const minTau = Math.max(2, Math.floor(sampleRate / ANALYSIS_MAX_F0));
    const maxTau = Math.min(Math.floor(sampleRate / ANALYSIS_MIN_F0), Math.floor(length / 2));
    const difference = new Float32Array(maxTau + 1), cmnd = new Float32Array(maxTau + 1);
    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      const count = length - tau;
      for (let j = 0; j < count; j++) {
        const delta = (samples[start + j] - mean) - (samples[start + j + tau] - mean);
        sum += delta * delta;
      }
      difference[tau] = sum;
    }
    let running = 0;
    cmnd[0] = 1;
    for (let tau = 1; tau <= maxTau; tau++) {
      running += difference[tau];
      cmnd[tau] = running > 0 ? difference[tau] * tau / running : 1;
    }
    let tau = -1;
    for (let candidate = minTau; candidate <= maxTau; candidate++) {
      if (cmnd[candidate] < YIN_THRESHOLD) {
        while (candidate + 1 <= maxTau && cmnd[candidate + 1] < cmnd[candidate]) candidate++;
        tau = candidate; break;
      }
    }
    if (tau < 0) {
      let best = minTau;
      for (let candidate = minTau + 1; candidate <= maxTau; candidate++) if (cmnd[candidate] < cmnd[best]) best = candidate;
      if (cmnd[best] > 0.28) return { rms, f0: null, confidence: Math.max(0, 1 - cmnd[best]) };
      tau = best;
    }
    const left = Math.max(minTau, tau - 1), right = Math.min(maxTau, tau + 1);
    const y0 = cmnd[left], y1 = cmnd[tau], y2 = cmnd[right], denom = y0 - 2 * y1 + y2;
    const refinedTau = Math.max(1, tau + (Math.abs(denom) > 1e-9 ? 0.5 * (y0 - y2) / denom : 0));
    return { rms, f0: sampleRate / refinedTau, confidence: clamp(1 - cmnd[tau], 0, 1) };
  }
  function monoAtRate(buffer, targetRate = ANALYSIS_RATE) {
    const sourceLength = buffer.length, sourceRate = buffer.sampleRate, targetLength = Math.max(1, Math.round(sourceLength * targetRate / sourceRate));
    const mono = new Float32Array(targetLength), channelCount = Math.max(1, buffer.numberOfChannels);
    for (let index = 0; index < targetLength; index++) {
      const sourcePos = index * sourceRate / targetRate, left = clamp(Math.floor(sourcePos), 0, sourceLength - 1), right = Math.min(sourceLength - 1, left + 1), mix = sourcePos - left;
      let value = 0;
      for (let channel = 0; channel < channelCount; channel++) {
        const data = buffer.getChannelData(channel); value += data[left] + (data[right] - data[left]) * mix;
      }
      mono[index] = value / channelCount;
    }
    return mono;
  }
  function spectralCentroid(frame, sampleRate) {
    const fftSize = Math.min(512, 1 << Math.floor(Math.log2(frame.length || 1)));
    if (fftSize < 64) return null;
    let weighted = 0, magnitudeSum = 0;
    for (let bin = 1; bin <= fftSize / 2; bin++) {
      let real = 0, imag = 0;
      for (let n = 0; n < fftSize; n++) {
        const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / Math.max(1, fftSize - 1));
        const angle = 2 * Math.PI * bin * n / fftSize, value = (frame[n] || 0) * window;
        real += value * Math.cos(angle); imag -= value * Math.sin(angle);
      }
      const magnitude = Math.hypot(real, imag), frequency = bin * sampleRate / fftSize;
      weighted += frequency * magnitude; magnitudeSum += magnitude;
    }
    return magnitudeSum > 1e-9 ? weighted / magnitudeSum : null;
  }
  function analyzeDecodedBuffer(buffer) {
    const samples = monoAtRate(buffer), frames = [], rmsValues = [];
    for (let start = 0; start + 384 < samples.length; start += ANALYSIS_HOP) {
      const result = yinFrame(samples, start, ANALYSIS_FRAME, ANALYSIS_RATE); if (!result) continue;
      frames.push({ start, ...result }); rmsValues.push(result.rms);
    }
    const sortedRms = [...rmsValues].sort((a, b) => a - b), typicalRms = percentile(sortedRms, 0.65) || 0;
    const activeThreshold = Math.max(0.0025, typicalRms * 0.32);
    const active = frames.filter(frame => frame.rms >= activeThreshold);
    const voiced = active.filter(frame => Number.isFinite(frame.f0) && frame.confidence >= 0.62);
    const f0Values = voiced.map(frame => frame.f0).sort((a, b) => a - b);
    const meanConfidence = voiced.length ? voiced.reduce((sum, frame) => sum + frame.confidence, 0) / voiced.length : 0;
    const voicedPercent = active.length ? voiced.length / active.length * 100 : 0;
    const centroidFrames = active.filter((_, index) => index % Math.max(1, Math.floor(active.length / 8)) === 0).slice(0, 8);
    const centroids = centroidFrames.map(frame => spectralCentroid(samples.subarray(frame.start, Math.min(samples.length, frame.start + 512)), ANALYSIS_RATE)).filter(Number.isFinite);
    const centroidHz = centroids.length ? centroids.reduce((sum, value) => sum + value, 0) / centroids.length : null;
    const reliable = f0Values.length >= 3 && voicedPercent >= 25 && meanConfidence >= 0.62;
    return {
      durationS: buffer.duration,
      sampleRate: buffer.sampleRate,
      f0LowHz: reliable ? percentile(f0Values, 0.1) : null,
      f0MedianHz: reliable ? percentile(f0Values, 0.5) : null,
      f0HighHz: reliable ? percentile(f0Values, 0.9) : null,
      voicedPercent,
      pitchConfidence: meanConfidence,
      spectralCentroidHz: centroidHz,
      pitchReliable: reliable,
      voicedFrameCount: voiced.length,
      activeFrameCount: active.length,
    };
  }
  function analyzeClip(url) {
    const context = ensureContext(), resolved = absoluteUrl(url);
    if (!context) return Promise.reject(new Error('Web Audio is unavailable for voice analysis'));
    if (analysisByUrl.has(resolved)) return analysisByUrl.get(resolved);
    const pending = decodeUrl(resolved, context).then(buffer => ({ url: resolved, clipKey: clipKey(resolved), ...analyzeDecodedBuffer(buffer) }))
      .catch(error => { analysisByUrl.delete(resolved); throw error; });
    analysisByUrl.set(resolved, pending); return pending;
  }

  function capturePreparedAnimalElement(originalRenderer, creature, opts) {
    const mediaProto = window.HTMLMediaElement?.prototype;
    if (!mediaProto?.play) return { accepted: false, audio: null, nativePlay: null };
    const nativePlay = mediaProto.play, blockedResult = { then() { return { catch() {} }; } };
    let captured = null;
    mediaProto.play = function captureAnimalVoicePlay() { if (!captured) captured = this; return this === captured ? blockedResult : nativePlay.call(this); };
    let accepted = false;
    try { accepted = !!originalRenderer(creature, { ...opts, rate: 1, rateContour: undefined, onStarted: undefined }); }
    finally { mediaProto.play = nativePlay; }
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
      const url = capture.audio.currentSrc || capture.audio.src, volume = clamp(finite(capture.audio.volume, opts.volume ?? 0.7), 0, 1);
      playDecodedUrl(url, { ...opts, volume }, capture.audio, capture.nativePlay, false); return true;
    };
    audioSystem.__independentAnimalVoiceWrapped = true; installed = true; return true;
  }
  function preview(url, opts = {}) {
    if (!url) return null; primeAudioContext();
    const audio = typeof Audio === 'function' ? new Audio(url) : null;
    if (audio) { audio.preload = 'auto'; audio.volume = clamp(finite(opts.volume, 0.7), 0, 1); }
    return playDecodedUrl(url, opts, audio, null, true);
  }
  function stopAllPreviews() { for (const handle of [...previewHandles]) handle.stop(); previewHandles.clear(); }
  function debugSnapshot() {
    return {
      installed,
      contextState: sharedContext?.state || 'unavailable',
      backend: lastBackend,
      previewCount: previewHandles.size,
      decodedClipCount: decodedByUrl.size,
      analyzedClipCount: analysisByUrl.size,
      normalizationClipCount: clipPitchByKey.size,
      renderedVariantCount: renderedByKey.size,
      lastRenderMs,
      lastClipNormalizationSemitones,
      lastUrl,
      lastStartedAt,
      lastPlaybackError: lastPlaybackError ? String(lastPlaybackError?.message || lastPlaybackError) : null,
    };
  }
  function requestEditorAnalyzer() {
    if (!EDITOR_ANALYZER_SRC || typeof document === 'undefined' || !/\/tools\/ambient-dialogue-editor\//.test(location.pathname)) return;
    if (document.querySelector('script[data-animal-voice-analysis-editor]')) return;
    const script = document.createElement('script'); script.src = EDITOR_ANALYZER_SRC; script.async = true; script.dataset.animalVoiceAnalysisEditor = '1'; document.head?.appendChild(script);
  }
  function installEditorDiagnostics() {
    if (typeof document === 'undefined' || !/\/tools\/ambient-dialogue-editor\//.test(location.pathname)) return;
    const mount = () => {
      if (!document.body || document.getElementById('animalVoiceDiagDock')) return;
      const dock = document.createElement('div'); dock.id = 'animalVoiceDiagDock';
      dock.style.cssText = 'position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483647;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 8px;background:rgba(3,9,16,.94);border:1px solid rgba(255,255,255,.22);border-radius:9px;box-shadow:0 4px 18px rgba(0,0,0,.45);font:11px system-ui,sans-serif;color:#dbeafe;max-width:720px;margin:auto';
      dock.innerHTML = '<b>Animal audio</b><span id="animalVoiceDiagText" style="flex:1;min-width:180px;overflow-wrap:anywhere">initializing…</span><button id="animalVoiceDiagCopy" type="button" style="padding:5px 7px">Copy audio probe</button>';
      document.body.appendChild(dock);
      const text = dock.querySelector('#animalVoiceDiagText'), copy = dock.querySelector('#animalVoiceDiagCopy');
      const update = () => {
        const snap = debugSnapshot(), error = snap.lastPlaybackError ? ` · error: ${snap.lastPlaybackError}` : '', render = snap.lastRenderMs == null ? '' : ` · render ${snap.lastRenderMs}ms`, normalization = snap.lastClipNormalizationSemitones ? ` · clip ${snap.lastClipNormalizationSemitones > 0 ? '+' : ''}${snap.lastClipNormalizationSemitones.toFixed(1)}st` : '';
        text.textContent = `${snap.contextState} · ${snap.backend} · previews ${snap.previewCount} · decoded ${snap.decodedClipCount}${normalization}${render}${error}`;
      };
      copy.onclick = async () => {
        const payload = JSON.stringify(debugSnapshot(), null, 2);
        try { await navigator.clipboard.writeText(payload); copy.textContent = 'Copied'; }
        catch (_) {
          const area = document.createElement('textarea'); area.value = payload; area.style.cssText = 'position:fixed;left:8px;right:8px;bottom:70px;height:180px;z-index:2147483647'; document.body.appendChild(area); area.select(); copy.textContent = 'Probe shown';
        }
        setTimeout(() => { copy.textContent = 'Copy audio probe'; }, 1200);
      };
      update(); setInterval(update, 250);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  }

  window.AnimalVoiceIndependentPlayback = {
    installAudioSystemAdapter, preview, stopAllPreviews, primeAudioContext,
    clampPitch, clampTempo, analyzeClip, clipKey, setNormalizationProfiles,
    debugSnapshot, isInstalled: () => installed,
  };

  installGestureUnlock();
  void loadNormalizationProfiles();
  requestEditorAnalyzer();
  installEditorDiagnostics();
  installAudioSystemAdapter();
})();