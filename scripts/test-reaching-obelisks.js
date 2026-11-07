#!/usr/bin/env node
'use strict';
// Reaching Obelisks: deterministic seeded floor graph, safe no-buff catch
// calculations, rhythmic motion, verifiable dock jumps, ice-author reuse and teardown.
const assert=require('assert');
const fs=require('fs');
const Obelisks=require('../docs/js/ruin-reaching-obelisks.js');
const Plan=require('../docs/js/ruin-layer-plan.js');
const Hub=require('../docs/js/shaft-hub.js');
const Grid=require('../docs/js/cell-grid-3d.js');

const fail=checks=>checks.filter(check=>!check.ok).map(check=>check.name+': '+(check.detail||'')).join(', ');
assert(Plan.TRAVERSAL_METHODS.includes('reachingObelisks'),'new methods are selected from a dedicated traversal pool');
assert(Obelisks.UNBUFFED_SPEED>3&&Obelisks.UNBUFFED_SPEED<4.3,'fall proof uses the no-buff movement reference with acceleration margin');
assert(Math.abs(Obelisks.fallDistanceForTiles(2)-4*Obelisks.fallDistanceForTiles(1))<1e-9,'freefall is quadratic in horizontal travel time');
assert.throws(()=>Obelisks.fallDistanceForTiles(2,0),'zero horizontal speed is not solvable');
assert(Obelisks.catchDepthForGap(4)>Obelisks.catchDepthForGap(1),'longer traversals need lower catch strands');

for(let seed=1;seed<=110;seed++){
  const layout=Plan.compose({seed,anchorX:320,anchorZ:320,nativeV50:true});
  assert(layout.ok,'floor plan '+seed+' '+fail(layout.checks));
  assert.equal(layout.options.floorHeight,16,'all floors are four times farther apart than legacy 4-cell shafts');
  assert.equal(layout.options.shaftSize,45,'larger octagonal chamber leaves room for enormous pillar circuits');
  assert.equal(layout.options.shaftTraversal,'reachingObelisks');
  const options={seed,floors:layout.floorCount,shaft:layout.options.shaftSize,
    wall:layout.options.shaftWall,spacing:layout.options.floorHeight,
    originX:290,originZ:290,balconySides:layout.floors.slice(1).map(f=>f.wings[0]?.side||'N')};
  // In actual game, selected hub gallery sides come from ShaftHub, not a wing.
  options.balconySides=['N','E','S','W'].slice(0,layout.floorCount-1);
  const plan=Obelisks.compose(options);
  assert(plan.ok,'obelisk solution '+seed+' '+fail(plan.checks));
  assert.equal(plan.pillars.length,(layout.floorCount-1)*4,'four physical columns per climb stage');
  assert.equal(plan.targets.length,0,'the old projectile-target activation design has been disabled');
  assert.equal(plan.plates.length,0,'standing on plates no longer activates shaft rotation');
  assert.deepEqual(plan.rhythm.rotationBeats,[2,3,4],'beats two, three and four are quarter-turns');
  assert.equal(plan.rhythm.elevationBeat,1,'only the first beat of each bar changes elevation');
  assert.equal(plan.pit.bottomY,options.baseY===undefined?-8:options.baseY-8,'death plane is below the entry floor');
  for(const route of plan.routes){
    const byName=Object.fromEntries(plan.pillars.filter(p=>p.story===route.story).map(p=>[p.name,p]));
    assert.equal(byName.A.highY-route.exitY,Obelisks.DOCK_DROP,'the raised A obelisk sits 1.25 units above the known accessible dock');
    assert(byName.A.lowY<byName.A.highY&&byName.B.lowY<byName.B.highY);
    assert(byName.A.highY-byName.A.catchDepth<=byName.D.topY+.5,
      'D reaches the underside of A even after A has been raised');
    assert(byName.A.y===undefined,'generator does not prematurely simulate moving platforms');
    assert(route.flights.every(f=>f.requiredCatchDepth<=byName[f.to.split('-').at(-1)].catchDepth),
      'every audited downward flight ends within the authored climbable strip');
    assert.equal(route.requires.length,0,'ascent is a timed platform route rather than a hidden switch hunt');
    for(const p of Object.values(byName)){
      assert(Number.isInteger(p.catchDepth)&&p.catchDepth>=9&&p.catchDepth<=15);
      const faces=Obelisks.climbFaces(p);
      assert(faces.length>1&&faces.some(s=>s.facing==='N'||s.facing==='W'||s.facing==='S'||s.facing==='E'),'actual climbable strips are authored');
      assert(faces.every(s=>s.u1-s.u0<=2.001),'a strand is never wider than two wall tiles');
    }
  }
  if(seed<=24){
    const placed=Hub.compose({seed,floors:layout.floorCount,wall:layout.options.shaftWall,
      shaft:layout.options.shaftSize,spacing:layout.options.floorHeight,
      originX:290,originZ:290,entranceSide:'W',traversal:'reachingObelisks'});
    assert(placed.ok,'whole playable hub '+seed+' '+fail(placed.checks));
    assert(placed.obelisks?.ok,'a physically mounted shaft carries the verified route data');
    assert.equal(placed.docks.length,layout.floorCount,'every floor has a dock, including the ground entrance');
    assert(placed.docks.every(d=>d.jumpGap>0&&d.jumpGap<=2),'every dock is within a 1–2-tile horizontal jump from its named pillar');
    assert(placed.docks.every(d=>d.cells.every(c=>placed.grid.canStand(c.col,c.row,d.level,2))),'every dock is a real supported platform with headroom');
    assert(placed.docks.slice(1).every(d=>Math.abs(d.dropY-Obelisks.DOCK_DROP)<.001),'all upper docks sit 1.25 units below the high A mantle');
    assert(placed.checks.filter(c=>c.name.includes('dock')).every(c=>c.ok),'no dock is an unreachable or ungrounded visual prop');
    assert(!placed.surfaces.some(s=>s.style==='holds'&&s.y0===0&&s.y1>=16),
      'predictable full-height buttress climbs never bypass the new puzzle');
  }
}
assert.equal(Obelisks.traditionOf('Hronal'),'hronal');
assert.equal(Obelisks.traditionOf('Tothal'),'tothal');
assert.equal(Obelisks.traditionOf('Kanthic'),'kanthic');

