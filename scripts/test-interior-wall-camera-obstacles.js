'use strict';

// Interior booms only pull in front of meshes tagged cameraObstacle (game.js
// gathers them per building scene). Every wall construction must carry the tag,
// not just the canvas style, or the follow camera passes through house walls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Node3D {
  constructor() { this.children = []; this.userData = {}; this.position = { set() {} }; this.rotation = { set() {} }; }
  add(child) { this.children.push(child); return this; }
  traverse(fn) { fn(this); this.children.forEach(child => child.traverse(fn)); }
}
class Group extends Node3D {}
class Mesh extends Node3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; } }
const THREE = { Group, Mesh, MeshLambertMaterial: class {}, BoxGeometry: class {}, MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } };

const window = { THREE };
const context = vm.createContext({ window, console, Math, Number, Object, Array, Map, Set, String, JSON, Float32Array });
context.globalThis = window;
vm.runInContext(fs.readFileSync('docs/js/interior-scene-builder.js', 'utf8'), context, { filename: 'interior-scene-builder.js' });
const builder = window.InteriorSceneBuilder;

const panels = builder.buildWallPanels(new Set(['2,2', '3,2', '2,3', '3,3']), new Set(), 1.75);
assert.ok(panels.length > 0, 'a floor produces wall panels');

for (const wallStyle of ['', 'brick']) {
  const group = builder.buildWallGroup(THREE, null, panels, wallStyle, {});
  const meshes = [];
  group.traverse(node => { if (node.isMesh) meshes.push(node); });
  assert.ok(meshes.length > 0, `${wallStyle || 'default'} walls build meshes`);
  assert.ok(meshes.every(mesh => mesh.userData.cameraObstacle === true), `every ${wallStyle || 'default'} wall mesh pulls the camera in`);
}
console.log('interior wall camera obstacles ok');
