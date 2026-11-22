#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
}
class Group {
  constructor() { this.isObject3D = true; this.parent = null; this.children = []; this.visible = true;
    this.position = new Vector(); this.rotation = new Vector(); this.scale = new Vector(1, 1, 1);
    this.userData = {}; }
  add(node) { node.parent?.remove(node); node.parent = this; this.children.push(node); }
  remove(node) { this.children = this.children.filter(child => child !== node); if (node.parent === this) node.parent = null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
class Mesh extends Group { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class PlaneGeometry { constructor(w, h) { this.width = w; this.height = h; } dispose() { this.disposed = true; } }
class MeshBasicMaterial { constructor(options) { Object.assign(this, options); } dispose() { this.disposed = true; } }
const THREE = { Group, Mesh, PlaneGeometry, MeshBasicMaterial, FrontSide: 0 }; // Small structural stand-in for actual THREE objects.
const scene = new Group(), babyRoot = new Group(), spouseRoot = new Group(), portrait = new Group();
babyRoot.position.set(6.5, 0, 6.5); spouseRoot.position.set(6.7, 0, 6.5);
scene.add(babyRoot); scene.add(spouseRoot); spouseRoot.add(portrait);
const babyAvatar = { userData: { frontTexture: {}, backTexture: {}, portraitModelWidth: .3, portraitModelHeight: .3 } };
const spouseAvatar = portrait; spouseAvatar.userData.portraitModelHeight = .95;
const child = { id: 'test-baby', name: 'Pip', otherParentId: 'spouse-id', carryBy: null };
const babyWalker = { rec: { id: child.id }, area: 'interior', root: babyRoot, avatarGroup: babyAvatar };
const spouseWalker = { rec: { id: 'spouse-id' }, area: 'interior', root: spouseRoot, avatarGroup: spouseAvatar };
let held = null, back = null, persistCount = 0, registered = 0, migrationCount = 0;
const api = {
  registerBurden(options) {
    assert.equal(Object.hasOwn(options, 'scene'), false, 'registry resolves the actual world scene, not NPC rig group');
    assert.equal(options.kind, 'familyBaby'); assert.equal(options.invulnerable, true); assert.equal(options.noHang, true);
    registered++;
    return { ...options, col: 6, row: 6, carried: false, flying: false, exploded: false };
  },
  pickUp(item) { held = item; item.carried = true; item.onPickup(item); return true; },
  heldBurdenInfo: () => held && { id: held.id },
  backCarriedInfo: () => back && { id: back.id },
  takeFromBack() { held = back; back = null; return !!held; },
  transferCarriedBurdenToArea(area, item) { assert(item.carried); item.mapId = area; migrationCount++; return true; },
  discardBurden(item) { if (held === item) held = null; if (back === item) back = null;
    item.onLost?.(item); item.group.parent?.remove(item.group); return true; },
};
const window = {
  THREE, Shattercasks: api,
  RomanceSystem: { helpers: { deps: () => ({ getCurrentArea: () => 'interior' }), findWalker: id => id === 'spouse-id' ? spouseWalker : null } },
};
vm.runInNewContext(fs.readFileSync('docs/js/family-baby-burdens.js', 'utf8'), { window, console });
const carry = window.FamilyBabyBurdens, persist = () => persistCount++;
assert(carry.sync(child, babyWalker, 'basket', persist));
assert.equal(registered, 1, 'one shared physical baby burden registered');
assert.equal(babyRoot.visible, true, 'baby NPC is visible in cradle');
assert.equal(carry.takeIntoArms(child, babyWalker, persist), true);
assert.equal(babyRoot.visible, false, 'baby NPC hides while player holds its lightweight proxy');
assert.equal(child.carryBy, 'player'); assert.equal(child.carryPose, 'arms');
assert.equal(carry.sync(child, babyWalker, 'basket', persist).burden.id, 'family_baby_test-baby');
back = held; held = null; carry.sync(child, babyWalker, 'basket', persist);
assert.equal(child.carryPose, 'back', 'player stowing is observed without a second carry implementation');
held = back; back = null; carry.sync(child, babyWalker, 'basket', persist);
assert.equal(child.carryPose, 'arms', 'player retrieving from back returns to arms');
const item = held; held = null; item.col = 7; item.row = 8; item.carried = false; item.onDrop(item);
assert.equal(child.carryBy, null); assert.equal(child.carrySpot.area, 'interior'); assert.equal(babyRoot.visible, true);
assert.equal(carry.spouseCarry(child, babyWalker, spouseWalker, 'back', persist), true);
assert.equal(child.carryBy, 'spouse'); assert.equal(child.carryPose, 'back');
assert.equal(carry.snapshot().babies[0].parent, portrait.name || null);
assert.equal(carry.takeIntoArms(child, babyWalker, persist), true, 'shared physical burden hands off from spouse to player');
assert.equal(child.carryBy, 'player'); assert.equal(registered, 1, 'handoff does not duplicate baby');
held = null; item.carried = true; child.carryBy = 'spouse'; item.mapId = 'farm';
assert.equal(carry.returnToBasket(child), true);
assert.equal(babyRoot.visible, true); assert.equal(child.carryBy, null); assert.equal(item.mapId, 'interior',
  'parent returning indoors re-registers the physical baby in the home area');
assert(migrationCount > 0);
carry.sync(child, babyWalker, 'toddler', persist);
assert.equal(carry.snapshot().babies.length, 0, 'toddler transition retires carrying proxy');
assert.equal(babyRoot.visible, true);
child.carryBy = 'spouse'; // Restore a save made while an NPC was holding the baby.
carry.sync(child, babyWalker, 'basket', persist);
assert.equal(child.carryBy, null, 'reloading cannot teleport baby into spouse arms without a live attachment');
assert.equal(carry.snapshot().babies.length, 1);
carry.clear(); assert.equal(carry.snapshot().babies.length, 0);
assert(persistCount > 0);
console.log('Single infant Burden, player/spouse handoff, back stow, zone transfer and cleanup: PASS');
