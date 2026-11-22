// Tests Scratchbones emoji animation curves, shared mask assets, and actor cleanup.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { expandClassicScriptGroups } = require('./classic-script-group-index.js'); // Ensures the authored emoji renderer ships from its parser-ordered service manifest.

const root = path.join(__dirname, '..'); // Base for production modules and ported source artwork.
const html = expandClassicScriptGroups(fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'));
assert.match(html, /js\/scratchbones-emoji-reactions\.js\?v=/);
for (const icon of ['love', 'disgust', 'alarmed', 'curious', 'gloat_cloud', 'gloat_coin1', 'gloat_coin2', 'gloat_coin3']) {
  assert.ok(fs.existsSync(path.join(root, 'docs/assets/symbols/emoji_' + icon + '.png')), 'missing original symbol: ' + icon);
}

let now = 0; // Simulated monotonic animation frame clock.
class Vector3 {
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  setFromMatrixColumn(matrix, index) { const elements = matrix.elements; return this.set(elements[index * 4], elements[index * 4 + 1], elements[index * 4 + 2]); }
  addScaledVector(vector, scale) { this.x += vector.x * scale; this.y += vector.y * scale; this.z += vector.z * scale; return this; }
  normalize() { return this; }
}
class Group {
  constructor() {
    this.isObject3D = true;
    this.visible = true;
    this.children = [];
    this.position = new Vector3().set(0, 0, 0);
    this.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
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
let portraitsFlipped = true; // Matches the default humanoid portrait setting and can change during a reaction.
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
  PNGPlaneAvatar: { getPortraitsFlipped: () => portraitsFlipped },
  AnimalChatheadFrame: { frameForKind: kind => ({ frame: kind === 'skeeri-medium' ? { x: .6611149088541667, y: .24899449865398673, width: .04, height: .04 } : { x: .25, y: .18, width: .30, height: .30 } }) }, // Skeeri's actual authored chathead is on source-right; other creatures use a source-left test crop.
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
function projectedChatheadEdge(actorRoot, frame, width, axisProjection, side) {
  const screenCenter = -(frame.x + frame.width / 2 - .5) * width * axisProjection; // Mirrors the source-x direction of both rendered animal faces.
  const screenHalfWidth = frame.width / 2 * width * Math.abs(axisProjection); // Visible crop width contracts for an edge-on animal.
  return actorRoot.position.x + screenCenter + side * screenHalfWidth;
}

(async () => {
  const livestock = actor(); // Livestock exercises the shared happy-reaction path.
  failNextImage = true;
  const animalOptions = { creatureKind: 'nelk', height: 1.2, width: 1.8 }; // Supplies real farm-animal metadata for the same shared reaction hook.
  assert.equal(api.trigger(livestock, 'love', animalOptions), true);
  await settle();
  assert.equal(billboard(), undefined, 'missing PNG never creates a blank quad');
  assert.equal(api.debugSnapshot().failedAssets, 1);
  assert.equal(api.trigger(livestock, 'love', { ...animalOptions, force: true }), true);
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
  now = 825;
  livestock.position.set(7, 2, 3);
  livestock.matrixWorld.elements[8] = 1; livestock.matrixWorld.elements[10] = 0; // Front-facing animal card projects its whole Z-axis sprite width onto camera right.
  step();
  const nelkFrame = win.AnimalChatheadFrame.frameForKind('nelk').frame; // Same species-authored normalized crop as the reaction.
  const headRight = projectedChatheadEdge(livestock, nelkFrame, animalOptions.width, 1, 1); // The simulated reversed card shows its muzzle on screen-right.
  assert.ok(love.position.x > headRight, 'reversed animal emoji sits to the right of its visible muzzle crop');
  assert.ok(love.position.y > 2 && love.position.y < 2.5, 'animal emoji sits at chathead level, not above the full actor');
  assert.equal(love.position.z, 3, 'side anchoring must not move the popup toward or away from the camera');
  assert.equal(api.debugSnapshot().last.side, 'animal-facing');
  assert.equal(love.quaternion.source, camera.quaternion);
  const faceOnOffsetX = love.position.x; // Used to detect head alignment changes after rotating the animal plane.
  const initialDrift = icon.position.x; // Compare the same frame on both faces to verify the animation also mirrors.
  assert.ok(initialDrift > 0, 'reversed animal animation drifts outward to screen-right');
  livestock.matrixWorld.elements[8] = 0; livestock.matrixWorld.elements[10] = 1; // Edge-on card projects a narrower head crop.
  step();
  assert.ok(love.position.x < faceOnOffsetX && love.position.x > livestock.position.x, 'reversed animal emoji follows the projected muzzle width as the sprite turns');
  livestock.matrixWorld.elements[8] = -1; livestock.matrixWorld.elements[10] = 0; // Fully reverse the visible face, including the texture's horizontal mirroring.
  step();
  assert.ok(love.position.x < projectedChatheadEdge(livestock, nelkFrame, animalOptions.width, -1, -1), 'animal emoji switches to the left of the muzzle on the source-facing card');
  assert.ok(Math.abs(love.position.x - (2 * livestock.position.x - faceOnOffsetX)) < 1e-9, 'the head anchor and gutter mirror exactly');
  assert.equal(icon.position.x, -initialDrift, 'animal emoji animation mirrors with the anchor');
  livestock.matrixWorld.elements[8] = 0;
  step();
  assert.ok(love.position.x < livestock.position.x, 'an edge-on card keeps the last visible muzzle side');
  assert.ok(icon.visible && icon.material.opacity > 0);
  const expectedSize = Math.max(.25, Math.min(.62, 1.7 * .38)) * 2 / 3; // Double the former one-third animal reaction size.
  const expectedScale = expectedSize * api.sample('love', now / 1650).scale; // Original curves still drive the billboard scale.
  assert.ok(Math.abs(icon.scale.x - expectedScale) < 1e-9, 'animal emoji width doubles');
  assert.ok(Math.abs(icon.scale.y - expectedScale) < 1e-9, 'animal emoji height doubles');
  now = 1651;
  step();
  assert.equal(billboard(), undefined, 'ended reaction removed');
  assert.ok(icon.geometry.disposed && icon.material.disposed && icon.material.map.disposed);

  const rightHeadAnimal = actor(); // An off-center head on the opposite half of a sprite catches incorrect absolute-value shortcuts.
  const walker = actor(); // Named animal dialogue anchors to its card group even when triggered on the walker root.
  scene.remove(rightHeadAnimal);
  walker.add(rightHeadAnimal);
  rightHeadAnimal.position.set(2, 0, 0);
  const frontPlane = new Group(); // A rendered card can turn independently of its movement root.
  frontPlane.updateWorldMatrix = () => {};
  const rightHeadOptions = { creatureKind: 'skeeri-medium', width: 2.1, height: 1.1,
    faceWalker: { animalAvatarRef: { group: rightHeadAnimal, frontPlane } }, greeting: true };
  assert.equal(api.reactToDialogue(walker, rightHeadOptions), true);
  await settle();
  now += 200;
  frontPlane.matrixWorld.elements[0] = Math.cos(Math.PI / 2 + Math.PI / 2); // Real east-facing animal: front card +90°, group +90°; its back/mirrored card is visible.
  frontPlane.matrixWorld.elements[13] = .4; // The renderer shifts the card up to compensate for authored ground padding.
  step();
  const rightHeadFrame = win.AnimalChatheadFrame.frameForKind('skeeri-medium').frame;
  assert.ok(rightHeadFrame.x + rightHeadFrame.width / 2 > .5, 'Skeeri genuinely has a source-right head crop');
  assert.ok(billboard().position.x < projectedChatheadEdge(rightHeadAnimal, rightHeadFrame, rightHeadOptions.width, 1, -1),
    'east-facing Skeeri shows the mirrored source-right head on screen-left, so its emoji belongs on screen-left');
  assert.ok(Math.abs(billboard().position.y - (.4 + (0.5 - rightHeadFrame.y - rightHeadFrame.height * .5 + .045) * rightHeadOptions.height)) < 1e-9,
    'animal reaction follows the card’s rendered height after ground padding');
  const cardOffset = billboard().position.x - rightHeadAnimal.position.x; // Root orientation stays fixed during the card's independently animated turn.
  frontPlane.matrixWorld.elements[0] = Math.cos(-Math.PI / 2 + Math.PI / 2); // Real west-facing animal: front card +90°, group -90°, so the source art is shown unmirrored.
  step();
  assert.ok(billboard().position.x > projectedChatheadEdge(rightHeadAnimal, rightHeadFrame, rightHeadOptions.width, -1, 1),
    'west-facing Skeeri shows the original right-hand head on screen-right, so its emoji belongs on screen-right');
  assert.ok(Math.abs(billboard().position.x - (rightHeadAnimal.position.x - cardOffset)) < 1e-9,
    'named animal emoji mirrors around its avatar group using the rendered card direction');
  now += 700;
  step();
  assert.equal(billboard(), undefined, 'opposite-head crop reaction completes normally');

  const npc = actor(); // Dialogue uses the same renderer for the five-ray shock burst.
  assert.equal(api.reactToDialogue(npc, { tone: 'shock' }), true);
  await settle();
  assert.equal(billboard().children.length, 5);
  now += 300;
  step();
  const npcReaction = billboard(); // NPC popups anchor beside the head, not above the character.
  assert.equal(api.debugSnapshot().last.side, 'npc-left');
  assert.ok(npcReaction.position.x < npc.position.x, 'default flipped NPC portrait places its emoji left of the head');
  assert.ok(npcReaction.position.y > .9 && npcReaction.position.y < 1.7, 'NPC emoji is near the head rather than high above it');
  assert.equal(api.debugSnapshot().last.size, expectedSize / 2, 'NPCs retain their original size');
  const npcOffset = npcReaction.position.x - npc.position.x; // Compare the anchor at the same point in the shock animation.
  const shockRayX = npcReaction.children[0].position.x; // A leftmost ray crosses to the opposite side when mirrored.
  assert.ok(shockRayX > 0, 'NPC shock rays mirror outward from the left-hand anchor');
  portraitsFlipped = false;
  step();
  assert.equal(npcReaction.position.x, npc.position.x - npcOffset, 'turning off portrait flip moves an active NPC emoji to screen-right');
  assert.equal(npcReaction.children[0].position.x, -shockRayX, 'shock rays mirror their travel');
  portraitsFlipped = true;
  step();
  assert.equal(npcReaction.position.x, npc.position.x + npcOffset, 'restoring the portrait flip moves the active emoji back left');
  camera.matrixWorld.elements[0] = 0; camera.matrixWorld.elements[2] = 1; // Turn the camera's right vector onto world Z without rotating the actor.
  step();
  assert.equal(npcReaction.position.x, npc.position.x, 'side offset follows camera right, not fixed world X');
  assert.ok(npcReaction.position.z < npc.position.z, 'NPC emoji remains on the visible left after camera turns');
  camera.matrixWorld.elements[0] = 1; camera.matrixWorld.elements[2] = 0;
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
