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
assert.equal(layout.doors.length,2);
assert.equal(layout.rooms[1].blocked.length,8,'eleven-cell wall has eight solid cells and one three-cell aperture');
assert.deepEqual(layout.rooms[1].ambient.color,[6,18,44]);
assert.equal(layout.rooms[1].ambient.darknessOffset,-.035);
assert.equal(Rooms.roomAt(layout.rooms,34,14,0).id,room2.id);
assert.equal(Rooms.roomAt(layout.rooms,34,14,10),null,'overlapping vertical stories cannot activate from an incorrect elevation');

const floorCells=new Set();
for(let x=10;x<21;x++)for(let z=10;z<21;z++)floorCells.add(x+','+z);
assert.equal(Rooms.floorAudit(layout.rooms[0],floorCells).missingFloorTiles,0);
floorCells.delete('18,12');
assert.equal(Rooms.floorAudit(layout.rooms[0],floorCells).missingFloorTiles,1,'missing support is a generation error');
const pit={contains:(x,z)=>x>=15&&x<17};
const voidRoom={...layout.rooms[0],pit};
assert.equal(Rooms.floorAudit(voidRoom,floorCells).deliberateVoidTiles,22,'an authored rope pit stays open');
assert.equal(Rooms.floorAudit(voidRoom,floorCells).missingFloorTiles,1,'an unrelated accidental floor hole is still detected');
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
const session=Rooms.mount({layout,getPlayerPosition:()=>player,getPlayerY:()=>player.y,
  getHostiles:()=>hostiles,mapId:ruin,tile:TILE});
session.tick(.31);
assert.equal(session.activeRoomId,room1.id);
assert.equal(enemy.areaId,'__ruin_room_sleep__:'+ruin);
assert.equal(enemy.x,35*TILE,'enemy resets to its recorded home on exit/not-current');
assert.equal(enemy.state,'idle');
assert.equal(enemy.avatarRef.group.visible,false);
assert.equal(session.lightAllowed({x:34,y:1,z:14}),false);
assert.equal(session.lightAllowed({x:14,y:1,z:14}),true);
player.x=34;player.z=14;
session.tick(.31);
assert.equal(session.activeRoomId,room2.id);
assert.equal(enemy.areaId,ruin,'reentering a room wakes its enemies');
assert.equal(enemy.avatarRef.group.visible,true);
assert.equal(session.ambient().darknessOffset,-.035);
let fills=0,clips=0,draws=0;
const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){clips++;}};
assert.equal(session.withLightClip(ctx,{x:34,y:1,z:14},(x,y,z)=>({x:x*2,y:z+y}),()=>{fills++;}),true);
assert.equal(clips,1);
assert.equal(fills,1);
assert.equal(session.withLightClip(ctx,{x:14,y:1,z:14},(x,y,z)=>({x:x*2,y:z+y}),()=>{draws++;}),false);
assert.equal(draws,0,'neighboring room light never paints over this room');
player.x=24;session.tick(.31);
assert.equal(session.activeRoomId,null,'hallways are seamless transition space, not an extra sealed room');
assert.equal(enemy.areaId,'__ruin_room_sleep__:'+ruin,'leaving the room immediately breaks pursuit');
session.dispose();
assert.equal(enemy.areaId,ruin,'disposing a dungeon never leaves stale sleeping actors');
console.log('ruin-room-system: enclosure, door IDs, floor holes, lighting and enemy resets OK');
