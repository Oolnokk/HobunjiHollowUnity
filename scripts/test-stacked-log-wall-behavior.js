'use strict';
const assert = require('node:assert/strict'); // Checks generated source spans and cache lifetime without WebGL.
const fs = require('node:fs'); // Loads production code into isolated browser-like contexts.
const vm = require('node:vm'); // Executes the actual wall renderer and bootstrap.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  fromArray(a) { return this.set(...a); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v, s) { return this.add(v.clone().multiplyScalar(s)); }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
  cross(v) {
    return this.set(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }
}
class Quaternion { // Orientation calls do not affect the span/caching assertions below.
  setFromUnitVectors() { return this; }
  setFromAxisAngle() { return this; }
  multiply() { return this; }
  copy() { return this; }
}
class Group {
  constructor() { this.children = []; this.userData = {}; }
  add(child) { this.children.push(child); }
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new Vector3();
    this.quaternion = new Quaternion();
    this.scale = new Vector3(1, 1, 1);
    this.userData = {};
  }
  clone() { return new Mesh(this.geometry, this.material); }
}
const THREE = { Vector3, Quaternion, Group }; // Minimal placement surface; source geometry is supplied by the foliage spy.
let generated = 0; // Counts actual foliage calls to distinguish reuse from regeneration.
const context = { console, FoliageGenerator: { buildLogMesh(options) {
  generated++;
  return new Mesh({ length: options.length }, options.material);
} }, WoodCutSurfaces: { makeLogAtlasMaterial(three, color) { return { color }; } } }; // Isolated production renderer with deterministic geometry/material identities.
vm.runInNewContext(fs.readFileSync('docs/js/stacked-log-walls.js', 'utf8'), context);
const api = context.StackedLogWalls; // Production API under test.
const panel = { id: 'front', corners: [[-2, 0, 0], [2, 0, 0], [2, 0.3, 0], [-2, 0.3, 0]] }; // One horizontal course in the front wall.
const opening = [[-0.5, 0, 0], [-0.5, 0.3, 0], [0.5, 0.3, 0], [0.5, 0, 0]]; // Same-plane opening that should split the course.
const options = { overhang: 0, rowDepthJitter: 0, rowRollDeg: 0, logDiameter: 0.3, courseGap: 0 }; // Eliminates random placement offsets for numeric assertions.
const build = (panels, extra = {}) => api.buildGroup(THREE, panels, { ...options, ...extra }); // Runs the complete production placement path.
const split = build([panel], { excludeQuads: [opening] }); // Expected source segments on the opening's own wall.
assert.equal(split.children.length, 2);
assert.deepEqual(Array.from(split.children, mesh => mesh.geometry.length), [1.5, 1.5]);
assert.deepEqual(Array.from(split.children, mesh => mesh.position.x), [1.25, -1.25]);
const opposite = { id: 'back', corners: panel.corners.map(([x, y]) => [x, y, 5]) }; // Parallel wall that must remain solid despite the front opening.
assert.equal(build([opposite], { excludeQuads: [opening] }).children.length, 1, 'an opening must not project through to another wall');
const perpendicular = { id: 'side', corners: [[0, 0, -2], [0, 0, 2], [0, 0.3, 2], [0, 0.3, -2]] }; // Crossing wall must not inherit an opening from the front plane.
assert.equal(build([perpendicular], { excludeQuads: [opening] }).children.length, 1);
const thinOpening = opening.map(([x, y, z]) => [x, y ? 0.24 : 0.23, z]); // Lies between the old lower/center/upper samples, inside this course's thickness.
assert.equal(build([panel], { excludeQuads: [thinOpening] }).children.length, 2, 'thin openings between sample heights still cut overlapping logs');
const first = build([panel]); // Captures geometry identities before testing cache reuse and eviction.
const beforeReuse = generated; // No further foliage work should happen for an unchanged preview.
const repeat = build([panel]);
assert.equal(generated, beforeReuse);
assert.equal(repeat.children[0].geometry, first.children[0].geometry);
for (let index = 0; index < 300; index++) build([panel], { seed: `edited-${index}` }); // Simulates many editor changes with new geometry signatures.
assert.equal(first.children[0].geometry.length, 4, 'eviction must not mutate or dispose active wall geometry');
build([panel]);
assert.ok(generated > beforeReuse + 300, 'old prototypes must be evicted instead of retaining every edited preview');
const diagnostic = build([panel]).userData; // Mobile-visible cache diagnostics from the renderer itself.
assert.ok(diagnostic.prototypeCacheSize <= diagnostic.prototypeCacheLimit);
assert.ok(diagnostic.prototypeCacheLimit > 0);
const coloredWall = build([panel], { barkColor: '#000000' }); // Keeps a live material reference while other colors leave the atlas cache.
const firstMaterial = coloredWall.children[0].material; // Repeated use should share the existing decoded atlas.
assert.equal(build([panel], { barkColor: '#000000' }).children[0].material, firstMaterial);
for (let index = 1; index <= 80; index++) build([panel], { barkColor: `#${index.toString(16).padStart(6, '0')}` }); // Reproduces repeated color-picker edits.
const colorDiagnostic = build([panel]).userData; // Exposes atlas retention limits without requiring mobile devtools.
assert.ok(colorDiagnostic.materialCacheSize <= colorDiagnostic.materialCacheLimit);
assert.ok(colorDiagnostic.materialCacheLimit > 0);
assert.equal(coloredWall.children[0].material, firstMaterial, 'eviction must preserve materials used by visible walls');

const writes = []; // Parser-time HTML emitted by the real FormatUtils bootstrap.
vm.runInNewContext(fs.readFileSync('docs/js/format-utils.js', 'utf8'), {
  window: {}, document: { readyState: 'loading', querySelector() { return null; }, write(html) { writes.push(html); } },
});
const stackedTag = writes.find(html => html.includes('stacked-log-walls.js')); // The new renderer must leave the HTML parser outside its script element.
assert.ok(stackedTag);
assert.match(stackedTag, /<\/script>$/);
assert.ok(!stackedTag.includes('\\'), 'written HTML must contain a real closing script tag');
console.log('stacked log opening, cache lifetime, and parser bootstrap behavior passed');
