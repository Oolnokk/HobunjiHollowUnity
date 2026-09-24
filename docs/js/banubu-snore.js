(() => {
  'use strict';

  const BANUBU_AREA_ID = 'map_northern_cliffs'; // Used to keep the exterior cave snore out of unrelated maps and Banubu's interior.
  const BANUBU_LOCALE_ID = 'locale_banubu_shrine'; // Used to resolve the live Tothal-shifted entrance transition rather than the locale anchor.
  const BANUBU_INTERIOR_ID = 'map_i_den_banubu'; // Used only as a compatibility fallback when an older generated transition lacks generatedLocaleId.
  const MAX_CHUNK_DISTANCE = 2; // Used by the coarse proximity gate: the player's chunk may be the entrance chunk or up to two chunks away.
  const IDLE_RECHECK_MS = 250; // Used only while no snore is playing so range/night checks stay cheap off-screen.
  const FAILED_START_RETRY_MS = 1000; // Used to avoid frame-spamming a temporarily blocked audio backend.
  const SNORE_TEMPO = 1 / 9; // Used to triple the existing one-third-speed Grehlr snore's audible duration.
  const SHORT_SNORE_TEMPO = 2 / 3; // Used by the short follow-up so its authored utterance lasts 50% longer while keeping the separate +2-semitone pitch.
  const SHORT_SNORE_PITCH_OFFSET = 2; // Raises only the short follow-up by a couple of semitones.
  const SNORE_PITCH_OFFSET = -12; // Lowers both snore calls by one octave while preserving the short call's relative pitch.
  const ACOUSTIC_EARSHOT_CHUNKS = 5; // Used only for smooth distance/elevation attenuation after the stricter two-chunk gate passes.
  const SCHEDULER_ID = 'banubu-night-snore'; // Used to keep development reloads from registering duplicate frame subscribers.

  let nextAttemptAtMs = 0; // Used to enforce the measured post-snore silence and throttle inactive/failed checks.
  let snorePlaying = false; // Used to guarantee only one slowed chatter call can be active at a time.
  let lastStartedAtMs = 0; // Used to measure the real rendered snore duration for mobile diagnostics.
  let schedulerUnsubscribe = null; // Used by dispose() so a development reload can cleanly detach this feature.
  let lastLoggedStatus = ''; // Used to keep the in-game debug log readable instead of logging every proximity poll.
  let activeSnoreController = null; // Cancels an already audible snore as soon as Banubu is addressed.
  let nextSnorePhase = 'long'; // Chooses the long or short call when the next eligible frame starts playback.
  let cycleDurationMs = 0; // Accumulates audible durations of the two calls for the following equal-length pause.
  let activeSnoreToken = 0; // Invalidates delayed audio callbacks after dialogue or disposal cancels a call.

  const debugState = {
    status: 'booting',
    area: null,
    night: false,
    originSource: null,
    transitionId: null,
    entranceCol: null,
    entranceRow: null,
    entranceElevation: null,
    playerElevation: null,
    playerChunk: null,
    entranceChunk: null,
    chunkDistance: null,
    horizontalDistanceTiles: null,
    elevationDistanceTiles: null,
    acousticDistanceTiles: null,
    baseVolume: null,
    acousticGain: null,
    tempo: SNORE_TEMPO,
    phase: 'long',
    playing: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastLongDurationMs: null,
    lastShortDurationMs: null,
    lastPauseMs: null,
    cycleDurationMs: 0,
    lastError: null,
  }; // Exposed through debugSnapshot() and Pixel Probe so mobile testing does not require a console.

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function logStatus(status) {
    if (status === lastLoggedStatus) return;
    lastLoggedStatus = status;
    if (typeof window.__farmLog === 'function') window.__farmLog(`[banubu-snore] ${status}`, 'audio');
  }

  function setStatus(status, detail = null) {
    debugState.status = detail ? `${status}: ${detail}` : status;
    debugState.playing = snorePlaying;
    logStatus(debugState.status);
  }

  function gameDeps() {
    return window.Combat?.deps || null;
  }

  function currentArea(deps) {
    return deps?.getCurrentArea?.() || null;
  }

  function liveEntranceTransition(layout) {
    const transitions = Array.isArray(layout?.transitions) ? layout.transitions : [];
    return transitions.find(transition => transition?.generatedLocaleId === BANUBU_LOCALE_ID)
      || transitions.find(transition => transition?.id === `sp_locale_${BANUBU_LOCALE_ID}`)
      || transitions.find(transition => transition?.targetMapId === BANUBU_INTERIOR_ID)
      || null;
  }

  function activeGrid(deps, area) {
    return deps?.getActiveGrid?.()
      || deps?.zoneScenes?.get?.(area)?.grid
      || deps?.zoneLayouts?.get?.(area)?.grid
      || null;
  }

  function surfaceYAt(deps, area, col, row) {
    const worldX = col + 0.5; // Used by exact continuous-surface samplers when the entrance tile has non-flat generated terrain.
    const worldZ = row + 0.5; // Used with worldX to sample the entrance interaction point at tile center.
    const exact = Number(deps?.activeSurfaceYAtWorld?.(worldX, worldZ));
    if (Number.isFinite(exact)) return exact;
    const grid = activeGrid(deps, area); // Used as the ordinary tile-surface fallback when no continuous sampler is injected.
    const tile = grid?.[row]?.[col];
    if (tile && typeof deps?.tileSurfaceYInArea === 'function') {
      const sampled = Number(deps.tileSurfaceYInArea(tile, area));
      if (Number.isFinite(sampled)) return sampled;
    }
    const stored = Number(tile?.surfaceY);
    return Number.isFinite(stored) ? stored : 0;
  }

  function playerSurfaceY(deps, area, tileSize) {
    const playerMesh = window.PlayerBodyTransformComposer?.getPlayerMesh?.(); // Used first because its feet-level Y includes live ramps/climbs/support surfaces.
    const liveY = Number(playerMesh?.position?.y);
    if (Number.isFinite(liveY)) return liveY;
    const player = deps?.player;
    if (!player || !(tileSize > 0)) return 0;
    const col = Math.floor(finite(player.x) / tileSize); // Used only as a fallback when the rendered player root is unavailable.
    const row = Math.floor(finite(player.y) / tileSize); // Used with col to recover the player's current terrain elevation.
    return surfaceYAt(deps, area, col, row);
  }

  function chunkRecord(tileCol, tileRow, chunkTiles) {
    return {
      col: Math.floor(tileCol / chunkTiles),
      row: Math.floor(tileRow / chunkTiles),
    };
  }

  function resolveAcoustics() {
    const deps = gameDeps();
    if (!deps?.player) return { ok: false, reason: 'waiting for player/runtime' };
    const area = currentArea(deps);
    debugState.area = area;
    if (area === BANUBU_INTERIOR_ID) {
      const col = 6, row = 5; // Banubu's authored sleeping station in the cave interior.
      const tileSize = Math.max(1, finite(deps.TILE, 64));
      const sourceX = (col + 0.5) * tileSize, sourceY = (row + 0.5) * tileSize;
      const horizontalDistanceTiles = Math.hypot(sourceX - finite(deps.player.x), sourceY - finite(deps.player.y)) / tileSize;
      const sourceElevation = surfaceYAt(deps, area, col, row);
      const elevationDistanceTiles = Math.abs(playerSurfaceY(deps, area, tileSize) - sourceElevation);
      const acousticDistanceTiles = Math.hypot(horizontalDistanceTiles, elevationDistanceTiles);
      Object.assign(debugState, { originSource: 'sleeping station', entranceCol: col, entranceRow: row,
        entranceElevation: sourceElevation, playerElevation: playerSurfaceY(deps, area, tileSize),
        horizontalDistanceTiles, elevationDistanceTiles, acousticDistanceTiles,
        acousticGain: Math.max(0, 1 - acousticDistanceTiles / 16), chunkDistance: 0 });
      return { ok: true, deps, area, tileSize, earshotTiles: 16, acousticDistanceTiles, sourceX, sourceY };
    }
    if (area !== BANUBU_AREA_ID) return { ok: false, reason: 'outside Northern Cliffs' };

    const layout = deps?.zoneLayouts?.get?.(area);
    if (!layout) return { ok: false, reason: 'waiting for live zone layout' };
    const transition = liveEntranceTransition(layout);
    if (!transition) return { ok: false, reason: 'Banubu entrance transition missing' };

    const col = Number(transition.col);
    const row = Number(transition.row);
    if (!Number.isFinite(col) || !Number.isFinite(row)) return { ok: false, reason: 'Banubu entrance transition invalid' };

    const tileSize = Math.max(1, finite(deps.TILE, 64));
    const chunkTiles = Math.max(1, finite(window.WildernessChunks?.constants?.CHUNK_TILES, 16));
    const sourceX = (col + 0.5) * tileSize; // Used by AudioSystem for left/right origin; deliberately derived from the entrance transition.
    const sourceY = (row + 0.5) * tileSize; // Used by AudioSystem for horizontal distance; never derived from locale instance x/y.
    const playerX = finite(deps.player.x);
    const playerY = finite(deps.player.y);
    const playerCol = playerX / tileSize;
    const playerRow = playerY / tileSize;
    const entranceChunk = chunkRecord(col, row, chunkTiles);
    const playerChunk = chunkRecord(playerCol, playerRow, chunkTiles);
    const chunkDistance = Math.max(
      Math.abs(playerChunk.col - entranceChunk.col),
      Math.abs(playerChunk.row - entranceChunk.row),
    );
    const horizontalDistanceTiles = Math.hypot(sourceX - playerX, sourceY - playerY) / tileSize;
    const entranceElevation = surfaceYAt(deps, area, Math.round(col), Math.round(row));
    const currentPlayerElevation = playerSurfaceY(deps, area, tileSize);
    const elevationDistanceTiles = Math.abs(currentPlayerElevation - entranceElevation);
    const acousticDistanceTiles = Math.hypot(horizontalDistanceTiles, elevationDistanceTiles);
    const earshotTiles = chunkTiles * ACOUSTIC_EARSHOT_CHUNKS;
    const acousticGain = Math.max(0, Math.min(1, 1 - acousticDistanceTiles / Math.max(1, earshotTiles)));

    Object.assign(debugState, {
      originSource: 'entrance transition',
      transitionId: transition.id || null,
      entranceCol: col,
      entranceRow: row,
      entranceElevation,
      playerElevation: currentPlayerElevation,
      playerChunk,
      entranceChunk,
      chunkDistance,
      horizontalDistanceTiles,
      elevationDistanceTiles,
      acousticDistanceTiles,
      acousticGain,
    });

    if (chunkDistance > MAX_CHUNK_DISTANCE) return { ok: false, reason: `outside two-chunk range (${chunkDistance})` };
    if (acousticGain <= 0) return { ok: false, reason: 'acoustically out of range' };

    return {
      ok: true,
      deps,
      area,
      tileSize,
      chunkTiles,
      earshotTiles,
      acousticDistanceTiles,
      transition,
      sourceX,
      sourceY,
    };
  }

  function grehlrChatterProfile() {
    const source = { creatureKey: 'grehlr', sizeClass: 'large' }; // Used only to resolve the exact authored passive chatter clip/pitch for Banubu's snore.
    const profile = window.AnimalVocalizations?.profileForDebug?.(source);
    const chatter = profile?.chatter;
    if (!chatter || !Array.isArray(chatter.allowedClips) || !chatter.allowedClips.length) return null;
    const utterance = Array.isArray(chatter.utterances) && chatter.utterances.length ? chatter.utterances[0] : {};
    return {
      source,
      profile,
      chatter,
      pitchSemitones: finite(utterance?.pitchSemitones, 0),
      sizePitchSemitones: finite(profile?.sizePitchSemitones?.large, 0),
    };
  }

  function markFinished(phase, error = null) {
    const finishedAt = nowMs(); // Used for real-duration diagnostics and to schedule the following silence.
    snorePlaying = false;
    activeSnoreController = null;
    debugState.playing = false;
    debugState.lastFinishedAt = Date.now();
    debugState.lastDurationMs = lastStartedAtMs > 0 ? Math.max(0, finishedAt - lastStartedAtMs) : null;
    if (!error) {
      if (phase === 'long') debugState.lastLongDurationMs = debugState.lastDurationMs;
      else debugState.lastShortDurationMs = debugState.lastDurationMs;
    }
    debugState.lastError = error ? String(error?.message || error) : null;
    if (error) {
      nextSnorePhase = 'long';
      cycleDurationMs = 0;
      debugState.lastPauseMs = null;
      nextAttemptAtMs = finishedAt + FAILED_START_RETRY_MS;
    } else {
      cycleDurationMs += debugState.lastDurationMs || 0;
      if (phase === 'long') {
        nextSnorePhase = 'short';
        nextAttemptAtMs = finishedAt;
      } else {
        nextSnorePhase = 'long';
        debugState.lastPauseMs = cycleDurationMs / 2;
        nextAttemptAtMs = finishedAt + debugState.lastPauseMs;
        cycleDurationMs = 0;
      }
    }
    debugState.phase = error ? 'long' : (phase === 'long' ? 'short next' : 'pause');
    debugState.cycleDurationMs = cycleDurationMs;
    setStatus(error ? 'playback error' : (phase === 'long' ? 'short snore next' : 'pausing between pairs'), debugState.lastError);
  }

  function startSnore(acoustics, timestamp) {
    const audio = window.AudioSystem;
    const playback = window.AnimalVoiceIndependentPlayback;
    if (!audio?.playAnimalVoiceUtterance || !playback?.isInstalled?.()) {
      setStatus('waiting for animal voice backend');
      nextAttemptAtMs = timestamp + IDLE_RECHECK_MS;
      return false;
    }

    const authored = grehlrChatterProfile();
    if (!authored) {
      setStatus('waiting for authored Grehlr chatter');
      nextAttemptAtMs = timestamp + IDLE_RECHECK_MS;
      return false;
    }

    const source = {
      ...authored.source,
      areaId: acoustics.area,
      x: acoustics.sourceX,
      y: acoustics.sourceY,
      health: 1,
    }; // Synthetic fixed emitter passed through the ordinary animal-voice renderer at the entrance interaction tile.
    const baseVolume = Math.max(0, Math.min(1, finite(authored.chatter.volume, 0.31)));
    debugState.baseVolume = baseVolume;

    const phase = nextSnorePhase; // Captures which breath owns these asynchronous playback callbacks.
    if (phase === 'long') debugState.lastPauseMs = null;
    const token = ++activeSnoreToken; // Guards against a cancelled long breath completing after dialogue ends.
    let started = false; // Used to measure the actual rendered duration rather than decode/preparation time.
    activeSnoreController = new AbortController(); // Passed to the independent voice renderer for immediate dialogue cancellation.
    const accepted = audio.playAnimalVoiceUtterance(source, {
      meaning: 'chatter',
      reason: 'banubu-snore',
      tempo: phase === 'long' ? SNORE_TEMPO : SHORT_SNORE_TEMPO,
      signal: activeSnoreController.signal,
      pitchSemitones: authored.pitchSemitones + SNORE_PITCH_OFFSET + (phase === 'short' ? SHORT_SNORE_PITCH_OFFSET : 0),
      sizePitchSemitones: authored.sizePitchSemitones,
      allowedClips: [...authored.chatter.allowedClips],
      clipTuning: authored.profile.clipTuning,
      volume: baseVolume,
      earshotTiles: acoustics.earshotTiles,
      acousticDistancePx: acoustics.acousticDistanceTiles * acoustics.tileSize,
      onStarted() {
        if (token !== activeSnoreToken) return;
        started = true;
        lastStartedAtMs = nowMs();
        debugState.lastStartedAt = Date.now();
        debugState.lastError = null;
        debugState.phase = phase;
        setStatus(`${phase} snore`);
      },
      onFinished() {
        if (token !== activeSnoreToken) return;
        if (!started) lastStartedAtMs = nowMs();
        markFinished(phase);
      },
      onError(error) {
        if (token === activeSnoreToken) markFinished(phase, error);
      },
    });

    if (!accepted) {
      activeSnoreController = null;
      setStatus('audio start deferred');
      nextAttemptAtMs = timestamp + FAILED_START_RETRY_MS;
      return false;
    }

    snorePlaying = true;
    debugState.playing = true;
    setStatus('snore queued');
    return true;
  }

  function update(frameContext = {}) {
    const timestamp = finite(frameContext.timestamp, nowMs());
    const deps = gameDeps(); // Dialogue state is authoritative even while a slowed snore is already playing.
    if (deps?.isDialogueOpen?.() && (currentArea(deps) === BANUBU_INTERIOR_ID || currentArea(deps) === BANUBU_AREA_ID)) {
      activeSnoreToken++;
      activeSnoreController?.abort();
      activeSnoreController = null;
      snorePlaying = false;
      nextSnorePhase = 'long';
      cycleDurationMs = 0;
      debugState.phase = 'dialogue';
      debugState.playing = false;
      setStatus('paused for dialogue');
      nextAttemptAtMs = timestamp + IDLE_RECHECK_MS;
      return;
    }
    if (snorePlaying) return;
    if (timestamp < nextAttemptAtMs) return;

    const night = window.Fishing?.timeOfDay?.() === 'night';
    debugState.night = night;
    if (!night && currentArea(deps) !== BANUBU_INTERIOR_ID) {
      setStatus('daytime');
      nextAttemptAtMs = timestamp + IDLE_RECHECK_MS;
      return;
    }

    const acoustics = resolveAcoustics();
    if (!acoustics.ok) {
      setStatus(acoustics.reason);
      nextAttemptAtMs = timestamp + IDLE_RECHECK_MS;
      return;
    }

    startSnore(acoustics, timestamp);
  }

  function debugSnapshot() {
    return {
      ...debugState,
      playerChunk: debugState.playerChunk ? { ...debugState.playerChunk } : null,
      entranceChunk: debugState.entranceChunk ? { ...debugState.entranceChunk } : null,
      maxChunkDistance: MAX_CHUNK_DISTANCE,
      schedulerAttached: !!schedulerUnsubscribe,
    };
  }

  function dispose() {
    schedulerUnsubscribe?.();
    schedulerUnsubscribe = null;
    activeSnoreToken++;
    activeSnoreController?.abort();
    activeSnoreController = null;
    snorePlaying = false;
    debugState.playing = false;
    setStatus('disposed');
  }

  window.BanubuSnore?.dispose?.();
  window.BanubuSnore = {
    update,
    debugSnapshot,
    resolveAcousticsForTest: resolveAcoustics,
    dispose,
  };

  if (window.RuntimeFrameScheduler?.register) {
    schedulerUnsubscribe = window.RuntimeFrameScheduler.register(SCHEDULER_ID, update, {
      phase: 'post-game',
      owner: 'BanubuSnore',
      description: 'Plays Banubu snores indoors all day or at night near his live exterior cave entrance.',
    });
    setStatus('ready');
  } else {
    setStatus('scheduler missing');
  }
})();
