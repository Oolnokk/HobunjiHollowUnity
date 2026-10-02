(() => {
  'use strict';

  const STATE_PREFIX = 'hobunjiOpeningStory.v1'; // Namespaces per-character/per-world opening progress so interrupted first boots can resume safely.
  const NPC_DB_URL = 'config/npcs/hobunji-starter-npc-database.json'; // Supplies the same authored NPC records the normal scheduler uses.
  const REQUIRED_NPCS = Object.freeze(['jubmir', 'father_hunundi_hodu', 'spearhead_unumanuk', 'khannibarri_agent']); // Guards the two scenes against silently falling back to placeholder actors.
  const status = { // Mobile-readable state surfaced through debugSnapshot() and the existing in-game debug log.
    phase: 'idle',
    pending: false,
    running: false,
    completed: false,
    lastScene: null,
    lastError: null,
    latestChange: 'Opening story now chains the existing Gar-wolf rescue into Hunundi-room amnesia/Khannibarri exposition using the authored cutscene runtime.',
  };

  function stateKey(profile) {
    const characterId = String(profile?.characterId || 'unknown-character'); // Separates the same world between different playable characters.
    const worldId = String(profile?.worldId || 'unknown-world'); // Separates the same character between different worlds.
    return STATE_PREFIX + ':' + characterId + ':' + worldId;
  }

  function readProgress(profile) {
    try {
      return localStorage.getItem(stateKey(profile)) || '';
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
      { id: 'wolf1', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lc: 10, lr: 7, rotation: 45, pose: 'standing' },
      { id: 'wolf2', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lc: 12, lr: 7, rotation: 270, pose: 'standing' },
      { id: 'wolf3', name: 'Gar-wolf', creatureTypeId: 'gar-wolf', team: 'gar_wolves', lc: 11, lr: 6, rotation: 90, pose: 'standing' },
      npcActor(records, { id: 'jubmir', name: 'Jubmir', npcId: 'jubmir', lc: 11, lr: 15, rotation: 0, pose: 'standing' }),
      npcActor(records, { id: 'spearhead', name: 'Spearhead', npcId: 'spearhead_unumanuk', lc: 16, lr: 0, rotation: 180, pose: 'standing' }),
      { id: 'hound1', name: 'Dabinggi-hound', creatureTypeId: 'dabinggi-hound', team: 'dabinggi_hounds', lc: 9, lr: 15, rotation: 0, pose: 'standing' },
      { id: 'hound2', name: 'Dabinggi-hound', creatureTypeId: 'dabinggi-hound', team: 'dabinggi_hounds', lc: 13, lr: 15, rotation: 0, pose: 'standing' },
    ];
    const stages = [ // Stable ids make the choice branches inspectable and regression-testable.
      { id: 'rescue_wolf1_growl', type: 'talk', speakerId: 'wolf1', text: 'Grrrr!', next: '__next__' },
      { id: 'rescue_wolf2_growl', type: 'talk', speakerId: 'wolf2', text: 'Hrrrr!!!', next: '__next__' },
      { id: 'rescue_wolf3_growl', type: 'talk', speakerId: 'wolf3', text: 'Hreeeeech!!!', next: '__next__' },
      { id: 'rescue_hound1_run', type: 'move', actorId: 'hound1', targetLocal: { lc: 9, lr: 11 }, speed: 'fast', waitForArrival: false, next: '__next__' },
      { id: 'rescue_hound2_run', type: 'move', actorId: 'hound2', targetLocal: { lc: 13, lr: 11 }, speed: 'fast', next: '__next__' },
      { id: 'rescue_combat', type: 'combat', duration: 3, participants: [
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
      { id: 'rescue_spearhead_enter', type: 'move', actorId: 'spearhead', targetLocal: { lc: 16, lr: 4 }, speed: 'fast', next: '__next__' },
      { id: 'rescue_spearhead_line', type: 'talk', speakerId: 'spearhead', text: "What's all this then?", next: '__next__' },
      { id: 'rescue_jubmir_turn', type: 'turn', actorId: 'jubmir', mode: 'actor', targetActorId: 'spearhead', duration: 0.45, next: '__next__' },
      { id: 'rescue_jubmir_request', type: 'talk', speakerId: 'jubmir', text: "Spearhead — you can't imagine how glad I am to see you. Help me bring this stranger into town.", next: '__next__' },
      { id: 'rescue_spearhead_rush', type: 'move', actorId: 'spearhead', targetLocal: { lc: 12, lr: 8 }, speed: 'fast', next: '__next__' },
      { id: 'rescue_fade_out', type: 'fade', direction: 'out', duration: 1.2, next: '__end__' },
    ];
    return {
      version: 6,
      title: 'Rescue',
      mapId: 'map_northern_cliffs',
      wilderness: true,
      footprint: { originC: 8, originR: -1, w: 17, h: 18 },
      camera3d: { localPos: { x: 11, y: 3.5, z: 15 }, localTarget: { x: 11, y: 0.6, z: 7 } },
      actors,
      stages,
    };
  }

  function seatTarget(c, r, rotY) {
    return { pose: 'sit', furnitureKey: 'chairSimpleFurniture', c, r, rotY, seatIndex: 0 }; // Mirrors the normal NPC schedule seat-target shape consumed by npcSeatTransformForTarget().
  }

  function buildHunundiMeetingScene(records, profile) {
    const playerName = String(profile?.nickname || 'Farmer'); // Keeps the player actor label consistent with the newly-created character.
    const actors = [ // Every participant is a real authored NPC/player avatar; no custom placeholder people are used.
      { id: 'player', name: playerName, isPlayer: true, worldC: 8, worldR: 9, rotation: 0, pose: 'sit', seatTarget: seatTarget(8, 9, 0) },
      npcActor(records, { id: 'hunundi', name: 'Father Hunundi', npcId: 'father_hunundi_hodu', worldC: 11, worldR: 8, rotation: 180, pose: 'sit', seatTarget: seatTarget(11, 8, 0) }),
      npcActor(records, { id: 'jubmir', name: 'Jubmir', npcId: 'jubmir', worldC: 7, worldR: 9, rotation: 0, pose: 'sit', seatTarget: seatTarget(7, 9, 0) }),
      npcActor(records, { id: 'spearhead', name: 'Spearhead', npcId: 'spearhead_unumanuk', worldC: 9, worldR: 9, rotation: 0, pose: 'sit', seatTarget: seatTarget(9, 9, 0) }),
      npcActor(records, { id: 'harkharash', name: 'Surveyor Harkharash', npcId: 'khannibarri_agent', worldC: 11, worldR: 5, rotation: 180, pose: 'standing', seatTarget: seatTarget(9, 8, 0) }),
    ];
    const stages = [ // The dialogue establishes amnesia, Nanjiri Farmstead, Khannibarri's offer, regional isolation, and Spearhead's resolve in one room.
      { id: 'meeting_fade_in', type: 'fade', direction: 'in', duration: 0.8, next: '__next__' },
      { id: 'meeting_hunundi_where', type: 'talk', speakerId: 'hunundi', text: 'Easy now. Jubmir tells me you remember your name. Do you remember where you came from?', next: '__next__' },
      { id: 'meeting_player_where', type: 'choice', speakerId: 'player', text: 'You search your memory.', options: [
        { text: "I don't know.", next: 'meeting_spearhead_family' },
        { text: "I can't remember anything before the cliffs.", next: 'meeting_spearhead_family' },
      ] },
      { id: 'meeting_spearhead_family', type: 'talk', speakerId: 'spearhead', text: 'Family? A village? A trade? Anything we can use to work backward?', next: '__next__' },
      { id: 'meeting_player_nothing', type: 'talk', speakerId: 'player', text: "Nothing. I know my name, but when I reach for anything else there's just... nothing.", next: '__next__' },
      { id: 'meeting_jubmir_belongings', type: 'talk', speakerId: 'jubmir', text: "You weren't carrying anything that told us much, either. Nothing with a name, a crest, or a place on it.", next: '__next__' },
      { id: 'meeting_hunundi_kind', type: 'talk', speakerId: 'hunundi', text: "Then we won't force an answer your mind isn't ready to give. What you need first is somewhere safe to recover.", next: '__next__' },
      { id: 'meeting_hunundi_farm', type: 'talk', speakerId: 'hunundi', text: "The old Nanjiri Farmstead has been abandoned for some time. It needs work, but the house still stands and the land is good. You could live there, if you'd like.", next: '__next__' },
      { id: 'meeting_player_farm', type: 'choice', speakerId: 'player', text: 'How do you answer?', options: [
        { text: 'You would let a stranger have a farm?', next: 'meeting_hunundi_answer' },
        { text: "I don't know how to repay you.", next: 'meeting_hunundi_answer' },
      ] },
      { id: 'meeting_hunundi_answer', type: 'talk', speakerId: 'hunundi', text: "By getting well. We can worry about the rest after you've had a roof over your head for a few nights.", next: '__next__' },
      { id: 'meeting_knock', type: 'caption', speakerName: '', text: 'Knock. Knock.', next: '__next__' },
      { id: 'meeting_hunundi_door', type: 'talk', speakerId: 'hunundi', text: 'Hm? Come in.', next: '__next__' },
      { id: 'meeting_hark_enter', type: 'move', actorId: 'harkharash', targetWorld: { c: 10, r: 7 }, speed: 'normal', next: '__next__' },
      { id: 'meeting_hark_intro', type: 'talk', speakerId: 'harkharash', text: "Good evening. Surveyor Harkharash, Khannibarri Imperial Mining Company. I'm looking for the town's leader. I was told Father Hunundi was the closest thing Hobunji Hollow had.", next: '__next__' },
      { id: 'meeting_hunundi_no_leader', type: 'talk', speakerId: 'hunundi', text: "I'm Father Hunundi. People come to me when something needs settling, but that doesn't make the Hollow mine. Sit, if you've come all this way.", next: '__next__' },
      { id: 'meeting_hark_to_seat', type: 'move', actorId: 'harkharash', targetWorld: { c: 9, r: 8 }, speed: 'normal', next: '__next__' },
      { id: 'meeting_hark_sit', type: 'animation', actorId: 'harkharash', animKind: 'none', resultPose: 'sit', duration: 0.35, next: '__next__' },
      { id: 'meeting_hark_offer', type: 'talk', speakerId: 'harkharash', text: 'Our surveys indicate a very substantial ore body beneath this valley. Extraction on the scale justified by the deposit would require the land Hobunji Hollow presently occupies. Khannibarri would like to purchase the settlement and the relevant surrounding claims.', next: '__next__' },
      { id: 'meeting_hunundi_people', type: 'talk', speakerId: 'hunundi', text: "Something like that is up to the townsfolk, not me. And I think you'll find it takes quite a lot of convincing to make people give up a place their families have called home for generations.", next: '__next__' },
      { id: 'meeting_hark_practical', type: 'talk', speakerId: 'harkharash', text: 'With respect, Father, I was hoping the nearest thing to a leader might also be the nearest thing to a practical man.', next: '__next__' },
      { id: 'meeting_hark_trade', type: 'talk', speakerId: 'harkharash', text: "Fewer Slagothim traders are willing to make this journey every year. They say there's a ghost army in the mountains. Ghosts. I don't put much stock in that sort of thing, but there's no reasoning peasants and Slagothim out of a superstition once they've taken to it.", next: '__next__' },
      { id: 'meeting_hark_bandits', type: 'talk', speakerId: 'harkharash', text: "And even if one indulges the ghosts, the bandit clans are real enough. So is the barbarian war. Every road to this place becomes less attractive by the season.", next: '__next__' },
      { id: 'meeting_hark_leverage', type: 'talk', speakerId: 'harkharash', text: 'Khannibarri can give every villager a cut of the sale. Enough to move out of the mountains and start living in the 12th century with the rest of the continent.', next: '__next__' },
      { id: 'meeting_spearhead_stand', type: 'animation', actorId: 'spearhead', animKind: 'none', resultPose: 'standing', duration: 0.25, next: '__next__' },
      { id: 'meeting_spearhead_step', type: 'move', actorId: 'spearhead', targetWorld: { c: 8, r: 8 }, speed: 'fast', next: '__next__' },
      { id: 'meeting_spearhead_turn', type: 'turn', actorId: 'spearhead', mode: 'actor', targetActorId: 'harkharash', duration: 0.25, next: '__next__' },
      { id: 'meeting_spearhead_anger', type: 'talk', speakerId: 'spearhead', text: 'You walk into our home and call us backward?', next: '__next__' },
      { id: 'meeting_hunundi_spearhead', type: 'talk', speakerId: 'hunundi', text: 'Spearhead.', next: '__next__' },
      { id: 'meeting_hunundi_invite', type: 'talk', speakerId: 'hunundi', text: "Surveyor, if you truly think you can convince everyone, you're welcome to stay in town and try. You can make your offer to the people whose homes you mean to buy.", next: '__next__' },
      { id: 'meeting_hark_agrees', type: 'talk', speakerId: 'harkharash', text: "Very well. That's all I wanted — a fair hearing. I'll make my arrangements in town.", next: '__next__' },
      { id: 'meeting_hark_stand', type: 'animation', actorId: 'harkharash', animKind: 'none', resultPose: 'standing', duration: 0.25, next: '__next__' },
      { id: 'meeting_hark_leave', type: 'move', actorId: 'harkharash', targetWorld: { c: 11, r: 5 }, speed: 'normal', next: '__next__' },
      { id: 'meeting_spearhead_home', type: 'talk', speakerId: 'spearhead', text: "I lost my first home to a dragon. I'm sure as stone not losing this one to those bronze-hungry monsters.", next: '__next__' },
      { id: 'meeting_hunundi_resume', type: 'talk', speakerId: 'hunundi', text: 'Well. As I was saying.', next: '__next__' },
      { id: 'meeting_hunundi_final', type: 'talk', speakerId: 'hunundi', text: "The Nanjiri Farmstead is yours to use. Rest first. Tomorrow, we'll see what sort of life you want to make of it.", next: '__next__' },
      { id: 'meeting_fade_out', type: 'fade', direction: 'out', duration: 0.8, next: '__end__' },
    ];
    return {
      version: 6,
      title: "Father Hunundi's Room",
      mapId: 'map_i_temple_basement_hunundi',
      camera3d: { worldPos: { x: 10.5, y: 3.0, z: 13.2 }, worldTarget: { x: 9.7, y: 0.8, z: 8.3 } },
      actors,
      stages,
    };
  }

  async function play(profile, options = {}) {
    if (status.running) return false;
    status.running = true;
    status.phase = 'loading';
    status.lastError = null;
    showBootCover();
    log('starting opening sequence');

    try {
      const runtime = await waitForGameRuntime(); // Uses the game-owned live wrapper around the existing Director stage engine.
      const records = await loadNpcRecords(); // Resolves Jubmir/Hunundi/Spearhead/Harkharash from the authoritative database.
      const rescue = buildRescueScene(records, profile); // Scene one preserves the already-authored Gar-wolf rescue blocking.
      const meeting = buildHunundiMeetingScene(records, profile); // Scene two uses Hunundi's real bedroom/study map and chair transforms.
      status.phase = 'rescue';
      status.lastScene = rescue.title;
      await runtime.run(rescue, { keepFadeOnFinish: true });
      status.phase = 'hunundi-room';
      status.lastScene = meeting.title;
      await runtime.run(meeting, { keepFadeOnFinish: false });
      status.phase = 'complete';
      status.pending = false;
      status.completed = true;
      if (!options.replay) writeProgress(profile, 'complete');
      log('opening sequence complete');
      return true;
    } catch (error) {
      status.phase = 'error';
      status.lastError = error?.message || String(error);
      log('opening sequence failed: ' + status.lastError, 'error');
      clearBootCover();
      return false;
    } finally {
      status.running = false;
    }
  }

  function shouldArmFromCreatorReload(profile) {
    const handoff = window.hobunjiOnboardingCharacterCreationReloadHandoff; // Distinguishes a newly-created character's clean reload from ordinary save-select Play.
    return !!handoff?.status?.resumed && !!profile?.characterId && !!profile?.worldId;
  }

  function handlePlayerReady(event) {
    if (window.__hobunjiCutscenePreview) return;
    const profile = event?.detail || window.__hobunjiPlayerProfile; // Uses the exact hydrated profile game.js receives on the same event.
    if (!profile?.characterId || !profile?.worldId) return;
    let progress = readProgress(profile); // Existing pending state survives a crash/reload; completed state prevents replay.
    if (progress !== 'complete' && shouldArmFromCreatorReload(profile)) {
      writeProgress(profile, 'pending');
      progress = 'pending';
    }
    status.pending = progress === 'pending';
    status.completed = progress === 'complete';
    if (progress === 'pending') queueMicrotask(() => play(profile));
  }

  document.addEventListener('hobunjiPlayerReady', handlePlayerReady);

  window.OpeningStoryCutscene = Object.freeze({
    buildRescueScene,
    buildHunundiMeetingScene,
    play: (profile = window.__hobunjiPlayerProfile) => play(profile, { replay: true }),
    debugSnapshot: () => ({ ...status }),
    stateKey,
  });
})();
