'use strict';
const assert = require('node:assert/strict'); // Behavioral coverage for expanded sprites and the real held-mesh factory.
const fs = require('node:fs'); // Reads shipped source modules.
const vm = require('node:vm'); // Minimal browser and Three.js adapters.
const window = {}; // Shared authoring/runtime namespace.
const context = vm.createContext({ window, console }); // Pure layout helpers need no browser canvas.
for (const path of ['docs/config/modular-weapons.js', 'docs/js/modular-weapons.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), context);
const api = window.ModularWeapons; // The actual compositor uses these same affine/bounds helpers.
const shaft = { mounts: [
  { type: 'tang', start: { x: 200, y: 1200 }, end: { x: 200, y: 1110 } },
  { type: 'tang', start: { x: 200, y: 10 }, end: { x: 200, y: 160 } }
] }; // Two directed tang lines of different lengths test automatic scaling and opposed attachment.
const head = { mount: { type: 'blade', start: { x: 200, y: 300 }, end: { x: 200, y: 220 } } };
const bounds = { left: 20, top: 40, right: 420, bottom: 1100 }; // Visible head pixel envelope.
for (const angle of [-151, 0, 47, 270]) for (const flipX of [false, true]) for (const flipY of [false, true]) {
  const values = { scaleX: 1.8, scaleY: 2.5, flipX, flipY, x: 75, y: -90, rotation: angle }; // Pair-specific corrections over automatic affine mount.
  const frame = api.compositionFrame(shaft, head, bounds, values);
  assert(frame.left <= 0 && frame.top <= 0 && frame.left + frame.width >= 450 && frame.top + frame.height >= 1204);
  for (const mount of shaft.mounts) {
    const matrix = api.headTransform(mount, values, head.mount); // Same matrix used by Canvas drawing and bounds.
    const sa = Math.atan2(mount.end.y - mount.start.y, mount.end.x - mount.start.x);
    const ha = Math.atan2(head.mount.end.y - head.mount.start.y, head.mount.end.x - head.mount.start.x);
    const autoScale = Math.hypot(mount.end.x - mount.start.x, mount.end.y - mount.start.y) /
      Math.hypot(head.mount.end.x - head.mount.start.x, head.mount.end.y - head.mount.start.y);
    const offsetAxis = sa + Math.PI / 2, totalAngle = sa - ha + angle * Math.PI / 180; // Independent transform derivation.
    for (const x of [bounds.left, bounds.right]) for (const y of [bounds.top, bounds.bottom]) {
      const hx = (x - head.mount.start.x) * values.scaleX * (flipX ? -1 : 1); // Perpendicular X width is NOT automatically stretched.
      const hy = (y - head.mount.start.y) * values.scaleY * (flipY ? -1 : 1) * autoScale; // Tang-line Y length is automatically fitted.
      const rx = Math.cos(totalAngle) * hx - Math.sin(totalAngle) * hy;
      const ry = Math.sin(totalAngle) * hx + Math.cos(totalAngle) * hy;
      const px = mount.start.x + Math.cos(offsetAxis) * values.x - Math.sin(offsetAxis) * values.y + rx;
      const py = mount.start.y + Math.sin(offsetAxis) * values.x + Math.cos(offsetAxis) * values.y + ry;
      assert(Math.abs(px - (matrix.a * x + matrix.c * y + matrix.e)) < 1e-8);
      assert(Math.abs(py - (matrix.b * x + matrix.d * y + matrix.f)) < 1e-8);
      assert(px > frame.left && px < frame.left + frame.width && py > frame.top && py < frame.top + frame.height);
    }
  }
  const layout = api.planeLayout({ width: 1024, height: 1024, modularFrame: frame }, .5);
  for (const point of [{ x: 0, y: 0 }, { x: 225, y: 602 }, { x: 202, y: 880 }, { x: 450, y: 1204 }]) {
    const u = (point.x - frame.left) / frame.width, v = (point.y - frame.top) / frame.height;
    assert(Math.abs(layout.x + (u - .5) * layout.width - (point.x - 225) * .5 / 450) < 1e-10);
    assert(Math.abs(layout.y + (.5 - v) * layout.height - (602 - point.y) * .5 / 450) < 1e-10);
  }
}
class Geometry { // One-segment PlaneGeometry exposes the same positions API used by the live factory.
  constructor(width, height) { this.parameters = { width, height }; this.userData = {}; this.vertices = []; this.attributes = { position: { setXYZ: (i, ...xyz) => { this.vertices[i] = xyz; } } }; this.boundsUpdates = 0; }
  computeBoundingBox() { this.boundsUpdates++; }
  computeBoundingSphere() { this.boundsUpdates++; }
}
class Group { // Held sprite parent retains the donor origin.
  constructor() { this.userData = {}; this.rotation = {}; this.children = []; }
  add(child) { this.children.push(child); }
}
class Mesh { // Both hands/NPCs may share a geometry object.
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.rotation = {}; }
}
const key = 'modular:dagger:warhammer:nativeCopper', texture = { image: { width: 450, height: 1204 } }, geometries = new Map(); // Simulates a texture that finishes composing after the item is already held.
const browser = { ...window, HobunjiSpritePngSurface: { makeMaterial: (_three, map) => ({ map }) }, ToolMetalRecolor: { getRecoloredCanvas: async () => ({ width: 1024, height: 1024, modularFrame: { left: -400, top: -700, width: 1500, height: 3200 } }) } }; // Asynchronous recolor retains logical origin and extent.
const runtime = vm.createContext({ window: browser, THREE: { PlaneGeometry: Geometry, Group, Mesh, DoubleSide: 2 }, TOOL_ITEM_DEFS: { [key]: { modular: {}, sprite: key, _imgW: 450, _imgH: 1204 } },
  toolTextures: { [key]: texture }, modularToolGeometries: geometries, TOOL_MODEL_WIDTH: .5, HELD_OBJECT_RENDER_ORDER: 1.5,
  ensureToolTexture: () => texture, metalToolRecolorOptions: () => ({ oxidationAmount: 0 }), quantizeOxidation: value => value, _markPngPlane() {} }); // Real game functions execute against these adapters.
const source = fs.readFileSync('docs/game.js', 'utf8'); // Extracts complete owner functions without loading unrelated game systems.
vm.runInContext(source.slice(source.indexOf('      function makeToolPlaneMesh('), source.indexOf('      function setToolMeshLoadedState(')), runtime);
vm.runInContext(source.slice(source.indexOf('      function refreshMetalToolWorldTexture('), source.indexOf('      // Build a PNG plane mesh sized', source.indexOf('      function refreshMetalToolWorldTexture('))), runtime);
(async () => {
  const first = runtime.makeToolPlaneMesh(key), second = runtime.makeToolPlaneMesh(key); // Shared quad updates must reach already-created held copies.
  assert.equal(first.userData.toolPlane.geometry, second.userData.toolPlane.geometry);
  const original = first.userData.toolPlane.geometry; // Origin/size changes without swapping away the geometry used by other copies.
  runtime.refreshMetalToolWorldTexture(key);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(first.userData.toolPlane.geometry, original);
  assert.equal(second.userData.toolPlane.geometry, original);
  assert.equal(original.parameters.width, 1500 * .5 / 450);
  assert.equal(original.parameters.height, 3200 * .5 / 450);
  assert(Math.abs(original.vertices[0][0] - (-400 - 225) * .5 / 450) < 1e-10);
  assert(Math.abs(original.vertices[0][1] - (602 + 700) * .5 / 450) < 1e-10);
  const updates = original.boundsUpdates; // Ordinary recolor/mastery refreshes do not rebuild unchanged geometry.
  runtime.refreshMetalToolWorldTexture(key); await Promise.resolve(); await Promise.resolve();
  assert.equal(original.boundsUpdates, updates);
  console.log('Modular sprite frame: transformed bounds, fixed grip/scale, async player/NPC/dual geometry updates and bitmap-resolution independence passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
