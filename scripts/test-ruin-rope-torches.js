#!/usr/bin/env node
'use strict';
// Regression: ruin bob carries the real Hachutu head recipe, shared fire, cheap halo and proper teardown.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Production code, not an alternate torch implementation.
const html = read('docs/index.html');
const simple = read('docs/js/dev-random-ruin-simple-puzzles.js');
const source = read('docs/js/ruin-rope-torches.js');
new Function(source);
assert(html.includes('js/ruin-rope-torches.js?') && html.indexOf('js/weapon-layer-effects.js?') < html.indexOf('js/ruin-rope-torches.js?'));
assert.match(simple, /RuinRopeTorch\?\.attach\?\.\(marker\)/);
assert.match(simple, /RuinRopeTorch\?\.tick\?\.\(rope\.torch,dt,ropeCamera\)/);
assert.match(simple, /RuinRopeTorch\?\.dispose\?\.\(rope\?\.torch\)/);
assert.match(simple, /for \(const rope of state\.ropes\) window\.RuinRopeTorch\?\.dispose\?\.\(rope\.torch\)/);

class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z)}
  set(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;return this}
  setScalar(v){return this.set(v,v,v)}
  copy(v){return this.set(v.x,v.y,v.z)}
  sub(v){return this.set(this.x-v.x,this.y-v.y,this.z-v.z)}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}
  normalize(){const n=Math.sqrt(this.lengthSq())||1;return this.set(this.x/n,this.y/n,this.z/n)}
  crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x)}
  distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2}
}
class Object3D {
  constructor(){
    this.children=[];this.parent=null;this.position=new Vector3();this.scale=new Vector3(1,1,1);
    this.visible=true;this.userData={};
    this.quaternion={setFromRotationMatrix(matrix){this.lastBasis=matrix.axes}};
  }
  add(child){child.parent?.remove(child);this.children.push(child);child.parent=this}
  remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null}
  traverse(fn){fn(this);for(const child of this.children)child.traverse(fn)}
  worldToLocal(point){return point.sub(this.position)}
}
class Material {
  constructor(options={}){Object.assign(this,options)}
  dispose(){this.disposed=true}
}
class Texture {
  constructor(image){this.image=image}
  clone(){return new Texture(this.image)}
  dispose(){this.disposed=true}
}
class Mesh extends Object3D {
  constructor(geometry,material){super();this.geometry=geometry;this.material=material}
}
class Sprite extends Object3D {
  constructor(material){super();this.material=material}
}
let loads=0,registers=0,activations=0,refreshes=0,fireSteps=0,fireTeardowns=0,authorMaterials=0; // Proves shared asset and VFX lifecycle instead of repainting fire in a second system.
const THREE = {
  Group:Object3D, Mesh,Sprite, SpriteMaterial:Material,MeshBasicMaterial:Material,Vector3,
  PlaneGeometry:class{constructor(width,height){this.width=width;this.height=height}dispose(){this.disposed=true}},
  Matrix4:class{makeBasis(right,up,forward){this.axes=[right.x,up.y,forward.z];return this}},
  TextureLoader:class{load(url,success){loads++;Promise.resolve().then(()=>success(new Texture({width:128,height:86,naturalWidth:128,naturalHeight:86})))}},
  CanvasTexture:class extends Texture{constructor(canvas){super(canvas)}},
  DoubleSide:2, AdditiveBlending:3, NearestFilter:1,
};
const effects = {
  registerLayer(state,mesh,layer,image){registers++;assert(mesh.material?.map && image.width===128 && layer.id)},
  activateHead(state,head,images,unit){
    activations++;assert.equal(head.layers.length,4);assert.equal(images.length,4);assert.equal(unit,.001);
    assert.equal(head.layers[2].vfx.type,'fire');assert.equal(head.layers[2].vfx.worldRise,true);
    const flameGroup=new THREE.Group(); // Simulate the real emitter's child group between fuel and front.
    state.headRoot.add(flameGroup);
    state.fireEmitters=[{group:flameGroup,particles:[]}];
  },
  refreshMetal(state){refreshes++;assert.equal(state.itemKey,'ruinRopeTorch')},
  stepFire(state,dt){fireSteps++;assert(dt>=0 && dt<=0.4);assert(state.fireEmitters.length)},
  dispose(state){fireTeardowns++;state.fireEmitters=[]},
};
const win={THREE,HobunjiLayeredWeaponEffects:effects,
  HobunjiSpritePngSurface:{
    makeMaterial(_three, map, name, options) {
      authorMaterials++;
      assert(name.startsWith('ruin-rope-torch-') && options.depthWrite === false && options.side === THREE.DoubleSide);
      return new Material({map, transparent:true, depthWrite:false, depthTest:true});
    },
  },
};
const document={createElement(type){
  assert.equal(type,'canvas');
  return {getContext(){return {createRadialGradient(){return {addColorStop(){}}},fillRect(){}}}};
}};
const context=vm.createContext({window:win,document,console,performance:{now:()=>2100}});
vm.runInContext(read('docs/config/weapon-sprite-assemblies.js'),context);
const head=win.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.hachutuTorchFlail.flail.head;
assert.equal(head.scale,2.5);
assert.deepEqual(Array.from(head.layers,layer=>layer.id),['back','handle','fuel','front']);
for(const layer of head.layers)assert(fs.existsSync(path.join(root,'docs',layer.sprite)), 'missing shipped head PNG '+layer.sprite);
vm.runInContext(source,context);
const api=win.RuinRopeTorch;
assert.equal(api.attach(null),null);
const floor=new Object3D(),marker=new Object3D();floor.add(marker);
const torch=api.attach(marker),second=api.attach(marker);
assert(torch && second);
assert.equal(torch.root.visible,false,'glow must not appear before the four brazier textures load');
assert.equal(torch.root.parent,marker,'head and halo inherit the real swinging rope bob');
const camera={getWorldPosition(vector){return vector.set(0,3,5)}};
api.tick(torch,.02,camera);
assert.equal(torch.root.visible,false,'a pre-load frame must not show a floating halo');
assert.equal(fireSteps,0,'unloaded head must not emit particles');

