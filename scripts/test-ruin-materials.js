'use strict';
const assert = require('assert'); // Used by material behavior checks.
const fs = require('fs'); // Reads the real material authority and authored chest data.
const vm = require('vm'); // Executes the furniture runtime with a controlled asynchronous loader.
const path = require('path'); // Resolves repository paths independently of the test runner's cwd.
const root = path.resolve(__dirname, '..'); // Repository root used by every file read below.
const jobs = []; // Pending PNG loads are completed after materials have been built.
class Texture {
  constructor() { this.center = { set() {} }; this.repeat = { set:(u,v) => { this.u=u; this.v=v; } }; }
  clone() { return new Texture(); } // Three.js r128 textures/clones have no userData by default.
}
class Material {
  constructor(options) { Object.assign(this, options); this.userData={}; this.color={set:value => {this.hex=value;}}; }
}
const THREE = { // Minimal material/texture API; geometry is intentionally outside these tests.
  MeshBasicMaterial:Material, MeshLambertMaterial:Material, FrontSide:0, RepeatWrapping:1000,
  SphereGeometry:class {}, // Uses the real buildPartMesh entry point without duplicating unrelated box UV geometry.
  Mesh:class { constructor(geometry, material) { this.geometry=geometry;this.material=material;this.position={set(){}};this.rotation={set(){}}; } },
  TextureLoader:class { load(url, done) { const texture=new Texture(); jobs.push(() => {texture.image={url};done(texture);}); return texture; } },
};
const fills = []; // Records shared shade-fill calls to verify color, source and cache isolation.
const window = { THREE, getShadeFillCanvas:(image,key,options) => {const result={image,key,options};fills.push(result);return result;} }; // Runtime globals used by the production material factory.
vm.runInNewContext(fs.readFileSync(path.join(root,'docs/js/procedural-furniture.js'),'utf8'),{window,THREE});
const factory=window.ProceduralFurniture.makePartMaterial; // Actual shared factory, including the asynchronous PNG handling.
const stone=factory({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never'}); // Unfilled door/brazier treatment.
const bronze=factory({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'always',materialFillEnabled:true,materialFillColor:'#b08d57'}); // Existing bronze furniture treatment.
const rope=factory({materialTexture:'boards.png',materialLighting:'unlit',materialFillEnabled:true,materialFillColor:'#c9ad77',materialRepeatU:4,surfaceOpacity:.98}); // Wrapped rope uses its previous hex.
assert.equal(stone.map.image,undefined);
assert.equal(stone.map.userData.furnitureTexture,'carved_smooth.png');
assert.equal(bronze.map.userData.furnitureFill,'#b08d57');
assert.notStrictEqual(stone.map.userData,bronze.map.userData,'each texture clone owns its fill metadata');
const mesh=window.ProceduralFurniture.buildPartMesh({kind:'sphere',transform:{sx:1,sy:1,sz:1},materialTexture:'boards.png'}); // Reproduces the authored/procedural furniture map-loading path from the error log.
assert.equal(mesh.material.map.userData.furnitureTexture,'boards.png');
for(const complete of jobs.splice(0))complete();
assert.equal(stone.map.image.url,'assets/textures/carved_smooth.png');
assert.equal(bronze.map.image.key,'furniture:carved_smooth.png:#b08d57');
assert.deepEqual(Array.from(rope.map.image.options.rgb),[201,173,119]);
assert.equal(rope.map.u,4);
assert.equal(rope.map.v,1);
assert.equal(rope.opacity,.98);
const lateStone=factory({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never'}); // Already-loaded source must remain unfilled after bronze is processed.
assert.equal(lateStone.map.image.url,'assets/textures/carved_smooth.png');
assert.equal(lateStone.map.userData.furnitureFill,null,'already-loaded stone initializes independent, unfilled clone metadata');
assert.equal(mesh.material.map.image.url,'assets/textures/boards.png');
assert.equal(fills.length,2);
for(let tier=1;tier<=4;tier++) {
  const data=JSON.parse(fs.readFileSync(path.join(root,`docs/config/furniture-authored/ruinDungeonChestT${tier}.json`))); // Real authored tier geometry keeps its hinge IDs.
  for(const part of data.parts) {
    assert.equal(part.materialTexture,'carved_smooth.png');
    assert.equal(part.materialUvMapping,'connected-surface-stretch');
    assert.equal(part.materialRole,['body','lid'].includes(part.id)?'stone':'metal');
  }
}
console.log('Ruin stone, bronze, asynchronous fill isolation, wrapped rope and all four chest tiers passed.');
