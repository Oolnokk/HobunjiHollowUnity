// Life Temple wedding — an authored cutscene in the same shape as
// js/opening-story-cutscene.js: buildWeddingScene() returns a Director-format
// scene (actors + stages, loadable in the Cutscene Director's "Repo
// cutscenes" list), and play() runs it through window.AuthoredCutsceneRuntime.
//
// The temple has a third alternate layout for this (config/maps/
// map_i_temple.json → layouts "wedding", enabled by the MapLayoutSystem flag
// `templeWedding`): north-facing pews filling the hall, the player and spouse
// up north one tile apart, and Father Hunundi between them one tile further
// north. play() switches to it behind a fade, seats every villager's live
// walker in those pews (a schedule override, so they stay for the reception
// and then walk back to their own routines), and stages the ceremony with
// cutscene stand-ins for the couple and Father Hunundi.
(() => {
  'use strict';
  if (window.RomanceWedding) return;

  const TEMPLE_MAP_ID = 'map_i_temple';
  const LAYOUT_FLAG = 'templeWedding';
  const NPC_DB_URL = 'config/npcs/hobunji-starter-npc-database.json';
  // officiant/player/spouse match the layout's station_wedding_* stations;
  // the centre aisle is columns 9-10, clear from the altar to the doors.
  const SPOTS = Object.freeze({ officiant: { c: 9, r: 5 }, player: { c: 8, r: 6 }, spouse: { c: 10, r: 6 }, aisle: { c: 9 }, recessionalRow: 11 });
  const NORTH = 180, SOUTH = 0; // Cutscene actor rotation degrees (CutscenePreviewHelpers.cutscenePreviewAngleToward convention).
  const CAMERAS = Object.freeze({
    // Both shots aim low so their subjects sit in the top ~60% of the frame,
    // above the cutscene dialogue box.
    wide: { id: 'wedding_wide', label: 'Wedding — over the altar to the pews', position: { x: 10, y: 3.6, z: 3.2 }, target: { x: 10, y: 0, z: 10.5 }, fovDeg: 58, blendSeconds: 1.4, trackSpeaker: false, stagePlayer: false },
    altar: { id: 'wedding_altar', label: 'Wedding — the altar', position: { x: 9.5, y: 2.6, z: 10.5 }, target: { x: 9.5, y: 0.2, z: 6.2 }, fovDeg: 46, blendSeconds: 1.1, trackSpeaker: false, stagePlayer: false },
  });

  const cfg = () => window.SCRATCHBONES_CONFIG?.game?.romance?.wedding || {};
  let deps = null; // RomanceSystem's game deps (seat transforms, layout rebuild, walkers).
  let ceremony = null; // { guestTargets: Map<npcId, target>, releaseAtHour }
  const status = { phase: 'idle', lastError: null, guests: 0, seats: 0 };

  function hourStamp() {
    const snap = window.CalendarSystem?.timeDebugSnapshot?.();
    return Math.max(0, Math.floor(Number(snap?.rawDay) || 0)) * 24 + (Number(window.CalendarSystem?.getHour?.()) || 0);
  }

  async function loadNpcRecords() {
    const db = window.LocalDBOverrides
      ? await window.LocalDBOverrides.loadDatabase('npcDatabase')
      : await fetch(NPC_DB_URL).then(response => {
        if (!response.ok) throw new Error('NPC database HTTP ' + response.status);
        return response.json();
      });
    return new Map((db?.npcs || []).map(record => [record.id, record]));
  }

  function npcActor(records, options) {
    return { ...options, npcRecord: records.get(options.npcId) };
  }

  // ── Scene ─────────────────────────────────────────────────────────────
  function buildWeddingScene(records, profile, cast = {}) {
    const playerName = String(profile?.nickname || 'Farmer');
    const spouseId = String(cast.spouseId || 'aliri_ginju');
    const spouseRecord = records.get(spouseId);
    const spouseName = String(cast.spouseName || spouseRecord?.name || 'your beloved').split(' ')[0];
    const officiantId = String(cast.officiantId || 'father_hunundi_hodu');
    const actors = [
      { id: 'player', name: playerName, isPlayer: true, worldC: SPOTS.player.c, worldR: SPOTS.player.r, rotation: NORTH, pose: 'standing' },
      npcActor(records, { id: 'spouse', name: spouseName, npcId: spouseId, worldC: SPOTS.spouse.c, worldR: SPOTS.spouse.r, rotation: NORTH, pose: 'standing' }),
      npcActor(records, { id: 'hunundi', name: 'Father Hunundi', npcId: officiantId, worldC: SPOTS.officiant.c, worldR: SPOTS.officiant.r, rotation: SOUTH, pose: 'standing' }),
    ];
    // Over one partner's shoulder onto the other, with Hunundi and the pews in frame.
    // Positive side = the source's right while facing the target; a wider
    // offset and a little height clear a big-headed partner from the frame.
    const overShoulder = (from, to, side, height = 0.05) => ({ cameraMode: 'pov', actorId: from, targetActorId: to, fovDeg: 50, povBack: 0.45, povSide: side, povHeight: height });
    const stages = [
      { id: 'wedding_fade_in', type: 'fade', direction: 'in', duration: 1.2, next: '__next__' },
      { id: 'wedding_gathered', type: 'caption', speakerName: '', text: 'Friends and neighbors fill every pew of the Life Temple.', cameraMode: 'authored', camera: CAMERAS.wide, next: '__next__' },
      { id: 'wedding_welcome', type: 'talk', speakerId: 'hunundi', addressedActorId: 'player', text: 'We gather beneath the Life that runs through soil and star, to bind two lives into one household.', cameraMode: 'authored', camera: CAMERAS.altar, next: '__next__' },
      { id: 'wedding_face_spouse', type: 'turn', actorId: 'player', mode: 'actor', targetActorId: 'spouse', duration: 0.35, next: '__next__' },
      { id: 'wedding_face_player', type: 'turn', actorId: 'spouse', mode: 'actor', targetActorId: 'player', duration: 0.35, next: '__next__' },
      { id: 'wedding_ask_player', type: 'talk', speakerId: 'hunundi', addressedActorId: 'player', text: `${playerName}, will you share your hearth, your harvests and your hardships with ${spouseName}?`, ...overShoulder('spouse', 'player', -0.6, 0.2), next: '__next__' },
      { id: 'wedding_player_vow', type: 'choice', speakerId: 'player', text: 'How do you answer?', options: [
        { text: 'I will.', next: 'wedding_ask_spouse' },
        { text: '…Not today.', next: 'wedding_postpone' },
      ] },
      { id: 'wedding_ask_spouse', type: 'talk', speakerId: 'hunundi', addressedActorId: 'spouse', text: `And you, ${spouseName}?`, ...overShoulder('player', 'spouse', 0.25), next: '__next__' },
      { id: 'wedding_spouse_vow', type: 'talk', speakerId: 'spouse', addressedActorId: 'player', text: 'I will. With all my heart.', ...overShoulder('player', 'spouse', 0.25), next: '__next__' },
      { id: 'wedding_pronounce', type: 'talk', speakerId: 'hunundi', addressedActorId: 'player', text: 'Then by the Life in the soil and the Life in the stars — you are wed!', cameraMode: 'authored', camera: CAMERAS.altar, next: '__next__' },
      { id: 'wedding_love', type: 'animation', actorId: 'spouse', animKind: 'emote', emoteName: 'love', resultPose: 'unchanged', duration: 1.2, next: '__next__' },
      // Recessional: the couple step into the centre aisle and walk out
      // between the pews under the cheering (the wide shot looks down the
      // aisle from the altar). It also leaves the player in the clear aisle
      // when gameplay resumes, so the follow camera isn't buried in the pews.
      { id: 'wedding_step_aisle', type: 'move', actorId: 'player', targetWorld: { c: SPOTS.aisle.c, r: SPOTS.player.r }, speed: 'slow', next: '__next__' },
      { id: 'wedding_recess_spouse', type: 'move', actorId: 'spouse', targetWorld: { c: SPOTS.spouse.c, r: SPOTS.recessionalRow, facing: SOUTH }, speed: 'slow', waitForArrival: false, next: '__next__' },
      { id: 'wedding_recess_player', type: 'move', actorId: 'player', targetWorld: { c: SPOTS.aisle.c, r: SPOTS.recessionalRow, facing: SOUTH }, speed: 'slow', waitForArrival: false, next: '__next__' },
      { id: 'wedding_cheer', type: 'caption', speakerName: '', text: 'The whole temple bursts into cheers.', cameraMode: 'authored', camera: CAMERAS.wide, next: '__next__' },
      { id: 'wedding_fade_out', type: 'fade', direction: 'out', duration: 1, next: '__end__' },
      { id: 'wedding_postpone', type: 'talk', speakerId: 'hunundi', addressedActorId: 'player', text: 'No matter. The Totem has waited this long; it will wait for you both.', cameraMode: 'authored', camera: CAMERAS.altar, next: 'wedding_postpone_fade' },
      { id: 'wedding_postpone_fade', type: 'fade', direction: 'out', duration: 1, next: '__end__' },
    ];
    return {
      version: 6,
      title: 'The Wedding',
      mapId: TEMPLE_MAP_ID,
      mapLayoutId: 'wedding', // Informational: play() enables this layout through its `templeWedding` flag before running the scene.
      actors,
      stages,
    };
  }

  // ── Guests ────────────────────────────────────────────────────────────
  function excludedGuests() {
    return new Set(Array.isArray(cfg().excludeGuests) ? cfg().excludeGuests : []);
  }
  function favorFor(npcId) {
    return Number(window.DialogueContent?.getNpcDlgState?.(npcId)?.favor) || 0;
  }
  // Every villager with a live walker, except the couple, the officiant,
  // named animals, doorstep visitors and the configured non-villagers.
  // The spouse's own household gets the front rows, then closest friends.
  function pickGuests(walkers, spouseId, officiantId) {
    const exclude = excludedGuests();
    const spouseHome = walkers.find(w => w.rec?.id === spouseId)?.rec?.homeId || null;
    const seen = new Set();
    const guests = [];
    for (const walker of walkers) {
      const id = walker?.rec?.id;
      if (!id || seen.has(id) || id === spouseId || id === officiantId) continue;
      if (walker._doorstepVisitor || walker.animalDef || exclude.has(id)) continue;
      seen.add(id);
      guests.push(walker);
    }
    const rank = walker => (spouseHome && walker.rec.homeId === spouseHome ? 1e6 : 0) + favorFor(walker.rec.id);
    return guests.sort((a, b) => rank(b) - rank(a));
  }
  // Seats front row first, aisle-side benches and aisle-side seats first.
  function pewSeats() {
    const stations = window.NpcScheduling?.findStationsByRole?.('wedding_pew', { area: TEMPLE_MAP_ID }) || [];
    const seats = [];
    for (const station of stations) {
      for (const seatIndex of [0, 1]) {
        const target = {
          area: TEMPLE_MAP_ID, c: station.c, r: station.r, rotY: station.rotY, pose: 'sit',
          furnitureKey: station.furnitureKey, seatIndex,
          stationId: `${station.stationId || station.id}#${seatIndex}`, activity: 'attending the wedding',
        };
        const seat = deps?.seatTransformForTarget?.(target);
        if (seat) seats.push({ target, seat });
      }
    }
    const aisleX = 10; // Between aisle columns 9 and 10.
    return seats.sort((a, b) => (a.target.r - b.target.r) || (Math.abs(a.seat.x - aisleX) - Math.abs(b.seat.x - aisleX)));
  }
  function seatGuests(spouseId, officiantId) {
    const walkers = deps?.npcWalkers || [];
    const guests = pickGuests(walkers, spouseId, officiantId);
    const seats = pewSeats();
    const guestTargets = new Map();
    guests.forEach((walker, index) => {
      const slot = seats[index];
      if (!slot) return;
      guestTargets.set(walker.rec.id, slot.target);
      if (walker.area !== TEMPLE_MAP_ID) walker.transferToArea(TEMPLE_MAP_ID, { c: slot.target.c, r: slot.target.r });
      walker._exitSpot = null; walker._entrySpot = null; walker._exitToArea = null;
      walker.state = 'idle';
      walker.root.position.x = slot.seat.x; // Behind the fade: straight onto the pew, no walk through the benches.
      walker.root.position.z = slot.seat.z;
    });
    status.guests = guestTargets.size;
    status.seats = seats.length;
    return guestTargets;
  }
  // The rebuilt hall reports ready before its furniture has registered its
  // seat stations, so wait (briefly) for the pews to exist before seating.
  async function waitForPews(timeoutMs = 15000) {
    const started = Date.now();
    while (!(window.NpcScheduling?.findStationsByRole?.('wedding_pew', { area: TEMPLE_MAP_ID }) || []).length) {
      if (Date.now() - started > timeoutMs) return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
  }
  function scheduleOverride(rec) {
    return ceremony?.guestTargets?.get(rec?.id) || null;
  }

  // ── Playback ──────────────────────────────────────────────────────────
  function cheerGuests(count = 8) {
    for (const id of [...(ceremony?.guestTargets?.keys() || [])].slice(0, count)) {
      const walker = (deps?.npcWalkers || []).find(w => w.rec?.id === id);
      if (walker?.root) window.AmbientDialogue?.cheer?.(walker.root);
    }
  }
  async function play({ spouseId, officiantId = 'father_hunundi_hodu', profile = window.__hobunjiPlayerProfile } = {}) {
    const runtime = window.AuthoredCutsceneRuntime;
    if (!runtime?.run) throw new Error('The authored cutscene runtime is unavailable.');
    if (!window.MapLayoutSystem?.setFlag || !deps?.rebuildBuildingForActiveLayout) throw new Error('Temple layouts are unavailable.');
    status.phase = 'loading';
    status.lastError = null;
    try {
      const records = await loadNpcRecords();
      const scene = buildWeddingScene(records, profile, { spouseId, officiantId });
      const setUp = async () => {
        window.MapLayoutSystem.setFlag(LAYOUT_FLAG, true);
        await deps.rebuildBuildingForActiveLayout(TEMPLE_MAP_ID);
        await waitForPews();
        ceremony = { guestTargets: seatGuests(spouseId, officiantId), releaseAtHour: Infinity };
        const fade = window.CutscenePreviewHelpers?.cutscenePreviewFadeEl?.(); // Stays black until the scene's own fade-in, like the opening's boot cover.
        if (fade) { fade.style.transitionDuration = '0s'; fade.style.opacity = '1'; }
      };
      if (window.CalendarSystem?.runScreenTransition) await window.CalendarSystem.runScreenTransition(setUp);
      else await setUp();
      status.phase = 'ceremony';
      let wed = false;
      await runtime.run(scene, {
        placePlayerAtFinalPosition: true,
        onDialogueContinue(stage) {
          if (stage.id !== 'wedding_pronounce') return;
          wed = true;
          cheerGuests(); // The pews cheer under the closing kiss/love emote and "rises to cheer" caption.
        },
      });
      // Guests stay for an in-game hour of reception, cheering, then go home.
      ceremony.releaseAtHour = hourStamp() + Math.max(0, Number(cfg().receptionHours) || 1);
      status.phase = wed ? 'wed' : 'postponed';
      return wed;
    } catch (error) {
      status.phase = 'error';
      status.lastError = error?.message || String(error);
      window.__farmLog?.('[wedding] ' + status.lastError, 'error');
      throw error;
    }
  }

  // Called from RomanceSystem's tick: releases the reception crowd after its
  // hour, and drops the Wedding layout once the player has left the temple
  // (the next door entry rebuilds the ordinary hall).
  function tick(currentArea) {
    if (ceremony && hourStamp() >= ceremony.releaseAtHour) ceremony.guestTargets = new Map();
    if (window.MapLayoutSystem?.getFlag?.(LAYOUT_FLAG) && currentArea !== TEMPLE_MAP_ID && status.phase !== 'loading' && status.phase !== 'ceremony') {
      window.MapLayoutSystem.setFlag(LAYOUT_FLAG, false);
      ceremony = null;
    }
  }

  function init(injected) {
    deps = injected || null;
    window.NpcScheduling?.registerTargetOverride?.('romance-wedding', scheduleOverride);
    return api;
  }

  const api = {
    init, play, tick, buildWeddingScene,
    cameras: CAMERAS, spots: SPOTS, layoutFlag: LAYOUT_FLAG, templeMapId: TEMPLE_MAP_ID,
    snapshot: () => ({ ...status, guestsSeated: ceremony?.guestTargets?.size || 0, layoutFlag: !!window.MapLayoutSystem?.getFlag?.(LAYOUT_FLAG) }),
    _test: { pickGuests, pewSeats, seatGuests, scheduleOverride },
  };
  window.RomanceWedding = api;
})();
