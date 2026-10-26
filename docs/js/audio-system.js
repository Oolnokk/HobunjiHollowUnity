(() => {
  'use strict';

  // Footstep / one-shot combat / object / creature sound effects — extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern already used by js/combat/*.js and js/mount-system.js. Does NOT
  // include the background-music (bgm) system (playMusicTrack and friends),
  // which is a separate, larger subsystem left in game.js for a future pass
  // — the few bgm-side helpers this module needs (isRealMediaError,
  // markAudioUrlFailed, audioUrlFailed) are passed in via deps instead.
  let deps = null;
  const activeSfx = new Set(); // Intro audio cleanup stops one-shots and pooled voices already in flight.
  let introductionMix = null; // Single owner restores audio settings after success/cancellation.
  const objectSfxPreloads = new Map(); // Retains eagerly loaded tool cues for low-latency clones in playObjectSfx.
  const combatSfxPreloads = new Map(); // URL -> bounded ready-element pool used so rapid combat cues cannot queue indefinitely.
  const animalVoicePreloads = new Map(); // Keeps species calls decoded/ready before a semantic vocal intent fires.
  const footstepAudioPools = new Map(); // URL -> reusable preloaded native-audio voices used by every recorded footstep.
  let footstepUnlockListenersInstalled = false; // Prevents duplicate touch/key priming listeners if AudioSystem.init is wrapped or repeated.
  let footstepPlayRequestCount = 0; // Shown in mobile diagnostics to prove cadence reached actual media playback.
  let footstepPlayStartedCount = 0; // Shown in mobile diagnostics to distinguish successful starts from requested footsteps.
  let footstepPlayFailureCount = 0; // Shown in mobile diagnostics when native media playback rejects or throws.
  let footstepPrimeFailureCount = 0; // Shown in mobile diagnostics when a gesture-time pooled voice prime fails.
  let lastFootstepPlayError = null; // Keeps the newest media failure copyable without requiring a browser console.
  let lastFootstepPlayErrorKey = null; // Suppresses repeated identical footstep failure lines in the in-game debug log.
  let lastObjectSfxKeyDebug = null; // Reported by Pixel Probe to diagnose cue lookup/preload timing on mobile.
  let lastCombatSfxDebug = null; // Reported by Pixel Probe to verify swing index, damage type, and impact size on mobile.
  let lastCombatSpatialDebug = null; // Retains source distance/elevation/gain for the mobile-copyable combat audio report.
  const combatDecodedByUrl = new Map(); // Cache shares decoded one-shot weapons, impacts and blocks without allocating a new media source per hit.
  const combatDecodeQueue = []; // Bounded preloads prevent large simultaneous decode spikes during wilderness startup.
  const activePositionalCombat = new Set(); // Stops positional Web Audio sources when the introduction takes sole ownership of the soundscape.
  const activeDirectionalRoutes = new Set(); // Retains HRTF routes only for the duration of their active audio source.
  let lastDirectionalRouteUpdateMs = 0; // Limits updates for moving combatants and camera turns to around 12 Hz.
  let directionalRouteSchedulerInstalled = false; // Guards against installing more than one frame update.
  let combatDecodeInFlight = 0; // Limits startup decoding to two cues at once.
  let combatPositionalContext = null; // Dedicated one-shot context isolates camera-relative HRTF listener coordinates from music/weather graphs.
  let combatSpatialBackend = 'native-fallback'; // Exposed in mobile diagnostics to distinguish true HRTF from a degraded output path.
  let combatSpatialFallbacks = 0; // Counts unavoidable unpositioned plays before decode or on Web Audio-incompatible browsers.
  let combatSpatialStarts = 0; // Counts actual Web Audio directional weapon/impact playback.
  let combatSpatialLastError = null; // Readable decoder/graph failure without a console.
  let lastFootstepSfxDebug = null; // Exposed by footstepSfxDebugSnapshot and mirrored into the in-game debug log on surface changes.
  let lastFootstepDebugSurface = null; // Prevents the mobile-readable debug log from receiving one line for every individual footfall.
  function init(injectedDeps) {
    deps = injectedDeps;
    installCombatGestureUnlock(); // Warm audio unlock happens on a trusted gesture, before the next wilderness attack.
    installCombatDirectionalUpdates(); // Turn the camera mid-grunt without leaving an enemy pinned to an old ear.
    preloadConfiguredObjectSfx();
    preloadConfiguredCombatSfx();
    preloadSpecialCombatSfx(); // Drenkirra projectile sounds are authored separately from the shared combat manifest.
    preloadAnimalVoices();
    preloadConfiguredFootstepSfx();
    installFootstepAudioUnlock();
    preloadHardFootstepNormalization();
  }

  function gameAudioConfig() {
    const direct = window.SCRATCHBONES_CONFIG?.game?.audio;
    if (direct && Object.keys(direct).length) return direct;
    return window.SCRATCHBONES_CONFIG?.game?.assets?.audio || {};
  }

  // ── Footstep SFX ──────────────────────────────────────────────────
  // Real recordings (docs/assets/audio/sfx/footsteps), keyed by a coarse
  // "surface" rather than raw TileType — several tile types share a
  // footstep (e.g. grass and weeds both sound like grass underfoot).
  // Roads plus every building/den/mine interior use the dedicated hard-step
  // recording pool; loose/exposed exterior ground keeps gravelstep.
  //
  // Recorded footsteps deliberately use reusable HTMLAudioElement voices,
  // not a freshly-created Audio(url) on every stride. The old disposable
  // path swallowed play() rejections and gave mobile autoplay policy no
  // persistent voice to prime/retry; it could therefore execute perfectly
  // while remaining completely silent. Reusing preloaded voices also removes
  // per-step fetch/decode startup from the movement frame.
  //
  // Each surface's clip list normally comes from config
  // (audio.footsteps.surfaces[key].urls, see scratchbones-config.js) —
  // FOOTSTEP_POST_FX also carries the dedicated hard-step and snow-step URLs
  // so runtime-owned surface recordings work immediately without duplicating
  // them into the large audio config. The remaining fields are oscillator+
  // noise synth fallback tuning used when no urls are configured for a surface.
  const FOOTSTEP_BASE = Object.freeze({
    waveform: 'triangle', freq: 55, freqVarianceHz: 16, durationMs: 55, noiseMix: 0.82, volume: 0.6,
  });

  const HARD_FOOTSTEP_URLS = Object.freeze([
    'assets/audio/sfx/footsteps/hardstep_1.mp3',
    'assets/audio/sfx/footsteps/hardstep_2.mp3',
    'assets/audio/sfx/footsteps/hardstep_3.mp3',
  ]);
  const SNOW_FOOTSTEP_URLS = Object.freeze([ // Used by the Western Slope snow surface and startup footstep preloading below.
    'assets/audio/sfx/footsteps/sfx_snowstep_1.mp3',
    'assets/audio/sfx/footsteps/sfx_snowstep_2.mp3',
    'assets/audio/sfx/footsteps/sfx_snowstep_3.mp3',
    'assets/audio/sfx/footsteps/sfx_snowstep_4.mp3',
    'assets/audio/sfx/footsteps/sfx_snowstep_5.mp3',
    'assets/audio/sfx/footsteps/sfx_snowstep_6.mp3',
  ]);
  const HARD_FOOTSTEP_TARGET_DBFS = -6; // Used by the one-time decoder scan below to peak-normalize every hard-step recording consistently.
  const HARD_FOOTSTEP_TARGET_PEAK = Math.pow(10, HARD_FOOTSTEP_TARGET_DBFS / 20); // Converts the authored dBFS target to the linear amplitude used by Web Audio.
  const hardFootstepNormalizationGainByUrl = new Map(); // Used by hard-step playback to apply each clip's cached -6 dBFS peak-normalization multiplier.
  const hardFootstepNormalizationPromiseByUrl = new Map(); // Used to dedupe asynchronous fetch/decode scans when startup and first playback overlap.
  const FOOTSTEP_AUDIO_POOL_SIZE = 2; // Two persistent voices per recording allow nearby NPC/player steps to overlap without spawning disposable media elements.

  const FOOTSTEP_POST_FX = Object.freeze({
    grass:  {},
    gravel: { filterFreqMul: 4.6, filterQ: 2.4, durationMul: 0.6, pitchMul: 1.2, volumeMul: 0.9 },
    hard:   { urls: HARD_FOOTSTEP_URLS, volumeMul: 1.0 },
    snow:   { urls: SNOW_FOOTSTEP_URLS, volumeMul: 3.0 },
    water:  { filterFreqMul: 5.5, filterQ: 1.0, durationMul: 1.3, pitchMul: 1.7, volumeMul: 1.0, filterType: 'highpass' },
  });

  function configuredFootstepUrls() {
    const urls = new Set([...HARD_FOOTSTEP_URLS, ...SNOW_FOOTSTEP_URLS]); // Includes both runtime-owned recorded surfaces even though neither is duplicated in config.
    const surfaces = gameAudioConfig().footsteps?.surfaces || {};
    for (const surface of Object.values(surfaces)) {
      if (surface?.url) urls.add(surface.url);
      for (const url of surface?.urls || []) if (url) urls.add(url);
    }
    return [...urls];
  }

  function createFootstepAudioVoice(url, poolIndex) {
    const snd = new Audio(url);
    snd.preload = 'auto';
    snd.dataset.footstepUrl = url;
    snd.dataset.footstepPoolIndex = String(poolIndex);
    snd.addEventListener?.('error', () => {
      const error = snd.error;
      recordFootstepPlayFailure(url, error || new Error('footstep media error'), 'media-error');
    });
    try { snd.load?.(); } catch (_) {}
    return snd;
  }

  function ensureFootstepAudioPool(url) {
    if (!url || typeof Audio !== 'function') return null;
    if (footstepAudioPools.has(url)) return footstepAudioPools.get(url);
    const pool = [];
    for (let i = 0; i < FOOTSTEP_AUDIO_POOL_SIZE; i++) pool.push(createFootstepAudioVoice(url, i));
    footstepAudioPools.set(url, pool);
    return pool;
  }

  function preloadConfiguredFootstepSfx() {
    if (typeof Audio !== 'function') return;
    for (const url of configuredFootstepUrls()) ensureFootstepAudioPool(url);
  }

  function acquireFootstepAudio(url) {
    const pool = ensureFootstepAudioPool(url);
    if (!pool?.length) return null;
    const available = pool.find(snd => snd.paused || snd.ended);
    const snd = available || pool.reduce((oldest, candidate) =>
      (candidate._footstepRequestedAt || 0) < (oldest._footstepRequestedAt || 0) ? candidate : oldest);
    if (!snd.paused) snd.pause();
    try { snd.currentTime = 0; } catch (_) {}
    snd._footstepRequestedAt = performance.now();
    return snd;
  }

  function recordFootstepPlayFailure(url, error, phase = 'play') {
    footstepPlayFailureCount += phase === 'play' ? 1 : 0;
    footstepPrimeFailureCount += phase === 'prime' ? 1 : 0;
    const errorName = error?.name || error?.code || 'Error';
    const message = error?.message || String(error || 'unknown media failure');
    lastFootstepPlayError = { phase, url, errorName: String(errorName), message, atMs: Math.round(performance.now()) };
    if (lastFootstepSfxDebug) {
      lastFootstepSfxDebug.playState = 'failed';
      lastFootstepSfxDebug.playError = { phase, name: String(errorName), message };
    }
    const key = `${phase}|${url}|${errorName}|${message}`;
    if (key === lastFootstepPlayErrorKey) return;
    lastFootstepPlayErrorKey = key;
    window.__farmLog?.(`[footstep] ${phase.toUpperCase()} FAILED ${url?.split('/').pop() || url || '-'} ${String(errorName)}: ${message}`, 'audio');
  }

  function requestFootstepMediaPlay(snd, url, surfaceKey) {
    if (!snd) return false;
    footstepPlayRequestCount++;
    const requestId = (snd._footstepPlayRequestId || 0) + 1;
    snd._footstepPlayRequestId = requestId;
    if (lastFootstepSfxDebug?.surfaceKey === surfaceKey) {
      lastFootstepSfxDebug.playState = 'requested';
      lastFootstepSfxDebug.playError = null;
      lastFootstepSfxDebug.readyState = snd.readyState ?? null;
      lastFootstepSfxDebug.networkState = snd.networkState ?? null;
      lastFootstepSfxDebug.poolIndex = Number(snd.dataset?.footstepPoolIndex) || 0;
    }
    let started = false;
    const markStarted = () => {
      if (started || snd._footstepPlayRequestId !== requestId) return;
      started = true;
      footstepPlayStartedCount++;
      if (lastFootstepSfxDebug?.surfaceKey === surfaceKey && lastFootstepSfxDebug?.url === url) {
        lastFootstepSfxDebug.playState = 'playing';
        lastFootstepSfxDebug.playError = null;
      }
    };
    snd.addEventListener?.('playing', markStarted, { once: true });
    try {
      const result = snd.play();
      if (result?.then) result.then(markStarted).catch(error => {
        if (snd._footstepPlayRequestId === requestId) recordFootstepPlayFailure(url, error, 'play');
      });
      else markStarted();
      return true;
    } catch (error) {
      recordFootstepPlayFailure(url, error, 'play');
      return false;
    }
  }

  function primeFootstepVoice(snd, reason) {
    if (!snd || snd._footstepPrimed || snd._footstepPrimePending) return;
    snd._footstepPrimePending = true;
    const previousVolume = Number.isFinite(Number(snd.volume)) ? snd.volume : 1;
    const previousRate = Number.isFinite(Number(snd.playbackRate)) ? snd.playbackRate : 1;
    // A tiny non-muted gain keeps this an ordinary media playback request
    // inside the actual user gesture while remaining effectively inaudible.
    snd.volume = 0.0001;
    snd.playbackRate = 1;
    try { snd.currentTime = 0; } catch (_) {}
    const restore = () => {
      snd.pause?.();
      try { snd.currentTime = 0; } catch (_) {}
      snd.volume = previousVolume;
      snd.playbackRate = previousRate;
      snd._footstepPrimePending = false;
    };
    try {
      const result = snd.play();
      Promise.resolve(result).then(() => {
        snd._footstepPrimed = true;
        restore();
      }).catch(error => {
        restore();
        recordFootstepPlayFailure(snd.dataset?.footstepUrl || snd.src, error, 'prime');
      });
    } catch (error) {
      restore();
      recordFootstepPlayFailure(snd.dataset?.footstepUrl || snd.src, error, 'prime');
    }
  }

  function unlockFootstepAudio(reason = 'user gesture') {
    const ctx = window._footstepAudioCtx;
    if (ctx?.state === 'suspended') ctx.resume?.().catch(error => recordFootstepPlayFailure('(AudioContext)', error, 'prime'));
    let primed = 0;
    for (const pool of footstepAudioPools.values()) for (const snd of pool) {
      if (!snd._footstepPrimed) { primeFootstepVoice(snd, reason); primed++; }
    }
    if (primed) window.__farmLog?.(`[footstep] gesture unlock ${reason}: priming ${primed} pooled voices`, 'audio');
  }

  function installFootstepAudioUnlock() {
    if (footstepUnlockListenersInstalled || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    footstepUnlockListenersInstalled = true;
    document.addEventListener('pointerdown', () => unlockFootstepAudio('pointerdown'), { capture: true, passive: true });
    document.addEventListener('touchstart', () => unlockFootstepAudio('touchstart'), { capture: true, passive: true });
    document.addEventListener('keydown', () => unlockFootstepAudio('keydown'), { capture: true });
  }

  function decodeFootstepAudioData(context, arrayBuffer) {
    return new Promise((resolve, reject) => {
      let settled = false; // Used to support both callback-style and Promise-style decodeAudioData without resolving twice.
      const succeed = value => { if (!settled) { settled = true; resolve(value); } };
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      try {
        const result = context.decodeAudioData(arrayBuffer.slice(0), succeed, fail);
        if (result?.then) result.then(succeed, fail);
      } catch (error) { fail(error); }
    });
  }

  async function measureHardFootstepNormalization(url) {
    if (hardFootstepNormalizationGainByUrl.has(url)) return hardFootstepNormalizationGainByUrl.get(url);
    if (hardFootstepNormalizationPromiseByUrl.has(url)) return hardFootstepNormalizationPromiseByUrl.get(url);
    const promise = (async () => {
      try {
        const fetchFn = window.fetch || (typeof fetch === 'function' ? fetch : null); // Uses same-origin browser fetch; absent in headless regression tests.
        const DecodeContext = window.OfflineAudioContext || window.webkitOfflineAudioContext || window.AudioContext || window.webkitAudioContext; // OfflineAudioContext avoids autoplay restrictions where available.
        if (!fetchFn || !DecodeContext) return null;
        const response = await fetchFn(url);
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'error'}`);
        const arrayBuffer = await response.arrayBuffer();
        const decodeContext = (window.OfflineAudioContext || window.webkitOfflineAudioContext)
          ? new DecodeContext(1, 1, 44100)
          : new DecodeContext();
        const buffer = await decodeFootstepAudioData(decodeContext, arrayBuffer);
        let sourcePeak = 0; // Used below to derive the exact per-file gain required to put its loudest sample at -6 dBFS.
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < data.length; i++) sourcePeak = Math.max(sourcePeak, Math.abs(data[i]));
        }
        if (!(sourcePeak > 0)) throw new Error('decoded clip has no nonzero samples');
        const normalizationGain = HARD_FOOTSTEP_TARGET_PEAK / sourcePeak; // Applied before the ordinary footstep/master attenuation so mixer settings still behave normally.
        const sourcePeakDbfs = 20 * Math.log10(sourcePeak);
        const result = { gain: normalizationGain, sourcePeak, sourcePeakDbfs, targetDbfs: HARD_FOOTSTEP_TARGET_DBFS };
        hardFootstepNormalizationGainByUrl.set(url, result);
        window.__farmLog?.(`[footstep] normalized ${url.split('/').pop()} peak=${sourcePeakDbfs.toFixed(2)}dBFS gain=${normalizationGain.toFixed(3)} target=${HARD_FOOTSTEP_TARGET_DBFS}dBFS`, 'audio');
        return result;
      } catch (error) {
        window.__farmLog?.(`[footstep] hardstep normalization unavailable for ${url.split('/').pop()}: ${error?.message || error}`, 'audio');
        return null;
      } finally {
        hardFootstepNormalizationPromiseByUrl.delete(url);
      }
    })();
    hardFootstepNormalizationPromiseByUrl.set(url, promise);
    return promise;
  }

  function preloadHardFootstepNormalization() {
    for (const url of HARD_FOOTSTEP_URLS) measureHardFootstepNormalization(url);
  }

  function hardFootstepNormalizationFor(url) {
    const cached = hardFootstepNormalizationGainByUrl.get(url);
    if (!cached) measureHardFootstepNormalization(url); // A startup decode may still be pending; first use also retries if startup could not measure it.
    return cached || null;
  }

  // How much of a ground footstep's own volume a simultaneous waterstep
  // blends in at when the tile is fully flooded (tile.water === MAX_WATER)
  // — scales linearly down to 0 at tile.water === 0. See playFootstepSfx.
  const FOOTSTEP_WATER_BLEND_MAX = 0.8;

  // Distance an entity must travel between alternating footfalls, in world px
  // (TILE-scaled so the same constant works for player/creature px coords
  // and NPC tile-unit coords once converted to px) — resolved once
  // init() has deps.TILE, see initDerivedConstants below.
  let FOOTSTEP_STRIDE_PX = 0;

  // The player and whistled companion animals tread a bit more quietly
  // than NPCs/hostiles, and aren't panned (the player is the listener;
  // a companion is always close at hand). Raised from its original 0.35
  // — that plus distance falloff made a companion's own footsteps nearly
  // silent even standing right next to the player.
  const FOOTSTEP_QUIET_SCALE = 0.7;
  const WESTERN_SLOPE_ID = 'map_western_slope'; // Used by snow footstep routing to scope the permanent snow cap to the exterior zone only.
  const WESTERN_SLOPE_SNOW_TILE_TYPES = new Set([ // Mirrors EnvironmentSurfaceMicroPlateau LAND_TYPES and is consulted only when a footfall is emitted.
    'grass', 'path', 'tilled', 'trench', 'raised', 'paddy', 'rock', 'shrub', 'cliff', 'ramp', 'weeds',
  ]);

  function isHardFootstepArea(area) {
    const areaId = String(area || '');
    return areaId === 'map_i_town_mine_safe'
      || areaId.startsWith('map_i_town_mine_f_')
      || areaId.startsWith('map_i_den_');
  }

  function isWesternSlopeSnowFootstepTile(area, type) {
    return String(area || '') === WESTERN_SLOPE_ID
      && type != null
      && WESTERN_SLOPE_SNOW_TILE_TYPES.has(String(type).toLowerCase());
  }

  // Grass = grassstep. Roads (TileType.PATH), natural dens, all mine areas,
  // and every building interior = hardstep. Western Slope's permanent snow
  // cap overrides the ordinary material for exactly the land tile types the
  // renderer covers (including paddy); river/stream/waterfall stay water.
  // Other hard-packed/exposed ground — tilled or raised soil, dug trenches,
  // rock, shrub, ramps — remains gravelstep. Outside Western Slope, anything
  // that actually holds standing water (river/stream/waterfall/paddy) =
  // waterstep rather than a moisture blend.
  function footstepSurfaceKey(area, type) {
    if (isHardFootstepArea(area)) return 'hard';
    if (area === 'interior' || deps._isBuildingArea(area)) return 'hard';
    if (isWesternSlopeSnowFootstepTile(area, type)) return 'snow';
    const TileType = deps.TileType;
    switch (type) {
      case TileType.PADDY:
      case TileType.RIVER:
      case TileType.STREAM:
      case TileType.WATERFALL: return 'water';
      case TileType.PATH:      return 'hard';
      case TileType.RAMP:
      case TileType.TILLED:
      case TileType.RAISED:
      case TileType.TRENCH:
      case TileType.ROCK:
      case TileType.SHRUB:     return 'gravel';
      default:                 return 'grass'; // GRASS, WEEDS
    }
  }

  // Returns the tile object at a world-px coordinate within `area`'s own
  // grid (not necessarily the player's currentArea — used for NPCs/
  // creatures walking around in areas the player isn't currently
  // viewing). Callers read both .type (surface) and .water (moisture
  // blend) off the result.
  function footstepTileAt(area, wx, wy, grid) {
    const g = grid || deps.npcGridForArea(area);
    if (!g) return null;
    const col = Math.floor(wx / deps.TILE), row = Math.floor(wy / deps.TILE);
    return g[row]?.[col] ?? null;
  }

  // Advances a per-entity footstep stride accumulator; returns true (and
  // resets the remainder) exactly when a footfall should sound, so cadence
  // naturally scales with how fast the entity is actually moving. Also
  // reused by game.js for the (non-audio) lunge-trail stamp spacing, since
  // it's a generic "distance accumulator" helper that happens to live here
  // alongside its main footstep-cadence use.
  function footstepAdvance(state, distPx, stridePx) {
    if (stridePx == null) stridePx = FOOTSTEP_STRIDE_PX;
    if (!(distPx > 0)) return false;
    state.footstepAccum = (state.footstepAccum || 0) + distPx;
    if (state.footstepAccum < stridePx) return false;
    state.footstepAccum -= stridePx;
    state.footstepFoot = !state.footstepFoot;
    return true;
  }

  // Recorded footsteps stay on native media output rather than being moved
  // into a MediaElementSource GainNode graph. This repo's music subsystem has
  // a documented device where that graph reported running but produced no
  // audible destination output; a footstep repair should not depend on the
  // same failure-prone route. Hard-step -6 dBFS correction is therefore
  // applied as a native volume multiplier after measurement. The native
  // volume ceiling is exposed in diagnostics if an unusually quiet source
  // would require >1.0 after the normal footstep/master attenuation.
  function playRecordedFootstepClip(snd, url, surfaceKey, volume, gainMul = 1, heavy = false, spatial = null) {
    const adjustedVolume = Math.max(0, volume * Math.max(0, Number(gainMul) || 0) * (heavy ? 1.15 : 1));
    const nativeVolume = Math.min(1, adjustedVolume);
    if (spatial?.position3d) {
      prepareCombatPositionalClip(url, true); // Urgent hostile footsteps take decode priority over background preloads.
      resumeCombatPositionalContext();
      const rendered = playDecodedCombatSfx({ url, gainBoost: 1 }, nativeVolume, snd.playbackRate, spatial);
      if (rendered) {
        footstepPlayRequestCount++; footstepPlayStartedCount++; // Maintain the existing mobile cadence diagnostics.
        if (lastFootstepSfxDebug?.surfaceKey === surfaceKey) {
          lastFootstepSfxDebug.playState = 'spatial-hrtf';
          lastFootstepSfxDebug.requestedLinearVolume = adjustedVolume;
          lastFootstepSfxDebug.nativeVolume = 0; // This cue rendered via a buffer, not its reserved native pool voice.
        }
        return;
      }
      combatSpatialFallbacks++; // Native recorded footstep until the decoded HRTF clip becomes available.
    }
    trackActiveSfx(snd);
    snd.volume = nativeVolume;
    if (lastFootstepSfxDebug?.surfaceKey === surfaceKey) {
      lastFootstepSfxDebug.nativeVolume = nativeVolume;
      lastFootstepSfxDebug.requestedLinearVolume = adjustedVolume;
      lastFootstepSfxDebug.normalizationClampedByNativeVolume = adjustedVolume > 1;
    }
    requestFootstepMediaPlay(snd, url, surfaceKey);
  }

  // Plays one surface's footfall at `volume` — a random pick from that
  // surface's configured clip list (audio.footsteps.surfaces[key].urls)
  // when one exists, else the oscillator+noise synth fallback tuned by
  // FOOTSTEP_POST_FX. `pan` only affects the synth fallback (recorded clips
  // use the native media path for maximum mobile compatibility).
  //
  // `heavy` is for a dodge/attack-lunge landing thud. Recorded clips use
  // their lower playback rate plus a small gain bump; the previous WebAudio
  // lowpass was intentionally dropped from this path because reliable dry
  // playback matters more than an optional filter on devices where the
  // MediaElementSource destination has already proven unreliable.
  function playFootstepSurface(surfaceKey, footstepCfg, volume, pan, heavy = false, spatial = null) {
    // A non-finite volume (NaN/Infinity — e.g. from a caller's distance
    // falloff math going through a NaN position) throws a hard
    // Uncaught TypeError the instant it's assigned to <audio>.volume,
    // instead of just silently muting like an out-of-range number would.
    if (!Number.isFinite(volume) || volume <= 0.002) return;
    const postFx = { ...FOOTSTEP_POST_FX[surfaceKey], ...(footstepCfg.surfaces?.[surfaceKey] || {}) };
    const urls = postFx.urls || (postFx.url ? [postFx.url] : null);
    const finalVolume = Math.min(1, volume * Math.max(0, Number(postFx.volumeMul) || 1));

    if (urls && urls.length) {
      const url = urls[Math.floor(Math.random() * urls.length)];
      const snd = acquireFootstepAudio(url) || new Audio(url);
      snd.playbackRate = heavy ? (0.6 + Math.random() * 0.1) : (0.92 + Math.random() * 0.16);
      const normalization = surfaceKey === 'hard' ? hardFootstepNormalizationFor(url) : null; // Cached per-file source peak correction; null until the tiny startup decode completes.
      const normalizationGain = normalization?.gain ?? 1;
      if (lastFootstepSfxDebug?.surfaceKey === surfaceKey) {
        lastFootstepSfxDebug.url = url;
        lastFootstepSfxDebug.normalizationReady = !!normalization;
        lastFootstepSfxDebug.normalizationGain = normalizationGain;
        lastFootstepSfxDebug.normalizationTargetDbfs = surfaceKey === 'hard' ? HARD_FOOTSTEP_TARGET_DBFS : null;
        lastFootstepSfxDebug.sourcePeakDbfs = normalization?.sourcePeakDbfs ?? null;
      }
      playRecordedFootstepClip(snd, url, surfaceKey, finalVolume, normalizationGain, heavy, spatial);
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = window._footstepAudioCtx || (window._footstepAudioCtx = new AudioCtx());
    if (ctx.state === 'suspended') ctx.resume().catch(error => recordFootstepPlayFailure('(synth AudioContext)', error, 'prime'));
    const now = ctx.currentTime;
    const base = FOOTSTEP_BASE;
    const pitchMul = (Number(postFx.pitchMul) || 1) * (heavy ? 0.55 : 1);
    const durationS = Math.max(0.02, (Number(base.durationMs) || 55) / 1000 * (Number(postFx.durationMul) || 1) * (heavy ? 2.2 : 1));
    const noiseMix = Math.max(0, Math.min(1, Number(base.noiseMix ?? 0.82)));
    const baseFreq = Math.max(20, Number(base.freq) * pitchMul);
    const variance = Math.max(0, Number(base.freqVarianceHz) || 15);

    const panNode = !spatial && typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    const spatialInput = spatial?.position3d ? ctx.createGain() : null; // Both synthesized noise and oscillator steps share one listener-relative HRTF route.
    const spatialRoute = spatialInput ? connectCombatSpatialDry(ctx, spatialInput, spatial) : null;
    if (panNode) {
      panNode.pan.value = Math.max(-1, Math.min(1, pan));
      panNode.connect(ctx.destination);
    }
    const outNode = spatialInput || panNode || ctx.destination;
    if (spatialInput) setTimeout(() => {
      try { spatialInput.disconnect(); spatialRoute?.dispose?.(); } catch (_) {}
    }, Math.ceil(durationS * 1000) + 40); // Detached when the short procedural footfall is complete.

    if (noiseMix < 1) {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = base.waveform || 'triangle';
      osc.frequency.value = baseFreq + (Math.random() * 2 - 1) * variance;
      oscGain.gain.setValueAtTime(finalVolume * (1 - noiseMix), now);
      oscGain.gain.exponentialRampToValueAtTime(0.0008, now + durationS);
      osc.connect(oscGain).connect(outNode);
      osc.start(now);
      osc.stop(now + durationS);
    }

    if (noiseMix > 0) {
      const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * durationS));
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = postFx.filterType || 'bandpass';
      filter.frequency.value = baseFreq * (Number(postFx.filterFreqMul) || 3.2) * (heavy ? 0.45 : 1);
      filter.Q.value = Number(postFx.filterQ) || 1.6;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(finalVolume * noiseMix, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0008, now + durationS);
      noise.connect(filter).connect(noiseGain).connect(outNode);
      noise.start(now);
      noise.stop(now + durationS);
    }
  }

  // `tile` is the grid tile the footstep lands on (see footstepTileAt) —
  // null for NPCs/creatures whose area has no grid (shouldn't normally
  // happen, just defends against it). `pan` is -1 (full left) .. 1 (full
  // right); leave at 0 for the player (the listener) and companions
  // (always close, not worth panning). `opts.heavy` — see
  // playHeavyLandingSfx — plays both layers through playFootstepSurface's
  // heavy (louder, pitched-down) mode instead of a plain stride.
  //
  // Ground surfaces (grass/gravel/hard) layer in a second, simultaneous
  // waterstep clip scaled by the tile's moisture (tile.water, 0..
  // MAX_WATER) — a bone-dry tile blends none in, a fully flooded one
  // blends it in at FOOTSTEP_WATER_BLEND_MAX (80%) of the footstep's own
  // volume. Western Slope snow is the raised contact surface itself, so it
  // deliberately suppresses that underlying moisture blend. Actual water
  // tiles (river/stream/waterfall, plus paddy outside Western Slope) already
  // resolve straight to 'water' and skip the blend as well.
  function playFootstepSfx(area, tile, volumeScale = 1, pan = 0, opts = {}) {
    const audioCfg = gameAudioConfig();
    if (audioCfg.enabled === false) return;
    const footstepCfg = audioCfg.footsteps || {};
    if (footstepCfg.enabled === false) return;
    const heavy = !!opts.heavy;
    const surfaceKey = footstepSurfaceKey(area, tile?.type ?? null);
    const wetFraction = deps.clamp((Number(tile?.water) || 0) / deps.MAX_WATER, 0, 1);
    lastFootstepSfxDebug = {
      area: String(area || ''),
      tileType: tile?.type ?? null,
      surfaceKey,
      wetFraction,
      heavy,
      url: null,
      normalizationReady: false,
      normalizationGain: 1,
      normalizationTargetDbfs: surfaceKey === 'hard' ? HARD_FOOTSTEP_TARGET_DBFS : null,
      sourcePeakDbfs: null,
      nativeVolume: null,
      requestedLinearVolume: null,
      normalizationClampedByNativeVolume: false,
      playState: 'routing',
      playError: null,
      readyState: null,
      networkState: null,
      poolIndex: null,
      atMs: Math.round(performance.now()),
    };
    if (surfaceKey !== lastFootstepDebugSurface) {
      lastFootstepDebugSurface = surfaceKey;
      window.__farmLog?.(`[footstep] area=${String(area || '-')} surface=${surfaceKey} tile=${String(tile?.type ?? '-')} wet=${wetFraction.toFixed(2)}`, 'audio');
    }
    const baseVolume = Math.max(0, Math.min(1, Number(footstepCfg.volume) || 0.65));
    const volume = baseVolume * Math.max(0, Number(audioCfg.sfxVolume ?? 1))
      * Math.max(0, volumeScale) * Math.max(0, Number(FOOTSTEP_BASE.volume) || 0.26);
    const spatial = opts.source && opts.source !== deps.player ? combatAudioSpatial(opts.source, { earshotTiles: 9 }) : null; // NPC/hostile footfalls come from their real location.
    playFootstepSurface(surfaceKey, footstepCfg, volume, spatial?.panX ?? pan, heavy, spatial);

    if (surfaceKey !== 'water' && surfaceKey !== 'snow') {
      playFootstepSurface('water', footstepCfg, volume * wetFraction * FOOTSTEP_WATER_BLEND_MAX, spatial?.panX ?? pan, heavy, spatial);
    }
  }

  function footstepSfxDebugSnapshot() {
    const pools = [...footstepAudioPools.entries()].map(([url, pool]) => ({
      url,
      voices: pool.length,
      primed: pool.filter(snd => snd._footstepPrimed).length,
      ready: pool.filter(snd => Number(snd.readyState) >= 2).length,
      states: pool.map(snd => ({
        readyState: snd.readyState ?? null,
        networkState: snd.networkState ?? null,
        paused: !!snd.paused,
        ended: !!snd.ended,
        primed: !!snd._footstepPrimed,
      })),
    }));
    return {
      ...(lastFootstepSfxDebug ? { ...lastFootstepSfxDebug } : {}),
      playbackRequests: footstepPlayRequestCount,
      playbackStarts: footstepPlayStartedCount,
      playbackFailures: footstepPlayFailureCount,
      primeFailures: footstepPrimeFailureCount,
      lastPlayError: lastFootstepPlayError ? { ...lastFootstepPlayError } : null,
      poolUrlCount: footstepAudioPools.size,
      pools,
    };
  }

  // Heavy "landing thud" used when a dodge or attack lunge comes to a
  // stop — same surface/moisture-blend as an ordinary footstep (see
  // playFootstepSfx) but louder and pitched down so it reads as hitting the
  // ground hard after a leap, not just another stride in the cadence.
  const HEAVY_LANDING_VOLUME_MUL = 2.0;
  function playHeavyLandingSfx(area, tile) {
    playFootstepSfx(area, tile, HEAVY_LANDING_VOLUME_MUL, 0, { heavy: true });
  }

  function combatSfxConfig() { return gameAudioConfig().combatSfx || {}; }

  // One AudioContext for all short recorded combat cues. Source buffers are
  // cached, but every attack gets its own independent panner/gain graph.
  function ensureCombatPositionalContext() {
    if (combatPositionalContext && combatPositionalContext.state !== 'closed') return combatPositionalContext;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try { combatPositionalContext = new AudioCtx(); }
    catch (error) { combatSpatialLastError = String(error?.message || error); return null; }
    return combatPositionalContext;
  }

  let combatGestureUnlockInstalled = false; // Ensures one set of trusted input handlers even if the game reinits the AudioSystem.
  function installCombatGestureUnlock() {
    if (combatGestureUnlockInstalled || typeof window.addEventListener !== 'function') return;
    combatGestureUnlockInstalled = true;
    const unlock = () => resumeCombatPositionalContext();
    for (const event of ['pointerdown', 'touchstart', 'keydown']) {
      window.addEventListener(event, unlock, { capture: true, passive: true });
    }
  }

  function resumeCombatPositionalContext() {
    const ctx = combatPositionalContext;
    if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted')) {
      try { ctx.resume?.().catch?.(error => { combatSpatialLastError = String(error?.message || error); }); }
      catch (error) { combatSpatialLastError = String(error?.message || error); }
    }
  }

  // Decodes never wait on a sound event: if an asset is still preparing, the
  // existing native cue starts immediately instead of playing late/off-beat.
  function pumpCombatDecodeQueue() {
    while (combatDecodeInFlight < 2 && combatDecodeQueue.length) {
      const entry = combatDecodeQueue.shift();
      const ctx = ensureCombatPositionalContext();
      if (!ctx || typeof fetch !== 'function' || typeof ctx.decodeAudioData !== 'function') {
        entry.state = 'unsupported';
        continue;
      }
      combatDecodeInFlight++;
      entry.state = 'loading';
      entry.attempts = (entry.attempts || 0) + 1;
      Promise.resolve().then(() => fetch(entry.url))
        .then(response => { if (!response.ok) throw new Error('combat audio HTTP ' + response.status); return response.arrayBuffer(); })
        .then(bytes => ctx.decodeAudioData(bytes))
        .then(buffer => {
          if (!buffer?.duration) throw new Error('combat audio decoded an empty clip');
          entry.buffer = buffer; entry.state = 'ready';
        })
        .catch(error => {
          entry.state = 'failed';
          entry.nextRetryAt = Date.now() + Math.min(60000, 4000 * Math.pow(2, Math.min(4, entry.attempts - 1)));
          combatSpatialLastError = `${entry.url}: ${error?.message || error}`;
        })
        .finally(() => { combatDecodeInFlight--; pumpCombatDecodeQueue(); });
    }
  }

  function prepareCombatPositionalClip(url, priority = false) {
    if (!url) return;
    let entry = combatDecodedByUrl.get(url);
    if (entry?.state === 'ready' || entry?.state === 'loading') return;
    if (entry?.state === 'failed' && Date.now() < (entry.nextRetryAt || 0)) return; // Transient network failures can retry later without a request storm.
    if (!entry) {
      entry = { url, buffer: null, state: 'queued', attempts: 0, nextRetryAt: 0 }; // Shared entry survives bounded cooldown retries.
      combatDecodedByUrl.set(url, entry);
    } else if (entry.state !== 'queued') entry.state = 'queued'; // Retry a previously failed or unsupported decode when the browser can play it.
    const queuedAt = combatDecodeQueue.indexOf(entry);
    if (queuedAt >= 0) combatDecodeQueue.splice(queuedAt, 1); // A newly requested attack should not wait behind unrelated background preloads.
    if (priority) combatDecodeQueue.unshift(entry);
    else combatDecodeQueue.push(entry);
    pumpCombatDecodeQueue();
  }

  function preloadSpecialCombatSfx() {
    const pelletCues = window.HobunjiDrenkirraPellet?.sfx || {};
    for (const cfg of Object.values(pelletCues)) if (cfg?.url) prepareCombatPositionalClip(cfg.url);
  }

  function updateCombatDirectionalRoutes(frame = {}) {
    const now = Number.isFinite(frame.timestamp) ? frame.timestamp : performance.now();
    if (now - lastDirectionalRouteUpdateMs < 80) return;
    lastDirectionalRouteUpdateMs = now;
    for (const route of activeDirectionalRoutes) {
      const pos = acousticPosition3D(route.actor); // Sample the current player and emitting actor, not their starting positions.
      if (!pos) continue;
      if (route.backend === 'hrtf') {
        const { positionX, positionY, positionZ } = route.node;
        if (positionX && positionY && positionZ) {
          for (const [param, value] of [[positionX, pos.x], [positionY, pos.y], [positionZ, pos.z]]) {
            if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, route.ctx.currentTime, 0.025);
            else param.value = value;
          }
        } else route.node.setPosition?.(pos.x, pos.y, pos.z);
      } else if (route.backend === 'stereo-fallback') {
        const pan = Math.max(-1, Math.min(1, pos.x / Math.max(1, Math.hypot(pos.x, pos.z) * 0.6)));
        if (typeof route.node.pan?.setTargetAtTime === 'function') route.node.pan.setTargetAtTime(pan, route.ctx.currentTime, 0.025);
        else if (route.node.pan) route.node.pan.value = pan;
      }
      const followed = route.followGain;
      if (followed?.param && followed.initialGain > 0 && followed.earshotPx > 0) {
        const actorArea = route.actor?.areaId || route.actor?.area || null;
        const sameArea = !actorArea || actorArea === deps?.getCurrentArea?.();
        const distance = animalVoiceAcousticDistancePx(route.actor); // Re-evaluate true horizontal+vertical separation, not merely pan.
        const nextGain = sameArea ? Math.pow(Math.max(0, 1 - distance / followed.earshotPx), 1.5) : 0;
        const value = Math.max(0, Math.min(4, followed.base * nextGain / followed.initialGain)); // Isolated attenuation avoids undoing charge-stop fades.
        if (typeof followed.param.setTargetAtTime === 'function') followed.param.setTargetAtTime(value, route.ctx.currentTime, 0.025);
        else followed.param.value = value;
      }
    }
  }

  function installCombatDirectionalUpdates() {
    if (directionalRouteSchedulerInstalled || !window.RuntimeFrameScheduler?.register) return;
    window.RuntimeFrameScheduler.register('combat-spatial-listener', updateCombatDirectionalRoutes, {
      phase: 'post-game', owner: 'AudioSystem', description: 'Update active HRTF combat emitters at player-relative coordinates.',
    });
    directionalRouteSchedulerInstalled = true;
  }

  // Use a listener fixed at (0,0,0), facing -Z, in listener-local
  // coordinates. The caller rotates each world-space emitter into the
  // active camera's right/up/back basis, preserving left/right, rear/front
  // and vertical (including below the player) without moving the ear to
  // the actual third-person camera's distant position.
  function connectCombatSpatialDry(ctx, input, spatial) {
    const pos = spatial?.position3d;
    if (pos && typeof ctx.createPanner === 'function') {
      try {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.rolloffFactor = 0; // Shared combatAudioSpatial already owns the actual 3D gain falloff.
        panner.refDistance = 1;
        panner.maxDistance = 10000;
        if (panner.positionX && panner.positionY && panner.positionZ) {
          panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z;
        } else panner.setPosition(pos.x, pos.y, pos.z);
        input.connect(panner); panner.connect(ctx.destination);
        const route = { node: panner, backend: 'hrtf', actor: spatial.sourceActor, followGain: spatial.followGain || null, ctx,
          dispose() { activeDirectionalRoutes.delete(route); try { panner.disconnect(); } catch (_) {} },
        }; // One live route per active attack/voice, disposed when playback ends.
        if (spatial.sourceActor) activeDirectionalRoutes.add(route);
        return route;
      } catch (error) { combatSpatialLastError = String(error?.message || error); }
    }
    const stereo = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (stereo) {
      stereo.pan.value = Math.max(-1, Math.min(1, Number(spatial?.panX) || 0));
      input.connect(stereo); stereo.connect(ctx.destination);
      const route = { node: stereo, backend: 'stereo-fallback', actor: spatial?.sourceActor, followGain: spatial?.followGain || null, ctx,
        dispose() { activeDirectionalRoutes.delete(route); try { stereo.disconnect(); } catch (_) {} },
      };
      if (spatial?.sourceActor) activeDirectionalRoutes.add(route);
      return route;
    }
    input.connect(ctx.destination);
    return { node: null, backend: 'mono-fallback', dispose() {} };
  }

  function playDecodedCombatSfx(cfgEntry, volume, rate, spatial) {
    const entry = combatDecodedByUrl.get(cfgEntry.url);
    const ctx = combatPositionalContext;
    if (!entry?.buffer || ctx?.state !== 'running') return null;
    let source = null, gain = null, lowpass = null, route = null, wet = null; // A mobile AudioContext can interrupt between graph setup and start; unwind partial graphs before native fallback.
    try {
      source = ctx.createBufferSource();
      gain = ctx.createGain();
      lowpass = typeof ctx.createBiquadFilter === 'function' && spatial.gain < 0.92 ? ctx.createBiquadFilter() : null; // Distant attacks lose direct treble without silencing their echoes.
      source.buffer = entry.buffer; source.playbackRate.value = rate;
      gain.gain.value = Math.max(0, volume * Math.max(1, Number(cfgEntry.gainBoost) || 1));
      source.connect(gain);
      if (lowpass) {
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 3500 + 16500 * Math.pow(spatial.gain, 0.7);
        gain.connect(lowpass);
      }
      route = connectCombatSpatialDry(ctx, lowpass || gain, { ...spatial,
        followGain: { param: gain.gain, initialGain: spatial.gain, base: gain.gain.value, earshotPx: spatial.earshotPx },
      }); // One-shot volume also updates if a lunge crosses a major elevation/earshot boundary while playing.
      wet = window.EnvironmentalReverb?.connectWetNode?.(ctx, gain, { volume: 1, extraWet: spatial.extraWetBoost, area: spatial.areaId || null }) || null;
      const handle = {
        pause() { try { source.stop(); } catch (_) {} cleanup(); },
        get paused() { return finished; },
        get ended() { return finished; },
      }; // Minimal native-compatible lifecycle for active-SFX cleanup; bandage loops never use this path.
      let finished = false;
      function cleanup() {
        if (finished) return;
        finished = true; activePositionalCombat.delete(handle);
        try { source.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
        try { lowpass?.disconnect(); } catch (_) {}
        try { route.dispose?.(); } catch (_) {}
        try { wet?.send?.disconnect?.(); } catch (_) {}
      }
      source.onended = cleanup;
      source.start();
      activePositionalCombat.add(handle);
      combatSpatialBackend = route.backend;
      combatSpatialStarts++;
      return handle;
    } catch (error) {
      combatSpatialLastError = String(error?.message || error);
      try { source?.stop?.(); } catch (_) {} // Source creation/start can fail after native context suspension.
      try { source?.disconnect?.(); } catch (_) {}
      try { gain?.disconnect?.(); } catch (_) {}
      try { lowpass?.disconnect?.(); } catch (_) {}
      try { route?.dispose?.(); } catch (_) {} // Avoid retaining the actor and PannerNode in the live-update set after a failed start.
      try { wet?.send?.disconnect?.(); } catch (_) {}
      return null; // The caller performs the immediate mobile-compatible native fallback.
    }
  }

  const COMBAT_SFX_POOL_SIZE = 2;
  const COMBAT_SFX_MAX_START_DELAY_MS = 140;

  function preloadConfiguredCombatSfx() {
    if (typeof Audio !== 'function') return;
    for (const [key, cfgEntry] of Object.entries(combatSfxConfig())) {
      if (!cfgEntry?.preload || !cfgEntry.url || combatSfxPreloads.has(cfgEntry.url)) continue;
      const pool = [];
      for (let i = 0; i < COMBAT_SFX_POOL_SIZE; i++) {
        const snd = new Audio(cfgEntry.url);
        snd.preload = 'auto';
        snd.dataset.combatSfxKey = key;
        snd.dataset.combatPoolIndex = String(i);
        snd.load();
        pool.push(snd);
      }
      combatSfxPreloads.set(cfgEntry.url, pool);
      if (typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function') {
        prepareCombatPositionalClip(cfgEntry.url); // Decode common weapon cues ahead of their first attack.
      }
    }
    // Non-preloaded ranged loading/fire and animal claw cues need the same
    // directional readiness as the preloaded swings/hits. Exclude the
    // player-owned bandage loops: those retain their stop/restart semantics.
    if (typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function') {
      for (const [key, cfgEntry] of Object.entries(combatSfxConfig())) {
        if (!cfgEntry?.url || key.startsWith('bandage')) continue;
        prepareCombatPositionalClip(cfgEntry.url);
        for (const species of Object.values(cfgEntry.species || {})) if (species?.url) prepareCombatPositionalClip(species.url);
      }
    }
  }

  function acquireCombatSfxAudio(url) {
    const pool = combatSfxPreloads.get(url);
    if (!pool?.length) return null;
    const available = pool.find(snd => snd.paused || snd.ended);
    const snd = available || pool.reduce((oldest, candidate) =>
      (candidate._combatRequestedAt || 0) < (oldest._combatRequestedAt || 0) ? candidate : oldest);
    if (!snd.paused) snd.pause();
    try { snd.currentTime = 0; } catch (_) {}
    snd._combatRequestedAt = performance.now();
    return snd;
  }

  // A mobile browser may accept play() but delay it until much later. That
  // stale request is worse than a dropped transient cue because several of
  // them erupt together after the fight has moved on. Pooled combat voices
  // therefore get a strict start deadline and are recycled instead of queued.
  function playPooledCombatSfx(snd, volume) {
    const requestId = (snd._combatRequestId || 0) + 1;
    snd._combatRequestId = requestId;
    snd.volume = Math.min(1, volume);
    let started = false;
    const markStarted = () => {
      if (snd._combatRequestId !== requestId) return;
      started = true;
      if (performance.now() - snd._combatRequestedAt <= COMBAT_SFX_MAX_START_DELAY_MS) return;
      snd.pause();
      try { snd.currentTime = 0; } catch (_) {}
    };
    snd.addEventListener?.('playing', markStarted, { once: true });
    const playResult = snd.play();
    if (playResult?.then) playResult.then(markStarted).catch(() => {});
    setTimeout(() => {
      if (started || snd._combatRequestId !== requestId) return;
      snd.pause();
      try { snd.currentTime = 0; } catch (_) {}
    }, COMBAT_SFX_MAX_START_DELAY_MS);
  }

  // One-shot combat SFX player (weapon swing/impact, block, bark, claw hit) —
  // simpler than playFootstepSfx since these always have a real audio
  // file staged (no procedural WebAudio fallback needed).
  function playOneShotSfx(cfgEntry, volumeScale = 1, pitch = 1, spatial = null) {
    const audioCfg = gameAudioConfig();
    if (audioCfg.enabled === false || !cfgEntry?.url) return null;
    if (combatSfxConfig().enabled === false) return null;
    const volume = Math.max(0, Math.min(1, Number(cfgEntry.volume) || 0.8))
      * Math.max(0, Number(audioCfg.sfxVolume ?? 1)) * Math.max(0, volumeScale);
    if (volume <= 0.002) return null;
    const pitchVariance = Number(cfgEntry.pitchVarianceMul) || 0;
    const rate = Math.max(0.3, (Number(pitch) || 1) * (1 + (Math.random() * 2 - 1) * pitchVariance));
    if (spatial?.position3d) {
      prepareCombatPositionalClip(cfgEntry.url, true); // Prioritize sounds actually needed in combat above the low-priority warmup queue.
      resumeCombatPositionalContext();
      const rendered = playDecodedCombatSfx(cfgEntry, volume, rate, spatial);
      if (rendered) return rendered;
      combatSpatialFallbacks++; combatSpatialBackend = 'native-fallback'; // Never delay an attack while a clip loads/unlocks.
    }
    const snd = acquireCombatSfxAudio(cfgEntry.url) || new Audio(cfgEntry.url);
    trackActiveSfx(snd);
    snd.playbackRate = rate;
    if (snd._combatRequestedAt != null && !(Number(cfgEntry.gainBoost) > 1)) playPooledCombatSfx(snd, volume);
    else playSfxAudioElement(snd, volume, Number(cfgEntry.gainBoost) || 1);
    return snd;
  }

  function playCombatSfxKey(key, volumeScale = 1, pitch = 1) {
    const cfgEntry = combatSfxConfig()[key]; // Keeps gameplay modules on semantic cue names instead of hard-coded asset paths.
    return cfgEntry ? playOneShotSfx(cfgEntry, volumeScale, pitch) : null;
  }

  function objectSfxConfig() { return gameAudioConfig().objectSfx || {}; }

  function preloadConfiguredObjectSfx() {
    for (const [key, cfgEntry] of Object.entries(objectSfxConfig())) {
      if (!cfgEntry?.preload || !cfgEntry.url || objectSfxPreloads.has(cfgEntry.url)) continue;
      const snd = new Audio(cfgEntry.url);
      snd.preload = 'auto';
      snd.dataset.objectSfxKey = key;
      snd.load();
      objectSfxPreloads.set(cfgEntry.url, snd);
    }
  }

  function createObjectSfxAudio(url) {
    const preloaded = objectSfxPreloads.get(url); // Used to avoid a fresh network/decode start on the first tool strike.
    return trackActiveSfx(preloaded ? preloaded.cloneNode(true) : new Audio(url));
  }

  // Generic one-shot player for object/machine/UI interaction sfx (see
  // audio.objectSfx in scratchbones-config.js and
  // docs/assets/audio/sfx/README.md) — like playOneShotSfx, but
  // fallback-aware: every cfgEntry names a real recording (cfgEntry.url,
  // not committed yet — a human needs to source it) *and* a placeholder
  // that's played instead whenever the real file is missing/fails to
  // load — either a single generated cfgEntry.placeholderUrl (see
  // scripts/generate-placeholder-sfx.js), or a cfgEntry.placeholderUrls
  // array to pick a random one from (several processing sfx reuse the
  // real grasstep/gravelstep/waterstep footstep recordings this way,
  // pitched/volumed for the moment — a real recording doing double duty
  // reads better than a from-scratch synth attempt). cfgEntry.pitch is
  // an optional baseline playback-rate multiplier on top of the
  // `pitch` param, e.g. for pitching a footstep-derived placeholder
  // down into something heavier. Failures are remembered via the same
  // _audioFailedUrls/markAudioUrlFailed/audioUrlFailed bookkeeping the
  // bgm system already uses (see deps), so later calls for the same cue
  // go straight to the placeholder instead of re-attempting (and
  // re-404ing) the missing real file every time.
  // A plain <audio>.volume tops out at 1.0 (its natural recorded
  // loudness) no matter what — there's no way to make a quiet source
  // clip louder than that through the element alone. cfgEntry.gainBoost
  // (a multiplier > 1, e.g. 3 for "300% volume") routes playback
  // through the shared footstep AudioContext's GainNode instead, whose
  // gain can genuinely exceed 1.0 and amplify the source — same trick
  // playHeavyFilteredClip uses for a heavy landing thud, minus the
  // lowpass. Falls back to plain .volume (clamped to 1) if Web Audio
  // is unavailable or gainBoost isn't set.
  function playSfxAudioElement(snd, volume, gainBoost, lowpassHz = 0) {
    const filtered = Number.isFinite(lowpassHz) && lowpassHz > 0; // Only specifically authored occluded SFX (such as indoor thunder) use a low-pass.
    if (!(gainBoost > 1) && !filtered) {
      snd.volume = Math.min(1, volume);
      snd.play().catch(() => {});
      return;
    }
    let source = null; // Allows sound effects to fall back to direct output when the optional filter graph fails halfway through.
    let ctx = null; // Holds the shared audio context for the direct-output recovery path below.
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('no AudioContext');
      ctx = window._footstepAudioCtx || (window._footstepAudioCtx = new AudioCtx());
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (filtered && ctx.state !== 'running') {
        snd.volume = Math.min(1, volume); // Avoid sending the weather one-shot into a silent context on restricted mobile browsers.
        snd.play().catch(() => {});
        return;
      }
      source = ctx.createMediaElementSource(snd); // One source per one-shot; other object SFX remain on their existing transport.
      const gain = ctx.createGain(); // Applies the original loudness/boost after optional low-pass filtering.
      gain.gain.value = Math.max(0, volume * gainBoost);
      if (filtered) {
        const filter = ctx.createBiquadFilter(); // Muffles thunder without affecting unrelated game audio.
        filter.type = 'lowpass';
        filter.frequency.value = lowpassHz;
        filter.Q.value = 0.65;
        source.connect(filter).connect(gain).connect(ctx.destination);
      } else {
        source.connect(gain).connect(ctx.destination);
      }
      snd.play().catch(() => {});
    } catch (e) {
      if (source && ctx) try { source.connect(ctx.destination); } catch (_) {} // A failed optional DSP graph must not swallow weather SFX.
      snd.volume = Math.min(1, volume);
      snd.play().catch(() => {});
    }
  }

  function playObjectSfx(cfgEntry, volumeScale = 1, pitch = 1) {
    const audioCfg = gameAudioConfig();
    if (audioCfg.enabled === false || !cfgEntry) return;
    if (objectSfxConfig().enabled === false) return;
    const volume = Math.max(0, Math.min(1, Number(cfgEntry.volume) || 0.8))
      * Math.max(0, Number(audioCfg.sfxVolume ?? 1)) * Math.max(0, volumeScale);
    if (volume <= 0.002) return;
    const gainBoost = Number(cfgEntry.gainBoost) || 1;
    const pickPlaceholder = () => (cfgEntry.placeholderUrls?.length)
      ? cfgEntry.placeholderUrls[Math.floor(Math.random() * cfgEntry.placeholderUrls.length)]
      : cfgEntry.placeholderUrl;
    const hasPlaceholder = !!(cfgEntry.placeholderUrl || cfgEntry.placeholderUrls?.length);
    const preferReal = cfgEntry.url && !deps.audioUrlFailed(cfgEntry.url);
    const url = preferReal ? cfgEntry.url : pickPlaceholder();
    if (!url) return;
    const pitchVariance = Number(cfgEntry.pitchVarianceMul) || 0;
    const rate = Math.max(0.3, pitch * (Number(cfgEntry.pitch) || 1) * (1 + (Math.random() * 2 - 1) * pitchVariance));
    const snd = createObjectSfxAudio(url);
    snd.playbackRate = rate;
    if ('preservesPitch' in snd) snd.preservesPitch = false; // Pitched object cues (including musical ruin plates and lowered cave-collapse sounds) must actually change pitch instead of browser pitch-correction keeping every playback at the source note.
    if ('webkitPreservesPitch' in snd) snd.webkitPreservesPitch = false;
    if ('mozPreservesPitch' in snd) snd.mozPreservesPitch = false;
    if (preferReal && hasPlaceholder) {
      snd.addEventListener('error', () => {
        if (!deps.isRealMediaError(snd)) return;
        deps.markAudioUrlFailed(cfgEntry.url, 'object sfx load failed');
        if (gameAudioConfig().enabled === false) return;
        const fallback = trackActiveSfx(new Audio(pickPlaceholder()));
        fallback.playbackRate = rate;
        if ('preservesPitch' in fallback) fallback.preservesPitch = false;
        if ('webkitPreservesPitch' in fallback) fallback.webkitPreservesPitch = false;
        if ('mozPreservesPitch' in fallback) fallback.mozPreservesPitch = false;
        playSfxAudioElement(fallback, volume, gainBoost, Number(cfgEntry.lowpassHz) || 0);
      }, { once: true });
    }
    playSfxAudioElement(snd, volume, gainBoost, Number(cfgEntry.lowpassHz) || 0);
  }

  function playGeneratedStoneKchunk(volume = 1) {
    const AudioCtx=window.AudioContext||window.webkitAudioContext; // Temporary procedural completion cue; intended to be replaced by a recorded stone kchunk asset later.
    if(!AudioCtx)return false;
    try{
      const ctx=playGeneratedStoneKchunk._ctx||(playGeneratedStoneKchunk._ctx=new AudioCtx());
      ctx.resume?.();
      const now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
      osc.type='square';osc.frequency.setValueAtTime(92,now);osc.frequency.exponentialRampToValueAtTime(46,now+.18);
      filter.type='lowpass';filter.frequency.value=520;
      gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(Math.max(.0001,.16*volume),now+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+.24);
      osc.connect(filter).connect(gain).connect(ctx.destination);osc.start(now);osc.stop(now+.25);
      return true;
    }catch(_){return false;}
  }

  function playObjectSfxKey(key, volumeScale = 1, pitch = 1) {
    const cfgEntry = objectSfxConfig()[key]; // Resolves named UI/object/tool cues without leaking the config shape to gameplay systems.
    const preloaded = cfgEntry?.url ? objectSfxPreloads.get(cfgEntry.url) : null; // Used by the mobile-readable debug snapshot below.
    lastObjectSfxKeyDebug = {
      key,
      found: !!cfgEntry,
      url: cfgEntry?.url || null,
      preloaded: !!preloaded,
      readyState: preloaded?.readyState ?? null,
      atMs: Math.round(performance.now()),
    };
    if (cfgEntry) playObjectSfx(cfgEntry, volumeScale, pitch);
    if (cfgEntry?.generatedStoneKchunk && gameAudioConfig().enabled !== false && objectSfxConfig().enabled !== false && Number(gameAudioConfig().sfxVolume ?? 1) > 0) playGeneratedStoneKchunk(Math.max(0,Number(gameAudioConfig().sfxVolume ?? 1))*Math.max(0,Number(cfgEntry.volume ?? .8))*volumeScale);
  }

  // AlchemyFlasks emits semantic events and never imports AudioSystem. This
  // adapter is the only place that resolves those placeholders to ordinary
  // object-SFX keys, so adding real recordings later is a config-only change.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('hobunji-flask-sfx', event => {
      const detail = event?.detail || {}; // Semantic flask phase and optional world context.
      const cueMap = gameAudioConfig().alchemyFlasks || {}; // Configured phase/cue-ID -> objectSfx key mapping.
      const configuredKey = cueMap[detail.cue] || cueMap[detail.cueId]; // Supports concise phase names or stable exported cue IDs.
      if (configuredKey) playObjectSfxKey(configuredKey);
      window.__farmLog?.(`[alchemy-flask-sfx] ${detail.cueId || detail.cue || 'unknown'}${configuredKey ? ` -> ${configuredKey}` : ' (placeholder)'}`, 'alchemy');
    });
  }

  function objectSfxDebugSnapshot() {
    return {
      last: lastObjectSfxKeyDebug ? { ...lastObjectSfxKeyDebug } : null,
      preloads: [...objectSfxPreloads.entries()].map(([url, snd]) => ({
        key: snd.dataset.objectSfxKey || '?',
        url,
        readyState: snd.readyState,
        networkState: snd.networkState,
      })),
    };
  }

  // Creature combat cues share the same three-dimensional earshot as NPC
  // vocalizations. A cliff's vertical separation must count as distance.
  function playCreatureSfxAt(c, cfgEntry, pitch) {
    if (!cfgEntry || !c || c.areaId !== deps?.getCurrentArea?.()) return;
    const spatial = combatAudioSpatial(c, { earshotTiles: 9 });
    if (spatial.gain <= 0.002) return;
    playOneShotSfx(cfgEntry, spatial.gain, pitch, spatial);
  }

  // Species-keyed pitch lets every creature reuse the same bark asset
  // (only one exists today) while still sounding distinct — alpha
  // gar-wolf pitched down, dabinggi-hound pitched up, relative to the
  // plain gar-wolf's neutral pitch. Future creatures/attacks can add
  // their own url+species entry without touching this function.
  function playCreatureBark(c) {
    const cfg = combatSfxConfig().creatureBark;
    const speciesCfg = cfg?.species?.[c.creatureKey];
    playCreatureSfxAt(c, speciesCfg?.url ? { ...cfg, ...speciesCfg } : cfg, Number(speciesCfg?.pitch) || 1);
  }

  const ANIMAL_VOICE_POOLS = Object.freeze({
    'dabinggi-hound': Object.freeze(['assets/audio/sfx/sfx_dabinggi-hound1.ogg', 'assets/audio/sfx/sfx_dabinggi-hound2.ogg']),
    drenkirra: Object.freeze(['assets/audio/sfx/sfx_drenkirra1.ogg', 'assets/audio/sfx/sfx_drenkirra2.ogg']),
    'gar-wolf': Object.freeze(['assets/audio/sfx/sfx_gar-wolf1.ogg', 'assets/audio/sfx/sfx_gar-wolf2.ogg']),
    grehlr: Object.freeze(['assets/audio/sfx/sfx_grehlr1.ogg', 'assets/audio/sfx/sfx_grehlr2.ogg']),
    nelk: Object.freeze(['assets/audio/sfx/sfx_nelk1.ogg']),
    uumkaoii: Object.freeze(["assets/audio/sfx/sfx_uumkao'ii1.ogg", "assets/audio/sfx/sfx_uumkao'ii2.ogg"]),
  });

  function animalVoiceSpeciesKey(c) {
    const raw = String(c?.creatureKey || c?.speciesKey || c?.species || c?.def?.key || '').toLowerCase();
    if (raw.includes('dabinggi')) return 'dabinggi-hound';
    if (raw.includes('gar-wolf')) return 'gar-wolf';
    if (raw.includes('grehlr')) return 'grehlr';
    if (raw.includes('drenkirra')) return 'drenkirra';
    if (raw.includes('uumkao')) return 'uumkaoii';
    if (raw.includes('nelk')) return 'nelk';
    return raw;
  }

  function hasAnimalVoice(c) {
    if (ANIMAL_VOICE_POOLS[animalVoiceSpeciesKey(c)]?.length) return true;
    const profile = window.AnimalVocalizations?.profileForDebug?.(c); // The cached authored profile owns voices for species added after the legacy pools.
    return !!(profile?.chatter?.allowedClips?.length
      || profile?.warning?.allowedClips?.length || profile?.growl?.allowedClips?.length);
  }

  function animalVoicePool(c, opts) {
    const authored = opts.allowedClips ?? window.AnimalVocalizations?.profileForDebug?.(c)?.[opts.meaning || 'chatter']?.allowedClips; // Semantic requests supply their authored clips; direct calls use the same profile authority.
    return Array.isArray(authored) ? authored : ANIMAL_VOICE_POOLS[animalVoiceSpeciesKey(c)];
  }

  function preloadAnimalVoices() {
    if (typeof Audio !== 'function') return;
    for (const urls of Object.values(ANIMAL_VOICE_POOLS)) for (const url of urls) {
      if (animalVoicePreloads.has(url)) continue;
      const snd = new Audio();
      snd.preload = 'auto';
      snd.src = url;
      // Assigning src with preload=auto is enough to begin browser fetching;
      // avoid an extra load() restart while startup is also priming tool SFX.
      animalVoicePreloads.set(url, snd);
    }
  }

  function disablePitchPreservation(snd) {
    try { snd.preservesPitch = false; } catch (_) {}
    try { snd.mozPreservesPitch = false; } catch (_) {}
    try { snd.webkitPreservesPitch = false; } catch (_) {}
  }

  // How much extra reverb-send "wet" a call gains by the time it's a full
  // chunk away, on top of animal-voice-independent-playback.js's fixed
  // ANIMAL_EXTRA_WET baseline — direct sound attenuates with distance much
  // faster than reflected/reverberant sound does, so a distant jungle call
  // reads as proportionally more echo, not just quieter.
  const ANIMAL_VOICE_DISTANT_EXTRA_WET_MAX = 0.16;

  // Directional/echo spatialization for a creature's vocalization — this
  // module's own playAnimalVoiceUtterance below only ever renders a plain
  // HTMLAudioElement with a distance-derived volume, no panning or reverb
  // graph of its own (see its comment). js/animal-voice-independent-
  // playback.js's WebAudio render path is what actually applies these:
  // panX through a StereoPannerNode, extraWetBoost added on top of its
  // fixed ANIMAL_EXTRA_WET reverb send — "even if too far to render in
  // detail, still originate the sound from the right direction, and sound
  // farther away/more echoey the farther it actually is."
  //
  // All combat sources use the camera-relative basis rather than a fixed world-X pan.
  // Front/back and height remain available even while the orbiting camera turns.
  // Read the same rendered terrain/actor height used by ranged combat.
  // The caller supplies world Y (Three.js units); map x/y remain pixels.
  function audioActorWorldY(actor) {
    if (!actor || !deps) return null;
    const explicitY = actor.avatarRef?.group?.position?.y ?? actor.root?.position?.y;
    if (typeof explicitY === 'number' && Number.isFinite(explicitY)) return explicitY;
    const sampled = deps.getActorWorldY?.(actor);
    if (typeof sampled === 'number' && Number.isFinite(sampled)) return sampled;
    if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return null;
    const surface = deps.worldSurfaceY?.(actor.x, actor.y);
    return typeof surface === 'number' && Number.isFinite(surface) ? surface : null;
  }

  function acousticPosition3D(c) {
    if (!deps?.player || !Number.isFinite(c?.x) || !Number.isFinite(c?.y)) return null;
    const tileSize = Math.max(1, deps.TILE || 64); // World Y already uses tile-sized world units.
    const dx = (c.x - deps.player.x) / tileSize; // Source displacement on world X.
    const dy = (audioActorWorldY(c) ?? 0) - (audioActorWorldY(deps.player) ?? 0); // Real height difference, negative for the bottom of a ravine.
    const dz = (c.y - deps.player.y) / tileSize; // Source displacement on world Z (gameplay's second coordinate is named y).
    const camera = deps.camera;
    camera?.updateMatrixWorld?.();
    const m = camera?.matrixWorld?.elements;
    if (m && m.length >= 16 && [m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]].every(Number.isFinite)) {
      return {
        x: dx*m[0] + dy*m[1] + dz*m[2], // Camera right, independent of character facing and third-person camera offset.
        y: dx*m[4] + dy*m[5] + dz*m[6], // Camera up, retaining vertical origin information.
        z: dx*m[8] + dy*m[9] + dz*m[10], // Camera rear; negative Z is in front of the listener.
      };
    }
    return { x: dx, y: dy, z: dz }; // Stable world-axis fallback for tests/editor previews without a Three.js camera.
  }

  function acousticVerticalSeparationPx(c) {
    const sourceY = audioActorWorldY(c);
    const listenerY = audioActorWorldY(deps?.player);
    return sourceY == null || listenerY == null ? 0 : Math.abs(sourceY - listenerY) * deps.TILE;
  }

  function animalVoiceAcousticDistancePx(c, opts = {}) {
    const overridePx = Number(opts?.acousticDistancePx); // Authored emitters (Banubu) already supply a complete elevation-aware distance.
    if (Number.isFinite(overridePx) && overridePx >= 0) return overridePx;
    if (!deps?.player || !Number.isFinite(c?.x) || !Number.isFinite(c?.y)) return 0;
    return Math.hypot(c.x - deps.player.x, c.y - deps.player.y, acousticVerticalSeparationPx(c));
  }

  function creatureAudioSpatial(c, opts = {}) {
    if (!deps?.player || !Number.isFinite(c?.x) || !Number.isFinite(c?.y)) return { panX: 0, extraWetBoost: 0, distance: 0, verticalDistancePx: 0 };
    const distance = animalVoiceAcousticDistancePx(c, opts); // True 3D distance makes the bottom of a ravine sound below/far away, not beside the listener.
    const position3d = acousticPosition3D(c);
    const panX = position3d ? Math.max(-1, Math.min(1, position3d.x / Math.max(1, Math.hypot(position3d.x, position3d.z) * 0.6))) : 0; // Stereo fallback follows the camera, not fixed world X.
    const chunkPx = (window.WildernessChunks?.constants?.CHUNK_TILES || 16) * deps.TILE;
    const wetT = Math.max(0, Math.min(1, distance / Math.max(1, chunkPx)));
    return { panX, position3d, sourceActor: c, extraWetBoost: wetT * ANIMAL_VOICE_DISTANT_EXTRA_WET_MAX, distance,
      verticalDistancePx: acousticVerticalSeparationPx(c) };
  }

  // Weapon/impact cues and humanoid grunts must share the same source-based
  // distance curve. Expose gain separately: native combat SFX cannot reliably
  // use MediaElementSource panners on all supported mobile browsers.
  function combatAudioSpatial(c, opts = {}) {
    const spatial = creatureAudioSpatial(c, opts);
    const earshotTiles = Math.max(1, Number(opts.earshotTiles) || 12); // Voices can carry farther than short weapon impacts.
    const rangePx = Math.max(1, (deps?.TILE || 64) * earshotTiles);
    const power = Math.max(1, Number(opts.power) || 1.5); // More depth contrast than a flat linear volume ramp.
    const validPosition = Number.isFinite(c?.x) && Number.isFinite(c?.y);
    const otherArea = (c?.areaId || c?.area) && c.areaId !== deps?.getCurrentArea?.() && c.area !== deps?.getCurrentArea?.();
    const gain = otherArea ? 0 : validPosition ? Math.pow(Math.max(0, 1 - spatial.distance / rangePx), power) : 1;
    const result = { ...spatial, gain, earshotPx: rangePx, areaId: c?.areaId || c?.area || deps?.getCurrentArea?.() };
    if (validPosition) {
      lastCombatSpatialDebug = {
        source: c?.id || c?.npcId || c?.name || c?.creatureKey || 'world impact',
        area: c?.areaId || c?.area || null,
        horizontalTiles: Math.hypot(c.x - deps.player.x, c.y - deps.player.y) / (deps.TILE || 64),
        verticalTiles: spatial.verticalDistancePx / (deps.TILE || 64),
        distanceTiles: spatial.distance / (deps.TILE || 64),
        gain: Number(gain.toFixed(3)),
        panX: Number(spatial.panX.toFixed(3)), position3d: spatial.position3d, // Verifies left/right and vertical origin directly on mobile.
      };
    }
    return result;
  }

  // A zone that was just entered is still doing its own expensive
  // synchronous work (chunk build-out, den/nest-pack spawning) — an animal
  // call landing in that same window means paying for a full decode+WSOLA
  // render+WebAudio-graph (see animal-voice-independent-playback.js) right
  // on top of it. Suppressing calls for a few seconds after each area
  // change costs nothing perceptible (wildlife wasn't audible yet anyway
  // at the old close-range earshot either) and keeps that startup window
  // free of extra main-thread contention. Tracked here, not via a
  // WildlifeSpawn.onZoneEntered hook, so it applies to every area (farm/
  // town/caverns too), not just wilderness zones with den packs.
  const ZONE_ENTRY_VOICE_GRACE_MS = 4000;
  let _voiceGraceArea = null;
  let _voiceGraceUntilMs = 0;
  function zoneEntryVoiceGraceActive(areaId) {
    const now = Date.now();
    if (areaId !== _voiceGraceArea) {
      _voiceGraceArea = areaId;
      _voiceGraceUntilMs = now + ZONE_ENTRY_VOICE_GRACE_MS;
    }
    return now < _voiceGraceUntilMs;
  }

  // Low-level renderer only: the vocal coordinator decides what a call
  // means and when each utterance is due; AudioSystem resolves the asset,
  // distance mix, tempo/pitch playback, and browser Audio lifecycle.
  function playAnimalVoiceUtterance(c, opts = {}) {
    const pool = animalVoicePool(c, opts); // Authored species must pass the native preparation gate before independent tempo/pitch playback can start.
    if (!pool?.length || !deps || c?.areaId !== deps.getCurrentArea()) return false;
    const audioCfg = gameAudioConfig();
    if (audioCfg.enabled === false || combatSfxConfig().enabled === false) return false;
    if (zoneEntryVoiceGraceActive(c.areaId)) return false;
    const earshot = deps.TILE * Math.max(1, Number(opts.earshotTiles) || 16);
    const distance = animalVoiceAcousticDistancePx(c, opts); // Optional override lets authored fixed emitters include vertical separation without changing ordinary creature calls.
    if (distance > earshot) return false;
    const clip = pool[Math.floor(Math.random() * pool.length)]; // Authored filenames live in the shared utterance library; legacy pools already contain paths.
    const url = clip.includes('/') ? clip : `assets/audio/sfx/utterances/${clip}`; // Used for preloaded/native preparation and as the direct playback fallback.
    const preload = animalVoicePreloads.get(url);
    const snd = trackActiveSfx(preload?.cloneNode?.(true) || new Audio(url));
    disablePitchPreservation(snd);
    const falloff = Math.max(0, 1 - distance / earshot);
    const baseVolume = Number.isFinite(Number(opts.volume)) ? Number(opts.volume) : 0.7;
    snd.volume = Math.max(0, Math.min(1, baseVolume * Math.max(0, Number(audioCfg.sfxVolume ?? 1)) * falloff));
    if (snd.volume <= 0.002) return false;
    const rate = Math.max(0.35, Math.min(2, Number(opts.rate)) || 1);
    snd.playbackRate = rate;
    const contour = Array.isArray(opts.rateContour)
      ? opts.rateContour.map(v => Math.max(0.35, Math.min(2, Number(v) || rate))) : null;
    if (contour?.length >= 2) {
      const segmentMs = 260;
      contour.slice(1).forEach((nextRate, i) => setTimeout(() => {
        if (!snd.ended && !snd.paused) snd.playbackRate = nextRate;
      }, segmentMs * (i + 1)));
    }
    let startNotified = false; // Used by both `playing` and play() resolution so mobile/browser event differences still emit exactly one visual beat.
    const notifyStarted = () => {
      if (startNotified) return;
      startNotified = true;
      opts.onStarted?.();
    };
    snd.addEventListener?.('playing', notifyStarted, { once: true });
    const playResult = snd.play();
    if (playResult?.then) playResult.then(notifyStarted).catch(() => {});
    return true;
  }

  // Treasure discovery is a player-facing alert, not a combat bark. It needs
  // a little more reach and headroom than the ordinary creature sound: a
  // companion can notice a site several tiles away, while the normal bark's
  // nine-tile falloff would make that notification effectively silent at the
  // exact range where the hint is useful. The gain boost is intentionally
  // scoped to this cue so routine combat audio keeps its authored mix.
  function playCreatureTreasureAlert(c) {
    const cfg = combatSfxConfig().creatureBark;
    if (!cfg || !deps || c?.areaId !== deps.getCurrentArea()) return;
    const spatial = combatAudioSpatial(c, { earshotTiles: 12 }); // Alerts share the caller's 3D origin, including ravine elevation and camera direction.
    const distance = spatial.distance;
    const earshot = deps.TILE * 12;
    if (distance > earshot) return;
    const speciesCfg = cfg.species?.[c.creatureKey] || {};
    const falloff = 0.42 + 0.58 * Math.max(0, 1 - distance / earshot);
    const alertCfg = {
      ...cfg,
      ...speciesCfg,
      volume: Math.min(1, (Number(cfg.volume) || 0.8) * 1.15),
      gainBoost: Math.max(1.8, Number(cfg.gainBoost) || 1),
    };
    playOneShotSfx(alertCfg, falloff, Number(speciesCfg.pitch) || 1, spatial);
  }

  function playCreatureClawHit(c) {
    playCreatureSfxAt(c, combatSfxConfig().creatureClawHit, 1);
  }

  function recordCombatSfx(key, cfgEntry, detail = null) {
    const pool = cfgEntry?.url ? combatSfxPreloads.get(cfgEntry.url) : null;
    const preloaded = pool?.[0] || null;
    lastCombatSfxDebug = {
      key, detail, url: cfgEntry?.url || null, preloaded: !!pool?.length,
      readyState: preloaded?.readyState ?? null, atMs: Math.round(performance.now()),
    };
  }

  // Combo steps are zero-based and map exactly to swing files 1/2/3.
  // Every other melee attack deliberately chooses one of the three anew.
  function playWeaponSlashSfx(pitch, comboStep, attacker = null) {
    const step = Number.isInteger(comboStep) && comboStep >= 0 && comboStep < 3
      ? comboStep : Math.floor(Math.random() * 3);
    const key = `weaponSwing${step + 1}`;
    const cfgEntry = combatSfxConfig()[key];
    const spatial = attacker && attacker !== deps?.player ? combatAudioSpatial(attacker, { earshotTiles: 9 }) : null;
    if (spatial && spatial.gain <= 0.002) return;
    recordCombatSfx(key, cfgEntry, { comboStep: Number.isInteger(comboStep) ? comboStep : null, gain: spatial?.gain ?? 1 });
    playOneShotSfx(cfgEntry, spatial?.gain ?? 1, pitch, spatial);
  }

  // Sized impact sound for any WEAPON hit landing (player Combo/Quick Attack/
  // Charged Breaker/Counter Shield riposte, or a bandit's own mirror of
  // the same abilities) -- distinct from playCreatureClawHit, which
  // stays wildlife-bite-only. tag is the attacker's own weapon dmgType
  // ('sharp'/'blunt', already threaded through every one of those
  // abilities' damageCreature/damagePlayer calls as dmgOpts.tag), not
  // the target's -- "chosen based on the attacker's weapon" per design.
  // Takes a plain x/y/areaId instead of a creature-shaped object so it
  // works equally for a bandit attacker (which has all three already)
  // and the player attacker (which has no .areaId field of its own --
  // see combat-core.js's deps.getCurrentArea()). size is authored by the
  // attack: combos use small/medium/large, while huge stays reserved for
  // true heavy strikes and quick attacks that earned their condition bonus.
  function playWeaponHitSfx(tag, x, y, areaId, pitch, size = 'medium') {
    if (areaId !== deps.getCurrentArea()) return;
    const normalizedSize = ['small', 'medium', 'large', 'huge'].includes(size) ? size : 'medium';
    const family = tag === 'blunt' ? 'Blunt' : 'Sharp';
    const key = `weaponHit${family}${normalizedSize[0].toUpperCase()}${normalizedSize.slice(1)}`;
    const cfgEntry = combatSfxConfig()[key];
    if (!cfgEntry) return;
    const spatial = combatAudioSpatial({ x, y, areaId }, { earshotTiles: 9 });
    if (spatial.gain <= 0.002) return;
    const falloff = spatial.gain;
    recordCombatSfx(key, cfgEntry, { tag: family.toLowerCase(), size: normalizedSize });
    playOneShotSfx(cfgEntry, falloff, pitch, spatial);
  }

  function playCounterShieldBlockSfx(x, y, areaId) {
    if (areaId !== deps.getCurrentArea()) return;
    const cfgEntry = combatSfxConfig().counterShieldBlock;
    if (!cfgEntry) return;
    const spatial = combatAudioSpatial({ x, y, areaId }, { earshotTiles: 9 });
    if (spatial.gain <= 0.002) return;
    const falloff = spatial.gain;
    recordCombatSfx('counterShieldBlock', cfgEntry, { block: true });
    playOneShotSfx(cfgEntry, falloff, undefined, spatial);
  }

  function playRangedImpactSfx(x, y, areaId) {
    if (areaId !== deps.getCurrentArea()) return;
    const cfgEntry = combatSfxConfig().rangedImpact;
    if (!cfgEntry) return;
    const spatial = combatAudioSpatial({ x, y, areaId }, { earshotTiles: 9 });
    if (spatial.gain <= 0.002) return;
    const falloff = spatial.gain;
    recordCombatSfx('rangedImpact', cfgEntry, { rangedImpact: true });
    playOneShotSfx(cfgEntry, falloff, undefined, spatial);
  }

  function combatSfxDebugSnapshot() {
    return {
      last: lastCombatSfxDebug ? { ...lastCombatSfxDebug } : null,
      spatial: lastCombatSpatialDebug ? { ...lastCombatSpatialDebug } : null, // Mobile diagnostics compare horizontal vs ravine depth.
      backend: combatSpatialBackend, spatialStarts: combatSpatialStarts, nativeFallbacks: combatSpatialFallbacks, activeRoutes: activeDirectionalRoutes.size, // Mobile reports live HRTF routes to diagnose cleanup.
      decoded: [...combatDecodedByUrl.values()].filter(v => v.state === 'ready').length,
      decoding: combatDecodeInFlight, queued: combatDecodeQueue.length,
      decodeFailures: [...combatDecodedByUrl.values()].filter(v => v.state === 'failed').length,
      specialCombatDecoded: Object.values(window.HobunjiDrenkirraPellet?.sfx || {}).filter(v => combatDecodedByUrl.get(v.url)?.state === 'ready').length,
      spatialError: combatSpatialLastError,
      maxStartDelayMs: COMBAT_SFX_MAX_START_DELAY_MS,
      preloads: [...combatSfxPreloads.entries()].flatMap(([url, pool]) => pool.map(snd => ({
        key: snd.dataset.combatSfxKey || '?', url, poolIndex: Number(snd.dataset.combatPoolIndex) || 0,
        readyState: snd.readyState, networkState: snd.networkState,
      }))),
    };
  }

  // Beyond this distance from the player, a creature-originated sound
  // (footstep/bark/claw hit/weapon hit) is inaudible. NPC/enemy footsteps
  // pan hard left/right within FOOTSTEP_PAN_RANGE_PX — keeps them clearly
  // directional without needing real spatial audio. Both are read
  // externally by game.js's tickCreatureFootsteps/NPC walker class, since
  // those compute their own falloff/pan before handing off to
  // playFootstepSfx — exposed here (fixed TILE-derived values, resolved
  // once init() has deps.TILE) rather than duplicated.
  let FOOTSTEP_EARSHOT_PX = 0;
  let FOOTSTEP_PAN_RANGE_PX = 0;
  let FOOTSTEP_PLAYER_STRIDE_PX = 0;
  // A call is audible from much farther than a footstep (see
  // animal-vocalizations.js's PROFILE_DEFAULTS.*.earshotTiles, now roughly
  // a wilderness chunk's length), so it needs its own, wider pan range —
  // reusing FOOTSTEP_PAN_RANGE_PX's 5 tiles would pin every call from more
  // than a few tiles off to the side at hard-left/right regardless of how
  // far ahead-vs-beside it actually is.
  let ANIMAL_VOICE_PAN_RANGE_PX = 0;

  function initDerivedConstants() {
    FOOTSTEP_STRIDE_PX = deps.TILE * 0.45;
    FOOTSTEP_EARSHOT_PX = deps.TILE * 9;
    FOOTSTEP_PAN_RANGE_PX = deps.TILE * 5;
    ANIMAL_VOICE_PAN_RANGE_PX = deps.TILE * 10;
    // The player moves much faster (px/s) than NPCs/creatures, so the same
    // per-distance stride would trigger footsteps far more often in real
    // time than it does for them — use a longer player-only stride so the
    // cadence (not the tone) matches how often NPC footsteps land.
    FOOTSTEP_PLAYER_STRIDE_PX = deps.TILE * 1.35;
  }

  function trackActiveSfx(audio) {
    activeSfx.add(audio);
    audio.addEventListener?.('ended', () => activeSfx.delete(audio), { once: true });
    return audio;
  }

  function beginIntroductionMix() {
    introductionMix?.finish();
    const config = gameAudioConfig(), hadEnabled = Object.prototype.hasOwnProperty.call(config, 'enabled'), enabled = config.enabled; // Restore the user's exact master preference/property on cleanup.
    config.enabled = false;
    const resumeMusic = window.Music?.beginQuietLoading?.(); // The existing mixer owns both native and gapless-buffer music transports.
    window.HobunjiAmbientBgs?.silence?.();
    window.HoneyfuzzleAudio?.silence?.(); // Introduction narration owns the soundscape exclusively.
    window.EnvironmentalReverb?.stopAll?.();
    for (const audio of activeSfx) audio.pause?.();
    activeSfx.clear();
    for (const source of [...activePositionalCombat]) source.pause(); // Intro wind must replace in-flight 3D weapon and impact tails too.
    window.AnimalVoiceIndependentPlayback?.stopAll?.();
    const context = window._footstepAudioCtx; // Pause synthesized/recorded Web Audio tails without routing the wind through the suspended context.
    const resumeContext = context?.state === 'running';
    if (resumeContext) context.suspend?.().catch?.(() => {});
    const wind = typeof Audio === 'function' ? new Audio('assets/audio/sfx/bgs/bgs_wind2.mp3') : null; // Stronger existing wind recording is the intro's sole dry audio layer.
    if (wind) { wind.loop = true; wind.volume = 1; wind.preload = 'auto'; wind.dataset.environmentalReverb = 'off'; }
    let finished = false, lastError = null, windStarted = false; // Exposed in the existing intro diagnostics; idempotent cleanup handles repeated cancellation.
    let resolveStarted; // Used by the narration layer so no words fade in before the wind is genuinely playing.
    const started = new Promise(resolve => { resolveStarted = resolve; });
    const markWindStarted = () => {
      if (windStarted) return;
      windStarted = true;
      resolveStarted?.(true);
    };
    if (wind?.addEventListener) wind.addEventListener('playing', markWindStarted, { once: true });
    else if (!wind) markWindStarted(); // Headless/no-media environments must not strand the introduction behind an impossible audio event.
    wind?.addEventListener?.('error', () => { lastError = `wind load failed (${wind.error?.code ?? 'unknown'})`; if (!windStarted) resolveStarted?.(false); }, { once: true }); // A missing/undecodable file can never fire 'playing'; release the narration gate instead of holding the opening on black.
    const session = {
      started,
      retry() {
        if (finished || !wind?.paused) return;
        try {
          const playRequest = wind.play();
          if (!wind.addEventListener) Promise.resolve(playRequest).then(markWindStarted).catch(error => { lastError = String(error); });
          else Promise.resolve(playRequest).catch(error => { lastError = String(error); });
        } catch (error) { lastError = String(error); }
      },
      finish() { if (finished) return; finished = true; if (!windStarted) resolveStarted?.(false); wind?.pause(); if (hadEnabled) config.enabled = enabled; else delete config.enabled; resumeMusic?.(); if (resumeContext) context.resume?.().catch?.(() => {}); window.HobunjiAmbientBgs?.updateNow?.(); window.HoneyfuzzleAudio?.updateNow?.(); if (introductionMix === session) introductionMix = null; },
      debug: () => ({ wind: wind?.src, playing: !!wind && !wind.paused, windStarted, lastError, latestChange: 'Introduction mutes gameplay sound/music, starts the violent wind loop, and exposes its real playing event so narration can wait for audible wind.' }),
    };
    introductionMix = session;
    session.retry();
    return session;
  }

  window.AudioSystem = {
    beginIntroductionMix,
    init(injectedDeps) {
      init(injectedDeps);
      initDerivedConstants();
    },
    gameAudioConfig,
    footstepSurfaceKey,
    footstepTileAt,
    footstepAdvance,
    playFootstepSfx,
    footstepSfxDebugSnapshot,
    playHeavyLandingSfx,
    combatSfxConfig,
    playOneShotSfx,
    playCombatSfxKey,
    objectSfxConfig,
    playObjectSfx,
    playObjectSfxKey,
    objectSfxDebugSnapshot,
    playCreatureSfxAt,
    playCreatureBark,
    hasAnimalVoice,
    creatureAudioSpatial,
    combatAudioSpatial,
    connectCombatSpatialDry, // Shared camera-relative HRTF path reused by vocal DSP and weapon cues.
    playAnimalVoiceUtterance,
    playCreatureTreasureAlert,
    playCreatureClawHit,
    playWeaponSlashSfx,
    playWeaponHitSfx,
    playCounterShieldBlockSfx,
    playRangedImpactSfx,
    combatSfxDebugSnapshot,
    get FOOTSTEP_EARSHOT_PX() { return FOOTSTEP_EARSHOT_PX; },
    get FOOTSTEP_PAN_RANGE_PX() { return FOOTSTEP_PAN_RANGE_PX; },
    get ANIMAL_VOICE_PAN_RANGE_PX() { return ANIMAL_VOICE_PAN_RANGE_PX; },
    get FOOTSTEP_QUIET_SCALE() { return FOOTSTEP_QUIET_SCALE; },
    get FOOTSTEP_PLAYER_STRIDE_PX() { return FOOTSTEP_PLAYER_STRIDE_PX; },
  };
})();
