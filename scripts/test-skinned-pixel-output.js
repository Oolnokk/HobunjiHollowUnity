'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'); // Exercises both production source-pixel resolvers with independent affine math.
let vectorAllocations = 0; // Repeated caller-owned output queries must not allocate vectors after warmup.
class Vector3 {
  constructor(x=0,y=0,z=0){vectorAllocations++;this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  clone(){return new Vector3(this.x,this.y,this.z);}
  applyMatrix4(m){return this.set(this.x*m.sx+m.tx,this.y*m.sy+m.ty,this.z*m.sz+m.tz);}
  addScaledVector(v,w){this.x+=v.x*w;this.y+=v.y*w;this.z+=v.z*w;return this;}
}
class Matrix4 {
  constructor(sx=1,sy=1,sz=1,tx=0,ty=0,tz=0){Object.assign(this,{sx,sy,sz,tx,ty,tz});}
  clone(){return new Matrix4(this.sx,this.sy,this.sz,this.tx,this.ty,this.tz);}
  fromArray(a,i){Object.assign(this,{sx:a[i],sy:a[i+5],sz:a[i+10],tx:a[i+12],ty:a[i+13],tz:a[i+14]});return this;}
}
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; // Root and neck keep their bind-space points unchanged.
const scaleHead = [2,0,0,0,0,3,0,0,0,0,1,0,.1,-.2,0,1]; // Distinct head scale and offset make neck-only sampling visibly wrong.
const plane = {isSkinnedMesh:true,geometry:{userData:{blendHeight:.6}},bindMatrix:new Matrix4(1,1,1,4,5,0),bindMatrixInverse:new Matrix4(1,1,1,-4,-5,0),skeleton:{bones:[{},{},{}],boneMatrices:[...identity,...identity,...scaleHead],update(){}},updateMatrixWorld(){assert.equal(ancestorsFresh,true);},localToWorld(p){p.x+=10;p.y+=20;p.z+=30;return p;}}; // Nonidentity bind/world transforms detect accidental double world application.
let ancestorsFresh = false; // A head pose can be queried before Three's normal world render updates its parents.
const avatar = {userData:{portraitModelWidth:2,portraitModelHeight:2,sourceCanvas:{width:100,height:100},neckRig:{available:true,skinnedPlane:plane,neckLocal:{y:0},headScaleJoint:{}}},updateWorldMatrix(){ancestorsFresh=true;},updateMatrixWorld(){}}; // Minimal canonical PNG rig with the separate head-scale bone.
const THREE = {Vector3,Matrix4}; // Only the math used by this production pixel path is required.
const sandbox = {window:{THREE},THREE,localStorage:{getItem(){return null;},setItem(){}}}; // Runs the base module, then its gameplay parity adapter, in one realm.
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('docs/js/png-plane-avatar.js','utf8'),sandbox);
function exercise(label){
  const api=sandbox.window.PNGPlaneAvatar, out=new Vector3(), pixel={x:25,y:25}; // Asymmetric source X verifies the current portrait-mirroring setting.
  api.setPortraitsFlipped(true);ancestorsFresh=false;
  assert.equal(api.resolveSkinnedPixelWorldPosition(avatar,pixel,out),out,label+' returns its caller-owned output');
  assert(Math.abs(out.x-15.1)<1e-9 && Math.abs(out.y-31.3)<1e-9 && out.z===30,label+' applies bind, head compensation and world placement exactly once');
  const allocations=vectorAllocations; // After warmup the four internal vectors are reused.
  for(let i=0;i<20;i++){ancestorsFresh=false;api.resolveSkinnedPixelWorldPosition(avatar,pixel,out);}
  assert.equal(vectorAllocations,allocations,label+' has no per-query vector allocation');
  const independent=api.resolveSkinnedPixelWorldPosition(avatar,pixel); // Legacy callers still receive an independent result.
  api.setPortraitsFlipped(false);api.resolveSkinnedPixelWorldPosition(avatar,pixel,out);
  assert(Math.abs(out.x-13.1)<1e-9,label+' follows portrait flip changes');
  assert(Math.abs(independent.x-15.1)<1e-9,label+' never exposes shared scratch as a returned result');
  api.setPortraitsFlipped(true);api.resolveSkinnedPixelWorldPosition(avatar,{x:50,y:50},out);
  assert(Math.abs(out.x-12.356475)<1e-9 && Math.abs(out.y-25.63255)<1e-9,label+' blends torso/neck/head weights rather than assuming a rigid head');
}
exercise('base resolver');
vm.runInContext(fs.readFileSync('docs/js/portrait-plane-outline-parity.js','utf8'),sandbox);
exercise('game parity resolver');
console.log('skinned pixel output: bind/world parity, mirrored weighted heads, ancestor refresh and vector reuse PASS');
