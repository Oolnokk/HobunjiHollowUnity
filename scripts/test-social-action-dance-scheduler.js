#!/usr/bin/env node
'use strict';

// Regression for the Stage 6 RAF-ownership decomposition:
// social-action-dance-runtime.js's combined frame() loop (hand-rig
// discovery, sentinel maintenance, dance-ownership lifecycle, social
// stimulus emission, and Kurraya wedge UI sync) becomes a single
// RuntimeFrameScheduler registration, since none of it has a render-order
// dependency - the actual dance-over-walk leg/hand pose application
// (applyLegLayer/applyHandLayer) stays entirely inside the sentinel's own
// onBeforeRender hook (renderOrder -99990), untouched by this migration.
// This module is only ever dynamically loaded by character-action-locks.js
// in the shipped game, never by a docs/tools/* editor page, so it needs no
// requestAnimationFrame fallback at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/social-action-dance-runtime.js', 'utf8');
assert(source.includes("global.RuntimeFrameScheduler.register('social-action-dance-state', maintainDanceState"), 'dance-state maintenance must register with the scheduler');
assert(source.includes('applyLegLayer();\n      applyHandLayer();'), 'the actual leg/hand pose application must remain in the onBeforeRender sentinel, not the scheduler callback');
assert(!/global\.requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
}
class BufferGeometry { setAttribute() {} }
class Float32BufferAttribute {}
class MeshBasicMaterial { constructor() { this.colorWrite = true; } }
class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.parent = null; }
  add(child) { child.parent = this; this.children = (this.children || []).concat(child); }
  getWorldPosition(target) { return target.set(0, 0, 0); }
}

function buildFixture() {
  const registered = new Map();
  let dancing = null;
  const player = new Mesh();
  const windowObject = {
    THREE: { Vector3, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh },
    SocialActionWheel: { getDebug() { return { dancing }; } },
    PlayerBodyTransformComposer: { getPlayerMesh() { return player; }, clearChannel() {} },
    SCRATCHBONES_CONFIG: { game: { socialActions: {} } },
    CharacterActionLocks: { getDebug() { return []; }, acquire() { return { release() {} }; } },
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
    setInterval() { return 0; },
  };
  const documentObject = {
    createElement() { return { textContent: '' }; },
    head: { appendChild() {} },
    getElementById() { return null; },
    querySelector() { return null; },
  };
  const sandbox = { window: windowObject, document: documentObject, performance: { now: () => 0 } };
  vm.runInNewContext(source, sandbox, { filename: 'social-action-dance-runtime.js' });
  return { windowObject, registered, player, setDancing: value => { dancing = value; } };
}

// --- Registration shape -----------------------------------------------------
{
  const { registered } = buildFixture();
  const entry = registered.get('social-action-dance-state');
  assert(entry, 'dance-state maintenance registers under a stable id');
  assert.equal(entry.options.owner, 'SocialActionDanceRuntime');
  assert.notEqual(entry.options.phase, 'pre-render', 'dance-state maintenance has no render-order dependency, so it must not claim the pre-render phase');
}

// --- Behavioral equivalence: driving the registered callback attaches the
// sentinel mesh with its onBeforeRender leg/hand layer intact. -----------
{
  const { registered, player } = buildFixture();
  registered.get('social-action-dance-state').fn({ timestamp: 0 });
  assert.equal(player.children?.length, 1, 'the sentinel mesh is attached to the player');
  const sentinel = player.children[0];
  assert.equal(sentinel.renderOrder, -99990);
  assert.equal(typeof sentinel.onBeforeRender, 'function', 'the leg/hand layer application stays in the render-order sentinel');
  assert.doesNotThrow(() => sentinel.onBeforeRender(), 'the sentinel still runs independent of the scheduler when not dancing');
}

// --- Dance ownership lifecycle still transitions from the scheduler callback
{
  const { registered, windowObject, setDancing } = buildFixture();
  windowObject.NpcSocialStimuli = { emit() {}, clear() {} };
  const debugBefore = windowObject.SocialActionDanceRuntime.getDebug();
  assert.equal(debugBefore.movementBlend, false);
  setDancing({ style: 'gentle-twirl', armStyle: 'relaxed' });
  registered.get('social-action-dance-state').fn({ timestamp: 100 });
  const debugDuring = windowObject.SocialActionDanceRuntime.getDebug();
  assert.equal(debugDuring.dancing, true);
  assert.equal(debugDuring.movementBlend, true, 'starting to dance acquires the movement-blend action lock');
  setDancing(null);
  registered.get('social-action-dance-state').fn({ timestamp: 200 });
  const debugAfter = windowObject.SocialActionDanceRuntime.getDebug();
  assert.equal(debugAfter.dancing, false);
  assert.equal(debugAfter.movementBlend, false, 'ending the dance releases the movement-blend action lock');
}

console.log('social action dance state-maintenance scheduler migration passed');
