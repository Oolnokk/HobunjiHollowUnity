#!/usr/bin/env node
'use strict';
// Reaching Obelisks: deterministic seeded floor graph, safe no-buff catch
// calculations, actual moving supports/targets, ice-author reuse and teardown.
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
  assert.equal(plan.targets.length,(layout.floorCount-1)*2,'two genuine ranged switches per story');
  assert.equal(plan.plates.length,layout.floorCount-1,'rotating pillar is keyed to a pressure plate');
  assert.equal(plan.pit.bottomY,options.baseY===undefined?-8:options.baseY-8,'death plane is below the entry floor');
  for(const route of plan.routes){
    const byName=Object.fromEntries(plan.pillars.filter(p=>p.story===route.story).map(p=>[p.name,p]));
    assert.equal(byName.A.highY,route.exitY,'raising A makes the next gallery accessible');
    assert(byName.A.lowY<byName.A.highY&&byName.B.lowY<byName.B.highY);
    assert(byName.A.highY-byName.A.catchDepth<=byName.D.topY+.5,
      'D reaches the underside of A even after A has been raised');
    assert(byName.A.y===undefined,'generator does not prematurely simulate moving platforms');
    assert(route.flights.every(f=>f.requiredCatchDepth<=byName[f.to.split('-').at(-1)].catchDepth),
      'every audited downward flight ends within the authored climbable strip');
    const raise=plan.targets.find(t=>t.controls===byName.A.id);
    const dot=(byName.A.x-byName.B.x)*raise.normal.x+(byName.A.z-byName.B.z)*raise.normal.z;
    assert(dot<0,'A cannot see the switch on the reverse face of B');
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
  rt.tick(.05);assert.equal(projectileTargets.size,plan.targets.length,'all ranged targets are attached to the canonical bus');
  const a=rt.columns.get('obelisk-f0-A'),b=rt.columns.get('obelisk-f0-B');
  const button=[...rt.targets.values()].find(t=>t.controls===a.id);
  assert(button&&!button.active);
  const spec=plan.targets.find(t=>t.id===button.id);
  player={x:b.x+spec.normal.x*6,z:b.z+spec.normal.z*6};playerY=b.y-1.3;
  assert(button.hittable(),'C-side line to B target is exposed at the correct elevation');
  player={x:a.x,z:a.z};assert(!button.hittable(),'the same switch is hidden from A');
  player={x:b.x+spec.normal.x*6,z:b.z+spec.normal.z*6};
  assert(button.onHit(),'a real ranged hit switches its linked pillar');
  assert(button.active&&a.desiredY===a.highY,'red target becomes green and lifts a different pillar');
  for(let i=0;i<95;i++)rt.tick(.05);
  assert(Math.abs(a.y-a.highY)<.001,'the pillar physically raises at its configured rate');
  assert.equal(surfaces.get('shaft-obelisks-'+a.id).topY(),a.highY,'live collision top follows the moving mesh');
  assert([...climbs.values()].some(s=>s.y1>a.lowY),'grip surfaces follow the moving pillar instead of disappearing');
  const plate=[...rt.plates.values()].find(s=>s.pillar.id===a.id);
  player={x:a.x,z:a.z};playerY=a.highY;
  for(let i=0;i<11;i++)rt.tick(.05);
  assert(plate.triggered&&a.rotation===1,'standing on pressure plate rotates A exactly 90 degrees');
  assert.equal(rt.isDeathAt(rt.plan.pillars[0].x,rt.plan.pillars[0].z,-8),true);
  assert.equal(rt.isDeathAt(rt.plan.pillars[0].x,rt.plan.pillars[0].z,8),false);
  rt.dispose();
  assert(!parent.children.length&&!projectileTargets.size&&!surfaces.size&&!climbs.size,
    'reroll removes all shaft meshes, targets, dynamic supports and climb faces');
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
assert(bootstrap.includes('reachFalling1'),'the updated fall logic is not masked by an old mobile cache');
console.log('ok test-reaching-obelisks: 110 seeds, ballistic catch proofs, 24 full shaft checks, moving platforms, switch LOS, ice covers, pressure plate and cleanup');
