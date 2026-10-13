from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    assert count == 1, f"{path}: expected exactly one literal match, found {count}"
    p.write_text(text.replace(old, new, 1))


def replace_regex_once(path, pattern, replacement):
    p = Path(path)
    text = p.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    assert count == 1, f"{path}: expected exactly one regex match, found {count}: {pattern}"
    p.write_text(updated)


animal = Path('docs/js/animal-voice-independent-playback.js')
text = animal.read_text()
assert 'const OUTPUT_TAIL_PAD_S = 0.018;' in text
text = text.replace(
    '  const OUTPUT_TAIL_PAD_S = 0.018;\n',
    '  const OUTPUT_TAIL_PAD_S = 0.018;\n'
    '  const SILENCE_TRIM_ABSOLUTE_FLOOR = 0.0005; // Keeps codec noise/dead air out of vocal timing without shaving quiet breath consonants.\n'
    '  const SILENCE_TRIM_RELATIVE_FLOOR = 0.002; // -54 dB relative to each decoded clip peak; intentionally conservative for breath tails.\n'
    '  const SILENCE_TRIM_PAD_MS = 4; // Retains a tiny acoustic margin around the first/last real waveform sample.\n',
    1,
)
assert '  const renderedByKey = new Map();\n' in text
text = text.replace(
    '  const renderedByKey = new Map();\n',
    '  const renderedByKey = new Map();\n'
    '  const silenceTrimCache = new WeakMap(); // Decoded AudioBuffer -> WeakMap(AudioContext -> Map(settings -> trimmed result)); repeated breathing never rescans the same clip.\n',
    1,
)
animal.write_text(text)

replace_regex_once(
    'docs/js/animal-voice-independent-playback.js',
    r"  function applyOutputEdgeEnvelope\(channels, sampleRate\) \{.*?\n  \}\n\n  function processConstantAxes\(buffer, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES\) \{.*?\n  \}",
    r'''  function trimDecodedSilence(buffer, context, opts = {}) {
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
  }'''
)

replace_once(
    'docs/js/animal-voice-independent-playback.js',
    '  function renderBufferFor(url, decoded, context, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES) {\n'
    '    const key = renderCacheKey(url, tempo, pitchSemitones, maxTempo, maxPitchSemitones);',
    '  function renderBufferFor(url, decoded, context, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES, renderOpts = {}) {\n'
    '    const key = renderCacheKey(url, tempo, pitchSemitones, maxTempo, maxPitchSemitones);'
)
replace_once(
    'docs/js/animal-voice-independent-playback.js',
    '      const channels = processConstantAxes(decoded, tempo, pitchSemitones, maxTempo, maxPitchSemitones);',
    '      const channels = processConstantAxes(decoded, tempo, pitchSemitones, maxTempo, maxPitchSemitones, renderOpts);'
)

replace_regex_once(
    'docs/js/animal-voice-independent-playback.js',
    r"  function renderDecodedIndependentBuffer\(decoded, context, opts = \{\}\) \{.*?\n  \}\n\n  function scheduleProcessedBuffer",
    r'''  function renderDecodedIndependentBuffer(decoded, context, opts = {}) {
    if (!decoded || !context?.createBuffer) return Promise.reject(new Error('Pitch-preserving render requires a decoded AudioBuffer and AudioContext'));
    const tempo = clampTempoFor(opts.tempo ?? 1, GENERIC_MAX_TEMPO);
    const pitchSemitones = clampPitchFor(opts.pitchSemitones ?? 0, GENERIC_MAX_SHIFT_SEMITONES);
    const pitchRatio = Math.pow(2, pitchSemitones / 12);
    return Promise.resolve().then(() => {
      const trimOpts = opts.trimSilence && typeof opts.trimSilence === 'object' ? opts.trimSilence : {};
      const trim = opts.trimSilence ? trimDecodedSilence(decoded, context, trimOpts) : {
        buffer: decoded, sourceDurationS: decoded.duration, trimmedDurationS: decoded.duration,
        trimStartS: 0, trimEndS: 0, trimmed: false,
      };
      const working = trim.buffer || decoded;
      const channels = processConstantAxes(working, tempo, pitchSemitones, GENERIC_MAX_TEMPO, GENERIC_MAX_SHIFT_SEMITONES, opts);
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
    });
  }

  function scheduleProcessedBuffer'''
)

