#!/usr/bin/env node
'use strict';
// Regression suite for octagonal shared-room shafts, wide-grid 2D layers,
// and the ordinary walkable hallway replacing the old shaft teleport.
const assert=require('assert');
const fs=require('fs');
const G=require('../docs/js/cell-grid-3d.js');
const H=require('../docs/js/shaft-hub.js');
const Plan=require('../docs/js/ruin-layer-plan.js');
const Corridor=require('../docs/js/ruin-shaft-corridor.js');
const Connector=require('../docs/js/ruin-shaft-connector.js');
const Playable=require('../docs/js/ruin-layer-playable.js');
const Challenges=require('../docs/js/ruin-layer-challenges.js'); // Canonical projectile and plate stage logic. // Tests mounted stone wings, challenge gates and braziers.

const runtime=fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
assert(runtime.includes('attachShaftHub(rec,candidateSeed);'),'every generated ruin retains a shaft');
assert(runtime.includes('attachShaftHub(rec,0);'),'story vault retains the shaft');
assert(runtime.includes('window.RuinShaftConnector'),'runtime must use physical hallway module');
assert(!runtime.includes("passage('Enter Shaft Hub'"),'no gameplay teleporter into the shaft');
assert(!runtime.includes("passage('Return to Ruin'"),'no gameplay teleporter out of the shaft');
for(const file of ['ruin-layer-plan.js','ruin-shaft-corridor.js','ruin-shaft-connector.js','ruin-layer-playable.js','ruin-layer-challenges.js'])
  assert(index.includes(file),'game page must load '+file);

// At identical X/Z, select the actor's story grid instead of the first
// registered one; the shared shaft still owns all levels of its own portal.
{
  const lower=G.create({cols:10,rows:10,baseY:0});
  const upper=G.create({cols:10,rows:10,baseY:4});
  const hub=G.create({cols:10,rows:10,baseY:0,levels:20});
  const stacks=new Map([['lower',{grid:lower,contains:()=>true}],
    ['upper',{grid:upper,contains:()=>true}]]);
  assert.equal(Playable.selectGrid(stacks,5,5,0),lower);
  assert.equal(Playable.selectGrid(stacks,5,5,4),upper);
  assert.equal(Playable.selectGrid(stacks,5,5,8),upper);
  stacks.set('shaft-hub',{grid:hub});
  assert.equal(Playable.selectGrid(stacks,5,5,8),hub,'hub owns every portal height');
  const footprint=new Map([['lower',{grid:lower,contains:()=>false}],
    ['upper',{grid:upper,contains:(x,z)=>x<6&&z<6}]]);
  assert.equal(Playable.selectGrid(footprint,5,5,0),upper,'empty lower wing bounds never capture upper rooms');
  assert.equal(Playable.selectGrid(footprint,8,8,4),null,'no collision owner beyond all actual footprints');
}

