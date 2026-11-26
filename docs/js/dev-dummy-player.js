(() => {
  'use strict';

  // DevDummyPlayer — a developer-controlled stand-in for a second (remote)
  // player, used to prove the game works with more than one player BEFORE any
  // networking exists. It is a plain player-shaped entity registered with
  // ActorRegistry (not local), so hostiles target it, projectiles/bites hit it
  // through DamageAuthority -> RemotePlayerState, and it can sit in another
  // area. It has no avatar mesh yet (that is CharacterVisuals work); inspect it
  // with ActorRegistry.getDebug() / RemotePlayerState.debugSnapshot().
  //
  //   DevDummyPlayer.spawn({ x, y, areaId })   DevDummyPlayer.walkTo(x, y)
  //   DevDummyPlayer.follow(true)              DevDummyPlayer.setArea('cave')
  //   DevDummyPlayer.despawn()

  const SPEED_PX_S = 140;
  const KNOCKBACK_DECAY_PER_S = 6;
  let dummy = null;
  let goal = null;
  let following = false;
  let registered = false;

  function update(dt) {
    if (!dummy || window.SharedCutscene?.isFrozen(dummy)) return; // A shared cutscene pauses every player.
    const reg = window.ActorRegistry;
    if (following && reg?.getLocalPlayer()) { const lp = reg.getLocalPlayer(); goal = { x: lp.x + 70, y: lp.y + 40 }; }
    if (!window.RemotePlayerState?.isDowned(dummy) && goal) {
      const dx = goal.x - dummy.x, dy = goal.y - dummy.y, d = Math.hypot(dx, dy);
      if (d > 4) { const step = Math.min(d, SPEED_PX_S * dt); dummy.x += dx / d * step; dummy.y += dy / d * step; dummy.angle = Math.atan2(dy, dx); }
      else if (!following) goal = null;
    }
    if (dummy.vx || dummy.vy) { // Knockback from hits, decaying.
      dummy.x += dummy.vx * dt; dummy.y += dummy.vy * dt;
      const k = Math.max(0, 1 - KNOCKBACK_DECAY_PER_S * dt);
      dummy.vx *= k; dummy.vy *= k;
      if (Math.abs(dummy.vx) < 1 && Math.abs(dummy.vy) < 1) { dummy.vx = 0; dummy.vy = 0; }
    }
  }

  function timeSkip(kind, minutes) {
    return { kind, source: 'dummy', minutes, run: () => { void window.CalendarSystem?.devAdvanceHours?.(Math.max(1, Math.round(minutes / 60))); } };
  }

  function spawn(opts = {}) {
    if (dummy) return dummy;
    const reg = window.ActorRegistry;
    const lp = reg?.getLocalPlayer();
    dummy = {
      x: opts.x ?? ((lp?.x || 0) + 70), y: opts.y ?? ((lp?.y || 0) + 40),
      vx: 0, vy: 0, angle: 0, climbing: false,
      health: 100, maxHealth: 100, stamina: 100, maxStamina: 100,
      areaId: opts.areaId ?? (lp ? reg.areaOf(lp) : null),
      isDummyPlayer: true, name: 'Dummy',
    };
    reg.registerPlayer(dummy, { playerId: 'dummy-player' });
    window.RemotePlayerState?.attach(dummy);
    if (!registered && window.RuntimeFrameScheduler?.register) {
      window.RuntimeFrameScheduler.register('DevDummyPlayer', frame => update(Math.max(0, Number(frame?.deltaMs) || 0) / 1000), {
        phase: 'pre-game', owner: 'DevDummyPlayer', description: 'Walks/follows the dev dummy second player and integrates its knockback.',
      });
      registered = true;
    }
    return dummy;
  }

  function despawn() {
    if (!dummy) return false;
    window.RemotePlayerState?.detach(dummy);
    window.ActorRegistry.unregisterPlayer(dummy);
    dummy = null; goal = null; following = false;
    return true;
  }

  window.DevDummyPlayer = {
    spawn, despawn, update,
    get: () => dummy,
    walkTo(x, y) { goal = { x, y }; following = false; },
    follow(on = true) { following = on === true; if (!following) goal = null; },
    setArea(areaId) { if (dummy) dummy.areaId = areaId; },
    // Time rules (js/time-consensus.js), driven from the console. A winning skip advances the clock via the dev hour-advance.
    sleep(minutes = 600) { return dummy && window.TimeConsensus?.requestRest(dummy, timeSkip('sleep', minutes)); },
    knockOut(minutes = 120) { return dummy && window.TimeConsensus?.knockOut(dummy, timeSkip('blackout', minutes)); },
    reviveDummy() { const lp = window.ActorRegistry?.getLocalPlayer(); return !!dummy && window.TimeConsensus?.revive(dummy, lp); }, // The local player revives the dummy.
    reviveLocal() { const lp = window.ActorRegistry?.getLocalPlayer(); return !!dummy && window.TimeConsensus?.revive(lp, dummy); }, // The dummy revives the local player.
    wake() { return !!dummy && window.TimeConsensus?.cancelRest(dummy); },
    setPosition(x, y) { if (dummy) { dummy.x = x; dummy.y = y; } },
  };
})();
