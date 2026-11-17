#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Uses the checked-out branch in CI and local runs.
const source = fs.readFileSync(path.join(ROOT, 'docs/js/wildlife-spawn.js'), 'utf8');
class Group {
  constructor() {
    this.children = []; this.userData = {};
    this.position = { set: (x,y,z) => { this.position.x=x; this.position.y=y; this.position.z=z; } };
    this.rotation = { y:0 };
    this.scale = { set: (x,y,z) => { this.scale.x=x; this.scale.y=y; this.scale.z=z; } };
  }
  add(...children) { for (const child of children) { this.children.push(child); child.parent=this; } }
  remove(...children) { for (const child of children) { const at=this.children.indexOf(child); if (at>=0) this.children.splice(at,1); child.parent=null; } }
}
const plane = () => ({ material: { map:null }, clone() { return { ...this }; } }); // Mirrors billboard material sharing used for both species' carried babies.
const hostiles = new Set(); // Shared live entity roster used to verify spawning and full scene cleanup.
const removed = []; // Captures cleanup requests made to the game's despawnCreature interface.
const logs = []; // Collects mobile log output for midnight census assertions.
let area = 'map_northern_cliffs'; // Simulates leaving/returning to the relevant game map.
let randomValue = 0.99; // Force predictable Moot/Voorg lottery outcomes in each daily slot.
let randomSequence = []; // Optional per-roll override to test a mixed-species day.
let nextId = 0; // Distinguishes newly created actors from surviving ones.
const zone = { roamingHerdSpecies:['voorg-ass','moot'], roamingHerdCount:2,
  roamingForagerSpecies:['nazgraku'], roamingForagerCount:1,
  denSpecies:[], cols:100, rows:100 }; // Post-registration Northern Cliffs species and counts.
