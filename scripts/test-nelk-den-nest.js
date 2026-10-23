#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies the production cavern setup and authored nest upgrade.
const fs = require('node:fs'); // Reads the same configuration and runtime files shipped to players.
const vm = require('node:vm'); // Executes the cavern setup without starting the full game.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Supplies the real building-scene nest creation block.
const start = game.indexOf('            if (Number.isFinite(mapData.nestCol)'); // Selects the complete cavern nest setup.
const end = game.indexOf('            // A "bigger, tunnely" den', start); // Excludes unrelated ore and corridor population setup.
assert(start > 0 && end > start, 'production cavern nest setup is present');
const nestSource = game.slice(start, end); // Runs existing production logic rather than a copy of its behavior.

function vector() {
  return { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } };
}

function object() {
  return { position: vector(), rotation: vector(), scale: vector(), userData: {}, updateMatrixWorld() {} };
}

function scene() {
  return {
    children: [],
    add(child) { this.children.push(child); child.parent = this; },
    remove(child) { this.children = this.children.filter(entry => entry !== child); child.parent = null; },
  };
}

async function main() {
  const context = vm.createContext({ console, Math, Promise, performance, document: { getElementById() {} } }); // Browser globals used by nest diagnostics and locale rendering.
  context.window = context;
  vm.runInContext(fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'), context);
  context.DEN_MOTHER_DEFS = context.SCRATCHBONES_CONFIG.game.wildlife.denMothers;
  context.DEN_MOTHER_ITEM_KEYS = Object.fromEntries(Object.values(context.DEN_MOTHER_DEFS).map(def => [def.creatureKey, def.nestItemKey]));
  assert.equal(context.DEN_MOTHER_ITEM_KEYS.nelk, 'nelkBaby', 'hatchling reward exists before game.js snapshots the mother registry');
  assert.equal(context.SCRATCHBONES_CONFIG.game.livestock.itemKinds.nelkBaby, 'nelk', 'farm and stable resolve the hatchling to Nelk');
  assert.equal(JSON.parse(fs.readFileSync('docs/config/items/item-index.json')).nelkBaby.cat, 'livestock');

  context.CREATURE_DB = { nelk: { liveBirth: false }, 'gar-wolf-den-mother': { liveBirth: true }, 'uumkaoii-wild-den-mother': { liveBirth: false }, unrewarded: {} };
  context.mapId = 'map_i_nelk_test';
  context.mapData = { nestCol: 4, nestRow: 7, denMotherKind: 'nelk' };
  context._denNests = new Map();
  context.bScene = scene();
  context.bGrid = [];
  context.cols = context.rows = 20;
  context.TILE = 32;
  context.hostileObjects = new Set();
  context.makeCreatureEntity = (kind, x, y, options) => ({ creatureKey: kind, x, y, ...options });
  context.WildernessMapGenerator = { makeRng: () => () => 0.99 };
  context.WildlifeSpawn = { denGenotypeFamily: () => 'nelk', getOrMakeDenGenotype: () => ({ sizeClass: 'medium' }) };
  context.THREE = {
    MeshBasicMaterial: class { constructor({ color }) { this.color = { getHex: () => color }; } },
    BoxGeometry: class { constructor(width, height, depth) { this.parameters = { width, height, depth }; } },
    Mesh: class { constructor(geometry, material) { Object.assign(this, object(), { geometry, material, isMesh: true }); } },
  };
  vm.runInContext(nestSource, context);
  const nest = context._denNests.get(context.mapId); // The live record is also the locale renderer's source of truth.
  assert.equal(nest.itemKey, 'nelkBaby');
  assert.equal(nest.liveBirth, true, 'egg-laying Nelk nests present already-hatched babies');
  assert.equal(context.CREATURE_DB.nelk.liveBirth, false, 'adult egg production metadata is unchanged');
  assert.equal(nest.remaining, 3, 'uncollected existing caves receive their deterministic configured clutch');
  assert.equal(context.hostileObjects.size, 1, 'mother still spawns');

  vm.runInContext(fs.readFileSync('docs/js/den-nest-system.js', 'utf8'), context);
  context.DenNestSystem.init({ _denNests: context._denNests, TILE: 32, activeSurfaceYAtWorld: () => 0, getCurrentArea: () => context.mapId, getActiveScene: () => context.bScene });
  const pending = context.DenNestSystem.debugSnapshot(); // Existing mobile diagnostics must resolve every Nelk record as a baby.
  assert.equal(pending.babyRecords.length, 3);
  assert.equal(pending.lastBabyKind, 'nelk');
  assert(pending.babyRecords.every(record => record.stage === 'waiting-metadata'), 'hatchlings enter the shared baby avatar renderer');

  const locale = JSON.parse(fs.readFileSync('docs/config/locales/locale_den_mother_nest.json')); // Real authored basket and clutch transforms.
  context.fetch = async () => ({ ok: true, json: async () => locale });
  context.AuthoredFurniture = {
    load: async () => ({ key: 'nest' }),
    buildGroup: () => ({ ...object(), name: 'authored_nest' }),
  };
  vm.runInContext(fs.readFileSync('docs/js/den-locale-runtime.js', 'utf8'), context);
  context.DenNestSystem.init({ _denNests: context._denNests, _buildingScenes: new Map([[context.mapId, { scene: context.bScene }]]), getCurrentArea: () => context.mapId });
  await context.DenLocaleRuntime.ready;
  context.DenLocaleRuntime.syncCurrentDen();
  await Promise.resolve();
  assert(context.bScene.children.some(child => child.userData.denLocaleFurniture), 'Nelk nest upgrades to the proper authored mesh');
  assert(!context.bScene.children.some(child => child.isMesh), 'brown placeholder is removed');

  context.mapData.nestState = { remaining: 1 };
  vm.runInContext(nestSource, context);
  assert.equal(context._denNests.get(context.mapId).remaining, 1, 'partially collected clutch survives revisits');
  context.mapData.nestState.remaining = 0;
  context.mapData.denMotherDefeated = true;
  vm.runInContext(nestSource, context);
  assert.equal(context._denNests.get(context.mapId).remaining, 0, 'empty saved clutch is never refilled');
  assert.equal(context.hostileObjects.size, 2, 'defeated mother is not respawned');

  for (const marker of context.bScene.children.filter(child => child.isMesh)) context.bScene.remove(marker); // Discard placeholders from the simulated intervening scene rebuilds.
  context.mapData.denMotherKind = 'unrewarded';
  vm.runInContext(nestSource, context);
  assert.equal(context._denNests.get(context.mapId).remaining, 0, 'unrewarded species cannot create undefined pickups');
  assert.equal(context._denNests.get(context.mapId).nestFurnitureKey, 'nest', 'unrewarded nests still reach the authored mesh renderer');
  context.DenLocaleRuntime.syncCurrentDen();
  await Promise.resolve();
  assert(!context.bScene.children.some(child => child.isMesh), 'unrewarded nest placeholder is also replaced');

  context.mapData.nestState = null;
  for (const [kind, liveBirth] of [['gar-wolf-den-mother', true], ['uumkaoii-wild-den-mother', false]]) {
    context.mapData.denMotherKind = kind;
    vm.runInContext(nestSource, context);
    assert.equal(context._denNests.get(context.mapId).liveBirth, liveBirth, `${kind} retains its existing baby/egg presentation`);
  }
  console.log('Nelk hatchling registration, baby renderer resolution, authored nest mesh, saved clutch counts, and legacy egg/baby nests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