class Group {
  constructor(){this.children=[];this.parent=null;this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z}};
    this.rotation={x:0,y:0,z:0};this.scale={x:1,y:1,z:1};this.userData={};this.visible=true;this.name='';}
  add(node){this.children.push(node);node.parent=this;}
  remove(node){this.children=this.children.filter(other=>other!==node);node.parent=null;}
  traverse(callback){callback(this);for(const child of this.children)child.traverse(callback);}
  getWorldPosition(vec){vec.x=0;vec.y=0;vec.z=0;for(let p=this;p;p=p.parent){vec.x+=p.position.x;vec.y+=p.position.y;vec.z+=p.position.z;}return vec;}
}
class Geometry {dispose(){this.disposed=true;}}
class Material{constructor(options){this.options=options||{};}dispose(){this.disposed=true;}}
class Mesh extends Group {constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}}
class Vector3 {constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}}
const THREE={Group,Mesh,Vector3,BoxGeometry:Geometry,PlaneGeometry:Geometry,MeshBasicMaterial:Material};
const savedIce=globalThis.IceStalagmiteCoverage;
let icePieces=0;
globalThis.IceStalagmiteCoverage={build:(T,source,settings)=>{
  assert(source.children.length>0&&source.children.length<=64,'1x1 invisible furniture cubes are batched instead of left as an enormous draw-call field');
  assert(settings.iceFacets>=3&&settings.iceTipSharpness>0&&settings.iceLean>=0,'authors full procedural spike recipe is used');
  icePieces+=source.children.length;
  const g=new Group(),node=new Mesh(new Geometry(),new Material());g.add(node);return g;
}};
try{
  const plan=Obelisks.compose({seed:91,shaft:45,wall:8,spacing:16,floors:3,
    balconySides:['N','E'],originX:100,originZ:100,baseY:0});
  assert(plan.ok,fail(plan.checks));
  const surfaces=new Map(),climbs=new Map(),projectileTargets=new Map();
  const DS={registerSurface:s=>surfaces.set(s.id,s),clearScope(scope){for(const [id,s]of surfaces)if(s.scope===scope)surfaces.delete(id);}};
  const CS={register:s=>{const record={...s,enabled:true};climbs.set(s.id,record);return record;},
    remove:id=>climbs.delete(id),clearScope(scope){for(const [id,s]of climbs)if(s.scope===scope)climbs.delete(id);}};
  const bus={hasActiveRuinState:()=>true,registerExternalProjectileTarget:t=>{projectileTargets.set(t.id,t);return()=>projectileTargets.delete(t.id);}};
  const parent=new Group();let player={x:0,z:0},playerY=0;
  const rt=Obelisks.mount(plan,{THREE,parent,DynamicSurfaces:DS,ClimbSurfaces:CS,
    tradition:'tothal',getPlayerPosition:()=>player,getPlayerY:()=>playerY,projectileBus:bus});
  assert.equal(rt.tradition,'tothal');assert(icePieces>=1000,'ice is generated across the whole pit, not just the corners');
  assert.equal(surfaces.size,plan.pillars.length);assert(climbs.size>10);
  assert.equal(projectileTargets.size,0,'the old ranged switch bus is not used');
  assert(!rt.targets&&!rt.plates,'shaft traversal no longer mounts manual switch or pressure plate controls');
  const a=rt.columns.get('obelisk-f0-A'),b=rt.columns.get('obelisk-f0-B');
  assert(a&&b,'moving columns are mounted and keep their stable support identifiers');
  assert(!rt.getState().active,'offstage mechanisms begin paused');
  player={x:a.x,z:a.z};playerY=a.lowY;
  rt.tick(.05);
  assert.equal(rt.getState().beat,1,'entering the shaft starts on an elevation downbeat');
  assert.equal(a.desiredY,a.highY,'beat one orders every A pillar up');
  assert.equal(b.desiredY,b.highY,'beat one orders every B pillar up');
  assert.equal(projectileTargets.size,0,'no targets register after the rhythm activates');
  const nextBeat=()=>{
    const current=rt.getState().elevationChanges+rt.getState().rotations;
    for(let i=0;i<45&&rt.getState().elevationChanges+rt.getState().rotations===current;i++)rt.tick(.05); // Default beat is 1.8 seconds; 45 simulation frames include float rounding room.
    assert.equal(rt.getState().elevationChanges+rt.getState().rotations,current+1,'each metronome beat fires exactly once');
  };
  const downbeatRotations=[a.rotation]; // All four orientations must appear once at the start of the four bars.
  for(let bar=1;bar<=4;bar++){
    for(const beat of [2,3,4]){
      nextBeat();
      assert.equal(rt.getState().beat,beat,'quarter-turn occurs on the correct numbered beat');
      assert.equal(a.rotation,(bar*3-3+beat-1)%4,'one 90-degree rotation on every non-downbeat');
      assert.equal(b.rotation,a.rotation,'all obelisks turn in sync, including the previously unrotating columns');
    }
    if(bar<4){
      nextBeat();
      assert.equal(rt.getState().beat,1);
      downbeatRotations.push(a.rotation);
      assert.equal(a.desiredY,bar%2===1?a.lowY:a.highY,'elevation alternates between low and high on successive downbeats');
    }
  }
  assert.deepEqual(downbeatRotations,[0,3,2,1],'four measures expose every possible quarter-turn orientation on beat one');
  assert.equal(a.rotation,0,'twelve quarter-turns return to the original orientation at the end of four measures');
  assert.equal(rt.getState().cycle,1,'a full 4/4 by four measures cycle has elapsed');
  for(let i=0;i<110;i++)rt.tick(.05); // The next downbeat is 1.8 s away, then the 9.25-unit ascent needs another 2.9 s.
  assert(Math.abs(a.y-a.highY)<.001,'the high plateau is reached during a full elevation-up measure');
  assert.equal(surfaces.get('shaft-obelisks-'+a.id).topY(),a.y,'live collider follows the same moving top as its stone mesh');
  assert([...climbs.values()].some(s=>s.y1>a.lowY),'grip surfaces follow moving and rotating pillars');
  player={x:-500,z:-500};
  rt.tick(.05);
  const paused=rt.getState(),height=a.y;
  for(let i=0;i<60;i++)rt.tick(.05);
  assert.equal(rt.getState().rotations,paused.rotations,'the beat suspends while visiting offshoot rooms');
  assert.equal(a.y,height,'moving platforms stop when the player leaves the shaft');
  player={x:a.x,z:a.z};rt.tick(.05);
  assert.equal(rt.getState().beat,1,'reentering starts cleanly on the elevation downbeat');
  assert.equal(rt.isDeathAt(rt.plan.pillars[0].x,rt.plan.pillars[0].z,-8),true);
  assert.equal(rt.isDeathAt(rt.plan.pillars[0].x,rt.plan.pillars[0].z,8),false);
  rt.dispose();
  assert(!parent.children.length&&!projectileTargets.size&&!surfaces.size&&!climbs.size,
    'reroll removes all shaft meshes, dynamic supports and climb faces');
}finally{globalThis.IceStalagmiteCoverage=savedIce;}

const runtime=fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
const connector=fs.readFileSync('docs/js/ruin-shaft-connector.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
const bootstrap=fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js','utf8');
assert(runtime.includes('function reconcileObeliskPlayer(now,x,z)'),'mid-air falling is integrated with actual player support/pose');
assert(runtime.includes('PlayerDowned?.dieImmediately?.(\'reaching-obelisks-'),'the pit bypasses downed and footing states');
assert(connector.includes('RuinReachingObelisks.mount('),'real physical shaft mounts the new motion machinery');
const scriptAt=name=>index.search(new RegExp('<script[^>]+src="js/'+name.replace('.','\\.')+'\\?v='));
assert(scriptAt('ruin-reaching-obelisks.js')>=0&&scriptAt('ruin-reaching-obelisks.js')<scriptAt('shaft-hub.js'),
  'the browser loads the obelisk module before its shaft consumers');
assert.match(bootstrap, /dev-random-ruin-interior-map\.js\?v=[A-Za-z0-9_-]+/, 'the fall runtime is loaded with a cache-bust token');
console.log('ok test-reaching-obelisks: 110 seeds, all-floor dock jumps, synchronized 4/4 rhythm, ballistic catches, moving supports and teardown');
