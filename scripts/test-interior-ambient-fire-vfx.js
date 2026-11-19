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

function buildContext(withScheduler = true) {
  const registered = new Map();
  const setEnabledCalls = [];
  const visuals = [];
  const emitterCalls = []; // Captures real emitter arguments for batched canonical fire regression checks.

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
  const scheduler = { // Actual in-game scheduler API; optional to emulate the standalone Interior Editor.
    register(id, fn, options) { registered.set(id, { fn, options }); },
    setEnabled(id, enabled) { setEnabledCalls.push({ id, enabled }); const r = registered.get(id); if (r) r.options.enabled = enabled; },
  };
  if (withScheduler) context.RuntimeFrameScheduler = scheduler;
  context.THREE = { TextureLoader: function () { return { load() {} }; }, RepeatWrapping: 1, SRGBColorSpace: 1 };
  context.ProceduralFurniture = {
    CATALOG: {},
    buildFurnitureGroup(key, color) { return { key, color, parent: null, userData: {} }; },
  };
  const authoredData = {
    campfire: { key: 'campfire', particleEmitters: [{ id: 'flame', type: 'fire', enabled: true, size: .19, rate: 38, speed: .7, radius: .13, spread: .3, gravity: -.05, lifetime: .72, colorA: '#ffd45a', colorB: '#ff3d12' }] },
    hearth: { key: 'hearth', particleEmitters: [{ id: 'hearth_fire', enabled: true, attachedPartId: 'hearth_ash' }] },
  };
  context.AuthoredFurniture = {
    load: key => Promise.resolve(authoredData[key] || null),
    buildGroup: () => null,
    peek: key => authoredData[key] || null,
    createEmitterVisual: (group, emitter, capacity) => { emitterCalls.push({ group, emitter, capacity }); return makeVisual(); },
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'interior-fire-floor-runtime.js' });
  return { context, registered, setEnabledCalls, visuals, scheduler, emitterCalls };
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

// Simulate both furniture groups actually being placed into a scene (have parents).
group.parent = {};
hearthGroup.parent = {};

const tick = entry.fn;
tick({ timestamp: 16 });
assert.equal(visuals[0].updates.length, 1, 'the scheduled tick updates the attached emitter visual once');
assert.equal(visuals[0].disposed, false, 'an attached emitter is not disposed while still in the scene');
assert.equal(entry.options.enabled, true, 'the subscriber stays enabled while a live emitter remains');

// Tzizkhanash is an outdoor exception: individual placed fire pieces should follow
// real weather, without mutating indoor candle tables or deleting emitters on rain.
let raining = true;
context.WeatherFX = { isRaining: () => raining };
group.userData.festivalWeatherFire = true;
group.userData.mapEditorAux = { light: { intensity: 1.35 } };
tick({ timestamp: 19 });
assert.equal(visuals[0].updates.at(-1).ambient, false, 'festival flame stops spawning during rain');
assert.equal(group.userData.mapEditorAux.light.intensity, 0, 'rain turns off the linked campfire light');
assert(context.InteriorFireFloorRuntime.debugSnapshot().suppressedFestivalFlames > 0, 'mobile debug includes suppressed fires');
raining = false;
tick({ timestamp: 23 });
assert.equal(visuals[0].updates.at(-1).ambient, true, 'clearing weather relights the very same emitter');
assert.equal(group.userData.mapEditorAux.light.intensity, 1.35, 'linked light restores its previous brightness');


// Removing the furniture from the scene (no parent) and letting the tick
// observe that must eventually dispose the record and disable the
// subscriber, matching "zero work when no fires exist".
group.parent = null;
hearthGroup.parent = null;
tick({ timestamp: 32 }); // wasAttached is now true, so losing the parent disposes immediately (no TTL wait needed once it was ever attached).
assert.equal(visuals[0].disposed, true, 'losing its scene parent after having been attached disposes the emitter record');
assert.equal(entry.options.enabled, false, 'the subscriber disables itself once no ambient records remain');
assert.equal(setEnabledCalls.filter(c => c.id === 'interior-ambient-vfx').length >= 2, true, 'setEnabled toggled at least once on and once off across the lifecycle');

