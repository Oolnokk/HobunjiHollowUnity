'use strict';
// Real shared glyph-ink shader and editor decal normalization, without a WebGL dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Load source under test rather than copied shader logic.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Checked-in code and fixture loader.
class Color {
  set(hex) { this.value = hex; return this; }
}
class Material {
  constructor(options = {}) { Object.assign(this, options); this.color = new Color(); this.color.set(options.color); }
}
class PlaneGeometry {
  constructor(width, height) { this.parameters = { width, height }; }
}
class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; this.children = []; this.position = { z:0 }; this.visible = true; }
  add(child) { child.parent = this; this.children.push(child); }
}
const THREE = { // Only the THREE surfaces the real ink module uses.
  Mesh, PlaneGeometry, MeshBasicMaterial: Material,
  NormalBlending: 1, AdditiveBlending: 2, DoubleSide: 3,
};
const window = { THREE }; // Independent browser namespace for script evaluation.
vm.runInNewContext(read('docs/js/furniture-decal-ink.js'), { window }, { filename:'furniture-decal-ink.js' });
const inkApi = window.FurnitureDecalInk; // Actual exports consumed by editor and game.
assert.equal(inkApi.installed, true);
assert.equal(inkApi.normalize({ enabled:false, color:'#ff00ff' }), null, 'unchecked mode does nothing');
assert.equal(inkApi.normalize({ enabled:true, color:'invalid', glowStrength:4, glowRadius:-1 }).color, '#ffffff', 'invalid color uses a safe neutral');
assert.equal(inkApi.normalize({ enabled:true, glowStrength:4 }).glowStrength, 1, 'glow intensity stays within UI range');
assert.equal(inkApi.normalize({ enabled:true, glowRadius:10 }).glowRadius, .25, 'glow radius stays within UI range');

const mesh = new Mesh(new PlaneGeometry(.25, .25), new Material({ map:null, color:'#ffffff' })); // Simulates editor's async PNG loading.
const settings = { enabled:true, color:'#aabbcc', glowStrength:.75, glowRadius:.07 }; // One static, reproducible glyph appearance.
const ink = inkApi.decorate(mesh, settings);
assert.equal(ink.color, '#aabbcc');
assert.equal(mesh.material.color.value, '#aabbcc', 'the motif uses selected ink rather than source PNG RGB');
assert.equal(mesh.material.blending, THREE.NormalBlending, 'glyph core uses normal blending to preserve hue');
assert.equal(mesh.children.length, 2, 'wide glow and concentrated hot glow are both attached to the glyph');
const halo = mesh.userData.glyphInkHalo; // Independently visible background falloff.
assert.ok(Math.abs(halo.material.opacity - .75 * .8) < 1e-9, 'outer glow restores strong color emission');
const hotHalo = mesh.userData.glyphInkHalos[1]; // A tight glow around the letter strokes, independent of the broader aura.
assert.equal(hotHalo.name, 'decal_ink_hot_glow');
assert.ok(Math.abs(hotHalo.material.opacity - .75 * 1.15) < 1e-9, 'hot glow is stronger than the wide aura');
assert.equal(hotHalo.material.blending, THREE.AdditiveBlending);
assert.equal(halo.visible, false, 'outer halo is hidden until the decal PNG loads');
assert.equal(hotHalo.visible, false, 'hot halo is also hidden until the decal PNG loads');
assert.ok(halo.geometry.parameters.width > mesh.geometry.parameters.width, 'halo footprint extends beyond motif');
const coreShader = { fragmentShader:'void main(){ #include <map_fragment> }' }; // Shader fragment replacement is the production behavior.
mesh.material.onBeforeCompile(coreShader);
assert.match(coreShader.fragmentShader, /diffuseColor\.a \*= texture2D\(map, vUv\)\.a/, 'source-alpha-only recolor preserves original silhouette');
const haloShader = { fragmentShader:'void main(){ #include <map_fragment> }' };
halo.material.onBeforeCompile(haloShader);
assert.match(haloShader.fragmentShader, /texture2D\(map, \(uv\)\)\.a/, 'halo uses source alpha only, including for dark PNG motifs');
assert.match(haloShader.fragmentShader, /< 0\.0 \|\|/, 'outer UVs are clamped transparent to prevent a square halo');
const loadedTexture = { source:'decal.png' }; // Shared WebGL texture feeds both planes after image load.
inkApi.setTexture(mesh, loadedTexture);
assert.equal(mesh.material.map, loadedTexture);
assert.equal(halo.material.map, loadedTexture);
assert.equal(hotHalo.material.map, loadedTexture);
assert.equal(hotHalo.visible, true, 'hot glow appears with the source alpha mask');
assert.equal(halo.visible, true);
assert.equal(halo.material.needsUpdate, true);
const recolorOnly = new Mesh(new PlaneGeometry(.3,.4),new Material({map:loadedTexture}));
inkApi.decorate(recolorOnly,{enabled:true,color:'#00ff99',glowStrength:0,glowRadius:.08});
assert.equal(recolorOnly.children.length, 0, 'zero strength retains color fill without extra halo draws');
assert.equal(recolorOnly.material.blending, THREE.NormalBlending);