replace_once(
    'docs/js/animal-voice-independent-playback.js',
    '      extraWet: ANIMAL_EXTRA_WET + Math.max(0, finite(opts.extraWetBoost, 0)),',
    '      extraWet: Math.max(0, finite(opts.extraWetBase, ANIMAL_EXTRA_WET)) + Math.max(0, finite(opts.extraWetBoost, 0)),'
)

replace_once(
    'docs/js/animal-voice-independent-playback.js',
    "    decodeUrl(resolved, context)\n      .then(decoded => renderBufferFor(resolved, decoded, context, tempo, pitchSemitones, maxTempo, maxPitchSemitones))",
    "    decodeUrl(resolved, context)\n      .then(decoded => {\n        const trimOpts = opts.trimSilence && typeof opts.trimSilence === 'object' ? opts.trimSilence : {};\n        const trim = opts.trimSilence ? trimDecodedSilence(decoded, context, trimOpts) : { buffer: decoded, trimStartS: 0, trimEndS: 0, trimmed: false };\n        const renderUrl = `${resolved}#trim=${trim.trimmed ? `${Number(trim.trimStartS).toFixed(5)}-${Number(trim.trimEndS).toFixed(5)}` : 'raw'};pad=${Number(opts.tailPadS ?? OUTPUT_TAIL_PAD_S).toFixed(4)};fade=${Number(opts.edgeFadeS ?? OUTPUT_EDGE_FADE_S).toFixed(4)}`;\n        return renderBufferFor(renderUrl, trim.buffer || decoded, context, tempo, pitchSemitones, maxTempo, maxPitchSemitones, opts);\n      })"
)

replace_once(
    'docs/js/animal-voice-independent-playback.js',
    "  function playIndependent(url, opts = {}) {\n    return playWithTempoLimit(url, opts, GENERIC_MAX_TEMPO, GENERIC_MAX_SHIFT_SEMITONES);\n  }",
    "  function playIndependent(url, opts = {}) {\n    return playWithTempoLimit(url, {\n      ...opts,\n      trimSilence: opts.trimSilence !== false,\n      tailPadS: opts.tailPadS == null ? 0 : opts.tailPadS,\n      extraWetBase: opts.extraWetBase == null ? 0 : opts.extraWetBase,\n    }, GENERIC_MAX_TEMPO, GENERIC_MAX_SHIFT_SEMITONES);\n  }"
)

replace_once(
    'docs/js/animal-voice-independent-playback.js',
    '    renderDecodedIndependentBuffer,\n',
    '    renderDecodedIndependentBuffer,\n    trimDecodedSilence,\n'
)

combat = Path('docs/js/combat/combat-vocalizations.js')
c = combat.read_text()
old_renderer_opts = """        snd = renderer(url, {
tempo: plan.tempo,
pitchSemitones: plan.pitchSemitones,
volume,
        });"""
assert c.count(old_renderer_opts) == 1
c = c.replace(old_renderer_opts, """        snd = renderer(url, {
          tempo: plan.tempo,
          pitchSemitones: plan.pitchSemitones,
          volume,
          trimSilence: true,
          tailPadS: 0,
          extraWetBase: 0, // Combat voices use the area's physical reverb profile without the animal-call extra-wet boost.
        });""", 1)
old_first_breath = """    if (!(nextBreathAtMs > 0)) {
      nextBreathAtMs = atMs + intervalS * 1000;
      lastBreathIntervalS = intervalS;
      return;
    }"""
