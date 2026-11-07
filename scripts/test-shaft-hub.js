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
globalThis.RuinWallFaces=require('../docs/js/ruin-wall-faces.js'); // The wings and shaft build their stone from merged faces when this is loaded, as index.html loads it.
const Challenges=require('../docs/js/ruin-layer-challenges.js'); // Canonical projectile and plate stage logic. // Tests mounted stone wings, challenge gates and braziers.
const NetworkChallenges={...Challenges,compose(options){ // Only the network-progression test substitutes the compound room: its real 16 variants and native push state have separate focused runtime tests.
  if(options.kind!=='findBlocks')return Challenges.compose(options);
  const stage={id:options.id,kind:'findBlocks',ready:true,linked:true,solved:false, // Solved state is consumed by the REAL network gate and brazier code.
    tick(){},animate(){},dispose(){},
    simulateCompletion(){
      if(stage.solved||!options.isActive())return;
      stage.solved=true;options.onSolved(stage);
    }};
  return stage;
}};
const NativeV50=require('../docs/js/ruin-v50-native-floors.js'); // Actual V50 story layout and pre-reserved footprint enforcement.

const runtime=fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
assert(runtime.includes('attachShaftHub(rec,candidateSeed,{preplanned:planned,nativeFloors:nativeSnapshots});'),
  'a V50 ruin must mount the pre-reserved native multi-floor plan, not compose a fresh shaft after V50');
assert(runtime.includes('const planned=singleRoomTrial?null:placement?.plan||window.RuinLayerPlan?.compose?.(')
  &&runtime.indexOf('const planned=singleRoomTrial?null:placement?.plan||')>runtime.indexOf("const meta=generated.locale?.meta?.interiorShell"),
  'the entrance-specific shaft reservation must be composed from the generated one-room doorway orientation');
assert(runtime.includes('entryPadX=placement?.padX??PAD;entryPadZ=placement?.padZ??PAD;'),
  'the same aligned V50 projection must be used for room geometry and collision');
assert(runtime.includes('attachShaftHub(rec,0);'),'story vault retains the shaft');
assert(runtime.includes('window.RuinShaftConnector'),'runtime must use physical hallway module');
assert(!runtime.includes("passage('Enter Shaft Hub'"),'no gameplay teleporter into the shaft');
assert(!runtime.includes("passage('Return to Ruin'"),'no gameplay teleporter out of the shaft');
for(const file of ['ruin-layer-plan.js','ruin-shaft-corridor.js','ruin-shaft-connector.js','ruin-layer-playable.js','ruin-layer-challenges.js','ruin-v50-native-floors.js'])
  assert(index.includes(file),'game page must load '+file);

// A forced trial substitutes one regular challenge slot across the generated floors.
{
  const stages=new Set(),floors=new Set(); // Check that selection is not limited to the end of one wing or the entrance floor.
  for(let seed=1;seed<=100;seed++){
    const options={seed,nativeV50:true};
    const baseline=Plan.compose(options);
    const trial=Plan.compose({...options,plinthTrial:true});
    assert(trial.ok,trial.checks.filter(check=>!check.ok).map(check=>check.name).join(', '));
    assert.equal(trial.totalWings,baseline.totalWings);
    for(const plan of [baseline,trial])for(const floor of plan.floors)for(const wing of floor.wings){
      // A normal approach no longer spends 7–15 empty cells between rooms;
      // the puzzle/defence chambers and their gate-to-room connectivity stay unchanged.
      assert(wing.corridors.every(hall=>hall.length<=10),`overlong empty wing hallway on seed ${seed}: ${wing.id}`);
    }
    assert.equal(trial.totalBraziers,baseline.totalBraziers);
    for(const floor of baseline.floors){
      const blocks=floor.rooms.filter(room=>room.challenge==='findBlocks');
      assert(blocks.length>=1,'Every generated dungeon story has at least one Find the Blocks chamber');
      assert(blocks.length<=3,'Short wings should not repeat the same compound challenge excessively');
      assert(blocks.every(room=>room.w>=18&&room.d>=18),'Block puzzles have genuine 18x18 push-space footprints');
      for(const wing of floor.wings){
        const kinds=wing.rooms.map(room=>room.challenge);
        assert(!kinds.some((kind,i)=>kind==='findBlocks'&&kinds[i-1]==='findBlocks'),
          'Block puzzles must not be consecutive in the same wing');
      }
    }
    const floor=trial.floors.find(f=>f.rooms.some(room=>room.id===trial.trialRoomId));
    const wing=floor.wings.find(w=>w.rooms.some(room=>room.id===trial.trialRoomId));
    const stage=wing.rooms.findIndex(room=>room.id===trial.trialRoomId);
    const room=wing.rooms[stage];
    assert.equal(room.kind,'challenge-room');
    assert.equal(room.challenge,'statueDefense');
    assert(room.w>=18&&room.d>=18);
    assert.equal(wing.corridors[stage].to,room.id);
    assert.equal(wing.corridors[stage+1].from,room.id);
    stages.add(stage);
    floors.add(floor.floor);
  }
  assert.equal(stages.size,2,'trial room may appear in either of the two short branch puzzle slots');
  assert(floors.size>1);
}