// Every floor is an independent ordinary 2D plan, with one shared, grid-snapped,
// wide octagonal anchor, 1..4 wings, multiple challenges and one brazier per wing.
let plannedWings=0;
for(let seed=1;seed<=1000;seed++){
  const plan=Plan.compose({seed});
  assert(plan.ok,'planner seed '+seed+' '+plan.checks.filter(c=>!c.ok).map(c=>c.name).join(','));
  assert(plan.floorCount>=3&&plan.floorCount<=5);
  assert.equal(plan.floors.length,plan.floorCount);
  assert.equal(plan.shaft.shape,'octagon');
  for(const floor of plan.floors){
    assert.deepEqual(floor.anchor,plan.shaft.anchor,'shaft position shared across all 2D floors');
    assert(floor.wings.length>=1&&floor.wings.length<=4);
    assert.equal(floor.wings.length,floor.braziers.length);
    for(const wing of floor.wings){
      plannedWings++;
      assert(wing.rooms.filter(r=>!!r.challenge).length>=2,'multiple challenge rooms before brazier');
      assert.equal(wing.rooms.filter(r=>r.kind==='brazier-chamber').length,1,'exactly one brazier endpoint');
      assert.equal(wing.corridors.length,wing.rooms.length,'hallway per progression stage');
    assert.equal(wing.rooms[0].challenge,'pressurePlate','every wing starts with a functional stone plate');
    assert(['glyphObelisk','ceilingRailTargets'].includes(wing.rooms[1].challenge),
      'every wing includes a real ranged-target room, never a fake labelled placeholder');
      assert(wing.corridors.every(h=>h.length>0&&h.rects.length>=1),'variable-length halls must have footprint');
      if(seed<=80){
        // Regression: even-sized rooms once had an invisible one-cell gap at
        // their entry threshold. Flood from the actual shaft portal, not the
        // room centre, and require every planned goal chamber to be reachable.
        const walk=Playable.collect(wing),start=wing.entry.x+','+wing.entry.z;
        assert(walk.has(start),'corridor must include the shaft-side threshold');
        const seen=new Set([start]),queue=[start];
        for(let n=0;n<queue.length;n++){
          const [x,z]=queue[n].split(',').map(Number);
          for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
            const next=(x+dx)+','+(z+dz);
            if(walk.has(next)&&!seen.has(next)){seen.add(next);queue.push(next);}
          }
        }
        for(const room of wing.rooms)assert(seen.has(
          Math.floor(room.x+room.w/2)+','+Math.floor(room.z+room.d/2)),
          'every room must be physically connected to its story portal: '+room.id);
      }
    }
  }
}

// Real multi-level room: outer eight-sided shell, accessible upper-floor galleries,
// exposed climb surfaces, and true physical ground entrance (no room teleport).
for(const floors of [3,4,5]) for(const seed of [1,2,3,5,8,13,21,34]){
  const r=H.compose({seed,floors,shaft:33,wall:8,chambers:false,entranceSide:'W'});
  assert(r.ok,'hub '+floors+' floors seed '+seed+': '+JSON.stringify(r.checks.filter(c=>!c.ok)));
  assert.equal(r.options.octagon,true);
  assert.equal(r.stories.length,floors);
  assert.equal(r.cols,49);
  assert.equal(r.entrance.side,'W');
  assert(!r.grid.isSolid(0,0,1),'octagon must visibly clip the square shell corners');
  assert(r.grid.isSolid(0,Math.floor(r.rows/2),2),'the wall remains solid above the ground entrance');
  assert.equal(r.balconies.length,floors-1);
  const reach=H.reachable(r);
  for(const story of r.stories.slice(1)){
    assert(story.gallery.length>100,'an upper story has a substantial octagonal ring');
    assert(story.gallery.every(c=>reach.has(c.col,c.row,story.level)),
      'all open gallery cells must be physically reachable');
  }
  for(const door of r.doors)assert(reach.has(door.col,door.row,door.level),'upper floor tunnel reachable');
}
{
  const r=H.compose({floors:9,shaft:4,spacing:1});
  assert(r.ok);
  assert.equal(r.options.floors,5);assert(r.options.shaft>=17);
  assert(r.options.spacing>=3);
}
{
  const r=H.compose({floors:4,wall:8,chambers:false,entranceSide:'W'});
  const count=r.grid.standingSurfaces({clearance:2}).length;
  const records=[];
  const DS={registerSurface:d=>records.push(d),clearScope(){}};
  const mount=H.mount(r,{DynamicSurfaces:DS,scope:'test-octagonal-supports'});
  assert(mount.floors>20&&mount.floors<count*.1,
    'coalesced support surfaces must avoid thousands of per-cell records: '+count+' => '+mount.floors);
  assert(records.every(d=>d.topY<r.grid.levelToY(r.levels-1)),'no roof-top phantom support');
  assert(records.some(d=>d.topY===12),'upper level registered');
  H.unmount({scope:'test-octagonal-supports'});
}