assert c.count(old_first_breath) == 1
c = c.replace(old_first_breath, """    if (!(nextBreathAtMs > 0)) {
      playBreath(p, atMs); // Crossing below max stamina begins the ongoing breathing loop immediately instead of waiting through one silent interval.
      const nextInterval = breathIntervalS(p);
      lastBreathIntervalS = nextInterval;
      nextBreathAtMs = atMs + nextInterval * 1000;
      return;
    }""", 1)
old_charge_gain = """    gain.connect(ctx.destination);
    return gain;"""
assert c.count(old_charge_gain) == 1
c = c.replace(old_charge_gain, """    gain.connect(ctx.destination);
    gain.__combatVocalWet = window.EnvironmentalReverb?.connectWetNode?.(ctx, gain, { volume: 1 }) || null; // Charge grunts use the same room/cavern/temple acoustic space as ordinary world SFX.
    return gain;""", 1)
old_finish = """  try { token.output?.disconnect?.(); } catch (_) {}
}"""
assert c.count(old_finish) == 1
c = c.replace(old_finish, """  try { token.output?.__combatVocalWet?.send?.disconnect?.(); } catch (_) {}
  try { token.output?.disconnect?.(); } catch (_) {}
}""", 1)
anchor = """    const voice = voicePlaybackPlan(randomPitchSemitones(config.grunts?.pitchRandomSemitones ?? 0));
    const plan = chargeRatePlan(buffer.duration, token.targetDurationS, voice.tempo);
    const renderOpts = { pitchSemitones: voice.pitchSemitones };"""
assert c.count(anchor) == 1
c = c.replace(anchor, """    const trimDecoded = window.AnimalVoiceIndependentPlayback?.trimDecodedSilence;
    const trim = trimDecoded ? trimDecoded(buffer, ctx, { padMs: 4 }) : {
      buffer, sourceDurationS: buffer.duration, trimmedDurationS: buffer.duration, trimStartS: 0, trimEndS: 0, trimmed: false,
    };
    const audibleBuffer = trim.buffer || buffer; // Charge math uses actual audible waveform duration, not leading/trailing silence or codec padding.
    const voice = voicePlaybackPlan(randomPitchSemitones(config.grunts?.pitchRandomSemitones ?? 0));
    const plan = chargeRatePlan(audibleBuffer.duration, token.targetDurationS, voice.tempo);
    const renderOpts = { pitchSemitones: voice.pitchSemitones, tailPadS: 0, trimSilence: false };""", 1)
c = c.replace('      renderIndependent(buffer, ctx, { ...renderOpts, tempo: plan.stretchedTempo }),', '      renderIndependent(audibleBuffer, ctx, { ...renderOpts, tempo: plan.stretchedTempo }),', 1)
c = c.replace('        ? renderIndependent(buffer, ctx, { ...renderOpts, tempo: plan.catchUpTempo })', '        ? renderIndependent(audibleBuffer, ctx, { ...renderOpts, tempo: plan.catchUpTempo })', 1)
assert c.count('    token.buffer = buffer;') == 1
c = c.replace('    token.buffer = buffer;', '    token.rawBuffer = buffer;\n    token.buffer = audibleBuffer;\n    token.trim = trim;', 1)
assert c.count('      bufferDurationS: buffer.duration,') == 1
c = c.replace('      bufferDurationS: buffer.duration,', '      rawBufferDurationS: buffer.duration,\n      bufferDurationS: audibleBuffer.duration,\n      trimmedLeadingSilenceS: trim.trimStartS || 0,\n      trimmedTrailingSilenceS: trim.trimEndS || 0,', 1)
combat.write_text(c)

