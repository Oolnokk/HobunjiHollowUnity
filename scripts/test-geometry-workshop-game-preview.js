'use strict';
// Integration contract for the Geometry Workshop gameplay renderer.
// The adapter is exercised with a fake canvas/renderer to verify that the
// overlay/shell passes do not clobber the source model or sibling viewport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const docs = path.join(__dirname, '..', 'docs');
const js = fs.readFileSync(path.join(docs, 'tools/geometry-workshop/game-preview.js'), 'utf8');
const sourceData = fs.readFileSync(path.join(docs, 'tools/enemy-loadout-editor/source-data.js'), 'utf8');
const shell = fs.readFileSync(path.join(docs, 'tools/geometry-workshop/index.html'), 'utf8');
const workshop = fs.readFileSync(path.join(docs, 'tools/geometry-workshop/workshop.js'), 'utf8');
const css = fs.readFileSync(path.join(docs, 'tools/geometry-workshop/workshop.css'), 'utf8');
assert.match(sourceData, /function renderingFromGame\(game\)/, 'the game renderer extractor must be shared, not duplicated in the Geometry Workshop');
assert.match(sourceData, /const \{ makeShellMaterial, makeLighting, applyLighting \} = renderingFromGame\(game\)/);
assert.match(shell, /tools\/enemy-loadout-editor\/source-data\.js\?v=/);
assert.match(shell, /tools\/geometry-workshop\/game-preview\.js\?v=/);
assert.match(shell, /js\/weather-fx\.js\?v=/);
assert.match(shell, /js\/natural-surface-materials\.js\?v=/);
for (const id of ['game-lighting','game-surfaces','sample-body-color','game-render-status','show-shell','mesh-integrity']) assert.match(shell, new RegExp('id="' + id + '"'));
assert.match(css, /workshop-lighting-overlay.*pointer-events:none/);
assert.match(workshop, /renderer\.outputEncoding = T\.LinearEncoding/);
assert.doesNotMatch(workshop, /renderer\.outputEncoding = T\.sRGBEncoding/);
assert.match(workshop, /renderPreview\.render\(w, h\)/, 'game parity draw must use logical pixel dimensions');
assert.match(workshop, /displayOriginal = addDisplay\(sceneA, original\)/);
assert.match(workshop, /displayCandidate = addDisplay\(sceneB, candidate\)/);

let tintCalls = 0, applied = 0, skyCalls = 0;
class FakeMaterial {
  constructor(name = 'Mat 1') { this.name = name; this.color = { value: '#ffffff' }; this.opacity = 1; this.transparent = false; this.alphaTest = 0; }
  clone() { return Object.assign(new FakeMaterial(this.name), this); }
  dispose() { this.disposed = true; }
}
class FakeGeometry {
  constructor() { this.attributes = { position:{count:4},normal:{count:4} }; this.disposed = false; }
  getAttribute(name) { return this.attributes[name]; }
  clone() { return new FakeGeometry(); }
  dispose() { this.disposed = true; }
}
class FakeMesh {
  constructor(geometry, material) { this.isMesh = true; this.geometry = geometry; this.material = material; this.userData = {}; this.layers = {mask:1,enable(n){this.mask |= 1<<n},disable(n){this.mask &= ~(1<<n)}}; }
  clone() { return new FakeMesh(this.geometry, this.material); }
}
const originalGeo = new FakeGeometry();
const originalMat = new FakeMaterial('Mat 1');
const originalRoot = {
  name:'Original hand', userData:{}, children:[new FakeMesh(originalGeo,originalMat)],
  clone() {
    const meshes = this.children.map(mesh=>mesh.clone());
    return {name:this.name,userData:{},children:meshes,traverse(fn){for(const mesh of meshes)fn(mesh);}};
  }
};
const fakeWindow = {
  THREE: {
    Mesh:FakeMesh, BufferAttribute: class { constructor(array,size){this.array=array;this.itemSize=size;} },
    MeshBasicMaterial: FakeMaterial, FogExp2:class{constructor(color,density){this.color=color;this.density=density}},
    Color:class{constructor(value){this.value=value}}, LinearEncoding:3000, NoToneMapping:0, PCFSoftShadowMap:2,
  },
  WeatherFX: {
    lightingStateFor(hour,options){return {hour,...options,r:255,g:245,b:210,a:0.04};},
    drawSkyTint(ctx,w,h,state){assert.equal(state.hour,12);skyCalls++;},
  },
  EnemyLoadoutSourceData:{
    renderingFromGame(content) {
      assert.equal(content, 'game shader and lighting source');
      return {
        makeShellMaterial(){return {uniforms:{uThickness:{value:0}},dispose(){}};},
        makeLighting(THREE,scene){return {ambientLight:{},sunLight:{},hemiLight:{}};},
        applyLighting(scene,ambient,sun,state){applied++;assert.equal(state.hour,12);},
      };
    },
  },
  HobunjiHandModelProfiles:{data:{models:{feline:{glb:'assets/models/hands/hand_feline.glb',materialRoles:{'Mat 1':'body'}}},colors:{bone:'#d8c7a3'}}},
  NaturalSurfaceMaterials:{
    naturalizeMesh(proxy,surface,mapping,options){
      assert.equal(surface,'trunks');
      assert.equal(mapping,'authored-stretch-fit');
      assert.equal(options.texture,'assets/textures/wavy_surface.png');
      tintCalls++;
      proxy.material = new FakeMaterial('game-surface');
    },
  },
  devicePixelRatio:1,
};
fakeWindow.window = fakeWindow;
const ctx={
  save(){},restore(){},beginPath(){},rect(){},clip(){},translate(){},setTransform(){},clearRect(){},
};
const overlay={width:0,height:0,style:{},className:'',setAttribute(){},getContext(){return ctx;},remove(){this.removed=true;}};
const fakeDocument={createElement(tag){assert.equal(tag,'canvas');return overlay;}};
const fakeHost={clientWidth:400,clientHeight:300,appendChild(child){this.child=child;}};
const fakeFetch=async url=>url==='game.js'?{ok:true,text:async()=> 'game shader and lighting source'}:
  {ok:true,json:async()=>({shell:{thicknessNdc:0.006}})};