// Four possible original entrance sides physically connect to the west shaft mouth.
// The new 2D corridor is made of real cells, with support rectangles covering them.
for(const start of [{x:20,z:1},{x:1,z:25},{x:100,z:30},{x:32,z:100}]){
  const args={start,end:{x:130,z:65},width:3,maxX:185,maxZ:145,
    mainBounds:{minX:2,minZ:2,maxX:100,maxZ:100},
    shaftBounds:{minX:130,minZ:40,maxX:179,maxZ:89}};
  const path=Corridor.route(args);
  assert(path.ok,'hallway approach from '+JSON.stringify(start)+' '+path.reason);
  assert(path.length>0&&path.path.length>0);
  const regions=Corridor.rectangles(path.tiles);
  assert(regions.length<path.tiles.length*.5,'merge hallway support boxes');
  for(const [x,z] of path.tiles)
    assert(regions.some(r=>x>=r.minC&&x<=r.maxC&&z>=r.minR&&z<=r.maxR),
      'every route tile has a broad collision/support rectangle');
}

// Generated entrance rooms can lie DEEP INSIDE the generator's rectangular
// extent. The connector must route around genuinely occupied cells, not refuse
// all empty space inside the original world bounding rectangle.
{
  const occupied=new Set();
  for(let z=15;z<42;z++)for(let x=15;x<36;x++)occupied.add(x+','+z);
  for(const start of [{x:25,z:14},{x:36,z:26},{x:25,z:42},{x:14,z:26}]){
    const p=Corridor.route({start,end:{x:130,z:65},width:3,maxX:190,maxZ:130,
      existing:occupied,mainBounds:null,shaftBounds:{minX:130,minZ:40,maxX:179,maxZ:89}});
    assert(p.ok,'inner V50 entrance must connect through unused space: '+JSON.stringify(start));
    assert(p.path.every(cell=>!occupied.has(cell.x+','+cell.z)),'hallway may not cut through occupied V50 room floor');
  }
}

// Real connector wiring using lightweight Three/occupancy doubles.
// No real browser is required to prove the returned floor tiles meet both ends.
class Group {
  constructor(){this.children=[];this.parent=null}
  add(node){this.children.push(node);node.parent=this}
  remove(node){this.children=this.children.filter(n=>n!==node);node.parent=null}
  traverse(fn){fn(this);for(const n of this.children)n.traverse?n.traverse(fn):fn(n)}
}
class Matrix4 {makeTranslation(x,y,z){this.xyz=[x,y,z];return this}}
class Geometry {rotateX(){return this}dispose(){}}
class Mesh extends Group{
  constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.visible=true;
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};} // Position changes are observable for moving rail targets.
}
class Material {clone(){return new Material()}dispose(){}}
class InstancedMesh {
  constructor(geometry,material,count){this.geometry=geometry;this.material=material;this.count=count;this.instances=[];this.instanceMatrix={needsUpdate:false};}
  setMatrixAt(i,matrix){this.instances[i]=matrix.xyz}
}
const THREE={Group,Mesh,BoxGeometry:Geometry,PlaneGeometry:Geometry,Matrix4,
  CylinderGeometry:Geometry,ConeGeometry:Geometry,MeshBasicMaterial:Material,InstancedMesh,FrontSide:0};
// Dungeon fire puzzles require a genuinely ignited player projectile to
// reach a registered heat target; ordinary ranged hits never call onBurn.
{
  const controls=[],targets=new Map(),removed=[],bus={hasActiveRuinState:()=>true};
  const fire={
    armNextProjectile:()=>true,
    registerTarget:t=>{targets.set(t.id,t);return t.id;},
    unregisterTarget:id=>{removed.push(id);return targets.delete(id);}
  };
  let currentY=4,solved=0;
  const challenge=Challenges.compose({THREE,parent:new Group(),room:{x:20,z:22,w:14,d:14},
    id:'ice-test',kind:'dungeonFire',y:4,isActive:()=>true,
    getPlayerPosition:()=>({x:27,z:29}),getPlayerY:()=>currentY,
    projectileBus:bus,dungeonFire:fire,addControl:control=>controls.push(control),
    onSolved:()=>solved++});
  challenge.tick(.05);
  assert(challenge.fireLinked&&targets.has('layer-fire-target-ice-test'));
  assert.equal(controls[0].kind,'dungeonFireSource');
  currentY=0;
  controls[0].onPress();
  assert.equal(targets.get('layer-fire-target-ice-test').isActive(),false,
    'ignition sources and heat targets belong to a particular story elevation');
  assert.equal(challenge.fireRecord.onBurn(),false);
  currentY=4;controls[0].onPress();
  assert.equal(challenge.fireRecord.onBurn(),true,'native fire collision burns the seal');
  assert(challenge.solved&&solved===1);
  challenge.dispose();assert.equal(targets.size,0,'fire contact target must unregister on reroll');
}

