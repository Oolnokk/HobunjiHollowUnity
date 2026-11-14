#!/usr/bin/env node
// Node-only Koma/held-hand integration proof; no browser or WebGL required.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
let disposals = 0; // Counts disposable leaf mesh material+geometry after completion/interruption.
const loadedTextures = []; // Verifies the existing PNG is loaded and reused, not recreated for each yawn.
const THREE = {};
class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  applyMatrix4() { return this; }
}
class Quat {
  setFromAxisAngle() { return this; }
  multiply() { return this; }
  copy() { return this; }
}
class Group {
  constructor() {
    this.parent = null; this.children = []; this.userData = {};
    this.position = new Vec3(); this.rotation = { x: 0, y: 0, z: 0 };
    this.quaternion = new Quat();
    this.scale = { x: 1, y: 1, z: 1, setScalar(n) { this.x = this.y = this.z = n; } };
  }
  add(child) { child.parent?.remove(child); this.children.push(child); child.parent = this; }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child.parent === this) child.parent = null;
  }
}
class PlaneGeometry {
  constructor(width, height) { this.parameters = { width, height }; }
  dispose() { disposals++; }
}
class Material { dispose() { disposals++; } }
class Mesh extends Group {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
  updateMatrix() { this.matrix = {}; }
}
THREE.Vector3 = Vec3;
THREE.Quaternion = Quat;
THREE.Group = Group;
THREE.Mesh = Mesh;
THREE.PlaneGeometry = PlaneGeometry;
THREE.MeshBasicMaterial = Material;
THREE.TextureLoader = class { load(url) { loadedTextures.push(url); return { colorSpace: 'none' }; } };
THREE.DoubleSide = 2;
THREE.SRGBColorSpace = 'srgb';
THREE.MathUtils = { degToRad: degrees => degrees * Math.PI / 180 };

let now = 100;
const window = {
  HobunjiSpritePngSurface: { makeMaterial: () => new Material() },
  PngPlaneOutlineOccluder: { markPngPlane() {} },
};
const context = { window, performance: { now: () => now } };
vm.runInNewContext(read('docs/js/character-action-locks.js'), context);
vm.runInNewContext(read('docs/js/npc-drink-interaction.js'), context);
const locks = window.CharacterActionLocks;
const drink = window.NpcDrinkInteraction;
const world = new Group();
const walker = {
  rec: { id: 'longoran-test' }, area: 'farm', root: new Group(), avatarGroup: new Group(),
};
world.add(walker.root);
const handParent = new Group(); // Normal NPC rig parents are nested within the outer world walker root.
walker.root.add(handParent);
handParent.add(walker.avatarGroup);
walker.avatarGroup.userData.proceduralHandRig = { parent: handParent };
walker.avatarGroup.userData.portraitModelWidth = 0.9;
walker.avatarGroup.userData.portraitModelHeight = 1.2;
walker.avatarGroup.userData.handAttachX = -.2;
walker.avatarGroup.userData.handAttachY = .4;
const toasts = [];
const drinkAnimation = { durationS: .95, strikeFrac: .62 }; // Existing authored drink curve, stretched to five seconds for Koma.
drink.init({
  THREE, actionLocks: locks, getDrinkAnimation: () => drinkAnimation,
  getCurrentArea: () => 'farm',
  getItemDef: () => null, // Koma PNG is never a fake inventory definition.
  npcParticipantId: id => 'npc:' + id,
  poseAt: () => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, bodyYaw: 0, headRelative: false }),
  disposeBottlePlane: (plane, parent) => {
    parent?.remove(plane);
    plane.geometry?.dispose?.(); plane.material?.dispose?.();
  },
  clamp: (number, min, max) => Math.max(min, Math.min(max, number)),
  log() {},
});
assert.equal(drink.playDailyKoma(walker, () => toasts.push('chew'), 5), 5000);
assert.equal(loadedTextures.length, 1);
assert.equal(loadedTextures[0], 'assets/leaves/koma_leaf.png');
assert.equal(drink.heldItemTarget(walker.root)?.holder?.name, undefined,
  'private autonomous drink holder may remain unnamed');
