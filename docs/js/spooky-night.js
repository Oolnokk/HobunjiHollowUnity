// Spooky-night runtime: exposes the full 24-hour clock,
// spatially mixes Just Beyond the Torchlight from 01:00-05:00, and adds wilderness torchfall darkness.
(function installSpookyNight(root) {
  'use strict';
  if (!root || root.SpookyNight) return;

  const TRACK_URL = 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg'; // Used by the dedicated spooky-night BGM loop.
  const SPOOKY_START_HOUR = 1; // Used to enter the spooky window at 1:00 AM.
  const SPOOKY_END_HOUR = 5; // Used to leave the spooky window at 5:00 AM.
  const ORIGINAL_REPRESENTED_HOURS = 16; // Used to preserve the existing seconds-per-game-hour pacing after extending the clock to 24h.
  const EXTENDED_REPRESENTED_HOURS = 24; // Used by the calendar init adapter and overnight time mapping.
  const EXTRA_PACE_SCALE = ORIGINAL_REPRESENTED_HOURS / EXTENDED_REPRESENTED_HOURS; // Applied on top of CalendarSystem's existing natural-time shim.
  const TOWN_MIN_FACTOR = 0.02; // Used at the town center/farm so the spooky track is almost silent.
  const MAP_EDGE_FACTOR = 0.10; // Used at town edges and wilderness entrances for the barely-audible handoff level.
  const FULL_WILDERNESS_DEPTH_FRACTION = 0.50; // Used to reach full BGM once distance from the entrance is half the map height.
  const MUSIC_FADE_SECONDS = 1.1; // Used by the per-frame spatial volume lerp.
  const DARKNESS_ALPHA = 0.97; // Used outside the torchfall gradient in wilderness during spooky night.
  const TORCH_CLEAR_RADIUS_FRACTION = 0.16; // Used for the fully clear center of the screen-space torchfall mask.
  const TORCH_FADE_RADIUS_FRACTION = 0.34; // Used for the outer edge of the torchfall mask.

  const state = {
    calendarDeps: null, // Captured from CalendarSystem.init; used for live time and calendar pacing.
    musicDeps: null, // Captured from Music.init; used for area/player/town-map spatial mixing.
    wildernessDeps: null, // Captured from WildernessMap.init; used for generated wilderness layout dimensions.
    track: null, // Dedicated spooky BGM Audio element reused throughout the night.
    trackTarget: 0, // Target absolute audio volume after BGM master and spatial factors.
    spatialFactor: 0, // Current 0..1 location factor exposed in diagnostics.
    previousArea: '', // Used to detect wilderness entry and refresh the entrance tile.
    wildernessEntrances: new Map(), // zoneId -> {c,r}; used as the distance origin for wilderness volume growth.
    mutedTracks: new Map(), // Music-owned Audio -> prior muted value; restored when spooky hours end.
    trackedAudio: new Set(), // Audio elements created after this early hook; used to suppress competing Music tracks only.
    overlay: null, // Dedicated wilderness-darkness canvas inserted over the existing lighting canvas.
    overlayCtx: null, // 2D context used to draw the torchfall darkness mask.
    lastFrameAt: performance.now(), // Used to make music volume smoothing frame-rate independent.
    lastActive: false, // Used to emit one transition log instead of per-frame spam.
    lastArea: '', // Used to log spatial-mix area changes.
    lastFactorBucket: -1, // Used to throttle mobile-visible spatial-mix debug messages.
    lastDiagAt: -Infinity, // Used for the five-second mobile-visible diagnostic heartbeat.
    playPending: false, // Guards repeated HTMLMediaElement.play() promises while autoplay is resolving.
  };

  function log(message, level = 'info', category = 'audio') {
    if (typeof root.__farmLog === 'function') root.__farmLog(`[spooky-night] ${message}`, level, category);
    else if (level === 'warn' || level === 'error') console.warn(`[spooky-night] ${message}`);
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function modulo24(hour) {
    return ((Number(hour) % 24) + 24) % 24;
  }

  function hourInWindow(hour, startHour, endHour) {
    if (!Number.isFinite(hour)) return false;
    const hour24 = modulo24(hour); // Normalized hour used for both wrapped and same-day windows.
    const start24 = modulo24(startHour); // Normalized lower bound used by the window test below.
    const end24 = modulo24(endHour); // Normalized exclusive upper bound used by the window test below.
    if (start24 === end24) return true;
    return start24 < end24
      ? hour24 >= start24 && hour24 < end24
      : hour24 >= start24 || hour24 < end24;
  }

  function installGlobalInterceptor(name, patcher) {
    let current = root[name]; // Retains the eventual module value while preserving normal window reads/writes.
    const patch = value => {
      if (!value || value.__spookyNightPatched) return value;
      try { patcher(value); value.__spookyNightPatched = true; }
      catch (error) { log(`${name} adapter failed: ${error?.message || error}`, 'error', 'general'); }
      return value;
    };
    if (current) { patch(current); return; }
    const desc = Object.getOwnPropertyDescriptor(root, name);
    if (desc && !desc.configurable) return;
    Object.defineProperty(root, name, {
      configurable: true,
      enumerable: true,
      get() { return current; },
      set(value) { current = patch(value); },
    });
  }

  // Track Audio instances early so only scheduler-owned music (_trackUrl) can
  // be silenced during spooky night without touching SFX, rain, or ambient BGS.
  (function installAudioTracker() {
    const NativeAudio = root.Audio; // Used by the wrapper and by our own untracked spooky track.
    if (typeof NativeAudio !== 'function' || NativeAudio.__spookyNightAudioWrapper) return;
    function TrackedAudio(...args) {
      const audio = new NativeAudio(...args); // Added to the tracking set for later _trackUrl inspection.
      state.trackedAudio.add(audio);
      queueMicrotask(() => { if (!audio._trackUrl) state.trackedAudio.delete(audio); }); // Drops ordinary SFX/BGS after Music has had one synchronous turn to tag scheduler tracks.
      audio.addEventListener?.('emptied', () => {
        if (!audio._trackUrl && audio.paused) state.trackedAudio.delete(audio);
      });
      return audio;
    }
    TrackedAudio.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(TrackedAudio, NativeAudio);
    TrackedAudio.__spookyNightAudioWrapper = true;
    TrackedAudio.__nativeAudio = NativeAudio;
    root.Audio = TrackedAudio;
  })();

  function installExtendedDayPace(calendar) {
    const desc = Object.getOwnPropertyDescriptor(calendar, 'time01'); // Existing CalendarSystem accessor to wrap, not replace semantically.
    if (!desc?.get || !desc?.set || desc.set.__spookyNightPaceWrapper) return;
    const originalGet = desc.get;
    const originalSet = desc.set;
    function setExtendedTime01(nextValue) {
      const current = Number(originalGet.call(calendar)); // Used to identify tiny natural game-loop increments.
      const numeric = Number(nextValue);
      const delta = numeric - current;
      // game.js owns the global rollover check at time01 >= 1. Scale every tiny
      // positive frame write here, independent of the current map/interior, so
      // time01 reaches 1 at the next 06:00 instead of the old 22:00 boundary.
      const naturalWrite = Number.isFinite(delta)
        && delta > 0
        && delta <= 0.02;
      const adjusted = naturalWrite ? current + delta * EXTRA_PACE_SCALE : numeric;
      originalSet.call(calendar, adjusted);
    }
    setExtendedTime01.__spookyNightPaceWrapper = true;
    Object.defineProperty(calendar, 'time01', {
      configurable: true,
      enumerable: true,
      get: originalGet,
      set: setExtendedTime01,
    });
  }

  installGlobalInterceptor('CalendarSystem', system => {
    const rawGetHour = system.getHour; // Wrapped before game.js can capture it, so all consumers see 0..24 overnight hours.
    if (typeof rawGetHour === 'function') {
      system.getHour = function spookyNightGetHour(...args) {
        return modulo24(rawGetHour.apply(this, args));
      };
    }

    const rawInit = system.init; // Used to inject a 24-hour represented span while leaving game.js's 22:00 constant untouched.
    if (typeof rawInit === 'function') {
      system.init = function spookyNightCalendarInit(injectedDeps) {
        const morning = Number(injectedDeps?.MORNING_HOUR);
        const deps24 = {
          ...injectedDeps,
          NIGHT_HOUR: Number.isFinite(morning) ? morning + EXTENDED_REPRESENTED_HOURS : 30,
        }; // Calendar-only clone: makes time01 0..1 map 06:00→next 06:00 while game.js's private rollover still keys off time01 itself.
        state.calendarDeps = deps24;
        const result = rawInit.call(this, deps24);
        installExtendedDayPace(deps24.calendar);
        log('24-hour clock armed globally: rollover now occurs at 06:00; 01:00-05:00 are spooky hours.', 'info', 'world');
        return result;
      };
    }

    if (typeof system.timeDebugSnapshot === 'function') {
      const rawSnapshot = system.timeDebugSnapshot; // Used to correct the mobile-copyable target-day duration after the extra pace wrapper.
      system.timeDebugSnapshot = function spookyNightTimeDebug(...args) {
        const value = rawSnapshot.apply(this, args) || {};
        return {
          ...value,
          spookyNightExtendedClock: true,
          spookyNightHours: `${String(SPOOKY_START_HOUR).padStart(2, '0')}:00-${String(SPOOKY_END_HOUR).padStart(2, '0')}:00`,
          spookyNightRolloverHour: '06:00',
          naturalClockTargetSecondsPerRepresentedDay: Math.round((Number(value.naturalClockTargetSecondsPerRepresentedDay) || 672) / EXTRA_PACE_SCALE),
        };
      };
    }
  });

  installGlobalInterceptor('Music', music => {
    const rawInit = music.init; // Captures the same live dependencies already used by the existing music scheduler.
    if (typeof rawInit === 'function') {
      music.init = function spookyNightMusicInit(injectedDeps) {
        state.musicDeps = injectedDeps;
        return rawInit.call(this, injectedDeps);
      };
    }
  });

  installGlobalInterceptor('WildernessMap', wilderness => {
    const rawInit = wilderness.init; // Captures _zoneLayouts without introducing a second wilderness-layout owner.
    if (typeof rawInit === 'function') {
      wilderness.init = function spookyNightWildernessInit(injectedDeps) {
        state.wildernessDeps = injectedDeps;
        return rawInit.call(this, injectedDeps);
      };
    }
  });

  function currentHour() {
    const deps = state.calendarDeps;
    if (!deps?.calendar) return NaN;
    return modulo24((Number(deps.MORNING_HOUR) || 6) + clamp(deps.calendar.time01, 0, 1) * EXTENDED_REPRESENTED_HOURS);
  }

  function isSpookyHour(hour = currentHour()) {
    return hourInWindow(hour, SPOOKY_START_HOUR, SPOOKY_END_HOUR);
  }

  function townMap() {
    return state.musicDeps?.getWorkspaceMaps?.()?.find(map => map?.id === 'map_hobunji_town') || null;
  }

  function playerTile() {
    const deps = state.musicDeps;
    if (!deps?.player || !Number.isFinite(Number(deps.TILE)) || Number(deps.TILE) <= 0) return null;
    return {
      c: Number(deps.player.x) / Number(deps.TILE),
      r: Number(deps.player.y) / Number(deps.TILE),
    };
  }

  function isZoneArea(area) {
    return !!state.musicDeps?._isZoneArea?.(area);
  }

  function spatialMix() {
    const deps = state.musicDeps;
    if (!deps) return { factor: 0, area: '', mode: 'uninitialized' };
    const area = deps.getCurrentArea?.() || '';
    const tile = playerTile();

    if (!isSpookyHour()) {
      state.previousArea = area;
      return { factor: 0, area, mode: 'day' };
    }

    if (area === 'town') {
      state.previousArea = area;
      const map = townMap();
      if (!tile || !map) return { factor: TOWN_MIN_FACTOR, area, mode: 'town-fallback' };
      const cols = Math.max(1, Number(map.cols) || 1);
      const rows = Math.max(1, Number(map.rows) || 1);
      const edgeDistance = Math.max(0, Math.min(tile.c, cols - 1 - tile.c, tile.r, rows - 1 - tile.r)); // Used to grow the track toward every town-map edge.
      const centerDistance = Math.max(1, Math.min(cols, rows) * 0.5);
      const edgeProximity = 1 - clamp(edgeDistance / centerDistance);
      const factor = TOWN_MIN_FACTOR + (MAP_EDGE_FACTOR - TOWN_MIN_FACTOR) * edgeProximity;
      return { factor, area, mode: 'town', edgeProximity, cols, rows };
    }

    if (area === 'farm') {
      state.previousArea = area;
      return { factor: TOWN_MIN_FACTOR, area, mode: 'farm' };
    }

    if (isZoneArea(area)) {
      const layout = state.wildernessDeps?._zoneLayouts?.get?.(area);
      if (tile && (state.previousArea !== area || !state.wildernessEntrances.has(area))) {
        state.wildernessEntrances.set(area, { c: tile.c, r: tile.r });
        log(`wilderness entrance captured area=${area} tile=${tile.c.toFixed(1)},${tile.r.toFixed(1)}`, 'info', 'world');
      }
      state.previousArea = area;
      const entrance = state.wildernessEntrances.get(area);
      const rows = Math.max(1, Number(layout?.rows) || 1);
      if (!tile || !entrance) return { factor: MAP_EDGE_FACTOR, area, mode: 'wilderness-fallback', rows };
      const distanceTiles = Math.hypot(tile.c - entrance.c, tile.r - entrance.r); // Used as true tile distance away from the entry point.
      const fullAtTiles = Math.max(1, rows * FULL_WILDERNESS_DEPTH_FRACTION);
      const depth01 = clamp(distanceTiles / fullAtTiles);
      const factor = MAP_EDGE_FACTOR + (1 - MAP_EDGE_FACTOR) * depth01;
      return { factor, area, mode: 'wilderness', distanceTiles, fullAtTiles, depth01, entrance, rows };
    }

    state.previousArea = area;
    return { factor: 0, area, mode: 'other' };
  }

  function audioConfig() {
    return root.AudioSystem?.gameAudioConfig?.() || root.SCRATCHBONES_CONFIG?.audio || {};
  }

  function ensureTrack() {
    if (state.track) return state.track;
    const NativeAudio = root.Audio?.__nativeAudio || root.Audio; // Bypasses the general tracker so our own track is never mistaken for competing BGM.
    if (typeof NativeAudio !== 'function') return null;
    const audio = new NativeAudio(TRACK_URL);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio._spookyNightTrack = true;
    audio.addEventListener('error', () => log(`BGM media error: ${TRACK_URL}`, 'warn', 'audio'));
    state.track = audio;
    return audio;
  }

  function requestTrackPlay() {
    const track = ensureTrack();
    if (!track || state.playPending || !track.paused) return;
    state.playPending = true;
    Promise.resolve(track.play()).catch(error => {
      const name = error?.name || String(error || 'play failed');
      if (name !== 'NotAllowedError' && name !== 'AbortError') log(`BGM play failed: ${name}`, 'warn', 'audio');
    }).finally(() => { state.playPending = false; });
  }

  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(eventName, () => {
      if (isSpookyHour() && state.trackTarget > 0.001) requestTrackPlay();
    }, { capture: true, passive: eventName === 'touchstart' });
  }

  function suppressCompetingMusic(active) {
    for (const audio of [...state.trackedAudio]) {
      if (!audio || audio._spookyNightTrack || !audio._trackUrl) continue;
      if (active) {
        if (!state.mutedTracks.has(audio)) state.mutedTracks.set(audio, !!audio.muted);
        audio.muted = true;
      } else if (state.mutedTracks.has(audio)) {
        audio.muted = state.mutedTracks.get(audio);
        state.mutedTracks.delete(audio);
      }
    }
    if (!active && state.mutedTracks.size) {
      for (const [audio, previousMuted] of state.mutedTracks) audio.muted = previousMuted;
      state.mutedTracks.clear();
    }
  }

  function ensureOverlay() {
    if (state.overlay?.isConnected) return state.overlay;
    const wrap = document.getElementById('canvasWrap');
    if (!wrap) return null;
    const canvas = document.createElement('canvas'); // Drawn above lightingCanvas (z=3) but below HUD/debug UI.
    canvas.id = 'spookyNightCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '4', display: 'none',
    });
    wrap.appendChild(canvas);
    state.overlay = canvas;
    state.overlayCtx = canvas.getContext('2d');
    return canvas;
  }

  function drawDarkness(active) {
    const canvas = ensureOverlay();
    const ctx = state.overlayCtx;
    if (!canvas || !ctx) return;
    const area = state.musicDeps?.getCurrentArea?.() || '';
    const visible = active && isZoneArea(area);
    canvas.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, root.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgba(0,0,0,${DARKNESS_ALPHA})`;
    ctx.fillRect(0, 0, w, h);

    const minDim = Math.max(1, Math.min(w, h));
    const inner = minDim * TORCH_CLEAR_RADIUS_FRACTION;
    const outer = minDim * TORCH_FADE_RADIUS_FRACTION;
    const cx = w * 0.5, cy = h * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.62, 'rgba(0,0,0,0.92)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function exposeDebugTools(mix, hour, active) {
    if (root.__farmDebugTools && !root.__farmDebugTools.spookyNightSnapshot) {
      root.__farmDebugTools.spookyNightSnapshot = () => snapshot();
      root.__farmDebugTools.copySpookyNightDebug = () => copyDebug();
    }
    const now = performance.now();
    const bucket = Math.round(clamp(mix.factor) * 10);
    if (mix.area !== state.lastArea || bucket !== state.lastFactorBucket) {
      state.lastArea = mix.area;
      state.lastFactorBucket = bucket;
      log(`mix area=${mix.area || 'none'} mode=${mix.mode} factor=${mix.factor.toFixed(3)} hour=${Number.isFinite(hour) ? hour.toFixed(2) : 'n/a'}`, 'bgm', 'audio');
    }
    if (active && now - state.lastDiagAt >= 5000) {
      state.lastDiagAt = now;
      log(`diag hour=${hour.toFixed(2)} area=${mix.area} mode=${mix.mode} factor=${mix.factor.toFixed(3)} target=${state.trackTarget.toFixed(3)} live=${(state.track?.volume || 0).toFixed(3)} dark=${isZoneArea(mix.area)}`, 'bgm', 'audio');
    }
  }

  function update(now) {
    const dt = Math.max(0, Math.min(0.25, (now - state.lastFrameAt) / 1000));
    state.lastFrameAt = now;
    const hour = currentHour();
    const active = isSpookyHour(hour);
    const mix = spatialMix();
    state.spatialFactor = clamp(mix.factor);
    const cfg = audioConfig();
    const bgmEnabled = cfg.enabled !== false && cfg.bgmEnabled !== false;
    const bgmMaster = clamp(Number(cfg.bgmVolume ?? 0.4));
    state.trackTarget = active && bgmEnabled ? bgmMaster * state.spatialFactor : 0;

    if (active !== state.lastActive) {
      state.lastActive = active;
      log(`${active ? 'entered' : 'left'} spooky hours at ${Number.isFinite(hour) ? hour.toFixed(2) : 'unknown'}; ${active ? 'Just Beyond the Torchlight owns exploration BGM.' : 'normal music restored.'}`, 'bgm', 'audio');
    }

    suppressCompetingMusic(active);
    const track = ensureTrack();
    if (track) {
      const blend = MUSIC_FADE_SECONDS <= 0 ? 1 : 1 - Math.exp(-dt * 4.6 / MUSIC_FADE_SECONDS);
      track.volume = clamp(track.volume + (state.trackTarget - track.volume) * blend);
      if (state.trackTarget > 0.001) requestTrackPlay();
      else if (track.volume <= 0.002 && !track.paused) {
        track.pause();
        if (!active) { try { track.currentTime = 0; } catch (_) {} }
      }
    }

    drawDarkness(active);
    exposeDebugTools(mix, hour, active);
    root.requestAnimationFrame(update);
  }

  function snapshot() {
    const hour = currentHour();
    const mix = spatialMix();
    return {
      active: isSpookyHour(hour),
      hour,
      area: mix.area,
      mode: mix.mode,
      spatialFactor: mix.factor,
      trackTargetVolume: state.trackTarget,
      trackLiveVolume: state.track?.volume || 0,
      trackPaused: state.track?.paused ?? true,
      darknessActive: !!(state.overlay && state.overlay.style.display !== 'none'),
      wildernessEntrance: mix.entrance || null,
      wildernessDistanceTiles: mix.distanceTiles ?? null,
      wildernessFullVolumeAtTiles: mix.fullAtTiles ?? null,
      townEdgeProximity: mix.edgeProximity ?? null,
      constants: {
        townMinFactor: TOWN_MIN_FACTOR,
        mapEdgeFactor: MAP_EDGE_FACTOR,
        fullWildernessDepthFraction: FULL_WILDERNESS_DEPTH_FRACTION,
        spookyStartHour: SPOOKY_START_HOUR,
        spookyEndHour: SPOOKY_END_HOUR,
      },
    };
  }

  function copyDebug() {
    const text = JSON.stringify(snapshot(), null, 2);
    root.navigator?.clipboard?.writeText?.(text).catch?.(() => {});
    log('spooky-night debug snapshot copied.', 'info', 'general');
    return text;
  }

  root.SpookyNight = Object.freeze({
    snapshot,
    copyDebug,
    isActive: () => isSpookyHour(),
    constants: Object.freeze({
      TRACK_URL,
      SPOOKY_START_HOUR,
      SPOOKY_END_HOUR,
      TOWN_MIN_FACTOR,
      MAP_EDGE_FACTOR,
      FULL_WILDERNESS_DEPTH_FRACTION,
    }),
  });

  root.requestAnimationFrame(update);
  log('runtime installed; waiting for CalendarSystem/Music/WildernessMap init.', 'info', 'general');
})(typeof window !== 'undefined' ? window : globalThis);