// A generated Scratchbone melody belongs to the game's existing eight-note
// flute session, and a failed or unrelated melody cannot unlock the gate.
{
  const handlers=new Map(),started=[]; // Event bus and captured challenge payload from the real MusicMinigame signature.
  const events={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{
    if(handlers.get(name)===fn)handlers.delete(name);
  }};
  const music={beginPlayerSession:arg=>{started.push(arg);return true;}};
  let floor=4,player={x:27,z:29},done=0;
  const melody=Challenges.compose({THREE,parent:new Group(),room:{x:20,z:22,w:14,d:14},
    id:'melody-test',kind:'melodyEcho',y:4,isActive:()=>true,
    getPlayerPosition:()=>player,getPlayerY:()=>floor,
    music,events,onSolved:()=>done++});
  assert.equal(melody.notes.length,Challenges.melodyFor('melody-test').length);
  assert(melody.notes.every(n=>Number.isInteger(n)&&n>=0&&n<8));
  melody.tick(.05);
  assert.equal(started.length,1,'stepping onto bronze plate plays one existing flute echo session');
  for(let i=0;i<10;i++)melody.tick(.05);
  assert.equal(started.length,1,'standing still does not restart the melody');
  handlers.get('hobunji-ruin-melody-result')({detail:{id:'someone-else',solved:true}});
  handlers.get('hobunji-ruin-melody-result')({detail:{id:'melody-test',solved:false}});
  assert.equal(done,0,'wrong and unrelated melodies do not complete a room');
  player={x:20,z:22};melody.tick(.05);player={x:27,z:29};melody.tick(.05);
  assert.equal(started.length,2,'stepping off and on replays this fixed note sequence');
  assert.deepEqual(started[0].echoChallenge.notes,started[1].echoChallenge.notes);
  floor=0;melody.tick(.05);assert.equal(started.length,2,'lower story cannot trigger this floor plate');
  floor=4;handlers.get('hobunji-ruin-melody-result')({detail:{id:'melody-test',solved:true}});
  assert(melody.solved&&done===1,'real instrument success opens the gate once');
  melody.dispose();assert(!handlers.size,'melody result event listener removed on ruin exit');
}

// Real projectile challenges share the canonical ranged-hit bus; a stale
// session must unregister every target and a projectile from another story
// must never complete the current room.
{
  const parent=new Group(),targets=new Set(),bus={
    registerExternalProjectileTarget(t){targets.add(t);return ()=>targets.delete(t)}
  };
  let elevation=4,active=true,completions=0; // Mutable player story and gate stage used by these acceptance cases.
  const room={x:20,z:22,w:14,d:14};
  const glyph=Challenges.compose({THREE,parent,room,y:4,id:'test-glyph',kind:'glyphObelisk',
    isActive:()=>active,getPlayerPosition:()=>({x:27,z:29}),getPlayerY:()=>elevation,
    projectileBus:bus,onSolved:()=>completions++});
  glyph.tick(.05);assert(glyph.linked&&targets.size===3,'three glyphs use the real projectile bus');
  elevation=0;glyph.simulateHit(0);assert.equal(glyph.hits,0,'wrong-story glyph hit is ignored');
  elevation=4;
  for(let i=0;i<glyph.targetCount;i++)glyph.simulateHit(i);
  assert(glyph.solved&&completions===1,'real target callbacks solve the chamber once');
  glyph.simulateHit(0);assert.equal(completions,1,'repeated projectiles do not retrigger rewards');
  glyph.dispose();assert.equal(targets.size,0,'projectile targets unregister on reroll');
  const rail=Challenges.compose({THREE,parent,room,y:8,id:'test-rail',kind:'ceilingRailTargets',
    isActive:()=>true,getPlayerPosition:()=>({x:27,z:29}),getPlayerY:()=>8,
    projectileBus:bus,onSolved:()=>completions++});
  const before=rail.targets[0].rune.position.x;
  rail.tick(.05);rail.tick(.05);
  assert(rail.linked&&targets.size===2,'moving rail targets use the same bus');
  assert(rail.targets[0].rune.position.x!==before||rail.targets[0].rune.position.z!==29,
    'the ranged target changes world position along the rail');
  rail.simulateHit(0);rail.simulateHit(1);
  assert(rail.solved&&completions===2);
  rail.dispose();assert.equal(targets.size,0,'moving rail hits unregister after disposal');
}