const editor = read('docs/tools/furniture-avatar-author/furniture-decals.js'); // Import/export must not strip either glow mode.
const begin = editor.indexOf('function normalizeDecal('), end = editor.indexOf('\nfunction selectedDecal(', begin);
assert.ok(begin >= 0 && end > begin, 'actual editor normalizer can be exercised');
const normalizeDecal = vm.runInNewContext(editor.slice(begin, end) + '\nnormalizeDecal;', {
  window, uid:()=>'test-decal', dclone: value => JSON.parse(JSON.stringify(value)),
  TANKAN_SOURCE_TYPE:'tankan', IMAGE_SOURCE_TYPE:'image', normalizedTankanRecord: () => ({}),
  finiteOr:(v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback,
  dclamp:(v,min,max)=>Math.max(min,Math.min(max,Number(v))),
});
const oldGlow = {off:['#ff0000'],on:['#00ff00'],cycleSeconds:1,pulse:.4}; // Legacy puzzle state survives normalization unchanged.
const loaded = normalizeDecal({imageSource:'assets/patterns/sample.png',glyphInk:settings,glow:oldGlow});
assert.equal(loaded.glyphInk.color,'#aabbcc','standalone glyph settings survive authoring import');
assert.equal(loaded.glow.off[0],'#ff0000','legacy puzzle state glow is not lost on import');
assert.equal(normalizeDecal({imageSource:'sample.png'}).glyphInk,undefined,'ordinary existing decals are opt-out');
for (const control of ['decalGlyphInkEnabled','decalGlyphInkColor','decalGlyphInkStrength','decalGlyphInkRadius'])
  assert.ok(editor.includes('id="' + control + '"'), 'Decal tab exposes ' + control);
const runtime = read('docs/js/furniture-decal-runtime.js'); // Game uses the same shared appearance after placing authored furniture.
assert.ok(runtime.includes('FurnitureDecalInk?.decorate?.(mesh, record.glyphInk)'), 'production runtime invokes shared shader');
for (const key of ['glowGlyphOrb','flamingLichHeart','unsleepingLichHeart','sightlessLichHeart']) {
  const data = JSON.parse(read('docs/config/furniture-authored/' + key + '.json'));
  const part = data.parts[0], surface = data.recognizedSurfaces[0], decal = data.decals[0]; // Authoring coordinates must be reduced together.
  assert.equal(part.transform.sx, .325);
  assert.equal(part.transform.sy, .325);
  assert.ok(Math.abs(surface.area-.325*.325)<1e-10);
  assert.equal(surface.bounds.minU,-.1625);
  assert.equal(surface.bounds.maxV,.1625);
  assert.equal(decal.width, .8, 'decal X scale matches authored 0.8 independently of billboard');
  assert.equal(decal.height, .8, 'decal Y scale matches authored 0.8 independently of billboard');
  assert.equal(decal.glyphInk?.enabled,true);
  assert.ok(decal.glyphInk.glowStrength>0);
  assert.ok(decal.glyphInk.glowRadius>0);
}
console.log('PASS alpha-only glyph recolor, halo, editor state preservation, and half-sized orb billboards');
