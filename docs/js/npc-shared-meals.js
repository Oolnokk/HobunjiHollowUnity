// Reusable gathering routine: ordinary schedule targets drive every walk; shared chairs own reservations.
(() => {
  'use strict';
  let deps = null; // Gathering owner supplies hours, authored destinations, social bonds and presentation adapters.
  let pendingStations = false; // Retry destinations while an asynchronously built map is registering its stations.
  let layout = null; // Cached destination source, rebuilt only when the editor/calendar changes its map object.
  let seats = [], bowls = [], pots = [], queues = [], alternatives = [], musicians = []; // Authored station targets grouped once per layout.
  const states = new Map(); // Transient per-NPC meal/locale progress; never mutates shared NPC records.
  const byWalker = new Map(); // Refreshed by the existing gathering tick, rather than scanning the crowd in each schedule probe.
  function random() { return deps?.random?.() ?? Math.random(); }
  function release(state) {
    window.FurnitureTableSystem?.setSeatTarget?.(state.id, null);
    deps?.clearCarry?.(state.id, byWalker.get(state.id));
  }
  function clear() { for (const state of states.values()) release(state); states.clear(); byWalker.clear(); layout = null; }
  function init(injected) { clear(); deps = injected; }
  function refreshLayout() {
    const next = deps?.getLayout?.(); // The effective map retains identity until a layout/editor change.
    if (next === layout && !pendingStations) return;
    if (next !== layout) { clear(); layout = next; }
    pendingStations = false;
    seats = []; bowls = []; pots = []; queues = []; alternatives = []; musicians = [];
    for (const station of next?.npcStations || []) {
      if (!station.mealRole && station.festivalRole !== 'musician' && station.festivalLocaleKind !== 'dance' && !(station.pose === 'sit' && station.tableId)) continue;
      const target = window.NpcScheduling?.resolveNpcStationTarget?.(station.id);
      if (!target) { pendingStations = true; continue; }
      const choice = { ...target, stationId:station.id, mealRole:station.mealRole, festivalNpcId:station.festivalNpcId }; // Resolved once, including physical furniture/table IDs.
      if (station.mealRole === 'bowls') bowls.push(choice);
      else if (station.mealRole === 'fill') pots.push(choice);
      else if (station.mealRole === 'queue') queues.push(choice);
      else if (station.festivalRole === 'musician') musicians.push(choice);
      else if (station.pose === 'sit' && station.tableId) seats.push(choice);
      else if (station.festivalLocaleKind === 'dance') alternatives.push(choice);
    }
  }
  function occupied(target, id) {
    if (target.pose === 'sit' && window.FurnitureTableSystem?.isSeatTaken?.(target.area, target, id)) return true;
    for (const state of states.values()) if (state.id !== id && state.target?.stationId === target.stationId) return true;
    return false;
  }
  function choose(list, state) {
    const start = Math.floor(random()*list.length); // Sample only on a phase change, never in per-frame target queries.
    for (let n = 0; n < list.length; n++) {
      const target = list[(start+n)%list.length];
      if (!occupied(target,state.id) && deps.canStandAt?.(target.area,target.c,target.r) !== false) return target;
    }
    return null;
  }
  function setPhase(state, phase, target, now, duration = 0) {
    if (state.target?.pose === 'sit' && target !== state.target) window.FurnitureTableSystem?.setSeatTarget?.(state.id,null);
    state.phase = phase; state.target = target; state.since = now; state.until = now+duration;
    if (target?.pose === 'sit') window.FurnitureTableSystem?.setSeatTarget?.(state.id,target);
  }
  function waitTarget(state) {
    return choose(queues,state) || state.wait; // Full queues wait at the NPC's current clear position, without a shared fallback tile.
  }
  function goBuffet(state, now) {
    state.hasBowl = false; state.hasMeal = false; release(state);
    const target = choose(bowls,state);
    setPhase(state,target?'walk-bowl':'queue',target||waitTarget(state),now);
  }
  function goOther(state, now) {
    release(state); state.hasBowl = false; state.hasMeal = false;
    setPhase(state,'other',choose(alternatives,state)||state.wait,now,20+random()*25);
  }
  function chooseSeat(state) {
    let best = null, score = -Infinity; // Existing household/workplace/friend weights favor tables containing familiar NPCs.
    for (const target of seats) {
      if (occupied(target,state.id)) continue;
      if (!window.FurnitureTableSystem?.tableForSeat?.(target.area,target)) continue;
      let value = random()*.3;
      for (const other of states.values()) if (other.id !== state.id && other.target?.pose === 'sit' && other.target.tableId === target.tableId) value += state.bonds.get(other.id)||0;
      for (const member of window.FurnitureTableSystem.members(target.area,target.tableId)) {
        if (!states.has(member.id)) value += state.bonds.get(member.id)||0;
      }
      if (value > score) { score = value; best = target; }
    }
    return best;
  }
  function arrived(walker, target) {
    if (!walker?.root || !target || walker.area !== target.area) return false;
    const seat = target.pose === 'sit' ? window.FurnitureTableSystem?.seatTransform?.(target.area,target) : null;
    return Math.hypot(walker.root.position.x-(seat?.x ?? target.c+.5),walker.root.position.z-(seat?.z ?? target.r+.5)) < .36;
  }
  function targetFor(rec) {
    if (!deps?.enabled?.()) return null;
    if (!layout) refreshLayout();
    let state = states.get(rec.id); // Cached targets make regular pathfinding queries constant-time.
    if (!state) {
      const walker = byWalker.get(rec.id) || deps.getWalkers?.().find(w => w.rec?.id === rec.id);
      const fallback = alternatives[0] || queues[0];
      const wait = walker?.root ? {area:walker.area,c:walker.root.position.x-.5,r:walker.root.position.z-.5,pose:'stand'} : fallback;
      if (!wait) return null;
      state = {id:rec.id,rec,phase:'new',target:null,wait,bonds:deps.companions?.(rec)||new Map(),hasBowl:false,hasMeal:false,bites:0,nextBite:0};
      states.set(rec.id,state);
      if (random()<.65) goBuffet(state,deps.minutes()); else goOther(state,deps.minutes());
    }
    return state.target;
  }
  function update() {
    if (!deps?.enabled?.()) { if (states.size) clear(); return; }
    if (deps.paused?.()) return;
    refreshLayout(); byWalker.clear();
    for (const walker of deps.getWalkers?.() || []) byWalker.set(walker.rec?.id,walker);
    const now = deps.minutes(); // Game time pauses and midnight remain owned by the existing calendar.
    for (const state of states.values()) {
      const walker = byWalker.get(state.id);
      if (state.rec.dead || state.rec.deceased) { release(state); states.delete(state.id); continue; }
      if (walker?.currentScheduleTarget?.overrideOwner && walker.currentScheduleTarget.overrideOwner !== deps.owner) {
        release(state); states.delete(state.id); continue; // Follow, dates and emergencies retain ownership.
      }
      if (state.target?.pose === 'sit') window.FurnitureTableSystem?.setSeatTarget?.(state.id,state.target); // Renew leases at the shared gathering rate.
      const musician = musicians.find(target => target.festivalNpcId === state.id && deps.isMusician?.(state.rec));
      if (musician) { if (state.phase !== 'musician') { release(state); setPhase(state,'musician',musician,now); } continue; }
      if (state.phase === 'musician') goOther(state,now);
      if (state.phase === 'other') { if (now >= state.until) goBuffet(state,now); continue; }
      if (state.phase === 'queue') {
        const target = choose(bowls,state); if (target) setPhase(state,'walk-bowl',target,now);
        else if (now-state.since>35) goOther(state,now);
        continue;
      }
      if (state.phase === 'walk-bowl' && arrived(walker,state.target)) setPhase(state,'take-bowl',state.target,now,1);
      if (state.phase === 'take-bowl' && now >= state.until) { state.hasBowl = true; setPhase(state,'seek-pot',state.target,now); }
      if (state.phase === 'seek-pot') {
        const target = choose(pots,state); if (target) setPhase(state,'walk-pot',target,now);
        else if (now-state.since>35) goOther(state,now);
      }
      if (state.phase === 'walk-pot' && arrived(walker,state.target)) setPhase(state,'fill-bowl',state.target,now,2);
      if (state.phase === 'fill-bowl' && now >= state.until) { state.hasMeal = true; setPhase(state,'seek-seat',waitTarget(state),now); }
      if (state.phase === 'seek-seat') {
        const seat = chooseSeat(state); if (seat) setPhase(state,'walk-seat',seat,now);
        else if (now-state.since>35) goOther(state,now);
      }
      if (state.phase === 'walk-seat') {
        if (occupied(state.target,state.id)) setPhase(state,'seek-seat',waitTarget(state),now);
        else if (arrived(walker,state.target)) { setPhase(state,'eating',state.target,now,20+random()*20); state.nextBite=now+3; }
      }
      if (state.phase === 'eating') {
        if (now>=state.until) { if(random()<.5)goBuffet(state,now);else goOther(state,now); continue; }
        if (now>=state.nextBite) {
          state.bites++; state.nextBite=now+4+random()*5;
          if (deps.visible?.(walker)) deps.playEat?.(walker);
        }
      }
      if (state.hasBowl && deps.visible?.(walker)) deps.carryBowl?.(walker,state.id);
      else deps.clearCarry?.(state.id,walker);
      if (state.phase.startsWith('walk-') && now-state.since>60) goOther(state,now); // Recover blocked routes without teleporting or taking another NPC's seat.
    }
  }
  function interrupt(id) { const state=states.get(id); if(!state)return; release(state); states.delete(id); } // An accepted social invitation releases its meal/seat before approaching.
  function diagnostics() {
    return { latestChange:'NPCs queue, take/fill bowls, prefer family/friend tables, eat and then repeat or change locales.',
      pendingStations,seats:seats.length,bowlSpots:bowls.length,servingSpots:pots.length,queueSpots:queues.length,
      actors:[...states.values()].map(s=>({id:s.id,phase:s.phase,station:s.target?.stationId,tableId:s.target?.tableId||null,hasBowl:s.hasBowl,hasMeal:s.hasMeal,bites:s.bites})) };
  }
  window.NpcSharedMeals = { init,targetFor,update,clear,interrupt,diagnostics };
})();