// Native V50 upper stories reserve a concrete full-size footprint before
// ANY V50 floor is generated. Generated V50 rooms must fit inside it, and
// none of the authored wings or their corridors may intrude on that space.
{
  let floors=0;
  for(let seed=1;seed<=1000;seed++){
    const plan=Plan.compose({seed,anchorX:320,anchorZ:320,nativeV50:true});
    assert(plan.ok,'native plan '+seed+' '+plan.checks.filter(c=>!c.ok).map(c=>c.name).join(','));
    for(const floor of plan.floors){
      if(floor.floor===0){assert(!floor.nativePort);continue;}
      floors++;
      assert.equal(floor.wings.length,3,'all three free upper-story shaft exits house short independent wings');
      assert.equal(floor.braziers.length,3,'each upper-story custom wing adds a required fire');
      const port=floor.nativePort,area=port.reservation;
      assert(area&&area.w===180&&area.d===180,'native floor allocation must exist before V50 runs');
      assert(!floor.wings.some(w=>w.side==='E'),'reserved east portal is exclusively native V50');
      for(const wing of floor.wings){
        for(const room of wing.rooms)assert(!Plan.intersects(room,area),'native reservation overlaps an authored room');
        for(const hall of wing.corridors)for(const rect of hall.rects)
          assert(!Plan.intersects(rect,area),'native reservation overlaps an authored corridor');
      }
      for(const size of [[8,8],[48,62],[180,180]]){
        const meta={cellSize:.5,gridCols:size[0],gridRows:size[1],
          entrance:{side:'west',axis:'x',boundary:0,center:Math.floor(size[1]/2)}};
        const placed=NativeV50.layoutPlacement(meta,port,2);
        assert(placed.originX>=area.x&&placed.originZ>=area.z);
        assert(placed.originX+placed.width<=area.x+area.w
          &&placed.originZ+placed.depth<=area.z+area.d,'native V50 geometry escaped its preplanned area');
      }
      assert.throws(()=>NativeV50.layoutPlacement({
        cellSize:.5,gridCols:181,gridRows:10,
        entrance:{side:'west',axis:'x',boundary:0,center:5}
      },port,2),/Invalid native V50/,'oversized V50 floor must fail before scene mutation');
    }
  }
  assert(floors>=2000,'exercise real multi-story native V50 reservations');
}

// The entry door and native V50 room each keep their exclusive side; all other
// exits become independent braziers instead of extending an existing wing.
for(let seed=1;seed<=100;seed++){
  const plan=Plan.compose({seed,nativeV50:true,groundEntranceSide:'W'});
  assert(plan.ok,'reserved entrance plan must remain valid');
  for(const floor of plan.floors){
    assert.equal(floor.wings.length,3,'three free wall exits must be occupied');
    assert.equal(floor.braziers.length,3,'each free exit must end at its own brazier');
    const sides=new Set(floor.wings.map(wing=>wing.side));
    assert(!sides.has(floor.floor===0?'W':'E'),'a reserved portal must not be reused');
    assert(floor.wings.every(wing=>wing.rooms.length<=3),'a long challenge sequence must not survive inside a wing');
    assert(floor.wings.some(wing=>wing.rooms.slice(0,-1).some(room=>
      ['glyphObelisk','ceilingRailTargets'].includes(room.challenge))),
      'each story retains a real ranged puzzle while distributing rooms');
  }
  assert.equal(plan.totalBraziers+plan.nativeFloorCount,plan.floorCount*4-1,
    'Great Door must require a fire from each free shaft exit and each reserved native V50 floor');
}

