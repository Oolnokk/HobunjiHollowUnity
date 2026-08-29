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
  const objectSfxPreloads = new Map(); // Retains eagerly loaded tool cues for low-latency clones in playObjectSfx.
  const combatSfxPreloads = new Map(); // URL -> bounded ready-element pool used so rapid combat cues cannot queue indefinitely.
  const animalVoicePreloads = new Map(); // Keeps species calls decoded/ready before a semantic vocal intent fires.
  let lastObjectSfxKeyDebug = null; // Reported by Pixel Probe to diagnose cue lookup/preload timing on mobile.
  let lastCombatSfxDebug = null; // Reported by Pixel Probe to verify swing index, damage type, and impact size on mobile.
  function init(injectedDeps) {
    deps = injectedDeps;
    preloadConfiguredObjectSfx();
    preloadConfiguredCombatSfx();
    preloadAnimalVoices();
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
  // Interior floors always map to 'gravel' regardless of the
  // (irrelevant) tile type beneath them, until interiors get their own
  // recorded surface.
  //
  // Each surface's clip list normally comes from config
  // (audio.footsteps.surfaces[key].urls, see scratchbones-config.js) —
  // FOOTSTEP_POST_FX below only carries the oscillator+noise synth
  // fallback tuning (filter shape/cutoff/Q, pitch, decay length) used
  // when no urls are configured for a surface.
  const FOOTSTEP_BASE = Object.freeze({
    waveform: 'triangle', freq: 55, freqVarianceHz: 16, durationMs: 55, noiseMix: 0.82, volume: 0.6,
  });

  const FOOTSTEP_POST_FX = Object.freeze({
    grass:  {},
    gravel: { filterFreqMul: 4.6, filterQ: 2.4, durationMul: 0.6, pitchMul: 1.2, volumeMul: 0.9 },
    water:  { filterFreqMul: 5.5, filterQ: 1.0, durationMul: 1.3, pitchMul: 1.7, volumeMul: 1.0, filterType: 'highpass' },
  });

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

  // Grass = grasstep. Path (and everything else that's hard-packed/
  // exposed ground rather than turf — tilled/raised soil, dug trenches,
  // rock, shrub, ramps) = gravelstep. Anything that actually holds
  // standing water (river/stream/waterfall/paddy) = waterstep — this is
  // "swimming" territory, not a moisture blend (see playFootstepSfx for
  // the blend applied to grass/gravel ground tiles instead).
  function footstepSurfaceKey(area, type) {
    if (area === 'interior' || deps._isBuildingArea(area)) return 'gravel'; // temporary — no dedicated interior surface yet
    const TileType = deps.TileType;
    switch (type) {
      case TileType.PADDY:
      case TileType.RIVER:
      case TileType.STREAM:
      case TileType.WATERFALL: return 'water';
      case TileType.PATH:
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

  // Routes a real footstep clip through the shared footstep AudioContext
  // with a dulling lowpass instead of just setting .volume, so a "heavy"
  // landing thud actually sounds tonally heavier (less high-end clack),
  // not just louder — used by playFootstepSurface's heavy branch.
  function playHeavyFilteredClip(snd, volume) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('no AudioContext');
      const ctx = window._footstepAudioCtx || (window._footstepAudioCtx = new AudioCtx());
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const source = ctx.createMediaElementSource(snd);
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 900; // dulls the clip's high end into a thud instead of a clack
      lpf.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, volume * 1.15); // filtering loses perceived loudness; compensate
      source.connect(lpf).connect(gain).connect(ctx.destination);
      snd.play().catch(() => {});
    } catch (e) {
      snd.volume = volume;
      snd.play().catch(() => {});
    }
  }

  // Plays one surface's footfall at `volume` — a random pick from that
  // surface's configured clip list (audio.footsteps.surfaces[key].urls)
  // when one exists, else the oscillator+noise synth fallback tuned by
  // FOOTSTEP_POST_FX. `pan` only affects the synth fallback (a plain
  // <audio> element, like every other one-shot sfx in this file, doesn't
  // get routed through a StereoPannerNode).
  //
  // `heavy` is for a dodge/attack-lunge landing thud (see
  // playHeavyLandingSfx): pitches noticeably down and, for real clips,
  // runs through playHeavyFilteredClip's dulling lowpass so it reads as
  // hitting the ground hard rather than an ordinary stride.
  function playFootstepSurface(surfaceKey, footstepCfg, volume, pan, heavy = false) {
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
      const snd = new Audio(url);
      snd.playbackRate = heavy ? (0.6 + Math.random() * 0.1) : (0.92 + Math.random() * 0.16);
      if (heavy) playHeavyFilteredClip(snd, finalVolume);
      else { snd.volume = finalVolume; snd.play().catch(() => {}); }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = window._footstepAudioCtx || (window._footstepAudioCtx = new AudioCtx());
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const base = FOOTSTEP_BASE;
    const pitchMul = (Number(postFx.pitchMul) || 1) * (heavy ? 0.55 : 1);
    const durationS = Math.max(0.02, (Number(base.durationMs) || 55) / 1000 * (Number(postFx.durationMul) || 1) * (heavy ? 2.2 : 1));
    const noiseMix = Math.max(0, Math.min(1, Number(base.noiseMix) ?? 0.82));
    const baseFreq = Math.max(20, Number(base.freq) * pitchMul);
    const variance = Math.max(0, Number(base.freqVarianceHz) || 15);

    const panNode = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panNode) {
      panNode.pan.value = Math.max(-1, Math.min(1, pan));
      panNode.connect(ctx.destination);
    }
    const outNode = panNode || ctx.destination;

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
  // heavy (louder, pitched-down/filtered) mode instead of a plain stride.
  //
  // Ground surfaces (grass/gravel) layer in a second, simultaneous
  // waterstep clip scaled by the tile's moisture (tile.water, 0..
  // MAX_WATER) — a bone-dry tile blends none in, a fully flooded one
  // blends it in at FOOTSTEP_WATER_BLEND_MAX (80%) of the footstep's own
  // volume. Actual water tiles (river/stream/paddy/waterfall) already
  // resolve straight to the 'water' surface via footstepSurfaceKey and
  // skip this blend — they're pure waterstep, not a blend target.
  function playFootstepSfx(area, tile, volumeScale = 1, pan = 0, opts = {}) {
    const audioCfg = gameAudioConfig();
    if (audioCfg.enabled === false) return;
    const footstepCfg = audioCfg.footsteps || {};
    if (footstepCfg.enabled === false) return;
    const heavy = !!opts.heavy;
    const surfaceKey = footstepSurfaceKey(area, tile?.type ?? null);
    const baseVolume = Math.max(0, Math.min(1, Number(footstepCfg.volume) || 0.65));
    const volume = baseVolume * Math.max(0, Number(audioCfg.sfxVolume) || 1)
      * Math.max(0, volumeScale) * Math.max(0, Number(FOOTSTEP_BASE.volume) || 0.26);
    playFootstepSurface(surfaceKey, footstepCfg, volume, pan, heavy);

    if (surfaceKey !== 'water') {
      const wetFraction = deps.clamp((Number(tile?.water) || 0) / deps.MAX_WATER, 0, 1);
      playFootstepSurface('water', footstepCfg, volume * wetFraction * FOOTSTEP_WATER_BLEND_MAX, pan, heavy);
    }
  }

  // Heavy "landing thud" used when a dodge or attack lunge comes to a
  // stop — same surface/moisture-blend as an ordinary footstep (see
  // playFootstepSfx) but louder and run through playFootstepSurface's
  // heavy mode so it reads as hitting the ground hard after a leap,
  // not just another stride in the cadence. Player-only: dodges and
  // combat lunges are a player.dodging/player.lunging-only mechanic
  // (see performDodge/beginCombatLunge) — no pan, matching the player's
  // own unpanned regular footsteps.
  const HEAVY_LANDING_VOLUME_MUL = 2.0;
  function playHeavyLandingSfx(area, tile) {
    playFootstepSfx(area, tile, HEAVY_LANDING_VOLUME_MUL, 0, { heavy: true });
  }

  function combatSfxConfig() { return gameAudioConfig().combatSfx || {}; }

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
    