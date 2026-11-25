(() => {
  'use strict';

  // TimeConsensus — who is allowed to advance the world clock in a co-op
  // session (up to ActorRegistry.MAX_PLAYERS). Time is global, so the rules
  // live here once and every skip source (beds, Wait/Sleep menu, alcohol
  // blackout, Rootledoot defeat, later Ikthi) goes through it:
  //
  //  * Voluntary rest/sleep  - time only advances when EVERY player is resting
  //    or knocked out. The first sleeper waits for the others.
  //  * Forced skips (alcohol blackout, fey kills) - the victim is KNOCKED OUT.
  //    Another player must revive them within REVIVE_WINDOW_MS or the skip
  //    happens. Each knocked-out player has their own window.
  //  * Several queued skips - the LONGEST wins (one skip, applied once).
  //  * A knocked-out player counts as asleep, so when everyone else is resting
  //    (or nobody is left awake to revive) the skip fires immediately.
  //  * Resting is cancelled if the player walks away from where they lay down.
  //
  // With fewer than two registered players nothing here is used: callers check
  // shouldGate() and keep their original immediate code path.
  //
  // A skip is a descriptor supplied by whoever requested it:
  //   { kind, source, minutes, run(resolution), onResolved(resolution), onRevived(by) }
  // `minutes` only ranks skips against each other. Only the WINNER's run() is
  // called (it applies the global time change); every participant's onResolved()
  // is called afterwards for that player's own side effects (travel, healing).

  const REVIVE_WINDOW_MS = 60000;
  const MOVE_CANCEL_PX = 48; // Walking this far from where they lay down cancels a rest.

  const entries = new Map();   // player -> { type:'rest'|'knockout', desc, at, anchor, expiresAt }
  const lastResolution = new WeakMap(); // player -> resolution not yet consumed
  const listeners = new Set();
  let hooks = { onKnockoutStart: null, onKnockoutEnd: null, tilePx: 64 };
  let firing = false;
  let ticking = false;
  let seq = 0;

  const clock = () => (window.SimClock ? window.SimClock.now() : performance.now());
  const registry = () => window.ActorRegistry;

  function init(opts = {}) { hooks = { ...hooks, ...opts }; }
  function emit(type, player, extra) {
    const ev = { type, id: registry()?.idOf(player) || null, ...extra };
    for (const fn of listeners) { try { fn(ev); } catch (e) { console.warn('[TimeConsensus] listener failed', e); } }
  }
  const onEvent = fn => { if (typeof fn === 'function') { listeners.add(fn); return () => listeners.delete(fn); } return () => {}; };

  const shouldGate = () => (registry()?.playerCount() || 0) >= 2;
  const stateOf = player => { const e = entries.get(player); return e ? (e.type === 'knockout' ? 'knockedOut' : 'resting') : 'none'; };
  const isKnockedOut = player => stateOf(player) === 'knockedOut';

  function ensureTicking() {
    if (ticking || !window.RuntimeFrameScheduler?.register) return;
    window.RuntimeFrameScheduler.register('TimeConsensus', () => tick(), {
      phase: 'pre-game', owner: 'TimeConsensus', description: 'Expires revive windows and cancels rests when a sleeper walks away.',
    });
    ticking = true;
  }

  function lengthOf(desc) { return Math.max(0, Number(desc?.minutes) || 0); }

  // Fire when nobody is left awake (every player resting or knocked out), or a
  // knocked-out player's revive window ran out.
  function evaluate() {
    if (firing || !entries.size) return null;
    const reg = registry();
    const players = reg ? reg.getPlayers() : [];
    const now = clock();
    let reason = null;
    for (const e of entries.values()) if (e.type === 'knockout' && now >= e.expiresAt) { reason = 'revive-window-expired'; break; }
    if (!reason && players.length && players.every(p => entries.has(p))) {
      reason = Array.from(entries.values()).some(e => e.type === 'rest') ? 'everyone-resting' : 'nobody-to-revive';
    }
    return reason ? resolve(reason) : null;
  }

  function resolve(reason) {
    const queued = Array.from(entries, ([player, e]) => ({ player, ...e }));
    let winner = queued[0];
    for (const q of queued) if (lengthOf(q.desc) > lengthOf(winner.desc) || (lengthOf(q.desc) === lengthOf(winner.desc) && q.at < winner.at)) winner = q;
    const resolution = {
      reason, seq: ++seq,
      winner: { id: registry()?.idOf(winner.player) || null, kind: winner.desc.kind, source: winner.desc.source || null, minutes: lengthOf(winner.desc) },
      participants: queued.map(q => ({ id: registry()?.idOf(q.player) || null, type: q.type, kind: q.desc.kind, minutes: lengthOf(q.desc) })),
    };
    const wasKnockedOut = queued.filter(q => q.type === 'knockout');
    entries.clear();
    firing = true;
    try {
      try { winner.desc.run?.(resolution); } catch (e) { console.warn('[TimeConsensus] skip failed', e); }
      for (const q of queued) {
        lastResolution.set(q.player, resolution);
        try { q.desc.onResolved?.(resolution); } catch (e) { console.warn('[TimeConsensus] onResolved failed', e); }
      }
      for (const q of wasKnockedOut) { try { hooks.onKnockoutEnd?.(q.player, 'resolved'); } catch (e) { console.warn(e); } }
    } finally { firing = false; }
    emit('resolved', winner.player, { resolution });
    return resolution;
  }

  // Voluntary rest/sleep/wait. Returns { state:'waiting' } or { state:'resolved', resolution }.
  function requestRest(player, desc) {
    ensureTicking();
    const existing = entries.get(player);
    if (existing?.type === 'knockout') return { state: 'waiting' }; // Out cold: cannot also choose to rest.
    if (existing && lengthOf(existing.desc) >= lengthOf(desc)) return { state: 'waiting' };
    entries.set(player, { type: 'rest', desc, at: clock(), anchor: { x: player.x, y: player.y }, expiresAt: Infinity });
    emit('rest', player, { kind: desc.kind, minutes: lengthOf(desc) });
    const resolution = evaluate();
    return resolution ? { state: 'resolved', resolution } : { state: 'waiting' };
  }

  // Forced skip: the player is knocked out for REVIVE_WINDOW_MS.
  function knockOut(player, desc) {
    ensureTicking();
    const existing = entries.get(player);
    const now = clock();
    if (existing?.type === 'knockout') { // A second forced skip while out: the longer one wins; the window does not extend.
      if (lengthOf(desc) > lengthOf(existing.desc)) existing.desc = desc;
    } else {
      entries.set(player, { type: 'knockout', desc, at: now, anchor: { x: player.x, y: player.y }, expiresAt: now + REVIVE_WINDOW_MS });
      try { hooks.onKnockoutStart?.(player); } catch (e) { console.warn(e); }
    }
    emit('knockout', player, { kind: desc.kind, minutes: lengthOf(desc) });
    const resolution = evaluate();
    return resolution ? { state: 'resolved', resolution } : { state: 'waiting', remainingMs: remainingMs(player) };
  }

  // Another standing player brings a knocked-out one round. Cancels that
  // player's own skip (the others' stay queued).
  function revive(target, by, opts = {}) {
    const e = entries.get(target);
    if (!e || e.type !== 'knockout' || !by || by === target) return false;
    if (entries.get(by)?.type === 'knockout') return false;
    if (Number(by.health) <= 0) return false;
    const maxPx = opts.maxDistancePx ?? hooks.tilePx * 2.5;
    if (maxPx > 0 && Math.hypot(by.x - target.x, by.y - target.y) > maxPx) return false;
    entries.delete(target);
    try { hooks.onKnockoutEnd?.(target, 'revived'); } catch (err) { console.warn(err); }
    try { e.desc.onRevived?.(by); } catch (err) { console.warn(err); }
    emit('revive', target, { by: registry()?.idOf(by) || null });
    return true;
  }

  function cancelRest(player) {
    const e = entries.get(player);
    if (!e || e.type !== 'rest') return false;
    entries.delete(player);
    emit('cancel', player, {});
    return true;
  }

  // Latest resolution this player took part in (returned once).
  function consumeResolution(player) {
    const r = lastResolution.get(player) || null;
    if (r) lastResolution.delete(player);
    return r;
  }

  function tick() {
    if (!entries.size) return null;
    const reg = registry();
    for (const [player, e] of Array.from(entries)) {
      if (reg && !reg.isPlayer(player)) { // Left the session.
        entries.delete(player);
        if (e.type === 'knockout') { try { hooks.onKnockoutEnd?.(player, 'left'); } catch (err) { console.warn(err); } }
        continue;
      }
      if (e.type === 'rest' && Math.hypot(player.x - e.anchor.x, player.y - e.anchor.y) > MOVE_CANCEL_PX) { entries.delete(player); emit('cancel', player, { reason: 'moved' }); }
    }
    return evaluate();
  }

  function remainingMs(player) {
    const e = entries.get(player);
    return e?.type === 'knockout' ? Math.max(0, e.expiresAt - clock()) : 0;
  }

  window.TimeConsensus = {
    REVIVE_WINDOW_MS, MOVE_CANCEL_PX,
    init, shouldGate, requestRest, knockOut, revive, cancelRest, consumeResolution, tick, onEvent,
    stateOf, isKnockedOut, remainingMs,
    snapshot: () => Array.from(entries, ([p, e]) => ({ id: registry()?.idOf(p) || null, type: e.type, kind: e.desc.kind, source: e.desc.source || null, minutes: lengthOf(e.desc), remainingMs: remainingMs(p) })),
  };
})();