// The sanctum's Great Door belongs to the shared shaft wall, not a V50
// challenge-room wall. It is a teleport destination so it must be accessible
// from floor-zero stone without stealing any of that story's four exits.
{
  const sanctum=fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8'); // Assert the real composer consumes the shaft's validated door site.
  const interior=fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8'); // The public runtime exposes the same site without private globals.
  assert(sanctum.includes('context.shaftHub===true')&&sanctum.includes('getShaftSanctumDoorSite'),
    'normal ruins mount the Great Door at the main shaft instead of choosing a V50 wall');
  assert(sanctum.includes('teleport(s.entry)')&&sanctum.includes('teleport(door.front)'),
    'entering the distant sanctum and returning both use the canonical fade teleport');
  assert(interior.includes('getShaftSanctumDoorSite:()=>ruin?.shaftSanctumDoorSite||null'),
    'public ruin API exposes the checked shaft wall site');
  for(let seed=1;seed<=160;seed++){
    const plan=Plan.compose({seed,anchorX:320,anchorZ:320,nativeV50:true,
      groundEntranceSide:['N','E','S','W'][seed%4]});
    assert(plan.ok,'valid four-sided plan for door '+seed);
    const portals=plan.floors.flatMap(f=>[
      ...f.wings.map(w=>({floor:f.floor,side:w.side})),
      ...(f.nativePort?[{floor:f.floor,side:f.nativePort.side}]:[]),
    ]);
    const hub=H.compose({seed,shaft:plan.options.shaftSize,wall:plan.options.shaftWall,
      floors:plan.floorCount,spacing:plan.options.floorHeight,portals,
      entranceSide:plan.options.groundEntranceSide,traversal:plan.options.shaftTraversal,
      originX:plan.shaft.anchor.x-Math.floor((plan.options.shaftSize+plan.options.shaftWall*2)/2),
      originZ:plan.shaft.anchor.z-Math.floor((plan.options.shaftSize+plan.options.shaftWall*2)/2)});
    assert(hub.ok,'the actual obelisk shaft and its wall exits must be traversable');
    const site=Connector.sanctumDoorSite(hub);
    assert(site?.shaft===true,'a safe, shaft-mounted final door must exist for every seed and entrance side');
    assert.equal(site.floorY,hub.grid.levelToY(0),'sanctum door is mounted on the shared shaft ground story');
    const front={x:site.x+site.normal.x*1.8,z:site.z+site.normal.z*1.8};
    const behind={x:site.x-site.normal.x*.4,z:site.z-site.normal.z*.4};
    const g=hub.grid;
    assert(g.canStand(g.xToCol(front.x),g.zToRow(front.z),0),'reachable walkable stone is in front of the door');
    assert(g.isSolid(g.xToCol(behind.x),g.zToRow(behind.z),0),'the Great Door is set against solid shaft masonry');
    assert(hub.wingPortals.filter(p=>p.floor===0&&p.side===site.side).every(p=>{
      const pAcross=site.normal.z?p.col:p.row;
      const across=site.normal.z?g.xToCol(site.x):g.zToRow(site.z);
      return Math.abs(pAcross-across)>=7;
    }),'the Great Door must not overlap an existing shaft portal');
  }
}

