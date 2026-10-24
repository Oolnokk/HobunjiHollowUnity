'use strict';
const assert = require('node:assert/strict'); // Checks owner scoping and all temporary render state.
const fs = require('node:fs'), vm = require('node:vm'); // Runs the production helper without a browser dependency.
const context = { window: {} }; // Isolated browser realm for the renderer helper.
vm.runInNewContext(fs.readFileSync('docs/js/head-relative-weapon-occlusion.js', 'utf8'), context);
const api = context.window.HeadRelativeWeaponOcclusion; // Production API under test.
const layers = () => ({ mask: 1, set(bit) { this.mask = 1 << bit; } }); // Matches Three.js camera/mesh layer selection.
const material = () => ({ visible:true,colorWrite:true,depthTest:true,depthWrite:true,stencilWrite:false,stencilWriteMask:255,stencilFunc:519,stencilRef:0,stencilFuncMask:255,stencilFail:7680,stencilZFail:7680,stencilZPass:7680 }); // Baseline materials must restore exactly.
const front = material(), back = material(), weaponMaterial = material(); // The front material must not contribute to the rear-only mask.
const rear = { isMesh:true,visible:true,layers:layers(),material:[front,back] }; // Canonical skinned portrait's front/back material groups.
const owner = { userData:{headRelativeBackPlane:rear},parent:null }; // Active head-relative holder tag.
const particleMaterial = material(); particleMaterial.depthWrite = false; // Transparent enchanted aura sprite.
const particle = { isSprite:true,visible:true,layers:layers(),material:particleMaterial,children:[],
  traverseVisible(fn) { if (this.visible) fn(this); } }; // Active particle in the held plane.
const hiddenParticle = { isSprite:true,visible:false,layers:layers(),material:material(),children:[],
  traverseVisible(fn) { if (this.visible) fn(this); } }; // Pooled particles must remain undrawn.
const weapon = { isMesh:true,visible:true,parent:owner,userData:{},layers:layers(),material:weaponMaterial,children:[particle,hiddenParticle],
  traverseVisible(fn) { if (!this.visible) return; fn(this); for (const child of this.children) child.traverseVisible(fn); } }; // Registered blade and its aura descendants.
const melee = { isMesh:true,parent:{userData:{}},userData:{},layers:layers(),material:material() }; // An unrelated melee weapon may not enter any head mask.
const groups = api.collect([weapon,melee]); // Uses only the small existing held list.
assert.equal(groups.length,1);assert.equal(groups[0].rear,rear);assert.equal(groups[0].weapons.length,1);
rear.layers.mask = 0xffffffff; // Enable-all sources must still be isolated between the two private draws.
const saved = JSON.stringify([front,back,weaponMaterial,particleMaterial,hiddenParticle.material]); // Before-image for exception-safe restoration checks.
const camera = {layers:layers()}, scene = {background:'sky',autoUpdate:true}; // Nested passes must restore world-render flags.
let writeMask=255,stencilBits=1,pass=0; // Bit 0 represents an existing hand/water fragment that must survive rear-mask clearing.
const renderer = {autoClear:true,state:{buffers:{stencil:{setMask(v){writeMask=v;},setTest(){}}}},clearStencil(){stencilBits &= ~writeMask;}}; // Simulates masked clears instead of clearing all stencil bits.
const T = {AlwaysStencilFunc:519,EqualStencilFunc:514,ReplaceStencilOp:7681,KeepStencilOp:7680}; // Three.js constants used by the production helper.
function draw() {
  pass++;
  if(pass===1){
    assert.equal(camera.layers.mask,1<<24);assert.equal(front.visible,false);
    assert.equal(back.colorWrite,false);assert.equal(back.depthTest,false);assert.equal(back.depthWrite,false);
    assert.equal(stencilBits,1,'owner mask clearing must preserve earlier water coverage');
    assert.equal(back.stencilWriteMask,2);stencilBits|=2;
  }else{
    assert.equal(rear.layers.mask & (1<<24),0,'rear source is excluded from the weapon color pass');
    assert.equal(camera.layers.mask,1<<24);assert.equal(weaponMaterial.stencilFunc,T.EqualStencilFunc);
    assert.equal(weaponMaterial.stencilRef & weaponMaterial.stencilFuncMask,0);
    assert.equal(weaponMaterial.stencilWriteMask,1,'visible head weapons stamp the existing water bit');
    assert.equal(weaponMaterial.depthTest,true);
    assert.equal(particle.layers.mask,1<<24,'aura child renders on the dedicated head-relative layer');
    assert.equal(particleMaterial.stencilWrite,true,'aura reads the owner's rear stencil');
    assert.equal(particleMaterial.stencilWriteMask,0,'transparent aura must never write a rectangular water stencil');
    assert.equal(particleMaterial.stencilFunc,T.EqualStencilFunc,'aura is rear-mask tested');
    assert.equal(particleMaterial.depthWrite,false,'sprite transparency keeps depth writing off');
    assert.equal(hiddenParticle.layers.mask,1,'pooled sprites remain untouched');
  }
}
api.draw(renderer,scene,camera,draw,groups,T,true);
assert.equal(pass,2);assert.equal(JSON.stringify([front,back,weaponMaterial,particleMaterial,hiddenParticle.material]),saved);
assert.equal(rear.layers.mask,0xffffffff);assert.equal(weapon.layers.mask,1);assert.equal(particle.layers.mask,1);assert.equal(hiddenParticle.layers.mask,1);assert.equal(camera.layers.mask,1);
assert.equal(renderer.autoClear,true);assert.equal(scene.background,'sky');assert.equal(scene.autoUpdate,true);assert.equal(writeMask,255);
assert.throws(()=>api.draw(renderer,scene,camera,()=>{throw new Error('draw failed');},groups,T),/draw failed/);
assert.equal(JSON.stringify([front,back,weaponMaterial,particleMaterial,hiddenParticle.material]),saved);assert.equal(particle.layers.mask,1);assert.equal(camera.layers.mask,1);assert.equal(rear.layers.mask,0xffffffff);
owner.userData.headRelativeBackPlane=null;
assert.equal(api.collect([weapon,melee]).length,0,'switching to melee immediately removes rear masking');
console.log('head-relative weapon owner masks, water bit, and state restoration PASS');
