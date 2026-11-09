// Character combat vocalizations: stamina breathing, pain, dodges, and attack grunts.
// Owns only vocal playback/orchestration; combat abilities and ResourceSystem stay authoritative.
(() => {
  'use strict';

  const VERSION = 4;
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
  let lastDotPainAtMsByEntity = new WeakMap(); // Pain cadence is per character so one NPC's DoT cannot silence another's.
  let activeAbilityContext = null;
  let originalBeginStagedAction = null;
  let originalRegisterAbility = null;
  let chargeBufferPromise = null;
  let chargeBufferUrl = null;
  let chargeTokenSerial = 0;
  const liveChargesByAbility = new Map(); // Player held abilities keyed by ability id; NPC attacks use per-action tokens below.
  const activeChargeTokens = new Set(); // Used for cleanup/debug without coupling tokens to one combat archetype.
  const trackedBreathers = new Set(); // Only non-player humanoids currently below max Stamina stay in the frame scheduler set.
  const breathStateByEntity = new WeakMap(); // Per-character cadence prevents NPCs from sharing the player's next-breath clock.
  let lastBreathPlaybackHandle = null; // Mobile diagnostics inspect this handle after asynchronous render failures can switch playback to native audio.
  let pitchBackendMissingSinceMs = null; // Bounds the startup wait for the asynchronously loaded pitch renderer before native compatibility fallback.
  const VOICE_FADE_OUT_S = 0.008; // Same sudden anti-pop handoff used by dialogue ownership.
  const DODGE_DURATION_SCALE = 0.75; // Dodge compresses pain intensity 1 to 75% of its normal species/gender-modulated duration.
  const BREATH_RETRY_AFTER_SUPPRESSION_MS = 100; // Resume passive breathing promptly once pain/attack vocals release the mouth.
  const SINGLE_UTTERANCE_ABILITIES = new Set(['acceleratingFlurry']); // One grunt per strike across its whole pose sequence.
  const attackActions = new Set(); // Player staged attacks whose windup/strike/recovery still blocks buffered starts.
  const strikeBuffers = new Map(); // Decoded release/combo clips reused by the same timed renderer as charge vocals.
  const debug = {
    lastBreath: null,
    lastPain: null,
    lastDodge: null,
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

  function appearanceForEntity(entity) {
    if (entity === player()) return window.__hobunjiPlayerProfile?.appearance || {};
    return entity?.rosterRecord?.appearance
      || entity?.rec?.appearance
      || entity?.npcRecord?.appearance
      || entity?.appearance
      || {};
  }

  function isHumanoidVocalEntity(entity) {
    if (!entity) return false;
    if (entity === player()) return true;
    const appearance = appearanceForEntity(entity);
    return !!(appearance?.speciesId || entity?.npcId || entity?.rosterRecord?.appearance || entity?.rec?.appearance);
  }

  function voiceIdentity(entity = player()) {
    const appearance = appearanceForEntity(entity);
    return {
      speciesId: String(appearance.speciesId || 'default'),
      gender: appearance.gender === 'female' ? 'female' : 'male',
    };
  }

  function voiceModulation(entity = player()) {
    const { speciesId, gender } = voiceIdentity(entity);
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

  function specialVoiceFor(entity, event) {
    return window.MaskboundGuardianCombat?.voiceVariantFor?.(entity, event) || null; // Guardian-only voice preset; all ordinary players/NPCs retain their native recordings.
  }

  function voicePlaybackPlan(randomSemitones = 0, entity = player()) {
    const mod = voiceModulation(entity);
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

  function voicePriority(kind) {
    const shared = window.CharacterVoiceOwner?.priorities || {};
    if (kind === 'active') return Number(shared.active ?? 3);
    if (kind === 'pain') return Number(shared.pain ?? 2);
    return Number(shared.breath ?? 1);
  }

  function voiceSpatialOptions(entity) {
    if (!entity || entity === player()) return { panX: 0, position3d: null, extraWetBoost: 0, gain: 1, sourceActor: null, lowpassHz: 20000, area: entity?.areaId || entity?.area || null };
    const spatial = window.AudioSystem?.combatAudioSpatial?.(entity, { earshotTiles: 14 })
      || window.AudioSystem?.creatureAudioSpatial?.(entity, {}) || {};
    const gain = clamp(spatial.gain ?? 1, 0, 1); // NPC voice volume follows actual 3D separation rather than the player's full-volume mix.
    return {
      panX: clamp(spatial.panX ?? 0, -1, 1),
      position3d: spatial.position3d || null, // Shared listener-local X/Y/Z gives enemy voices the same front/back and ravine depth as weapons.
      sourceActor: spatial.sourceActor || entity, // Keeps prolonged charge grunts attached to the moving combatant.
      earshotPx: spatial.earshotPx || null, // Shared combat-volume range, reused by the live attenuation update.
      extraWetBoost: Math.max(0, Number(spatial.extraWetBoost) || 0),
      gain,
      lowpassHz: Math.round(4000 + 16000 * Math.pow(gain, 0.7)), // Distant NPC direct voices lose treble while the environmental reflections remain present.
      area: entity.areaId || entity.area || null,
    };
  }

  function fadeNativeVoice(audio, fadeOutS = VOICE_FADE_OUT_S, onFinished = null) {
    if (!audio) { onFinished?.(); return; }
    const fade = Math.max(0, Number(fadeOutS) || 0);
    if (!(fade > 0)) {
      try { audio.pause?.(); audio.currentTime = 0; } catch (_) {}
      onFinished?.();
      return;
    }
    const startVolume = Math.max(0, Number(audio.volume) || 0);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - startedAt) / Math.max(1, fade * 1000));
      try { audio.volume = startVolume * (1 - t); } catch (_) {}
      if (t < 1) return;
      clearInterval(timer);
      try { audio.pause?.(); audio.currentTime = 0; } catch (_) {}
      onFinished?.();
    }, 2);
  }

  function playOneShot(entity, url, baseVolume, pitchRandomSemitones, debugKind, detail = {}, voiceKind = 'active', durationScale = 1, overlapGroup = null) {
    if (!isHumanoidVocalEntity(entity)) return null;
    const special = specialVoiceFor(entity, debugKind === 'dodge' ? 'dodge' : debugKind === 'pain' ? 'pain' : debugKind === 'breath' ? 'breath' : 'strike'); // Attack, pain, dodge and stamina breathing share the same scream.
    url = special?.url || url; // Prevent generic human voice files from reaching the guardian's playback channel.
    if (!url) return null;
    const audio = audioConfig();
    if (audio.enabled === false || Number(audio.sfxVolume ?? 1) <= 0) return null;
    // Passive breathing may begin before the asynchronously requested playback module loads.
    // Don't immediately use native playback at startup: its browser-dependent pitch preservation can leave early breaths untransposed.
    if (voiceKind === 'breath') {
      const pitchPlayback = window.AnimalVoiceIndependentPlayback; // Shared renderer needed for consistent species/gender pitch shifting.
      if (!pitchPlayback) {
        if (pitchBackendMissingSinceMs == null) pitchBackendMissingSinceMs = nowMs();
        if (nowMs() - pitchBackendMissingSinceMs < 5000) { // Bounded wait keeps native-only/failed-load browsers from losing breathing indefinitely.
          return { suppressed: true, reason: 'pitch-renderer-loading', voiceKind, ...detail };
        }
      } else {
        pitchBackendMissingSinceMs = null;
        if (pitchPlayback.readyForIndependentPitch?.() === false) {
          return { suppressed: true, reason: 'audio-context-pending', voiceKind, ...detail };
        }
      }
    }
    const spatial = voiceSpatialOptions(entity); // Reject inaudible/off-area actors before taking their voice-priority channel.
    if (spatial.gain <= 0.002) return { suppressed: true, reason: 'outside-combat-earshot', voiceKind, ...detail };
    const claim = window.CharacterVoiceOwner?.request?.(entity, {
      kind: voiceKind,
      priority: voicePriority(voiceKind),
      overlapGroup, // Release grunts retain other release tails while remaining higher priority than pain/breath.
      preserveGroup: overlapGroup,
      fadeOutS: VOICE_FADE_OUT_S,
    }) || null;
    if (window.CharacterVoiceOwner && !claim) return { suppressed: true, reason: 'voice-priority', voiceKind, ...detail };

    const plan = voicePlaybackPlan(special ? special.pitchOffsetSemitones : randomPitchSemitones(pitchRandomSemitones), entity);
    if (special) plan.tempo *= special.tempoMultiplier; // Vary tempo independently of pitch via AnimalVoiceIndependentPlayback.
    plan.tempo /= durationScale; // Shortens dodge duration independently of the species/gender pitch.
    const volume = clamp(
      Number(baseVolume ?? 1) * plan.modulation.gain * Number(audio.sfxVolume ?? 1) * spatial.gain,
      0,
      1,
    );
    const finish = () => window.CharacterVoiceOwner?.release?.(claim);
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
          extraWetBase: 0, // Character combat voices use the area's normal wet profile; NPC distance contributes only the shared distance wet boost.
          panX: spatial.panX,
          position3d: spatial.position3d, // Shared independent-pitch renderer builds a true HRTF PannerNode for NPCs.
          sourceActor: spatial.sourceActor,
          extraWetBoost: spatial.extraWetBoost,
          lowpassHz: spatial.lowpassHz, // Web Audio dry-path filtering makes distant ravine shouts read as remote.
          area: spatial.area,
          onFinished: finish,
        });
        window.CharacterVoiceOwner?.bindStop?.(claim, fadeS => snd?.stop?.(fadeS));
      } else if (typeof Audio === 'function') {
        snd = new Audio(url);
        snd.volume = volume;
        // Emergency native playback couples speed and pitch; preserve the authored voice identity.
        setPitchPreservation(snd, Math.abs(plan.pitchSemitones) < 0.05);
        snd.playbackRate = clamp(plan.tempo * Math.pow(2, plan.pitchSemitones / 12), 0.02, 4);
        snd.addEventListener?.('ended', finish, { once: true });
        snd.addEventListener?.('error', finish, { once: true });
        window.CharacterVoiceOwner?.bindStop?.(claim, fadeS => fadeNativeVoice(snd, fadeS, finish));
        const result = snd.play();
        result?.catch?.(error => { finish(); recordPlaybackFailure(debugKind, error, url); });
      }
    } catch (error) {
      finish();
      recordPlaybackFailure(debugKind, error, url);
      return null;
    }
    if (!snd) finish();
    return {
      snd,
      claim,
      entity,
      tempo: plan.tempo,
      pitchSemitones: plan.pitchSemitones,
      modulation: plan.modulation,
      independentPitch: snd?.independentPitch ?? (snd ? Math.abs(plan.pitchSemitones) < 0.05 : false), // Report the real playback handle, not merely whether an independent renderer exists.
      suppressed: false,
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

  function playBreath(entity, atMs) {
    const intensity = chooseBreathIntensity(entity);
    const url = config.assets?.breath?.[intensity];
    const played = playOneShot(
      entity,
      url,
      config.breath?.volume ?? 0.72,
      config.breath?.pitchRandomSemitones ?? 0,
      'breath',
      { intensity },
      'breath',
    );
    lastBreathPlaybackHandle = played?.snd || null;
    debug.lastBreath = {
      atMs: Math.round(atMs),
      entity: entity?.id || entity?.npcId || entity?.name || (entity === player() ? 'player' : 'npc'),
      intensity,
      stamina: Number(entity.stamina) || 0,
      maxStamina: Number(entity.maxStamina) || 0,
      exhausted: !!entity.exhaustion?.active,
      suppressed: !!played?.suppressed,
      reason: played?.reason || null, // Identifies temporary audio-unlock suppression without using a desktop console.
      tempo: played?.tempo ?? null,
      pitchSemitones: played?.pitchSemitones ?? null,
      modulation: played?.modulation ? { ...played.modulation } : voiceModulation(entity), // Mobile diagnostics distinguish authored species pitch from randomized breath pitch.
      independentPitch: played?.independentPitch ?? null, // Records whether this particular breath used the pitch-preserving backend.
    };
    return played;
  }

  function trackBreather(entity) {
    if (!isHumanoidVocalEntity(entity) || !(Number(entity?.maxStamina) > 0) || !(Number(entity?.health) > 0)) return;
    if (entity.exhaustion?.active || Number(entity.stamina) < Number(entity.maxStamina)) trackedBreathers.add(entity);
  }

  function breathState(entity) {
    let state = breathStateByEntity.get(entity);
    if (!state) {
      state = { nextAtMs: 0, lastIntervalS: 0 };
      breathStateByEntity.set(entity, state);
    }
    return state;
  }

  function forgetEntity(entity) {
    trackedBreathers.delete(entity);
    breathStateByEntity.delete(entity);
    lastDotPainAtMsByEntity.delete(entity);
    window.CharacterVoiceOwner?.stop?.(entity, VOICE_FADE_OUT_S);
    for (const token of activeChargeTokens) if (token.entity === entity) cancelCharge(token);
  }

  function serviceBreathing(entity, atMs) {
    const currentArea = window.Combat?.deps?.getCurrentArea?.() ?? player()?.areaId; // Live map identity gates retained NPC breathers.
    const entityArea = entity?.areaId ?? entity?.area; // Runtime NPC map identity; fixtures without one retain legacy behavior.
    if (entity !== player() && (entity?._banditDisposed || (currentArea != null && entityArea != null && entityArea !== currentArea))) {
      forgetEntity(entity);
      return;
    }
    if (!isHumanoidVocalEntity(entity) || !(Number(entity?.maxStamina) > 0) || !(Number(entity?.health) > 0)) {
      trackedBreathers.delete(entity);
      return;
    }
    const state = breathState(entity);
    if (!entity.exhaustion?.active && Number(entity.stamina) >= Number(entity.maxStamina)) {
      state.nextAtMs = 0;
      state.lastIntervalS = 0;
      trackedBreathers.delete(entity);
      return; // Full-stamina fast path: no profile/intensity/audio work.
    }
    if (entity !== player()) trackedBreathers.add(entity);

    const intervalS = breathIntervalS(entity);
    if (!(state.nextAtMs > 0)) {
      const played = playBreath(entity, atMs);
      if (played?.suppressed) {
        state.nextAtMs = atMs + BREATH_RETRY_AFTER_SUPPRESSION_MS;
        return;
      }
      state.lastIntervalS = intervalS;
      state.nextAtMs = atMs + intervalS * 1000;
      return;
    }
    if (intervalS < state.lastIntervalS) state.nextAtMs = Math.min(state.nextAtMs, atMs + intervalS * 1000);
    state.lastIntervalS = intervalS;
    if (atMs < state.nextAtMs) return;

    const played = playBreath(entity, atMs);
    if (played?.suppressed) {
      state.nextAtMs = atMs + BREATH_RETRY_AFTER_SUPPRESSION_MS;
      return;
    }
    state.nextAtMs = atMs + intervalS * 1000;
  }

  function breathFrame(frameContext) {
    const atMs = Number(frameContext?.timestamp) || nowMs();
    const p = player();
    if (p) serviceBreathing(p, atMs);
    for (const entity of trackedBreathers) {
      if (entity === p) continue;
      serviceBreathing(entity, atMs);
    }
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

  function playPain(entity, kind, delta, atMs) {
    const intensity = choosePainIntensity(entity);
    if (intensity == null) return;
    const played = playOneShot(
      entity,
      config.assets?.pain?.[intensity],
      config.pain?.volume ?? 0.9,
      config.pain?.pitchRandomSemitones ?? 0,
      'pain',
      { intensity, kind },
      'pain',
    );
    debug.lastPain = {
      atMs: Math.round(atMs),
      kind,
      intensity,
      delta,
      entity: entity?.id || entity?.npcId || entity?.name || (entity === player() ? 'player' : 'npc'),
      health: Number(entity.health) || 0,
      maxHealth: Number(entity.maxHealth) || 0,
      suppressed: !!played?.suppressed,
      tempo: played?.tempo ?? null,
      pitchSemitones: played?.pitchSemitones ?? null,
    };
  }

  function playDodge(entity = player()) {
    const played = playOneShot( // Uses the same voice owner, modulation, and spatial routing as combat pain/breathing.
      entity,
      config.assets?.pain?.[1],
      config.pain?.volume ?? 0.9,
      config.pain?.pitchRandomSemitones ?? 0,
      'dodge',
      { intensity: 1, durationScale: DODGE_DURATION_SCALE },
      'active',
      DODGE_DURATION_SCALE,
    );
    debug.lastDodge = {
      atMs: Math.round(nowMs()),
      entity: entity?.id || entity?.npcId || entity?.name || (entity === player() ? 'player' : 'npc'),
      intensity: 1,
      durationScale: DODGE_DURATION_SCALE,
      suppressed: !!played?.suppressed,
      tempo: played?.tempo ?? null,
      pitchSemitones: played?.pitchSemitones ?? null,
    };
    trackBreather(entity);
    return played;
  }

  function onResourceChange(event) {
    const detail = event?.detail || {};
    const entity = detail.entity;
    if (!isHumanoidVocalEntity(entity) || !(Number(detail.delta) < 0)) return;
    trackBreather(entity);
    const atMs = nowMs();
    if (detail.immediate === true) {
      playPain(entity, 'direct', Number(detail.delta) || 0, atMs);
      return;
    }
    const repeatMs = Math.max(100, (Number(config.pain?.dotRepeatS) || 1) * 1000);
    const previous = Number(lastDotPainAtMsByEntity.get(entity));
    if (Number.isFinite(previous) && atMs - previous < repeatMs) return;
    lastDotPainAtMsByEntity.set(entity, atMs);
    playPain(entity, 'dot', Number(detail.delta) || 0, atMs);
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

  function chargeOutputGain(ctx, entity) {
    const audio = audioConfig();
    const mod = voiceModulation(entity);
    const gain = ctx.createGain();
    const spatial = voiceSpatialOptions(entity);
    gain.gain.value = clamp(
      Number(config.grunts?.volume ?? 0.86) * mod.gain * Number(audio.sfxVolume ?? 1) * spatial.gain,
      0,
      3,
    );
    const distanceGain = ctx.createGain(); // Keep spatial attenuation separate from the existing master fade that ends a held charge.
    distanceGain.gain.value = 1;
    gain.connect(distanceGain);
    gain.__combatVocalDistanceGain = distanceGain;
    const filter = spatial.lowpassHz < 18000 && typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null; // Filters distant dry grunts but leaves their acoustic reverb send unfiltered.
    if (filter) {
      filter.type = 'lowpass';
      filter.frequency.value = spatial.lowpassHz;
      distanceGain.connect(filter);
      gain.__combatVocalFilter = filter;
    }
    const dryOutput = filter || distanceGain;
    const routed = window.AudioSystem?.connectCombatSpatialDry?.(ctx, dryOutput, {
      ...spatial,
      followGain: { param: distanceGain.gain, initialGain: spatial.gain, base: 1, earshotPx: spatial.earshotPx },
    });
    if (routed) { gain.__combatVocalPanner = routed.node; gain.__combatVocalRoute = routed; } // Route tracks the source while a charge is held.
    else {
      const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      if (panner) {
        panner.pan.value = spatial.panX;
        dryOutput.connect(panner);
        panner.connect(ctx.destination);
        gain.__combatVocalPanner = panner;
      } else dryOutput.connect(ctx.destination);
    }
    gain.__combatVocalWet = window.EnvironmentalReverb?.connectWetNode?.(ctx, distanceGain, { volume: 1, extraWet: spatial.extraWetBoost, area: spatial.area }) || null; // Distance gain affects direct grunts and their reflected energy equally without interrupting the charge's master fade.
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
    if (authoritative > 0) return authoritative / (window.WeaponShapeStats?.current?.()?.speed || 1); // The live charged pose and its stretch-grunt must reach 100% together.
  }
  const fallback = Number(config.chargePlayback?.fullChargeDurationByAbility?.[abilityId]);
  return fallback > 0 ? fallback : null;
}

// Grunts are time-mapped onto authored attack phases; a short windup->strike
// interpolation can need well over the renderer's generic 4x compression.
const MAX_MAPPED_TEMPO = 16;

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
    stretchedTempo: clamp(clipDurationS / targetS, 1 / 9, MAX_MAPPED_TEMPO), // Full charge duration is gameplay-authored; species voice tempo only defines normal/catch-up speed.
    earlyReleaseNormalSpeedMul,
    catchUpTempo: clamp(baseNormalTempo * earlyReleaseNormalSpeedMul, 1 / 9, 4),
  };
}

