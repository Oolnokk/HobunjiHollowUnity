'use strict';

// Regression: modular weapon keys are virtual sprites; the aura must scan the
// assembled source canvas and map selected pixels to the offset rendered quad.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/combat/weapon-enchantment-vfx.js'), 'utf8');
const key = 'modular:bshuakauitl:fishing-mace:arsenicalBronze';
let now = 1000; // Used by the simulated pre-render loop below.
let revision = 1; // Used to prove foundry edits invalidate cached metal masks.
let compositions = 0; // Used to ensure cached scans do not continually recompose a weapon.
let imageLoads = 0; // Used to catch accidental Image loading of a virtual modular key.
let frame = null; // Used to drive the registered production VFX update callback.

class Object3D {
  constructor() {
    this.children = []; this.parent = null; this.visible = true; this.userData = {};
    this.position = { x: 0, y: 0, z: 0 };
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(entry => entry !== child); child.parent = null; }
}
const plane = Object.assign(new Object3D(), {
  isObject3D: true,
  geometry: {
    parameters: { width: 1, height: 2 },
    userData: { modularLayout: { width: 1, height: 2, x: 0.375, y: -0.25 } },
    boundingBox: { min: { x: -0.125, y: -1.25 }, max: { x: 0.875, y: 0.75 } },
  },
}); // Mirrors the non-centered quad produced by ModularWeapons.fitPlaneGeometry().
const held = new Object3D(); // The actual player's held visual.
held.userData.itemKey = key;
held.userData.toolPlane = plane;
held.add(plane);
const holder = new Object3D(); // No world-scene or NPC search is allowed.
holder.add(held);
const gear = {}; // Holds the VFX alignment/appearance fallback for the fake player inventory.
const canvas = {
  width: 2, height: 2,
  getContext() {
    return {
      getImageData() {
        return { width: 2, height: 2, data: Uint8ClampedArray.from([
          90, 132, 128, 255, // Authored metal source pixel, top-left.
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ]) };
      },
    };
  },
}; // Tiny assembled source image; never an Image URL.
const context = {
  window: {
    Combat: { deps: {
      TOOL_ITEM_DEFS: { [key]: { sprite: key } },
      equipmentSlots: { weapon: key },
      currentWeaponKey: () => key,
      getActiveTool: () => 'weapon',
      getHeldMode: () => 'tool',
      getGearInventory: () => gear,
    } },
    ProceduralHandAttachments: { gameDeps: { toolHolder: holder } },
    EnchantmentSystem: { PLANES: ['Tothal'], planarCounts: () => ({ Tothal: 1 }) },
    ColorFill: { rgbToHsv: () => ({ h: 0, s: 0 }), hueDistance: () => 0 },
    ModularWeapons: {
      decode: sprite => sprite === key ? { shaft: 'bshuakauitl', head: 'fishing-mace', metal: 'arsenicalBronze' } : null,
      diagnostics: () => ({ revision }),
      compose: async (shaft, head) => {
        assert.equal(shaft, 'bshuakauitl');
        assert.equal(head, 'fishing-mace');
        compositions++;
        return canvas;
      },
    },
    RuntimeFrameScheduler: { register(_id, update) { frame = update; } },
  },
  document: { baseURI: 'https://example.test/docs/' },
  Image: class { constructor() { imageLoads++; } },
  THREE: { Group: Object3D },
  performance: { now: () => now },
  URL, Uint32Array, Uint8ClampedArray, Map, Set, Object, Math, Number, Promise, console,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'weapon-enchantment-vfx.js' });
const api = context.window.WeaponEnchantmentVFX;
const tick = time => { now = time; frame(time); }; // Drives the production scanner without a browser.
const settle = () => new Promise(resolve => setImmediate(resolve)); // Flushes async compose and held snapshot promises.

(async () => {
  assert(frame, 'the enchantment system is registered with the game scheduler');
  tick(1000);
  await settle();
  const first = api.debugSnapshot(key);
  assert.equal(first.sourceSprite, key, 'a virtual modular key remains the canonical sprite identity');
  assert.equal(first.matchedMetalPixels, 1, 'the composed canvas yields the authored metal pixel');
  assert.equal(first.emitters, 1, 'the exact held melee plane owns the emitter');
  assert.equal(imageLoads, 0, 'virtual modular sprite keys must never be requested as image URLs');
  assert.equal(compositions, 1, 'the modular composition runs once');

  const local = api._test.metalPixelToLocal(0, { width: 2, height: 2 }, plane);
  assert.equal(local.x, 0.125, 'the left source pixel includes the modular quad X displacement');
  assert.equal(local.y, 0.25, 'the top source pixel includes the modular quad Y displacement');

  api.forceRefresh();
  tick(1100);
  await settle();
  assert.equal(api.debugSnapshot(key).matchedMetalPixels, 1);
  assert.equal(compositions, 1, 're-equipping the unchanged modular weapon reuses its cached mask');

  revision = 2; // Mimics a foundry authoring change that rebuilds the composite.
  api.forceRefresh();
  tick(1200);
  await settle();
  assert.equal(compositions, 2, 'changing the modular composition revision rebuilds its metal mask');
  assert.equal(api.debugSnapshot(key).matchedMetalPixels, 1);
  console.log('weapon-enchantment-vfx modular source mask, cache, and offset geometry passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
