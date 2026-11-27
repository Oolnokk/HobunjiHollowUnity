// NPC hourly fatigue, shared waking yawns, and daily Slagothim Koma rituals.
// Uses the live schedule/bed pose, shared voice renderer and existing drink action.
(() => {
  'use strict';

  const VERSION = 9; // Fallback yawns now use shared species/gender pitch while retaining 0.350x tempo and natural audio tails.
  if (Number(window.NpcYawnRest?.version) >= VERSION) return;
  const YAWN_DURATION_S = 5; // Used for the head/body yawn pose and its movement debuff.
  const FATIGUE_SPEED_MULTIPLIER = 0.25; // While yawning, NPCs move 75% slower.
  const RESTED_HOURS = 3; // Short NPC sleeps provide the same three-hour fatigue relief as the player's Rested buff.
  const WELL_RESTED_HOURS = 24; // Eight-hour NPC sleeps prevent fatigue for one complete in-game day.
  const FULL_SLEEP_HOURS = 8; // Required elapsed NPC sleep for the 24-hour Well Rested fatigue grace.
  const PLAYER_YAWN_CHANNEL = 'player-yawn-rest'; // Scoped player chest extension; presentation module owns hands and held visuals.
  const HOURLY_GAP = 1; // An un-rested NPC yawns once per in-game hour.
  const CHECK_INTERVAL_MS = 350; // Only sleep/combat/calendar decisions are polled; active poses still animate per frame.
  const KOMA_TOAST = 'You chew your daily koma leaves so that you may run and jump as the outlanders do.';
  const SLAGOTHIM = new Set(['slagothim', 'tletingan', 'nuhongan', 'longoran']); // NPC Slagothim identities eligible to chew daily Koma.
  const PLAYER_KOMA_SPECIES = new Set(['tletingan', 'nuhongan', 'longoran']); // Only these three player subspecies receive the Koma ritual and its second-person toast.
  const PLAYER_KOMA_ID = '__player_daily_koma__'; // Separate per-character cooldown key for the player's own daily Koma dose.
  const SAVE_PREFIX = 'hobunji_npc_yawn_rest_v2:'; // New per-character namespace avoids importing old, non-monotonic midnight timestamps.
  const YAWN_ROOT = 'assets/audio/sfx/utterances/'; // A new recording can be dropped here without changing NPC logic.
  const BREATH_FALLBACK = 'assets/audio/sfx/combat/sfx_heavybreath_intensity5.m4a'; // Missing yawn recordings use the existing intensity-5 breath asset.
  const BREATH_FALLBACK_TEMPO = 0.35; // The ordinary utterance renderer plays this breath at a fixed, pitch-preserving 0.350x tempo.
  const active = new Set(); // Live 5-second presentation/voice objects; nothing is evaluated per-frame for inactive walkers.
  const trailingBreaths = new Set(); // Completed poses retain audible fallback breaths until the recording ends or the save is unloaded.
  const activeById = new Map(); // O(1) lookups from each NPC's movement-speed chokepoint, even during crowd-wide yawns.
  const fileProbes = new Map(); // One HEAD lookup per future yawn-asset filename, reused for every NPC.
  const voicePlans = new Map(); // Species+gender-specific resolution promises shared by all actors of that identity.
  let walkerStates = new WeakMap(); // Transient walking/sleeping/wake presentation per instantiated NPC.
  let lastCheckMs = -Infinity; // Polling gate; the runtime scheduler remains the only frame source.
  let saveCharacterId = null; // Switches save namespaces when the active player character changes.
  let saved = {}; // Persistent NPC rest and Koma days for the current save character.
  let dirty = false; // Batches NPC checkpoint writes into at most one localStorage write per poll.
  let lastVoice = null; // Included in mobile diagnostics to verify actual clip and fallback modulation.
  let lastPlayerVoice = null; // Retains the player's most recent request and actual playback status even if town NPCs yawn afterward.
  let lastYawn = null; // Included in mobile diagnostics to verify each scheduled wake or hourly trigger.
  let lastError = null; // Included in mobile diagnostics instead of requiring browser devtools.
  let playerWakePending = false; // Set by a positive Sleep passage; consumed when the player's avatar/actions become ready.
  let playerWalker = null; // One stable adapter for the player's real avatar, allowing hourly yawns to reuse the NPC state machine.

  function nowGameHour() {
    const calendar = window.CalendarSystem; // The installed full-day sky clock advances continuously from 06:00 through midnight to 06:00.
    if (!calendar || calendar.isInitialized?.() === false) return NaN;
    const absolute = calendar.getAbsoluteGameHour?.();
    if (Number.isFinite(absolute)) return absolute;
    const snapshot = calendar.timeDebugSnapshot?.(); // Editor fallback must use the live day's span, not the obsolete daylight-only model.
    const day = snapshot?.rawDay;
    const fraction = snapshot?.time01 ?? snapshot?.rawTime01;
    if (!Number.isFinite(day) || !Number.isFinite(fraction)) return NaN;
    const fullDay = snapshot?.fullDayClock === true || calendar.constants?.FULL_DAY_CYCLE === true; // Sky-dome's 24h clock runs through midnight.
    const rolloverHour = Number(snapshot?.dayRolloverHour ?? calendar.constants?.DAY_ROLLOVER_HOUR ?? 6); // Used by the fallback absolute game hour.
    return day * 24 + rolloverHour + fraction * (fullDay ? 24 : 16);
  }

  function rememberChange() { dirty = true; } // Marks a checkpoint for the next batched save.
  function flush() {
    if (!dirty || !saveCharacterId) return;
    try {
      localStorage.setItem(SAVE_PREFIX + saveCharacterId, JSON.stringify(saved));
      dirty = false;
    } catch (error) { lastError = 'save: ' + String(error?.message || error); }
  }
  function syncCharacter() {
    const id = String(window.__hobunjiPlayerProfile?.characterId || '');
    if (!id) {
      if (saveCharacterId) {
        for (const entry of [...active]) finish(entry, 'character unloaded'); // Leaving a save must not strand hidden tools or a player action lock at the title screen.
        for (const entry of [...trailingBreaths]) stopVoice(entry); // Leaving a character stops any breath still sounding after its pose.
        flush(); // Persist the outgoing character's final rest state before clearing its namespace.
        saveCharacterId = null;
        saved = {};
        dirty = false;
        walkerStates = new WeakMap();
        playerWalker = null;
        voicePlans.clear();
        playerWakePending = false;
        lastPlayerVoice = null;
      }
      return false;
    }
    if (saveCharacterId === id) return true;
    for (const entry of [...active]) finish(entry, 'character changed');
    for (const entry of [...trailingBreaths]) stopVoice(entry); // A new character never inherits the previous save's lingering breath.
    flush();
    saveCharacterId = id;
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_PREFIX + id) || '{}');
      saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (error) { saved = {}; lastError = 'load: ' + String(error?.message || error); }
    walkerStates = new WeakMap();
    playerWalker = null; // A different character never inherits this one's live yawn or Koma ritual.
    voicePlans.clear();
    lastPlayerVoice = null;
    const appearance = window.__hobunjiPlayerProfile?.appearance; // Supplies the correct player species/gender for the first playable yawn.
    if (appearance?.speciesId && window.CombatVocalizations?.getVoiceModulation) {
      const identity = sourceIdentity({ rec: { appearance } });
      void voiceFor(identity.species, identity.gender).catch(error => { lastError = 'player voice prewarm: ' + String(error?.message || error); });
    } // Resolve the absent/borrowed yawn clip while the world is loading, rather than eating the first five-second yawn.
    playerWakePending = false; // A pending wake from another selected character must not animate the new one.
    dirty = false;
    return true;
  }

  function firstYawnHour(npcId, hour) {
    let hash = 2166136261; // Stable per-NPC scheduling offset avoids dozens of simultaneous town yawns on initial spawn.
    for (const character of String(npcId)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hour + 0.15 + ((hash >>> 0) / 4294967296) * 0.85;
  }
  function stateFor(walker, hour) {
    let state = walkerStates.get(walker);
    if (state) return state;
    const id = String(walker.rec?.id || '');
    const old = saved[id] || {};
    state = {
      walker, id,
      restedUntil: typeof old.restedUntil === 'number' && Number.isFinite(old.restedUntil) ? old.restedUntil : -Infinity,
      nextHour: typeof old.nextHour === 'number' && Number.isFinite(old.nextHour) ? old.nextHour : firstYawnHour(id, hour),
      lastKomaHour: typeof old.lastKomaHour === 'number' && Number.isFinite(old.lastKomaHour) ? old.lastKomaHour : -Infinity, // JSON encodes -Infinity as null; never mistake that for a Koma dose at hour zero.
      wasSleeping: !!walker._bedLieActive && walker.currentScheduleTarget?.pose === 'lie',
      sleepStartedHour: !!walker._bedLieActive && walker.currentScheduleTarget?.pose === 'lie' ? hour : NaN, // Tracks NPC sleep length so only eight-hour sleeps grant Well Rested.
      wakePending: false, active: null, lastNeckOffset: 0, lastNeckApplied: null,
    };
    walkerStates.set(walker, state);
    return state;
  }
  function checkpoint(state) {
    if (!state.id) return;
    saved[state.id] = {
      restedUntil: state.restedUntil, nextHour: state.nextHour,
      lastKomaHour: state.lastKomaHour,
    };
    rememberChange();
  }
  function asleep(walker) {
    return !!walker._bedLieActive && walker.currentScheduleTarget?.pose === 'lie';
  }
  function inCombat(walker, globalCombat) {
    if (globalCombat) return true;
    return walker.state === 'wildlife-flight' || walker._npcRunMode === 'cover'
      || Number(walker._wildlifeThreatUntil) > performance.now();
  }
  function unavailableForYawn(walker) {
    return walker.pause === Infinity || walker.state === 'alcohol-blackout' || walker.combatTutorialSuspended
      || !!walker._npcCliffClimb || !!window.FestivalWheelDanceRuntime?.isPartner?.(walker); // Do not run the yawn over blackout, authored scene control, cliff traversal, or partner dance poses.
  }
  function combatNow() {
    const combat = window.Combat?.deps;
    const area = combat?.getCurrentArea?.();
    if (!area || !combat?.hostileObjects) return false;
    for (const foe of combat.hostileObjects) {
      if (foe?.health > 0 && foe.areaId === area && !foe._denHidden
        && !foe.denDisplacedPrey && foe._porakanekiPlannerControlled !== true
        && (foe.state === 'chase' || foe.state === 'searching')
        && !(foe._chunkCombatTarget?.health > 0)) return true;
    }
    return false;
  }
  function sourceIdentity(walker) {
    const appearance = walker.rec?.appearance || walker.profile?.appearance || {};
    return {
      species: String(appearance.speciesId || walker.rec?.species || 'default').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      gender: (appearance.gender || walker.rec?.gender) === 'female' ? 'female' : 'male', // The actual rendered appearance overrides a stale top-level gender.
    };
  }
  function voiceModulation(species, gender) {
    const character = { rec: { appearance: { speciesId: species, gender } } };
    return window.CombatVocalizations?.getVoiceModulation?.(character)
      || { pitchSemitones: 0, tempo: 1, gain: 1 };
  }

  function probeFile(url) {
    if (!fileProbes.has(url)) {
      fileProbes.set(url, (typeof fetch === 'function'
        ? fetch(url, { method: 'HEAD' }).then(response => response.ok).catch(() => false)
        : Promise.resolve(false)));
    }
    return fileProbes.get(url);
  }
  async function findVoiceFile(species, gender) {
    const variants = [...new Set([species, species.replace(/-/g, '_')])]; // Supports either established species slug spelling.
    const candidates = []; // Prioritized audio URLs probed together to keep first-time yawns audible on mobile.
    for (const variant of variants) {
      for (const ext of ['ogg', 'm4a', 'mp3']) {
        candidates.push(YAWN_ROOT + 'sfx_yawn_' + variant + '_' + gender + '.' + ext);
      }
    }
    const exists = await Promise.all(candidates.map(probeFile)); // A missing recording must not cost nine serial HTTP round trips.
    return candidates.find((url, index) => exists[index]) || null;
  }
  async function voiceFor(species, gender) {
    const key = species + ':' + gender;
    if (!voicePlans.has(key)) voicePlans.set(key, (async () => {
      const genderFile = await findVoiceFile(species, gender);
      if (genderFile) return { type: 'gender', url: genderFile }; // Only file discovery is stable enough to cache across combat-voice config reloads.
      if (gender === 'female') {
        const maleFile = await findVoiceFile(species, 'male');
        if (maleFile) return { type: 'borrowed male', url: maleFile }; // Share HEAD probes, not the female-to-male pitch offset.
      }
      return { type: 'fallback' };
    })());
    const recording = await voicePlans.get(key); // Cached existence check; modulation is recomputed after this await using the current config.
    if (recording.type === 'gender') return { url: recording.url, pitch: 0, tempo: 1, gain: 1, source: 'gender yawn' };
    const mod = voiceModulation(species, gender);
    if (recording.type === 'borrowed male') {
      const male = voiceModulation(species, 'male');
      return {
        url: recording.url,
        pitch: (Number(mod.pitchSemitones) || 0) - (Number(male.pitchSemitones) || 0),
        tempo: (Number(mod.tempo) || 1) / Math.max(0.1, Number(male.tempo) || 1),
        gain: (Number(mod.gain) || 1) / Math.max(0.1, Number(male.gain) || 1),
        source: 'male yawn, relative female modulation',
      };
    }
    return {
      url: window.CombatVocalizations?.getConfig?.()?.assets?.breath?.['5'] || BREATH_FALLBACK,
      pitch: Number(mod.pitchSemitones) || 0, // Missing yawn clips reuse the actor's current combat-voice pitch independently of the 0.350x utterance tempo.
      tempo: BREATH_FALLBACK_TEMPO, // Exact utterance tempo; no inherited species cadence.
      gain: 1, // No combat voice-gain multiplier; normal SFX mixing remains in startVoice.
      fallbackBreath: true, // Used to leave the recording untrimmed and let it finish after the pose.
      source: 'breath 5 (0.350x utterance tempo)',
    };
  }

  function stopVoice(entry) {
    trailingBreaths.delete(entry); // Explicit stops, including save switches, release completed-breath ownership.
    if (entry.voiceDebug && !['finished', 'error'].includes(entry.voiceDebug.status))
      entry.voiceDebug.status = 'stopped'; // Distinguishes a clip canceled before decode from one the browser actually started.
    entry.voice?.stop?.(0.12);
    entry.voice = null;
    window.CharacterVoiceOwner?.release?.(entry.voiceClaim);
    entry.voiceClaim = null;
  }
  async function startVoice(entry) {
    const walker = entry.walker;
    if (walker.area !== window.Combat?.deps?.getCurrentArea?.()) return;
    const audioConfig = window.AudioSystem?.gameAudioConfig?.() || {};
    if (audioConfig.enabled === false || Number(audioConfig.sfxVolume ?? 1) <= 0) return;
    const tile = Number(window.Combat?.deps?.TILE) || 64;
    const actor = entry.isPlayer ? null : {
      get x() { return walker.root.position.x * tile; },
      get y() { return walker.root.position.z * tile; },
      get areaId() { return walker.area; },
      rec: walker.rec,
    }; // Only NPCs are positional emitters; the player is the audio listener, as in CombatVocalizations.
    const audioSpatial = entry.isPlayer ? null : window.AudioSystem?.combatAudioSpatial;
    if (actor && Number(audioSpatial?.(actor, { earshotTiles: 14 })?.gain ?? 1) < 0.002) return; // NPCs outside earshot do not request voice clips.
    const identity = sourceIdentity(walker);
    const plan = await voiceFor(identity.species, identity.gender);
    const ageStage = window.CombatVocalizations?.getVoiceAgeStage?.(walker.rec) || 'adult'; // Re-read the saved phase at playback; file existence cache stays species/gender-only.
    const agePitchSemitones = Number(window.CombatVocalizations?.getAgePitchOffset?.(walker.rec)) || 0; // Age shifts apply even to dedicated yawn recordings.
    const pitchSemitones = Math.max(-24, Math.min(24, plan.pitch + agePitchSemitones)); // Renderer keeps this pitch independent from the yawn tempo.
    if (!active.has(entry) || entry.finished || walker.area !== window.Combat?.deps?.getCurrentArea?.()) return;
    const spatial = entry.isPlayer
      ? { gain: 1, panX: 0, position3d: null, extraWetBoost: 0 }
      : (audioSpatial?.(actor, { earshotTiles: 14 }) || {});
    if (!entry.isPlayer && Number(spatial.gain ?? 1) < 0.002) return; // A late-moving NPC can leave earshot while the recording resolves.
    const owner = window.CharacterVoiceOwner;
    const claim = owner?.request?.(entry.isPlayer ? (window.Combat?.deps?.player || walker) : walker, {
      kind: 'active', priority: window.CombatVocalizations?.getVoicePriority?.('active') ?? 3,
      fadeOutS: 0.12,
    }) || null;
    if (owner && !claim) return;
    const volume = Math.min(1, Math.max(0, 0.72 * plan.gain * Number(audioConfig.sfxVolume ?? 1) * Number(spatial.gain ?? 1)));
    const renderer = window.AnimalVoiceIndependentPlayback?.playIndependent;
    if (!renderer) { owner?.release?.(claim); lastError = 'audio: voice renderer unavailable'; return; }
    const voiceDebug = {
      npcId: walker.rec?.id, isPlayer: entry.isPlayer, species: identity.species, gender: identity.gender,
      source: plan.source, fallbackBreath: plan.fallbackBreath === true, url: plan.url, tempo: plan.tempo, pitch: pitchSemitones, ageStage, agePitchSemitones, volume,
      positional: !entry.isPlayer, status: 'queued',
    }; // The real renderer's started/error/finished events update this same record for copyable mobile diagnostics.
    entry.voiceDebug = voiceDebug;
    lastVoice = voiceDebug;
    if (entry.isPlayer) lastPlayerVoice = voiceDebug;
    entry.voiceClaim = claim;
    entry.voice = renderer(plan.url, {
      onStarted: () => { voiceDebug.status = 'playing'; },
      onError: error => {
        voiceDebug.status = 'error';
        lastError = 'audio: ' + String(error?.message || error);
      },
      tempo: plan.tempo, pitchSemitones, volume,
      trimSilence: !plan.fallbackBreath, // The fallback uses the complete, untrimmed intensity-5 recording.
      preservePitchOnFallback: Math.abs(pitchSemitones) < 0.05, // Neutral-pitch yawns still play slowly without lowering the original recording's pitch.
      preferPitchShiftOnFallback: Math.abs(pitchSemitones) >= 0.05, // Emergency native media prioritizes the species/gender pitch; it cannot independently retain the 0.350x yawn tempo.
      tailPadS: 0, extraWetBase: 0,
      panX: spatial.panX || 0, position3d: spatial.position3d || null,
      sourceActor: actor, extraWetBoost: spatial.extraWetBoost || 0,
      lowpassHz: Math.round(4000 + 16000 * Math.pow(Math.max(0, Number(spatial.gain ?? 1)), 0.7)),
      area: walker.area,
      onFinished: () => {
        if (voiceDebug.status !== 'error' && voiceDebug.status !== 'stopped') voiceDebug.status = 'finished';
        trailingBreaths.delete(entry); // Release a completed pose's remaining audio without polling it per frame.
        if (entry.voiceClaim === claim) { owner?.release?.(claim); entry.voiceClaim = null; }
        entry.voice = null; // The finished voice handle must not remain attached to the discarded pose.
      },
    });
    if (!entry.voice) {
      owner?.release?.(claim); entry.voiceClaim = null;
      voiceDebug.status = 'unavailable'; lastError = 'audio: voice renderer refused playback'; return;
    }
    owner?.bindStop?.(claim, seconds => entry.voice?.stop?.(seconds));
  }

  function restorePose(entry) {
    const state = entry.state;
    const neck = entry.walker.neckJoint;
    if (window.RigTransformLayers?.clear) {
      window.RigTransformLayers.clear(neck, 'npc-yawn-neck'); // Named release handles an interrupted gesture without subtracting another animator's angle.
    } else if (neck?.rotation && state.lastNeckApplied != null
      && Math.abs(neck.rotation.x - state.lastNeckApplied) < 0.0001) {
      neck.rotation.x -= state.lastNeckOffset;
    }
    state.lastNeckOffset = 0;
    state.lastNeckApplied = null;
    const body = entry.walker.alcoholPoseGroup; // This torso-only parent is independent of NPC feet and held-item action locks.
    if (window.RigTransformLayers?.clear) {
      window.RigTransformLayers.clear(body, 'npc-yawn-body'); // Release only this yawn's torso pitch after other pose ownership changes.
    } else if (body?.rotation && entry.lastBodyApplied != null
      && Math.abs(body.rotation.x - entry.lastBodyApplied) < 0.0001) {
      body.rotation.x -= entry.lastBodyOffset;
    }
    entry.lastBodyApplied = null;
    entry.lastBodyOffset = 0;
    const composer = window.portraitBreathingComposer;
    if (entry.ownsMouth && composer?.getExpression?.(entry.seatId) === 'yap') {
      composer.clearExpression?.(entry.seatId); // Do not clear dialogue or social expressions that replaced the yawn.
    }
    entry.ownsMouth = false;
    if (entry.isPlayer) {
      window.PlayerYawnStretchPresentation?.end?.(entry); // Release item visibility, the action lock and stretch hands on every completion path.
      window.PlayerBodyTransformComposer?.clearChannel?.(PLAYER_YAWN_CHANNEL);
    }
  }
  function finish(entry, reason = 'complete') {
    if (!entry || entry.finished) return;
    entry.finished = true;
    restorePose(entry);
    if (reason === 'complete' && entry.voiceDebug?.fallbackBreath === true
        && entry.voiceDebug.status === 'playing') trailingBreaths.add(entry); // Let the unaltered breath reach its natural end after the 5s pose.
    else stopVoice(entry); // Interruptions, late-rendered voices and dedicated yawns retain the original cancellation behavior.
    if (entry.komaStarted && reason !== 'complete') window.NpcDrinkInteraction?.stopAutonomous?.(entry.walker, '__daily_koma_leaf__');
    active.delete(entry);
    if (activeById.get(entry.state.id) === entry) activeById.delete(entry.state.id);
    if (entry.state.active === entry) entry.state.active = null;
  }
  function startYawn(walker, state, hour, reason) {
    if (state.active) return false;
    const entry = { walker, state, startedAt: performance.now(), finished: false, komaStarted: false,
      isPlayer: walker._dailyKomaPlayer === true, // Used to restrict the second-person toast and preserve the player's own action/voice ownership.
      voice: null, voiceClaim: null, lastBodyApplied: null, lastBodyOffset: 0, ownsMouth: false, seatId: null }; // Tracks only yawn-owned pose deltas so other animations can safely take over.
    state.active = entry;
    state.wakePending = false;
    state.nextHour = reason === 'waking' ? Math.max(hour + HOURLY_GAP, state.restedUntil) : hour + HOURLY_GAP; // Wake yawns are exempt; the next fatigue yawn starts at buff expiry, not an extra hour after it.
    checkpoint(state);
    active.add(entry);
    activeById.set(state.id, entry);
    const composer = window.portraitBreathingComposer; // Existing mouth sprites already include a wide-open 'yap' frame for supported species.
    const seatId = entry.isPlayer ? 'player' : (window.DialogueContent?.dialogueSeatId?.(walker) || state.id); // Player portraits use the shared composer seat named "player".
    const resting = entry.isPlayer ? 'neutral' : (window.DialogueContent?.npcRestingExpression?.(walker.rec) || 'neutral');
    const existingMouth = composer?.getExpression?.(seatId);
    if (composer?.setExpression && (existingMouth == null || existingMouth === resting || existingMouth === 'neutral')) {
      composer.setExpression(seatId, 'yap', YAWN_DURATION_S * 1000);
      entry.seatId = seatId;
      entry.ownsMouth = true;
    }
    const identity = sourceIdentity(walker);
    const eligible = entry.isPlayer ? PLAYER_KOMA_SPECIES.has(identity.species) : SLAGOTHIM.has(identity.species); // NPCs chew silently; the player's ritual is only for three subspecies.
    if (eligible && hour - state.lastKomaHour >= 24
      && walker.area === window.Combat?.deps?.getCurrentArea?.()) {
      const duration = window.NpcDrinkInteraction?.playDailyKoma?.(walker, () => {
        state.lastKomaHour = hour; // The rolling cooldown begins only at the successful chew strike.
        checkpoint(state); // An interrupted attempt stays eligible for the next yawn.
        if (entry.isPlayer) window.ToastNotifications?.showToast?.(KOMA_TOAST, true); // Never address the player for another NPC's Koma.
      }, YAWN_DURATION_S, entry.isPlayer ? { participantId: 'player', allowWalking: true, preserveFacing: true } : {}) || 0; // The player can walk slowly throughout their Koma yawn.
      if (duration > 0) entry.komaStarted = true; // Combat/area-change cleanup owns the transient leaf until drink completion.
    }
    if (entry.isPlayer) window.PlayerYawnStretchPresentation?.start?.(entry); // Begin AFTER Koma requests its own action lock, so chewing remains eligible.
    lastYawn = { npcId: state.id, reason, hour, koma: entry.komaStarted, durationS: YAWN_DURATION_S };
    window.__farmLog?.('[yawn] ' + state.id + ' (' + reason + ')' + (entry.komaStarted ? ' + daily koma' : ''), 'npc');
    void startVoice(entry).catch(error => { lastError = 'audio: ' + String(error?.message || error); });
    return true;
  }

  function movementMultiplier(npcId) {
    return activeById.has(String(npcId || '')) ? FATIGUE_SPEED_MULTIPLIER : 1;
  }
  function playerMovementMultiplier() {
    return movementMultiplier(PLAYER_KOMA_ID); // DevotionRestBuffs composes the same quarter-speed into the native player movement choke point.
  }
  function poseFrame(entry, now) {
    const progress = Math.min(1, Math.max(0, (now - entry.startedAt) / (YAWN_DURATION_S * 1000)));
    if (progress >= 1) { finish(entry); return; }
    if (entry.walker._bedLieActive) { finish(entry, 'bed-pose-owned'); return; } // A newly acquired bed pose must not retain a frozen additive neck/chest bend.
    const envelope = Math.sin(Math.PI * progress) ** 2;
    const neck = entry.walker.neckJoint;
    const state = entry.state;
    if (neck?.rotation) {
      const offset = -0.28 * envelope + 0.05 * Math.sin(progress * Math.PI * 4) * envelope;
      if (window.RigTransformLayers?.setAxis) {
        window.RigTransformLayers.setAxis(neck, 'npc-yawn-neck', 'rotation', 'x', offset); // Recompose from the live neck base, never accumulate a previous yawn frame.
      } else {
        const base = state.lastNeckApplied != null && Math.abs(neck.rotation.x - state.lastNeckApplied) < 0.0001
          ? neck.rotation.x - state.lastNeckOffset : neck.rotation.x;
        neck.rotation.x = base + offset;
        state.lastNeckOffset = offset;
        state.lastNeckApplied = neck.rotation.x;
      }
    }
    if (entry.isPlayer) {
      window.PlayerBodyTransformComposer?.setChannel?.(PLAYER_YAWN_CHANNEL, {
        priority: 400, leaseMs: 500, rotation: { pitch: -0.16 * envelope }, includeExternal: false, // Refreshes throughout the yawn; expires if gesture teardown is skipped.
      }); // The backward chest extension complements the arms-raised stretch without changing the player's world-facing orientation.
      window.PlayerYawnStretchPresentation?.update?.(entry, progress);
    }
    const body = entry.walker.alcoholPoseGroup; // NPC chest lean uses the existing torso group, independent of the player compositor.
    if (body?.rotation) {
      const offset = -0.085 * envelope;
      if (window.RigTransformLayers?.setAxis) {
        window.RigTransformLayers.setAxis(body, 'npc-yawn-body', 'rotation', 'x', offset); // Body bend is independent from the player's own composer channel.
      } else {
        const base = entry.lastBodyApplied != null && Math.abs(body.rotation.x - entry.lastBodyApplied) < 0.0001
          ? body.rotation.x - entry.lastBodyOffset : body.rotation.x;
        body.rotation.x = base + offset;
        entry.lastBodyOffset = offset;
        entry.lastBodyApplied = body.rotation.x;
      }
    }
  }

  function resolvePlayerWalker(hour, area) {
    const profile = window.__hobunjiPlayerProfile;
    const avatarGroup = window.WorldPortraitLife?.getPlayerAvatar?.()?.group;
    const root = avatarGroup?.parent; // Real playerMesh remains the holder and voice anchor; no separate mesh is spawned.
    if (!profile?.appearance?.speciesId || !root?.parent || !area) return null;
    if (playerWalker && (playerWalker.root !== root || playerWalker.avatarGroup !== avatarGroup)) {
      const oldState = walkerStates.get(playerWalker);
      if (oldState?.active) finish(oldState.active, 'player avatar replaced'); // Avoid leaving a stale neck/chest pose on an outgoing avatar.
      playerWalker = null;
    }
    if (!playerWalker) {
      playerWalker = {
        rec: { id: PLAYER_KOMA_ID, appearance: profile.appearance }, root, avatarGroup, area,
        neckJoint: avatarGroup.userData?.neckRig?.neckJoint || null, _dailyKomaPlayer: true,
      }; // Persistent player adapter, unlike the old waking-only temporary walker.
      const state = stateFor(playerWalker, hour);
      state.restedUntil = -Infinity; // Player's Rested / Well Rested state belongs solely to TemplePrayerRestBlessings, not obsolete NPC saved grace.
    } else {
      playerWalker.rec.appearance = profile.appearance;
      playerWalker.neckJoint = avatarGroup.userData?.neckRig?.neckJoint || null;
      playerWalker.area = area;
    }
    const identity = sourceIdentity(playerWalker);
    if (window.CombatVocalizations?.getVoiceModulation && !voicePlans.has(identity.species + ':' + identity.gender))
      void voiceFor(identity.species, identity.gender).catch(error => { lastError = 'player voice prewarm: ' + String(error?.message || error); });
    return playerWalker;
  }
  function playerAttackInputBusy() {
    const input = window.Combat?.input; // The weapon input module exposes live held, queued, and alignment states before a swing actually starts.
    for (const slot of [1, 2]) {
      const press = input?.getState?.(slot);
      if (press?.down || press?.holding || press?.holdStarted
          || press?.alignmentPending || press?.releaseQueued || press?.attackQueued) return true;
    }
    if (input?.queueSnapshot?.()?.length) return true; // A buffered attack also owns the pending animation slot.
    return (Number(window.CombatVocalizations?.attackStartDelayS?.()) || 0) > 0; // Still in the real windup/strike/hold timeline, even after button release.
  }
  function playerHeldActionBusy() {
    const target = window.ProceduralHandAttachments?.gameDeps?.toolHolder
      || window.Combat?.deps?.toolHolder; // Native pick/shovel/hoe and fishing work publishes its authored pose activity on this existing holder.
    const holder = typeof target === 'function' ? target() : target; // Some combat adapters expose the same scene group as a getter.
    if (holder?.userData?.authoredToolActionActive === true) return true;
    return !!window.RangedWeapons?.playerActionState?.(); // Loading, aiming for release, and firing a ranged weapon must finish before stretching.
  }
  function playerMountTransitionActive() {
    return ['mounted', 'mountingUp', 'mountingDown', 'climbLeap'].includes(window.Mounts?.rideState); // Preserve both mounting transitions as authored full-body actions.
  }
  function playerCanYawn(globalCombat, ongoingEntry = null) {
    const player = window.Combat?.deps?.player; // Shared live combat participant owns prone, dodge, lunge and capture states.
    if (globalCombat || playerAttackInputBusy() || playerHeldActionBusy()
        || window.ClothingWeavingSystem?.combatActive?.(player) === true
        || (Number.isFinite(player?.health) && player.health <= 0)) return false; // Recent attack attempts/hits count as combat even without a currently chasing foe.
    if (player?.prone || player?.dodging || player?.lunging || player?.somersaultRecovering
      || player?.tzatzulCapturedBy || player?._knockbackLedgeFall
      || (Number(player?.knockbackT) || 0) > 0 || window.PlayerDowned?.isDowned?.()
      || window.PlayerCrawl?.isActive?.()) return false; // Combat impacts, downed crawl and recovery fully own the body.
    if (player?._freeJump || player?.climbing || player?.onClimbSurface || player?.onCliffBalcony
        || player?._cliffRouteSession || player?.onBranch) return false; // Airborne, rope, climbing and branch traversal have their own hand/leg poses.
    if (window.Combat?.deps?.isDialogueOpen?.() || window.CalendarSystem?.isTimePassageActive?.()) return false;
    const seat = window.__hobunjiFurnitureDebug?.sitState || window.__hobunjiFurnitureDebug?.sitInteraction; // Includes 'out': the player's stand-up animation still owns the body until sitInteraction becomes null.
    if (window.PlayerSocialPoses?.active || seat) return false;
    if (window.Fishing?.state?.active || window.MusicMinigame?.state?.active || playerMountTransitionActive()) return false; // Tool modes and mount/dismount transitions own the body and hands.
    if (window.PlayerYawnStretchPresentation?.actionBlocked?.(ongoingEntry)
        ?? window.CharacterActionLocks?.isLocked?.('player', 'actions')) return false; // Ignore only our own active lock and the yawn's Koma lock, never unrelated actions.
    if (window.CharacterActionLocks?.isLocked?.('player', 'pose')) return false;
    return true;
  }
  function playerWakingYawn(hour, area) {
    if (!playerWakePending || !playerCanYawn(false)) return;
    const walker = resolvePlayerWalker(hour, area);
    if (!walker) return;
    const state = stateFor(walker, hour);
    state.restedUntil = -Infinity; // Strong/weak rest buff expiry is queried from the single saved blessing authority.
    if (startYawn(walker, state, hour, 'player waking')) playerWakePending = false;
  }
  function playerHourlyYawn(hour, area, globalCombat) {
    const walker = resolvePlayerWalker(hour, area);
    if (!walker) return;
    const state = stateFor(walker, hour);
    const rested = window.TemplePrayerRestBlessings?.isRested?.() === true
      || window.TemplePrayerRestBlessings?.isWellRested?.() === true; // Both rest tiers prevent fatigue; only Well Rested also gives stat boosts.
    const player = window.Combat?.deps?.player; // Active forced player poses interrupt even a Koma ceremony that owns its own action lock.
    const scriptedPose = !!(window.Combat?.deps?.isDialogueOpen?.() || window.CalendarSystem?.isTimePassageActive?.()
      || window.PlayerSocialPoses?.active || window.__hobunjiFurnitureDebug?.sitState
      || window.__hobunjiFurnitureDebug?.sitInteraction || window.Fishing?.state?.active
      || window.MusicMinigame?.state?.active || playerMountTransitionActive()
      || player?.prone || player?.dodging || player?.lunging || player?.tzatzulCapturedBy
      || player?._knockbackLedgeFall); // No lingering slow/pose over a completed seat or new combat/traversal animation.
    if (state.active && (scriptedPose || !playerCanYawn(globalCombat, state.active)))
      finish(state.active, 'player action interrupted');
    if (state.active || playerWakePending || rested || !playerCanYawn(globalCombat)) return;
    if (hour >= state.nextHour) startYawn(walker, state, hour, 'hourly fatigue');
  }
  function frame(context = {}) {
    if (!syncCharacter()) return;
    const now = Number.isFinite(context.timestamp) ? context.timestamp : performance.now();
    for (const entry of active) {
      if (entry.isPlayer && !playerCanYawn(false, entry)) finish(entry, 'player action interrupted');
      else poseFrame(entry, now); // Real actions interrupt immediately; routine eligibility remains on the 350ms calendar poll.
    }
    if (now - lastCheckMs < CHECK_INTERVAL_MS) return;
    lastCheckMs = now;
    const hour = nowGameHour();
    if (!Number.isFinite(hour)) return;
    const area = window.Combat?.deps?.getCurrentArea?.();
    const globalCombat = combatNow();
    for (const entry of active) {
      if (entry.isPlayer && (globalCombat || !entry.walker.root.parent || entry.walker.area !== area))
        finish(entry, 'interrupted'); // A real player encounter cancels the yawn and unfinished chewing immediately.
    }
    if (!globalCombat) playerWakingYawn(hour, area);
    playerHourlyYawn(hour, area, globalCombat); // Same hourly five-second yawn and speed penalty as NPCs, not just on waking.
    for (const walker of window._npcWalkers || []) {
      if (!walker?.root || !walker.rec?.id || walker.animalDef) continue;
      if (sourceIdentity(walker).species.endsWith('-skeleton')) continue; // Undead skeletons have no breathing voice or sleep need in CombatVocalizations.
      const state = stateFor(walker, hour);
      const sleepingNow = asleep(walker);
      if (sleepingNow) {
        if (!state.wasSleeping || !Number.isFinite(state.sleepStartedHour)) state.sleepStartedHour = hour; // Track only the actual, observed sleep time.
        state.wasSleeping = true;
        if (state.active) finish(state.active, 'sleep');
        continue;
      }
      const rising = !!walker._bedLieActive || walker.currentScheduleTarget?.pose === 'lie';
      if (state.wasSleeping && !rising) {
        state.wasSleeping = false;
        state.wakePending = true;
        const sleptHours = Number.isFinite(state.sleepStartedHour) ? Math.max(0, hour - state.sleepStartedHour) : 0; // Rested for short sleep; Well Rested for a genuine eight-hour sleep.
        const restHours = sleptHours >= FULL_SLEEP_HOURS ? WELL_RESTED_HOURS : RESTED_HOURS;
        state.restedUntil = hour + restHours;
        state.nextHour = hour + restHours; // The advertised 3h/24h fatigue grace expires precisely at this hour; no hidden fourth/twenty-fifth hour.
        state.sleepStartedHour = NaN;
        checkpoint(state);
      }
      const unavailable = unavailableForYawn(walker); // The only actively animated characters this system may safely affect.
      const actionLocked = !!window.CharacterActionLocks?.isLocked?.('npc:' + state.id, 'actions'); // NPC Koma owns its own lock; unrelated actions should still interrupt ordinary yawns.
      if (state.active && (globalCombat || inCombat(walker, false) || unavailable || rising || !walker.root.parent
          || (actionLocked && !state.active.komaStarted))) {
        finish(state.active, 'interrupted');
      }
      if (rising || state.active || !walker.root.parent || walker.area !== area || unavailable || actionLocked) continue;
      if (inCombat(walker, globalCombat)) continue;
      if (state.wakePending) startYawn(walker, state, hour, 'waking');
      else if (hour >= state.restedUntil && hour >= state.nextHour) startYawn(walker, state, hour, 'hourly fatigue');
    }
    flush();
  }

  window.RuntimeFrameScheduler?.register?.('npc-yawn-rest', frame, {
    phase: 'pre-render', owner: 'NpcYawnRest',
    description: 'NPC rested timers, five-second poses, untrimmed intensity-5 breath at 0.350x tempo and daily Koma drink',
  });
  window.addEventListener?.('hobunji-time-passage', event => {
    if (event?.detail?.kind === 'sleep' && Number(event.detail.hours) > 0) playerWakePending = true; // Only actual completed player Sleep, never Wait or dev time skips.
  });
  window.addEventListener?.('beforeunload', flush);
  window.NpcYawnRest = Object.freeze({
    version: VERSION,
    movementMultiplier,
    playerMovementMultiplier,
    debugSnapshot: () => ({
      version: VERSION, characterId: saveCharacterId,
      active: [...active].map(entry => ({ npcId: entry.state.id, elapsedS: (performance.now() - entry.startedAt) / 1000, koma: entry.komaStarted })),
      trackedRecords: Object.keys(saved).length, playerWakePending, playerSlowMultiplier: playerMovementMultiplier(), lastYawn, lastVoice, lastPlayerVoice, trailingBreathCount: trailingBreaths.size, lastError,
      playerStretch: window.PlayerYawnStretchPresentation?.debugSnapshot?.() || null,
      fileChecks: fileProbes.size, pendingSave: dirty,
    }),
    _test: Object.freeze({ frame, nowGameHour, stateFor, voiceFor, sourceIdentity, finish, combatNow, resolvePlayerWalker, playerHourlyYawn, playerCanYawn, playerAttackInputBusy, syncCharacter }),
  });
})();
