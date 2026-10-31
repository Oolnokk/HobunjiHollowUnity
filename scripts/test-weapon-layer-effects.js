'use strict';
// Run: node scripts/test-weapon-layer-effects.js
// Tests real material/visibility logic with small transparent authored PNG fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('docs/js/weapon-layer-effects.js', 'utf8'); // Production effects runtime under test.
const registry = fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8'); // Artist-authoritative layer order and marker colors.
const vfx = fs.readFileSync('docs/js/combat/weapon-enchantment-vfx.js', 'utf8'); // The existing enchantment emission consumer.
const held = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'); // Existing held-object overlay preserves layer draw order.
const game = fs.readFileSync('docs/game.js', 'utf8'); // The real weapon factory supplies plating/mastery metal options.
const hub = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/app.js','utf8'); // Only used in the standalone authoring iframe.
new Function(src);new Function(registry);new Function(hub);
assert.match(game,/metalOptions: \(\) => metalToolRecolorOptions\(itemKey\)/);
assert.match(game,/hachutuTorchFlail: \{[^\n]*metalKey: 'tinBronze'/);
assert.match(vfx,/assembly\.enchantmentTargets\(heldVisual\)/);
assert.match(vfx,/snapshot\.maskByPlane\?\.get\(emitter\.plane\)/);
assert.match(held,/mesh\.userData\?\.hobunjiWeaponAssemblyPart !== true/);
assert.match(hub,/function layers\(\)[\s\S]*def\.flail\?\.head\?\.layers \|\| \[\]/);

function pixels(width, height, entries) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x,y,rgba] of entries) data.set(rgba,(y*width+x)*4);
  return { width,height,pixels:data };
}
const metal = [90,132,128,255], rag = [127,0,255,255], clear=[0,0,0,0];
const back = pixels(2,2,[[0,0,metal],[1,0,metal],[0,1,metal]]);
const handle = pixels(2,2,[[1,1,metal]]);
const fuel = pixels(2,2,[[0,1,rag]]);
const front = pixels(2,2,[[1,0,metal]]);
let current = null; // Fake canvas source image, swapped by context.drawImage.
const document = {createElement(type) {
  assert.equal(type,'canvas');
  return {
    width:0,height:0,
    getContext() { return {
      drawImage(img) {current=img;},
      getImageData() {return {width:current.width,height:current.height,data:current.pixels};},
      createImageData(w,h) {return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
      putImageData(result) {this.output=result;},
      createRadialGradient() {return {addColorStop(){}};},fillRect() {},
    };},
  };
}};
const window = {};
vm.runInNewContext(src,{window,document,console,performance:{now:()=>1500}});
vm.runInNewContext(registry,{window});
const api=window.HobunjiLayeredWeaponEffects; // Public renderer helper, no new standalone physics loop.
assert(api);
const weapon=window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.hachutuTorchFlail;
assert.deepEqual(Array.from(weapon.flail.head.layers,l=>l.id),['back','handle','fuel','front']);
assert.deepEqual(Array.from(weapon.flail.head.layers,l=>l.material),['metal','metal','marker','metal']);
assert.equal(weapon.flail.chain.material,'metal');
assert.equal(weapon.flail.head.layers[2].sourceHex,'#7F00FF');
assert.equal(weapon.flail.head.layers[2].targetHex,'#E7DDC9');
const images=[back,handle,fuel,front];
const layers=images.map((image,index)=>({image,config:weapon.flail.head.layers[index],mesh:{renderOrder:1.52+index*.001}}));
const targets=api.visibleMetalTargets(layers); // Uses source metal hues, subtracting later opaque head layers.
assert.equal(targets.length,4,'back, handle, front (metal hue) and fuel (fire-marker hue) all emit: enchantments target both source colors');
assert.deepEqual(Array.from(targets,t=>t.plane.renderOrder),[1.52,1.521,1.522,1.523],'targets stay in head-layer order');
assert.deepEqual(Array.from(targets[0].mask.indices),[0],'back metal hidden by fuel and front must not spawn enchantments');
assert.deepEqual(Array.from(targets[1].mask.indices),[3],'visible handle metal remains eligible');
assert.deepEqual(Array.from(targets[2].mask.indices),[2],'visible fuel marker pixel is an enchantment source too');
assert.deepEqual(Array.from(targets[3].mask.indices),[1],'frontmost metal remains eligible');
const markers=api.sourcePixels(fuel,'#7F00FF','marker');
assert.deepEqual(Array.from(markers),[2], 'fire starts from original violet rag pixels, not the recolored render texture');
assert.strictEqual(markers,api.sourcePixels(fuel,'#7F00FF','marker'),'source alpha masks must be cached between frames');
assert.equal(api.coveredByUpperLayers(1,0,layers[0],layers,0),true);
assert.equal(api.coveredByUpperLayers(0,0,layers[0],layers,0),false);
const colored=api.recolorMarker(fuel,'#7F00FF','#E7DDC9');
assert(colored && colored.width===2 && colored.height===2,'marker recolor outputs its own canvas');
assert.equal(fuel.pixels[2*4],127,'source PNG pixels remain untouched');
const grouped=api.visibleMetalTargets(layers).reduce((n,t)=>n+t.mask.matchedMetalPixels,0);
assert.equal(grouped,4,'all visible metal and fire-marker pixels are available for the existing enchantment emitter');

class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(other){return this.set(other.x,other.y,other.z);}
  clone(){return new Vector3(this.x,this.y,this.z);}
}
class Object3D {
  constructor(){
    this.children=[]; this.layers={mask:1}; this.userData={}; this.parent=null;
    this.position=new Vector3(); this.scale=new Vector3(1,1,1); this.rotation={z:0}; // Planar test transform simulates a swung flail/staff including translation and scaled child pivots.
    this.scale.setScalar=v=>{this.scale.set(v,v,v);};
  }
  add(o){o.parent?.remove(o);o.parent=this;this.children.push(o);}
  remove(o){this.children=this.children.filter(x=>x!==o);o.parent=null;}
  localToWorld(v){
    for(let node=this;node;node=node.parent){
      const c=Math.cos(node.rotation.z),s=Math.sin(node.rotation.z),x=v.x*node.scale.x,y=v.y*node.scale.y;
      v.set(x*c-y*s+node.position.x,x*s+y*c+node.position.y,v.z*node.scale.z+node.position.z);
    }
    return v;
  }
  worldToLocal(v){
    const hierarchy=[];for(let node=this;node;node=node.parent)hierarchy.push(node);
    for(const node of hierarchy.reverse()){
      const c=Math.cos(node.rotation.z),s=Math.sin(node.rotation.z),x=v.x-node.position.x,y=v.y-node.position.y;
      v.set((x*c+y*s)/node.scale.x,(-x*s+y*c)/node.scale.y,(v.z-node.position.z)/node.scale.z);
    }
    return v;
  }
  getWorldPosition(target){return this.localToWorld(target.set(0,0,0));}
  getWorldScale(target){target.set(1,1,1);for(let node=this;node;node=node.parent){target.x*=node.scale.x;target.y*=node.scale.y;target.z*=node.scale.z;}return target;}
}
class Group extends Object3D {}
const THREE={
  Group, Vector3,
  CanvasTexture: class{constructor(canvas){this.image=canvas;}},
  SpriteMaterial:class{constructor(options){Object.assign(this,options);this.color={set(v){this.value=v;}};}dispose(){}},
  Sprite:class extends Object3D{
    constructor(material){super();this.material=material;this.layers={mask:1,set(index){this.mask=1<<index;}};}
  },
  AdditiveBlending:2, NormalBlending:1
};
const root=new Group(); // Fake head: interleaved emitter inserted into this same ordered stack.
root.scale.setScalar(2.5); // The actual brazier head applies its 2.5× transform to every child emitter.
const state={THREE,headRoot:root,headParts:layers.map(l=>l.mesh)};
api.activateHead(state,weapon.flail.head,images.map(image=>({image})),0.002);
assert.equal(state.fireEmitters.length,1);
const emitter=state.fireEmitters[0];
assert(emitter.renderOrder>layers[2].mesh.renderOrder && emitter.renderOrder<layers[3].mesh.renderOrder,
  'fire is drawn after fuel but before front; front alpha masks flames');
