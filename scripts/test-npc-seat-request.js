#!/usr/bin/env node
'use strict';
// "Ask for seat" on the More (hold Action 1) wheel: only for seated NPCs, accepted at zero or more hearts, the NPC stands
// clear of the chair, the player sits in the same physical seat, and a refusal leaves everyone as they were.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const calls = { seatTarget:[], stopped:0, reseat:[], responses:[], toasts:[], sat:[] };
const listKeys = () => Object.keys(calls).filter(k => Array.isArray(calls[k]));
let hearts = 0, playerSeated = false, blocked = false, sitOk = true, blackedOut = false;
const blockedTiles = new Set(); // "x,z" rounded to half tiles
const window = {
  FurnitureTableSystem:{ setSeatTarget:(id,target)=>calls.seatTarget.push([id,target]) },
  NpcDrinkInteraction:{ stopAutonomous:()=>{ calls.stopped++; } },
  NpcSharedMeals:{ reseat:id=>{ calls.reseat.push(id); return true; } },
  NpcFavorBalance:{ relationshipHeartsForNpc:()=>hearts },
  HobunjiDrunkGameplayBridge:{ isNpcBlackedOut:()=>blackedOut },
  NpcPathfinding:{ isNpcPositionWalkable:(area,x,z)=>!blockedTiles.has(`${Math.round(x*2)/2},${Math.round(z*2)/2}`) },
  AmbientDialogue:{ showSocialResponse:(walker,response)=>calls.responses.push({ id:walker.rec.id,...response }) },
};
vm.runInNewContext(fs.readFileSync('docs/js/npc-seat-request.js','utf8'),{ window,Date });
const API = window.NpcSeatRequest;
const player = { x:10.5, z:12.5 };
const walkers = [];
API.init({ getArea:()=> 'map_i_inn', getWalkers:()=>walkers, getPlayerPosition:()=>player, isPlayerSeated:()=>playerSeated, isBlocked:()=>blocked,
  canSit:()=>true, beginSitAtTarget:seat=>{ calls.sat.push(seat); return sitOk ? { ok:true,message:'You sit down.' } : { ok:false,message:'Someone has already taken this seat.' }; },
  toast:(text,ok)=>calls.toasts.push({ text,ok }), now:()=>0 });
function seated(id='leaf') {
  const walker = { rec:{ id,name:'Leaf' }, area:'map_i_inn', root:{ position:{ x:10.5,z:10.5 } }, _seatedStationKey:'stool', state:'idle',
    currentScheduleTarget:{ pose:'sit',furnitureKey:'stoolFurniture',c:10,r:10,seatIndex:0,stationId:'stool',area:'map_i_inn' }, resetRouteState(){ this.reset = true; } };
  walkers.length = 0; walkers.push(walker); return walker;
}
const reset = () => { for (const k of listKeys()) calls[k].length = 0; calls.stopped = 0; };

let walker = seated();
assert.equal(JSON.stringify(API.optionsFor(walker).map(o => o.id)),'["ask-seat"]','a seated NPC offers "Ask for seat" on the More wheel');
walker._seatedStationKey = null; assert.equal(API.optionsFor(walker).length,0,'still walking to the chair: no option');
walker = seated(); walker.currentScheduleTarget.pose = 'stand'; assert.equal(API.optionsFor(walker).length,0,'standing NPCs offer nothing');
walker = seated(); walker.area = 'town'; assert.equal(API.optionsFor(walker).length,0,'only for NPCs in the player\'s area');
walker = seated(); playerSeated = true; assert.equal(API.optionsFor(walker).length,0,'hidden while the player already sits'); playerSeated = false;
blocked = true; assert.equal(API.optionsFor(walker).length,0,'hidden during dialogue/menus/combat'); blocked = false;
blackedOut = true; assert.equal(API.optionsFor(walker).length,0,'a passed-out NPC cannot be asked'); blackedOut = false;
walker.currentScheduleTarget.furnitureKey = ''; assert.equal(API.optionsFor(walker).length,0,'no physical chair, no request');

// Negative hearts refuse; nothing changes.
walker = seated(); hearts = -1; reset();
assert.equal(API.optionsFor(walker)[0].run().refused,true);
assert.equal(walker._seatedStationKey,'stool','the refusing NPC keeps their seat'); assert.equal(calls.sat.length,0); assert.equal(calls.responses[0].accepted,false);
assert.equal(calls.seatTarget.length,0);

// Zero hearts accept: the NPC stands beside the chair (not on a blocked tile or the player), the player takes the exact seat.
for (const value of [0,.4,5]) {
  walker = seated(); hearts = value; reset(); blockedTiles.add('11.5,10.5'); blockedTiles.add('11,10.5');
  const result = API.optionsFor(walker)[0].run();
  assert(result.ok,`${value} hearts accept`);
  assert.equal(JSON.stringify(calls.sat[0]),JSON.stringify({ pose:'sit',furnitureKey:'stoolFurniture',c:10,r:10,seatIndex:0,stationId:'stool',area:'map_i_inn' }),'the player sits in the NPC\'s own seat');
  assert.deepEqual(calls.seatTarget[0],['leaf',null],'their seat reservation is released first'); assert.deepEqual(calls.reseat,['leaf'],'the festival meal routine is told to re-seat them'); assert.equal(calls.stopped,1);
  assert.equal(walker._seatedStationKey,null); assert.equal(walker.currentScheduleTarget,null,'no stale sit target reserves the chair'); assert.equal(walker.reset,true,'route state resets so they behave as if they had just shown up');
  const away = Math.hypot(walker.root.position.x-10.5,walker.root.position.z-10.5);
  assert(away >= .9 && away <= 2.1,`they stand clear of the chair (${away.toFixed(2)} tiles)`);
  assert(!blockedTiles.has(`${Math.round(walker.root.position.x*2)/2},${Math.round(walker.root.position.z*2)/2}`),'on walkable ground');
  assert(Math.hypot(walker.root.position.x-player.x,walker.root.position.z-player.z) >= .6,'not on top of the player');
  assert.equal(calls.responses.at(-1).accepted,true); assert.match(calls.toasts.at(-1).text,/You take Leaf's seat/);
}
// If sitting fails after the NPC has stood (rare), they simply reclaim it; the player is told why.
walker = seated(); hearts = 2; reset(); sitOk = false;
assert.equal(API.optionsFor(walker)[0].run().ok,false); assert.equal(calls.toasts.at(-1).ok,false); assert.equal(calls.responses.length,0,'no thanks are spoken for a seat the player did not get');
console.log('Ask for seat: option gating, hearts check, vacating, exact-seat handoff and failure handling passed.');
