(() => {
  'use strict';

  // Environmental reverb is deliberately a parallel wet-only layer. Existing
  // HTMLAudioElement/Web Audio dry playback stays untouched, so a failed Web
  // Audio destination can never silence the game's original sound path.
  const DEFAULT_PROFILE = Object.freeze({ wet: 0.028, decayS: 0.42, preDelayMs: 8, dampingHz: 6200 });
  const PROFILE_PRESETS = Object.freeze({
    outdoor: Object.freeze({ wet: 0.025, decayS: 0.38, preDelayMs: 7, dampingHz: 6800 }),
    forest: Object.freeze({ wet: 0.048, decayS: 0.62, preDelayMs: 11, dampingHz: 5000 }),
    interior: Object.freeze({ wet: 0.082, decayS: 0.82, preDelayMs: 14, dampingHz: 4300 }),
    stable: Object.freeze({ wet: 0.050, decayS: 0.56, preDelayMs: 10, dampingHz: 4100 }),
    tent: Object.freeze({ wet: 0.034, decayS: 0.38, preDelayMs: 8, dampingHz: 5200 }),
    temple: Object.freeze({ wet: 0.145, decayS: 1.34, preDelayMs: 22, dampingHz: 5200 }),
    basement: Object.freeze({ wet: 0.185, decayS: 1.55, preDelayMs: 25, dampingHz: 3400 }),
    cavern: Object.freeze({ wet: 0.235, decayS: 1.95, preDelayMs: 31, dampingHz: 3000 }),
  });
  const MAX_WET = 0.38;
  const MAX_ONE_SHOT_SECONDS = 18;
  const ANIMAL_EXTRA_WET = 0.026;
  const MEDIA_DECODE_CACHE_LIMIT = 48;

  const decodedByUrl = new Map();
  const contextBusByContext = new WeakMap();
  const activeWetSources = new Set();
  let areaResolver = null;
  let lastKnownArea = 'map_hobunji_town';
  let mediaPlayWrapped = false;
  let audioInitWrapped = false;
  let musicInitWrapped = false;
  let sharedContext = null;
  let lastError = null;
  let lastWetUrl = null;
  let wetPlayCount = 0;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function config() { return window.SCRATCHBONES_CONFIG?.game?.audio?.environmentalReverb || {}; }
  function enabled() { return config().enabled !== false; }
  function setAreaResolver(fn) { areaResolver = typeof fn === 'function' ? fn : null; }
  function setArea(area) {
    if (area != null && String(area).trim()) lastKnownArea = String(area);
    return lastKnownArea;
  }
  function currentArea() {
    try {
      const resolved = areaResolver?.();
      if (resolved != null && String(resolved).trim()) lastKnownArea = String(resolved);
    } catch (_) {}
    return lastKnownArea;
  }
  function mergeProfile(base, override) {
    const result = { ...base, ...(override || {}) };
    result.wet = clamp(finite(result.wet, base.wet), 0, MAX_WET);
    result.decayS = clamp(finite(result.decayS, base.decayS), 0.12, 4);
    result.preDelayMs = clamp(finite(result.preDelayMs, base.preDelayMs), 0, 80);
    result.dampingHz = clamp(finite(result.dampingHz, base.dampingHz), 700, 16000);
    return result;
  }
  function presetForArea(area) {
    const id = String(area || '').toLowerCase();
    if (/cavern|cave|dungeon|mine|crypt|sewer|tunnel/.test(id)) return 'cavern';
    if (/temple[_-]?basement|basement|cellar/.test(id)) return 'basement';
    if (/map_i_temple|life[_-]?temple/.test(id)) return 'temple';
    if (/stable|barn/.test(id)) return 'stable';
    if (/tent/.test(id)) return 'tent';
    if (/^map_i_|interior|house|shop|inn|room|watchhouse|farmstead|carpenter|smithy/.test(id)) return 'interior';
    if (/cloud.?forest|forest|jungle|wilderness|woods/.test(id)) return 'forest';
    return 'outdoor';
  }
  function profileForArea(area = currentArea()) {
    const cfg = config();
    const exact = cfg.byArea?.[area];
    const presetName = exact?.preset || presetForArea(area);
    const configuredPreset = cfg.profiles?.[presetName];
    let profile = mergeProfile(PROFILE_PRESETS[presetName] || DEFAULT_PROFILE, configuredPreset);
    profile = mergeProfile(profile, exact);
    profile.preset = presetName;
    profile.area = String(area || '');
    profile.wet = clamp(profile.wet * Math.max(0, finite(cfg.wetScale, 1)), 0, MAX_WET);
    return profile;
  }
  function ensureContext(preferred = null) {
    if (preferred && preferred.state !== 'closed') return preferred;
    if (sharedContext && sharedContext.state !== 'closed') return sharedContext;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      sharedContext = new AudioCtx();
      if (sharedContext.state === 'suspended') sharedContext.resume?.().catch?.(() => {});
      return sharedContext;
    } catch (error) {
      lastError = error;
      return null;
    }
  }
  function makeImpulse(context, profile) {
    const length = Math.max(1, Math.round(context.sampleRate * profile.decayS));
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
      const data = buffer.getChannelData(channelIndex);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        const t = i / Math.max(1, length - 1);
        const envelope = Math.pow(1 - t, 2.4);
        const noise = Math.random() * 2 - 1;
        smooth = smooth * 0.30 + noise * 0.70;
        data[i] = smooth * envelope * (0.78 + Math.random() * 0.22);
      }
    }
    return buffer;
  }
  function ensureBus(context, profile) {
    let state = contextBusByContext.get(context);
    if (!state) {
      const input = context.createGain();
      const delay = context.createDelay(0.1);
      const convolver = context.createConvolver();
      const damping = context.createBiquadFilter();
      const output = context.createGain();
      damping.type = 'lowpass';
      output.gain.value = 1;
      input.connect(delay).connect(convolver).connect(damping).connect(output).connect(context.destination);
      state = { input, delay, convolver, damping, output, signature: '' };
      contextBusByContext.set(context, state);
    }
    const signature = [profile.decayS.toFixed(3), profile.preDelayMs.toFixed(1), profile.dampingHz.toFixed(0)].join('|');
    if (signature !== state.signature) {
      state.delay.delayTime.value = profile.preDelayMs / 1000;
      state.damping.frequency.value = profile.dampingHz;
      state.convolver.buffer = makeImpulse(context, profile);
      state.signature = signature;
    }
    return state;
  }
  function connectWetNode(context, node, { volume = 1, wetOverride = null, extraWet = 0, area = null } = {}) {
    if (!enabled() || !context || !node?.connect) return null;
    const profile = profileForArea(area || currentArea());
    const wet = clamp(wetOverride == null ? profile.wet + finite(extraWet, 0) : finite(wetOverride, 0), 0, MAX_WET);
    if (wet <= 0.0005 || volume <= 0.0005) return null;
    try {
      const bus = ensureBus(context, profile);
      const send = context.createGain();
      send.gain.value = clamp(finite(volume, 1), 0, 2) * wet;
      node.connect(send).connect(bus.input);
      return { send, profile, wet };
    } catch (error) {
      lastError = error;
      return null;
    }
  }
  function absoluteUrl(url) {
    try { return new URL(url, document.baseURI).href; }
    catch (_) { return String(url || ''); }
  }
  function decodeUrl(url, context) {
    const resolved = absoluteUrl(url);
    if (!resolved) return Promise.reject(new Error('Environmental reverb URL is empty'));
    if (decodedByUrl.has(resolved)) return decodedByUrl.get(resolved);
    const pending = fetch(resolved)
      .then(response => {
        if (!response.ok) throw new Error(`Environmental reverb fetch ${response.status}: ${resolved}`);
        return response.arrayBuffer();
      })
      .then(bytes => context.decodeAudioData(bytes.slice(0)))
      .catch(error => { decodedByUrl.delete(resolved); throw error; });
    decodedByUrl.set(resolved, pending);
    while (decodedByUrl.size > MEDIA_DECODE_CACHE_LIMIT) decodedByUrl.delete(decodedByUrl.keys().next().value);
    return pending;
  }
  function playWetUrl(url, opts = {}) {
    if (!enabled() || !url) return null;
    const context = ensureContext(opts.context || null);
    if (!context) return null;
    if (context.state === 'suspended') context.resume?.().catch?.(() => {});
    const resolved = absoluteUrl(url);
    lastWetUrl = resolved;
    let stopped = false;
    let source = null;
    let send = null;
    const handle = {
      stop() {
        if (stopped) return;
        stopped = true;
        try { source?.stop?.(); } catch (_) {}
        try { source?.disconnect?.(); } catch (_) {}
        try { send?.send?.disconnect?.(); } catch (_) {}
        activeWetSources.delete(handle);
      },
    };
    activeWetSources.add(handle);
    decodeUrl(resolved, context).then(buffer => {
      if (stopped) return;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clamp(finite(opts.playbackRate, 1), 0.25, 4);
      send = connectWetNode(context, source, opts);
      if (!send) { handle.stop(); return; }
      source.onended = () => {
        const tailMs = Math.ceil((send.profile.decayS + send.profile.preDelayMs / 1000 + 0.08) * 1000);
        setTimeout(() => handle.stop(), tailMs);
      };
      const startAt = context.currentTime + Math.max(0.004, finite(opts.startDelayS, 0.006));
      const offsetS = clamp(finite(opts.offsetS, 0), 0, Math.max(0, buffer.duration - 0.001));
      source.start(startAt, offsetS);
      wetPlayCount++;
    }).catch(error => {
      lastError = error;
      handle.stop();
    });
    return handle;
  }
  function isWorldOneShot(media) {
    if (!media || media.dataset?.environmentalReverb === 'off') return false;
    if (media.loop) return false;
    const src = String(media.currentSrc || media.src || '').toLowerCase();
    if (!src) return false;
    if (/\/music\/|\/bgm\/|\/ui\/|menu|button|click/.test(src)) return false;
    const duration = Number(media.duration);
    if (Number.isFinite(duration) && duration > MAX_ONE_SHOT_SECONDS) return false;
    return true;
  }
  function scheduleMediaWet(media) {
    if (!isWorldOneShot(media) || media.__environmentalWetPending) return;
    const volume = clamp(finite(media.volume, 1), 0, 1);
    if (volume <= 0.002) return;
    media.__environmentalWetPending = true;
    Promise.resolve().then(() => {
      media.__environmentalWetPending = false;
      if (media.paused) return;
      playWetUrl(media.currentSrc || media.src, {
        volume,
        playbackRate: finite(media.playbackRate, 1),
        offsetS: finite(media.currentTime, 0),
      });
    });
  }
  function installMediaPlayWrapper() {
    if (mediaPlayWrapped || !window.HTMLMediaElement?.prototype?.play) return false;
    const proto = window.HTMLMediaElement.prototype;
    const nativePlay = proto.play;
    proto.play = function environmentalReverbPlay(...args) {
      let result;
      try { result = nativePlay.apply(this, args); }
      catch (error) { throw error; }
      Promise.resolve(result).then(() => scheduleMediaWet(this)).catch(() => {});
      return result;
    };
    mediaPlayWrapped = true;
    return true;
  }
  function wrapInitWithAreaResolver(namespace, flagName) {
    if (!namespace?.init || namespace[flagName]) return false;
    const original = namespace.init;
    namespace.init = function environmentalReverbAwareInit(injectedDeps, ...rest) {
      if (typeof injectedDeps?.getCurrentArea === 'function') setAreaResolver(() => injectedDeps.getCurrentArea());
      return original.call(this, injectedDeps, ...rest);
    };
    namespace[flagName] = true;
    return true;
  }
  function wrapAreaBearingAudioMethods() {
    const audioSystem = window.AudioSystem;
    if (!audioSystem) return;
    if (typeof audioSystem.playFootstepSfx === 'function' && !audioSystem.playFootstepSfx.__environmentalAreaWrapped) {
      const original = audioSystem.playFootstepSfx;
      const wrapped = function(area, ...rest) { setArea(area); return original.call(this, area, ...rest); };
      wrapped.__environmentalAreaWrapped = true;
      audioSystem.playFootstepSfx = wrapped;
    }
    if (typeof audioSystem.playHeavyLandingSfx === 'function' && !audioSystem.playHeavyLandingSfx.__environmentalAreaWrapped) {
      const original = audioSystem.playHeavyLandingSfx;
      const wrapped = function(area, ...rest) { setArea(area); return original.call(this, area, ...rest); };
      wrapped.__environmentalAreaWrapped = true;
      audioSystem.playHeavyLandingSfx = wrapped;
    }
  }
  function install() {
    installMediaPlayWrapper();
    const audioSystem = window.AudioSystem;
    if (audioSystem && !audioInitWrapped) {
      audioInitWrapped = wrapInitWithAreaResolver(audioSystem, '__environmentalReverbInitWrapped') || audioInitWrapped;
      wrapAreaBearingAudioMethods();
    }
    const music = window.Music;
    if (music && !musicInitWrapped) musicInitWrapped = wrapInitWithAreaResolver(music, '__environmentalReverbInitWrapped') || musicInitWrapped;
  }
  function debugSnapshot() {
    const profile = profileForArea();
    return {
      enabled: enabled(),
      area: currentArea(),
      preset: profile.preset,
      wet: Number(profile.wet.toFixed(3)),
      decayS: Number(profile.decayS.toFixed(2)),
      preDelayMs: Number(profile.preDelayMs.toFixed(1)),
      dampingHz: Math.round(profile.dampingHz),
      animalExtraWet: ANIMAL_EXTRA_WET,
      mediaPlayWrapped,
      decodedWetClipCount: decodedByUrl.size,
      activeWetSources: activeWetSources.size,
      wetPlayCount,
      lastWetUrl,
      lastError: lastError ? String(lastError?.message || lastError) : null,
    };
  }

  window.EnvironmentalReverb = {
    install,
    setAreaResolver,
    setArea,
    currentArea,
    profileForArea,
    connectWetNode,
    playWetUrl,
    debugSnapshot,
  };

  install();
  if (typeof window.setInterval === 'function') window.setInterval(install, 250);
})();