editor = Path('docs/tools/combat-vocalization-editor/index.html')
e = editor.read_text()
assert 'let cfg=null,chargeBuffer=null,ctx=null,currentPreview=null,waveformPeaks=null' in e
e = e.replace('let cfg=null,chargeBuffer=null,ctx=null,currentPreview=null,waveformPeaks=null', 'let cfg=null,chargeBuffer=null,chargeTrimInfo=null,ctx=null,currentPreview=null,waveformPeaks=null', 1)
old_status = "function renderChargeStatus(){if(!chargeBuffer)return;const p=chargeTempoPlan(chargeBuffer.duration,fullChargeDurationS,1);$('samplerStatus').textContent=`Source ${chargeBuffer.duration.toFixed(3)}s · 0→100% ${fullChargeDurationS.toFixed(3)}s · WSOLA tempo ${p.stretchedTempo.toFixed(3)}× · early release ${p.mul.toFixed(2)}× normal · pitch preserved`}"
assert e.count(old_status) == 1
e = e.replace(old_status, "function renderChargeStatus(){if(!chargeBuffer)return;const p=chargeTempoPlan(chargeBuffer.duration,fullChargeDurationS,1),raw=Number(chargeTrimInfo?.sourceDurationS)||chargeBuffer.duration,trimmed=chargeTrimInfo?.trimmed?` · silence trimmed from ${raw.toFixed(3)}s`:'';$('samplerStatus').textContent=`Audible source ${chargeBuffer.duration.toFixed(3)}s${trimmed} · 0→100% ${fullChargeDurationS.toFixed(3)}s · WSOLA tempo ${p.stretchedTempo.toFixed(3)}× · early release ${p.mul.toFixed(2)}× normal · pitch preserved`}", 1)
old_load = "async function loadCharge(){try{$('samplerStatus').className='';$('samplerStatus').textContent='Loading charge grunt…';chargeBuffer=await decodeUrl(assetUrl(cfg.assets.chargeGrunt));buildPeaks();drawWaveform();renderChargeStatus();latest(`charge grunt decoded; full-charge duration ${fullChargeDurationS.toFixed(3)}s`)}catch(e){$('samplerStatus').textContent=`Charge decode failed: ${e.message}`;$('samplerStatus').className='bad';log(e.message,'bad')}}"
assert e.count(old_load) == 1
e = e.replace(old_load, "async function loadCharge(){try{$('samplerStatus').className='';$('samplerStatus').textContent='Loading charge grunt…';const decoded=await decodeUrl(assetUrl(cfg.assets.chargeGrunt)),trim=window.AnimalVoiceIndependentPlayback?.trimDecodedSilence;chargeTrimInfo=trim?trim(decoded,audioContext(),{padMs:4}):{buffer:decoded,sourceDurationS:decoded.duration,trimmed:false};chargeBuffer=chargeTrimInfo.buffer||decoded;buildPeaks();drawWaveform();renderChargeStatus();latest(`charge grunt decoded/trimmed; full-charge duration ${fullChargeDurationS.toFixed(3)}s`)}catch(e){$('samplerStatus').textContent=`Charge decode failed: ${e.message}`;$('samplerStatus').className='bad';log(e.message,'bad')}}", 1)
e = e.replace("render(chargeBuffer,c,{tempo:plan.stretchedTempo,pitchSemitones:voice.pitchSemitones})", "render(chargeBuffer,c,{tempo:plan.stretchedTempo,pitchSemitones:voice.pitchSemitones,tailPadS:0})", 1)
e = e.replace("render(chargeBuffer,c,{tempo:plan.catchUpTempo,pitchSemitones:voice.pitchSemitones})", "render(chargeBuffer,c,{tempo:plan.catchUpTempo,pitchSemitones:voice.pitchSemitones,tailPadS:0})", 1)
editor.write_text(e)

dialogue = Path('docs/js/dialogue-content.js')
d = dialogue.read_text()
marker = '  let _favorRescaleApplied = true; // see loadNpcRelationships/_applyLegacyFavorRescale\n'
assert d.count(marker) == 1
d = d.replace(marker, marker + "  const _npcSpeechBySpeaker = new Map(); // One live vowel/utterance per NPC; new speech replaces the same speaker instead of layering over itself.\n  const NPC_SPEECH_FADE_IN_S = 0.004; // Fast ramps remove onset clicks without making dialogue feel delayed.\n  const NPC_SPEECH_FADE_OUT_S = 0.008; // Abrupt-but-clickless handoff when the next syllable arrives.\n", 1)
dialogue.write_text(d)

