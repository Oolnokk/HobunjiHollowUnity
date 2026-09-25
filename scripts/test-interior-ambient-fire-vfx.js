#!/usr/bin/env node
'use strict';

// Regression for the Stage 2 RAF-ownership migration: interior-fire-floor-runtime.js
// used to start a private RAF only while ambient fire/candle emitter records
// existed, and stop it (by simply not rescheduling) once none remained. It
// now registers once with the shared RuntimeFrameScheduler and toggles
// setEnabled() instead (see docs/architecture/runtime-frame-scheduler.md),
// preserving the "zero work when no fires exist" behavior.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/interior-fire-floor-runtime.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'interior ambient fire VFX must no longer own a direct requestAnimationFrame( call site');
assert(source.includes("window.RuntimeFrameScheduler.register(AMBIENT_SCHEDULER_ID, ambientTick"), 'ambientTick must be registered with the shared scheduler');
assert(source.includes('setEnabled(AMBIENT_SCHEDULER_ID, false)'), 'the tick must disable itself once no ambient records remain');
assert(source.includes('setEnabled(AMBIENT_SCHEDULER_ID, true)'), 'attaching a new ambient emitter must enable the subscriber');

function buildContext() {
  const registered = new Map();
  const setEnabledCalls = [];
  const visuals = [];

  function makeVisual() {
    const v = { updates: [], disposed: false, update(dt, ambient) { v.updates.push({ dt, ambient }); }, dispose() { v.disposed = true; } };
    visuals.push(v);
    return v;
  }

  const context = {
    console,
    Math, Number, Object, Array, Set, WeakMap, WeakSet, String, JSON, Promise,
    window: null,
    performance: { now: () => 0 },
    setTimeout() {}, // The module's one-shot late-init retries are irrelevant to this ambient-VFX-only test.
  };
  context.window = context;
  context.RuntimeFrameScheduler = {
    register(id, fn, options) { registered.set(id, { fn, options }); },
    setEnabled(id, enabled) { setEnabledCalls.push({ id, enabled }); const r = registered.get(id); if (r) r.options.enabled = enabled; },
  };
  context.THREE = { TextureLoader: function () { return { load() {} }; }, RepeatWrapping: 1, SRGBColorSpace: 1 };
  context.ProceduralFurniture = {
    CATALOG: {},
    buildFurnitureGroup(key, color) { return { key, color, parent: null, userData: {} }; },
  };
  const authoredData = {
    campfire: { key: 'campfire', particleEmitters: [{ id: 'flame', enabled: true }] },
    hearth: { key: 'hearth', particleEmitters: [{ id: 'hearth_fire', enabled: true, attachedPartId: 'hearth_ash' }] },
  };
  context.AuthoredFurniture = {
    load: key => Promise.resolve(authoredData[key] || null),
    buildGroup: () => null,
    peek: key => authoredData[key] || null,
    createEmitterVisual: (group, emitter) => makeVisual(),
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'interior-fire-floor-runtime.js' });
  return { context, registered, setEnabledCalls, visuals };
}

const { context, registered, setEnabledCalls, visuals } = buildContext();

const entry = registered.get('interior-ambient-vfx');
assert(entry, 'ambientTick registers with the scheduler under a stable id');
assert.equal(entry.options.enabled, false, 'starts disabled since no ambient furniture exists yet at module load');
assert.equal(entry.options.owner, 'InteriorFireFloorRuntime');

// Placing a campfire (an AMBIENT_FIRE_KEYS member) with cached authored data
// must attach a live emitter and enable the scheduler subscriber, exactly
// like the old ensureAmbientLoop()'s first requestAnimationFrame(ambientTick).
const group = context.ProceduralFurniture.buildFurnitureGroup('campfire', 0x6d3e20);
assert.equal(entry.options.enabled, true, 'attaching the first ambient emitter enables the subscriber');
assert.equal(visuals.length, 1, 'one particle visual was created for the campfire flame emitter');


// A farmstead/interior hearth commonly starts as a procedural fallback while
// its authored JSON resolves. A part-bound flame must NOT be parented to that
// temporary root, because its hearth_ash mesh does not exist yet.
const hearthGroup = context.ProceduralFurniture.buildFurnitureGroup('hearth', 0x5a4a3a);
assert.equal(visuals.length, 1, 'part-bound hearth flame waits instead of attaching to the procedural fallback root');
assert.equal(hearthGroup.userData.hobunjiAmbientFurnitureVfxPendingKey, 'hearth', 'deferred hearth records the ambient key for diagnostics');

// FurnitureVesselRuntime installs meshById, then calls onAuthoredFurnitureReady.
// The retry must now attach exactly once to the finished authored furniture.
hearthGroup.userData.meshById = new Map([['hearth_ash', {}]]);
context.InteriorFireFloorRuntime.onAuthoredFurnitureReady(
  hearthGroup,
  { key: 'hearth', particleEmitters: [{ id: 'hearth_fire', enabled: true, attachedPartId: 'hearth_ash' }] },
  'hearth',
);
assert.equal(visuals.length, 2, 'authored-upgrade notification attaches the deferred hearth flame exactly once');
assert.equal(hearthGroup.userData.hobunjiAmbientFurnitureVfxPendingKey, undefined, 'successful authored attachment clears the pending marker');
assert.equal(hearthGroup.userData.hobunjiAmbientFurnitureVfxKey, 'hearth', 'hearth group records its live ambient VFX key');

// Simulate the furniture actually being placed into a scene (has a parent).
group.parent = {};

const tick = entry.fn;
tick({ timestamp: 16 });
assert.equal(visuals[0].updates.length, 1, 'the scheduled tick updates the attached emitter visual once');
assert.equal(visuals[0].disposed, false, 'an attached emitter is not disposed while still in the scene');
assert.equal(entry.options.enabled, true, 'the subscriber stays enabled while a live emitter remains');

// Removing the furniture from the scene (no parent) and letting the tick
// observe that must eventually dispose the record and disable the
// subscriber, matching "zero work when no fires exist".
group.parent = null;
tick({ timestamp: 32 }); // wasAttached is now true, so losing the parent disposes immediately (no TTL wait needed once it was ever attached).
assert.equal(visuals[0].disposed, true, 'losing its scene parent after having been attached disposes the emitter record');
assert.equal(entry.options.enabled, false, 'the subscriber disables itself once no ambient records remain');
assert.equal(setEnabledCalls.filter(c => c.id === 'interior-ambient-vfx').length >= 2, true, 'setEnabled toggled at least once on and once off across the lifecycle');

console.log('interior ambient fire VFX scheduler migration passed');