function finishChargeToken(token) {
  if (!token || token.done) return;
  token.done = true;
  clearTimeout(token.stopTimer);
  activeChargeTokens.delete(token);
  window.CharacterVoiceOwner?.release?.(token.voiceClaim);
  try { token.output?.__combatVocalWet?.send?.disconnect?.(); } catch (_) {}
  try { token.output?.__combatVocalRoute?.dispose?.(); } catch (_) {}
  try { token.output?.__combatVocalPanner?.disconnect?.(); } catch (_) {}
  try { token.output?.__combatVocalFilter?.disconnect?.(); } catch (_) {}
  try { token.output?.__combatVocalDistanceGain?.disconnect?.(); } catch (_) {}
  try { token.output?.disconnect?.(); } catch (_) {}
}

function stopChargeToken(token, fadeOutS = VOICE_FADE_OUT_S, action = 'cancel') {
  if (!token || token.cancelled || token.done) return;
  token.cancelled = true;
  const fade = Math.max(0, Number(fadeOutS) || 0);
  if (token.ctx && token.source && token.output?.gain && fade > 0) {
    const at = token.ctx.currentTime;
    try {
      const param = token.output.gain;
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
      else {
        param.cancelScheduledValues?.(at);
        param.setValueAtTime(Math.max(0.0001, Number(param.value) || 0.0001), at);
      }
      param.linearRampToValueAtTime(0.0001, at + fade);
      stopSource(token.source, at + fade + 0.001);
      token.stopTimer = setTimeout(() => finishChargeToken(token), Math.ceil((fade + 0.004) * 1000));
    } catch (_) {
      stopSource(token.source);
      finishChargeToken(token);
    }
  } else {
    stopSource(token.source);
    finishChargeToken(token);
  }
  debug.lastCharge = {
    id: token.id,
    action,
    abilityId: token.abilityId,
    entity: token.entity?.id || token.entity?.npcId || token.entity?.name || (token.entity === player() ? 'player' : 'npc'),
    atMs: Math.round(nowMs()),
  };
}