replace_regex_once(
    'docs/js/dialogue-content.js',
    r"  function _playNpcDialogueLetterSfx\(char, rec = _dlgNpcRec \|\| deps\.getDialogueWalker\(\)\?\.rec\) \{.*?\n  \}\n\n  function stopNpcDialogueTypewriter",
    r'''  function _npcSpeechOwnerKey(rec = _dlgNpcRec || deps?.getDialogueWalker?.()?.rec) {
    return String(rec?.id || rec?.name || 'npc-dialogue');
  }

  function _npcSpeechAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = window._npcDialogueAudioCtx || (window._npcDialogueAudioCtx = new AudioCtx());
    if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
    return ctx;
  }

  function _finishNpcSpeechHandle(handle) {
    if (!handle || handle.finished) return;
    handle.finished = true;
    clearTimeout(handle.startTimer);
    clearTimeout(handle.stopTimer);
    try { handle.audio?.pause?.(); } catch (_) {}
    try { if (handle.audio) handle.audio.currentTime = 0; } catch (_) {}
    try { handle.osc?.stop?.(); } catch (_) {}
    try { handle.source?.disconnect?.(); } catch (_) {}
    try { handle.osc?.disconnect?.(); } catch (_) {}
    try { handle.gain?.disconnect?.(); } catch (_) {}
    try { handle.wet?.send?.disconnect?.(); } catch (_) {}
    if (_npcSpeechBySpeaker.get(handle.ownerKey) === handle) _npcSpeechBySpeaker.delete(handle.ownerKey);
  }

  function _fadeNpcSpeechHandle(handle) {
    if (!handle || handle.finished || handle.stopping) return;
    handle.stopping = true;
    clearTimeout(handle.startTimer);
    const ctx = handle.ctx;
    const param = handle.gain?.gain;
    if (!ctx || !param) { _finishNpcSpeechHandle(handle); return; }
    const now = ctx.currentTime;
    try {
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else {
        param.cancelScheduledValues?.(now);
        param.setValueAtTime(Math.max(0.0001, Number(param.value) || Number(handle.volume) || 0.0001), now);
      }
      param.linearRampToValueAtTime(0.0001, now + NPC_SPEECH_FADE_OUT_S);
    } catch (_) {}
    handle.stopTimer = setTimeout(() => _finishNpcSpeechHandle(handle), Math.ceil(NPC_SPEECH_FADE_OUT_S * 1000) + 2);
  }

  function _playNpcDialogueLetterSfx(char, rec = _dlgNpcRec || deps.getDialogueWalker()?.rec) {
    const cfg = npcDialogueLetterSfxConfig(rec);
    if (cfg.enabled === false || !char || /\s/.test(char)) return;
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    if (audioCfg.enabled === false) return;
    const volume = Math.max(0, Math.min(1, Number(cfg.volume) || 0.18)) * Math.max(0, Number(audioCfg.sfxVolume ?? 1));
    if (volume <= 0) return;

    const ownerKey = _npcSpeechOwnerKey(rec);
    const previous = _npcSpeechBySpeaker.get(ownerKey) || null;
    if (previous) _fadeNpcSpeechHandle(previous);
    const ctx = _npcSpeechAudioContext();
    const replaceDelayMs = previous ? Math.ceil(NPC_SPEECH_FADE_OUT_S * 1000) : 0;

    if (cfg.url) {
      const snd = new Audio(cfg.url);
      snd.playbackRate = Math.max(0.25, Number(cfg.playbackRate) || 1);
      if (!ctx?.createMediaElementSource) {
        snd.volume = volume;
        const handle = { ownerKey, audio: snd, ctx: null, gain: null, volume, startTimer: 0, stopTimer: 0, finished: false, stopping: false };
        _npcSpeechBySpeaker.set(ownerKey, handle);
        snd.addEventListener?.('ended', () => _finishNpcSpeechHandle(handle), { once: true });
        handle.startTimer = setTimeout(() => snd.play().catch?.(() => _finishNpcSpeechHandle(handle)), replaceDelayMs);
        return;
      }
      snd.volume = 1;
      snd.dataset.environmentalReverb = 'off'; // This voice is routed into the room bus below; disable the HTMLMediaElement wet-copy wrapper to avoid double reverb.
      const source = ctx.createMediaElementSource(snd);
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      source.connect(gain).connect(ctx.destination);
      const wet = window.EnvironmentalReverb?.connectWetNode?.(ctx, gain, { volume: 1 }) || null;
      const handle = { ownerKey, audio: snd, source, ctx, gain, wet, volume, startTimer: 0, stopTimer: 0, finished: false, stopping: false };
      _npcSpeechBySpeaker.set(ownerKey, handle);
      snd.addEventListener?.('ended', () => _finishNpcSpeechHandle(handle), { once: true });
      handle.startTimer = setTimeout(() => {
        if (handle.finished || handle.stopping) return;
        const at = ctx.currentTime;
        try {
          gain.gain.cancelScheduledValues?.(at);
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.linearRampToValueAtTime(volume, at + NPC_SPEECH_FADE_IN_S);
        } catch (_) { gain.gain.value = volume; }
        Promise.resolve(snd.play()).catch(() => _finishNpcSpeechHandle(handle));
      }, replaceDelayMs);
      return;
    }

    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const variance = Math.max(0, Number(cfg.frequencyVarianceHz) || 35);
    const base = Math.max(20, Number(cfg.frequencyHz) || 520);
    const durationS = Math.max(0.005, (Math.max(5, Number(cfg.durationMs) || 24) / 1000));
    const startAt = ctx.currentTime + replaceDelayMs / 1000;
    osc.type = cfg.waveform || 'square';
    osc.frequency.value = base + (Math.random() * 2 - 1) * variance;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + Math.min(NPC_SPEECH_FADE_IN_S, durationS * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationS);
    osc.connect(gain).connect(ctx.destination);
    const wet = window.EnvironmentalReverb?.connectWetNode?.(ctx, gain, { volume: 1 }) || null;
    const handle = { ownerKey, osc, ctx, gain, wet, volume, startTimer: 0, stopTimer: 0, finished: false, stopping: false };
    _npcSpeechBySpeaker.set(ownerKey, handle);
    osc.onended = () => _finishNpcSpeechHandle(handle);
    osc.start(startAt);
    osc.stop(startAt + durationS);
  }

  function stopNpcDialogueTypewriter'''
)

