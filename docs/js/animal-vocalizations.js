(() => {
  'use strict';

  // Semantic animal-call scheduler. Audio authoring is intentionally simple:
  // each response owns an explicit list of fixed utterances, each indexed
  // recording has one global fixed base tempo/pitch, and one global size-class
  // pitch map is added on top. There are no random pitch/tempo modulation curves.
  let deps = null;
  let authoredProfiles = {};
  const states = new WeakMap();
  const tracked = new Set();
  const PRIORITY = Object.freeze({ chatter: 1, growl: 2, warning: 3 });
  const PULSE_DURATION_S = 0.18;
  const PULSE_ADD_SCALE = 0.025;
  const VOCAL_NOD_UP_DEG = -10;
  const SIZE_CLASSES = Object.freeze(['small', 'medium', 'large']);
  const DEFAULT_SIZE_PITCH = Object.freeze({ small: 2.5, medium: 0, large: -2.5 });
  const DEFAULT_UTTERANCE = Object.freeze({ tempo: 1, pitchSemitones: 0 });

  const PROFILE_DEFAULTS = Object.freeze({
    chatter: Object.freeze({
      intervalMs: 180,
      volume: 0.24,
      // Roughly a wilderness chunk's length (see wilderness-chunks.js's
      // CHUNK_TILES=16) — a real jungle carries distant calls much farther
      // than the old close-range earshot; audio-system.js's linear falloff
      // plus animal-voice-independent-playback.js's distance-scaled reverb
      // send (see creatureAudioSpatial) do the rest of the "far away and
      // echoey" work.
      earshotTiles: 16,
      tailMs: 320,
      initialDelayMinS: 4,
      initialDelayMaxS: 10,
      cooldownMinS: 5,
      cooldownMaxS: 12,
      utterances: Object.freeze([
        Object.freeze({ tempo: 1, pitchSemitones: 0 }),
        Object.freeze({ tempo: 1, pitchSemitones: 0 }),
        Object.freeze({ tempo: 1, pitchSemitones: 0 }),
      ]),
      textEachUtterance: false,
      textLines: Object.freeze([]),
    }),
    warning: Object.freeze({
      intervalMs: 420,
      volume: 0.94,
      // See chatter's earshotTiles comment — warning stays the farthest-
      // reaching call, same relative ordering as before (warning > growl >
      // chatter), just all three now scaled up to jungle range.
      earshotTiles: 18,
      tailMs: 500,
      utterances: Object.freeze([
        Object.freeze({ tempo: 1, pitchSemitones: 0 }),
        Object.freeze({ tempo: 1, pitchSemitones: 0 }),
        Object.freeze({ tempo: 1, pitchSemitones: 0 }),
      ]),
      textEachUtterance: false,
      textLines: Object.freeze([]),
    }),
    growl: Object.freeze({
      intervalMs: 0,
      volume: 0.82,
      // See chatter's earshotTiles comment.
      earshotTiles: 16,
      tailMs: 900,
      utterances: Object.freeze([Object.freeze({ tempo: 1, pitchSemitones: 0 })]),
      textEachUtterance: false,
      textLines: Object.freeze([]),
    }),
    discoveryText: Object.freeze({ 'animal-den': Object.freeze([]), 'bandit-camp': Object.freeze([]) }),
  });

  const debug = {
    requested: 0,
    rendered: 0,
    pulsed: 0,
    textRendered: 0,
    suppressed: 0,
    lastStartLatencyMs: null,
    profilesLoaded: false,
    last: null,
  };

  const MODULE_BASE_SRC = typeof document !== 'undefined' && document.currentScript?.src
    ? document.currentScript.src
    : null;
  const REVERB_MODULE_SRC = MODULE_BASE_SRC
    ? new URL('environmental-reverb.js?v=20260828room1', MODULE_BASE_SRC).href
    : null;
  const PLAYBACK_MODULE_SRC = MODULE_BASE_SRC
    ? new URL('animal-voice-independent-playback.js?v=20260828library1', MODULE_BASE_SRC).href
    : null;

  function requestEnvironmentalReverbModule() {
    if (!REVERB_MODULE_SRC || window.EnvironmentalReverb || typeof document === 'undefined') return;
    if (document.querySelector?.('script[data-hobunji-environmental-reverb]')) return;
    const script = document.createElement('script');
    script.src = REVERB_MODULE_SRC;
    script.async = false;
    script.dataset.hobunjiEnvironmentalReverb = '1';
    document.head?.appendChild(script);
  }

  function requestPlaybackModule() {
    requestEnvironmentalReverbModule();
    if (!PLAYBACK_MODULE_SRC || window.AnimalVoiceIndependentPlayback || typeof document === 'undefined') return;
    if (document.querySelector?.('script[data-hobunji-animal-independent-playback]')) return;
    const script = document.createElement('script');
    script.src = PLAYBACK_MODULE_SRC;
    script.async = true;
    script.dataset.hobunjiAnimalIndependentPlayback = '1';
    document.head?.appendChild(script);
  }

  requestEnvironmentalReverbModule();
  requestPlaybackModule();

  function init(injectedDeps) {
    deps = injectedDeps;
    void loadAuthoredProfiles();
    requestEnvironmentalReverbModule();
    requestPlaybackModule();
  }

  function random() { return deps?.random?.() ?? Math.random(); }
  function hasVoice(c) { return !!deps?.hasVoice?.(c); }
  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function randomRange(min, max) {
    const lo = finite(min, 0), hi = finite(max, lo);
    return Math.min(lo, hi) + random() * Math.max(0, Math.abs(hi - lo));
  }

  function speciesProfileKey(c) {
    const raw = String(c?.creatureKey || c?.speciesKey || c?.species || c?.def?.key || '').toLowerCase();
    return raw
      .replace(/-wild-den-mother$/, '')
      .replace(/-den-mother$/, '')
      .replace(/-(?:mother|alpha)$/, '')
      .replace(/-wild$/, '');
  }

  function creatureSizeClass(c) {
    const raw = String(c?.genotype?.sizeClass || c?.sizeClass || c?.def?.defaultSizeClass || '').toLowerCase();
    return SIZE_CLASSES.includes(raw) ? raw : 'medium';
  }

  function normalizeUtterance(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : DEFAULT_UTTERANCE;
    return {
      tempo: clamp(finite(source.tempo, 1), 0.35, 2),
      pitchSemitones: clamp(finite(source.pitchSemitones, 0), -12, 12),
    };
  }

  function normalizeUtterances(value, fallback) {
    const source = Array.isArray(value) ? value : fallback;
    if (!Array.isArray(source) || !source.length) return [];
    return source.slice(0, 12).map(normalizeUtterance);
  }

  function mergeKind(base, common, species) {
    const merged = { ...base, ...(common || {}), ...(species || {}) };
    const authoredUtterances = Array.isArray(species?.utterances)
      ? species.utterances
      : Array.isArray(common?.utterances)
        ? common.utterances
        : base.utterances;
    merged.utterances = normalizeUtterances(authoredUtterances, base.utterances);
    if (Array.isArray(species?.allowedClips)) merged.allowedClips = [...species.allowedClips];
    else if (Array.isArray(common?.allowedClips)) merged.allowedClips = [...common.allowedClips];
    else delete merged.allowedClips;
    return merged;
  }

  function globalSizePitchMap() {
    const authored = authoredProfiles.default?.sizePitchSemitones;
    return {
      small: clamp(finite(authored?.small, DEFAULT_SIZE_PITCH.small), -12, 12),
      medium: clamp(finite(authored?.medium, DEFAULT_SIZE_PITCH.medium), -12, 12),
      large: clamp(finite(authored?.large, DEFAULT_SIZE_PITCH.large), -12, 12),
    };
  }

  function profileFor(c) {
    const common = authoredProfiles.default || {};
    const species = authoredProfiles[speciesProfileKey(c)] || {};
    return {
      chatter: mergeKind(PROFILE_DEFAULTS.chatter, common.chatter, species.chatter),
      warning: mergeKind(PROFILE_DEFAULTS.warning, common.warning, species.warning),
      growl: mergeKind(PROFILE_DEFAULTS.growl, common.growl, species.growl),
      // Recording base tuning is deliberately global: the same indexed sound
      // keeps the same base identity no matter which species response uses it.
      clipTuning: { ...(common.clipTuning || {}) },
      sizePitchSemitones: globalSizePitchMap(),
      discoveryText: {
        ...PROFILE_DEFAULTS.discoveryText,
        ...(common.discoveryText || {}),
        ...(species.discoveryText || {}),
      },
    };
  }

  function sizePitchOffsetSemitones(c, profile) {
    return finite(profile?.sizePitchSemitones?.[creatureSizeClass(c)], 0);
  }

  function authoredAllowedClips(cfg, opts) {
    if (Array.isArray(opts?.allowedClips)) return [...opts.allowedClips];
    if (Array.isArray(cfg?.allowedClips)) return [...cfg.allowedClips];
    return null;
  }

  function setAuthoredProfiles(profiles) {
    authoredProfiles = profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
    debug.profilesLoaded = true;
  }

  async function loadAuthoredProfiles() {
    if (typeof fetch !== 'function') return;
    try {
      const response = await fetch('config/dialogue/ambient-dialogue.json');
      if (!response.ok) return;
      const config = await response.json();
      setAuthoredProfiles(config?.animalVocalizations || {});
    } catch (_) {}
  }

  function stateFor(c) {
    let state = states.get(c);
    if (!state) {
      const chatter = profileFor(c).chatter;
      state = {
        active: null,
        nextChatterS: randomRange(chatter.initialDelayMinS, chatter.initialDelayMaxS),
        pulseRemainingS: 0,
      };
      states.set(c, state);
      tracked.add(c);
    }
    return state;
  }

  function buildSequence(c, kind, opts, profile) {
    const cfg = profile[kind];
    const utterances = normalizeUtterances(cfg.utterances, PROFILE_DEFAULTS[kind].utterances);
    const intervalS = Math.max(0, finite(opts.intervalMs, cfg.intervalMs) / 1000);
    const sizePitch = sizePitchOffsetSemitones(c, profile);
    return utterances.map((utterance, index) => ({
      atS: index * intervalS,
      volume: clamp(finite(opts.volume, cfg.volume), 0, 1),
      tempo: utterance.tempo,
      pitchSemitones: utterance.pitchSemitones,
      sizePitchSemitones: sizePitch,
      earshotTiles: Math.max(1, finite(opts.earshotTiles, cfg.earshotTiles)),
      allowedClips: authoredAllowedClips(cfg, opts),
      clipTuning: profile.clipTuning,
    }));
  }

  function request(c, requestedKind, opts = {}) {
    if (!deps || !c || c.health <= 0 || !hasVoice(c)) return false;
    const kind = requestedKind === 'discovery' ? 'warning' : requestedKind;
    const priority = PRIORITY[kind];
    if (!priority) return false;
    const state = stateFor(c);
    if (state.active && priority <= state.active.priority) {
      debug.suppressed++;
      return false;
    }
    const profile = profileFor(c);
    const sequence = buildSequence(c, kind, opts, profile);
    if (!sequence.length) return false;
    const tailS = Math.max(0.05, finite(profile[kind].tailMs, 350) / 1000);
    state.active = {
      kind,
      priority,
      reason: opts.reason || null,
      elapsedS: 0,
      nextIndex: 0,
      sequence,
      profile,
      endsAtS: sequence[sequence.length - 1].atS + tailS,
    };
    if (kind !== 'chatter') state.nextChatterS = Math.max(state.nextChatterS, 2.5);
    debug.requested++;
    debug.last = {
      kind,
      reason: opts.reason || null,
      species: speciesProfileKey(c) || '?',
      sizeClass: creatureSizeClass(c),
      at: Date.now(),
    };
    renderDue(c, state);
    return true;
  }

  function textLinesFor(active) {
    if (active.reason === 'treasure') return [];
    const reasonLines = active.reason ? active.profile.discoveryText?.[active.reason] : null;
    if (Array.isArray(reasonLines) && reasonLines.length) return reasonLines;
    const genericLines = active.profile[active.kind]?.textLines;
    return Array.isArray(genericLines) ? genericLines : [];
  }

  function showUtteranceText(c, active, utteranceIndex) {
    const cfg = active.profile[active.kind] || {};
    if (utteranceIndex > 0 && cfg.textEachUtterance !== true) return;
    const lines = textLinesFor(active);
    if (!lines.length || !c?.avatarRef?.group || !window.AmbientDialogue?.show) return;
    const line = lines[Math.floor(random() * lines.length)] || '';
    if (!String(line).trim()) return;
    window.AmbientDialogue.show(c.avatarRef.group, line, {
      speakerId: c.id,
      mode: 'overhead',
      durationMs: Math.max(500, finite(cfg.textDurationMs, 1600)),
      tone: 'animal',
    });
    debug.textRendered++;
  }

  function renderDue(c, state) {
    const active = state.active;
    if (!active) return;
    while (active.nextIndex < active.sequence.length
      && active.sequence[active.nextIndex].atS <= active.elapsedS + 0.0001) {
      const utteranceIndex = active.nextIndex;
      const utterance = active.sequence[active.nextIndex++];
      const playbackRequestedAtMs = Date.now();
      const onStarted = () => {
        state.pulseRemainingS = PULSE_DURATION_S;
        debug.pulsed++;
        debug.lastStartLatencyMs = Math.max(0, Date.now() - playbackRequestedAtMs);
        showUtteranceText(c, active, utteranceIndex);
      };
      if (deps.renderUtterance(c, {
        ...utterance,
        meaning: active.kind,
        reason: active.reason,
        utteranceIndex,
        onStarted,
      })) debug.rendered++;
    }
    if (active.nextIndex >= active.sequence.length && active.elapsedS >= active.endsAtS) state.active = null;
  }

  function tickCreature(c, dt, opts = {}) {
    if (!deps || !c || c.health <= 0 || !hasVoice(c)) return;
    const state = stateFor(c);
    const step = Math.max(0, Number(dt) || 0);
    state.pulseRemainingS = Math.max(0, state.pulseRemainingS - step);
    if (state.active) {
      state.active.elapsedS += step;
      renderDue(c, state);
    }
    const threatened = opts.threatened ?? (
      ['attack', 'attacking', 'chase', 'chasing', 'aggro', 'hostile', 'flee', 'fleeing', 'patrol-chase']
        .includes(String(c.state || '').toLowerCase())
      || !!(c.target || c.combatTarget || c.attackTarget || c.aggroTarget || c.targetCreature)
    );
    const chatter = profileFor(c).chatter;
    if (opts.allowPassive === false || threatened) {
      state.nextChatterS = Math.max(state.nextChatterS, 2.5);
      return;
    }
    state.nextChatterS -= step;
    if (state.nextChatterS > 0 || state.active) return;
    request(c, 'chatter');
    state.nextChatterS = randomRange(chatter.cooldownMinS, chatter.cooldownMaxS);
  }

  function companionDiscovery(c, reason, opts = {}) { return request(c, 'warning', { ...opts, reason }); }
  function threatGrowl(c, reason, opts = {}) { return request(c, 'growl', { ...opts, reason }); }
  function warning(c, reason, opts = {}) { return request(c, 'warning', { ...opts, reason }); }

  function pulseEnvelope(c) {
    const remainingS = states.get(c)?.pulseRemainingS || 0;
    if (remainingS <= 0) return 0;
    const progress = Math.max(0, Math.min(1, 1 - remainingS / PULSE_DURATION_S));
    return Math.sin(progress * Math.PI);
  }
  function scalePulse(c, additiveScale = PULSE_ADD_SCALE) {
    return 1 + pulseEnvelope(c) * Math.max(0, Number(additiveScale) || 0);
  }
  function headNodOffsetDeg(c) { return pulseEnvelope(c) * VOCAL_NOD_UP_DEG; }

  function debugSnapshot() {
    let active = 0, pulsing = 0, maxHeadNodDeg = 0;
    for (const c of tracked) {
      if (!c || c.health <= 0) { tracked.delete(c); continue; }
      if (states.get(c)?.active) active++;
      if ((states.get(c)?.pulseRemainingS || 0) > 0) {
        pulsing++;
        const nodDeg = headNodOffsetDeg(c);
        if (Math.abs(nodDeg) > Math.abs(maxHeadNodDeg)) maxHeadNodDeg = nodDeg;
      }
    }
    return {
      ...debug,
      active,
      pulsing,
      playback: window.AnimalVoiceIndependentPlayback?.debugSnapshot?.() || null,
      maxHeadNodDeg: Number(maxHeadNodDeg.toFixed(2)),
    };
  }

  window.AnimalVocalizations = {
    init,
    tickCreature,
    companionDiscovery,
    threatGrowl,
    warning,
    pulseEnvelope,
    scalePulse,
    headNodOffsetDeg,
    debugSnapshot,
    setAuthoredProfiles,
    profileForDebug: profileFor,
    creatureSizeClass,
  };
})();