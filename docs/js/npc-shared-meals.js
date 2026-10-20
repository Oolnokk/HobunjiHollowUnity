// Reusable gathering routine: ordinary schedule targets drive every walk; shared chairs own reservations.
// After each meal or song, NpcFestivalDance weighs the character's own traits to choose the next thing (seconds, dancing, mingling).
(() => {
  'use strict';
  let deps = null; // Gathering owner supplies hours, authored destinations, social bonds and presentation adapters.
  let pendingStations = false; // Retry destinations while an asynchronously built map is registering its stations.
  let layout = null; // Cached destination source, rebuilt only when the editor/calendar changes its map object.
  let seats = [], bowls = [], pots = [], queues = [], alternatives = [], musicians = [], slots = [], leftovers = []; // Authored station targets grouped once per layout.
  let audience = null; // Centre of the dance floor; mingling and solo dancers face the stage from around it.
  let commons = null; // Centre of the serving table: guests gather here while they wait for a bowl, a pot or a chair.
  let musicOn = true; // Refreshed once per gathering tick: nobody dances (or keeps dancing) without a musician actually playing.
  const states = new Map(); // Transient per-NPC meal/locale progress; never mutates shared NPC records.
  const byWalker = new Map(); // Refreshed by the existing gathering tick, rather than scanning the crowd in each schedule probe.
  const FACING = 'festival-dance';
  function random() { return deps?.random?.() ?? Math.random(); }
  function dancing() { return window.NpcFestivalDance; }
  function release(state) {
    window.FurnitureTableSystem?.setSeatTarget?.(state.id, null);
    deps?.clearCarry?.(state.id, byWalker.get(state.id));
  }
  function clear() { for (const state of states.values()) release(state); states.clear(); byWalker.clear(); layout = null; }
  function init(injected) { clear(); deps = injected; musicOn = true; }
  function refreshLayout() {
    const next = deps?.getLayout?.(); // The effective map retains identity until a layout/editor change.
    if (next === layout && !pendingStations) return;
    if (next !== layout) { clear(); layout = next; }
    pendingStations = false;
    seats = []; bowls = []; pots = []; queues = []; alternatives = []; musicians = []; slots = []; leftovers = []; audience = null; commons = null;
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
    const grouped = dancing()?.pairSlots?.(alternatives) || { slots:[], leftovers:alternatives };
    slots = grouped.slots; leftovers = grouped.leftovers;
    const serving = bowls.concat(pots);
    if (serving.length) commons = { area:serving[0].area, x:serving.reduce((s,t)=>s+t.c+.5,0)/serving.length, z:serving.reduce((s,t)=>s+t.r+.5,0)/serving.length };
    if (alternatives.length) audience = { area:alternatives[0].area, x:alternatives.reduce((s,t)=>s+t.c+.5,0)/alternatives.length, z:alternatives.reduce((s,t)=>s+t.r+.5,0)/alternatives.length };
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
  function chooseFloor(state) { return choose(leftovers,state) || choose(alternatives,state); } // Waiting dancers leave facing pairs free where possible.
  function setPhase(state, phase, target, now, duration = 0) {
    if (state.target?.pose === 'sit' && target !== state.target) window.FurnitureTableSystem?.setSeatTarget?.(state.id,null);
    state.phase = phase; state.target = target; state.since = now; state.until = now+duration;
    if (target?.pose === 'sit') window.FurnitureTableSystem?.setSeatTarget?.(state.id,target);
  }
  function waitTarget(state) {
    return choose(queues,state) || stagingSpot(state) || state.wait; // Full queues overflow onto clear ground by the buffet; the NPC's own position is the last resort.
  }
  function goBuffet(state, now) { // Everyone walks to the buffet's queue first; the service points are reserved only once the guest is actually there.
    state.hasBowl = false; state.hasMeal = false; state.readyAt = null; release(state);
    setPhase(state,'queue',waitTarget(state),now);
  }
  function watching(target) { return audience ? { ...target, socialLookAt:{ stimulusId:FACING, x:audience.x, z:audience.z }, socialWatching:true } : target; }
  function ringSpot(state, center, kind, near, far) { // A loose ring of free standing tiles around a locale: a real place to wait, never somebody's house.
    if (!center) return null;
    for (let n = 0; n < 10; n++) {
      const angle = random()*Math.PI*2, radius = near + random()*(far-near);
      const c = Math.floor(center.x + Math.cos(angle)*radius - .5), r = Math.floor(center.z + Math.sin(angle)*radius - .5);
      if (deps.canStandAt?.(center.area,c,r) === false) continue;
      let crowded = false; // Keep a body's width between loiterers.
      for (const other of states.values()) if (other.id !== state.id && other.target?.stationId?.startsWith(`${kind}:`) && Math.hypot(other.target.c-c,other.target.r-r) < 1.2) { crowded = true; break; }
      if (!crowded) return { area:center.area, c, r, pose:'stand', stationId:`${kind}:${state.id}` };
    }
    return null;
  }
  function mingleSpot(state) { const spot = ringSpot(state,audience,'mingle',3.4,6); return spot && watching(spot); } // Listening, chatting, watching the dancers.
  function stagingSpot(state) { return ringSpot(state,commons,'staging',2.2,4.2); } // Waiting for the buffet without blocking its service points.
  function goOther(state, now) {
    release(state); state.hasBowl = false; state.hasMeal = false; dissolve(state);
    setPhase(state,'other',mingleSpot(state)||state.wait,now,12+random()*18);
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
      state = {id:rec.id,rec,phase:'new',target:null,wait,bonds:deps.companions?.(rec)||new Map(),hasBowl:false,hasMeal:false,bites:0,nextBite:0,
        helpings:0,songs:0,readyAt:null,lastMealAt:deps.minutes(),partnerId:null,lastPartnerId:null,pairUntil:0,solo:false,spouseWasWaiting:false};
      states.set(rec.id,state);
      next(state,deps.minutes(),{arriving:true}); // Arriving guests are hungry, but a lively character may head straight for the floor.
    }
    return state.target;
  }
  // ── Social decisions ────────────────────────────────────────────────────
  function spouseState(state) {
    for (const id of dancing()?.spouseIds?.(state.rec) || []) { const other = states.get(id); if (other) return other; }
    return null;
  }
  function eligiblePartners(state) {
    let count = 0;
    for (const other of states.values()) {
      if (other.id === state.id || other.phase === 'musician' || other.partnerId && other.partnerId !== state.id) continue;
      if (dancing().pairWeight(state.rec,other.rec) > 0) count++;
    }
    return count;
  }
  function floorOpen(state) { return alternatives.some(target => !occupied(target,state.id)); }
  function next(state, now, extra = {}) { // The one place a character decides what to do with free time.
    const NFD = dancing(), spouse = spouseState(state);
    const spouseAvailable = !!spouse && spouse.phase !== 'musician' && !(spouse.partnerId && spouse.partnerId !== state.id);
    const decision = NFD ? NFD.decide(state.rec,{
      helpings:state.helpings, songs:state.songs, minutesSinceMeal:now-state.lastMealAt, musicOn, floorOpen:floorOpen(state),
      spouseAvailable, spouseWaiting:!!spouse && spouse.phase === 'dance-wait', partnerCount:eligiblePartners(state), ...extra,
    },random) : { action:'seconds' };
    if (decision.action === 'dance') return startDancing(state,now,decision.solo);
    if (decision.action === 'other') return goOther(state,now);
    return goBuffet(state,now);
  }
  function startDancing(state, now, solo, stay = false) {
    release(state); state.hasBowl = false; state.hasMeal = false; state.solo = !!solo;
    const here = stay && alternatives.find(t => t.stationId === state.target?.stationId && !occupied(t,state.id)); // Between songs a dancer waits where they stand.
    const spot = here || chooseFloor(state);
    if (!spot) return goBuffet(state,now);
    if (solo) return setPhase(state,'dance-walk',watching(spot),now);
    setPhase(state,'dance-wait',spot,now,24+random()*24*(1.2-dancing().traits(state.rec).shyness)); // Patient enough (roughly 12-25 real seconds) for a partner to finish eating and arrive.
  }
  function dissolve(state) { // Clears pairing bookkeeping; the partner notices on its next tick.
    if (state.partnerId) state.lastPartnerId = state.partnerId;
    state.partnerId = null; state.solo = false; state.pairUntil = 0;
    if (state.target?.socialDance) { state.target = { ...state.target }; delete state.target.socialDance; }
  }
  function slotCost(slot, a, b) {
    const wa = byWalker.get(a.id)?.root?.position, wb = byWalker.get(b.id)?.root?.position;
    const d = (p, t) => p ? Math.hypot(p.x-t.c-.5,p.z-t.r-.5) : 0;
    const direct = d(wa,slot.a)+d(wb,slot.b), crossed = d(wa,slot.b)+d(wb,slot.a);
    return direct <= crossed ? { cost:direct, first:slot.a, second:slot.b } : { cost:crossed, first:slot.b, second:slot.a };
  }
  function holders(station, ignoreA, ignoreB) {
    const out = [];
    for (const state of states.values()) if (state.id !== ignoreA && state.id !== ignoreB && state.target?.stationId === station.stationId) out.push(state);
    return out;
  }
  function pickSlot(a, b) { // A facing pair needs both spots; idle waiters on them are simply restaged, anyone committed blocks the slot.
    let best = null;
    for (const slot of slots) {
      if ([slot.a,slot.b].some(station => deps.canStandAt?.(station.area,station.c,station.r) === false || holders(station,a.id,b.id).some(h => h.phase !== 'dance-wait'))) continue;
      const option = slotCost(slot,a,b);
      if (!best || option.cost < best.cost) best = option;
    }
    return best;
  }
  function look(from, toward, now, pair) {
    return { ...from, socialLookAt:{ stimulusId:FACING, x:toward.c+.5, z:toward.r+.5 }, pairKey:pair };
  }
  function pairUp(a, b, now) {
    const choice = pickSlot(a,b); if (!choice) return false;
    for (const station of [choice.first,choice.second]) for (const displaced of holders(station,a.id,b.id)) { // Waiters keep dancing intent but give up the spot.
      const spot = choose(leftovers.concat(alternatives).filter(t => t.stationId !== choice.first.stationId && t.stationId !== choice.second.stationId),displaced);
      if (spot) setPhase(displaced,'dance-wait',spot,now,Math.max(6,displaced.until-now)); else goOther(displaced,now);
    }
    const key = `${a.id}|${b.id}`;
    a.partnerId = b.id; b.partnerId = a.id;
    setPhase(a,'dance-walk',look(choice.first,choice.second,now,key),now);
    setPhase(b,'dance-walk',look(choice.second,choice.first,now,key),now);
    return true;
  }
  function matchmake(now) {
    const waiting = [...states.values()].filter(s => s.phase === 'dance-wait' && !s.partnerId && arrived(byWalker.get(s.id),s.target)).sort((x,y)=>x.since-y.since);
    for (const a of waiting) {
      if (a.partnerId || a.phase !== 'dance-wait') continue;
      const options = waiting.filter(b => b !== a && !b.partnerId && b.phase === 'dance-wait');
      const b = dancing().pickWeighted(options,other => Math.min(dancing().pairWeight(a.rec,other.rec,{lastPartnerId:a.lastPartnerId}),dancing().pairWeight(other.rec,a.rec,{lastPartnerId:other.lastPartnerId})),random);
      if (b) pairUp(a,b,now);
    }
  }
  function startSong(state, now, until) {
    const style = state.rec.preferredDance || {};
    const presentation = { stimulusId:FACING, style:style.style === 'gentle-twirl' ? 'side-step' : (style.style || 'loose-sway'), armStyle:style.armStyle || 'overhead-punch' };
    state.pairUntil = until; state.phase = 'dancing'; state.since = now; state.until = until;
    state.target = { ...state.target, socialDance:presentation };
  }
  function songContext(state, now) {
    return { songs:state.songs, minutesSinceMeal:now-state.lastMealAt, musicOn };
  }
  function danceTick(state, walker, now) { // Returns true when this state's phase fully handled the tick.
    const NFD = dancing();
    if (!musicOn && (state.phase === 'dance-wait' || state.phase === 'dance-walk' || state.phase === 'dancing')) { goOther(state,now); return true; }
    if (state.phase === 'dance-wait') {
      if (now >= state.until) { next(state,now,{ justDanced:true, musicOn:false }); return true; }
      return true;
    }
    const partner = state.partnerId ? states.get(state.partnerId) : null;
    const lost = !state.solo && (!partner || partner.partnerId !== state.id || !['dance-walk','dancing'].includes(partner.phase));
    if (lost) { const was = state.phase === 'dancing'; dissolve(state); if (musicOn && was) startDancing(state,now,false,true); else next(state,now,{ justDanced:was }); return true; }
    if (state.phase === 'dance-walk') {
      if (now-state.since > 40) { goOther(state,now); return true; } // Blocked routes never strand a pair.
      if (!arrived(walker,state.target)) return true;
      if (state.solo) { startSong(state,now,now+dancing().songMinutes(random)); return true; }
      if (arrived(byWalker.get(partner.id),partner.target)) { const until = now+dancing().songMinutes(random); startSong(state,now,until); startSong(partner,now,until); } // Both begin on the same beat.
      return true;
    }
    // dancing
    if (now < state.pairUntil) return true;
    if (state.solo) {
      state.songs++;
      if (NFD.wantsAnotherSong(state.rec,songContext(state,now),random)) startSong(state,now,now+NFD.songMinutes(random)); else { dissolve(state); next(state,now,{ justDanced:true }); }
      return true;
    }
    if (state.id > partner.id) return true; // The lower id decides for the couple so the pair never splits mid-tick.
    state.songs++; partner.songs++;
    const both = NFD.wantsAnotherSong(state.rec,songContext(state,now),random) && NFD.wantsAnotherSong(partner.rec,songContext(partner,now),random);
    const married = NFD.kind(state.rec) === 'married';
    const keep = both && (married || random() < .2 + Math.min(.3,NFD.bond(state.rec,partner.rec)/30)); // Singles usually swap partners after a song.
    if (keep) { const until = now+NFD.songMinutes(random); startSong(state,now,until); startSong(partner,now,until); return true; }
    for (const member of [state,partner]) {
      const again = !married && musicOn && NFD.wantsAnotherSong(member.rec,songContext(member,now),random);
      dissolve(member);
      if (again) startDancing(member,now,false,true); else next(member,now,{ justDanced:true });
    }
    return true;
  }
  function headOfQueue() { // The guest who has been standing in line longest takes the next bowl.
    let head = null;
    for (const state of states.values()) if (state.phase === 'queue' && state.readyAt !== null && (!head || state.readyAt < head.readyAt)) head = state;
    return head;
  }
  function update() {
    if (!deps?.enabled?.()) { if (states.size) clear(); return; }
    if (deps.paused?.()) return;
    refreshLayout(); byWalker.clear();
    for (const walker of deps.getWalkers?.() || []) byWalker.set(walker.rec?.id,walker);
    musicOn = deps.musicOn ? !!deps.musicOn() : true;
    const now = deps.minutes(); // Game time pauses and midnight remain owned by the existing calendar.
    for (const state of [...states.values()]) {
      const walker = byWalker.get(state.id);
      if (state.rec.dead || state.rec.deceased) { release(state); states.delete(state.id); continue; }
      if (walker?.currentScheduleTarget?.overrideOwner && walker.currentScheduleTarget.overrideOwner !== deps.owner) {
        release(state); states.delete(state.id); continue; // Follow, dates and emergencies retain ownership.
      }
      if (state.target?.pose === 'sit') window.FurnitureTableSystem?.setSeatTarget?.(state.id,state.target); // Renew leases at the shared gathering rate.
      const musician = musicians.find(target => target.festivalNpcId === state.id && deps.isMusician?.(state.rec));
      if (musician) { if (state.phase !== 'musician') { release(state); dissolve(state); setPhase(state,'musician',musician,now); } continue; }
      if (state.phase === 'musician') { state.lastMealAt = now; next(state,now,{ arriving:true }); }
      if (state.phase === 'other') { if (now >= state.until) next(state,now); continue; }
      if (state.phase === 'dance-wait' || state.phase === 'dance-walk' || state.phase === 'dancing') { danceTick(state,walker,now); continue; }
      if (state.phase === 'queue') {
        if (!arrived(walker,state.target)) { if (now-state.since>120) goOther(state,now); continue; } // Long walks from a house or workplace are fine; a stuck route is not.
        if (state.readyAt === null) state.readyAt = now;
        if (headOfQueue()?.id === state.id) { const target = choose(bowls,state); if (target) { setPhase(state,'walk-bowl',target,now); continue; } }
        if (now-state.readyAt>45) goOther(state,now); // Gave up waiting: wander off and come back later.
        continue;
      }
      if (state.phase === 'walk-bowl' && arrived(walker,state.target)) setPhase(state,'take-bowl',state.target,now,1);
      if (state.phase === 'take-bowl' && now >= state.until) { state.hasBowl = true; setPhase(state,'seek-pot',state.target,now); }
      if (state.phase === 'seek-pot') {
        const target = choose(pots,state); if (target) setPhase(state,'walk-pot',target,now);
        else if (now-state.since>35) goOther(state,now);
      }
      if (state.phase === 'walk-pot' && arrived(walker,state.target)) setPhase(state,'fill-bowl',state.target,now,2);
      if (state.phase === 'fill-bowl' && now >= state.until) { state.hasMeal = true; state.helpings++; setPhase(state,'seek-seat',waitTarget(state),now); }
      if (state.phase === 'seek-seat') {
        const seat = chooseSeat(state); if (seat) setPhase(state,'walk-seat',seat,now);
        else if (now-state.since>35) goOther(state,now);
      }
      if (state.phase === 'walk-seat') {
        if (occupied(state.target,state.id)) setPhase(state,'seek-seat',waitTarget(state),now);
        else if (arrived(walker,state.target)) { setPhase(state,'eating',state.target,now,10+random()*10); state.nextBite=now+2; } // A plate lasts 10-20 game minutes.
      }
      if (state.phase === 'eating') {
        const spouse = spouseState(state);
        const called = spouse?.phase === 'dance-wait' && now >= state.since+(state.until-state.since)*.5; // A waiting spouse pulls their partner away from the table once the plate is half finished.
        if (now>=state.until || called) { state.lastMealAt = now; next(state,now); continue; }
        if (now>=state.nextBite) {
          state.bites++; state.nextBite=now+2+random()*3;
          if (deps.visible?.(walker)) deps.playEat?.(walker);
        }
      }
      if (state.hasBowl && deps.visible?.(walker)) deps.carryBowl?.(walker,state.id);
      else deps.clearCarry?.(state.id,walker);
      if (state.phase.startsWith('walk-') && now-state.since>60) goOther(state,now); // Recover blocked routes without teleporting or taking another NPC's seat.
    }
    if (musicOn) matchmake(now);
  }
  function interrupt(id) { const state=states.get(id); if(!state)return; release(state); states.delete(id); } // An accepted social invitation releases its meal/seat before approaching; a dance partner notices on the next tick.
  function diagnostics() {
    return { latestChange:'NPCs queue, take/fill bowls, sit with spouses/family/friends, eat 10-20 minutes, then choose seconds, a facing-pair dance (spouses together; unmarried romanceable guests swap partners) or mingling, and only dance while a musician plays.',
      pendingStations,seats:seats.length,bowlSpots:bowls.length,servingSpots:pots.length,queueSpots:queues.length,danceSpots:alternatives.length,pairSlots:slots.length,musicOn,
      actors:[...states.values()].map(s=>({id:s.id,phase:s.phase,station:s.target?.stationId,tableId:s.target?.tableId||null,hasBowl:s.hasBowl,hasMeal:s.hasMeal,bites:s.bites,helpings:s.helpings,songs:s.songs,partner:s.partnerId||null})) };
  }
  window.NpcSharedMeals = { init,targetFor,update,clear,interrupt,diagnostics };
})();
