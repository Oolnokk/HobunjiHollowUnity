#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership migration of stable-animal-progression.js:
// its self-recursive alertFrame() loop (service-XP ticks plus shoulder-pet
// threat-alert aura animation) becomes a single RuntimeFrameScheduler
// registration, since neither piece has a render-order dependency (auras
// are ordinary scene sprites, not PlayerBodyTransformComposer channels).
// This module is only ever dynamically loaded by
// livestock-nursery-install-bridge.js in the shipped game, never by a
// docs/tools/* editor page, so it needs no requestAnimationFrame fallback
// at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/stable-animal-progression.js', 'utf8');
assert(source.includes("window.RuntimeFrameScheduler.register('stable-animal-progression-alert'"), 'alertFrame must register with the scheduler');
assert(!/requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

function buildFixture(three = null) {
  const registered = new Map();
  const windowObject = {
    FarmAnimals: { init() {} },
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
  };
  const canvasContext = { clearRect(){},beginPath(){},arc(){},stroke(){},moveTo(){},lineTo(){} };
  const document = { createElement: () => ({ style: {}, appendChild(){}, addEventListener(){},getContext:()=>canvasContext }), getElementById: () => null };
  const context = { window: windowObject, document, console, performance: { now: () => 1000 } };
  context.window = windowObject;
  if (three) context.THREE = three;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'stable-animal-progression.js' });
  return { windowObject, registered, api: windowObject.StableAnimalProgression };
}

// --- install() registers exactly once with the scheduler --------------------
{
  const { registered, api } = buildFixture();
  api.install();
  const entry = registered.get('stable-animal-progression-alert');
  assert(entry, 'alertFrame registers under a stable id after install()');
  assert.equal(entry.options.owner, 'StableAnimalProgression');
  assert.notEqual(entry.options.phase, 'pre-render', 'alert auras are ordinary scene sprites with no render-order dependency');
}

// --- install() called twice (real re-install path) registers only once -----
{
  const { registered, api } = buildFixture();
  api.install();
  api.install();
  assert.equal([...registered.keys()].filter(id => id === 'stable-animal-progression-alert').length, 1, 'repeated install() calls must not double-register the alert frame');
}

// --- driving the registered callback does not throw with no active pets ----
{
  const { registered, api } = buildFixture();
  api.install();
  const entry = registered.get('stable-animal-progression-alert');
  assert.doesNotThrow(() => entry.fn({ timestamp: 2000 }), 'the scheduler callback must tolerate an idle stable with no player/combat deps wired');
}

// Multiple awards in one scheduler callback save once, without delaying XP.
{
  const THREE = {CanvasTexture:class{},SpriteMaterial:class{dispose(){}},Sprite:class{
    constructor(material){this.material=material;this.position={copy(p){Object.assign(this,p);}};this.scale={set(){}};}
  }};
  const {windowObject:w,registered,api}=buildFixture(THREE);
  const player={x:0,y:0}, entries=['companion','mount','shoulderPet'].map(role=>({id:role,role,level:0,stableXp:0,animalPerks:{}}));
  let saves=0, anchors=0, warnings=0, conditions=0;
  const scene={isScene:true,children:[],add(o){o.parent=this;this.children.push(o);},remove(o){this.children=this.children.filter(x=>x!==o);o.parent=null;}};
  const enemy={health:100,x:10,y:0,areaId:'town',isBandit:true,telegraphState:'windup',_banditSwingAnim:'sweep',_banditSwingPower:1.7,def:{weaponKey:'axe'},root:{parent:scene}};
  w.Combat={deps:{player,TILE:64,getCurrentArea:()=> 'town',companionObjects:entries.map(e=>({health:100,stableRole:e.role,master:player})),hostileObjects:[enemy]},
    loadout:{getSlot:()=> 'quick'},quickAttackData:{TECHNIQUES:{quick:{condKey:'ready'}}},getQuickAttackConditions(){conditions++;return {ready:true};}};
  w.WorldPopupText={avatarCentroidWorld(){anchors++;return {x:1,y:2,z:3};}};
  w.AnimalVocalizations={warning(){warnings++;}};
  api.install();w.FarmAnimals.init({getStable:()=>entries,saveStable(){saves++;},getActiveCompanionId:()=> 'companion',getActiveMountId:()=> 'mount',getActiveShoulderPetId:()=> 'shoulderPet'});
  const run=timestamp=>registered.get('stable-animal-progression-alert').fn({timestamp});
  saves=0;run(5000);assert.equal(conditions,0,'no warning perks means no enemy condition work');
  entries[2].animalPerks={heavyWindupAlert:1,quickOpportunityAlert:1};
  run(10000);
  assert.equal(saves,1,'three service awards and two alert awards persist together');
  assert.deepEqual(entries.map(e=>e.stableXp),[2,2,8]);
  assert.equal(scene.children.length,2);assert.equal(anchors,1,'both warnings share the centroid');assert.equal(warnings,2);
  run(10001);assert.equal(saves,1,'existing auras do not award again');assert.equal(anchors,2);
  entries[2].animalPerks={};run(10002);assert.equal(scene.children.length,0,'removing perks clears existing warnings immediately');
  api.awardXp(entries[0],3,'public');assert.equal(saves,2,'public XP remains immediately persisted');
}

console.log('stable animal progression scheduler migration and batched XP passed');
