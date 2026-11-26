(() => {
  'use strict';

  // RemotePlayerAvatar - the on-screen body of every NON-local player (a connected guest, or the
  // dev dummy). It reuses the exact pipeline the cutscene director's player stand-in uses, so a
  // remote player has the full four-part body from docs/architecture/visual-authoring.md
  // (authored PNG portrait + pants, procedural 3D feet and hands with their generated outlines)
  // with nothing invented here:
  //
  //   makeNpcWalker(syntheticRecord)   -> the same walker/rig an NPC gets (not added to npcWalkers,
  //                                       so no schedule, dialogue or save state is attached)
  //   walker.applyFacingDeadzone       -> the NPC camera-relative facing rule
  //   walker.legs.update               -> procedural feet/pants animation from real speed
  //   despawnNpcVisitor(walker, true)  -> the one disposer for an unregistered walker
  //
  // The simulation entity (ActorRegistry player: x, y, angle, areaId) stays the source of truth;
  // this module only mirrors it. A body exists only while the player is in the area this client is
  // showing (zone scenes are built lazily), and is rebuilt on entry (~1-2 s of portrait work).
  //
  // A remote player's look comes from `player.avatarProfile` ({ appearance, equippedCosmetics,
  // appliedDyes }), which the network layer will fill from their character save; with none it
  // falls back to the local player's own look (what the dev dummy uses).

  const SYNC_INTERVAL_MS = 250;     // How often bodies are created/removed (driving is every frame).
  const SNAP_TILES = 3;             // A jump this large (area entry, teleport) snaps instead of walking.
  const RETRY_MS = 5000;            // After a failed build.
  const SCHEDULER_ID = 'RemotePlayerAvatar';

  let deps = null;
  const bodies = new Map();         // player entity -> { walker, area, building, failedAt, speedTiles, last }
  let lastSyncMs = -Infinity;
  let registered = false;

  function init(injected) {
    deps = injected;
    window.CharacterVisuals?.registerProvider?.({
      id: 'remote-players',
      each(area, visit) {
        const kinds = window.CharacterVisuals.KINDS;
        for (const [player, body] of bodies) {
          const root = body.walker?.root;
          if (body.area === area && root?.parent && root.visible !== false && visit(kinds.NPC, root, body.walker, null)) return;
        }
      },
    });
    ensureRegistered();
  }

  function ensureRegistered() {
    if (registered || !window.RuntimeFrameScheduler?.register) return;
    registered = true;
    window.RuntimeFrameScheduler.register(SCHEDULER_ID, frame => update(Math.max(0, Number(frame?.deltaMs) || 0) / 1000), {
      phase: 'post-game', owner: 'RemotePlayerAvatar',
      description: 'Creates/removes and drives the on-screen bodies of non-local players.',
    });
  }

  const tile = () => Number(deps?.TILE) || 64;
  const profileFor = player => player.avatarProfile || deps.getLocalProfile?.() || null;

  async function build(player, body) {
    const profile = profileFor(player);
    if (!profile?.appearance) throw new Error('no appearance to build a remote avatar from');
    const id = window.ActorRegistry?.idOf(player) || 'remote';
    const rec = {
      id: `__remote_player_${id}`, name: player.name || 'Player',
      appearance: profile.appearance, equippedCosmetics: profile.equippedCosmetics || [], appliedDyes: profile.appliedDyes || {},
    };
    const area = deps.getCurrentArea();
    const walker = await deps.makeNpcWalker(rec, { area, c: Math.floor(player.x / tile()), r: Math.floor(player.y / tile()) });
    if (!walker) throw new Error('makeNpcWalker returned nothing');
    // Stale build: the player left, or this client changed area while the portrait rendered.
    if (bodies.get(player) !== body || deps.getCurrentArea() !== area || window.ActorRegistry?.areaOf(player) !== area) {
      deps.despawnWalker(walker, true);
      return null;
    }
    walker.pause = Infinity;               // Never schedule-driven; nothing calls walker.update().
    walker.rec._remotePlayer = true;
    window.NpcPathfinding?.decorateWalkerCollision?.(walker);
    const root = walker.root;
    if (!root.parent) { const sc = deps.getActiveScene?.(); if (sc) { sc.add(root); root._npcScene = sc; } }
    body.walker = walker; body.area = area; body.last = null; body.speedTiles = 0;
    return walker;
  }

  function dispose(player) {
    const body = bodies.get(player);
    if (!body) return;
    bodies.delete(player);
    if (body.walker) { try { window.NpcHeldEquipment?.detachCutsceneWalker?.(body.walker); } catch (_) {} deps.despawnWalker(body.walker, true); }
  }

  // Which remote players should have a body right now, and create/remove accordingly.
  function sync() {
    const reg = window.ActorRegistry;
    if (!deps || !reg) return;
    const here = deps.getCurrentArea();
    const wanted = new Set();
    for (const p of reg.getPlayers()) if (!reg.isLocalPlayer(p) && reg.areaOf(p) === here) wanted.add(p);
    for (const p of Array.from(bodies.keys())) if (!wanted.has(p) || (bodies.get(p).area && bodies.get(p).area !== here)) dispose(p);
    const now = performance.now();
    for (const p of wanted) {
      let body = bodies.get(p);
      if (body?.building || body?.walker) continue;
      if (body?.failedAt && now - body.failedAt < RETRY_MS) continue;
      body = { walker: null, area: null, building: true, failedAt: 0 };
      bodies.set(p, body);
      build(p, body).catch(error => { console.warn('[RemotePlayerAvatar] build failed', error); if (bodies.get(p) === body) body.failedAt = performance.now(); })
        .finally(() => { body.building = false; });
    }
  }

  // Mirror the simulation entity onto the body: position, facing, feet/pants gait.
  function drive(player, body, dt) {
    const walker = body.walker, root = walker?.root;
    if (!root || !root.parent) return;
    const T = tile();
    const tx = player.x / T, tz = player.y / T;
    const dx = tx - root.position.x, dz = tz - root.position.z, dist = Math.hypot(dx, dz);
    if (dist > SNAP_TILES) { root.position.x = tx; root.position.z = tz; }
    else if (dist > 0.0005) { root.position.x = tx; root.position.z = tz; walker._tickFootsteps?.(dist); }
    root.position.y = deps.npcSurfaceY(body.area, Math.floor(tx), Math.floor(tz));
    // Gait from the real displacement (smoothed so network jitter does not flicker the feet).
    const instant = dt > 0 && dist <= SNAP_TILES ? dist / dt : 0;
    body.speedTiles += (instant - body.speedTiles) * Math.min(1, dt * 10);
    walker._moveSpeedTiles = body.speedTiles < 0.02 ? 0 : body.speedTiles;
    walker._lastUpdateDt = dt;
    // Facing: the entity's own angle (px space, atan2(dy, dx)), through the NPC facing rule.
    const heading = Number.isFinite(player.angle) ? player.angle : (dist > 0.0005 ? Math.atan2(dz, dx) : null);
    if (heading !== null) walker.applyFacingDeadzone?.(-heading + Math.PI / 2, 0.15);
    root.rotation.y = Number.isFinite(walker.rot) ? walker.rot : root.rotation.y;
    walker.legs?.update(dt > 0 ? dt : 1 / 60, walker._moveSpeedTiles, false);
    window.NpcHeldEquipment?.updateCutsceneWalker?.(walker);
  }

  function update(dt) {
    if (!deps) return;
    const now = performance.now();
    if (now - lastSyncMs >= SYNC_INTERVAL_MS) { lastSyncMs = now; sync(); }
    for (const [player, body] of bodies) if (body.walker) drive(player, body, dt);
  }

  function disposeAll() { for (const p of Array.from(bodies.keys())) dispose(p); }

  window.RemotePlayerAvatar = {
    init, update, sync, disposeAll,
    has: player => !!bodies.get(player)?.walker,
    getWalker: player => bodies.get(player)?.walker || null,
    debug: () => Array.from(bodies, ([p, b]) => ({ id: window.ActorRegistry?.idOf(p) || null, built: !!b.walker, building: b.building, area: b.area, speedTiles: +(b.speedTiles || 0).toFixed(2), visible: !!b.walker?.root?.parent })),
  };
})();
