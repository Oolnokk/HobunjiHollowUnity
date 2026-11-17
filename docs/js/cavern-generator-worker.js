/* Procedural den carving worker. Only math/data: no DOM, THREE, or gameplay state.
 * Loaded lazily by CavernGenerator.generateCavernFloorAsync(), not at boot. */
'use strict';

self.window = self; // The two existing pure modules export via window.<Namespace>.
importScripts('cavern-sculptor.js?v=20261116deepAudit1', 'cavern-generator.js?v=20261117deepAudit3');

// Exactly the canonical FNV-1a + mulberry32 sequence from WildernessMapGenerator.
// The worker must not load the entire wilderness/scene generator merely to seed
// the cave: a different fallback RNG changes every passage and exit coordinate.
function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seedText) {
  let state = hashSeed(seedText);
  return function random() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
self.WildernessMapGenerator = { makeRng }; // Identical generator used by the main-thread code, without loading its world-side effects.

self.onmessage = event => {
  const { id, seedText, generationOptions, caveShape } = event.data || {};
  try {
    if (!Number.isSafeInteger(id) || typeof seedText !== 'string' || !seedText) throw new TypeError('Invalid den generation request');
    self.HobunjiCaveShapeConfig = caveShape || {}; // Per-request snapshot prevents settings drift across concurrently requested dens.
    const floorData = self.CavernGenerator.generateCavernFloor(seedText, { ...generationOptions, cache: false });
    // The sculptor emits large coordinate arrays. Transfer typed buffers
    // when possible rather than cloning them back onto the UI thread.
    const buffers = new Set(); // Eliminates duplicate ArrayBuffers from views sharing the same storage.
    for (const value of Object.values(floorData.mesh || {})) {
      if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
    }
    self.postMessage({ id, floorData }, [...buffers]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.stack || error?.message || error) });
  }
};
