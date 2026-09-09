(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json'; // Shared march config supplies the canonical Ghoul track plus proximity-stage tuning.
  const OVERRIDE_ID = 'harlyao-night-march'; // Used by diagnostics to identify this exclusive soundtrack owner.
  const FALLBACK_TRACK_URL = 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg'; // Canonical Ghoul-floor file keeps startup deterministic before config fetch resolves.
  const FALLBACK_STAGES = Object.freeze([
    { maxChunkDistance: 0, volumeScale: 1 },
    { maxChunkDistance: 1, volumeScale: 0.72 },
    { maxChunkDistance: 2, volumeScale: 0.48 },
    { maxChunkDistance: 4, volumeScale: 0.28 },
    { maxChunkDistance: 7, volumeScale: 0.15 },
    { maxChunkDistance: 999, volumeScale: 0.08 },
  ]); // Mirrors authored defaults only for the tiny pre-config startup window.

  let config = null; // Parsed Harlyao march config used by the soundtrack provider and toast copy.
  let musicDeps = null; // Music-only dependency object captured from Music.init for area/toast/combat integration.
  let originalTownMineBgm = null; // Preserves TownMine's ordinary mine-floor BGM resolver outside the active army zone.
  let originalMusicInit = null; // Preserves Music.init while supplying a music-only combat-state proxy.
  let originalMusicUpdate = null; // Preserves Music.updateAmbientCues while this module captures its scheduler-owned Harlyao element.
  let capturedAudio = null; // Actual Music.currentBgm HTMLAudio element when the scheduler starts the Harlyao track.
  let schedulerRawVolume = 0; // Unscaled volume requested by Music before Harlyao proximity gain is applied.
  let currentGain = 0; // Current 12-second-interpolated multiplier applied to schedulerRawVolume.
  let transitionFrom = 0; // Gain at the start of the current proximity-stage interpolation.
  let transitionTo = 0; // Gain target for the current proximity stage.
  let transitionStartedAt = 0; // performance.now timestamp used by the fixed-duration gain interpolation.
  let transitionKey = 'boot'; // Prevents restarting the same gain interpolation every frame.
  let stageIndex = -1; // Current authored proximity-stage index for mobile diagnostics.
  let chunkDistance = null; // Current Euclidean player-to-army distance in wilderness chunks.
  let lastArea = null; // Used to emit the entry toast only when the player actually enters an area.
  let installedTownMine = false; // Tracks the one-time area-BGM resolver wrapper.
  let installedMusic = false; // Tracks the one-time Music scheduler wrapper.

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  async function loadConfig() {
    if (config) return config;
    try {
      const response = await fetch(CONFIG_URL); // Browser cache normally shares this JSON with the march controller and atmosphere adapter.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      return config;
    } catch (error) {
      window.__farmLog?.(`[harlyao-music] config load failed: ${error.message}`, 'warn', 'bgm');
      return null;
    }
  }

  function marchSnapshotForArea(area) {
    const snapshot = window.HarlyaoNightMarch?.debugSnapshot?.(); // Reuses the controller's hourly/offscreen route state instead of simulating the army again.
    if (!snapshot?.scheduled || snapshot.scheduled.zoneId !== area) return null;
    return snapshot;
  }

  function currentArea() {
    return musicDeps?.getCurrentArea?.() || null;
  }

  function activeSnapshot() {
    const area = currentArea();
    return area ? marchSnapshotForArea(area) : null;
  }

  function armyChunk(snapshot) {
    return snapshot?.liveChunk || snapshot?.scheduled?.chunk || null; // Observed physical movement wins over the coarse hourly chunk whenever available.
  }

  function distanceInChunks(snapshot) {
    const player = snapshot?.playerChunk;
    const army = armyChunk(snapshot);
    if (!player || !army) return Infinity;
    return Math.hypot(player.cx - army.cx, player.cz - army.cz); // Proximity stages operate in 2D WildernessChunks coordinates.
  }

  function stageForDistance(distance) {
    const stages = config?.music?.stages || FALLBACK_STAGES;
    for (let index = 0; index < stages.length; index++) {
      if (distance <= Number(stages[index]?.maxChunkDistance)) return { index, ...stages[index] };
    }
    const fallback = stages[stages.length - 1] || { maxChunkDistance: Infinity, volumeScale: 0.08 };
    return { index: Math.max(0, stages.length - 1), ...fallback };
  }

  function targetGainForSnapshot(snapshot) {
    chunkDistance = distanceInChunks(snapshot);
    const stage = stageForDistance(chunkDistance);
    stageIndex = stage.index;
    const ghoulMultiplier = Math.max(0, Number(config?.music?.ghoulFloorVolumeMultiplier) || 2); // Matches TownMine's canonical Ghoul-floor 2x reference level.
    return ghoulMultiplier * Math.max(0, Number(stage.volumeScale) || 0);
  }

  function interpolatedGain(now = performance.now()) {
    const duration = Math.max(1000, Number(config?.music?.lerpMs) || 12000); // Deliberately long transition requested for chunk-stage changes.
    const t = clamp((now - transitionStartedAt) / duration, 0, 1);
    return transitionFrom + (transitionTo - transitionFrom) * t;
  }

  function beginTransition(target, key) {
    const safeTarget = Math.max(0, Number(target) || 0);
    if (key === transitionKey && Math.abs(safeTarget - transitionTo) < 0.0001) return;
    const now = performance.now();
    currentGain = interpolatedGain(now); // New stage starts from the exact audible gain reached by the prior in-progress transition.
    transitionFrom = currentGain;
    transitionTo = safeTarget;
    transitionStartedAt = now;
    transitionKey = key;
  }

  function nativeVolumeDescriptor(audio) {
    let proto = audio; // Walks to HTMLMediaElement.prototype without assuming a specific browser prototype depth.
    while (proto) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'volume');
      if (descriptor?.get && descriptor?.set) return descriptor;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  function applyCapturedVolume() {
    if (!capturedAudio?._harlyaoNativeVolumeSet) return;
    const actual = clamp(schedulerRawVolume * currentGain, 0, 1); // Music's own fade/duck level remains authoritative, with Harlyao proximity layered on top.
    capturedAudio._harlyaoNativeVolumeSet(actual);
  }

  function captureSchedulerAudio(audio) {
    if (!audio || audio._harlyaoSoundtrackCaptured) return audio;
    const descriptor = nativeVolumeDescriptor(audio);
    if (!descriptor) return audio;
    schedulerRawVolume = clamp(Number(descriptor.get.call(audio)) || 0, 0, 1);
    const nativeAddEventListener = audio.addEventListener.bind(audio); // Used to omit only playMusicTrack's natural-end fade watcher from this intentionally looping soundtrack.
    audio.addEventListener = function harlyaoSchedulerEventListener(type, listener, options) {
      if (type === 'timeupdate') return; // A looping BGM must not fade itself to zero just before every loop boundary.
      return nativeAddEventListener(type, listener, options);
    };
    const nativeSet = value => descriptor.set.call(audio, clamp(Number(value) || 0, 0, 1)); // Bypasses the scheduler-facing setter when only proximity gain changes.
    Object.defineProperty(audio, 'volume', {
      configurable: true,
      enumerable: true,
      get() { return descriptor.get.call(audio); },
      set(value) {
        schedulerRawVolume = clamp(Number(value) || 0, 0, 1);
        nativeSet(schedulerRawVolume * currentGain);
      },
    });
    audio._harlyaoNativeVolumeSet = nativeSet;
    audio._harlyaoSoundtrackCaptured = true;
    capturedAudio = audio;
    return audio;
  }

  function sameTrackUrl(url) {
    const configured = config?.music?.trackUrl || FALLBACK_TRACK_URL;
    if (!configured || !url) return false;
    try { return new URL(String(url), document.baseURI).href === new URL(configured, document.baseURI).href; }
    catch { return String(url).includes(configured); }
  }

  function withSchedulerAudioCapture(callback, active) {
    if (!active || typeof window.Audio !== 'function') return callback();
    const NativeAudio = window.Audio; // Temporarily wraps only this synchronous Music.updateAmbientCues call.
    function HarlyaoCapturingAudio(url) {
      const audio = new NativeAudio(url);
      if (sameTrackUrl(url)) captureSchedulerAudio(audio);
      return audio;
    }
    HarlyaoCapturingAudio.prototype = NativeAudio.prototype;
    window.Audio = HarlyaoCapturingAudio;
    try { return callback(); }
    finally { window.Audio = NativeAudio; }
  }

  function withExclusiveCueConditions(callback, active) {
    const registry = window.ConditionRegistry;
    if (!active || !registry || typeof registry.entryEligible !== 'function') return callback();
    const original = registry.entryEligible; // Existing ambient cues must become immediately ineligible when the march owns the soundtrack.
    registry.entryEligible = function harlyaoExclusiveEntryEligible(entry, ...args) {
      if (entry?.file && !entry?.url) return false;
      return original.call(this, entry, ...args);
    };
    try { return callback(); }
    finally { registry.entryEligible = original; }
  }

  function soundtrackTrack(snapshot) {
    if (!snapshot) return null;
    return {
      url: config?.music?.trackUrl || FALLBACK_TRACK_URL,
      volumeMultiplier: Number(config?.music?.ghoulFloorVolumeMultiplier) || 2,
      harlyaoMarchMusic: true,
      exclusiveSoundtrack: true,
      loop: true,
      volumeLerpMs: Math.max(1000, Number(config?.music?.lerpMs) || 12000),
    }; // This is a real Music BGM candidate; no second SFX/audio copy exists.
  }

  function patchTownMine() {
    const api = window.TownMine;
    if (installedTownMine) return true;
    if (!api?.bgmTracksForArea) return false;
    originalTownMineBgm = api.bgmTracksForArea.bind(api);
    api.bgmTracksForArea = function harlyaoSoundtrackBgmTracksForArea(area) {
      const snapshot = marchSnapshotForArea(area);
      const track = soundtrackTrack(snapshot);
      return track ? [track] : originalTownMineBgm(area);
    };
    installedTownMine = true;
    return true;
  }

  function routeLabel(zoneId) {
    return config?.routesClockwise?.find?.(route => route.zoneId === zoneId)?.label || 'wilderness';
  }

  function maybeShowEntryToast(area, snapshot) {
    const changed = area !== lastArea;
    lastArea = area;
    if (!changed || !snapshot || !musicDeps?.showToast) return;
    const template = String(config?.zoneAtmosphere?.entryToast || 'The night grows unnaturally dark. A spectral army marches somewhere through the {zone}.'); // Authored copy can change without touching runtime logic.
    const message = template.replaceAll('{zone}', routeLabel(snapshot.scheduled?.zoneId));
    musicDeps.showToast(message, true);
  }

  function applyProximity(snapshot) {
    if (!snapshot) return;
    const chunk = armyChunk(snapshot);
    const target = targetGainForSnapshot(snapshot);
    beginTransition(target, `stage:${snapshot.scheduled.zoneId}:${chunk?.cx},${chunk?.cz}:${stageIndex}`);
    currentGain = Math.max(0, interpolatedGain());
    if (capturedAudio) {
      capturedAudio.loop = true; // makeGameAudio initializes loop=false; set it after Music has created the scheduler-owned element.
      applyCapturedVolume();
    }
  }

  function musicOnlyDeps(injected) {
    const proxy = Object.create(injected || null); // Keeps every existing Music dependency intact while changing combat ownership only for this soundtrack.
    proxy.isPlayerInCombat = () => activeSnapshot() ? false : !!injected?.isPlayerInCombat?.(); // Exclusive march BGM must not be replaced by combat BGM.
    return proxy;
  }

  function patchMusic() {
    const api = window.Music;
    if (installedMusic) return true;
    if (!api) return false;
    if (typeof api.init !== 'function' || typeof api.updateAmbientCues !== 'function') return false;

    originalMusicInit = api.init.bind(api);
    api.init = function harlyaoSoundtrackMusicInit(injected) {
      musicDeps = injected;
      return originalMusicInit(musicOnlyDeps(injected));
    };

    originalMusicUpdate = api.updateAmbientCues.bind(api);
    api.updateAmbientCues = function harlyaoExclusiveSoundtrackUpdate(...args) {
      const area = currentArea();
      const snapshot = area ? marchSnapshotForArea(area) : null;
      maybeShowEntryToast(area, snapshot);
      const result = withSchedulerAudioCapture(
        () => withExclusiveCueConditions(() => originalMusicUpdate(...args), !!snapshot),
        !!snapshot,
      );
      applyProximity(snapshot);
      if (!snapshot && capturedAudio?.paused) {
        capturedAudio = null;
        schedulerRawVolume = 0;
        stageIndex = -1;
        chunkDistance = null;
      }
      return result;
    };

    api.harlyaoSoundtrackDebugSnapshot = debugSnapshot; // Mobile diagnostics can verify that the audible element is Music-owned rather than a separate SFX loop.
    installedMusic = true;
    return true;
  }

  function install() {
    return patchTownMine() && patchMusic();
  }

  function debugSnapshot() {
    const snapshot = activeSnapshot();
    const chunk = armyChunk(snapshot);
    return {
      configReady: !!config,
      installedTownMine,
      installedMusic,
      schedulerOwned: !!capturedAudio?._harlyaoSoundtrackCaptured,
      exclusive: !!snapshot,
      active: !!snapshot,
      area: currentArea(),
      armyChunk: chunk,
      playerChunk: snapshot?.playerChunk || null,
      chunkDistance,
      stageIndex,
      schedulerRawVolume,
      currentGain,
      targetGain: transitionTo,
      currentVolume: capturedAudio?.volume ?? 0,
      targetVolume: clamp(schedulerRawVolume * transitionTo, 0, 1), // Keeps existing Pixel Probe current→target volume diagnostics meaningful.
      lerpMs: Math.max(1000, Number(config?.music?.lerpMs) || 12000),
      sourcePlaying: !!capturedAudio && !capturedAudio.paused,
      loop: !!capturedAudio?.loop,
      trackUrl: config?.music?.trackUrl || FALLBACK_TRACK_URL,
      ownerId: OVERRIDE_ID,
    };
  }

  window.HarlyaoNightMarchMusic = Object.freeze({
    install,
    loadConfig,
    debugSnapshot,
    formatDebug: () => {
      const data = debugSnapshot();
      const army = data.armyChunk ? `${data.armyChunk.cx},${data.armyChunk.cz}` : 'none';
      return `Harlyao music: owner=${data.ownerId} scheduler=${data.schedulerOwned} exclusive=${data.exclusive} area=${data.area || '-'} army=${army} distChunks=${Number.isFinite(data.chunkDistance) ? data.chunkDistance.toFixed(2) : '-'} stage=${data.stageIndex} volume=${Number(data.currentVolume || 0).toFixed(3)} gain=${data.currentGain.toFixed(3)}→${data.targetGain.toFixed(3)} loop=${data.loop} playing=${data.sourcePlaying}`;
    },
    __test: Object.freeze({ stageForDistance }),
  });

  install(); // Main parser path must wrap Music.init before game.js injects dependencies; providers remain inactive until config finishes loading.
  loadConfig();
  if ((!installedTownMine || !installedMusic) && typeof window.setInterval === 'function') {
    const retry = window.setInterval(() => {
      if (install()) window.clearInterval?.(retry);
    }, 250); // Only needed in dev/tool loading orders where TownMine or Music appears after this module.
  }
})();