// Native V50 rope flights pass *plain* CellGrid3D axis-aligned boxes
// through the same segment intersection used by Three.Box3 projectile hits.
// Regress an actual 3D closed gate and avoid a rawBox.clone() runtime crash.
{
  const puzzleSource=fs.readFileSync('docs/js/dev-random-ruin-simple-puzzles.js','utf8');
  const begin=puzzleSource.indexOf('  function segmentBoxInterval(');
  const end=puzzleSource.indexOf('  function modularProjectileHit(',begin);
  assert(begin>=0&&end>begin,'reuse the canonical projectile segment interval');
  const intersect=new Function(puzzleSource.slice(begin,end)+'\nreturn segmentBoxInterval;')();
  const gate=G.create({cols:10,rows:10,levels:3,baseY:8});
  gate.set(4,4,0,G.KIND.SOLID);gate.set(4,4,1,G.KIND.SOLID);
  const start={x:3,y:8.8,z:4.5},stop={x:5,y:8.8,z:4.5};
  assert(intersect(start,stop,{min:{x:4,y:8,z:4},max:{x:5,y:10,z:5}},.02)?.enter>0,
    'plain voxel AABBs must work in the actual segment intersection function');
  const blocked=gate.solidSegmentHit(start,stop,.20,(a,b,record,pad)=>intersect(a,b,record.box,pad));
  assert(blocked!==null,'native rope flight must collide with its own story\'s closed stone gate');
  const elsewhere=gate.solidSegmentHit({...start,y:4.8},{...stop,y:4.8},.20,
    (a,b,record,pad)=>intersect(a,b,record.box,pad));
  assert.equal(elsewhere,null,'the same coordinates on a lower story remain unblocked');
}

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
// wide octagonal anchor, every unused shaft exit, 1–2 challenges and a required fire per branch.
let plannedWings=0;
for(let seed=1;seed<=1000;seed++){
  const plan=Plan.compose({seed});
  assert(plan.ok,'planner seed '+seed+' '+plan.checks.filter(c=>!c.ok).map(c=>c.name).join(','));
  assert(plan.floorCount>=3&&plan.floorCount<=5);
  assert.equal(plan.floors.length,plan.floorCount);
  assert.equal(plan.shaft.shape,'octagon');
  for(const floor of plan.floors){
    assert.deepEqual(floor.anchor,plan.shaft.anchor,'shaft position shared across all 2D floors');
    assert.equal(floor.wings.length,4,'all four available hub exits become short puzzle branches');
    assert.equal(floor.wings.length,floor.braziers.length);
    assert.equal(new Set(floor.wings.map(wing=>wing.side)).size,4,'one separate fire route emerges from every shaft exit');
    for(const wing of floor.wings){
      plannedWings++;
      assert(wing.rooms.filter(r=>!!r.challenge).length>=1 && wing.rooms.filter(r=>!!r.challenge).length<=2,
        'every shaft exit has only one or two puzzle chambers before its fire');
      assert.equal(wing.rooms.filter(r=>r.kind==='brazier-chamber').length,1,'exactly one brazier endpoint');
      assert.equal(wing.corridors.length,wing.rooms.length,'hallway per progression stage');
      if(wing.rooms.length===3){
        assert(['pressurePlate','findBlocks'].includes(wing.rooms[0].challenge),
          'a two-puzzle wing begins with a real stone plate or the full four-block compound puzzle');
        assert(['glyphObelisk','ceilingRailTargets','findBlocks'].includes(wing.rooms[1].challenge),
          'its second chamber uses the ranged family or Find the Blocks without skipping a progression gate');
        assert(!(wing.rooms[0].challenge==='findBlocks'&&wing.rooms[1].challenge==='findBlocks'),
          'consecutive large block puzzles would make a short wing repetitive');
      }else assert(Plan.DEFAULTS.minChallenges===1 && wing.rooms[0].challenge,
        'single-puzzle branches still require an implemented mechanism');
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
        // Solvability is not enough: a sealed gate must be a real cut-set
        // between consecutive challenge rooms. Otherwise players can bypass
        // the authored mechanism via an overlooked adjacent floor tile.
        const dir={N:[0,-1],E:[1,0],S:[0,1],W:[-1,0]}[wing.side];
        for(let stage=0;stage<wing.rooms.length-1;stage++){
          const end=wing.corridors[stage+1].end;
          const blocked=new Set(Array.from({length:3},(_,j)=>
            (end.x+dir[1]*(j-1))+','+(end.z+dir[0]*(j-1))));
          const open=new Set([start]),edge=[start];
          for(let n=0;n<edge.length;n++){
            const [x,z]=edge[n].split(',').map(Number);
            for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
              const next=(x+dx)+','+(z+dz);
              if(walk.has(next)&&!blocked.has(next)&&!open.has(next)){open.add(next);edge.push(next);}
            }
          }
          const nextRoom=wing.rooms[stage+1],goal=
            Math.floor(nextRoom.x+nextRoom.w/2)+','+Math.floor(nextRoom.z+nextRoom.d/2);
          assert(!open.has(goal),'the '+wing.id+' gate '+stage+' cannot be walked around before solving its challenge');
        }
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
  constructor(){this.children=[];this.parent=null;this.userData={}}
  add(node){this.children.push(node);node.parent=this}
  remove(node){this.children=this.children.filter(n=>n!==node);node.parent=null}
  traverse(fn){fn(this);for(const n of this.children)n.traverse?n.traverse(fn):fn(n)}
}
class Matrix4 {makeTranslation(x,y,z){this.xyz=[x,y,z];return this}}
class Geometry {rotateX(){return this}dispose(){}}
class Mesh extends Group{
  constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.visible=true;
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.scale={x:1,y:1,z:1};this.rotation={x:0,y:0,z:0};} // Include rotation for the horizontal rope-abyss fog plane.
}
class Material {clone(){return new Material()}dispose(){}}
class BufferAttribute {constructor(array,itemSize){this.array=array;this.itemSize=itemSize}}
class BufferGeometry {constructor(){this.attributes={}}setAttribute(name,attribute){this.attributes[name]=attribute}setIndex(index){this.index=index}dispose(){}} // The shaft's stone is real merged faces now (js/ruin-wall-faces.js).
class InstancedMesh {
  constructor(geometry,material,count){this.geometry=geometry;this.material=material;this.count=count;this.instances=[];this.instanceMatrix={needsUpdate:false};}
  setMatrixAt(i,matrix){this.instances[i]=matrix.xyz}
}
const THREE={Group,Mesh,BoxGeometry:Geometry,PlaneGeometry:Geometry,BufferGeometry,BufferAttribute,Matrix4,
  CylinderGeometry:Geometry,ConeGeometry:Geometry,MeshBasicMaterial:Material,InstancedMesh,FrontSide:0};
