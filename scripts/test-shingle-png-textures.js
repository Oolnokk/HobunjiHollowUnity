'use strict';

const assert = require('assert'); // Validates the production material updates and request lifecycle.
const fs = require('fs'); // Reads the real shingle asset and production renderer.
const vm = require('vm'); // Executes the classic renderer with controlled asset callbacks.

const bytes = fs.readFileSync('docs/assets/models/HighlandLongshingle_boned.glb'); // Confirms the shipped GLB contains the settings that caused the regression.
const glb = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()); // Reads the GLB JSON chunk without an external Three dependency.
assert(glb.meshes[0].primitives[0].attributes.COLOR_0 != null);
assert.strictEqual(glb.materials[0].pbrMetallicRoughness.metallicFactor, 1);

const requests = []; // Controls success, failure, and out-of-order PNG responses.
const logs = []; // Checks diagnostics reach the mobile-visible debug sink.
let completeGlb; // Delays template loading to exercise a queued tint.
let failCanvas = false; // Simulates canvas read failures while recoloring the PNG.
const material = { vertexColors: true, metalness: 1, roughness: 0.5, color: { setHex(value) { this.value = value; } } }; // Models the authored shingle shell material.
const scene = { traverse(fn) { fn({ isMesh: true, material, geometry: { getAttribute() { return {}; } } }); } }; // Keeps an existing UV attribute intact during template analysis.
const clone = { material }; // Models Three's shared material references on already-placed shingles.
const window = {
  THREE: {
    GLTFLoader: class { load(url, done) { completeGlb = done; } },
    TextureLoader: class { load(path, done, progress, fail) { requests.push({ path, done, fail }); } },
    CanvasTexture: class { constructor(image) { this.image = image; } },
    Vector3: class {},
    Box3: class { setFromObject() { return this; } getSize() { return { x: 1, y: 1, z: 1 }; } },
    RepeatWrapping: 1000,
  },
  parseHexColor() { return { r: 125, g: 115, b: 85 }; },
  getPortraitTintingConfig() { return {}; },
  getShadeFillCanvas(image) { if (failCanvas) throw new Error('canvas read failed'); return image; },
  __farmLog(...args) { logs.push(args); },
}; // Supplies only the APIs used by the public shingle loading/tinting path.
vm.runInNewContext(fs.readFileSync('docs/js/HousePieceGen.js', 'utf8'), { window });
const api = window.HousePieceGen; // Exercises the renderer's actual public API.
api.tintShingleMaterial('roof.png', '#7d7355');
api.loadShingleGlb('assets/models/');
assert.strictEqual(requests.length, 0);
completeGlb({ scene });
assert.strictEqual(requests.length, 1);
requests[0].done({ image: { width: 32, height: 32 } });
assert.strictEqual(clone.material.map.image.width, 32);
assert.strictEqual(material.vertexColors, false);
assert.strictEqual(material.metalness, 0);
assert.strictEqual(material.roughness, 1);
assert.strictEqual(material.color.value, 0xffffff);
assert.strictEqual(material.map.wrapS, window.THREE.RepeatWrapping);
assert.strictEqual(material.map.wrapT, window.THREE.RepeatWrapping);
assert.strictEqual(material.needsUpdate, true);
api.tintShingleMaterial('roof.png', '#7d7355');
assert.strictEqual(requests.length, 1, 'identical finish must reuse its request');

api.tintShingleMaterial('old.png');
api.tintShingleMaterial('new.png');
const newest = { image: {}, dispose() { this.disposed = true; } }; // Represents the successful replacement finish.
requests[2].done(newest);
const obsolete = { image: {}, dispose() { this.disposed = true; } }; // Checks a late response cannot restore an older finish.
requests[1].done(obsolete);
assert.strictEqual(material.map, newest);
assert.strictEqual(obsolete.disposed, true);
requests[1].fail(new Error('obsolete failure'));
api.tintShingleMaterial('new.png');
assert.strictEqual(requests.length, 3, 'obsolete failure must not invalidate the current finish');

api.tintShingleMaterial('retry.png');
requests[3].fail(new Error('network failure'));
api.tintShingleMaterial('retry.png');
assert.strictEqual(requests.length, 5, 'failed PNG must be retryable');
requests[4].done({ image: {} });
api.tintShingleMaterial('canvas.png', '#7d7355');
failCanvas = true;
requests[5].done({ image: {} });
failCanvas = false;
api.tintShingleMaterial('canvas.png', '#7d7355');
assert.strictEqual(requests.length, 7, 'failed recoloring must be retryable');
requests[6].done({ image: {} });
assert(logs.some(entry => entry[1] === 'warn' && entry[0].includes('canvas read failed')));
assert(logs.some(entry => entry[2] === 'render' && entry[0].includes('baked vertex colors disabled')));
console.log('Shingle PNG material, queued tint, shared clones, request races, and retry diagnostics passed.');
