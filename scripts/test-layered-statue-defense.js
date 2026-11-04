#!/usr/bin/env node
'use strict';
// Integration proof for actual RuinComposer statue-defence placements inside
// stacked wings. Async asset failures, inventory actions, encounter ownership,
// and the real plinth's completion state determine the challenge outcome.
const assert=require('assert');
const Composer=require('../docs/js/ruin-composer.js'); // Existing authored defence solver, not a test-only layout.
const Defense=require('../docs/js/ruin-layer-defense.js'); // Production wing-to-furniture/encounter integration.

class Group {
  constructor(){
    this.children=[];this.parent=null;this.userData={};this.isObject3D=true; // The real KeyStatues registry rejects non-Three.js dispenser roots.
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.rotation={y:0};
  }
  add(node){node.parent?.remove?.(node);this.children.push(node);node.parent=this;}
  remove(node){this.children=this.children.filter(child=>child!==node);node.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)child.traverse?.(fn);}
}
const THREE={Group}; // Only authored scene roots are needed; the furniture runtime owns meshes.

function harness(id,overrides={}){
  const parent=new Group(),nodes=new Map(),controls=[],encounters=[],dispensers=[],removed=[];
  const disposed={geometries:0,materials:0}; // Tracks per-instance authored furniture GPU wrapper disposal on exit and failed assembly.
  let currentY=8,solved=0,linked=0,errors=0; // Mutable story elevation and externally observable stage effects.
  const authored={
    load:async key=>({key,parts:[{id:'authored'}]}),
    buildGroup:asset=>{
      const group=new Group();
      group.geometry={dispose:()=>disposed.geometries++}; // Fake private authored geometry; disposed without affecting cached textures.
      group.material={dispose:()=>disposed.materials++}; // Private material wrapper owned by this one room instance.
      if(asset.key==='ruinDefensePlinth')
        group.userData.furniturePuzzle={behavior:'burdenPlate',motion:{durationSeconds:8}};
      if(asset.key==='keyStatueDispenser')
        group.userData.furniturePuzzle={behavior:'keyStatue'};
      return group;
    },
    ...overrides,
  };
  const puzzle={
    registerNode(mapId,record,group){
      assert.equal(mapId,'map_i_dev_random_ruin');
      nodes.set(record.id,group);
      group.userData.__puzzleOverride=record.puzzle;
      return true;
    },
    getNode:(mapId,name)=>nodes.get(name)||null,
    unregisterNode:(mapId,name)=>nodes.delete(name),
    burdenPlateButtons:()=>[{label:'Place Key Statue',action:'interact',allowed:true}],
    keyStatueButtons:()=>[{label:'Take Key Statue',action:'take',allowed:true}],
    interactBurdenPlate:()=>({ok:true,message:'The statue sinks'}),
    interactKeyStatue:()=>({ok:true,message:'Key Statue taken'}),
  };
  const statue={
    registerDispenser(mapId,name,group,puzzleConfig,options){
      dispensers.push({name,feedPlinthId:options.feedPlinthId});
      return true;
    },
  };
  const enemy={
    create:spec=>{encounters.push(spec);return spec;},
    remove:identifier=>{removed.push(identifier);return true;},
  };
  const instance=Defense.create({THREE,parent,room:{x:100,z:160,w:18,d:18},y:8,id,
    mapId:'map_i_dev_random_ruin',Ruinc:null,RuinComposer:Composer,AuthoredFurniture:authored,
    FurniturePuzzleRuntime:puzzle,KeyStatues:statue,RuinEncounters:enemy,
    isActive:()=>true,getPlayerY:()=>currentY,
    addControl:c=>controls.push(c),removeControl:c=>{
      const index=controls.indexOf(c);if(index>=0)controls.splice(index,1);
    },
    onSolved:()=>solved++,onLink:()=>linked++,onError:()=>errors++,
  });
  return {instance,parent,nodes,controls,encounters,dispensers,removed,disposed,
    get solved(){return solved},get linked(){return linked},get errors(){return errors},
    setFloor:y=>{currentY=y},puzzle,
  };
}
async function flush(){
  for(let i=0;i<16;i++)await Promise.resolve(); // Drain asset loading and state assignment without wall-clock sleeps.
}
(async()=>{
  const one=harness('statue-integration-1');
  const rec=one.instance;
  assert.equal(rec.kind,'statueDefense');
  assert(!rec.ready&&!rec.solved);
  rec.tick(.05);await flush();
  assert(rec.ready&&!rec.error&&one.linked===1,'real authored plinth assets and encounter become ready');
  assert(rec.composedPieces>=3&&rec.enemySchedule>0,'real RuinComposer produced physical fixtures and enemy schedule');
  assert(one.nodes.has(rec.plinthId),'authored burden plinth registered under unique chamber instance ID');
  assert(one.nodes.has(rec.dispenserId),'physical Key Statue dispenser registered under unique chamber instance ID');
  assert(one.dispensers.some(d=>d.feedPlinthId===rec.plinthId),
    'every dispenser feeds the exact defended plinth so statue loss cannot softlock the dungeon');
  assert.equal(one.nodes.get(rec.plinthId).userData.__puzzleOverride.motion.durationSeconds,Defense.PRESS_SECONDS,
    'authored plinth and combat waves use the exact same 30-second objective clock');
  assert.equal(one.encounters.length,1,'one real combat encounter per defence chamber');
  const combat=one.encounters[0];
  assert.equal(combat.objective.plinthId,rec.plinthId);
  assert(combat.spawners.length>=1&&combat.schedule.length>=2,
    'authored spawner pillars must schedule skeleton and demolitionist waves');
  assert(combat.spawners.every(s=>s.x>=101&&s.z>=161),
    'enemy spawners must be translated to the actual stacked-story arena, not spawn at the map origin');
  assert.equal(combat.surfaceY(108,169),8,'all generated skeletons retain this story elevation');
  assert.equal(one.controls.length,2,'plinth and dispenser have real normal-world interactions');
  assert(one.controls.every(c=>c.floorY===8),'one story cannot use another story\'s burden inventory');
  one.setFloor(0);assert.equal(one.controls[0].onPress().ok,false,'lower-floor plinth cannot be activated');
  one.setFloor(8);assert.equal(one.controls[0].onPress().ok,true);
  rec.tick(.05);assert(!rec.solved,'combat objective cannot be bypassed by merely touching a fixture');
  one.nodes.get(rec.plinthId).userData.burdenPlateComplete=true;
  rec.tick(.05);assert(rec.solved&&one.solved===1,'ONLY the native plinth completion opens the wing gate');
  rec.tick(.05);assert.equal(one.solved,1,'completion callback is idempotent');
  rec.dispose();assert.equal(one.nodes.size,0,'defence cleanup unregisters all furniture puzzle nodes');
  assert.equal(one.controls.length,0,'defence cleanup withdraws player inputs');
  assert(one.disposed.geometries>=rec.composedPieces&&one.disposed.materials>=rec.composedPieces,
    'all private authored statue meshes release GPU geometry/material wrappers');
  assert.deepEqual(one.removed,[combat.id],'defence cleanup removes its enemy encounter and survivors');

  const invalid=harness('statue-missing-metadata',{
    buildGroup:asset=>{
      const group=new Group(); // Bad authored export: no mandatory burden plate or key-statue puzzle metadata.
      return group;
    },
  });
  invalid.instance.tick(.05);await flush();
  assert(!invalid.instance.ready&&!!invalid.instance.error&&invalid.errors===1,
    'a missing authored puzzle schema must be visible and must not silently unlock the gate');
  assert.equal(invalid.encounters.length,0,'invalid authored art cannot start combat with no usable plinth');
  assert.equal(invalid.nodes.size,0,'failed authored export rolls back all fixture registrations');
  invalid.instance.dispose();

  let fail=true;
  const later=harness('statue-retry', {load:async key=>{
    if(fail)throw new Error('temporary asset unavailable');
    return {key,parts:[{id:'authored'}]};
  }});
  later.instance.tick(.05);await flush();
  assert(!later.instance.ready&&!!later.instance.error&&later.errors===1,
    'missing authored art must not count the challenge as solved');
  assert.equal(later.nodes.size,0,'a failed load cannot strand half-built puzzle furniture');
  fail=false;
  for(let i=0;i<55;i++)later.instance.tick(.1);
  await flush();
  assert(later.instance.ready&&later.linked===1,
    'recoverable asset errors retry without rerolling a softlocked ruin');
  later.instance.dispose();

  const delayed={};
  const pending=harness('statue-aborted',{load:key=>new Promise(resolve=>{(delayed[key] ||= []).push(resolve);})});
  pending.instance.tick(.05);
  pending.instance.dispose();
  for(const [key,waiters] of Object.entries(delayed))for(const resolve of waiters)resolve({key,parts:[{}]});
  await flush();
  assert(!pending.instance.ready&&!pending.encounters.length&&!pending.nodes.size,
    'leaving the ruin during async preload cannot resurrect enemies, controls, or furniture');

  console.log('ok layered statue defence: real authored plan, 30s objective, replenishable key statue, enemy waves, retry, teardown');
})().catch(error=>{console.error(error);process.exitCode=1;});