(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(loads,4,'four shared weapon textures load once even with two separate ropes');
  assert.equal(registers,8,'each head gets its own recolorable four-layer meshes');
  assert.equal(authorMaterials,8,'every layer uses the canonical authored PNG material builder');
  assert.equal(activations,2,'both ropes emit using the existing Torch-Flail fire effect');
  assert.equal(refreshes,2,'both heads request the shared bronze metal surface treatment');
  assert.equal(torch.headRoot.children.length,5,'four PNG layers plus the shared interleaved fire group');
  assert.equal(torch.aura.material.blending,THREE.AdditiveBlending,'halo is a fake-light sprite, not a point light');
  assert.equal(torch.aura.raycast !== Sprite.prototype.raycast,true,'aura cannot block grabbing');
  assert.equal(api.debugSnapshot().ready,2);
  assert.equal(api.debugSnapshot().lastError,null);

  api.tick(torch,.03,camera);
  assert(torch.root.visible && fireSteps>=1,'live rope has active flames within the camera range');
  assert(torch.facingRoot.quaternion.lastBasis,'head billboards upright without tilting to the rope swing');
  const stepsWhenShown=fireSteps;
  marker.position.x=100;
  api.tick(torch,.03,camera);
  assert.equal(torch.root.visible,false,'distant rope fire and aura are culled together');
  assert.equal(fireSteps,stepsWhenShown,'offscreen rope emits no particles');
  marker.position.x=0;
  api.tick(torch,.03,camera);
  assert(torch.root.visible && fireSteps>=stepsWhenShown+2,'returning to view discards stale motes then resumes live fire');
  floor.visible=false;
  api.tick(torch,.03,camera);
  assert.equal(torch.root.visible,false,'hidden upper floors do not keep burning');
  floor.visible=true;

  const late=api.attach(marker);
  api.dispose(late);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(late.ready,false,'late PNG promise cannot resurrect a disposed rope');
  api.dispose(torch);
  api.dispose(second);
  api.dispose(torch); // Idempotent, including after an already-rejected rope build.
  assert.equal(api.debugSnapshot().total,0);
  assert.equal(marker.children.length,0,'all head and halo scene children are removed');
  assert.equal(fireTeardowns,3,'pooled particles retire exactly once per rope');
  assert.equal(torch.state.dead,true,'late asynchronous bronze recolors cannot revive a removed rope');
  assert(torch.state.headParts.length===0 && torch.state.materialLayers.length===0,'layer references are released');
  console.log('Ruin rope Torch-Flail head, shared fire, fake aura, culling, async assets and teardown passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