// A house or inventory wall torch may be assembled independently of an ordinary
// furniture catalog entry: its real tilted tip still gets the player's campfire
// particle VFX, and the same ambient subscriber disposes it on removal.
const torchAnchor = {}; // The authored-furniture runtime positions this under the handheld sprite pivot.
const replacementAnchor = {}; // Simulates a newly authored sprite replacing a provisional procedural fallback.
const torchVisuals = []; // Tracks every emitter to ensure a replacement disposes its predecessor exactly once.
let torchOpts = null; // Confirm a size-only adaptation, not a new flame renderer.
context.PersistentGroundFire = {
  attachCampfireFlame(anchor, options) {
    assert([torchAnchor, replacementAnchor].includes(anchor), 'fire only attaches to one of the live torch tip anchors');
    torchOpts = options;
    const visual = { anchor, updates: [], disposed: false, update(dt, lit) { this.updates.push({ dt, lit }); }, dispose() { this.disposed = true; } };
    torchVisuals.push(visual);
    return visual;
  },
};
const torchGroup = { userData: { wallTorchFireAnchor: torchAnchor }, parent: {} };
context.InteriorFireFloorRuntime.onAuthoredFurnitureReady(torchGroup, null, 'wallTorch');
assert(torchOpts && torchOpts.scale > 0 && torchOpts.rateScale > 0, 'wall torch asks the existing campfire VFX renderer for a smaller flame');
assert.equal(context.InteriorFireFloorRuntime.debugSnapshot().lastAmbientKey, 'wallTorch', 'mobile ambient snapshot identifies torches');
tick({ timestamp: 40 });
assert.equal(torchVisuals[0].updates.length, 1, 'wall torch receives the same scheduler update as all ambient flames');
torchGroup.userData.wallTorchFireAnchor = replacementAnchor;
context.InteriorFireFloorRuntime.onAuthoredFurnitureReady(torchGroup, null, 'wallTorch');
assert.equal(torchVisuals.length, 2, 'upgrading a fallback torch rebinds its flame to the newly authored tip');
assert.equal(torchVisuals[0].disposed, true, 'the orphaned fallback-anchor emitter is disposed on upgrade');
assert.equal(torchVisuals[1].anchor, replacementAnchor, 'the replacement uses the new authored tip rather than the removed sprite');
assert.equal(context.InteriorFireFloorRuntime.debugSnapshot().ambientGroups, 1, 'a live torch upgrade must keep only one ambient record');
context.InteriorFireFloorRuntime.onAuthoredFurnitureReady(torchGroup, null, 'wallTorch');
assert.equal(torchVisuals.length, 2, 'repeat notifications for the same tip never double-attach flames');
tick({ timestamp: 50 });
assert.equal(torchVisuals[1].updates.length, 1, 'the live replacement flame receives scheduled ticks');
torchGroup.parent = null;
tick({ timestamp: 56 });
assert.equal(torchVisuals[1].disposed, true, 'removing the upgraded torch disposes its live campfire emitter');
assert.equal(entry.options.enabled, false, 'torch removal releases the ambient subscriber when no other flames remain');

// The stand-alone interior editor may load furniture before the game scheduler.
// It must still boot, author floor/furniture and attach later when a scheduler appears.
const standalone = buildContext(false);
assert.equal(standalone.context.InteriorFireFloorRuntime.installed, true, 'standalone editor boots without a frame scheduler');
assert.equal(standalone.registered.size, 0, 'no attempt to register against an absent scheduler');
standalone.context.ProceduralFurniture.buildFurnitureGroup('campfire', 0x6d3e20);
assert.equal(standalone.visuals.length, 1, 'editor can build fire furniture without a scheduler');
standalone.context.RuntimeFrameScheduler = standalone.scheduler;
standalone.context.ProceduralFurniture.buildFurnitureGroup('campfire', 0x6d3e20);
assert(standalone.registered.has('interior-ambient-vfx'), 'later scheduler is registered when a new visual needs animation');
assert.equal(standalone.registered.get('interior-ambient-vfx').options.enabled, true, 'late-registered scheduler starts the existing emitters');
console.log('interior ambient fire VFX scheduler migration and scheduler-free editor startup passed');

// The numerous festival candle clusters retain one GPU particle emitter per
// 16-wick cluster, but the emitter must now be the real authored CAMPFIRE source.
(async function checkCanonicalBatchedCandleFlames() {
  const clustered = buildContext();
  const key = 'candleCluster';
  const parts = Array.from({ length: 16 }, (_, index) => ({
    id: 'wax_' + index,
    transform: { x: (index % 4) * .1, y: .3, z: Math.floor(index / 4) * .1, sy: .18 },
  }));
  const emitters = parts.map((part, index) => ({
    id: 'candle_' + index, type: 'fire', enabled: true,
    attachedPartId: part.id, size: .047,
  }));
  const group = { parent: {}, userData: { meshById: new Map(parts.map(part => [part.id, {}])) } };
  clustered.context.InteriorFireFloorRuntime.onAuthoredFurnitureReady(group, { key, parts, particleEmitters: emitters }, key);
  await Promise.resolve(); await Promise.resolve(); // Allow the actual authored campfire load and visual creation to settle.
  assert.equal(clustered.emitterCalls.length, 1, 'sixteen candle tips use exactly one authored emitter instance');
  const { emitter, capacity } = clustered.emitterCalls[0];
  assert.equal(emitter.type, 'fire', 'cluster source is the campfire flame rather than a one-off Points renderer');
  assert.equal(emitter.emissionOrigins.length, 16, 'all editable candle tips are present in the batched source');
  assert.deepEqual([emitter.colorA, emitter.colorB], ['#ffd45a', '#ff3d12'], 'cluster uses the normal campfire flame palette');
  assert(capacity <= 55, 'particle capacity remains close to the prior 48-particle budget');
  const fxTick = clustered.registered.get('interior-ambient-vfx').fn;
  fxTick({ timestamp: 20 });
  assert.equal(clustered.visuals[0].updates.length, 1, 'the shared ambient subscriber advances the canonical candle emitter');
  group.parent = null;
  fxTick({ timestamp: 40 });
  assert.equal(clustered.visuals[0].disposed, true, 'cluster cleanup disposes its shared authored emitter');
  console.log('canonical campfire wall-torch and batched candle-cluster VFX passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
