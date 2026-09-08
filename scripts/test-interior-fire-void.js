'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/interior-fire-void-runtime.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(source, { filename: 'interior-fire-void-runtime.js' }));

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}
class Box3 {
  setFromObject() { this.empty = false; return this; }
  isEmpty() { return !!this.empty; }
  getCenter(target) { target.x = 10; target.y = 1; target.z = 12; return target; }
  getSize(target) { target.x = 20; target.y = 4; target.z = 24; return target; }
}
class BoxGeometry {
  constructor(width, height, depth) { this.parameters = { width, height, depth }; }
}
class MeshBasicMaterial {
  constructor(options = {}) {
    this.type = 'MeshBasicMaterial';
    this.color = { value: options.color, set: value => { this.color.value = value; } };
    this.side = options.side;
    this.depthWrite = options.depthWrite;
    this.fog = true;
    this.toneMapped = true;
    this.needsUpdate = false;
  }
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.name = '';
    this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
    this.userData = {};
  }
}

const calls = [];
const campfireRecipe = [
  { kind: 'cylinder', transform: { x: 0.2, y: 0.1, z: -0.3, sx: 0.7, sy: 0.16, sz: 0.16 } },
  { kind: 'cylinder', transform: { x: -0.2, y: 0.08, z: 0.25, sx: 0.22, sy: 0.14, sz: 0.22 } },
];
const furniture = {
  CATALOG: { campfire: JSON.parse(JSON.stringify(campfireRecipe)), bonfire: [] },
  buildFurnitureGroup(key, baseColor) { calls.push([key, baseColor]); return { key, children: [{}] }; },
};
const GridTileAccessors = { init() {} };
const context = {
  window: {
    THREE: { Box3, Vector3, BoxGeometry, MeshBasicMaterial, Mesh, BackSide: 'BackSide' },
    ProceduralFurniture: furniture,
    GridTileAccessors,
  },
  setTimeout(fn) { fn(); return 1; },
  queueMicrotask(fn) { fn(); },
  console,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'interior-fire-void-runtime.js' });

const api = context.window.InteriorFireVoidRuntime;
assert(api?.installed, 'fire/void runtime must install');
assert.strictEqual(api.canonicalFireKey('campfireFurniture'), 'campfire');
assert.strictEqual(api.canonicalFireKey('bonfireFurniture'), 'bonfire');
assert.strictEqual(api.canonicalFireKey('chairSimpleFurniture'), 'chairSimpleFurniture');

assert.strictEqual(furniture.CATALOG.bonfire.length, campfireRecipe.length,
  'bonfire needs immediate non-empty procedural geometry while authored data loads');
assert.strictEqual(furniture.CATALOG.bonfire[0].transform.sx, campfireRecipe[0].transform.sx * 2,
  'immediate bonfire geometry must be exactly doubled from the campfire recipe');
assert.strictEqual(furniture.CATALOG.bonfireFurniture, furniture.CATALOG.bonfire,
  'bonfireFurniture catalog lookup must resolve to the canonical bonfire recipe');

furniture.buildFurnitureGroup('campfireFurniture', 0x123456);
furniture.buildFurnitureGroup('bonfireFurniture', 0x654321);
assert.deepStrictEqual(calls.slice(-2).map(call => call[0]), ['campfire', 'bonfire'],
  'item keys must be canonicalized before the visual builder can fall through to a placeholder cube');

const decorativeBridge = vm.runInContext(`(() => {
  const defs = { basicBedFurniture: {}, chairSimpleFurniture: {}, rugFurniture: {} };
  return [
    defs.campfireFurniture?.procKey,
    defs.bonfireFurniture?.procKey,
    defs.bonfireFurniture?.fw,
    defs.bonfireFurniture?.fd,
    defs.bonfireFurniture?.key,
    defs.bonfireFurniture?.label,
    defs.bonfireFurniture?.col,
  ];
})()`, context);
assert.deepStrictEqual(Array.from(decorativeBridge), ['campfire', 'bonfire', 2, 2, 'bonfireFurniture', 'Bonfire', 0x6d3e20],
  'definition bridge must satisfy both gameplay and Interior Editor catalog fields');

const children = [];
const scene = {
  add(child) { children.push(child); child.parent = this; },
  getObjectByName(name) { return children.find(child => child.name === name) || null; },
};
const backdrop = api.blackVoidForScene({ scene }, 'map_i_temple');
assert(backdrop, 'interior scene must receive a void backdrop');
assert.strictEqual(backdrop.material.type, 'MeshBasicMaterial', 'void must use an unlit material');
assert.strictEqual(backdrop.material.color.value, 0x000000, 'void must be pure black, not brown');
assert.strictEqual(backdrop.material.fog, false, 'fog must not tint the black void');
assert.strictEqual(backdrop.material.toneMapped, false, 'tone mapping must not alter the black void');
assert.strictEqual(backdrop.userData.unlitBlack, true);
assert.strictEqual(backdrop.raycast(), undefined, 'void backdrop must be ignored by interaction rays');

console.log('interior fire item-key + immediate bonfire + pure-black unlit void regression checks: PASS');
