'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
class EmptyGroup {
  constructor() { this.children=[];this.userData={};this.matrixWorld={clone:()=>({invert(){return this;}})}; }
  add(child){this.children.push(child);child.parent=this;return this;}
  remove(child){this.children=this.children.filter(value=>value!==child);child.parent=null;}
  traverse(callback){callback(this);for(const child of [...this.children])child.traverse(callback);}
  updateWorldMatrix(){}
}
const windowForTest = {THREE:{Group:EmptyGroup,Vector3:class {}}}; // Dependency-free empty-surface lifecycle; real triangles are also checked headlessly.
vm.runInNewContext(fs.readFileSync('docs/js/foliage-generator.js','utf8'),{window:windowForTest});
const api = windowForTest.FoliageGenerator; // Execute the production normalizer and lifecycle rather than mirroring source expressions.
const original = {kind:'roots',count:9999,length:-3,radius:Infinity,color:'not-a-color',target:'selected',targetIds:['chair',null,12]};
const normalized = api.normalizeSurfaceGrowth(original);
assert.equal(normalized.count,80);assert.equal(normalized.length,.05);assert.equal(normalized.radius,.025);
assert.equal(normalized.color,'#4a3b33');assert.equal(normalized.texture,'assets/textures/wibbly_surface.png');assert.deepEqual(Array.from(normalized.targetIds),['chair']);assert.equal(original.count,9999);
for(const bad of [null,undefined,[],42,'broken'])assert.equal(api.normalizeSurfaceGrowth(bad).kind,'vines');
assert.equal(api.normalizeSurfaceGrowth({target:'invented',count:NaN,length:Infinity,seed:'x'.repeat(999)}).target,'all');
assert.equal(api.normalizeSurfaceGrowth({seed:'x'.repeat(999)}).seed.length,128);
assert.equal(api.normalizeSurfaceGrowth({}).texture,'assets/textures/carved_smooth.png');
assert.equal(api.normalizeSurfaceGrowth({texture:'assets/textures/custom.png',color:'#123456'}).texture,'assets/textures/custom.png');
assert.equal(api.normalizeSurfaceGrowth({texture:''}).texture,'');
for(const texture of ['javascript:alert(1)','blob:temporary','file:///x.png','../private.png'])assert.equal(api.normalizeSurfaceGrowth({texture}).texture,'assets/textures/carved_smooth.png');
const embedded = 'data:image/png;base64,iVBORw0KGgo='; // Portable uploaded PNG reference must survive serialization without becoming an object URL.
assert.equal(api.normalizeSurfaceGrowth(JSON.parse(JSON.stringify({texture:embedded}))).texture,embedded);
windowForTest.NaturalSurfaceMaterials={surfaceDefaults:(surface)=>({texture:'assets/textures/configured.png',color:surface==='trunks'?'#504030':'#406040'})};
assert.equal(api.normalizeSurfaceGrowth({kind:'roots'}).color,'#504030');assert.equal(api.normalizeSurfaceGrowth({kind:'roots'}).texture,'assets/textures/configured.png');
assert.equal(api.normalizeSurfaceGrowth({kind:'vines',color:'#abcdef'}).color,'#abcdef');
delete windowForTest.NaturalSurfaceMaterials;
const parent = new EmptyGroup(), source = new EmptyGroup(), old = new EmptyGroup(), nested = new EmptyGroup(); // Only owned generated layers may be released on regeneration.
let disposedGeometry=0,disposedMaterial=0;
source.geometry={dispose:()=>{throw new Error('source geometry disposed');}};
old.userData.surfaceFoliage=true;nested.geometry={dispose:()=>disposedGeometry++};nested.material={dispose:()=>disposedMaterial++};old.add(nested);parent.add(source);parent.add(old);
const report = api.applySurfaceGrowth(parent,[{kind:'vines'}]);
assert.equal(disposedGeometry,1);assert.equal(disposedMaterial,1);assert(parent.children.includes(source));assert(!parent.children.includes(old));
assert(report.includes('No eligible surface triangles'));
assert.equal(parent.children.filter(child=>child.userData.surfaceFoliage).length,1);
api.applySurfaceGrowth(parent,Array.from({length:100},()=>({kind:'roots'})));
assert.equal(parent.children.filter(child=>child.userData.surfaceFoliage).length,32);
api.applySurfaceGrowth(parent,null);assert.deepEqual(parent.children,[source]);
console.log('Surface foliage input bounds, empty targets, deterministic recipe normalization and owned-layer disposal passed.');
