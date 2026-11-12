#!/usr/bin/env node
'use strict';

// Exercise the real player/enemy portrait snapshotter with deterministic fake
// canvases and Three resources: repeat moves should reuse GPU objects, while
// face changes, skinned poses, and scene cleanup must remain correct.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/combat/combat-blink-dodge.js', 'utf8'); // Production effect under test.

let nowMs = 1000; // Fake combat clock used to control sampling and idle pool expiry.
const counts = { geometry: 0, materials: 0, textures: 0, meshes: 0, canvases: 0, geometryDisposals: 0, textureDisposals: 0 }; // Allocation counters for detecting per-dodge churn.
class Matrix {
  constructor() { this.elements = Array.from({ length: 16 }, (_, i) => i % 5 === 0 ? 1 : 0); }
  clone() { const matrix = new Matrix(); matrix.elements = this.elements.slice(); return matrix; }
  copy(other) { this.elements = other.elements.slice(); return this; }
  invert() { return this; }
  multiplyMatrices(_parent, local) { return this.copy(local); }
}
class Group {
  constructor() { this.children = []; this.parent = null; this.matrixWorld = new Matrix(); this.userData = {}; this.isScene = false; }
  add(child) { child.parent?.remove?.(child); this.children.push(child); child.parent = this; }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
  }
  traverse(callback) { callback(this); for (const child of this.children) child.traverse ? child.traverse(callback) : callback(child); }
  updateWorldMatrix() {}
}
class PositionAttribute {
  constructor() { this.count = 2; this.values = [1, 2]; }
  setXYZ(index, x) { this.values[index] = x; this.needsUpdate = true; }
}
class Geometry {
  constructor() { this.positions = new PositionAttribute(); }
  clone() { counts.geometry += 1; return new Geometry(); }
  getAttribute(name) { return name === 'position' ? this.positions : null; }
  deleteAttribute() {}
  dispose() { counts.geometryDisposals += 1; }
}
class Texture {
  constructor(image) { this.image = image; }
  clone() { counts.textures += 1; return new Texture(this.image); }
  dispose() { counts.textureDisposals += 1; }
}
class Material {
  constructor(name, texture) {
    this.name = name; this.map = texture; this.opacity = 1; this.alphaTest = 0.35;
  }
  clone() { counts.materials += 1; return Object.assign(new Material(this.name, this.map), this); }
  dispose() {}
}
class Mesh extends Group {
  constructor(geometry, material) {
    super();
    counts.meshes += 1;
    this.geometry = geometry; this.material = material; this.isMesh = true;
    this.matrix = new Matrix(); this.layers = { mask: 1 }; this.renderOrder = 0;
    this.name = ''; this.type = 'Mesh';
  }
}
class Vertex {
  fromBufferAttribute(attribute, index) {
    this.x = attribute.values[index]; this.y = 0; this.z = 0;
    return this;
  }
}
const scene = new Group(); // Holds the two live portrait rigs and transient detached snapshots.
scene.isScene = true;
function makeActor(name, skinned) {
  const root = new Group(); // Root passed to findPortraitMeshes for each actor.
  scene.add(root);
  const image = { width: 8, height: 8, name }; // Mutable live face whose pixels are frozen on each sample.
  const material = new Material('npc_avatar_skinned_front_' + name, new Texture(image)); // Material identity gates safe reuse.
  const portrait = new Mesh(new Geometry(), material); // Rendered portrait plane with optional skinning.
  portrait.name = 'portrait_' + name;
  portrait.isSkinnedMesh = skinned;
  portrait.pose = 0;
  if (skinned) {
    portrait.skeleton = { update() {} };
    portrait.boneTransform = (_index, vertex) => { vertex.x += portrait.pose; };
  }
  root.add(portrait);
  return { root, portrait, material, image };
}
const playerRig = makeActor('player', true); // Skinned reuse must rebake its current vertex positions.
const enemyRig = makeActor('enemy', false); // An independent material/mesh must not inherit the player's ghost.
const player = { x: 0, y: 0, lunging: false, dodging: false, stamina: 200 }; // Drives player forced-motion samples.
const enemy = { x: 0, y: 0, state: 'chase', health: 100, isBandit: true, _banditLunging: false, avatarRef: { group: enemyRig.root } }; // Drives NPC samples.
const combat = {
  abilities: { register() {} },
  deps: { player, playerMesh: playerRig.root, TILE: 64, hostileObjects: [enemy], getCurrentArea: () => null },
  update() {}, setMovementSpeedMul() {},
};
let canvasId = 0; // Distinguishes independent frozen canvas objects in the fake document.
const documentStub = {
  createElement() {
    counts.canvases += 1;
    const canvas = { width: 0, height: 0, id: ++canvasId };
    canvas.getContext = () => ({
      clearRect() { canvas.cleared = true; },
      drawImage(image) { canvas.copiedFace = image.name; },
    });
    return canvas;
  },
};
const windowStub = {
  Combat: combat,
  THREE: { Mesh, Vector3: Vertex },
  BanditCombat: { setCombatExpression() {} },
  WorldPortraitLife: { setPlayerCombatExpression() {}, isPlayerCombatExpressionApplied: () => true },
  HobunjiSpritePngSurface: { alphaTest: () => 0.001 },
};
vm.runInNewContext(source, { window: windowStub, document: documentStub, performance: { now: () => nowMs }, console }, { filename: 'combat-blink-dodge.js' });
const stats = () => windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages; // Mobile diagnostics used to check pooling without relying on internal module functions.
const ghosts = () => scene.children.filter(object => object.name === 'combat_portrait_afterimage'); // Currently attached visual snapshots.
player.lunging = true;
enemy._banditLunging = true;
combat.update(0.016);
player.x += 64;
enemy.x += 64;
nowMs += 60;
combat.update(0.06);
assert.equal(stats().active, 2, 'player and NPC lunges each produce a record');
assert.equal(stats().entriesCreated, 2, 'one live mesh and texture created per portrait source');
assert.equal(counts.geometry, 2);
assert.equal(counts.materials, 2);
assert.equal(counts.textures, 2);
assert.equal(counts.canvases, 2);
const firstMeshes = ghosts(); // Used to ensure both Mesh instances survive the fade/reuse cycle.
assert.equal(firstMeshes.length, 2);
player.lunging = false;
enemy._banditLunging = false;
nowMs += 400;
combat.update(0.4);
assert.equal(stats().active, 0);
assert.equal(stats().pooled, 2);
playerRig.portrait.pose = 5;
playerRig.image.name = 'updated player expression';
player.lunging = true;
enemy._banditLunging = true;
player.x += 64;
enemy.x += 64;
nowMs += 60;
combat.update(0.06);
assert.equal(stats().entriesCreated, 2, 'no new ghost mesh or material after warm-up');
assert.equal(stats().entriesReused, 2, 'both actors reuse their own pooled resources');
assert.equal(counts.geometry, 2, 'geometry cloned once per actor');
assert.equal(counts.materials, 2, 'material cloned once per actor');
assert.equal(counts.textures, 2, 'GPU texture created once per actor');
assert.equal(counts.canvases, 2, 'canvas allocated once per actor');
assert(ghosts().every(mesh => firstMeshes.includes(mesh)), 'ghost mesh identities survive recycling');
assert(ghosts().some(mesh => mesh.geometry.positions.values[0] === 6), 'a reused skinned ghost rebakes its updated pose');
assert(ghosts().some(mesh => mesh.material.map.image.copiedFace === 'updated player expression'), 'recycled textures freeze the latest face instead of displaying stale pixels');
assert(ghosts().every(mesh => mesh.material.opacity > 0), 'recycled ghosts restore opacity after their previous fade');
player.lunging = false;
enemy._banditLunging = false;
nowMs += 400;
combat.update(0.4);
assert.equal(stats().pooled, 2);
nowMs += 4600;
combat.update(0.01);
assert.equal(stats().pooled, 0, 'idle pool releases transient resources after four seconds');
assert(counts.geometryDisposals >= 2 && counts.textureDisposals >= 2, 'expired pooled GPU resources are actually disposed');
console.log('Player/NPC dodge-lunge afterimage pooling regression tests passed.');
