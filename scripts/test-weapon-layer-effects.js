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
assert.equal(targets.length,3,'back, handle, and front emit; fuel does not');
assert.deepEqual(Array.from(targets[0].mask.indices),[0],'back metal hidden by fuel and front must not spawn enchantments');
assert.deepEqual(Array.from(targets[1].mask.indices),[3],'visible handle metal remains eligible');
assert.deepEqual(Array.from(targets[2].mask.indices),[1],'frontmost metal remains eligible');
const markers=api.sourcePixels(fuel,'#7F00FF','marker');
assert.deepEqual(Array.from(markers),[2], 'fire starts from original violet rag pixels, not the recolored render texture');
assert.strictEqual(markers,api.sourcePixels(fuel,'#7F00FF','marker'),'source alpha masks must be cached between frames');
assert.equal(api.coveredByUpperLayers(1,0,layers[0],layers,0),true);
assert.equal(api.coveredByUpperLayers(0,0,layers[0],layers,0),false);
const colored=api.recolorMarker(fuel,'#7F00FF','#E7DDC9');
assert(colored && colored.width===2 && colored.height===2,'marker recolor outputs its own canvas');
assert.equal(fuel.pixels[2*4],127,'source PNG pixels remain untouched');
const grouped=api.visibleMetalTargets(layers).reduce((n,t)=>n+t.mask.matchedMetalPixels,0);
assert.equal(grouped,3,'all visible metal pixels are available for the existing enchantment emitter');

class Group {constructor(){this.children=[];this.layers={mask:1};this.userData={};}add(o){o.parent=this;this.children.push(o);}remove(o){this.children=this.children.filter(x=>x!==o);o.parent=null;}}
const THREE={
  Group,
  CanvasTexture: class{constructor(canvas){this.image=canvas;}},
  SpriteMaterial:class{constructor(options){Object.assign(this,options);this.color={set(v){this.value=v;}};}dispose(){}},
  Sprite:class{
    constructor(material){this.material=material;this.layers={mask:1,set(index){this.mask=1<<index;}};this.position={set(x,y,z){this.x=x;this.y=y;this.z=z;}};this.scale={setScalar(v){this.x=v;this.y=v;}};}
  },
  AdditiveBlending:2
};
const root=new Group(); // Fake head: interleaved emitter inserted into this same ordered stack.
const state={THREE,headRoot:root,headParts:layers.map(l=>l.mesh)};
api.activateHead(state,weapon.flail.head,images.map(image=>({image})),0.002);
assert.equal(state.fireEmitters.length,1);
const emitter=state.fireEmitters[0];
assert(emitter.renderOrder>layers[2].mesh.renderOrder && emitter.renderOrder<layers[3].mesh.renderOrder,
  'fire is drawn after fuel but before front; front alpha masks flames');
assert.deepEqual(Array.from(state.metalTargets,t=>t.mask.matchedMetalPixels),[1,1,1]);
api.stepFire(state,0.1);
assert(emitter.particles.length>0,'fire emits from the fuel marker mask');
assert(emitter.particles.every(p=>p.sprite.renderOrder<layers[3].mesh.renderOrder));
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
assert.equal(state.metalTargets.length,oldHeadTargets+1,'head enchantment masks survive activation of rigid shaft');
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
assert.equal(staffRecipe.base.vfx.size, weapon.flail.head.layers[2].vfx.size, 'rank 5 matches the torch-flail mote size');
const staffSource = pixels(2, 20, [[0,0,rag],[0,1,rag],[0,18,rag],[0,19,rag]]); // Four opaque violet pixels form two staff tips.
let rank = 0; // Live mastery callback exercises both ends of the rank progression.
const staffPlane = new Group(); staffPlane.renderOrder = 1.5;
const staffState = { THREE, plane: staffPlane, masteryLevel: () => rank };
api.activateStatic(staffState, staffRecipe.base, [], [], staffSource, .002);
assert.equal(staffState.metalTargets.length, 0, 'marker-only staff is not a source of verdigris or metal enchantment motes');
assert.equal(staffState.fireEmitters.length, 1, 'both tips share one bounded pooled emitter');
const staffFx = staffState.fireEmitters[0];
assert.equal(staffFx.clusters.length, 2, 'fuel pixels are divided between the two ends');
assert.deepEqual(Array.from(staffFx.clusters, cluster => cluster.pixels.length), [2,2]);
api.stepFire(staffState, .1);
assert(staffFx.particles.length > 0);
assert(staffFx.particles.every(p => Math.abs(p.size - .0044) < 1e-6), 'rank 0 uses many tiny flames');
rank = 5;
api.stepFire(staffState, .5); // Retire existing rank-0 particles and replace them at rank-5 size.
assert(staffFx.particles.length > 0);
assert(staffFx.particles.every(p => Math.abs(p.size - .02) < 1e-6), 'rank 5 uses the full torch-flail flame size');
assert(staffFx.particles.every(p => Math.abs(Math.abs(p.y) - .018) < 1e-6), 'rank-5 ignition sites converge on two individual end centers');
api.dispose(staffState);
assert.equal(staffFx.group.parent, null);
assert.match(game, /hachutuTorchStaff: \{[^\n]*shapeKey: 'hachutuTorchStaff'/);
assert.match(game, /masteryLevel: \(\) => toolMasteryLevel\(itemKey\)/);
assert.match(hub, /baseFireMode/, 'tool editor exposes single-PNG effects');

console.log('weapon layer effects: PASS (metal recolor, visible composite mask, fuel marker, interleaved fire, head-only enchantments, no chain)');