d = Path('docs/js/dialogue-content.js').read_text()
stop_anchor = """  function stopNpcDialogueTypewriter(showFullText = false) {
    _npcDialogueSequenceId++;"""
assert d.count(stop_anchor) == 1
d = d.replace(stop_anchor, """  function stopNpcDialogueTypewriter(showFullText = false) {
    const currentSpeech = _npcSpeechBySpeaker.get(_npcSpeechOwnerKey());
    if (currentSpeech) _fadeNpcSpeechHandle(currentSpeech);
    _npcDialogueSequenceId++;""", 1)
Path('docs/js/dialogue-content.js').write_text(d)

tests = Path('scripts/test-combat-vocalizations.js')
t = tests.read_text()
old_breath_test = """// Non-exhausted low stamina must stay inside intensities 1..3.
player.stamina = 10;
scheduledBreath({ timestamp: 2000 }); // schedules first breath
scheduledBreath({ timestamp: 10000 }); // plays it
assert(played.at(-1).url.includes('heavybreath_medium_intensity3'), 'non-exhausted low stamina should top out at intensity 3');
assert(!played.at(-1).url.includes('intensity4') && !played.at(-1).url.includes('intensity5'));
assert.equal(played.at(-1).pitchPreserved, true, 'breath tempo changes must use independent pitch preservation');
assert.equal(played.at(-1).tempo, 1, 'default vocal tempo remains 1x');
assert(Number.isFinite(played.at(-1).pitchSemitones), 'explicit/random pitch is carried as a separate semitone axis');"""
assert t.count(old_breath_test) == 1
new_breath_test = """// Non-exhausted low stamina starts immediately and keeps breathing while stamina stays below max.
context.window.__hobunjiPlayerProfile = { appearance: { speciesId: 'nuhongan', gender: 'female' } };
player.stamina = 10;
const beforeBreathing = played.length;
scheduledBreath({ timestamp: 2000 });
assert.equal(played.length, beforeBreathing + 1, 'dropping below max stamina should start breathing immediately');
scheduledBreath({ timestamp: 4000 });
assert.equal(played.length, beforeBreathing + 2, 'breathing should continue on cadence while stamina remains below max without another stamina event');
assert(played.at(-1).url.includes('heavybreath_medium_intensity3'), 'non-exhausted low stamina should top out at intensity 3');
assert(!played.at(-1).url.includes('intensity4') && !played.at(-1).url.includes('intensity5'));
assert.equal(played.at(-1).pitchPreserved, true, 'breath tempo changes must use independent pitch preservation');
assert.equal(played.at(-1).tempo, 1, 'default vocal tempo remains 1x');
assert(played.at(-1).pitchSemitones > 14 && played.at(-1).pitchSemitones < 14.3, 'breathing receives the same Nuhongan female species pitch shift plus small authored random variation');
assert.equal(played.at(-1).trimSilence, true, 'combat vocals request decoded silence trimming');
assert.equal(played.at(-1).tailPadS, 0, 'combat vocals add no artificial silent tail after trimming');"""
t = t.replace(old_breath_test, new_breath_test, 1)
static_anchor = "assert.match(animalPlaybackSource, /GENERIC_MAX_SHIFT_SEMITONES = 24/, 'combat may use +14 semitone profiles without raising the animal-call +/-12 ceiling');\n"
assert t.count(static_anchor) == 1
t = t.replace(static_anchor, static_anchor + "assert.match(animalPlaybackSource, /function trimDecodedSilence/, 'shared pitch-preserving playback trims decoded leading/trailing silence before combat timing');\nassert.match(animalPlaybackSource, /extraWetBase/, 'generic combat one-shots route through the environmental reverb send without inheriting animal-only extra wetness');\nassert.match(source, /__combatVocalWet = window\\.EnvironmentalReverb\\?\\.connectWetNode/, 'custom charge playback also sends into the current environmental reverb space');\nassert.match(source, /chargeRatePlan\\(audibleBuffer\\.duration/, 'charge duration math uses the silence-trimmed audible buffer');\n", 1)
tests.write_text(t)

