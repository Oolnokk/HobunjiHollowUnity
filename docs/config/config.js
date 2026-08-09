// Shared gameplay, HUD, and editor tuning. Loaded before dependent scripts.
(function (root) {
  'use strict';
  const plateauVerticalUnit = 2.5;
  root.HOBUNJI_CONFIG = Object.freeze({
    terrain: Object.freeze({
      plateauVerticalUnit,
      // visualHeights stores normalized values. Keep its full displacement
      // strictly below one gameplay cliff tier.
      subtleHeightMaxDisplacement: plateauVerticalUnit * 0.24,
      subtleHeightMin: -1,
      subtleHeightMax: 1,
      subtleHeightDefault: 0,
      subtleHeightMaxNeighborDelta: 1.99
    }),
    editor: Object.freeze({
      visualHeightBrushStrength: 0.1,
      visualHeightBrushRadius: 1,
      visualHeightBrushMode: 'literal',
      visualHeightColorStops: Object.freeze([
        Object.freeze({ value: -1, color: '#2563eb' }),
        Object.freeze({ value: 0, color: '#f8fafc' }),
        Object.freeze({ value: 1, color: '#ef4444' })
      ])
    }),
    resourceRings: Object.freeze({
      arcs: Object.freeze({
        health: Object.freeze({ start: 292, end: 186 }),
        stamina: Object.freeze({ start: 174, end: 68 }),
        footing: Object.freeze({ start: 56, end: -56 })
      }),
      colors: Object.freeze({
        health: '#55d76f',
        stamina: '#67b7ff',
        footing: '#d9a441',
        exhausted: '#050608',
        outline: '#000000',
        target: '#ff2020'
      }),
      afflictionColors: Object.freeze({
        woundedStamina: '#ff9b2f',
        bleedingHealth: '#cf1e2e',
        congealedHealth: '#c98d41',
        infectedStamina: '#284f2a',
        windedStamina: '#90949c',
        bruisedHealth: '#4c42a9',
        shatteredStamina: '#8c4ad9',
        poisonedHealth: '#37651c'
      }),
      neon: Object.freeze({
        minSourceSaturation: 0.12,
        minSourceLightness: 0.08,
        saturation: 1,
        minLightness: 0.42,
        maxLightness: 0.6,
        glowHaloPadFraction: 0.34,
        glowHaloOpacityMultiplier: 0.75
      }),
      afflictionPulse: Object.freeze({ durationSeconds: 1, scale: 0.22, shakeUnits: 0.035 })
    })
  });

  const isToolPage = typeof location !== 'undefined' && /\/tools\//.test(location.pathname); // Used to keep every runtime-only compatibility hook out of authoring tools.

  // These legacy records have historically been authored as people who must
  // not participate in live town schedules. Two are deceased; Hammerhead was
  // previously represented as banished, and old/local database copies can
  // therefore lack the newer lifecycle wording the generic filter expects.
  const LEGACY_NONSPAWN_NPC_IDS = new Set([
    'talisman_hatayap',
    'bowstring_hatayap',
    'hammerhead_tuhupnuk',
  ]);

  function isRuntimeNonspawnNpc(npc) {
    if (!npc || typeof npc !== 'object') return false;
    if (LEGACY_NONSPAWN_NPC_IDS.has(String(npc.id || ''))) return true;
    if (npc.isDeceased === true || npc.spawnEnabled === false || npc.spawn === false) return true;
    const status = String(npc.lifecycleStatus ?? npc.lifeStatus ?? npc.status ?? '').trim().toLowerCase(); // Used to catch explicit lifecycle fields in newer database exports.
    if (status === 'deceased' || status === 'dead' || status === 'banished') return true;
    const authoredSignals = [npc.role, npc.homeId, ...(Array.isArray(npc.tags) ? npc.tags : [])]; // Used to catch legacy structured naming without scanning biography/lore prose.
    return authoredSignals.some(value => /(^|[^a-z])(deceased|dead|banished)([^a-z]|$)/i.test(String(value || '')));
  }

  function wrapRuntimeNpcDatabaseLoader(localDb) {
    if (!localDb || localDb.__hobunjiRuntimeNonspawnWrapped) return localDb;
    const originalLoadDatabase = localDb.loadDatabase; // Used to preserve the normal repo/local-source selection and dialogue composition.
    if (typeof originalLoadDatabase !== 'function') return localDb;
    localDb.loadDatabase = async function (id, ...args) {
      const data = await originalLoadDatabase.call(this, id, ...args); // Used as the already-selected database result before final spawn admission filtering.
      if (id !== 'npcDatabase' || !Array.isArray(data?.npcs)) return data;
      const removed = data.npcs.filter(isRuntimeNonspawnNpc); // Used for both the authoritative final filter and startup diagnostics.
      if (!removed.length) return data;
      const filtered = { ...data, npcs: data.npcs.filter(npc => !isRuntimeNonspawnNpc(npc)) }; // Used so stale defaultPosition data can never reach spawnScheduledNpcs.
      const message = `[NPC lifecycle] Runtime spawn gate removed ${removed.length} nonspawn NPC(s): ${removed.map(n => n.id || n.name || '<unnamed>').join(', ')}`;
      if (typeof root.debugLog === 'function') root.debugLog(message, 'schedule');
      else root.__farmLog?.(message, 'info');
      return filtered;
    };
    Object.defineProperty(localDb, '__hobunjiRuntimeNonspawnWrapped', { value: true, configurable: true });
    return localDb;
  }

  // config.js loads before local-db-overrides.js. Intercept that module's one
  // global assignment so the spawn gate is installed before game.js can ever
  // request the NPC database; this cannot lose a race to a startup schedule.
  function installRuntimeNpcSpawnGate() {
    if (isToolPage) return;
    const existing = root.LocalDBOverrides;
    if (existing) { wrapRuntimeNpcDatabaseLoader(existing); return; }
    let assignedValue; // Used only until local-db-overrides.js assigns its API object.
    try {
      Object.defineProperty(root, 'LocalDBOverrides', {
        configurable: true,
        enumerable: true,
        get() { return assignedValue; },
        set(value) {
          assignedValue = wrapRuntimeNpcDatabaseLoader(value) || value;
          Object.defineProperty(root, 'LocalDBOverrides', {
            configurable: true, enumerable: true, writable: true, value: assignedValue,
          });
        },
      });
    } catch (_) {}
  }
  installRuntimeNpcSpawnGate();

  let _hardStepLogged = false; // Used to confirm the first actual hard-surface footfall reaches the direct procedural route.
  let _footstepCadenceLogged = false; // Used to confirm the shared stride accumulator is firing after AudioSystem initialization.
  let _hardStepRouteInstallLogged = false; // Used to emit the route-install diagnostic only once across delayed install probes.

  function audioDebug(message) {
    if (typeof root.debugLog === 'function') root.debugLog(message, 'audio');
    else if (typeof root.__farmLog === 'function') root.__farmLog(`[audio] ${message}`, 'info');
    else console.info(message);
  }

  // Music's stock exterior/rain functions deliberately resolve building areas
  // to zero outdoor BGS. For interiors, run those same mixers against a
  // temporary exterior profile at a small fraction of their normal level so
  // rain/wind/birds remain perceptible through the walls instead of vanishing.
  const INDOOR_OUTDOOR_BGS_SCALE = 0.18;
  let _musicRuntimeDeps = null; // Used by the Music wrappers to identify the actual current area before applying the temporary exterior profile.
  let _lastIndoorBgsArea = ''; // Used to avoid repeating the same indoor-muffle diagnostic every audio tick.

  function withIndoorOutdoorBgsProfile(callback) {
    const musicDeps = _musicRuntimeDeps; // Used as Music's injected current-area/building-area dependency set.
    const actualArea = musicDeps?.getCurrentArea?.(); // Used to decide whether this update is occurring inside a building.
    const indoors = actualArea === 'interior'
      || !!(musicDeps && musicDeps._isBuildingArea?.(actualArea)); // Used to leave every exterior update completely unchanged.
    if (!indoors) { _lastIndoorBgsArea = ''; return callback(); }

    const audioCfg = root.AudioSystem?.gameAudioConfig?.(); // Used as the live config object Music itself reads during the wrapped call.
    const bgs = audioCfg?.bgs; // Used to temporarily scale only outdoor background layers, never furniture/interior SFX.
    if (!bgs || typeof musicDeps.getCurrentArea !== 'function') return callback();

    const originalGetCurrentArea = musicDeps.getCurrentArea; // Used to restore the real area immediately after the synchronous mixer update.
    const volumeDefaults = {
      birdsVolume: 0.25,
      nightbugsVolume: 0.23,
      wind1Volume: 0.20,
      wind2Volume: 0.18,
      gentlerainVolume: 0.45,
      midrainVolume: 0.55,
      heavyrainVolume: 0.65,
    };
    const saved = new Map(); // Used to restore every BGS config property exactly, including whether it originally existed.
    try {
      for (const [key, fallback] of Object.entries(volumeDefaults)) {
        saved.set(key, { had: Object.prototype.hasOwnProperty.call(bgs, key), value: bgs[key] });
        bgs[key] = Math.max(0, Number(bgs[key] ?? fallback) || 0) * INDOOR_OUTDOOR_BGS_SCALE;
      }
      // Music's existing mixers already know how to choose rain intensity,
      // day/night birds/bugs, and wind. Present the building as an exterior
      // only for this one mixer call, while retaining the real weather/time.
      musicDeps.getCurrentArea = () => 'farm';
      if (_lastIndoorBgsArea !== actualArea) {
        _lastIndoorBgsArea = actualArea;
        if (typeof root.debugLog === 'function') root.debugLog(`[bgs] Indoor outdoor-BGS bleed active area=${actualArea} scale=${INDOOR_OUTDOOR_BGS_SCALE}`, 'bgs');
      }
      return callback();
    } finally {
      musicDeps.getCurrentArea = originalGetCurrentArea;
      for (const [key, state] of saved) {
        if (state.had) bgs[key] = state.value;
        else delete bgs[key];
      }
    }
  }

  function wrapMusicForIndoorBgs(musicSystem) {
    if (!musicSystem || musicSystem.__hobunjiIndoorBgsWrapped) return musicSystem;
    const originalInit = musicSystem.init; // Used to retain Music's injected area helpers without changing its initialization behavior.
    if (typeof originalInit === 'function') {
      musicSystem.init = function (injectedDeps) {
        _musicRuntimeDeps = injectedDeps;
        return originalInit.call(this, injectedDeps);
      };
    }
    const originalExterior = musicSystem.updateExteriorBgs; // Used as the unchanged birds/nightbugs/wind mixer inside the temporary indoor profile.
    if (typeof originalExterior === 'function') {
      musicSystem.updateExteriorBgs = function (...args) {
        return withIndoorOutdoorBgsProfile(() => originalExterior.apply(this, args));
      };
    }
    const originalRain = musicSystem.updateRainAudio; // Used as the unchanged three-layer rain mixer inside the temporary indoor profile.
    if (typeof originalRain === 'function') {
      musicSystem.updateRainAudio = function (...args) {
        return withIndoorOutdoorBgsProfile(() => originalRain.apply(this, args));
      };
    }
    Object.defineProperty(musicSystem, '__hobunjiIndoorBgsWrapped', { value: true, configurable: true });
    return musicSystem;
  }

  // config.js is parsed before music-system.js, so capture Music's assignment
  // synchronously and have the wrapper installed before game.js calls init().
  function installIndoorBgsHook() {
    if (isToolPage) return;
    const existing = root.Music;
    if (existing) { wrapMusicForIndoorBgs(existing); return; }
    let assignedValue; // Used only until music-system.js assigns window.Music.
    try {
      Object.defineProperty(root, 'Music', {
        configurable: true,
        enumerable: true,
        get() { return assignedValue; },
        set(value) {
          assignedValue = wrapMusicForIndoorBgs(value) || value;
          Object.defineProperty(root, 'Music', {
            configurable: true, enumerable: true, writable: true, value: assignedValue,
          });
        },
      });
    } catch (_) {}
  }
  installIndoorBgsHook();

  // Exact pre-recording hard/path recipe: triangle + short band-passed noise,
  // using the old path post-FX values. It deliberately bypasses
  // AudioSystem.playFootstepSurface so no configured gravel recording can be
  // selected. Gain is raised from the historical mix so rain/music cannot
  // bury the player's own step.
  function playLegacyHardSurfaceStep(audioSystem, volumeScale = 1, pan = 0, heavy = false) {
    const audioCfg = audioSystem.gameAudioConfig?.() || {}; // Used for the same master/SFX/footstep settings as normal AudioSystem playback.
    if (audioCfg.enabled === false) return;
    const footstepCfg = audioCfg.footsteps || {}; // Used to honor the existing Footsteps enabled/volume settings.
    if (footstepCfg.enabled === false) return;
    const AudioCtx = root.AudioContext || root.webkitAudioContext; // Used to render the historical procedural path voice directly.
    if (!AudioCtx) return;
    const ctx = root._footstepAudioCtx || (root._footstepAudioCtx = new AudioCtx()); // Shared with AudioSystem so unlocking/resume behavior stays consistent.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const baseVolume = Math.max(0, Math.min(1, Number(footstepCfg.volume) || 0.65)); // Used as the authored footsteps master level.
    const sfxVolume = Math.max(0, Number(audioCfg.sfxVolume) || 1); // Used as the global SFX level.
    const finalVolume = Math.min(1, baseVolume * sfxVolume * Math.max(0, Number(volumeScale) || 0) * (heavy ? 1 : 0.9)); // Used as a deliberately audible version of the old path voice.
    if (finalVolume <= 0.002) return;

    const now = ctx.currentTime;
    const pitchMul = 1.2 * (heavy ? 0.55 : 1); // Used to match the old path pitch and AudioSystem's heavy-landing lowering.
    const durationS = 0.055 * 0.6 * (heavy ? 2.2 : 1); // Used to match the old 55ms base × path decay multiplier.
    const baseFreq = 55 * pitchMul; // Used by both the triangle fundamental and the path noise filter.
    const panNode = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null; // Used for NPC/creature hard steps; player stays centered.
    if (panNode) {
      panNode.pan.value = Math.max(-1, Math.min(1, Number(pan) || 0));
      panNode.connect(ctx.destination);
    }
    const outNode = panNode || ctx.destination;

    const osc = ctx.createOscillator(); // Used as the 18% tonal component of the historical footstep voice.
    const oscGain = ctx.createGain(); // Used to give the triangle component its short exponential decay.
    osc.type = 'triangle';
    osc.frequency.value = baseFreq + (Math.random() * 2 - 1) * 16;
    oscGain.gain.setValueAtTime(finalVolume * 0.18, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0008, now + durationS);
    osc.connect(oscGain).connect(outNode);
    osc.start(now);
    osc.stop(now + durationS);

    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * durationS)); // Used to size exactly one short noise burst per footfall.
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate); // Used as the 82% noisy component of the historical footstep voice.
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter(); // Used to recreate the old path/gravel band-pass character.
    filter.type = 'bandpass';
    filter.frequency.value = baseFreq * 4.6 * (heavy ? 0.45 : 1);
    filter.Q.value = 2.4;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(finalVolume * 0.82, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0008, now + durationS);
    noise.connect(filter).connect(noiseGain).connect(outNode);
    noise.start(now);
    noise.stop(now + durationS);
  }

  function wrapHardSurfaceAudioSystem(audioSystem) {
    if (!audioSystem) return false;
    if (audioSystem.__hobunjiDirectHardStepWrapped) return true;
    if (typeof audioSystem.playFootstepSfx !== 'function' || typeof audioSystem.footstepSurfaceKey !== 'function') return false;

    const originalPlayFootstepSfx = audioSystem.playFootstepSfx; // Used for grass/water and as the existing porch fallback path.
    audioSystem.playFootstepSfx = function (area, tile, volumeScale = 1, pan = 0, opts = {}) {
      let surfaceKey = null; // Used to ask AudioSystem itself for authoritative terrain/building classification.
      try { surfaceKey = audioSystem.footstepSurfaceKey(area, tile?.type ?? null); } catch (_) {}
      if (surfaceKey !== 'gravel') return originalPlayFootstepSfx.call(this, area, tile, volumeScale, pan, opts);
      if (!_hardStepLogged) {
        _hardStepLogged = true;
        audioDebug(`[footsteps] DIRECT legacy hard-step fired area=${area} tileType=${tile?.type ?? 'none'} ctx=${root._footstepAudioCtx?.state || 'new'}; recorded gravel clips bypassed.`);
      }
      return playLegacyHardSurfaceStep(audioSystem, volumeScale, pan, !!opts.heavy);
    };

    const originalAdvance = audioSystem.footstepAdvance; // Used only to add a one-time cadence diagnostic without changing movement timing.
    if (typeof originalAdvance === 'function') {
      audioSystem.footstepAdvance = function (state, distPx, stridePx) {
        const fires = originalAdvance.call(this, state, distPx, stridePx);
        if (fires && !_footstepCadenceLogged) {
          _footstepCadenceLogged = true;
          audioDebug(`[footsteps] cadence fired dist=${Number(distPx).toFixed(2)} stride=${Number(stridePx).toFixed(2)} playerStride=${Number(audioSystem.FOOTSTEP_PLAYER_STRIDE_PX).toFixed(2)}`);
        }
        return fires;
      };
    }

    Object.defineProperty(audioSystem, '__hobunjiDirectHardStepWrapped', { value: true, configurable: true });
    if (!_hardStepRouteInstallLogged) {
      _hardStepRouteInstallLogged = true;
      audioDebug('[footsteps] Direct legacy hard-surface route installed; gravel recordings are bypassed for AudioSystem gravel surfaces.');
    }
    return true;
  }

  // AudioSystem and BuildingDoor are parsed later in the page. Install after
  // their final wrappers exist, but well before a player can unlock audio and
  // start walking. Repeated short probes also make this resilient to future
  // script-order changes without keeping a permanent polling loop alive.
  if (!isToolPage && typeof setTimeout === 'function') {
    for (const delayMs of [0, 25, 100, 250, 500, 1000, 2500]) {
      setTimeout(() => wrapHardSurfaceAudioSystem(root.AudioSystem), delayMs);
    }
  }

  // One startup marker that appears after the debug panel exists; useful when
  // testing exact GitHack commits to distinguish a stale/cached build from the
  // branch head before chasing subsystem behavior.
  if (!isToolPage && typeof setTimeout === 'function') {
    setTimeout(() => audioDebug('[runtime patches] lifecycle gate + direct hard steps + indoor BGS hook loaded.'), 3000);
  }
})(typeof self !== 'undefined' ? self : globalThis);
