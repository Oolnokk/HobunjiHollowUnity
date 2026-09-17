#!/usr/bin/env node
'use strict';

// Regression for the Stage 6 RAF-ownership decomposition:
// social-action-body-plane-runtime.js's combined frame() loop (portrait body
// plane discovery + dance body-channel submission) is split into two
// independent RuntimeFrameScheduler registrations. This module is only ever
// dynamically loaded by character-action-locks.js in the shipped game (never
// by a docs/tools/* editor page), so unlike the dual-context hand/procedural
// modules it needs no requestAnimationFrame fallback at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/social-action-body-plane-runtime.js', 'utf8');
assert(source.includes("global.RuntimeFrameScheduler.register('social-action-body-plane-discovery', discoverPlanes"), 'plane discovery must register with the scheduler');
assert(source.includes("global.RuntimeFrameScheduler.register('social-action-body-plane-channel'"), 'dance body-channel submission must register with the scheduler');
assert(source.includes("phase: 'pre-render'"), 'the body-channel submission must be on the pre-render phase');
assert(!/global\.requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

function buildFixture() {
  const registered = new Map();
  const hookedMeshes = [];
  const plane = {
    isMesh: true,
    name: 'avatar_front_plane',
    userData: {},
    geometry: { parameters: {} },
    updateWorldMatrix() { this.worldMatrixUpdates = (this.worldMatrixUpdates || 0) + 1; },
  };
  const player = {
    userData: { portraitModelWidth: 0.9, portraitModelHeight: 0.9 },
    traverse(callback) { callback(plane); },
  };
  let dancing = { style: 'side-step', armStyle: 'relaxed' };
  const channels = new Map();
  const windowObject = {
    SocialActionWheel: { getDebug() { return { dancing }; } },
    PlayerBodyTransformComposer: {
      getPlayerMesh() { return player; },
      setChannel(name, value) { channels.set(name, value); hookedMeshes.push(value); },
      clearChannel(name) { channels.delete(name); },
      getDebug() { return { playerAttached: true, appliedOrder: [], lastRender: { appliedOrder: [] } }; },
    },
    SCRATCHBONES_CONFIG: { game: { socialActions: { danceBpm: 104, danceGroove: 72 } } },
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
  };
  const sandbox = { window: windowObject, performance: { now: () => 0 } };
  vm.runInNewContext(source, sandbox, { filename: 'social-action-body-plane-runtime.js' });
  return { windowObject, registered, plane, channels, setDancing: value => { dancing = value; } };
}

// --- Registration shape -----------------------------------------------------
{
  const { registered } = buildFixture();
  const discovery = registered.get('social-action-body-plane-discovery');
  const channel = registered.get('social-action-body-plane-channel');
  assert(discovery, 'plane discovery registers under a stable id');
  assert(channel, 'dance body-channel submission registers under a stable id');
  assert.notEqual(discovery.options.phase, 'pre-render', 'plane discovery has no render-order dependency, so it must not share the pre-render phase');
  assert.equal(channel.options.phase, 'pre-render');
  assert.equal(discovery.options.owner, 'SocialActionBodyPlaneRuntime');
  assert.equal(channel.options.owner, 'SocialActionBodyPlaneRuntime');
}

// --- Behavioral equivalence --------------------------------------------------
{
  const { registered, plane, channels } = buildFixture();
  registered.get('social-action-body-plane-discovery').fn();
  assert.equal(typeof plane.onBeforeRender, 'function', 'discovery hooks the portrait plane with the matrixWorld sync sentinel');
  registered.get('social-action-body-plane-channel').fn({ timestamp: 0 });
  assert(channels.has('social-dance'), 'the dance body channel is submitted with fresh gameplay state');
  registered.get('social-action-body-plane-channel').fn({ timestamp: 500 });
  assert.equal(channels.size, 1, 'repeated submissions update the same channel key');
}

// --- The render-order sentinel installed by discovery stays untouched ------
{
  const { registered, plane, setDancing } = buildFixture();
  registered.get('social-action-body-plane-discovery').fn();
  setDancing({ style: 'gentle-twirl', armStyle: 'relaxed' });
  plane.onBeforeRender();
  assert.equal(plane.worldMatrixUpdates, 1, 'the onBeforeRender sentinel still refreshes matrixWorld while dancing, independent of the scheduler');
}

console.log('social action body plane discovery/channel scheduler split passed');
