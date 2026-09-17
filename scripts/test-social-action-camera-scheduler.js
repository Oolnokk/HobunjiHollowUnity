#!/usr/bin/env node
'use strict';

// Regression for the Stage 6 RAF-ownership decomposition:
// social-action-camera-runtime.js's combined frame() loop (dance free-cam
// sentinel maintenance + dance-finish baseline cleanup) becomes a single
// RuntimeFrameScheduler registration, since neither responsibility has a
// render-order dependency - the actual per-render camera sample stays
// entirely inside the sentinel's own onBeforeRender hook (renderOrder
// -99970), untouched by this migration. This module is only ever
// dynamically loaded by character-action-locks.js in the shipped game,
// never by a docs/tools/* editor page, so it needs no
// requestAnimationFrame fallback at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/social-action-camera-runtime.js', 'utf8');
assert(source.includes("global.RuntimeFrameScheduler.register('social-action-camera-sentinel', maintainSentinel"), 'sentinel maintenance must register with the scheduler');
assert(source.includes('sampleCamera(camera)'), 'the actual camera sample must remain in the onBeforeRender sentinel, not the scheduler callback');
assert(!/global\.requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = Math.sqrt(this.lengthSq()) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
}
class BufferGeometry { setAttribute() {} }
class Float32BufferAttribute {}
class MeshBasicMaterial { constructor() { this.colorWrite = true; } }
class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.parent = null; }
  add(child) { child.parent = this; this.children = (this.children || []).concat(child); }
}

function buildFixture() {
  const registered = new Map();
  let dancing = null;
  const player = new Mesh();
  const camera = { getWorldDirection(target) { return target.set(0, 0, -1); } };
  const characterViewMode = { enabled: false };
  const actionArcDeps = {
    player: { vx: 0, vy: 0 },
    playerMesh: player,
    characterViewMode,
    setCharacterViewMode(enabled) { characterViewMode.enabled = !!enabled; },
  };
  const windowObject = {
    THREE: { Vector3, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh },
    SocialActionWheel: { getDebug() { return { dancing }; } },
    PlayerBodyTransformComposer: { getPlayerMesh() { return player; } },
    SCRATCHBONES_CONFIG: { game: { socialActions: {} } },
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
  };
  const sandbox = { window: windowObject };
  vm.runInNewContext(source, sandbox, { filename: 'social-action-camera-runtime.js' });
  windowObject.SocialActionCameraRuntime.getDebug(); // Touch state via the public API to exercise it without reaching into module internals.
  return { windowObject, registered, player, actionArcDeps, camera, characterViewMode, setDancing: value => { dancing = value; } };
}

// --- Registration shape -----------------------------------------------------
{
  const { registered } = buildFixture();
  const sentinel = registered.get('social-action-camera-sentinel');
  assert(sentinel, 'sentinel maintenance registers under a stable id');
  assert.equal(sentinel.options.owner, 'SocialActionCameraRuntime');
  assert.notEqual(sentinel.options.phase, 'pre-render', 'sentinel maintenance has no render-order dependency, so it must not claim the pre-render phase');
}

// --- Behavioral equivalence: driving the registered callback attaches the
// sentinel mesh with its onBeforeRender camera sampler intact. ------------
{
  const { registered, player, windowObject } = buildFixture();
  windowObject.ActionArcUI = { init(deps) { return deps; } };
  windowObject.ActionArcUI.init({
    player: { vx: 0, vy: 0 },
    playerMesh: player,
    characterViewMode: { enabled: false },
    setCharacterViewMode() {},
  });
  registered.get('social-action-camera-sentinel').fn();
  assert.equal(player.children?.length, 1, 'the sentinel mesh is attached to the player');
  const sentinel = player.children[0];
  assert.equal(sentinel.renderOrder, -99970);
  assert.equal(typeof sentinel.onBeforeRender, 'function', 'the camera sample stays in the render-order sentinel');
  assert.doesNotThrow(() => sentinel.onBeforeRender(null, null, { getWorldDirection: t => t.set(0, 0, -1) }), 'the sentinel camera sample still runs independent of the scheduler');
}

// --- finishDanceIfNeeded cleanup still runs from the scheduler callback ----
{
  const { registered, windowObject, player, characterViewMode, setDancing } = buildFixture();
  windowObject.ActionArcUI = { init(deps) { return deps; } };
  windowObject.ActionArcUI.init({
    player: { vx: 0, vy: 0 },
    playerMesh: player,
    characterViewMode,
    setCharacterViewMode(enabled) { characterViewMode.enabled = !!enabled; },
  });
  setDancing({ style: 'gentle-twirl', armStyle: 'relaxed' });
  registered.get('social-action-camera-sentinel').fn();
  setDancing(null);
  assert.doesNotThrow(() => registered.get('social-action-camera-sentinel').fn(), 'dance-finish cleanup runs without throwing once dancing ends');
  const debug = windowObject.SocialActionCameraRuntime.getDebug();
  assert.equal(debug.dancing, false);
}

console.log('social action camera sentinel-maintenance scheduler migration passed');
