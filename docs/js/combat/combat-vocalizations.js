// Player combat vocalizations: stamina breathing, pain reactions, and attack grunts.
// Owns only vocal playback/orchestration; combat abilities and ResourceSystem stay authoritative.
(() => {
  'use strict';

  const VERSION = 3;
  const CONFIG_URL = 'config/combat/combat-vocalizations.json';
  const LOCAL_OVERRIDE_KEY = 'hobunji_combat_vocalizations_override_v1';
  const SCHEDULER_ID = 'combat-vocalizations-breath';
  const DEFAULT_CONFIG = Object.freeze({
      "schema": "hobunji_combat_vocalizations.v2",
      "assets": {
          "chargeGrunt": "assets/audio/sfx/combat/sfx_chargegrunt.m4a",
          "releaseGrunt": "assets/audio/sfx/combat/sfx_releasegrunt.m4a",
          "comboAttackGrunts": [
              "assets/audio/sfx/combat/sfx_attackgrunt_1.m4a"
          ],
          "breath": {
              "1": "assets/audio/sfx/combat/sfx_heavybreath_intensity1.m4a",
              "2": "assets/audio/sfx/combat/sfx_heavybreath_intensity2.m4a",
              "3": "assets/audio/sfx/combat/sfx_heavybreath_medium_intensity3.m4a",
              "4": "assets/audio/sfx/combat/sfx_heavybreath_intensity4.m4a",
              "5": "assets/audio/sfx/combat/sfx_heavybreath_intensity5.m4a"
          },
          "pain": {
              "1": "assets/audio/sfx/combat/sfx_pain_intensity1.m4a",
              "2": "assets/audio/sfx/combat/sfx_pain_intensity2.m4a",
              "4": "assets/audio/sfx/combat/sfx_pain_intensity4.m4a",
              "5": "assets/audio/sfx/combat/sfx_pain_intensity5.m4a",
              "6": "assets/audio/sfx/combat/sfx_pain_instensity6.m4a"
          }
      },
      "breath": {
          "intervalHighStaminaS": 4.5,
          "intervalLowStaminaS": 1.25,
          "exhaustedIntervalS": 0.85,
          "pitchRandomSemitones": 0.22,
          "volume": 0.72
      },
      "pain": {
          "dotRepeatS": 0.5,
          "pitchRandomSemitones": 1.5,
          "volume": 0.9
      },
      "grunts": {
          "pitchRandomSemitones": 1.5,
          "volume": 0.86,
          "liveStretchAbilities": [
              "chargedBreaker"
          ]
      },
      "utteranceModulation": {
          "default": {
              "male": {
                  "pitchSemitones": 0,
                  "tempo": 1,
                  "gain": 1
              },
              "female": {
                  "pitchSemitones": 0,
                  "tempo": 1,
                  "gain": 1
              }
          },
          "species": {
              "mao-ao": {
                  "female": {
                      "pitchSemitones": 6,
                      "tempo": 1,
                      "gain": 1
                  },
                  "male": {
                      "pitchSemitones": 1,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "ghoul": {
                  "male": {
                      "pitchSemitones": 1,
                      "tempo": 1,
                      "gain": 1
                  },
                  "female": {
                      "pitchSemitones": 6,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "mao-ao-skeleton": {
                  "female": {
                      "pitchSemitones": 0,
                      "tempo": 1,
                      "gain": 0
                  },
                  "male": {
                      "pitchSemitones": 0,
                      "tempo": 1,
                      "gain": 0
                  }
              },
              "harlyao-skeleton": {
                  "male": {
                      "pitchSemitones": 0,
                      "tempo": 1,
                      "gain": 0
                  },
                  "female": {
                      "pitchSemitones": 0,
                      "tempo": 1,
                      "gain": 0
                  }
              },
              "harlyao": {
                  "female": {
                      "pitchSemitones": 3,
                      "tempo": 1,
                      "gain": 1
                  },
                  "male": {
                      "pitchSemitones": -5,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "porakaneki": {
                  "male": {
                      "pitchSemitones": 9,
                      "tempo": 1,
                      "gain": 1
                  },
                  "female": {
                      "pitchSemitones": 11,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "tletingan": {
                  "male": {
                      "pitchSemitones": 3,
                      "tempo": 1,
                      "gain": 1
                  },
                  "female": {
                      "pitchSemitones": 7.5,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "nuhongan": {
                  "female": {
                      "pitchSemitones": 14,
                      "tempo": 1,
                      "gain": 1
                  },
                  "male": {
                      "pitchSemitones": 7,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "kenkari": {
                  "male": {
                      "pitchSemitones": 4,
                      "tempo": 1,
                      "gain": 1
                  },
                  "female": {
                      "pitchSemitones": 8.5,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "rakakoan": {
                  "female": {
                      "pitchSemitones": 8.5,
                      "tempo": 1,
                      "gain": 1
                  },
                  "male": {
                      "pitchSemitones": 4,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "mashtzarr": {
                  "male": {
                      "pitchSemitones": -6,
                      "tempo": 1,
                      "gain": 1
                  },
                  "female": {
                      "pitchSemitones": 5,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "mammakhbuur": {
                  "female": {
                      "pitchSemitones": 4,
                      "tempo": 1,
                      "gain": 1
                  },
                  "male": {
                      "pitchSemitones": -9,
                      "tempo": 1,
                      "gain": 1
                  }
              },
              "engh-sho": {
                  "female": {
                      "pitchSemitones": 4.5,
                      "tempo": 1,
                      "gain": 1
                  },
                  "male": {
                      "pitchSemitones": 0.5,
                      "tempo": 1,
                      "gain": 1
                  }
              }
          }
      },
      "chargePlayback": {
          "earlyReleaseNormalSpeedMul": 2,
          "fullChargeDurationByAbility": {
              "chargedBreaker": 4
          }
      }
  });

  let config = clone(DEFAULT_CONFIG);
  let configSource = 'defaults';
  let configError = null;
  let installedCombatHooks = false;
  let nextBreathAtMs = 0;
  let lastBreathIntervalS = 0;
  let lastDotPainAtMs = -Infinity;
  let activeAbilityContext = null;
  let originalBeginStagedAction = null;
  let originalRegisterAbility = null;
  let chargeBufferPromise = null;
  let chargeBufferUrl = null;
  let chargeTokenSerial = 0;
  const liveChargesByAbility = new Map(); // Used by hold-release abilities to stretch one charge vocal across the full charge window.
  const activeChargeTokens = new Set(); // Used for cleanup/debug without coupling tokens to one combat archetype.
  const debug = {
    lastBreath: null,
    lastPain: null,
    lastStrike: null,
    lastCharge: null,
    failedPlayback: null,
    wrappedAbilities: [],
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function merge(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) return override == null ? base : override;
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
    }
    return out;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function player() {
    return window.Combat?.deps?.player || null;
  }

  function audioConfig() {
    return window.AudioSystem?.gameAudioConfig?.()
      || window.SCRATCHBONES_CONFIG?.game?.audio
      || window.SCRATCHBONES_CONFIG?.game?.assets?.audio
      || {};
  }

  function playerVoiceIdentity() {
    const appearance = window.__hobunjiPlayerProfile?.appearance || {};
    return {
      speciesId: String(appearance.speciesId || 'default'),
      gender: appearance.gender === 'female' ? 'female' : 'male',
    };
  }

  function voiceModulation() {
    const { speciesId, gender } = playerVoiceIdentity();
    const root = config.utteranceModulation || {};
    const fallback = root.default?.[gender] || root.default?.male || {};
    const authored = root.species?.[speciesId]?.[gender] || {};
    return {
      speciesId,
      gender,
      pitchSemitones: Number(authored.pitchSemitones ?? fallback.pitchSemitones ?? 0) || 0,
      tempo: clamp(authored.tempo ?? fallback.tempo ?? 1, 0.35, 3),
      gain: clamp(authored.gain ?? fallback.gain ?? 1, 0, 3),
    };
  }

  function randomPitchSemitones(span) {
    const amount = Math.max(0, Number(span) || 0);
    return amount > 0 ? (Math.random() * 2 - 1) * amount : 0;
  }

  function voicePlaybackPlan(randomSemitones = 0) {
    const mod = voiceModulation();
    return {
      modulation: mod,
      tempo: clamp(mod.tempo, 0.35, 3),
      pitchSemitones: clamp(mod.pitchSemitones + randomSemitones, -24, 24),
    };
  }

  function setPitchPreservation(audio, enabled) {
    try { audio.preservesPitch = enabled; } catch (_) {}
    try { audio.mozPreservesPitch = enabled; } catch (_) {}
    try { audio.webkitPreservesPitch = enabled; } catch (_) {}
  }

  function playOneShot(url, baseVolume, pitchRandomSemitones, debugKind, detail = {}) {
    if (!url) return null;
    const audio = audioConfig();
    if (audio.enabled === false || Number(audio.sfxVolume ?? 1) <= 0) return null;
    const plan = voicePlaybackPlan(randomPitchSemitones(pitchRandomSemitones));
    const volume = clamp(
      Number(baseVolume ?? 1) * plan.modulation.gain * Number(audio.sfxVolume ?? 1),
      0,
      1,
    );
    let snd = null;
    try {
      const renderer = window.AnimalVoiceIndependentPlayback?.playIndependent
        || window.AnimalVoiceIndependentPlayback?.play;
      if (renderer) {
        snd = renderer(url, {
          tempo: plan.tempo,
          pitchSemitones: plan.pitchSemitones,
          volume,
          trimSilence: true,
          tailPadS: 0,
          extraWetBase: 0, // Combat voices use the area's physical reverb profile without the animal-call extra-wet boost.
        });
      } else if (typeof Audio === 'function') {
        // Emergency fallback preserves pitch while changing tempo. Explicit pitch
        // authoring waits for the shared renderer rather than being coupled to speed.
        snd = new Audio(url);
        snd.volume = volume;
        setPitchPreservation(snd, true);
        snd.playbackRate = plan.tempo;
        const result = snd.play();
        result?.catch?.(error => recordPlaybackFailure(debugKind, error, url));
      }
    } catch (error) {
      recordPlaybackFailure(debugKind, error, url);
      return null;
    }
    return {
      snd,
      tempo: plan.tempo,
      pitchSemitones: plan.pitchSemitones,
      modulation: plan.modulation,
      independentPitch: true,
      ...detail,
    };
  }

  function recordPlaybackFailure(kind, error, url) {
    debug.failedPlayback = {
      kind,
      url,
      name: error?.name || 'Error',
      message: error?.message || String(error || 'unknown playback failure'),
      atMs: Math.round(nowMs()),
    };
    window.__farmLog?.(`[combat-vocal] ${kind} failed: ${debug.failedPlayback.message}`, 'audio');
  }

  function weightedThreeCandidate(centerIndex, maxIndex) {
    const center = clamp(Math.round(centerIndex), 0, maxIndex);
    return [
      clamp(center - 1, 0, maxIndex),
      center,
      clamp(center + 1, 0, maxIndex),
    ];
  }

  function chooseBreathIntensity(p) {
    if (p?.exhaustion?.active) {
      return [3, 4, 5][Math.floor(Math.random() * 3)]; // Intensity 4/5 are reachable only in true Exhausted state.
    }
    const max = Math.max(0.0001, Number(p?.maxStamina) || 0.0001);
    const staminaFraction = clamp((Number(p?.stamina) || 0) / max, 0, 1);
    const center = (1 - staminaFraction) * 2; // Maps non-exhausted stamina to intensity indices 1..3.
    const candidates = weightedThreeCandidate(center, 2).map(index => index + 1);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function breathIntervalS(p) {
    if (p?.exhaustion?.active) return Math.max(0.15, Number(config.breath?.exhaustedIntervalS) || 0.85);
    const max = Math.max(0.0001, Number(p?.maxStamina) || 0.0001);
    const depletion = 1 - clamp((Number(p?.stamina) || 0) / max, 0, 1);
    const slow = Math.max(0.15, Number(config.breath?.intervalHighStaminaS) || 4.5);
    const fast = Math.max(0.15, Number(config.breath?.intervalLowStaminaS) || 1.25);
    return slow + (fast - slow) * depletion;
  }

  function playBreath(p, atMs) {
    const intensity = chooseBreathIntensity(p);
    const url = config.assets?.breath?.[intensity];
    const played = playOneShot(
      url,
      config.breath?.volume ?? 0.72,
      config.breath?.pitchRandomSemitones ?? 0,
      'breath',
      { intensity },
    );
    debug.lastBreath = {
      atMs: Math.round(atMs),
      intensity,
      stamina: Number(p.stamina) || 0,
      maxStamina: Number(p.maxStamina) || 0,
      exhausted: !!p.exhaustion?.active,
      tempo: played?.tempo ?? null,
      pitchSemitones: played?.pitchSemitones ?? null,
    };
  }

  function breathFrame(frameContext) {
    const p = player();
    if (!p || !(Number(p.maxStamina) > 0) || !(Number(p.health) > 0)) return;

    // Performance fast path: at exactly full ordinary stamina there is no
    // intensity/rate/profile/audio work at all. Only the due-time sentinel is reset.
    if (!p.exhaustion?.active && Number(p.stamina) >= Number(p.maxStamina)) {
      nextBreathAtMs = 0;
      lastBreathIntervalS = 0;
      return;
    }

    const atMs = Number(frameContext?.timestamp) || nowMs();
    const intervalS = breathIntervalS(p);
    if (!(nextBreathAtMs > 0)) {
      playBreath(p, atMs); // Crossing below max stamina begins the ongoing breathing loop immediately instead of waiting through one silent interval.
      const nextInterval = breathIntervalS(p);
      lastBreathIntervalS = nextInterval;
      nextBreathAtMs = atMs + nextInterval * 1000;
      return;
    }

    // If stamina suddenly falls, shorten an already-scheduled calm breath so
    // cadence reacts immediately instead of waiting out the old high-stamina gap.
    if (intervalS < lastBreathIntervalS) {
      nextBreathAtMs = Math.min(nextBreathAtMs, atMs + intervalS * 1000);
    }
    lastBreathIntervalS = intervalS;
    if (atMs < nextBreathAtMs) return;

    playBreath(p, atMs);
    const nextInterval = breathIntervalS(p);
    lastBreathIntervalS = nextInterval;
    nextBreathAtMs = atMs + nextInterval * 1000;
  }

  function choosePainIntensity(p) {
    const keys = Object.keys(config.assets?.pain || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!keys.length) return null;
    const max = Math.max(0.0001, Number(p?.maxHealth) || 0.0001);
    const healthFraction = clamp((Number(p?.health) || 0) / max, 0, 1);
    const center = (1 - healthFraction) * (keys.length - 1);
    const candidates = weightedThreeCandidate(center, keys.length - 1).map(index => keys[index]);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function playPain(p, kind, delta, atMs) {
    const intensity = choosePainIntensity(p);
    if (intensity == null) return;
    const played = playOneShot(
      config.assets?.pain?.[intensity],
      config.pain?.volume ?? 0.9,
      config.pain?.pitchRandomSemitones ?? 0,
      'pain',
      { intensity, kind },
    );
    debug.lastPain = {
      atMs: Math.round(atMs),
      kind,
      intensity,
      delta,
      health: Number(p.health) || 0,
      maxHealth: Number(p.maxHealth) || 0,
      tempo: played?.tempo ?? null,
      pitchSemitones: played?.pitchSemitones ?? null,
    };
  }

  function onResourceChange(event) {
    const detail = event?.detail || {};
    const p = player();
    if (!p || detail.entity !== p || !(Number(detail.delta) < 0)) return;
    const atMs = nowMs();
    if (detail.immediate === true) {
      playPain(p, 'direct', Number(detail.delta) || 0, atMs);
      return;
    }
    const repeatMs = Math.max(100, (Number(config.pain?.dotRepeatS) || 1) * 1000);
    if (atMs - lastDotPainAtMs < repeatMs) return;
    lastDotPainAtMs = atMs;
    playPain(p, 'dot', Number(detail.delta) || 0, atMs);
  }

  function ensureAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = window._footstepAudioCtx || (window._footstepAudioCtx = new AudioCtx());
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    return ctx;
  }

  function decodeAudioData(context, arrayBuffer) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = value => { if (!settled) { settled = true; resolve(value); } };
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      try {
        const result = context.decodeAudioData(arrayBuffer.slice(0), done, fail);
        result?.then?.(done, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  function preloadChargeBuffer() {
    const url = config.assets?.chargeGrunt;
    if (!url || typeof fetch !== 'function') return Promise.resolve(null);
    if (chargeBufferPromise && chargeBufferUrl === url) return chargeBufferPromise;
    chargeBufferUrl = url;
    chargeBufferPromise = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`charge grunt HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const ctx = ensureAudioContext();
      if (!ctx) throw new Error('Web Audio unavailable');
      return decodeAudioData(ctx, bytes);
    })().catch(error => {
      recordPlaybackFailure('charge-decode', error, url);
      chargeBufferPromise = null;
      return null;
    });
    return chargeBufferPromise;
  }

  function chargeOutputGain(ctx) {
    const audio = audioConfig();
    const mod = voiceModulation();
    const gain = ctx.createGain();
    gain.gain.value = clamp(
      Number(config.grunts?.volume ?? 0.86) * mod.gain * Number(audio.sfxVolume ?? 1),
      0,
      3,
    );
    gain.connect(ctx.destination);
    gain.__combatVocalWet = window.EnvironmentalReverb?.connectWetNode?.(ctx, gain, { volume: 1 }) || null; // Charge grunts use the same room/cavern/temple acoustic space as ordinary world SFX.
    return gain;
  }

  function startChargeSource(ctx, rendered, output, when, progress = 0) {
  const source = ctx.createBufferSource();
  source.buffer = rendered.buffer;
  source.playbackRate.value = rendered.playbackRate; // Only explicit pitch transposition lives here; tempo was already WSOLA-rendered.
  source.connect(output);
  const offset = clamp(progress, 0, 0.999999) * Math.max(0, rendered.buffer.duration - 0.0001);
  source.start(when, offset);
  return source;
}

function stopSource(source, when = 0) {
  try { if (source) source.onended = null; } catch (_) {}
  try { source?.stop?.(when || undefined); } catch (_) {}
  try { source?.disconnect?.(); } catch (_) {}
}

function liveChargeTargetDurationS(abilityId) {
  if (abilityId === 'chargedBreaker') {
    const authoritative = Number(window.Combat?.chargedBreakerData?.MAX_CHARGE_S);
    if (authoritative > 0) return authoritative;
  }
  const fallback = Number(config.chargePlayback?.fullChargeDurationByAbility?.[abilityId]);
  return fallback > 0 ? fallback : null;
}

function chargeRatePlan(bufferDurationS, targetDurationS, normalTempo) {
  const clipDurationS = Math.max(0.001, Number(bufferDurationS) || 0.001);
  const targetS = Number(targetDurationS) > 0 ? Number(targetDurationS) : clipDurationS;
  const baseNormalTempo = Math.max(0.02, Number(normalTempo) || 1);
  const earlyReleaseNormalSpeedMul = Math.max(
    0.1,
    Number(config.chargePlayback?.earlyReleaseNormalSpeedMul) || 2,
  );
  return {
    clipDurationS,
    targetDurationS: targetS,
    normalTempo: baseNormalTempo,
    stretchedTempo: clamp(clipDurationS / targetS, 1 / 9, 4), // Full charge duration is gameplay-authored; species voice tempo only defines normal/catch-up speed.
    earlyReleaseNormalSpeedMul,
    catchUpTempo: clamp(baseNormalTempo * earlyReleaseNormalSpeedMul, 1 / 9, 4),
  };
}

function finishChargeToken(token) {
  if (!token || token.done) return;
  token.done = true;
  activeChargeTokens.delete(token);
  try { token.output?.__combatVocalWet?.send?.disconnect?.(); } catch (_) {}
  try { token.output?.disconnect?.(); } catch (_) {}
}

function cancelCharge(token) {
  if (!token || token.cancelled || token.done) return;
  token.cancelled = true;
  const stopAt = token.ctx ? token.ctx.currentTime + 0.002 : 0;
  stopSource(token.source, stopAt);
  finishChargeToken(token);
  debug.lastCharge = {
    id: token.id,
    action: 'cancel',
    abilityId: token.abilityId,
    atMs: Math.round(nowMs()),
  };
}

function releaseCharge(token) {
  if (!token || token.cancelled || token.released || token.done) return;
  token.released = true;
  if (!token.catchUpOnRelease) {
    debug.lastCharge = {
      id: token.id,
      action: 'planned-release',
      abilityId: token.abilityId,
      targetDurationS: token.targetDurationS,
      stretchedTempo: token.stretchedTempo ?? null,
      pitchSemitones: token.pitchSemitones ?? null,
      atMs: Math.round(nowMs()),
    };
    return;
  }
  if (!token.ready || !token.ctx || !token.source || !token.catchUpRendered) {
    finishChargeToken(token);
    return;
  }

  const elapsedS = Math.max(0, (nowMs() - token.createdAtMs) / 1000);
  const progress = clamp(elapsedS / Math.max(0.001, token.fullDurationS || token.targetDurationS || 1), 0, 0.999999);
  const switchAt = token.ctx.currentTime + 0.003;
  stopSource(token.source, token.ctx.currentTime + 0.002);
  token.source = startChargeSource(token.ctx, token.catchUpRendered, token.output, switchAt, progress);
  token.source.onended = () => finishChargeToken(token);
  debug.lastCharge = {
    id: token.id,
    action: 'early-release-catch-up',
    abilityId: token.abilityId,
    targetDurationS: token.targetDurationS,
    normalTempo: token.normalTempo,
    stretchedTempo: token.stretchedTempo,
    catchUpTempo: token.catchUpTempo,
    pitchSemitones: token.pitchSemitones,
    earlyReleaseNormalSpeedMul: token.earlyReleaseNormalSpeedMul,
    progress,
    atMs: Math.round(nowMs()),
  };
}

function beginCharge(options = {}) {
  const requestedTarget = options.targetDurationS ?? options.durationS;
  const token = {
    id: ++chargeTokenSerial,
    abilityId: options.abilityId || null,
    category: options.category || null,
    targetDurationS: Number.isFinite(Number(requestedTarget)) && Number(requestedTarget) > 0
      ? Number(requestedTarget)
      : null,
    catchUpOnRelease: options.catchUpOnRelease === true,
    createdAtMs: nowMs(),
    ready: false,
    released: false,
    cancelled: false,
    done: false,
  };
  activeChargeTokens.add(token);

  preloadChargeBuffer().then(async buffer => {
    if (!buffer || token.cancelled || token.released || token.done) {
      activeChargeTokens.delete(token);
      return;
    }

    const ctx = ensureAudioContext();
    const renderIndependent = window.AnimalVoiceIndependentPlayback?.renderDecodedIndependentBuffer;
    if (!ctx || !renderIndependent) {
      finishChargeToken(token);
      recordPlaybackFailure('charge-renderer', new Error('Animal-call pitch-preserving renderer unavailable'), config.assets?.chargeGrunt);
      return;
    }

    const trimDecoded = window.AnimalVoiceIndependentPlayback?.trimDecodedSilence;
    const trim = trimDecoded ? trimDecoded(buffer, ctx, { padMs: 4 }) : {
      buffer, sourceDurationS: buffer.duration, trimmedDurationS: buffer.duration, trimStartS: 0, trimEndS: 0, trimmed: false,
    };
    const audibleBuffer = trim.buffer || buffer; // Charge math uses actual audible waveform duration, not leading/trailing silence or codec padding.
    const voice = voicePlaybackPlan(randomPitchSemitones(config.grunts?.pitchRandomSemitones ?? 0));
    const plan = chargeRatePlan(audibleBuffer.duration, token.targetDurationS, voice.tempo);
    const renderOpts = { pitchSemitones: voice.pitchSemitones, tailPadS: 0, trimSilence: false };
    const [fullRendered, catchUpRendered] = await Promise.all([
      renderIndependent(audibleBuffer, ctx, { ...renderOpts, tempo: plan.stretchedTempo }),
      token.catchUpOnRelease
        ? renderIndependent(audibleBuffer, ctx, { ...renderOpts, tempo: plan.catchUpTempo })
        : Promise.resolve(null),
    ]);
    if (token.cancelled || token.released || token.done) {
      activeChargeTokens.delete(token);
      return;
    }

    const elapsedS = Math.max(0, (nowMs() - token.createdAtMs) / 1000);
    const progress = clamp(elapsedS / Math.max(0.001, fullRendered.durationS), 0, 1);
    if (progress >= 1) {
      finishChargeToken(token); // Do not start stale audio if first-use decode/render outlives the authored windup.
      return;
    }

    const output = chargeOutputGain(ctx);
    const when = ctx.currentTime + 0.003;
    token.ctx = ctx;
    token.rawBuffer = buffer;
    token.buffer = audibleBuffer;
    token.trim = trim;
    token.output = output;
    token.normalTempo = plan.normalTempo;
    token.stretchedTempo = plan.stretchedTempo;
    token.catchUpTempo = plan.catchUpTempo;
    token.pitchSemitones = voice.pitchSemitones;
    token.earlyReleaseNormalSpeedMul = plan.earlyReleaseNormalSpeedMul;
    token.fullRendered = fullRendered;
    token.catchUpRendered = catchUpRendered;
    token.fullDurationS = fullRendered.durationS;
    token.ready = true;
    token.source = startChargeSource(ctx, fullRendered, output, when, progress);
    token.source.onended = () => finishChargeToken(token);

    debug.lastCharge = {
      id: token.id,
      action: token.catchUpOnRelease ? 'begin-live-stretch' : 'begin-predetermined-stretch',
      abilityId: token.abilityId,
      targetDurationS: token.targetDurationS,
      rawBufferDurationS: buffer.duration,
      bufferDurationS: audibleBuffer.duration,
      trimmedLeadingSilenceS: trim.trimStartS || 0,
      trimmedTrailingSilenceS: trim.trimEndS || 0,
      fullDurationS: fullRendered.durationS,
      normalTempo: plan.normalTempo,
      stretchedTempo: plan.stretchedTempo,
      catchUpTempo: plan.catchUpTempo,
      pitchSemitones: voice.pitchSemitones,
      earlyReleaseNormalSpeedMul: plan.earlyReleaseNormalSpeedMul,
      progress,
      independentPitch: true,
      atMs: Math.round(nowMs()),
    };
  }).catch(error => {
    finishChargeToken(token);
    recordPlaybackFailure('charge-start', error, config.assets?.chargeGrunt);
  });
  return token;
}

  function playStrikeGrunt(category, abilityId) {
    const isCombo = category === 'combo';
    const urls = isCombo ? (config.assets?.comboAttackGrunts || []) : [config.assets?.releaseGrunt];
    const available = urls.filter(Boolean);
    if (!available.length) return;
    const url = available[Math.floor(Math.random() * available.length)];
    const played = playOneShot(
      url,
      config.grunts?.volume ?? 0.86,
      config.grunts?.pitchRandomSemitones ?? 0,
      isCombo ? 'combo-grunt' : 'release-grunt',
      { abilityId, category },
    );
    debug.lastStrike = {
      atMs: Math.round(nowMs()),
      abilityId,
      category,
      url,
      tempo: played?.tempo ?? null,
      pitchSemitones: played?.pitchSemitones ?? null,
    };
  }

  function isOffensiveVocalCategory(category) {
    return category === 'combo' || category === 'quickAttack' || category === 'offensiveHold';
  }

  function isLiveStretchAbility(id) {
  const ids = config.grunts?.liveStretchAbilities || config.grunts?.liveSustainAbilities || [];
  return ids.includes(id);
}

  function wrapBeginStagedAction() {
    if (!window.Combat?.beginStagedAction || window.Combat.beginStagedAction.__combatVocalWrapped) return;
    originalBeginStagedAction = window.Combat.beginStagedAction;
    const wrapped = function combatVocalStagedAction(spec = {}) {
      const context = activeAbilityContext;
      if (!context || !isOffensiveVocalCategory(context.category)) {
        return originalBeginStagedAction.call(this, spec);
      }

      let charge = liveChargesByAbility.get(context.id) || null;
      if (charge) {
        liveChargesByAbility.delete(context.id);
        releaseCharge(charge); // Hold-release: stop sustaining the instant gameplay leaves the held windup.
      } else {
        const preImpactS = Math.max(0, Number(spec.windupS) || 0) + Math.max(0, Number(spec.strikeS) || 0);
        if (preImpactS > 0) {
          charge = beginCharge({ targetDurationS: preImpactS, abilityId: context.id, category: context.category });
        }
      }

      const originalStrike = spec.onStrike;
      const originalCancel = spec.onCancel;
      return originalBeginStagedAction.call(this, {
        ...spec,
        onStrike: (...args) => {
          Promise.resolve(charge).then(token => releaseCharge(token));
          playStrikeGrunt(context.category, context.id);
          return originalStrike?.(...args);
        },
        onCancel: (...args) => {
          Promise.resolve(charge).then(token => cancelCharge(token));
          return originalCancel?.(...args);
        },
      });
    };
    wrapped.__combatVocalWrapped = true;
    window.Combat.beginStagedAction = wrapped;
  }

  function wrapAbilityDefinition(id, def) {
    if (!def || def.__combatVocalWrapped) return def;
    const category = def.category;
    if (!isOffensiveVocalCategory(category)) return def;

    const wrapHandler = (name, original) => {
      if (typeof original !== 'function') return original;
      return function combatVocalAbilityHandler(...args) {
        const previous = activeAbilityContext;
        activeAbilityContext = { id, category, phase: name };
        try {
          if (name === 'onHoldCancel') {
            const live = liveChargesByAbility.get(id);
            if (live) {
              liveChargesByAbility.delete(id);
              Promise.resolve(live).then(token => cancelCharge(token));
            }
          }
          const result = original.apply(this, args);
          if (name === 'onHoldStart' && category === 'offensiveHold' && isLiveStretchAbility(id)) {
            const previousLive = liveChargesByAbility.get(id);
            if (previousLive) Promise.resolve(previousLive).then(token => cancelCharge(token));
            liveChargesByAbility.set(id, beginCharge({
              abilityId: id,
              category,
              targetDurationS: liveChargeTargetDurationS(id),
              catchUpOnRelease: true,
            }));
          }
          return result;
        } finally {
          if (name === 'onHoldEnd') {
            const live = liveChargesByAbility.get(id);
            if (live) {
              liveChargesByAbility.delete(id);
              Promise.resolve(live).then(token => releaseCharge(token));
            }
          }
          activeAbilityContext = previous;
        }
      };
    };

    for (const name of ['onTap', 'onHoldStart', 'onHoldUpdate', 'onHoldEnd', 'onHoldCancel']) {
      if (typeof def[name] === 'function') def[name] = wrapHandler(name, def[name]);
    }
    def.__combatVocalWrapped = true;
    debug.wrappedAbilities.push({ id, category });
    return def;
  }

  function installCombatHooks() {
    if (installedCombatHooks || !window.Combat?.abilities) return false;
    installedCombatHooks = true;
    wrapBeginStagedAction();

    const seen = new Set();
    for (const family of ['tap', 'hold']) {
      for (const def of window.Combat.abilities.listForFamily?.(family) || []) {
        if (!def?.id || seen.has(def.id)) continue;
        seen.add(def.id);
        wrapAbilityDefinition(def.id, def);
      }
    }

    originalRegisterAbility = window.Combat.abilities.register;
    window.Combat.abilities.register = function combatVocalAwareRegister(id, def) {
      return originalRegisterAbility.call(this, id, wrapAbilityDefinition(id, def));
    };
    return true;
  }

  function resetTransientState() {
    nextBreathAtMs = 0;
    lastBreathIntervalS = 0;
    lastDotPainAtMs = -Infinity;
    for (const value of liveChargesByAbility.values()) Promise.resolve(value).then(token => cancelCharge(token));
    liveChargesByAbility.clear();
    for (const token of [...activeChargeTokens]) cancelCharge(token);
  }

  function loadConfig() {
    let localOverride = null;
    try {
      const raw = localStorage.getItem(LOCAL_OVERRIDE_KEY);
      if (raw) localOverride = JSON.parse(raw);
    } catch (_) {}

    const request = typeof fetch === 'function'
      ? fetch(`${CONFIG_URL}?v=20261013vocal3`).then(response => response.ok ? response.json() : null)
      : Promise.resolve(null);

    return request.then(authored => {
      config = merge(clone(DEFAULT_CONFIG), authored || {});
      configSource = authored ? 'repo' : 'defaults';
      if (localOverride) {
        config = merge(config, localOverride);
        configSource += '+local';
      }
      configError = null;
      chargeBufferPromise = null;
      chargeBufferUrl = null;
      preloadChargeBuffer();
      return config;
    }).catch(error => {
      configError = error?.message || String(error);
      config = merge(clone(DEFAULT_CONFIG), localOverride || {});
      configSource = localOverride ? 'defaults+local' : 'defaults';
      preloadChargeBuffer();
      return config;
    });
  }

  function installBreathScheduler() {
    if (!window.RuntimeFrameScheduler?.register) return; // Shared scheduler owns shipped frame loops; do not create a second RAF owner.
    window.RuntimeFrameScheduler.register(SCHEDULER_ID, breathFrame, {
      phase: 'post-game',
      owner: 'CombatVocalizations',
      description: 'Schedules player heavy-breath one-shots only while ordinary stamina is below 100%.',
    });
  }

  window.addEventListener?.('hobunji-resource-change', onResourceChange);
  document.addEventListener?.('hobunjiPlayerReady', resetTransientState);
  installCombatHooks();
  installBreathScheduler();
  const configPromise = loadConfig();

  window.CombatVocalizations = {
    version: VERSION,
    configPromise,
    reloadConfig: loadConfig,
    beginCharge,
    releaseCharge,
    cancelCharge,
    playStrikeGrunt,
    chargeRatePlan,
    liveChargeTargetDurationS,
    getConfig: () => clone(config),
    getVoiceModulation: () => ({ ...voiceModulation() }),
    debugSnapshot: () => ({
      version: VERSION,
      configSource,
      configError,
      nextBreathInMs: nextBreathAtMs > 0 ? Math.max(0, Math.round(nextBreathAtMs - nowMs())) : null,
      lastBreathIntervalS,
      activeCharges: [...activeChargeTokens].map(token => ({
        id: token.id,
        abilityId: token.abilityId,
        category: token.category,
        targetDurationS: token.targetDurationS,
        catchUpOnRelease: token.catchUpOnRelease,
        normalTempo: token.normalTempo ?? null,
        stretchedTempo: token.stretchedTempo ?? null,
        catchUpTempo: token.catchUpTempo ?? null,
        pitchSemitones: token.pitchSemitones ?? null,
        ready: token.ready,
        released: token.released,
        cancelled: token.cancelled,
      })),
      liveChargeAbilities: [...liveChargesByAbility.keys()],
      modulation: voiceModulation(),
      lastBreath: debug.lastBreath ? { ...debug.lastBreath } : null,
      lastPain: debug.lastPain ? { ...debug.lastPain } : null,
      lastStrike: debug.lastStrike ? { ...debug.lastStrike } : null,
      lastCharge: debug.lastCharge ? { ...debug.lastCharge } : null,
      failedPlayback: debug.failedPlayback ? { ...debug.failedPlayback } : null,
      wrappedAbilities: debug.wrappedAbilities.map(entry => ({ ...entry })),
    }),
  };
})();
