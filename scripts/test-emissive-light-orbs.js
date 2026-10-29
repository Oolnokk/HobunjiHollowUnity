'use strict';
// Emissive fake lights (mask eye glow) are drawn as Blizzard-style glowing circles on a canvas ABOVE the darkness/fog canvas,
// additively, only while their face is toward the camera, and fade with scene transitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = p => fs.readFileSync(p, 'utf8');

const win = { performance, devicePixelRatio: 1 };
win.window = win;
const lights = [];
win.FurnitureLightRegistry = { list: scene => lights.filter(l => l.scene === scene) };
vm.runInNewContext(read('docs/js/emissive-light-orbs.js'), { window: win, document: { getElementById: () => null }, performance, console });
const api = win.EmissiveLightOrbs;

// Column-major world matrix at (x,y,z) with +Z axis pointing along `normal`.
function node(position, normal = [0, 0, 1]) {
  const [nx, ny, nz] = normal;
  const e = [1, 0, 0, 0, 0, 1, 0, 0, nx, ny, nz, 0, position[0], position[1], position[2], 1];
  return { matrixWorld: { elements: e }, updateWorldMatrix() {}, updateMatrixWorld() {}, parent: null, userData: {} };
}
function makeLight(position, normal, emissive = true) {
  const parent = node(position, normal);
  const light = node(position, [0, 0, 1]);
  light.parent = parent; light.color = { r: 0.5, g: 0, b: 1 }; light.userData = emissive ? { emissiveOrb: {} } : {};
  return light;
}
const camera = Object.assign(node([0, 0, 5]), {});
const projection = { camera, worldToOverlay: (x, y, z) => ({ x: 200 + x * 100, y: 200 - y * 100, visible: true }) };
function recorder() {
  const calls = { composite: [], arcs: 0, strokes: 0, gradients: [] };
  return {
    calls,
    ctx: {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {},
      arc() { calls.arcs++; }, createRadialGradient(...a) { calls.gradients.push(a); return { addColorStop() {} }; },
      set globalCompositeOperation(v) { calls.composite.push(v); }, set strokeStyle(v) {}, set fillStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {},
    },
  };
}

// collect: only emissive lights in the requested scene.
const scene = {};
const eye = makeLight([0, 0, 0], [0, 0, 1]); eye.scene = scene;
const plain = makeLight([1, 0, 0], [0, 0, 1], false); plain.scene = scene;
const elsewhere = makeLight([2, 0, 0], [0, 0, 1]); elsewhere.scene = {};
lights.push(eye, plain, elsewhere);
assert.deepEqual(api.collect(scene), [eye], 'only emissive lights in the active scene are collected');

// Facing the camera: a core circle and its halo are drawn additively (no orbiting motes).
{
  const { ctx, calls } = recorder();
  assert.equal(api.drawOrbs(ctx, projection, [eye], 1000), 1, 'a front-facing eye is drawn');
  assert.ok(calls.composite.includes('lighter'), 'additive composite so it brightens rather than being tinted by the darkness');
  assert.equal(calls.arcs, 2, 'just the core circle and its halo, got ' + calls.arcs);
}
// Facing away (seen through the back of the skull): nothing.
{
  const { ctx } = recorder();
  const back = makeLight([0, 0, 0], [0, 0, -1]);
  assert.equal(api.drawOrbs(ctx, projection, [back], 1000), 0, 'a face turned away from the camera does not glow through the head');
}
// Scene fade-to-black takes the glow with it.
{
  const { ctx } = recorder();
  assert.equal(api.drawOrbs(ctx, projection, [eye], 1000, { alpha: 0 }), 0, 'fully faded scenes draw no orbs');
}
// Off-screen sources are skipped.
{
  const { ctx } = recorder();
  const off = { ...projection, worldToOverlay: () => ({ x: 0, y: 0, visible: false }) };
  assert.equal(api.drawOrbs(ctx, off, [eye], 1000), 0, 'invisible projections are skipped');
}

// Wiring.
assert.match(read('docs/js/png-plane-avatar.js'), /light\.userData\.emissiveOrb = \{ radius:/, 'the mask glow light is flagged emissive (its fake-light aura is unchanged)');
assert.match(read('docs/js/weather-fx.js'), /getProjection: \(\) => deps/, 'WeatherFX exposes its projection to layers above the lighting canvas');
assert.match(read('docs/game.js'), /EmissiveLightOrbs\?\.installGameOverlay\(/, 'the game installs the overlay');
const html = read('docs/index.html');
assert.ok(html.indexOf('js/emissive-light-orbs.js') > 0 && html.indexOf('js/emissive-light-orbs.js') < html.indexOf('src="game.js'), 'the module loads before game.js');
assert.match(read('docs/js/emissive-light-orbs.js'), /z-index:4;/, 'the orb canvas stacks above the lighting canvas (z-index 3)');
assert.match(read('docs/js/emissive-light-orbs.js'), /RuntimeFrameScheduler\?\.register\(SCHEDULER_ID, frame, \{\s*phase: 'post-game'/, 'redrawn every browser frame through the frame scheduler');
assert.match(read('docs/tools/enemy-loadout-editor/preview.js'), /EmissiveLightOrbs\?\.drawOrbs\(/, 'the Workshop viewport draws the orbs over its own darkness');

console.log('Emissive light orbs: additive circles above darkness/fog, front-facing only, faded with scenes, wired in game and Workshop');
