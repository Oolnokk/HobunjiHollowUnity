#!/usr/bin/env node
// Run with: node scripts/test-player-yawn-stretch-presentation.js
// Exercises final-render stretch, held-object hiding and action-lock cleanup without a browser.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  clone() { return new Vector(this.x, this.y, this.z); }
  copy(other) { Object.assign(this, { x: other.x, y: other.y, z: other.z }); return this; }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  copy(other) { Object.assign(this, { x: other.x, y: other.y, z: other.z, w: other.w }); return this; }
}
class Node {
  constructor(name = '', type = 'Group') {
    this.name = name; this.type = type; this.isObject3D = true;
    this.children = []; this.parent = null; this.visible = true;
    this.position = new Vector(); this.quaternion = new Quaternion(); this.userData = {};
  }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(node => node !== child); child.parent = null; }
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) { const found = child.getObjectByName?.(name); if (found) return found; }
    return null;
  }
  traverse(visit) { visit(this); for (const child of this.children) child.traverse?.(visit); }
  rotateX(angle) { this.quaternion.x += angle; }
  rotateZ(angle) { this.quaternion.z += angle; }
  updateMatrixWorld() {}
}
class Mesh extends Node {
  constructor(geometry, material) {
    super('', 'Mesh'); this.isMesh = true; this.geometry = geometry; this.material = material;
  }
}
class Geometry { setAttribute() {} dispose() {} }
class Material { constructor() { this.colorWrite = true; } dispose() {} }
const THREE = { Mesh, BufferGeometry: Geometry, Float32BufferAttribute: class {},
  MeshBasicMaterial: Material }; // Only the invisible sentinel's Three.js surface is needed in this test.

const playerMesh = new Node('player');
const avatar = new Node('avatar');
avatar.userData.portraitModelHeight = 0.9; // Reused by the reach-length calculation.
playerMesh.add(avatar);
const handGroup = new Node('hands');
avatar.add(handGroup);
const left = new Node('left_hand_socket'), right = new Node('right_hand_socket');
left.position.x = -0.15; right.position.x = 0.15;
handGroup.add(left); handGroup.add(right);
let poseOwner = null; // Mirrors ProceduralHandAttachments' scoped hand-pose owner.
let poseProvider = null; // Lets the native hand driver apply the active hand pose before the yawn's final-render layer.
const rig = {
  group: handGroup,
  armLengthForSide: () => 0.3,
  setPoseProvider(owner, provider) {
    if (provider || poseOwner === owner) {
      poseOwner = provider ? owner : null;
      poseProvider = provider || null;
    }
  },
  applyOwnedPose() { if (!poseProvider) return false; poseProvider(this); return true; },
  getDebug: () => ({ poseOwner }),
  useIdlePose() {
    left.position.copy(new Vector(-0.15, 0, 0));
    right.position.copy(new Vector(0.15, 0, 0));
    left.quaternion.copy(new Quaternion());
    right.quaternion.copy(new Quaternion());
    left.visible = true;
    right.visible = true;
  },
}; // Owns the existing procedural rig's neutral hand placement rather than removing the player's equipment.
avatar.userData.proceduralHandRig = rig;
const tool = new Node('weapon_holder'); // Independently parented external held-tool root.
const bag = new Node(); // The unnamed PNG-held item group on playerMesh.
bag.userData.isPngPlane = true;
playerMesh.add(bag);
const burden = new Node('hand_burden');
const invisibleTool = new Node('already_hidden');
invisibleTool.visible = false; // An initially stowed visual must stay stowed after the yawn.

