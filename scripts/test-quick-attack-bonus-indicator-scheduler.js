#!/usr/bin/env node
'use strict';

// Regression for the Stage 5 RAF-ownership migration: QuickAttackBonusIndicator
// was the scheduler's sole documented temporary-order-exception (its
// historical RAF had to run before gameLoop, via independent
// requestAnimationFrame registration order). Now that
// scripts/test-runtime-frame-scheduler-ordering.js proves the scheduler's
// pre-game/post-game phase contract, it registers as a 'pre-game' phase
// subscriber instead of owning a private RAF — this is the first real
// dependent of that contract, not just a relabeling.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/quick-attack-bonus-indicator.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'Quick Attack must no longer own a direct requestAnimationFrame( call site');
assert(source.includes("window.RuntimeFrameScheduler.register(SCHEDULER_ID, scheduledFrame"), 'Quick Attack must register its combined readiness/reticle update with the shared scheduler');
assert(source.includes("phase: 'pre-game'"), 'Quick Attack must be on the pre-game phase to keep running before gameLoop');

function buildContext() {
  const registered = new Map();
  const context = {
    console, Math, Number, String, Object, Array, Set, WeakMap, JSON, URLSearchParams,
    window: null,
    document: {
      createElement() {
        return {
          style: {},
          getContext: () => ({
            clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          }),
        };
      },
      body: null,
    },
    performance: { now: () => 1000 },
    location: { search: '' },
    THREE: {
      Vector3: class Vector3 { set() { return this; } copy() { return this; } applyQuaternion() { return this; } addScaledVector() { return this; } },
      Sprite: class Sprite {
        constructor(material) {
          this.material = material;
          this.scale = { set() {} };
          this.position = { copy() {}, lerp() {} };
          this.userData = {};
          this.parent = null;
        }
      },
      SpriteMaterial: class SpriteMaterial { constructor(opts) { Object.assign(this, opts); this.color = { setRGB() {} }; } },
      CanvasTexture: class CanvasTexture {},
      TextureLoader: class TextureLoader { load() {} },
      LinearFilter: 1,
      NormalBlending: 1,
      AdditiveBlending: 2,
      SRGBColorSpace: 1,
    },
  };
  context.window = context;
  context.RuntimeFrameScheduler = {
    register(id, fn, options) { registered.set(id, { fn, options }); },
  };
  context.Combat = {
    loadout: { getSlot: () => 'tap2' },
    quickAttackData: { TECHNIQUES: { tap2: { condKey: 'behind', label: 'Test Quick Attack' } } },
    getQuickAttackConditions: (deps, target) => ({ behind: true }),
    deps: {
      findMeleeAttackCandidate: () => ({ health: 10, avatarRef: { group: { parent: { isScene: true, add() {} }, updateWorldMatrix() {} } } }),
      currentWeaponKey: () => null,
      camera: null,
    },
  };
  context.WorldPopupText = { avatarCentroidWorld: () => ({ x: 0, y: 1, z: 0 }) };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'quick-attack-bonus-indicator.js' });
  return { context, registered };
}

const { context, registered } = buildContext();

const entry = registered.get('quick-attack-bonus-indicator');
assert(entry, 'registers with the scheduler under a stable id');
assert.equal(entry.options.phase, 'pre-game');
assert.equal(entry.options.owner, 'QuickAttackBonusIndicator');

// The scheduled callback still drives the full readiness/reticle pipeline.
const scheduledFrame = entry.fn;
assert.doesNotThrow(() => scheduledFrame({ timestamp: 1016 }), 'the scheduled callback runs the same readiness/reticle logic the old frame() loop did');
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, true, 'a ready condition still shows the reticle when driven by the scheduler');

// A throwing readiness/render pass must still detach the reticle and record
// its own error snapshot, exactly like the old try/catch inside frame().
context.Combat.getQuickAttackConditions = () => { throw new Error('boom'); };
scheduledFrame({ timestamp: 1032 });
assert.equal(context.QuickAttackBonusIndicator.snapshot().lastFrameError, 'boom', 'a thrown readiness error is captured for the mobile debug snapshot');
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, false, 'the reticle is detached rather than left frozen after an error');

console.log('quick attack bonus indicator pre-game scheduler migration passed');