const Defense={create:options=>({
  id:options.id,kind:'statueDefense',ready:true,solved:false,
  tick(){},dispose(){this.disposed=true;},
  simulateCompletion(){if(this.solved)return;this.solved=true;options.onSolved(this);}
})}; // The separate authored-defence test verifies real plinth/encounter integration; the network test drives its completion callback.
// The rope gap must run wall-to-wall across each radial chamber, leaving
// exactly two safe banks and never trapping the player in a sealed room.
{
  for(const side of ['N','E','S','W']){
    const room={x:20,z:30,w:15,d:13},pit=Challenges.ropePitForRoom(room,side);
    assert(pit,'minimum generated room fits a three-or-more rope chain');
    assert(!pit.contains(room.x+.5,room.z+.5),'one corner is a safe bank or an intact side wall');
    const along=side==='E'||side==='W'?'x':'z';
    assert.equal(along==='x'?pit.maxX-pit.minX:pit.maxZ-pit.minZ,
      (along==='x'?room.w:room.d)-6,'three full safe floor cells at both entry and exit');
  }
  const room={x:20,z:30,w:15,d:13},parent=new Group();
  let player={x:21,z:36},y=8,solved=0,created=0,removed=0;
  const registry={
    hasActiveRuinState:()=>true,
    registerExternalRopeChain(spec){created++;return {external:true,...spec}},
    removeExternalRopeChain(){removed++;return true}
  };
  const crossing=Challenges.compose({THREE,parent,room,side:'E',id:'rope-test',
    kind:'ropeChain',y:8,getPlayerPosition:()=>player,getPlayerY:()=>y,
    projectileBus:registry,isActive:()=>true,onSolved:()=>solved++});
  crossing.tick(.05);
  assert(crossing.ropeLinked&&created===1,'native V50 riding engine claims authored rope chains');
  assert(crossing.ropeSpec.anchors.length>=3,'multiple independent mid-air catches are required');
  assert(crossing.ropeSpec.anchors.every(p=>p.x>crossing.pit.minX&&p.x<crossing.pit.maxX),
    'all rope anchors remain over the real bottomless opening');
  player={...crossing.ropeSpec.exit};y=4;crossing.tick(.05);
  assert.equal(solved,0,'being on the correct XZ but the wrong floor does not solve ropes');
  y=8;crossing.tick(.05);assert(crossing.solved&&solved===1,
    'only reaching the opposite supported bank at the right elevation opens the challenge gate');
  crossing.dispose();assert.equal(removed,1,'rider ropes unregister with the physical chamber');
}

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
    removeControl:control=>{const index=controls.indexOf(control);if(index>=0)controls.splice(index,1);},
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
  for(let i=0;i<18;i++)challenge.animate(.05);
  assert(challenge.meltProgress===1&&!challenge.fireSeal.visible,
    'the DungeonFire ice target reverses its growth to fully disappear after contact');
  challenge.dispose();assert.equal(targets.size,0,'fire contact target must unregister on reroll');
  assert.equal(controls.length,0,'fire source control must unregister on challenge disposal');
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

