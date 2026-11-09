'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const manifest=JSON.parse(fs.readFileSync('docs/config/ruin-piece-sets/stone-age.json','utf8')); // One-to-one architectural equivalents remain ordinary editable furniture recipes.
const keys=['pillar_round','pillar_square','pillar_carved','pillar_heavy','pillar_ruined','stone_arch','stone_buttress','stone_pedestal','obelisk_stone'];
assert.deepEqual(Object.keys(manifest.mapping).sort(),keys.slice().sort());
for(const key of keys){
  const original=JSON.parse(fs.readFileSync('docs/assets/models/furniture/data/'+key+'.json','utf8'));
  const replacement=JSON.parse(fs.readFileSync('docs/'+manifest.mapping[key],'utf8'));
  assert.equal(replacement.equivalentTo,key);
  assert.deepEqual(replacement.tileBase,original.tileBase,'placement footprints must remain interchangeable');
  assert(replacement.parts.length>0&&replacement.parts.length<original.parts.length,'Stone Age equivalents must use fewer, simpler components');
  assert(new Set(replacement.parts.map(p=>p.id)).size===replacement.parts.length);
  for(const part of replacement.parts){assert(['legSquare','cylinder'].includes(part.kind));for(const value of Object.values(part.transform))assert(Number.isFinite(value));assert(part.transform.sx>0&&part.transform.sy>0&&part.transform.sz>0);assert.equal(part.materialRole,'stone');}
}
const bridge=fs.readFileSync('docs/tools/debris-ifier/debrisifier-v50-api.js','utf8');
const segment=bridge.slice(bridge.indexOf('  let activePieceSet='),bridge.indexOf('  // The recovered V50 source'));
const originalAsset={path:'docs/assets/models/furniture/data/pillar_square.json',name:'pillar_square',foot:{w:1,h:1},data:{parts:[{id:'original'}]}}; // Execute the bridge's actual opt-in resolver with local assets.
const context={URL,location:{href:'https://example.test/docs/tools/debris-ifier/index.html'},
 interiorSupportPillarSlots:(_room,_network,plateau)=>plateau.focuses,resolveRuinAsset:async()=>originalAsset,fetchRepoFurnitureData:async path=>JSON.parse(fs.readFileSync(path,'utf8')),
 fetch:async()=>({ok:true,json:async()=>manifest})};
vm.createContext(context);vm.runInContext(segment,context);
(async()=>{
 assert.equal(await vm.runInContext('resolveRuinAsset("docs/assets/models/furniture/data/pillar_square.json")',context),originalAsset);
 await vm.runInContext('selectPieceSet("stoneAge")',context);
 const alternate=await vm.runInContext('resolveRuinAsset("docs/assets/models/furniture/data/pillar_square.json")',context);
 assert.equal(alternate.name,originalAsset.name);assert.equal(alternate.path,originalAsset.path);assert.equal(alternate.foot,originalAsset.foot);
 assert.equal(alternate.data.equivalentTo,'pillar_square');assert.equal(alternate.data.parts.length,1);assert.equal(originalAsset.data.parts[0].id,'original');
 context.plateau={focuses:['removed display']};assert.equal(vm.runInContext('interiorSupportPillarSlots(null,null,plateau).length',context),1);vm.runInContext('activePillarsOnly=true',context);assert.equal(vm.runInContext('interiorSupportPillarSlots(null,null,plateau).length',context),0);assert.equal(context.plateau.focuses.length,1);
 await vm.runInContext('selectPieceSet()',context);
 assert.equal(await vm.runInContext('resolveRuinAsset("docs/assets/models/furniture/data/pillar_square.json")',context),originalAsset,'ordinary Harlyao generation must restore its original pieces');
 console.log('Stone Age ruin pieces: nine simpler equivalents, matching footprints, opt-in mapping, immutable source assets and Harlyao restoration passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
