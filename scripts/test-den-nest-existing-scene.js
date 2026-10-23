#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks live repair of existing fake nests without a locale-renderer dependency.
const fs = require('node:fs'); // Loads the exact production nest owner.
const vm = require('node:vm'); // Exercises cached scenes and existing save counts without a full game boot.
const source = fs.readFileSync('docs/js/den-nest-system.js', 'utf8'); // Includes the public runtime sync and repair helper.
function object(name = '') {
  return { name, userData: {}, position: { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } } };
}
for (const remaining of [0, 1, 3]) {
  const scene = { children: [], add(mesh) { this.children.push(mesh); mesh.parent = this; }, remove(mesh) { this.children = this.children.filter(child => child !== mesh); mesh.parent = null; } }; // Session cache containing an old generated brown box.
  const legacy = { ...object('old_brown_box'), isMesh: true, geometry: { parameters: { width: 2, height: .12, depth: 2 }, dispose() { this.disposed = true; } }, material: { color: { getHex: () => 0x3a2a1a }, dispose() { this.disposed = true; } } }; // Exact marker geometry/material reported by Pixel Probe.
  legacy.position.set(5, .02, 8);
  scene.add(legacy);
  const genotype = { base: { color: '#abcdef' }, sizeClass: 'large' }; // Existing inherited bloodline must survive repair by identity.
  const nest = { col: 4, row: 7, w: 2, h: 2, itemKey: 'nelkBaby', liveBirth: true, remaining, genotype }; // A saved empty clutch must stay empty too.
  if (remaining === 1) nest.mesh = legacy; // Covers an older cached record that explicitly points at its fake mesh.
  let builds = 0; // Confirms per-frame sync does not repeatedly rebuild furniture.
  const context = vm.createContext({ document: { getElementById() {} }, performance, window: { SCRATCHBONES_CONFIG: { game: { livestock: { itemKinds: { nelkBaby: 'nelk' } } } } } }); // Deliberately omits DenLocaleRuntime and AuthoredFurniture.
  vm.runInContext(source, context);
  context.window.DenNestSystem.init({
    _denNests: new Map([['den', nest]]), TILE: 32, getCurrentArea: () => 'den', getActiveScene: () => scene, activeSurfaceYAtWorld: () => -.12,
    buildFurnitureVisual(key, color) { assert.equal(key, 'nest'); assert.equal(color, 0xc9a227); builds++; return object('shared_real_nest'); },
  });
  const first = context.window.DenNestSystem.debugSnapshot(); // Uses the ordinary rendering sync, which also runs through updateNestInteraction.
  assert.equal(first.legacyMarkersReplaced, 1, 'old fake nest is removed without needing the optional locale document');
  assert.equal(scene.children.length, 1);
  assert.equal(scene.children[0], nest.mesh);
  assert.equal(nest.mesh.position.y, -.12, 'replacement uses the existing cave floor rather than floating at zero');
  assert.equal(nest.remaining, remaining, 'repair never regenerates or consumes babies');
  assert.equal(nest.genotype, genotype, 'repair never rerolls inherited genes');
  assert.equal(legacy.geometry.disposed, true);
  assert.equal(legacy.material.disposed, true);
  assert.equal(first.currentNest.remaining, remaining, 'copyable diagnostics expose the exact saved count');
  context.window.DenNestSystem.debugSnapshot();
  assert.equal(builds, 1, 'later frames reuse the repaired mesh');
  context.window.DenNestSystem.ensureCavernNestFurniture({ ...nest, mesh: null, devArenaTestNest: true }, scene);
  assert.equal(builds, 1, 'arena-owned test nest furniture is not duplicated');
}
console.log('Existing fake nests repair without locale loading, preserving empty/partial/full saved clutches and inherited genes.');
