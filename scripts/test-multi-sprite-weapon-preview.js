'use strict';
// node scripts/test-multi-sprite-weapon-preview.js
// Head and full-assembly auto-fit guard for off-screen long chains on mobile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/preview-renderer.js','utf8'); // Actual renderer used by Tool Hub.
const author = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/app.js','utf8'); // Checks that both preview modes are driven from one RAF.
const html = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/index.html','utf8'); // Tests independently mounted preview panels.
const registrySource = fs.readFileSync('docs/config/weapon-sprite-assemblies.js','utf8'); // Production flail layer recipe and contact defaults.
new Function(script); new Function(author);
assert.match(html, /id="headPreview"/);
assert.match(html, /id="preview"/);
assert.match(html, /id="soloLayer"/);
assert.match(html, /preview-renderer\.js\?v=/);
assert.match(author, /drawCanvas\(\$\('headPreview'\), 'head'/);
assert.match(author, /drawCanvas\(\$\('preview'\), 'combined'/);
assert.match(author, /renderer\.debugSnapshot\(\)|Renderer\?\.debugSnapshot\(\)/); // Mobile diagnostics include measured bounds.

function image(name, width, height, opaquePoints) {
  const rgba = new Uint8ClampedArray(width*height*4);
  for (const [x,y] of opaquePoints) {
    const idx = (y*width+x)*4;
    rgba[idx]=90;rgba[idx+1]=132;rgba[idx+2]=128;rgba[idx+3]=255;
  }
  return {name,width,height,rgba};
}
const pngs = {
  'hachutu_torch-flail_handle.png': image('shaft',512,512,[[250,180],[250,320]]),
  'hachutu_torch-flail_chain.png': image('chain',32,1050,[[16,20],[16,1030]]),
  'torch-flail_brazier-back.png': image('back',260,300,[[100,80],[130,220]]),
  'torch-flail_brazier-handle.png': image('handle',270,300,[[130,40],[130,280]]),
  'torch-flail_brazier-fuel.png': image('fuel',280,300,[[160,110],[163,130]]),
  'torch-flail_brazier-front.png': image('front',260,320,[[100,60],[150,260]]),
}; // Deliberately enormous 1,050px chain and different-sized transparent head images.

const document = {
  createElement(tag) {
    assert.equal(tag,'canvas');
    return {
      width:0,height:0,
      getContext() {
        return {
          drawImage(img) { this.current = img; },
          getImageData() {return {data:this.current.rgba};},
        };
      },
    };
  },
};
const window = {devicePixelRatio:2};
vm.runInNewContext(script,{window,document,Math});
vm.runInNewContext(registrySource,{window});
const renderer=window.HobunjiMultiSpritePreviewRenderer;
assert.ok(renderer);
const recipe=window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.hachutuTorchFlail;
const lookup=path=>pngs[String(path).split('/').pop()]||null;

function assertFitted(bounds,viewWidth,viewHeight) {
  const f=renderer.fit(bounds,viewWidth,viewHeight);
  const eps=1e-6;
  assert.ok(f.zoom>0 && Number.isFinite(f.zoom));
  assert.ok(bounds.minX*f.zoom+f.x>=-eps, 'left of assembled opaque pixels is not clipped');
  assert.ok(bounds.maxX*f.zoom+f.x<=viewWidth+eps, 'right of assembled opaque pixels is not clipped');
  assert.ok(bounds.minY*f.zoom+f.y>=-eps, 'top of assembled opaque pixels is not clipped');
  assert.ok(bounds.maxY*f.zoom+f.y<=viewHeight+eps, 'bottom of assembled opaque pixels is not clipped');
  return f;
}
for (const t of [0,0.12,0.25,0.5,0.68,0.95]) {
  const model=renderer.modelFor(recipe,lookup,t,1500);
  assert.ok(model.headOrigin && model.headPosition);
  assert.ok(Math.hypot(model.headPosition.x-model.pivot.x, model.headPosition.y-model.pivot.y)>300,
    'approved shorter chain still spans more than 300 handle pixels throughout the swing');
  const full=renderer.boundsFor(model,lookup,'combined');
  const detail=renderer.boundsFor(model,lookup,'head');
  assert.ok(full.maxY>model.headPosition.y-200,'combined view measures the brazier, not just the haft');
  assert.ok(detail.maxY-detail.minY>100,'head close-up measures the actual brazier art');
  assertFitted(full,340,275); // Mobile portrait full assembly canvas.
  assertFitted(detail,340,210); // Mobile portrait head canvas.
  assertFitted(full,960,430); // Desktop.
  assertFitted(detail,960,360);
}
const model=renderer.modelFor(recipe,lookup,.25,1500); // Pure fit fixtures above remain useful; live rendering below delegates to the real gameplay owner.
assert(renderer.fireReach(model) > 2, '0.4-world-unit fire inherits 2.5x head scale, rather than an arbitrary 2D pixel radius');
class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);} set(x,y,z){Object.assign(this,{x,y,z});return this;} copy(v){return this.set(v.x,v.y,v.z);} add(v){return this.set(this.x+v.x,this.y+v.y,this.z+v.z);} sub(v){return this.set(this.x-v.x,this.y-v.y,this.z-v.z);} length(){return Math.hypot(this.x,this.y,this.z);} distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);} applyMatrix4(){return this;}
}
class Box3 {
  constructor(){this.min=new Vector3();this.max=new Vector3();this.makeEmpty();} makeEmpty(){this.min.set(Infinity,Infinity,Infinity);this.max.set(-Infinity,-Infinity,-Infinity);return this;} expandByPoint(v){for(const axis of ['x','y','z']){this.min[axis]=Math.min(this.min[axis],v[axis]);this.max[axis]=Math.max(this.max[axis],v[axis]);}return this;} isEmpty(){return this.min.x>this.max.x;} getCenter(v){return v.set((this.min.x+this.max.x)/2,(this.min.y+this.max.y)/2,(this.min.z+this.max.z)/2);} getSize(v){return v.copy(this.max).sub(this.min);}
}
class Group {
  constructor(){this.children=[];this.userData={};this.visible=true;this.position=new Vector3();this.rotation={set(){}};this.matrixWorld={};} add(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}return this;} remove(node){this.children=this.children.filter(child=>child!==node);} traverse(fn){fn(this);for(const node of this.children)node.traverse?.(fn);} updateMatrixWorld(){}
}
class Mesh extends Group {constructor(geometry,material){super();Object.assign(this,{isMesh:true,geometry,material});}}
const renders=[], clocks=[], decorated=[]; // Observe actual production controller calls, rather than implementing replacement physics or emitters.
let drops=0, currentRoot=null; // Detect unintended frame-by-frame rebuilds and resource leaks.
window.THREE={Vector3,Box3,Scene:Group,Group,Mesh,Color:class{},HemisphereLight:class{},DoubleSide:2,
  PlaneGeometry:class{constructor(width,height){this.parameters={width,height};}dispose(){}},
  PerspectiveCamera:class{constructor(fov,aspect){Object.assign(this,{fov,aspect,position:new Vector3()});}updateProjectionMatrix(){}},
  OrbitControls:class{constructor(){this.target=new Vector3();}update(){}},
  WebGLRenderer:class{constructor({canvas}){this.canvas=canvas;}setPixelRatio(){}setSize(){}render(scene){renders.push({canvas:this.canvas.id,root:currentRoot,visible:currentRoot.children.filter(child=>child.visible).map(child=>child.name),head:currentRoot.children.find(child=>child.name?.endsWith('_flail_head'))?.children.filter(child=>child.visible).map(child=>child.name)});}},
};
window.HobunjiSpritePngSurface={makeCanvasTexture(_THREE,image){return{image,dispose(){}};},makeMaterial(_THREE,map){return{map,dispose(){}};}};
window.SharedAttackPose={fourPhaseLerp(){return 0;}};
window.HobunjiWeaponSpriteAssemblies={
  decorate(root,key,def){
    decorated.push(def.weaponAssembly);currentRoot=root;root.userData.toolPlane.name='haft';
    const head=new Group();head.name=key+'_flail_head';
    for(const part of def.weaponAssembly.flail.head.layers){const mesh=new Mesh(new window.THREE.PlaneGeometry(.2,.3),{map:{image:lookup(part.sprite)}});mesh.name=part.id;mesh.userData.hobunjiWeaponAssemblyPart=true;head.add(mesh);}
    const fire=new Group();fire.name='weapon_interleaved_fire_fuel';fire.userData.weaponInterleavedVfx=true;head.add(fire);root.add(head);
  },
  setAction(){},tick(dt,freeze){clocks.push({dt,freeze});},drop(){drops++;},debugSnapshot(){return[];},
};
const options={dt:1/60,playing:true,weaponKey:'hachutuTorchFlail',revision:0,stackTarget:'head',solo:false,selected:2}; // The same options sent by app.js's one RAF.
const headCanvas={id:'head',clientWidth:330,clientHeight:240}, fullCanvas={id:'combined',clientWidth:330,clientHeight:240};
renderer.beginFrame(model,lookup,part=>lookup(part.sprite),options);
renderer.drawCanvas(headCanvas,'head',model,lookup,null,options);
renderer.drawCanvas(fullCanvas,'combined',model,lookup,null,options);
assert.equal(decorated.length,1,'both 3D cameras share a single gameplay assembly');
assert.strictEqual(decorated[0],recipe,'the exact live recipe reaches gameplay assembly/effect construction');
assert.strictEqual(renders[0].root,renders[1].root,'both panes render the exact same live particle scene');
assert.deepEqual(renders[0].visible,['hachutuTorchFlail_flail_head'],'detail hides haft and chain without removing the head');
assert.deepEqual(renders[1].visible,['haft','hachutuTorchFlail_flail_head'],'combined visibility is restored');
renderer.drawCanvas(headCanvas,'head',model,lookup,null,{...options,solo:true});
assert.deepEqual(renders.at(-1).head,['fuel','weapon_interleaved_fire_fuel'],'solo preserves the selected fuel and its real emitter');
renderer.drawCanvas(fullCanvas,'combined',model,lookup,null,options);
assert.equal(renders.at(-1).head.length,5,'soloing cannot remove layers/effects from the combined pane');
const count=clocks.length; // Only the controller advances particle time; rendering both cameras adds no second clock tick.
renderer.beginFrame(model,lookup,part=>lookup(part.sprite),{...options,playing:false});
assert.equal(clocks.length,count+1,'a paused frame avoids replay when the timeline did not change');
assert.deepEqual(clocks.at(-1),{dt:1/60,freeze:true},'paused motion freezes physics while actual particles remain live');
assert.equal(decorated.length,1,'unchanged frames retain meshes and particle pools');
renderer.beginFrame(model,lookup,part=>lookup(part.sprite),{...options,revision:1});
assert.equal(decorated.length,2);assert.equal(drops,1,'recipe edits dispose the old assembly before rebuilding');
assert.equal(renderer.debugSnapshot().renderer,'shared-gameplay-3d');
assert(renderer.debugSnapshot().combined.cameraDistance>0);
renderer.resetEffects();
console.log('multi-sprite weapon preview: PASS (3D gameplay delegation, shared particles, solo isolation, physical scale, mobile bounds, pause and rebuild lifecycle)');
