#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const replies=[]; // Captures actual directed ambient responses for explicit invitations.
const W={AmbientDialogue:{showSocialResponse:(_walker,response)=>replies.push(response)}},context=vm.createContext({window:W,console,performance:{now:()=>1000}}); // Executes shared follow and furniture owners together.
for(const name of ['furniture-table-system','npc-following'])vm.runInContext(fs.readFileSync('docs/js/'+name+'.js','utf8'),context);
let area='town',playerSeat=null,player={x:3.5,z:3.5},override=null; // Live world inputs can change without rebuilding the movement provider.
const friend={rec:{id:'friend'},area,root:{position:{x:8.5,z:3.5}}};
W.NpcScheduling={registerTargetOverride(_id,fn){override=fn;}};
W.NpcPathfinding={isNpcTileWalkable:()=>true};
W.FurnitureTableSystem.init({getArea:()=>area,getPlayerSeat:()=>playerSeat,getPlayerPosition:()=>player,getWalkers:()=>[friend]});
W.NpcFollowing.init({findWalker:()=>friend,getPlayerTilePosition:()=>player,getCurrentArea:()=>area,normalizeNpcArea:a=>a,canHostNpc:()=>true});
W.NpcFollowing.commandOptionsFor(friend).find(o=>o.id==='follow').run();
assert.equal(override(friend.rec).activity,'following you');
W.NpcFollowing.commandOptionsFor(friend).find(o=>o.id==='wait').run();
const wait=override(friend.rec);player.x=20;
assert.equal(override(friend.rec).c,wait.c,'Wait remains at the NPC location while the player moves');
W.NpcFollowing.commandOptionsFor(friend).find(o=>o.id==='follow').run();player.x=3.5;
function place(id,key,c,r,tableId){const root={parent:{},position:{x:c+.5,y:0,z:r+.5},scale:{x:1,y:1,z:1},userData:{}};W.FurnitureTableSystem.registerPlacement(area,{id,key,col:c,row:r,tableId},root,{sit:key==='chairSimple',fw:1,fd:1});}
place('table','tableSmall',4,4);place('player','chairSimple',3,4,'table');place('friend','chairSimple',5,4,'table');
playerSeat={phase:'active',furnitureId:'player'};
const seat=override(friend.rec);
assert.equal(seat.pose,'sit');assert.equal(seat.furnitureId,'friend','following uses a separate chair explicitly belonging to the player’s table');
assert.equal(W.FurnitureTableSystem.companionSeat(area,'someone-else'),null,'the last free chair cannot be reserved by two companions');
friend.currentScheduleTarget=seat;
assert.equal(override(friend.rec).furnitureId,'friend','a reserved seat remains stable');
W.NpcFollowing.commandOptionsFor(friend).find(o=>o.id==='dismiss').run();friend.currentScheduleTarget=null;
assert.equal(override(friend.rec),null,'dismissal returns control to ordinary schedules');
assert(replies.some(r=>r.accepted&&r.reason==='company'),'accepted Follow uses ambient NPC speech');
W.NpcRapport={get:()=>-10};
assert.equal(W.NpcFollowing.setMode(friend,'follow'),false,'unfriendly NPC can decline following');
assert.equal(replies.at(-1).accepted,false,'declining uses the same directed ambient response owner');
assert.equal(override(friend.rec),null,'declined invitations never alter the NPC schedule');
assert.equal(W.NpcFollowing.setMode(friend,'invalid'),false,'invalid commands cannot create a companion');
let dateMode='';W.RomanceSystem={isOnDateWith:()=>true,setDateMode:mode=>{dateMode=mode;return true;}};
assert.equal(W.NpcFollowing.setMode(friend,'wait'),true);assert.equal(dateMode,'wait','existing date controls retain their own acceptance/session behavior');
console.log('Shared companion/date follow, Wait, dismissal and exclusive same-table seating passed.');

W.RomanceSystem=null;W.NpcRapport={get:()=>0};
assert(W.NpcFollowing.setMode(friend,'follow'));
assert(override(friend.rec));W.NpcFollowing.clear();
assert.equal(override(friend.rec),null,'save restore can clear session-only company');
