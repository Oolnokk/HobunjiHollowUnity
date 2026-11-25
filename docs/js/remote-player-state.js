(() => {
  'use strict';

  // RemotePlayerState — damage, downed/bleed-out and respawn for every player
  // that is NOT the local avatar (a connected guest on the host, or the dev
  // dummy). The local avatar keeps its richer path (damagePlayer +
  // js/player-downed.js, which own HUD, crawl and mounts); this module is the
  // same *rules* as pure simulation state with no HUD, so each remote player
  // has independent health, bleed-out timer and invulnerability.
  //
  // It registers itself as DamageAuthority's remote-player handler, so
  // `DamageAuthority.hit(remotePlayer, ...)` lands here instead of nowhere.
  //
  // Rules mirror PlayerDowned.CONFIG: lethal damage puts a player down at 1
  // Health with a bleed-out timer; each hit while down costs time; a kill by
  // the player (or their companion) revives them at half Health; running out
  // of time respawns them.

  const DEFAULTS = { bleedOutSeconds: 30, reviveHealthFraction: 0.5, hitPenaltySeconds: 2, reviveInvulnSeconds: 1.5, downedHealth: 1 };
  const cfg = () => ({ ...DEFAULTS, ...(window.PlayerDowned?.CONFIG || {}) });
  const clockNow = () => (window.SimClock ? window.SimClock.now() : performance.now());

  const states = new WeakMap();        // player -> { remainingS }
  const tracked = new Set();           // players being ticked
  const listeners = new Set();
  let respawnPoint = null;             // (player) => { x, y, areaId? } | null
  let ticking = false;

  const emit = (type, player, extra) => {
    const ev = { type, id: window.ActorRegistry?.idOf(player) || null, ...extra };
    for (const fn of listeners) { try { fn(ev); } catch (e) { console.warn('[RemotePlayerState] listener failed', e); } }
    return ev;
  };
  const onEvent = fn => { if (typeof fn === 'function') { listeners.add(fn); return () => listeners.delete(fn); } return () => {}; };
  const setRespawnPoint = fn => { respawnPoint = typeof fn === 'function' ? fn : null; };

  function attach(player) {
    if (!player) return;
    window.ResourceSystem?.initEntity?.(player);
    if (!Number.isFinite(player.maxHealth)) player.maxHealth = 100;
    if (!Number.isFinite(player.health)) player.health = player.maxHealth;
    tracked.add(player);
    ensureTicking();
  }
  function detach(player) { tracked.delete(player); states.delete(player); if (player) player._downed = false; }

  const isDowned = p => !!p && states.has(p);
  const remainingBleedOutS = p => states.get(p)?.remainingS ?? 0;

  function down(player, reason) {
    states.set(player, { remainingS: cfg().bleedOutSeconds });
    player.health = cfg().downedHealth;
    player._downed = true;
    player.vx = 0; player.vy = 0;
    player.invulnUntil = 0;
    emit('down', player, { reason });
  }

  function revive(player, reason) {
    if (!states.has(player)) return false;
    states.delete(player);
    player._downed = false;
    const c = cfg();
    const max = window.ResourceSystem?.getEffectiveMax?.(player, 'health') || player.maxHealth || 100;
    player.health = Math.max(1, Math.round(max * c.reviveHealthFraction));
    player.invulnUntil = clockNow() + c.reviveInvulnSeconds * 1000;
    emit('revive', player, { reason });
    return true;
  }

  function die(player, reason) {
    states.delete(player);
    player._downed = false;
    const spot = respawnPoint?.(player);
    if (spot) { player.x = spot.x; player.y = spot.y; if (spot.areaId != null) player.areaId = spot.areaId; }
    player.vx = 0; player.vy = 0;
    player.health = player.maxHealth || 100;
    player.invulnUntil = clockNow() + cfg().reviveInvulnSeconds * 1000;
    emit('death', player, { reason });
  }

  // DamageAuthority remote handler. Returns { applied, lethal } like the
  // environmental-impact path of damagePlayer.
  function applyHit(player, amount, fromX, fromY, knockbackPxS, opts) {
    if (!tracked.has(player)) attach(player);
    const env = opts?.environmentalImpact === true;
    if (states.has(player)) { // Down: a hit only shortens the timer.
      if (!env) states.get(player).remainingS = Math.max(0, states.get(player).remainingS - cfg().hitPenaltySeconds);
      return { applied: 0, lethal: false };
    }
    if (!env && clockNow() < (Number(player.invulnUntil) || 0)) return { applied: 0, lethal: false };
    const before = Math.max(0, Number(player.health) || 0);
    if (window.ResourceSystem?.applyDamage) window.ResourceSystem.applyDamage(player, amount, opts || {});
    else player.health = Math.max(0, before - amount);
    const after = Math.max(0, Number(player.health) || 0);
    if (after > 0 && !env && fromX !== undefined && knockbackPxS) { // Owner of the position integrates this push.
      const dx = player.x - fromX, dy = player.y - fromY, len = Math.hypot(dx, dy) || 1;
      player.vx = (dx / len) * knockbackPxS; player.vy = (dy / len) * knockbackPxS;
    }
    const lethal = after <= 0;
    emit('hit', player, { amount, applied: before - after, lethal });
    if (lethal) { if (env) die(player, 'impact'); else down(player, 'damage'); }
    return { applied: before - after, lethal };
  }

  // The player (or their companion) killed an enemy: Second Wind.
  const noteKillBy = player => revive(player, 'kill');

  function update(dt) {
    for (const p of tracked) {
      const s = states.get(p);
      if (s) { s.remainingS -= dt; if (s.remainingS <= 0) die(p, 'bleed-out'); }
    }
  }

  function ensureTicking() {
    if (ticking || !window.RuntimeFrameScheduler?.register) return;
    window.RuntimeFrameScheduler.register('RemotePlayerState', frame => update(Math.max(0, Number(frame?.deltaMs) || 0) / 1000), {
      phase: 'pre-game', owner: 'RemotePlayerState', description: 'Bleed-out timers and respawn for non-local players.',
    });
    ticking = true;
  }

  // Time rules (js/time-consensus.js) for non-local players: a knocked-out remote player is down
  // (so hostiles/targeting skip them) until revived or the skip lands; sleepers wake rested.
  function remotePlayerFor(id) { const reg = window.ActorRegistry; const p = id ? reg?.getById(id) : null; return p && reg.isPlayer(p) && !reg.isLocalPlayer(p) ? p : null; }
  window.TimeConsensus?.onEvent?.(ev => {
    if (ev.type === 'knockout') { const p = remotePlayerFor(ev.id); if (p) { p._downed = true; p.vx = 0; p.vy = 0; } }
    else if (ev.type === 'revive') { const p = remotePlayerFor(ev.id); if (p && !isDowned(p)) p._downed = false; }
    else if (ev.type === 'resolved') {
      for (const part of ev.resolution.participants) {
        const p = remotePlayerFor(part.id); if (!p) continue;
        if (!isDowned(p)) p._downed = false;
        if (part.type === 'rest') { p.health = p.maxHealth || p.health; p.stamina = p.maxStamina || p.stamina; } // Slept: restored, like sleepInBed.
        else if (Number(p.health) > 0 && Number(p.health) < 1) p.health = 1;
      }
    }
  });

  window.RemotePlayerState = {
    attach, detach, applyHit, noteKillBy, revive, update, isDowned, remainingBleedOutS, onEvent, setRespawnPoint,
    debugSnapshot: () => Array.from(tracked).map(p => ({ id: window.ActorRegistry?.idOf(p), health: p.health, downed: isDowned(p), remainingS: remainingBleedOutS(p) })),
  };
  window.DamageAuthority?.setRemotePlayerHandler?.(applyHit); // Hits on any non-local player land here.
})();
