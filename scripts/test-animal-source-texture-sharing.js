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
class TextureLoader {
  load() { loads++; return { image: { width: 1375, height: 600 }, repeat: { set() {} }, offset: { set() {} }, dispose() { disposed++; } }; }
}
const THREE = { TextureLoader, Mesh, Group, PlaneGeometry: Geometry, MeshBasicMaterial: class { constructor(options) { Object.assign(this, options); } dispose() {} } };
const source = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const start = source.indexOf('  const animalSourceTextures'), end = source.indexOf('  function hasUsablePortraitRig', start);
const context = { window: {}, cfg: () => ({}) };
vm.runInNewContext(source.slice(start, end) + '\nthis.build = buildAnimalPlaneAvatarModel;', context);
const herd = Array.from({ length: 24 }, () => context.build(THREE, 'herd.png'));
assert.equal(loads, 2, '24 adults share one native-resolution front/back source pair rather than 48 textures');
const survivingMap = herd[23].frontPlane.material.map;
for (let i = 0; i < 23; i++) { herd[i].dispose(); herd[i].dispose(); }
assert.equal(disposed, 0, 'retiring one actor cannot dispose a surviving actor\'s maps');
assert.equal(herd[23].frontPlane.material.map, survivingMap);
herd[23].dispose();
assert.equal(disposed, 2, 'the final actor frees both source textures');
context.build(THREE, 'herd.png');
assert.equal(loads, 4, 'zero-owner cache entries do not retain their source pair forever');
console.log('Canonical animal source texture sharing and reference-counted disposal passed.');
