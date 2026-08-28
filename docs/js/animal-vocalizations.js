(() => {
  'use strict';

  // Converts gameplay meaning into a timed sequence of utterances. This
  // module deliberately owns no Audio objects and knows no asset paths:
  // producers request chatter/warning/growl intents, while AudioSystem is
  // injected as the renderer. Species authoring is read from the existing
  // ambient-dialogue config so sound semantics and overhead text can be
  // tuned together without coupling either system to browser audio loading.
  let deps = null;
  let authoredProfiles = {};
  const states = new WeakMap();
  const tracked = new Set();
  const PRIORITY = Object.freeze({ chatter: 1, growl: 2, warning: 3 });
  const PULSE_DURATION_S = 0.18; // Used by scalePulse/tickCreature to give each rendered utterance one brief visual beat.
  const PULSE_ADD_SCALE = 0.025; // Used by scalePulse as the tiny additive peak above the animal's composed base scale.
  const VOCAL_NOD_UP_DEG = -10; // Used by headNodOffsetDeg; negative Z pitch is upward in the animal head-rig convention.
  const PROFILE_DEFAULTS = Object.freeze({
    chatter: Object.freeze({
      repeatsMin: 2, repeatsMax: 5,
      intervalMinMs: 120, intervalMaxMs: 480,
      volumeMin: 0.16, volumeMax: 0.26,
      rateMin: 1.18, rateMax: 1.56,
      earshotTiles: 8, tailMs: 350,
      initialDelayMinS: 4, initialDelayMaxS: 12,
      cooldownMinS: 5, cooldownMaxS: 14,
      textEachUtterance: false, textLines: [],
    }),
    warning: Object.freeze({
      repeats: 3, intervalMs: 520,
      volumeMin: 0.94, volumeMax: 0.94,
      rateMin: 0.96, rateMax: 1.06,
      earshotTiles: 12, tailMs: 500,
      textEachUtterance: false, textLines: [],
    }),
    growl: Object.freeze({
      repeats: 1, intervalMs: 0,
      volumeMin: 0.76, volumeMax: 0.76,
      rateMin: 0.56, rateMax: 0.68,
      rateContour: Object.freeze([1, 1.22, 0.92]),
      earshotTiles: 10, tailMs: 1200,
      textEachUtterance: false, textLines: [],
    }),
    discoveryText: Object.freeze({ 'animal-den': Object.freeze([]), 'bandit-camp': Object.freeze([]) }),
  });
  const debug = {
    requested: 0, rendered: 0, pulsed: 0, textRendered: 0, suppressed: 0,
    lastStartLatencyMs: null, profilesLoaded: false, last: null,
  };

  function init(injectedDeps) {
    deps = injectedDeps;
    void loadAuthoredProfiles();
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
  function randomInt(min, max) {
    const lo = Math.round(Math.min(finite(min, 1), finite(max, 1)));
    const hi = Math.round(Math.max(finite(min, 1), finite(max, 1)));
    return lo + Math.floor(random() * (hi - lo + 1));
  }

  function speciesProfileKey(c) {
    const raw = String(c?.creatureKey || c?.speciesKey || c?.species || c?.def?.key || '').toLowerCase();
    return raw.replace(/-(?:mother|alpha)$/, '');
  }

  function mergeKind(base, common, species) {
    return { ...base, ...(common || {}), ...(species || {}) };
  }

  function profileFor(c) {
    const common = authoredProfiles.default || {};
    const species = authoredProfiles[speciesProfileKey(c)] || {};
    return {
      chatter: mergeKind(PROFILE_DEFAULTS.chatter, common.chatter, species.chatter),
      warning: mergeKind(PROFILE_DEFAULTS.warning, common.warning, species.warning),
      growl: mergeKind(PROFILE_DEFAULTS.growl, common.growl, species.growl),
      discoveryText: {
        ...PROFILE_DEFAULTS.discoveryText,
        ...(common.discoveryText || {}),
        ...(species.discoveryText || {}),
      },
    };
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
    } catch (_) {
      // The defaults above deliberately preserve the pre-authoring behavior
      // when the config is unavailable or an older save/build has no profiles.
    }
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
    if (kind === 'growl') {
      const repeats = clamp(Math.round(finite(opts.repeats, cfg.repeats)), 1, 6);
      const intervalS = Math.max(0, finite(opts.intervalMs, cfg.intervalMs) / 1000);
      return Array.from({ length: repeats }, (_, i) => {
        const rate = Number.isFinite(Number(opts.rate)) ? Number(opts.rate) : randomRange(cfg.rateMin, cfg.rateMax);
        const contour = Array.isArray(opts.rateContour) ? opts.rateContour : cfg.rateContour;
        return {
          atS: i * intervalS,
          volume: Number.isFinite(Number(opts.volume)) ? Number(opts.volume) : randomRange(cfg.volumeMin, cfg.volumeMax),
          rate,
          rateContour: (Array.isArray(contour) && contour.length ? contour : [1, 1.22, 0.92])
            .map(multiplier => rate * finite(multiplier, 1)),
          earshotTiles: finite(opts.earshotTiles, cfg.earshotTiles),
        };
      });
    }
    if (kind === 'warning') {
      const repeats = clamp(Math.round(finite(opts.repeats, cfg.repeats)), 1, 8);
      const intervalS = Math.max(0.08, finite(opts.intervalMs, cfg.intervalMs) / 1000);
      return Array.from({ length: repeats }, (_, i) => ({
        atS: i * intervalS,
        volume: Number.isFinite(Number(opts.volume)) ? Number(opts.volume) : randomRange(cfg.volumeMin, cfg.volumeMax),
        rate: Number.isFinite(Number(opts.rate)) ? Number(opts.rate) : randomRange(cfg.rateMin, cfg.rateMax),
        earshotTiles: finite(opts.earshotTiles, cfg.earshotTiles),
      }));
    }
    const repeats = opts.repeats == null
      ? clamp(randomInt(cfg.repeatsMin, cfg.repeatsMax), 1, 10)
      : clamp(Math.round(finite(opts.repeats, 3)), 1, 10);
    let atS = 0;
    return Array.from({ length: repeats }, (_, i) => {
      if (i) atS += randomRange(cfg.intervalMinMs, cfg.intervalMaxMs) / 1000;
      return {
        atS,
        volume: Number.isFinite(Number(opts.volume)) ? Number(opts.volume) : randomRange(cfg.volumeMin, cfg.volumeMax),
        rate: Number.isFinite(Number(opts.rate)) ? Number(opts.rate) : randomRange(cfg.rateMin, cfg.rateMax),
        earshotTiles: finite(opts.earshotTiles, cfg.earshotTiles),
      };
    });
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
    const tailS = Math.max(0.05, finite(profile[kind].tailMs, 350) / 1000);
    state.active = {
      kind, priority, reason: opts.reason || null, elapsedS: 0, nextIndex: 0,
      sequence, profile, endsAtS: sequence[sequence.length - 1].atS + tailS,
    };
    if (kind !== 'chatter') state.nextChatterS = Math.max(state.nextChatterS, 2.5);
    debug.requested++;
    debug.last = { kind, reason: opts.reason || null, species: speciesProfileKey(c) || '?', at: Date.now() };
    // The first sound is intentionally rendered synchronously with the
    // gameplay event; later repeats are advanced by tickCreature.
    renderDue(c, state);
    return true;
  }

  function textLinesFor(active) {
    // Treasure already has a dedicated, backwards-compatible text path in
    // AmbientDialogue.companionTreasure(), called by the detector before this
    // warning request. Do not duplicate that popup here.
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
      const playbackRequestedAtMs = Date.now(); // Compared at actual media start for copyable mobile latency diagnostics.
      const onStarted = () => {
        state.pulseRemainingS = PULSE_DURATION_S;
        debug.pulsed++;
        debug.lastStartLatencyMs = Math.max(0, Date.now() - playbackRequestedAtMs);
        showUtteranceText(c, active, utteranceIndex);
      }; // Called by AudioSystem only when the media element actually starts, not when playback is merely requested.
      if (deps.renderUtterance(c, {
        ...utterance, meaning: active.kind, reason: active.reason, onStarted,
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

  function companionDiscovery(c, reason, opts = {}) {
    return request(c, 'warning', { ...opts, reason });
  }

  function threatGrowl(c, reason, opts = {}) {
    return request(c, 'growl', { ...opts, reason });
  }

  function warning(c, reason, opts = {}) {
    return request(c, 'warning', { ...opts, reason });
  }

  function pulseEnvelope(c) {
    const remainingS = states.get(c)?.pulseRemainingS || 0; // Read by the optional scale helper and the live vocal head-nod layer.
    if (remainingS <= 0) return 0;
    const progress = Math.max(0, Math.min(1, 1 - remainingS / PULSE_DURATION_S));
    return Math.sin(progress * Math.PI);
  }

  // Reusable visual envelope for future effects. Vocalizations currently use
  // the additive head nod below, but callers that genuinely want a tiny body
  // pulse later can compose this scale without changing the scheduler.
  function scalePulse(c, additiveScale = PULSE_ADD_SCALE) {
    return 1 + pulseEnvelope(c) * Math.max(0, Number(additiveScale) || 0);
  }

  function headNodOffsetDeg(c) {
    return pulseEnvelope(c) * VOCAL_NOD_UP_DEG;
  }

  function debugSnapshot() {
    let active = 0, pulsing = 0, maxHeadNodDeg = 0;
    for (const c of tracked) {
      if (!c || c.health <= 0) { tracked.delete(c); continue; }
      if (states.get(c)?.active) active++;
      if ((states.get(c)?.pulseRemainingS || 0) > 0) {
        pulsing++;
        const nodDeg = headNodOffsetDeg(c); // Keeps the strongest live signed nod so mobile diagnostics preserve direction.
        if (Math.abs(nodDeg) > Math.abs(maxHeadNodDeg)) maxHeadNodDeg = nodDeg;
      }
    }
    return { ...debug, active, pulsing, maxHeadNodDeg: Number(maxHeadNodDeg.toFixed(2)) };
  }

  window.AnimalVocalizations = {
    init, tickCreature, companionDiscovery, threatGrowl, warning,
    pulseEnvelope, scalePulse, headNodOffsetDeg, debugSnapshot,
    setAuthoredProfiles, profileForDebug: profileFor,
  };
})();