assert.deepEqual(Array.from(state.metalTargets,t=>t.mask.matchedMetalPixels),[1,1,1,1]);
api.stepFire(state,0.1);
assert(emitter.particles.length>0,'fire emits from the fuel marker mask');
assert(emitter.particles.every(p=>p.sprite.renderOrder<layers[3].mesh.renderOrder));
assert.equal(emitter.worldRise,true,'the Torch-Flail head uses world-up fire at all attack pitches');
const rotatingFlailParticle=emitter.particles[0]; // Track one flame after the head swings and its ignition point moves.
const initialFlailWorld=rotatingFlailParticle.spawnWorld.clone();
root.rotation.z = Math.PI/2; root.position.set(3,2,0); // Simulate a horizontal brazier swinging away from the spawn location.
api.stepFire(state,.05);
const movedFlailWorld=rotatingFlailParticle.sprite.getWorldPosition(new Vector3());
assert(Math.abs(movedFlailWorld.y - initialFlailWorld.y - rotatingFlailParticle.worldSpeed * rotatingFlailParticle.age)<1e-6,
  'flail flame rises in world +Y, rather than turning sideways with its moving head');
assert(Math.abs(movedFlailWorld.x-initialFlailWorld.x) < .02,'flail fire remains near the original world X despite a moving/rotating head');
assert(Math.abs(movedFlailWorld.x-root.position.x)>1,'older flame must not teleport to the brazier after a swing');
// A flail may also author fuel on the rigid shaft: activating either stack must
// not discard the other's particles, masks, or cleanup ownership.
const oldHeadTargets = state.metalTargets.length; // The previously constructed head masks must survive the second stack.
const shaft = new Group(); // Independent parent simulates the rigid tool plane under the same weapon state.
shaft.renderOrder = 1.5;
state.plane = shaft;
const shaftLayer = { id:'haftFuel', material:'marker', sourceHex:'#7F00FF', vfx:{ type:'fire', rate:22, life:.35, size:.02, speed:.12 } };
const shaftMesh = { renderOrder:1.501 }; // Source mesh for the new shaft emitter, kept independent from the head.
state.materialLayers = [{ mesh:shaftMesh, image:fuel }]; // Match decorate()'s registration contract before activating the rigid stack.
api.activateStatic(state,[shaftLayer],[shaftMesh],back,0.002);
assert.equal(state.fireEmitters.length,2,'shaft and head emitters remain owned by the same weapon');
assert.equal(state.metalTargets.length,oldHeadTargets+2,'head enchantment masks survive activation of rigid shaft, which adds its metal base and its fire-marker fuel layer');
assert.strictEqual(state.fireEmitters[0],emitter,'head emitter identity survives rigid stack activation');
api.stepFire(state,.1);
assert(state.fireEmitters.every(fx=>fx.particles.length>0),'both independent particle stacks continue to emit');
const [headFire,shaftFire] = state.fireEmitters.map(fx=>fx.group); // Check both parent groups release correctly.
api.dispose(state);
assert.equal(state.fireEmitters.length,0,'teardown disposes both fire sprite pools');
assert.equal(headFire.parent,null,'head emitter is detached');
assert.equal(shaftFire.parent,null,'shaft emitter is detached');

