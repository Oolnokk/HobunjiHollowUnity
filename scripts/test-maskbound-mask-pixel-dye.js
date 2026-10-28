'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const avatar = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const mask = JSON.parse(fs.readFileSync('docs/config/cosmetics/clothes/masks/hachutu_binding_mask_ii.json', 'utf8'));
const slice = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
class Canvas {
  getContext() { return {
    drawImage: img => { this.data = new Uint8ClampedArray(img.data); },
    getImageData: () => ({ data: this.data }),
    putImageData: image => { this.data = image.data; },
  }; }
}
const context = vm.createContext({ document: { createElement: () => new Canvas() }, portraitRelPath: url => url });
vm.runInContext(slice(portrait, 'class PortraitPixelCache', 'const IMG_CACHE') +
  slice(portrait, 'function parseHexColor(', 'function getPortraitTintingConfig(') +
  slice(portrait, 'const _PIXEL_DYE_CACHE', '// Behind-view layers') +
  slice(portrait, 'function _extractLayersFromParts(', '/**\n * Return the correct layer list') +
  '\nthis.api = { pixelDyeLayerImage, _extractLayersFromParts };', context);
const source = { width: 3, height: 1, data: new Uint8ClampedArray([
  127, 0, 255, 128, 126, 0, 255, 255, 127, 0, 255, 0,
]) };
for (const variant of Object.values(mask.speciesVariants)) {
  const layers = context.api._extractLayersFromParts(variant.parts, mask.palette.layers);
  assert.equal(layers.length, 2);
  const [base, glow] = layers;
  assert.equal(glow.paletteColorKey, 'C', 'third dye is an ordinary discoverable portrait palette slot');
  const plain = context.api.pixelDyeLayerImage(source, base);
  assert.equal(plain.data[3], 0, 'base tint must exclude the keyed pixel');
  assert.equal(plain.data[7], 255, 'nearby purple is untouched');
  const dyed = context.api.pixelDyeLayerImage(source, glow, [24, 200, 70]);
  assert.deepEqual(Array.from(dyed.data), [24, 200, 70, 128, 126, 0, 255, 0, 127, 0, 255, 0]);
  assert.equal(dyed.pixelDyeCentroid.x, 1 / 6);
  assert.strictEqual(context.api.pixelDyeLayerImage(source, glow, [24, 200, 70]), dyed, 'composition is cached');
  assert.notStrictEqual(context.api.pixelDyeLayerImage(source, glow, [200, 20, 90]), dyed, 'dye changes invalidate the pixel result');
}
class Node {
  constructor() { this.userData = {}; this.position = { set(x,y,z) { Object.assign(this, {x,y,z}); } }; }
  add(node) { node.removeFromParent?.(); node.parent = this; }
  remove(node) { node.parent = null; }
  removeFromParent() { this.parent = null; }
}
class PointLight extends Node {
  constructor() { super(); this.color = { set(value) { this.value = value; } }; this.layers = { set: n => { this.layer = n; } }; }
  dispose() { this.disposed = true; }
}
const root = new Node();
root.userData = { portraitModelWidth: 2, portraitModelHeight: 4, visualCentroidLocalY: 1, visualCentroidLocalZ: 0,
  neckRig: { available: true, neckLocal: { x: 0, y: 1, z: 0 }, headScaleJoint: new Node() } };
const registered = new Set();
const lights = vm.createContext({ window: { FurnitureLightRegistry: { register: light => registered.add(light) } }, portraitsFlipped: false });
vm.runInContext(slice(avatar, '  const portraitThreeByRoot', '  function buildSinglePlaneAvatarModel(') + '\nthis.sync = syncPortraitGlow; this.attach=setPortraitGlowAttachment;', lights);
const canvas = { hobunjiPortraitGlow: { x: .25, y: .2, color: '#18c846', intensity: 3.5, radius: .65 } };
lights.sync({ PointLight }, root, canvas);
const light = root.userData.portraitGlowLight;
assert.strictEqual(light.parent, root.userData.neckRig.headScaleJoint, 'light follows the animated/scaled head');
assert.equal(light.position.x, -.5);
assert(Math.abs(light.position.y - .2) < 1e-9);
assert.equal(light.layer, 31, 'excluded from real WebGL lighting');
assert(light.userData.furnitureLightMask);
assert(registered.has(light), 'existing fake-light compositor receives the source');
assert.equal(light.distance, .65);
assert.equal(light.intensity, 3.5);
canvas.hobunjiPortraitGlow.color = '#cc3344';
lights.portraitsFlipped = true;
lights.sync({ PointLight }, root, canvas);
assert.strictEqual(root.userData.portraitGlowLight, light, 'redye reuses the existing light');
assert.equal(light.color.value, '#cc3344');
assert.equal(light.position.x, .5, 'portrait mirroring also mirrors the source');
root.userData.sourceCanvas=canvas;
const convertedNeck=new Node();
lights.attach(root,convertedNeck,{x:.1,y:1,z:0});
assert.strictEqual(light.parent,convertedNeck,'converted hostile rig receives the same light');
assert.equal(light.position.x,.4);
lights.portraitsFlipped=false;lights.sync({PointLight},root,canvas);
assert.strictEqual(light.parent,convertedNeck,'mirror/refresh cannot move the light back to the hidden original PNG root');
assert.equal(light.position.x,-.6);
lights.sync({ PointLight }, root, {});
assert.equal(root.userData.portraitGlowLight, null);
assert.equal(light.parent, null);
assert(light.disposed, 'unequipping removes and disposes the light');
console.log('Mask pixel dye: exact selection, alpha, C palette, recolor cache, head attachment, fake lighting, mirroring, removal passed');
