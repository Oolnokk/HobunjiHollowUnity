// NPC hourly fatigue, waking yawns and Slagothim's daily koma ritual.
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
  const KOMA_SPRITE = 'assets/leaves/koma_leaf.png'; // Used by NpcDrinkInteraction's shared drink pose.
  const KOMA_TOAST = 'You chew your daily koma leaves so that you may run and jump as the outlanders do.';
  const SLAGOTHIM = new Set(['slagothim', 'tletingan', 'nuhongan', 'longoran']); // All currently playable Slagothim variants share the daily ritual.
  const SAVE_PREFIX = 'hobunji_npc_yawn_rest_v1:'; // Character-scoped key for rested and daily-koma time stamps.
  const YAWN_ROOT = 'assets/audio/sfx/utterances/'; // A new recording can be dropped here without changing NPC logic.
  const BREATH_FALLBACK = 'assets/audio/sfx/combat/sfx_heavybreath_intensity1.m4a'; // Shared combat-breath recording if no yawn exists.
  const active = new Set(); // Live 5-second presentation/voice objects; nothing is evaluated per-frame for inactive walkers.
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

  function nowGameHour() {
    const snapshot = window.CalendarSystem?.timeDebugSnapshot?.();
    const day = Number(snapshot?.rawDay);
    const time01 = Number(snapshot?.time01 ?? snapshot?.rawTime01);
    if (!Number.isFinite(day) || !Number.isFinite(time01)) return NaN;
    return day * 24 + time01 * 24;
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
    dirty = false;
    return true;
  }

  function stateFor(walker, hour) {
    let state = walkerStates.get(walker);
    if (state) return state;
    const id = String(walker.rec?.id || '');
    const old = saved[id] || {};
    state = {
      walker, id,
      restedUntil: Number.isFinite(Number(old.restedUntil)) ? Number(old.restedUntil) : -Infinity,
      nextHour: Number.isFinite(Number(old.nextHour)) ? Number(old.nextHour) : hour + HOURLY_GAP,
      lastKomaHour: Number.isFinite(Number(old.lastKomaHour)) ? Number(old.lastKomaHour) : -Infinity,
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
      gender: appearance.gender === 'female' || walker.rec?.gender === 'female' ? 'female' : 'male',
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
    const identity = sourceIdentity(walker);
    const plan = await voiceFor(identity.species, identity.gender);
    if (!active.has(entry) || entry.finished || walker.area !== window.Combat?.deps?.getCurrentArea?.()) return;
    const audioConfig = window.AudioSystem?.gameAudioConfig?.() || {};
    if (audioConfig.enabled === false || Number(audioConfig.sfxVolume ?? 1) <= 0) return;
    const tile = Number(window.Combat?.deps?.TILE) || 64;
    const actor = {
      x: walker.root.position.x * tile, y: walker.root.position.z * tile,
      areaId: walker.area, rec: walker.rec,
    };
    const spatial = window.AudioSystem?.combatAudioSpatial?.(actor, { earshotTiles: 14 }) || {};
    if (Number(spatial.gain ?? 1) < 0.002) return;
    const owner = window.CharacterVoiceOwner;
    const claim = owner?.request?.(walker, {
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
  }
  function finish(entry, reason = 'complete') {
    if (!entry || entry.finished) return;
    entry.finished = true;
    restorePose(entry);
    stopVoice(entry);
    if (entry.komaStarted && reason !== 'complete') window.NpcDrinkInteraction?.stopAutonomous?.(entry.walker, '__daily_koma_leaf__');
    active.delete(entry);
    if (entry.state.active === entry) entry.state.active = null;
  }
  function startYawn(walker, state, hour, reason) {
    if (state.active) return false;
    const entry = { walker, state, startedAt: performance.now(), finished: false, komaStarted: false,
      voice: null, voiceClaim: null };
    state.active = entry;
    state.wakePending = false;
    state.nextHour = Math.max(hour, state.restedUntil) + HOURLY_GAP;
    checkpoint(state);
    active.add(entry);
    const identity = sourceIdentity(walker);
    if (SLAGOTHIM.has(identity.species) && hour - state.lastKomaHour >= 24
      && walker.area === window.Combat?.deps?.getCurrentArea?.()) {
      const duration = window.NpcDrinkInteraction?.playDailyKoma?.(walker, () => {
        window.ToastNotifications?.showToast?.(KOMA_TOAST, true);
      }, YAWN_DURATION_S) || 0;
      if (duration > 0) {
        state.lastKomaHour = hour;
        entry.komaStarted = true;
        checkpoint(state);
      }
    }
    lastYawn = { npcId: state.id, reason, hour, koma: entry.komaStarted, durationS: YAWN_DURATION_S };
    window.__farmLog?.('[yawn] ' + state.id + ' (' + reason + ')' + (entry.komaStarted ? ' + daily koma' : ''), 'npc');
    void startVoice(entry).catch(error => { lastError = 'audio: ' + String(error?.message || error); });
    return true;
  }

  function movementMultiplier(npcId) {
    for (const entry of active) {
      if (!entry.finished && entry.state.id === npcId) return FATIGUE_SPEED_MULTIPLIER;
    }
    return 1;
  }
  function poseFrame(entry, now) {
    const progress = Math.min(1, Math.max(0, (now - entry.startedAt) / (YAWN_DURATION_S * 1000)));
    if (progress >= 1) { finish(entry); return; }
    const neck = entry.walker.neckJoint;
    if (!neck?.rotation || entry.walker._bedLieActive) return;
    const envelope = Math.sin(Math.PI * progress) ** 2;
    const offset = -0.28 * envelope + 0.05 * Math.sin(progress * Math.PI * 4) * envelope;
    const state = entry.state;
    const base = state.lastNeckApplied != null && Math.abs(neck.rotation.x - state.lastNeckApplied) < 0.0001
      ? neck.rotation.x - state.lastNeckOffset : neck.rotation.x;
    neck.rotation.x = base + offset;
    state.lastNeckOffset = offset;
    state.lastNeckApplied = neck.rotation.x;
  }

  function frame(context = {}) {
    if (!syncCharacter()) return;
    const now = Number.isFinite(context.timestamp) ? context.timestamp : performance.now();
    for (const entry of [...active]) poseFrame(entry, now);
    if (now - lastCheckMs < CHECK_INTERVAL_MS) return;
    lastCheckMs = now;
    const hour = nowGameHour();
    if (!Number.isFinite(hour)) return;
    const area = window.Combat?.deps?.getCurrentArea?.();
    const globalCombat = combatNow();
    for (const walker of window._npcWalkers || []) {
      if (!walker?.root || !walker.rec?.id || walker.animalDef) continue;
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
      if (state.active && (globalCombat || inCombat(walker, false) || rising || !walker.root.parent)) {
        finish(state.active, 'interrupted');
      }
      if (rising || state.active || !walker.root.parent || walker.area !== area) continue;
      if (inCombat(walker, globalCombat)) continue;
      if (window.CharacterActionLocks?.isLocked?.('npc:' + state.id, 'actions')) continue;
      if (state.wakePending) startYawn(walker, state, hour, 'waking');
      else if (hour >= state.restedUntil && hour >= state.nextHour) startYawn(walker, state, hour, 'hourly fatigue');
    }
    flush();
  }

  window.RuntimeFrameScheduler?.register?.('npc-yawn-rest', frame, {
    phase: 'pre-render', owner: 'NpcYawnRest',
    description: 'NPC rested timers, five-second yawns, pitch-preserving voice fallback and daily Koma drink',
  });
  window.addEventListener?.('beforeunload', flush);
  window.NpcYawnRest = Object.freeze({
    version: VERSION,
    movementMultiplier,
    debugSnapshot: () => ({
      version: VERSION, characterId: saveCharacterId,
      active: [...active].map(entry => ({ npcId: entry.state.id, elapsedS: (performance.now() - entry.startedAt) / 1000, koma: entry.komaStarted })),
      trackedRecords: Object.keys(saved).length, lastYawn, lastVoice, lastError,
      fileChecks: fileProbes.size, pendingSave: dirty,
    }),
    _test: Object.freeze({ frame, nowGameHour, stateFor, voiceFor, sourceIdentity, finish, combatNow }),
  });
})();
