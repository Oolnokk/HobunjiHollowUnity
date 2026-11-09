(() => {
  'use strict';

  const STATE_PREFIX = 'hobunjiOpeningStory.v1'; // Namespaces world-scoped opening progress so interrupted sessions can retry safely.
  const NPC_DB_URL = 'config/npcs/hobunji-starter-npc-database.json'; // Supplies the same authored NPC records the normal scheduler uses.
  const REQUIRED_NPCS = Object.freeze(['jubmir', 'father_hunundi_hodu', 'spearhead_unumanuk', 'khannibarri_agent']); // Guards the two scenes against silently falling back to placeholder actors.
  const OPENING_RUNTIME_TIMEOUT_MS = 120000; // Gives slow mobile cold boots four times the old runtime-start window before surfacing a retry instead of falling through into town.
  const STARTUP_RETRY_DELAYS_MS = Object.freeze([350, 900]); // Used only for rescue setup failures that occur before the wilderness is revealed.
  const FEY_VISIT_KEY = 'jubmir_great_fey'; // Shared doorstep queue/completion key for Jubmir's story visit.
  const FEY_VISIT_DELAY_HOURS = 12; // In-game hours after the farm tour before Jubmir can visit.
  const status = { // Mobile-readable state surfaced through debugSnapshot() and the existing in-game debug log.
    phase: 'idle',
    pending: false,
    running: false,
    completed: false,
    lastScene: null,
    lastError: null,
    runtimeWaitMs: 0,
    setupAttempts: 0,
    startupRetries: 0,
    latestChange: 'New-world startup now tolerates slow mobile runtime initialization, retries transient rescue setup failures before reveal, and blocks the normal town fallback with an on-screen Retry if the required opening still cannot load. Rescue locale remains the isolated generated Cloud Forest mini-wilderness; all prior cinematic, farm-tour, camera, seating, equipment and dialogue behavior is preserved.',
  };

  function stateKey(profile) {
    const worldId = String(profile?.worldId || 'unknown-world'); // Each new world gets its own opening regardless of the owning character's prior worlds.
    return STATE_PREFIX + ':' + worldId;
  }

  // World-scoped story progress travels in hobunjiSaveMeta through all normal
  // folder/cloud/quick-save snapshots. Legacy browser flags are import-only.
  const SAVE_META_KEY = 'hobunjiSaveMeta';
  let cachedWorldId = null;
  let cachedStory = null;

  function legacyValue(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function worldMeta(profile) {
    const id = String(profile?.worldId || '');
    try {
      const meta = JSON.parse(localStorage.getItem(SAVE_META_KEY) || 'null');
      return { meta, world: (meta?.worlds || []).find(w => String(w.id) === id) || null };
    } catch (_) { return { meta: null, world: null }; }
  }

  function storedStory(profile) {
    const id = String(profile?.worldId || '');
    if (!id) return null;
    if (cachedWorldId === id) return cachedStory; // No massive save JSON parse on repeated story checks.
    const { meta, world } = worldMeta(profile);
    if (!world) return null;
    if (world.openingStory && typeof world.openingStory === 'object') {
      cachedWorldId = id;
      cachedStory = { ...world.openingStory };
      return cachedStory;
    }
    const oldOpening = legacyValue(stateKey(profile));
    const oldCharacter = legacyValue(STATE_PREFIX + ':' + profile.characterId + ':' + id);
    const oldTour = legacyValue(stateKey(profile) + ':farm-tour') === 'complete';
    const oldFey = legacyValue(stateKey(profile) + ':jubmir-fey') === 'complete';
    const rawHours = legacyValue(stateKey(profile) + ':farm-tour:completed-hours');
    // Day-two+ worlds must already have finished the mandatory introduction,
    // including a world downloaded via DriveSync without its browser-only keys.
    const advanced = Math.max(Number(world.lastDay) || 1, Number(world.calendar?.day) || 1) > 1;
    const complete = oldOpening === 'complete' || oldCharacter === 'complete' || oldTour || advanced;
    const story = {
      opening: complete ? 'complete' : oldOpening === 'pending' ? 'pending' : '',
      farmTourComplete: oldTour || advanced,
      farmTourCompletedAtHours: rawHours != null && rawHours.trim() !== '' && Number.isFinite(Number(rawHours)) ? Number(rawHours) : null,
      jubmirFeyComplete: oldFey,
    };
    cachedWorldId = id;
    cachedStory = story;
    if (complete || oldOpening || oldFey) {
      world.openingStory = story;
      try { localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta)); }
      catch (error) { status.lastError = error?.message || String(error); }
    }
    return story;
  }

  function changeStory(profile, fields) {
    const id = String(profile?.worldId || '');
    const prior = storedStory(profile) || {};
    const { meta, world } = worldMeta(profile); // Always mutate the freshest full world record.
    if (world) {
      world.openingStory = { ...(world.openingStory || prior), ...fields };
      try {
        localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
        cachedWorldId = id;
        cachedStory = { ...world.openingStory };
        return true;
      } catch (error) { status.lastError = error?.message || String(error); }
    }
    // Compatibility with preview/test environments where no world save exists.
    cachedWorldId = id;
    cachedStory = { ...prior, ...fields };
    try {
      if (Object.prototype.hasOwnProperty.call(fields, 'opening')) localStorage.setItem(stateKey(profile), fields.opening || '');
      if (fields.farmTourComplete === true) localStorage.setItem(stateKey(profile) + ':farm-tour', 'complete');
      if (Number.isFinite(fields.farmTourCompletedAtHours)) localStorage.setItem(stateKey(profile) + ':farm-tour:completed-hours', String(fields.farmTourCompletedAtHours));
      if (fields.jubmirFeyComplete === true) localStorage.setItem(stateKey(profile) + ':jubmir-fey', 'complete');
    } catch (_) { /* The portable world save remains the authority. */ }
    return false;
  }

  function readProgress(profile) {
    const saved = storedStory(profile);
    if (saved) return saved.opening || '';
    const progress = legacyValue(stateKey(profile));
    if (progress) return progress;
    const legacyComplete = legacyValue(STATE_PREFIX + ':' + profile?.characterId + ':' + profile?.worldId) === 'complete';
    if (legacyComplete) {
      // Carry old per-character completion into the current world-scoped key
      // when a legacy session does not yet expose its portable world record.
      changeStory(profile, { opening: 'complete' });
      return 'complete';
    }
    return '';
  }

  function writeProgress(profile, value) {
    return changeStory(profile, { opening: String(value || '') });
  }

  function log(message, level = 'info') {
    window.__farmLog?.('[opening-story] ' + message, level);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms)); // Shared startup polling/retry delay keeps the slow-mobile path deterministic and testable.
  }

  function clearStartupFailure() {
    document.getElementById('openingStoryStartupFailure')?.remove(); // Removes the mobile-visible retry surface once a fresh attempt begins or succeeds.
  }

  function showStartupFailure(profile, message) {
    clearStartupFailure();
    const root = document.createElement('div'); // Full-screen failure surface prevents an unfinished opening from exposing the ordinary town spawn underneath.
    root.id = 'openingStoryStartupFailure';
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '1000000', display: 'grid', placeItems: 'center',
      background: '#000', color: '#fff', padding: '24px', textAlign: 'center', fontFamily: 'serif',
    });
    const panel = document.createElement('div'); // Compact panel stays readable on narrow mobile screens without relying on developer tools.
    panel.style.maxWidth = '34rem';
    const title = document.createElement('div'); // Human-readable heading explains that startup stopped intentionally rather than silently spawning in town.
    title.textContent = 'The opening scene could not finish loading.';
    title.style.fontSize = '1.15rem';
    title.style.marginBottom = '0.75rem';
    const detail = document.createElement('div'); // Technical detail is visible in-game so mobile reports can identify the failing startup stage.
    detail.textContent = String(message || 'Unknown opening-scene startup error.');
    detail.style.opacity = '0.72';
    detail.style.fontSize = '0.82rem';
    detail.style.marginBottom = '1rem';
    const retry = document.createElement('button'); // Retry starts the same required opening again after the failed runtime has completed its cleanup.
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.style.padding = '0.65rem 1.2rem';
    retry.style.font = 'inherit';
    retry.addEventListener('click', () => {
      retry.disabled = true;
      clearStartupFailure();
      showBootCover();
      setTimeout(() => { void play(profile); }, 0);
    });
    panel.append(title, detail, retry);
    root.append(panel);
    document.body?.appendChild(root);
  }

  function showBootCover() {
    const fadeEl = window.CutscenePreviewHelpers?.cutscenePreviewFadeEl?.(); // Reuses the cutscene fade surface so the farmhouse never flashes before the rescue opens.
    if (!fadeEl) return null;
    fadeEl.style.transitionDuration = '0s';
    fadeEl.style.opacity = '1';
    return fadeEl;
  }

  function clearBootCover() {
    const fadeEl = document.getElementById('cutscenePreviewFade'); // Releases the shared fade only for optional replay failures; required openings stay covered until retry/success.
    if (!fadeEl) return;
    fadeEl.style.transitionDuration = '0.35s';
    requestAnimationFrame(() => { fadeEl.style.opacity = '0'; });
  }

  async function waitForGameRuntime(timeoutMs = 30000) {
    const start = performance.now(); // Tracks how long startup spends waiting so slow-device reports are visible through debugSnapshot().
    while (true) {
      const elapsed = performance.now() - start; // Updated each poll and copied into status for the in-game mobile diagnostics.
      status.runtimeWaitMs = Math.max(0, Math.round(elapsed));
      if (window.__hobunjiGameStarted && window.AuthoredCutsceneRuntime?.run) return window.AuthoredCutsceneRuntime;
      if (timeoutMs > 0 && elapsed >= timeoutMs) throw new Error(`Timed out waiting ${Math.round(timeoutMs / 1000)}s for the authored cutscene runtime.`);
      await delay(100);
    }
  }

  async function loadNpcRecords() {
    const db = window.LocalDBOverrides // Honors the same locally-authored NPC database source as ordinary gameplay.
      ? await window.LocalDBOverrides.loadDatabase('npcDatabase')
      : await fetch(NPC_DB_URL).then(response => {
        if (!response.ok) throw new Error('NPC database HTTP ' + response.status);
        return response.json();
      });
    const records = new Map((db?.npcs || []).map(record => [record.id, record])); // Gives scene builders stable O(1) lookup by canonical NPC id.
    const missing = REQUIRED_NPCS.filter(id => !records.has(id)); // Prevents a story-critical speaker from degrading to a capsule placeholder.
    if (missing.length) throw new Error('Opening story is missing NPC records: ' + missing.join(', '));
    return records;
  }

  function npcActor(records, options) {
    const npcRecord = records.get(options.npcId); // Embeds the canonical authored record required by the cutscene walker's existing spawn path.
    return { ...options, npcRecord };
  }

  function buildRescueScene(records, profile) {
    const playerName = String(profile?.nickname || 'Farmer'); // Names the player stand-in in dialogue without depending on unresolved template tokens.
    const actors = [ // Reuses the Director's existing Gar-wolf Rescue cast and blocking.
      { id: 'player', name: playerName, isPlayer: true, team: 'player', lc: 11, lr: 8, rotation: 270, pose: 'prone', lantern: true }, // Lantern flags light the player and the two rescuers via CutsceneLanternCarriers.
      { id: 'wolf1', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lookAtActorId: 'player', lc: 9, lr: 9, rotation: 45, pose: 'standing' },
      { id: 'wolf2', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lookAtActorId: 'player', lc: 13, lr: 9, rotation: 270, pose: 'standing' },
      { id: 'wolf3', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lookAtActorId: 'player', lc: 11, lr: 6, rotation: 90, pose: 'standing' },
      npcActor(records, { id: 'jubmir', name: 'Jubmir', npcId: 'jubmir', lookAtActorId: 'player', lc: 11, lr: 15, rotation: 0, pose: 'standing', lantern: true }),
      npcActor(records, { id: 'spearhead', name: 'Spearhead', npcId: 'spearhead_unumanuk', visible: false, lc: 16, lr: 0, rotation: 180, pose: 'standing', lantern: true }),
      { id: 'hound1', name: 'Dabinggi-hound', creatureTypeId: 'dabinggi-hound', team: 'dabinggi_hounds', lookAtActorId: 'player', lc: 9, lr: 15, rotation: 0, pose: 'standing' },
      { id: 'hound2', name: 'Dabinggi-hound', creatureTypeId: 'dabinggi-hound', team: 'dabinggi_hounds', lookAtActorId: 'player', lc: 13, lr: 15, rotation: 0, pose: 'standing' },
    ];
    const stages = [ // Stable ids make the choice branches inspectable and regression-testable.
      { id: 'rescue_fade_in', type: 'fade', direction: 'in', duration: 0.8, next: '__next__' },
      { id: 'rescue_wolf1_growl', type: 'talk', speakerId: 'wolf1', text: 'Grrrr!', next: '__next__' },
      { id: 'rescue_wolf2_growl', type: 'talk', speakerId: 'wolf2', text: 'Hrrrr!!!', next: '__next__' },
      { id: 'rescue_wolf3_growl', type: 'talk', speakerId: 'wolf3', text: 'Hreeeeech!!!', next: '__next__' },
      { id: 'rescue_hound1_run', type: 'move', actorId: 'hound1', targetLocal: { lc: 9, lr: 11 }, speed: 'fast', waitForArrival: false, next: '__next__' },
      { id: 'rescue_hound2_run', type: 'move', actorId: 'hound2', targetLocal: { lc: 13, lr: 11 }, speed: 'fast', next: '__next__' },
      { id: 'rescue_combat', type: 'combat', cameraMode: 'establishing', duration: 3, participants: [
        { actorId: 'wolf1', combatOn: true, canLose: false },
        { actorId: 'wolf2', combatOn: true, canLose: false },
        { actorId: 'wolf3', combatOn: true, canLose: false },
        { actorId: 'hound1', combatOn: true, canLose: false },
        { actorId: 'hound2', combatOn: true, canLose: false },
      ], next: '__next__', lossNext: '__end__' },
      { id: 'rescue_hound1_settle', type: 'move', actorId: 'hound1', targetLocal: { lc: 9, lr: 9 }, speed: 'normal', waitForArrival: false, next: '__next__' },
      { id: 'rescue_hound2_settle', type: 'move', actorId: 'hound2', targetLocal: { lc: 13, lr: 9 }, speed: 'normal', waitForArrival: false, next: '__next__' },
      { id: 'rescue_wolf1_flee', type: 'move', actorId: 'wolf1', targetLocal: { lc: 23, lr: 2 }, speed: 'fast', waitForArrival: false, next: '__next__' },
      { id: 'rescue_wolf2_flee', type: 'move', actorId: 'wolf2', targetLocal: { lc: 23, lr: 4 }, speed: 'fast', waitForArrival: false, next: '__next__' },
      { id: 'rescue_wolf3_flee', type: 'move', actorId: 'wolf3', targetLocal: { lc: 23, lr: 6 }, speed: 'fast', next: '__next__' },
      { id: 'rescue_jubmir_enter', type: 'move', actorId: 'jubmir', targetLocal: { lc: 10, lr: 7 }, speed: 'fast', next: '__next__' },
      { id: 'rescue_jubmir_face', type: 'turn', actorId: 'jubmir', mode: 'actor', targetActorId: 'player', duration: 0.3, next: '__next__' },
      { id: 'rescue_jubmir_question', type: 'talk', speakerId: 'jubmir', text: 'Are you alright? Are you hurt?', next: '__next__' },
      { id: 'rescue_player_choice', type: 'choice', speakerId: 'player', text: 'How do you answer?', options: [
        { text: "I'm fine.", next: 'rescue_fine_reply' },
        { text: 'Who in the void are you?', next: 'rescue_who_reply' },
      ] },
      { id: 'rescue_fine_reply', type: 'talk', speakerId: 'jubmir', text: 'Well, your wounds say otherwise.', next: 'rescue_healer_line' },
      { id: 'rescue_who_reply', type: 'talk', speakerId: 'jubmir', text: "My name's Jubmir. I'm a trader — but my primary interest right now is making sure you don't bleed out and die.", next: 'rescue_healer_line' },
      { id: 'rescue_healer_line', type: 'talk', speakerId: 'jubmir', text: 'We need to get you to a healer. Can you walk?', next: '__next__' },
      { id: 'rescue_slow_stand', type: 'animation', actorId: 'player', animKind: 'none', resultPose: 'standing', duration: 1.5, next: '__next__' },
      { id: 'rescue_player_step', type: 'move', actorId: 'player', targetLocal: { lc: 11, lr: 7 }, speed: 'slow', next: '__next__' },
      { id: 'rescue_collapse', type: 'animation', actorId: 'player', animKind: 'none', resultPose: 'prone', duration: 1, next: '__next__' },
      { id: 'rescue_oh_dear', type: 'talk', speakerId: 'jubmir', text: 'Oh dear.', next: '__next__' },
      { id: 'rescue_spearhead_enter', type: 'move', actorId: 'spearhead', visible: true, spawnOutsideView: true, targetLocal: { lc: 16, lr: 4 }, speed: 'fast', next: '__next__' },
      { id: 'rescue_spearhead_line', type: 'talk', speakerId: 'spearhead', text: "What's all this then?", next: '__next__' },
      { id: 'rescue_jubmir_turn', type: 'turn', actorId: 'jubmir', mode: 'actor', targetActorId: 'spearhead', duration: 0.45, next: '__next__' },
      { id: 'rescue_jubmir_request', type: 'talk', speakerId: 'jubmir', addressedActorId: 'spearhead', text: "Spearhead — you can't imagine how glad I am to see you. Help me bring this stranger into town.", next: '__next__' },
      { id: 'rescue_spearhead_rush', type: 'move', actorId: 'spearhead', targetLocal: { lc: 12, lr: 8 }, speed: 'fast', next: '__next__' },
      { id: 'rescue_fade_out', type: 'fade', direction: 'out', duration: 1.2, next: '__end__' },
    ];
    for (const actor of actors) { actor.lc -= 8; actor.lr += 1; }
    for (const stage of stages) if (stage.targetLocal) { stage.targetLocal.lc -= 8; stage.targetLocal.lr += 1; }
    return {
      version: 6,
      title: 'Rescue',
      mapId: 'map_opening_cloud_forest',
      miniWilderness: { sourceZoneId: 'map_southern_cloud_forest', chunksPerSide: 4 }, // Same generated mini-map path as the Wilderness Chunk Lab, using the Cloud Forest biome.
      localeId: 'locale_opening_rescue',
      wilderness: true,
      footprint: { originC: 0, originR: 0, w: 17, h: 18 },
      creatureDialogueDistanceMultiplier: 0.9, creatureDialogueFovDeg: 48, randomCreatureDialogueAngles: true,
      cameraTargetActorId: 'player', widePlayerShots: true, // Establishing and player-choice shots stay centered on the injured character.
      camera3d: { fovDeg: 52, localPos: { x: 3.5, y: 4, z: 16.5 }, localTarget: { x: 3.5, y: 0.3, z: 9.5 } },
      actors,
      stages,
    };
  }

  function seatTarget(c, r, rotY) {
    const furnitureId = ({ '11,8': 'f_tbhunundi_chair', '9,9': 'fmtst9ykgmqf0', '8,9': 'fmtsteb7xjq80', '7,9': 'f_tbhunundi_guest_chair_west', '9,6': 'f_tbhunundi_guest_chair_near' })[`${c},${r}`]; // Stable map instance binding keeps seated actors attached to animated furniture.
    return { pose: 'sit', furnitureKey: 'chairSimple', furnitureId, c, r, rotY, seatIndex: 0 }; // Mirrors the normal NPC schedule seat-target shape consumed by npcSeatTransformForTarget().
  }

  function buildHunundiMeetingScene(records, profile) {
    const playerName = String(profile?.nickname || 'Farmer'); // Keeps the player actor label consistent with the newly-created character.
    const actors = [ // Every participant is a real authored NPC/player avatar; no custom placeholder people are used.
      { id: 'player', name: playerName, isPlayer: true, worldC: 8, worldR: 9, rotation: 0, pose: 'sit', seatTarget: seatTarget(8, 9, 180) },
      npcActor(records, { id: 'hunundi', name: 'Father Hunundi', npcId: 'father_hunundi_hodu', worldC: 11, worldR: 8, rotation: 180, pose: 'sit', seatTarget: seatTarget(11, 8, 0) }),
      npcActor(records, { id: 'jubmir', name: 'Jubmir', npcId: 'jubmir', worldC: 7, worldR: 9, rotation: 0, pose: 'sit', seatTarget: seatTarget(7, 9, 180) }),
      npcActor(records, { id: 'spearhead', name: 'Spearhead', npcId: 'spearhead_unumanuk', worldC: 9, worldR: 9, rotation: 0, pose: 'sit', seatTarget: seatTarget(9, 9, 180) }),
      npcActor(records, { id: 'harkharash', name: 'Surveyor Harkhanash', npcId: 'khannibarri_agent', visible: false, worldC: 11, worldR: 5, rotation: 0, pose: 'standing', seatTarget: seatTarget(9, 6, 0) }),
    ];
    const stages = [ // The dialogue establishes amnesia, Nanjiri Farmstead, the Company's offer, regional isolation, and Spearhead's resolve in one room.
      { id: 'meeting_fade_in', type: 'fade', direction: 'in', duration: 0.8, next: '__next__' },
      { id: 'meeting_hunundi_where', type: 'talk', speakerId: 'hunundi', text: 'Easy now. Jubmir tells me you remember your name. Do you remember where you came from?', next: '__next__' },
      { id: 'meeting_player_where', type: 'choice', speakerId: 'player', text: 'You search your memory.', options: [
        { text: "I don't know.", next: 'meeting_spearhead_family' },
        { text: "Nothing before the forest.", next: 'meeting_spearhead_family' },
      ] },
      { id: 'meeting_spearhead_family', type: 'talk', speakerId: 'spearhead', text: 'Family? A village? A trade? Anything we can use to work backward?', next: '__next__' },
      { id: 'meeting_player_nothing', type: 'choice', speakerId: 'player', text: 'Can you recall anything?', options: [{ text: 'Only my name.', next: '__next__' }, { text: 'Nothing else.', next: '__next__' }] },
      { id: 'meeting_jubmir_belongings', type: 'talk', speakerId: 'jubmir', text: "You weren't carrying anything that told us much, either. Nothing with a name, a crest, or a place on it.", next: '__next__' },
      { id: 'meeting_hunundi_kind', type: 'talk', speakerId: 'hunundi', text: "Then we won't force an answer your mind isn't ready to give. What you need first is somewhere safe to recover.", next: '__next__' },
      { id: 'meeting_hunundi_farm', type: 'talk', speakerId: 'hunundi', text: "Nanjiri Farmstead is abandoned, but the house still stands and the land is good. You could live there.", next: '__next__' },
      { id: 'meeting_player_farm', type: 'choice', speakerId: 'player', text: 'How do you answer?', options: [
        { text: 'You would let a stranger have a farm?', next: 'meeting_hunundi_answer' },
        { text: "I don't know how to repay you.", next: 'meeting_hunundi_answer' },
      ] },
      { id: 'meeting_hunundi_answer', type: 'talk', speakerId: 'hunundi', text: "By getting well. We can worry about the rest after you've had a roof over your head for a few nights.", next: '__next__' },
      { id: 'meeting_knock', type: 'caption', speakerName: '', text: 'Knock. Knock.', next: '__next__' },
      { id: 'meeting_hunundi_rise', type: 'animation', actorId: 'hunundi', animKind: 'none', resultPose: 'standing', duration: 0.35, next: '__next__' },
      { id: 'meeting_hunundi_face_door', type: 'turn', actorId: 'hunundi', mode: 'actor', targetActorId: 'harkharash', duration: 0.4, next: '__next__' },
      { id: 'meeting_hunundi_door', type: 'talk', speakerId: 'hunundi', text: 'Hm? Come in.', next: '__next__' },
      { id: 'meeting_hark_enter', type: 'animation', animKind: 'none', resultPose: 'standing', duration: 0.35, visible: true, cameraMode: 'npcRelative', actorId: 'harkharash', next: '__next__' },
      { id: 'meeting_hark_intro', type: 'talk', speakerId: 'harkharash', text: "Surveyor Harkhanash, the Imperial Khannibarri Mining Company. I'm looking for Father Hunundi — the nearest thing to a leader here, I'm told.", next: '__next__' },
      { id: 'meeting_hunundi_no_leader', type: 'talk', speakerId: 'hunundi', text: "I'm Father Hunundi. I help settle disputes; the Hollow isn't mine. Have a seat.", next: '__next__' },
      { id: 'meeting_hark_to_seat', type: 'move', actorId: 'harkharash', targetWorld: { c: 9, r: 6 }, speed: 'normal', next: '__next__' },
      { id: 'meeting_hark_sit', type: 'animation', cameraMode: 'wall', actorId: 'harkharash', animKind: 'none', resultPose: 'sit', duration: 0.35, next: '__next__' },
      { id: 'meeting_hunundi_reseat', type: 'animation', actorId: 'hunundi', animKind: 'none', resultPose: 'sit', duration: 0.4, next: '__next__' },
      { id: 'meeting_hark_offer', type: 'talk', speakerId: 'harkharash', text: 'Our surveys found substantial ore beneath this valley. The Company would like to buy the settlement and the surrounding claims to extract it.', next: '__next__' },
      { id: 'meeting_hunundi_people', type: 'talk', speakerId: 'hunundi', text: "That is up to the townsfolk. Their families have lived here for generations. They won't give it up lightly.", next: '__next__' },
      { id: 'meeting_hark_practical', type: 'talk', speakerId: 'harkharash', text: 'With respect, Father, I was hoping the nearest thing to a leader might also be the nearest thing to a practical man.', next: '__next__' },
      { id: 'meeting_hark_trade', type: 'talk', speakerId: 'harkharash', text: "Fewer Slagothim traders come each year. They talk of a ghost army in the mountains. There's no reasoning peasants and Slagothim out of superstition.", next: '__next__' },
      { id: 'meeting_hark_bandits', type: 'talk', speakerId: 'harkharash', text: "And even if one indulges the ghosts, the bandit clans are real enough. So is the barbarian war. Every road to this place becomes less attractive by the season.", next: '__next__' },
      { id: 'meeting_hark_leverage', type: 'talk', speakerId: 'harkharash', text: 'The Company can give every villager a cut of the sale. Enough to move out of the mountains and start living in the 12th century with the rest of the continent.', next: '__next__' },
      { id: 'meeting_spearhead_stand', type: 'animation', actorId: 'spearhead', animKind: 'none', resultPose: 'standing', duration: 0.25, next: '__next__' },
      { id: 'meeting_spearhead_step', type: 'move', actorId: 'spearhead', targetWorld: { c: 8, r: 8 }, speed: 'fast', next: '__next__' },
      { id: 'meeting_spearhead_turn', type: 'turn', actorId: 'spearhead', mode: 'actor', targetActorId: 'harkharash', duration: 0.25, next: '__next__' },
      { id: 'meeting_spearhead_anger', type: 'talk', speakerId: 'spearhead', text: 'You walk into our home and call us backward?', next: '__next__' },
      { id: 'meeting_hunundi_spearhead', type: 'talk', speakerId: 'hunundi', text: 'Spearhead.', next: '__next__' },
      { id: 'meeting_hunundi_invite', type: 'talk', speakerId: 'hunundi', text: "Surveyor, if you truly think you can convince everyone, you're welcome to stay in town and try. You can make your offer to the people whose homes you mean to buy.", next: '__next__' },
      { id: 'meeting_hark_agrees', type: 'talk', speakerId: 'harkharash', text: "Very well. That's all I wanted — a fair hearing. I'll make my arrangements in town.", next: '__next__' },
      { id: 'meeting_hark_stand', type: 'animation', actorId: 'harkharash', animKind: 'none', resultPose: 'standing', duration: 0.25, next: '__next__' },
      { id: 'meeting_hark_leave', type: 'move', actorId: 'harkharash', targetWorld: { c: 11, r: 5 }, speed: 'normal', next: '__next__' },
      { id: 'meeting_hark_hide', type: 'animation', actorId: 'harkharash', visible: false, animKind: 'none', resultPose: 'unchanged', duration: 0, next: '__next__' },
      { id: 'meeting_spearhead_home', type: 'talk', speakerId: 'spearhead', text: "I lost my first home to a dragon. I'm sure as stone not losing this one to those bronze-hungry monsters.", next: '__next__' },
      { id: 'meeting_hunundi_resume', type: 'talk', speakerId: 'hunundi', text: 'Well. As I was saying.', next: '__next__' },
      { id: 'meeting_hunundi_final', type: 'talk', speakerId: 'hunundi', text: "The Nanjiri Farmstead is yours to use. Rest first. Tomorrow, we'll see what sort of life you want to make of it.", next: '__next__' },
      { id: 'meeting_fade_out', type: 'fade', direction: 'out', duration: 0.8, next: '__end__' },
    ];
    for (const stage of stages) if (stage.speakerId) stage.addressedActorId = stage.speakerId === 'harkharash' ? 'hunundi' : (stage.id === 'meeting_hunundi_no_leader' || stage.id === 'meeting_hunundi_people' || stage.id === 'meeting_hunundi_invite' ? 'harkharash' : 'player');
    for (const stage of stages) { if (stage.speakerId === 'hunundi' && stage.addressedActorId === 'harkharash') Object.assign(stage, { cameraMode: 'pov', actorId: 'hunundi', targetActorId: 'harkharash', fovDeg: 55, povBack: 0.4, povSide: -0.25, povHeight: 0.1 }); else if (stage.speakerId === 'harkharash') Object.assign(stage, { cameraMode: 'npcRelative', actorId: 'harkharash', cameraDistanceMultiplier: 0.7 }); else if (stage.type === 'talk' && stage.id !== 'meeting_hark_intro' && stage.id !== 'meeting_hunundi_door') stage.cameraMode = 'wall'; } // Hunundi directly addresses the surveyor from his own eye-level view.
    return {
      version: 6,
      title: "Father Hunundi's Room",
      mapId: 'map_i_temple_basement_hunundi',
      furnitureTransforms: [{ furnitureId: 'f_tbhunundi_chair', transform: { rotationDeg: { y: -90 } } }],
      cinematicCameraId: 'hunundi_office_wall',
      actors,
      stages,
    };
  }

  function tourKey(profile) {
    return stateKey(profile) + ':farm-tour'; // Farm introduction and exit permissions belong to the same world as the rescue.
  }

  function tourComplete(profile) {
    const saved = storedStory(profile);
    // Portable data wins when it explicitly records a decision. A partial
    // in-memory fallback in older worlds must not hide a completed legacy tour.
    if (saved?.farmTourComplete != null) return saved.farmTourComplete === true;
    return legacyValue(tourKey(profile)) === 'complete';
  }

  function gameHours() {
    const calendar = window.CalendarSystem; // Reads the authoritative clock, including sleep, wait and day rollover.
    if (!calendar?.isInitialized?.()) return null;
    const now = calendar.previewAfterHours(0); // Zero-hour preview exposes the live raw day without mutating time.
    const hours = (now.day - 1) * 24 + calendar.getHour(now.time01); // Absolute hours keep the visit delay valid across midnight and reloads.
    return Number.isFinite(hours) ? hours : null;
  }

  function rememberFarmTourTime(profile) {
    const hours = gameHours(); // Recorded at the final farm-tour Continue, rather than when the tour starts.
    if (hours === null) return;
    if (Number.isFinite(storedStory(profile)?.farmTourCompletedAtHours)) return;
    // In a legacy/no-portable-world session, preserve the stored completion
    // time rather than restarting Jubmir's 12-hour countdown after a reload.
    const legacyRaw = legacyValue(tourKey(profile) + ':completed-hours');
    if (legacyRaw != null && legacyRaw.trim() !== '' && Number.isFinite(Number(legacyRaw))) return;
    changeStory(profile, { farmTourCompletedAtHours: hours }); // Portable world-scoped farm-tour timestamp.
  }

  function feyVisitState(profile = window.__hobunjiPlayerProfile) {
    const now = gameHours(); // Used for eligibility and mobile diagnostics, never wall-clock time.
    const saved = storedStory(profile);
    const raw = saved?.farmTourCompletedAtHours !== undefined
      ? saved.farmTourCompletedAtHours : legacyValue(tourKey(profile) + ':completed-hours');
    const completedAt = raw === null || raw === '' || raw === undefined ? NaN : Number(raw);
    return {
      completed: saved ? saved.jubmirFeyComplete === true : legacyValue(stateKey(profile) + ':jubmir-fey') === 'complete',
      completedAtHours: Number.isFinite(saved?.jubmirFeyCompletedAtHours) ? saved.jubmirFeyCompletedAtHours : null,
      farmTourCompletedAtHours: Number.isFinite(completedAt) ? completedAt : null,
      hoursUntilVisit: now !== null && Number.isFinite(completedAt) ? Math.max(0, completedAt + FEY_VISIT_DELAY_HOURS - now) : null,
      latestChange: 'Six inn rooms; Jubmir visits 12 game hours after the farm tour and discusses trade and the Great Fey in his room.',
    };
  }

  function nextFeyVisit() {
    const profile = window.__hobunjiPlayerProfile; // Only the world's story owner receives this one-time continuation.
    if (profile?.isWorldOwner !== true || !tourComplete(profile) || status.running) return null;
    rememberFarmTourTime(profile); // Legacy completed tours begin their missing timer on first observation.
    const state = feyVisitState(profile); // The same state is exposed by debugSnapshot().
    if (state.completed || state.hoursUntilVisit === null || state.hoursUntilVisit > 0) return null;
    return {
      key: FEY_VISIT_KEY, npcId: 'jubmir',
      tree: {
        id: 'doorstep_jubmir_great_fey', label: 'Doorstep — Jubmir’s Invitation', entryNode: 'invitation',
        nodes: [{ id: 'invitation', type: 'text', text: "Good {{timeOfDay}}, {{playerHonorific}}. There is something I would like to discuss with you about the village. Come with me to my room at the inn, where we can speak privately.", next: null }],
      },
    };
  }

  function buildJubmirFeyScene(records, profile) {
    const openingLines = [ // Authored speech before the player's optional question.
      "The issues that Surveyor Harkhanash spoke of are very much real. I am the only trader who has made the trek to Hobunji Hollow in nearly six months, and I only come here because I love these people.",
      "I don't tell them, but much of what I make trading elsewhere is simply lost here, because I sell them goods for less than they're worth. Their economy is not doing well, and I can only carry so much. Even though I'm sure most of them are reluctant to sell, I can't help but feel that Surveyor Harkhanash will eventually win them over.",
      "I've seen a lot in my travels, and the Imperial Khanibarri Mining Company are not the harmless benefactors the Surveyor makes them out to seem.",
      "They shatter mountains, level forests, and I assure you that none of the villagers will be leaving the mountains to make new lives. Their contracts are always littered with hidden snares.",
      "They will be working the very mine their homes were destroyed to build, with growing debts they can never repay. They'll be slaves.",
      "The only way to save Hobunji Hollow is to make it worth the journey for my people to come and trade, and luckily there are many ways to do that, but I think I'd serve you best by explaining that issue which the Surveyor so easily dismissed as mere superstition: the Harlyao Ghost Army. And I can do you even better by suggesting a solution.",
      "You see, Hobunji Hollow sits at a crossroads between four distinct regions of the Harugasirri, all equally unpopulated, dangerous, but ripe with nature's resources.",
      "Each one has an ancient guardian, a Great Fey. There was a time, not so long ago, when the people of this village revered them and made constant offerings in their name. But now, few still believe they even exist, and no such offerings are made.",
      "But until so recently, we Slagothim would travel out there to trade with the barbarians. We know the wilds that surround this place far better than the villagers, and the barbarians even more so. The Great Fey are as real as the stones and the trees.",
      "We don't know what awoke the ghost army from their long slumber, but if anyone does, it may very well be those ancient enough to have seen its soldiers as they were in life.",
      "And if anyone can help, I am almost certain that the Great Fey are among them.",
      "You're likely wondering why I'm coming to you, a complete stranger, for help. And honestly I am too. I can't explain it, but I have a sense that you're the one who can make a difference, that you're the missing piece of the puzzle.",
      "But will you help me? Will you seek them out? Figure out if they can help?",
    ];
    const guidanceLines = [ // Shared continuation preserves all four leads and the broader trade goal on either choice path.
      "And there is another thing that makes it even more speculative, and it's a warning that I owe you: the Fey are fickle and tricky beings.",
      "They are nonsensical as much in form as they are in action and motivation. But if you play along, there is a good chance that they may be able to help us.",
      "Should you look to the Northern Cliffs you may find Banubu the Sleeping Grehlr. Listen for snoring in the night during your travels if you wish to find his cave. He is benevolent, kind and well loved by the Porakaneki and Omgurku alike, though he is at times unreliable.",
      "Should you look to the Western Slope, know that within its farthest, deepest snowbanks sleeps Old Man Nohuknuk. He has lived there since before the Unumanuk clan arrived in town, and yet they seem to know him well, even better than the locals, it seems.",
      "Presumably his domain must extend high into those mountains that they once called home.",
      "Sightings of him have always been rarer than the others, and he is said to ignore those who call to him. He has always been a strange, quiet neighbor to the people of Hobunji Hollow. But if the stories Eldress Teacup tells of him are true, perhaps they know how to get him to speak.",
      "Should you look to the south you may find Hiki-hiki, the trickster. He is said to take the form of a Drenkirra, wearing a hat. He is fond of riddles, and may be eager to share them with any who would listen.",
      "I suspect that if you were to wager his aid as a reward for solving them, he is the most likely among the four to help us. Assuming you are able to solve them, that is.",
      "Better yet, he is infamously clever. If it's in any way possible to divert the ghost army out of the region, he would know how.",
      "Should you look to the Eastern Mire, do be wary. It is a place of impenetrable fog, disorienting illusions, and, should you believe the tales told by the Omgurku and Porakaneki, it is a hive of evil fey entities known as the Ikthi, who wait beneath the water, preying upon lost travelers and those who fish in the deepest fog.",
      "Those pierced with their wicked blades do not bleed out and die, though their fate is arguably worse. They are instead sent into a deep slumber, and when they awake, they are filled with a pain like no other. One said to be torturous not only to the flesh, but to the spirit.",
      "The only way to cure this ailment is to make an offering to the one who commands them. The one who I would ask you to seek out for aid with our current dilemma, should you choose to take such a risk. The Great Fey of the Eastern Mire, Mother Rahayobi.",
      "She is one of a scarce but widespread variety of fey known as a Hag. Few understand their nature, but they are known to be wicked, cruel and, unlike many types of fey both good and evil, deadly.",
      "And yet, should you somehow garner the favor of Mother Rahayobi, she may be able to offer more than simply warding off the ghost army. From the stories I've heard, she is not so simple and one-dimensional as the other Great Fey, and as such is not nearly as predictable. Such a trait poses a challenge, yet opens the possibilities of what aid she may be able to offer us.",
      "Whether you choose to seek out the Great Fey is up to you, but I thought it would be best to give you my two suns on the issue.",
      "The patrol of the Ghost Army is predictable and avoidable by traders and travelers, but with what little Hobunji Hollow has to offer, it is enough to dissuade my fellow traders from making the trek into the highlands.",
      "Garnering the aid of any one of the Great Fey would open a safe path into the village, but without the army diverted out of the region entirely, trade with the nearby barbarians will remain difficult, which can at times turn out more profitable than trade with Hobunji Hollow itself.",
      "And that of course still comes with its own dangers following the recent breakout of war between them.",
      "However you choose to help, our goal is to bring trade back to the village. With trade comes prosperity and wellbeing, and with it, the Surveyor's offer will become less and less tempting.",
      "If things go well, a time will come when the Imperial Khanibarri Mining Company loses hope and turns its eyes elsewhere. The more profit it offers to the Slagothim that the village stands, the sooner the Company will realize that they're losing money paying Surveyor Harkhanash to chase a lost cause.",
      "My point in saying this is that there is more than one way to skin a turg-rat. Finding ways to make the journey to Hobunji Hollow more worthwhile would be just as helpful as removing the obstacles that make it difficult.",
      "Father Hunundi has been asking around the village for ideas on how to do that. I would seek him out when you have time.",
    ];
    const talk = (id, text) => ({ // Every spoken paragraph resets the shared two-person orbit, including whichever optional answer the player hears.
      id, type: 'talk', speakerId: 'jubmir', addressedActorId: 'player', text, next: '__next__',
      cameraMode: 'orbit', orbitActorIds: ['player', 'jubmir'], orbitAlternateFocus: true,
      orbitInitialZoomPercent: 131.25, orbitZoomStepPercent: 5, // First paragraph is exactly 20% closer in boom distance than the former 105% zoom shot.
      orbitHeightMode: 'oppositeFaceArc', // Tilt endpoints to the player's/Jubmir's real face heights, and look toward the antipodal point.
      orbitDistanceTiles: 1.85, orbitSpeedDegPerSec: 6, orbitBlendSeconds: 1, // Keep the former smooth reset available in the Director.
      orbitInstantCut: true, // Jubmir's paragraphs hard-cut between camera positions rather than blending.
      horizontalCameraCollision: true, // Only this inn-room conversation opts into the wall/furniture horizontal sweep.
      orbitDirection: 'clockwise', orbitDirectionSwitchEvery: 2, orbitDirectionalStartOffsetDeg: 30, // Jubmir CW, player CW, Jubmir CCW, player CCW; repeat.
    });
    return {
      version: 6, title: 'Jubmir — The Great Fey', mapId: 'map_i_inn_F2_jubmir', // Dialogue partners occupy adjacent, furniture-free floor tiles.
      actors: [
        { id: 'player', name: profile?.nickname || 'Farmer', isPlayer: true, worldC: 9, worldR: 8, rotation: 90, pose: 'standing' },
        npcActor(records, { id: 'jubmir', name: 'Jubmir', npcId: 'jubmir', worldC: 10, worldR: 8, rotation: 270, pose: 'standing' }),
      ],
      stages: [
        { id: 'fey_fade_in', type: 'fade', direction: 'in', duration: 0.6, next: '__next__' },
        ...openingLines.map((text, index) => talk('fey_intro_' + index, text)),
        { id: 'fey_question', type: 'choice', speakerId: 'player', addressedActorId: 'jubmir', text: 'How do you answer?', options: [
          { text: "Why can't you do it?", next: 'fey_why' },
          { text: "I'll see what I can do.", next: 'fey_guidance_0' },
        ] },
        { ...talk('fey_why', "I can't afford the time. As I said, I am the village's only connection to the outside world. What I've told you is mere speculation on my part, and I must be in nigh-constant movement, helping in the only way that I know helps for certain."), next: 'fey_guidance_0' },
        ...guidanceLines.map((text, index) => talk(index === guidanceLines.length - 1 ? 'fey_final' : 'fey_guidance_' + index, text)),
        { id: 'fey_fade_out', type: 'fade', direction: 'out', duration: 0.6, next: '__end__' },
      ],
    };
  }

  async function playJubmirFeyVisit(profile = window.__hobunjiPlayerProfile) {
    if (status.running || !nextFeyVisit()) return false;
    status.running = true;
    status.phase = 'jubmir-fey';
    status.lastError = null;
    try {
      const runtime = await waitForGameRuntime(); // Shared runner owns map travel, actor cloning, input lock and return to the farm.
      const records = await loadNpcRecords(); // Uses Jubmir's current authored appearance rather than a placeholder.
      let finalContinued = false; // Leaving/skipping an unfinished scene must keep the visit available.
      await runtime.run(buildJubmirFeyScene(records, profile), {
        onDialogueContinue(stage) { if (stage.id === 'fey_final') finalContinued = true; },
      });
      if (!finalContinued) { status.phase = 'jubmir-fey-interrupted'; return false; }
      changeStory(profile, { jubmirFeyComplete: true, jubmirFeyCompletedAtHours: gameHours() }); // Used by Garanki's following-day Guild invitation.
      window.DoorstepVisits?.markDone(FEY_VISIT_KEY);
      window.DoorstepVisits?.dismissVisit(FEY_VISIT_KEY);
      status.phase = 'jubmir-fey-complete';
      log('Jubmir’s Great Fey conversation complete');
      return true;
    } catch (error) {
      status.lastError = error?.message || String(error);
      status.phase = 'jubmir-fey-error';
      log('Jubmir conversation failed; visit remains available: ' + status.lastError, 'error');
      return false;
    } finally { status.running = false; }
  }

  // Story appointments take precedence over Jubmir's recurring trading days.
  window.NpcScheduling?.registerTargetOverride(FEY_VISIT_KEY, (rec, context) => {
    if (rec?.id !== 'jubmir') return null;
    const profile = window.__hobunjiPlayerProfile; // Scope the appointment to the story owner's world.
    if (profile?.isWorldOwner !== true || !tourComplete(profile)) return null;
    const state = feyVisitState(profile); // Keep him present during playback too, until successful completion.
    if (state.completed || state.hoursUntilVisit !== 0) return null;
    const entrance = rec.visitorPresence?.entrance; // Reuse the authored arrival location and existing async spawn guard.
    if (!entrance || !Number.isFinite(entrance.c) || !Number.isFinite(entrance.r)) return null;
    if (context.hasExistingWalker) {
      const room = window.NpcScheduling.resolveNpcStationTarget('station_inn_jubmir_bed'); // Wait in his authored room when its station is loaded.
      if (room) return room;
    }
    return { area: entrance.mapId || entrance.area, c: entrance.c, r: entrance.r,
      label: entrance.label, activity: 'Jubmir story appointment', visitorArrival: !context.hasExistingWalker };
  });

  window.DoorstepVisits?.registerProvider({
    id: FEY_VISIT_KEY, priority: 80,
    sync() {
      const profile = window.__hobunjiPlayerProfile; // Starts the migration timer even if a legacy player is already outside.
      if (profile?.isWorldOwner === true && tourComplete(profile)) rememberFarmTourTime(profile);
    },
    next: nextFeyVisit,
    onComplete() {
      void playJubmirFeyVisit(); // Async scene completion, rather than the invitation alone, commits and dismisses the visit.
      return false;
    },
  });

  function needsTempleArrival(profile) {
    return profile?.isWorldOwner === true && !tourComplete(profile);
  }

  function canEnterWilderness(profile = window.__hobunjiPlayerProfile) {
    return profile?.isWorldOwner !== true || tourComplete(profile);
  }

  function buildFarmTourScene(records, profile, points) {
    const entry = points.entry; // Current farm arrival tile; the real player remains parked here during the authored tour.
    const porch = points.porch; // Shared farmhouse door resolver supplies the final stop instead of a hardcoded house coordinate.
    return {
      version: 6, title: 'Nanjiri Farmstead', mapId: 'farm',
      cinematicCameraFromStageId: 'farm_choice', // Continuing Spearhead's opening line begins the south-side camera lerp.
      cinematicCamera: points.camera, // Keeps the shared south-to-north wide shot through choices and the walk to the farmhouse.
      actors: [
        { id: 'player', name: profile?.nickname || 'Farmer', isPlayer: true, worldC: entry.c, worldR: entry.r, pose: 'standing' },
        npcActor(records, { id: 'spearhead', name: 'Spearhead', npcId: 'spearhead_unumanuk', worldC: points.guide.c, worldR: points.guide.r, pose: 'standing' }),
      ],
      stages: [
        { id: 'farm_intro', type: 'talk', speakerId: 'spearhead', text: "Here we are. Nanjiri Farmstead. It's been left to itself for a while, but there's good land under all this mess.", next: '__next__' },
        { id: 'farm_choice', type: 'choice', speakerId: 'player', text: 'What do you make of it?', options: [{ text: 'Where should I start?', next: '__next__' }, { text: 'It has possibilities.', next: '__next__' }] },
        { id: 'farm_walk_guide', type: 'move', cameraMode: 'follow', followActorIds: ['player', 'spearhead'], cameraOffset: { x: 0, y: 5, z: 8 }, fovDeg: 55, blendSeconds: 1.25, actorId: 'spearhead', targetWorld: { c: porch.c, r: porch.r }, speed: 'normal', navigate: true, waitForArrival: false, next: '__next__' },
        { id: 'farm_walk_player', type: 'move', actorId: 'player', targetWorld: { c: points.playerPorch.c, r: points.playerPorch.r }, speed: 'normal', navigate: true, next: '__next__' },
        { id: 'farm_house', type: 'talk', cameraMode: 'authored', camera: points.houseCamera, waitForActors: ['player', 'spearhead'], speakerId: 'spearhead', text: "The house is a mess inside. Last time I checked, though, the bed was still intact. Get some rest before you try clearing everything out.", next: '__next__' },
        { id: 'farm_reply', type: 'choice', speakerId: 'player', text: 'How do you answer?', options: [{ text: 'A bed sounds good.', next: '__next__' }, { text: 'Thank you for showing me.', next: '__next__' }] },
        { id: 'farm_tour_final', type: 'talk', speakerId: 'spearhead', text: "You've got a roof and room to start again. Take your time. I'll see you around the Hollow.", next: '__end__' },
      ],
    };
  }

  async function onFarmEntered(profile = window.__hobunjiPlayerProfile) {
    if (profile?.isWorldOwner !== true || tourComplete(profile) || readProgress(profile) !== 'complete' || status.running) return false;
    status.running = true;
    status.phase = 'farm-tour';
    try {
      const runtime = await waitForGameRuntime(); // Tour uses the same live stage engine, input lock and cleanup as the opening.
      const records = await loadNpcRecords(); // Reuses canonical Spearhead and the selected player appearance.
      await runtime.run(buildFarmTourScene(records, profile, runtime.farmTourPoints()), {
        placePlayerAtFinalPosition: true, // The owner resumes beside the house after walking there during the tour.
        onDialogueContinue(stage) {
          if (stage.id === 'farm_tour_final') {
            rememberFarmTourTime(profile);
            changeStory(profile, { farmTourComplete: true });
          }
        },
      });
      status.phase = tourComplete(profile) ? 'farm-tour-complete' : 'farm-tour-interrupted';
      return tourComplete(profile);
    } catch (error) {
      status.lastError = error?.message || String(error);
      status.phase = 'error';
      log('farm introduction failed: ' + status.lastError, 'error');
      return false;
    } finally { status.running = false; }
  }

  // Dev/test URL flags: ?skipRescue=1 skips the Gar-wolf rescue, ?skipMeeting=1
  // skips the Hunundi meeting. Skipping the meeting still marks the opening complete.
  function urlFlag(name) {
    try { return new URLSearchParams(window.location?.search || '').get(name) === '1'; } catch (_) { return false; }
  }
  const skipRescueRequested = () => urlFlag('skipRescue');
  const skipMeetingRequested = () => urlFlag('skipMeeting');

  async function play(profile, options = {}) {
    if (status.running) return false;
    status.running = true;
    status.phase = 'loading';
    status.lastError = null;
    status.runtimeWaitMs = 0;
    status.setupAttempts = 0;
    status.startupRetries = 0;
    clearStartupFailure();
    showBootCover();
    log('starting opening sequence');

    let introduction = null; // Loading preset is scoped to this world opening and always released on failure.
    try {
      introduction = await window.LoadingScreenRuntime?.beginIntroduction?.();
      let resolveAssetsReady; // Final page alone waits for all streamed terrain, actors, textures and shaders.
      const assetsReady = new Promise(resolve => { resolveAssetsReady = resolve; });
      const loadingPages = introduction ? (async () => {
        for (let index = 0; index < 4; index++) {
          if (index) introduction.start(index);
          await introduction.complete(index === 3 ? assetsReady : undefined);
        }
        introduction.finish(); introduction = null;
      })() : Promise.resolve(); // Page delays run independently while preparation continues behind black.
      loadingPages.catch(() => {}); // Setup failure cancels the input wait through the normal cleanup path.
      const runtime = await waitForGameRuntime(OPENING_RUNTIME_TIMEOUT_MS); // Slow mobile cold boots get a longer window; a true failure stays on the opening cover instead of falling through into town.
      const records = await loadNpcRecords(); // Resolves Jubmir/Hunundi/Spearhead/Harkhanash from the authoritative database.
      const rescue = buildRescueScene(records, profile); // Scene one preserves the already-authored Gar-wolf rescue blocking.
      const meeting = buildHunundiMeetingScene(records, profile); // Scene two uses Hunundi's real bedroom/study map and chair transforms.
      introduction?.setProgress(15);
      status.phase = 'rescue';
      status.lastScene = rescue.title;
      let rescueReady = false; // Once onReady completes, the scene has crossed the reveal boundary and must never be silently replayed after a later runtime error.
      let rescueComplete = skipRescueRequested(); // ?skipRescue=1 (dev/test) goes straight to the Hunundi meeting; the opening still completes normally.
      if (rescueComplete) {
        log('skipping the rescue scene (?skipRescue=1)');
        await runtime.preloadOpeningMeeting?.(meeting);
        introduction?.setProgress(100);
        resolveAssetsReady();
        await loadingPages;
      }
      while (!rescueComplete) {
        status.setupAttempts += 1;
        try {
          await runtime.run(rescue, {
            keepFadeOnFinish: true,
            async onEnvironmentReady() { introduction?.setProgress(45); },
            async onActorsReady() { await runtime.preloadOpeningMeeting?.(meeting); introduction?.setProgress(75); },
            async onReady() { rescueReady = true; introduction?.setProgress(100); resolveAssetsReady(); await loadingPages; },
          });
          rescueComplete = true;
        } catch (error) {
          const retryIndex = status.setupAttempts - 1; // Maps the failed setup attempt to the authored backoff delay below.
          const canRetryBeforeReveal = !rescueReady && retryIndex < STARTUP_RETRY_DELAYS_MS.length; // Only pre-reveal failures are safe to repeat automatically.
          if (!canRetryBeforeReveal) throw error;
          status.startupRetries += 1;
          status.lastError = error?.message || String(error);
          log(`rescue setup attempt ${status.setupAttempts} failed before reveal; retrying: ${status.lastError}`, 'warn');
          showBootCover();
          await delay(STARTUP_RETRY_DELAYS_MS[retryIndex]);
        }
      }
      status.phase = 'hunundi-room';
      status.lastScene = meeting.title;
      let finalDialogueContinued = false; // Scene cleanup alone must not complete an opening that skipped its final dialogue.
      if (skipMeetingRequested()) {
        log('skipping the Hunundi meeting (?skipMeeting=1)');
        finalDialogueContinued = true;
        status.pending = false;
        status.completed = true;
        if (!options.replay) writeProgress(profile, 'complete');
        clearBootCover();
      } else await runtime.run(meeting, {
        keepFadeOnFinish: false,
        onDialogueContinue(stage) {
          if (stage.id !== 'meeting_hunundi_final') return;
          finalDialogueContinued = true;
          status.pending = false;
          status.completed = true;
          if (!options.replay) writeProgress(profile, 'complete');
        },
      });
      if (!finalDialogueContinued) throw new Error('Opening ended before Hunundi’s final dialogue was continued.');
      await runtime.placeOutsideTemple?.();
      clearStartupFailure();
      status.phase = 'complete';
      log('opening sequence complete; awaiting the farm introduction');
      return true;
    } catch (error) {
      status.lastError = error?.message || String(error);
      const requiredOpeningStillPending = !options.replay && readProgress(profile) !== 'complete'; // Required fresh-world openings may never reveal ordinary town gameplay as an error fallback.
      status.phase = requiredOpeningStillPending ? 'blocked' : 'error';
      status.pending = requiredOpeningStillPending;
      log('opening sequence failed: ' + status.lastError, 'error');
      if (requiredOpeningStillPending) {
        showBootCover();
        showStartupFailure(profile, status.lastError);
      } else {
        clearBootCover();
      }
      return false;
    } finally {
      introduction?.cancel();
      status.running = false;
    }
  }

  function handlePlayerReady(event) {
    if (window.__hobunjiCutscenePreview) return;
    const profile = event?.detail || window.__hobunjiPlayerProfile; // Uses onboarding's authoritative owner role for the selected world.
    if (!profile?.characterId || !profile?.worldId || profile.isWorldOwner !== true) return;
    const progress = readProgress(profile); // Completion belongs to this world, including openings finished by the earlier version.
    status.pending = progress !== 'complete';
    status.completed = progress === 'complete';
    if (status.pending) {
      writeProgress(profile, 'pending');
      queueMicrotask(() => play(profile));
    }
  }

  document.addEventListener('hobunjiPlayerReady', handlePlayerReady);

  window.OpeningStoryCutscene = Object.freeze({
    buildRescueScene,
    buildHunundiMeetingScene,
    buildJubmirFeyScene, nextFeyVisit, playJubmirFeyVisit,
    play: (profile = window.__hobunjiPlayerProfile) => play(profile, { replay: true }),
    debugSnapshot: () => ({ ...status, farmTourComplete: tourComplete(window.__hobunjiPlayerProfile), wildernessUnlocked: canEnterWilderness(), jubmirFey: feyVisitState() }),
    stateKey, readProgress,
    getStory: (profile = window.__hobunjiPlayerProfile) => storedStory(profile) || {}, // The Guild reads the same portable story record as Jubmir.
    updateStory: changeStory, // Reuses the single world-meta writer for additional story phases.
    tourKey, needsTempleArrival, canEnterWilderness, onFarmEntered, buildFarmTourScene,
  });
  function storyVisitPanel() {
    const profile = window.__hobunjiPlayerProfile; // Supplies owner eligibility for the companion's read-only story panel.
    const story = window.OpeningStoryCutscene.debugSnapshot(); // Reuses the same progress and countdown sent to companion diagnostics.
    const doorstep = window.DoorstepVisits?.debugSnapshot?.(); // Adds visitor runtime readiness and the most recent spawn failure.
    const hreesh = window.DoorstepVisits?.sourceDiagnostics?.('hreesh'); // Live source/build status plus retained Hreesh-specific spawn failure.
    const fey = story.jubmirFey; // Shared persisted countdown/completion, with no timer writes from rendering.
    const registered = doorstep?.providers?.includes(FEY_VISIT_KEY); // Detects a missed provider registration without changing the queue.
    let reason = 'Ready — exit the farmhouse to request the visit.'; // Human-readable eligibility summary shown above the raw progress rows.
    if (!profile) reason = 'Waiting for a player profile.';
    else if (profile.isWorldOwner !== true) reason = 'Only the world owner receives this story visit.';
    else if (!story.farmTourComplete) reason = 'Spearhead’s farm tour is not marked complete.';
    else if (fey.completed) reason = 'Jubmir’s inn conversation is complete.';
    else if (story.running) reason = 'An opening-story cutscene is running.';
    else if (!window.CalendarSystem?.isInitialized?.()) reason = 'Waiting for the game clock.';
    else if (fey.hoursUntilVisit === null) reason = 'The farm-tour timestamp is missing or invalid; waiting for visit synchronization.';
    else if (fey.hoursUntilVisit > 0) reason = 'Waiting for the 12-hour delay.';
    else if (!doorstep) reason = 'Doorstep runtime is unavailable.';
    else if (!registered) reason = 'Jubmir’s story visit provider is not registered.';
    else if (doorstep.activeVisitKey === FEY_VISIT_KEY) reason = 'Jubmir’s story visitor is active at the farmhouse.';
    else if (doorstep.activeVisitKey) reason = 'Another doorstep visitor is active: ' + doorstep.activeVisitKey;
    else if (!doorstep.schedulingReady) reason = 'Doorstep visits are waiting for the NPC scheduling connection.';
    else if (!window.DoorstepVisits.sourceWalker('jubmir')) reason = 'Jubmir’s source NPC is unavailable; the visitor cannot be cloned.';
    return {
      summary: reason,
      rows: [
        ['World owner', profile?.isWorldOwner === true ? 'Yes' : 'No'],
        ['farmTourComplete', story.farmTourComplete ? 'Yes' : 'No'],
        ['Jubmir conversation complete', fey.completed ? 'Yes' : 'No'],
        ['Hours until visit', fey.hoursUntilVisit === null ? 'Unavailable' : Math.ceil(fey.hoursUntilVisit * 100) / 100],
        ['Farm tour completed at (world hours)', fey.farmTourCompletedAtHours ?? 'Unavailable'],
        ['Story phase', story.phase],
        ['Story running', story.running ? 'Yes' : 'No'],
        ['Story visit provider registered', registered ? 'Yes' : 'No'],
        ['Current area', doorstep?.currentArea || 'Unavailable'],
        ['Doorstep NPC scheduling connected', doorstep?.schedulingReady ? 'Yes' : 'No'],
        ['Active visit', doorstep?.activeVisitKey || 'None'],
        ['Registered visit providers', doorstep?.providers?.join(', ') || 'None'],
        ['Jubmir source NPC available', window.DoorstepVisits?.sourceWalker?.('jubmir') ? 'Yes' : 'No'],
        ['Farmhouse entrances', doorstep ? window.DoorstepVisits.exitDoorCandidates().length : 'Unavailable'],
        ['Farmhouse exit requests', doorstep?.exitCount ?? 'Unavailable'],
        ['Last observed area', doorstep?.lastObservedArea || 'None'],
        ['Last exit trigger', doorstep?.lastExitAttempt?.trigger || 'None this session'],
        ['Last exit result', doorstep?.lastExitAttempt?.result || 'None this session'],
        ['Last exit provider results', doorstep?.lastExitAttempt ? JSON.stringify(doorstep.lastExitAttempt.providers) : 'None this session'],
        ['Last spawn attempt', doorstep?.lastSpawnAttempt ? `${doorstep.lastSpawnAttempt.key || 'Unknown'}: ${doorstep.lastSpawnAttempt.reason}` : 'None this session'],
        ['Hreesh requested NPC id', hreesh?.npcId || 'Unavailable'],
        ['Hreesh database record loaded', hreesh?.recordFound == null ? 'Unavailable' : hreesh.recordFound ? 'Yes' : 'No'],
        ['Hreesh live source / area', hreesh?.sourceAvailable ? `Yes / ${hreesh.sourceArea || 'Unknown'}` : 'No'],
        ['Hreesh cloneable root', hreesh?.rootCloneAvailable ? 'Yes' : 'No'],
        ['Hreesh scheduled spawn stage', hreesh?.spawnStage || 'Unavailable'],
        ['Hreesh avatar build error', hreesh?.spawnError || 'None recorded'],
        ['Hreesh current schedule target', hreesh?.scheduleTarget ? JSON.stringify(hreesh.scheduleTarget) : 'None resolved'],
        ['Hreesh last visit attempt', hreesh?.lastAttempt ? `${hreesh.lastAttempt.key}: ${hreesh.lastAttempt.reason}` : 'None this session'],
        ['Live NPC walker count', hreesh?.walkerCount ?? 'Unavailable'],
        ['Last story error', story.lastError || 'None'],
        ['Latest change', 'Visitor cloning bypasses circular live hand-rig metadata and remaps cloned skeletons to their own bones; original NPC rigs stay untouched.'],
      ],
      note: 'Read-only diagnostics. After the countdown reaches zero, enter and exit the farmhouse. The visit stays pending until the inn conversation finishes. Last spawn attempt describes a past attempt, not necessarily the current blocker.',
    };
  }

  window.DevCompanion?.registerStateProvider('openingStory', () => window.OpeningStoryCutscene.debugSnapshot());
  window.DevCompanion?.registerPanel({
    id: 'opening-story-doorstep', title: 'Opening Story / Doorstep Visits', order: 21,
    when: () => window.__hobunjiGameStarted === true,
    render: storyVisitPanel,
  });
})();
