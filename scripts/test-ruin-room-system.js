// Runtime assertions for room-owned geometry, light containment and Zelda-style enemy resets.
const assert=require('node:assert/strict');
const Rooms=require('../docs/js/ruin-room-system.js');
const ruin='map_i_dev_random_ruin'; // All fixture actors belong to this single continuous interior map.
const room1={id:'floor0-E-room1',kind:'challenge-room',challenge:'pressurePlate',x:10,z:10,w:11,d:11};
const room2={id:'floor0-E-room2',kind:'brazier-chamber',challenge:null,x:30,z:10,w:11,d:11};
const layout=Rooms.planRooms({options:{theme:'tothal'},floors:[{
  floor:0,y:0,doorways:[
    {to:room1.id,from:'shaft-f0',point:{x:10,z:15}},
    {to:room2.id,from:room1.id,point:{x:30,z:15}}],
  wings:[{id:'floor0-E',side:'E',rooms:[room1,room2]}],
}]});
assert.equal(layout.ok,true,layout.errors.join('; '));
assert.equal(layout.rooms.length,2);
const v50=Rooms.v50Rooms({cellSize:.5,rooms:[{id:'vestibule',col:2,row:3,w:6,h:8}]},{
  originX:40,originZ:70,tileScale:2,y:12,prefix:'v50-f1',theme:'kanthic',
});
assert.deepEqual(v50.map(r=>[r.id,r.x,r.z,r.w,r.d,r.y]),[['v50-f1:vestibule',42,73,6,8,12]]);
assert.deepEqual(v50[0].ambient.color,[0,0,0]);
assert.equal(layout.doors.length,2);
assert.equal(layout.rooms[1].blocked.length,8,'eleven-cell wall has eight solid cells and one three-cell aperture');
assert.deepEqual(layout.rooms[1].ambient.color,[6,18,44]);
assert.equal(layout.rooms[1].ambient.darknessOffset,-.035);
assert.equal(Rooms.roomAt(layout.rooms,34,14,0).id,room2.id);
assert.equal(Rooms.roomAt([
  {...room2,y:6,id:'upper'}, {...room2,y:0,id:'lower'},
],34,14,4).id,'lower','jumping under another floor cannot switch rooms');
assert.equal(Rooms.roomAt([{...room2,y:6}],34,14,4),null,'a floor above the player must not activate from below');
assert.equal(Rooms.roomAt([layout.rooms[1],{...layout.rooms[1],id:'nested',x:33,z:13,w:3,d:3}],34,14,0).id,
  'nested','smaller nested authored V50 puzzle rooms take precedence');
assert.equal(Rooms.doorNear({x:30,z:15},{x:30,z:15,y:0},false,4),true,
  'an upward jump through a doorway cannot close the door');
assert.equal(Rooms.doorNear({x:30,z:15},{x:30,z:15,y:0},false,7),false,
  'a different story cannot activate a lower door');
assert.equal(Rooms.roomAt(layout.rooms,34,14,10),null,'overlapping vertical stories cannot activate from an incorrect elevation');

const floorCells=new Set();
for(let x=10;x<21;x++)for(let z=10;z<21;z++)floorCells.add(x+','+z);
assert.equal(Rooms.floorAudit(layout.rooms[0],floorCells).missingFloorTiles,0);
assert.equal(Rooms.projectedFloorArea({positions:new Float32Array([
  0,0,0, 2,0,0, 2,0,3, 0,0,3,
  2,0,0, 3,0,0, 3,0,1, 2,0,1,
])}),7,'visible quads are checked by area, not by number of triangles');
assert.equal(Rooms.projectedFloorArea({positions:new Float32Array([0,0,0])}),0,'malformed floor meshes fail coverage validation');
floorCells.delete('18,12');
assert.equal(Rooms.floorAudit(layout.rooms[0],floorCells).missingFloorTiles,1,'missing support is a generation error');
const pit={contains:(x,z)=>x>=15&&x<17};
const voidRoom={...layout.rooms[0],pit};
assert.equal(Rooms.floorAudit(voidRoom,floorCells).deliberateVoidTiles,22,'an authored rope pit stays open');
assert.equal(Rooms.floorAudit(voidRoom,floorCells).missingFloorTiles,1,'an unrelated accidental floor hole is still detected');
const west=[],north=[],all=new Set();
for(let z=10;z<21;z++)for(let x=10;x<21;x++)all.add(x+','+z);
for(let z=10;z<21;z++){west.push([10,z+.5,1],[21,z+.5,-1]);}
for(let x=10;x<21;x++){north.push([x+.5,10,1],[x+.5,21,-1]);}
assert.equal(Rooms.wallAudit(layout.rooms[0],all,north,west).missingWallEdges,0);
north.pop();
assert.equal(Rooms.wallAudit(layout.rooms[0],all,north,west).missingWallEdges,1,'one missing wall face fails enclosure validation');
const malformed=Rooms.planRooms({options:{},floors:[{floor:0,y:0,
  doorways:[{to:room1.id,from:'shaft-f0',point:{x:11,z:15}}],
  wings:[{id:'east',side:'E',rooms:[room1]}]}]});