// Torch-Staff is a true single-PNG marker material: two original fuel regions,
// no metal enchantment mask and rank-driven small-to-large plumes.
const staffRecipe = window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.hachutuTorchStaff; // Committed one-sprite torch staff configuration.
assert.equal(staffRecipe.flail, undefined);
assert.equal(staffRecipe.base.material, 'marker');
assert.equal(staffRecipe.base.vfx.masteryClusters, 2);
assert.equal(staffRecipe.base.vfx.size, weapon.flail.head.layers[2].vfx.size, 'staff retains the Torch-Flail mote size instead of enlarging individual glows');
assert(staffRecipe.base.vfx.visualScale > weapon.flail.head.scale, 'whole staff-tip flame assembly scales larger than the 2.5x brazier head');
assert.equal(staffRecipe.base.vfx.blendMode, 'normal', 'staff avoids additive overdraw that turns big flames into a uniform glow');
assert(staffRecipe.base.vfx.masteryFocus < 1, 'rank-5 source keeps a visible ignition footprint instead of collapsing onto a pixel');
const staffSource = pixels(2, 20, [[0,0,rag],[0,1,rag],[0,18,rag],[0,19,rag]]); // Four opaque violet pixels form two staff tips.
let rank = 0; // Live mastery callback exercises both ends of the rank progression.
const staffPlane = new Group(); staffPlane.renderOrder = 1.5;
const staffState = { THREE, plane: staffPlane, masteryLevel: () => rank };
api.activateStatic(staffState, staffRecipe.base, [], [], staffSource, .002);
assert.equal(staffState.metalTargets.length, 1, 'marker-only staff still emits enchantment motes: enchantments target the fire-marker hue as well as metal');
assert.equal(staffState.metalTargets[0].plane, staffPlane, 'staff motes spawn on the rigid staff plane');
assert.equal(staffState.metalTargets[0].mask.matchedMetalPixels, 4, 'all four visible violet pixels (both tips) are sources');
assert.equal(staffState.fireEmitters.length, 1, 'both tips share one bounded pooled emitter');
const staffFx = staffState.fireEmitters[0];
assert.equal(staffFx.clusters.length, 2, 'fuel pixels are divided between the two ends');
assert.deepEqual(Array.from(staffFx.clusters, cluster => cluster.pixels.length), [2,2]);
assert.equal(staffFx.worldRise,true,'both Torch-Staff tips rise in world space while the staff rotates');
assert.equal(staffFx.visualScale, 4);
assert.equal(staffFx.anchors.length, 2, 'staff has two independent scaled groups at the original ignition sites');
assert.deepEqual(Array.from(staffFx.anchors, anchor => anchor.group.scale.x), [4,4]);
assert(Math.abs(staffFx.anchors[0].y - .018) < 1e-6);
assert(Math.abs(staffFx.anchors[1].y + .018) < 1e-6);
assert.equal(staffFx.group.scale.x, 1, 'the emitter root is not scaled; only individual tip pivots are');
api.stepFire(staffState, .1);
assert(staffFx.particles.length > 0);
assert(staffFx.particles.every(p => Math.abs(p.size - .0044) < 1e-6), 'rank 0 uses small individual motes in the parent geometry scale');
assert(staffFx.particles.every(p => p.sprite.material.blending === THREE.NormalBlending), 'large staff fire retains color under overlap');
assert(staffFx.particles.every(p => staffFx.anchors.some(anchor => p.sprite.parent === anchor.group)), 'sprites are attached under their own tip pivot');
const staffWorldParticles=staffFx.particles.map(p=>({particle:p,spawn:p.spawnWorld.clone()})); // Assert world-up is unaffected by changing either parent tip pivot.
staffPlane.rotation.z = Math.PI; staffPlane.position.set(-2,3,0); // Invert and translate the whole staff after the ignition sites were captured.
api.stepFire(staffState,.05);
for(const {particle,spawn} of staffWorldParticles){
  const position=particle.sprite.getWorldPosition(new Vector3());
  assert(Math.abs(position.y-spawn.y-particle.worldSpeed*particle.age)<1e-6,'staff flame rises world-up despite a 180-degree staff flip');
  assert(Math.abs(position.x-spawn.x) < .02,'staff flame does not follow the inverted or translated handle');
}
rank = 5;
api.stepFire(staffState, .5); // Retire existing rank-0 particles and replace them at rank-5 size.
assert(staffFx.particles.length > 0);
assert(staffFx.particles.every(p => Math.abs(p.size - .02) < 1e-6), 'rank 5 uses the original sharp torch-flail particle size locally');
assert(staffFx.particles.every(p => Math.abs(p.sprite.parent.scale.x * p.size - .08) < 1e-6), 'rank 5 renders larger by scaling the whole flame assembly, not additive glow strength');
assert(staffFx.particles.some(p => p.y !== 0), 'mastery 5 retains nonzero fuel spread instead of stacking flames exactly on one pixel');
assert(staffFx.particles.every(p => Math.abs(p.y) < .001), 'recorded local ignition coordinates remain near each tip pivot');
api.dispose(staffState);
assert.equal(staffFx.group.parent, null);
assert.match(game, /hachutuTorchStaff: \{[^\n]*shapeKey: 'hachutuTorchStaff'/);
assert.match(game, /masteryLevel: \(\) => toolMasteryLevel\(itemKey\)/);
assert.match(hub, /baseFireMode/, 'tool editor exposes single-PNG effects');

console.log('weapon layer effects: PASS (metal recolor, visible composite mask, fuel marker, interleaved fire, head-only enchantments, no chain)');