function cancelCharge(token) {
  stopChargeToken(token, VOICE_FADE_OUT_S, 'cancel');
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
  const entity = options.entity || player();
  const special = options.voiceVariant || specialVoiceFor(entity, options.assetUrl ? 'strike' : 'charge'); // One rolled variation survives async decode and attack windup.
  const token = {
    id: ++chargeTokenSerial,
    entity,
    abilityId: options.abilityId || null,
    category: options.category || null,
    targetDurationS: Number.isFinite(Number(requestedTarget)) && Number(requestedTarget) > 0
      ? Number(requestedTarget)
      : null,
    catchUpOnRelease: options.catchUpOnRelease === true,
    createdAtMs: Number.isFinite(options.createdAtMs) ? options.createdAtMs : nowMs(),
    ready: false,
    released: false,
    cancelled: false,
    done: false,
  };
  if (!isHumanoidVocalEntity(entity) || audioConfig().enabled === false || Number(audioConfig().sfxVolume ?? 1) <= 0) { token.done = true; token.suppressed = true; return token; }
  token.voiceClaim = window.CharacterVoiceOwner?.request?.(entity, {
    kind: 'active',
    priority: voicePriority('active'),
    overlapGroup: options.overlapGroup || null,
    preserveGroup: options.preserveGroup || options.overlapGroup || null, // A new windup must not truncate a previous release tail.
    fadeOutS: VOICE_FADE_OUT_S,
  }) || null;
  if (window.CharacterVoiceOwner && !token.voiceClaim) { token.done = true; token.suppressed = true; return token; }
  window.CharacterVoiceOwner?.bindStop?.(token.voiceClaim, fadeS => stopChargeToken(token, fadeS, 'priority-preempted'));
  trackBreather(entity);
  activeChargeTokens.add(token);

  const chosenUrl = special?.url || options.assetUrl || config.assets?.chargeGrunt; // Puppets never fetch human charge/release grunt files.
  (special || options.assetUrl ? preloadStrikeBuffer(chosenUrl) : preloadChargeBuffer()).then(async buffer => { // Normal voices retain the existing shared charge buffer; guardians decode their one scream instead.
    if (!buffer || token.cancelled || token.released || token.done) {
      finishChargeToken(token);
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
    const voice = voicePlaybackPlan(special ? special.pitchOffsetSemitones : Number.isFinite(options.pitchOffsetSemitones)
      ? options.pitchOffsetSemitones // Pre-rolled by prewarmStrikeGrunt so this render is already cached.
      : randomPitchSemitones(config.grunts?.pitchRandomSemitones ?? 0), entity);
    const plan = chargeRatePlan(audibleBuffer.duration, token.targetDurationS, voice.tempo);
    if (special) { // Tempo variation is independent from pitch while preserving the shared timed-attack renderer.
      plan.stretchedTempo = clamp(plan.stretchedTempo * special.tempoMultiplier, 1 / 9, MAX_MAPPED_TEMPO);
      plan.catchUpTempo = clamp(plan.catchUpTempo * special.tempoMultiplier, 1 / 9, 4);
    }
    const renderOpts = { pitchSemitones: voice.pitchSemitones, tailPadS: 0, trimSilence: false, maxTempo: MAX_MAPPED_TEMPO };
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

    const output = chargeOutputGain(ctx, entity);
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

  function preloadStrikeBuffer(url) {
    if (!url) return Promise.resolve(null);
    if (strikeBuffers.has(url)) return strikeBuffers.get(url);
    const pending = (async () => { // Decode each configured strike clip once, outside frame updates.
      const response = await fetch(url);
      if (!response.ok) throw new Error(`strike grunt HTTP ${response.status}`);
      const ctx = ensureAudioContext(); // Charge and release voices share pitch-preserving rendering and trimming.
      if (!ctx) return null;
      return decodeAudioData(ctx, await response.arrayBuffer());
    })().catch(error => { recordPlaybackFailure('strike-decode', error, url); return null; });
    strikeBuffers.set(url, pending);
    return pending;
  }

  function attackStartDelayS() {
    let delayS = 0; // Gameplay animation timing owns the queue even when audio is muted, suppressed, or unavailable.
    let tracked = false; // A tracked attack's own utterance span is the whole gate; the frame-clamped visual clock must not outlast it.
    for (const action of attackActions) {
      if (action.cancelled || action.phase === 'done') attackActions.delete(action);
      else {
        tracked = true;
        delayS = Math.max(delayS, Math.max(0, (Number(action.totalS) || 0) - (Number(action.t) || 0)));
      }
    }
    if (tracked) return delayS;
    const timeline = window.Combat?.deps?.getWeaponAttackTimeline?.(); // The cosmetic return tail must not extend the next attack's queue.
    return Number(timeline?.activeRemainingS ?? timeline?.remainingS) || 0;
  }

  // Attack inputs during a gated attack queue only once its Strike pose is
  // reached; earlier presses are ignored rather than buffered.
  function attackQueueOpen() {
    for (const action of attackActions) {
      if (action.cancelled || action.phase === 'done') continue;
      if ((Number(action.t) || 0) < (Number(action.windupS) || 0) + (Number(action.strikeS) || 0)) return false;
    }
    const timeline = window.Combat?.deps?.getWeaponAttackTimeline?.();
    return !(Number(timeline?.strikeRemainingS) > 0);
  }

  function pickStrikeGruntUrl(category) {
    const urls = category === 'combo' ? (config.assets?.comboAttackGrunts || []) : [config.assets?.releaseGrunt];
    const available = urls.filter(Boolean);
    return available.length ? available[Math.floor(Math.random() * available.length)] : null;
  }

  // The release voice used to be pitch-rolled and WSOLA-rendered only when the
  // windup ended. With a fresh random pitch every swing the render cache never
  // hit, so on slower devices it started late (offset past its loud start) or
  // not at all, leaving only the windup grunt, which ends at the strike. Roll
  // the pitch and render at attack start; the windup-end call reuses the cache.
  function prewarmStrikeGrunt(entity, category, durationS) {
    const special = specialVoiceFor(entity, 'strike'); // Keep the same pitch/tempo variation during prewarm and strike playback.
    const url = special?.url || pickStrikeGruntUrl(category);
    if (!url || !(durationS > 0)) return url ? { url, voiceVariant: special } : null;
    const pitchOffsetSemitones = special ? special.pitchOffsetSemitones : randomPitchSemitones(config.grunts?.pitchRandomSemitones ?? 0);
    if (isHumanoidVocalEntity(entity) && audioConfig().enabled !== false && Number(audioConfig().sfxVolume ?? 1) > 0) {
      preloadStrikeBuffer(url).then(buffer => {
        const ctx = ensureAudioContext();
        const playback = window.AnimalVoiceIndependentPlayback;
        if (!buffer || !ctx || !playback?.renderDecodedIndependentBuffer) return null;
        const trim = playback.trimDecodedSilence ? playback.trimDecodedSilence(buffer, ctx, { padMs: 4 }) : { buffer };
        const audible = trim.buffer || buffer; // Same trimmed buffer object beginCharge will use (trims are cached per buffer).
        const voice = voicePlaybackPlan(pitchOffsetSemitones, entity);
        const plan = chargeRatePlan(audible.duration, durationS, voice.tempo);
        const tempo = special ? clamp(plan.stretchedTempo * special.tempoMultiplier, 1 / 9, MAX_MAPPED_TEMPO) : plan.stretchedTempo; // Match beginCharge exactly so cached pitch-preserving audio is reusable.
        return playback.renderDecodedIndependentBuffer(audible, ctx, { pitchSemitones: voice.pitchSemitones, tailPadS: 0, trimSilence: false, maxTempo: MAX_MAPPED_TEMPO, tempo });
      }).catch(() => {});
    }
    return { url, pitchOffsetSemitones, voiceVariant: special };
  }

  function playStrikeGrunt(entity, category, abilityId, durationS = 0, elapsedS = 0, preset = null) {
    const isCombo = category === 'combo';
    const url = preset?.url || specialVoiceFor(entity, 'strike')?.url || pickStrikeGruntUrl(category);
    if (!url) return;
    const played = durationS > 0 ? beginCharge({
      entity, category, abilityId, assetUrl: url, targetDurationS: durationS,
      overlapGroup: isCombo ? null : 'release-grunt',
      createdAtMs: nowMs() - Math.max(0, elapsedS) * 1000,
      pitchOffsetSemitones: preset?.pitchOffsetSemitones,
      voiceVariant: preset?.voiceVariant, // Reuse the exact enemy-specific pitch and tempo rolled during the windup.
    }) : playOneShot(
      entity,
      url,
      config.grunts?.volume ?? 0.86,
      config.grunts?.pitchRandomSemitones ?? 0,
      isCombo ? 'combo-grunt' : 'release-grunt',
      { abilityId, category },
      'active',
      1,
      isCombo ? null : 'release-grunt',
    );
    debug.lastStrike = {
      atMs: Math.round(nowMs()),
      entity: entity?.id || entity?.npcId || entity?.name || (entity === player() ? 'player' : 'npc'),
      abilityId,
      category,
      url,
      durationS,
      tempo: played?.tempo ?? null,
      pitchSemitones: played?.pitchSemitones ?? null,
    };
    return played;
  }

  function isOffensiveVocalCategory(category) {
    return category === 'combo' || category === 'quickAttack' || category === 'offensiveHold';
  }

  function isLiveStretchAbility(id) {
  const ids = config.grunts?.liveStretchAbilities || config.grunts?.liveSustainAbilities || [];
  return ids.includes(id);
}

  function stagedVoiceContext(spec = {}) {
    if (activeAbilityContext) return { ...activeAbilityContext, entity: player() };
    const entity = spec.data?.attacker || null;
    const category = spec.data?.voiceCategory || null;
    if (!isHumanoidVocalEntity(entity) || !isOffensiveVocalCategory(category)) return null;
    return {
      entity,
      id: spec.data?.voiceAbilityId || spec.data?.comboId || 'npcAttack',
      category,
      phase: 'npc-staged-action',
    };
  }

  function wrapBeginStagedAction() {
    if (!window.Combat?.beginStagedAction || window.Combat.beginStagedAction.__combatVocalWrapped) return;
    originalBeginStagedAction = window.Combat.beginStagedAction;
    const wrapped = function combatVocalStagedAction(spec = {}) {
      const context = stagedVoiceContext(spec);
      if (!context) return originalBeginStagedAction.call(this, spec);
      trackBreather(context.entity);

      const isPlayer = context.entity === player(); // Player visuals expose the strike hold separately from the cosmetic return tail.
      const timeline = isPlayer ? window.Combat.deps?.getWeaponAttackTimeline?.() : null; // Captured after the ability starts or releases its animation.
      const totalS = Math.max(0, Number(timeline?.activeRemainingS ?? timeline?.remainingS ?? ((Number(spec.windupS) || 0) + (Number(spec.strikeS) || 0) + (Number(spec.recoverS) || 0))) || 0);
      // Flurry strikes are too short to split into a windup grunt and a release grunt:
      // each strike gets one utterance mapped over its whole Windup -> Strike -> hold.
      const singleUtterance = SINGLE_UTTERANCE_ABILITIES.has(context.id);
      const windupS = singleUtterance ? 0 : Math.min(totalS, Math.max(0, Number(timeline?.windupRemainingS ?? spec.windupS) || 0)); // Neutral to Windup endpoint only; excludes the Strike interpolation.
      // The input gate (totalS) runs to the middle of the Strike hold; the release
      // voice is time-mapped over Windup -> Strike -> the end of the hold, and keeps
      // playing past the gate until it ends or the next attack's voice takes over.
      const voiceEndS = Math.max(windupS, Number(timeline?.holdEndRemainingS ?? totalS) || 0);
      const releaseS = Math.max(0, voiceEndS - windupS);
      let charge = isPlayer ? (liveChargesByAbility.get(context.id) || null) : null; // Reuse a held charge until its release boundary.
      let release = null; // Cancellation handle for the second voice phase.
      let releaseStarted = false; // A low frame rate or strike callback must not play the second grunt twice.
      if (charge) liveChargesByAbility.delete(context.id);
      if (windupS > 0 && !charge) charge = beginCharge({ entity: context.entity, targetDurationS: windupS, abilityId: context.id, category: context.category, preserveGroup: 'release-grunt' });
      const releasePreset = windupS > 0 ? prewarmStrikeGrunt(context.entity, context.category, releaseS) : null; // Rendered during the windup.
      const startRelease = elapsedS => {
        if (releaseStarted) return;
        releaseStarted = true;
        cancelCharge(charge);
        release = playStrikeGrunt(context.entity, context.category, context.id, releaseS, elapsedS, releasePreset);
      };
      if (windupS <= 0) startRelease(0);
      // gameLoop clamps dt to 0.04s, so below 25 fps the staged clock falls behind the
      // wall-clock utterance and the next attack waited after the voice had stopped.
      // Player attacks advance by real elapsed time (capped per frame so a pause can't skip the strike).
      let wallClockS = 0;
      let lastWallMs = nowMs();
      const originalStrike = spec.onStrike; // Gameplay hit callbacks retain their authored impact time.
      const originalCancel = spec.onCancel; // Canceling either phase stops its audio as well as queued starts.
      const action = originalBeginStagedAction.call(this, {
        ...spec,
        recoverS: Math.max(Number(spec.recoverS) || 0, totalS - (Number(spec.windupS) || 0) - (Number(spec.strikeS) || 0)),
        onUpdate: action => {
          if (isPlayer) {
            const atMs = nowMs();
            wallClockS += Math.min(0.25, Math.max(0, (atMs - lastWallMs) / 1000));
            lastWallMs = atMs;
            if (wallClockS > action.t) action.t = wallClockS;
          }
          if (action.t >= windupS) startRelease(Math.max(0, action.t - windupS));
          spec.onUpdate?.(action);
        },
        onStrike: (...args) => {
          // Fallback for immediate staged actions, which have no update tick.
          if (!releaseStarted) startRelease(Math.max(0, (Number(args[0]?.t) || windupS) - windupS));
          return originalStrike?.(...args);
        },
        onComplete: (...args) => {
          cancelCharge(charge);
          return spec.onComplete?.(...args); // The release voice runs on to the end of the hold.
        },
        onCancel: (...args) => {
          cancelCharge(charge);
          cancelCharge(release);
          return originalCancel?.(...args);
        },
      });
      if (context.entity === player() && action) attackActions.add(action);
      return action;
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
              entity: player(),
              abilityId: id,
              category,
              targetDurationS: liveChargeTargetDurationS(id),
              catchUpOnRelease: true,
              preserveGroup: 'release-grunt',
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
    attackActions.clear();
    lastBreathPlaybackHandle = null;
    window.Combat?.input?.abortAllPresses?.();
    lastDotPainAtMsByEntity = new WeakMap();
    trackedBreathers.clear();
    for (const value of liveChargesByAbility.values()) Promise.resolve(value).then(token => cancelCharge(token));
    liveChargesByAbility.clear();
    for (const token of [...activeChargeTokens]) cancelCharge(token);
    window.CharacterVoiceOwner?.stop?.(player(), VOICE_FADE_OUT_S);
  }

  function loadConfig() {
    let localOverride = null;
    try {
      const raw = localStorage.getItem(LOCAL_OVERRIDE_KEY);
      if (raw) localOverride = JSON.parse(raw);
    } catch (_) {}

    const request = typeof fetch === 'function'
      ? fetch(`${CONFIG_URL}?v=20261023breathPitch1`).then(response => response.ok ? response.json() : null)
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
      for (const url of [config.assets?.releaseGrunt, ...(config.assets?.comboAttackGrunts || [])]) preloadStrikeBuffer(url);
      return config;
    }).catch(error => {
      configError = error?.message || String(error);
      config = merge(clone(DEFAULT_CONFIG), localOverride || {});
      configSource = localOverride ? 'defaults+local' : 'defaults';
      preloadChargeBuffer();
      for (const url of [config.assets?.releaseGrunt, ...(config.assets?.comboAttackGrunts || [])]) preloadStrikeBuffer(url);
      return config;
    });
  }

  function installBreathScheduler() {
    if (!window.RuntimeFrameScheduler?.register) return; // Shared scheduler owns shipped frame loops; do not create a second RAF owner.
    window.RuntimeFrameScheduler.register(SCHEDULER_ID, breathFrame, {
      phase: 'post-game',
      owner: 'CombatVocalizations',
      description: 'Schedules player + humanoid NPC heavy breathing only while each character is below max Stamina.',
    });
  }

  window.addEventListener?.('hobunji-resource-change', onResourceChange);
  document.addEventListener?.('hobunjiPlayerReady', resetTransientState);
  installCombatHooks();
  installBreathScheduler();
  const configPromise = loadConfig();

  window.CombatVocalizations = {
    version: VERSION,
    latestChange: 'Release grunts overlap without interrupting one another, including between consecutive attacks and across windups; voice priority, fades, and actor cleanup remain in force. NPC combat voices use elevation-aware distance attenuation, dry-path treble rolloff and far-field reverb while player voices remain close; breathing retries during async pitch-renderer loading and Web Audio unlock before playing, keeping species/gender shifting consistent from cold startup; mobile diagnostics expose fallback status. Release spans windup through the end of the Strike hold (one utterance per Flurry strike); the input gate ends halfway through the hold and inputs queue only after the Strike pose. Dodge uses pain intensity 1 at 75% duration; all combat vocals retain species/gender modulation.',
    configPromise,
    reloadConfig: loadConfig,
    forgetEntity,
    beginCharge,
    releaseCharge,
    cancelCharge,
    playStrikeGrunt,
    prewarmStrikeGrunt,
    playDodge,
    attackStartDelayS,
    attackQueueOpen,
    chargeRatePlan,
    liveChargeTargetDurationS,
    getConfig: () => clone(config),
    getVoiceModulation: entity => ({ ...voiceModulation(entity || player()) }),
    getVoicePriority: kind => voicePriority(kind),
    debugSnapshot: () => ({
      version: VERSION,
      latestChange: window.CombatVocalizations.latestChange,
      maskboundVoiceSource: window.MaskboundGuardianCombat?.voiceSource || null, // Mobile debug proves all guardian combat utterances use the same recorded scream.
      configSource,
      configError,
      attackStartDelayS: attackStartDelayS(),
      queuedAttacks: window.Combat?.input?.queueSnapshot?.() || [],
      nextBreathInMs: (() => { const p = player(); const s = p ? breathStateByEntity.get(p) : null; return s?.nextAtMs > 0 ? Math.max(0, Math.round(s.nextAtMs - nowMs())) : null; })(),
      lastBreathIntervalS: (() => { const p = player(); return p ? breathStateByEntity.get(p)?.lastIntervalS || 0 : 0; })(),
      trackedNpcBreathers: [...trackedBreathers].filter(entity => entity !== player()).length,
      activeVoiceOwner: window.CharacterVoiceOwner?.current?.(player()) || null,
      activeReleaseGrunts: window.CharacterVoiceOwner?.debugSnapshot?.().filter(claim => claim.overlapGroup === 'release-grunt').length ?? 0, // Mobile diagnostics verify that simultaneous releases survive new attacks.
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
      lastBreath: debug.lastBreath ? {
        ...debug.lastBreath,
        independentPitch: lastBreathPlaybackHandle?.independentPitch ?? debug.lastBreath.independentPitch, // Reflects native fallback even if the decode failed after playBreath returned.
      } : null,
      lastPain: debug.lastPain ? { ...debug.lastPain } : null,
      lastDodge: debug.lastDodge ? { ...debug.lastDodge } : null,
      lastStrike: debug.lastStrike ? { ...debug.lastStrike } : null,
      lastCharge: debug.lastCharge ? { ...debug.lastCharge } : null,
      failedPlayback: debug.failedPlayback ? { ...debug.failedPlayback } : null,
      wrappedAbilities: debug.wrappedAbilities.map(entry => ({ ...entry })),
    }),
  };
})();
