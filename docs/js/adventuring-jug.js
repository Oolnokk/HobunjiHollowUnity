// Actor-owned jug rules; adapters own physical traces, puzzle receivers, rendering and save lifecycle.
(function(root){
function createJugRuntime(deps) {
  'use strict';
  const LIQUIDS=Object.freeze({water:Object.freeze({capacity:12,belt:true}),lifeWater:Object.freeze({capacity:6,belt:false})}); // Shared liquid definitions.
  const inventory=new WeakMap(), flights=new WeakMap(), rolls=new WeakMap(); // Per-actor state and one-shot action/roll ownership.
  const areas=new Map(); // Area -> tile column -> records at distinct elevations.
  const DURATION=20000, INTERVAL=1000, TOLERANCE=.2; // Consecration and its fixed tick cadence, in simulation milliseconds.
  let nextTick=null,lastEvent=null; // Debug and periodic effect state.
  const validActor=a=>!!a&&typeof a==='object';
  const validArea=a=>typeof a==='string'&&!!a;
  const known=l=>Object.prototype.hasOwnProperty.call(LIQUIDS,l);
  const now=()=>{const t=deps.nowMs();if(!Number.isFinite(t))throw Error('Invalid jug simulation clock');return t;};
  const empty=()=>({liquid:null,units:0});
  function normalize(s){
    if(!s||!known(s.liquid)||!Number.isFinite(s.units))return empty();
    const units=Math.max(0,Math.min(LIQUIDS[s.liquid].capacity,Math.floor(s.units)));
    return units?{liquid:s.liquid,units}:empty();
  }
  function getState(a){return {...(inventory.get(a)||empty())};}
  function restore(a,s){if(!validActor(a))return false;inventory.set(a,normalize(s));rolls.delete(a);return true;}
  function write(a,s){const value=normalize(s);inventory.set(a,value);deps.onStateChanged?.(a,{...value});}
  function fill(a,l){
    if(!validActor(a)||!known(l))return false;
    const s=getState(a), capacity=LIQUIDS[l].capacity;
    if(s.units&&(s.liquid!==l||s.units===capacity))return false; // Never mix or silently replace liquids.
    write(a,{liquid:l,units:capacity});lastEvent={action:'fill',liquid:l,units:capacity};return true;
  }
  function beginAction(a,area,action){
    if(!validActor(a)||!validArea(area)||!['pour','splash','empty'].includes(action))return null;
    const s=getState(a);if(!s.units)return null;
    const units=action==='empty'?s.units:1;
    write(a,{liquid:s.liquid,units:s.units-units});
    const ticket=Object.freeze({action,area,liquid:s.liquid,units}); // A release can resolve exactly once.
    flights.set(ticket,a);lastEvent={...ticket,phase:'release'};return ticket;
  }
  function tileOf(t){return t&&validArea(t.area)&&[t.x,t.y,t.z].every(Number.isFinite)?{area:t.area,x:Math.floor(t.x),z:Math.floor(t.z),y:t.y}:null;}
  const key=t=>t.x+','+t.z;
  const sameFloor=(a,b)=>Math.abs(a.y-b.y)<=TOLERANCE;
  function records(t,create=false){
    let columns=areas.get(t.area);
    if(!columns&&create)areas.set(t.area,columns=new Map());
    let list=columns?.get(key(t));
    if(!list&&create)columns.set(key(t),list=[]);
    return list;
  }
  function isConsecrated(raw,time){
    if(!areas.has(raw?.area))return false; // No allocations or clock reads in ordinary dry-area hazard queries.
    const t=tileOf(raw),at=time??now();return !!t&&!!records(t)?.some(r=>sameFloor(r,t)&&at<r.until);
  }
  function consecrate(t,time){
    const list=records(t,true);let r=list.find(r=>sameFloor(r,t));
    if(!r){r={...t,until:0};list.push(r);}
    r.until=time+DURATION;deps.onConsecrated?.({...r});
  }
  function uniqueTiles(area,tiles,visited=new Map()){
    const result=[]; // Deduplicate each surface independently, including stacked floors.
    for(const raw of tiles||[]){
      const t=tileOf(raw);if(!t||t.area!==area)continue;
      const list=visited.get(key(t))||[];
      if(list.some(r=>sameFloor(r,t)))continue;
      list.push(t);visited.set(key(t),list);result.push(t);
    }
    return result;
  }
  function affect(area,liquid,tiles,owner){
    const cells=uniqueTiles(area,tiles),time=now();
    for(const t of cells){
      deps.extinguishTile?.(t,owner);
      if(liquid==='lifeWater'){consecrate(t,time);deps.clearPlasmTile?.(t,owner);}
    }
    return cells.length;
  }
  function resolveImpact(ticket,impact){
    if(!ticket||!flights.has(ticket))return null;
    const owner=flights.get(ticket);flights.delete(ticket);
    if(!impact||impact.area!==ticket.area)return null; // Stale flight cannot affect a newly loaded area.
    let filled=0,tiles=0;
    if(ticket.action!=='splash'&&impact.receptacle){
      const n=Number(deps.fillReceptacle?.(impact.receptacle,ticket.liquid,ticket.units,owner));
      filled=Number.isFinite(n)?Math.max(0,Math.min(ticket.units,Math.floor(n))):0;
    }else{
      tiles=affect(ticket.area,ticket.liquid,ticket.action==='pour'?[impact.tile]:impact.tiles,owner);
    }
    lastEvent={...ticket,phase:'impact',filled,tiles};return {filled,tiles};
  }
  function cancelImpact(ticket){return flights.delete(ticket);}
  function beginDodge(a,area,onBelt){
    if(!validActor(a)||!validArea(area)||!onBelt||rolls.has(a))return false;
    const s=getState(a);if(!s.units||!LIQUIDS[s.liquid]?.belt)return false;
    write(a,{liquid:s.liquid,units:s.units-1});
    rolls.set(a,{area,liquid:s.liquid,visited:new Map()}); // Protection survives spending the last unit.
    lastEvent={action:'belt-dodge',area,liquid:s.liquid,units:1};return true;
  }
  function dodgeProtected(a,area){return rolls.get(a)?.area===area&&validArea(area);}
  function dodgeTiles(a,area,tiles){
    const roll=rolls.get(a);if(!roll||roll.area!==area)return 0;
    return affect(area,roll.liquid,uniqueTiles(area,tiles,roll.visited),a);
  }
  function endDodge(a){return rolls.delete(a);}
  function prune(time){
    for(const [area,columns] of areas){
      for(const [k,list] of columns){
        for(let i=list.length-1;i>=0;i--)if(time>=list[i].until){const [r]=list.splice(i,1);deps.onConsecrationExpired?.({...r});}
        if(!list.length)columns.delete(k);
      }
      if(!columns.size)areas.delete(area);
    }
  }
  function update(){
    if(!areas.size){nextTick=null;return 0;}
    const time=now();prune(time);
    if(!areas.size){nextTick=null;return 0;}
    if(nextTick===null){nextTick=time+INTERVAL;return 0;}
    if(time<nextTick)return 0;
    nextTick=time+INTERVAL; // Avoid catch-up damage bursts after suspension.
    const seen=new Set();
    for(const area of areas.keys())for(const a of deps.actorsInArea?.(area)||[]){
      if(!validActor(a)||seen.has(a)||!deps.isAlive?.(a))continue;
      const t=deps.actorTile?.(a,area);
      if(t?.area!==area||!isConsecrated(t,time))continue;
      seen.add(a);
      if(deps.isUndead?.(a))deps.damageUndead?.(a);else deps.healLiving?.(a);
    }
    return seen.size;
  }
  function clearArea(area){
    const columns=areas.get(area);if(!columns)return;
    for(const list of columns.values())for(const r of list)deps.onConsecrationExpired?.({...r});
    areas.delete(area);if(!areas.size)nextTick=null;
  }
  function debug(a){
    const s=getState(a),time=areas.size?now():0;let activeTiles=0;
    for(const columns of areas.values())for(const list of columns.values())for(const r of list)if(r.until>time)activeTiles++;
    return {...s,capacity:LIQUIDS[s.liquid]?.capacity||0,rollProtected:rolls.has(a),activeConsecratedTiles:activeTiles,lastEvent};
  }
  return Object.freeze({LIQUIDS,DURATION,TOLERANCE,getState,restore,fill,beginAction,resolveImpact,cancelImpact,beginDodge,dodgeProtected,dodgeTiles,endDodge,isConsecrated,hasArea:area=>areas.has(area),hasLiquid:actor=>(inventory.get(actor)?.units||0)>0,update,clearArea,debug});
}
if(typeof module==='object'&&module.exports)module.exports=createJugRuntime;else root.HobunjiCreateJugRuntime=createJugRuntime;
})(typeof window!=='undefined'?window:globalThis);
