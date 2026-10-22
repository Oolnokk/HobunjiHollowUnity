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
const weapon = { isMesh:true,parent:owner,userData:{},layers:layers(),material:weaponMaterial }; // Registered weapon under that holder.
const melee = { isMesh:true,parent:{userData:{}},userData:{},layers:layers(),material:material() }; // An unrelated melee weapon may not enter any head mask.
const groups = api.collect([weapon,melee]); // Uses only the small existing held list.
assert.equal(groups.length,1);assert.equal(groups[0].rear,rear);assert.equal(groups[0].weapons.length,1);
const saved = JSON.stringify([front,back,weaponMaterial]); // Before-image for exception-safe restoration checks.
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
    assert.equal(camera.layers.mask,1<<25);assert.equal(weaponMaterial.stencilFunc,T.EqualStencilFunc);
    assert.equal(weaponMaterial.stencilRef & weaponMaterial.stencilFuncMask,0);
    assert.equal(weaponMaterial.stencilWriteMask,1,'visible head weapons stamp the existing water bit');
    assert.equal(weaponMaterial.depthTest,true);
  }
}
api.draw(renderer,scene,camera,draw,groups,T,true);
assert.equal(pass,2);assert.equal(JSON.stringify([front,back,weaponMaterial]),saved);
assert.equal(rear.layers.mask,1);assert.equal(weapon.layers.mask,1);assert.equal(camera.layers.mask,1);
assert.equal(renderer.autoClear,true);assert.equal(scene.background,'sky');assert.equal(scene.autoUpdate,true);assert.equal(writeMask,255);
assert.throws(()=>api.draw(renderer,scene,camera,()=>{throw new Error('draw failed');},groups,T),/draw failed/);
assert.equal(JSON.stringify([front,back,weaponMaterial]),saved);assert.equal(camera.layers.mask,1);assert.equal(rear.layers.mask,1);
owner.userData.headRelativeBackPlane=null;
assert.equal(api.collect([weapon,melee]).length,0,'switching to melee immediately removes rear masking');
console.log('head-relative weapon owner masks, water bit, and state restoration PASS');
