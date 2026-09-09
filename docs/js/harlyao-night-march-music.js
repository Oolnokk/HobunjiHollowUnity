(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json'; // Shared march config supplies the exact Ghoul cue plus distance-stage tuning.
  const SILENT_SCHEDULER_MULTIPLIER = 0; // Keeps ordinary area BGM/cues displaced while the real proximity-controlled copy owns audible volume.
  const KEEPALIVE_RANGE_TILES = 10000; // Keeps Music's reusable looping-source transport alive anywhere in the same zone while this module owns final volume.
  const STOP_EPSILON = 0.002; // Source is retired after a long fade reaches effectively silent output.

  let config = null; // Parsed Harlyao march config used by every music decision below.
  let source = null; // Music.registerFurnitureSfxSource handle for the audible Ghoul-track copy.
  let currentArea = null; // Last area Music asked TownMine to resolve, which is the active scheduler area.
  let activeSnapshot = null; // Current Harlyao controller snapshot when its scheduled zone matches currentArea.
  let currentVolume = 0; // Stored independently because Music's generic furniture pass writes its own temporary volume before this module overrides it.
  let transitionFrom = 0; // Volume at the start of the current long interpolation.
  let transitionTo = 0; // Target stage volume reached at the end of the current interpolation.
  let transitionStartedAt = 0; // performance.now() timestamp used by the fixed-duration interpolation.
  let transitionKey = 'boot'; // Prevents restarting the same interpolation every frame.
  let stageIndex = -1; // Current authored proximity-stage index for diagnostics.
  let chunkDistance = null; // Current Euclidean distance in wilderness chunks for diagnostics.
  let installedTownMine = false; // Tracks the one-time BGM-provider wrapper installation.
  let installedMusic = false; // Tracks the one-time generic looping-source update wrapper installation.
  let originalBgmTracksForArea = null; // Preserves TownMine's real Ghoul-floor provider for every non-Harlyao area.
  let originalFurnitureUpdate = null; // Preserves Music's furniture/loop transport before applying the final long-lerped Harlyao volume.

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  async function loadConfig() {
    if (config) return config;
    try {
      const response = await fetch(CONFIG_URL); // Browser cache normally satisfies this from the controller's existing config request.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      return config;
    } catch (error) {
      window.__farmLog?.(`[harlyao-music] config load failed: ${error.message}`, 'warn', 'bgm');
      return null;
    }
  }

  function marchSnapshotForArea(area) {
    const snapshot = window.HarlyaoNightMarch?.debugSnapshot?.(); // Reuses the controller's hourly/offscreen route state instead of recalculating the army schedule.
    if (!snapshot?.scheduled || snapshot.scheduled.zoneId !== area) return null;
    return snapshot;
  }

  function armyChunk(snapshot) {
    return snapshot?.liveChunk || snapshot?.scheduled?.chunk || null; // Observed physical movement wins over coarse hourly schedule when available.
  }

  function distanceInChunks(snapshot) {
    const player = snapshot?.playerChunk;
    const army = armyChunk(snapshot);
    if (!player || !army) return Infinity;
    return Math.hypot(player.cx - army.cx, player.cz - army.cz); // Measures proximity to the army's actual/scheduled 16x16 chunk in 2D chunk space.
  }

  function stageForDistance(distance) {
    const stages = config?.music?.stages || [];
    for (let index = 0; index < stages.length; index++) {
      if (distance <= Number(stages[index]?.maxChunkDistance)) return { index, ...stages[index] };
    }
    const fallback = stages[stages.length - 1] || { maxChunkDistance: Infinity, volumeScale: 0.08 };
    return { index: Math.max(0, stages.length - 1), ...fallback };
  }

  function fullGhoulFloorVolume() {
    const audioCfg = window.AudioSystem?.gameAudioConfig?.() || {};
    const baseVolume = Math.max(0, Math.min(1, Number(audioCfg.bgmVolume) || 0.48)); // Mirrors Music's existing Ghoul-floor BGM base-volume calculation.
    const multiplier = Math.max(0, Number(config?.music?.ghoulFloorVolumeMultiplier) || 2); // Exact same 2x multiplier used by TownMine's GHOUL_BGM_TRACK.
    return clamp(baseVolume * multiplier, 0, 1);
  }

  function targetForSnapshot(snapshot) {
    chunkDistance = distanceInChunks(snapshot);
    const stage = stageForDistance(chunkDistance);
    stageIndex = stage.index;
    return clamp(fullGhoulFloorVolume() * Math.max(0, Number(stage.volumeScale) || 0), 0, 1);
  }

  function beginTransition(target, key) {
    const safeTarget = clamp(Number(target) || 0, 0, 1);
    if (key === transitionKey && Math.abs(safeTarget - transitionTo) < 0.0001) return;
    const now = performance.now();
    currentVolume = interpolatedVolume(now); // Starts a new stage from the exact audible point reached by the prior stage's in-progress lerp.
    transitionFrom = currentVolume;
    transitionTo = safeTarget;
    transitionStartedAt = now;
    transitionKey = key;
  }

  function interpolatedVolume(now = performance.now()) {
    const duration = Math.max(1000, Number(config?.music?.lerpMs) || 12000); // Deliberately long fixed interpolation requested for chunk-stage changes.
    const t = clamp((now - transitionStartedAt) / duration, 0, 1);
    return transitionFrom + (transitionTo - transitionFrom) * t;
  }

  function chunkCenterTiles(chunk) {
    const size = Number(window.WildernessChunks?.constants?.CHUNK_TILES) || 16;
    return { x: (Number(chunk?.cx) + 0.5) * size, z: (Number(chunk?.cz) + 0.5) * size }; // Used only for the generic looping-source transport and its audio diagnostics.
  }

  function ensureSource(area, snapshot) {
    const music = config?.music;
    const trackUrl = music?.trackUrl;
    if (!trackUrl || !window.Music?.registerFurnitureSfxSource) return null;
    const center = chunkCenterTiles(armyChunk(snapshot));
    if (!source) {
      source = window.Music.registerFurnitureSfxSource(area, center.x, center.z, {
        url: trackUrl,
        rangeTiles: KEEPALIVE_RANGE_TILES,
        volume: 1,
      }); // Reuses Music's proven looping HTMLAudio transport/autoplay handling rather than adding a second audio subsystem.
      if (!source) return null;
      source.audio.loop = true;
      currentVolume = 0;
      transitionFrom = 0;
      transitionTo = 0;
      transitionStartedAt = performance.now();
      transitionKey = 'source-created';
    }
    source.area = area;
    source.x = center.x;
    source.z = center.z;
    return source;
  }

  function retireSource() {
    if (!source) return;
    window.Music?.unregisterFurnitureSfxSource?.(source);
    source = null;
    currentVolume = 0;
    transitionFrom = 0;
    transitionTo = 0;
    transitionKey = 'retired';
    stageIndex = -1;
    chunkDistance = null;
  }

  function silentSchedulerTrack() {
    return {
      url: config?.music?.trackUrl,
      volumeMultiplier: SILENT_SCHEDULER_MULTIPLIER,
      harlyaoMarchMusic: true,
    }; // Occupies Music's ordinary BGM slot so local area songs/cues do not overlap the proximity-controlled copy.
  }

  function evaluateArea(area) {
    currentArea = area;
    const snapshot = marchSnapshotForArea(area);
    activeSnapshot = snapshot;
    if (!snapshot) {
      if (source) {
        source.area = area; // Keeps Music's generic transport alive in the newly current area while our long exit fade finishes.
        beginTransition(0, `exit:${area}`);
      }
      return null;
    }

    const audioCfg = window.AudioSystem?.gameAudioConfig?.() || {};
    if (audioCfg.enabled === false) {
      retireSource();
      return silentSchedulerTrack();
    }

    ensureSource(area, snapshot);
    const target = targetForSnapshot(snapshot);
    beginTransition(target, `stage:${snapshot.scheduled.zoneId}:${armyChunk(snapshot)?.cx},${armyChunk(snapshot)?.cz}:${stageIndex}`);
    return silentSchedulerTrack();
  }

  function patchTownMine() {
    const api = window.TownMine;
    if (!api?.bgmTracksForArea || installedTownMine) return false;
    originalBgmTracksForArea = api.bgmTracksForArea.bind(api);
    api.bgmTracksForArea = function harlyaoAwareBgmTracksForArea(area) {
      const harlyaoTrack = evaluateArea(area);
      return harlyaoTrack ? [harlyaoTrack] : originalBgmTracksForArea(area);
    };
    installedTownMine = true;
    return true;
  }

  function applyFinalVolume() {
    if (!source?.audio) return;
    const audioCfg = window.AudioSystem?.gameAudioConfig?.() || {};
    if (audioCfg.enabled === false) {
      retireSource();
      return;
    }

    if (activeSnapshot && activeSnapshot.scheduled?.zoneId === currentArea) {
      ensureSource(currentArea, activeSnapshot);
      const target = targetForSnapshot(activeSnapshot);
      beginTransition(target, `stage:${activeSnapshot.scheduled.zoneId}:${armyChunk(activeSnapshot)?.cx},${armyChunk(activeSnapshot)?.cz}:${stageIndex}`);
    } else {
      beginTransition(0, `exit:${currentArea || 'none'}`);
    }

    currentVolume = clamp(interpolatedVolume(), 0, 1);
    source.audio.volume = currentVolume; // Runs after Music's generic furniture pass, making this long stage lerp the final audible value for the frame.
    if (transitionTo <= STOP_EPSILON && currentVolume <= STOP_EPSILON) retireSource();
  }

  function patchMusic() {
    const api = window.Music;
    if (!api?.updateFurnitureSfxSources || installedMusic) return false;
    originalFurnitureUpdate = api.updateFurnitureSfxSources.bind(api);
    api.updateFurnitureSfxSources = function harlyaoProximityMusicUpdate(...args) {
      const result = originalFurnitureUpdate(...args);
      applyFinalVolume();
      return result;
    };
    installedMusic = true;
    return true;
  }

  function install() {
    const townReady = patchTownMine();
    const musicReady = patchMusic();
    return townReady && musicReady;
  }

  function debugSnapshot() {
    return {
      configReady: !!config,
      installedTownMine,
      installedMusic,
      active: !!activeSnapshot,
      area: currentArea,
      armyChunk: armyChunk(activeSnapshot),
      playerChunk: activeSnapshot?.playerChunk || null,
      chunkDistance,
      stageIndex,
      currentVolume,
      targetVolume: transitionTo,
      lerpMs: Math.max(1000, Number(config?.music?.lerpMs) || 12000),
      sourcePlaying: !!source?.audio && !source.audio.paused,
      trackUrl: config?.music?.trackUrl || null,
    };
  }

  window.HarlyaoNightMarchMusic = Object.freeze({
    install,
    loadConfig,
    debugSnapshot,
    formatDebug: () => {
      const data = debugSnapshot();
      const army = data.armyChunk ? `${data.armyChunk.cx},${data.armyChunk.cz}` : 'none';
      return `Harlyao music: active=${data.active} area=${data.area || '-'} army=${army} distChunks=${Number.isFinite(data.chunkDistance) ? data.chunkDistance.toFixed(2) : '-'} stage=${data.stageIndex} volume=${data.currentVolume.toFixed(3)}→${data.targetVolume.toFixed(3)} lerp=${data.lerpMs}ms playing=${data.sourcePlaying}`;
    },
    __test: Object.freeze({ stageForDistance }),
  });

  loadConfig().then(() => install());
  if (!install() && typeof window.setInterval === 'function') {
    const retry = window.setInterval(() => {
      if (install()) window.clearInterval?.(retry);
    }, 250);
  }
})();
