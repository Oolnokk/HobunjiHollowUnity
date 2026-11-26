(() => {
  'use strict';

  // SharedCutscene - what a cutscene means for a co-op session (up to ActorRegistry.MAX_PLAYERS).
  //
  // Rules:
  //  * A cutscene PAUSES EVERYONE and EVERYONE WATCHES IT, no matter which area they are in.
  //    Every registered player is a participant for the whole scene. Remote participants are
  //    frozen, untargetable and invulnerable (`_inCutscene`); the world clock's revive windows
  //    and sleep votes are held (TimeConsensus.pause/resume). The player who triggered it
  //    (`controller`) is the one who makes dialogue choices; the others watch.
  //  * Crowd scenes (a wedding, an announcement, the Five Blossoms crowning - anything where
  //    the villagers gather as an audience): the other players JOIN THE CROWD. The scene owner
  //    keeps its own layout and asks for the extra people via crowdMembers(), then places them
  //    with joinCrowd({ area, slots }) using the same ranks/pews it gave the villagers. A joined
  //    player's entity is moved to its slot for the scene (and given the slot's facing/pose, so
  //    RemotePlayerAvatar draws them standing or seated in the crowd) and put back afterwards.
  //  * Scenes that are not crowd scenes keep other players as watchers only: their bodies are not
  //    drawn in the cutscene area.
  //
  // Scenes may nest (sequential authored scenes): begin()/end() are depth-counted, the session
  // lasts until the outermost end(). In single-player this is a no-op shell around the existing
  // runner (the only participant is the local player, who the runner already pauses).

  const TILE_FALLBACK = 64;
  let session = null;                   // { id, area, controller, depth, startedAt, participants:Map, crowd:Map }
  const listeners = new Set();
  const registry = () => window.ActorRegistry;
  let tilePx = TILE_FALLBACK;
  let unsubscribePlayers = null;

  function init(opts = {}) { if (Number(opts.tilePx) > 0) tilePx = Number(opts.tilePx); }
  function emit(type, extra) {
    const ev = { type, id: session?.id || null, area: session?.area || null, ...extra };
    for (const fn of listeners) { try { fn(ev); } catch (e) { console.warn('[SharedCutscene] listener failed', e); } }
  }
  const onEvent = fn => { if (typeof fn === 'function') { listeners.add(fn); return () => listeners.delete(fn); } return () => {}; };

  const isActive = () => !!session;
  const getSession = () => session;
  const isParticipant = player => !!session?.participants.has(player);
  // Frozen = takes no input and cannot be hurt for the length of the scene. Every player, wherever they are.
  const isFrozen = player => !!player && isParticipant(player);
  // The area every participant's client shows during the scene.
  const viewAreaFor = player => (isParticipant(player) ? session.area : null);

  function adopt(player) {
    if (!session || session.participants.has(player)) return;
    const reg = registry();
    const local = reg?.isLocalPlayer(player);
    const rec = { local, prior: null };
    session.participants.set(player, rec);
    if (!local) { player._inCutscene = true; player.vx = 0; player.vy = 0; }
    emit('watch', { playerId: reg?.idOf(player) || null, local });
  }

  function release(player) {
    const rec = session?.participants.get(player);
    if (!rec) return;
    session.participants.delete(player);
    leaveCrowd(player);
    if (!rec.local) player._inCutscene = false;
  }

  // controller: the player who triggered the scene (defaults to the local player).
  function begin(opts = {}) {
    const reg = registry();
    if (session) { session.depth++; return session; } // Nested/sequential scene: same session.
    session = {
      id: opts.id || 'cutscene', area: opts.area || null, title: opts.title || null,
      controller: opts.controller || reg?.getLocalPlayer() || null,
      depth: 1, participants: new Map(), crowd: new Map(),
    };
    for (const p of reg ? reg.getPlayers() : []) adopt(p); // Everyone, in every area.
    unsubscribePlayers = reg?.onPlayersChanged?.((type, player) => { // A player joining mid-scene watches too; one leaving is released.
      if (!session) return;
      if (type === 'add') adopt(player); else if (type === 'remove') release(player);
    }) || null;
    window.TimeConsensus?.pause?.();
    emit('begin', { controllerId: reg?.idOf(session.controller) || null, viewers: Array.from(session.participants.keys()).map(p => reg?.idOf(p) || null) });
    return session;
  }

  function end() {
    if (!session) return false;
    if (--session.depth > 0) return false;
    const done = session;
    for (const p of Array.from(done.participants.keys())) release(p);
    unsubscribePlayers?.(); unsubscribePlayers = null;
    session = null;
    window.TimeConsensus?.resume?.();
    for (const fn of listeners) { try { fn({ type: 'end', id: done.id, area: done.area }); } catch (e) { console.warn('[SharedCutscene] listener failed', e); } }
    return true;
  }

  // ---- crowd -------------------------------------------------------------------------------

  // The people a crowd scene must make room for, in a stable order: everyone but the controller.
  function crowdMembers() {
    if (!session) return [];
    return Array.from(session.participants.keys()).filter(p => p !== session.controller);
  }

  // slots[i] = { c, r, rotY (degrees, NPC convention), pose: 'stand'|'sit', seatTarget? } for crowdMembers()[i].
  // Returns the number placed. The owner calls this after laying out its villagers.
  function joinCrowd({ area, slots } = {}) {
    if (!session || !Array.isArray(slots)) return 0;
    const members = crowdMembers();
    let placed = 0;
    members.forEach((player, i) => {
      const slot = slots[i];
      if (!slot || !Number.isFinite(slot.c) || !Number.isFinite(slot.r)) return;
      const rec = session.participants.get(player);
      if (!rec || rec.local) return; // The local avatar is placed by the cutscene runner itself.
      if (!session.crowd.has(player)) session.crowd.set(player, { x: player.x, y: player.y, areaId: player.areaId, angle: player.angle });
      player.x = (slot.c + 0.5) * tilePx; player.y = (slot.r + 0.5) * tilePx;
      player.areaId = area || session.area;
      player.angle = Math.PI / 2 - (Number(slot.rotY) || 0) * Math.PI / 180; // NPC root yaw (deg) -> px-space heading
      player._crowdSlot = { c: slot.c, r: slot.r, rotY: Number(slot.rotY) || 0, pose: slot.pose === 'sit' ? 'sit' : 'stand', seatTarget: slot.seatTarget || null };
      placed++;
    });
    if (placed) emit('crowd', { placed });
    return placed;
  }

  function leaveCrowd(player) {
    const prior = session?.crowd.get(player);
    if (!prior) return;
    session.crowd.delete(player);
    player.x = prior.x; player.y = prior.y; player.areaId = prior.areaId; player.angle = prior.angle;
    player._crowdSlot = null;
  }
  const isInCrowd = player => !!session?.crowd.has(player);

  window.SharedCutscene = {
    init, begin, end, isActive, getSession, isParticipant, isFrozen, viewAreaFor,
    crowdMembers, joinCrowd, isInCrowd, onEvent,
    snapshot: () => session && ({ id: session.id, area: session.area, depth: session.depth,
      controller: registry()?.idOf(session.controller) || null,
      watching: Array.from(session.participants.keys()).map(p => registry()?.idOf(p) || null),
      crowd: Array.from(session.crowd.keys()).map(p => registry()?.idOf(p) || null) }),
  };
})();
