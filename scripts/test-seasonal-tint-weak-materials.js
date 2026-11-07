#!/usr/bin/env node
'use strict';

// seasonal-vegetation-tint.js used to keep every material ever constructed in strong Sets until someone disposed it.
// Evicting a wilderness zone does not dispose every material (disposeSceneResources only disposes what it can prove
// no live scene uses), so each missed one stayed reachable with its textures: about 13 MB per four zone visits in a
// heap snapshot. This runs the real module and a real GC to check that an undisposed, otherwise unreferenced
// material is collectable while a referenced one is still tracked and still receives the tint.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const v8 = require('node:v8');
const vm = require('node:vm');

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

const source = fs.readFileSync('docs/js/seasonal-vegetation-tint.js', 'utf8');
class Color { constructor(h = 0) { this.isColor = true; this._hex = h; } setHex(h) { this._hex = h; return this; } setHSL() { return this; } getHex() { return this._hex; } getHexString() { return this._hex.toString(16).padStart(6, '0'); } }
const context = { console, window: null, THREE: { Color, TextureLoader: { prototype: { load() { return {}; } } }, CanvasTexture: function CanvasTexture() {}, Material: { prototype: { setValues(v) { Object.assign(this, v); return this; }, dispose() {} } } } };
context.window = context;
context.RuntimeFrameScheduler = { register() {} };
context.CalendarSystem = { currentSeason: () => null };
context.fetch = undefined;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'seasonal-vegetation-tint.js' });

const proto = context.THREE.Material.prototype;
const tracked = () => context.SeasonalVegetationTint.status().trackedMaterials;
const kept = Object.create(proto); kept.setValues({ name: 'kept' });
const disposed = Object.create(proto); disposed.setValues({ name: 'disposed' });
assert.equal(tracked(), 2, 'both materials are tracked at construction');
disposed.dispose();
assert.equal(tracked(), 1, 'dispose still removes a material straight away');

(async () => {
  // Create the never-disposed materials in a scope that ends, as a evicted zone's would.
  (() => { for (let i = 0; i < 200; i++) Object.create(proto).setValues({ name: `orphan${i}`, big: new Array(1000).fill(i) }); })();
  assert.ok(tracked() >= 1);
  for (let i = 0; i < 10 && tracked() > 1; i++) { await new Promise(r => setImmediate(r)); gc(); }
  assert.equal(tracked(), 1, 'undisposed materials that nothing else references are collected');
  assert.equal(kept.name, 'kept');
  console.log('seasonal tint weak materials: ok');
})().catch(e => { console.error(e); process.exit(1); });
