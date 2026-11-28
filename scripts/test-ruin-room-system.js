// Runtime assertions for room-owned geometry, full-screen ambience, room-local light bounds and Zelda-style enemy resets.
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
const shaftAnte={id:'floor0-E-shaft-anteroom',kind:'shaft-antechamber',challenge:null,x:8,z:13,w:5,d:5};
const firstAfterAnte={...room1,x:14};
const withAnte=Rooms.planRooms({options:{theme:'hronal'},floors:[{
  floor:0,y:0,doorways:[
    {to:shaftAnte.id,from:'shaft-f0',point:{x:8,z:15}},
    {to:firstAfterAnte.id,from:shaftAnte.id,point:{x:14,z:15}},
    {to:room2.id,from:firstAfterAnte.id,point:{x:30,z:15}}],
  wings:[{id:'floor0-E',side:'E',anteroom:shaftAnte,rooms:[firstAfterAnte,room2]}],
}]});
assert(withAnte.ok,withAnte.errors.join('; '));
assert.equal(withAnte.rooms.length,3,'shaft anteroom is an independently owned room');
assert.equal(withAnte.doors.length,3,'shaft anteroom gets a real door');
assert.deepEqual(withAnte.doors.map(door=>door.initiallyLocked),[false,false,true],
  'anteroom and initial challenge open automatically; later progression remains gated');
assert.equal(withAnte.rooms[0].blocked.length,2,'5-cell entrance wall retains a three-cell shaft doorway');
assert.equal(withAnte.rooms[0].kind,'shaft-antechamber');
assert(withAnte.rooms[0].ambient,'anteroom shares normal per-room ambience');
const v50=Rooms.v50Rooms({cellSize:.5,rooms:[{id:'vestibule',col:2,row:3,w:6,h:8}]},{
  originX:40,originZ:70,tileScale:2,y:12,prefix:'v50-f1',theme:'kanthic',
});
assert.deepEqual(v50.map(r=>[r.id,r.x,r.z,r.w,r.d,r.y]),[['v50-f1:vestibule',42,73,6,8,12]]);
assert.deepEqual(v50[0].ambient.color,[0,0,0]);
const sunkenRoom={...v50[0],supportYAt:(x,z)=>x<45?11.16:13.26}; // One native chamber can include lower and upper plateau cells around its nominal Y=12.
assert.equal(Rooms.roomAt([sunkenRoom],42.5,74,11.16)?.id,'v50-f1:vestibule',
  'a sunken native plateau remains active instead of suspending its puzzle');
assert.equal(Rooms.roomAt([sunkenRoom],47,74,13.26)?.id,'v50-f1:vestibule',
  'room ownership follows actual raised native floor support');
