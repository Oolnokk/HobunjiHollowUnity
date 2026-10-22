#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'); // Runs the actual authored-surface composer without WebGL.
const fs=require('node:fs'); // Production source, not a second implementation of placement rules.
const vm=require('node:vm'); // Tiny scene graph adapters isolate recursion and async lifetime behavior.
class Vector { constructor(){this.x=0;this.y=0;this.z=0;} set(x,y,z){Object.assign(this,{x,y,z});return this;} fromArray(a){return this.set(...a);} copy(v){return this.set(v.x,v.y,v.z);} applyMatrix4(){return this;} transformDirection(){return this;} addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;} setScalar(s){return this.set(s,s,s);} }
class Matrix { copy(){return this;} invert(){return this;} multiply(){return this;} compose(){return this;} }
class Group { constructor(){this.children=[];this.userData={};this.position=new Vector();this.scale=new Vector().setScalar(1);this.rotation={set(){}};this.quaternion={};this.matrixWorld=new Matrix();} add(child){child.parent?.remove(child);child.parent=this;this.children.push(child);} remove(child){this.children=this.children.filter(c=>c!==child);child.parent=null;} traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);} updateWorldMatrix(){} }
const data={}; // Authored template library returned by the real loader's fetch boundary.
function template(key,child){return {key,parts:[{id:'top',kind:'box'}],recognizedSurfaces:[{id:'surface',partId:'top',localCentroid:[0,0,0],localNormal:[0,1,0],basisU:[1,0,0],basisV:[0,0,1]}],itemPlacements:child?[{id:'child',furnitureKey:child,surfaceId:'surface',scale:1}]:[]};}
data.parent=template('parent','child');data.child=template('child');data.self=template('self','self');data.a=template('a','b');data.b=template('b','a');data.late=template('late');
let finishLate=null, hooks=0; // A deferred asset request verifies that replacing a surface cancels its old work.
const window={ProceduralFurniture:{buildPartMesh:()=>new Group()}}; // Geometry construction is independent of recursion/placement ownership.
const context={window,THREE:{Group,Vector3:Vector,Matrix4:Matrix,Quaternion:class {}},fetch:url=>url.endsWith('/late.json')?new Promise(resolve=>{finishLate=()=>resolve({ok:true,json:()=>data.late});}):Promise.resolve({ok:true,json:()=>data[url.split('/').pop().replace('.json','')]}),console};
vm.runInNewContext(fs.readFileSync('docs/js/authored-furniture-runtime.js','utf8'),context);
const authored=window.AuthoredFurniture; // Same public API called by furniture previews and gameplay.
const flush=()=>new Promise(resolve=>setImmediate(resolve)); // Completes nested promise chains without a frame loop.
(async()=>{
 const parent=authored.buildGroup(data.parent);await flush();
 const holder=parent.userData.authoredItemPlacements.children[0];
 assert.equal(holder.userData.surfacePlacement.furnitureKey,'child');
 assert.equal(holder.children[0].userData.surfaceFurnitureKey,'child','3D furniture renders with no PNG/canvas dependency');
 assert.equal(holder.children[0].userData.meshById.size,1,'nested model retains its actual authored parts');
 const self=authored.buildGroup(data.self);await flush();assert.equal(self.userData.authoredItemPlacements.children[0].children.length,0,'self containment cannot recurse');
 const cycle=authored.buildGroup(data.a);await flush();
 const b=cycle.userData.authoredItemPlacements.children[0].children[0];
 assert.equal(b.userData.authoredFurnitureKey,'b');assert.equal(b.userData.authoredItemPlacements.children[0].children.length,0,'indirect A/B containment also stops');
 authored.setItemPlacements(parent,data.parent,[{id:'old',furnitureKey:'late',surfaceId:'surface'}]);
 const abandoned=parent.userData.authoredItemPlacements.children[0];
 authored.setItemPlacements(parent,data.parent,[]);finishLate();await flush();
 assert.equal(abandoned.children.length,0,'late asset cannot revive a cleared/replaced surface');
 window.FurnitureVesselRuntime={installed:true};
 window.ProceduralFurniture.buildFurnitureGroup=(key,color)=>{hooks++;return authored.buildGroup(data[key],color);}; // Real VFX/window/seat wrappers retain the original two-argument signature.
 const canonical=authored.buildGroup(data.parent);await flush();
 assert.equal(hooks,1,'nested furniture passes through the shared vessel/VFX build authority');
 assert.equal(canonical.userData.authoredItemPlacements.children[0].children[0].userData.surfaceAncestry.join(','),'parent,child','canonical builders retain cycle protection');
 const wrappedCycle=authored.buildGroup(data.a);await flush();
 const wrappedB=wrappedCycle.userData.authoredItemPlacements.children[0].children[0];
 assert.equal(wrappedB.userData.authoredItemPlacements.children[0].children.length,0,'cycle protection survives legacy canonical wrappers that drop extra arguments');
 console.log('Authored 3D surface furniture, direct/indirect recursion guards, shared builders and async replacement passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