cadence = Path('scripts/test-dialogue-syllable-cadence.js')
s = cadence.read_text()
cadence_anchor = "assert.match(dialogueContent, /_playNpcDialogueLetterSfx\\(unit\\.vowels\\[index\\]\\)/, 'NPC dialogue plays exactly one tick for every vowel in a syllable');\n"
assert s.count(cadence_anchor) == 1
s = s.replace(cadence_anchor, cadence_anchor + "assert.match(dialogueContent, /_npcSpeechBySpeaker = new Map/, 'NPC speech keeps one active utterance owner per speaker');\nassert.match(dialogueContent, /if \(previous\) _fadeNpcSpeechHandle\(previous\)/, 'a new vowel replaces the same NPC previous utterance instead of layering');\nassert.match(dialogueContent, /NPC_SPEECH_FADE_OUT_S = 0\\.008/, 'replacement uses a sudden click-safe fade rather than an audible hard cut');\nassert.match(dialogueContent, /EnvironmentalReverb\\?\\.connectWetNode/, 'NPC utterances are sent through the current physical acoustic space');\nassert.match(dialogueContent, /dataset\\.environmentalReverb = 'off'/, 'WebAudio-routed NPC clips suppress the duplicate media-element reverb wrapper');\n", 1)
cadence.write_text(s)
