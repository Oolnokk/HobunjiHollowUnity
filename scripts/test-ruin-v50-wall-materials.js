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
// Reproduce the normal NaturalSurfaceMaterials path: the old wall material must reach its
// *final* wall-only clone, with no second stone conversion or stale engraved-material pointer.
let stoneCreates=0;
const legacy={side:0,map:{name:'V50 stone'},clone(){return {...this};}};
const other={side:0,map:{name:'other'},clone(){return {...this};}};
const authoredWall={isMesh:true,material:legacy,userData:{ruinInteriorWall:true,decalMaterials:[legacy]}};
const anotherWall={isMesh:true,material:legacy,userData:{ruinInteriorWall:true}};
const mixedWall={isMesh:true,material:[legacy,other],userData:{ruinInteriorWall:true,decalMaterials:[legacy,other]}};
const authoredFloor={isMesh:true,material:legacy,userData:{decalMaterials:[legacy]}};
const authoredCeiling={isMesh:true,material:legacy,userData:{}};
const realisticNodes=[authoredWall,anotherWall,mixedWall,authoredFloor,authoredCeiling];
const realistic=vm.runInNewContext('('+source.slice(begin,end).trim()+')',{
  THREE:{DoubleSide:2},
  window:{
    RuinWallFaces:require('../docs/js/ruin-wall-faces.js'),
    NaturalSurfaceMaterials:{naturalizeMesh(){}},
    ProceduralFurniture:{makePartMaterial(){stoneCreates++;return {side:0,map:{name:'carved_smooth'},clone(){return {...this};}};}},
  },
  isLegacyV50StoneMaterial:material=>material===legacy||material?.map?.name==='carved_smooth',
  isLitMaterial:()=>false,makeUnlitMaterial:material=>material,
});
realistic({traverse(fn){for(const node of realisticNodes)fn(node);}});
assert.equal(stoneCreates,5,'four whole-stone meshes plus one mixed-material wall use only one material pass each');
assert.equal(authoredWall.material.side,2,'whole-stone wall clone must be two-sided');
assert.equal(authoredWall.userData.decalMaterials[0],authoredWall.material,'whole-stone walls remap original engraving references to their final wall clone');
assert.equal(mixedWall.userData.decalMaterials[0],mixedWall.material[0],'mixed-material walls remap the stone engraving to the wall clone');
assert.equal(mixedWall.userData.decalMaterials[1],mixedWall.material[1],'mixed-material walls also remap the non-stone engraving to the wall clone');
assert.equal(authoredFloor.userData.decalMaterials[0],authoredFloor.material,'floor decals follow their own single-sided stone replacement');
assert.equal(authoredFloor.material.side,0,'floor remains front-sided');
assert.equal(authoredCeiling.material.side,0,'ceiling remains front-sided');
assert.equal(legacy.side,0,'the original V50 prototype material is not changed');
console.log('ruin-v50-wall-materials: shared-material isolation and realistic legacy V50 remapping OK');