// The actual game builds V50's rope state on the first in-map frame; this
// test double records the same per-chamber registration/removal boundaries.
const savedSimplePuzzles=globalThis.DevRandomRuinSimplePuzzles; // Restored at test exit to avoid leaking registry state.
const liveChains=new Set();
globalThis.DevRandomRuinSimplePuzzles={
  hasActiveRuinState:()=>true,
  registerExternalRopeChain:spec=>{
    const chain={external:true,...spec};liveChains.add(chain);return chain;
  },
  removeExternalRopeChain:chain=>liveChains.delete(chain),
};

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
  const preplanned=Plan.compose({seed:23,anchorX:320,anchorZ:320,shaftTraversal:'buttress'}); // Deliberately differs from the old post-generation anchor.
  const connected=Connector.connect({rec,ruin,seed:23,meta,preplanned,THREE,makeTile,DynamicSurfaces:DS,
    ShaftHub:H,ClimbSurfaces:climb,DevRandomRuin:dev,TileOccupancy:occupancy,
    RuinLayerPlan:Plan,RuinShaftCorridor:Corridor,RuinLayerPlayable:Playable,RuinLayerChallenges:NetworkChallenges,RuinLayerDefense:Defense,CellGrid3D:G,
    getPlayerPosition:()=>({x:player.x,z:player.z}),getPlayerY:()=>player.y});
  assert(connected.hub.ok,'integrated octagonal room passed reachability');
  // The shaft's stone is merged stretch-to-fit faces in one masonry group (so decorateRuin can engrave the walls),
  // not a field of one-unit instanced boxes that repeat the texture per cell.
  let shaftShell=null;rec.scene.traverse(node=>{if(node.name==='shaft-hub')shaftShell=node;});
  assert(shaftShell,'the shaft shell is mounted');
  const masonry=shaftShell.children.find(node=>node.name==='shaft-hub-masonry');
  assert(masonry,'stone lives in a dedicated masonry group, apart from climb markings');
  const stone=Object.fromEntries(masonry.children.map(mesh=>[mesh.name,mesh]));
  for(const name of ['shaft-hub-walls','shaft-hub-ledges','shaft-hub-octagonal-floor'])
    assert(stone[name]?.geometry?.attributes?.position?.array?.length>0,name+' has real merged geometry');
  assert(stone['shaft-hub-walls'].geometry.attributes.uv.array.every(value=>value>=0&&value<=1),'every wall patch stretches its texture 0..1');
  // Broad walls are separate meshes in their own group: the pattern decorator makes one atlas per mesh, so engraving
  // hundreds of disjoint strips in one mesh would shrink the atlas to nothing.
  const featureGroup=masonry.children.find(node=>node.name==='shaft-hub-feature-walls');
  assert(featureGroup&&featureGroup.children.length>=4&&featureGroup.children.length<=24,'the broad shaft walls are individual meshes in a feature group, capped to bound engraving atlas memory');
  for(const mesh of featureGroup.children){
    assert.equal(mesh.name,'shaft-hub-feature-wall','one shared name, so they form a single pattern type');
    const p=mesh.geometry.attributes.position.array,lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
    for(let i=0;i<p.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[i+k]);hi[k]=Math.max(hi[k],p[i+k]);}
    assert(Math.max(hi[0]-lo[0],hi[2]-lo[2])>=3-1e-6&&hi[1]-lo[1]>=2-1e-6,'a feature wall is at least 3 wide and 2 tall');
  }
  assert(!featureGroup.children.includes(stone['shaft-hub-walls']),'the plain strips are not in the engraved group');
  assert(stone['shaft-hub-walls'].geometry.attributes.position.array.length/12<4000,'faces are merged, not one quad per cell');
  const boxes=[];shaftShell.traverse(node=>{if(node instanceof InstancedMesh)boxes.push(node.name);});
  assert.deepEqual(boxes,[],'no instanced one-unit stone boxes remain in the shaft shell');
  assert.equal(connected.hub.grid.originX+Math.floor(connected.hub.cols/2),preplanned.shaft.anchor.x);
  assert.equal(connected.hub.grid.originZ+Math.floor(connected.hub.rows/2),preplanned.shaft.anchor.z);
  assert.equal(ruin.occupancy.cols,rec.cols,'occupancy must include all mounted wings');
  assert.equal(ruin.occupancy.rows,rec.rows,'occupancy must include all mounted wings');
  assert(ruin.shaftConnection.physical,'the normal ruin entrance is a real corridor');
  assert.equal(ruin.shaftConnection.floorCount,connected.plan.floorCount);
  assert(ruin.shaftConnection.supportRects<100,'hallway support surfaces merged');
  assert.deepEqual(ruin.occupancy.getPosition(),{x:5,z:7},'occupancy must reuse injected player adapter');
  const network=connected.layerRuntime;
  network.tick(0);
  // Wings draw their stone as merged stretch-to-fit faces too, with a capped handful of engravable feature walls each.
  const wingBoxes=[],wingFloors=[],wingWalls=[],wingFeatureGroups=[];
  network.group.traverse(node=>{
    if(node instanceof InstancedMesh&&/-(floor|wall-ns|wall-ew)$/.test(node.name))wingBoxes.push(node.name);
    if(node.userData?.ruinFeatureWalls)wingFeatureGroups.push(node);
    if(/^floor\d+-[NESW]-floor$/.test(node.name||''))wingFloors.push(node);
    if(/^floor\d+-[NESW]-walls$/.test(node.name||''))wingWalls.push(node);
  });
  assert.deepEqual(wingBoxes,[],'no instanced one-unit boxes remain in any wing');
  assert(wingFloors.length>=2&&wingFloors.every(mesh=>mesh.geometry.attributes.position.array.length>0&&mesh.geometry.attributes.uv.array.every(v=>v>=0&&v<=1)),'each wing floor is merged stretch-to-fit faces');
  assert(wingWalls.length>=1,'wing walls are merged faces');
  for(const group of wingFeatureGroups)for(const mesh of group.children){ // One face only: two opposed faces collapse the pattern decorator's atlas to a sliver.
    const p=mesh.geometry.attributes.position.array,n=mesh.geometry.attributes.normal.array;
    const across=axis=>{let lo=1e9,hi=-1e9;for(let i=axis;i<p.length;i+=3){lo=Math.min(lo,p[i]);hi=Math.max(hi,p[i]);}return hi-lo;};
    assert(Math.min(across(0),across(2))<1e-6,'a feature wall is one flat face, not a two-faced slab');
    assert(new Set(Array.from({length:n.length/3},(_,i)=>n[i*3]+','+n[i*3+2])).size===1,'and every patch of it faces the same way');
  }
  assert(wingFeatureGroups.length>=1&&wingFeatureGroups.every(group=>group.children.length>=1&&group.children.length<=4&&group.children.every(mesh=>mesh.name==='wing-feature-wall')),
    'each wing has between one and four engravable feature walls, one mesh each (the cap bounds engraving atlas memory)');
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
    else if(remaining.kind==='ropeChain'){player={...remaining.ropeSpec.exit};network.tick(.05);} // Same bank condition as native rope traversal.
    else if(remaining.kind==='statueDefense'||remaining.kind==='findBlocks')remaining.simulateCompletion(); // Separate authored integration test validates plinth completion.
    else for(let i=0;i<remaining.targetCount;i++)remaining.simulateHit(i); // Dispatch actual projectile onHit callbacks.
    assert(remaining.solved,'the puzzle family must truly unlock its gate: '+remaining.kind);
  }
  brazierControl.onPress();
  assert.equal(network.getState().lit,1,'a completed wing can ignite its real brazier');
  for(const p of [connected.route.path[0],connected.route.path.at(-1)])
    assert(rec.floorSet.has(p.x+','+p.z),'both path endpoints are actual walkable tiles');
  assert(rec.mapData.floor.some(([c,r])=>c===connected.route.path.at(-1).x&&r===connected.route.path.at(-1).z));
  if(side==='north'){ // Prove the whole generated multi-floor goal graph can complete, not just its first room.
    for(const record of network.states){
      for(let i=record.solved;i<record.challenges.length;i++){
        const challenge=record.challenges[i];
        player={x:challenge.x,z:challenge.z,y:challenge.floorY};
        if(challenge.kind==='pressurePlate')
          for(let j=0;j<17;j++)network.tick(.05);
        else if(challenge.kind==='melodyEcho')
          challenge.onMelodyResult({id:challenge.id,solved:true});
        else if(challenge.kind==='dungeonFire')
          assert.equal(challenge.fireRecord.onBurn(),true);
        else if(challenge.kind==='ropeChain'){
          network.tick(.05); // Registers the authored ropes into the active native V50 state.
          player={...challenge.ropeSpec.exit};network.tick(.05);
        }else if(challenge.kind==='statueDefense'||challenge.kind==='findBlocks')challenge.simulateCompletion();
        else for(let j=0;j<challenge.targetCount;j++)challenge.simulateHit(j);
        assert(challenge.solved,'every authored challenge can progress: '+challenge.id);
      }
    }
    const allBrazierControls=ruin.controls.filter(control=>control.kind==='layerBrazier');
    for(let i=0;i<network.states.length;i++){
      const state=network.states[i];
      assert.equal(state.solved,state.challenges.length,'all stages must precede this brazier');
      player={x:state.challenges.at(-1).x,z:state.challenges.at(-1).z,
        y:state.challenges.at(-1).floorY};
      allBrazierControls[i].onPress();
    }
    assert.equal(network.getState().lit,network.getState().braziers);
    assert(network.getState().complete&&ruin.shaftNetworkComplete,
      'every physical floor wing is required to complete shaft-wide Great Door seals');
    allBrazierControls.at(-1).onPress();
    assert.equal(network.getState().lit,network.getState().braziers,'brazier interactions are idempotent');
  }

  const oldMusic=globalThis.MusicMinigame; // Simulate leaving during a shaft melody without closing the flute overlay.
  const echo=network.states.flatMap(state=>state.challenges).find(challenge=>challenge.kind==='melodyEcho');
  let musicClosed=0;
  if(echo)globalThis.MusicMinigame={
    state:{echoChallenge:{id:echo.id}},close:()=>{musicClosed++;}
  };
  ruin.shaftConnectorCleanup();
  if(echo)assert.equal(musicClosed,1,'teardown must close the active stacked-story flute session');
  globalThis.MusicMinigame=oldMusic;
  assert(network.disposed,'all secondary wing collision grids and meshes are disposable');
  assert.equal(ruin.controls.filter(control=>control.kind==='layerBrazier'||control.kind==='dungeonFireSource').length,0,
    'reroll clears the authored wing brazier and fire-source interactions');
  assert.equal(liveChains.size,0,'leaving a generated ruin never leaks rope grabs and mid-air catch records');
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
    RuinLayerPlayable:Playable,RuinLayerChallenges:NetworkChallenges,RuinLayerDefense:Defense,CellGrid3D:G,getPlayerPosition:()=>({x:6,z:27}),getPlayerY:()=>0});
  assert(placed.route.ok&&placed.route.path[0].x===6&&placed.route.path[0].z===28,
    'fixed story vault extends physically through its actual southern doorway');
  assert(rec.floorSet.has('6,28')&&ruin.shaftConnection.physical);
  ruin.shaftConnectorCleanup();
}
globalThis.DevRandomRuinSimplePuzzles=savedSimplePuzzles;
console.log('ok test-shaft-hub: 1000 layouts, '+plannedWings+' layered wings, real gates/braziers, climbable multi-story octagons, four walk-in approaches');