assert.equal(malformed.ok,false,'room doorway must sit on its correct wall');

const TILE=64; // Enemy world coordinates are pixels, while room/world-light coordinates are tiles.
const player={x:14,z:14,y:0};
const enemy={areaId:ruin,health:10,x:34*TILE,y:14*TILE,homeX:35*TILE,homeY:14*TILE,
  vx:20,vy:-10,state:'chase',targetPlayer:player,
  avatarRef:{group:{visible:true,position:{x:34,y:0,z:14}}}};
const hostiles=new Set([enemy]);
const walker={area:ruin,root:{visible:true,position:{x:34,y:0,z:14}}};
const walkers=[walker]; // A civilian NPC's update loop follows the same area guard as hostiles.
const session=Rooms.mount({layout,getPlayerPosition:()=>player,getPlayerY:()=>player.y,
  getHostiles:()=>hostiles,getWalkers:()=>walkers,mapId:ruin,tile:TILE});
session.addRooms(v50);
session.tick(.31);
assert.equal(session.snapshot().totalRooms,3);
assert.equal(session.activeRoomId,room1.id);
assert.equal(enemy.areaId,'__ruin_room_sleep__:'+ruin);
assert.equal(enemy.x,35*TILE,'enemy resets to its recorded home on exit/not-current');
assert.equal(enemy.state,'idle');
assert.equal(enemy.avatarRef.group.visible,false);
assert.equal(walker.area,'__ruin_room_sleep__:'+ruin);
assert.equal(walker.root.visible,false,'civilian NPC walker is hidden while its room sleeps');
assert.equal(session.lightAllowed({x:34,y:1,z:14}),false);
assert.equal(session.lightAllowed({x:14,y:1,z:14}),true);
player.x=34;player.z=14;
session.tick(.31);
assert.equal(session.activeRoomId,room2.id);
assert.equal(enemy.areaId,ruin,'reentering a room wakes its enemies');
assert.equal(enemy.avatarRef.group.visible,true);
assert.equal(walker.area,ruin);
assert.equal(walker.root.visible,true,'civilian NPC walker wakes with its room');
assert.equal(session.ambient().darknessOffset,-.035);
let fills=0,clips=0,draws=0;
const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){clips++;}};
assert.equal(session.withLightClip(ctx,{x:34,y:1,z:14},(x,y,z)=>({x:x*2,y:z+y}),()=>{fills++;}),true);
assert.equal(clips,1);
assert.equal(fills,1);
let projections=0;
session.prepareLightClip((x,y,z)=>{projections++;return {x:x*2,y:z+y};});
assert.equal(projections,8,'active-room clip is projected once per unified lighting pass');
session.withLightClip(ctx,{x:34,y:1,z:14},()=>{throw Error('cached light clip must not reproject per light');},()=>{fills++;});
assert.equal(fills,2);
assert.equal(projections,8,'second light reuses the already-projected clip');
assert.equal(session.withLightClip(ctx,{x:14,y:1,z:14},(x,y,z)=>({x:x*2,y:z+y}),()=>{draws++;}),false);
assert.equal(draws,0,'neighboring room light never paints over this room');
player.x=24;session.tick(.31);
assert.equal(session.activeRoomId,null,'hallways are seamless transition space, not an extra sealed room');
assert.equal(enemy.areaId,'__ruin_room_sleep__:'+ruin,'leaving the room immediately breaks pursuit');
assert.equal(walker.area,'__ruin_room_sleep__:'+ruin,'civilian NPCs also stop when the player leaves');
session.dispose();
assert.equal(enemy.areaId,ruin,'disposing a dungeon never leaves stale sleeping actors');
assert.equal(walker.area,ruin,'no NPC remains assigned to a sleeping synthetic area after cleanup');
console.log('ruin-room-system: enclosure, door IDs, floor holes, lighting and enemy resets OK');
