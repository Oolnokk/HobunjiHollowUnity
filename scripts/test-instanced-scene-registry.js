'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const boundsSource=fs.readFileSync('docs/js/instanced-mesh-bounds.js','utf8');
const outlineSource=fs.readFileSync('docs/js/outline-render-performance.js','utf8');
class Object3D {
  constructor(){this.isObject3D=true;this.parent=null;this.children=[];this.visible=true;this.userData={};}
  add(...objects){for(const object of objects){object.parent?.remove(object);object.parent=this;this.children.push(object);}return this;}
  remove(...objects){for(const object of objects){const i=this.children.indexOf(object);if(i>=0){this.children.splice(i,1);object.parent=null;}}return this;}
  clear(){return this.remove(...this.children.slice());}
  traverse(visit){visit(this);for(const child of this.children)child.traverse(visit);}
}
class Scene extends Object3D {constructor(){super();this.isScene=true;}}
class Instance extends Object3D {constructor(brick=false){super();this.isInstancedMesh=true;this.userData.hobunjiBrickLod=brick;}}
const THREE={Object3D,Scene,Box3:class{},Matrix4:class{}};
const window={THREE};
new Function('window','globalThis','WeakRef',boundsSource)(window,window,WeakRef);
const bounds=window.InstancedMeshBounds;
const begin=outlineSource.indexOf('  function isWorldTextOverlayMaterial(');
const end=outlineSource.indexOf('  function reserveWorldTextOverlayLayer(',begin);
assert(begin>=0 && end>begin);
new Function('window','THREE','performance','WORLD_TEXT_RENDER_ORDER_MIN',outlineSource.slice(begin,end))(window,THREE,{now:()=>0},1200);
window.OutlineRenderPerformance={sceneAttachmentNotifications:THREE.Object3D.prototype.add.__hobunjiStructureEpochWrapped===true};
assert(window.OutlineRenderPerformance.sceneAttachmentNotifications);
const a=new Scene(),b=new Scene();
const parent=new Object3D();a.add(parent);
const brick=bounds.tag(new Instance(true));parent.add(brick);
const grass=bounds.tag(new Instance());a.add(grass);
for(let i=0;i<500;i++)b.add(bounds.tag(new Instance(i%2===0)));
const get=(scene,onlyBricks=false)=>{
  const entries=[];
  (onlyBricks?bounds.forEachTrackedBrickInScene:bounds.forEachTrackedInScene)(scene,(mesh,visible)=>entries.push({mesh,visible}));
  return entries;
};
assert.deepEqual(get(a).map(x=>x.mesh),[brick,grass]);
assert.deepEqual(get(a,true).map(x=>x.mesh),[brick]);
assert.equal(get(b).length,500);
const before=bounds.snapshot();
for(let i=0;i<10;i++)get(a);
assert.equal(bounds.snapshot().scopedVisits-before.scopedVisits,20,'steady active-map scan never visits inactive instances');
assert.equal(bounds.snapshot().initialScans,before.initialScans);
parent.visible=false;
assert.equal(get(a,true)[0].visible,false,'hidden parent does not unregister a brick');
parent.visible=true;
assert.equal(get(a,true)[0].visible,true);
b.add(parent);
assert.equal(get(a,true).length,0);
assert(get(b,true).some(x=>x.mesh===brick),'moving a whole group updates the previously indexed destination');
a.add(parent);
assert.equal(get(a,true).length,1,'returning group is indexed without duplicates');
const detached=new Object3D();
const newBrick=bounds.tag(new Instance(true));detached.add(newBrick);
a.add(detached);
assert(get(a,true).some(x=>x.mesh===newBrick),'tagged detached subtree enrolled on attach');
const late=new Instance(true);a.add(late);bounds.tag(late);bounds.tag(late);
assert.equal(get(a,true).filter(x=>x.mesh===late).length,1);
const replay=bounds.tag(new Instance(true),{track:false});a.add(replay);bounds.tag(replay);
assert(!get(a,true).some(x=>x.mesh===replay),'replay-only registration remains replay-only');
const nested=new Scene();a.add(nested);
const nestedBrick=bounds.tag(new Instance(true));nested.add(nestedBrick);
assert(get(a,true).some(x=>x.mesh===nestedBrick),'nested scene notifications reach outer scene');
a.remove(parent);assert(!get(a,true).some(x=>x.mesh===brick));
a.add(parent);assert(get(a,true).some(x=>x.mesh===brick));
bounds.setSceneScopedEnabled(false);
assert(get(a).length>=500,'disabled mode retains global registry for A/B and older render scopes');
const whileDisabled=bounds.tag(new Instance(true));a.add(whileDisabled);
bounds.setSceneScopedEnabled(true);
assert(get(a,true).some(x=>x.mesh===whileDisabled),'topology kept current while scoped mode disabled');
for(let i=0;i<260;i++){
  const root=new Object3D();root.add(new Object3D());b.add(root);
}
assert(bounds.snapshot().queueOverflows>0,'inactive scene notification backlog is bounded');
const afterOverflow=bounds.tag(new Instance(true));b.add(afterOverflow);
assert(get(b,true).some(x=>x.mesh===afterOverflow),'overflow reindexes exact membership');
a.clear();assert.equal(get(a).length,0);
// Simulate collection of a weak entry before a consumer throws: compaction
// must retain every unread instance and must never duplicate a live one.
{
  const refs=[];
  class TestWeakRef { constructor(object){this.object=object;refs.push(this);} deref(){return this.object;} }
  const host={THREE};
  new Function('window','globalThis','WeakRef',boundsSource)(host,host,TestWeakRef);
  const api=host.InstancedMeshBounds;
  const dead=api.tag(new Instance()),first=api.tag(new Instance()),last=api.tag(new Instance());
  refs.find(ref=>ref.object===dead).object=null;
  assert.throws(()=>api.forEachTracked(mesh=>{assert.equal(mesh,first);throw Error('consumer failed');}),/consumer failed/);
  const live=[];api.forEachTracked(mesh=>live.push(mesh));
  assert.deepEqual(live,[first,last],'failed compaction retains unread entries exactly once');
}
console.log('instanced scene registry: active-map visits, attachments, visibility, reparenting, late tags, overflow and A/B PASS');