vm.runInNewContext(js,{window:fakeWindow,document:fakeDocument,fetch:fakeFetch,console,Error,Number,Object,Math,Set,WeakSet,Map});
const adapter=fakeWindow.GeometryWorkshopGamePreview;
const display=adapter.decorate(originalRoot,'assets/models/hands/hand_feline.glb',true,'#7dc89a');
assert.notEqual(display.children[0].geometry, originalGeo, 'display UV changes must not modify the exported GLB geometry');
assert.notEqual(display.children[0].material, originalMat, 'game preview shaders/textures must not modify export materials');
assert.equal(originalRoot.children[0].material, originalMat);
assert.equal(originalRoot.children[0].geometry, originalGeo);
assert.equal(tintCalls,1);
assert.ok(display.children[0].layers.mask&(1<<1),'3D model joins shell outline layer');
const scene = label => ({name:label,overrideMaterial:null,background:null,fog:null,children:[],add(value){this.children.push(value)},remove(){}});
const scenes=[scene('left'),scene('right')];
const camera={layers:{mask:1,set(value){this.mask=1<<value}}};
const frames=[],clear=[];
const renderer={
  autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,
  shadowMap:{enabled:false,type:0},
  setScissorTest(value){this.scissor=value;},
  setViewport(...args){this.viewport=args;},
  setScissor(...args){this.scissorRect=args;},
  clear(...args){clear.push({viewport:this.viewport,...args})},
  render(scene,camera){
    // Three.js r128 forcibly clears when Scene.background is a Color, regardless
    // of renderer.autoClear; that's the original black-hand regression.
    if (scene.background) this.forcedBackgroundClears = (this.forcedBackgroundClears || 0) + 1;
    frames.push({scene:scene.name,shader:!!scene.overrideMaterial,mask:camera.layers.mask,
      backgroundActive:!!scene.background,viewport:this.viewport.slice()});
  },
};
const statuses=[];
(async () => {
  const preview=adapter.build(renderer,scenes,camera,fakeHost,(s,error)=>statuses.push([s,error]));
  assert.equal(await preview.init(),true);
  assert.equal(preview.ready,true);
  assert.equal(renderer.outputEncoding,fakeWindow.THREE.LinearEncoding);
  assert.equal(applied,2,'both sides get identical game lighting');
  preview.render(400,300);
  assert.equal(clear.length,2,'each side owns an independent color and depth clear');
  assert.deepEqual(frames.map(f=>[f.scene,f.shader,f.mask]),[
    ['left',false,1],['left',true,2],['right',false,1],['right',true,2],
  ]);
  assert.deepEqual(frames.map(f=>f.backgroundActive),[true,false,true,false],
    'shell pass must NOT re-render a Color background and wipe the base color/depth');
  assert.equal(renderer.forcedBackgroundClears,2,'only one forced Color background clear per viewport');
  assert.deepEqual(frames[0].viewport,[0,0,200,300]);
  assert.deepEqual(frames[2].viewport,[200,0,200,300]);
  assert.equal(camera.layers.mask,1,'camera layers restored after shell pass');
  assert.equal(scenes[0].overrideMaterial,null,'temporary shell override restored');
  assert.equal(renderer.autoClear,true,'renderer clear state restored');
  assert.equal(renderer.scissor,false,'scissor state restored');
  assert.equal(skyCalls,2,'same WeatherFX sky tint on each side');
  preview.setShellEnabled(false); // Inspect true surfaces without black shell; should not change source geometry.
  const priorFrameCount = frames.length;
  preview.render(400,300);
  assert.deepEqual(frames.slice(priorFrameCount).map(f=>f.shader),[false,false], 'no shader pass with outlines disabled');
  assert.equal(camera.layers.mask,1);
  preview.setShellEnabled(true);
  preview.render(400,300);
  assert.deepEqual(frames.slice(-2).map(f=>f.backgroundActive),[true,false], 're-enabled shell still preserves background state');
  // Verify the real shipped hand, not just a synthetic mesh. It has six
  // individually closed lobes; apparent gray slits in the old screenshot were
  // created by the second render clearing the first-pass depth.
  const glb=fs.readFileSync(path.join(docs,'assets/models/hands/hand_feline.glb'));
  const jsonBytes=glb.readUInt32LE(12);
  const model=JSON.parse(glb.subarray(20,20+jsonBytes).toString('utf8'));
  const bin=20+jsonBytes+8, accessors=model.accessors, views=model.bufferViews;
  const positionAccessor=accessors[0], positionView=views[positionAccessor.bufferView];
  const indexAccessor=accessors[2], indexView=views[indexAccessor.bufferView];
  const getPosition=(i,d)=>glb.readFloatLE(bin+positionView.byteOffset+i*12+d*4);
  const shippedMesh={
    isMesh:true,
    geometry:{
      getAttribute(name){return name==='position'?{
        count:positionAccessor.count, getX:i=>getPosition(i,0),getY:i=>getPosition(i,1),getZ:i=>getPosition(i,2),
      }:null;},
      getIndex(){return {count:indexAccessor.count,getX:i=>glb.readUInt16LE(bin+indexView.byteOffset+i*2)};},
    },
  };
  const integrity=adapter.inspectMeshIntegrity({traverse(fn){fn(shippedMesh);}});
  assert.equal(integrity.triangles,3120);
  assert.equal(integrity.components,6);
  assert.equal(integrity.boundaryEdges,0,'feline GLB has no actual missing polygon faces');
  assert.equal(integrity.nonManifoldEdges,0);
  assert.match(adapter.topologyDescription(integrity),/closed/);
  // An open tetrahedron genuinely reports its missing face (3 border edges).
  const vertices=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]];
  const triangleIndices=[0,2,1, 0,1,3, 0,3,2]; // Only three of four tetra faces.
  const synthetic={isMesh:true,geometry:{
    getAttribute(name){return name==='position'?{
      count:vertices.length,getX:i=>vertices[i][0],getY:i=>vertices[i][1],getZ:i=>vertices[i][2],
    }:null;},
    getIndex(){return {count:triangleIndices.length,getX:i=>triangleIndices[i]};},
  }};
  const missingFace=adapter.inspectMeshIntegrity({traverse(fn){fn(synthetic);}});
  assert.equal(missingFace.boundaryEdges,3,'genuinely missing triangle face detected');
  assert.equal(missingFace.components,1);
  adapter.disposeDisplay(scenes[0],display);
  assert.equal(originalGeo.disposed,false,'disposing a preview must not dispose source geometry');
  preview.dispose();
  assert.ok(overlay.removed);

  for (const file of ['tools/geometry-workshop/game-preview.js','tools/geometry-workshop/workshop.js','tools/enemy-loadout-editor/source-data.js']) {
    execFileSync(process.execPath,['--check',path.join(docs,file)],{stdio:'pipe'});
  }
  console.log('Geometry Workshop game render: source shader, PNG material isolation, weather, split scissor + shell passes OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
