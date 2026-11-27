// Named Flame guardian regression: combo-linked aerial movement, pitched blows, and reuse of the Hronal exploding pillar.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8'); // The shipped runtime modules are executed directly rather than shadow-implemented.
let now=0,hits=0; // Clock and real-damage counter for the airborne combo assertions.
const actions=[]; // Recorded staged actions expose their normal strike/complete callbacks without any DOM.
const player={x:200,y:0,health:150,angle:Math.PI};
const window={
  Combat:{
    comboData:{COMBO_RESET_S:1.8,swingCombo:[0,1,2].map(i=>({windupS:.34,strikeS:.07,holdS:.43,returnS:.18,rangeMul:1,lungeMul:i?1:2,halfConeDeg:30,damageMul:1,anim:'sweep'}))},
    meleeAimSolution:()=>({pitch:.55}),
    beginStagedAction:opts=>{actions.push(opts);return opts;},
    meleeHit:(_attacker,_target,opts)=>{assert.equal(opts.pitch,.55);return true;},
    spawnMeleeTrail:()=>{},
    currentPlayerMeleeThreat:()=>window.threat||null,
  },
  RangedWeapons:{actorHitbox:actor=>({center:{y:Number(actor.groundLift)||.5}})},
  BanditCombat:{finishAction:actor=>{actor._banditAction=null;}},
  AudioSystem:{playWeaponHitSfx:()=>{}},
  EnemyLoadoutRules:{ruleFor:()=>({})},
}; // Minimal gameplay dependencies retain the real combo and vertical aim API shapes.
vm.runInNewContext(read('docs/js/flying-combat-orbit.js'),{window,Math,console});
vm.runInNewContext(read('docs/js/combat/combat-special-liches.js'),{window,performance:{now:()=>now},console});
const guardian=window.SpecialHarlyaoLiches;
const actor={x:0,y:0,groundLift:.5,health:200,lichType:'hronal',def:{chaseSpeed:300},avatarRef:{modelHeight:1.2,legs:{beginLunge(){}}}};
const deps={TILE:64,player,canOccupyAt:()=>true,sweptMove:(_x,_y,x,y)=>({x,y}),moveCreatureToward:()=>false,damagePlayer:()=>hits++,damageCreature:()=>{}};
guardian.init(actor,'hronal');
const ai=(dt=.016)=>guardian.handleAI(actor,dt,player,deps,0,Math.hypot(player.x-actor.x,player.y-actor.y));
const tick=(dt=.016)=>guardian.tick(actor,dt);
assert.equal(actor._specialMode,'melee','Azgarlu leads with his warhammer');
ai();assert.equal(actions.length,1,'First melee step is staged through the canonical Combat controller');
assert(actor._specialLunge && actor._specialAirMotion,'Aerial lunge begins both swept travel and non-gravity height interpolation');
for(let i=0;i<30;i++){now+=16;ai();tick();}
const altitude=actor._specialHoverOffsetWorld; // Current extra hover altitude retained during combo continuation and Hold.
assert(Math.abs(altitude)>.1,'Lunge changes hover height instead of always returning to one altitude');
actions[0].onStrike();actions[0].onComplete();
assert.equal(hits,1,'Hammer damage still uses the real pitched melee test');
assert.equal(actor._specialComboStep,1,'First hit advances the authored combo');
now=900;tick(.1);
assert(Math.abs(actor._specialHoverOffsetWorld-altitude)<1e-6,'Hover height persists while the next combo step remains available');
actor._specialMeleeCooldown=0;ai();assert.equal(actions.length,2,'Second combo step chains from the same swingCombo');
for(let i=0;i<30;i++){now+=16;ai();tick();}
actions[1].onStrike();actions[1].onComplete();assert.equal(actor._specialComboStep,2);
actor._specialAirMotion=null;const held=actor._specialHoverOffsetWorld; // Position used to check smooth return after both timers expire.
now=3500;tick(.15);
assert(Math.abs(actor._specialHoverOffsetWorld)<Math.abs(held),'Height returns to baseline after combo continuation and strike Hold');
actor._specialComboStep=2;actor._specialComboUntilMs=now+1800;actor._specialMeleeCooldown=0;actor._specialLunge=null;ai();
assert.equal(actions.length,3,'Third swing is the authored combo finisher');
for(let i=0;i<30;i++){now+=16;ai();tick();} // Advance the actual lunge through its windup/strike before firing the staged impact.
actions[2].onStrike();actions[2].onComplete();
assert.equal(actor._specialComboUntilMs,0,'Finisher does not create a phantom fourth step');
const finishingHeight=actor._specialHoverOffsetWorld; // Retained through the finisher Hold despite no further combo continuation.
now+=300;tick(.08);
assert.equal(actor._specialHoverOffsetWorld,finishingHeight,'Final strike Hold still keeps its finishing altitude');
now+=1600;tick(.1);
assert(Math.abs(actor._specialHoverOffsetWorld)<Math.abs(finishingHeight),'Finisher starts returning after Hold ends');
actor._specialComboStep=0;actor._specialComboUntilMs=0;actor._specialStrikeHoldUntilMs=0;actor._specialAirMotion=null;actor._specialLunge=null;actor._banditAction=null;
player.x=150;actor.x=0;actor.y=0;
window.threat={attacker:player,id:1,yaw:Math.PI,halfConeRad:1.5,rangePx:250,lungePx:0}; // The player's real windup is within Azgarlu's reaction cone.
assert.equal(ai().handled,true);assert.equal(actor.dodging,true,'Player attack triggers airborne dodge');
assert.equal(actor._specialAirMotion.kind,'dodge','Dodge changes altitude without gravity');
const dodgeStart=Math.atan2(actor.y-player.y,actor.x-player.x); // Real live target defines the center of Azgarlu's evasive circle.
window.threat=null;
ai(.12);ai(.12); // A no-perch boss must keep steering tangentially during the already-started dodge.
const dodgeEnd=Math.atan2(actor.y-player.y,actor.x-player.x);
assert(Math.abs(Math.atan2(Math.sin(dodgeEnd-dodgeStart),Math.cos(dodgeEnd-dodgeStart)))>.1,
  'aerial dodge changes bearing around the opponent instead of retreating straight away');
