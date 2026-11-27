'use strict';
const assert = require('node:assert/strict'); // The production renderer/painter integration must preserve complete uploaded rigs.
const fs = require('node:fs'); // Loads the shipped modules and creature bestiary.
const vm = require('node:vm'); // Runs browser-only installers without devtools.
const ids = ["moot","voorg-ass","puktuk","gar-wolf","grehlr","dabinggi-hound","uumkaoii","nelk","nazgraku","pingdort"]; // Ten independently authored species.
const bestiary = JSON.parse(fs.readFileSync('docs/config/creatures/hobunji-creature-bestiary.json','utf8'));
const originalDrenkirra = { pivot:{x:.4375,y:.51}, weightMap:{ marker:'unchanged-head-paint' } }; // Non-upload regression fixture.
const renderer = { ANIMAL_HEAD_RIGS: {drenkirra:originalDrenkirra}, HEAD_RIG_VARIANT_ALIASES:{} };
const species = {ANIMAL_HEAD_RIGS:renderer.ANIMAL_HEAD_RIGS, baseSpeciesFor:kind=>kind==='grehlr-den-mother'?'grehlr':kind,resolveForOptions:()=>null};
const avatars = { buildAnimalPlaneAvatarModel(_THREE,_url,options={}){ return {options}; } };
let preview = '{}'; // Simulates the browser's locally edited rig preview.
const localStorage = { getItem:key=>key==='hobunji_animal_head_rigs_v1'?preview:null };
const win = {CreatureGeneticsRender:renderer, HobunjiAnimalHeadRigSpecies:species, PNGPlaneAvatar:avatars,
  CreatureGenetics:{SPECIES_ALIAS:{}}, AnimalHeadRigRuntime:{STORAGE_KEY:'hobunji_animal_head_rigs_v1'},
  __farmLog(){},localStorage};
const context = vm.createContext({window:win, localStorage,console,JSON,Object,String,Array,Number});
vm.runInContext(fs.readFileSync('docs/js/animal-head-rig-authored.js','utf8'),context,{filename:'animal-head-rig-authored.js'});
const api = win.HobunjiAuthoredAnimalHeadRigs;
assert.equal(api?.version,'2026-11-26-ten-authored-rigs1','latest defaults must load on desktop and mobile');
const plain = value=>JSON.parse(JSON.stringify(value)); // Normalizes the vm realm before deep-equality comparisons.
for(const id of ids){
  const records=bestiary.creatures.filter(c=>c.id===id);
  assert.equal(records.length,1,id+': editor needs exactly one full creature record');
  const expected=records[0].headRig;
  if(id==='pingdort') assert.equal(expected?.shoulderRest,undefined,'Pingdort curl remains owned by the flying rig');
  else assert(expected?.shoulderRest?.enabled,id+': full painted shoulder export is required');
  assert.deepEqual(plain(api.get(id)),expected,id+': uploaded full rig equals painter source');
  assert.deepEqual(plain(renderer.ANIMAL_HEAD_RIGS[id]),expected,id+': renderer contains new default');
  assert.deepEqual(plain(species.ANIMAL_HEAD_RIGS[id]),expected,id+': species lookup contains new default');
  assert.deepEqual(plain(avatars.buildAnimalPlaneAvatarModel(null,id+'_idle.png',{creatureId:id}).options.headRig),expected,
    id+': runtime avatar builder receives whole authored rig including growth controls');
}
assert.deepEqual(plain(api.get('drenkirra').weightMap),originalDrenkirra.weightMap,
 'Drenkirra keeps previous painted head when no uploaded replacement exists');
assert(api.get('drenkirra').shoulderRest?.enabled,'Drenkirra keeps a shoulder pose');
assert.deepEqual(plain(api.get('grehlr-den-mother')),plain(api.get('grehlr')),
 'Grehlr Den-Mother shares the authored base species rig');
const explicit={enabled:true,pivot:{x:0.125,y:0.875},local:true}; // Editor-supplied rigs always outrank committed species.
preview=JSON.stringify({'gar-wolf':explicit});
assert.deepEqual(plain(avatars.buildAnimalPlaneAvatarModel(null,'',{creatureId:'gar-wolf'}).options.headRig),explicit,
 'locally painted preview wins over built-in defaults');
assert.deepEqual(plain(avatars.buildAnimalPlaneAvatarModel(null,'',{creatureId:'moot',headRig:explicit}).options.headRig),explicit,
 'explicit animation/editor option always wins');
preview='{}';
assert.equal(avatars.buildAnimalPlaneAvatarModel(null,'',{creatureId:'gar-wolf'}).options.headRig.babyHeadScale,1.3,
 'clearing a preview reverts to new committed baby head without a reload');

const outputCanvases=[]; // Detect whether baby deformation incorrectly mutates an adult's original pixels.
context.document={createElement(tag){
  assert.equal(tag,'canvas');
  const canvas={width:0,height:0,data:null};
  canvas.getContext=()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
    putImageData:image=>{canvas.data=image.data;}});
  outputCanvases.push(canvas);
  return canvas;
}};
vm.runInContext(fs.readFileSync('docs/js/baby-animal-head-warp.js','utf8'),context,
  {filename:'baby-animal-head-warp.js'});
const warp=win.BabyAnimalHeadWarp;
const growth={moot:1.35,'voorg-ass':1.41,puktuk:1.23,'gar-wolf':1.3,grehlr:1.28,
 'dabinggi-hound':1.12,uumkaoii:1.23,nelk:1.19,nazgraku:1.23,pingdort:1}; // Exact uploaded or inherited 123% scales.
for(const [id,scale] of Object.entries(growth)){
  assert.equal(warp.scaleForKind(id),scale,id+': uploaded baby scale must reach production warp');
  assert.equal(warp.shorteningForKind(id),api.get(id).babyHeadShortening??warp.getShortening(),
    id+': brachycephaly uses uploaded or global setting');
  assert.equal(warp.maskModeForKind(id),api.get(id).babyHeadUsePaintedFrame===false?'idle-alpha':'legacy-frame',
    id+': authored alpha versus painted choice survives');
}
for(const [id,width,height] of [['gar-wolf',128,56],['grehlr',128,96]]){
  const pixels=new Uint8ClampedArray(width*height*4); // Synthetic nonuniform opaque idle image.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    pixels[i]=x*2;pixels[i+1]=y*3;pixels[i+2]=x+y;pixels[i+3]=255;
  }
  const original={width,height,data:pixels,getContext:()=>({getImageData:()=>({data:pixels})})};
  assert.equal(warp.abdomenForKind(id).enabled,api.get(id).babyAbdomenEnabled,id+': uploaded abdomen toggle survives runtime');
  const rig=api.get(id); // Prefer the explicitly enabled custom growth rectangle; retain the authored fallback frame.
  const expectedFrame=rig.babyHeadUseCustomFrame===true ? rig.babyHeadCustomFrame : rig.babyHeadFrame;
  assert.deepEqual(plain(warp.frameForKind(id)),plain(expectedFrame),id+': selected authored head rectangle is active');
  assert(warp.primeIdleMask(id,original)?.opaquePixels>0,id+': valid idle-head opacity mask');
  const grown=warp.applyToCanvas(original,id);
  assert(grown!==original&&grown.data.some((v,i)=>v!==pixels[i]),id+': output head pixels grow');
  assert.equal(original.data,pixels,id+': original adult artwork is not modified');
}
console.log('uploaded animal head rigs: ten default head sizes and real baby-pixel warp checks passed');
