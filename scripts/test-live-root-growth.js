// Executable unit tests for the independent LiveRootGrowth controller.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  multiplyScalar(k){this.x*=k;this.y*=k;this.z*=k;return this;}
  lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
  distanceToSquared(v){return (v.x-this.x)**2+(v.y-this.y)**2+(v.z-this.z)**2;}
  distanceTo(v){return Math.sqrt(this.distanceToSquared(v));}
  toArray(){return [this.x,this.y,this.z];}
  fromBufferAttribute(attr,i){this.x=attr.getX(i);this.y=attr.getY(i);this.z=attr.getZ(i);return this;}
}
class Group {
  constructor(){this.isObject3D=true;this.children=[];this.userData={};this.position=new Vector3();this.scale=new Vector3(1,1,1);this.quaternion={copy() {return this;}};this.rotation={x:0,y:0,z:0};this.visible=true;this.layers={mask:1,enable(n){this.mask|=(1<<n);},disable(n){this.mask&=~(1<<n);}};}
  add(...children){children.forEach(child=>{child.parent=this;this.children.push(child);});}
  remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null;}
  traverse(fn){fn(this);this.children.forEach(child=>child.traverse(fn));}
  updateWorldMatrix(){}
  localToWorld(v){let node=this;while(node){v.add(node.position);node=node.parent;}return v;}
  worldToLocal(v){let node=this;while(node){v.sub(node.position);node=node.parent;}return v;}
  clone(recursive){
    const result=new this.constructor();
    result.position.copy(this.position);result.scale.copy(this.scale);result.rotation={...this.rotation};result.visible=this.visible;
    result.userData={...this.userData};
    if(recursive)this.children.forEach(child=>result.add(child.clone(true)));
    return result;
  }
}
class Attribute {
  constructor(points){this.points=points;this.count=points.length;}
  getX(i){return this.points[i].x;}getY(i){return this.points[i].y;}getZ(i){return this.points[i].z;}
  setXYZ(i,x,y,z){this.points[i].x=x;this.points[i].y=y;this.points[i].z=z;}
}
class Geometry {
  constructor(points){this.attribute=new Attribute(points||[new Vector3(),new Vector3(1,0,0),new Vector3(0,0,1)]);this.index={count:Math.max(3,this.attribute.count*3)};this.drawRange={start:0,count:Infinity};}
  getAttribute(name){return name==='position'?this.attribute:null;}
  setDrawRange(start,count){this.drawRange={start,count};}
  computeVertexNormals(){}
  dispose(){this.disposed=true;}
}
class PlaneGeometry extends Geometry {}
class TubeGeometry extends Geometry {
  constructor(curve,segments,radius,radial){
    const points=[];
    for(let ring=0;ring<=segments;ring++){
      const p=curve.getPointAt(ring/segments);
      for(let spoke=0;spoke<=radial;spoke++)points.push(p.clone().add(new Vector3(Math.cos(spoke)*radius,0,Math.sin(spoke)*radius)));
    }
    super(points);this.parameters={path:curve};this.index={count:segments*radial*6};
  }
}
class Material {
  constructor(){this.visible=true;}
  clone(){return new Material();}
  dispose(){this.disposed=true;}
}
class Mesh extends Group {
  constructor(geometry=new Geometry(),material=new Material()){
    super();this.isMesh=true;this.geometry=geometry;this.material=material;
  }
  clone(recursive){const c=new Mesh(this.geometry,this.material);c.name=this.name;c.position.copy(this.position);c.scale.copy(this.scale);c.visible=this.visible;c.userData={...this.userData};if(recursive)this.children.forEach(child=>c.add(child.clone(true)));return c;}
}
class Curve {
  constructor(points){this.points=points;}
  getPointAt(t){
    const x=t*(this.points.length-1),i=Math.min(this.points.length-2,Math.floor(x));
    return this.points[i].clone().lerp(this.points[i+1],x-i);
  }
}
const three={Group,Mesh,Vector3,PlaneGeometry,TubeGeometry,MeshBasicMaterial:Material,CatmullRomCurve3:Curve};
function fakeGrowth(parent,recipe){
  const output=new Group();
  const points=recipe.target==='floors'
    ? Array.from({length:40},(_,i)=>new Vector3((i%10-5)*.2,.045,Math.floor(i/10)*.3))
    : Array.from({length:12},(_,i)=>new Vector3(i%3-.8,.6+Math.floor(i/3)*.2,Math.floor(i/3)-1));
  output.add(new Mesh(new Geometry(points),new Material()));
  output.userData.generatedStrands=13;
  output.userData.surfaceGrowthEndpoints=recipe.target==='floors'?[]:[{start:[-.8,.5,-.8],end:[.8,.8,.8]}];
  output.userData.diagnostics='13 wrap strands';
  return output;
}
const calls=[];
const foliage={
  buildSurfaceGrowth(parent,recipe){calls.push({parent,recipe});return fakeGrowth(parent,recipe);},
  normalizeSurfaceGrowth(v){return v;},
  surfaceGrowthDefaults(){return {color:'#424242',texture:'assets/textures/wibbly_surface.png'};}
};
const windowMock={THREE:three,FoliageGenerator:foliage};
vm.runInNewContext(fs.readFileSync('docs/js/live-root-growth.js','utf8'),{window:windowMock,console});
const feature=windowMock.LiveRootGrowth;
assert.equal(feature.version,2);
const normalized=feature.normalizeRecipe({branchCount:Infinity,floorWidth:-2,targetDensity:5,duration:'NaN'});
assert.equal(normalized.branchCount,9);assert.equal(normalized.floorWidth,1);
assert.equal(normalized.targetDensity,5);assert.equal(normalized.duration,0.5);
assert.equal(feature.DEFAULTS.floorDensity,6);
assert.equal(feature.DEFAULTS.targetDensity,6);
assert.equal(feature.normalizeRecipe({targetDensity:100,floorDensity:100}).targetDensity,6);
assert.equal(feature.normalizeRecipe({targetDensity:100,floorDensity:100}).floorDensity,6);
assert.equal(feature.normalizeRecipe({targetDensity:0.1}).targetDensity,0.1);
assert.equal(normalized.arcConcavity,.72,'old recipes inherit the concave default');
assert.equal(feature.normalizeRecipe({arcConcavity:10}).arcConcavity,1);
assert.equal(feature.normalizeRecipe({arcConcavity:-10}).arcConcavity,0);
const input=new Group();input.add(new Mesh(new Geometry(),new Material())); // Caller must retain its original visible source.
const options={target:input,recipe:{seed:'fixed',branchCount:4},THREE:three,foliage};
const first=feature.create(options);
assert.equal(first.branches.length,4);
assert.equal(first.group.children.length,3);
assert.equal(input.children[0].visible,true,'hidden geometry must be cloned');
assert.equal(first.target.children[0].visible,false,'the imported furniture must be hidden');
assert.equal(first.getProgress(),0);
assert.equal(first.getDiagnostics().floorNodesFromWrap,true);
assert.equal(first.getDiagnostics().shapeWrapEndpointPairs,6);
assert.equal(first.getDiagnostics().floorDensityPasses,6);
assert.equal(first.getDiagnostics().shapeDensityPasses,6);
assert.equal(first.getDiagnostics().floorStrands,78);
assert.equal(first.getDiagnostics().shapeStrands,78);
assert.equal(calls.length,12,'six seeded floor Wraps and six seeded furniture Wraps must actually be generated');
assert(calls.every(call=>call.recipe.density===1),'each Wrap pass respects the shared generator density cap');
assert.equal(first.targetGrowth.children.length,6,'all furniture density layers must be retained');
const glbInput=new Group(), glbDriver=new Mesh(new Geometry(),new Material()); // Async GLB owner keeps a non-renderable placeholder geometry.
glbDriver.userData.furnitureGlbPart=true;glbDriver.userData.glbReady=true;glbDriver.userData.authoredPartId='glb-attachment';
glbDriver.position=new Vector3(0,1,0);glbDriver.add(new Mesh(new Geometry(),new Material()));
glbInput.add(glbDriver);
const glbCase=feature.create({...options,target:glbInput});
assert.equal(glbInput.children[0].isMesh,true,'the caller retains its original GLB driver');
assert.equal(glbCase.target.children[0].isMesh,undefined,'the growth clone replaces the placeholder with a group');
assert.equal(glbCase.target.children[0].children[0].isMesh,true,'real GLB child geometry is retained');
assert.equal(glbCase.target.children[0].position.y,1,'the wrapper retains original furniture transforms');
assert.equal(glbCase.target.children[0].userData.authoredPartId,'glb-attachment',
  'GLB-backed furniture keeps its authored particle attachment ID after placeholder removal');