assert.equal(Rooms.roomAt([sunkenRoom],42.5,74,10.3),null,
  'players below the local plateau may not wake that V50 chamber');
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
const hronalLayout={...layout,rooms:layout.rooms.map(room=>({...room,theme:'hronal'}))}; // Every tradition now keeps isolated light ownership without a projected hull.
const session=Rooms.mount({layout:hronalLayout,getPlayerPosition:()=>player,getPlayerY:()=>player.y,
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
const previousLayerLights=global.RuinLayerPlayable; // A real lit source in this chamber changes only its steady room ambient.
global.RuinLayerPlayable={roomLights:()=>[
  {x:34,y:1,z:14,strength:.9,active:true},
  {x:14,y:1,z:14,strength:1,active:true}, // This other room's stronger fire must not leak into the active room.
]};
assert.equal(session.ambient().illumination,.9);
assert(Math.abs(session.ambient().darknessOffset-(-.035-.9*.13))<1e-9,
  'solving one chamber restores uniform room-wide visibility without a projected tunnel frame');
global.RuinLayerPlayable=previousLayerLights;
let fills=0,projections=0,clips=0;
const ctx={globalAlpha:.8,clip(){clips++;throw new Error('The room mask must not paint any projected polygon');}};
const project=()=>{projections++;throw new Error('A full-screen tint needs no camera projection');};
session.prepareLightClip(project); // Retained compatibility entry must do no work.
assert.equal(session.withLightClip(ctx,{x:34,y:1,z:14},project,()=>{
  fills++;assert.equal(ctx.globalAlpha,.8,'room lights must preserve the caller alpha');
}),true);
assert.equal(fills,1,'one room light is one unclipped paint, not a series of feather bands');
assert.equal(projections,0,'no bounding box is projected into screen space');
assert.equal(clips,0,'there are no rectangular canvas clips or feather bands');
for(let i=0;i<80;i++)assert.equal(session.withLightClip(ctx,{x:34,y:1,z:14},project,()=>{fills++;}),true);
assert.equal(fills,81,'many room glows still use one draw each, without additional canvas passes');
assert.equal(session.withLightClip(ctx,{x:14,y:1,z:14},project,()=>{fills++;}),false,
  'a source in a different room cannot contribute to the current room');
assert.equal(fills,81,'rejected lights do not draw');
assert.equal(session.withLightClip(ctx,{x:34,y:1,z:14},project,null),false,
  'invalid drawing callbacks must be ignored');
assert.equal(session.roomGlowRadius({x:35.5,y:1,z:15.5},20),5.4,
  'the solved room light fades at the nearest world-space stone wall without a colored rectangle');
assert.equal(session.roomGlowRadius({x:31,y:1,z:15},4),.9,
  'off-center room lights fade before their adjacent wall');
assert.equal(session.roomGlowRadius({x:14,y:1,z:14},4),4,
  'light sources outside the active chamber keep their authored radius');
assert.equal(session.roomGlowRadius({x:35,y:10,z:15},6),6,
  'another story at the same tile does not inherit the active room light radius');
assert.equal(session.roomGlowRadius({x:NaN,y:1,z:15},6),6,
  'malformed source positions cannot create a clipped light or extra room searches');
let regionClips=0,regionPaints=0,projectionsRegion=0; // Verify no camera-space polygon is generated for any room.
const regionCtx={save(){throw Error('no room hull may save a canvas clip');},
  clip(){regionClips++;throw Error('no projected tunnel light frame is permitted');}};
const roomProjection=()=>{projectionsRegion++;throw Error('room light ownership must not project the camera volume');};
assert.equal(session.withLightRegion(regionCtx,roomProjection,()=>{regionPaints++;}),true);
assert.equal(regionPaints,1);
assert.equal(regionClips,0);
assert.equal(projectionsRegion,0);
assert.throws(()=>session.withLightRegion(regionCtx,roomProjection,()=>{throw new Error('intentional redraw failure');}),
  /intentional redraw failure/);
assert.equal(regionClips,0,'failed callbacks leave no canvas masks behind');
assert.equal(projectionsRegion,0,'failed callbacks never project room corners');
assert.equal(session.withLightRegion(regionCtx,roomProjection,()=>{regionPaints++;}),true);
assert.equal(regionPaints,2,'unclipped room lighting still draws after an exception');
const lightDebug=session.snapshot().lightClip;
assert.equal(lightDebug.mode,'full-screen-tint');
assert.equal(lightDebug.feathered,false);
assert.equal(lightDebug.canvasPasses,0);
assert.equal(lightDebug.bands,0);
assert.equal(projections,0);
assert.equal(clips,0);
assert.equal(ctx.globalAlpha,.8,'source filtering must not mutate shared Canvas state');
const boundaryDebug=session.snapshot().localLightBoundary;
assert.equal(boundaryDebug.mode,'unclipped-hronal-screen-overlay');
assert.equal(boundaryDebug.active,false,'a colored projected room hull must never return');
assert.equal(boundaryDebug.roomIsolated,true,'room-source filtering still isolates the visible chamber');
assert.equal(boundaryDebug.canvasPasses,0);
const fogSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../docs/js/cloud-forest-fog.js'),'utf8');
assert.match(fogSource,/RUIN_SCREEN_TINT_ALPHA\s*=\s*0\.07/,'the new full-screen tradition overlay is intentionally subtle');
assert.match(fogSource,/ctx\.fillRect\(0,0,rect\.width,rect\.height\)/,'the tint fills the entire viewport');
assert.match(fogSource,/paintRuinScreenTint\(ctx,rect,ruinTradition\)/,'ordinary enclosed ruins render the full-screen tint');
assert.match(fogSource,/paintRuinScreenTint\(ctx,rect,activeRuinTradition\(\)\)/,'fog-backed ruins use that same tint');
assert.doesNotMatch(fogSource,/prepareLightClip\?\./,'lighting redraw cannot revive old room polygon precomputation');
assert.equal((fogSource.match(/withRuinLightRegion\(ctx,\(\)=>\{/g)||[]).length,2,
  'both enclosed and fog-backed lighting route source masks through the room-owned compositor');
assert.match(fogSource,/roomBound===true[\s\S]*roomGlowRadius/,
  'large solved-room lights fade naturally before the actual wall boundary');
player.x=24;session.tick(.31);
assert.equal(session.activeRoomId,null,'hallways are seamless transition space, not an extra sealed room');
session.withLightRegion(regionCtx,roomProjection,()=>{regionPaints++;});
assert.equal(regionClips,0,'hallway and room lighting must remain free of projected hulls');
assert.equal(regionPaints,3);
assert.equal(enemy.areaId,'__ruin_room_sleep__:'+ruin,'leaving the room immediately breaks pursuit');
assert.equal(walker.area,'__ruin_room_sleep__:'+ruin,'civilian NPCs also stop when the player leaves');
session.dispose();
assert.equal(enemy.areaId,ruin,'disposing a dungeon never leaves stale sleeping actors');
assert.equal(walker.area,ruin,'no NPC remains assigned to a sleeping synthetic area after cleanup');
const tothalSession=Rooms.mount({layout,getPlayerPosition:()=>player,getPlayerY:()=>player.y,
  getHostiles:()=>new Set(),getWalkers:()=>[],mapId:ruin,tile:TILE});
player.x=34;player.z=14;tothalSession.tick(.31);
let diffuseDraws=0;
const noTothalClip={save(){throw Error('Tothal cannot create a hard projected light frame');},
  clip(){throw Error('Tothal cannot clip its overcast light');}};
assert.equal(tothalSession.withLightRegion(noTothalClip,()=>{throw Error('Tothal must not project a room hull');},()=>{diffuseDraws++;}),true);
assert.equal(diffuseDraws,1,'Tothal ceiling/wall illumination draws once without a room-shaped cutout');
assert.equal(tothalSession.lightAllowed({x:14,y:1,z:14}),false,'unclipped Tothal still rejects light in another room');
assert.equal(tothalSession.lightAllowed({x:34,y:1,z:14}),true,'Tothal keeps light in the active room');
assert.deepEqual(tothalSession.snapshot().localLightBoundary,
  {mode:'unclipped-tothal-overcast',active:false,roomIsolated:true,canvasPasses:0,illumination:0},'mobile diagnostics distinguish the Tothal path');
tothalSession.dispose();
const kanthicLayout={...layout,rooms:layout.rooms.map(room=>({...room,theme:'kanthic'}))}; // Compare Kanthic against the same independent physical rooms.
const kanthicSession=Rooms.mount({layout:kanthicLayout,getPlayerPosition:()=>player,getPlayerY:()=>player.y,
  getHostiles:()=>new Set(),getWalkers:()=>[],mapId:ruin,tile:TILE});
kanthicSession.tick(.31);
let kanthicDraws=0; // Counts one stable screen lighting pass, not projected room masks.
const noKanthicClip={save(){throw Error('Kanthic cannot project a room light frame');},
  clip(){throw Error('Kanthic cannot clip a room light frame');}};
assert.equal(kanthicSession.withLightRegion(noKanthicClip,()=>{throw Error('Kanthic must not project room geometry');},
  ()=>{kanthicDraws++;}),true);
assert.equal(kanthicDraws,1,'Kanthic lighting is a viewport-stable overlay');
assert.equal(kanthicSession.lightAllowed({x:14,y:1,z:14}),false,'Kanthic still rejects lights from separate rooms');
assert.equal(kanthicSession.lightAllowed({x:34,y:1,z:14}),true,'Kanthic retains local brazier lighting');
assert.deepEqual(kanthicSession.snapshot().localLightBoundary,
  {mode:'unclipped-kanthic-screen-overlay',active:false,roomIsolated:true,canvasPasses:0,illumination:0});
const previousSanctumLights=global.DevRandomRuinSanctum;
const brazierSource={x:34,y:1,z:14,strength:.98,active:true,flameAnchor:{}};
global.DevRandomRuinSanctum={lightSources:()=>[brazierSource]};
assert.equal(kanthicSession.ambient().illumination,0,'lit Kanthic brazier never lifts room-wide ambient darkness');
global.DevRandomRuinSanctum={lightSources:()=>[brazierSource,{x:34,y:1,z:14,strength:.8,active:true}]};
assert.equal(kanthicSession.ambient().illumination,.8,'non-brazier encounter reveal still lifts room ambience');
global.DevRandomRuinSanctum=previousSanctumLights;
kanthicSession.dispose();
assert.match(fogSource,/const mistActive = active;/,
  'Kanthic restores the Cloud Forest mist cylinders instead of suppressing them');
assert.match(fogSource,/group\.visible = mistActive && \(!westernSlope \|\| slopeOpacityScale > 0\.002\);/,
  'Kanthic retains the existing mist layers while clear Western Slope weather still skips them');
assert.match(fogSource,/if \(!group\.visible\) return;/,
  'Only invisible mist groups skip per-frame updates, including calm Western Slope snow haze');
assert.doesNotMatch(fogSource,/ruinMistFade|inRuinShaft/,'old shaft-centered mist animation must not return');
console.log('ruin-room-system: enclosure, real Kanthic mist, stable overlay, physical walls and enemy resets OK');
