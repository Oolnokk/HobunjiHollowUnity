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
window.threat=null;actor._specialDodge=null;actor.dodging=false;actor._specialDodgeCooldownS=0;
actor._specialModeClock=10.3;actor._specialComboUntilMs=0;actor._specialLunge=null;actor._banditAction=null;ai(.05);
assert.equal(actor._specialMode,'magic','Melee phase lasts triple the magic phase');
actor._specialModeClock=3.5;ai(.05);assert.equal(actor._specialMode,'melee','Magic phase remains the brief interruption');

class V{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}applyAxisAngle(){return this;}}
class O{constructor(){this.position=new V();this.rotation=new V();this.scale=new V(1,1,1);this.children=[];this.parent=null;this.visible=true;this.userData={};}add(a){a.parent=this;this.children.push(a);}remove(a){this.children=this.children.filter(x=>x!==a);a.parent=null;}traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}updateWorldMatrix(){}}
class G{dispose(){}}
class M{constructor(fields={}){Object.assign(this,fields);}dispose(){}}
class Mesh extends O{constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}}
let composer;const footprints=new Map(); // Records exact XZ occupied boxes and their separate lifecycle tags.
const rockWindow={
  THREE:{Group:O,Object3D:O,Vector3:V,Mesh,BoxGeometry:G,PlaneGeometry:G,MeshBasicMaterial:M,DoubleSide:2},
  DevRandomRuinSimplePuzzles:{registerComposer:next=>composer=next},
  DevRandomRuinSanctum:{getState:()=>({layout:{arena:{minX:1,maxX:11,minZ:1,maxZ:11}}})},
  DevRandomRuinTileOccupancy:{
    solidAt:()=>false,refresh:()=>{},
    addSolidBox:(id,box,enabled,tag)=>footprints.set(id,{box,enabled,tag}),
    clearSolids:tag=>{for(const [id,record] of footprints)if(record.tag===tag)footprints.delete(id);},
  },
  ResourceSystem:{addAffliction(){},spendFooting(){}},
}; // Uses the same true Hronal composer as a generated dungeon, not a fabricated pillar animation.
vm.runInNewContext(read('docs/js/dev-random-ruin-lich-themes.js'),{window:rockWindow,console});
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
composer.clear();assert.equal(footprints.size,0,'Ruin teardown removes summoned pillar collision');
const arenaScene=new O(); // A stand-alone Testing Arena needs the exact same rise/charge handler without a generated ruin composer.
const arenaDeps={TILE:64,player:simulatedPlayer,hostileObjects:new Set(),canOccupyAt:()=>true,worldSurfaceY:()=>0};
const arenaBoss={...boss,areaId:'map_dev_arena',scene:arenaScene,areaGrid:Array.from({length:12},()=>Array(12).fill({type:'grass'})),_specialToolDeps:arenaDeps};
arenaDeps.hostileObjects.add(arenaBoss);
assert.equal(rockWindow.DevRandomRuinLichThemes.spawnBossPillar(arenaBoss,simulatedPlayer),1,'Testing Arena summons a rising pillar, not the old earth eruption');
const arenaPillar=arenaScene.children[0].children[0]; // Body of the stand-alone fixed-width arena column.
assert.equal(arenaPillar.scale.y,.001);
rockWindow.DevRandomRuinLichThemes.updateArenaBossPillars(.36);
assert(arenaPillar.scale.y>.001&&arenaPillar.scale.y<1,'Testing Arena advances the same grounded height lerp');
rockWindow.DevRandomRuinLichThemes.updateArenaBossPillars(.36);
assert.equal(arenaPillar.scale.y,1);
rockWindow.DevRandomRuinLichThemes.clearArenaBossPillars();
assert.equal(footprints.size,0,'Leaving the arena removes summoned pillar footprints');
assert.equal(arenaScene.children.length,0,'Leaving the arena removes the pillar render scene');
console.log('Azgarlu aerial combat and rising-pillar regressions passed');
