'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const transformSource = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-transform.js'), 'utf8');
const previewLoaderSource = fs.readFileSync(path.join(repoRoot, 'docs/js/terrain-preview.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-map-editor.js'), 'utf8');

assert.equal(transformSource.includes('setInterval('), false, 'transform helper must not poll with setInterval');
assert.equal(transformSource.includes('requestAnimationFrame('), false, 'transform helper must not add per-frame work');
assert.equal(editorSource.includes('requestAnimationFrame('), false, 'Map Editor bridge must not add a second render loop');

const storage = new Map();
const dispatched = [];
const windowForTransform = {
  dispatchEvent(event) { dispatched.push(event); },
};
class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}
vm.runInNewContext(transformSource, {
  window: windowForTransform,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  },
  CustomEvent: FakeCustomEvent,
  console,
});
const transform = windowForTransform.HarugasirriTransform;
assert(transform, 'shared transform API should install');
const asset = {
  origin: { bounds: { min: [-11, 0, -11], max: [11, 9.921569, 11] } },
  runtime: { worldScale: 12 },
};
const initial = transform.defaults(asset);
assert.equal(initial.width, 264);
assert.equal(initial.depth, 264);
assert(Math.abs(initial.height - 119.058828) < 1e-6, 'default height should equal authored height × 12');

const applied = { scale: null, position: null, rotation: { y: 0 }, updateCount: 0 };
const group = {
  scale: { set(x, y, z) { applied.scale = [x, y, z]; } },
  position: { set(x, y, z) { applied.position = [x, y, z]; } },
  rotation: applied.rotation,
  updateMatrixWorld() { applied.updateCount++; },
};
transform.apply(group, asset, { ...initial, width: 528, height: initial.height * 2, depth: 132, x: 7, y: 3, z: -9, rotationY: 90 });
assert.deepEqual(applied.scale, [24, 24, 6], 'final dimensions should resolve to exact nonuniform object scales');
assert.deepEqual(applied.position, [7, 3, -9]);
assert(Math.abs(applied.rotation.y - Math.PI / 2) < 1e-12, 'yaw should convert degrees to radians exactly once');
assert.equal(applied.updateCount, 1);

transform.save({ ...initial, x: 5, visibilityTest: true }, asset);
assert.equal(dispatched.length, 1, 'one authoring change should emit one transform refresh event');
assert.equal(dispatched[0].type, 'harugasirri-transform-changed');
assert.equal(transform.load(asset).x, 5, 'saved editor transform should be the runtime transform source');

function runPreviewLoader(pathname) {
  const writes = [];
  vm.runInNewContext(previewLoaderSource, {
    document: {
      currentScript: { src: 'https://example.test/js/terrain-preview.js' },
      write(value) { writes.push(String(value)); },
    },
    location: { href: `https://example.test${pathname}`, pathname },
    URL,
  });
  return writes;
}
const mapEditorWrites = runPreviewLoader('/tools/map-editor/index.html');
assert(mapEditorWrites.some(value => value.includes('terrain-preview-core.js')), 'Map Editor should still load the unchanged terrain-preview core');
assert(mapEditorWrites.some(value => value.includes('harugasirri-map-editor.js')), 'Map Editor should load the Highlands transform bridge');
const otherWrites = runPreviewLoader('/tools/cutscene-director/index.html');
assert(otherWrites.some(value => value.includes('terrain-preview-core.js')), 'other browser tools should still get terrain-preview core');
assert.equal(otherWrites.some(value => value.includes('harugasirri-map-editor.js')), false, 'Highlands editor bridge must be Map Editor-only');

// Preserve the existing Node contract used by scripts/check-terrain.js.
let required = null;
const moduleObject = { exports: {} };
vm.runInNewContext(previewLoaderSource, {
  module: moduleObject,
  require(name) { required = name; return { core: true }; },
});
assert.equal(required, './terrain-preview-core.js');
assert.deepEqual(moduleObject.exports, { core: true });

console.log('PASS Harugasirri Map Editor transforms: exact dimensions/position/yaw, event-driven refresh, and Map Editor-only preview hook.');