assert(Math.abs(Math.hypot(actor.x-player.x,actor.y-player.y)-150)<16,
  'curving dodge stays near the original engagement radius');
actor._specialDodge=null;actor.dodging=false;actor._specialDodgeCooldownS=0;
actor._specialModeClock=10.3;actor._specialComboUntilMs=0;actor._specialLunge=null;actor._banditAction=null;ai(.05);
assert.equal(actor._specialMode,'magic','Melee phase lasts triple the magic phase');
actor._specialModeClock=3.5;ai(.05);assert.equal(actor._specialMode,'melee','Magic phase remains the brief interruption');

class V{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}applyAxisAngle(){return this;}}
class O{constructor(){this.position=new V();this.rotation=new V();this.scale=new V(1,1,1);this.children=[];this.parent=null;this.visible=true;this.userData={};}add(a){a.parent=this;this.children.push(a);}remove(a){this.children=this.children.filter(x=>x!==a);a.parent=null;}traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}updateWorldMatrix(){}}
class G{
  setAttribute(name,value){(this.attributes ||= {})[name]=value;}
  dispose(){this.disposed=true;}
}
class Taper extends G{
  constructor(top,bottom,height){
    super();
    this.boundingBox={min:new V(-bottom,0,-bottom),max:new V(bottom,height,bottom)};
    const corners=[[0,bottom],[height,top]].flatMap(([y,r])=>[[-r,y,-r],[r,y,r]]);
    this.attributes={position:{count:corners.length,getX:i=>corners[i][0],getY:i=>corners[i][1],getZ:i=>corners[i][2]}};
  }
  rotateY(){}
  translate(){}
}
class Box3{
  setFromObject(){this.min=new V(-.39,0,-.39);return this;}
  getSize(out){return out.set(.78,1.75,.78);}
  getCenter(out){return out.set(0,.875,0);}
}
class M{constructor(fields={}){Object.assign(this,fields);}dispose(){}}
class Mesh extends O{constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}}
let composer;const footprints=new Map(); // Records exact XZ occupied boxes and their separate lifecycle tags.
const squarePillar=JSON.parse(read('docs/assets/models/furniture/data/pillar_square.json')); // Keep the test tied to the actual five-part decoy recipe.
let finishPillarLoad;
let pillarLoadAttempts=0; // The first request fails and all live pillars share the automatic retry.
const pillarLoad=new Promise(resolve=>{finishPillarLoad=resolve;}); // Exercise both the immediate tell and asynchronous authored-model upgrade.
const rockWindow={
  THREE:{Group:O,Object3D:O,Vector3:V,Mesh,CylinderGeometry:Taper,Box3,BufferGeometry:G,Float32BufferAttribute:class{},MeshBasicMaterial:M,DoubleSide:2,MathUtils:{lerp:(a,b,t)=>a+(b-a)*t}},
  RuinShaftSupportPillars:{loadSquarePillar:()=>++pillarLoadAttempts===1?Promise.resolve(null):pillarLoad,stretchStoneFaces(){}},
  ProceduralFurniture:{buildPartMesh(part){
    const mesh=new Mesh(new Taper(.2,.24,part.transform.sy),new M());
    mesh.name=part.name;
    return mesh;
  }},
  DevRandomRuinSimplePuzzles:{registerComposer:next=>composer=next},
  DevRandomRuinSanctum:{getState:()=>({layout:{arena:{minX:1,maxX:11,minZ:1,maxZ:11}}})},
  DevRandomRuinTileOccupancy:{
    solidAt:()=>false,refresh:()=>{},
    addSolidBox:(id,box,enabled,tag)=>footprints.set(id,{box,enabled,tag}),
    clearSolids:tag=>{for(const [id,record] of footprints)if(record.tag===tag)footprints.delete(id);},
  },
  ResourceSystem:{addAffliction(){},spendFooting(){}},
}; // Uses the same true Hronal composer as a generated dungeon, not a fabricated pillar animation.
vm.runInNewContext(read('docs/js/area-footprint-blockers.js'),{window:rockWindow,console}); // Load the actual movement/projectile collision registry.
vm.runInNewContext(read('docs/js/dev-random-ruin-lich-themes.js'),{window:rockWindow,console,setTimeout:queueMicrotask});
async function checkPillars(){
  const context={root:new O(),theme:'hronal',seed:8,floorSet:new Set(),ceilingY:4,meta:{rooms:[],floorSurfaceY:0,wallHeight:4}};
  for(let z=0;z<12;z++)for(let x=0;x<12;x++)context.floorSet.add(x+','+z);
  const simulatedPlayer={x:5*64,y:5*64,health:100,areaId:'map_i_dev_random_ruin'};
  const boss={x:5*64,y:5*64,health:100,areaId:'map_i_dev_random_ruin',isSpecialLich:true,specialLichId:'azgarlu',lichType:'hronal'};
  const kit={deps:{TILE:64,player:simulatedPlayer,hostileObjects:new Set([boss])},state:{context},group:()=>context.root,sampleSupport:()=>({y:0}),makeBasic:()=>new M()};
  composer.buildRooms(kit,context);
  assert.equal(rockWindow.DevRandomRuinLichThemes.spawnBossPillar(boss,simulatedPlayer),1);
  assert.equal(footprints.size,1,'A summoned column reserves one immutable authored footprint');
  const pillarGroup=context.root.children[0].children[0]; // Ground-pivoted mesh for the first newly summoned pillar.
  assert.equal(pillarGroup.scale.y,.001,'New pillar begins almost buried');
  composer.update(kit,0,.36);assert(pillarGroup.scale.y>.001&&pillarGroup.scale.y<1,'Pillar grows vertically over time');
  composer.update(kit,0,.36);assert.equal(pillarGroup.scale.y,1,'Pillar finishes fully emerged');
  composer.update(kit,0,.05);assert.equal(rockWindow.DevRandomRuinLichThemes.snapshot().chargedPillars,1,'Existing pulse/explosion handler owns its subsequent charge');
  const platform=rockWindow.DevRandomRuinLichThemes.addPlatformPillar({x:8.5,z:8.5,y:3});
  assert.equal(footprints.size,1,'The shaft decoy never registers as a movement blocker');
  const loadingShaft=pillarGroup.children[0].children[0]; // Owned loading geometry must be freed once the authored model mounts.
  assert.equal(loadingShaft.children.filter(c=>c.visible).length,1);
  composer.update(kit,0,1.05);
  assert.equal(loadingShaft.children.filter(c=>c.visible).length,2);
  assert.equal(platform.phase,'idle','A different floor does not trigger the platform decoy');
  const arenaScene=new O(); // Exercise leaving the arena during the shared asset request.
  const arenaDeps={TILE:64,player:simulatedPlayer,hostileObjects:new Set(),canOccupyAt:()=>true,worldSurfaceY:()=>0};
  const arenaBoss={...boss,areaId:'map_dev_arena',scene:arenaScene,areaGrid:Array.from({length:12},()=>Array(12).fill({type:'grass'})),_specialToolDeps:arenaDeps};
  arenaDeps.hostileObjects.add(arenaBoss);
  assert.equal(rockWindow.DevRandomRuinLichThemes.spawnBossPillar(arenaBoss,simulatedPlayer),1);
  const retiredPillar=arenaScene.children[0].children[0]; // This fallback is disposed before the successful reply.
  const retiredVisual=retiredPillar.children[0];
  rockWindow.DevRandomRuinLichThemes.clearArenaBossPillars();
  await new Promise(setImmediate);
  assert.equal(pillarLoadAttempts,2,'All waiting pillars share one retry after the failed first asset load');
  finishPillarLoad(squarePillar);
  await new Promise(setImmediate);
  assert.equal(retiredPillar.children[0],retiredVisual,'A retired pillar is never rebuilt by a late asset reply');
  assert.equal(retiredVisual.children[0].geometry.disposed,true);
  assert.equal(arenaScene.children.length,0,'A late reply cannot resurrect a retired arena scene');
  function verifyDecoy(group,visibleStages){
    const [visual]=group.children;
    assert.deepEqual(visual.children.map(part=>part.name),squarePillar.parts.map(part=>part.name),'Every use includes the authored plinth, foot, shaft, collar and capital');
    const shaft=visual.children.find(part=>part.name==='Square Tapered Shaft');
    assert.deepEqual(shaft.children.map(crack=>crack.userData.ruinCrackStage),[1,2,3]);
    assert.equal(shaft.children.filter(c=>c.visible).length,visibleStages,'The authored model preserves the current warning stage');
    assert.equal(Math.abs(visual.position.y),0,'The assembled stone stays anchored to the floor');
    assert.equal(visual.scale.x,.62/.78,'The complete stone model fits the existing footprint');
  }
  verifyDecoy(pillarGroup,2);
  verifyDecoy(platform.group,1);
  assert.equal(loadingShaft.geometry.disposed,true,'The loading stone is freed after the swap');
  composer.clear();assert.equal(footprints.size,0,'Ruin teardown removes summoned pillar collision');
  assert.equal(rockWindow.DevRandomRuinLichThemes.spawnBossPillar(arenaBoss,simulatedPlayer),1,'Testing Arena summons a rising pillar, not the old earth eruption');
  const arenaPillar=arenaScene.children[0].children[0]; // Body of the stand-alone fixed-width arena column.
  assert.equal(arenaPillar.scale.y,.001);
  verifyDecoy(arenaPillar,1);
  assert.equal(footprints.size,0,'Arena pillar must not register a footprint on the generated ruin model');
  assert.equal(rockWindow.AreaFootprintBlockers.providerIds().length,1,'Testing Arena registers a native player/enemy/projectile blocker');
  const arenaBlocked=(worldY=null)=>rockWindow.AreaFootprintBlockers.blocksBox('map_dev_arena',arenaPillar.position.x,arenaPillar.position.z,.2,worldY); // Game movement and projectiles query this exact native area registry.
  assert.equal(arenaBlocked(),false,'Column stays nonblocking while rising');
  rockWindow.DevRandomRuinLichThemes.updateArenaBossPillars(.36);
  assert(arenaPillar.scale.y>.001&&arenaPillar.scale.y<1,'Testing Arena advances the same grounded height lerp');
  rockWindow.DevRandomRuinLichThemes.updateArenaBossPillars(.36);
  assert.equal(arenaPillar.scale.y,1);
  assert.equal(arenaBlocked(),true,'Full-height arena pillar physically blocks traversal');
  assert.equal(rockWindow.AreaFootprintBlockers.blocksBox('map_i_dev_random_ruin',arenaPillar.position.x,arenaPillar.position.z,.2),false,'Arena pillar never blocks generated ruins');
  assert.equal(arenaBlocked(100),false,'Projectile collision respects the actual pillar height');
  rockWindow.DevRandomRuinLichThemes.clearArenaBossPillars();
  assert.equal(footprints.size,0,'Leaving the arena never touches generated-ruin pillar footprints');
  assert.equal(rockWindow.AreaFootprintBlockers.providerIds().length,0,'Leaving the arena unregisters the live native collision provider');
  assert.equal(arenaScene.children.length,0,'Leaving the arena removes the pillar render scene');
  console.log('Azgarlu aerial combat and shared Hronal decoy regressions passed');
}
checkPillars().catch(error=>{ console.error(error); process.exitCode=1; });
