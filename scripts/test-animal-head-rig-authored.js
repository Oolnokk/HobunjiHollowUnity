'use strict';
const assert = require('node:assert/strict'); // The production renderer/painter integration must preserve complete uploaded rigs.
const fs = require('node:fs'); // Loads the shipped modules and creature bestiary.
const vm = require('node:vm'); // Runs browser-only installers without devtools.
const ids = ["moot","voorg-ass","puktuk","gar-wolf","grehlr","dabinggi-hound","uumkaoii","nelk","nazgraku"]; // Nine species explicitly approved for this release.
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
assert.equal(api?.version,'2026-11-18-nine-authored-rigs2','latest defaults must load on desktop and mobile');
const plain = value=>JSON.parse(JSON.stringify(value)); // Normalizes the vm realm before deep-equality comparisons.
for(const id of ids){
  const records=bestiary.creatures.filter(c=>c.id===id);
  assert.equal(records.length,1,id+': editor needs exactly one full creature record');
  const expected=records[0].headRig;
  assert(expected?.shoulderRest?.enabled,id+': full painted shoulder export is required');
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
assert.equal(api.get('grehlr').shoulderRest.afterPoints[1].x,0.45273197437284163,
 'second shoulder spline point must preserve the exact uploaded precision');
assert.equal(api.get('grehlr').shoulderRest.afterPoints[4].x,0.46590469124098366,
 'fifth shoulder spline point must preserve the exact uploaded precision');
const explicit={enabled:true,pivot:{x:0.125,y:0.875},local:true}; // Editor-supplied rigs always outrank committed species.
preview=JSON.stringify({'gar-wolf':explicit});
assert.deepEqual(plain(avatars.buildAnimalPlaneAvatarModel(null,'',{creatureId:'gar-wolf'}).options.headRig),explicit,
 'locally painted preview wins over built-in defaults');
assert.deepEqual(plain(avatars.buildAnimalPlaneAvatarModel(null,'',{creatureId:'moot',headRig:explicit}).options.headRig),explicit,
 'explicit animation/editor option always wins');
preview='{}';
assert.equal(avatars.buildAnimalPlaneAvatarModel(null,'',{creatureId:'gar-wolf'}).options.headRig.babyHeadScale,1.3,
 'clearing a preview reverts to new committed baby head without a reload');

const expectedMaps={
  "moot": {
    "weightMap": "c0e7f597",
    "compressibilityMap": "21d1da34"
  },
  "voorg-ass": {
    "weightMap": "5596eaec",
    "compressibilityMap": "eb040ff6"
  },
  "puktuk": {
    "weightMap": "e18bd65d",
    "compressibilityMap": "8b4e349a",
    "stretchabilityMap": "49d37702"
  },
  "gar-wolf": {
    "weightMap": "1b3d0a54"
  },
  "grehlr": {
    "weightMap": "72fe5e4c",
    "compressibilityMap": "d59e15f9",
    "stretchabilityMap": "ef76e3e2"
  },
  "dabinggi-hound": {
    "weightMap": "497c97a8"
  },
  "uumkaoii": {
    "weightMap": "52f9e3f1",
    "compressibilityMap": "c73e77cb",
    "stretchabilityMap": "473958c9"
  },
  "nelk": {
    "weightMap": "8c4f163f",
    "compressibilityMap": "59322801",
    "stretchabilityMap": "04e0498a"
  },
  "nazgraku": {
    "weightMap": "31220f8a",
    "compressibilityMap": "5d5deb33",
    "stretchabilityMap": "13d686e4"
  }
}; // Signed-off fingerprints of every 16-bit source RLE stream.
function fingerprint(map){
  let hash=0x811c9dc5; // FNV-1a checks both bytes of all run lengths and painted values.
  for(const value of map.data){
    hash=Math.imul(hash^(value&255),0x01000193);
    hash=Math.imul(hash^(value>>>8),0x01000193);
  }
  return (hash>>>0).toString(16).padStart(8,'0');
}
for(const [id,maps] of Object.entries(expectedMaps)){
  const rig=api.get(id);
  for(const [name,digest] of Object.entries(maps)){
    const m=rig[name];
    assert.equal(m?.encoding,'rle-u9',id+'/'+name+': painted map encoding');
    assert.equal(m.data.length%2,0,id+'/'+name+': complete runs');
    let cells=0; // Reject maps that leave gaps or overshoot the authored UV grid.
    for(let i=0;i<m.data.length;i+=2){
      assert(Number.isSafeInteger(m.data[i])&&m.data[i]>0,id+'/'+name+': positive integer run');
      assert(Number.isInteger(m.data[i+1])&&m.data[i+1]>=0&&m.data[i+1]<=256,id+'/'+name+': legal intensity');
      cells+=m.data[i];
    }
    assert.equal(cells,m.width*m.height,id+'/'+name+': full painted area');
    assert.equal(fingerprint(m),digest,id+'/'+name+': exact uploaded paint values');
  }
}
const otherEnd=api.get('voorg-ass').shoulderRest.afterPoints[6].y; // An edit to Moot must not leak into Voorg-Ass.
const moot=api.get('moot'),voorg=api.get('voorg-ass');
assert.notStrictEqual(moot.weightMap.data,voorg.weightMap.data,'each species has independent head paint data');
moot.shoulderRest.afterPoints[6].y+=.01;
assert.equal(voorg.shoulderRest.afterPoints[6].y,otherEnd,'independent shoulder curve survives runtime edits');
assert.notStrictEqual(api.get('nelk').shoulderRest.beforePoints,api.get('nazgraku').shoulderRest.beforePoints,
 'painted shoulder splines are not shared mutable instances');
console.log('animal-head-rig-authored: nine complete rigs, source fingerprints, fallbacks, preview and avatar ownership passed');
