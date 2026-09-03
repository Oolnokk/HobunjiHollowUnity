// Shared Kurraya/social-dance rhythm clock.
//
// The last Kurraya performance the player plays or hears becomes the session's
// authoritative musical clock (tempo, meter, grouping and phase). When no
// performance has happened yet, a simple configurable session preset runs from
// page load. Social dances join that clock on the next beat with a small stable
// human timing offset; dance footsteps and the hosted Kurraya metronome reuse
// the ordinary surface-footstep audio instead of a synthetic click.
(function (global) {
  'use strict';

  if (global.SocialRhythmClock?.installed) return;

  const PLAYER_FRAME_ID = 'musicMinigameFrame';
  const MUSIC_FRAME_FRAGMENT = 'assets/minigames/lyre-performance.html';
  const state = {
    bpm: 104,
    timeSignature: [4, 4],
    beatGrouping: [4],
    originMs: performance.now(),
    source: 'session-default',
    sourceLabel: 'Session default',
    revision: 1,
    lastHeardAtMs: performance.now(),
    lastPollAtMs: 0,
    actionArcDeps: null,
    characterViewWasEnabled: false,
    neckReturn: null,
    socialWheelProxy: null,
    socialWheelTarget: null,
    danceGate: null,
    dancerOffsets: new Map(),
    audioTarget: null,
    basePlayFootstepSfx: null,
    syntheticDanceBeatIndex: null,
    playerMetronomeBeatIndex: null,
    playerMetronomeFrame: null,
    framePatches: new WeakSet(),
    rhythmSamples: 0,
    danceStarts: 0,
    danceResyncs: 0,
    danceFootsteps: 0,
    accentedDanceFootsteps: 0,
    accentedWalkingFootsteps: 0,
    kurrayaMetronomeFootsteps: 0,
    suppressedDigitalClicks: 0,
    ambientMetronomeBoosts: 0,
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const now = () => performance.now();

  function cfg() {
    return global.SCRATCHBONES_CONFIG?.game?.socialActions || {};
  }

  function configuredNumber(name, fallback, lo = -Infinity, hi = Infinity) {
    const value = Number(cfg()[name]);
    return Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
  }

  function normalizeSignature(value) {
    const source = Array.isArray(value) ? value : String(value || '').split('/');
    const numerator = clamp(Math.round(Number(source[0]) || 4), 1, 32);
    const rawDenominator = Math.round(Number(source[1]) || 4);
    const denominator = [1, 2, 4, 8, 16, 32].includes(rawDenominator) ? rawDenominator : 4;
    return [numerator, denominator];
  }

  function automaticGrouping(signature) {
    const [numerator, denominator] = signature;
    if (denominator >= 8 && numerator >= 6 && numerator % 3 === 0) return Array.from({ length: numerator / 3 }, () => 3);
    if (numerator === 5) return [3, 2];
    if (numerator === 7) return [2, 2, 3];
    return [numerator];
  }

  function normalizeGrouping(value, signature) {
    const [numerator] = signature;
    const source = Array.isArray(value) ? value : String(value || '').split('+');
    const groups = source.map(item => Math.round(Number(item))).filter(item => item > 0);
    return groups.length && groups.reduce((sum, item) => sum + item, 0) === numerator
      ? groups
      : automaticGrouping(signature);
  }

  function defaultPreset() {
    const signature = normalizeSignature(cfg().globalRhythmDefaultTimeSignature || [4, 4]);
    return {
      bpm: configuredNumber('globalRhythmDefaultBpm', 104, 30, 300),
      timeSignature: signature,
      beatGrouping: normalizeGrouping(cfg().globalRhythmDefaultBeatGrouping, signature),
    };
  }

  function resetToSessionDefault() {
    const preset = defaultPreset();
    state.bpm = preset.bpm;
    state.timeSignature = preset.timeSignature;
    state.beatGrouping = preset.beatGrouping;
    state.originMs = now();
    state.source = 'session-default';
    state.sourceLabel = 'Session default';
    state.revision++;
    state.lastHeardAtMs = now();
    syncLegacyDanceTempo();
  }

  function quarterBeatMs() {
    return 60000 / Math.max(1, state.bpm);
  }

  function beatMs() {
    return quarterBeatMs() * (4 / state.timeSignature[1]);
  }

  function measureMs() {
    return beatMs() * state.timeSignature[0];
  }

  function beatAt(timeMs = now(), offsetMs = 0) {
    return (timeMs - state.originMs - offsetMs) / Math.max(1, beatMs());
  }

  function measurePhase(timeMs = now()) {
    const duration = Math.max(1, measureMs());
    const elapsed = timeMs - state.originMs;
    return ((elapsed % duration) + duration) % duration;
  }

  function nearestBeatDistanceMs(timeMs = now()) {
    const duration = Math.max(1, beatMs());
    const elapsed = timeMs - state.originMs;
    const remainder = ((elapsed % duration) + duration) % duration;
    return Math.min(remainder, duration - remainder);
  }

  function beatAccentWindowMs() {
    return Math.min(
      configuredNumber('danceBeatAccentWindowMs', 85, 10, 220),
      beatMs() * configuredNumber('danceBeatAccentWindowFraction', 0.18, 0.04, 0.42),
    );
  }

  function isNearBeat(timeMs = now()) {
    return nearestBeatDistanceMs(timeMs) <= beatAccentWindowMs();
  }

  function nextBeatAt(timeMs = now(), offsetMs = 0) {
    const duration = Math.max(1, beatMs());
    const elapsed = timeMs - state.originMs - offsetMs;
    let index = Math.ceil((elapsed + 0.01) / duration);
    let result = state.originMs + offsetMs + index * duration;
    if (result < timeMs + 8) result += duration;
    return result;
  }

  function tactusBpm(raw) {
    let bpm = Number(raw) || 104;
    while (bpm > 122) bpm /= 2;
    while (bpm < 58) bpm *= 2;
    return bpm;
  }

  function syncLegacyDanceTempo() {
    const social = global.SCRATCHBONES_CONFIG?.game?.socialActions;
    if (!social) return;
    try { social.danceBpm = tactusBpm(state.bpm); } catch (_) {}
  }

  function sameArray(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Number(value) === Number(b[index]));
  }

  function nearestEquivalentOrigin(candidateOriginMs, periodMs) {
    if (!(periodMs > 0) || !Number.isFinite(state.originMs)) return candidateOriginMs;
    const cycles = Math.round((candidateOriginMs - state.originMs) / periodMs);
    return candidateOriginMs - cycles * periodMs;
  }

  function setRhythm(sample = {}) {
    const bpm = clamp(Number(sample.bpm) || state.bpm || 104, 30, 300);
    const signature = normalizeSignature(sample.timeSignature || state.timeSignature);
    const grouping = normalizeGrouping(sample.beatGrouping, signature);
    const newBeatMs = 60000 / bpm * (4 / signature[1]);
    const newMeasureMs = newBeatMs * signature[0];
    const specsChanged = Math.abs(bpm - state.bpm) > 0.01
      || !sameArray(signature, state.timeSignature)
      || !sameArray(grouping, state.beatGrouping);

    let candidateOrigin = Number(sample.originMs);
    if (!Number.isFinite(candidateOrigin)) {
      const phaseFraction = Number(sample.measurePhaseFraction);
      if (Number.isFinite(phaseFraction)) candidateOrigin = now() - (((phaseFraction % 1) + 1) % 1) * newMeasureMs;
      else candidateOrigin = state.originMs;
    }
    if (!specsChanged) candidateOrigin = nearestEquivalentOrigin(candidateOrigin, newMeasureMs);

    state.bpm = bpm;
    state.timeSignature = signature;
    state.beatGrouping = grouping;
    if (Number.isFinite(candidateOrigin)) state.originMs = candidateOrigin;
    state.source = String(sample.source || state.source || 'kurraya');
    state.sourceLabel = String(sample.sourceLabel || state.sourceLabel || 'Kurraya');
    state.lastHeardAtMs = now();
    state.rhythmSamples++;
    if (specsChanged) state.revision++;
    syncLegacyDanceTempo();
    return getState();
  }

  function parseFrameRhythm(frame, bridgeState) {
    let text = '';
    try { text = frame.contentDocument?.getElementById('debugState')?.textContent || ''; } catch (_) {}
    const match = text.match(/shared\s+([0-9.]+)\s+quarter-BPM\s+(\d+)\/(\d+)\s+clock(?:\s+\(([^)]+)\))?/i);
    const bpm = match ? Number(match[1]) : Number(bridgeState?.bpm);
    const signature = match ? [Number(match[2]), Number(match[3])] : [4, 4];
    const grouping = match?.[4] ? match[4].split('+').map(Number) : automaticGrouping(normalizeSignature(signature));
    if (!(bpm > 0)) return null;

    const reportedMeasureDuration = Number(bridgeState?.measureDurationMs);
    const reportedMeasurePhase = Number(bridgeState?.measurePhaseMs);
    let phaseFraction = null;
    if (reportedMeasureDuration > 0 && Number.isFinite(reportedMeasurePhase)) {
      phaseFraction = ((reportedMeasurePhase / reportedMeasureDuration) % 1 + 1) % 1;
    }
    return { bpm, timeSignature: signature, beatGrouping: grouping, measurePhaseFraction: phaseFraction };
  }

  function musicFrames() {
    return [...document.querySelectorAll('iframe')].filter(frame => {
      const src = frame.getAttribute?.('src') || '';
      return src.includes(MUSIC_FRAME_FRAGMENT);
    });
  }

  function frameBridge(frame) {
    try { return frame.contentWindow?.HobunjiMusicControlBridge || null; }
    catch (_) { return null; }
  }

  function isPlayerMusicActive() {
    try { return !!global.MusicMinigame?.state?.active; }
    catch (_) { return false; }
  }

  function chooseHeardFrame() {
    const frames = musicFrames();
    const player = frames.find(frame => frame.id === PLAYER_FRAME_ID) || null;
    if (player && isPlayerMusicActive() && frameBridge(player)?.getState) return player;
    for (const frame of frames) {
      const bridge = frameBridge(frame);
      if (!bridge?.getState) continue;
      let bridgeState = null;
      try { bridgeState = bridge.getState(); } catch (_) {}
      if (bridgeState?.gameActive) return frame;
    }
    return null;
  }

  function sampleKurrayaRhythm() {
    const frame = chooseHeardFrame();
    if (!frame) return;
    const bridge = frameBridge(frame);
    let bridgeState = null;
    try { bridgeState = bridge?.getState?.(); } catch (_) {}
    const rhythm = parseFrameRhythm(frame, bridgeState);
    if (!rhythm) return;
    const playerFrame = frame.id === PLAYER_FRAME_ID;
    setRhythm({
      ...rhythm,
      source: playerFrame ? 'player-kurraya' : 'heard-kurraya',
      sourceLabel: bridgeState?.selectedSongTitle || (playerFrame ? 'Player Kurraya jam' : 'Heard Kurraya'),
    });
  }

  function randomHumanOffsetMs() {
    const maximum = configuredNumber('danceHumanTimingOffsetMs', 42, 0, 140);
    return (Math.random() * 2 - 1) * maximum;
  }

  function dancerOffsetMs(id, session = 'persistent') {
    const key = `${String(id || 'dancer')}|${String(session)}`;
    if (!state.dancerOffsets.has(key)) state.dancerOffsets.set(key, randomHumanOffsetMs());
    return state.dancerOffsets.get(key);
  }

  function dancerBeatAt(id, timeMs = now(), session = 'persistent') {
    return beatAt(timeMs, dancerOffsetMs(id, session));
  }

  function patchSocialWheel(api) {
    if (!api || state.socialWheelTarget === api || api.__socialRhythmProxy) return;
    const originalGetDebug = typeof api.getDebug === 'function' ? api.getDebug.bind(api) : null;
    if (!originalGetDebug) return;
    const proxy = new Proxy(api, {
      get(target, prop, receiver) {
        if (prop === '__socialRhythmProxy') return true;
        if (prop !== 'getDebug') return Reflect.get(target, prop, receiver);
        return function rhythmAwareSocialDebug(...args) {
          const raw = originalGetDebug(...args) || {};
          const dance = raw.dancing || null;
          if (!dance) {
            state.danceGate = null;
            state.syntheticDanceBeatIndex = null;
            return raw;
          }
          const identity = `${dance.style || ''}|${dance.armStyle || ''}|${dance.startedAt ?? dance.startedAtMs ?? dance.actionId ?? 'active'}`;
          const needsGate = !state.danceGate
            || state.danceGate.identity !== identity
            || state.danceGate.revision !== state.revision;
          if (needsGate) {
            const wasReleased = !!state.danceGate?.released;
            const offsetMs = randomHumanOffsetMs();
            state.danceGate = {
              identity,
              revision: state.revision,
              offsetMs,
              releaseAtMs: nextBeatAt(now(), offsetMs),
              released: false,
            };
            state.syntheticDanceBeatIndex = null;
            if (wasReleased) state.danceResyncs++;
          }
          if (now() + 0.5 < state.danceGate.releaseAtMs) {
            return { ...raw, dancing: null, rhythmPending: { releaseAtMs: state.danceGate.releaseAtMs, offsetMs: state.danceGate.offsetMs, revision: state.revision } };
          }
          if (!state.danceGate.released) {
            state.danceGate.released = true;
            state.danceStarts++;
          }
          return {
            ...raw,
            dancing: { ...dance, rhythmOffsetMs: state.danceGate.offsetMs, rhythmRevision: state.revision },
            rhythmPending: null,
          };
        };
      },
    });
    state.socialWheelTarget = api;
    state.socialWheelProxy = proxy;
    try { global.SocialActionWheel = proxy; } catch (_) {}
  }

  function chainGlobal(name, patcher) {
    const current = global[name];
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current;
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(global) : stored; },
        set(value) {
          if (oldSet) oldSet.call(global, value); else stored = value;
          const resolved = oldGet ? oldGet.call(global) : stored;
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  function patchActionArc(api) {
    if (!api?.init || api.init.__socialRhythmWrapped) return;
    const original = api.init.bind(api);
    const wrapped = function socialRhythmActionArcInit(injectedDeps) {
      state.actionArcDeps = injectedDeps || null;
      return original(injectedDeps);
    };
    wrapped.__socialRhythmWrapped = true;
    api.init = wrapped;
  }

  function updateCharacterViewHead(timeMs) {
    const deps = state.actionArcDeps;
    const view = deps?.characterViewMode;
    if (!view) return;
    const enabled = !!view.enabled;
    if (enabled && !state.characterViewWasEnabled) {
      state.neckReturn = {
        startAtMs: timeMs,
        startX: Number(view.lockedNeckX) || 0,
        startY: Number(view.lockedNeckY) || 0,
      };
    } else if (!enabled) {
      state.neckReturn = null;
    }
    state.characterViewWasEnabled = enabled;
    if (!enabled || !state.neckReturn) return;
    const duration = configuredNumber('characterViewHeadReturnMs', 360, 40, 1600);
    const t = clamp((timeMs - state.neckReturn.startAtMs) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    view.lockedNeckX = state.neckReturn.startX * (1 - eased);
    view.lockedNeckY = state.neckReturn.startY * (1 - eased);
    if (t >= 1) {
      view.lockedNeckX = 0;
      view.lockedNeckY = 0;
      state.neckReturn = null;
    }
  }

  function dep(name) {
    for (const bag of [global.ProceduralHandAttachments?.gameDeps, global.Combat?.deps]) {
      if (bag && bag[name] != null) return bag[name];
    }
    return null;
  }

  function currentPlayerTile() {
    const audio = state.audioTarget || global.AudioSystem;
    const player = dep('player');
    const areaGetter = dep('getCurrentArea');
    const area = typeof areaGetter === 'function' ? areaGetter() : areaGetter;
    if (!audio?.footstepTileAt || !player || !area) return null;
    const tile = audio.footstepTileAt(area, Number(player.x) || 0, Number(player.y) || 0);
    return tile ? { area, tile } : null;
  }

  function danceVisible() {
    try { return global.SocialActionWheel?.getDebug?.()?.dancing || null; }
    catch (_) { return null; }
  }

  function likelyPlayerFootstep(volumeScale, pan, opts) {
    if (opts?.heavy) return false;
    if (opts?.actor && opts.actor !== 'player') return false;
    return Math.abs(Number(pan) || 0) < 0.0001 && Math.max(0, Number(volumeScale) || 0) <= 1.5;
  }

  function patchAudio(api) {
    if (!api?.playFootstepSfx || api.playFootstepSfx.__socialRhythmWrapped) return;
    const original = api.playFootstepSfx.bind(api);
    state.audioTarget = api;
    state.basePlayFootstepSfx = original;
    const wrapped = function rhythmAccentFootstep(area, tile, volumeScale = 1, pan = 0, opts = {}) {
      let scale = Math.max(0, Number(volumeScale) || 0);
      if (!opts?.socialRhythmSynthetic && likelyPlayerFootstep(scale, pan, opts) && danceVisible() && isNearBeat(now())) {
        scale *= 3;
        state.accentedWalkingFootsteps++;
      }
      return original(area, tile, scale, pan, opts);
    };
    wrapped.__socialRhythmWrapped = true;
    api.playFootstepSfx = wrapped;
  }

  function playCurrentTileFootstep(volumeScale, kind) {
    const resolved = currentPlayerTile();
    const play = state.basePlayFootstepSfx || global.AudioSystem?.playFootstepSfx;
    if (!resolved || typeof play !== 'function') return false;
    play(resolved.area, resolved.tile, volumeScale, 0, { socialRhythmSynthetic: true, socialRhythmKind: kind });
    return true;
  }

  function updateDanceFootsteps(timeMs) {
    const dance = danceVisible();
    const gate = state.danceGate;
    if (!dance || !gate?.released) {
      state.syntheticDanceBeatIndex = null;
      return;
    }
    const speed = Number(global.SocialActionDanceRuntime?.getDebug?.()?.lastLegSpeed) || 0;
    const stationaryThreshold = configuredNumber('danceSyntheticFootstepMaxMoveSpeed', 0.08, 0, 1.5);
    if (speed > stationaryThreshold) {
      state.syntheticDanceBeatIndex = null;
      return;
    }
    const duration = Math.max(1, beatMs());
    const localBeat = (timeMs - gate.releaseAtMs) / duration;
    if (localBeat < 0) return;
    const beatIndex = Math.floor(localBeat);
    if (state.syntheticDanceBeatIndex == null) {
      state.syntheticDanceBeatIndex = beatIndex;
      return;
    }
    if (beatIndex === state.syntheticDanceBeatIndex) return;
    state.syntheticDanceBeatIndex = beatIndex;
    const landingAt = gate.releaseAtMs + beatIndex * duration;
    const accented = nearestBeatDistanceMs(landingAt) <= beatAccentWindowMs();
    if (playCurrentTileFootstep(accented ? 3 : 1, 'dance-plant')) {
      state.danceFootsteps++;
      if (accented) state.accentedDanceFootsteps++;
    }
  }

  function patchFrameAudio(frame) {
    if (!frame || state.framePatches.has(frame)) return;
    let win = null;
    try { win = frame.contentWindow; } catch (_) { return; }
    if (!win) return;
    state.framePatches.add(frame);

    const Context = win.AudioContext || win.webkitAudioContext;
    const contextProto = Context?.prototype;
    if (contextProto?.createOscillator && !contextProto.createOscillator.__socialRhythmNoDigitalClick) {
      const originalCreate = contextProto.createOscillator;
      const wrappedCreate = function socialRhythmCreateOscillator(...args) {
        const oscillator = originalCreate.apply(this, args);
        let metronomeFrequency = false;
        const frequency = oscillator.frequency;
        if (frequency?.setValueAtTime) {
          const originalSet = frequency.setValueAtTime.bind(frequency);
          frequency.setValueAtTime = function socialRhythmFrequency(value, time) {
            const numeric = Number(value);
            if ([880, 1080, 1320].some(target => Math.abs(numeric - target) < 0.1)) metronomeFrequency = true;
            return originalSet(value, time);
          };
        }
        const originalStart = oscillator.start?.bind(oscillator);
        const originalStop = oscillator.stop?.bind(oscillator);
        let suppressed = false;
        if (originalStart) oscillator.start = function socialRhythmOscillatorStart(...startArgs) {
          if (oscillator.type === 'square' && metronomeFrequency) {
            suppressed = true;
            state.suppressedDigitalClicks++;
            return;
          }
          return originalStart(...startArgs);
        };
        if (originalStop) oscillator.stop = function socialRhythmOscillatorStop(...stopArgs) {
          if (suppressed) return;
          return originalStop(...stopArgs);
        };
        return oscillator;
      };
      wrappedCreate.__socialRhythmNoDigitalClick = true;
      contextProto.createOscillator = wrappedCreate;
    }

    try {
      const dots = frame.contentDocument?.getElementById('metronomeDots');
      if (dots && !dots.__socialRhythmBeatObserver) {
        const observer = new win.MutationObserver(() => {
          if (chooseHeardFrame() !== frame) return;
          const duration = Math.max(1, beatMs());
          const sampled = now();
          const beatNumber = Math.round((sampled - state.originMs) / duration);
          state.originMs = sampled - beatNumber * duration;
        });
        observer.observe(dots, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
        dots.__socialRhythmBeatObserver = observer;
      }
    } catch (_) {}

    if (frame.id !== PLAYER_FRAME_ID) {
      const AudioParamClass = win.AudioParam;
      const paramProto = AudioParamClass?.prototype;
      if (paramProto?.setValueAtTime && !paramProto.setValueAtTime.__socialRhythmAmbientBoost) {
        const originalSet = paramProto.setValueAtTime;
        const wrappedSet = function socialRhythmAmbientGain(value, time) {
          let next = value;
          if (Number(value) > 0.001) {
            let stack = '';
            try { stack = new Error().stack || ''; } catch (_) {}
            if (stack.includes('playMetronomeClick')) {
              next = Number(value) * 1.5;
              state.ambientMetronomeBoosts++;
            }
          }
          return originalSet.call(this, next, time);
        };
        wrappedSet.__socialRhythmAmbientBoost = true;
        paramProto.setValueAtTime = wrappedSet;
      }
    }
  }

  function patchExistingFrames() {
    for (const frame of musicFrames()) patchFrameAudio(frame);
  }

  function playerMetronomeEnabled(frame) {
    try { return !!frame?.contentDocument?.getElementById('auditoryMetronome')?.checked; }
    catch (_) { return false; }
  }

  function updatePlayerKurrayaMetronome(timeMs) {
    const frame = document.getElementById(PLAYER_FRAME_ID);
    if (!frame || !isPlayerMusicActive() || !frameBridge(frame)?.getState) {
      state.playerMetronomeBeatIndex = null;
      state.playerMetronomeFrame = null;
      return;
    }
    patchFrameAudio(frame);
    if (!playerMetronomeEnabled(frame)) {
      state.playerMetronomeBeatIndex = null;
      return;
    }
    const index = Math.floor(beatAt(timeMs));
    if (state.playerMetronomeFrame !== frame) {
      state.playerMetronomeFrame = frame;
      state.playerMetronomeBeatIndex = index;
      return;
    }
    if (state.playerMetronomeBeatIndex == null) {
      state.playerMetronomeBeatIndex = index;
      return;
    }
    if (index === state.playerMetronomeBeatIndex) return;
    state.playerMetronomeBeatIndex = index;
    if (playCurrentTileFootstep(3, 'kurraya-metronome')) state.kurrayaMetronomeFootsteps++;
  }

  function getState() {
    return {
      bpm: state.bpm,
      timeSignature: [...state.timeSignature],
      beatGrouping: [...state.beatGrouping],
      beatMs: beatMs(),
      quarterBeatMs: quarterBeatMs(),
      measureMs: measureMs(),
      measurePhaseMs: measurePhase(),
      beat: beatAt(),
      source: state.source,
      sourceLabel: state.sourceLabel,
      revision: state.revision,
      lastHeardAtMs: state.lastHeardAtMs,
      danceGate: state.danceGate ? { ...state.danceGate } : null,
      counters: {
        rhythmSamples: state.rhythmSamples,
        danceStarts: state.danceStarts,
        danceResyncs: state.danceResyncs,
        danceFootsteps: state.danceFootsteps,
        accentedDanceFootsteps: state.accentedDanceFootsteps,
        accentedWalkingFootsteps: state.accentedWalkingFootsteps,
        kurrayaMetronomeFootsteps: state.kurrayaMetronomeFootsteps,
        suppressedDigitalClicks: state.suppressedDigitalClicks,
        ambientMetronomeBoosts: state.ambientMetronomeBoosts,
      },
    };
  }

  function frame(timeMs) {
    if (timeMs - state.lastPollAtMs >= configuredNumber('globalRhythmPollMs', 180, 50, 1000)) {
      state.lastPollAtMs = timeMs;
      patchExistingFrames();
      sampleKurrayaRhythm();
    }
    updateCharacterViewHead(timeMs);
    updateDanceFootsteps(timeMs);
    updatePlayerKurrayaMetronome(timeMs);
    global.requestAnimationFrame(frame);
  }

  resetToSessionDefault();
  chainGlobal('SocialActionWheel', patchSocialWheel);
  chainGlobal('ActionArcUI', patchActionArc);
  chainGlobal('AudioSystem', patchAudio);
  document.addEventListener?.('load', event => {
    const frame = event.target;
    if (frame?.tagName === 'IFRAME' && String(frame.getAttribute?.('src') || '').includes(MUSIC_FRAME_FRAGMENT)) patchFrameAudio(frame);
  }, true);

  global.SocialRhythmClock = Object.freeze({
    installed: true,
    getState,
    setRhythm,
    resetToSessionDefault,
    beatAt,
    beatMs,
    measureMs,
    measurePhase,
    nearestBeatDistanceMs,
    isNearBeat,
    nextBeatAt,
    dancerOffsetMs,
    dancerBeatAt,
  });

  global.requestAnimationFrame(frame);
})(window);
