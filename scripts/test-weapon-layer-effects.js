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

class Group {constructor(){this.children=[];this.layers={mask:1};this.userData={};}add(o){o.parent=this;this.children.push(o);}remove(o){this.children=this.children.filter(x=>x!==o);}}
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
api.dispose(state);
assert.equal(state.fireEmitters.length,0,'teardown disposes fire sprite pools');

console.log('weapon layer effects: PASS (metal recolor, visible composite mask, fuel marker, interleaved fire, head-only enchantments, no chain)');
