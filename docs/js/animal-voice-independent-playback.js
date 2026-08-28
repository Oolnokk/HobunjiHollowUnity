(() => {
  'use strict';

  // Adapter around AudioSystem's existing animal-voice renderer. AudioSystem
  // still owns species clip selection, preload reuse, range rejection, and
  // distance/SFX-volume mixing. This module intercepts only the prepared
  // <audio> element at the final play() call, then renders that same element
  // through an independent tempo + pitch stage. That keeps semantic scheduling,
  // low-level audio selection/mixing, and pitch processing independently replaceable.

  const MAX_SHIFT_SEMITONES = 12; // Used by clampPitch so the short-delay shifter stays inside its stable/usable range.
  const PITCH_EPSILON_SEMITONES = 0.08; // Used by setPitchSemitones to bypass imperceptibly small shifts and avoid needless processing.
  const PITCH_DELAY_S = 0.03; // Used by each modulated DelayNode; 30 ms is short enough for animal calls while allowing a useful ±12 st range.
  const CONTOUR_SEGMENT_MS = 260; // Used by runtime/editor contour playback when an authored segment duration is absent.
  const CONTROL_BUFFER_SECONDS = 1; // Used by createControlBuffers so control-source playbackRate directly equals cycles per second.
  const controlBuffersByContext = new WeakMap(); // Used by createPitchDirection to reuse the same ramp/window control buffers for every utterance in one AudioContext.
  const previewHandles = new Set(); // Used by stopAllPreviews so the authoring tool can stop every in-flight audition cleanly.
  let sharedContext = null; // Used by ensureContext so all short animal utterances share one Web Audio graph/context instead of creating one per sound.
  let installed = false; // Used by installAudioSystemAdapter/isInstalled to prevent wrapping AudioSystem more than once.

  function finite(value, fallback) {
    const number = Number(value); // Used below as the normalized finite numeric candidate.
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clampPitch(semitones) {
    return clamp(finite(semitones, 0), -MAX_SHIFT_SEMITONES, MAX_SHIFT_SEMITONES);
  }

  function clampTempo(tempo) {
    return clamp(finite(tempo, 1), 0.35, 2);
  }

  function setPitchPreservation(audio, enabled) {
    try { audio.preservesPitch = enabled; } catch (_) {}
    try { audio.mozPreservesPitch = enabled; } catch (_) {}
    try { audio.webkitPreservesPitch = enabled; } catch (_) {}
  }

  function ensureContext() {
    if (sharedContext && sharedContext.state !== 'closed') return sharedContext;
    const AudioCtx = window.AudioContext || window.webkitAudioContext; // Used here to feature-detect the native Web Audio backend.
    if (!AudioCtx) return null;
    try {
      sharedContext = new AudioCtx();
      return sharedContext;
    } catch (_) {
      return null;
    }
  }

  function createControlBuffers(context) {
    const cached = controlBuffersByContext.get(context); // Used to avoid rebuilding one-second modulation tables for every vocalization.
    if (cached) return cached;
    const length = Math.max(128, Math.round(context.sampleRate * CONTROL_BUFFER_SECONDS)); // Used as the shared sample count for the ramp and Hann-window buffers.
    const ascending = context.createBuffer(1, length, context.sampleRate); // Used by the pitch-down delay lines: delay increases linearly through each grain cycle.
    const descending = context.createBuffer(1, length, context.sampleRate); // Used by the pitch-up delay lines: delay decreases linearly through each grain cycle.
    const windowBuffer = context.createBuffer(1, length, context.sampleRate); // Used to crossfade the two half-cycle-offset delay lines without audible sawtooth resets.
    const upData = ascending.getChannelData(0); // Filled below with a 0→1 ramp for increasing delay.
    const downData = descending.getChannelData(0); // Filled below with a 1→0 ramp for decreasing delay.
    const windowData = windowBuffer.getChannelData(0); // Filled below with a Hann window whose half-cycle pair sums to a constant gain.
    for (let index = 0; index < length; index++) {
      const phase = index / Math.max(1, length - 1); // Used to build all three periodic control shapes from the same normalized position.
      upData[index] = phase;
      downData[index] = 1 - phase;
      windowData[index] = 0.5 - 0.5 * Math.cos(Math.PI * 2 * phase);
    }
    const buffers = { ascending, descending, window: windowBuffer }; // Cached and reused by every direction graph in this AudioContext.
    controlBuffersByContext.set(context, buffers);
    return buffers;
  }

  function createPitchDirection(context, input, output, direction, startAt) {
    const buffers = createControlBuffers(context); // Used by both delay lines as loopable audio-rate modulation sources.
    const directionGain = context.createGain(); // Used by setPitchSemitones to select this up/down direction without rebuilding the graph.
    directionGain.gain.value = 0;
    directionGain.connect(output);
    const controls = []; // Used by setCycleSeconds/stop to update and dispose every looped modulation source together.
    const nodes = [directionGain]; // Used by stop to disconnect the short-lived processing graph after the utterance ends.
    const rampBuffer = direction === 'up' ? buffers.descending : buffers.ascending; // Decreasing delay pitches up; increasing delay pitches down.

    for (const phaseOffset of [0, 0.5]) {
      const delay = context.createDelay(PITCH_DELAY_S + 0.01); // Used as one of the two alternating variable-delay grains.
      const lineGain = context.createGain(); // Used by the Hann control source to mute this line at its delay-ramp reset seam.
      const rampSource = context.createBufferSource(); // Used to loop the rising/falling delay ramp at audio rate.
      const rampDepth = context.createGain(); // Used to scale the normalized 0..1 ramp into 0..PITCH_DELAY_S seconds.
      const windowSource = context.createBufferSource(); // Used to loop the Hann crossfade envelope in phase with this line's ramp.
      delay.delayTime.value = 0;
      lineGain.gain.value = 0;
      rampSource.buffer = rampBuffer;
      rampSource.loop = true;
      rampDepth.gain.value = PITCH_DELAY_S;
      windowSource.buffer = buffers.window;
      windowSource.loop = true;
      input.connect(delay);
      delay.connect(lineGain);
      lineGain.connect(directionGain);
      rampSource.connect(rampDepth);
      rampDepth.connect(delay.delayTime);
      windowSource.connect(lineGain.gain);
      const offsetSeconds = phaseOffset * rampBuffer.duration; // Used to keep the second grain exactly half a modulation cycle out of phase.
      rampSource.start(startAt, offsetSeconds);
      windowSource.start(startAt, offsetSeconds);
      controls.push(rampSource, windowSource);
      nodes.push(delay, lineGain, rampSource, rampDepth, windowSource);
    }

    function setCycleSeconds(cycleSeconds, when) {
      const safeCycle = clamp(finite(cycleSeconds, 0.12), 0.012, 3); // Used to bound modulation frequency across the supported semitone range.
      const controlRate = CONTROL_BUFFER_SECONDS / safeCycle; // Applied equally to ramps/windows so their phase relationship never drifts.
      for (const control of controls) {
        control.playbackRate.cancelScheduledValues(when);
        control.playbackRate.setTargetAtTime(controlRate, when, 0.006);
      }
    }

    function stop() {
      for (const control of controls) {
        try { control.stop(); } catch (_) {}
      }
      for (const node of nodes) {
        try { node.disconnect(); } catch (_) {}
      }
    }

    return { gain: directionGain.gain, setCycleSeconds, stop };
  }

  function createPitchShifter(context, source, output, initialSemitones = 0) {
    const startAt = context.currentTime; // Used as the common phase origin for bypass/up/down paths.
    const bypassGain = context.createGain(); // Used when pitch is neutral so the signal avoids variable-delay coloration entirely.
    const up = createPitchDirection(context, source, output, 'up', startAt); // Used for positive-semitone shifts.
    const down = createPitchDirection(context, source, output, 'down', startAt); // Used for negative-semitone shifts.
    bypassGain.gain.value = 1;
    source.connect(bypassGain);
    bypassGain.connect(output);

    function setGain(param, value, when) {
      param.cancelScheduledValues(when);
      param.setTargetAtTime(value, when, 0.008);
    }

    function setPitchSemitones(semitones, when = context.currentTime) {
      const shift = clampPitch(semitones); // Used to choose bypass/up/down and derive the exact variable-delay cycle rate.
      if (Math.abs(shift) <= PITCH_EPSILON_SEMITONES) {
        setGain(bypassGain.gain, 1, when);
        setGain(up.gain, 0, when);
        setGain(down.gain, 0, when);
        return 0;
      }
      const ratio = Math.pow(2, shift / 12); // Converts authored semitones into the target frequency ratio for the delay-slope equation.
      if (shift > 0) {
        const cycleSeconds = PITCH_DELAY_S / Math.max(0.001, ratio - 1); // A decreasing delay slope of -(ratio-1) raises pitch without changing media tempo.
        up.setCycleSeconds(cycleSeconds, when);
        setGain(bypassGain.gain, 0, when);
        setGain(up.gain, 1, when);
        setGain(down.gain, 0, when);
      } else {
        const cycleSeconds = PITCH_DELAY_S / Math.max(0.001, 1 - ratio); // An increasing delay slope of +(1-ratio) lowers pitch without changing media tempo.
        down.setCycleSeconds(cycleSeconds, when);
        setGain(bypassGain.gain, 0, when);
        setGain(up.gain, 0, when);
        setGain(down.gain, 1, when);
      }
      return shift;
    }

    function stop() {
      try { source.disconnect(bypassGain); } catch (_) {}
      try { bypassGain.disconnect(); } catch (_) {}
      up.stop();
      down.stop();
    }

    setPitchSemitones(initialSemitones, startAt);
    return { setPitchSemitones, stop };
  }

  function playPreparedElement(audio, opts = {}, nativePlay = null) {
    const tempo = clampTempo(opts.tempo ?? opts.rate ?? 1); // Applied only to HTMLMediaElement playbackRate with pitch preservation enabled.
    const pitchSemitones = clampPitch(opts.pitchSemitones ?? 0); // Applied only to the Web Audio pitch shifter, independent of media tempo.
    const tempoContour = Array.isArray(opts.tempoContour) ? opts.tempoContour.map(clampTempo) : null; // Used after audible start for independent within-call tempo changes.
    const pitchContour = Array.isArray(opts.pitchContourSemitones) ? opts.pitchContourSemitones.map(clampPitch) : null; // Used after audible start for independent within-call pitch changes.
    const contourSegmentMs = Math.max(40, finite(opts.contourSegmentMs, CONTOUR_SEGMENT_MS)); // Used by both contour axes so their authored stages stay synchronized.
    const context = ensureContext(); // Used for independent pitch processing when Web Audio is available.
    const timers = []; // Used by stop/cleanup to cancel scheduled JS contour transitions.
    let shifter = null; // Created below only when a MediaElementSource can be routed through Web Audio successfully.
    let source = null; // Used by cleanup to disconnect the MediaElementSource created for this one utterance.
    let output = null; // Used by cleanup to disconnect this utterance's final gain node.
    let stopped = false; // Used by notifyStarted/cleanup so late events cannot restart state after an explicit stop.
    let startNotified = false; // Used by playing + play-promise resolution so nod/text synchronization still fires exactly once.

    setPitchPreservation(audio, true);
    audio.playbackRate = tempo;

    if (context) {
      try {
        if (context.state === 'suspended') context.resume().catch(() => {});
        source = context.createMediaElementSource(audio);
        output = context.createGain();
        output.gain.value = 1;
        output.connect(context.destination);
        shifter = createPitchShifter(context, source, output, pitchSemitones);
      } catch (_) {
        shifter = null;
        source = null;
        output = null;
      }
    }

    // If Web Audio is unavailable, keep the sound audible rather than failing.
    // This fallback necessarily re-couples pitch/speed because basic <audio>
    // cannot shift pitch independently; supported browsers use the graph above.
    if (!shifter && Math.abs(pitchSemitones) > PITCH_EPSILON_SEMITONES) {
      setPitchPreservation(audio, false);
      audio.playbackRate = clampTempo(tempo * Math.pow(2, pitchSemitones / 12));
    }

    function applyContourStage(index) {
      if (stopped) return;
      if (tempoContour?.[index] != null) {
        if (shifter) {
          setPitchPreservation(audio, true);
          audio.playbackRate = tempoContour[index];
        } else {
          const stagePitch = pitchContour?.[index] ?? pitchSemitones; // Used by the no-Web-Audio fallback to preserve both authored dimensions as closely as possible.
          setPitchPreservation(audio, Math.abs(stagePitch) <= PITCH_EPSILON_SEMITONES);
          audio.playbackRate = Math.abs(stagePitch) <= PITCH_EPSILON_SEMITONES
            ? tempoContour[index]
            : clampTempo(tempoContour[index] * Math.pow(2, stagePitch / 12));
        }
      }
      if (shifter && pitchContour?.[index] != null) shifter.setPitchSemitones(pitchContour[index]);
    }

    function scheduleContours() {
      const stageCount = Math.max(tempoContour?.length || 0, pitchContour?.length || 0); // Used to schedule whichever independent contour has the most authored stages.
      if (stageCount <= 0) return;
      applyContourStage(0);
      for (let index = 1; index < stageCount; index++) {
        const timer = setTimeout(() => applyContourStage(index), contourSegmentMs * index); // Used by cleanup to cancel this stage if playback stops early.
        timers.push(timer);
      }
    }

    function notifyStarted() {
      if (startNotified || stopped) return;
      startNotified = true;
      scheduleContours();
      opts.onStarted?.();
    }

    function cleanup() {
      if (stopped) return;
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      shifter?.stop();
      try { source?.disconnect(); } catch (_) {}
      try { output?.disconnect(); } catch (_) {}
      previewHandles.delete(handle);
    }

    function stop() {
      try { audio.pause(); } catch (_) {}
      try { audio.currentTime = 0; } catch (_) {}
      cleanup();
    }

    const handle = { audio, stop, setPitchSemitones: value => shifter?.setPitchSemitones(value), setTempo: value => { audio.playbackRate = clampTempo(value); } }; // Returned to the editor so previews can be stopped/re-tuned without touching runtime scheduler state.
    audio.addEventListener?.('playing', notifyStarted, { once: true });
    audio.addEventListener?.('ended', cleanup, { once: true });
    const playResult = nativePlay ? nativePlay.call(audio) : audio.play(); // Uses the unpatched native method when invoked from the AudioSystem interception path.
    if (playResult?.then) playResult.then(notifyStarted).catch(() => cleanup());
    return handle;
  }

  function capturePreparedAnimalElement(originalRenderer, creature, opts) {
    const mediaProto = window.HTMLMediaElement?.prototype; // Temporarily patched only during the synchronous AudioSystem call to capture its fully prepared animal <audio> element.
    if (!mediaProto?.play) return { accepted: false, audio: null, nativePlay: null };
    const nativePlay = mediaProto.play; // Restored immediately after AudioSystem finishes selecting/mixing the utterance.
    const blockedResult = { then() { return { catch() {} }; } }; // Returned to AudioSystem so its own start callback never fires before the captured element is actually played below.
    let captured = null; // Filled by the first play() call made synchronously inside playAnimalVoiceUtterance.
    mediaProto.play = function captureAnimalVoicePlay() {
      if (!captured) captured = this;
      if (this === captured) return blockedResult;
      return nativePlay.call(this);
    };
    let accepted = false; // Used to preserve AudioSystem's existing false result for muted/out-of-range/unsupported calls.
    try {
      const legacyOpts = { ...opts, rate: 1, rateContour: undefined, onStarted: undefined }; // Lets AudioSystem do selection/falloff only; independent tempo/pitch are applied after capture.
      accepted = !!originalRenderer(creature, legacyOpts);
    } finally {
      mediaProto.play = nativePlay;
    }
    return { accepted, audio: captured, nativePlay };
  }

  function installAudioSystemAdapter() {
    const audioSystem = window.AudioSystem; // Wrapped in-place so game.js keeps using its existing injected AudioSystem method without any coupling changes.
    if (!audioSystem?.playAnimalVoiceUtterance || audioSystem.__independentAnimalVoiceWrapped) return false;
    const originalRenderer = audioSystem.playAnimalVoiceUtterance.bind(audioSystem); // Retained as the authoritative clip-selection/range/volume implementation.
    audioSystem.playAnimalVoiceUtterance = function independentAnimalVoiceUtterance(creature, opts = {}) {
      const capture = capturePreparedAnimalElement(originalRenderer, creature, opts); // Obtains the exact preloaded/volume-mixed element AudioSystem would otherwise play itself.
      if (!capture.accepted) return false;
      if (!capture.audio) return originalRenderer(creature, opts); // Defensive fallback if a future AudioSystem renderer stops using HTMLMediaElement.play synchronously.
      playPreparedElement(capture.audio, opts, capture.nativePlay);
      return true;
    };
    audioSystem.__independentAnimalVoiceWrapped = true;
    installed = true;
    return true;
  }

  function preview(url, opts = {}) {
    if (typeof Audio !== 'function' || !url) return null;
    const audio = new Audio(url); // Used only by the standalone authoring preview; runtime clip selection remains owned by AudioSystem.
    audio.preload = 'auto';
    audio.volume = clamp(finite(opts.volume, 0.7), 0, 1);
    const handle = playPreparedElement(audio, opts); // Stored so changing species/mode in the editor can stop every active preview cleanly.
    previewHandles.add(handle);
    return handle;
  }

  function stopAllPreviews() {
    for (const handle of [...previewHandles]) handle.stop();
    previewHandles.clear();
  }

  window.AnimalVoiceIndependentPlayback = {
    installAudioSystemAdapter,
    preview,
    stopAllPreviews,
    clampPitch,
    clampTempo,
    isInstalled: () => installed,
  };

  installAudioSystemAdapter();
})();