for(const side of ['north','east','south','west']){
  const isX=side==='west'||side==='east';
  const meta={cellSize:.5,worldWidth:54,worldDepth:49,
    entrance:{side,axis:isX?'x':'z',
      boundary:side==='west'||side==='north'?0:(side==='east'?108:98),
      center:isX?48:50}};
  const makeTile=walkable=>({type:walkable?'grass':'rock'});
  const rec={cols:150,rows:140,grid:Array.from({length:140},()=>Array.from({length:150},()=>makeTile(false))),
    floorSet:new Set(),mapData:{id:'map_i_dev_random_ruin',floor:[]},scene:new Group()};
  const ruin={localeRoot:new Group(),occupancy:{},mechanisms:new Map(),transitDoors:[],activators:[],pushBlocks:[],controls:[]};
  let player={x:5,z:7,y:0}; // Mutable position to test upper-story plate activation.
  const DS={registerSurface(){},clearScope(){}};
  const climb={registerGrid:()=>3,clearScope(){}};
  const dev={registerShaftGrid(){},unregisterShaftGrid(){}};
  const occupancy={create(config){return {cols:config.cols,rows:config.rows,getPosition:config.getPlayerPosition}}};
  const connected=Connector.connect({rec,ruin,seed:23,meta,THREE,makeTile,DynamicSurfaces:DS,
    ShaftHub:H,ClimbSurfaces:climb,DevRandomRuin:dev,TileOccupancy:occupancy,
    RuinLayerPlan:Plan,RuinShaftCorridor:Corridor,RuinLayerPlayable:Playable,RuinLayerChallenges:Challenges,CellGrid3D:G,
    getPlayerPosition:()=>({x:player.x,z:player.z}),getPlayerY:()=>player.y});
  assert(connected.hub.ok,'integrated octagonal room passed reachability');
  assert(ruin.shaftConnection.physical,'the normal ruin entrance is a real corridor');
  assert.equal(ruin.shaftConnection.floorCount,connected.plan.floorCount);
  assert(ruin.shaftConnection.supportRects<100,'hallway support surfaces merged');
  assert.deepEqual(ruin.occupancy.getPosition(),{x:5,z:7},'occupancy must reuse injected player adapter');
  const network=connected.layerRuntime;
  network.tick(0);
  const upperVisual=network.group.children.find(c=>c.name==='ruin-layer-floor-1');
  assert.equal(upperVisual?.visible,false,'upper floor meshes must not cover player viewed from below');
  assert.equal(network.group.children.find(c=>c.name==='ruin-layer-floor-0')?.visible,true);
  assert.equal(network.getState().wings,connected.plan.totalWings,'every planned floor wing is instantiated');
  assert.equal(network.getState().braziers,connected.plan.totalWings,'one physical brazier per wing');
  assert.equal(ruin.controls.filter(c=>c.kind==='layerBrazier').length,network.getState().braziers);
  const challenge=network.states[0].challenges[0];
  assert(challenge.gate,'first chamber must block its outbound corridor until solved');
  const gateSolid=()=>challenge.gate.tiles.every(([c,r])=>challenge.grid.isSolid(
    challenge.grid.xToCol(c+.5),challenge.grid.zToRow(r+.5),0));
  assert(gateSolid(),'the first stone gate blocks only its floor-specific 3D collision grid');
  assert(challenge.gate.tiles.every(([c,r])=>rec.grid[r][c].type==='grass'),
    'shared 2D occupancy may not block another story at the same X/Z');
  player={x:challenge.x,z:challenge.z,y:challenge.floorY+4};
  for(let i=0;i<17;i++)network.tick(.05);
  assert(!challenge.solved,'a plate must not activate when player is on another story');
  player={x:challenge.x,z:challenge.z,y:challenge.floorY};
  for(let i=0;i<17;i++)network.tick(.05);
  assert(challenge.solved,'standing on the stone plate for .8s opens its gate');
  assert(!gateSolid(),'solving a plate removes the corresponding 3D gate obstruction');
  const first=network.states[0],brazierControl=ruin.controls.find(c=>c.kind==='layerBrazier');
  brazierControl.onPress();
  assert.equal(network.getState().lit,0,'uncompleted wing cannot ignite its endpoint');
  for(const remaining of first.challenges.slice(1)){
    player={x:remaining.x,z:remaining.z,y:remaining.floorY};
    if(remaining.kind==='pressurePlate')for(let i=0;i<17;i++)network.tick(.05);
    else if(remaining.kind==='melodyEcho')remaining.onMelodyResult({id:remaining.id,solved:true}); // Canonical flute completion event.
    else if(remaining.kind==='dungeonFire')remaining.fireRecord.onBurn(); // Canonical fire-contact callback; not a normal arrow hit.
    else for(let i=0;i<remaining.targetCount;i++)remaining.simulateHit(i); // Dispatch actual projectile onHit callbacks.
    assert(remaining.solved,'the puzzle family must truly unlock its gate: '+remaining.kind);
  }
  brazierControl.onPress();
  assert.equal(network.getState().lit,1,'a completed wing can ignite its real brazier');
  for(const p of [connected.route.path[0],connected.route.path.at(-1)])
    assert(rec.floorSet.has(p.x+','+p.z),'both path endpoints are actual walkable tiles');
  assert(rec.mapData.floor.some(([c,r])=>c===connected.route.path.at(-1).x&&r===connected.route.path.at(-1).z));
  ruin.shaftConnectorCleanup();
  assert(network.disposed,'all secondary wing collision grids and meshes are disposable');
}
// The special story vault has no V50 `meta.entrance`: its authored southern
// doorway at (6,27) must still lead to the shared room on ordinary floor tiles.
{
  const makeTile=walkable=>({type:walkable?'grass':'rock'});
  const floorSet=new Set();
  for(let r=13;r<=27;r++)for(let c=5;c<=7;c++)floorSet.add(c+','+r);
  for(let r=3;r<=12;r++)for(let c=2;c<=10;c++)floorSet.add(c+','+r);
  const rec={cols:13,rows:30,
    grid:Array.from({length:30},(_,r)=>Array.from({length:13},(_,c)=>makeTile(floorSet.has(c+','+r)))),
    floorSet,mapData:{id:'map_i_dev_random_ruin',floor:[...floorSet].map(k=>k.split(',').map(Number))},
    exits:[{tiles:[[6,27]]}],scene:new Group()};
  const ruin={storyVault:true,localeRoot:new Group(),mechanisms:new Map(),
    transitDoors:[],activators:[],pushBlocks:[],controls:[]};
  const ds={registerSurface(){},clearScope(){}};
  const climb={registerGrid:()=>3,clearScope(){}};
  const dev={registerShaftGrid(){},unregisterShaftGrid(){}};
  const placed=Connector.connect({rec,ruin,seed:0,meta:{rooms:[{name:'vault'}]},
    THREE,makeTile,DynamicSurfaces:ds,ShaftHub:H,ClimbSurfaces:climb,
    DevRandomRuin:dev,RuinLayerPlan:Plan,RuinShaftCorridor:Corridor,
    RuinLayerPlayable:Playable,RuinLayerChallenges:Challenges,CellGrid3D:G,getPlayerPosition:()=>({x:6,z:27}),getPlayerY:()=>0});
  assert(placed.route.ok&&placed.route.path[0].x===6&&placed.route.path[0].z===28,
    'fixed story vault extends physically through its actual southern doorway');
  assert(rec.floorSet.has('6,28')&&ruin.shaftConnection.physical);
  ruin.shaftConnectorCleanup();
}
console.log('ok test-shaft-hub: 1000 layouts, '+plannedWings+' layered wings, real gates/braziers, climbable multi-story octagons, four walk-in approaches');