const layout = { cols:100,rows:100,dens:[],tiles:[],foliagePatches:[
  {centroid:{x:20,y:20},tiles:[{x:20,y:20},{x:21,y:20}]},
  {centroid:{x:80,y:80},tiles:[{x:80,y:80},{x:81,y:80}]},
  {centroid:{x:50,y:50},tiles:[{x:50,y:50},{x:51,y:50}]},
] }; // Real foliage anchors separated enough to exercise proximity culling.
const w = {
  THREE: { Group },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: { moot: { anchors: { saddle: { position: {x:0.3,y:0.19,z:0.02} } } }, 'voorg-ass': { anchors: { saddle: { position: {x:0,y:0.12,z:0} } } } } }, // Explicit distinct saddles reveal accidental use of the wrong species' rig.
  BanditCamps:{ensureCurrentZoneCamps(){}},
  CreatureGenetics:{makeDefaultGenotype(kind){return {sizeClass:'medium',base:{color:kind==='moot'?'#aaaaaa':'#bbbbbb'}}},creatureSizeScale(kind,sizeClass){return kind==='moot'?(sizeClass==='small'?{x:0.35,y:0.35}:{x:1.5,y:1.5}):(sizeClass==='small'?{x:0.34,y:0.34}:{x:1.1,y:1.1})}},
  CreatureGeneticsRender:{SPECIES:{}},
  VoorgAssRegistration:{KIND:'voorg-ass',HERD_MOTHER_KIND:'voorg-ass-herd-mother',
    ensureCreatureDefs(db){db['voorg-ass']={};db['voorg-ass-herd-mother']={}},
    ensureRendererSpecies(){},
    ensureNorthernCliffsHerds(){return {ready:true,zone,roaming:zone.roamingHerdSpecies}},
  },
  MootRegistration:{register(d){d.CREATURE_DB.moot={};d.CREATURE_DB['moot-herd-mother']={};return true}},
  __farmLog(message){logs.push(message)},
}; // Other species have independent registration tests; this fixture targets live herd lifecycle.
const deps = {CREATURE_DB:{nazgraku:{}},EXTERIOR_ZONES:{map_northern_cliffs:zone},
  zoneLayouts:new Map([['map_northern_cliffs',layout]]),hostileObjects:hostiles,
  denNests:new Map(),buildingScenes:new Map(),DEN_MOTHER_DEFS:{},
  TILE:10,TileType:{RIVER:'river',STREAM:'stream'},player:{x:205,y:205},
  rnd:()=>randomSequence.length ? randomSequence.shift() : randomValue,getCurrentArea:()=>area,_isZoneArea:id=>id==='map_northern_cliffs',
  getCutscenePreviewActive:()=>false,buildZoneScene:()=>true,
  makeCreatureEntity(kind,x,y,opts){const group=new Group(),frontPlane=plane(),backPlane=plane();group.add(frontPlane,backPlane);return {id:++nextId,creatureKey:kind,health:50,x,y,avatarRef:{group,frontPlane,backPlane},...opts}},
  despawnCreature(creature){removed.push(creature)},
  showToast(){},
}; // Minimal production wildlife dependencies; no separate substitute herd simulator.
vm.runInNewContext(source,{window:w,performance:{now:()=>0}},{filename:'wildlife-spawn.js'});
w.WildlifeSpawn.init(deps);
const tick = () => w.WildlifeSpawn.updateHostileSpawning(3); // Real two-second spawning entry point.
const herds = () => w.WildlifeSpawn.roamingHerdCensus('map_northern_cliffs').herds; // The mobile dev-panel census.
tick();
assert.deepEqual(Array.from(herds(), herd => herd.species),['moot','moot']);
assert(herds().every(h=>h.adults===12&&h.mothers===1&&h.carriedBabies===4),'Moot herds have 8-12 adults and one mother carrying 2-4 babies');
assert.equal([...hostiles].filter(c=>c.creatureKey==='moot-herd-mother').length,2,'one Moot Herd-Mother is a living member of each herd');
assert([...hostiles].filter(c=>c.isHerdMother).every(c=>c.carriedBabyItemKey==='mootBaby'),'wild Moot mothers carry recoverable Moot babies');
const firstMootMother=[...hostiles].find(c=>c.creatureKey==='moot-herd-mother'); // Real mock world creature used to verify post-stream visual restoration.
assert.equal(firstMootMother._carriedBabyVisuals.length,4,'Moot babies receive actual three-dimensional attachments');
assert(firstMootMother._carriedBabyVisuals.every(g=>g.parent===firstMootMother.avatarRef.group),'Moot babies remain attached to their mother');
assert(firstMootMother._carriedBabyVisuals.every(g=>g.children[0].material===firstMootMother.avatarRef.frontPlane.material),'babies reuse their own Moot genotype material');
assert.equal(Math.round(firstMootMother._carriedBabyVisuals[0].position.x*1000),215,'Moot babies use the Moot saddle rather than the Voorg-Ass saddle');
assert.equal(Math.round(firstMootMother._carriedBabyVisuals[0].scale.x*10000),2333,'Moot children use the Moot small-to-large authored scale ratio');
assert.equal(w.WildlifeSpawn.restoreHerdMotherVisuals(firstMootMother),4,'visual promotion restores all carried Moot babies');
assert.equal(firstMootMother.avatarRef.group.children.filter(g=>g.userData?.herdCarriedBaby).length,4,'repeated promotion must replace rather than duplicate attachments');
assert.equal([...hostiles].filter(c=>c.creatureKey==='nazgraku').length,5,'Nazgraku remains independent');
randomValue=0.01;
w.WildlifeSpawn.advanceCaveMidnight(10);
assert.equal(herds()[0].species,'moot','nearby herd is not removed at midnight');
assert.equal(herds()[0].pendingTurnover,true,'nearby herd waits until map exit');
assert.equal(herds()[1].adults,0,'distant herd is removed at midnight');
assert(removed.length>=12,'midnight uses the full despawn cleanup');
tick();
assert.equal(herds()[1].species,'voorg-ass','distant herd can re-roll next day');
assert.equal(herds()[1].mothers,1,'new Voorg-Ass herd keeps its Herd-Mother');
assert.equal(herds()[0].species,'moot','nearby herd survives while still in map');
const before=removed.length; // Used to ensure repeated midnight review does not rotate twice.
w.WildlifeSpawn.advanceCaveMidnight(10);
assert.equal(removed.length,before);
area='town';w.WildlifeSpawn.onZoneEntered(area);
assert.equal(herds()[0].adults,0,'nearby herd disappears only after leaving the map');
area='map_northern_cliffs';w.WildlifeSpawn.onZoneEntered(area);tick();
assert.equal(herds()[0].species,'voorg-ass','pending slot re-rolls upon return');
assert.equal(herds()[0].pendingTurnover,false);
assert.equal([...hostiles].filter(c=>c.creatureKey==='nazgraku').length,5);
randomValue=0.99;deps.player.x=-9999;deps.player.y=-9999;
w.WildlifeSpawn.advanceCaveMidnight(11);tick();
assert.deepEqual(Array.from(herds(), herd => herd.species),['moot','moot'],'all-Moot days remain possible');
randomSequence=[0.01,0.01,0.01,0.01,0.99,0.99,0.99,0.99]; // Both Voorg-Ass and Moot roll species, herd size, mother index and baby count.
w.WildlifeSpawn.advanceCaveMidnight(12);tick();
assert.deepEqual(Array.from(herds(), herd => herd.species),['voorg-ass','moot'],'different species can occupy different slots on the same day');
assert(herds().every(h=>h.mothers===1&&h.carriedBabies>=2&&h.carriedBabies<=4),'mixed-species roaming herds each retain their own Herd-Mother and babies');
assert(logs.some(line=>line.includes('deferredNearby=1')),'mobile debug log explains pending rotation');
console.log('PASS rotating herd slots, real midnight distance gates, map-exit deferral, Nazgraku isolation');
