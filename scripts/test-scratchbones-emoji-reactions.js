// Tests Scratchbones emoji animation curves, shared mask assets, and actor cleanup.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..'); // Base for production modules and ported source artwork.
const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
assert.match(html, /js\/scratchbones-emoji-reactions\.js\?v=/);
for (const icon of ['love', 'disgust', 'alarmed', 'curious', 'gloat_cloud', 'gloat_coin1', 'gloat_coin2', 'gloat_coin3']) {
  assert.ok(fs.existsSync(path.join(root, 'docs/assets/symbols/emoji_' + icon + '.png')), 'missing original symbol: ' + icon);
}

let now = 0; // Simulated monotonic animation frame clock.
class Vector3 {
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  setFromMatrixColumn(matrix, index) { return this.set(index === 0 ? 1 : 0, 0, index === 2 ? 1 : 0); }
  normalize() { return this; }
}
class Group {
  constructor() {
    this.isObject3D = true;
    this.visible = true;
    this.children = [];
    this.position = new Vector3().set(0, 0, 0);
    this.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0] };
    this.quaternion = { copy(source) { this.source = source; } };
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
  getWorldPosition(target) { return target.set(this.position.x, this.position.y, this.position.z); }
  getWorldScale(target) { return target.set(1, 1, 1); }
}
class Disposable { dispose() { this.disposed = true; } }
class Mesh extends Group {
  constructor(geometry, material) {
    super();
    Object.assign(this, { geometry, material, isMesh: true, scale: new Vector3(), rotation: {} });
  }
}
class Box3 { constructor() { this.max = { y: 1.7 }; } setFromObject() { return this; } isEmpty() { return false; } }
let failNextImage = false; // Exercises recovery when a CDN image fails or refuses CORS.
let strongestGlowBlur = 0; // Captures the largest cached emoji mask glow to prevent over-bright reactions.
class FakeImage {
  constructor() { this.naturalWidth = 42; this.naturalHeight = 30; }
  set src(value) {
    assert.equal(this.crossOrigin, 'anonymous', 'set CORS before loading PNGs');
    assert.match(value, /^https:\/\/example.test\/assets\/symbols\/emoji_/);
    const fail = failNextImage;
    failNextImage = false;
    queueMicrotask(() => fail ? this.onerror() : this.onload());
  }
}
function canvas() {
  return { width: 0, height: 0, getContext: () => ({
    set shadowBlur(value) { strongestGlowBlur = Math.max(strongestGlowBlur, value); },
    drawImage() {}, fillRect() {}, getImageData: () => ({ data: [0, 0, 0, 255] }),
  }) };
}
const win = {
  THREE: { Group, Mesh, Box3, Vector3, PlaneGeometry: Disposable },
  HobunjiSpritePngSurface: {
    makeCanvasTexture(THREE, canvas) { return Object.assign(new Disposable(), { canvas, isCanvasTexture: true }); },
    makeMaterial(THREE, map, name, options) { return Object.assign(new Disposable(), { map, name }, options); },
  },
  RewardReadout: { enqueue() { assert.fail('Reactions must not enter the reward queue'); } },
};
const context = { // Runs both production modules with the minimal Three/canvas interface.
  window: win, Image: FakeImage, URL, URLSearchParams,
  document: { currentScript: { src: 'https://example.test/js/scratchbones-emoji-reactions.js' }, createElement: canvas, getElementById: () => null },
  performance: { now: () => now }, Date, Promise, queueMicrotask,
};
for (const file of ['world-popup-text.js', 'scratchbones-emoji-reactions.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js', file), 'utf8'), context);
}
const scene = Object.assign(new Group(), { isScene: true }); // World popup meshes attach here, outside the actor rig.
const camera = new Group(); // Shared popup camera determines the group's billboard rotation.
const popup = win.WorldPopupText.init({ THREE: win.THREE, camera, getActiveScene: () => scene });
const step = () => popup.update(now); // Drives the same entry point used by gameLoop.
const settle = () => new Promise(resolve => setImmediate(resolve)); // Wait for async PNG composition and popup attachment.
const api = win.HobunjiEmojiReactions; // Public API exposed to NPC and livestock gameplay.
assert.ok(api?.trigger && api?.reactToDialogue && api?.debugSnapshot);
assert.equal(api.reactionForDialogue({ greeting: true }), 'curious');
assert.equal(api.reactionForDialogue({ tone: 'reaction-music-positive' }), 'love');
assert.equal(api.reactionForDialogue({ tone: 'reaction-dance-negative' }), 'disgust');
assert.equal(api.reactionForDialogue({ tone: 'animal' }), null);
assert.equal(api.reactionForDialogue({ tone: 'refuse' }), 'disgust');
assert.equal(api.reactionForDialogue({ tone: 'cheer' }), 'gloat');
assert.equal(api.reactionForDialogue({ tone: 'reaction-silliness-positive' }), 'gloat');
assert.equal(api.reactionForDialogue({ tone: 'shock' }), 'shock');
assert.equal(api.reactionForDialogue({ tone: 'warning' }), 'alarmed');
assert.equal(api.reactionForDialogue({ emojiReaction: false, tone: 'cheer' }), null);
for (const kind of ['love', 'disgust', 'alarmed', 'curious', 'shock', 'gloat']) {
  for (const t of [0, .1, .3, .6, .9, 1]) {
    const pose = api.sample(kind, t, kind === 'gloat' ? 'cloud' : 'icon', 0);
    for (const key of ['x', 'y', 'scale', 'alpha', 'rotation']) {
      assert.ok(Number.isFinite(pose[key]), kind + ' non-finite ' + key);
    }
    assert.ok(pose.alpha >= 0 && pose.alpha <= 1, kind + ' opacity out of bounds');
  }
}

