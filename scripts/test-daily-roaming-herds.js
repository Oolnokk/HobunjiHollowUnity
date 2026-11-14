#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Uses the checked-out branch in CI and local runs.
const source = fs.readFileSync(path.join(ROOT, 'docs/js/wildlife-spawn.js'), 'utf8');
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
  BanditCamps:{ensureCurrentZoneCamps(){}},
  CreatureGenetics:{makeDefaultGenotype(kind){return {sizeClass:'medium',base:{color:kind==='moot'?'#aaaaaa':'#bbbbbb'}}}},
  CreatureGeneticsRender:{SPECIES:{}},
  VoorgAssRegistration:{KIND:'voorg-ass',HERD_MOTHER_KIND:'voorg-ass-herd-mother',
    ensureCreatureDefs(db){db['voorg-ass']={};db['voorg-ass-herd-mother']={}},
    ensureRendererSpecies(){},
    ensureNorthernCliffsHerds(){return {ready:true,zone,roaming:zone.roamingHerdSpecies}},
  },
  MootRegistration:{register(d){d.CREATURE_DB.moot={};return true}},
  __farmLog(message){logs.push(message)},
}; // Other species have independent registration tests; this fixture targets live herd lifecycle.
const deps = {CREATURE_DB:{nazgraku:{}},EXTERIOR_ZONES:{map_northern_cliffs:zone},
  zoneLayouts:new Map([['map_northern_cliffs',layout]]),hostileObjects:hostiles,
  denNests:new Map(),buildingScenes:new Map(),DEN_MOTHER_DEFS:{},
  TILE:10,TileType:{RIVER:'river',STREAM:'stream'},player:{x:205,y:205},
  rnd:()=>randomSequence.length ? randomSequence.shift() : randomValue,getCurrentArea:()=>area,_isZoneArea:id=>id==='map_northern_cliffs',
  getCutscenePreviewActive:()=>false,buildZoneScene:()=>true,
  makeCreatureEntity(kind,x,y,opts){return {id:++nextId,creatureKey:kind,health:50,x,y,...opts}},
  despawnCreature(creature){removed.push(creature)},
  showToast(){},
}; // Minimal production wildlife dependencies; no separate substitute herd simulator.
vm.runInNewContext(source,{window:w,performance:{now:()=>0}},{filename:'wildlife-spawn.js'});
w.WildlifeSpawn.init(deps);
const tick = () => w.WildlifeSpawn.updateHostileSpawning(3); // Real two-second spawning entry point.
const herds = () => w.WildlifeSpawn.roamingHerdCensus('map_northern_cliffs').herds; // The mobile dev-panel census.
tick();
assert.deepEqual(herds().map(h=>h.species),['moot','moot']);
assert(herds().every(h=>h.adults===12&&!h.mothers),'Moots must be proper herds, not 3-5-member foragers');
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
assert.deepEqual(herds().map(h=>h.species),['moot','moot'],'all-Moot days remain possible');
randomSequence=[0.01,0.01,0.01,0.01,0.99,0.99]; // First Voorg-Ass slot needs four rolls; the Moot slot needs two.
w.WildlifeSpawn.advanceCaveMidnight(12);tick();
assert.deepEqual(herds().map(h=>h.species),['voorg-ass','moot'],'different species can occupy different slots on the same day');
assert(logs.some(line=>line.includes('deferredNearby=1')),'mobile debug log explains pending rotation');
console.log('PASS rotating herd slots, real midnight distance gates, map-exit deferral, Nazgraku isolation');