const locks = []; // Mock CharacterActionLocks token ledger.
let nextId = 0; // Supplies a separate token for each acquired yawn.
const actionLocks = {
  getDebug: () => locks.map(item => item),
  acquire(options) {
    const record = { ...options, token: ++nextId };
    locks.push(record);
    return { release() { locks.splice(locks.indexOf(record), 1); } };
  },
};
const channels = new Map(); // Body compositor's active animation channels.
const window = {
  THREE,
  Combat: { deps: { playerMesh, toolHolder: tool, getHeldItemHandTarget: () => ({ holder: bag }) } },
  PlayerBodyTransformComposer: {
    getPlayerMesh: () => playerMesh,
    clearChannel: id => channels.delete(id),
    setChannel: (id, contribution) => channels.set(id, contribution),
  },
  CharacterActionLocks: actionLocks,
  Shattercasks: { heldHandTarget: () => ({ holder: burden }) },
};
const source = fs.readFileSync(path.join(__dirname, '../docs/js/player-yawn-stretch-presentation.js'), 'utf8');
vm.runInNewContext(source, { window }, { filename: 'player-yawn-stretch-presentation.js' });
const presentation = window.PlayerYawnStretchPresentation;
const yawn = { isPlayer: true, komaStarted: false, walker: { root: playerMesh, avatarGroup: avatar } };
assert.equal(presentation.actionBlocked(), false);
left.position.y = 0.30; right.position.y = 0.34; // A held tool's native grip is not the free-hand resting position.
assert.equal(presentation.start(yawn), true, 'player yawn takes presentation ownership');
assert.equal(rig.getDebug().poseOwner, 'player-yawn-stretch', 'the yawn claims the real rig before the native hand frame runs');
assert.equal(rig.applyOwnedPose(), true, 'the native hand frame invokes the scoped idle-pose provider');
assert.equal(left.position.y, 0, 'hidden weapon grip is explicitly replaced with the neutral left-hand base');
assert.equal(right.position.y, 0, 'hidden weapon grip is explicitly replaced with the neutral right-hand base');
assert.equal(tool.visible, false, 'weapons and tools disappear without changing the selected equipment');
assert.equal(bag.visible, false, 'ordinary inventory-held objects also disappear');
assert.equal(burden.visible, false, 'hand-carried burdens also disappear, not back-stowed items');
assert.equal(presentation.actionBlocked(yawn), false, 'the yawn must not block itself with its own action lock');
assert.equal(presentation.actionBlocked(), true, 'new tool/actions may not start while the yawn is active');
presentation.update(yawn, 0.5);
const sentinel = playerMesh.children.find(node => node.name === 'player_yawn_stretch_final_hand_pose');
assert.ok(sentinel?.onBeforeRender, 'hands are posed by the same final-render pattern as the punch dance');
sentinel.onBeforeRender();
assert.ok(left.position.y > 0.48 && right.position.y > 0.48, 'both arms stretch overhead at mid-yawn');
const leftHigh = left.position.y;
sentinel.onBeforeRender();
assert.equal(left.position.y, leftHigh, 'second render pass must not accumulate hand offsets');
assert.equal(window.PlayerBodyTransformComposer.setChannel('weapon-idle-stance-body-yaw', {}), false,
  'equipped weapon stance may not override the unarmed yawn body');
assert.equal(channels.has('weapon-idle-stance-body-yaw'), false);
const conflictingAction = { owner: 'other-interaction', participants: [{ id: 'player', channels: ['tools', 'actions'] }] };
locks.push(conflictingAction);
assert.equal(presentation.actionBlocked(yawn), true, 'new unrelated actions still interrupt an active yawn');
locks.pop();
const traversalAction = { owner: 'ledge-climb', participants: [{ id: 'player', channels: ['movement'] }] }; // Traversal may own movement without also locking the attack input.
locks.push(traversalAction);
assert.equal(presentation.actionBlocked(yawn), true, 'a movement-only traversal lock interrupts the stretch');
locks.pop();
presentation.end(yawn);
assert.equal(tool.visible, true);
assert.equal(bag.visible, true);
assert.equal(burden.visible, true);
assert.equal(left.position.y, 0, 'left hand returns to native animation without a residual stretch');
assert.equal(right.position.y, 0, 'right hand also restores its previous pose');
assert.equal(locks.length, 0, 'cancellation releases the action lock');
assert.equal(rig.getDebug().poseOwner, null, 'completion releases hand pose ownership to the normal grip driver');
assert.equal(presentation.debugSnapshot().hiddenHeldRoots, 0, 'visibility snapshots are cleared on finish');

right.visible = false;
const hiddenHandYawn = { isPlayer: true, komaStarted: false, walker: { root: playerMesh, avatarGroup: avatar } };
presentation.start(hiddenHandYawn); presentation.update(hiddenHandYawn, 0.5); sentinel.onBeforeRender();
assert.equal(right.visible, true, 'stretch temporarily reveals a hand hidden by its ordinary grip pose');
presentation.end(hiddenHandYawn);
assert.equal(right.visible, false, 'cleanup restores original hand visibility, not just its position');
right.visible = true; // Restore the normal hand baseline before the separate Koma check.

window.Combat.deps.toolHolder = invisibleTool;
const komaLock = { owner: 'npc-autonomous-drink', participants: [{ id: 'player', channels: ['tools', 'actions'] }] };
locks.push(komaLock);
const koma = { isPlayer: true, komaStarted: true, walker: { root: playerMesh, avatarGroup: avatar } };
presentation.start(koma); presentation.update(koma, 0.5); sentinel.onBeforeRender();
assert.equal(rig.getDebug().poseOwner, null, 'daily Koma keeps the natural right-hand chewing pose instead of claiming both hands');
assert.ok(left.position.y > 0.48, 'the free arm still stretches during the Koma chewing yawn');
assert.equal(right.position.y, 0, 'the Koma leaf retains its own right-hand chewing pose');
assert.equal(presentation.actionBlocked(koma), false, 'the yawn and its Koma-owned action lock coexist');
presentation.end(koma);
assert.equal(invisibleTool.visible, false, 'previously hidden equipment stays hidden on cleanup');
assert.equal(locks.length, 1, 'presentation may not release the independent Koma lock');
locks.pop();
assert.equal(presentation.debugSnapshot().lastError, null);
console.log('Player yawn stretch, held visuals, final-render pose, Koma, and cleanup: OK');