assert.ok(drink.heldItemTarget(handParent), 'direct NPC hand parent must resolve the leaf; querying only the outer world root does not suffice');
assert.ok(locks.isLocked('npc:longoran-test', 'tools'), 'the Koma animation locks other tools');
assert.equal(locks.isLocked('npc:longoran-test', 'movement'), false, 'the yawn movement speed modifier remains authoritative');
walker._moveSpeedTiles = 0.6;
walker.root.rotation.y = 1.2; // The walker changed direction while slowly moving through its Koma ceremony.
drink.update(0.2);
assert.equal(walker.root.rotation.y, 1.2, 'the ceremonial drink must respect current pathing facing, not the pre-yawn facing');
walker._moveSpeedTiles = 0;
drink.update(2.85);
assert.equal(toasts.length, 0, 'do not announce chewing before the real drink strike');
drink.update(0.1);
assert.equal(toasts.length, 1, 'apply the Koma effect at the authored drink strike');
drink.update(2);
assert.equal(walker.root.rotation.y, 1.2, 'completion preserves the most recent NPC movement direction');
assert.equal(drink.getDebug().length, 0, 'a completed drink fully clears its runtime state');
assert.equal(drink.heldItemTarget(handParent), null, 'completed leaf releases nested hand target');
assert.equal(drink.heldItemTarget(walker.root), null, 'completed leaf releases world-root hand target');
assert.equal(locks.isLocked('npc:longoran-test', 'tools'), false);
assert.equal(disposals, 2, 'completion disposes its geometry and material, retaining the shared PNG');
assert.equal(drink.playDailyKoma(walker, () => toasts.push('late'), 5), 5000);
assert.equal(loadedTextures.length, 1, 'texture must be shared between consecutive daily rituals');
assert.ok(drink.heldItemTarget(handParent));
drink.stopAutonomous(walker, '__daily_koma_leaf__');
assert.equal(toasts.length, 1, 'combat interruption before strike never awards chewing');
assert.equal(drink.heldItemTarget(handParent), null, 'interruption clears hand alias');
assert.equal(drink.heldItemTarget(walker.root), null);
assert.equal(drink.getDebug().length, 0);
assert.equal(locks.isLocked('npc:longoran-test', 'tools'), false);
assert.equal(disposals, 4, 'interruption disposes both transient per-actor resources');

// Player Koma reuses the exact same leaf/drink, but must lock the REAL player participant
// and never let the NPC body-yaw interpolation overwrite the player's camera-relative facing.
const playerRoot = new Group(), playerAvatar = new Group(); // Mirrors playerMesh and its avatarGroup child.
world.add(playerRoot); playerRoot.add(playerAvatar);
playerAvatar.userData.proceduralHandRig = { parent: playerRoot };
const playerWalker = {
  rec: { id: '__player_daily_koma__' }, area: 'farm', root: playerRoot, avatarGroup: playerAvatar,
};
let playerChews = 0; // Only advances at the actual drink strike for this player-scoped ceremony.
assert.equal(drink.playDailyKoma(playerWalker, () => { playerChews++; }, 5, {
  participantId: 'player', allowWalking: false, preserveFacing: true,
}), 5000);
assert.equal(locks.isLocked('player', 'movement'), true, 'player Koma must lock player movement, not a dummy NPC key');
assert.equal(locks.isLocked('player', 'tools'), true);
assert.equal(locks.isLocked('player', 'actions'), true);
assert.equal(locks.isLocked('npc:__player_daily_koma__', 'actions'), false);
assert.ok(drink.heldItemTarget(playerRoot), 'player hand driver must see the Koma leaf as a held item');
playerRoot.rotation.y = 2.2;
drink.update(1);
assert.equal(playerRoot.rotation.y, 2.2, 'the player keeps live facing even when the authored drink pose changes');
assert.equal(playerChews, 0, 'player toast/effect cannot fire before the chew point');
drink.update(2.2);
assert.equal(playerChews, 1, 'the player completes one chew at the authored strike');
drink.update(2);
assert.equal(playerRoot.rotation.y, 2.2, 'finishing the drink does not restore an obsolete player facing');
assert.equal(locks.isLocked('player', 'actions'), false, 'the player is never stranded in a locked control state');
assert.equal(drink.heldItemTarget(playerRoot), null);
assert.equal(disposals, 6, 'player ritual also disposes its own geometry/material');

console.log('Daily Koma: NPC and player hand grips, true action locks, face direction, strike and cleanup OK');
