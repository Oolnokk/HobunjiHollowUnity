#!/usr/bin/env node
'use strict';
// Exercise the shipped wall-coffin functions with a minimal dungeon session:
// proximity is per coffin, skeletons spawn once, and scripted ossuaries retain their trigger.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/dev-random-ruin-simple-puzzles.js', 'utf8');
function shipped(start, next) {
  const a = source.indexOf('  '+start), b = source.indexOf('  '+next, a+start.length);
  assert(a >= 0 && b > a, 'Could not locate shipped '+start);
  return source.slice(a, b);
}
function coffin(x, z=0, floorY=0) {
  return {spawnX:x, spawnZ:z, floorY, spawnStarted:false, activated:false, spawned:false,
    spawnError:null, creature:null, released:false, closedY:0, openY:1.62, progress:0,
    panel:{position:{y:0}}};
}
function moduleFor(id, coffins, autoActivateRadius=4) {
  return {id, coffins, autoActivateRadius, tier:1, spawnCount:0, spawnStarted:false, activated:false};
}
let player = {x:0, z:0, y:0}; // Mutable tile coordinates supplied by the simulated player movement.
let groundY = 0; // Actual physical floor elevation for the multifloor proximity check.
const spawned = []; // Records calls to the real MinionCombat factory seam.
const released = []; // Records skeletons activated after their stone panels open.
const disposed = []; // Records late actors rejected after the dungeon changes.
let deferredSpawn = null; // Optional promise resolver for the reroll race regression.
const frame = {
  SARCOPHAGUS_WAKE_VERTICAL_GAP:1.4,
  MAP_ID:'map_i_dev_random_ruin',
  playerWorld:()=>player,
  inRuin:()=>true,
  DS:{sampleSupport:()=>({y:0})},
  deps:{TILE:64,hostileObjects:{add:creature=>released.push(creature)}},
  disposeSpawnedMinion:creature=>{if(creature)disposed.push(creature);},
  window:{
    DevRandomRuin:{getPlayerGroundSupportY:()=>groundY},
    MinionCombat:{makeEntity:async options=>{
      spawned.push(options);
      if(deferredSpawn)return new Promise(resolve=>{deferredSpawn=resolve;});
      return {x:options.x,y:options.y,avatarRef:{group:{position:{y:0}}},
        groundShadow:{position:{y:0}},halfHeight:.65};
    }},
  },
  console,
};
frame.state={sarcophagusModules:[],spawnedMinions:new Set(),context:{scene:{},grid:{},noLoot:false}};
vm.createContext(frame);
vm.runInContext([
  shipped('async function activateSarcophagusSpawner(', 'function buildOssuaryChordComposer('),
  shipped('function updateSarcophagusModules(', 'function updateOssuaryComposers('),
].join('\n'),frame);

async function settled() {
  await new Promise(resolve=>setImmediate(resolve));
}
async function run() {
  const near=coffin(0), far=coffin(15), upper=coffin(25,0,6);
  const wall=moduleFor('wall',[near,far,upper]);
  frame.state.sarcophagusModules.push(wall);
  player={x:4.01,z:0,y:0};
  frame.updateSarcophagusModules(.016);
  assert.equal(spawned.length,0,'outside four tiles must not wake a coffin');
  player={x:4,z:0,y:0};
  frame.updateSarcophagusModules(.016);
  await settled();
  assert.equal(spawned.length,1,'the coffin exactly four tiles away must spawn');
  assert.equal(wall.spawnCount,1);
  assert.equal(near.activated,true);
  assert.equal(far.activated,false,'remote coffins stay closed until approached');
  assert.equal(wall.activated,false,'one opened coffin is not the entire room');
  assert.equal(released.length,0,'AI must wait for panel clearance');
  frame.updateSarcophagusModules(.5);
  assert.equal(near.released,true,'skeleton releases after the existing panel animation threshold');
  assert.equal(released.length,1);
  frame.updateSarcophagusModules(.5);
  assert.equal(released.length,1,'release must happen only once');
  assert.equal(spawned.length,1,'a used coffin does not respawn when revisited');
  player={x:15,z:0,y:0};
  frame.updateSarcophagusModules(.016);await settled();
  assert.equal(spawned.length,2,'approaching a second coffin wakes only that one');
  assert.equal(far.activated,true);
  player={x:25,z:0,y:0};
  frame.updateSarcophagusModules(.016);await settled();
  assert.equal(spawned.length,2,'vertically overlapping floors must not wake each other');
  groundY=6;
  frame.updateSarcophagusModules(.016);await settled();
  assert.equal(spawned.length,3,'coffins on the actual player level can wake');
  assert.equal(upper.activated,true);
  assert.equal(wall.activated,true);

  const puzzle=moduleFor('scripted',[coffin(40),coffin(50)],0);
  frame.state.sarcophagusModules.push(puzzle);
  player={x:40,z:0,y:0};groundY=0;
  frame.updateSarcophagusModules(.016);
  assert.equal(spawned.length,3,'scripted ossuary coffins ignore ordinary proximity');
  await frame.activateSarcophagusSpawner(puzzle);
  assert.equal(spawned.length,5,'the existing puzzle trigger still wakes all coffins');
  assert.equal(puzzle.activated,true);

  const late=moduleFor('reroll',[coffin(60)],4);
  frame.state.sarcophagusModules.push(late);
  deferredSpawn = true;
  const pending=frame.activateSarcophagusSpawner(late,late.coffins[0]);
  assert.equal(spawned.length,6);
  const oldState=frame.state;
  frame.state={sarcophagusModules:[],spawnedMinions:new Set(),context:{}};
  const lateActor={x:60,y:0};
  deferredSpawn(lateActor);
  deferredSpawn=null;
  assert.equal(await pending,false,'stale asynchronous spawns must be rejected');
  assert.equal(disposed.includes(lateActor),true,'late skeleton must be cleaned up');
  assert.equal(oldState.spawnedMinions.has(lateActor),false,'old ruin session must not adopt a late actor');
  console.log('ok ruin sarcophagi: per-coffin 4-tile wake, no respawn, same floor, scripted ambush, release and reroll');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
