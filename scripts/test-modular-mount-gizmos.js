'use strict';

const assert = require('node:assert/strict'); // Gizmo algebra and editor control integration.
const fs = require('node:fs'); // Uses the production gizmo module without recreating geometry.
const vm = require('node:vm'); // Loads browser helper in an isolated Node context.
const window = {}; // Mock browser namespace.
vm.runInNewContext(fs.readFileSync('docs/tools/modular-weapon-editor/mount-gizmos.js', 'utf8'),
  { window, globalThis: window }, { filename: 'mount-gizmos.js' });
const g = window.ModularMountGizmos; // Real renderer and controller manipulation helpers.
const sample = { type: 'eye', start: { x: 200, y: 180 }, end: { x: 200, y: 280 } }; // Center (200,230), length 100.
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, a + ' differs from ' + b); // Geometry epsilon.

assert.equal(g.length(sample), 100, 'Arrow length measures from its origin to the tip.');
const longer = g.setLength(sample, 180); // Numerical length extends tip while preserving origin and bearing.
near(longer.start.x, sample.start.x);
near(longer.start.y, sample.start.y);
near(longer.end.x, 200);
near(longer.end.y, 360);
near(g.length(longer), 180);
near(g.length(sample), 100); // Undo/editor source remains untouched.
const shorter = g.setLength(sample, 35);
near(shorter.end.y, 215);
near(g.length(shorter), 35);
const diagonal = { type: 'tang', start: { x: 100, y: 200 }, end: { x: 130, y: 240 } }; // 3:4:5 line, 50px long.
const twice = g.setLength(diagonal, 100);
near(twice.start.x, 100); near(twice.start.y, 200);
near(twice.end.x, 160); near(twice.end.y, 280);
near(g.length(twice), 100);
const edge = { type: 'eye', start: { x: 400, y: 1200 }, end: { x: 430, y: 1202 } };
const capped = g.setLength(edge, 300); // Clamp tip at the last available frame boundary, not by moving origin.
near(capped.start.x, 400); near(capped.start.y, 1200);
near(capped.end.x, 450); // This diagonal hits the right edge before reaching the bottom edge.
near(capped.end.y, 1200 + 50 * 2 / 30);
assert(capped.end.x <= 450 && capped.end.y <= 1204);
assert.equal(g.setLength(sample, NaN), sample, 'Invalid numeric values preserve the line.');
assert.equal(g.setLength(sample, 0), sample, 'Minimum valid arrow length is enforced.');

const moved = g.move(sample, 80, -30); // Translate without changing direction or length.
assert.equal(moved.start.x, 280);
assert.equal(moved.start.y, 150);
assert.equal(moved.end.x, 280);
assert.equal(moved.end.y, 250);
assert.equal(Math.hypot(moved.end.x - moved.start.x, moved.end.y - moved.start.y), 100);
assert.deepEqual([sample.start.x, sample.end.y], [200, 280], 'Moving never mutates the original for cancellation.');
const clamped = g.move({ type: 'tang', start: { x: 400, y: 700 }, end: { x: 420, y: 800 } }, 80, 500);
assert.equal(clamped.start.x, 430);
assert.equal(clamped.end.x, 450);
assert.equal(clamped.end.y, 1204);
near(Math.hypot(clamped.end.x - clamped.start.x, clamped.end.y - clamped.start.y), Math.hypot(20, 100));

const rotated = g.rotate(sample, Math.PI / 2); // Rotate around midpoint without shrinking.
near(rotated.start.x, 250);
near(rotated.end.x, 150);
near(rotated.start.y, 230);
near(rotated.end.y, 230);
near(Math.hypot(rotated.end.x - rotated.start.x, rotated.end.y - rotated.start.y), 100);
assert.deepEqual([sample.start.x, sample.start.y], [200, 180], 'Rotating does not mutate the saved line.');
const corner = { type: 'tang', start: { x: 0, y: 0 }, end: { x: 0, y: 100 } }; // Rotating near an edge may shift its center inward, not shorten it.
const turned = g.rotate(corner, Math.PI / 2);
assert(turned.start.x >= 0 && turned.end.x >= 0);
near(Math.hypot(turned.end.x - turned.start.x, turned.end.y - turned.start.y), 100);
assert.equal(turned.type, corner.type);
const outside = g.rotate({ type: 'tang', start: { x: 225, y: 0 }, end: { x: 225, y: 1204 } }, Math.PI / 2); // Horizontal rotation wouldn't fit in 450px width.
assert.equal(outside.end.y, 1204, 'Reject impossible rotations rather than collapsing the line.');
const handle = g.rotationHandle(sample); // Rotating uses a separate visible 2D gizmo handle.
assert(handle.x >= 10 && handle.x <= 440 && handle.y >= 10 && handle.y <= 1194);
near(g.rotationDelta(sample, handle, { x: 200, y: 340 }), -Math.PI / 2);

const html = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8'); // Existing tool keeps the new button trio.
const editor = fs.readFileSync('docs/tools/modular-weapon-editor/editor.js', 'utf8'); // Gizmos must be wired into gestures, not decorative.
for (const id of ['gizmo-draw', 'gizmo-move', 'gizmo-rotate', 'shaft-canvas', 'head-canvas']) {
  assert(html.includes('id="' + id + '"'), 'Missing mount gizmo UI: ' + id);
}
assert(html.indexOf('mount-gizmos.js?') < html.indexOf('editor.js?'), 'Geometry module must load before editor.');
assert(editor.includes('gizmos.move(drawing.original, dx, dy)'));
assert(editor.includes('gizmos.rotate(drawing.original, angle)'));
assert(editor.includes("button.setAttribute('aria-pressed'"), 'Active tool modes must be accessible.');
assert(editor.includes("gizmos.setLength(line, value)"), 'Length field must update the selected line, not an unrelated coordinate.');
assert(editor.includes("lengthInput.type = 'number'"), 'Length field uses native spinner arrows.');
assert(editor.includes("shorten.onclick") && editor.includes("extend.onclick"), 'Mobile increment/decrement buttons are wired.');
assert(html.includes('Line length is the distance'), 'Length semantics are explained beside the editor.');
console.log('Mount gizmos: move, rotate, adjustable origin-to-tip length, frame bounds, non-mutation and editor bindings passed.');
