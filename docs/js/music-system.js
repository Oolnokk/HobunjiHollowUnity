(() => {
  'use strict';

  // Background music, ambient cues, layered weather/exterior bgs (birds/
  // wind/nightbugs/rain), and looping furniture-proximity SFX — extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as js/combat/*.js, js/mount-system.js, js/audio-system.js, and
  // js/pixel-probe.js.
  //
  // This is a genuinely finicky part of the game — several comments below
  // (see attachMusicGain) document a live debugging session where the
  // GainNode-based volume/boost graph turned out to not reliably reach real
  // audio output in some environments and had to be disabled in favor of a
  // plain-.volume fallback. That's a pre-existing quirk of the system being
  // moved, not something this extraction changes.
  let deps = null;
  let _startupBgm = null; // Holds Remembrance while the title/save/onboarding/loading sequence owns the soundtrack.
  let _startupSequenceComplete = false; // Prevents startup music from restarting after actual gameplay hydration.
  let _startupGameStartWatch = 0; // Short-lived post-selection watcher; cleared as soon as game.js marks the hydrated world started.
  function init(injectedDeps) {
    deps = injectedDeps;
    // A loaded/selected profile is still part of the authored startup sequence;
    // only the actual player-ready/game-start handoff ends Remembrance.
    if (window.__hobunjiGameStarted === true) {
      _startupSequenceComplete = true;
      window.HobunjiTitleScreen?.cancelStartupBgmAudio?.();
      return;
    }
    startStartupBgm();
  }

  const _audioCueIndexes = new Map();
  const _mapAudioIndexes = new Map();
  // blockUntil: performance.now() timestamp before which updateAmbientCues
  // won't start a new bgm/cue/combatBgm track — sets a floor so an
  // interrupted track's fade-out (see stopAmbientCue) actually finishes
  // fading to silence before anything new starts on top of it, instead of
  // the two overlapping audibly for the fade's duration.
  let _ambientCueState = { area: '', indexId: '', mode: 'bgm', nextAt: 0, currentCue: null, currentBgm: null, combatOverrideActive: false, combatSchedulerPausedAt: 0, currentCombatBgm: null, blockUntil: 0 };
  const _furnitureSfxSources = [];
  const _loopingBgs = new Map();
  const _audioDebugLast = new Map();
  const _gameAudioElements = new Set();
  let _gameAudioUnlocked = false;
  const _audioFailedUrls = new Set();
  const _dailyBgmPlayed = new Set();
  let _musicAudioCtx = null;
  const _musicGainNodes = new Map();       // music <audio> element -> { ctx, gain, target }
  const _musicLoudnessGain = new Map();    // resolved track url -> measured normalization multiplier
  const _musicLoudnessPending = new Map(); // resolved track url -> in-flight analysis promise
  const MUSIC_TARGET_RMS = 0.16;
  const MUSIC_LOUDNESS_GAIN_MIN = 0.5;
  const MUSIC_LOUDNESS_GAIN_MAX = 2.2;

  function audioDebug(message, key = message, throttleMs = 1200, category = 'audio') {
    const now = performance.now();
    const last = _audioDebugLast.has(key) ? _audioDebugLast.get(key) : -Infinity;
    if (now - last < throttleMs) return;
    _audioDebugLast.set(key, now);
    const log = deps?.debugLog || window.__farmLog; // Parser-time audio unlock gestures can fire before game.js injects Music deps.
    if (typeof log === 'function') log(message, category);
  }

  function audioTraceEnabled() {
    return window.SCRATCHBONES_CONFIG?.game?.debug?.trace?.audio !== false;
  }

  // Peek-only version of audioDebug's own throttle check (doesn't record a
  // call), so a call site that runs every frame can skip building its whole
  // message string (and whatever values it interpolates) on the ~99% of
  // frames where audioDebug would just throttle-discard it anyway.
  function _audioDebugDue(key, throttleMs) {
    const last = _audioDebugLast.has(key) ? _audioDebugLast.get(key) : -Infinity;
    return performance.now() - last >= throttleMs;
  }

  function audioTrace(message, key = message, throttleMs = 2000, category = 'audio') {
    if (!audioTraceEnabled()) return;
    audioDebug(message, key, throttleMs, category);
  }

  function resolveAudioUrl(url) {
    if (!url) return '';
    try { return new URL(url, document.baseURI).href; }
    catch { return url; }
  }

  function audioReadyStateLabel(snd) {
    const labels = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
    return labels[snd?.readyState] || String(snd?.readyState ?? 'none');
  }

  function makeGameAudio(url, { loop = false, preload = 'auto' } = {}) {
    const snd = new Audio(resolveAudioUrl(url));
    snd.loop = !!loop;
    snd.preload = preload;
    snd.addEventListener('loadstart', () => audioTrace('loadstart ' + snd.src, 'media-loadstart-' + snd.src, 0), { once: true });
    snd.addEventListener('canplaythrough', () => audioTrace('canplaythrough ' + snd.src + ' ready=' + audioReadyStateLabel(snd), 'media-canplay-' + snd.src, 0), { once: true });
    snd.addEventListener('error', () => audioDebug('media error ' + snd.src + ' code=' + (snd.error?.code || 'none') + ' message=' + (snd.error?.message || ''), 'media-error-' + snd.src, 0));
    _gameAudioElements.add(snd);
    try { snd.load(); } catch {}
    return snd;
  }

  // One shared play gate per <audio> element. The game loop can ask a
  // blocked looping ambience to play every frame; without this guard that
  // creates a pile of concurrent play() promises and makes their eventual
  // success/failure ordering nondeterministic.
  function requestGameAudioPlay(snd) {
    if (!snd) return Promise.reject(new Error('Missing audio element'));
    if (!snd.paused) { snd._gameAutoplayBlocked = false; return Promise.resolve(); }
    if (snd._gamePlayPromise) return snd._gamePlayPromise;
    let playResult;
    try { playResult = snd.play(); }
    catch (error) { return Promise.reject(error); }
    const pending = Promise.resolve(playResult)
      .then(result => { snd._gameAutoplayBlocked = false; return result; })
      .catch(error => {
        if (error?.name === 'NotAllowedError') snd._gameAutoplayBlocked = true;
        throw error;
      })
      .finally(() => {
        if (snd._gamePlayPromise === pending) snd._gamePlayPromise = null;
      });
    snd._gamePlayPromise = pending;
    return pending;
  }

  function getMusicAudioCtx() {
    if (_musicAudioCtx) return _musicAudioCtx;
    // Reuse AudioSystem's already-proven audible Web Audio context instead of
    // creating an isolated music-only destination. Object SFX gainBoost uses
    // this same context successfully for >100% gain.
    if (window._footstepAudioCtx) {
      _musicAudioCtx = window._footstepAudioCtx;
      return _musicAudioCtx;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      _musicAudioCtx = new AudioCtx();
      window._footstepAudioCtx = _musicAudioCtx;
    } catch (e) {
      audioDebug('music audio context unavailable: ' + (e?.message || e), 'music-ctx-fail', 0);
      _musicAudioCtx = null;
    }
    return _musicAudioCtx;
  }

  // Routes a music <audio> element through the same GainNode path already
  // proven by AudioSystem's boosted object SFX. This is required for authored
  // per-song gains above the HTMLMediaElement.volume ceiling of 1.0.
  //
  // The earlier music GainNode attempt mirrored the gain value onto
  // snd.volume as well. HTML media volume can still attenuate a media-element
  // source before it reaches Web Audio, so that effectively applied the same
  // reduction twice on ordinary BGM. Keep the media element itself at unity
  // and let exactly one GainNode own music loudness/fades instead.
  function attachMusicGain(snd) {
    const ctx = getMusicAudioCtx();
    if (!ctx) return null;
    if (_musicGainNodes.has(snd)) return _musicGainNodes.get(snd);
    if (ctx.state !== 'running') {
      // Never capture a live media element into a silent AudioContext. Resume
      // first and keep this call on the plain-volume fallback; once running,
      // refresh the same track so >100% gain can be attached without a dropout.
      ctx.resume().then(() => {
        if (!snd?._musicRetired) snd._refreshMusicTarget?.(120);
      }).catch(err => audioDebug('music audio resume failed before gain attach: ' + (err?.name || err), 'music-pre-attach-resume-fail', 0));
      return null;
    }
    try {
      const source = ctx.createMediaElementSource(snd);
      const gain = ctx.createGain();
      // Preserve the level actually coming out of the HTML audio element at
      // the instant routing changes. Using the requested final target here
      // would make a >100% song jump straight to full gain and skip fade-in.
      const initialTarget = Math.max(0, Math.min(1, Number(snd.volume) || 0));
      gain.gain.value = initialTarget;
      source.connect(gain).connect(ctx.destination);
      snd._fadeToken = null;
      snd.volume = 1;
      const node = { ctx, source, gain, target: initialTarget };
      _musicGainNodes.set(snd, node);
      return node;
    } catch (e) {
      audioDebug('music gain attach failed ' + snd.src + ': ' + (e?.message || e), 'music-gain-attach-fail', 0);
      return null;
    }
  }

  function releaseMusicGain(snd) {
    const node = _musicGainNodes.get(snd);
    if (node) {
      try { node.source?.disconnect(); } catch {}
      try { node.gain.disconnect(); } catch {}
    }
    _musicGainNodes.delete(snd);
  }

  function musicWantsAudible(snd) {
    if (!snd || snd._musicRetired) return false;
    if (snd._musicResumePending) return true;
    return Math.max(0, Number(snd._musicTarget) || 0) > 0.0001;
  }

  // Permanently removes a completed/failed/superseded music element from
  // the autoplay-unlock retry set. This prevents an old NotAllowedError
  // victim from springing back to life on a later tap over the current song.
  function retireMusicTrack(snd, { pause = true, silence = true } = {}) {
    if (!snd || snd._musicRetired) return;
    snd._musicRetired = true;
    snd._fadeToken = null;
    if (silence) setMusicVolumeNow(snd, 0);
    if (pause && !snd.paused) snd.pause();
    releaseMusicGain(snd);
    _gameAudioElements.delete(snd);
  }

  function setMusicVolumeNow(snd, value) {
    const v = Math.max(0, value);
    snd._musicTarget = v; // Preserves the intended level even while pre-gesture playback is still on the plain-volume fallback.
    let node = _musicGainNodes.get(snd);
    if (!node && v > 1.0001) node = attachMusicGain(snd); // Only cross into Web Audio when plain HTML volume genuinely lacks enough headroom.
    const clampedTarget = Math.max(0, Math.min(1, v));
    if (node) {
      node.target = v;
      node.gain.gain.cancelScheduledValues(node.ctx.currentTime);
      node.gain.gain.setValueAtTime(v, node.ctx.currentTime);
      snd.volume = 1; // GainNode is the sole audible level control on this path.
    } else {
      snd.volume = clampedTarget;
    }
  }

  // Ramps a music element's volume to `target` over `durationMs`. Uses
  // Web Audio gain automation when available (including real >100% gain),
  // and a rAF-driven plain-volume fallback if Web Audio cannot attach.
  function fadeMusicVolume(snd, target, durationMs, onDone) {
    const v = Math.max(0, target);
    snd._musicTarget = v; // Used by autoplay retry and by deferred GainNode attachment.
    const dur = Math.max(0, Number(durationMs) || 0);
    const clampedTarget = Math.max(0, Math.min(1, v));
    let node = _musicGainNodes.get(snd);
    if (!node && v > 1.0001) node = attachMusicGain(snd); // Ordinary <=100%-of-element playback stays on the proven direct-audio path.
    if (node) {
      node.target = v;
      const now = node.ctx.currentTime;
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(node.gain.gain.value, now);
      if (dur <= 0) node.gain.gain.setValueAtTime(v, now);
      else node.gain.gain.linearRampToValueAtTime(v, now + dur / 1000);
      snd.volume = 1; // Do not double-attenuate the MediaElementSource.
      if (onDone) setTimeout(() => { if (node.target === v) onDone(); }, dur);
      return;
    }
    if (dur <= 0) { snd.volume = clampedTarget; onDone?.(); return; }
    const start = snd.volume;
    const startTime = performance.now();
    const token = {};
    snd._fadeToken = token;
    const step = now => {
      if (snd._fadeToken !== token) return;
      const t = Math.max(0, Math.min(1, (now - startTime) / dur));
      snd.volume = Math.max(0, Math.min(1, start + (clampedTarget - start) * t));
      if (t < 1) requestAnimationFrame(step);
      else onDone?.();
    };
    requestAnimationFrame(step);
  }

  function computeAudioBufferRms(buffer) {
    let sumSquares = 0, count = 0;
    const step = Math.max(1, Math.floor(buffer.sampleRate / 4000));
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i += step) { sumSquares += data[i] * data[i]; count++; }
    }
    return count ? Math.sqrt(sumSquares / count) : 0;
  }

  // Lazily measures a track's loudness via Web Audio and caches a gain
  // multiplier that brings it to MUSIC_TARGET_RMS, so songs/cues recorded
  // or mastered at different levels come out at a consistent perceived
  // volume automatically, without hand-tuning each file's `volume` field.
  function musicLoudnessGain(url) {
    const resolved = resolveAudioUrl(url);
    if (!resolved) return Promise.resolve(1);
    // Authored BGM files now carry explicit LUFS-derived reference gains in
    // AudioTrackGainSettings, calibrated against Follow the Signs. Do not
    // stack the older RMS normalizer on top of those hand-audited values.
    // Ambient cue files that are not in the BGM dropdown still use RMS
    // normalization automatically.
    if (window.AudioTrackGainSettings?.hasTrack?.(url)) {
      _musicLoudnessGain.set(resolved, 1);
      return Promise.resolve(1);
    }
    if (_musicLoudnessGain.has(resolved)) return Promise.resolve(_musicLoudnessGain.get(resolved));
    if (_musicLoudnessPending.has(resolved)) return _musicLoudnessPending.get(resolved);
    const ctx = getMusicAudioCtx();
    if (!ctx) return Promise.resolve(1);
    const promise = fetch(resolved)
      .then(res => res.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(audioBuf => {
        const rms = computeAudioBufferRms(audioBuf);
        const gain = rms > 0.0001 ? deps.clamp(MUSIC_TARGET_RMS / rms, MUSIC_LOUDNESS_GAIN_MIN, MUSIC_LOUDNESS_GAIN_MAX) : 1;
        _musicLoudnessGain.set(resolved, gain);
        audioDebug('measured loudness url=' + resolved + ' rms=' + rms.toFixed(4) + ' gain=' + gain.toFixed(2), 'music-loudness-' + resolved, 0);
        return gain;
      })
      .catch(e => {
        audioDebug('loudness analysis failed url=' + resolved + ': ' + (e?.message || e), 'music-loudness-fail-' + resolved, 0);
        _musicLoudnessGain.set(resolved, 1);
        return 1;
      })
      .finally(() => _musicLoudnessPending.delete(resolved));
    _musicLoudnessPending.set(resolved, promise);
    return promise;
  }

  function musicFadeConfig() {
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    return {
      songFadeInMs: Math.max(0, Number(audioCfg.songFadeInMs) || 2200),
      songFadeOutMs: Math.max(0, Number(audioCfg.songFadeOutMs) || 2600),
      cueFadeMs: Math.max(0, Number(audioCfg.musicFadeMs) || 280),
      interruptFadeMs: Math.max(0, Number(audioCfg.musicFadeMs) || 280),
      bgsFadeMs: Math.max(0, Number(audioCfg.bgsFadeMs) || 1600)
    };
  }

  // Plays a music track (BGM song or ambient cue) with a fade-in at the
  // start / fade-out before it ends naturally. Authored BGM uses the
  // Follow-the-Signs LUFS calibration from AudioTrackGainSettings; unlisted
  // ambient cues retain the automatic RMS normalizer. `baseVolume` remains
  // the shared pre-track-gain target from config. Returns the <audio> element, with
  // a `_stopMusic(fadeMs)` helper attached for fading out an interruption
  // (e.g. switching areas) instead of cutting the track off mid-note.
  function playMusicTrack(url, baseVolume, fadeInMs, fadeOutMs, { loop = false, existingAudio = null } = {}) {
    // Startup Remembrance can already be playing before this module is fully
    // initialized. Adopt that exact element so title -> onboarding keeps one
    // uninterrupted playhead instead of restarting/overlapping the track.
    const snd = existingAudio || makeGameAudio(url, { loop });
    if (existingAudio) {
      snd.loop = !!loop;
      snd.preload = 'auto';
      snd._musicRetired = false;
      _gameAudioElements.add(snd);
    }
    snd._trackUrl = url; // lets area-change handling recognize "same song on both playlists" — see areaBgmIncludesTrack
    let fadingOut = false;
    let ducked = _lyreDucked; // A track that starts while the Lyre minigame is already sounding (e.g. the previous song looped over) should come up silent, not at full volume.
    let transportPaused = false; // Used by scheduler interruptions that must preserve this track's playhead instead of retiring it.
    const targetVolume = () => {
      if (ducked) return 0;
      const measuredGain = _musicLoudnessGain.get(resolveAudioUrl(url)) ?? 1;
      const userTrackGainRaw = Number(window.AudioTrackGainSettings?.gainForUrl?.(url));
      const userTrackGain = Number.isFinite(userTrackGainRaw) ? Math.max(0, userTrackGainRaw) : 1;
      return Math.max(0, baseVolume) * measuredGain * userTrackGain;
    };
    if (existingAudio) setMusicVolumeNow(snd, targetVolume());
    else {
      setMusicVolumeNow(snd, 0);
      fadeMusicVolume(snd, targetVolume(), fadeInMs);
    }
    snd._refreshMusicTarget = (fadeMs = 120) => {
      if (fadingOut || transportPaused || snd._musicRetired) return false;
      fadeMusicVolume(snd, targetVolume(), Math.max(0, Number(fadeMs) || 0));
      return true;
    };
    musicLoudnessGain(url).then(() => {
      if (!fadingOut && !transportPaused && !snd.paused) snd._refreshMusicTarget(400);
    });
    if (!loop && fadeOutMs > 0) {
      snd.addEventListener('timeupdate', () => {
        if (fadingOut) return;
        const remaining = (snd.duration || 0) - snd.currentTime;
        if (Number.isFinite(remaining) && remaining > 0 && remaining <= fadeOutMs / 1000) {
          fadingOut = true;
          fadeMusicVolume(snd, 0, remaining * 1000);
        }
      });
    }
    snd._stopMusic = (stopFadeMs = fadeOutMs) => new Promise(resolve => {
      if (snd._musicRetired) { resolve(); return; }
      fadingOut = true;
      transportPaused = false;
      snd._musicResumePending = false;
      fadeMusicVolume(snd, 0, stopFadeMs, () => { retireMusicTrack(snd); resolve(); });
    });
    snd._finishMusicResume = () => {
      if (snd._musicRetired || transportPaused || fadingOut || !snd._musicResumePending) return;
      const resumeFadeMs = Math.max(0, Number(snd._musicResumeFadeMs) || fadeInMs); // Restores any scheduler-paused track smoothly after playback actually resumes.
      snd._musicResumePending = false;
      fadeMusicVolume(snd, targetVolume(), resumeFadeMs);
    };
    snd._pauseMusic = (pauseFadeMs = musicFadeConfig().interruptFadeMs) => {
      if (snd._musicRetired || fadingOut) return false;
      transportPaused = true;
      snd._musicResumePending = false;
      fadeMusicVolume(snd, 0, pauseFadeMs, () => {
        if (transportPaused && !snd._musicRetired && !snd.paused) snd.pause();
      });
      return true;
    };
    snd._resumeMusic = (resumeFadeMs = fadeInMs) => {
      if (!transportPaused || snd._musicRetired || fadingOut) return false;
      transportPaused = false;
      snd._musicResumeFadeMs = Math.max(0, Number(resumeFadeMs) || 0);
      snd._musicResumePending = true;
      setMusicVolumeNow(snd, 0);
      requestGameAudioPlay(snd).then(() => snd._finishMusicResume?.()).catch(err => {
        if (err?.name === 'NotAllowedError') return; // unlockGameAudio retries this preserved music resume even though its faded volume is currently zero.
        snd._musicResumePending = false;
        audioDebug('music resume failed ' + snd.src + ': ' + (err?.name || err), 'music-resume-fail-' + snd.src, 0, 'bgm');
      });
      return true;
    };
    // Ducks toward silence and back without pausing or losing the
    // playhead — see updateLyreDucking, which calls this on every track
    // whenever the Lyre minigame's own music starts/stops sounding
    // (whether the player is playing or a nearby NPC is performing
    // ambiently) so the two never compete for the listener's attention.
    snd._setDuck = (duck, fadeMs = 900) => {
      if (ducked === duck || fadingOut || snd._musicRetired) return;
      ducked = duck;
      if (transportPaused) return;
      fadeMusicVolume(snd, targetVolume(), fadeMs);
    };
    // Some decode failures never surface as an 'error' event: the element
    // reports paused=false (and the gain ramp completes normally) but
    // currentTime never advances — silently stuck forever with nothing
    // for a caller's 'error' listener to catch. Lets callers detect that
    // and recover instead of leaving the track stuck mute indefinitely.
    snd._watchForStall = (timeoutMs, onStalled) => {
      setTimeout(() => {
        if (fadingOut || snd.paused || snd.ended) return;
        if (snd.currentTime > 0.05) return;
        onStalled();
      }, timeoutMs);
    };
    return snd;
  }

  function startStartupBgm() {
    if (_startupSequenceComplete || _startupBgm || window.__hobunjiGameStarted === true) return false;
    const audioCfg = window.AudioSystem?.gameAudioConfig?.() || {}; // Supplies the authored Remembrance entry and shared BGM volume.
    const track = audioCfg.startupBgm; // Startup-only soundtrack config used until onboarding emits hobunjiPlayerReady.
    if (audioCfg.enabled === false || !track?.url) {
      window.HobunjiTitleScreen?.cancelStartupBgmAudio?.();
      return false;
    }
    const fade = musicFadeConfig(); // Reuses the normal song fades so the startup/gameplay handoff is musical.
    const baseVol = Math.max(0, Math.min(1, Number(audioCfg.bgmVolume) || 0.48)); // Uses the same master BGM level as area music.
    const earlyTitleAudio = window.HobunjiTitleScreen?.claimStartupBgmAudio?.(track.url) || null; // Takes over the title runtime's already-loaded/already-playing Remembrance element without resetting currentTime.
    const snd = playMusicTrack(track.url, baseVol, fade.songFadeInMs, fade.songFadeOutMs, { loop: track.loop !== false, existingAudio: earlyTitleAudio }); // Persists continuously across title, every pre-game menu/loading surface, and world hydration. Its calibrated default stays below the HTML volume ceiling, so it remains on direct audio unless the user explicitly boosts it high enough to require Web Audio.
    snd._musicEntry = track;
    _startupBgm = snd;
    const finishStartup = () => {
      if (_startupBgm === snd) _startupBgm = null;
      retireMusicTrack(snd);
    };
    snd.addEventListener('ended', finishStartup, { once: true });
    snd.addEventListener('error', () => {
      if (isRealMediaError(snd)) markAudioUrlFailed(track.url, 'startup media error');
      finishStartup();
    }, { once: true });
    requestGameAudioPlay(snd).catch(err => {
      const errName = err?.name || ''; // Distinguishes browser autoplay blocking from a real media failure.
      if (errName === 'NotAllowedError') return; // The shared unlock gate retries Remembrance on the first title/onboarding gesture.
      if (errName !== 'AbortError') markAudioUrlFailed(track.url, errName || 'startup play failed');
      finishStartup();
    });
    return true;
  }

  function stopStartupBgm(reason = 'startup complete') {
    _startupSequenceComplete = true;
    clearStartupGameStartWatch();
    const snd = _startupBgm; // Captures the current startup owner before clearing its slot.
    _startupBgm = null;
    if (!snd) return false;
    const fadeMs = musicFadeConfig().songFadeOutMs; // Delays ordinary area music until Remembrance has actually faded away.
    _ambientCueState.blockUntil = Math.max(_ambientCueState.blockUntil, performance.now() + fadeMs);
    audioDebug('fading startup bgm reason=' + reason + ' url=' + snd.src, 'startup-bgm-stop-' + reason, 0, 'bgm');
    snd._stopMusic?.(fadeMs);
    return true;
  }

  function clearStartupGameStartWatch() {
    if (!_startupGameStartWatch) return;
    clearInterval(_startupGameStartWatch);
    _startupGameStartWatch = 0;
  }

  function finishStartupWhenGameActuallyStarts() {
    if (_startupSequenceComplete) return;
    if (window.__hobunjiGameStarted === true) {
      clearStartupGameStartWatch();
      stopStartupBgm('game started');
      return;
    }
    if (_startupGameStartWatch) return;
    _startupGameStartWatch = setInterval(() => {
      if (window.__hobunjiGameStarted !== true) return;
      clearStartupGameStartWatch();
      stopStartupBgm('game started');
    }, 50); // Bounded handoff poll: exists only between world selection and spawnPlayerAvatar's final hydrated-game flag.
  }

  document.addEventListener('hobunjiPlayerReady', finishStartupWhenGameActuallyStarts); // PlayerReady begins loading; Remembrance continues until the playable world is hydrated.

  function markAudioUrlFailed(url, reason) {
    const resolved = resolveAudioUrl(url);
    if (!resolved) return;
    _audioFailedUrls.add(resolved);
    audioDebug('marked audio failed url=' + resolved + ' reason=' + reason, 'audio-failed-' + resolved, 0);
  }

  // MediaError.code === 1 is MEDIA_ERR_ABORTED — the browser's own fetch
  // for this element was deliberately interrupted (e.g. the .pause()
  // that a fade-out's _stopMusic calls mid-buffer when the player
  // changes areas), not a sign the file itself is broken. A bgm 'error'
  // listener that blacklisted on any error unconditionally could
  // permanently lose a perfectly fine track like bgm_farm1.m4a for the
  // rest of the session the first time the player left an area while it
  // was still loading — same root cause as the AbortError carve-out on
  // the play() rejection path below, just on the native error event.
  function isRealMediaError(snd) {
    return (snd?.error?.code || 0) !== 1;
  }

  function audioUrlFailed(url) {
    const resolved = resolveAudioUrl(url);
    return !!resolved && _audioFailedUrls.has(resolved);
  }

  function describeAudioConfigForArea(area) {
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    const bgs = audioCfg.bgs || {};
    audioTrace('config area=' + area + ' enabled=' + (audioCfg.enabled !== false) + ' bgmCount=' + ((audioCfg.areaBgm?.[area] || []).length) + ' bgs birds=' + !!bgs.birds + ' nightbugs=' + !!bgs.nightbugs + ' wind1=' + !!bgs.wind1 + ' wind2=' + !!bgs.wind2, 'audio-config-' + area, 5000);
  }

  function unlockGameAudio(reason = 'user gesture') {
    // Create/resume the shared music context while we still have a trusted
    // gesture. Otherwise the first >100% song might create it much later,
    // outside user activation, then route itself into a suspended/silent graph.
    const musicCtx = getMusicAudioCtx();
    if (musicCtx?.state === 'suspended') musicCtx.resume().catch(err => audioDebug('music audio resume failed: ' + (err?.name || err), 'music-resume-fail', 0));
    if (!_gameAudioUnlocked) {
      _gameAudioUnlocked = true;
      audioDebug('audio unlock from ' + reason, 'audio-unlock', 0);
    }
    // Retry blocked playback on every gesture, not just the first: every
    // bgm/cue track is a freshly-created <audio> element (see
    // playMusicTrack), so a track that starts well after the player's
    // first click/tap can still get autoplay-blocked and needs its own
    // later gesture to retry play() — a one-shot retry only ever catches
    // whatever happened to be paused at that first moment.
    for (const snd of _gameAudioElements) {
      if (!snd) continue;
      if (!_musicGainNodes.has(snd) && Math.max(0, Number(snd._musicTarget) || 0) > 1.0001) {
        attachMusicGain(snd); // Promote only tracks whose requested level really exceeds the HTMLMediaElement ceiling; ordinary/startup music stays on direct audio.
      }
      if (!musicWantsAudible(snd) || !snd.paused) {
        if (!snd.paused) snd._refreshMusicTarget?.(90);
        continue;
      }
      requestGameAudioPlay(snd).then(() => {
        if (snd._musicResumePending) snd._finishMusicResume?.();
        audioTrace('unlock replay started ' + snd.src, 'unlock-play-' + snd.src, 0);
      }).catch(err => {
        audioDebug('unlock replay blocked/failed ' + snd.src + ': ' + (err?.name || err), 'unlock-fail-' + snd.src, 0);
      });
    }
  }

  window.addEventListener('hobunji-title-starting', () => unlockGameAudio('title start')); // Runs synchronously inside the title's swallowed trusted input so Remembrance can satisfy browser autoplay policy.
  window.addEventListener('hobunji-track-gain-changed', event => {
    const changedUrl = resolveAudioUrl(event?.detail?.url || '');
    if (!changedUrl) return;
    for (const snd of _gameAudioElements) {
      if (!snd?._trackUrl || resolveAudioUrl(snd._trackUrl) !== changedUrl) continue;
      snd._refreshMusicTarget?.(90);
    }
  }); // Settings slider updates the selected song in-place without waiting for the next scheduler start.
  document.addEventListener('pointerdown', () => unlockGameAudio('pointerdown'), { capture: true });
  document.addEventListener('keydown', () => unlockGameAudio('keydown'), { capture: true });
  document.addEventListener('touchstart', () => unlockGameAudio('touchstart'), { capture: true, passive: true });

  // Generic UI click tick — delegated (one listener, not one per
  // button), scoped to buttons inside #menuPanel (the tabbed
  // Inventory/Calendar/Map/Farm/Stable/.../Settings menu shell — see
  // index.html's mp-tab/mp-pane markup). Deliberately does NOT cover
  // the in-game action bar, world-object interaction buttons, or NPC
  // dialogue — those are gameplay inputs, not menu navigation, and a
  // tick on every single one of them (dig, till, plant, talk...) was
  // just noise that meant nothing beyond "you pressed something",
  // which showToast's error chime already covers for the one case
  // that actually carries information (it didn't work).
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target?.closest?.('button');
    if (btn?.closest('#menuPanel')) window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().uiClick);
  }, { capture: true });

  async function loadAudioCueIndexes() {
    try {
      const res = await fetch('assets/audio/music/cues/index.json');
      if (!res.ok) return;
      const registry = await res.json();
      await Promise.all((registry.indexes || []).map(async entry => {
        if (!entry?.id || !entry.file) return;
        const r = await fetch(entry.file);
        if (!r.ok) return;
        const data = await r.json();
        data.__basePath = entry.file.replace(/[^/]+$/, '');
        _audioCueIndexes.set(entry.id, data);
        audioDebug('loaded cue index ' + entry.id + ' (' + ((data.ambient_cues || []).length) + ' cues)', 'cue-index-' + entry.id, 0, 'cue');
      }));
    } catch(e) { deps.debugLog('Audio cue index load failed: ' + e.message, 'warn'); }
  }

  function registerMapAudio(entries) {
    for (const e of (entries || [])) {
      const area = e.area || e.mapId;
      if (area && e.audioIndex) _mapAudioIndexes.set(area, e.audioIndex);
    }
  }

  function resolveAreaAudioIndex(area) {
    if (area === 'farm' || area === 'town') return 'general';
    if (area === 'map_western_slope') return 'northern_cliffs'; // Western Slope intentionally shares the Highland/Northern Cliffs cue pool.
    if (_mapAudioIndexes.has(area)) return _mapAudioIndexes.get(area);
    if (deps._isZoneArea(area)) return deps.EXTERIOR_ZONES[area].audioIndex || '';
    const wsMap = deps.getWorkspaceMaps()?.find(m => (m.id === area) || (area === 'town' && m.id === 'map_hobunji_town'));
    return wsMap?.audioIndex || '';
  }

  function resetAmbientCueTimer(area = deps.getCurrentArea()) {
    _ambientCueState.area = area;
    _ambientCueState.indexId = resolveAreaAudioIndex(area);
    _ambientCueState.mode = 'bgm';
    _ambientCueState.nextAt = 0;
    audioDebug('ambient area=' + area + ' cueIndex=' + (_ambientCueState.indexId || 'none') + ' mode=bgm', 'ambient-area-' + area, 0, 'bgm');
    describeAudioConfigForArea(area);
  }

  function stopMusicSlot(key, reason = 'conditions changed', fadeMs = musicFadeConfig().interruptFadeMs) {
    const snd = _ambientCueState[key];
    _ambientCueState[key] = null;
    if (!snd) return false;
    const stopFadeMs = Math.max(0, Number(fadeMs) || 0); // Controls the fade and replacement delay for this retiring scheduler slot.
    if (snd._stopMusic) snd._stopMusic(stopFadeMs);
    else retireMusicTrack(snd);
    // Hold off starting anything new until this one has actually faded
    // out, not just been handed off — see blockUntil's declaration.
    _ambientCueState.blockUntil = Math.max(_ambientCueState.blockUntil, performance.now() + stopFadeMs);
    audioDebug('fading ' + key + ' reason=' + reason + ' url=' + snd.src, 'music-stop-' + key + '-' + reason + '-' + snd.src, 0, key === 'currentCue' ? 'cue' : 'bgm');
    return true;
  }

  function stopAmbientCue(reason = 'music context changed') {
    stopMusicSlot('currentCue', reason);
    stopMusicSlot('currentBgm', reason);
  }

  function musicEntryOwnsSoundtrack(snd) {
    return snd?._musicEntry?.exclusiveSoundtrack === true;
  }

  function ambientMusicOwnsSoundtrack() {
    return musicEntryOwnsSoundtrack(_ambientCueState.currentCue) || musicEntryOwnsSoundtrack(_ambientCueState.currentBgm);
  }

  function pauseMusicSlotForCombat(key, fadeMs) {
    const snd = _ambientCueState[key]; // Current scheduler-owned track preserved here so combat can pause rather than retire it.
    if (!snd || musicEntryOwnsSoundtrack(snd)) return false;
    const pauseFadeMs = Math.max(0, Number(fadeMs) || 0); // Used both for the audible fade and the combat-track start barrier.
    if (snd._pauseMusic?.(pauseFadeMs)) {
      _ambientCueState.blockUntil = Math.max(_ambientCueState.blockUntil, performance.now() + pauseFadeMs);
      audioDebug('fading ' + key + ' to combat pause url=' + snd.src, 'music-combat-pause-' + key + '-' + snd.src, 0, key === 'currentCue' ? 'cue' : 'bgm');
      return true;
    }
    return stopMusicSlot(key, 'combat started during terminal fade', pauseFadeMs);
  }

  function pauseAmbientForCombat() {
    const fadeMs = musicFadeConfig().interruptFadeMs; // Shared short handoff keeps cue/BGM and combat transitions synchronized.
    _ambientCueState.combatSchedulerPausedAt = performance.now(); // Used on combat exit to preserve any remaining cue/BGM wait instead of letting its timer elapse during combat.
    pauseMusicSlotForCombat('currentCue', fadeMs);
    pauseMusicSlotForCombat('currentBgm', fadeMs);
  }

  function restoreAmbientSchedulerAfterCombat() {
    const pausedAt = Number(_ambientCueState.combatSchedulerPausedAt) || 0; // Start timestamp used to calculate how long normal scheduler time was frozen.
    const resumedAt = performance.now(); // End timestamp used to shift only waits that were still pending when combat started.
    const pausedMs = pausedAt > 0 ? Math.max(0, resumedAt - pausedAt) : 0; // Preserved duration added to an outstanding normal-music wait.
    if (pausedMs > 0 && _ambientCueState.nextAt > pausedAt) _ambientCueState.nextAt += pausedMs;
    _ambientCueState.combatSchedulerPausedAt = 0;
  }

  function resumeMusicSlotAfterCombat(key) {
    const snd = _ambientCueState[key]; // Preserved cue/BGM slot is resumed only if it survived live area/condition checks during combat.
    if (!snd?._resumeMusic) return false;
    const fade = musicFadeConfig(); // Selects the existing cue-vs-song transition timing for the preserved slot being restored.
    const resumeFadeMs = key === 'currentCue' ? fade.cueFadeMs : fade.songFadeInMs; // Cues return quickly; full BGM keeps the authored slower song fade.
    const resumed = snd._resumeMusic(resumeFadeMs);
    if (resumed) audioDebug('resuming ' + key + ' after combat url=' + snd.src, 'music-combat-resume-' + key + '-' + snd.src, 0, key === 'currentCue' ? 'cue' : 'bgm');
    return resumed;
  }

  function resumeAmbientAfterCombat() {
    resumeMusicSlotAfterCombat('currentCue');
    resumeMusicSlotAfterCombat('currentBgm');
  }

  // ── Ducking for the Lyre minigame ────────────────────────────────────
  // Like combat's pause/resume handoff above, a Lyre performance should
  // never retire the ambient track underneath it — the player might only be
  // playing along with an NPC for a few bars. This just rides the same
  // track's volume down and back up around whatever the Lyre is doing.
  let _lyreDucked = false;
  function isLyreMusicPlaying() {
    return !!(window.MusicMinigame?.state?.active || window.MusicMinigame?.ambientActive);
  }
  function updateLyreDucking() {
    const shouldDuck = isLyreMusicPlaying();
    if (shouldDuck === _lyreDucked) return;
    _lyreDucked = shouldDuck;
    const fadeMs = 900;
    for (const key of ['currentBgm', 'currentCue', 'currentCombatBgm']) {
      _ambientCueState[key]?._setDuck?.(shouldDuck, fadeMs);
    }
    audioDebug('lyre ducking ' + (shouldDuck ? 'engaged' : 'released'), 'lyre-duck-' + shouldDuck, 0, 'bgm');
  }

  function isNightTime() {
    const hour = deps.getHour();
    return hour < 7 || hour >= 19;
  }

  function audioTimeOfDay() {
    const configured = deps.getTimeOfDay?.();
    if (configured) return configured;
    const hour = deps.getHour();
    if (hour < 8) return 'dawn';
    if (hour < 17) return 'day';
    if (hour < 20) return 'dusk';
    return 'night';
  }

  // Shared condition-registry world state used by both authored cues and
  // BGM entries. Empty/missing condition arrays remain unrestricted.
  function audioConditionWorld(area = deps.getCurrentArea()) {
    return {
      weekdays: deps.currentWeekdayName?.(),
      seasons: deps.currentSeason?.()?.name,
      weather: deps.calendar.weather,
      timesOfDay: audioTimeOfDay(),
      maps: area,
    };
  }

  function isAudioEntryEligible(entry, area = deps.getCurrentArea()) {
    if (!entry) return false;
    return window.ConditionRegistry?.entryEligible
      ? window.ConditionRegistry.entryEligible(entry, audioConditionWorld(area))
      : true;
  }

  function bgmDailyKey(track) {
    return deps.calendar.day + ':' + resolveAudioUrl(track?.url || '');
  }

  function isSunriseBgmEligible(track) {
    if (!track?.sunriseOnly) return true;
    const sunriseHour = Number.isFinite(Number(track.sunriseHour)) ? Number(track.sunriseHour) : deps.MORNING_HOUR;
    const windowHours = Math.max(0, Number(track.sunriseWindowHours) || 0);
    const hour = deps.getHour();
    return hour >= sunriseHour && hour < sunriseHour + windowHours;
  }

  function isAuthoredHourWindowEligible(track) {
    const rawStart = Number(track?.startHour); // Optional inclusive gameplay-clock lower bound for a BGM entry.
    const rawEnd = Number(track?.endHour); // Optional exclusive gameplay-clock upper bound for a BGM entry.
    const hasStart = Number.isFinite(rawStart); // Distinguishes an omitted lower bound from midnight.
    const hasEnd = Number.isFinite(rawEnd); // Distinguishes an omitted upper bound from midnight.
    if (!hasStart && !hasEnd) return true;
    const hour = Math.max(0, Math.min(23.999999, Number(deps.getHour()) || 0)); // Normalized current game hour used for the authored window check.
    const start = hasStart ? Math.max(0, Math.min(24, rawStart)) : 0; // Inclusive start used below, with omitted values defaulting to midnight.
    const end = hasEnd ? Math.max(0, Math.min(24, rawEnd)) : 24; // Exclusive end used below, with omitted values defaulting to day end.
    if (start === end) return true;
    return start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);
  }

  function isBgmTrackEligible(track, area = deps.getCurrentArea(), { alreadyPlaying = false } = {}) {
    if (!track?.url) return false;
    if (track.rainingOnly && !deps.calendar.isRaining) return false;
    if (track.nightOnly && !isNightTime()) return false;
    if (!isSunriseBgmEligible(track)) return false;
    if (!isAuthoredHourWindowEligible(track)) return false;
    if (!alreadyPlaying && track.oncePerDay && _dailyBgmPlayed.has(bgmDailyKey(track))) return false;
    return isAudioEntryEligible(track, area) && !audioUrlFailed(track.url);
  }

  function areaBgmTracks(area) {
    const mineTracks = window.TownMine?.bgmTracksForArea?.(area);
    if (Array.isArray(mineTracks)) return mineTracks;
    return window.AudioSystem?.gameAudioConfig().areaBgm?.[area] || [];
  }

  function resolveAreaBgm(area) {
    const all = areaBgmTracks(area).filter(track => track?.url);
    const playable = all.filter(track => isBgmTrackEligible(track, area));
    if (!playable.length) {
      if (all.length) audioDebug('no eligible bgm candidates for area=' + area + '; waiting for time window or valid media', 'bgm-all-failed-' + area, 3000, 'bgm');
      return null;
    }
    const preferred = playable.filter(track => !track.fallback);
    const list = preferred.length ? preferred : playable;
    return list[Math.floor(Math.random() * list.length)] || null;
  }

  // True if `snd`'s track appears anywhere in `area`'s configured bgm
  // list — a "same song on both playlists" check for area-transition
  // continuity (see updateAmbientCues). Unlike the original version, this
  // also rechecks live time/weather/map conditions: a track may continue
  // through a shared doorway, but not after its authored conditions expire.
  function areaBgmIncludesTrack(area, snd) {
    const trackUrl = snd?._trackUrl;
    if (!trackUrl) return false;
    const resolved = resolveAudioUrl(trackUrl);
    const list = areaBgmTracks(area);
    return list.some(t => t?.url && resolveAudioUrl(t.url) === resolved && isBgmTrackEligible(t, area, { alreadyPlaying: true }));
  }

  function areaCueIncludesTrack(area, snd) {
    const indexId = resolveAreaAudioIndex(area);
    const idx = _audioCueIndexes.get(indexId);
    const resolved = resolveAudioUrl(snd?._trackUrl);
    if (!idx || !resolved) return false;
    return (idx.ambient_cues || []).some(cue => {
      const cueUrl = (idx.__basePath || '') + (cue?.file || '');
      return cue.file && resolveAudioUrl(cueUrl) === resolved && isAudioEntryEligible(cue, area) && !audioUrlFailed(cueUrl);
    });
  }

  function scheduleNextCueDelay() {
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    const minSec = Number(audioCfg.ambientCueMinDelaySec) || 20;
    const maxSec = Math.max(minSec, Number(audioCfg.ambientCueMaxDelaySec) || 45);
    _ambientCueState.nextAt = performance.now() + (minSec + Math.random() * (maxSec - minSec)) * 1000;
  }

  function updateAmbientCues() {
    const currentArea = deps.getCurrentArea();
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    if (_startupBgm && window.__hobunjiGameStarted === true) stopStartupBgm('game started'); // Redundant no-poll fallback at the first real gameplay audio tick.
    if (_startupBgm && !_startupBgm._musicRetired) {
      audioTrace('ambient scheduler suppressed by startup soundtrack', 'ambient-startup-owner', 5000, 'bgm');
      return;
    }
    if (audioCfg.enabled === false) {
      stopAmbientCue('audio disabled');
      stopMusicSlot('currentCombatBgm', 'audio disabled');
      audioTrace('ambient disabled by config', 'ambient-disabled', 3000);
      return;
    }
    if (_ambientCueState.area !== currentArea) {
      const keepBgm = _ambientCueState.currentBgm
        && !_ambientCueState.currentBgm.ended
        && areaBgmIncludesTrack(currentArea, _ambientCueState.currentBgm);
      const keepCue = _ambientCueState.currentCue
        && !_ambientCueState.currentCue.ended
        && areaCueIncludesTrack(currentArea, _ambientCueState.currentCue);
      if (keepBgm || keepCue) {
        // Tracks shared by both areas keep their current playhead. This
        // covers cues as well as BGM (farm and town both use `general`) and
        // still requires the active track's conditions to remain eligible.
        _ambientCueState.area = currentArea;
        _ambientCueState.indexId = resolveAreaAudioIndex(currentArea);
        audioDebug('area changed to ' + currentArea + ' — shared ' + (keepCue ? 'cue' : 'bgm') + ' kept playing', 'ambient-area-keep-' + currentArea, 0, keepCue ? 'cue' : 'bgm');
      } else {
        stopAmbientCue('area changed to ' + currentArea);
        resetAmbientCueTimer(currentArea);
      }
    }

    // Conditions can expire without a map transition (weather/time changes).
    // Fade only the invalid owner; stale callbacks cannot advance the shared
    // scheduler because every finish path below checks its slot identity.
    if (_ambientCueState.currentCue && !areaCueIncludesTrack(currentArea, _ambientCueState.currentCue)) {
      stopMusicSlot('currentCue', 'cue conditions expired');
      _ambientCueState.mode = 'bgm';
      _ambientCueState.nextAt = _ambientCueState.blockUntil;
    }
    if (_ambientCueState.currentBgm && !areaBgmIncludesTrack(currentArea, _ambientCueState.currentBgm)) {
      // Authored BGM conditions (including active rain) should dissolve
      // musically rather than cut with the short map/combat interruption.
      stopMusicSlot('currentBgm', 'bgm conditions expired', musicFadeConfig().songFadeOutMs);
      _ambientCueState.mode = 'bgm';
      _ambientCueState.nextAt = _ambientCueState.blockUntil;
    }

    const playerInCombat = !!deps.isPlayerInCombat(); // Existing game combat state remains the sole source of truth for soundtrack handoff.
    const combatOverrideSuppressed = playerInCombat && ambientMusicOwnsSoundtrack(); // Existing exclusiveSoundtrack metadata keeps authored special music authoritative without a second exemption system.
    const combatOverrideActive = playerInCombat && !combatOverrideSuppressed; // Drives only the music override; gameplay combat state itself is untouched.
    if (combatOverrideActive !== _ambientCueState.combatOverrideActive) {
      _ambientCueState.combatOverrideActive = combatOverrideActive;
      if (combatOverrideActive) {
        pauseAmbientForCombat();
        audioDebug('combat started — fading ambient music to pause', 'combat-duck-' + currentArea, 0, 'bgm');
      } else {
        stopMusicSlot('currentCombatBgm', playerInCombat ? 'combat-exempt soundtrack active' : 'combat ended');
        if (!playerInCombat) {
          restoreAmbientSchedulerAfterCombat();
          resumeAmbientAfterCombat();
        }
        audioDebug(playerInCombat ? 'combat music suppressed by active exclusive soundtrack' : 'combat ended — resuming paused ambient music', 'combat-unduck-' + currentArea + '-' + playerInCombat, 0, 'bgm');
      }
    }

    if (combatOverrideSuppressed) {
      audioTrace('combat bgm suppressed by active exclusive soundtrack area=' + currentArea, 'ambient-combat-exclusive-' + currentArea, 5000, 'bgm');
    }

    if (combatOverrideActive) {
      if (_ambientCueState.currentCombatBgm && !isAudioEntryEligible(_ambientCueState.currentCombatBgm._musicEntry, currentArea)) {
        stopMusicSlot('currentCombatBgm', 'combat music conditions expired');
      }
      const combatTracks = (audioCfg.combatBgm || []).filter(t => t?.url && isAudioEntryEligible(t, currentArea) && !audioUrlFailed(t.url));
      if (!_ambientCueState.currentCombatBgm && combatTracks.length && performance.now() >= _ambientCueState.blockUntil) {
        const track = combatTracks[Math.floor(Math.random() * combatTracks.length)];
        const fade = musicFadeConfig();
        const baseVol = Math.max(0, Math.min(1, Number(audioCfg.bgmVolume) || 0.48));
        const trackVolMulRaw = Number(track.volumeMultiplier); // Optional authored per-track gain; Ghoul mine music uses 2x while existing tracks remain 1x.
        const trackVolMul = Number.isFinite(trackVolMulRaw) ? Math.max(0, trackVolMulRaw) : 1;
        const repeatWhileCombat = track.loop !== false; // Used by native media looping and the same-element ended fallback below.
        const snd = playMusicTrack(track.url, baseVol * trackVolMul, fade.songFadeInMs, fade.songFadeOutMs, { loop: repeatWhileCombat });
        snd._musicEntry = track;
        const finishCombatBgm = ({ repeatIfStillInCombat = true } = {}) => {
          const ownsSlot = _ambientCueState.currentCombatBgm === snd; // Prevents an old ended/error callback from touching a newer combat track.
          const liveArea = deps.getCurrentArea(); // Re-checks the track against the player's current area before an ended fallback restarts it.
          // Native HTML media looping is the gapless primary path. Some mobile
          // media stacks can still surface an ended event for an M4A loop; when
          // that happens, restart this exact element immediately instead of
          // retiring it and creating a fresh copy with the normal song fade-in.
          if (repeatIfStillInCombat
              && repeatWhileCombat
              && ownsSlot
              && !!deps.isPlayerInCombat()
              && !ambientMusicOwnsSoundtrack()
              && isAudioEntryEligible(track, liveArea)
              && !audioUrlFailed(track.url)) {
            try { snd.currentTime = 0; } catch {}
            audioTrace('combat bgm ended while combat remains active — immediate same-element repeat url=' + snd.src, 'combat-bgm-repeat-' + snd.src, 0, 'bgm');
            requestGameAudioPlay(snd).catch(err => {
              const errName = err?.name || ''; // Routes repeat failures through the existing autoplay-vs-real-error handling.
              if (errName === 'NotAllowedError') {
                audioDebug('combat bgm repeat waiting for audio unlock url=' + snd.src, 'combat-bgm-repeat-autoplay-' + snd.src, 0, 'bgm');
                return;
              }
              if (errName !== 'AbortError') markAudioUrlFailed(track.url, errName || 'repeat failed');
              finishCombatBgm({ repeatIfStillInCombat: false });
            });
            return;
          }
          if (ownsSlot) _ambientCueState.currentCombatBgm = null;
          retireMusicTrack(snd);
        };
        snd.addEventListener('ended', finishCombatBgm);
        snd.addEventListener('error', () => {
          if (isRealMediaError(snd)) markAudioUrlFailed(track.url, 'media error');
          finishCombatBgm({ repeatIfStillInCombat: false });
        }, { once: true });
        _ambientCueState.currentCombatBgm = snd;
        requestGameAudioPlay(snd).catch(err => {
          const errName = err?.name || '';
          if (errName === 'NotAllowedError') {
            audioDebug('combat bgm waiting for audio unlock url=' + snd.src, 'combat-bgm-autoplay-' + snd.src, 0, 'bgm');
            return;
          }
          if (errName !== 'NotAllowedError' && errName !== 'AbortError') markAudioUrlFailed(track.url, errName || 'play failed');
          finishCombatBgm({ repeatIfStillInCombat: false });
        });
      }
      audioTrace('ambient suppressed (in combat) area=' + currentArea + ' combatTracks=' + combatTracks.length, 'ambient-combat-' + currentArea, 5000);
      return;
    }

    const idx = _audioCueIndexes.get(_ambientCueState.indexId);
    const cues = idx?.ambient_cues || [];
    // updateAmbientCues runs every frame; skip building this trace string
    // (and the Math.round/negation work in it) on the frames it would just
    // get throttle-discarded on anyway.
    if (audioTraceEnabled() && _audioDebugDue('ambient-state-' + currentArea, 5000)) {
      audioTrace('ambient state area=' + currentArea + ' mode=' + _ambientCueState.mode + ' index=' + (_ambientCueState.indexId || 'none') + ' cues=' + cues.length + ' bgmActive=' + !!_ambientCueState.currentBgm + ' cueActive=' + !!_ambientCueState.currentCue + ' nextInMs=' + Math.max(0, Math.round((_ambientCueState.nextAt || 0) - performance.now())), 'ambient-state-' + currentArea, 5000);
    }
    if (_ambientCueState.currentCue && !_ambientCueState.currentCue.ended) return;
    if (_ambientCueState.currentCue?.ended) _ambientCueState.currentCue = null;

    if (_ambientCueState.mode === 'cue_wait') {
      if (performance.now() < _ambientCueState.nextAt || performance.now() < _ambientCueState.blockUntil) return;
      const eligibleCues = cues.filter(cue => {
        const cueUrl = (idx?.__basePath || '') + (cue?.file || '');
        return cue?.file && isAudioEntryEligible(cue, currentArea) && !audioUrlFailed(cueUrl);
      });
      if (!eligibleCues.length) { _ambientCueState.mode = 'bgm'; _ambientCueState.nextAt = performance.now() + 5000; return; }
      const cue = eligibleCues[Math.floor(Math.random() * eligibleCues.length)];
      if (!cue?.file) { scheduleNextCueDelay(); return; }
      const fade = musicFadeConfig();
      const cueUrl = (idx.__basePath || '') + cue.file;
      const cueBaseVolume = Math.max(0, Math.min(1, Number(cue.volume) || Number(audioCfg.bgmVolume) || 0.7));
      const snd = playMusicTrack(cueUrl, cueBaseVolume, fade.cueFadeMs, fade.cueFadeMs);
      snd._musicEntry = cue;
      const finishCue = ({ nextMode = 'bgm', retryMs = 0 } = {}) => {
        const ownsSlot = _ambientCueState.currentCue === snd;
        if (ownsSlot) {
          _ambientCueState.currentCue = null;
          _ambientCueState.mode = nextMode;
          if (retryMs > 0) _ambientCueState.nextAt = performance.now() + retryMs;
        }
        retireMusicTrack(snd);
      };
      snd.addEventListener('ended', finishCue, { once: true });
      snd.addEventListener('error', () => {
        audioDebug('cue error ' + snd.src, 'cue-error-' + cue.id, 0, 'cue');
        if (isRealMediaError(snd)) markAudioUrlFailed(cueUrl, 'media error');
        finishCue({ nextMode: 'cue_wait', retryMs: 3000 });
      }, { once: true });
      snd._watchForStall(6000, () => {
        if (_ambientCueState.currentCue !== snd) return;
        audioDebug('cue stalled (no playback progress) ' + snd.src, 'cue-stall-' + cue.id, 0, 'cue');
        finishCue({ nextMode: 'cue_wait', retryMs: 3000 });
      });
      _ambientCueState.currentCue = snd;
      audioDebug('playing cue area=' + currentArea + ' id=' + cue.id + ' url=' + snd.src + ' baseVolume=' + cueBaseVolume.toFixed(2), 'cue-play-' + cue.id, 0, 'cue');
      requestGameAudioPlay(snd).catch(err => {
        audioDebug('cue play blocked/failed id=' + cue.id + ': ' + (err?.name || err), 'cue-fail-' + cue.id, 0, 'cue');
        const errName = err?.name || '';
        if (errName === 'NotAllowedError') return; // Remains the sole owner; unlockGameAudio retries it.
        if (errName !== 'AbortError') markAudioUrlFailed(cueUrl, errName || 'play failed');
        finishCue({ nextMode: 'cue_wait', retryMs: 3000 });
      });
      return;
    }

    if (_ambientCueState.currentBgm && !_ambientCueState.currentBgm.ended) return;
    _ambientCueState.currentBgm = null;
    if (performance.now() < _ambientCueState.nextAt || performance.now() < _ambientCueState.blockUntil) return;
    const bgmTrack = resolveAreaBgm(currentArea);
    const bgmUrl = bgmTrack?.url || '';
    if (!bgmUrl) {
      // No areaBgm track configured/eligible for this area (e.g. a
      // wilderness zone with no music of its own) — fall back to the
      // ambient cue pool instead of parking in 'bgm' mode forever, which
      // used to retry bgm resolution every 5s indefinitely and never
      // give the cue system a turn even when it had cues available.
      audioDebug('no eligible bgm for area=' + currentArea + '; falling back to ambient cues', 'bgm-missing-' + currentArea, 3000, 'bgm');
      _ambientCueState.mode = 'cue_wait';
      _ambientCueState.nextAt = performance.now();
      return;
    }
    const fade = musicFadeConfig();
    const bgmBaseVolume = Math.max(0, Math.min(1, Number(audioCfg.bgmVolume) || 0.48));
    const snd = playMusicTrack(bgmUrl, bgmBaseVolume, fade.songFadeInMs, fade.songFadeOutMs, { loop: bgmTrack?.loop === true });
    snd._musicEntry = bgmTrack;
    const finishBgm = ({ nextMode = 'cue_wait', retryMs = 0 } = {}) => {
      const ownsSlot = _ambientCueState.currentBgm === snd;
      if (ownsSlot) {
        _ambientCueState.currentBgm = null;
        _ambientCueState.mode = nextMode;
        if (retryMs > 0) _ambientCueState.nextAt = performance.now() + retryMs;
        else if (nextMode === 'cue_wait') scheduleNextCueDelay();
      }
      retireMusicTrack(snd);
    };
    snd.addEventListener('ended', finishBgm, { once: true });
    snd.addEventListener('error', () => {
      audioDebug('bgm error ' + snd.src + ' code=' + (snd.error?.code || 'none'), 'bgm-error-' + bgmUrl, 0, 'bgm');
      if (isRealMediaError(snd)) markAudioUrlFailed(bgmUrl, 'media error');
      finishBgm({ nextMode: 'bgm', retryMs: 1000 });
    }, { once: true });
    snd._watchForStall(10000, () => {
      if (_ambientCueState.currentBgm !== snd) return;
      // Not marked failed (unlike the 'error' case above) — a stall can
      // be a transient slow-load/decode hiccup rather than a permanently
      // broken file, and blacklisting would wrongly exclude it forever.
      // (10s rather than the cue watcher's 6s: a live session showed a
      // bgm track's canplaythrough only landing ~4s after a 6s watchdog
      // had already given up and paused it, which used to look like a
      // real failure via the AbortError that pausing an in-flight
      // play() triggers — see the play().catch() below.)
      audioDebug('bgm stalled (no playback progress) ' + snd.src, 'bgm-stall-' + currentArea + '-' + bgmUrl, 0, 'bgm');
      finishBgm({ nextMode: 'bgm', retryMs: 1000 });
    });
    _ambientCueState.currentBgm = snd;
    audioDebug('playing bgm area=' + currentArea + ' url=' + snd.src + ' baseVolume=' + bgmBaseVolume.toFixed(2), 'bgm-play-' + currentArea + '-' + bgmUrl, 0, 'bgm');
    requestGameAudioPlay(snd).then(() => {
      if (bgmTrack?.oncePerDay) {
        _dailyBgmPlayed.add(bgmDailyKey(bgmTrack));
        audioDebug('marked once-per-day bgm played url=' + snd.src + ' day=' + deps.calendar.day, 'bgm-daily-' + bgmDailyKey(bgmTrack), 0, 'bgm');
      }
    }).catch(err => {
      audioDebug('bgm play blocked/failed area=' + currentArea + ': ' + (err?.name || err), 'bgm-fail-' + currentArea, 0, 'bgm');
      // NotAllowedError = autoplay policy block, AbortError = play()
      // interrupted by a pause() call elsewhere (e.g. the stall watchdog
      // below pausing a track that was just slow to buffer, not actually
      // broken) — neither means the file itself is bad, so don't
      // permanently blacklist the URL over them the way a real decode/
      // network error warrants.
      const errName = err?.name || '';
      if (errName === 'NotAllowedError') return; // Keep ownership so a later gesture cannot resurrect an orphan over newer music.
      if (errName !== 'NotAllowedError' && errName !== 'AbortError') markAudioUrlFailed(bgmUrl, err?.name || err || 'play failed');
      finishBgm({ nextMode: 'bgm', retryMs: 1000 });
    });
  }

  function setLoopingBgs(id, url, volume) {
    const v = Math.max(0, Math.min(1, Number(volume) || 0));
    let snd = _loopingBgs.get(id);
    if (!snd && url) {
      snd = makeGameAudio(url, { loop: true });
      snd.volume = 0;
      snd._bgsLastUpdateAt = performance.now(); // Used below to smooth this loop toward its live target.
      snd._bgsTargetVolume = 0; // Exposed in audio diagnostics and updated on every mix pass.
      _loopingBgs.set(id, snd);
    }
    if (!snd) return;
    const now = performance.now();
    const elapsedMs = Math.max(0, Math.min(250, now - (snd._bgsLastUpdateAt ?? now)));
    const fadeMs = musicFadeConfig().bgsFadeMs;
    const blend = fadeMs <= 0 ? 1 : 1 - Math.exp(-4.6 * elapsedMs / fadeMs);
    snd._bgsLastUpdateAt = now;
    snd._bgsTargetVolume = v;
    snd.volume = Math.max(0, Math.min(1, snd.volume + (v - snd.volume) * blend));
    audioTrace('bgs state ' + id + ' volume=' + snd.volume.toFixed(2) + ' target=' + v.toFixed(2) + ' paused=' + snd.paused + ' ready=' + audioReadyStateLabel(snd) + ' url=' + snd.src, 'bgs-state-' + id, 5000, 'bgs');
    if (v > 0 && snd.paused && !snd._gameAutoplayBlocked) {
      audioDebug('starting bgs ' + id + ' url=' + snd.src + ' volume=' + v.toFixed(2), 'bgs-start-' + id, 3000, 'bgs');
      requestGameAudioPlay(snd).catch(err => audioDebug('bgs play blocked/failed ' + id + ': ' + (err?.name || err), 'bgs-fail-' + id, 3000, 'bgs'));
    }
    if (v <= 0 && snd.volume <= 0.002 && !snd.paused) {
      snd.volume = 0;
      audioDebug('stopping bgs ' + id, 'bgs-stop-' + id, 0, 'bgs');
      snd.pause();
    }
  }

  function updateExteriorBgs() {
    const currentArea = deps.getCurrentArea();
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    if (audioCfg.enabled === false) {
      audioDebug('exterior bgs disabled by config', 'bgs-disabled', 1200, 'bgs');
      setLoopingBgs('birds', '', 0);
      setLoopingBgs('nightbugs', '', 0);
      setLoopingBgs('wind1', '', 0);
      setLoopingBgs('wind2', '', 0);
      return;
    }
    const bgs = audioCfg.bgs || {};
    const exterior = currentArea === 'farm' || currentArea === 'town' || deps._isZoneArea(currentArea);
    const rainy = deps.calendar.isRaining;
    const night = isNightTime();
    // updateExteriorBgs runs every frame; same throttle-peek as the ambient
    // trace above, to skip the string build on the common no-log frames.
    if (audioTraceEnabled() && _audioDebugDue('bgs-resolve-' + currentArea, 5000)) {
      audioTrace('bgs resolve area=' + currentArea + ' exterior=' + exterior + ' rainy=' + rainy + ' night=' + night + ' rainStrength=' + (deps.calendar.rainStrength || 0), 'bgs-resolve-' + currentArea, 5000);
    }
    setLoopingBgs('birds', bgs.birds, exterior && !night && !rainy ? (bgs.birdsVolume ?? 0.25) : 0);
    setLoopingBgs('nightbugs', bgs.nightbugs, exterior && night && !rainy ? (bgs.nightbugsVolume ?? 0.34) : 0);
    const wind01 = exterior ? Math.max(0, Math.min(1, (deps.calendar.rainStrength || 0) / 3)) : 0;
    setLoopingBgs('wind1', bgs.wind1, (bgs.wind1Volume ?? 0.20) * Math.max(0, wind01 - 0.35) / 0.65);
    setLoopingBgs('wind2', bgs.wind2, (bgs.wind2Volume ?? 0.18) * (exterior ? Math.max(0.15, wind01 * 0.75) : 0));
  }

  // ── Layered rain audio ──────────────────────────────────────────────
  // Weather-driven mix of three real rain recordings (gentle/mid/heavy —
  // see audio.bgs.gentlerain/midrain/heavyrain) instead of synthesized
  // noise. Reuses the same looping-<audio>-element plumbing as the
  // birds/wind/nightbugs bgs layers (setLoopingBgs) rather than Web
  // Audio buffer sources, so all three tracks live in _loopingBgs and
  // get the same autoplay-unlock/retry handling for free.
  //
  // Weights form a triangular crossfade over rainStrength/3 (0..1):
  // gentle owns low intensity, mid the middle, heavy the high end, with
  // neighboring bands overlapping instead of hard-cutting between them.
  function rainLayerWeights(intensity) {
    // Zero means dry weather, not the lowest audible rain band. Without
    // this boundary guard the gentle formula evaluates to 1 at intensity
    // 0, so clear weather continuously requests the gentle-rain loop.
    if (intensity <= 0) return { gentle: 0, mid: 0, heavy: 0 };
    const gentle = deps.clamp(1 - intensity / 0.66, 0, 1);
    const mid    = deps.clamp(1 - Math.abs(intensity - 0.5) / 0.5, 0, 1);
    const heavy  = deps.clamp((intensity - 0.34) / 0.66, 0, 1);
    return { gentle, mid, heavy };
  }

  function updateRainAudio() {
    const currentArea = deps.getCurrentArea();
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    const bgs = audioCfg.bgs || {};
    if (audioCfg.enabled === false) {
      setLoopingBgs('raingentle', '', 0);
      setLoopingBgs('rainmid', '', 0);
      setLoopingBgs('rainheavy', '', 0);
      return;
    }
    const outdoors = currentArea === 'farm' || currentArea === 'town' || deps._isZoneArea(currentArea);
    const indoors = currentArea === 'interior' || deps._isBuildingArea(currentArea);
    const intensity = (outdoors && !indoors && deps.calendar.isRaining)
      ? Math.min(1, (deps.calendar.rainStrength || 0) / 3)
      : 0;
    const weights = rainLayerWeights(intensity);
    const master = Math.max(0, Number(audioCfg.rainVolume) || 1);
    setLoopingBgs('raingentle', bgs.gentlerain, weights.gentle * (bgs.gentlerainVolume ?? 0.45) * master);
    setLoopingBgs('rainmid',    bgs.midrain,    weights.mid    * (bgs.midrainVolume    ?? 0.55) * master);
    setLoopingBgs('rainheavy',  bgs.heavyrain,  weights.heavy  * (bgs.heavyrainVolume   ?? 0.65) * master);
  }

  function resolveFurnitureSfx(def) {
    if (!def) return null;
    if (def.sfx) return def.sfx;
    const key = def.sfxKey;
    return key ? window.AudioSystem?.gameAudioConfig().furnitureSfx?.[key] : null;
  }

  function registerFurnitureSfxSource(area, x, z, sfx) {
    if (!sfx?.url) return null;
    const audio = makeGameAudio(sfx.url, { loop: true });
    audio.volume = 0;
    const source = { area, x, z, range: Number(sfx.rangeTiles) || 5, maxVolume: Number(sfx.volume) || 0.7, audio };
    _furnitureSfxSources.push(source);
    audioDebug('registered furniture sfx area=' + area + ' url=' + audio.src + ' pos=' + x.toFixed(2) + ',' + z.toFixed(2) + ' range=' + source.range, 'furn-register-' + area + '-' + x + '-' + z, 0);
    return source;
  }

  function unregisterFurnitureSfxSource(source) {
    if (!source) return;
    const i = _furnitureSfxSources.indexOf(source);
    if (i >= 0) _furnitureSfxSources.splice(i, 1);
    source.audio.pause();
    source.audio.currentTime = 0;
    _gameAudioElements.delete(source.audio);
    audioDebug('unregistered furniture sfx area=' + source.area + ' pos=' + source.x.toFixed(2) + ',' + source.z.toFixed(2), 'furn-unregister-' + source.area + '-' + source.x + '-' + source.z, 0);
  }

  // Tears down every furniture sfx source registered for `area` — used
  // when a zone's scene/geometry is disposed and rebuilt (see
  // disposeZoneScene in game.js), so the old area's sources don't keep
  // playing (or leak) after the furniture they were attached to is gone.
  function unregisterFurnitureSfxSourcesForArea(area) {
    for (const source of _furnitureSfxSources.filter(s => s.area === area)) unregisterFurnitureSfxSource(source);
  }

  function updateFurnitureSfxSources() {
    const currentArea = deps.getCurrentArea();
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    if (audioCfg.enabled === false) {
      for (const src of _furnitureSfxSources) {
        src.audio.volume = 0;
        if (!src.audio.paused) src.audio.pause();
      }
      return;
    }
    for (const src of _furnitureSfxSources) {
      const active = src.area === currentArea;
      const dx = deps.player.x / deps.TILE - src.x;
      const dz = deps.player.y / deps.TILE - src.z;
      const dist = Math.hypot(dx, dz);
      const v = active ? src.maxVolume * Math.max(0, 1 - dist / src.range) : 0;
      src.audio.volume = Math.max(0, Math.min(1, v));
      if (v > 0.01 && src.audio.paused && !src.audio._gameAutoplayBlocked) {
        audioDebug('starting furniture sfx area=' + src.area + ' url=' + src.audio.src + ' volume=' + src.audio.volume.toFixed(2), 'furn-start-' + src.area + '-' + src.x + '-' + src.z, 3000);
        requestGameAudioPlay(src.audio).catch(err => audioDebug('furniture sfx play blocked/failed area=' + src.area + ': ' + (err?.name || err), 'furn-fail-' + src.area + '-' + src.x + '-' + src.z, 3000));
      }
      if (v <= 0.01 && !src.audio.paused) {
        audioDebug('stopping furniture sfx area=' + src.area + ' pos=' + src.x.toFixed(2) + ',' + src.z.toFixed(2), 'furn-stop-' + src.area + '-' + src.x + '-' + src.z, 0);
        src.audio.pause();
      }
    }
  }

  // Diagnostic for "bgm/cue reports playing but is silent": the actual
  // audible level lives in the (currently disabled — see attachMusicGain)
  // GainNode graph, not on the <audio> element's own .volume, so a
  // healthy-looking playback state (no errors, paused=false) can still be
  // inaudible if the context is stuck suspended or the gain never reached
  // its ramped target. Called once per gameLoop tick from game.js.
  // Called every frame, but each of the three audioDebug() calls below only
  // actually logs once per 5000ms (see audioDebug's internal throttle) — the
  // rest of the time this function used to build all three message strings
  // (plus audioConditionWorld() and friends) purely to hand them to a call
  // that immediately discards them. Gate the whole body behind the same
  // window so that work only happens right before it's actually used.
  let _lastDiagTickRun = -Infinity;
  function logAudioTickDiagnostics() {
    const now = performance.now();
    if (now - _lastDiagTickRun < 5000) return;
    _lastDiagTickRun = now;
    audioDebug('audio tick active area=' + deps.getCurrentArea() + ' paused=' + deps.getPaused() + ' gameStarted=' + deps.getGameStarted(), 'audio-tick-' + deps.getCurrentArea(), 5000);
    const ambientSnd = _ambientCueState.currentBgm || _ambientCueState.currentCue; // Preserved exploration owner is reported even while combat has it paused.
    const activeSnd = _ambientCueState.currentCombatBgm || ambientSnd; // Audible soundtrack owner takes precedence in the mobile-copyable diagnostics.
    const gainNode = activeSnd ? _musicGainNodes.get(activeSnd) : null;
    const activeKind = _ambientCueState.currentCombatBgm ? 'combat-bgm' : _ambientCueState.currentBgm ? 'bgm' : _ambientCueState.currentCue ? 'cue' : 'none'; // Labels the actual soundtrack owner in the mobile-copyable debug log.
    const world = audioConditionWorld(); // Captures the exact condition values used by live eligibility checks.
    const nightbugs = _loopingBgs.get('nightbugs'); // Reports the formerly inaudible layer's actual and requested mix levels.
    audioDebug(
      'music scheduler mode=' + _ambientCueState.mode +
      ' owner=' + activeKind +
      ' url=' + (activeSnd?._trackUrl || 'none') +
      ' combatOverride=' + _ambientCueState.combatOverrideActive +
      ' ambientPaused=' + !!ambientSnd?.paused +
      ' blockForMs=' + Math.max(0, Math.round(_ambientCueState.blockUntil - performance.now())) +
      ' conditions=' + [world.maps, world.weather, world.timesOfDay, world.seasons, world.weekdays].join('/') +
      ' rainActive=' + deps.calendar.isRaining +
      ' ctxState=' + (_musicAudioCtx?.state || 'none') +
      ' liveGain=' + (gainNode ? gainNode.gain.gain.value.toFixed(3) : 'n/a') +
      ' targetGain=' + (gainNode ? gainNode.target.toFixed(3) : 'n/a') +
      ' sndVolume=' + (activeSnd ? activeSnd.volume.toFixed(3) : 'n/a') +
      ' sndMuted=' + (activeSnd ? activeSnd.muted : 'n/a'),
      'music-gain-diag',
      5000,
      'bgm'
    );
    audioDebug(
      'nightbugs mix volume=' + (nightbugs ? nightbugs.volume.toFixed(3) : 'not-loaded') +
      ' target=' + (nightbugs ? Number(nightbugs._bgsTargetVolume || 0).toFixed(3) : 'n/a') +
      ' paused=' + (nightbugs ? nightbugs.paused : 'n/a') +
      ' eligible=' + (isNightTime() && !deps.calendar.isRaining && (deps.getCurrentArea() === 'farm' || deps.getCurrentArea() === 'town' || deps._isZoneArea(deps.getCurrentArea()))),
      'nightbugs-diag',
      5000,
      'bgs'
    );
  }

  window.Music = {
    init,
    audioDebug,
    isNightTime,
    loadAudioCueIndexes,
    registerMapAudio,
    resetAmbientCueTimer,
    updateAmbientCues,
    updateLyreDucking,
    updateExteriorBgs,
    updateRainAudio,
    updateFurnitureSfxSources,
    resolveFurnitureSfx,
    registerFurnitureSfxSource,
    unregisterFurnitureSfxSource,
    unregisterFurnitureSfxSourcesForArea,
    logAudioTickDiagnostics,
    isRealMediaError,
    markAudioUrlFailed,
    audioUrlFailed,
  };
})();