'use strict';
// Execute production V50 conversion: two-sided masonry must not alter shared roof/floor materials.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/js/dev-random-ruin-interior-map.js'),'utf8');
const begin=source.indexOf('  function applyUnlitRuinMaterials(root) {');
const end=source.indexOf('\n  function buildTexturedCeiling',begin);
assert(begin>=0&&end>begin,'the production V50 material converter exists');
const input={side:0,map:{name:'stone'},clone(){return {...this};}};
const wallA={isMesh:true,material:input,userData:{ruinInteriorWall:true,decalMaterials:[input]}};
const wallB={isMesh:true,material:[input],userData:{ruinInteriorWall:true}};
const floor={isMesh:true,material:input,userData:{}};
const ceiling={isMesh:true,material:input,userData:{devRandomRuinCeiling:true}};
const scene={traverse(callback){for(const node of [wallA,wallB,floor,ceiling])callback(node);}};
const sandbox={THREE:{DoubleSide:2},window:{RuinWallFaces:require('../docs/js/ruin-wall-faces.js')},
  isLegacyV50StoneMaterial:()=>false,isLitMaterial:()=>false,makeUnlitMaterial:material=>material};
const apply=vm.runInNewContext('('+source.slice(begin,end).trim()+')',sandbox);
const stats=apply(scene);
assert.equal(stats.totalMeshes,4);
assert.notEqual(wallA.material,input,'V50 masonry gets independent wall-only material');
assert.equal(wallA.material.side,2,'V50 wall backs remain visible');
assert.equal(wallA.material,wallB.material[0],'walls share one clone per source material');
assert.equal(wallA.userData.decalMaterials[0],wallA.material,'engraving material tracks the actual wall clone');
assert.equal(floor.material,input,'ordinary floor material is preserved');
assert.equal(ceiling.material,input,'overhead ceiling material is preserved');
assert.equal(input.side,0,'the original shared stone material is unchanged');
console.log('ruin-v50-wall-materials: isolated masonry sidedness OK');