glbCase.dispose();
const glbPending=new Group(),notLoaded=new Mesh(new Geometry(),new Material());
notLoaded.userData.furnitureGlbPart=true;glbPending.add(notLoaded);
assert.throws(()=>feature.create({...options,target:glbPending}),/not finished loading/);
const temple=JSON.parse(fs.readFileSync('docs/config/pieces/temple.json','utf8'));
assert(temple.surfaceGrowth.filter(layer=>layer.kind==='roots').every(layer=>layer.color===feature.TEMPLE_ROOT_FINISH.color && layer.texture===feature.TEMPLE_ROOT_FINISH.texture));
assert.deepEqual(first.rootFinish,feature.TEMPLE_ROOT_FINISH);
assert(calls.every(call=>call.recipe.color===feature.TEMPLE_ROOT_FINISH.color && call.recipe.texture===feature.TEMPLE_ROOT_FINISH.texture));
assert(first.branches.every(branch=>!!(branch.layers.mask&2) && branch.userData.noOutline===false));
assert.deepEqual(calls.slice(0,2).map(x=>x.recipe.style),['wrap','wrap']);
assert.deepEqual(calls.slice(0,2).map(x=>x.recipe.kind),['roots','roots']);
assert.equal(first.branches[0].geometry.drawRange.count,0);
assert(first.targetGrowth.children.every(layer=>layer.children[0].geometry.drawRange.count===0),
  'all target Wrap layers must be hidden at growth start');
