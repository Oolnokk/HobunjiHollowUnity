// "Ask for seat": while an NPC sits anywhere (inn, temple, festival table...), the hold-Action "More" wheel can ask them to give
// up the chair. Anyone at zero or more hearts agrees: they stand, the player sits in the same physical seat, and the NPC carries on
// as if they had just arrived (the festival meal routine or the ordinary social-seating chooser picks them another free seat).
(() => {
  'use strict';
  let deps = null; // Game-owned adapters: area, player seating, blocking UI, toasts.
  const HEARTS_REQUIRED = 0;
  const ACCEPT = ['Of course, have it.', 'Sure, take my seat.', 'Go right ahead.', 'Please, sit. I will find another.', 'Happy to make room.'];
  const REFUSE = ['I was sitting here.', 'Not just now. Sorry.', 'I would rather keep my seat.'];
  const debug = { latestChange:'Any seated NPC at zero or more hearts hands the player their chair.', lastRequest:null };
  function init(injected) { deps = injected || {}; }
  function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function hearts(id) {
    const hearts = window.NpcFavorBalance?.relationshipHeartsForNpc?.(id);
    return Number.isFinite(hearts) ? hearts : (Number(window.DialogueContent?.getNpcDlgState?.(id)?.favor) || 0) / 40;
  }
  // The seat an NPC is physically sitting in right now (arrived, seated pose), or null. Cheap: read by the wheel every 100 ms.
  function seatedTarget(walker) {
    const target = walker?.currentScheduleTarget;
    if (!walker?._seatedStationKey || target?.pose !== 'sit' || !target.furnitureKey) return null;
    return walker.area === deps?.getArea?.() ? target : null;
  }
  function canAsk(walker) {
    if (!deps || !seatedTarget(walker) || deps.isPlayerSeated?.() || deps.isBlocked?.()) return false;
    return !window.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(walker.rec?.id);
  }
  function optionsFor(walker) {
    return canAsk(walker) ? [{ id:'ask-seat', icon:'🪑', label:'Ask for seat', run:() => ask(walker) }] : [];
  }
  function say(walker, accepted, text) {
    if (window.AmbientDialogue?.showSocialResponse) window.AmbientDialogue.showSocialResponse(walker, { text, line:text, accepted, reason:'seat' });
    else deps?.toast?.(`${walker.rec?.name || 'They'}: ${text}`, accepted);
  }
  // A tile beside the chair, as close to the player as possible, clear of walls, furniture and other bodies.
  function standSpot(walker, seat) {
    const area = walker.area, origin = walker.root.position, player = deps.getPlayerPosition?.() || origin;
    const others = (deps.getWalkers?.() || []).filter(w => w !== walker && w.area === area && w.root);
    let best = null, bestScore = Infinity;
    for (const radius of [1, 1.5, 2]) {
      for (let step = 0; step < 16; step++) {
        const angle = step * Math.PI / 8, x = seat.x + Math.cos(angle) * radius, z = seat.z + Math.sin(angle) * radius;
        if (window.NpcPathfinding?.isNpcPositionWalkable?.(area, x, z) === false) continue;
        if (others.some(w => Math.hypot(w.root.position.x - x, w.root.position.z - z) < .55) || Math.hypot(player.x - x, player.z - z) < .6) continue;
        const score = radius * .6 + Math.hypot(player.x - x, player.z - z);
        if (score < bestScore) { bestScore = score; best = { x, z }; }
      }
      if (best) break;
    }
    return best;
  }
  function vacate(walker, target) {
    const id = walker.rec.id, here = { x:walker.root.position.x, z:walker.root.position.z };
    window.FurnitureTableSystem?.setSeatTarget?.(id, null); // Drop the reservation first so the player may take the seat.
    window.NpcDrinkInteraction?.stopAutonomous?.(walker);
    window.NpcSharedMeals?.reseat?.(id); // Festival diners keep their bowl and look for another chair by table preference.
    const spot = standSpot(walker, here);
    if (spot) { walker.root.position.x = spot.x; walker.root.position.z = spot.z; }
    walker._seatedStationKey = null; walker._gridPath = null; walker.state = 'idle';
    walker.resetRouteState?.();
    walker.currentScheduleTarget = null; // No stale 'sit' target may keep reserving the chair; the next update resolves a fresh one.
  }
  function ask(walker) {
    const target = seatedTarget(walker);
    if (!target || deps.isPlayerSeated?.()) return { ok:false };
    const id = walker.rec.id, score = hearts(id);
    debug.lastRequest = { npcId:id, hearts:score, at:Date.now() };
    if (score < HEARTS_REQUIRED) { say(walker, false, REFUSE[hash(id) % REFUSE.length]); debug.lastRequest.accepted = false; return { ok:false, refused:true }; }
    if (deps.canSit?.() === false) { deps.toast?.('You cannot sit down right now.', false); return { ok:false }; }
    const seat = { ...target };
    vacate(walker, seat);
    const result = deps.beginSitAtTarget?.(seat) || { ok:false };
    debug.lastRequest.accepted = !!result.ok;
    if (!result.ok) { deps.toast?.(result.message || 'Nowhere to sit there.', false); return result; } // The NPC simply reclaims it on their next update.
    say(walker, true, ACCEPT[hash(`${id}:${Math.floor((deps.now?.() ?? 0) / 60000)}`) % ACCEPT.length]);
    deps.toast?.(`You take ${walker.rec.name ? `${walker.rec.name}'s` : 'their'} seat.`, true);
    return { ok:true };
  }
  window.NpcSeatRequest = { init, optionsFor, canAsk, ask, hearts, diagnostics:() => ({ ...debug }), HEARTS_REQUIRED };
})();
