// NPC hourly fatigue, shared waking yawns, and daily Slagothim Koma rituals.
// Uses the live schedule/bed pose, shared voice renderer and existing drink action.
(() => {
  'use strict';

  const VERSION = 1; // Checked by reloads so only one scheduler owns these NPCs.
  if (Number(window.NpcYawnRest?.version) >= VERSION) return;
  const YAWN_DURATION_S = 5; // Used for the head/body yawn pose and its movement debuff.
  const FATIGUE_SPEED_MULTIPLIER = 0.25; // While yawning, NPCs move 75% slower.
  const RESTED_HOURS = 16; // Matches the existing player Well Rested sleep buff.
  const HOURLY_GAP = 1; // An un-rested NPC yawns once per in-game hour.
  const CHECK_INTERVAL_MS = 350; // Only sleep/combat/calendar decisions are polled; active poses still animate per frame.
  const KOMA_TOAST = 'You chew your daily koma leaves so that you may run and jump as the outlanders do.';
  const SLAGOTHIM = new Set(['slagothim', 'tletingan', 'nuhongan', 'longoran']); // NPC Slagothim identities eligible to chew daily Koma.
  const PLAYER_KOMA_SPECIES = new Set(['tletingan', 'nuhongan', 'longoran']); // Only these three player subspecies receive the Koma ritual and its second-person toast.
  const PLAYER_KOMA_ID = '__player_daily_koma__'; // Separate per-character cooldown key for the player's own daily Koma dose.
  const SAVE_PREFIX = 'hobunji_npc_yawn_rest_v1:'; // Character-scoped key for rested and daily-koma time stamps.
  const YAWN_ROOT = 'assets/audio/sfx/utterances/'; // A new recording can be dropped here without changing NPC logic.
  const BREATH_FALLBACK = 'assets/audio/sfx/combat/sfx_heavybreath_intensity1.m4a'; // Shared combat-breath recording if no yawn exists.
  const active = new Set(); // Live 5-second presentation/voice objects; nothing is evaluated per-frame for inactive walkers.
  const activeById = new Map(); // O(1) lookups from each NPC's movement-speed chokepoint, even during crowd-wide yawns.
  const fileProbes = new Map(); // One HEAD lookup per future yawn-asset filename, reused for every NPC.
  const voicePlans = new Map(); // Species+gender-specific resolution promises shared by all actors of that identity.
  let walkerStates = new WeakMap(); // Transient walking/sleeping/wake presentation per instantiated NPC.
  let lastCheckMs = -Infinity; // Polling gate; the runtime scheduler remains the only frame source.
  let saveCharacterId = null; // Switches save namespaces when the active player character changes.
  let saved = {}; // Persistent NPC rest and Koma days for the current save character.
  let dirty = false; // Batches NPC checkpoint writes into at most one localStorage write per poll.
  let lastVoice = null; // Included in mobile diagnostics to verify actual clip and fallback modulation.
  let lastYawn = null; // Included in mobile diagnostics to verify each scheduled wake or hourly trigger.
  let lastError = null; // Included in mobile diagnostics instead of requiring browser devtools.
  let playerWakePending = false; // Set by a real Sleep passage or finished bed lie; consumed when the player's avatar/actions become ready.
  let lastBedSleepCount = null; // Tracks completed legacy bed animations without touching BedLiePose's private sleep/rollover logic.

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
    if (!id || saveCharacterId === id) return !!id;
    for (const entry of [...active]) finish(entry, 'character changed');
    flush();
    saveCharacterId = id;
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_PREFIX + id) || '{}');
      saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (error) { saved = {}; lastError = 'load: ' + String(error?.message || error); }
    walkerStates = new WeakMap();
    voicePlans.clear();
    playerWakePending = false; // A pending wake from another selected character must not animate the new one.
    lastBedSleepCount = null; // BedLiePose counters are runtime-global, not per save character.
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
      const mod = voiceModulation(species, gender);
      const genderFile = await findVoiceFile(species, gender);
      if (genderFile) return { url: genderFile, pitch: 0, tempo: 1, gain: 1, source: 'gender yawn' };
      if (gender === 'female') {
        const maleFile = await findVoiceFile(species, 'male');
        if (maleFile) {
          const male = voiceModulation(species, 'male');
          return {
            url: maleFile,
            pitch: (Number(mod.pitchSemitones) || 0) - (Number(male.pitchSemitones) || 0),
            tempo: (Number(mod.tempo) || 1) / Math.max(0.1, Number(male.tempo) || 1),
            gain: (Number(mod.gain) || 1) / Math.max(0.1, Number(male.gain) || 1),
            source: 'male yawn, relative female modulation',
          };
        }
      }
      return {
        url: window.CombatVocalizations?.getConfig?.()?.assets?.breath?.['1'] || BREATH_FALLBACK,
        pitch: Number(mod.pitchSemitones) || 0,
        tempo: (Number(mod.tempo) || 1) / 4,
        gain: Number(mod.gain) || 1,
        source: 'breathing x4 duration',
      };
    })());
    return voicePlans.get(key);
  }

  function stopVoice(entry) {
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
    const actor = {
      get x() { return walker.root.position.x * tile; },
      get y() { return walker.root.position.z * tile; },
      get areaId() { return walker.area; },
      rec: walker.rec,
    }; // Voice renderer follows the live NPC position rather than a frozen spawn-point snapshot.
    const audioSpatial = window.AudioSystem?.combatAudioSpatial;
    if (Number(audioSpatial?.(actor, { earshotTiles: 14 })?.gain ?? 1) < 0.002) return; // No audio asset probes for inaudible/off-area NPCs.
    const identity = sourceIdentity(walker);
    const plan = await voiceFor(identity.species, identity.gender);
    if (!active.has(entry) || entry.finished || walker.area !== window.Combat?.deps?.getCurrentArea?.()) return;
    const spatial = audioSpatial?.(actor, { earshotTiles: 14 }) || {};
    if (Number(spatial.gain ?? 1) < 0.002) return;
    const owner = window.CharacterVoiceOwner;
    const claim = owner?.request?.(entry.isPlayer ? (window.Combat?.deps?.player || walker) : walker, {
      kind: 'active', priority: window.CombatVocalizations?.getVoicePriority?.('active') ?? 3,
      fadeOutS: 0.12,
    }) || null;
    if (owner && !claim) return;
    const volume = Math.min(1, Math.max(0, 0.72 * plan.gain * Number(audioConfig.sfxVolume ?? 1) * Number(spatial.gain ?? 1)));
    const renderer = window.AnimalVoiceIndependentPlayback?.playIndependent;
    if (!renderer) { owner?.release?.(claim); return; }
    entry.voiceClaim = claim;
    entry.voice = renderer(plan.url, {
      tempo: plan.tempo, pitchSemitones: plan.pitch, volume, trimSilence: true,
      tailPadS: 0, extraWetBase: 0,
      panX: spatial.panX || 0, position3d: spatial.position3d || null,
      sourceActor: actor, extraWetBoost: spatial.extraWetBoost || 0,
      lowpassHz: Math.round(4000 + 16000 * Math.pow(Math.max(0, Number(spatial.gain ?? 1)), 0.7)),
      area: walker.area,
      onFinished: () => { if (entry.voiceClaim === claim) { owner?.release?.(claim); entry.voiceClaim = null; } },
    });
    owner?.bindStop?.(claim, seconds => entry.voice?.stop?.(seconds));
    lastVoice = { npcId: walker.rec?.id, species: identity.species, gender: identity.gender,
      source: plan.source, url: plan.url, tempo: plan.tempo, pitch: plan.pitch, volume };
  }

  function restorePose(entry) {
    const state = entry.state;
    const neck = entry.walker.neckJoint;
    if (neck?.rotation && state.lastNeckApplied != null
      && Math.abs(neck.rotation.x - state.lastNeckApplied) < 0.0001) {
      neck.rotation.x -= state.lastNeckOffset;
    }
    state.lastNeckOffset = 0;
    state.lastNeckApplied = null;
    const body = entry.walker.alcoholPoseGroup; // This torso-only parent is independent of NPC feet and held-item action locks.
    if (body?.rotation && entry.lastBodyApplied != null
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
  }
  function finish(entry, reason = 'complete') {
    if (!entry || entry.finished) return;
    entry.finished = true;
    restorePose(entry);
    stopVoice(entry);
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
    state.nextHour = Math.max(hour, state.restedUntil) + HOURLY_GAP;
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
      }, YAWN_DURATION_S, entry.isPlayer ? { participantId: 'player', allowWalking: false, preserveFacing: true } : {}) || 0;
      if (duration > 0) entry.komaStarted = true; // Combat/area-change cleanup owns the transient leaf until drink completion.
    }
    lastYawn = { npcId: state.id, reason, hour, koma: entry.komaStarted, durationS: YAWN_DURATION_S };
    window.__farmLog?.('[yawn] ' + state.id + ' (' + reason + ')' + (entry.komaStarted ? ' + daily koma' : ''), 'npc');
    void startVoice(entry).catch(error => { lastError = 'audio: ' + String(error?.message || error); });
    return true;
  }

  function movementMultiplier(npcId) {
    return activeById.has(String(npcId || '')) ? FATIGUE_SPEED_MULTIPLIER : 1;
  }
  function poseFrame(entry, now) {
    const progress = Math.min(1, Math.max(0, (now - entry.startedAt) / (YAWN_DURATION_S * 1000)));
    if (progress >= 1) { finish(entry); return; }
    if (entry.walker._bedLieActive) return;
    const envelope = Math.sin(Math.PI * progress) ** 2;
    const neck = entry.walker.neckJoint;
    const state = entry.state;
    if (neck?.rotation) {
      const offset = -0.28 * envelope + 0.05 * Math.sin(progress * Math.PI * 4) * envelope;
      const base = state.lastNeckApplied != null && Math.abs(neck.rotation.x - state.lastNeckApplied) < 0.0001
        ? neck.rotation.x - state.lastNeckOffset : neck.rotation.x;
      neck.rotation.x = base + offset;
      state.lastNeckOffset = offset;
      state.lastNeckApplied = neck.rotation.x;
    }
    const body = entry.walker.alcoholPoseGroup; // Visible chest expansion and a slight backward lean distinguish a yawn from ordinary head tracking.
    if (body?.rotation) {
      const offset = -0.085 * envelope;
      const base = entry.lastBodyApplied != null && Math.abs(body.rotation.x - entry.lastBodyApplied) < 0.0001
        ? body.rotation.x - entry.lastBodyOffset : body.rotation.x;
      body.rotation.x = base + offset;
      entry.lastBodyOffset = offset;
      entry.lastBodyApplied = body.rotation.x;
    }
  }

  function playerWakingYawn(hour, area) {
    if (!playerWakePending || window.CharacterActionLocks?.isLocked?.('player', 'actions')) return;
    const profile = window.__hobunjiPlayerProfile;
    const portrait = window.WorldPortraitLife?.getPlayerAvatar?.();
    const avatarGroup = portrait?.group;
    const root = avatarGroup?.parent; // Current playerMesh owns the same hand rig used by the authored held-item drink animation.
    if (!profile?.appearance?.speciesId || !root?.parent || !area) return;
    const walker = {
      rec: { id: PLAYER_KOMA_ID, appearance: profile.appearance },
      root, avatarGroup, area,
      neckJoint: avatarGroup.userData?.neckRig?.neckJoint || null,
      _dailyKomaPlayer: true,
    }; // Transient player adapter; reuses the NPC yawn/voice and authored Koma pose without treating the player as an NPC walker.
    const state = stateFor(walker, hour);
    state.restedUntil = hour + RESTED_HOURS; // A completed sleep refreshes the usual post-sleep rested timer.
    if (startYawn(walker, state, hour, 'player waking')) playerWakePending = false;
  }
  function frame(context = {}) {
    if (!syncCharacter()) return;
    const now = Number.isFinite(context.timestamp) ? context.timestamp : performance.now();
    for (const entry of active) poseFrame(entry, now); // Deleting the just-finished Set entry during iteration is safe; no per-frame array allocation.
    if (now - lastCheckMs < CHECK_INTERVAL_MS) return;
    lastCheckMs = now;
    const hour = nowGameHour();
    if (!Number.isFinite(hour)) return;
    const completedBedSleeps = window.BedLiePose?.debug?.()?.completed; // Legacy bed animation calls game.js sleepInBed without emitting the newer Sleep passage event.
    if (Number.isFinite(completedBedSleeps)) {
      if (lastBedSleepCount !== null && completedBedSleeps > lastBedSleepCount) playerWakePending = true;
      lastBedSleepCount = completedBedSleeps;
    }
    const area = window.Combat?.deps?.getCurrentArea?.();
    const globalCombat = combatNow();
    for (const entry of active) {
      if (entry.isPlayer && (globalCombat || !entry.walker.root.parent || entry.walker.area !== area))
        finish(entry, 'interrupted'); // A real player encounter cancels the yawn and unfinished chewing immediately.
    }
    if (!globalCombat) playerWakingYawn(hour, area);
    for (const walker of window._npcWalkers || []) {
      if (!walker?.root || !walker.rec?.id || walker.animalDef) continue;
      if (sourceIdentity(walker).species.endsWith('-skeleton')) continue; // Undead skeletons have no breathing voice or sleep need in CombatVocalizations.
      const state = stateFor(walker, hour);
      const sleepingNow = asleep(walker);
      if (sleepingNow) {
        state.wasSleeping = true;
        if (state.active) finish(state.active, 'sleep');
        continue;
      }
      const rising = !!walker._bedLieActive || walker.currentScheduleTarget?.pose === 'lie';
      if (state.wasSleeping && !rising) {
        state.wasSleeping = false;
        state.wakePending = true;
        state.restedUntil = hour + RESTED_HOURS;
        state.nextHour = hour + RESTED_HOURS + HOURLY_GAP;
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
    description: 'NPC rested timers, five-second yawns, pitch-preserving voice fallback and daily Koma drink',
  });
  window.addEventListener?.('hobunji-time-passage', event => {
    if (event?.detail?.kind === 'sleep' && Number(event.detail.hours) > 0) playerWakePending = true; // Only actual completed player Sleep, never Wait or dev time skips.
  });
  window.addEventListener?.('beforeunload', flush);
  window.NpcYawnRest = Object.freeze({
    version: VERSION,
    movementMultiplier,
    debugSnapshot: () => ({
      version: VERSION, characterId: saveCharacterId,
      active: [...active].map(entry => ({ npcId: entry.state.id, elapsedS: (performance.now() - entry.startedAt) / 1000, koma: entry.komaStarted })),
      trackedRecords: Object.keys(saved).length, playerWakePending, lastBedSleepCount, lastYawn, lastVoice, lastError,
      fileChecks: fileProbes.size, pendingSave: dirty,
    }),
    _test: Object.freeze({ frame, nowGameHour, stateFor, voiceFor, sourceIdentity, finish, combatNow }),
  });
})();
