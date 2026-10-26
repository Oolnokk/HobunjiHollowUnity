(() => {
  'use strict';

  // Constant-axis animal voice renderer. The only authored audio transforms are
  // one fixed tempo/pitch per recording, one fixed tempo/pitch per utterance,
  // and the species size-class pitch offset. No random ranges, normalization,
  // contours, splice-tempo or behavior-specific modulation remain.
  const MIN_TEMPO = 1 / 9; // Allows Banubu's Grehlr snore to run three times longer than its prior one-third tempo.
  const MAX_TEMPO = 2;
  const GENERIC_MAX_TEMPO = 4; // Shared pitch-preserving renderer may serve faster non-animal one-shots without changing animal authoring limits.
  const MAX_SHIFT_SEMITONES = 12;
  const GENERIC_MAX_SHIFT_SEMITONES = 24; // Combat profiles can exceed animal authoring pitch limits without changing animal-call behavior.
  const WSOLA_FRAME_S = 0.056;
  const WSOLA_OVERLAP_RATIO = 0.62;
  const WSOLA_SEARCH_S = 0.018;
  const WSOLA_CORRELATION_STEP = 2;
  const OUTPUT_EDGE_FADE_S = 0.006;
  const OUTPUT_TAIL_PAD_S = 0.018;
  const SILENCE_TRIM_ABSOLUTE_FLOOR = 0.0005; // Keeps codec noise/dead air out of vocal timing without shaving quiet breath consonants.
  const SILENCE_TRIM_RELATIVE_FLOOR = 0.002; // -54 dB relative to each decoded clip peak; intentionally conservative for breath tails.
  const SILENCE_TRIM_PAD_MS = 4; // Retains a tiny acoustic margin around the first/last real waveform sample.
  const MAX_RENDER_CACHE = 32;
  const ANIMAL_EXTRA_WET = 0.026;
  const UTTERANCE_BASE = 'assets/audio/sfx/utterances/';
  // Widening earshot to jungle range (see animal-vocalizations.js's
  // PROFILE_DEFAULTS) means far more creatures can qualify to bark at
  // once, and each one that does pays for a real WebAudio graph (source +
  // gain + panner + reverb send) here — cheap per call, but the count of
  // simultaneously active calls now scales with a much bigger radius, not
  // just nearby creature density. This caps concurrent renders so that
  // scaling stays bounded instead of tracking earshot's radius squared.
  // 'warning' calls (rare, gameplay-relevant) are exempt — only ambient
  // chatter/growl piles get throttled.
  const MAX_CONCURRENT_ANIMAL_VOICES = 6;
  let activeVoiceCount = 0;
  const activeHandles = new Set(); // Introduction audio can stop pending decodes and native/processed voices together.

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
  const silenceTrimCache = new WeakMap(); // Decoded AudioBuffer -> WeakMap(AudioContext -> Map(settings -> trimmed result)); repeated breathing never rescans the same clip.
  const previewHandles = new Set();
  let sharedContext = null;
  let pendingContextResume = null; // A pending gesture-unlock resume is shared by breathing retries rather than issuing one resume per frame.
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
  let lastStretchSourceSamples = 0; // Debug snapshot: decoded sample count entering the most recent tempo stretch.
  let lastStretchTargetSamples = 0; // Debug snapshot: requested sample count after the most recent tempo stretch.
  let lastStretchCoverage = 1; // Debug snapshot: fraction of the source guaranteed to be represented through the final anchored frame.

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clampTempoFor(value, maxTempo = MAX_TEMPO) { return clamp(finite(value, 1), MIN_TEMPO, maxTempo); }
  function clampTempo(value) { return clampTempoFor(value, MAX_TEMPO); }
  function clampPitchFor(value, maxShiftSemitones = MAX_SHIFT_SEMITONES) { return clamp(finite(value, 0), -maxShiftSemitones, maxShiftSemitones); }
  function clampPitch(value) { return clampPitchFor(value, MAX_SHIFT_SEMITONES); }
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
  function primeAudioContext(fromUserGesture = false) {
    const context = ensureContext();
    if (!context) return false;
    // A background resume can remain pending until a trusted gesture, so never let it block the gesture itself.
    if ((context.state === 'suspended' || context.state === 'interrupted') && (!pendingContextResume || fromUserGesture)) {
      try {
        const resumed = context.resume();
        if (resumed?.then) {
          const pending = Promise.resolve(resumed).catch(error => { lastPlaybackError = error; }); // Tracks one resume attempt so older pending completions cannot clear a newer gesture attempt.
          pendingContextResume = pending;
          pending.finally(() => { if (pendingContextResume === pending) pendingContextResume = null; });
        }
      } catch (error) { lastPlaybackError = error; }
    }
    return context.state === 'running';
  }

  function readyForIndependentPitch() {
    const context = ensureContext();
    if (!context) return true; // Browsers without Web Audio retain the existing native playback behavior.
    if (context.state === 'running') return true;
    primeAudioContext(); // Unlock asynchronously; passive breathing retries on its existing short suppression timer.
    return false;
  }
  function installGestureUnlock() {
    if (typeof window.addEventListener !== 'function') return;
    const unlock = () => primeAudioContext(true); // Trusted input may restart a resume left pending by a breathing-frame readiness check.
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

  function* wsolaStretchSteps(channels, stretch, sampleRate) {
    const sourceLength = channels[0]?.length || 0;
    if (!sourceLength) {
      lastStretchSourceSamples = 0;
      lastStretchTargetSamples = 1;
      lastStretchCoverage = 1;
      return channels.map(() => new Float32Array(1));
    }
    const safeStretch = clamp(finite(stretch, 1), 0.25, 9); // Accommodates the snore's one-ninth tempo at neutral pitch.
    const targetLength = Math.max(1, Math.round(sourceLength * safeStretch));
    lastStretchSourceSamples = sourceLength;
    lastStretchTargetSamples = targetLength;
    lastStretchCoverage = 1;
    if (Math.abs(safeStretch - 1) < 0.012) {
      if (targetLength === sourceLength) return channels.map(channel => channel.slice());
      return channels.map(channel => {
        const output = new Float32Array(targetLength);
        for (let index = 0; index < targetLength; index++) output[index] = cubicSample(channel, index * (sourceLength - 1) / Math.max(1, targetLength - 1));
        return output;
      });
    }

    // Keep enough grains in even a 2x-speed short call that the algorithm can
    // traverse the whole source rather than treating the beginning as the call.
    const desiredFrame = Math.round(sampleRate * WSOLA_FRAME_S);
    const sourceBoundFrame = Math.max(32, Math.floor(sourceLength * 0.45));
    const targetBoundFrame = Math.max(32, Math.floor(targetLength * 0.45));
    const frame = Math.max(32, Math.min(sourceLength, desiredFrame, sourceBoundFrame, targetBoundFrame));
    if (frame < 64 || sourceLength <= frame || targetLength <= frame) {
      // There is not enough waveform for meaningful similarity grains. Preserve
      // complete start-to-end coverage rather than clipping or manufacturing a tail.
      return channels.map(channel => {
        const output = new Float32Array(targetLength);
        for (let index = 0; index < targetLength; index++) output[index] = cubicSample(channel, index * (sourceLength - 1) / Math.max(1, targetLength - 1));
        return output;
      });
    }

    const overlap = Math.max(16, Math.min(frame - 1, Math.round(frame * WSOLA_OVERLAP_RATIO)));
    const synthesisHop = Math.max(8, frame - overlap);
    const searchRadius = Math.max(8, Math.round(sampleRate * WSOLA_SEARCH_S));
    const maxOutputStart = Math.max(0, targetLength - frame);
    const maxInputStart = Math.max(0, sourceLength - frame);
    const outputs = channels.map(() => new Float32Array(targetLength));
    const referenceChannel = channels[0];
    const referenceOutput = outputs[0];
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      outputs[channelIndex].set(channels[channelIndex].subarray(0, frame), 0);
    }

    let previousOutputPos = 0;
    let outputPos = Math.min(synthesisHop, maxOutputStart);
    let finalInputEnd = frame;
    while (outputPos > previousOutputPos && outputPos <= maxOutputStart) {
      const isFinalFrame = outputPos === maxOutputStart;
      const progress = maxOutputStart > 0 ? outputPos / maxOutputStart : 1;
      const center = isFinalFrame
        ? maxInputStart
        : clamp(Math.round(progress * maxInputStart), 0, maxInputStart);
      const priorWrittenEnd = Math.min(targetLength, previousOutputPos + frame);
      const overlapLength = Math.max(0, Math.min(frame, priorWrittenEnd - outputPos, targetLength - outputPos));
      let bestInputPos = center;
      if (!isFinalFrame && overlapLength > 0) {
        const searchStart = Math.max(0, center - searchRadius);
        const searchEnd = Math.min(maxInputStart, center + searchRadius);
        let bestScore = -Infinity;
        for (let candidatePos = searchStart; candidatePos <= searchEnd; candidatePos += WSOLA_CORRELATION_STEP) {
          const score = correlation(referenceOutput, referenceChannel, outputPos, candidatePos, overlapLength);
          if (score > bestScore) { bestScore = score; bestInputPos = candidatePos; }
          if ((candidatePos - searchStart) % (WSOLA_CORRELATION_STEP * 16) === 0) yield; // Bound correlation-search slices, including on slower mobile CPUs.
        }
      }

      let usableForCoverage = 0;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        const input = channels[channelIndex];
        const output = outputs[channelIndex];
        const usable = Math.min(frame, input.length - bestInputPos, targetLength - outputPos);
        usableForCoverage = Math.max(usableForCoverage, usable);
        const crossfade = Math.min(overlapLength, usable);
        for (let index = 0; index < crossfade; index++) {
          const weight = smoothBlendWeight(index, crossfade);
          output[outputPos + index] = output[outputPos + index] * (1 - weight) + input[bestInputPos + index] * weight;
        }
        for (let index = crossfade; index < usable; index++) output[outputPos + index] = input[bestInputPos + index];
      }
      yield; // One grain is the cooperative scheduling unit for uncached charge renders.
      finalInputEnd = Math.max(finalInputEnd, bestInputPos + usableForCoverage);
      previousOutputPos = outputPos;
      if (isFinalFrame) break;
      outputPos = Math.min(maxOutputStart, outputPos + synthesisHop);
    }
    lastStretchCoverage = clamp(finalInputEnd / sourceLength, 0, 1);
    return outputs;
  }

  function wsolaStretch(channels, stretch, sampleRate) {
    const steps = wsolaStretchSteps(channels, stretch, sampleRate); // Existing animal rendering retains its synchronous API.
    let result = steps.next(); // Holds the generator's completed channel buffers.
    while (!result.done) result = steps.next();
    return result.value;
  }

  const chargeRenderStats = { cacheHits: 0, yields: 0, maxSliceMs: 0 }; // Mobile diagnostics for repeated render reuse and cooperative processing.

  let renderWorker = null; // One shared worker processes uncached voices without blocking combat or waiting on timer slices.
  let renderWorkerFailed = false; // Unsupported/CSP-blocked workers retain the cooperative fallback for this session.
  let nextRenderJobId = 0; // Correlates worker replies with concurrent voice requests.
  const renderJobs = new Map(); // Pending worker jobs retain only their completion callbacks.
  const workerRenderStats = { completed: 0, failures: 0, lastMs: 0 }; // Exposed in the existing mobile audio diagnostics.

  function disableRenderWorker(error) {
    renderWorkerFailed = true;
    workerRenderStats.failures++;
    renderWorker?.terminate();
    renderWorker = null;
    for (const job of renderJobs.values()) job.reject(error);
    renderJobs.clear();
  }

  function ensureRenderWorker() {
    if (renderWorker || renderWorkerFailed) return renderWorker;
    if (typeof Worker !== 'function' || typeof Blob !== 'function' || !URL.createObjectURL) return null;
    // Serialize the existing pure DSP functions so worker and fallback cannot drift.
    const code = `
      'use strict';
      const WSOLA_FRAME_S = ${WSOLA_FRAME_S}, WSOLA_OVERLAP_RATIO = ${WSOLA_OVERLAP_RATIO},
        WSOLA_SEARCH_S = ${WSOLA_SEARCH_S}, WSOLA_CORRELATION_STEP = ${WSOLA_CORRELATION_STEP},
        OUTPUT_EDGE_FADE_S = ${OUTPUT_EDGE_FADE_S}, OUTPUT_TAIL_PAD_S = ${OUTPUT_TAIL_PAD_S};
      let lastStretchSourceSamples = 0, lastStretchTargetSamples = 0, lastStretchCoverage = 1;
      ${[finite, clamp, smoothBlendWeight, cubicSample, correlation, wsolaStretchSteps, wsolaStretch, applyOutputEdgeEnvelope].map(fn => fn.toString()).join('\n')}
      self.onmessage = ({ data }) => {
        try {
          const started = performance.now();
          const stretched = wsolaStretch(data.channels, Math.pow(2, data.pitchSemitones / 12) / data.tempo, data.sampleRate);
          const channels = applyOutputEdgeEnvelope(stretched, data.sampleRate, data.opts);
          self.postMessage({ id: data.id, channels, elapsedMs: performance.now() - started,
            sourceSamples: lastStretchSourceSamples, targetSamples: lastStretchTargetSamples, coverage: lastStretchCoverage }, channels.map(channel => channel.buffer));
        } catch (error) {
          self.postMessage({ id: data.id, error: error.message || String(error) });
        }
      };
    `;
    let workerUrl = null; // Revoke the generated script URL after the worker has acquired it.
    try {
      workerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      renderWorker = new Worker(workerUrl);
      renderWorker.onmessage = ({ data }) => {
        const job = renderJobs.get(data.id); // Ignore replies for jobs already rejected by a worker failure.
        if (!job) return;
        renderJobs.delete(data.id);
        if (data.error) { job.reject(new Error(data.error)); return; }
        workerRenderStats.completed++;
        workerRenderStats.lastMs = Math.round(data.elapsedMs);
        lastStretchSourceSamples = data.sourceSamples;
        lastStretchTargetSamples = data.targetSamples;
        lastStretchCoverage = data.coverage;
        job.resolve(data.channels);
      };
      renderWorker.onerror = event => {
        event.preventDefault?.();
        disableRenderWorker(new Error(event.message || 'Voice render worker failed'));
      };
      renderWorker.onmessageerror = () => disableRenderWorker(new Error('Voice render worker message failed'));
    } catch (error) {
      disableRenderWorker(error);
    } finally {
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    }
    return renderWorker;
  }

  async function processConstantAxesOffThread(buffer, tempo, pitchSemitones, opts = {}) {
    const worker = ensureRenderWorker(); // Decode stays in WebAudio; only waveform processing moves to the worker.
    if (worker) {
      try {
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice()); // Transfer private copies; never detach cached decoded audio.
        return await new Promise((resolve, reject) => {
          const id = ++nextRenderJobId; // Stable completion identity even when multiple characters vocalize together.
          renderJobs.set(id, { resolve, reject });
          try {
            worker.postMessage({ id, channels, sampleRate: buffer.sampleRate, tempo, pitchSemitones,
              opts: { edgeFadeS: opts.edgeFadeS, tailPadS: opts.tailPadS } }, channels.map(channel => channel.buffer));
          } catch (error) {
            disableRenderWorker(error);
          }
        });
      } catch (_) { /* CSP/runtime failures preserve the yielding renderer below. */ }
    }
    return processConstantAxesCooperatively(buffer, tempo, pitchSemitones, opts);
  }

  async function processConstantAxesCooperatively(buffer, tempo, pitchSemitones, opts) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice()); // Private processing buffers.
    const pitchRatio = Math.pow(2, pitchSemitones / 12); // Matches the synchronous renderer's independent pitch math.
    const steps = wsolaStretchSteps(channels, pitchRatio / tempo, buffer.sampleRate); // Shares every DSP calculation with animal playback.
    let sliceStartedAt = performance.now(); // Measures CPU slices between task yields.
    let deadline = sliceStartedAt + 2; // Yield between grains once this task has used its short processing budget.
    let result = steps.next(); // Final value contains the stretched channels.
    while (!result.done) {
      if (performance.now() >= deadline) {
        chargeRenderStats.maxSliceMs = Math.max(chargeRenderStats.maxSliceMs, performance.now() - sliceStartedAt);
        chargeRenderStats.yields++;
        // scheduler.yield avoids nested timer clamping while still allowing input/render work.
        if (typeof window.scheduler?.yield === 'function') await window.scheduler.yield();
        else await new Promise(resolve => setTimeout(resolve, 0));
        sliceStartedAt = performance.now();
        deadline = sliceStartedAt + 2;
      }
      result = steps.next();
    }
    chargeRenderStats.maxSliceMs = Math.max(chargeRenderStats.maxSliceMs, performance.now() - sliceStartedAt);
    return applyOutputEdgeEnvelope(result.value, buffer.sampleRate, opts);
  }

  const decodedRenderCache = new Map(); // Bounded LRU of decoded charge renders, including in-flight work.
  const decodedRenderIds = new WeakMap(); // Stable buffer/context identity without retaining evicted sources.
  let nextDecodedRenderId = 1; // Allocates identity keys for the bounded cache.
  function decodedRenderId(value) {
    if (!decodedRenderIds.has(value)) decodedRenderIds.set(value, nextDecodedRenderId++);
    return decodedRenderIds.get(value);
  }

  function trimDecodedSilence(buffer, context, opts = {}) {
    if (!buffer || !context?.createBuffer || !(buffer.numberOfChannels > 0) || !(buffer.length > 0)) {
      return { buffer, sourceDurationS: Number(buffer?.duration) || 0, trimmedDurationS: Number(buffer?.duration) || 0, trimStartS: 0, trimEndS: 0, trimmed: false };
    }
    const absoluteFloor = Math.max(0, finite(opts.absoluteFloor, SILENCE_TRIM_ABSOLUTE_FLOOR));
    const relativeFloor = Math.max(0, finite(opts.relativeFloor, SILENCE_TRIM_RELATIVE_FLOOR));
    const padMs = clamp(finite(opts.padMs, SILENCE_TRIM_PAD_MS), 0, 40);
    const signature = `${absoluteFloor.toFixed(7)}|${relativeFloor.toFixed(7)}|${padMs.toFixed(3)}`;
    let byContext = silenceTrimCache.get(buffer);
    if (!byContext) { byContext = new WeakMap(); silenceTrimCache.set(buffer, byContext); }
    let bySettings = byContext.get(context);
    if (!bySettings) { bySettings = new Map(); byContext.set(context, bySettings); }
    if (bySettings.has(signature)) return bySettings.get(signature);

    const sourceLength = buffer.length;
    const sampleRate = Math.max(1, Number(buffer.sampleRate) || 44100);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channelIndex) => buffer.getChannelData(channelIndex));
    let peak = 0;
    for (const channel of channels) for (let i = 0; i < sourceLength; i++) peak = Math.max(peak, Math.abs(channel[i] || 0));
    const threshold = Math.max(absoluteFloor, peak * relativeFloor);
    let first = sourceLength;
    let last = -1;
    for (let i = 0; i < sourceLength; i++) {
      let audible = false;
      for (const channel of channels) {
        if (Math.abs(channel[i] || 0) >= threshold) { audible = true; break; }
      }
      if (!audible) continue;
      if (first === sourceLength) first = i;
      last = i;
    }
    if (last < first) {
      const silent = { buffer, sourceDurationS: buffer.duration, trimmedDurationS: buffer.duration, trimStartS: 0, trimEndS: 0, threshold, trimmed: false };
      bySettings.set(signature, silent);
      return silent;
    }
    const padSamples = Math.max(0, Math.round(sampleRate * padMs / 1000));
    first = Math.max(0, first - padSamples);
    last = Math.min(sourceLength - 1, last + padSamples);
    if (first === 0 && last === sourceLength - 1) {
      const unchanged = { buffer, sourceDurationS: buffer.duration, trimmedDurationS: buffer.duration, trimStartS: 0, trimEndS: 0, threshold, trimmed: false };
      bySettings.set(signature, unchanged);
      return unchanged;
    }
    const length = Math.max(1, last - first + 1);
    const trimmedBuffer = context.createBuffer(buffer.numberOfChannels, length, sampleRate);
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      trimmedBuffer.copyToChannel(channels[channelIndex].subarray(first, last + 1), channelIndex);
    }
    const result = {
      buffer: trimmedBuffer,
      sourceDurationS: buffer.duration,
      trimmedDurationS: trimmedBuffer.duration,
      trimStartS: first / sampleRate,
      trimEndS: Math.max(0, sourceLength - 1 - last) / sampleRate,
      threshold,
      trimmed: true,
    };
    bySettings.set(signature, result);
    return result;
  }

  function applyOutputEdgeEnvelope(channels, sampleRate, opts = {}) {
    const length = channels[0]?.length || 0;
    if (!length) return channels;
    const edgeFadeS = clamp(finite(opts.edgeFadeS, OUTPUT_EDGE_FADE_S), 0, 0.05);
    const tailPadS = clamp(finite(opts.tailPadS, OUTPUT_TAIL_PAD_S), 0, 0.1);
    const fadeSamples = edgeFadeS > 0
      ? Math.min(Math.max(1, Math.round(sampleRate * edgeFadeS)), Math.max(1, Math.floor(length / 4)))
      : 0;
    const padSamples = Math.max(0, Math.round(sampleRate * tailPadS));
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

  function processConstantAxes(buffer, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES, renderOpts = {}) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
    const pitchRatio = Math.pow(2, clampPitchFor(pitchSemitones, maxPitchSemitones) / 12); // Explicit pitch remains independent from tempo; only this final resample transposes it.
    const safeTempo = clampTempoFor(tempo, maxTempo);
    const stretched = wsolaStretch(channels, pitchRatio / safeTempo, buffer.sampleRate); // WSOLA changes wall-clock speed while compensating for the later pitch resample.
    return applyOutputEdgeEnvelope(stretched, buffer.sampleRate, renderOpts);
  }

  function renderCacheKey(url, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES) {
    return `${absoluteUrl(url)}|${clampTempoFor(tempo, maxTempo).toFixed(4)}|${clampPitchFor(pitchSemitones, maxPitchSemitones).toFixed(3)}`;
  }
  function pruneRenderCache() {
    while (renderedByKey.size > MAX_RENDER_CACHE) renderedByKey.delete(renderedByKey.keys().next().value);
  }
  function renderBufferFor(url, decoded, context, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES, renderOpts = {}) {
    const key = renderCacheKey(url, tempo, pitchSemitones, maxTempo, maxPitchSemitones);
    if (renderedByKey.has(key)) return renderedByKey.get(key);
    const pending = Promise.resolve().then(async () => {
      const clock = typeof performance !== 'undefined' && performance?.now ? performance : Date;
      const started = clock.now();
      const channels = await processConstantAxesOffThread(decoded, clampTempoFor(tempo, maxTempo), clampPitchFor(pitchSemitones, maxPitchSemitones), renderOpts);
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

  function renderDecodedIndependentBuffer(decoded, context, opts = {}) {
    if (!decoded || !context?.createBuffer) return Promise.reject(new Error('Pitch-preserving render requires a decoded AudioBuffer and AudioContext'));
    const tempo = clampTempoFor(opts.tempo ?? 1, Math.max(GENERIC_MAX_TEMPO, Number(opts.maxTempo) || 0)); // Callers mapping a clip onto a short authored span may allow more compression.
    const pitchSemitones = clampPitchFor(opts.pitchSemitones ?? 0, GENERIC_MAX_SHIFT_SEMITONES);
    const pitchRatio = Math.pow(2, pitchSemitones / 12);
    const trimSettings = opts.trimSilence && typeof opts.trimSilence === 'object' ? opts.trimSilence : {}; // Normalize only options that affect rendered samples.
    const key = [decodedRenderId(decoded), decodedRenderId(context), tempo, pitchSemitones,
      !!opts.trimSilence, trimSettings.padMs, trimSettings.absoluteFloor, trimSettings.relativeFloor,
      opts.edgeFadeS ?? OUTPUT_EDGE_FADE_S, opts.tailPadS ?? OUTPUT_TAIL_PAD_S].join('|'); // Exact rendering identity; different pitch/timing never shares a waveform.
    if (decodedRenderCache.has(key)) {
      chargeRenderStats.cacheHits++;
      const cached = decodedRenderCache.get(key); // Refresh LRU order on a cache hit.
      decodedRenderCache.delete(key);
      decodedRenderCache.set(key, cached);
      return cached;
    }
    const pending = Promise.resolve().then(async () => {
      const trimOpts = opts.trimSilence && typeof opts.trimSilence === 'object' ? opts.trimSilence : {};
      const trim = opts.trimSilence ? trimDecodedSilence(decoded, context, trimOpts) : {
        buffer: decoded, sourceDurationS: decoded.duration, trimmedDurationS: decoded.duration,
        trimStartS: 0, trimEndS: 0, trimmed: false,
      };
      const working = trim.buffer || decoded;
      const channels = await processConstantAxesOffThread(working, tempo, pitchSemitones, opts);
      const length = Math.max(1, channels[0]?.length || 1);
      const rendered = context.createBuffer(channels.length, length, working.sampleRate);
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) rendered.copyToChannel(channels[channelIndex], channelIndex);
      return {
        buffer: rendered,
        playbackRate: pitchRatio,
        durationS: rendered.duration / Math.max(0.0001, pitchRatio),
        sourceDurationS: working.duration,
        untrimmedSourceDurationS: decoded.duration,
        trimStartS: trim.trimStartS || 0,
        trimEndS: trim.trimEndS || 0,
        silenceTrimmed: !!trim.trimmed,
        tempo,
        pitchSemitones,
        independentPitch: true,
      };
    }).catch(error => {
      if (decodedRenderCache.get(key) === pending) decodedRenderCache.delete(key);
      throw error;
    });
    decodedRenderCache.set(key, pending);
    while (decodedRenderCache.size > MAX_RENDER_CACHE) decodedRenderCache.delete(decodedRenderCache.keys().next().value);
    return pending;
  }

  function scheduleProcessedBuffer(context, buffer, opts, onFinished) {
    const source = context.createBufferSource();
    const master = context.createGain();
    // Dry path only — the reverb send below taps `master` directly, same as
    // before, so panning the dry signal doesn't touch how directional the
    // echo itself sounds (a real distant jungle echo reads as diffuse, not
    // pinned to one side).
    const panner = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
    let spatialRoute = null; // True HRTF is selected only for positioned creature/NPC vocalizations, not the local player.
    const lowpassHz = Number(opts.lowpassHz); // Optional distance EQ for NPC combat voices; ordinary wildlife and player audio keep their current frequency response.
    const lowpass = Number.isFinite(lowpassHz) && lowpassHz < 18000 && typeof context.createBiquadFilter === 'function' ? context.createBiquadFilter() : null;
    if (lowpass) {
      lowpass.type = 'lowpass';
      lowpass.frequency.value = Math.max(600, lowpassHz);
    }
    const startAt = context.currentTime + 0.012;
    const pitchRatio = Math.pow(2, clampPitchFor(opts.pitchSemitones, opts.pitchMaxSemitones ?? MAX_SHIFT_SEMITONES) / 12); // Used by native BufferSource resampling so audible transposition avoids the custom cubic resampler.
    const effectiveDurationS = buffer.duration / pitchRatio; // Used for completion timing after playbackRate changes the stretched buffer's wall-clock duration.
    let stopped = false;
    let stopping = false; // A priority handoff may ramp this voice out for a few milliseconds before final cleanup.
    let finishTimer = null;
    let startTimer = null;
    let wet = null;
    source.buffer = buffer;
    source.playbackRate.value = pitchRatio;
    master.gain.value = clamp(finite(opts.volume, 0.7), 0, 1);
    source.connect(master);
    if (lowpass) master.connect(lowpass); // Dry direct path alone is rolled off; reflections still receive the original master signal.
    const dryOutput = lowpass || master;
    if (opts.position3d) spatialRoute = window.AudioSystem?.connectCombatSpatialDry?.(context, dryOutput, opts);
    if (!spatialRoute) {
      if (panner) {
        panner.pan.value = clamp(finite(opts.panX, 0), -1, 1);
        dryOutput.connect(panner);
        panner.connect(context.destination);
      } else {
        dryOutput.connect(context.destination);
      }
    }
    // extraWetBoost (see audio-system.js's creatureAudioSpatial) grows with
    // distance on top of the fixed baseline — "farther away sounds more
    // echoey," not just quieter.
    wet = window.EnvironmentalReverb?.connectWetNode?.(context, master, {
      volume: 1,
      extraWet: Math.max(0, finite(opts.extraWetBase, ANIMAL_EXTRA_WET)) + Math.max(0, finite(opts.extraWetBoost, 0)),
      area: opts.area || null,
    }) || null;
    function cleanup() {
      if (stopped) return;
      stopped = true;
      stopping = false;
      clearTimeout(finishTimer);
      clearTimeout(startTimer);
      try { source.disconnect(); } catch (_) {}
      try { master.disconnect(); } catch (_) {}
      try { panner?.disconnect(); } catch (_) {}
      try { spatialRoute?.dispose?.(); } catch (_) {}
      try { lowpass?.disconnect(); } catch (_) {}
      try { wet?.send?.disconnect?.(); } catch (_) {}
      onFinished?.();
    }
    function stop(fadeOutS = 0) {
      if (stopped || stopping) return;
      const fade = clamp(finite(fadeOutS, 0), 0, 0.08);
      if (!(fade > 0) || !master?.gain) {
        try { source.stop(); } catch (_) {}
        cleanup();
        return;
      }
      stopping = true;
      const at = context.currentTime;
      try {
        if (typeof master.gain.cancelAndHoldAtTime === 'function') master.gain.cancelAndHoldAtTime(at);
        else {
          master.gain.cancelScheduledValues?.(at);
          master.gain.setValueAtTime(Math.max(0.0001, Number(master.gain.value) || 0.0001), at);
        }
        master.gain.linearRampToValueAtTime(0.0001, at + fade);
        source.stop(at + fade + 0.001);
      } catch (_) {
        try { source.stop(); } catch (_) {}
        cleanup();
        return;
      }
      clearTimeout(finishTimer);
      finishTimer = setTimeout(cleanup, Math.max(1, Math.ceil((fade + 0.004) * 1000)));
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
      lastBackend = 'full-source WSOLA + native pitch resample';
      lastStartedAt = Date.now();
      opts.onStarted?.();
    }, Math.max(0, Math.round((startAt - context.currentTime) * 1000)));
    finishTimer = setTimeout(cleanup, Math.max(1, Math.ceil((effectiveDurationS + 0.04) * 1000)));
    return { stop, durationS: effectiveDurationS, independentPitch: true };
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
    const tempo = clampTempoFor(opts.tempo, opts.tempoMax ?? MAX_TEMPO);
    const pitch = clampPitchFor(opts.pitchSemitones, opts.pitchMaxSemitones ?? MAX_SHIFT_SEMITONES);
    const pitchRatio = Math.pow(2, pitch / 12);
    audio.volume = clamp(finite(opts.volume, 0.7), 0, 1);
    if (Math.abs(pitch) < 0.05) {
      setPitchPreservation(audio, true);
      audio.playbackRate = tempo;
    } else {
      // Emergency fallback only. The normal Web Audio path keeps speed/pitch
      // independent; browsers without it necessarily couple them here.
      setPitchPreservation(audio, false);
      audio.playbackRate = clamp(tempo * pitchRatio, MIN_TEMPO, 4);
    }
    let finished = false;
    let started = false;
    let fadeTimer = null; // Native fallback uses a tiny volume ramp when a higher-priority voice preempts it.
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
      if (fadeTimer) clearInterval(fadeTimer);
      fadeTimer = null;
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
      stop(fadeOutS = 0) {
        const fade = clamp(finite(fadeOutS, 0), 0, 0.08);
        if (!(fade > 0) || finished) {
          try { audio.pause(); audio.currentTime = 0; } catch (_) {}
          cleanup();
          return;
        }
        const startedAt = Date.now();
        const startVolume = Math.max(0, Number(audio.volume) || 0);
        if (fadeTimer) clearInterval(fadeTimer);
        fadeTimer = setInterval(() => {
          const t = Math.min(1, (Date.now() - startedAt) / Math.max(1, fade * 1000));
          try { audio.volume = startVolume * (1 - t); } catch (_) {}
          if (t < 1) return;
          clearInterval(fadeTimer);
          fadeTimer = null;
          try { audio.pause(); audio.currentTime = 0; } catch (_) {}
          cleanup();
        }, 2);
      },
    };
  }

  function playWithTempoLimit(url, opts = {}, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES) {
    if (!url || window.AudioSystem?.gameAudioConfig?.()?.enabled === false) return null;
    const resolved = absoluteUrl(url);
    const tempo = clampTempoFor(opts.tempo ?? 1, maxTempo);
    const pitchSemitones = clampPitchFor(opts.pitchSemitones ?? 0, maxPitchSemitones);
    const context = ensureContext();
    lastUrl = resolved;
    lastTempo = tempo;
    lastPitchSemitones = pitchSemitones;
    if (!context || context.state !== 'running') primeAudioContext();
    let stopped = false;
    let active = null;
    const handle = {
      independentPitch: true,
      stop(fadeOutS = 0) {
        if (stopped) return;
        stopped = true;
        active?.stop?.(fadeOutS);
        activeHandles.delete(handle);
      },
    };
    activeHandles.add(handle);
    const completed = () => { activeHandles.delete(handle); opts.onFinished?.(); }; // Shared cleanup for decoded buffers and native fallback.
    if (!context || context.state !== 'running') {
      active = playNativeFallback(resolved, { ...opts, tempo, tempoMax: maxTempo, pitchSemitones, pitchMaxSemitones: maxPitchSemitones, onFinished: completed }, opts.fallbackAudio || null);
      handle.independentPitch = active?.independentPitch ?? false; // Native fallback cannot preserve authored pitch independently of playback speed.
      return handle;
    }
    lastBackend = 'fixed render pending';
    decodeUrl(resolved, context)
      .then(decoded => {
        const trimOpts = opts.trimSilence && typeof opts.trimSilence === 'object' ? opts.trimSilence : {};
        const trim = opts.trimSilence ? trimDecodedSilence(decoded, context, trimOpts) : { buffer: decoded, trimStartS: 0, trimEndS: 0, trimmed: false };
        const renderUrl = `${resolved}#trim=${trim.trimmed ? `${Number(trim.trimStartS).toFixed(5)}-${Number(trim.trimEndS).toFixed(5)}` : 'raw'};pad=${Number(opts.tailPadS ?? OUTPUT_TAIL_PAD_S).toFixed(4)};fade=${Number(opts.edgeFadeS ?? OUTPUT_EDGE_FADE_S).toFixed(4)}`;
        return renderBufferFor(renderUrl, trim.buffer || decoded, context, tempo, pitchSemitones, maxTempo, maxPitchSemitones, opts);
      })
      .then(rendered => {
        if (stopped) return;
        active = scheduleProcessedBuffer(context, rendered, { ...opts, tempo, pitchSemitones, pitchMaxSemitones: maxPitchSemitones }, completed);
      })
      .catch(error => {
        if (stopped) return;
        lastPlaybackError = error;
        active = playNativeFallback(resolved, { ...opts, tempo, tempoMax: maxTempo, pitchSemitones, pitchMaxSemitones: maxPitchSemitones, onFinished: completed }, opts.fallbackAudio || null);
        handle.independentPitch = active?.independentPitch ?? false; // Decoding/render failure also downgrades the handle's reported pitch backend.
      });
    return handle;
  }

  function play(url, opts = {}) {
    return playWithTempoLimit(url, opts, MAX_TEMPO, MAX_SHIFT_SEMITONES);
  }

  function playIndependent(url, opts = {}) {
    return playWithTempoLimit(url, {
      ...opts,
      trimSilence: opts.trimSilence !== false,
      tailPadS: opts.tailPadS == null ? 0 : opts.tailPadS,
      extraWetBase: opts.extraWetBase == null ? 0 : opts.extraWetBase,
    }, GENERIC_MAX_TEMPO, GENERIC_MAX_SHIFT_SEMITONES);
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
      if (opts.meaning !== 'warning' && activeVoiceCount >= MAX_CONCURRENT_ANIMAL_VOICES) return false;
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
      // Even a creature too far away to be worth simulating in detail still
      // has a real tile position (den/nest/wherever it's currently
      // patrolling) — pan and extra echo are both derived straight from
      // that, so the call always originates from the right direction.
      const spatial = audioSystem.creatureAudioSpatial?.(c, opts) || { panX: 0, extraWetBoost: 0 }; // Carries optional fixed-emitter acoustic distance through the normal panning/reverb path.
      activeVoiceCount++;
      let completed = false; // Used to forward exactly one terminal callback even when an error path also triggers renderer cleanup.
      const complete = (error = null) => {
        if (completed) return;
        completed = true;
        opts.signal?.removeEventListener?.('abort', cancelPlayback);
        activeVoiceCount = Math.max(0, activeVoiceCount - 1);
        if (error) opts.onError?.(error);
        else opts.onFinished?.();
      };
      const cancelPlayback = () => { handle?.stop?.(); complete(); }; // Used by authored ambient voices to end immediately when dialogue begins.
      let handle = null; // Kept only while this voice owns its independent playback, for cancellation.
      opts.signal?.addEventListener?.('abort', cancelPlayback, { once: true });
      handle = play(url, {
        tempo,
        pitchSemitones,
        volume: clamp(finite(capture.audio.volume, opts.volume ?? 0.7), 0, 1),
        area: c?.areaId || null,
        panX: spatial.panX,
        position3d: spatial.position3d, // Wildlife warning/growl calls share front-back/vertical positioning with combat strikes.
        sourceActor: spatial.sourceActor, // A moving animal remains in the correct ear until its call ends.
        extraWetBoost: spatial.extraWetBoost,
        onStarted: opts.onStarted,
        onError: error => complete(error),
        onFinished: () => complete(),
        fallbackAudio: capture.audio,
      });
      if (opts.signal?.aborted) cancelPlayback();
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
      chargeRendering: { ...chargeRenderStats, cachedVariants: decodedRenderCache.size, worker: { ...workerRenderStats, available: !!renderWorker, failed: renderWorkerFailed, pending: renderJobs.size }, latestChange: 'Uncached voices render in one worker without combat-frame blocking or timer-clamped startup; yielding fallback retained.' },
      lastTempo,
      lastPitchSemitones,
      lastClipTempo,
      lastClipPitchSemitones,
      lastUtteranceTempo,
      lastUtterancePitchSemitones,
      lastSizePitchSemitones,
      lastStretchSourceSamples,
      lastStretchTargetSamples,
      lastStretchCoverage,
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
    playIndependent,
    renderDecodedIndependentBuffer,
    trimDecodedSilence,
    preview,
    stopAllPreviews,
    stopAll() { for (const handle of [...activeHandles]) handle.stop(); },
    primeAudioContext,
    readyForIndependentPitch,
    clampPitch,
    clampTempo,
    clipKey,
    normalizeLibraryName,
    utteranceUrl,
    installAudioSystemAdapter,
    debugSnapshot,
    isInstalled: () => adapterInstalled,
  };

  // Construct the one shared AudioContext during module setup instead of on
  // the player's first pointerdown. Browsers keep it suspended until the
  // trusted gesture; the gesture handler then only resumes it and avoids a
  // large synchronous AudioContext-construction hitch on input.
  ensureContext();
  installGestureUnlock();
  requestSimpleEditor();
  // window.AudioSystem is assigned exactly once at its own module's load
  // (see audio-system.js) and installAudioSystemAdapter is idempotent once
  // wrapped, so this only ever needs to keep trying until that one
  // assignment has happened -- via the shared SceneReadyPoller (see its own
  // header comment) rather than a bare forever-interval.
  if (window.SceneReadyPoller) window.SceneReadyPoller.pollUntilReady(installAudioSystemAdapter, Infinity, 250);
  else installAudioSystemAdapter();
})();
