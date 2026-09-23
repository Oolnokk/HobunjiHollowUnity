#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies Burning Health presentation uses the authored furniture emitter without changing affliction damage.
const fs = require('node:fs'); // Reads the shipped Burning Health VFX module.
const vm = require('node:vm'); // Executes the browser module against a minimal scheduler/furniture fixture.

const source = fs.readFileSync('docs/js/combat/burning-affliction-vfx.js', 'utf8'); // Exact runtime source under test.
let schedulerRecord = null; // Captures the one shared frame-scheduler subscriber installed by the module.
let schedulerEnabled = false; // Tracks whether live flames correctly wake/sleep their scheduler owner.
let createdEmitter = null; // Captures the authored campfire emitter cloned onto the afflicted avatar.
let updates = 0; // Counts presentation-only particle ticks.
let disposals = 0; // Counts flame disposal after extinguish/despawn.
const burning = new WeakMap(); // Test-owned affliction values returned through the real public API shape.

const campfireData = {
  particleEmitters: [
    {
      id: 'campfire_fire', name: 'Campfire Flames', type: 'fire', enabled: true,
      attachedPartId: 'campfire_ash',
      position: { x: 0, y: 0.17, z: 0 },
      radius: 0.13, size: 0.19, rate: 38, lifetime: 0.72,
      speed: 0.7, spread: 0.3, gravity: -0.05,
      colorA: '#ffd45a', colorB: '#ff3d12',
    },
    { id: 'campfire_smoke', type: 'smoke', enabled: true },
  ],
};

const windowStub = {
  RuntimeFrameScheduler: {
    register(id, callback, options) {
      schedulerRecord = { id, callback, options };
      return schedulerRecord;
    },
    setEnabled(id, enabled) {
      assert.equal(id, 'burning-affliction-vfx');
      schedulerEnabled = !!enabled;
    },
  },
  AuthoredFurniture: {
    peek(key) {
      assert.equal(key, 'campfire');
      return campfireData;
    },
    load: async key => {
      assert.equal(key, 'campfire');
      return campfireData;
    },
    createEmitterVisual(group, emitter, maxParticles) {
      createdEmitter = { group, emitter, maxParticles };
      return {
        update(dt, active) {
          assert(dt > 0 && dt <= 0.05, 'particle update receives a capped positive scheduler delta');
          assert.equal(active, true);
          updates++;
        },
        dispose() { disposals++; },
      };
    },
  },
  ResourceSystem: {
    getAffliction(entity, id) {
      assert.equal(id, 'burningHealth');
      return burning.get(entity) || 0;
    },
  },
  Combat: { deps: {} },
};
const context = {
  console,
  Math,
  Date,
  Number,
  Object,
  Set,
  WeakMap,
  Promise,
  JSON,
  performance: { now: () => 1000 },
  window: windowStub,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'burning-affliction-vfx.js' });

const api = windowStub.BurningAfflictionVfx;
assert(api?.installed, 'Burning Health VFX module registers its public API');
assert.equal(schedulerRecord?.id, 'burning-affliction-vfx', 'module owns one stable shared scheduler subscriber');
assert.equal(schedulerRecord?.options?.phase, 'post-game', 'particle presentation updates after gameplay resource ticks');
assert.equal(schedulerRecord?.options?.enabled, false, 'scheduler stays asleep until a Burning Health entity exists');

const entity = { id: 'burn-test' }; // Afflicted actor fixture used by syncEntity.
const group = { userData: {}, parent: {} }; // Minimal THREE-like avatar root accepted by the authored emitter factory.
burning.set(entity, 30);
assert.equal(api.syncEntity(entity, group), true, 'positive Burning Health attaches a flame immediately when the campfire emitter is cached');
assert.equal(schedulerEnabled, true, 'first active flame wakes the shared scheduler');
assert.equal(createdEmitter.group, group, 'fire emitter is parented to the afflicted avatar root');
assert.equal(createdEmitter.emitter.id, 'burning_health_fire', 'runtime clone gets a dedicated diagnostic emitter id');
assert.equal(createdEmitter.emitter.type, 'fire', 'the selected authored furniture emitter is the fire emitter');
assert.equal(createdEmitter.emitter.attachedPartId, undefined, 'campfire-only ash attachment is removed for character roots');
assert.equal(createdEmitter.emitter.rate, 38, 'authored campfire flame tuning is reused instead of duplicated');
assert.equal(createdEmitter.maxParticles, 40, 'Burning presentation retains the lightweight authored emitter cap');

schedulerRecord.callback({ timestamp: 1016, deltaMs: 16 });
assert.equal(updates, 1, 'active Burning Health advances the authored particle visual once per scheduler frame');

burning.set(entity, 0);
schedulerRecord.callback({ timestamp: 1032, deltaMs: 16 });
assert.equal(disposals, 1, 'flame is disposed as soon as Burning Health reaches zero');
assert.equal(schedulerEnabled, false, 'scheduler sleeps after the last flame is extinguished');
assert.equal(api.debugSnapshot().activeEntities, 0, 'mobile debug snapshot reports no lingering Burning VFX');

burning.set(entity, 12);
api.syncEntity(entity, group);
assert.equal(api.debugSnapshot().activeEntities, 1, 'reapplying Burning Health can attach a fresh flame');
api.disposeEntity(entity);
assert.equal(disposals, 2, 'explicit entity despawn cleanup disposes its flame');
assert.equal(api.debugSnapshot().activeEntities, 0, 'despawn cleanup leaves no active VFX records');

console.log('Burning Health authored fire-emitter regression passed');
