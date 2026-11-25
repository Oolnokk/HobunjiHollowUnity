'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = file => fs.readFileSync('docs/js/' + file, 'utf8');
const block = (text, from, to) => {
  const a=text.indexOf(from), b=text.indexOf(to,a+from.length);
  assert(a>=0 && b>a, from);
  return text.slice(a,b);
};

function testCoinReuse() {
  const text = source('action-arch-icons.js');
  let allocations=0, rasterRevision=0, step=1, loaded=true;
  class Node {
    constructor() {
      this.children=[]; this.dataset={}; this.attrs={}; this.style={}; this.tokens=new Set();
      this.classList={contains:key=>this.tokens.has(key),add:key=>this.tokens.add(key),toggle:(key,on)=>on?this.tokens.add(key):this.tokens.delete(key)};
    }
    setAttribute(key,value){this.attrs[key]=String(value);}
    getAttribute(key){return this.attrs[key]??null;}
    appendChild(child){this.children.push(child); return child;}
    append(...children){this.children.push(...children);}
    cloneNode(){return Object.assign(new Node(),this,{children:[...this.children]});}
    replaceChildren(...children){this.children=children;}
    querySelector(selector){
      if(selector==='.abt-icon') return this.host;
      if(selector==='.combat-coin') return this.children.find(n=>n.className==='combat-coin')||null;
      return null;
    }
  }
  const document={createElement(){allocations++;return new Node();}};
  const defs={combo:{category:'combo',label:'Combo'},quick:{category:'quickAttack',label:'Quick'}};
  let holding=false;
  const window={Combat:{loadout:{getSlot:id=>id==='tap1'?'combo':'quick'},abilities:{get:id=>defs[id]},input:{getState:()=>({holding})}}};
  const make = new Function('document','window','loadedIcon','comboNextStep','comboRaster',
    'let comboRasterRevision=0;\n' +
    block(text,'  function createDedicatedImage(','  function normalize(') +
    block(text,'  function attackTypeFor(','  function comboNextStep(') +
    block(text,'  const coinPerf =','  function actionButtons(') +
    block(text,'  function renderCombatButton(','  function refreshCombatButtons(') +
    '\nreturn {renderCombatButton,coinPerf,revise:()=>++comboRasterRevision};');
  const api=make(document,window,file=>loaded?{url:file}:null,()=>step,()=>loaded?'raster:'+step:null);
  const button=new Node(); button.host=new Node(); button.dataset.action='attack';
  api.renderCombatButton(1,button);
  const initial=allocations, original=button.host.children[0];
  assert(initial>0);
  for(let i=0;i<30;i++) api.renderCombatButton(1,button);
  assert.equal(allocations,initial,'unchanged combat coin must allocate zero DOM nodes');
  assert.equal(api.coinPerf.reuses,30);
  holding=true; api.renderCombatButton(1,button);
  assert(button.classList.contains('combat-hold-flipped'));
  assert.equal(allocations,initial,'holding changes CSS only');
  assert.equal(button.host.children[0],original);
  step=2; api.renderCombatButton(1,button);
  assert.notEqual(button.host.children[0],original,'combo step change rebuilds');
  const beforeRevision=button.host.children[0];
  api.revise(); api.renderCombatButton(1,button);
  assert.notEqual(button.host.children[0],beforeRevision,'new font/raster generation rebuilds');
  const beforeLabel=button.host.children[0];
  defs.quick.label='New quick'; api.renderCombatButton(1,button);
  assert.notEqual(button.host.children[0],beforeLabel);
  button.host.replaceChildren(); api.renderCombatButton(1,button);
  assert(button.host.children.length,'missing coin repairs itself');
  loaded=false; api.renderCombatButton(1,button);
  const fallback=button.host.children[0]; loaded=true; api.renderCombatButton(1,button);
  assert.notEqual(button.host.children[0],fallback,'loaded icon replaces pending fallback');
}

async function testMaterialization() {
  const text=source('porakaneki-camps-runtime.js');
  const counters={materializationAttempts:0,materializationCancelledBeforeBuild:0,materializationCancelledAfterBuild:0,materializationFailures:0,materializations:0};
  let nearby=true, area='zone', calls=0, pendingConfig, pendingEntity;
  let configPromise=()=>new Promise(resolve=>{pendingConfig=resolve;});
  let entityPromise=()=>new Promise(resolve=>{pendingEntity=resolve;});
  const discarded=[], published=[];
  const hostileObjects={add(entity){assert(entity.neutral);published.push(entity);}};
  const window={BanditCombat:{makeEntity(){calls++;return entityPromise();},discardEntity(e){discarded.push(e);}}};
  const camp={zoneId:'zone',hunters:[],id:'camp',kind:'small'};
  const hunter={camp,id:'h',x:0,y:0}; camp.hunters.push(hunter);
  const api=new Function('state','window','combatDeps','currentArea','sharesPlayerChunk','loadGangConfig',
    'weaponDef','isAvenger','tribe','placeEntity','makeNeutral',
    'let buildGeneration=1;const LABEL="Tribe",KEY="tribe",SPECIES_ID="test";\n' +
    block(text,'  function hunterCanMaterialize(','  function makeNeutral(') +
    '\nreturn {materializeHunter,nextGeneration:()=>++buildGeneration};')(
    counters,window,{TILE:64,hostileObjects},()=>area,()=>nearby,()=>configPromise(),
    ()=>({shapeKey:'shape'}),()=>false,{},()=>true,entity=>{entity.neutral=true;});
  let run=api.materializeHunter(hunter,1);
  assert.equal(await api.materializeHunter(hunter,1),null,'pending build is deduplicated');
  nearby=false; pendingConfig({}); assert.equal(await run,null);
  assert.equal(calls,0,'radius exit during config load avoids expensive avatar build');
  assert.equal(counters.materializationCancelledBeforeBuild,1);
  assert.equal(hunter.building,false);

  nearby=true; run=api.materializeHunter(hunter,1);
  pendingConfig({}); await Promise.resolve();
  assert.equal(calls,1);
  hunter.slain=true; hunter.materializationLifeRevision=1;
  hunter.slain=false; // Replacement has become eligible, but the old rig must not publish.
  const obsolete={health:10}; pendingEntity(obsolete);
  assert.equal(await run,null); assert.deepEqual(discarded,[obsolete]);
  assert.equal(counters.materializationCancelledAfterBuild,1);
  assert.equal(hunter.entity,undefined);

  run=api.materializeHunter(hunter,1); pendingConfig({}); await Promise.resolve();
  const valid={health:20}; pendingEntity(valid);
  assert.equal(await run,valid); assert.deepEqual(published,[valid]); assert.equal(hunter.entity,valid);
  assert.equal(counters.materializations,1);
  assert.equal(counters.materializationAttempts,3);
  assert.equal(counters.materializationFailures,0);
  assert.equal(hunter.building,false);

  delete hunter.entity; run=api.materializeHunter(hunter,1);
  camp.hunters.length=0; pendingConfig({}); assert.equal(await run,null);
  assert.equal(calls,2,'removed resident cannot start a new factory');
  assert.equal(counters.materializationCancelledBeforeBuild,2);
  camp.hunters.push(hunter);
  run=api.materializeHunter(hunter,1); pendingConfig(null); assert.equal(await run,null);
  assert.equal(counters.materializationFailures,1);
  assert.equal(hunter.building,false);
}

(async()=>{testCoinReuse();await testMaterialization();console.log('performance materialization and combat coin reuse: PASS');})().catch(error=>{console.error(error);process.exitCode=1;});
