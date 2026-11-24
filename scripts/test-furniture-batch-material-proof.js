'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('docs/js/zone-prop-render-batches.js','utf8');
const start=code.indexOf('  const furnitureAlphaProof =');
const end=code.indexOf('  function materialEligible(',start);
assert(start>=0 && end>start);
const timers=[];
const api=vm.runInNewContext(code.slice(start,end)
  + '\n({furnitureMaterialKey,furnitureTextureOpaque,captureFurnitureState,furnitureStateMatches})',{
  window:{THREE:{NormalBlending:1}},
  defaultAfterRender:undefined,
  document:{createElement:()=>({getContext:()=>({
    clearRect(){},drawImage(image){this.image=image;},
    getImageData(){return {data:new Uint8Array([0,0,0,this.image.alpha])};}
  })})},
  setTimeout:fn=>timers.push(fn),isCustomShader:m=>!!m.custom,drawnMaterial:m=>m.material,
  CARRIED_FLAG_PATTERN:/^(hobunji|is|surface|ground|background|noOutline|skipOcclusionFade|terrain|cameraObstacle)/
});
const map={id:1,version:1,image:{width:1,height:65,alpha:255},userData:{furnitureShared:true}};
const material={isMeshLambertMaterial:true,type:'MeshLambertMaterial',opacity:1,
  depthWrite:true,depthTest:true,colorWrite:true,blending:1,transparent:true,
  color:{r:1,g:1,b:1},map};
const mesh={userData:{authoredPart:{kind:'box'}},parent:{userData:{authoredFurnitureKey:'campfire'}},children:[],material};
assert.equal(api.furnitureMaterialKey(mesh),null);
assert.equal(api.furnitureMaterialKey(mesh),null);
assert.equal(timers.length,1);
let turns=0;
while(timers.length){timers.shift()();turns++;}
assert.equal(turns,3);
const key=api.furnitureMaterialKey(mesh);
assert.ok(key);
assert.equal(api.furnitureMaterialKey({...mesh,material:{...material}}),key);
assert.equal(material.transparent,true);
const state=api.captureFurnitureState(mesh,material);
assert.equal(api.furnitureStateMatches(mesh,state),true);
assert.equal(api.furnitureStateMatches({...mesh,material:{...material,opacity:.5}},state),false);
assert.equal(api.furnitureStateMatches({...mesh,userData:{...mesh.userData,isBillboard:true}},state),false);
map.version++;
assert.equal(api.furnitureStateMatches(mesh,state),false);
map.version--;
assert.notEqual(api.furnitureMaterialKey({...mesh,material:{...material,color:{r:0,g:1,b:1}}}),key);
assert.equal(api.furnitureMaterialKey({...mesh,material:{...material,opacity:.5}}),null);
assert.equal(api.furnitureMaterialKey({...mesh,children:[{}]}),null);
assert.equal(api.furnitureMaterialKey({...mesh,material:{...material,custom:true}}),null);
const cutout={...map,image:{width:1,height:1,alpha:254}};
assert.equal(api.furnitureTextureOpaque(cutout),false);
while(timers.length) timers.shift()();
assert.equal(api.furnitureTextureOpaque(cutout),false);
assert.equal(timers.length,0);
console.log('furniture alpha proof and live material key OK');
