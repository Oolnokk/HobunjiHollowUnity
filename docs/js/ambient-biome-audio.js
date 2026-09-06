(() => {
  'use strict';

  // Biome/time/proximity ambience that sits beside Music's existing BGS mixer.
  // This helper deliberately ticks at 4 Hz rather than joining the render loop.
  // Its only grid search is cached until the player changes map or tile.
  window.HobunjiAmbientBgs?.dispose?.();

  const UPDATE_INTERVAL_MS = 250; // Controls low-frequency fades and proximity refreshes without per-frame work.
  const DEFAULT_FADE_MS = 1600; // Matches the existing Music BGS fade when no config override is authored.
  const CLOUD_FOREST_AREA = 'map_southern_cloud_forest'; // Selects the dedicated day/night cloud-forest beds.
  const RIVER_AREAS = new Set([CLOUD_FOREST_AREA, 'town', 'map_hobunji_town', 'map_northern_cliffs']); // Restricts river ambience to the three requested locations.
  const AUDIO_URLS = Object.freeze({
    nightbugs: 'assets/audio/sfx/bgs/bgs_nightbugs1.ogg',
    cloudforest: 'assets/audio/sfx/bgs/bgs_cloudforest.ogg',
    cloudforestNight: 'assets/audio/sfx/bgs/bgs_cloudforest_night.ogg',
    river: 'assets/audio/sfx/bgs/bgs_river.ogg',
  }); // Provides the Ogg Vorbis assets used by each persistent layer.
  const layers = new Map(); // Retains one reusable HTMLAudioElement per ambience layer.
  const debugState = {
    lastError: null,
    lastUpdateAt: 0,
    riverScanCount: 0,
    riverDistanceTiles: Infinity,
    riverCandidateCount: 0,
    area: '',
    playerTile: null,
    mixKey: '',
  }; // Exposes mobile-readable state through debugSnapshot().
  const riverCache = {
    area: '',
    grid: null,
    tileCol: NaN,
    tileRow: NaN,
    candidates: [],
  }; // Avoids re-searching nearby water until the player crosses a tile/map boundary.
  const capturedConfig = {
    bgs: null,
    hadBirdsVolume: false,
    birdsVolume: undefined,
    hadNightbugsVolume: false,
    nightbugsVolume: undefined,
    birdsSuppressed: false,
  }; // Restores built-in birds/nightbugs settings exactly when this helper is disposed.
  const unlockHandlers = []; // Stores gesture listeners so dispose() can remove every installed handler.
  let timerId = null; // Holds the single low-frequency update timer.
  let disposed = false; // Prevents delayed gesture callbacks from reviving a disposed helper.

  function gameDeps() {
    const deps = window.Combat?.deps; // Reuses game.js's initialized runtime dependency bundle.
    return deps || null;
  }

  function audioConfig() {
    const direct = window.AudioSystem?.gameAudioConfig?.(); // Uses the same resolved config object as Music and AudioSystem.
    return direct || window.SCRATCHBONES_CONFIG?.game?.audio || window.SCRATCHBONES_CONFIG?.game?.assets?.audio || {};
  }

  function bgsConfig() {
    const config = audioConfig(); // Supplies mutable BGS settings shared with the existing mixer.
    config.bgs = config.bgs || {};
    return config.bgs;
  }

  function clamp01(value) {
    const number = Number(value) || 0; // Normalizes authored/configured volume values before applying them to media elements.
    return Math.max(0, Math.min(1, number));
  }

  function log(message, category = 'audio') {
    if (typeof window.__farmLog === 'function') window.__farmLog(`[ambient-bgs] ${message}`, category);
    else console.debug?.(`[ambient-bgs] ${message}`);
  }

  function recordError(layerId, error) {
    const name = error?.name || error?.code || 'Error'; // Labels the failure without requiring a browser console.
    const message = error?.message || String(error || 'unknown audio failure'); // Preserves the newest actionable media error for mobile diagnostics.
    debugState.lastError = { layerId, name: String(name), message, at: Date.now() };
    log(`${layerId} failed: ${name}: ${message}`);
  }

  function createLayer(id, url) {
    if (typeof Audio !== 'function') return null;
    const audio = new Audio(url); // Provides one persistent, reusable loop for this ambience source.
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio._ambientTargetVolume = 0;
    audio._ambientLastUpdateAt = performance.now();
    audio._ambientAutoplayBlocked = false;
    audio.addEventListener?.('error', () => recordError(id, audio.error || new Error('media error')));
    try { audio.load?.(); } catch (error) { recordError(id, error); }
    const layer = { id, url, audio }; // Associates diagnostics and target routing with the media element.
    layers.set(id, layer);
    return layer;
  }

  function ensureLayer(id) {
    const existing = layers.get(id); // Reuses decoded/preloaded audio instead of creating media elements during updates.
    if (existing) return existing;
    return createLayer(id, AUDIO_URLS[id]);
  }

  function requestLayerPlay(layer) {
    const audio = layer?.audio; // Starts only the persistent element owned by the requested layer.
    if (!audio || !audio.paused || audio._ambientPlayPromise) return;
    let playResult; // Captures sync exceptions and Promise-style browser playback results through one path.
    try { playResult = audio.play(); }
    catch (error) { recordError(layer.id, error); return; }
    const pending = Promise.resolve(playResult)
      .then(() => { audio._ambientAutoplayBlocked = false; })
      .catch(error => {
        if (error?.name === 'NotAllowedError') audio._ambientAutoplayBlocked = true;
        else recordError(layer.id, error);
      })
      .finally(() => {
        if (audio._ambientPlayPromise === pending) audio._ambientPlayPromise = null;
      }); // Deduplicates play() requests while a browser is resolving one.
    audio._ambientPlayPromise = pending;
  }

  function setLayerTarget(id, targetVolume, now) {
    const target = clamp01(targetVolume); // Keeps authored multipliers within HTMLMediaElement.volume's legal range.
    const layer = layers.get(id) || (target > 0 ? ensureLayer(id) : null); // Lazily fetches Ogg files only after their layer first becomes audible.
    if (!layer) return;
    const audio = layer.audio; // Applies the smoothed target and play/pause lifecycle below.
    const config = audioConfig(); // Reads the same BGS fade duration used by the main Music mixer.
    const fadeMs = Math.max(0, Number(config.bgsFadeMs) || DEFAULT_FADE_MS); // Controls low-frequency exponential crossfades.
    const elapsedMs = Math.max(0, Math.min(UPDATE_INTERVAL_MS * 4, now - (audio._ambientLastUpdateAt ?? now))); // Prevents a background-tab stall from snapping the next fade.
    const blend = fadeMs <= 0 ? 1 : 1 - Math.exp(-4.6 * elapsedMs / fadeMs); // Approximates the existing BGS fade curve at a 4 Hz update rate.
    audio._ambientLastUpdateAt = now;
    audio._ambientTargetVolume = target;
    audio.volume = clamp01(audio.volume + (target - audio.volume) * blend);
    if (target > 0 && audio.paused && !audio._ambientAutoplayBlocked) requestLayerPlay(layer);
    if (target <= 0 && audio.volume <= 0.002 && !audio.paused) {
      audio.volume = 0;
      audio.pause();
    }
  }

  function captureAndSuppressBuiltInBgs(bgs, inCloudForest) {
    if (capturedConfig.bgs !== bgs) {
      if (capturedConfig.bgs) restoreBuiltInBgs();
      capturedConfig.bgs = bgs;
      capturedConfig.hadBirdsVolume = Object.prototype.hasOwnProperty.call(bgs, 'birdsVolume');
      capturedConfig.birdsVolume = bgs.birdsVolume;
      capturedConfig.hadNightbugsVolume = Object.prototype.hasOwnProperty.call(bgs, 'nightbugsVolume');
      capturedConfig.nightbugsVolume = bgs.nightbugsVolume;
    }
    bgs.nightbugsVolume = 0; // Mutes Music's old generic loop so the converted Ogg owns that layer without doubling.
    if (inCloudForest) {
      bgs.birdsVolume = 0; // Replaces generic daytime birds with the dedicated cloud-forest recording.
      capturedConfig.birdsSuppressed = true;
    } else if (capturedConfig.birdsSuppressed) {
      restoreBirdsVolume();
    }
  }

  function restoreBirdsVolume() {
    const bgs = capturedConfig.bgs; // Restores the exact pre-helper property state after leaving the cloud forest.
    if (!bgs) return;
    if (capturedConfig.hadBirdsVolume) bgs.birdsVolume = capturedConfig.birdsVolume;
    else delete bgs.birdsVolume;
    capturedConfig.birdsSuppressed = false;
  }

  function restoreBuiltInBgs() {
    const bgs = capturedConfig.bgs; // Returns shared config to its original values during hot reload/disposal.
    if (!bgs) return;
    restoreBirdsVolume();
    if (capturedConfig.hadNightbugsVolume) bgs.nightbugsVolume = capturedConfig.nightbugsVolume;
    else delete bgs.nightbugsVolume;
    capturedConfig.bgs = null;
  }

  function currentArea(deps) {
    return deps?.getCurrentArea?.() || '';
  }

  function isExteriorArea(deps, area) {
    if (area === 'farm' || area === 'town' || area === 'map_hobunji_town') return true;
    if (deps?._isZoneArea?.(area) || deps?.isZoneArea?.(area)) return true;
    return area === CLOUD_FOREST_AREA || area === 'map_northern_cliffs' || area === 'map_western_slope' || area === 'map_eastern_mire';
  }

  function isNight(deps) {
    const musicAnswer = window.Music?.isNightTime?.(); // Reuses Music's authoritative 19:00-07:00 window when available.
    if (typeof musicAnswer === 'boolean') return musicAnswer;
    const hour = Number(deps?.getHour?.() ?? deps?.calendar?.hour ?? 12); // Supports tests/late-load fallback if Music is unavailable.
    return hour < 7 || hour >= 19;
  }

  function isRaining(deps) {
    return !!deps?.calendar?.isRaining;
  }

  function areaGrid(deps, area) {
    const direct = deps?.npcGridForArea?.(area) || deps?.gridForArea?.(area); // Prefers the same area-grid resolver used by footsteps/pathfinding.
    if (direct) return direct;
    const zoneMaps = deps?.zoneMaps; // Supports Map- or object-backed zone stores used by alternate runtime builds/tests.
    const zone = zoneMaps?.get?.(area) || zoneMaps?.[area];
    return zone?.grid || zone?.tilesGrid || null;
  }

  function isWaterTile(deps, tile) {
    const type = tile?.type; // Reads the terrain type from the resolved area grid cell.
    const types = deps?.TileType || {}; // Uses the game's canonical numeric/string tile constants.
    if (deps?.WATERWAY_TYPES?.has?.(type)) return true;
    return type === types.RIVER || type === types.STREAM || type === types.WATERFALL;
  }

  function refreshRiverCandidates(deps, area, grid, playerTileX, playerTileZ, rangeTiles) {
    const tileCol = Math.floor(playerTileX); // Keys the cache to the player's current column.
    const tileRow = Math.floor(playerTileZ); // Keys the cache to the player's current row.
    const unchanged = riverCache.area === area && riverCache.grid === grid && riverCache.tileCol === tileCol && riverCache.tileRow === tileRow; // Skips all grid access while the player remains in one tile.
    if (unchanged) return;
    riverCache.area = area;
    riverCache.grid = grid;
    riverCache.tileCol = tileCol;
    riverCache.tileRow = tileRow;
    riverCache.candidates = [];
    debugState.riverScanCount++;
    if (!grid || !RIVER_AREAS.has(area)) return;
    const radius = Math.max(1, Math.ceil(rangeTiles)); // Bounds the local search to only cells capable of producing audible river volume.
    const rowStart = Math.max(0, tileRow - radius); // Prevents negative sparse-array probes near map edges.
    const rowEnd = Math.min(grid.length - 1, tileRow + radius); // Stops the scan at the final available row.
    for (let row = rowStart; row <= rowEnd; row++) {
      const gridRow = grid[row]; // Reuses the row reference throughout the inner scan.
      if (!gridRow) continue;
      const colStart = Math.max(0, tileCol - radius); // Prevents negative column probes near map edges.
      const colEnd = Math.min(gridRow.length - 1, tileCol + radius); // Stops the scan at the final available column.
      for (let col = colStart; col <= colEnd; col++) {
        if (isWaterTile(deps, gridRow[col])) riverCache.candidates.push({ x: col + 0.5, z: row + 0.5 });
      }
    }
  }

  function riverMix(deps, area, bgs) {
    if (!RIVER_AREAS.has(area)) {
      riverCache.area = area;
      riverCache.grid = null;
      riverCache.tileCol = NaN;
      riverCache.tileRow = NaN;
      riverCache.candidates = [];
      debugState.riverDistanceTiles = Infinity;
      debugState.riverCandidateCount = 0;
      return 0;
    }
    const tileSize = Math.max(1, Number(deps?.TILE) || 64); // Converts the player's world-pixel coordinates to terrain-tile coordinates.
    const playerTileX = Number(deps?.player?.x || 0) / tileSize; // Supplies continuous X distance for smoother 4 Hz attenuation.
    const playerTileZ = Number(deps?.player?.y || 0) / tileSize; // Supplies continuous Z distance for smoother 4 Hz attenuation.
    const playerTileCol = Math.floor(playerTileX); // Identifies whether the local water cache can be reused this tick.
    const playerTileRow = Math.floor(playerTileZ); // Identifies whether the local water cache can be reused this tick.
    const rangeTiles = Math.max(1, Number(bgs.riverRangeTiles) || 9); // Defines where the river loop fades fully to silence.
    const fullRadiusTiles = Math.max(0, Math.min(rangeTiles, Number(bgs.riverFullVolumeRadiusTiles) || 1.5)); // Keeps full volume immediately beside/on water.
    const cacheMatchesTile = riverCache.area === area && riverCache.grid && riverCache.tileCol === playerTileCol && riverCache.tileRow === playerTileRow; // Avoids even resolving the area grid while the player remains in one tile.
    const grid = cacheMatchesTile ? riverCache.grid : areaGrid(deps, area); // Resolves terrain only on map/tile changes.
    refreshRiverCandidates(deps, area, grid, playerTileX, playerTileZ, rangeTiles);
    let nearest = Infinity; // Finds the closest cached water cell using only the small local candidate set.
    for (const cell of riverCache.candidates) nearest = Math.min(nearest, Math.hypot(playerTileX - cell.x, playerTileZ - cell.z));
    debugState.riverDistanceTiles = nearest;
    debugState.riverCandidateCount = riverCache.candidates.length;
    debugState.playerTile = { col: Math.floor(playerTileX), row: Math.floor(playerTileZ) };
    if (!Number.isFinite(nearest) || nearest >= rangeTiles) return 0;
    const falloff = nearest <= fullRadiusTiles ? 1 : 1 - (nearest - fullRadiusTiles) / Math.max(0.001, rangeTiles - fullRadiusTiles); // Produces a simple distance fade between the authored radii.
    return clamp01((bgs.riverVolume ?? 0.42) * falloff);
  }

  function updateNow() {
    if (disposed) return;
    const deps = gameDeps(); // Reads the initialized runtime only at the low-frequency update boundary.
    if (!deps?.player) return;
    const now = performance.now(); // Drives all four layer fades from one timestamp.
    const config = audioConfig(); // Honors the existing global audio enable switch.
    const bgs = bgsConfig(); // Supplies optional volume/range tuning without introducing another config file.
    const area = currentArea(deps); // Selects biome and river eligibility for this mix pass.
    const exterior = isExteriorArea(deps, area); // Prevents generic ambience from leaking indoors/mines/dens.
    const night = isNight(deps); // Selects generic nightbugs or cloud-forest night ambience.
    const rainy = isRaining(deps); // Mirrors the existing wildlife-BGS rain suppression behavior.
    const enabled = config.enabled !== false; // Silences every custom layer when the game's audio master is disabled.
    const inCloudForest = area === CLOUD_FOREST_AREA;
    captureAndSuppressBuiltInBgs(bgs, inCloudForest);

    const capturedNightbugsVolume = Number(capturedConfig.nightbugsVolume); // Converts the pre-helper generic ambience setting into a safe numeric target.
    const genericNightbugsVolume = capturedConfig.hadNightbugsVolume && Number.isFinite(capturedNightbugsVolume) ? capturedNightbugsVolume : 0.34; // Preserves the old layer's authored loudness after muting its built-in owner.
    const wildlifeAllowed = enabled && exterior && !rainy; // Keeps nature loops aligned with the existing birds/nightbugs weather rules.
    const nightbugsTarget = wildlifeAllowed && night && !inCloudForest ? genericNightbugsVolume : 0; // Routes generic night wildlife everywhere except the dedicated cloud-forest bed.
    const cloudforestTarget = wildlifeAllowed && inCloudForest && !night ? (bgs.cloudforestVolume ?? 0.30) : 0; // Routes the daytime cloud-forest recording only in its biome.
    const cloudforestNightTarget = wildlifeAllowed && inCloudForest && night ? (bgs.cloudforestNightVolume ?? 0.34) : 0; // Routes the night cloud-forest recording only in its biome.
    const riverTarget = enabled ? riverMix(deps, area, bgs) : 0; // Keeps water proximity independent from rain while honoring the audio master switch.
    setLayerTarget('nightbugs', nightbugsTarget, now);
    setLayerTarget('cloudforest', cloudforestTarget, now);
    setLayerTarget('cloudforestNight', cloudforestNightTarget, now);
    setLayerTarget('river', riverTarget, now);

    const mixKey = [area, enabled, night, rainy, nightbugsTarget > 0, cloudforestTarget > 0, cloudforestNightTarget > 0, riverTarget > 0].join('|'); // Detects meaningful ambience transitions without logging every timer tick.
    if (mixKey !== debugState.mixKey) {
      debugState.mixKey = mixKey;
      log(`mix area=${area || 'none'} night=${night} rain=${rainy} targets bugs=${clamp01(nightbugsTarget).toFixed(2)} forest=${clamp01(cloudforestTarget).toFixed(2)} forestNight=${clamp01(cloudforestNightTarget).toFixed(2)} river=${clamp01(riverTarget).toFixed(2)} scans=${debugState.riverScanCount}`);
    }
    debugState.area = area;
    debugState.lastUpdateAt = Date.now();
  }

  function retryBlockedAudio() {
    if (disposed) return;
    updateNow();
    for (const layer of layers.values()) {
      const audio = layer.audio; // Retries only loops that currently want audible output after a user gesture.
      if ((audio._ambientTargetVolume || 0) <= 0 || !audio.paused) continue;
      audio._ambientAutoplayBlocked = false;
      requestLayerPlay(layer);
    }
  }

  function installUnlockListeners() {
    if (typeof document?.addEventListener !== 'function') return;
    for (const type of ['pointerdown', 'touchstart', 'keydown']) {
      const handler = () => retryBlockedAudio(); // Shares one gesture retry routine across desktop and mobile input.
      document.addEventListener(type, handler, { capture: true, passive: type !== 'keydown' });
      unlockHandlers.push({ type, handler });
    }
  }

  function debugSnapshot() {
    const layerState = {}; // Serializes current/target volume, playback, and URL for in-game/mobile inspection.
    for (const [id, layer] of layers) {
      const audio = layer.audio; // Reads the persistent media element without mutating playback.
      layerState[id] = {
        url: layer.url,
        volume: Number(audio.volume || 0),
        targetVolume: Number(audio._ambientTargetVolume || 0),
        paused: !!audio.paused,
        autoplayBlocked: !!audio._ambientAutoplayBlocked,
        readyState: audio.readyState ?? null,
      };
    }
    return {
      ...debugState,
      riverDistanceTiles: Number.isFinite(debugState.riverDistanceTiles) ? debugState.riverDistanceTiles : null,
      layers: layerState,
      updateIntervalMs: UPDATE_INTERVAL_MS,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timerId != null) clearInterval(timerId);
    timerId = null;
    for (const { type, handler } of unlockHandlers) document.removeEventListener?.(type, handler, { capture: true });
    unlockHandlers.length = 0;
    for (const layer of layers.values()) {
      layer.audio.pause?.();
      try { layer.audio.currentTime = 0; } catch (_) {}
    }
    layers.clear();
    restoreBuiltInBgs();
  }

  installUnlockListeners();
  updateNow();
  timerId = setInterval(updateNow, UPDATE_INTERVAL_MS);

  window.HobunjiAmbientBgs = {
    installed: true,
    updateNow,
    debugSnapshot,
    dispose,
  };
})();
