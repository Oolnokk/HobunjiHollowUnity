#!/usr/bin/env node
'use strict';

// Regression for the Stage 2 RAF-ownership migration: seasonal-vegetation-tint.js's
// permanent watchSeasonTint() watchdog now registers with the shared
// RuntimeFrameScheduler instead of owning a private requestAnimationFrame
// loop, with identical drift-detection behavior (see
// docs/architecture/runtime-frame-scheduler.md).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/seasonal-vegetation-tint.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'the seasonal vegetation watchdog must no longer own a direct requestAnimationFrame( call site');
assert(source.includes("window.RuntimeFrameScheduler.register(SCHEDULER_ID, watchSeasonTint"), 'watchSeasonTint must be registered with the shared scheduler');

class Color {
  constructor(hex = 0x000000) { this.isColor = true; this.setHex(hex); }
  setHex(hex) { this._hex = hex >>> 0; return this; }
  setHSL() { return this; } // Only used at module-load time for constant colors; the exact value doesn't matter for this test.
  getHex() { return this._hex; }
  getHexString() { return this._hex.toString(16).padStart(6, '0'); }
}

function buildContext() {
  const registered = new Map();
  const context = {
    console,
    Math, Number, String, Object, Array, Set, WeakMap,
    window: null,
    THREE: {
      Color,
      TextureLoader: { prototype: { load(url, onLoad) { return {}; } } },
      CanvasTexture: function CanvasTexture() {},
      Material: { prototype: { setValues(values) { Object.assign(this, values); return this; }, dispose() {} } },
    },
  };
  context.window = context;
  context.RuntimeFrameScheduler = {
    register(id, fn, options) { registered.set(id, { fn, options }); },
  };
  context.CalendarSystem = { currentSeason: () => null };
  context.fetch = undefined; // Skip the terrain-materials.json fetch branch entirely in this fixture.
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'seasonal-vegetation-tint.js' });
  return { context, registered };
}

const { context, registered } = buildContext();

const entry = registered.get('seasonal-vegetation-tint');
assert(entry, 'watchSeasonTint registers with the scheduler under a stable id');
assert.equal(entry.options.owner, 'SeasonalVegetationTint');
assert.equal(entry.options.phase, 'visual');

const watchdog = entry.fn;

// No season tint available yet -> watchdog is a no-op, matching the
// original `if (tint) { ... }` guard.
watchdog();
assert.equal(context.SeasonalVegetationTint.status().lastAppliedTint, null, 'watchdog does nothing while no season tint is available');

// A grass surface material registers itself via the wrapped Material.setValues
// (the same hook game.js's own material construction goes through).
const trackedMaterial = {};
context.THREE.Material.prototype.setValues.call(trackedMaterial, {
  isMeshBasicMaterial: true,
  color: new Color(0x123456), // Matches looksLikePlainGrassFloorMaterial's DEFAULT_GRASS_GREEN_HEX check only loosely; this test drives the watchdog via the generic trackedMaterials path instead of a specific target set.
});

// Season tint becomes available -> the scheduled watchdog callback must
// detect the change and sync, exactly like the old per-frame RAF did.
const summerTint = new Color(0x55aa33);
context.CalendarSystem.currentSeason = () => ({ grassColor: summerTint, grassDensity: 0.8 });
watchdog();
assert.equal(context.SeasonalVegetationTint.status().lastAppliedTint, `#${summerTint.getHexString()}`, 'watchdog applies a newly-available season tint on its scheduled callback');
assert.equal(context.SeasonalVegetationTint.status().lastAppliedDensity, 0.8, 'watchdog applies the matching season density');

// Same tint/density on the next scheduled call -> no redundant re-sync (the
// registeredTargetDrifted() fallback finds nothing drifted since no targets
// were registered through the specific grass/leaf/weed tracking sets).
const before = context.SeasonalVegetationTint.status();
watchdog();
const after = context.SeasonalVegetationTint.status();
assert.deepEqual(after, before, 'an unchanged season on the next scheduled call does no redundant work');

// A season change is still picked up on a later scheduled call.
const autumnTint = new Color(0xaa5522);
context.CalendarSystem.currentSeason = () => ({ grassColor: autumnTint, grassDensity: 0.5 });
watchdog();
assert.equal(context.SeasonalVegetationTint.status().lastAppliedTint, `#${autumnTint.getHexString()}`, 'a season change is detected on the next scheduled watchdog call');

console.log('seasonal vegetation tint scheduler migration passed');
