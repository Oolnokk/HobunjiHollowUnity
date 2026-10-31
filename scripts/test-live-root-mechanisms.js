'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Group{constructor(){this.children=[];this.name='';this.parent=null;this.userData={};}traverse(fn){fn(this);for(const child of this.children)child.traverse?child.traverse(fn):fn(child);}updateWorldMatrix(){}add(child){this.children.push(child);child.parent=this;}remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null;}}
const builds=[],floor=new Group();floor.shared=true; // Only the first state may own the flat preview floor.
const context={LiveRootGrowth:{async createAsync(options){
  const index=builds.length,mesh={visible:true,position:[index,2,3]},api={group:new Group(),recipe:{duration:.5,showGuide:false},rootFinish:{color:'#24211d'},target:options.target,floorGrowth:options.growthSource||floor,targetGrowth:new Group(),branches:[],connectors:[],partPlan:[{mesh}],partGrowths:[],emitterVisuals:[],progress:0,disposed:0,
    setProgress(value){this.progress=value;},getProgress(){return this.progress;},update(){},getDiagnostics(){return {progress:this.progress,substrate:options.growthSource?'ruin':'flat',preparedVegetation:!!options.growthSource,floorDensityPasses:6};},dispose(){this.disposed++;}};
  builds.push({options,api});options.onProgress?.({part:'mock',layer:1,layers:1});return api;
}}};vm.createContext(context);vm.runInContext(fs.readFileSync('docs/js/live-root-mechanisms.js','utf8'),context);
const controller=context.LiveRootMechanisms,frames=[{progress:0,state:0},{progress:.22,state:1},{progress:.76,state:1},{progress:1,state:0}]; // The real timed bridge opens, holds, then retracts.
assert.throws(()=>controller.normalizeFrames([{progress:0,state:0},{progress:0,state:1}],2),/ordered/);
assert.throws(()=>controller.normalizeFrames([{progress:0,state:0},{progress:1,state:3}],2),/existing state/);
assert.throws(()=>controller.normalizeFrames([{progress:.1,state:0},{progress:1,state:1}],2),/cover progress/);
assert.deepEqual(Array.from(controller.stateWeights(frames,.5,2)),[0,1],'holds must preserve one complete rooted shape');
assert.deepEqual(Array.from(controller.stateWeights(frames,.11,2)),[.5,.5]);
(async()=>{
 const targets=[{position:[0,0,0]},{position:[4,0,0]}],api=await controller.createAsync({THREE:{Group},states:targets.map(target=>({target})),keyframes:frames,transitionDuration:1});
 assert.equal(builds[0].options.growthSource,undefined);assert.equal(builds[1].options.growthSource,floor,'later poses borrow the first floor');
 api.setProgress(1);api.setPoseProgress(.11);assert.deepEqual(builds.slice(0,2).map(b=>b.api.progress),[.5,.5]);
 api.setPoseProgress(.5);assert.deepEqual(builds.slice(0,2).map(b=>b.api.progress),[0,1]);
 assert.deepEqual(targets.map(target=>target.position),[[0,0,0],[4,0,0]],'transitions must not translate, rotate or scale pose targets');
 api.setPoseProgress(0);api.setPoseTarget(1);const version=api.getRenderVersion();api.update(.25);assert.equal(api.getPoseProgress(),.25);assert(api.getRenderVersion()>version);api.pause();api.update(.25);assert.equal(api.getPoseProgress(),.25,'Pause also freezes the mechanism transition');
 api.setProgress(0);assert(builds.slice(0,2).every(b=>b.api.progress===0));api.extend();api.update(.25);assert.equal(api.getProgress(),.5);
 assert.equal(api.getDiagnostics().substrate,'flat','a borrowed per-state floor must not mislabel the whole preview');
 api.setPoseProgress(1);api.setPoseTarget(1);api.update(.1);assert.equal(api.getPoseProgress(),.1,'a return-to-start sequence can activate again');
 api.setPoseProgress(1);api.setPoseTarget(0);assert.equal(api.getPoseProgress(),0,'reset from the identical end state is immediate');
 api.dispose();api.dispose();assert(builds.slice(0,2).every(b=>b.api.disposed===1),'each generated state is released once');
 const signal={aborted:false},start=builds.length;
 await assert.rejects(controller.createAsync({THREE:{Group},states:targets.map(target=>({target})),keyframes:frames,signal,onProgress(){signal.aborted=true;}}),error=>error.name==='AbortError');
 assert.equal(builds.length,start+1);assert.equal(builds[start].api.disposed,1,'cancelled multi-pose builds must release completed states');
 // Invariant supports are generated once, remain fully grown during pose interpolation,
 // and live until controller disposal (including successful construction).
 class Mesh extends Group{constructor(geometry,material){super();this.isMesh=true;this.geometry=geometry;this.material=material;this.position={};this.quaternion={};this.scale={};this.matrixWorld={elements:[0],decompose(){}};}}
 const geometry={},guide=(offset)=>{const group=new Group(),support=new Mesh(geometry,{}),panel=new Mesh(geometry,{});support.userData.authoredPartId='arch';panel.userData.authoredPartId='panel';panel.matrixWorld.elements=[offset];group.add(support);group.add(panel);return {target:group};};
 const supportsStart=builds.length,supported=await controller.createAsync({THREE:{Group,Mesh},states:[guide(1),guide(2)],keyframes:[{progress:0,state:0},{progress:1,state:1}],progress:1});
 assert.equal(builds.length-supportsStart,3);assert.equal(supported.commonState.disposed,0,'successful creation retains shared supports');
 supported.setPoseProgress(.5);assert.equal(supported.commonState.getProgress(),1);assert.deepEqual(Array.from(supported.states,s=>s.getProgress()),[.5,.5]);
 assert.equal(supported.commonState.target.children.length,1);assert.equal(supported.states[0].target.children.length,1);assert.equal(supported.getDiagnostics().mechanism.staticParts,1);
 const renderVersion=supported.getRenderVersion();supported.setProgress(.1);assert(supported.getRenderVersion()>renderVersion,'support-only growth invalidates rendering');
 supported.dispose();supported.dispose();assert(builds.slice(supportsStart).every(b=>b.api.disposed===1));
 const supportSignal={aborted:false},cancelStart=builds.length;
 await assert.rejects(controller.createAsync({THREE:{Group,Mesh},states:[guide(1),guide(2)],keyframes:[{progress:0,state:0},{progress:1,state:1}],signal:supportSignal,onProgress(){supportSignal.aborted=true;}}),e=>e.name==='AbortError');
 assert.equal(builds.length,cancelStart+1);assert.equal(builds[cancelStart].api.disposed,1,'cancelled supports are released');
 console.log('Root mechanisms: keyframe validation, growth-only interpolation, hold reuse, shared floors, static guide transforms, activation timing, pause, reset and cancellation ownership passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
