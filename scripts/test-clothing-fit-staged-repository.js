#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../docs/tools/clothing-species-fit'); // Uses the actual split editor implementation.
const core=Array.from({length:12},(_,i)=>fs.readFileSync(path.join(root,'app.part'+(i+1)+'.txt'),'utf8')).join('');
const start=core.indexOf('async function mapLimit(');
const end=core.indexOf('function rebuildSelectors(){',start);
assert(start>=0&&end>start,'Repository loader function was not found in the concatenated editor');
const implementation=core.slice(start,end); // Execute actual staged-loading logic with deterministic repository responses.
const makeLoad=new Function('R','E','A','fitRegion','status','runtimeDocsBase','fetchJson',
  'BODY_SLOTS','HEAD_SLOTS','rebuildSelectors','refreshAssets','rebuildGarmentSelector','log','console',
  implementation+'\nreturn loadRepositoryData;');

function deferred(){
  let resolve;
  const promise=new Promise(r=>resolve=r); // Controls when the nonpriority saved garment becomes available.
  return{promise,resolve};
}
async function until(predicate){
  for(let i=0;i<150;i++){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,3));
  }
  throw new Error('Staged catalog completion timed out');
}
function harness(){
  const gate=deferred(); // Keeps the last catalog item pending while the first priority batch finishes.
  const catalog=[{id:'basic',path:'basic.json'}];
  for(let i=1;i<20;i++)catalog.push({id:'filler_'+i,path:'filler_'+i+'.json'});
  catalog.push({id:'saved_late',path:'saved_late.json'});
  const E={garment:{value:'',options:[]},clothPng:{disabled:false},compositePng:{disabled:false},threeStatus:{textContent:''}};
  const A={settings:{region:'body',garment:'saved_late'}};
  const R={
    repositoryGeneration:0,assetGeneration:0,garmentSelectionEpoch:0,
    three:{portraitCache:new Map(),runtimeDocsBase:null,runtimeReadyPromise:null},
    speciesCfg:new Map(),garments:[],images:new Map(),bodyCanvases:new Map(),garmentCanvases:new Map(),
    body:{old:true},sourceBody:null,headReference:null,cloth:null,authoredTargetCloth:null
  };
  const messages=[];
  let assetLoads=0;
  const fetchJson=async p=>{
    if(p==='config/species/index.json')return {entries:[{speciesId:'tletingan',path:'./tletingan.json'}]};
    if(p==='config/cosmetics/index.json')return {entries:catalog};
    if(p==='config/species/tletingan.json')return {male:{headSprite:'head.png'}};
    if(p==='config/cosmetics/saved_late.json')await gate.promise;
    if(!p.startsWith('config/cosmetics/'))throw Error('Unexpected path '+p);
    return {slot:'torso',speciesVariants:{tletingan_male:{parts:{}}},meta:{name:p}};
  };
  const updateOptions=()=>{
    const options=R.garments.map(g=>({value:g.id}));
    E.garment.options=options;
    if(!options.some(o=>o.value===E.garment.value))E.garment.value=options[0]?.value||'';
  };
  const load=makeLoad(
    R,E,A,()=>A.settings.region,v=>messages.push(v),()=>'/unused/repository/root/',
    fetchJson,new Set(['torso']),new Set(['hood']),
    updateOptions,async()=>{assetLoads++;R.body={loaded:true};A.settings.garment=E.garment.value},
    updateOptions,()=>{}, {error(){}}
  );
  return {gate,R,E,A,load,messages,get assetLoads(){return assetLoads}};
}
(async()=>{
  const restored=harness();
  const loading=restored.load();
  assert(restored.R.assetGeneration===1,'Repository reload must invalidate old image requests immediately');
  assert.equal(restored.R.body,null,'Old canvas must not remain exportable during reload');
  await loading;
  assert.equal(restored.E.garment.value,'basic','First batch offers immediate garment choice');
  assert.equal(restored.A.settings.garment,'basic','Test fixture models normal saveState fallback');
  restored.gate.resolve();
  await until(()=>restored.E.garment.value==='saved_late');
  assert.equal(restored.assetLoads,2,'Late saved garment must load its own real source art');

  const changed=harness();
  await changed.load();
  changed.R.garmentSelectionEpoch++;
  changed.gate.resolve();
  await until(()=>changed.messages.some(m=>m.includes('2D editor ready:')));
  assert.equal(changed.E.garment.value,'basic','An explicit new selection must not be overwritten by saved fallback');
  assert.equal(changed.assetLoads,1,'Deferred catalog must not reload art when user chose another garment');

  console.log('OK: queued garment restoration, user selection priority, and repository reload invalidation');
})().catch(e=>{console.error(e);process.exitCode=1});