function actor() {
  const root = Object.assign(new Group(), { name: 'test-actor' }); // NPC and livestock rigs use the same popup anchor path.
  scene.add(root);
  return root;
}
function billboard() { return scene.children.find(group => !group.name); }

(async () => {
  const livestock = actor(); // Livestock exercises the shared happy-reaction path.
  failNextImage = true;
  assert.equal(api.trigger(livestock, 'love'), true);
  await settle();
  assert.equal(billboard(), undefined, 'missing PNG never creates a blank quad');
  assert.equal(api.debugSnapshot().failedAssets, 1);
  assert.equal(api.trigger(livestock, 'love', { force: true }), true);
  assert.equal(api.trigger(livestock, 'disgust'), false, 'per-creature cooldown');
  await settle();
  const love = billboard(); // The same render flags as ordinary popup text qualify it for the final overlay.
  assert.equal(livestock.children.length, 0);
  assert.equal(love.children.length, 1);
  const icon = love.children[0];
  assert.equal(strongestGlowBlur, 5, 'emoji mask glow must remain subtle');
  assert.equal(icon.isMesh, true);
  assert.equal(icon.material.map.isCanvasTexture, true);
  assert.equal(icon.material.depthTest, false);
  assert.equal(icon.material.depthWrite, false);
  assert.equal(icon.renderOrder, 1200);
  now = 300;
  livestock.position.set(7, 2, 3);
  step();
  assert.equal(love.position.x, 7, 'billboard follows the live actor');
  assert.ok(love.position.y > 3.9, 'anchor remains above the actor');
  assert.equal(love.quaternion.source, camera.quaternion);
  assert.ok(icon.visible && icon.material.opacity > 0);
  const expectedSize = Math.max(.25, Math.min(.62, 1.7 * .38)) / 3; // Actor bounds are 1.7 high in this mock; the reaction is a third of its former size.
  const expectedScale = expectedSize * api.sample('love', now / 1650).scale; // Original animation curves still drive the smaller billboard.
  assert.ok(Math.abs(icon.scale.x - expectedScale) < 1e-9, 'emoji width must be one-third of previous baseline');
  assert.ok(Math.abs(icon.scale.y - expectedScale) < 1e-9, 'emoji height must be one-third of previous baseline');
  now = 1651;
  step();
  assert.equal(billboard(), undefined, 'ended reaction removed');
  assert.ok(icon.geometry.disposed && icon.material.disposed && icon.material.map.disposed);

  const npc = actor(); // Dialogue uses the same renderer for the five-ray shock burst.
  assert.equal(api.reactToDialogue(npc, { tone: 'shock' }), true);
  await settle();
  assert.equal(billboard().children.length, 5);
  now += 1600;
  step();
  assert.equal(billboard(), undefined);

  const gloatingNpc = actor(); // Ensure the raining-coin effect cannot outlive a hidden actor.
  assert.equal(api.trigger(gloatingNpc, 'gloat'), true);
  await settle();
  assert.equal(billboard().children.length, 19);
  assert.equal(new Set(billboard().children.map(coin => coin.material.map)).size, 4, 'repeated coins share textures');
  gloatingNpc.visible = false;
  step();
  assert.equal(billboard(), undefined);
  assert.equal(api.debugSnapshot().active, 0);

  const pending = actor(); // Only the latest reaction may attach after async PNG loading.
  assert.equal(api.trigger(pending, 'curious'), true);
  assert.equal(api.trigger(pending, 'alarmed', { force: true }), true);
  await settle();
  assert.equal(billboard().children[0].name, 'scratchbones_emoji_alarmed');
  assert.equal(api.trigger(pending, 'gloat', { force: true }), true);
  assert.equal(billboard(), undefined, 'replacing a popup removes its previous billboard immediately');
  assert.equal(popup.releaseScene(scene), 1, 'zone eviction also cancels an outstanding image load');
  await settle();
  assert.equal(billboard(), undefined);
  assert.equal(api.debugSnapshot().active, 0);
  assert.equal(api.trigger(pending, 'love', { force: true }), true);
  await settle();
  popup.clear();
  assert.equal(billboard(), undefined);
  console.log('Scratchbones emoji reactions: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
