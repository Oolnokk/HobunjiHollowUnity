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
  function init(injectedDeps) { deps = injectedDeps; }

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

  // One-shot combat SFX player (weapon slash / creature bark / claw hit) —
  // simpler than playFootstepSfx since these always have a real audio
  // file staged (no procedural WebAudio fallback needed).
  function playOneShotSfx(cfgEntry, volumeScale = 1, pitch = 1) {
    const audioCfg = gameAudioConfig();
    if (audioCfg.enabled === false || !cfgEntry?.url) return;
    if (combatSfxConfig().enabled === false) return;
    const volume = Math.max(0, Math.min(1, Number(cfgEntry.volume) || 0.8))
      * Math.max(0, Number(audioCfg.sfxVolume) || 1) * Math.max(0, volumeScale);
    if (volume <= 0.002) return;
    const snd = new Audio(cfgEntry.url);
    const pitchVariance = Number(cfgEntry.pitchVarianceMul) || 0;
    snd.playbackRate = Math.max(0.3, pitch * (1 + (Math.random() * 2 - 1) * pitchVariance));
    playSfxAudioElement(snd, volume, Number(cfgEntry.gainBoost) || 1);
  }

  function objectSfxConfig() { return gameAudioConfig().objectSfx || {}; }

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
  function playSfxAudioElement(snd, volume, gainBoost) {
    if (!(gainBoost > 1)) {
      snd.volume = Math.min(1, volume);
      snd.play().catch(() => {});
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('no AudioContext');
      const ctx = window._footstepAudioCtx || (window._footstepAudioCtx = new AudioCtx());
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const source = ctx.createMediaElementSource(snd);
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, volume * gainBoost);
      source.connect(gain).connect(ctx.destination);
      snd.play().catch(() => {});
    } catch (e) {
      snd.volume = Math.min(1, volume);
      snd.play().catch(() => {});
    }
  }

  function playObjectSfx(cfgEntry, volumeScale = 1, pitch = 1) {
    const audioCfg = gameAudioConfig();
    if (audioCfg.enabled === false || !cfgEntry) return;
    if (objectSfxConfig().enabled === false) return;
    const volume = Math.max(0, Math.min(1, Number(cfgEntry.volume) || 0.8))
      * Math.max(0, Number(audioCfg.sfxVolume) || 1) * Math.max(0, volumeScale);
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
    const snd = new Audio(url);
    snd.playbackRate = rate;
    if (preferReal && hasPlaceholder) {
      snd.addEventListener('error', () => {
        if (!deps.isRealMediaError(snd)) return;
        deps.markAudioUrlFailed(cfgEntry.url, 'object sfx load failed');
        const fallback = new Audio(pickPlaceholder());
        fallback.playbackRate = rate;
        playSfxAudioElement(fallback, volume, gainBoost);
      }, { once: true });
    }
    playSfxAudioElement(snd, volume, gainBoost);
  }

  function playObjectSfxKey(key, volumeScale = 1, pitch = 1) {
    const cfgEntry = objectSfxConfig()[key]; // Resolves named UI/object/tool cues without leaking the config shape to gameplay systems.
    if (cfgEntry) playObjectSfx(cfgEntry, volumeScale, pitch);
  }

  // Distance falloff for a creature-originated combat sound (bark/claw
  // hit), mirroring tickCreatureFootsteps — inaudible past earshot.
  function playCreatureSfxAt(c, cfgEntry, pitch) {
    if (!cfgEntry || c.areaId !== deps.getCurrentArea()) return;
    const distToPlayer = Math.hypot(c.x - deps.player.x, c.y - deps.player.y);
    if (distToPlayer > FOOTSTEP_EARSHOT_PX) return;
    // Linear, not squared — squared falloff made anything past ~30% of
    // earshot drop to near-silence, which was most of the usable range.
    const falloff = Math.max(0, 1 - distToPlayer / FOOTSTEP_EARSHOT_PX);
    playOneShotSfx(cfgEntry, falloff, pitch);
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

  // Treasure discovery is a player-facing alert, not a combat bark. It needs
  // a little more reach and headroom than the ordinary creature sound: a
  // companion can notice a site several tiles away, while the normal bark's
  // nine-tile falloff would make that notification effectively silent at the
  // exact range where the hint is useful. The gain boost is intentionally
  // scoped to this cue so routine combat audio keeps its authored mix.
  function playCreatureTreasureAlert(c) {
    const cfg = combatSfxConfig().creatureBark;
    if (!cfg || !deps || c?.areaId !== deps.getCurrentArea()) return;
    const distance = Math.hypot(c.x - deps.player.x, c.y - deps.player.y);
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
    playOneShotSfx(alertCfg, falloff, Number(speciesCfg.pitch) || 1);
  }

  function playCreatureClawHit(c) {
    playCreatureSfxAt(c, combatSfxConfig().creatureClawHit, 1);
  }

  function playWeaponSlashSfx(pitch) {
    playOneShotSfx(combatSfxConfig().weaponSlash, 1, pitch);
  }

  // Impact sound for any WEAPON hit landing (player Combo/Quick Attack/
  // Charged Breaker/Counter Shield riposte, or a bandit's own mirror of
  // the same abilities) -- distinct from playCreatureClawHit, which
  // stays wildlife-bite-only. tag is the attacker's own weapon dmgType
  // ('sharp'/'blunt', already threaded through every one of those
  // abilities' damageCreature/damagePlayer calls as dmgOpts.tag), not
  // the target's -- "chosen based on the attacker's weapon" per design.
  // Takes a plain x/y/areaId instead of a creature-shaped object so it
  // works equally for a bandit attacker (which has all three already)
  // and the player attacker (which has no .areaId field of its own --
  // see combat-core.js's deps.getCurrentArea()).
  function playWeaponHitSfx(tag, x, y, areaId, pitch) {
    if (areaId !== deps.getCurrentArea()) return;
    const cfgEntry = combatSfxConfig()[tag === 'blunt' ? 'weaponHitBlunt' : 'weaponHitSharp'];
    if (!cfgEntry) return;
    const distToPlayer = Math.hypot(x - deps.player.x, y - deps.player.y);
    if (distToPlayer > FOOTSTEP_EARSHOT_PX) return;
    const falloff = Math.max(0, 1 - distToPlayer / FOOTSTEP_EARSHOT_PX);
    playOneShotSfx(cfgEntry, falloff, pitch);
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

  function initDerivedConstants() {
    FOOTSTEP_STRIDE_PX = deps.TILE * 0.45;
    FOOTSTEP_EARSHOT_PX = deps.TILE * 9;
    FOOTSTEP_PAN_RANGE_PX = deps.TILE * 5;
    // The player moves much faster (px/s) than NPCs/creatures, so the same
    // per-distance stride would trigger footsteps far more often in real
    // time than it does for them — use a longer player-only stride so the
    // cadence (not the tone) matches how often NPC footsteps land.
    FOOTSTEP_PLAYER_STRIDE_PX = deps.TILE * 1.35;
  }

  window.AudioSystem = {
    init(injectedDeps) {
      init(injectedDeps);
      initDerivedConstants();
    },
    gameAudioConfig,
    footstepSurfaceKey,
    footstepTileAt,
    footstepAdvance,
    playFootstepSfx,
    playHeavyLandingSfx,
    combatSfxConfig,
    playOneShotSfx,
    objectSfxConfig,
    playObjectSfx,
    playObjectSfxKey,
    playCreatureSfxAt,
    playCreatureBark,
    playCreatureTreasureAlert,
    playCreatureClawHit,
    playWeaponSlashSfx,
    playWeaponHitSfx,
    get FOOTSTEP_EARSHOT_PX() { return FOOTSTEP_EARSHOT_PX; },
    get FOOTSTEP_PAN_RANGE_PX() { return FOOTSTEP_PAN_RANGE_PX; },
    get FOOTSTEP_QUIET_SCALE() { return FOOTSTEP_QUIET_SCALE; },
    get FOOTSTEP_PLAYER_STRIDE_PX() { return FOOTSTEP_PLAYER_STRIDE_PX; },
  };
})();
