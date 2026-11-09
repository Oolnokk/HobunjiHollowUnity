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
const subscribers = new Map(); // Mimic the game's one authoritative browser-frame scheduler.
function step() {
  const owner = subscribers.get('scratchbones-emoji-reactions'); // Only an enabled pre-render subscriber receives a frame.
  if (owner?.enabled) owner.callback({ timestamp: now, frameId: 1, deltaMs: 16 });
}
class CanvasTexture { constructor(canvas) { this.canvas = canvas; } }
class SpriteMaterial { constructor(options) { Object.assign(this, options); this.rotation = 0; } dispose() {} }
class Sprite {
  constructor(material) {
    this.material = material;
    this.position = { set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.scale = { set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.userData = {};
  }
}
class Box3 { constructor() { this.max = { y: 1.7 }; } setFromObject() { return this; } isEmpty() { return false; } }
class Vector3 { constructor() { this.y = 0; } }
class FakeImage {
  constructor() { this.width = 42; this.height = 30; }
  set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
}
function canvas() {
  return { width: 0, height: 0, getContext: () => ({
    drawImage() {}, fillRect() {}, set imageSmoothingEnabled(v) {}, set globalCompositeOperation(v) {},
    set fillStyle(v) {}, set shadowColor(v) {}, set shadowBlur(v) {},
  }) };
}
const win = { // The minimal public Three/canvas interface used by the shared sprite renderer.
  THREE: { CanvasTexture, SpriteMaterial, Sprite, Box3, Vector3, LinearFilter: 1, SRGBColorSpace: 'srgb' },
  RuntimeFrameScheduler: {
    register(id, callback, options) {
      assert.equal(options.phase, 'pre-render', 'emoji motion runs after simulation and before rendering');
      assert.equal(options.enabled, false, 'emoji work must be initially dormant');
      subscribers.set(id, { callback, enabled: false });
    },
    setEnabled(id, enabled) {
      const owner = subscribers.get(id); // Record transitions to assert that finished effects sleep.
      assert.ok(owner, 'subscriber is registered');
      owner.enabled = enabled;
    },
  },
};
const context = { // Browser shim: no game loop or visual renderer is required for unit checks.
  window: win, Image: FakeImage, URL, URLSearchParams,
  document: { currentScript: { src: 'https://example.test/js/scratchbones-emoji-reactions.js' }, createElement: canvas },
  performance: { now: () => now }, Date, Promise, queueMicrotask,
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/scratchbones-emoji-reactions.js'), 'utf8'), context);
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
  return {
    name: 'test-actor', isObject3D: true, parent: {}, visible: true, children: [],
    add(sprite) { sprite.parent = this; this.children.push(sprite); },
    remove(sprite) { this.children.splice(this.children.indexOf(sprite), 1); sprite.parent = null; },
    updateWorldMatrix() {},
    getWorldPosition(target) { target.y = 0; return target; },
    getWorldScale(target) { target.y = 1; return target; },
  };
}

(async () => {
  const livestock = actor(); // Livestock exercises the shared happy-reaction path.
  assert.equal(api.trigger(livestock, 'love'), true);
  assert.equal(api.trigger(livestock, 'disgust'), false, 'per-creature cooldown');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(livestock.children.length, 1);
  assert.ok(livestock.children[0].material.map, 'asset texture should be loaded');
  assert.equal(livestock.children[0].material.depthTest, true, 'world geometry occludes emojis');
  assert.equal(subscribers.get('scratchbones-emoji-reactions').enabled, true);
  now = 1651;
  step();
  assert.equal(livestock.children.length, 0, 'ended reaction disposed');
  assert.equal(subscribers.get('scratchbones-emoji-reactions').enabled, false, 'do not tick when no emotes are active');

  const npc = actor(); // NPC uses the identical renderer for the five-ray shock burst.
  assert.equal(api.trigger(npc, 'shock'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(npc.children.length, 5);
  now += 1600;
  step();
  assert.equal(npc.children.length, 0);

  const gloatingNpc = actor(); // Ensure the raining-coin effect cannot outlive a hidden/despawned actor.
  assert.equal(api.trigger(gloatingNpc, 'gloat'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gloatingNpc.children.length, 19);
  gloatingNpc.visible = false;
  step();
  assert.equal(gloatingNpc.children.length, 0);
  assert.equal(api.debugSnapshot().active, 0);
  assert.equal(subscribers.get('scratchbones-emoji-reactions').enabled, false);

  const overlappingNpc = actor(); // Another emote on the same NPC must replace, not stack with the gloat cloud.
  assert.equal(api.trigger(overlappingNpc, 'gloat'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlappingNpc.children.length, 19);
  now += 1000;
  assert.equal(api.trigger(overlappingNpc, 'love'), true);
  assert.equal(overlappingNpc.children.length, 0, 'replace previous particles before measuring actor height');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlappingNpc.children.length, 1);
  now += 1700;
  step();
  assert.equal(overlappingNpc.children.length, 0);

  const pending = actor(); // Two same-frame requests must not emit stale effects after async PNG loading.
  assert.equal(api.trigger(pending, 'curious'), true);
  assert.equal(api.trigger(pending, 'alarmed', { force: true }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.children.length, 1, 'newer emotion wins pending texture races');
  pending.parent = null;
  step();
  assert.equal(pending.children.length, 0);
  assert.equal(api.debugSnapshot().active, 0);
  console.log('Scratchbones emoji reactions: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
