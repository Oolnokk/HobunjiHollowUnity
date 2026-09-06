#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync('docs/js/livestock-harvest-staging.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/character-action-locks.js', 'utf8');
const farmSource = fs.readFileSync('docs/js/farm-animals.js', 'utf8');
assert.match(loaderSource, /livestock-harvest-staging\.js\?v=20260906harvest1/, 'the shared interaction loader includes the harvest staging bridge before gameplay boots');
assert.match(farmSource, /const HARVEST_TRANSITION_S = 0\.35;/, 'the staging bridge transition duration stays aligned with FarmAnimals');
assert.match(farmSource, /const HARVEST_ACTIVE_DURATION_S = 2;/, 'the staging bridge active duration stays aligned with FarmAnimals');

const sandbox = {
  console,
  Date,
  Math,
  WeakMap,
  WeakSet,
  Object,
  performance: { now: () => 1000 },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(runtimeSource, sandbox, { filename: 'livestock-harvest-staging.js' });

const animals = new Set();
const player = { x: 10, y: 20 };
const faceTarget = () => ({ x: 10, z: 10, worldY: 1.5 });
const deps = {
  animalObjects: animals,
  player,
  TILE: 48,
  getGrid: () => [[{ type: 'grass' }, { type: 'grass' }, { type: 'grass' }], [{ type: 'grass' }, { type: 'grass' }, { type: 'grass' }], [{ type: 'grass' }, { type: 'grass' }, { type: 'grass' }]],
  tileSurfaceY: () => 0.2,
  getPlayerFaceTarget: faceTarget,
};

let harvesting = true;
let originalHarvestCalls = 0;
const api = {
  init() {},
  isHarvesting: () => harvesting,
  updateHarvestInteraction(dt) {
    originalHarvestCalls++;
    if (originalHarvestCalls === 1) {
      player.x = 70;
      player.y = 90;
    }
    return dt;
  },
};
sandbox.window.FarmAnimals = api;
api.init(deps);

const seenFaceTargets = [];
const group = {
  position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  rotation: { y: 0.75 },
};
const animal = {
  id: 'animal-test',
  livestockId: 'livestock-test',
  animalKey: 'gar-wolf',
  col: 2,
  row: 2,
  targetCol: 2,
  targetRow: 2,
  wx: 2.1,
  wy: 0.4,
  wz: 2.2,
  halfHeight: 0.3,
  groupRot: 0.75,
  avatarRef: { group },
  update() {
    const target = deps.getPlayerFaceTarget();
    seenFaceTargets.push(target);
    if (target) this.groupRot = 3.0;
  },
  _harvestFrozen: true,
};
animals.add(animal);

api.updateHarvestInteraction(0.35);
animal.update(1 / 60);

assert.equal(originalHarvestCalls, 1, 'canonical FarmAnimals harvest update still runs');
assert.equal(animal.wx, 2.5, 'livestock reaches its stable target-tile X anchor by the end of the in transition');
assert.equal(animal.wz, 2.5, 'livestock reaches its stable target-tile Z anchor by the end of the in transition');
assert.equal(animal.wy, 0.5, 'livestock reaches the destination tile surface with its existing ground lift');
assert.equal(group.position.x, 2.5, 'rendered livestock group receives the staged X position');
assert.equal(group.position.z, 2.5, 'rendered livestock group receives the staged Z position');
assert.equal(animal.groupRot, 0.75, 'harvest staging preserves the pre-interaction animal facing');
assert.equal(group.rotation.y, 0.75, 'rendered body rotation stays on the authored harvest facing');
assert.equal(seenFaceTargets.at(-1), null, 'the ordinary player-approach face target is suppressed during harvest rendering');
assert.equal(deps.getPlayerFaceTarget, faceTarget, 'the ordinary face target dependency is restored immediately after the harvest frame');
assert.equal(player.x, 70 + (2.5 - 2.1) * 48, 'player receives the same X translation as the staged animal');
assert.equal(player.y, 90 + (2.5 - 2.2) * 48, 'player receives the same Z translation as the staged animal');

const activePlayerX = player.x;
const activePlayerY = player.y;
api.updateHarvestInteraction(0.1);
assert.equal(player.x, activePlayerX, 'the active harvest hold does not accumulate the same player X correction every frame');
assert.equal(player.y, activePlayerY, 'the active harvest hold does not accumulate the same player Y correction every frame');

const debug = sandbox.window.LivestockHarvestStaging.getDebug();
assert.equal(debug.active.phase, 'active', 'debug state exposes the current harvest phase without devtools');
assert.equal(debug.active.playerApproachSuppressed, true, 'debug state explicitly reports approach suppression');

harvesting = false;
animal._harvestFrozen = false;
api.updateHarvestInteraction(0.01);
animal.update(0.01);
assert.equal(sandbox.window.LivestockHarvestStaging.getDebug().active, null, 'staging state is cleaned up when the harvest ends');

console.log('Livestock harvest staging regression checks passed.');
