(() => {
  'use strict';

  // NpcConversations - who is talking to which NPC, for a co-op session (js/actor-registry.js).
  //
  // Rule: an ordinary NPC conversation holds ONLY the person talking. The world, the clock and
  // every other player keep running; the only other thing it freezes is the NPC being spoken to
  // (they stand still and listen). So:
  //  * one conversation per NPC at a time: a second player gets { ok:false, by } ("busy") and the
  //    NPC is left alone, instead of two players driving one dialogue;
  //  * one NPC per player: starting another conversation ends the previous one;
  //  * a remote player's conversation (host side) holds that NPC and freezes that player
  //    (`_inDialogue`, input ignored by the host) until it ends, they disconnect, or they leave;
  //  * the local player's own dialogue UI/camera/pause stay owned by game.js (openNpcDialogue /
  //    closeNpcDialogue), which only has to ask permission here and report the end.
  //
  // Cutscenes are different: a SCENE pauses everyone (js/shared-cutscene.js).

  const byWalker = new Map();   // walker -> { player, ownsPause, prevPause }
  const byPlayer = new Map();   // player -> walker
  const listeners = new Set();
  let unsubscribe = null;

  const registry = () => window.ActorRegistry;
  function emit(type, player, walker, extra) {
    const ev = { type, playerId: registry()?.idOf(player) || null, npcId: walker?.rec?.id || null, ...extra };
    for (const fn of listeners) { try { fn(ev); } catch (e) { console.warn('[NpcConversations] listener failed', e); } }
  }
  const onEvent = fn => { if (typeof fn === 'function') { listeners.add(fn); return () => listeners.delete(fn); } return () => {}; };

  function watchSession() {
    if (unsubscribe || !registry()?.onPlayersChanged) return;
    unsubscribe = registry().onPlayersChanged((type, player) => { if (type === 'remove') end(player, 'left'); }); // A disconnect must not leave an NPC frozen.
  }

  const speakerOf = walker => byWalker.get(walker)?.player || null;
  const walkerOf = player => byPlayer.get(player) || null;
  const isTalking = player => byPlayer.has(player);
  // Busy for `forPlayer` when someone else is already talking to it.
  const isBusy = (walker, forPlayer = null) => { const s = speakerOf(walker); return !!s && s !== forPlayer; };

  // ownsPause: true for remote players, whose NPC freeze this module applies and releases. The
  // local player's game.js sets/clears walker.pause itself.
  function begin(player, walker, { ownsPause = false } = {}) {
    if (!player || !walker) return { ok: false, by: null };
    watchSession();
    const holder = speakerOf(walker);
    if (holder && holder !== player) return { ok: false, by: holder };
    if (byPlayer.get(player) === walker) return { ok: true, by: player };
    if (byPlayer.has(player)) end(player, 'switched');
    byWalker.set(walker, { player, ownsPause, prevPause: walker.pause });
    byPlayer.set(player, walker);
    if (ownsPause) { walker.pause = Infinity; }
    if (!registry()?.isLocalPlayer(player)) { player._inDialogue = true; player.vx = 0; player.vy = 0; }
    emit('begin', player, walker);
    return { ok: true, by: player };
  }

  function end(player, reason = 'closed') {
    const walker = byPlayer.get(player);
    if (!walker) return false;
    const rec = byWalker.get(walker);
    byPlayer.delete(player);
    byWalker.delete(walker);
    if (rec?.ownsPause) walker.pause = rec.prevPause === Infinity ? 0 : (rec.prevPause || 0); // Back to the schedule; never restore a stale "frozen".
    player._inDialogue = false;
    emit('end', player, walker, { reason });
    return true;
  }

  window.NpcConversations = {
    begin, end, speakerOf, walkerOf, isTalking, isBusy, onEvent,
    snapshot: () => Array.from(byPlayer, ([p, w]) => ({ playerId: registry()?.idOf(p) || null, npcId: w?.rec?.id || null })),
  };
})();