const compatibility=feature.create({...options,recipe:{...options.recipe,floorDensity:1,targetDensity:.4}});
assert.equal(compatibility.getDiagnostics().floorDensityPasses,1);
assert.equal(compatibility.getDiagnostics().shapeDensityPasses,1);
compatibility.dispose();
const second=feature.create(options);
const spine = branch => branch.geometry.parameters.path.points; // Authored control points, before the animation draw-range is applied.
assert.deepEqual(first.branches.map(branch=>spine(branch).map(point=>point.toArray())),
  second.branches.map(branch=>spine(branch).map(point=>point.toArray())),
  'identical seeds must reproduce every part of the new concave arc');
let checkedRising = 0; // Verifies that rising branches do not bow above their direct source-to-target chord.
for (const branch of first.branches) {
  const [start,p1,p2,end] = spine(branch);
  const rise = end.y - start.y;
  if (rise <= .01) continue; // Non-rising targets intentionally retain straight-height interpolation.
  checkedRising++;
  assert(p1.y < start.y + rise * .28, 'first control point must stay below its straight-line height');
  assert(p2.y < start.y + rise * .7, 'second control point must stay below its straight-line height');
  assert(p1.y >= start.y && p2.y >= p1.y && p2.y <= end.y,
    'concave path must rise monotonically and not plunge through the floor');
}
assert(checkedRising>0, 'the fixture must exercise branches rising toward furniture');
const straight = feature.create({...options,recipe:{...options.recipe,arcConcavity:0}}); // Zero concavity is the original chord-height control.
for (const branch of straight.branches) {
  const [start,p1,p2,end] = spine(branch),rise=end.y-start.y;
  assert(Math.abs(p1.y - (start.y + rise * .28)) < 1e-8, 'zero concavity restores linear early height');
  assert(Math.abs(p2.y - (start.y + rise * .7)) < 1e-8, 'zero concavity restores linear late height');
}
straight.dispose();
first.extend();
first.update(.25);assert.equal(first.getProgress(),.5,'default growth duration is half a second');
first.setProgress(1);
assert.equal(first.getProgress(),1);
assert(first.branches.every(x=>x.geometry.drawRange.count===x.userData.fullDrawCount));
assert(first.targetGrowth.children.every(layer=>layer.children[0].geometry.drawRange.count===
  layer.children[0].geometry.index.count),'all shape Wrap layers must be revealed on completion');
