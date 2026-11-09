(() => {
  'use strict';

  // Honeyfuzzle hive and swarm ambience: one decoded sound, one looping Web Audio
  // voice per selected emitter. Loop seams are crossfaded in the shared buffer,
  // not with extra per-emitter voices or recurring node allocation.
  window.HoneyfuzzleAudio?.dispose?.();

  const AUDIO_URL = 'assets/audio/sfx/utterances/sfx_honeyfuzzle_buzz.m4a'; // Existing restored AAC recording in the authored utterance asset directory.
  const RANGE_TILES = 24; // Matches HoneyfuzzleHives.SPAWN_RADIUS_TILES: only sources in earshot are considered.
  const MAX_VOICES = 8; // Caps simultaneous positional voices on mobile and desktop.
  const TICK_MS = 100; // Ten updates per second are ample for smooth AudioParam automation.
  const SCAN_MS = 350; // Roster/standing-stump scans run independently of pitch/position updates.
  const CROSSFADE_SECONDS = 0.65; // Overlap at the source file's loop seam (computed once per decoded clip).
  const SOUND_SPEED_TILES_S = 48; // Game-scale virtual sound speed for audible but restrained Doppler.
  const MAX_SPEED_TILES_S = 20; // Treat spawn/teleport jumps as discontinuities, never enormous Doppler.
  const RELEASE_MS = 900; // Lets fading voices reach silence before disconnecting their graphs.
  const RETRY_MS = 60000; // Avoids hammering an absent audio asset each update.
  const VOICE_GAIN = Object.freeze({ hive: 0.16, swarm: 0.24, house: 0.18 }); // Close-range base levels, before distance and SFX mix.
  const voices = new Map(); // Source key -> long-lived gain, panner and AudioBufferSourceNode.
  const candidates = new Map(); // Source key -> latest in-range source record; recomputed only at SCAN_MS.
  const listenerMotion = { area: '', x: 0, y: 0, at: 0, vx: 0, vy: 0 }; // Smoothed listener velocity used by Doppler.
  const debug = { state: 'idle', error: null, loadAttempts: 0, scanCount: 0, candidateCount: 0, clippedByBudget: 0, area: '', lastUpdate: 0 }; // Copyable mobile diagnostics.
  let context = null; // Created lazily after nearby honeyfuzzles actually exist.
  let loopBuffer = null; // Shared, pre-crossfaded mono PCM buffer reused by every emitter.
  let loading = null; // Serializes fetch and decode to one network request.
  let retryAt = 0; // Defers repeated failures until the cooldown expires.
  let lastScanAt = -Infinity; // Throttles costly world-roster scans.
  let timer = null; // Single low-frequency update timer; no feature-specific RAF.
  let disposed = false; // Guards late asynchronous decode completions.
  const unlockEvents = ['pointerdown', 'touchstart', 'keydown']; // Mobile/desktop user gestures allowed to resume Web Audio.

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value)); // Bounds gains, pitches, and radial speeds.
  const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by); // Tile-space distance shared by culling and attenuation.
  const isHoneyfuzzle = actor => (actor?.creatureKey || actor?.kind || actor?.species || actor?.type) === 'honeyfuzzle'; // Allocation-free species check while scanning live creatures.
  const runtime = () => window.Combat?.deps || null; // Uses the same live world dependency source as ambient-biome-audio.js.
  const config = () => window.AudioSystem?.gameAudioConfig?.() || window.SCRATCHBONES_CONFIG?.game?.audio || {}; // Honors the game's SFX enable/level switches.

  function aggression(actor) {
    if (!actor || actor._hiveTucked) return 0;
    const phase = actor._territorialBehavior?.phase; // Explicit warning/fight contract from wildlife-territorial.js.
    if (phase === 'fight' || actor._animalAttack) return 1;
    if (phase === 'warning') return 0.48;
    if (phase === 'disengage') return 0.2;
    if (actor.state === 'chase' || actor.state === 'attacking') return 0.9;
    if (actor.state === 'searching') return 0.55;
    return 0;
  }

  function dopplerRate(dx, dy, sourceVx, sourceVy, listenerVx, listenerVy) {
    const len = Math.hypot(dx, dy); // Direction from listener toward emitter.
    if (len < 0.05) return 1;
    const nx = dx / len, ny = dy / len;
    const towardSource = listenerVx * nx + listenerVy * ny; // Listener velocity toward the emitter.
    const towardListener = -(sourceVx * nx + sourceVy * ny); // Emitter velocity toward the listener.
    const speed = SOUND_SPEED_TILES_S;
    return clamp((speed + clamp(towardSource, -MAX_SPEED_TILES_S, MAX_SPEED_TILES_S)) /
      (speed - clamp(towardListener, -MAX_SPEED_TILES_S, MAX_SPEED_TILES_S)), 0.84, 1.16);
  }

  function makeSeamlessBuffer(ctx, decoded) {
    const channels = decoded.numberOfChannels; // Stereo restorations are folded to mono for directional placement.
    const length = decoded.length; // Source sample count before removing the overlapping end segment.
    const fade = Math.min(Math.floor(decoded.sampleRate * CROSSFADE_SECONDS), Math.floor(length / 3));
    const outputLength = length - fade; // The final fade samples reappear at the start and are removed from the tail.
    if (channels < 1 || outputLength <= 16 || fade < 8) return decoded;
    const buffer = ctx.createBuffer(1, outputLength, decoded.sampleRate); // One seamless buffer shared by every position.
    const output = buffer.getChannelData(0);
    const data = Array.from({ length: channels }, (_, i) => decoded.getChannelData(i)); // Source channel arrays, allocated only once at decode.
    for (let i = 0; i < outputLength; i++) {
      let head = 0;
      for (const channel of data) head += channel[i];
      head /= channels;
      if (i < fade) {
        let tail = 0;
        for (const channel of data) tail += channel[outputLength + i];
        tail /= channels;
        const blend = i / fade; // Linear overlap keeps RMS from surging for highly correlated recordings.
        output[i] = tail * (1 - blend) + head * blend;
      } else output[i] = head;
    }
    return buffer;
  }

  function ensureContext() {
    if (context && context.state !== 'closed') return context;
    const AudioContext = window.AudioContext || window.webkitAudioContext; // Web Audio is required for live independent pitch and positions.
    if (!AudioContext) { debug.state = 'unsupported'; return null; }
    try { context = new AudioContext(); }
    catch (error) { debug.error = String(error?.message || error); debug.state = 'unsupported'; }
    return context;
  }

  function ensureSample() {
    if (loopBuffer || loading || performance.now() < retryAt || disposed || !candidates.size) return;
    const ctx = ensureContext(); // Does not decode or allocate a context until a source actually enters earshot.
    if (!ctx || typeof fetch !== 'function') return;
    debug.state = 'loading';
    debug.loadAttempts++;
    loading = Promise.resolve().then(() => fetch(AUDIO_URL))
      .then(response => {
        if (!response.ok) throw new Error('Honeyfuzzle buzz HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then(bytes => ctx.decodeAudioData(bytes))
      .then(decoded => {
        if (disposed || !decoded?.length) return;
        loopBuffer = makeSeamlessBuffer(ctx, decoded);
        debug.state = 'ready';
        debug.error = null;
      })
      .catch(error => {
        debug.state = 'failed';
        debug.error = String(error?.message || error);
        retryAt = performance.now() + RETRY_MS;
        window.__farmLog?.('[honeyfuzzle-audio] ' + debug.error + ' (asset: ' + AUDIO_URL + ')', 'audio');
      })
      .finally(() => { loading = null; });
  }

  function emit(list, key, kind, x, y, actor = null) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const d = distance(x, y, listenerMotion.x, listenerMotion.y);
    if (d >= RANGE_TILES) return;
    list.push({ key, kind, x, y, actor, distanceTiles: d }); // Reused for roster selection; moving actors are resampled each tick.
  }

  function scan(deps, area, now) {
    lastScanAt = now;
    debug.scanCount++;
    candidates.clear();
    const items = []; // Current nearby live hives, free swarms and farm houses before voice-budget selection.
    const tileSize = Math.max(1, Number(deps.TILE) || 1);
    const hives = window.HoneyfuzzleHives?.census?.();
    if (hives?.zoneId === area && !hives.excluded) {
      for (const hive of hives.hives) {
        if (hive.standing) emit(items, 'hive:' + hive.key, 'hive', hive.col + 0.5, hive.row + 0.5);
      }
    }
    for (const actor of deps.hostileObjects || []) {
      if (!isHoneyfuzzle(actor) || (Number.isFinite(actor.health) && actor.health <= 0) || actor._hiveTucked) continue;
      if ((actor.areaId || actor.area) && (actor.areaId || actor.area) !== area) continue;
      if (actor.hiveKey && !String(actor.hiveKey).startsWith(area + ':hive:')) continue; // An old zone's hive defender must never sound after a map transition.
      emit(items, 'swarm:' + String(actor.id ?? actor.hiveKey ?? actor), 'swarm', Number(actor.x) / tileSize, Number(actor.y) / tileSize, actor);
    }
    if (area === 'farm') {
      window.HoneyfuzzleHouse?.forEachAudioSource?.((id, x, y) =>
        emit(items, 'house:' + id, 'house', x, y)); // Occupied houses are audible even without a wild creature entity.
    }
    items.sort((a, b) => a.distanceTiles - b.distanceTiles); // Nearest-first selection is stable and prevents voice overload.
    debug.candidateCount = items.length;
    debug.clippedByBudget = Math.max(0, items.length - MAX_VOICES);
    for (const item of items.slice(0, MAX_VOICES)) candidates.set(item.key, item);
  }

  function createVoice(item, now) {
    if (!loopBuffer || !context || context.state !== 'running') return null;
    let src = null, gain = null, spatial = null;
    try {
      src = context.createBufferSource(); // Exactly one permanent loop transport per audible emitter.
      src.buffer = loopBuffer;
      src.loop = true;
      gain = context.createGain(); // Owns entry/exit crossfades, distance falloff and volume.
      gain.gain.value = 0;
      spatial = context.createPanner?.() || context.createStereoPanner?.() || null; // Panner is optional on limited browsers.
      if (spatial?.panningModel) {
        spatial.panningModel = 'equalpower'; // Lower CPU than HRTF when several swarms share the scene.
        spatial.distanceModel = 'inverse';
        spatial.rolloffFactor = 0; // The custom 24-tile curve owns attenuation; prevent double falloff.
        spatial.refDistance = 1;
      }
      src.connect(gain);
      if (spatial) { gain.connect(spatial); spatial.connect(context.destination); }
      else gain.connect(context.destination);
      let hash = 2166136261; // Deterministic independent loop offset avoids artificial phase-locking between neighboring hives.
      for (let i = 0; i < item.key.length; i++) hash = Math.imul(hash ^ item.key.charCodeAt(i), 16777619);
      src.start(0, ((hash >>> 0) / 4294967296) * Math.max(0.01, loopBuffer.duration - 0.02));
      const voice = { ...item, src, gain, spatial, createdAt: now, lastWantedAt: now, previousX: item.x, previousY: item.y, previousAt: now, pitch: 1, targetGain: 0, aggression: 0, doppler: 1 }; // Diagnostic and motion history stays with this one emitter.
      voices.set(item.key, voice);
      return voice;
    } catch (error) {
      debug.error = 'voice: ' + String(error?.message || error);
      try { src?.stop?.(); } catch (_) {}
      try { src?.disconnect?.(); gain?.disconnect?.(); spatial?.disconnect?.(); } catch (_) {}
      return null;
    }
  }

  function releaseVoice(key) {
    const voice = voices.get(key);
    if (!voice) return;
    voices.delete(key);
    try { voice.src.stop(); } catch (_) {}
    try { voice.src.disconnect(); voice.gain.disconnect(); voice.spatial?.disconnect?.(); } catch (_) {}
  }

  function listenerPosition(deps, area, now) {
    const tileSize = Math.max(1, Number(deps.TILE) || 1);
    const x = Number(deps.player?.x) / tileSize, y = Number(deps.player?.y) / tileSize;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const dt = (now - listenerMotion.at) / 1000;
    if (listenerMotion.area === area && dt > 0.02 && dt < 2) {
      const vx = (x - listenerMotion.x) / dt, vy = (y - listenerMotion.y) / dt;
      listenerMotion.vx = Math.hypot(vx, vy) > MAX_SPEED_TILES_S ? 0 : vx;
      listenerMotion.vy = Math.hypot(vx, vy) > MAX_SPEED_TILES_S ? 0 : vy;
    } else { listenerMotion.vx = 0; listenerMotion.vy = 0; lastScanAt = -Infinity; }
    listenerMotion.x = x; listenerMotion.y = y; listenerMotion.at = now; listenerMotion.area = area;
    return true;
  }

  function positionVoice(voice, dx, dy, deps) {
    const camera = deps.getCamera?.() || deps.camera; // Third-person camera basis: listener is the player, not the distant camera boom.
    const matrix = camera?.matrixWorld?.elements;
    const rightX = matrix?.[0] ?? 1, rightY = matrix?.[2] ?? 0;
    const backX = matrix?.[8] ?? 0, backY = matrix?.[10] ?? 1;
    const right = dx * rightX + dy * rightY, back = dx * backX + dy * backY;
    const spatial = voice.spatial;
    if (!spatial) return;
    if (spatial.positionX && spatial.positionZ) {
      spatial.positionX.setTargetAtTime(right, context.currentTime, 0.06);
      spatial.positionZ.setTargetAtTime(back, context.currentTime, 0.06);
    } else if (spatial.setPosition) spatial.setPosition(right, 0, back);
    else if (spatial.pan) spatial.pan.setTargetAtTime(clamp(right / Math.max(2, Math.hypot(right, back)), -1, 1), context.currentTime, 0.06);
  }

  function updateNow() {
    if (disposed) return;
    const deps = runtime();
    const now = performance.now();
    const area = deps?.getCurrentArea?.() || '';
    debug.area = area;
    debug.lastUpdate = now;
    if (!deps?.player || !listenerPosition(deps, area, now)) return;
    const settings = config();
    const enabled = settings.enabled !== false && !document?.hidden; // Pauses in the background; the shared AudioMix bus still owns master/effects controls.
    const volume = clamp(Number(settings.sfxVolume ?? 1), 0, 1);
    if (now - lastScanAt >= SCAN_MS) scan(deps, area, now);
    if (enabled && volume > 0 && candidates.size) ensureSample();
    if (context?.state === 'running' && loopBuffer && enabled) {
      for (const item of candidates.values()) if (!voices.has(item.key)) createVoice(item, now);
    }
    for (const [key, voice] of voices) {
      const item = enabled ? candidates.get(key) : null;
      const tileSize = Math.max(1, Number(deps.TILE) || 1);
      const x = item?.actor ? Number(item.actor.x) / tileSize : item?.x;
      const y = item?.actor ? Number(item.actor.y) / tileSize : item?.y;
      const dist = item ? distance(x, y, listenerMotion.x, listenerMotion.y) : Infinity;
      const valid = item && Number.isFinite(dist) && dist < RANGE_TILES && !item.actor?._hiveTucked;
      let target = 0;
      if (valid) {
        voice.lastWantedAt = now;
        const dt = (now - voice.previousAt) / 1000;
        let vx = 0, vy = 0;
        if (item.actor && dt > 0.02 && dt < 2) {
          vx = (x - voice.previousX) / dt;
          vy = (y - voice.previousY) / dt;
          if (Math.hypot(vx, vy) > MAX_SPEED_TILES_S) vx = vy = 0;
        }
        voice.previousX = x; voice.previousY = y; voice.previousAt = now;
        voice.aggression = aggression(item.actor);
        voice.doppler = dopplerRate(x - listenerMotion.x, y - listenerMotion.y, vx, vy, listenerMotion.vx, listenerMotion.vy);
        voice.pitch = clamp((0.94 + voice.aggression * 0.27) * voice.doppler, 0.78, 1.4);
        voice.src.playbackRate.setTargetAtTime(voice.pitch, context.currentTime, 0.16); // Gradual live pitch with no retriggering.
        positionVoice(voice, x - listenerMotion.x, y - listenerMotion.y, deps);
        const proximity = Math.pow(1 - dist / RANGE_TILES, 1.5);
        target = VOICE_GAIN[voice.kind] * proximity * (1 + voice.aggression * 0.12) * volume;
      }
      voice.targetGain = target;
      voice.gain.gain.setTargetAtTime(target, context.currentTime, 0.13); // Smooth 24-tile edge, mute, area transitions and source culling.
      if (!valid && now - voice.lastWantedAt > RELEASE_MS) releaseVoice(key);
    }
  }

  function unlock() {
    if (disposed || !context || context.state === 'running' || context.state === 'closed') return;
    try { context.resume?.().then?.(updateNow).catch?.(error => { debug.error = String(error); }); }
    catch (error) { debug.error = String(error); }
  }

  function silence() { // Intro audio can immediately take sole ownership of the soundscape.
    for (const key of [...voices.keys()]) releaseVoice(key);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer != null) clearInterval(timer);
    for (const name of unlockEvents) document?.removeEventListener?.(name, unlock, true);
    silence();
    candidates.clear();
    try { context?.close?.(); } catch (_) {}
    context = null;
  }

  function debugSnapshot() {
    return { ...debug, url: AUDIO_URL, radiusTiles: RANGE_TILES, voiceBudget: MAX_VOICES, activeVoices: voices.size,
      contextState: context?.state || null, decodedSeconds: loopBuffer?.duration || null,
      voices: [...voices.values()].map(v => ({ key: v.key, kind: v.kind, pitch: +v.pitch.toFixed(3), aggression: +v.aggression.toFixed(2), doppler: +v.doppler.toFixed(3), gain: +v.targetGain.toFixed(3) })) }; // Mobile-readable, no console needed.
  }

  for (const name of unlockEvents) document?.addEventListener?.(name, unlock, { passive: true, capture: true });
  timer = setInterval(updateNow, TICK_MS);
  window.HoneyfuzzleAudio = { updateNow, silence, dispose, debugSnapshot, aggression, dopplerRate, makeSeamlessBuffer, scanIntervalMs: SCAN_MS };
})();
