(() => {
  'use strict';

  const STATE_PREFIX = 'hobunjiOpeningStory.v1'; // Namespaces world-scoped opening progress so interrupted sessions can retry safely.
  const NPC_DB_URL = 'config/npcs/hobunji-starter-npc-database.json'; // Supplies the same authored NPC records the normal scheduler uses.
  const REQUIRED_NPCS = Object.freeze(['jubmir', 'father_hunundi_hodu', 'spearhead_unumanuk', 'khannibarri_agent']); // Guards the two scenes against silently falling back to placeholder actors.
  const status = { // Mobile-readable state surfaced through debugSnapshot() and the existing in-game debug log.
    phase: 'idle',
    pending: false,
    running: false,
    completed: false,
    lastScene: null,
    lastError: null,
    latestChange: 'Four-stage intro loading preset; independent neck deadzones; panel-safe head framing; Hunundi shoulder POV; focused randomized wolf shots. Hunundi POV camera/head targeting and cinematic HUD suppression. Smooth combat-prone transitions, wider wolf shots, town Spearhead equipment, animated office furniture, Hunundi doorway blocking and seated conversational eye contact. Rescue shots center on the player with wider framing and surrounding wolves; combat prone pose, real equipped gear, correct chair anchors/rotations and locked cutscene dialogue. Rescue animals use composed eyes and character head targeting; cutscenes follow facing deadzones and seat height, with a hidden surveyor doorway reveal and relocated office camera. Farm-tour choices now continue through valid col/row navigation hops; the real player stays hidden behind its stand-in, with a wide south-to-north farm shot that blends in after the first dialogue Continue.',
  };

  function stateKey(profile) {
    const worldId = String(profile?.worldId || 'unknown-world'); // Each new world gets its own opening regardless of the owning character's prior worlds.
    return STATE_PREFIX + ':' + worldId;
  }

  function readProgress(profile) {
    try {
      const progress = localStorage.getItem(stateKey(profile)); // Reads the world's shared completion flag before considering the previous character-scoped format.
      if (progress) return progress;
      const legacyKey = STATE_PREFIX + ':' + profile.characterId + ':' + profile.worldId; // Preserves completed openings recorded by the previous version for this world's owner.
      if (localStorage.getItem(legacyKey) === 'complete') {
        writeProgress(profile, 'complete');
        return 'complete';
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  function writeProgress(profile, value) {
    try {
      localStorage.setItem(stateKey(profile), String(value || ''));
      return true;
    } catch (error) {
      status.lastError = error?.message || String(error);
      return false;
    }
  }

  function log(message, level = 'info') {
    window.__farmLog?.('[opening-story] ' + message, level);
  }

  function showBootCover() {
    const fadeEl = window.CutscenePreviewHelpers?.cutscenePreviewFadeEl?.(); // Reuses the cutscene fade surface so the farmhouse never flashes before the rescue opens.
    if (!fadeEl) return null;
    fadeEl.style.transitionDuration = '0s';
    fadeEl.style.opacity = '1';
    return fadeEl;
  }

  function clearBootCover() {
    const fadeEl = document.getElementById('cutscenePreviewFade'); // Releases the shared fade if startup fails before the runtime takes ownership.
    if (!fadeEl) return;
    fadeEl.style.transitionDuration = '0.35s';
    requestAnimationFrame(() => { fadeEl.style.opacity = '0'; });
  }

  async function waitForGameRuntime(timeoutMs = 30000) {
    const start = performance.now(); // Bounds startup polling on damaged/partial pages instead of hanging forever.
    while (performance.now() - start < timeoutMs) {
      if (window.__hobunjiGameStarted && window.AuthoredCutsceneRuntime?.run) return window.AuthoredCutsceneRuntime;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the authored cutscene runtime.');
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
      { id: 'player', name: playerName, isPlayer: true, team: 'player', lc: 11, lr: 8, rotation: 270, pose: 'prone' },
      { id: 'wolf1', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lookAtActorId: 'player', lc: 9, lr: 9, rotation: 45, pose: 'standing' },
      { id: 'wolf2', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lookAtActorId: 'player', lc: 13, lr: 9, rotation: 270, pose: 'standing' },
      { id: 'wolf3', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lookAtActorId: 'player', lc: 11, lr: 6, rotation: 90, pose: 'standing' },
      npcActor(records, { id: 'jubmir', name: 'Jubmir', npcId: 'jubmir', lookAtActorId: 'player', lc: 11, lr: 15, rotation: 0, pose: 'standing' }),
      npcActor(records, { id: 'spearhead', name: 'Spearhead', npcId: 'spearhead_unumanuk', visible: false, lc: 16, lr: 0, rotation: 180, pose: 'standing' }),
      { id: 'hound1', name: 'Dabinggi-hound', creatureTypeId: 'dabinggi-hound', team: 'dabinggi_hounds', lookAtActorId: 'player', lc: 9, lr: 15, rotation: 0, pose: 'standing' },
      { id: 'hound2', name: 'Dabinggi-hound', creatureTypeId: 'dabinggi-hound', team: 'dabinggi_hounds', lookAtActorId: 'player', lc: 13, lr: 15, rotation: 0, pose: 'standing' },
    ];
    const stages = [ // Stable ids make the choice branches inspectable and regression-testable.
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
      mapId: 'map_southern_cloud_forest',
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
      { id: 'meeting_hark_intro', type: 'talk', speakerId: 'harkharash', text: "Surveyor Harkhanash, the Imperial Khanibarri Mining Company. I'm looking for Father Hunundi — the nearest thing to a leader here, I'm told.", next: '__next__' },
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
    try { return localStorage.getItem(tourKey(profile)) === 'complete'; } catch (_) { return false; }
  }

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
          if (stage.id === 'farm_tour_final') localStorage.setItem(tourKey(profile), 'complete');
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

  async function play(profile, options = {}) {
    if (status.running) return false;
    status.running = true;
    status.phase = 'loading';
    status.lastError = null;
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
      const runtime = await waitForGameRuntime(); // Uses the game-owned live wrapper around the existing Director stage engine.
      const records = await loadNpcRecords(); // Resolves Jubmir/Hunundi/Spearhead/Harkhanash from the authoritative database.
      const rescue = buildRescueScene(records, profile); // Scene one preserves the already-authored Gar-wolf rescue blocking.
      const meeting = buildHunundiMeetingScene(records, profile); // Scene two uses Hunundi's real bedroom/study map and chair transforms.
      introduction?.setProgress(15);
      status.phase = 'rescue';
      status.lastScene = rescue.title;
      await runtime.run(rescue, {
        keepFadeOnFinish: true,
        async onEnvironmentReady() { introduction?.setProgress(45); },
        async onActorsReady() { await runtime.preloadOpeningMeeting?.(meeting); introduction?.setProgress(75); },
        async onReady() { introduction?.setProgress(100); resolveAssetsReady(); await loadingPages; },
      });
      status.phase = 'hunundi-room';
      status.lastScene = meeting.title;
      let finalDialogueContinued = false; // Scene cleanup alone must not complete an opening that skipped its final dialogue.
      await runtime.run(meeting, {
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
      status.phase = 'complete';
      log('opening sequence complete; awaiting the farm introduction');
      return true;
    } catch (error) {
      status.phase = 'error';
      status.lastError = error?.message || String(error);
      log('opening sequence failed: ' + status.lastError, 'error');
      clearBootCover();
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
    play: (profile = window.__hobunjiPlayerProfile) => play(profile, { replay: true }),
    debugSnapshot: () => ({ ...status, farmTourComplete: tourComplete(window.__hobunjiPlayerProfile), wildernessUnlocked: canEnterWilderness() }),
    stateKey,
    tourKey, needsTempleArrival, canEnterWilderness, onFarmEntered, buildFarmTourScene,
  });
})();