first.retract();
for(let i=0;i<16;i++)first.update(.25);
assert.equal(first.getProgress(),0);
assert(first.branches.every(x=>x.geometry.drawRange.count===0));
// The authored runtime owns particle simulation; the root controller only gates it
// and duplicates attachment transforms without making the source mesh visible.
const emitterInput=new Group(), emitterPart=new Mesh(new Geometry(),new Material());
emitterPart.position=new Vector3(1,2,3);
emitterPart.userData.authoredPartId='glowing-top';
emitterInput.add(emitterPart);
emitterInput.userData.authoredParticleEmitters=[{id:'sparks',name:'Sparks',attachedPartId:'glowing-top',rate:24,enabled:false}]; // Growth must override an initially disabled authored emitter.
const emitted=[],disposables=[];
const emitterRuntime={createEmitterVisual(host,record){
  const anchor=host.userData.meshById.get(record.attachedPartId);
  assert(anchor,'particle attachment must resolve against the cloned furniture');
  assert(!anchor.isMesh && anchor.visible!==false,'particle anchors cannot be hidden furniture meshes');
  assert.equal(anchor.position.y,2,'authored part offset is retained');
  assert.equal(host.parent?.name,'Live root growth','particle host is not inside the hidden furniture');
  const visual={record,update(delta,active,override){emitted.push({delta,active,enabled:override?.enabled});},dispose(){disposables.push(record.id);}};
  return visual;
}};
const emission=feature.create({...options,target:emitterInput,emitterRuntime});
assert.equal(emission.getDiagnostics().furnitureEmitterCount,1);
assert.equal(emission.getDiagnostics().furnitureEmittersActive,false);
assert.equal(emitterInput.children[0].visible,true,'source furniture remains untouched');
assert.equal(emission.target.children[0].visible,false,'the cloned furniture remains hidden');
emission.extend();
emission.update(.25);
assert.equal(emitted.at(-1).active,false,'particles cannot emit during incomplete growth');
emission.update(.25);
assert.equal(emission.getProgress(),1);
assert.equal(emitted.at(-1).active,true,'emitters must activate precisely when the growth finishes');
assert.equal(emitted.at(-1).enabled,true,'growth completion must override originally disabled emitter flags');
const before=emitted.length;
emission.update(.1);
assert.equal(emitted.length,before+1,'completed emitters must continue updating with animation paused');
assert.equal(emitted.at(-1).active,true);
emission.retract();emission.update(.1);
assert.equal(emitted.at(-1).active,false,'retracting immediately disables new emission');
emission.pause();emission.setProgress(1);emission.update(.1); // Matches the editor scrub behavior: pause animation before seeking.
assert.equal(emitted.at(-1).active,true,'scrubbing to completion also starts effects');
emission.setProgress(0);emission.update(.1);
assert.equal(emitted.at(-1).active,false,'scrubbing below completion stops effects');
emission.dispose();emission.dispose();
assert.deepEqual(disposables,['sparks'],'particle resources are disposed only once');
const scene=new Group();scene.add(first.group); // Disposal must detach from a real scene parent.
const owned=first.branches[0].geometry;first.dispose();first.dispose();
assert.equal(owned.disposed,true);
assert.equal(first.group.parent,null);
assert.throws(()=>feature.create({target:null,THREE:three,foliage}),/furniture group/);
assert.match(fs.readFileSync('docs/tools/index.html','utf8'),/live-root-growth\/index\.html/);
assert.match(fs.readFileSync('docs/tools/live-root-growth/index.html','utf8'),/js\/live-root-growth\.js\?v=[A-Za-z0-9_-]+/);
assert.match(fs.readFileSync('docs/tools/live-root-growth/index.html','utf8'),/id="arcConcavity"/);
assert(fs.readFileSync('docs/tools/live-root-growth/tool.js','utf8').includes("'arcConcavity'"), 'the UI must save and restore arc concavity');
const authorHtml=fs.readFileSync('docs/tools/live-root-growth/index.html','utf8');
assert.match(authorHtml,/id="floorDensity"[^>]*value="6"/);
assert.match(authorHtml,/id="targetDensity"[^>]*value="6"/);
assert.match(authorHtml,/id="duration"[^>]*value="\.5"/);
const authoredIndex=JSON.parse(fs.readFileSync('docs/config/furniture-authored/index.json','utf8'));
assert(authoredIndex.furniture.some(entry=>entry.key==='woodenDoor'));
const editor=fs.readFileSync('docs/tools/live-root-growth/tool.js','utf8');
assert(editor.includes('config/furniture-authored/index.json'));
assert(editor.includes('git/trees/'));
assert(editor.includes('function importRepoFurniture('));
assert(editor.includes('scene.overrideMaterial = shellOutlineMaterial'));
assert(editor.includes('camera.layers.set(1)'));
console.log('Live root growth: wrap reuse, source preservation, deterministic nodes, controls, retraction, disposal and Tools Hub wiring passed.');
