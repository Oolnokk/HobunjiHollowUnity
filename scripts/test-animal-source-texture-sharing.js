'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let loads = 0, disposed = 0;
class Geometry { clone() { return new Geometry(); } dispose() {} }
class Group { constructor() { this.children = []; this.userData = {}; } add(...children) { this.children.push(...children); } }
class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.position = {}; this.rotation = {}; this.scale = { set() {} }; this.userData = {}; }
}
class Texture { constructor() { this.image = undefined; this.repeat = { set() {} }; this.offset = { set() {} }; } dispose() { disposed++; } }
class TextureLoader {
  load(url, onLoad) {
    loads++;
    const texture = new Texture();
    texture.image = { width: 1375, height: 600 };
    onLoad?.(texture); // Synchronous stand-in for the image finishing.
    return texture;
  }
}
class MeshBasicMaterial {
  constructor(options = {}) { Object.assign(this, options); }
  clone() { return new MeshBasicMaterial({ name: this.name, map: this.map }); }
  dispose() {}
}
const THREE = { Texture, TextureLoader, Mesh, Group, PlaneGeometry: Geometry, MeshBasicMaterial };
const source = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const start = source.indexOf('  const animalSourceTextures'), end = source.indexOf('  function hasUsablePortraitRig', start);
const context = { window: {}, cfg: () => ({}) };
vm.runInNewContext(source.slice(start, end) + '\nthis.build = buildAnimalPlaneAvatarModel;', context);
const herd = Array.from({ length: 24 }, () => context.build(THREE, 'herd.png'));
assert.equal(loads, 1, '24 adults share one native-resolution source image (the back card mirrors it in-shader)');
const backMaterial = herd[0].backPlane.material;
assert.equal(backMaterial.map, herd[0].frontPlane.material.map, 'the back card binds the front texture instead of a second mirrored upload');
assert.equal(typeof backMaterial.onBeforeCompile, 'function', 'the back material mirrors UVs in its own shader');
{
  const shader = { uniforms: {}, vertexShader: '#include <common>\nvoid main() {\n#include <uv_vertex>\n}' };
  backMaterial.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /1\.0 - uv\.x/, 'the uv chunk is replaced by the mirrored lookup');
  assert.equal(shader.uniforms.hobunjiSharedFaceMirror.value, 1, 'mirroring is on while the shared front texture is bound');
  const legacy = new Texture(); // A caller-supplied pre-mirrored back texture keeps rendering as before.
  backMaterial.map = legacy;
  assert.equal(shader.uniforms.hobunjiSharedFaceMirror.value, 0, 'mirroring stays off for pre-mirrored back textures');
  backMaterial.map = herd[0].frontPlane.material.map;
  const clone = backMaterial.clone(); // Dialogue fades and depth occluders clone avatar materials.
  const cloneShader = { uniforms: {}, vertexShader: '#include <uv_vertex>' };
  clone.onBeforeCompile(cloneShader);
  assert.equal(cloneShader.uniforms.hobunjiSharedFaceMirror.value, 1, 'clones keep the in-shader mirror');
}
const survivingMap = herd[23].frontPlane.material.map;
for (let i = 0; i < 23; i++) { herd[i].dispose(); herd[i].dispose(); }
assert.equal(disposed, 0, 'retiring one actor cannot dispose a surviving actor\'s maps');
assert.equal(herd[23].frontPlane.material.map, survivingMap);
herd[23].dispose();
assert.equal(disposed, 2, 'the final actor frees both source textures');
context.build(THREE, 'herd.png');
assert.equal(loads, 2, 'zero-owner cache entries do not retain their source pair forever');
console.log('Canonical animal source texture sharing and reference-counted disposal passed.');
